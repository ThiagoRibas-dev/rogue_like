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

const SHAPESHIFT_STANCE_DEFS = [
  ['shapeshift_normal', 'normal', 1, 'Normal Form', 'Revert to humanoid form (Swift)'],
  ['shapeshift_predator', 'predator', 1, 'Predator Form', '+4 STR, +4 Nat AC, 50ft, 1d6 Bite'],
  ['shapeshift_aerial', 'aerial', 5, 'Aerial Form', '+2 STR, +2 Nat AC, +2 Ref, 40ft Fly'],
  ['shapeshift_ferocious_slayer', 'ferocious_slayer', 8, 'Ferocious Slayer', 'Large, +8 STR, +8 Nat AC, Bite+Claws']
] as const;

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
  const addMode = (id: string, label: string, isActive: boolean, tooltipText: string, groupId?: string): void => {
    modes.push({ id, label, isActive, ...(groupId ? { groupId } : {}), tooltipText });
  };
  const dials: ReadonlyArray<TacticalDialDescriptor> = extractActorTacticalDials(
    dndData.feats ?? [],
    sysFeats,
    dndData.suppressedBundleIds ?? []
  );

  for (const dial of dials) {
    const settingVal = doctrine?.settings?.[dial.abilityId] ?? doctrine?.settings?.[`${dial.abilityId}_dial`];
    let currentVal = typeof settingVal === 'number' ? settingVal : 0;
    if (currentVal === 0 && dial.legacyPropertyKey !== undefined && doctrine) {
      const legacyVal = doctrine[dial.legacyPropertyKey];
      if (typeof legacyVal === 'number') currentVal = legacyVal;
    }
    const maxVal = dial.maxCapRule === 'fixed_5' ? Math.min(5, bab) : bab;
    const label = dial.name ?? dial.abilityId.replace(/_/g, ' ');
    modes.push({
      id: dial.abilityId,
      label,
      isActive: currentVal > 0,
      numericValue: currentVal,
      minNumericValue: dial.min,
      maxNumericValue: maxVal,
      tooltipText: `${label} (Current: ${currentVal}, Max: ${maxVal})`
    });
  }

  const is2H = doctrine?.gripMode === 'two_handed';
  const fDef = doctrine?.fightingDefensively ?? false;
  const tDef = doctrine?.totalDefense ?? false;
  addMode('fighting_defensively', 'Fighting Def', fDef, 'Fighting Defensively (-4 Atk, +2 AC)');
  addMode('total_defense', 'Total Def', tDef, 'Total Defense (+4 Dodge AC, Standard)');
  addMode('two_handed_grip', is2H ? '2H Grip' : '1H Grip', is2H, 'Toggle Grip Mode');

  const features = dndData.activeClassFeatures ?? [];
  if (features.includes('decisive_strike')) {
    addMode(
      'decisive_strike',
      'Decisive 2x',
      (doctrine?.decisiveStrike ?? false) && !tDef,
      'Decisive Strike (-2 Atk, 2x damage)'
    );
  }
  if (features.includes('whirling_frenzy')) {
    addMode(
      'whirling_frenzy',
      'Whirling Frenzy',
      doctrine?.whirlingFrenzy ?? false,
      'Whirling Frenzy (+4 STR, +2 AC/Ref)'
    );
  }

  const activeGroups = doctrine?.activeStanceGroups ?? {};
  if (features.includes('shapeshift')) {
    const druidTrack = dndData.tracks?.find((t) => t.trackId === 'druid');
    const druidLevel = Math.max(1, druidTrack?.levels ?? dndData.tracks?.reduce((sum, t) => sum + t.levels, 0) ?? 1);
    const activeForm = activeGroups['druid_shapeshift_form'] ?? 'normal';
    for (const [id, formKey, minLevel, label, tooltipText] of SHAPESHIFT_STANCE_DEFS) {
      if (druidLevel >= minLevel) addMode(id, label, activeForm === formKey, tooltipText, 'druid_shapeshift_form');
    }
  }

  for (const featId of dndData.feats ?? []) {
    for (const act of sysFeats?.[featId]?.activatedAbilities ?? []) {
      const grp = act.toggleGroup;
      if (grp) addMode(act.abilityId, act.name, activeGroups[grp] === act.abilityId, `${act.name} (${grp})`, grp);
    }
  }

  for (const opt of auraStanceOptions ?? []) {
    if (modes.some((m) => m.id === opt.stanceId)) continue;
    const isActive = resolveActiveStanceInGroup(doctrine, opt.groupId, auraStanceOptions, true) === opt.stanceId;
    addMode(opt.stanceId, opt.label, isActive, opt.tooltipText ?? `${opt.label} (${opt.groupId})`, opt.groupId);
  }
  return modes;
}

