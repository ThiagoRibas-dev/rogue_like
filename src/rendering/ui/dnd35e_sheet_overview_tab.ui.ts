/**
 * @file D&D 3.5e Character Sheet Overview Tab (Milestone 118).
 * Renders Ability Scores with DAG modifiers, AC breakdown tree, Saves, BAB,
 * Grapple, Speed, and Full Attack Routine preview using native DOM creation.
 */

import { ALL_ABILITY_IDS, evaluateDnD35eEntityDAG } from '../../rulesets/registry.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

const DEFAULT_ABILITY_SCORE = 10;
const BASE_CRIT_THREAT_NATURAL_20 = 20;

/**
 * Helper to create a stat row with label and value using native DOM nodes.
 */
function createStatRow(labelText: string, valueText: string, isBold = true): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sheet-stat-row';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'stat-name';
  nameSpan.textContent = labelText;
  row.appendChild(nameSpan);

  const valEl = document.createElement(isBold ? 'strong' : 'span');
  valEl.className = 'stat-val';
  valEl.textContent = valueText;
  row.appendChild(valEl);

  return row;
}

/**
 * Formats a signed numeric modifier (`+X` or `-X`).
 */
function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

/**
 * Renders Tab 1: Overview & Combat DAG of the Heroic Character Sheet.
 */
export function renderSheetOverviewTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  container.replaceChildren();

  const evalResult = evaluateDnD35eEntityDAG(state, playerId);
  if (!evalResult) {
    const err = document.createElement('div');
    err.className = 'status-empty';
    err.textContent = 'Unable to compute Character DAG.';
    container.appendChild(err);
    return;
  }

  const { dagResult, attackRoutine } = evalResult;

  const root = document.createElement('div');
  root.className = 'dnd35-sheet-overview-grid';

  // 1. Ability Scores Column
  const abCol = document.createElement('div');
  abCol.className = 'sheet-overview-card';
  const abTitle = document.createElement('h3');
  abTitle.textContent = 'Ability Scores';
  abCol.appendChild(abTitle);

  const abList = document.createElement('div');
  abList.className = 'sheet-stats-list';
  for (const ab of ALL_ABILITY_IDS) {
    const scoreVal = dagResult.effectiveAbilities[ab]?.base ?? DEFAULT_ABILITY_SCORE;
    const modVal = dagResult.effectiveAbilityModifiers[ab] ?? 0;
    abList.appendChild(createStatRow(ab.toUpperCase(), `${scoreVal} (${formatSigned(modVal)})`, true));
  }
  abCol.appendChild(abList);
  root.appendChild(abCol);

  // 2. Armor Class & Defense Column
  const acCol = document.createElement('div');
  acCol.className = 'sheet-overview-card';
  const acTitle = document.createElement('h3');
  acTitle.textContent = 'Armor Class & Saves';
  acCol.appendChild(acTitle);

  const acList = document.createElement('div');
  acList.className = 'sheet-stats-list';
  const acBreakdown = dagResult.acBreakdown;
  acList.appendChild(createStatRow('Total AC', String(acBreakdown.fullAC), true));
  acList.appendChild(createStatRow('Touch AC', String(acBreakdown.touchAC), false));
  acList.appendChild(createStatRow('Flat-Footed AC', String(acBreakdown.flatFootedAC), false));
  acList.appendChild(createStatRow('Fortitude', formatSigned(dagResult.saves.fort), true));
  acList.appendChild(createStatRow('Reflex', formatSigned(dagResult.saves.ref), true));
  acList.appendChild(createStatRow('Will', formatSigned(dagResult.saves.will), true));
  acCol.appendChild(acList);
  root.appendChild(acCol);

  // 3. Combat Routine Column
  const combatCol = document.createElement('div');
  combatCol.className = 'sheet-overview-card';
  const combatTitle = document.createElement('h3');
  combatTitle.textContent = 'Combat & Attack Routine';
  combatCol.appendChild(combatTitle);

  const combatList = document.createElement('div');
  combatList.className = 'sheet-stats-list';

  const strikes = attackRoutine.strikes;
  if (strikes.length === 0) {
    const emptyRow = document.createElement('div');
    emptyRow.className = 'status-empty';
    emptyRow.textContent = 'No weapon or natural attack available.';
    combatList.appendChild(emptyRow);
  } else {
    for (const strike of strikes) {
      const strikeRow = document.createElement('div');
      strikeRow.className = 'sheet-strike-row';

      const atkSign = formatSigned(strike.attackBonus);
      const dmgBonus = strike.strDamageBonus + strike.doctrineDamageBonus + strike.flatDamageBonus;
      const dmgSign = formatSigned(dmgBonus);
      const critStr =
        strike.critThreatMin < BASE_CRIT_THREAT_NATURAL_20
          ? `${strike.critThreatMin}-${BASE_CRIT_THREAT_NATURAL_20}/x${strike.critMultiplier}`
          : `x${strike.critMultiplier}`;

      const titleDiv = document.createElement('div');
      titleDiv.className = 'strike-title';
      const strongEl = document.createElement('strong');
      strongEl.textContent = strike.label;
      titleDiv.appendChild(strongEl);
      const bonusSpan = document.createElement('span');
      bonusSpan.className = 'strike-bonus';
      bonusSpan.textContent = ` ${atkSign}`;
      titleDiv.appendChild(bonusSpan);
      strikeRow.appendChild(titleDiv);

      const detailDiv = document.createElement('div');
      detailDiv.className = 'strike-detail';
      detailDiv.textContent = `${strike.weaponDice} ${dmgSign} (${strike.weaponDamageType}, ${critStr})`;
      strikeRow.appendChild(detailDiv);

      combatList.appendChild(strikeRow);
    }
  }
  combatCol.appendChild(combatList);
  root.appendChild(combatCol);

  container.appendChild(root);
}
