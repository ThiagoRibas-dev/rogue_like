/**
 * @file D&D 3.5e Character Sheet Column 2:
 * Attacks & Weapons, Combat Maneuvers, Abilities & Pools, and Tactical Stances.
 */

import { getComponent } from '../../core/ecs.ts';
import { getGameState, queuePlayerIntent, setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { evaluateDnD35eEntityDAG } from '../../rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { aggregateProgressionChassis } from '../../rulesets/dnd35e/progression.ts';
import { SIZE_METRICS } from '../../rulesets/dnd35e/spatial/grid_geometry.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import { DnD35UIAdapter } from '../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import {
  ComponentType,
  type ResourcePoolComponent,
  type TacticalDoctrineComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { UICharacterSheetModel } from '../../types/ui_adapter.types.ts';
import { closeCartridgeModal } from './cartridge_ui_registry.ts';
import { applyDoctrineUpdate } from './dnd35e_doctrine_actions.ts';

const dndAdapter = new DnD35UIAdapter();

function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

/**
 * Renders Column 2 (Center Column): Attacks & Weapons, Maneuvers, Abilities & Pools, and Stances.
 */
export function renderSheetAttacksTab(
  container: HTMLElement,
  state: GameState,
  playerId: EntityId,
  preSheetModel?: UICharacterSheetModel
): void {
  const col = document.createElement('div');
  col.className = 'crpg-col-pane crpg-sheet-col-attacks-abilities';

  const evalResult = evaluateDnD35eEntityDAG(state, playerId);
  const dndData = getDnD35EntityData(state, playerId);
  const sheetModel = preSheetModel ?? dndAdapter.getCharacterSheetData({ state, entityId: playerId, evalResult });

  const conMod = evalResult?.dagResult.effectiveAbilityModifiers.con ?? 0;
  const strMod = evalResult?.dagResult.effectiveAbilityModifiers.str ?? 0;
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const sizeMetric = SIZE_METRICS[dndData.sizeCategory ?? 'medium'];
  const specialSizeMod = sizeMetric?.specialSizeModifier ?? 0;

  // 1. Attacks & Weapons
  const atkHeader = document.createElement('div');
  atkHeader.className = 'crpg-subbanner';
  atkHeader.textContent = 'ATTACKS';
  col.appendChild(atkHeader);

  const attackGroups = sheetModel.attackGroups ?? [];
  const routineList = document.createElement('div');
  routineList.className = 'crpg-attack-routine-list';

  if (attackGroups.length === 0) {
    const emptyRow = document.createElement('div');
    emptyRow.className = 'crpg-attack-routine-row';
    emptyRow.innerHTML = '<span class="status-empty">No active weapons equipped or natural attacks present.</span>';
    routineList.appendChild(emptyRow);
  } else {
    for (const grp of attackGroups) {
      const row = document.createElement('div');
      row.className = 'crpg-attack-routine-row';

      const hdr = document.createElement('div');
      hdr.className = 'crpg-attack-group-header';
      hdr.innerHTML = `<span class="crpg-attack-group-title">${grp.label}</span><span class="crpg-attack-group-sub">${grp.subtitle}</span>`;

      const metrics = document.createElement('div');
      metrics.className = 'crpg-attack-group-metrics';
      metrics.innerHTML = `
        <span class="crpg-attack-bonus-chain">ATK ${grp.attackBonuses}</span>
        <span class="crpg-attack-dmg-crit">${grp.damageFormula} (${grp.criticalProfile})</span>
      `;

      row.append(hdr, metrics);
      if (grp.riderNotes) {
        const note = document.createElement('div');
        note.className = 'crpg-attack-rider-note';
        note.textContent = grp.riderNotes;
        row.appendChild(note);
      }
      routineList.appendChild(row);
    }
  }
  col.appendChild(routineList);

  // 2. Maneuvers
  const manHeader = document.createElement('div');
  manHeader.className = 'crpg-subbanner';
  manHeader.textContent = 'MANEUVERS';
  col.appendChild(manHeader);

  const manTable = document.createElement('div');
  manTable.className = 'crpg-maneuver-table';

  const maneuvers = [
    { name: 'Trip', mod: strMod + specialSizeMod, note: 'provokes' },
    { name: 'Disarm', mod: chassis.totalBab + strMod, note: 'vs ATK' },
    { name: 'Sunder', mod: chassis.totalBab + strMod, note: '2x vs obj' },
    { name: 'Bull Rush', mod: strMod + specialSizeMod, note: 'push 5ft+' },
    { name: 'Grapple', mod: chassis.totalBab + strMod + specialSizeMod, note: 'hold/pin' }
  ];

  for (const m of maneuvers) {
    const row = document.createElement('div');
    row.className = 'crpg-maneuver-row';
    row.innerHTML = `
      <span class="crpg-maneuver-name">${m.name}</span>
      <span class="crpg-maneuver-mod">${formatSigned(m.mod)}</span>
      <span class="crpg-maneuver-note">[${m.note}]</span>
    `;
    manTable.appendChild(row);
  }
  col.appendChild(manTable);

  // 3. Abilities & Pools
  const poolHeader = document.createElement('div');
  poolHeader.className = 'crpg-subbanner';
  poolHeader.textContent = 'ABILITIES & POOLS';
  col.appendChild(poolHeader);

  const poolComp = getComponent(state, playerId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  const poolList = document.createElement('div');
  poolList.className = 'crpg-pool-list';

  const pools = poolComp?.pools ?? {};
  const activePoolKeys = Object.keys(pools).filter((k) => (pools[k]?.max ?? 0) > 0);

  if (activePoolKeys.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'status-empty';
    empty.textContent = 'No daily pools or activated class abilities.';
    poolList.appendChild(empty);
  } else {
    for (const poolId of activePoolKeys) {
      const entry = pools[poolId]!;
      const row = document.createElement('div');
      row.className = 'crpg-pool-row';

      const label = document.createElement('span');
      label.className = 'crpg-pool-label';
      label.textContent = entry.label ?? poolId.replace(/_/g, ' ');

      const count = document.createElement('span');
      count.className = 'crpg-pool-count';
      count.textContent = `${entry.current} / ${entry.max}`;

      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'crpg-pool-use-btn';
      useBtn.textContent = 'Use';
      useBtn.disabled = entry.current <= 0;

      useBtn.addEventListener('click', () => {
        // Close character sheet modal and execute ability
        const live = getGameState() ?? state;
        setGameState(closeCartridgeModal(live));
        queuePlayerIntent({
          type: IntentType.UseAbility,
          entityId: playerId,
          effectId: `pool:${poolId}`,
          abilityName: entry.label ?? poolId
        });
        markAllDomainsDirty();
      });

      row.append(label, count, useBtn);
      poolList.appendChild(row);
    }
  }
  col.appendChild(poolList);

  // 4. Stances
  const stanceHeader = document.createElement('div');
  stanceHeader.className = 'crpg-subbanner';
  stanceHeader.textContent = 'STANCES';
  col.appendChild(stanceHeader);

  const doctrine = getComponent(state, playerId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const stanceGrid = document.createElement('div');
  stanceGrid.className = 'crpg-stance-grid';

  const isFightingDefensively = doctrine?.fightingDefensively ?? false;
  const isTotalDefense = doctrine?.totalDefense ?? false;
  const powerAttackVal = doctrine?.powerAttackAmount ?? 0;

  const defBtn = document.createElement('button');
  defBtn.type = 'button';
  defBtn.className = `crpg-stance-btn ${isFightingDefensively ? 'active' : ''}`;
  defBtn.textContent = `Fight Defensive (${isFightingDefensively ? 'ON' : '-4/+2'})`;
  defBtn.addEventListener('click', () => {
    const live = getGameState() ?? state;
    applyDoctrineUpdate(live, playerId, { fightingDefensively: !isFightingDefensively });
    markAllDomainsDirty();
  });

  const totBtn = document.createElement('button');
  totBtn.type = 'button';
  totBtn.className = `crpg-stance-btn ${isTotalDefense ? 'active' : ''}`;
  totBtn.textContent = `Total Defense (${isTotalDefense ? 'ON' : '+4 AC'})`;
  totBtn.addEventListener('click', () => {
    const live = getGameState() ?? state;
    applyDoctrineUpdate(live, playerId, { totalDefense: !isTotalDefense });
    markAllDomainsDirty();
  });

  const pwrBtn = document.createElement('button');
  pwrBtn.type = 'button';
  pwrBtn.className = `crpg-stance-btn ${powerAttackVal > 0 ? 'active' : ''}`;
  pwrBtn.textContent = `Power Attack (${powerAttackVal > 0 ? `-${powerAttackVal}/+${powerAttackVal}` : '0'})`;
  pwrBtn.addEventListener('click', () => {
    const live = getGameState() ?? state;
    const nextVal = powerAttackVal >= 5 ? 0 : powerAttackVal + 1;
    applyDoctrineUpdate(live, playerId, { powerAttackAmount: nextVal });
    markAllDomainsDirty();
  });

  stanceGrid.append(pwrBtn, defBtn, totBtn);
  col.appendChild(stanceGrid);

  container.appendChild(col);
}
