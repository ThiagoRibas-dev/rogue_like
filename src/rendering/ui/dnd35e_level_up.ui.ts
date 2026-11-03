/**
 * @file D&D 3.5e Interactive Level-Up Modal (Milestone 112.9).
 * Reuses shared 2-pane Skills, Feats, and Per-Class Spell step renderers with multiclass skill caps,
 * Prestige Class spellcasting target selectors, isolated per-class spell tabs, and mandatory step gating.
 */

import { getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import {
  type AbilityId,
  aggregateProgressionChassis,
  ALL_ABILITY_IDS,
  applyLevelUpToActor,
  buildHitDieTrackFromClass,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculateMulticlassXpMultiplier,
  calculateSkillAllocationCost,
  type ClassSpellSelectionBudget,
  computeAbilityModifier,
  computeClassSpellSelectionBudget,
  computeEffectiveClassCastingLevel,
  computeXpThresholdForLevel,
  evaluatePrerequisiteAST,
  getActorEverClassSkillIds,
  getClassLevelRow,
  getDnD35EntityData,
  getDnD35SystemContent,
  getEffectiveClassSkillIds,
  getEligibleBaseCastingClassesForPrestige,
  type LevelUpChoice,
  validateLevelUpStep
} from '../../rulesets/registry.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import { captureScrollPositions, restoreScrollPositions } from './dnd35e_char_builder.ui.ts';
import {
  renderSharedClassSpellStep,
  renderSharedFeatsStep,
  renderSharedSkillsStep
} from './dnd35e_char_builder_steps.ui.ts';

/** Hit Dice interval for ability score increases (`4`). */
const ABILITY_INCREASE_HD_STEP = 4;

/** Hit Dice interval for general feat slots (`3`). */
const GENERAL_FEAT_HD_STEP = 3;

let levelUpTab: 'class' | 'skills' | 'feats' | `spells:${string}` = 'class';

let levelUpDraft: LevelUpChoice = {
  classId: 'fighter',
  hpMethod: 'average',
  addedSkillRanks: {},
  selectedFeats: [],
  learnedSpells: [],
  advancedSpellcastingClassIds: [],
  learnedSpellsByClass: {}
};

/**
 * Checks whether the player actor has enough XP to advance to the next character level.
 */
export function canPlayerLevelUpDnD35e(state: GameState, playerId: EntityId): boolean {
  if (state.campaign.manifest.rulesetId !== 'dnd35e') return false;
  const fighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return false;
  const dndData = getDnD35EntityData(state, playerId);
  const chassis = aggregateProgressionChassis(dndData.tracks, 0, dndData.levelAdjustment ?? 0);
  const nextThreshold = computeXpThresholdForLevel(chassis.ecl + 1);
  return fighter.xp >= nextThreshold;
}

/**
 * Renders the D&D 3.5e Interactive Level-Up Modal when `state.uiMode === UIMode.LevelUp`.
 */
export function renderDnD35eLevelUpModal(state: GameState): void {
  const overlay = document.getElementById('level-up-overlay');
  if (!overlay) return;

  if (state.uiMode !== UIMode.LevelUp) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  const content = document.getElementById('level-up-body');
  if (!content) return;

  const savedScrolls = captureScrollPositions(content);
  content.replaceChildren();

  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!sys || playerId === undefined) return;

  const dndData = getDnD35EntityData(state, playerId);
  const prereqCtx = buildPrerequisiteContextForActor(dndData, sys.classes);
  const currentChassis = aggregateProgressionChassis(dndData.tracks, 0, dndData.levelAdjustment ?? 0);
  const nextCharLevel = currentChassis.totalHD + 1;

  const activeCls = sys.classes[levelUpDraft.classId] ?? Object.values(sys.classes)[0]!;
  const existingTrack = dndData.tracks.find((t) => t.trackId === activeCls.id);
  const nextClassLevel = (existingTrack ? existingTrack.levels : 0) + 1;
  const nextRow = getClassLevelRow(activeCls, nextClassLevel);

  const raceDef = dndData.raceId ? sys.races[dndData.raceId] : undefined;
  const intScore = (dndData.abilityScores.int.base ?? 10) + (levelUpDraft.abilityScoreIncrease === 'int' ? 1 : 0);
  const intMod = computeAbilityModifier(intScore);
  const skillBudget = calculateLevelSkillPointBudget(
    activeCls.skillPointsPerLevel,
    intMod,
    false,
    0,
    raceDef?.extraSkillPointsPerLevel ?? 0
  );
  const activeLevelClassSkillIds = getEffectiveClassSkillIds(activeCls, dndData.domains ?? [], sys);
  const everClassSkillIds = getActorEverClassSkillIds(dndData, activeCls.id, dndData.domains ?? [], sys);
  const literacyCost = levelUpDraft.spendSkillPointsForLiteracy === true ? 2 : 0;
  const skillSpent =
    calculateSkillAllocationCost(levelUpDraft.addedSkillRanks, activeLevelClassSkillIds) + literacyCost;
  const skillRemaining = Math.max(0, Math.round((skillBudget - skillSpent) * 100) / 100);

  const generalFeatEarned = nextCharLevel % GENERAL_FEAT_HD_STEP === 0 ? 1 : 0;
  const bonusFeatEarned = nextRow?.bonusFeatSlot === true ? 1 : 0;
  const totalFeatSlots = generalFeatEarned + bonusFeatEarned;

  // Determine advanced spellcasting classes at this level (either base class itself or prestige class targets)
  const prestigeSlots = getEligibleBaseCastingClassesForPrestige(
    dndData.tracks,
    activeCls,
    nextClassLevel,
    sys.classes
  );

  // Auto-populate default prestige targets if not yet chosen
  let effectivePrestigeTargets = [...(levelUpDraft.advancedSpellcastingClassIds ?? [])];
  if (prestigeSlots.length > 0 && effectivePrestigeTargets.length === 0) {
    effectivePrestigeTargets = prestigeSlots
      .map((slot) => slot.eligibleClassIds[0])
      .filter((id): id is string => id !== undefined);
    if (effectivePrestigeTargets.length > 0) {
      levelUpDraft = { ...levelUpDraft, advancedSpellcastingClassIds: effectivePrestigeTargets };
    }
  }

  const advancedCastingClassIds: string[] = [];
  if (activeCls.castingMode !== 'none' && !activeCls.isPrestige) {
    advancedCastingClassIds.push(activeCls.id);
  }
  for (const targetId of effectivePrestigeTargets) {
    if (targetId && !advancedCastingClassIds.includes(targetId)) {
      advancedCastingClassIds.push(targetId);
    }
  }

  const spellTabs: Array<{
    readonly tabId: `spells:${string}`;
    readonly classId: string;
    readonly className: string;
    readonly castingTradition: string;
    readonly budget: ClassSpellSelectionBudget;
  }> = [];

  for (const targetClassId of advancedCastingClassIds) {
    const targetCls = sys.classes[targetClassId];
    if (!targetCls) continue;
    const prevEffLvl = computeEffectiveClassCastingLevel(dndData.tracks, targetCls, sys.classes, dndData.levelHistory);
    const nextEffLvl = prevEffLvl + 1;
    const existingKnown =
      dndData.spellbooksByClass?.[targetClassId]?.knownSpellIds ??
      (targetClassId === dndData.tracks[0]?.trackId ? (dndData.knownSpells ?? []) : []);
    const spBudget = computeClassSpellSelectionBudget(
      targetCls,
      prevEffLvl,
      nextEffLvl,
      intMod,
      dndData.prohibitedSchools ?? [],
      dndData.domains ?? [],
      existingKnown,
      sys
    );
    if (spBudget.requiresManualSelection) {
      spellTabs.push({
        tabId: `spells:${targetClassId}`,
        classId: targetClassId,
        className: targetCls.name,
        castingTradition: targetCls.castingTradition,
        budget: spBudget
      });
    }
  }

  const tabs: Array<{ readonly id: typeof levelUpTab; readonly label: string }> = [
    { id: 'class', label: `1. Class & HP (HD ${nextCharLevel})` },
    { id: 'skills', label: `2. Skills (${skillRemaining}/${skillBudget} pts)` },
    { id: 'feats', label: `3. Feats (${levelUpDraft.selectedFeats.length}/${totalFeatSlots})` }
  ];
  spellTabs.forEach((st, idx) => {
    const pickedCount =
      levelUpDraft.learnedSpellsByClass?.[st.classId]?.length ??
      (st.classId === activeCls.id ? (levelUpDraft.learnedSpells ?? []).length : 0);
    tabs.push({
      id: st.tabId,
      label: `${4 + idx}. ${st.className} Spells (${pickedCount})`
    });
  });

  if (!tabs.some((t) => t.id === levelUpTab)) {
    levelUpTab = 'class';
  }
  const activeTabIndex = tabs.findIndex((t) => t.id === levelUpTab);
  const currentTabCheck = validateLevelUpStep(dndData, levelUpDraft, levelUpTab, sys);

  const canNavigateToTab = (targetIdx: number): boolean => {
    if (targetIdx <= activeTabIndex) return true;
    for (let i = 0; i < targetIdx; i++) {
      const tb = tabs[i];
      if (tb && !validateLevelUpStep(dndData, levelUpDraft, tb.id, sys).valid) {
        return false;
      }
    }
    return true;
  };

  // Sub-step navigation bar
  const tabBar = document.createElement('div');
  tabBar.style.display = 'flex';
  tabBar.style.flexWrap = 'wrap';
  tabBar.style.gap = '6px';
  tabs.forEach((t, idx) => {
    const tBtn = document.createElement('button');
    tBtn.type = 'button';
    tBtn.className = 'modal-btn';
    tBtn.style.padding = '6px 12px';
    tBtn.style.fontSize = '0.8rem';
    const tabValid = validateLevelUpStep(dndData, levelUpDraft, t.id, sys).valid;
    tBtn.style.borderColor = levelUpTab === t.id ? '#2ecc71' : tabValid ? 'var(--border-color)' : '#e67e22';
    tBtn.textContent = t.label;
    tBtn.disabled = !canNavigateToTab(idx);
    tBtn.addEventListener('click', () => {
      if (!canNavigateToTab(idx)) return;
      levelUpTab = t.id;
      renderDnD35eLevelUpModal(state);
    });
    tabBar.appendChild(tBtn);
  });
  content.appendChild(tabBar);

  const stageHost = document.createElement('div');
  stageHost.style.flex = '1';
  stageHost.style.minHeight = '0';
  stageHost.style.display = 'flex';
  stageHost.style.flexDirection = 'column';
  stageHost.style.overflow = 'hidden';

  if (levelUpTab === 'class') {
    const stage = document.createElement('div');
    stage.className = 'dnd35-two-pane-stage';

    const leftPane = document.createElement('div');
    leftPane.className = 'dnd35-pane-left';
    leftPane.dataset['scrollId'] = 'lvlup-class-left';

    const rightPane = document.createElement('div');
    rightPane.className = 'dnd35-pane-right';
    rightPane.dataset['scrollId'] = 'lvlup-class-right';

    for (const cls of Object.values(sys.classes).filter((c) => !c.isNpcClass)) {
      const meetsPrereqs = cls.prerequisites ? evaluatePrerequisiteAST(cls.prerequisites, prereqCtx) : true;
      const alignOk = cls.allowedAlignments ? cls.allowedAlignments.includes(dndData.alignment ?? 'N') : true;
      const eligible = meetsPrereqs && alignOk;

      const trk = dndData.tracks.find((t) => t.trackId === cls.id);
      const nxtLvl = (trk ? trk.levels : 0) + 1;
      const previewTracks = trk
        ? dndData.tracks.map((t) => (t.trackId === cls.id ? buildHitDieTrackFromClass(cls, nxtLvl) : t))
        : [...dndData.tracks, buildHitDieTrackFromClass(cls, 1)];
      const xpMult = calculateMulticlassXpMultiplier(
        previewTracks,
        sys.classes,
        dndData.favoredClass ?? 'any',
        dndData.enforceMulticlassXpPenalty ?? true
      );
      const rRow = getClassLevelRow(cls, nxtLvl) ?? cls.progression[cls.progression.length - 1]!;
      const isSelected = levelUpDraft.classId === cls.id;

      const row = document.createElement('div');
      row.className = `dnd35-list-item${isSelected ? ' selected' : ''}`;
      const tag = cls.isPrestige ? '[Prestige]' : '[Base]';
      const xpNote = xpMult < 1 ? ` ⚠ XP ${Math.round(xpMult * 100)}%` : '';
      row.textContent = `${eligible ? '🟢' : '🔴'} ${tag} ${cls.name} (Lv ${nxtLvl}, d${cls.hitDieSides}, BAB +${rRow.bab})${xpNote}`;
      row.addEventListener('click', () => {
        if (!eligible) return;
        levelUpDraft = {
          ...levelUpDraft,
          classId: cls.id,
          addedSkillRanks: {},
          selectedFeats: [],
          learnedSpells: [],
          advancedSpellcastingClassIds: [],
          learnedSpellsByClass: {}
        };
        renderDnD35eLevelUpModal(state);
      });
      leftPane.appendChild(row);
    }

    // Right pane: HP method, 4th-HD ability increase, Prestige spellcasting target selectors
    const rTitle = document.createElement('h3');
    rTitle.style.margin = '0 0 6px 0';
    rTitle.style.color = '#2ecc71';
    rTitle.textContent = `${activeCls.name} Level ${nextClassLevel} Advancement`;
    rightPane.appendChild(rTitle);

    const hpRow = document.createElement('div');
    hpRow.style.display = 'flex';
    hpRow.style.gap = '8px';
    for (const method of ['average', 'roll'] as const) {
      const mBtn = document.createElement('button');
      mBtn.type = 'button';
      mBtn.className = 'modal-btn';
      mBtn.style.borderColor = levelUpDraft.hpMethod === method ? '#f1c40f' : 'var(--border-color)';
      mBtn.textContent =
        method === 'average'
          ? `Fixed Average (+${Math.floor(activeCls.hitDieSides / 2) + 1} HP)`
          : `🎲 Roll 1d${activeCls.hitDieSides}`;
      mBtn.addEventListener('click', () => {
        levelUpDraft = { ...levelUpDraft, hpMethod: method };
        renderDnD35eLevelUpModal(state);
      });
      hpRow.appendChild(mBtn);
    }
    rightPane.appendChild(hpRow);

    if (nextCharLevel % ABILITY_INCREASE_HD_STEP === 0) {
      const abTitle = document.createElement('strong');
      abTitle.style.color = '#f1c40f';
      abTitle.textContent = '+1 Ability Score Increase (Every 4th Hit Die):';
      rightPane.appendChild(abTitle);
      const abWrap = document.createElement('div');
      abWrap.style.display = 'flex';
      abWrap.style.flexWrap = 'wrap';
      abWrap.style.gap = '6px';
      for (const key of ALL_ABILITY_IDS) {
        const kBtn = document.createElement('button');
        kBtn.type = 'button';
        kBtn.className = 'modal-btn';
        kBtn.style.padding = '4px 8px';
        kBtn.style.borderColor = levelUpDraft.abilityScoreIncrease === key ? '#f1c40f' : 'var(--border-color)';
        kBtn.textContent = `+1 ${key.toUpperCase()}`;
        kBtn.addEventListener('click', () => {
          levelUpDraft = { ...levelUpDraft, abilityScoreIncrease: key };
          renderDnD35eLevelUpModal(state);
        });
        abWrap.appendChild(kBtn);
      }
      rightPane.appendChild(abWrap);
    }

    // Prestige Class +1 Existing Spellcasting Class target selectors
    if (prestigeSlots.length > 0) {
      prestigeSlots.forEach((slot, slotIdx) => {
        const slotHeader = document.createElement('strong');
        slotHeader.style.color = '#58a6ff';
        slotHeader.textContent = `${slot.label}:`;
        rightPane.appendChild(slotHeader);

        const slotWrap = document.createElement('div');
        slotWrap.style.display = 'flex';
        slotWrap.style.flexWrap = 'wrap';
        slotWrap.style.gap = '6px';
        const curTarget = effectivePrestigeTargets[slotIdx];
        for (const candId of slot.eligibleClassIds) {
          const candCls = sys.classes[candId];
          const cBtn = document.createElement('button');
          cBtn.type = 'button';
          cBtn.className = 'modal-btn';
          cBtn.style.padding = '4px 8px';
          cBtn.style.borderColor = curTarget === candId ? '#2ecc71' : 'var(--border-color)';
          cBtn.textContent = candCls?.name ?? candId;
          cBtn.addEventListener('click', () => {
            const nextTargets = [...effectivePrestigeTargets];
            nextTargets[slotIdx] = candId;
            levelUpDraft = {
              ...levelUpDraft,
              advancedSpellcastingClassIds: nextTargets
            };
            renderDnD35eLevelUpModal(state);
          });
          slotWrap.appendChild(cBtn);
        }
        rightPane.appendChild(slotWrap);
      });
    }

    stage.appendChild(leftPane);
    stage.appendChild(rightPane);
    stageHost.appendChild(stage);
  } else if (levelUpTab === 'skills') {
    const abilityModifiers: Record<AbilityId, number> = {
      str: computeAbilityModifier(
        (dndData.abilityScores.str.base ?? 10) + (levelUpDraft.abilityScoreIncrease === 'str' ? 1 : 0)
      ),
      dex: computeAbilityModifier(
        (dndData.abilityScores.dex.base ?? 10) + (levelUpDraft.abilityScoreIncrease === 'dex' ? 1 : 0)
      ),
      con: computeAbilityModifier(
        (dndData.abilityScores.con.base ?? 10) + (levelUpDraft.abilityScoreIncrease === 'con' ? 1 : 0)
      ),
      int: intMod,
      wis: computeAbilityModifier(
        (dndData.abilityScores.wis.base ?? 10) + (levelUpDraft.abilityScoreIncrease === 'wis' ? 1 : 0)
      ),
      cha: computeAbilityModifier(
        (dndData.abilityScores.cha.base ?? 10) + (levelUpDraft.abilityScoreIncrease === 'cha' ? 1 : 0)
      )
    };

    const miscSkillBonuses: Record<string, number> = {};
    for (const mod of dndData.statModifiers ?? []) {
      if (mod.targetStat.startsWith('skill:')) {
        const skId = mod.targetStat.slice('skill:'.length);
        miscSkillBonuses[skId] = (miscSkillBonuses[skId] ?? 0) + mod.value;
      }
    }

    renderSharedSkillsStep(stageHost, sys, {
      scrollPrefix: 'lvlup',
      totalHd: nextCharLevel,
      budget: Math.max(0, skillBudget - literacyCost),
      activeLevelClassSkillIds,
      everClassSkillIds,
      priorSkillRanks: dndData.skillRanks,
      addedSkillRanks: levelUpDraft.addedSkillRanks,
      abilityModifiers,
      miscSkillBonuses,
      onUpdateAddedRanks: (nextAdded) => {
        levelUpDraft = { ...levelUpDraft, addedSkillRanks: nextAdded };
        renderDnD35eLevelUpModal(state);
      },
      onRefresh: () => renderDnD35eLevelUpModal(state)
    });
  } else if (levelUpTab === 'feats') {
    const parts: string[] = [];
    if (generalFeatEarned > 0) parts.push(`${generalFeatEarned} General`);
    if (bonusFeatEarned > 0) parts.push(`${bonusFeatEarned} Class Bonus`);
    const summaryLabel =
      totalFeatSlots > 0
        ? `Feats Selected: ${levelUpDraft.selectedFeats.length} / ${totalFeatSlots} (${parts.join(' + ')})`
        : 'No new feat slots earned at this Hit Die (General feats gained at HD 3, 6, 9, 12, 15, 18)';

    renderSharedFeatsStep(stageHost, sys, {
      scrollPrefix: 'lvlup',
      slotSummaryLabel: summaryLabel,
      totalSlots: totalFeatSlots,
      alreadyOwnedFeatIds: dndData.feats,
      selectedFeatIds: levelUpDraft.selectedFeats,
      prereqCtx,
      onUpdateSelectedFeats: (nextFeats) => {
        levelUpDraft = { ...levelUpDraft, selectedFeats: nextFeats };
        renderDnD35eLevelUpModal(state);
      },
      onRefresh: () => renderDnD35eLevelUpModal(state)
    });
  } else if (levelUpTab.startsWith('spells:')) {
    const targetClassId = levelUpTab.slice('spells:'.length);
    const spellTabEntry = spellTabs.find((st) => st.classId === targetClassId);
    if (spellTabEntry) {
      const priorClassSpells: ReadonlyArray<string> =
        dndData.spellbooksByClass?.[targetClassId]?.knownSpellIds ??
        (targetClassId === dndData.tracks[0]?.trackId ? (dndData.knownSpells ?? []) : []);
      const curClassPicks: ReadonlyArray<string> =
        levelUpDraft.learnedSpellsByClass?.[targetClassId] ??
        (targetClassId === activeCls.id ? (levelUpDraft.learnedSpells ?? []) : []);

      renderSharedClassSpellStep(stageHost, sys, {
        scrollPrefix: 'lvlup',
        classId: spellTabEntry.classId,
        className: spellTabEntry.className,
        castingTradition: spellTabEntry.castingTradition,
        budget: spellTabEntry.budget,
        priorKnownSpells: priorClassSpells,
        selectedSpells: curClassPicks,
        prohibitedSchools: dndData.prohibitedSchools ?? [],
        domains: dndData.domains ?? [],
        onUpdateSelectedSpells: (nextSpells) => {
          const nextByClass = {
            ...(levelUpDraft.learnedSpellsByClass ?? {}),
            [targetClassId]: nextSpells
          };
          levelUpDraft = {
            ...levelUpDraft,
            learnedSpells: targetClassId === activeCls.id ? nextSpells : (levelUpDraft.learnedSpells ?? []),
            learnedSpellsByClass: nextByClass
          };
          renderDnD35eLevelUpModal(state);
        },
        onRefresh: () => renderDnD35eLevelUpModal(state)
      });
    }
  }

  content.appendChild(stageHost);

  if (!currentTabCheck.valid && currentTabCheck.reason) {
    const gateBanner = document.createElement('div');
    gateBanner.style.padding = '5px 10px';
    gateBanner.style.fontSize = '0.78rem';
    gateBanner.style.color = '#f39c12';
    gateBanner.style.border = '1px solid #e67e22';
    gateBanner.style.background = 'rgba(230, 126, 34, 0.12)';
    gateBanner.textContent = `⚠ Required before proceeding: ${currentTabCheck.reason}`;
    content.appendChild(gateBanner);
  }

  // Footer commit / navigation
  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.paddingTop = '6px';
  footer.style.borderTop = '1px solid #333947';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-btn';
  cancelBtn.textContent = 'Later (Esc)';
  cancelBtn.addEventListener('click', () => {
    setGameState({ ...state, uiMode: UIMode.Game });
    markAllDomainsDirty();
  });

  const navRight = document.createElement('div');
  navRight.style.display = 'flex';
  navRight.style.gap = '8px';

  if (activeTabIndex > 0) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'modal-btn';
    prevBtn.textContent = '← Previous';
    prevBtn.addEventListener('click', () => {
      const prevTab = tabs[activeTabIndex - 1];
      if (prevTab) {
        levelUpTab = prevTab.id;
        renderDnD35eLevelUpModal(state);
      }
    });
    navRight.appendChild(prevBtn);
  }

  if (activeTabIndex < tabs.length - 1) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'modal-btn';
    nextBtn.textContent = 'Next Step →';
    nextBtn.disabled = !currentTabCheck.valid;
    nextBtn.addEventListener('click', () => {
      if (!currentTabCheck.valid) return;
      const nextTab = tabs[activeTabIndex + 1];
      if (nextTab) {
        levelUpTab = nextTab.id;
        renderDnD35eLevelUpModal(state);
      }
    });
    navRight.appendChild(nextBtn);
  }

  const allTabsValid = tabs.every((tb) => validateLevelUpStep(dndData, levelUpDraft, tb.id, sys).valid);
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'modal-btn';
  confirmBtn.style.borderColor = allTabsValid ? '#2ecc71' : 'var(--border-color)';
  confirmBtn.textContent = '✔ Confirm Level Up';
  confirmBtn.disabled = !allTabsValid;
  confirmBtn.addEventListener('click', () => {
    if (!allTabsValid) return;
    const result = applyLevelUpToActor(state, playerId, levelUpDraft);
    setGameState({ ...result.state, uiMode: UIMode.Game });
    markAllDomainsDirty();
  });
  navRight.appendChild(confirmBtn);

  footer.appendChild(cancelBtn);
  footer.appendChild(navRight);
  content.appendChild(footer);

  restoreScrollPositions(content, savedScrolls);
}
