/**
 * @file D&D 3.5e Interactive Level-Up Modal (Milestone 112).
 * Built with pure DOM manipulation (document.createElement) per AGENTS.md §7.
 */

import { getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import {
  aggregateProgressionChassis,
  ALL_ABILITY_IDS,
  applyLevelUpToActor,
  buildPrerequisiteContextForActor,
  calculateMulticlassXpMultiplier,
  computeXpThresholdForLevel,
  evaluatePrerequisiteAST,
  getDnD35EntityData,
  getDnD35SystemContent,
  type LevelUpChoice
} from '../../rulesets/registry.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';

/** Hit Dice interval for ability score increases (`4`). */
const ABILITY_INCREASE_HD_STEP = 4;

let levelUpDraft: LevelUpChoice = {
  classId: 'fighter',
  hpMethod: 'average',
  addedSkillRanks: {},
  selectedFeats: [],
  learnedSpells: []
};

/**
 * Checks whether the player actor has enough XP to advance to the next character level.
 *
 * @param state The current GameState.
 * @param playerId The player's EntityId.
 * @returns True if the player can level up in D&D 3.5e.
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
 *
 * @param state The current GameState.
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
  content.replaceChildren();

  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!sys || playerId === undefined) return;

  const dndData = getDnD35EntityData(state, playerId);
  const prereqCtx = buildPrerequisiteContextForActor(dndData, sys.classes);
  const currentChassis = aggregateProgressionChassis(dndData.tracks, 0, dndData.levelAdjustment ?? 0);
  const nextCharLevel = currentChassis.totalHD + 1;

  const header = document.createElement('div');
  header.style.marginBottom = '8px';
  header.textContent = `Advancing to Hit Die ${nextCharLevel} — Select a Base or Prestige Class:`;
  content.appendChild(header);

  // Class list (11 Base + 10 Prestige) with live Prerequisite AST badge + Multiclass XP preview
  const classList = document.createElement('div');
  classList.style.display = 'flex';
  classList.style.flexDirection = 'column';
  classList.style.gap = '6px';
  classList.style.maxHeight = '28vh';
  classList.style.overflowY = 'auto';

  for (const cls of Object.values(sys.classes)) {
    const meetsPrereqs = cls.prerequisites ? evaluatePrerequisiteAST(cls.prerequisites, prereqCtx) : true;
    const alignOk = cls.allowedAlignments ? cls.allowedAlignments.includes(dndData.alignment ?? 'N') : true;
    const eligible = meetsPrereqs && alignOk;

    // Preview multiclass XP multiplier if this class were advanced
    const existingTrack = dndData.tracks.find((t) => t.trackId === cls.id);
    const previewTracks = existingTrack
      ? dndData.tracks.map((t) => (t.trackId === cls.id ? { ...t, levels: t.levels + 1 } : t))
      : [
          ...dndData.tracks,
          {
            trackId: cls.id,
            levels: 1,
            hitDieSides: cls.hitDieSides,
            babCurve: cls.babCurve,
            fortCurve: cls.fortCurve,
            refCurve: cls.refCurve,
            willCurve: cls.willCurve,
            skillPointsPerLevel: cls.skillPointsPerLevel
          }
        ];
    const xpMult = calculateMulticlassXpMultiplier(
      previewTracks,
      sys.classes,
      dndData.favoredClass ?? 'any',
      dndData.enforceMulticlassXpPenalty ?? true
    );

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.textAlign = 'left';
    btn.style.borderColor = levelUpDraft.classId === cls.id ? '#f1c40f' : eligible ? '#2ecc71' : '#e74c3c';
    const tag = cls.isPrestige ? '[Prestige]' : '[Base]';
    const xpNote = xpMult < 1 ? ` ⚠ Multiclass XP: ${Math.round(xpMult * 100)}%` : '';
    btn.textContent = `${eligible ? '🟢' : '🔴'} ${tag} ${cls.name} (d${cls.hitDieSides})${xpNote}`;
    btn.addEventListener('click', () => {
      if (!eligible) return;
      levelUpDraft = { ...levelUpDraft, classId: cls.id };
      renderDnD35eLevelUpModal(state);
    });
    classList.appendChild(btn);
  }
  content.appendChild(classList);

  // Hit Die method toggle
  const hpRow = document.createElement('div');
  hpRow.style.display = 'flex';
  hpRow.style.gap = '8px';
  hpRow.style.marginTop = '8px';
  for (const method of ['average', 'roll'] as const) {
    const mBtn = document.createElement('button');
    mBtn.type = 'button';
    mBtn.className = 'modal-btn';
    mBtn.style.borderColor = levelUpDraft.hpMethod === method ? '#f1c40f' : 'var(--border-color)';
    mBtn.textContent = method === 'average' ? 'Fixed Average HP' : '🎲 Roll Hit Die';
    mBtn.addEventListener('click', () => {
      levelUpDraft = { ...levelUpDraft, hpMethod: method };
      renderDnD35eLevelUpModal(state);
    });
    hpRow.appendChild(mBtn);
  }
  content.appendChild(hpRow);

  // Every 4th HD Ability Score Increase
  if (nextCharLevel % ABILITY_INCREASE_HD_STEP === 0) {
    const abRow = document.createElement('div');
    abRow.style.marginTop = '8px';
    const abTitle = document.createElement('strong');
    abTitle.textContent = '+1 Ability Score Increase (Every 4th HD): ';
    abRow.appendChild(abTitle);
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
      abRow.appendChild(kBtn);
    }
    content.appendChild(abRow);
  }

  // Footer commit / cancel
  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.marginTop = '14px';

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
}
