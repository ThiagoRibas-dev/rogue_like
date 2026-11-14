/**
 * @file D&D 3.5e Character Sheet Column 1:
 * Adventurer Identity, Defenses & Saves, Active Conditions, Ability Scores, and Skills.
 */

import { getComponent } from '../../core/ecs.ts';
import { evaluateDnD35eEntityDAG } from '../../rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { summarizeConditionEffects } from '../../rulesets/dnd35e/combat/maneuvers_conditions.ts';
import { aggregateProgressionChassis, computeXpThresholdForLevel } from '../../rulesets/dnd35e/progression.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import { ALL_ABILITY_IDS } from '../../rulesets/dnd35e/types/dnd35e.types.ts';
import { DnD35UIAdapter } from '../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import {
  ComponentType,
  type FighterComponent,
  type IdentityComponent,
  type StatusEffectsComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { UICharacterSheetModel } from '../../types/ui_adapter.types.ts';

const DEFAULT_ABILITY_SCORE = 10;
const dndAdapter = new DnD35UIAdapter();
let showTrainedOnly = false;

function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

/**
 * Builds tooltip text explaining the mechanical impact of an active condition.
 */
function buildConditionTooltip(cond: string, condSummary: ReturnType<typeof summarizeConditionEffects>): string {
  const parts: string[] = [];
  if (condSummary.meleeAttackPenalty < 0) parts.push(`${condSummary.meleeAttackPenalty} Attack`);
  if (condSummary.acPenalty < 0) parts.push(`${condSummary.acPenalty} AC`);
  if (condSummary.strPenalty > 0) parts.push(`-${condSummary.strPenalty} STR`);
  if (condSummary.dexPenalty > 0) parts.push(`-${condSummary.dexPenalty} DEX`);
  if (condSummary.losesDexToAC) parts.push('Loses DEX to AC');
  if (!condSummary.canTakeActions) parts.push('Incapacitated');
  return parts.length > 0 ? `${cond.toUpperCase()}: ${parts.join(', ')}` : `${cond.toUpperCase()}`;
}

/**
 * Renders Column 1 (Left Column): Identity, Defenses, Active Conditions, Ability Scores & Skills.
 */
