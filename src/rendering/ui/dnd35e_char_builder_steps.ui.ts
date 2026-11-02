/**
 * @file Step renderers (Skills, Feats, Spells, Equipment) for the D&D 3.5e Character Creation Wizard (Milestone 112.5).
 * Full-screen 2-pane layout with strict rank-vs-bonus separation, class spell-list filtering, and live right-pane inspector.
 */

import { getComponent } from '../../core/ecs.ts';
import {
  applyCharacterCreationToPlayer,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  computeAbilityModifier,
  computeFirstLevelFeatSlotBudget,
  computeSkillSynergyBonus,
  evaluatePrerequisiteAST,
  getDnD35EntityData,
  getDnD35SystemContent,
  getEffectiveClassSkillIds,
  getSkillMaxRanks,
  isSpellSelectableForDraft,
  STARTING_EQUIPMENT_PACKAGES
} from '../../rulesets/registry.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { renderFeatInspector, renderSkillInspector, renderSpellInspector } from './dnd35e_inspector.ui.ts';

let inspectedSkillId = 'tumble';
let skillFilterMode: 'all' | 'class' | 'trained' | 'invested' = 'all';
let inspectedFeatId = 'power_attack';
let inspectedSpellId = 'magic_missile';

/**
 * Renders Step 4 (Skill Point Allocation) in a 2-pane layout with `[ - ] [ ranks ] [ + ]` steppers
 * and strict separation between invested ranks and ability/racial/synergy bonuses.
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
  const spent = calculateSkillAllocationCost(draft.skillRanks, classSkillIds);
  const remaining = Math.max(0, Math.round((budget - spent) * 100) / 100);

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-skills-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-skills-right';

  // Top budget & filter bar
  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';
  const budgetBadge = document.createElement('strong');
  budgetBadge.style.color = remaining > 0 ? '#f1c40f' : '#2ecc71';
  budgetBadge.textContent = `Points Remaining: ${remaining} / ${budget} (Spent: ${spent})`;
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
    fBtn.style.borderColor = skillFilterMode === m.id ? '#f1c40f' : 'var(--border-color)';
    fBtn.textContent = m.label;
    fBtn.addEventListener('click', () => {
      skillFilterMode = m.id;
      updateDraft(draft);
    });
    filterBtns.appendChild(fBtn);
  }
  filterBar.appendChild(filterBtns);
  leftPane.appendChild(filterBar);

  // Preview actor state to compute read-only racial/feat skill modifiers
  const previewState = applyCharacterCreationToPlayer(state, playerId, draft);
  const previewData = getDnD35EntityData(previewState, playerId);

  const allSkills = Object.values(sys.skills).sort((a, b) => a.name.localeCompare(b.name));
  if (!sys.skills[inspectedSkillId] && allSkills.length > 0) {
    inspectedSkillId = allSkills[0]!.id;
  }

  for (const skill of allSkills) {
    const isClass = classSkillIds.includes(skill.id);
    const currentRanks = draft.skillRanks[skill.id] ?? 0;
    if (skillFilterMode === 'class' && !isClass) continue;
    if (skillFilterMode === 'trained' && !skill.trainedOnly) continue;
    if (skillFilterMode === 'invested' && currentRanks <= 0) continue;

    const maxRanks = getSkillMaxRanks(totalHd, isClass);
    const rankStep = isClass ? 1 : 0.5;
    const abAdj = race.abilityAdjustments[skill.keyAbility] ?? 0;
    const abMod = computeAbilityModifier(draft.baseAbilityScores[skill.keyAbility] + abAdj);
    const synBonus = computeSkillSynergyBonus(skill.synergyFromSkills, draft.skillRanks);
    const miscMods = (previewData.statModifiers ?? []).filter((m) => m.targetStat === `skill:${skill.id}`);
    const miscBonus = miscMods.reduce((acc, m) => acc + m.value, 0);
    const totalMod = Math.floor(currentRanks) + abMod + synBonus + miscBonus;

    const row = document.createElement('div');
    row.className = `dnd35-list-item${currentRanks > 0 ? ' selected' : ''}${inspectedSkillId === skill.id ? ' inspected' : ''}`;
    row.addEventListener('click', () => {
      inspectedSkillId = skill.id;
      renderSkillInspector(rightPane, skill, currentRanks, draft.skillRanks, abMod, miscBonus, isClass, maxRanks, sys);
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
    subSpan.style.color = isClass ? '#2ecc71' : '#9da7b3';
    const modSign = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
    const bonusSum = abMod + synBonus + miscBonus;
    const bonusSign = bonusSum >= 0 ? `+${bonusSum}` : `${bonusSum}`;
    subSpan.textContent = `${isClass ? 'Class (1pt/rk)' : 'Cross (1pt/0.5rk)'} • Total ${modSign} (Bonus ${bonusSign})`;
    leftCol.appendChild(subSpan);

    const counter = document.createElement('div');
    counter.className = 'dnd35-counter-group';

    const btnMinus = document.createElement('button');
    btnMinus.type = 'button';
    btnMinus.className = 'modal-btn dnd35-counter-btn';
    btnMinus.textContent = '−';
    btnMinus.disabled = currentRanks <= 0;
    btnMinus.addEventListener('click', (e) => {
      e.stopPropagation();
      inspectedSkillId = skill.id;
      const nextVal = Math.max(0, Math.round((currentRanks - rankStep) * 10) / 10);
      const nextRanks = { ...draft.skillRanks };
      if (nextVal <= 0) {
        delete nextRanks[skill.id];
      } else {
        nextRanks[skill.id] = nextVal;
      }
      updateDraft({ ...draft, skillRanks: nextRanks });
    });

    const valSpan = document.createElement('span');
    valSpan.className = 'dnd35-counter-val';
    valSpan.textContent = `${currentRanks}/${maxRanks}`;

    const btnPlus = document.createElement('button');
    btnPlus.type = 'button';
    btnPlus.className = 'modal-btn dnd35-counter-btn';
    btnPlus.textContent = '+';
    btnPlus.disabled = currentRanks + rankStep > maxRanks || remaining < 1;
    btnPlus.addEventListener('click', (e) => {
      e.stopPropagation();
      inspectedSkillId = skill.id;
      const nextVal = Math.min(maxRanks, Math.round((currentRanks + rankStep) * 10) / 10);
      updateDraft({
        ...draft,
        skillRanks: { ...draft.skillRanks, [skill.id]: nextVal }
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
    const isClass = classSkillIds.includes(activeSkill.id);
    const maxRanks = getSkillMaxRanks(totalHd, isClass);
    const curRanks = draft.skillRanks[activeSkill.id] ?? 0;
    const abAdj = race.abilityAdjustments[activeSkill.keyAbility] ?? 0;
    const abMod = computeAbilityModifier(draft.baseAbilityScores[activeSkill.keyAbility] + abAdj);
    const miscMods = (previewData.statModifiers ?? []).filter((m) => m.targetStat === `skill:${activeSkill.id}`);
    const miscBonus = miscMods.reduce((acc, m) => acc + m.value, 0);
    renderSkillInspector(rightPane, activeSkill, curRanks, draft.skillRanks, abMod, miscBonus, isClass, maxRanks, sys);
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}

/**
 * Renders Step 5 (Feat Selection) in a 2-pane layout with feat slot budgeting and live prerequisite inspector.
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

  const race = sys.races[draft.raceId];
  const cls = sys.classes[draft.classId];
  const budget = computeFirstLevelFeatSlotBudget(race, cls);
  const previewState = applyCharacterCreationToPlayer(state, playerId, draft);
  const dndData = getDnD35EntityData(previewState, playerId);
  const prereqCtx = buildPrerequisiteContextForActor(dndData, sys.classes);

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-feats-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-feats-right';

  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';
  const parts: string[] = [`${budget.generalSlots} General`];
  if (budget.humanBonusSlots > 0) parts.push(`${budget.humanBonusSlots} Racial Bonus`);
  if (budget.fighterBonusSlots > 0) parts.push(`${budget.fighterBonusSlots} Class Bonus`);
  filterBar.textContent = `Feats Selected: ${draft.selectedFeats.length} / ${budget.totalSlots} (${parts.join(' + ')})`;
  leftPane.appendChild(filterBar);

  const allFeats = Object.values(sys.feats);
  if (!sys.feats[inspectedFeatId] && allFeats.length > 0) {
    inspectedFeatId = allFeats[0]!.id;
  }

  for (const feat of allFeats) {
    const meets = feat.prerequisites ? evaluatePrerequisiteAST(feat.prerequisites, prereqCtx) : true;
    const isSelected = draft.selectedFeats.includes(feat.id);
    const canAdd = isSelected || (meets && draft.selectedFeats.length < budget.totalSlots);

    const row = document.createElement('div');
    row.className = `dnd35-list-item${isSelected ? ' selected' : ''}${inspectedFeatId === feat.id ? ' inspected' : ''}`;
    row.addEventListener('click', () => {
      inspectedFeatId = feat.id;
      renderFeatInspector(rightPane, feat, prereqCtx);
    });

    const label = document.createElement('div');
    label.textContent = `${isSelected ? '☑' : meets ? '🟢' : '🔴'} ${feat.name}`;

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'modal-btn';
    toggleBtn.style.padding = '3px 8px';
    toggleBtn.style.fontSize = '0.74rem';
    toggleBtn.textContent = isSelected ? 'Remove' : 'Select';
    toggleBtn.disabled = !canAdd;
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      inspectedFeatId = feat.id;
      const nextFeats = isSelected
        ? draft.selectedFeats.filter((id) => id !== feat.id)
        : [...draft.selectedFeats, feat.id];
      updateDraft({ ...draft, selectedFeats: nextFeats });
    });

    row.appendChild(label);
    row.appendChild(toggleBtn);
    leftPane.appendChild(row);
  }

  const activeFeat = sys.feats[inspectedFeatId] ?? allFeats[0];
  if (activeFeat) {
    renderFeatInspector(rightPane, activeFeat, prereqCtx);
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}

/**
 * Renders Step 6 (Starting Spell Selection) in a 2-pane layout filtered strictly by class spell list,
 * maximum castable level at Level 1, Cleric domains, and Wizard prohibited schools.
 */
