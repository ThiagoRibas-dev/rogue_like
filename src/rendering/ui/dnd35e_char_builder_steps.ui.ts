/**
 * @file Step renderers (Skills, Feats, Spells, Equipment) for the D&D 3.5e Character Creation Wizard.
 * Built with pure DOM manipulation (document.createElement) per AGENTS.md §7.
 */

import { getComponent } from '../../core/ecs.ts';
import {
  applyCharacterCreationToPlayer,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  evaluatePrerequisiteAST,
  getDnD35EntityData,
  getDnD35SystemContent,
  getSkillMaxRanks,
  STARTING_EQUIPMENT_PACKAGES
} from '../../rulesets/registry.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';

/**
 * Renders Step 4 (Skill Point Allocation) of the Character Creation Wizard.
 */
export function renderCharBuilderSkillsStep(
  container: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;
  const cls = sys.classes[draft.classId];
  const race = sys.races[draft.raceId];
  if (!cls || !race) return;

  const intMod = Math.floor((draft.baseAbilityScores.int - 10) / 2);
  const budget = calculateLevelSkillPointBudget(
    cls.skillPointsPerLevel,
    intMod,
    true,
    race.extraSkillPointsFirstLevel,
    race.extraSkillPointsPerLevel
  );
  const spent = calculateSkillAllocationCost(draft.skillRanks, cls.classSkills);

  const summary = document.createElement('div');
  summary.textContent = `Skill Points Spent: ${spent} / ${budget} (Max Class Ranks: 4, Cross-Class: 2; 5+ ranks unlock Synergies in subsequent levels)`;
  container.appendChild(summary);

  for (const skill of Object.values(sys.skills)) {
    const isClass = cls.classSkills.includes(skill.id);
    const maxRanks = getSkillMaxRanks(1, isClass);
    const current = draft.skillRanks[skill.id] ?? 0;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.alignItems = 'center';

    const label = document.createElement('span');
    label.textContent = `${skill.name} (${skill.keyAbility.toUpperCase()}) [${isClass ? 'Class 1pt' : 'Cross 2pt'}]: ${current}/${maxRanks}`;

    const btnAdd = document.createElement('button');
    btnAdd.type = 'button';
    btnAdd.className = 'modal-btn';
    btnAdd.style.padding = '2px 8px';
    btnAdd.textContent = current >= maxRanks ? 'Reset' : '+1 Rank';
    btnAdd.addEventListener('click', () => {
      const nextRanks = current >= maxRanks ? 0 : current + 1;
      updateDraft({
        ...draft,
        skillRanks: { ...draft.skillRanks, [skill.id]: nextRanks }
      });
    });

    row.appendChild(label);
    row.appendChild(btnAdd);
    container.appendChild(row);
  }
}

/**
 * Renders Step 5 (Feat Selection with live Prerequisite AST badges) of the Character Creation Wizard.
 */
export function renderCharBuilderFeatsStep(
  container: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!sys || playerId === undefined) return;
  const previewState = applyCharacterCreationToPlayer(state, playerId, draft);
  const dndData = getDnD35EntityData(previewState, playerId);
  const prereqCtx = buildPrerequisiteContextForActor(dndData, sys.classes);

  for (const feat of Object.values(sys.feats)) {
    const meets = feat.prerequisites ? evaluatePrerequisiteAST(feat.prerequisites, prereqCtx) : true;
    const isSelected = draft.selectedFeats.includes(feat.id);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.textAlign = 'left';
    btn.style.borderColor = isSelected ? '#f1c40f' : meets ? '#2ecc71' : '#e74c3c';
    btn.textContent = `${isSelected ? '☑' : meets ? '🟢' : '🔴'} ${feat.name} — ${feat.description}`;
    btn.addEventListener('click', () => {
      if (!meets && !isSelected) return;
      const nextFeats = isSelected
        ? draft.selectedFeats.filter((id) => id !== feat.id)
        : [...draft.selectedFeats, feat.id];
      updateDraft({ ...draft, selectedFeats: nextFeats });
    });
    container.appendChild(btn);
  }
}

/**
 * Renders Step 6 (Starting Spell Selection) of the Character Creation Wizard.
 */
export function renderCharBuilderSpellsStep(
  container: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;

  for (const spell of Object.values(sys.spells)) {
    if (spell.level > 1) continue;
    const isPicked = draft.knownSpells.includes(spell.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.textAlign = 'left';
    btn.style.borderColor = isPicked ? '#f1c40f' : 'var(--border-color)';
    btn.textContent = `[Lv ${spell.level}] ${spell.name} (${spell.school})`;
    btn.addEventListener('click', () => {
      const nextSpells = isPicked
        ? draft.knownSpells.filter((id) => id !== spell.id)
        : [...draft.knownSpells, spell.id];
      updateDraft({ ...draft, knownSpells: nextSpells });
    });
    container.appendChild(btn);
  }
}

/**
 * Renders Step 7 (Starting Equipment Kit Selection) of the Character Creation Wizard.
 */
export function renderCharBuilderEquipmentStep(
  container: HTMLElement,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  for (const pkg of STARTING_EQUIPMENT_PACKAGES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.textAlign = 'left';
    btn.style.borderColor = draft.equipmentPackageId === pkg.id ? '#f1c40f' : 'var(--border-color)';
    btn.textContent = `${pkg.name}: ${pkg.description}`;
    btn.addEventListener('click', () => {
      updateDraft({ ...draft, equipmentPackageId: pkg.id });
    });
    container.appendChild(btn);
  }
}