function getPoolAbilityIcon(poolId: string): string {
  const n = poolId.toLowerCase();
  if (n.includes('turn') || n.includes('rebuke')) return '☀️';
  if (n.includes('rage')) return '🔥';
  if (n.includes('lay_on_hands') || n.includes('heal')) return '💛';
  return n.includes('smite') ? '⚡' : '🌟';
}

/** Builds the 12-slot NWN2-style hotbar dynamically from equipped weapons, spells, resource abilities, skills, and consumables. */
export function buildActorHotbarSlots(
  dndData: Partial<DnD35EntityData> & { readonly resourcePools?: ResourcePoolComponent | undefined },
  state?: GameState,
  entityId?: EntityId,
  resourcePools?: ResourcePoolComponent
): ReadonlyArray<UIHotbarSlot> {
  const candidates: Array<Omit<UIHotbarSlot, 'slotIndex' | 'keyLabel'>> = [];
  const pushCand = (
    label: string,
    iconUrl: string,
    tooltipTitle: string,
    actionPayload: NonNullable<UIHotbarSlot['actionPayload']>,
    isDisabled?: boolean
  ): void => {
    candidates.push({
      label,
      iconUrl,
      tooltipTitle,
      actionPayload,
      ...(isDisabled !== undefined ? { isDisabled } : {})
    });
  };
  const sys = state ? getDnD35SystemContent(state.campaign) : undefined;
  const equip =
    state && entityId !== undefined
      ? (getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined)
      : undefined;
  for (const slot of equip?.slots ?? []) {
    if (!state || (slot.slotType !== 'main_hand' && slot.slotType !== 'off_hand') || slot.equippedItem === null)
      continue;
    const item = mapEntityItemToUI(state, slot.equippedItem, true);
    if (item) {
      pushCand(item.name, item.iconUrl ?? '⚔️', `${item.name} (${slot.id})`, {
        kind: 'weapon',
        id: item.id,
        entityId: slot.equippedItem
      });
    }
  }

  const effectivePools = resourcePools ?? dndData.resourcePools;
  for (const [poolId, entry] of Object.entries(effectivePools?.pools ?? {})) {
    if (entry.max <= 0) continue;
    const displayName = entry.label ?? poolId.replace(/_/g, ' ');
    const actionType =
      poolId === 'abrupt_jaunt' || poolId === 'invisible_fist' ? 'Immediate Action' : 'Standard Action';
    pushCand(
      `${displayName} (${entry.current}/${entry.max})`,
      getPoolAbilityIcon(poolId),
      `${displayName}: ${entry.current}/${entry.max} uses remaining (${actionType})`,
      { kind: 'ability', id: poolId, remainingCount: entry.current },
      entry.current <= 0
    );
  }

  for (const [classId, book] of Object.entries(dndData.spellbooksByClass ?? {})) {
    if (book.castingMode === 'prepared') {
      const groups = new Map<string, { spellId: string; slotId?: string; count: number; level?: number }>();
      if (book.preparedSlots && book.preparedSlots.length > 0) {
        for (const s of book.preparedSlots) {
          if (s.expended || !s.preparedSpellId) continue;
          const key = `${s.spellLevel}:${s.preparedSpellId}`;
          const prev = groups.get(key);
          if (prev) prev.count += 1;
          else groups.set(key, { spellId: s.preparedSpellId, slotId: s.slotId, count: 1, level: s.spellLevel });
        }
      } else {
        for (const spId of book.preparedSpellIds) {
          const prev = groups.get(spId);
          if (prev) prev.count += 1;
          else groups.set(spId, { spellId: spId, count: 1 });
        }
      }
      let slotIdx = 0;
      for (const grp of groups.values()) {
        const name = sys?.spells?.[grp.spellId]?.name ?? grp.spellId.replace(/_/g, ' ');
        pushCand(
          grp.count > 1 ? `${name} ×${grp.count}` : name,
          '✨',
          `Cast ${name} (${classId.toUpperCase()}, ${grp.count} left)`,
          {
            kind: 'spell',
            id: grp.spellId,
            classId,
            slotIdx: slotIdx++,
            ...(grp.slotId !== undefined ? { slotId: grp.slotId } : {}),
            ...(grp.level !== undefined ? { spellLevel: grp.level } : {}),
            remainingCount: grp.count
          }
        );
      }
    } else {
      const usedMap = book.spontaneousSlotsUsedByLevel ?? {};
      book.knownSpellIds.forEach((spellId, slotIdx) => {
        const spDef = sys?.spells?.[spellId];
        const name = spDef?.name ?? spellId.replace(/_/g, ' ');
        const lvl = spDef?.levelByClass[classId] ?? spDef?.level ?? 0;
        const total = book.spellsPerDay[String(lvl)] ?? 0;
        const isAtWill = (lvl === 0 && total === 0) || classId === 'warlock' || classId === 'innate';
        if (!isAtWill && total <= 0) return;
        const rem = isAtWill ? -1 : Math.max(0, total - (usedMap[String(lvl)] ?? 0));
        const suffix = rem < 0 ? '∞' : `${rem}`;
        pushCand(
          `${name} (${suffix})`,
          '✨',
          `Cast ${name} (${classId.toUpperCase()} Lv ${lvl}, ${suffix} left)`,
          { kind: 'spell', id: spellId, classId, slotIdx, spellLevel: lvl, remainingCount: rem },
          rem === 0
        );
      });
    }
  }
  for (const [skillId, ranks] of Object.entries(dndData.skillRanks ?? {})) {
    if (ranks <= 0 || !ACTIVE_SKILL_IDS.has(skillId)) continue;
    const name = sys?.skills?.[skillId]?.name ?? skillId.replace(/_/g, ' ');
    pushCand(name, '🎯', `Use Skill: ${name} (${ranks} ranks)`, { kind: 'skill', id: skillId });
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
      pushCand(item.name, item.iconUrl ?? '🧪', `Use ${item.name}`, { kind: 'item', id: item.id, entityId: itemId });
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
  const b = dndData.actionBudget;
  if (!b) return DND35E_ACTION_PIPS;
  const pip = (id: string, label: string, available: boolean, detailText: string): UIActionEconomyPip => ({
    id,
    label,
    available,
    detailText
  });
  const movLabel =
    b.movementRemainingFt > 0 ? `MOV ${b.movementRemainingFt}ft` : b.moveRemaining > 0 ? 'MOV' : 'MOV 0ft';
  const movDetail =
    b.movementRemainingFt > 0
      ? `${b.movementRemainingFt} ft of movement remaining`
      : b.moveRemaining > 0
        ? 'Move Action Available'
        : 'Move Action Spent';
  const stdOk = b.standardRemaining > 0;
  const swfOk = b.swiftRemaining > 0;
  return [
    pip('std', 'STD', stdOk, stdOk ? 'Standard Action Available' : 'Standard Action Spent'),
    pip('mov', movLabel, b.moveRemaining > 0 || b.movementRemainingFt > 0, movDetail),
    pip('swf', 'SWF', swfOk, swfOk ? 'Swift Action Available' : 'Swift Action Spent'),
    pip('aoo', `AoO (${b.aooRemaining})`, b.aooRemaining > 0, `${b.aooRemaining}/${b.aooMax} AoO Remaining`)
  ];
}

export const DND35E_ACTION_PIPS: ReadonlyArray<UIActionEconomyPip> = [
  { id: 'std', label: 'STD', available: true, detailText: 'Standard Action' },
  { id: 'mov', label: 'MOV', available: true, detailText: 'Move Action' },
  { id: 'swf', label: 'SWF', available: true, detailText: 'Swift Action' },
  { id: 'aoo', label: 'AoO', available: true, detailText: 'Attack of Opportunity' }
];
