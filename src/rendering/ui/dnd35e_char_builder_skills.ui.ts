import { getComponent } from '../../core/ecs.ts';
import { computeAbilityModifier } from '../../rulesets/dnd35e/abilities.ts';
import {
  applyCharacterCreationToPlayer,
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  getEffectiveClassSkillIds,
  getSkillMaxRanks
} from '../../rulesets/dnd35e/character_builder.ts';
import { computeSkillSynergyBonus } from '../../rulesets/dnd35e/skills.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import type { AbilityId } from '../../rulesets/dnd35e/types/dnd35e.types.ts';
import { type DnD35SystemContent, getDnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { renderSkillInspector } from './dnd35e_inspector.ui.ts';

let inspectedSkillId = 'tumble';
let skillFilterMode: 'all' | 'class' | 'trained' | 'invested' = 'all';

/** Configuration for the shared Skills step renderer (Character Creation & Level-Up). */
export interface SharedSkillsStepConfig {
  readonly scrollPrefix: string;
  readonly totalHd: number;
  readonly budget: number;
  readonly activeLevelClassSkillIds: ReadonlyArray<string>;
  readonly everClassSkillIds: ReadonlyArray<string>;
  readonly priorSkillRanks: Readonly<Record<string, number>>;
  readonly addedSkillRanks: Readonly<Record<string, number>>;
  readonly abilityModifiers: Readonly<Record<AbilityId, number>>;
  readonly miscSkillBonuses: Readonly<Record<string, number>>;
  readonly onUpdateAddedRanks: (nextAddedRanks: Record<string, number>) => void;
  readonly onRefresh: () => void;
}

/**
 * Renders the shared 2-pane Skill Allocation step for both Level 1 Character Creation and Levels 2–20 Level-Up.
 * Separates active-level rank purchase cost (`activeLevelClassSkillIds`) from multiclass rank cap (`everClassSkillIds`).
 */
export function renderSharedSkillsStep(
  container: HTMLElement,
  sys: DnD35SystemContent,
  config: SharedSkillsStepConfig
): void {
  const spent = calculateSkillAllocationCost(config.addedSkillRanks, config.activeLevelClassSkillIds);
  const remaining = Math.max(0, Math.round((config.budget - spent) * 100) / 100);

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = `${config.scrollPrefix}-skills-left`;

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = `${config.scrollPrefix}-skills-right`;

  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';
  const budgetBadge = document.createElement('strong');
  budgetBadge.style.color = remaining > 0 ? 'var(--crpg-gold, #f1c40f)' : 'var(--crpg-success, #2ecc71)';
  budgetBadge.textContent = `Points Remaining: ${remaining} / ${config.budget} (Spent: ${spent})`;
  filterBar.appendChild(budgetBadge);

  const filterBtns = document.createElement('div');
  filterBtns.style.display = 'flex';
  filterBtns.style.gap = '4px';
  const modes: ReadonlyArray<{ readonly id: typeof skillFilterMode; readonly label: string }> = [
    { id: 'all', label: `All (${Object.keys(sys.skills).length})` },
    { id: 'class', label: 'Class' },
    { id: 'trained', label: 'Trained-Only' },
    { id: 'invested', label: 'Invested' }
  ];
  for (const m of modes) {
    const fBtn = document.createElement('button');
    fBtn.type = 'button';
    fBtn.className = 'modal-btn';
    fBtn.style.padding = '3px 7px';
    fBtn.style.fontSize = '0.72rem';
    fBtn.style.borderColor = skillFilterMode === m.id ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
    fBtn.textContent = m.label;
    fBtn.addEventListener('click', () => {
      skillFilterMode = m.id;
      config.onRefresh();
    });
    filterBtns.appendChild(fBtn);
  }
  filterBar.appendChild(filterBtns);
  leftPane.appendChild(filterBar);

  const mergedRanks: Record<string, number> = { ...config.priorSkillRanks };
  for (const [k, v] of Object.entries(config.addedSkillRanks)) {
    mergedRanks[k] = Math.round(((mergedRanks[k] ?? 0) + v) * 10) / 10;
  }

  const allSkills = Object.values(sys.skills).sort((a, b) => a.name.localeCompare(b.name));
  if (!sys.skills[inspectedSkillId] && allSkills.length > 0) {
    inspectedSkillId = allSkills[0]!.id;
  }

  for (const skill of allSkills) {
    const isActiveClass = config.activeLevelClassSkillIds.includes(skill.id);
    const isEverClass = config.everClassSkillIds.includes(skill.id);
    const priorRanks = config.priorSkillRanks[skill.id] ?? 0;
    const addedDelta = config.addedSkillRanks[skill.id] ?? 0;
    const totalRanks = Math.round((priorRanks + addedDelta) * 10) / 10;

    if (skillFilterMode === 'class' && !isEverClass) continue;
    if (skillFilterMode === 'trained' && !skill.trainedOnly) continue;
    if (skillFilterMode === 'invested' && totalRanks <= 0) continue;

    const maxRanks = getSkillMaxRanks(config.totalHd, isEverClass);
    const rankStep = isActiveClass ? 1 : 0.5;
    const abMod = config.abilityModifiers[skill.keyAbility] ?? 0;
    const synBonus = computeSkillSynergyBonus(skill.synergyFromSkills, mergedRanks);
    const miscBonus = config.miscSkillBonuses[skill.id] ?? 0;
    const totalMod = Math.floor(totalRanks) + abMod + synBonus + miscBonus;

    const row = document.createElement('div');
    row.className = `dnd35-list-item${addedDelta > 0 ? ' selected' : ''}${inspectedSkillId === skill.id ? ' inspected' : ''}`;
    row.addEventListener('click', () => {
      inspectedSkillId = skill.id;
      renderSkillInspector(rightPane, skill, totalRanks, mergedRanks, abMod, miscBonus, isEverClass, maxRanks, sys);
    });

    const leftCol = document.createElement('div');
    leftCol.style.display = 'flex';
    leftCol.style.flexDirection = 'column';
    leftCol.style.gap = '2px';

    const titleSpan = document.createElement('strong');
    titleSpan.style.fontSize = '0.84rem';
    titleSpan.textContent = `${skill.name} (${skill.keyAbility.toUpperCase()})`;
    leftCol.appendChild(titleSpan);

    const subSpan = document.createElement('span');
    subSpan.style.fontSize = '0.73rem';
    subSpan.style.color = isActiveClass
      ? 'var(--crpg-success, #2ecc71)'
      : isEverClass
        ? 'var(--crpg-gold, #f1c40f)'
        : 'var(--crpg-text-dim, #9da7b3)';
    const costLabel = isActiveClass
      ? 'Class (1pt/rk)'
      : isEverClass
        ? 'Prior Class Cap • Cross Cost (1pt/0.5rk)'
        : 'Cross (1pt/0.5rk)';
    const modSign = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
    const bonusSum = abMod + synBonus + miscBonus;
    const bonusSign = bonusSum >= 0 ? `+${bonusSum}` : `${bonusSum}`;
    const priorNote = priorRanks > 0 ? ` • Prior ${priorRanks}` : '';
    subSpan.textContent = `${costLabel}${priorNote} • Total ${modSign} (Bonus ${bonusSign})`;
    leftCol.appendChild(subSpan);

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
      const nextVal = Math.max(0, Math.round((addedDelta - rankStep) * 10) / 10);
      const nextAdded = { ...config.addedSkillRanks };
      if (nextVal <= 0) {
        delete nextAdded[skill.id];
      } else {
        nextAdded[skill.id] = nextVal;
      }
      config.onUpdateAddedRanks(nextAdded);
    });

    const valSpan = document.createElement('span');
    valSpan.className = 'dnd35-counter-val';
    valSpan.textContent = priorRanks > 0 ? `+${addedDelta} (${totalRanks}/${maxRanks})` : `${totalRanks}/${maxRanks}`;

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'modal-btn dnd35-counter-btn';
    btnPlus.textContent = '+';
    btnPlus.disabled = totalRanks + rankStep > maxRanks || remaining < 1;
    btnPlus.addEventListener('click', (e) => {
      e.stopPropagation();
      inspectedSkillId = skill.id;
      const nextDelta = Math.min(Math.max(0, maxRanks - priorRanks), Math.round((addedDelta + rankStep) * 10) / 10);
      config.onUpdateAddedRanks({
        ...config.addedSkillRanks,
        [skill.id]: nextDelta
      });
    });

    counter.appendChild(btnMinus);
    counter.appendChild(valSpan);
    counter.appendChild(btnPlus);

    row.appendChild(leftCol);
    row.appendChild(counter);
    leftPane.appendChild(row);
  }

  const activeSkill = sys.skills[inspectedSkillId] ?? allSkills[0];
  if (activeSkill) {
    const isEverClass = config.everClassSkillIds.includes(activeSkill.id);
    const maxRanks = getSkillMaxRanks(config.totalHd, isEverClass);
    const curRanks = mergedRanks[activeSkill.id] ?? 0;
    const abMod = config.abilityModifiers[activeSkill.keyAbility] ?? 0;
    const miscBonus = config.miscSkillBonuses[activeSkill.id] ?? 0;
    renderSkillInspector(rightPane, activeSkill, curRanks, mergedRanks, abMod, miscBonus, isEverClass, maxRanks, sys);
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}

