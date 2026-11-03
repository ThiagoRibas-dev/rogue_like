/**
 * @file Shared Step Renderers (Skills, Feats, Per-Class Spells, Equipment) for D&D 3.5e Character Creation & Level-Up (Milestone 112.9).
 * Full-screen 2-pane layout with multiclass rank-cap vs. rank-cost separation, filter chips, per-class spellbooks, and live right-pane inspector.
 */

import { getComponent } from '../../core/ecs.ts';
import {
  type AbilityId,
  applyCharacterCreationToPlayer,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  type ClassSpellSelectionBudget,
  computeAbilityModifier,
  computeClassSpellSelectionBudget,
  computeFirstLevelFeatSlotBudget,
  computeSkillSynergyBonus,
  type DnD35FeatDefinition,
  type DnD35SpellSchool,
  type DnD35SystemContent,
  evaluatePrerequisiteAST,
  getDnD35EntityData,
  getDnD35SystemContent,
  getEffectiveClassSkillIds,
  getSkillMaxRanks,
  getSpellLevelForClass,
  isSpellSelectableForDraft,
  type PrerequisiteEvalContext,
  resolveClassSpellAcquisitionMode,
  STARTING_EQUIPMENT_PACKAGES
} from '../../rulesets/registry.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { renderFeatInspector, renderSkillInspector, renderSpellInspector } from './dnd35e_inspector.ui.ts';

let inspectedSkillId = 'tumble';
let skillFilterMode: 'all' | 'class' | 'trained' | 'invested' = 'all';
let inspectedFeatId = 'power_attack';
let featFilterMode: 'all' | 'eligible' | 'fighter' | 'combat' | 'magic' = 'all';
let inspectedSpellId = 'magic_missile';
let spellLevelFilter: number | 'all' = 'all';

const COMBAT_FEAT_IDS: ReadonlyArray<string> = [
  'power_attack',
  'cleave',
  'great_cleave',
  'combat_expertise',
  'improved_trip',
  'improved_disarm',
  'improved_bull_rush',
  'improved_sunder',
  'improved_grapple',
  'improved_feint',
  'Dodge',
  'dodge',
  'mobility',
  'spring_attack',
  'whirlwind_attack',
  'weapon_finesse',
  'weapon_focus',
  'weapon_specialization',
  'greater_weapon_focus',
  'greater_weapon_specialization',
  'improved_critical',
  'point_blank_shot',
  'precise_shot',
  'rapid_shot',
  'manyshot',
  'two_weapon_fighting',
  'improved_two_weapon_fighting',
  'greater_two_weapon_fighting',
  'two_weapon_defense',
  'improved_initiative',
  'improved_unarmed_strike',
  'stunning_fist',
  'deflect_arrows',
  'mounted_combat',
  'ride_by_attack',
  'spirited_charge',
  'trample',
  'blind_fight',
  'combat_reflexes'
];

function classifyFeatCategory(feat: DnD35FeatDefinition): {
  readonly isFighterBonus: boolean;
  readonly isCombat: boolean;
  readonly isMagic: boolean;
} {
  const isFighterBonus = feat.isFighterBonusFeat === true;
  const idLower = feat.id.toLowerCase();
  const nameLower = feat.name.toLowerCase();
  const descLower = feat.description.toLowerCase();
  const isMagic =
    idLower.includes('spell') ||
    idLower.includes('empower') ||
    idLower.includes('maximize') ||
    idLower.includes('quicken') ||
    idLower.includes('extend') ||
    idLower.includes('silent') ||
    idLower.includes('still') ||
    idLower.includes('widen') ||
    idLower.includes('heighten') ||
    idLower.includes('eschew') ||
    idLower.includes('augment_summoning') ||
    idLower.includes('combat_casting') ||
    idLower.includes('natural_spell') ||
    idLower.includes('extra_turning') ||
    nameLower.includes('spell') ||
    descLower.includes('metamagic') ||
    descLower.includes('caster level');
  const isCombat = isFighterBonus || COMBAT_FEAT_IDS.includes(feat.id);
  return { isFighterBonus, isCombat, isMagic };
}

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
  budgetBadge.style.color = remaining > 0 ? '#f1c40f' : '#2ecc71';
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
    fBtn.style.borderColor = skillFilterMode === m.id ? '#f1c40f' : 'var(--border-color)';
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
    subSpan.style.color = isActiveClass ? '#2ecc71' : isEverClass ? '#f1c40f' : '#9da7b3';
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