export function renderSheetOverviewTab(
  container: HTMLElement,
  state: GameState,
  playerId: EntityId,
  preEvalResult?: ReturnType<typeof evaluateDnD35eEntityDAG>,
  preSheetModel?: UICharacterSheetModel
): void {
  const col = document.createElement('div');
  col.className = 'crpg-col-pane crpg-sheet-col-identity-skills';

  const evalResult = preEvalResult ?? evaluateDnD35eEntityDAG(state, playerId);
  const dndData = getDnD35EntityData(state, playerId);
  const sheetModel = preSheetModel ?? dndAdapter.getCharacterSheetData({ state, entityId: playerId, evalResult });
  const identity = getComponent(state, playerId, ComponentType.Identity) as IdentityComponent | undefined;
  const fighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent | undefined;

  const conMod = evalResult?.dagResult.effectiveAbilityModifiers.con ?? 0;
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const xpCurr = fighter?.xp ?? 0;
  const xpNext = computeXpThresholdForLevel(chassis.ecl + 1);
  const trackSummary = dndData.tracks.map((t) => `${t.trackId} ${t.levels}`).join(' / ') || 'Adventurer 1';

  // 1. Identity & Vitals Banner
  const nameHeading = document.createElement('h3');
  nameHeading.className = 'crpg-section-heading';
  nameHeading.textContent = identity?.name ?? 'Adventurer';
  col.appendChild(nameHeading);

  const subLine = document.createElement('div');
  subLine.className = 'crpg-identity-subline';
  subLine.textContent = `${(dndData.alignment ?? 'NG').toUpperCase().replace(/_/g, ' ')} ${(dndData.raceId ?? 'human').toUpperCase()} • ${trackSummary} (ECL ${chassis.ecl})`;
  col.appendChild(subLine);

  const vitalsGrid = document.createElement('div');
  vitalsGrid.className = 'crpg-vitals-grid';
  for (const item of [
    { label: 'HP', val: `${fighter?.hp ?? chassis.maxHp} / ${fighter?.maxHp ?? chassis.maxHp}` },
    { label: 'XP', val: `${xpCurr.toLocaleString()} / ${xpNext.toLocaleString()}` },
    { label: 'INIT', val: formatSigned(evalResult?.dagResult.effectiveAbilityModifiers.dex ?? 0) },
    { label: 'SPEED', val: '30 ft' }
  ]) {
    const chip = document.createElement('div');
    chip.className = 'crpg-vital-chip';
    chip.innerHTML = `<span class="crpg-vital-label">${item.label}</span><span class="crpg-vital-val">${item.val}</span>`;
    vitalsGrid.appendChild(chip);
  }
  col.appendChild(vitalsGrid);

  // 2. Defenses & Saves
  const defHeader = document.createElement('div');
  defHeader.className = 'crpg-subbanner';
  defHeader.textContent = 'DEFENSES & SAVES';
  col.appendChild(defHeader);

  const acBreakdown = evalResult?.dagResult.acBreakdown;
  const saves = evalResult?.dagResult.saves;
  const defGrid = document.createElement('div');
  defGrid.className = 'crpg-ac-saves-grid';
  for (const c of [
    { label: 'AC', value: `${acBreakdown?.fullAC ?? 10}` },
    { label: 'Touch', value: `${acBreakdown?.touchAC ?? 10}` },
    { label: 'Flat', value: `${acBreakdown?.flatFootedAC ?? 10}` },
    { label: 'Fort', value: formatSigned(saves?.fort ?? chassis.baseSaves.fort) },
    { label: 'Ref', value: formatSigned(saves?.ref ?? chassis.baseSaves.ref) },
    { label: 'Will', value: formatSigned(saves?.will ?? chassis.baseSaves.will) },
    { label: 'BAB', value: formatSigned(chassis.totalBab) },
    {
      label: 'Grapple',
      value: formatSigned(chassis.totalBab + (evalResult?.dagResult.effectiveAbilityModifiers.str ?? 0))
    }
  ]) {
    const cell = document.createElement('div');
    cell.className = 'crpg-defense-cell';
    cell.innerHTML = `<span class="crpg-defense-cell-label">${c.label}</span><span class="crpg-defense-cell-val">${c.value}</span>`;
    defGrid.appendChild(cell);
  }
  col.appendChild(defGrid);

  // 3. Active Conditions Strip
  const condHeader = document.createElement('div');
  condHeader.className = 'crpg-subbanner';
  condHeader.textContent = 'ACTIVE CONDITIONS';
  col.appendChild(condHeader);

  const condStrip = document.createElement('div');
  condStrip.className = 'crpg-conditions-strip';

  const conditions = dndData.conditions ?? [];
  const statusComp = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  const activeEffects = statusComp?.activeEffects ?? [];

  if (conditions.length === 0 && activeEffects.length === 0) {
    const normalChip = document.createElement('span');
    normalChip.className = 'crpg-condition-chip normal';
    normalChip.textContent = '[ Normal ]';
    normalChip.title = 'No debilitating conditions or temporary status effects active.';
    condStrip.appendChild(normalChip);
  } else {
    const condSummary = summarizeConditionEffects(conditions);
    for (const cond of conditions) {
      const chip = document.createElement('span');
      chip.className = 'crpg-condition-chip debuff';
      chip.textContent = `[ ${cond.toUpperCase()} ]`;
      chip.title = buildConditionTooltip(cond, condSummary);
      condStrip.appendChild(chip);
    }
    for (const eff of activeEffects) {
      const chip = document.createElement('span');
      chip.className = 'crpg-condition-chip buff';
      chip.textContent = `[ ${eff.effectId} (${eff.duration}t) ]`;
      condStrip.appendChild(chip);
    }
  }
  col.appendChild(condStrip);

  // 4. Ability Scores
  const attrHeader = document.createElement('div');
  attrHeader.className = 'crpg-subbanner';
  attrHeader.textContent = 'ABILITY SCORES';
  col.appendChild(attrHeader);

  const attrGrid = document.createElement('div');
  attrGrid.className = 'crpg-attr-grid-2col';
  for (const ab of ALL_ABILITY_IDS) {
    const scoreVal = evalResult?.dagResult.effectiveAbilities[ab]?.base ?? DEFAULT_ABILITY_SCORE;
    const modVal = evalResult?.dagResult.effectiveAbilityModifiers[ab] ?? 0;
    const cell = document.createElement('div');
    cell.className = 'crpg-attr-cell';
    cell.innerHTML = `<span class="crpg-attr-label">${ab.toUpperCase()}</span><span class="crpg-attr-score">${scoreVal}</span><span class="crpg-attr-mod">(${formatSigned(modVal)})</span>`;
    attrGrid.appendChild(cell);
  }
  col.appendChild(attrGrid);

  // 5. Skills Table
  const skillBar = document.createElement('div');
  skillBar.className = 'crpg-skills-header-bar';
  const skillTitle = document.createElement('div');
  skillTitle.className = 'crpg-subbanner';
  skillTitle.style.margin = '0';
  skillTitle.textContent = 'SKILLS';
  skillBar.appendChild(skillTitle);

  const filterBtn = document.createElement('button');
  filterBtn.type = 'button';
  filterBtn.className = 'crpg-filter-toggle-btn';
  filterBtn.textContent = showTrainedOnly ? 'Trained Only' : 'All Skills';
  filterBtn.addEventListener('click', () => {
    showTrainedOnly = !showTrainedOnly;
    const parent = col.parentElement;
    if (parent) {
      col.replaceWith(
        (() => {
          const holder = document.createElement('div');
          renderSheetOverviewTab(holder, state, playerId, evalResult, sheetModel);
          return holder.firstElementChild ?? holder;
        })()
      );
    }
  });
  skillBar.appendChild(filterBtn);
  col.appendChild(skillBar);

  const skillsWrap = document.createElement('div');
  skillsWrap.className = 'crpg-skills-wrap-scroll';

  const tbl = document.createElement('table');
  tbl.className = 'crpg-pnp-skills-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>CS</th><th>Skill Name</th><th>Key</th><th>Tot</th><th>Rnks</th></tr>';
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const skill of sheetModel.skillRows ?? []) {
    if (showTrainedOnly && skill.ranks <= 0) continue;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="crpg-skill-cs-dot" title="${skill.isClassSkill ? 'Class Skill' : 'Cross-Class'}">${skill.isClassSkill ? '■' : '□'}</td>
      <td class="crpg-skill-name">${skill.name}</td>
      <td class="crpg-skill-key">${skill.keyAbility.toUpperCase()}</td>
      <td class="crpg-skill-tot">${formatSigned(skill.totalModifier)}</td>
      <td class="crpg-skill-rnk">${skill.ranks}</td>
    `;
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  skillsWrap.appendChild(tbl);
  col.appendChild(skillsWrap);

  container.appendChild(col);
}