/**
 * Renders Step 4 (Skill Point Allocation) in the Level 1 Character Creation Wizard via `renderSharedSkillsStep`.
 */
export function renderCharBuilderSkillsStep(
  container: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!sys || playerId === undefined) return;
  const cls = sys.classes[draft.classId];
  const race = sys.races[draft.raceId];
  if (!cls || !race) return;

  const classSkillIds = getEffectiveClassSkillIds(cls, draft.domains, sys);
  const intAdj = race.abilityAdjustments.int ?? 0;
  const intMod = computeAbilityModifier(draft.baseAbilityScores.int + intAdj);
  const totalHd = Math.max(1, (race.rhdProgression?.baseHdCount ?? 0) + 1);
  const budget = calculateLevelSkillPointBudget(
    cls.skillPointsPerLevel,
    intMod,
    true,
    race.extraSkillPointsFirstLevel,
    race.extraSkillPointsPerLevel
  );

  const previewState = applyCharacterCreationToPlayer(state, playerId, draft);
  const previewData = getDnD35EntityData(previewState, playerId);

  const abilityModifiers: Record<AbilityId, number> = {
    str: computeAbilityModifier(draft.baseAbilityScores.str + (race.abilityAdjustments.str ?? 0)),
    dex: computeAbilityModifier(draft.baseAbilityScores.dex + (race.abilityAdjustments.dex ?? 0)),
    con: computeAbilityModifier(draft.baseAbilityScores.con + (race.abilityAdjustments.con ?? 0)),
    int: intMod,
    wis: computeAbilityModifier(draft.baseAbilityScores.wis + (race.abilityAdjustments.wis ?? 0)),
    cha: computeAbilityModifier(draft.baseAbilityScores.cha + (race.abilityAdjustments.cha ?? 0))
  };

  const miscSkillBonuses: Record<string, number> = {};
  for (const mod of previewData.statModifiers ?? []) {
    if (mod.targetStat.startsWith('skill:')) {
      const skId = mod.targetStat.slice('skill:'.length);
      miscSkillBonuses[skId] = (miscSkillBonuses[skId] ?? 0) + mod.value;
    }
  }

  renderSharedSkillsStep(container, sys, {
    scrollPrefix: 'char',
    totalHd,
    budget,
    activeLevelClassSkillIds: classSkillIds,
    everClassSkillIds: classSkillIds,
    priorSkillRanks: {},
    addedSkillRanks: draft.skillRanks,
    abilityModifiers,
    miscSkillBonuses,
    onUpdateAddedRanks: (nextAddedRanks) => updateDraft({ ...draft, skillRanks: nextAddedRanks }),
    onRefresh: () => updateDraft(draft)
  });
}