/** Configuration for the shared Feats step renderer (Character Creation & Level-Up). */
export interface SharedFeatsStepConfig {
  readonly scrollPrefix: string;
  readonly slotSummaryLabel: string;
  readonly totalSlots: number;
  readonly alreadyOwnedFeatIds: ReadonlyArray<string>;
  readonly selectedFeatIds: ReadonlyArray<string>;
  readonly prereqCtx: PrerequisiteEvalContext;
  readonly onUpdateSelectedFeats: (nextFeats: string[]) => void;
  readonly onRefresh: () => void;
}

/**
 * Renders the shared 2-pane Feat Selection step with category filter chips (`All`, `Eligible`, `Fighter Bonus`, `Combat`, `Metamagic / Magic`).
 */
export function renderSharedFeatsStep(
  container: HTMLElement,
  sys: DnD35SystemContent,
  config: SharedFeatsStepConfig
): void {
  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = `${config.scrollPrefix}-feats-left`;

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = `${config.scrollPrefix}-feats-right`;

  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';
  const summaryStrong = document.createElement('strong');
  summaryStrong.style.color = config.selectedFeatIds.length >= config.totalSlots ? '#2ecc71' : '#f1c40f';
  summaryStrong.textContent = config.slotSummaryLabel;
  filterBar.appendChild(summaryStrong);

  const chipRow = document.createElement('div');
  chipRow.style.display = 'flex';
  chipRow.style.flexWrap = 'wrap';
  chipRow.style.gap = '4px';
  const featModes: ReadonlyArray<{ readonly id: typeof featFilterMode; readonly label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'eligible', label: 'Eligible' },
    { id: 'fighter', label: 'Fighter Bonus' },
    { id: 'combat', label: 'Combat' },
    { id: 'magic', label: 'Metamagic / Magic' }
  ];
  for (const fm of featModes) {
    const fBtn = document.createElement('button');
    fBtn.type = 'button';
    fBtn.className = 'modal-btn';
    fBtn.style.padding = '3px 7px';
    fBtn.style.fontSize = '0.72rem';
    fBtn.style.borderColor = featFilterMode === fm.id ? '#f1c40f' : 'var(--border-color)';
    fBtn.textContent = fm.label;
    fBtn.addEventListener('click', () => {
      featFilterMode = fm.id;
      config.onRefresh();
    });
    chipRow.appendChild(fBtn);
  }
  filterBar.appendChild(chipRow);
  leftPane.appendChild(filterBar);

  const allFeats = Object.values(sys.feats);
  if (!sys.feats[inspectedFeatId] && allFeats.length > 0) {
    inspectedFeatId = allFeats[0]!.id;
  }

  for (const feat of allFeats) {
    const alreadyOwned = config.alreadyOwnedFeatIds.includes(feat.id);
    const meets = feat.prerequisites ? evaluatePrerequisiteAST(feat.prerequisites, config.prereqCtx) : true;
    const isSelected = config.selectedFeatIds.includes(feat.id);
    const cat = classifyFeatCategory(feat);

    if (featFilterMode === 'eligible' && (!meets || alreadyOwned)) continue;
    if (featFilterMode === 'fighter' && !cat.isFighterBonus) continue;
    if (featFilterMode === 'combat' && !cat.isCombat) continue;
    if (featFilterMode === 'magic' && !cat.isMagic) continue;

    const canToggle = isSelected || (!alreadyOwned && meets && config.selectedFeatIds.length < config.totalSlots);

    const row = document.createElement('div');
    row.className = `dnd35-list-item${isSelected ? ' selected' : ''}${inspectedFeatId === feat.id ? ' inspected' : ''}`;
    row.addEventListener('click', () => {
      inspectedFeatId = feat.id;
      renderFeatInspector(rightPane, feat, config.prereqCtx);
    });

    const label = document.createElement('div');
    const fighterTag = cat.isFighterBonus ? ' [Fighter]' : '';
    label.textContent = `${alreadyOwned ? '✔ [Owned]' : isSelected ? '☑' : meets ? '🟢' : '🔴'} ${feat.name}${fighterTag}`;

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'modal-btn';
    toggleBtn.style.padding = '3px 8px';
    toggleBtn.style.fontSize = '0.74rem';
    toggleBtn.textContent = isSelected ? 'Remove' : 'Select';
    toggleBtn.disabled = !canToggle;
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      inspectedFeatId = feat.id;
      const nextFeats = isSelected
        ? config.selectedFeatIds.filter((id) => id !== feat.id)
        : [...config.selectedFeatIds, feat.id];
      config.onUpdateSelectedFeats(nextFeats);
    });

    row.appendChild(label);
    row.appendChild(toggleBtn);
    leftPane.appendChild(row);
  }

  const activeFeat = sys.feats[inspectedFeatId] ?? allFeats[0];
  if (activeFeat) {
    renderFeatInspector(rightPane, activeFeat, config.prereqCtx);
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}

