/**
 * @file D&D 3.5e Interactive Level-Up Modal (Milestone 112.5).
 * Full-screen 2-pane layout with locked prior skill ranks, `[ - ] [ +delta ] [ + ]` steppers,
 * feat & prestige class prerequisite inspection, and scroll preservation.
 */

import { getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import {
  aggregateProgressionChassis,
  ALL_ABILITY_IDS,
  applyLevelUpToActor,
  buildHitDieTrackFromClass,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculateMulticlassXpMultiplier,
  calculateSkillAllocationCost,
  computeAbilityModifier,
  computeXpThresholdForLevel,
  evaluatePrerequisiteAST,
  getClassLevelRow,
  getDnD35EntityData,
  getDnD35SystemContent,
  getEffectiveClassSkillIds,
  getSkillMaxRanks,
  type LevelUpChoice
} from '../../rulesets/registry.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import { captureScrollPositions, restoreScrollPositions } from './dnd35e_char_builder.ui.ts';
import { renderFeatInspector, renderSkillInspector } from './dnd35e_inspector.ui.ts';

/** Hit Dice interval for ability score increases (`4`). */
const ABILITY_INCREASE_HD_STEP = 4;

/** Hit Dice interval for general feat slots (`3`). */
const GENERAL_FEAT_HD_STEP = 3;

let levelUpTab: 'class' | 'skills' | 'feats' = 'class';
let inspectedSkillId = 'tumble';
let inspectedFeatId = 'power_attack';

let levelUpDraft: LevelUpChoice = {
  classId: 'fighter',
  hpMethod: 'average',
  addedSkillRanks: {},
  selectedFeats: [],
  learnedSpells: []
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
  const classSkillIds = getEffectiveClassSkillIds(activeCls, dndData.domains ?? [], sys);
  const skillSpent = calculateSkillAllocationCost(levelUpDraft.addedSkillRanks, classSkillIds);
  const skillRemaining = Math.max(0, Math.round((skillBudget - skillSpent) * 100) / 100);

  const generalFeatEarned = nextCharLevel % GENERAL_FEAT_HD_STEP === 0 ? 1 : 0;
  const bonusFeatEarned = nextRow?.bonusFeatSlot === true ? 1 : 0;
  const totalFeatSlots = generalFeatEarned + bonusFeatEarned;

  // Sub-step navigation bar
  const tabBar = document.createElement('div');
  tabBar.style.display = 'flex';
  tabBar.style.gap = '6px';
  const tabs: ReadonlyArray<{ readonly id: typeof levelUpTab; readonly label: string }> = [
    { id: 'class', label: `1. Class & HP (HD ${nextCharLevel})` },
    { id: 'skills', label: `2. Skills (${skillRemaining}/${skillBudget} pts)` },
    { id: 'feats', label: `3. Feats (${levelUpDraft.selectedFeats.length}/${totalFeatSlots})` }
  ];
  for (const t of tabs) {
    const tBtn = document.createElement('button');
    tBtn.type = 'button';
    tBtn.className = 'modal-btn';
    tBtn.style.padding = '6px 12px';
    tBtn.style.fontSize = '0.8rem';
    tBtn.style.borderColor = levelUpTab === t.id ? '#2ecc71' : 'var(--border-color)';
    tBtn.textContent = t.label;
    tBtn.addEventListener('click', () => {
      levelUpTab = t.id;
      renderDnD35eLevelUpModal(state);
    });
    tabBar.appendChild(tBtn);
  }
  content.appendChild(tabBar);

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = `lvlup-${levelUpTab}-left`;

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = `lvlup-${levelUpTab}-right`;

  if (levelUpTab === 'class') {
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
        levelUpDraft = { ...levelUpDraft, classId: cls.id, addedSkillRanks: {}, selectedFeats: [] };
        renderDnD35eLevelUpModal(state);
      });
      leftPane.appendChild(row);
    }

    // Right pane: HP method, 4th-HD ability increase, and class progression preview
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
  } else if (levelUpTab === 'skills') {
    const allSkills = Object.values(sys.skills).sort((a, b) => a.name.localeCompare(b.name));
    for (const skill of allSkills) {
      const isClass = classSkillIds.includes(skill.id);
      const baseRanks = dndData.skillRanks[skill.id] ?? 0;
      const addedDelta = levelUpDraft.addedSkillRanks[skill.id] ?? 0;
      const totalRanks = baseRanks + addedDelta;
      const maxRanks = getSkillMaxRanks(nextCharLevel, isClass);
      const rankStep = isClass ? 1 : 0.5;
      const abMod = computeAbilityModifier(dndData.abilityScores[skill.keyAbility].base ?? 10);

      const row = document.createElement('div');
      row.className = `dnd35-list-item${addedDelta > 0 ? ' selected' : ''}${inspectedSkillId === skill.id ? ' inspected' : ''}`;
      row.addEventListener('click', () => {
        inspectedSkillId = skill.id;
        const mergedRanks = { ...dndData.skillRanks };
        for (const [k, v] of Object.entries(levelUpDraft.addedSkillRanks)) {
          mergedRanks[k] = (mergedRanks[k] ?? 0) + v;
        }
        renderSkillInspector(rightPane, skill, totalRanks, mergedRanks, abMod, 0, isClass, maxRanks, sys);
      });

      const lbl = document.createElement('span');
      lbl.textContent = `${skill.name} (${skill.keyAbility.toUpperCase()}) [${isClass ? 'Class' : 'Cross'}] — Prior: ${baseRanks}`;

      const counter = document.createElement('div');
      counter.className = 'dnd35-counter-group';

      const btnMinus = document.createElement('button');
      btnMinus.type = 'button';
      btnMinus.className = 'modal-btn dnd35-counter-btn';
      btnMinus.textContent = '−';
      btnMinus.disabled = addedDelta <= 0;
      btnMinus.addEventListener('click', (e) => {
        e.stopPropagation();
        inspectedSkillId = skill.id;
        const nextDelta = Math.max(0, Math.round((addedDelta - rankStep) * 10) / 10);
        const nextAdded = { ...levelUpDraft.addedSkillRanks };
        if (nextDelta <= 0) delete nextAdded[skill.id];
        else nextAdded[skill.id] = nextDelta;
        levelUpDraft = { ...levelUpDraft, addedSkillRanks: nextAdded };
        renderDnD35eLevelUpModal(state);
      });

      const valSpan = document.createElement('span');
      valSpan.className = 'dnd35-counter-val';
      valSpan.textContent = `+${addedDelta} (${totalRanks}/${maxRanks})`;

      const btnPlus = document.createElement('button');
      btnPlus.type = 'button';
      btnPlus.className = 'modal-btn dnd35-counter-btn';
      btnPlus.textContent = '+';
      btnPlus.disabled = totalRanks + rankStep > maxRanks || skillRemaining < 1;
      btnPlus.addEventListener('click', (e) => {
        e.stopPropagation();
        inspectedSkillId = skill.id;
        const nextDelta = Math.round((addedDelta + rankStep) * 10) / 10;
        levelUpDraft = {
          ...levelUpDraft,
          addedSkillRanks: { ...levelUpDraft.addedSkillRanks, [skill.id]: nextDelta }
        };
        renderDnD35eLevelUpModal(state);
      });

      counter.appendChild(btnMinus);
      counter.appendChild(valSpan);
      counter.appendChild(btnPlus);
      row.appendChild(lbl);
      row.appendChild(counter);
      leftPane.appendChild(row);
    }

    const activeSkill = sys.skills[inspectedSkillId] ?? allSkills[0];
    if (activeSkill) {
      const isClass = classSkillIds.includes(activeSkill.id);
      const maxRanks = getSkillMaxRanks(nextCharLevel, isClass);
      const mergedRanks = { ...dndData.skillRanks };
      for (const [k, v] of Object.entries(levelUpDraft.addedSkillRanks)) {
        mergedRanks[k] = (mergedRanks[k] ?? 0) + v;
      }
      const abMod = computeAbilityModifier(dndData.abilityScores[activeSkill.keyAbility].base ?? 10);
      renderSkillInspector(
        rightPane,
        activeSkill,
        mergedRanks[activeSkill.id] ?? 0,
        mergedRanks,
        abMod,
        0,
        isClass,
        maxRanks,
        sys
      );
    }
  } else {
    const allFeats = Object.values(sys.feats);
    for (const feat of allFeats) {
      const alreadyOwned = dndData.feats.includes(feat.id);
      const meets = feat.prerequisites ? evaluatePrerequisiteAST(feat.prerequisites, prereqCtx) : true;
      const isSelected = levelUpDraft.selectedFeats.includes(feat.id);
      const canToggle = isSelected || (!alreadyOwned && meets && levelUpDraft.selectedFeats.length < totalFeatSlots);

      const row = document.createElement('div');
      row.className = `dnd35-list-item${isSelected ? ' selected' : ''}${inspectedFeatId === feat.id ? ' inspected' : ''}`;
      row.addEventListener('click', () => {
        inspectedFeatId = feat.id;
        renderFeatInspector(rightPane, feat, prereqCtx);
      });

      const lbl = document.createElement('span');
      lbl.textContent = `${alreadyOwned ? '✔ [Owned]' : isSelected ? '☑' : meets ? '🟢' : '🔴'} ${feat.name}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modal-btn';
      btn.style.padding = '3px 8px';
      btn.style.fontSize = '0.74rem';
      btn.textContent = isSelected ? 'Remove' : 'Select';
      btn.disabled = !canToggle;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        inspectedFeatId = feat.id;
        const nextFeats = isSelected
          ? levelUpDraft.selectedFeats.filter((id) => id !== feat.id)
          : [...levelUpDraft.selectedFeats, feat.id];
        levelUpDraft = { ...levelUpDraft, selectedFeats: nextFeats };
        renderDnD35eLevelUpModal(state);
      });

      row.appendChild(lbl);
      row.appendChild(btn);
      leftPane.appendChild(row);
    }

    const activeFeat = sys.feats[inspectedFeatId] ?? allFeats[0];
    if (activeFeat) {
      renderFeatInspector(rightPane, activeFeat, prereqCtx);
    }
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  content.appendChild(stage);

  // Footer commit / cancel
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

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'modal-btn';
  confirmBtn.style.borderColor = '#2ecc71';
  confirmBtn.textContent = '✔ Confirm Level Up';
  confirmBtn.addEventListener('click', () => {
    const result = applyLevelUpToActor(state, playerId, levelUpDraft);
    setGameState({ ...result.state, uiMode: UIMode.Game });
    markAllDomainsDirty();
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);
  content.appendChild(footer);

  restoreScrollPositions(content, savedScrolls);
}
