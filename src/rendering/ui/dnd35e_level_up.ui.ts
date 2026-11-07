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
  ALL_ABILITY_IDS,
  aggregateProgressionChassis,
  applyLevelUpToActor,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  computeAbilityModifier,
  computeXpThresholdForLevel,
  getActorEverClassSkillIds,
  getClassLevelRow,
  getDnD35EntityData,
  getDnD35SystemContent,
  getEffectiveClassSkillIds,
  type LevelUpChoice,
  validateLevelUpStep
} from '../../rulesets/registry.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { closeCartridgeModal, isCartridgeModalOpen } from './cartridge_ui_registry.ts';
import { captureScrollPositions, restoreScrollPositions } from './dnd35e_char_builder.ui.ts';
import {
  renderSharedClassSpellStep,
  renderSharedFeatsStep,
  renderSharedSkillsStep
} from './dnd35e_char_builder_steps.ui.ts';
import {
  computeLevelUpSpellTabs,
  GENERAL_FEAT_HD_STEP,
  renderLevelUpClassStage,
  renderLevelUpFooter
} from './dnd35e_level_up_class.ui.ts';

export * from './dnd35e_level_up_class.ui.ts';

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
  if (!isCartridgeModalOpen(state, 'level_up')) {
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

  const { prestigeSlots, effectivePrestigeTargets, spellTabs } = computeLevelUpSpellTabs(
    dndData,
    activeCls,
    nextClassLevel,
    intMod,
    levelUpDraft,
    sys
  );
  if (effectivePrestigeTargets.length > 0 && (levelUpDraft.advancedSpellcastingClassIds ?? []).length === 0) {
    levelUpDraft = { ...levelUpDraft, advancedSpellcastingClassIds: effectivePrestigeTargets };
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
    tabs.push({ id: st.tabId, label: `${4 + idx}. ${st.className} Spells (${pickedCount})` });
  });

  if (!tabs.some((t) => t.id === levelUpTab)) levelUpTab = 'class';
  const activeTabIndex = tabs.findIndex((t) => t.id === levelUpTab);
  const currentTabCheck = validateLevelUpStep(dndData, levelUpDraft, levelUpTab, sys);

  const canNavigateToTab = (targetIdx: number): boolean => {
    if (targetIdx <= activeTabIndex) return true;
    for (let i = 0; i < targetIdx; i++) {
      const tb = tabs[i];
      if (tb && !validateLevelUpStep(dndData, levelUpDraft, tb.id, sys).valid) return false;
    }
    return true;
  };

  const tabBar = document.createElement('div');
  tabBar.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';
  tabs.forEach((t, idx) => {
    const tBtn = document.createElement('button');
    tBtn.type = 'button';
    tBtn.className = 'modal-btn';
    const tabValid = validateLevelUpStep(dndData, levelUpDraft, t.id, sys).valid;
    const borderCol =
      levelUpTab === t.id
        ? 'var(--crpg-success, #2ecc71)'
        : tabValid
          ? 'var(--border-color)'
          : 'var(--crpg-warning, #e67e22)';
    tBtn.style.cssText = `padding: 6px 12px; font-size: 0.8rem; border-color: ${borderCol};`;
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
  stageHost.style.cssText = 'flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden;';

  if (levelUpTab === 'class') {
    renderLevelUpClassStage(
      stageHost,
      dndData,
      prereqCtx,
      activeCls,
      nextClassLevel,
      nextCharLevel,
      prestigeSlots,
      effectivePrestigeTargets,
      levelUpDraft,
      sys,
      (nextDraft) => {
        levelUpDraft = nextDraft;
        renderDnD35eLevelUpModal(state);
      }
    );
  } else if (levelUpTab === 'skills') {
    const abilityModifiers = {} as Record<AbilityId, number>;
    for (const k of ALL_ABILITY_IDS) {
      abilityModifiers[k] = computeAbilityModifier(
        (dndData.abilityScores[k].base ?? 10) + (levelUpDraft.abilityScoreIncrease === k ? 1 : 0)
      );
    }
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
          const nextByClass = { ...(levelUpDraft.learnedSpellsByClass ?? {}), [targetClassId]: nextSpells };
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

  const allTabsValid = tabs.every((tb) => validateLevelUpStep(dndData, levelUpDraft, tb.id, sys).valid);
  renderLevelUpFooter(
    content,
    currentTabCheck,
    activeTabIndex,
    tabs.length,
    allTabsValid,
    () => {
      setGameState(closeCartridgeModal(state));
      markAllDomainsDirty();
    },
    (delta) => {
      const targetTab = tabs[activeTabIndex + delta];
      if (targetTab) {
        levelUpTab = targetTab.id;
        renderDnD35eLevelUpModal(state);
      }
    },
    () => {
      const result = applyLevelUpToActor(state, playerId, levelUpDraft);
      setGameState(closeCartridgeModal(result.state));
      markAllDomainsDirty();
    }
  );

  restoreScrollPositions(content, savedScrolls);
}