export function renderCharBuilderSpellsStep(
  container: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;
  const cls = sys.classes[draft.classId];
  if (!cls) return;

  const row1 = cls.progression.find((r) => r.level === 1);
  let maxCastableLevel = -1;
  if (cls.castingMode !== 'none' && row1?.spellsPerDay) {
    for (const [lvlKey, slots] of Object.entries(row1.spellsPerDay)) {
      const lvl = Number(lvlKey);
      if (!Number.isNaN(lvl) && slots >= 0 && lvl > maxCastableLevel) {
        maxCastableLevel = lvl;
      }
    }
  }

  if (cls.castingMode === 'none' || maxCastableLevel < 0) {
    const msg = document.createElement('div');
    msg.className = 'dnd35-filter-bar';
    msg.textContent = `${cls.name} does not cast spells at 1st character level. Proceed to Step 7 (Equipment).`;
    container.appendChild(msg);
    return;
  }

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-spells-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-spells-right';

  const eligibleSpells = Object.values(sys.spells).filter(
    (sp) => isSpellSelectableForDraft(sp, cls.id, maxCastableLevel, draft.prohibitedSchools, draft.domains).selectable
  );

  if (!eligibleSpells.some((s) => s.id === inspectedSpellId) && eligibleSpells.length > 0) {
    inspectedSpellId = eligibleSpells[0]!.id;
  }

  const header = document.createElement('div');
  header.className = 'dnd35-filter-bar';
  header.textContent = `${cls.name} (${cls.castingTradition.toUpperCase()} — ${cls.castingMode}) • Selected Spells: ${draft.knownSpells.length}`;
  leftPane.appendChild(header);

  for (const spell of eligibleSpells) {
    const check = isSpellSelectableForDraft(spell, cls.id, maxCastableLevel, draft.prohibitedSchools, draft.domains);
    const isPicked = draft.knownSpells.includes(spell.id);

    const row = document.createElement('div');
    row.className = `dnd35-list-item${isPicked ? ' selected' : ''}${inspectedSpellId === spell.id ? ' inspected' : ''}`;
    row.addEventListener('click', () => {
      inspectedSpellId = spell.id;
      renderSpellInspector(rightPane, spell, cls.id, draft.domains);
    });

    const label = document.createElement('span');
    label.textContent = `${isPicked ? '☑' : '☐'} [Lv ${check.effectiveLevel ?? spell.level}] ${spell.name} (${spell.school})`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.padding = '3px 8px';
    btn.style.fontSize = '0.74rem';
    btn.textContent = isPicked ? 'Remove' : 'Add';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      inspectedSpellId = spell.id;
      const nextSpells = isPicked
        ? draft.knownSpells.filter((id) => id !== spell.id)
        : [...draft.knownSpells, spell.id];
      updateDraft({ ...draft, knownSpells: nextSpells });
    });

    row.appendChild(label);
    row.appendChild(btn);
    leftPane.appendChild(row);
  }

  const activeSpell = sys.spells[inspectedSpellId] ?? eligibleSpells[0];
  if (activeSpell) {
    renderSpellInspector(rightPane, activeSpell, cls.id, draft.domains);
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}

