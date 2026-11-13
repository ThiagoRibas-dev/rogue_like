/**
 * @file Pure hotbar and stance-mode projection helpers for the D&D 3.5e Cartridge UI Adapter.
 * Projects combat stances, scaling resource pools, and the 12-slot NWN2-style hotbar from live ECS state.
 */

import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ResourcePoolComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { UIActionEconomyPip, UIHotbarSlot, UIStanceModeEntry } from '../../../types/ui_adapter.types.ts';
import { type ConsoleStanceGroupOption, resolveActiveStanceInGroup } from '../../../systems/stance.system.ts';
import type { DnD35EntityData } from '../types/dnd35e.types.ts';
import { type DnD35FeatDefinition, getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { mapEntityItemToUI } from './dnd35e_ui_projection.ts';

const HOTBAR_SLOT_COUNT = 12;

export const ACTIVE_SKILL_IDS: ReadonlySet<string> = new Set([
  'search',
  'open_lock',
  'disable_device',
  'heal',
  'intimidate',
  'diplomacy',
  'tumble'
]);

import { extractActorTacticalDials, type TacticalDialDescriptor } from '../combat/tactical_doctrine.ts';

/** Projects dynamic combat stances and class-feature scaling pools from an actor's live build. */
export function buildActorStanceModes(
  dndData: Partial<DnD35EntityData>,
  bab: number,
  doctrine?: TacticalDoctrineComponent,
  resourcePools?: ResourcePoolComponent,
  sysFeats?: Readonly<Record<string, DnD35FeatDefinition>>,
  auraStanceOptions?: ReadonlyArray<ConsoleStanceGroupOption>
): ReadonlyArray<UIStanceModeEntry> {
  const modes: UIStanceModeEntry[] = [];
  const dials: ReadonlyArray<TacticalDialDescriptor> = extractActorTacticalDials(
    dndData.feats ?? [],
    sysFeats,
    dndData.suppressedBundleIds ?? []
  );

  for (const dial of dials) {
    let currentVal = 0;
    if (doctrine?.settings) {
      const settingVal = doctrine.settings[dial.abilityId] ?? doctrine.settings[`${dial.abilityId}_dial`];
      if (typeof settingVal === 'number') currentVal = settingVal;
    }
    if (currentVal === 0 && dial.legacyPropertyKey !== undefined && doctrine) {
      const legacyVal = doctrine[dial.legacyPropertyKey];
      if (typeof legacyVal === 'number') currentVal = legacyVal;
    }

    let maxVal = bab;
    if (dial.maxCapRule === 'fixed_5') maxVal = Math.min(5, bab);

    modes.push({
      id: dial.abilityId,
      label: dial.name ?? dial.abilityId.replace(/_/g, ' '),
      isActive: currentVal > 0,
      numericValue: currentVal,
      minNumericValue: dial.min,
      maxNumericValue: maxVal,
      tooltipText: `${dial.name ?? dial.abilityId} (Current: ${currentVal}, Max: ${maxVal})`
    });
  }

  const is2H = doctrine?.gripMode === 'two_handed';
  modes.push(
    {
      id: 'fighting_defensively',
      label: 'Fighting Def',
      isActive: doctrine?.fightingDefensively ?? false,
      tooltipText: 'Fighting Defensively (-4 Attack, +2 Dodge AC)'
    },
    {
      id: 'total_defense',
      label: 'Total Def',
      isActive: doctrine?.totalDefense ?? false,
      tooltipText: 'Total Defense (+4 Dodge AC, Standard Action)'
    },
    { id: 'two_handed_grip', label: is2H ? '2H Grip' : '1H Grip', isActive: is2H, tooltipText: 'Toggle Grip Mode' }
  );
  if (resourcePools) {
    for (const [id, entry] of Object.entries(resourcePools.pools)) {
      if (entry.max <= 0) continue;
      modes.push({
        id: `pool:${id}`,
        label: `${entry.label ?? id.replace(/_/g, ' ')} (${entry.current}/${entry.max})`,
        isActive: entry.current > 0
      });
    }
  }

  // Active Console Stance Groups (e.g. Battle Cadence, Martial Stances)
  const activeGroups = doctrine?.activeStanceGroups ?? {};
  for (const featId of dndData.feats ?? []) {
    const featDef = sysFeats?.[featId];
    for (const act of featDef?.activatedAbilities ?? []) {
      if (act.toggleGroup) {
        const isActive = activeGroups[act.toggleGroup] === act.abilityId;
        modes.push({
          id: act.abilityId,
          label: act.name,
          isActive,
          groupId: act.toggleGroup,
          tooltipText: `${act.name} (${act.toggleGroup})`
        });
      }
    }
  }

  if (auraStanceOptions && auraStanceOptions.length > 0) {
    for (const opt of auraStanceOptions) {
      if (modes.some((m) => m.id === opt.stanceId)) continue;
      const activeStanceId = resolveActiveStanceInGroup(doctrine, opt.groupId, auraStanceOptions, true);
      modes.push({
        id: opt.stanceId,
        label: opt.label,
        isActive: activeStanceId === opt.stanceId,
        groupId: opt.groupId,
        tooltipText: opt.tooltipText ?? `${opt.label} (${opt.groupId})`
      });
    }
  }

  return modes;
}

/** Builds the 12-slot NWN2-style hotbar dynamically from the actor's equipped weapons, spells, skills, and consumables. */
export function buildActorHotbarSlots(
  dndData: Partial<DnD35EntityData>,
  state?: GameState,
  entityId?: EntityId
): ReadonlyArray<UIHotbarSlot> {
  const candidates: Array<Omit<UIHotbarSlot, 'slotIndex' | 'keyLabel'>> = [];
  const sys = state ? getDnD35SystemContent(state.campaign) : undefined;
  const equip =
    state && entityId !== undefined
      ? (getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined)
      : undefined;
  for (const slot of equip?.slots ?? []) {
    if (state && (slot.slotType === 'main_hand' || slot.slotType === 'off_hand') && slot.equippedItem !== null) {
      const item = mapEntityItemToUI(state, slot.equippedItem, true);
      if (item) {
        candidates.push({
          label: item.name,
          iconUrl: item.iconUrl ?? '⚔️',
          tooltipTitle: `${item.name} (${slot.id})`,
          actionPayload: { kind: 'weapon', id: item.id, entityId: slot.equippedItem }
        });
      }
    }
  }
  for (const [classId, book] of Object.entries(dndData.spellbooksByClass ?? {})) {
    const spells = book.castingMode === 'spontaneous' ? book.knownSpellIds : book.preparedSpellIds;
    spells.forEach((spellId, slotIdx) => {
      const name = sys?.spells?.[spellId]?.name ?? spellId.replace(/_/g, ' ');
      candidates.push({
        label: name,
        iconUrl: '✨',
        tooltipTitle: `${name} (${classId.toUpperCase()})`,
        actionPayload: { kind: 'spell', id: spellId, classId, slotIdx }
      });
    });
  }
  for (const [skillId, ranks] of Object.entries(dndData.skillRanks ?? {})) {
    if (ranks > 0 && ACTIVE_SKILL_IDS.has(skillId)) {
      const name = sys?.skills?.[skillId]?.name ?? skillId.replace(/_/g, ' ');
      candidates.push({
        label: name,
        iconUrl: '🎯',
        tooltipTitle: `Use Skill: ${name} (${ranks} ranks)`,
        actionPayload: { kind: 'skill', id: skillId }
      });
    }
  }
  const inv =
    state && entityId !== undefined
      ? (getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined)
      : undefined;
  const equippedIds = new Set(
    (equip?.slots ?? []).map((s) => s.equippedItem).filter((id): id is EntityId => id !== null)
  );
  for (const itemId of inv?.items ?? []) {
    if (!state || equippedIds.has(itemId)) continue;
    const item = mapEntityItemToUI(state, itemId, false);
    if (item?.category === 'consumable') {
      candidates.push({
        label: item.name,
        iconUrl: item.iconUrl ?? '🧪',
        tooltipTitle: `Use ${item.name}`,
        actionPayload: { kind: 'item', id: item.id, entityId: itemId }
      });
    }
  }
  return Array.from({ length: HOTBAR_SLOT_COUNT }, (_, i) => {
    const keyLabel = i === 9 ? '0' : i === 10 ? '-' : i === 11 ? '=' : `${i + 1}`;
    const c = candidates[i];
    return c ? { slotIndex: i, keyLabel, ...c } : { slotIndex: i, keyLabel, label: '' };
  });
}

/**
 * Projects live 5-tier action pips dynamically from an actor's DnD35ActionBudget.
 */
export function buildActorActionPips(dndData: Partial<DnD35EntityData>): ReadonlyArray<UIActionEconomyPip> {
  const budget = dndData.actionBudget;
  if (!budget) {
    return DND35E_ACTION_PIPS;
  }

  const movLabel =
    budget.movementRemainingFt > 0
      ? `MOV ${budget.movementRemainingFt}ft`
      : budget.moveRemaining > 0
        ? 'MOV'
        : 'MOV 0ft';

  return [
    {
      id: 'std',
      label: 'STD',
      available: budget.standardRemaining > 0,
      detailText: budget.standardRemaining > 0 ? 'Standard Action Available' : 'Standard Action Spent'
    },
    {
      id: 'mov',
      label: movLabel,
      available: budget.moveRemaining > 0 || budget.movementRemainingFt > 0,
      detailText:
        budget.movementRemainingFt > 0
          ? `${budget.movementRemainingFt} ft of movement remaining`
          : budget.moveRemaining > 0
            ? 'Move Action Available'
            : 'Move Action Spent'
    },
    {
      id: 'swf',
      label: 'SWF',
      available: budget.swiftRemaining > 0,
      detailText: budget.swiftRemaining > 0 ? 'Swift Action Available' : 'Swift Action Spent'
    },
    {
      id: 'aoo',
      label: `AoO (${budget.aooRemaining})`,
      available: budget.aooRemaining > 0,
      detailText: `${budget.aooRemaining} / ${budget.aooMax} Attacks of Opportunity Remaining`
    }
  ];
}

export const DND35E_ACTION_PIPS: ReadonlyArray<UIActionEconomyPip> = [
  { id: 'std', label: 'STD', available: true, detailText: 'Standard Action' },
  { id: 'mov', label: 'MOV', available: true, detailText: 'Move Action' },
  { id: 'swf', label: 'SWF', available: true, detailText: 'Swift Action' },
  { id: 'aoo', label: 'AoO', available: true, detailText: 'Attack of Opportunity' }
];