/** Configuration for the shared Per-Class Spell Selection step renderer. */
export interface SharedClassSpellStepConfig {
  readonly scrollPrefix: string;
  readonly classId: string;
  readonly className: string;
  readonly castingTradition: string;
  readonly budget: ClassSpellSelectionBudget;
  readonly priorKnownSpells: ReadonlyArray<string>;
  readonly selectedSpells: ReadonlyArray<string>;
  readonly prohibitedSchools: ReadonlyArray<DnD35SpellSchool>;
  readonly domains: ReadonlyArray<string>;
  readonly onUpdateSelectedSpells: (nextSpells: string[]) => void;
  readonly onRefresh: () => void;
}

/**
 * Renders a per-class Spell Selection step with Spell Level Filter Chips (`All`, `Lv 0`, `Lv 1`, ...)
 * and strict enforcement of Wizard Spellbook Scribed budgets (`3 + INT` at Lv 1, `+2` at Lv 2+) and Spontaneous Spells Known deltas.
 */
export function renderSharedClassSpellStep(
  container: HTMLElement,
  sys: DnD35SystemContent,
  config: SharedClassSpellStepConfig
): void {
  const { budget } = config;
  if (!budget.requiresManualSelection || budget.maxCastableLevel < 0) {
    const msg = document.createElement('div');
    msg.className = 'dnd35-filter-bar';
    msg.textContent =
      budget.spellAcquisitionMode === 'prayerbook_full_list'
        ? ` Divine Prayerbook Rule: ${config.className} automatically accesses the full ${config.className} spell list (plus domain spells) up to Spell Level ${budget.maxCastableLevel} when preparing daily spells. No manual spell learning required.`
        : `${config.className} does not require manual spell selection at this level.`;
    container.appendChild(msg);
    return;
  }

  if (spellLevelFilter !== 'all' && spellLevelFilter > budget.maxCastableLevel) {
    spellLevelFilter = 'all';
  }

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = `${config.scrollPrefix}-spells-${config.classId}-left`;

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = `${config.scrollPrefix}-spells-${config.classId}-right`;

  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';

  const manualSelected = config.selectedSpells.filter((id) => !budget.autoGrantedCantripIds.includes(id));
  const pickedByLevel: Record<number, number> = {};
  let nonZeroPicked = 0;
  for (const spId of manualSelected) {
    const sp = sys.spells[spId];
    if (!sp) continue;
    const lvl = getSpellLevelForClass(sp, config.classId, config.domains) ?? sp.level;
    pickedByLevel[lvl] = (pickedByLevel[lvl] ?? 0) + 1;
    if (lvl >= 1) nonZeroPicked += 1;
  }

  const summaryStrong = document.createElement('strong');
  if (budget.freePickCount > 0) {
    const targetCount = budget.freePickCount;
    summaryStrong.style.color = nonZeroPicked === targetCount ? '#2ecc71' : '#f1c40f';
    summaryStrong.textContent = `${config.className} Spellbook • Scribe Lv 1–${budget.maxCastableLevel} Spells: ${nonZeroPicked} / ${targetCount}`;
  } else {
    const parts: string[] = [];
    let allExact = true;
    for (const [lvlKey, req] of Object.entries(budget.requiredBySpellLevel)) {
      const lvl = Number(lvlKey);
      const cur = pickedByLevel[lvl] ?? 0;
      if (cur !== req) allExact = false;
      parts.push(`Lv ${lvl}: ${cur}/${req}`);
    }
    const cantripNote =
      budget.autoGrantedCantripIds.length > 0 ? ' (All non-prohibited Lv 0 Cantrips auto-scribed)' : '';
    summaryStrong.style.color = allExact ? '#2ecc71' : '#f1c40f';
    summaryStrong.textContent = `${config.className} Spells • ${parts.join(' | ')}${cantripNote}`;
  }
  filterBar.appendChild(summaryStrong);

  const chipRow = document.createElement('div');
  chipRow.style.display = 'flex';
  chipRow.style.flexWrap = 'wrap';
  chipRow.style.gap = '4px';

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'modal-btn';
  allChip.style.padding = '3px 7px';
  allChip.style.fontSize = '0.72rem';
  allChip.style.borderColor = spellLevelFilter === 'all' ? '#f1c40f' : 'var(--border-color)';
  allChip.textContent = 'All Levels';
  allChip.addEventListener('click', () => {
    spellLevelFilter = 'all';
    config.onRefresh();
  });
  chipRow.appendChild(allChip);

  for (let lvl = 0; lvl <= budget.maxCastableLevel; lvl++) {
    const lvlChip = document.createElement('button');
    lvlChip.type = 'button';
    lvlChip.className = 'modal-btn';
    lvlChip.style.padding = '3px 7px';
    lvlChip.style.fontSize = '0.72rem';
    lvlChip.style.borderColor = spellLevelFilter === lvl ? '#f1c40f' : 'var(--border-color)';
    lvlChip.textContent = `Lv ${lvl}`;
    lvlChip.addEventListener('click', () => {
      spellLevelFilter = lvl;
      config.onRefresh();
    });
    chipRow.appendChild(lvlChip);
  }
  filterBar.appendChild(chipRow);
  leftPane.appendChild(filterBar);

  const eligibleSpells = Object.values(sys.spells).filter(
    (sp) =>
      isSpellSelectableForDraft(sp, config.classId, budget.maxCastableLevel, config.prohibitedSchools, config.domains)
        .selectable
  );

  if (!eligibleSpells.some((s) => s.id === inspectedSpellId) && eligibleSpells.length > 0) {
    inspectedSpellId = eligibleSpells[0]!.id;
  }

  for (const spell of eligibleSpells) {
    const check = isSpellSelectableForDraft(
      spell,
      config.classId,
      budget.maxCastableLevel,
      config.prohibitedSchools,
      config.domains
    );
    const effLvl = check.effectiveLevel ?? spell.level;
    if (spellLevelFilter !== 'all' && effLvl !== spellLevelFilter) continue;

    const isAutoCantrip = budget.autoGrantedCantripIds.includes(spell.id);
    const isAlreadyOwned = config.priorKnownSpells.includes(spell.id);
    const isPicked = manualSelected.includes(spell.id);

    let canAdd = false;
    if (!isAutoCantrip && !isAlreadyOwned && !isPicked) {
      if (budget.freePickCount > 0) {
        canAdd = effLvl >= 1 && effLvl <= budget.maxCastableLevel && nonZeroPicked < budget.freePickCount;
      } else {
        const reqForLvl = budget.requiredBySpellLevel[effLvl] ?? 0;
        const curForLvl = pickedByLevel[effLvl] ?? 0;
        canAdd = curForLvl < reqForLvl;
      }
    }

    const row = document.createElement('div');
    row.className = `dnd35-list-item${isPicked || isAutoCantrip ? ' selected' : ''}${inspectedSpellId === spell.id ? ' inspected' : ''}`;
    row.addEventListener('click', () => {
      inspectedSpellId = spell.id;
      renderSpellInspector(rightPane, spell, config.classId, config.domains);
    });

    const label = document.createElement('span');
    const statusIcon = isAutoCantrip ? '✔ [Auto]' : isAlreadyOwned ? '✔ [Known]' : isPicked ? '☑' : '☐';
    label.textContent = `${statusIcon} [Lv ${effLvl}] ${spell.name} (${spell.school})`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.padding = '3px 8px';
    btn.style.fontSize = '0.74rem';
    btn.textContent = isAutoCantrip ? 'Auto' : isAlreadyOwned ? 'Known' : isPicked ? 'Remove' : 'Add';
    btn.disabled = isAutoCantrip || isAlreadyOwned || (!isPicked && !canAdd);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      inspectedSpellId = spell.id;
      const nextSpells = isPicked ? manualSelected.filter((id) => id !== spell.id) : [...manualSelected, spell.id];
      config.onUpdateSelectedSpells(nextSpells);
    });

    row.appendChild(label);
    row.appendChild(btn);
    leftPane.appendChild(row);
  }

  const activeSpell = sys.spells[inspectedSpellId] ?? eligibleSpells[0];
  if (activeSpell) {
    renderSpellInspector(rightPane, activeSpell, config.classId, config.domains);
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

/**
 * Renders Step 5 (Feat Selection) in the Level 1 Character Creation Wizard via `renderSharedFeatsStep`.
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

  const parts: string[] = [`${budget.generalSlots} General`];
  if (budget.humanBonusSlots > 0) parts.push(`${budget.humanBonusSlots} Racial Bonus`);
  if (budget.fighterBonusSlots > 0) parts.push(`${budget.fighterBonusSlots} Class Bonus`);

  renderSharedFeatsStep(container, sys, {
    scrollPrefix: 'char',
    slotSummaryLabel: `Feats Selected: ${draft.selectedFeats.length} / ${budget.totalSlots} (${parts.join(' + ')})`,
    totalSlots: budget.totalSlots,
    alreadyOwnedFeatIds: [],
    selectedFeatIds: draft.selectedFeats,
    prereqCtx,
    onUpdateSelectedFeats: (nextFeats) => updateDraft({ ...draft, selectedFeats: nextFeats }),
    onRefresh: () => updateDraft(draft)
  });
}

/**
 * Renders Step 6 (Starting Spell Selection) in the Level 1 Character Creation Wizard via `renderSharedClassSpellStep`.
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
  const race = sys.races[draft.raceId];
  if (!cls || !race) return;

  const intMod = computeAbilityModifier(draft.baseAbilityScores.int + (race.abilityAdjustments.int ?? 0));
  const budget = computeClassSpellSelectionBudget(cls, 0, 1, intMod, draft.prohibitedSchools, draft.domains, [], sys);

  renderSharedClassSpellStep(container, sys, {
    scrollPrefix: 'char',
    classId: cls.id,
    className: cls.name,
    castingTradition: cls.castingTradition,
    budget,
    priorKnownSpells: [],
    selectedSpells: draft.knownSpells,
    prohibitedSchools: draft.prohibitedSchools,
    domains: draft.domains,
    onUpdateSelectedSpells: (nextSpells) => updateDraft({ ...draft, knownSpells: nextSpells }),
    onRefresh: () => updateDraft(draft)
  });
}

/**
 * Renders Step 7 (Starting Equipment Kit Selection & Final Character Sheet Preview) in a 2-pane layout.
 */
export function renderCharBuilderEquipmentStep(
  container: HTMLElement,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void,
  sys?: DnD35SystemContent
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

  const cls = sys?.classes[draft.classId];
  const spellMode = cls ? resolveClassSpellAcquisitionMode(cls) : 'none';
  const spellSummaryLine =
    spellMode === 'prayerbook_full_list'
      ? `Spellcasting: Divine Prayerbook (Full ${cls?.name ?? draft.classId} spell list & domain access)`
      : `Known Spells (${draft.knownSpells.length}): ${draft.knownSpells.join(', ') || 'None'}`;

  const lines = [
    `Race: ${draft.raceId.toUpperCase()} | Class: ${draft.classId.toUpperCase()} (Lv 1) | Alignment: ${draft.alignment}`,
    `Weapon: ${activePkg.weaponDice} ${activePkg.weaponDamageType} | Armor: +${activePkg.armorBonus} | Shield: +${activePkg.shieldBonus}`,
    `Feats (${draft.selectedFeats.length}): ${draft.selectedFeats.join(', ') || 'None'}`,
    `Skills Invested (${Object.keys(draft.skillRanks).length}): ${
      Object.entries(draft.skillRanks)
        .map(([k, v]) => `${k} (${v})`)
        .join(', ') || 'None'
    }`,
    spellSummaryLine
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