/**
 * Renders Step 7 (Starting Equipment Kit Selection & Final Character Sheet Preview) in a 2-pane layout.
 */
export function renderCharBuilderEquipmentStep(
  container: HTMLElement,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-equip-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-equip-right';

  for (const pkg of STARTING_EQUIPMENT_PACKAGES) {
    const selected = draft.equipmentPackageId === pkg.id;
    const row = document.createElement('div');
    row.className = `dnd35-list-item${selected ? ' selected' : ''}`;
    row.addEventListener('click', () => {
      updateDraft({ ...draft, equipmentPackageId: pkg.id });
    });
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = pkg.name;
    const desc = document.createElement('div');
    desc.style.fontSize = '0.78rem';
    desc.style.color = '#9da7b3';
    desc.textContent = pkg.description;
    info.appendChild(title);
    info.appendChild(desc);
    row.appendChild(info);
    leftPane.appendChild(row);
  }

  const activePkg =
    STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId) ?? STARTING_EQUIPMENT_PACKAGES[0]!;
  const summaryTitle = document.createElement('h3');
  summaryTitle.style.margin = '0 0 6px 0';
  summaryTitle.style.color = '#f1c40f';
  summaryTitle.textContent = `Character Summary & ${activePkg.name}`;
  rightPane.appendChild(summaryTitle);

  const lines = [
    `Race: ${draft.raceId.toUpperCase()} | Class: ${draft.classId.toUpperCase()} (Lv 1) | Alignment: ${draft.alignment}`,
    `Weapon: ${activePkg.weaponDice} ${activePkg.weaponDamageType} | Armor: +${activePkg.armorBonus} | Shield: +${activePkg.shieldBonus}`,
    `Feats (${draft.selectedFeats.length}): ${draft.selectedFeats.join(', ') || 'None'}`,
    `Skills Invested (${Object.keys(draft.skillRanks).length}): ${
      Object.entries(draft.skillRanks)
        .map(([k, v]) => `${k} (${v})`)
        .join(', ') || 'None'
    }`,
    `Known Spells (${draft.knownSpells.length}): ${draft.knownSpells.join(', ') || 'None'}`
  ];
  for (const text of lines) {
    const p = document.createElement('div');
    p.style.fontSize = '0.84rem';
    p.style.padding = '4px 0';
    p.style.borderBottom = '1px solid #282e3b';
    p.textContent = text;
    rightPane.appendChild(p);
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}
