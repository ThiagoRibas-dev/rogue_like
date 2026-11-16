/**
 * @file Pure hotbar and stance-mode projection helpers for the D&D 3.5e Cartridge UI Adapter.
 * Projects combat stances, activated class/domain abilities, and the 12-slot NWN2-style hotbar from live ECS state.
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
import { extractActorTacticalDials, type TacticalDialDescriptor } from '../combat/tactical_doctrine.ts';
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

/** Projects dynamic combat stances and toggle groups (excluding activated daily-use resource pools). */
export function buildActorStanceModes(
  dndData: Partial<DnD35EntityData>,
  bab: number,
  doctrine?: TacticalDoctrineComponent,
  _resourcePools?: ResourcePoolComponent,
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

    const maxVal = dial.maxCapRule === 'fixed_5' ? Math.min(5, bab) : bab;
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

  const features = dndData.activeClassFeatures ?? [];
  if (features.includes('decisive_strike')) {
    modes.push({
      id: 'decisive_strike',
      label: 'Decisive 2x',
      isActive: (doctrine?.decisiveStrike ?? false) && !(doctrine?.totalDefense ?? false),
      tooltipText: 'Decisive Strike (-2 Attack, single strike dealing 2x damage + 2x AoO damage)'
    });
  }
  if (features.includes('whirling_frenzy')) {
    modes.push({
      id: 'whirling_frenzy',
      label: 'Whirling Frenzy',
      isActive: doctrine?.whirlingFrenzy ?? false,
      tooltipText: 'Whirling Frenzy (+4 STR, +2 Dodge AC/Ref, +1 Extra Strike at -2 Atk)'
    });
  }

  const activeGroups = doctrine?.activeStanceGroups ?? {};
  if (features.includes('shapeshift')) {
    const druidTrack = dndData.tracks?.find((t) => t.trackId === 'druid');
    const druidLevel = Math.max(1, druidTrack?.levels ?? dndData.tracks?.reduce((sum, t) => sum + t.levels, 0) ?? 1);
    const activeForm = activeGroups['druid_shapeshift_form'];

    modes.push({
      id: 'shapeshift_normal',
      label: 'Normal Form',
      isActive: !activeForm || activeForm === 'normal',
      groupId: 'druid_shapeshift_form',
      tooltipText: 'Normal Form (Revert to normal humanoid form as a swift action)'
    });
    modes.push({
      id: 'shapeshift_predator',
      label: 'Predator Form',
      isActive: activeForm === 'predator',
      groupId: 'druid_shapeshift_form',
      tooltipText: 'Predator Form (+4 STR, +4 Natural Armor, 50 ft speed, 1d6 Bite)'
    });
    if (druidLevel >= 5) {
      modes.push({
        id: 'shapeshift_aerial',
        label: 'Aerial Form',
        isActive: activeForm === 'aerial',
        groupId: 'druid_shapeshift_form',
        tooltipText: 'Aerial Form (+2 STR, +2 Natural Armor, +2 Ref, 40 ft Fly, 1d6 Talon)'
      });
    }
    if (druidLevel >= 8) {
      modes.push({
        id: 'shapeshift_ferocious_slayer',
        label: 'Ferocious Slayer',
        isActive: activeForm === 'ferocious_slayer',
        groupId: 'druid_shapeshift_form',
        tooltipText: 'Ferocious Slayer Form (Large, +8 STR, +8 Natural Armor, 40 ft speed, 1d8 Bite + 2x 1d6 Claws)'
      });
    }
  }
  for (const featId of dndData.feats ?? []) {
    const featDef = sysFeats?.[featId];
    for (const act of featDef?.activatedAbilities ?? []) {
      if (act.toggleGroup) {
        modes.push({
          id: act.abilityId,
          label: act.name,
          isActive: activeGroups[act.toggleGroup] === act.abilityId,
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

function getPoolAbilityIcon(poolId: string): string {
  const normalized = poolId.toLowerCase();
  if (normalized.includes('turn') || normalized.includes('rebuke')) return '☀️';
  if (normalized.includes('rage')) return '🔥';
  if (normalized.includes('lay_on_hands') || normalized.includes('heal')) return '💛';
  if (normalized.includes('smite')) return '⚡';
  return '🌟';
}

/** Builds the 12-slot NWN2-style hotbar dynamically from equipped weapons, spells, resource abilities, skills, and consumables. */
export function buildActorHotbarSlots(
  dndData: Partial<DnD35EntityData> & { readonly resourcePools?: ResourcePoolComponent | undefined },
  state?: GameState,
  entityId?: EntityId,
  resourcePools?: ResourcePoolComponent
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

  const effectivePools = resourcePools ?? dndData.resourcePools;
  if (effectivePools) {
    for (const [poolId, entry] of Object.entries(effectivePools.pools)) {
      if (entry.max <= 0) continue;
      const displayName = entry.label ?? poolId.replace(/_/g, ' ');
      const isImmediatePool = poolId === 'abrupt_jaunt' || poolId === 'invisible_fist';
      const actionTypeLabel = isImmediatePool ? 'Immediate Action' : 'Standard Action';
      candidates.push({
        label: `${displayName} (${entry.current}/${entry.max})`,
        iconUrl: getPoolAbilityIcon(poolId),
        isDisabled: entry.current <= 0,
        tooltipTitle: `${displayName}: ${entry.current}/${entry.max} uses remaining (${actionTypeLabel})`,
        actionPayload: {
          kind: 'ability',
          id: poolId,
          remainingCount: entry.current
        }
      });
    }
  }

  for (const [classId, book] of Object.entries(dndData.spellbooksByClass ?? {})) {
    if (book.castingMode === 'prepared') {
      const preparedGroups = new Map<string, { spellId: string; slotId?: string; count: number; level?: number }>();
      if (book.preparedSlots && book.preparedSlots.length > 0) {
        for (const s of book.preparedSlots) {
          if (s.expended || !s.preparedSpellId) continue;
          const key = `${s.spellLevel}:${s.preparedSpellId}`;
          const prev = preparedGroups.get(key);
          if (prev) prev.count += 1;
          else preparedGroups.set(key, { spellId: s.preparedSpellId, slotId: s.slotId, count: 1, level: s.spellLevel });
        }
      } else {
        for (const spId of book.preparedSpellIds) {
          const prev = preparedGroups.get(spId);
          if (prev) prev.count += 1;
          else preparedGroups.set(spId, { spellId: spId, count: 1 });
        }
      }
      let slotIdx = 0;
      for (const grp of preparedGroups.values()) {
        const spDef = sys?.spells?.[grp.spellId];
        const name = spDef?.name ?? grp.spellId.replace(/_/g, ' ');
        candidates.push({
          label: grp.count > 1 ? `${name} ×${grp.count}` : name,
          iconUrl: '✨',
          tooltipTitle: `Cast ${name} (${classId.toUpperCase()}, ${grp.count} left)`,
          actionPayload: {
            kind: 'spell',
            id: grp.spellId,
            classId,
            slotIdx,
            ...(grp.slotId !== undefined ? { slotId: grp.slotId } : {}),
            ...(grp.level !== undefined ? { spellLevel: grp.level } : {}),
            remainingCount: grp.count
          }
        });
        slotIdx++;
      }
    } else {
      const usedMap = book.spontaneousSlotsUsedByLevel ?? {};
      book.knownSpellIds.forEach((spellId, slotIdx) => {
        const spDef = sys?.spells?.[spellId];
        const name = spDef?.name ?? spellId.replace(/_/g, ' ');
        const lvl = spDef?.levelByClass[classId] ?? spDef?.level ?? 0;
        const total = book.spellsPerDay[String(lvl)] ?? 0;
        const isAtWill = (lvl === 0 && total === 0) || classId === 'warlock' || classId === 'innate';
        const rem = isAtWill ? -1 : Math.max(0, total - (usedMap[String(lvl)] ?? 0));
        if (!isAtWill && total <= 0) return;
        const suffix = rem < 0 ? '∞' : `${rem}`;
        candidates.push({
          label: `${name} (${suffix})`,
          iconUrl: '✨',
          isDisabled: rem === 0,
          tooltipTitle: `Cast ${name} (${classId.toUpperCase()} Lv ${lvl}, ${suffix} left)`,
          actionPayload: { kind: 'spell', id: spellId, classId, slotIdx, spellLevel: lvl, remainingCount: rem }
        });
      });
    }
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

/** Projects live 5-tier action pips dynamically from an actor's DnD35ActionBudget. */
export function buildActorActionPips(dndData: Partial<DnD35EntityData>): ReadonlyArray<UIActionEconomyPip> {
  const budget = dndData.actionBudget;
  if (!budget) return DND35E_ACTION_PIPS;
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
