/**
 * @file Pure hotbar and stance-mode projection helpers for the D&D 3.5e Cartridge UI Adapter.
 * Projects combat stances, activated class/domain abilities, and the 12-slot NWN2-style hotbar from live ECS state.
 */

import { getComponent } from '../../../core/ecs.ts';
import { type ConsoleStanceGroupOption, resolveActiveStanceInGroup } from '../../../systems/stance.system.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ResourcePoolComponent,
  type ResourcePoolEntry,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { UIActionEconomyPip, UIHotbarSlot, UIStanceModeEntry } from '../../../types/ui_adapter.types.ts';
import { extractActorTacticalDials } from '../combat/tactical_doctrine.ts';
import { resolveResourcePoolActionCost } from '../progression/ledger_resource_pools.ts';
import type { DnD35EntityData } from '../types/dnd35e.types.ts';
import {
  type DnD35ClassDefinition,
  type DnD35FeatDefinition,
  type DnD35SkillDefinition,
  getDnD35SystemContent,
  getLastLoadedDnD35SystemContent
} from '../types/dnd35e_system.types.ts';
import { mapEntityItemToUI } from './dnd35e_ui_projection.ts';

const HOTBAR_SLOT_COUNT = 12;

const ACTION_COST_LABELS: Readonly<Record<NonNullable<ResourcePoolEntry['actionCost']>, string>> = {
  standard: 'Standard Action',
  move: 'Move Action',
  full_round: 'Full-Round Action',
  swift: 'Swift Action',
  immediate: 'Immediate Action',
  free: 'Free Action',
  none: 'Passive'
};

/** Resolves declaratively from loaded `skills/*.json` definitions whether a skill is actively usable from UI. */
export function isSkillUsableActive(
  skillId: string,
  sysSkills?: Readonly<Record<string, DnD35SkillDefinition>>
): boolean {
  const def = (sysSkills ?? getLastLoadedDnD35SystemContent()?.skills)?.[skillId];
  return def !== undefined && (def.isUsableActive === true || def.activeVerb !== undefined);
}

/** Projects dynamic combat stances and toggle groups (excluding activated daily-use resource pools). */
export function buildActorStanceModes(
  dndData: Partial<DnD35EntityData>,
  bab = 0,
  doctrine?: TacticalDoctrineComponent,
  _resourcePools?: ResourcePoolComponent,
  sysFeats?: Readonly<Record<string, DnD35FeatDefinition>>,
  auraStanceOptions?: ReadonlyArray<ConsoleStanceGroupOption>,
  sysClasses?: Readonly<Record<string, DnD35ClassDefinition>>,
  canToggle2HGrip = false
): ReadonlyArray<UIStanceModeEntry> {
  const modes: UIStanceModeEntry[] = [];
  const addedModeIds = new Set<string>();
  const addMode = (id: string, label: string, isActive: boolean, tooltipText: string, groupId?: string): void => {
    if (addedModeIds.has(id)) return;
    addedModeIds.add(id);
    modes.push({ id, label, isActive, ...(groupId ? { groupId } : {}), tooltipText });
  };

  for (const dial of extractActorTacticalDials(dndData.feats ?? [], sysFeats, dndData.suppressedBundleIds ?? [])) {
    const settingVal = doctrine?.settings?.[dial.abilityId] ?? doctrine?.settings?.[`${dial.abilityId}_dial`];
    let currentVal = typeof settingVal === 'number' ? settingVal : 0;
    if (currentVal === 0 && dial.legacyPropertyKey !== undefined && doctrine) {
      const legacyVal = doctrine[dial.legacyPropertyKey];
      if (typeof legacyVal === 'number') currentVal = legacyVal;
    }
    const maxVal = dial.maxCapRule === 'fixed_5' ? Math.min(5, bab) : bab;
    const label = dial.name ?? dial.abilityId.replace(/_/g, ' ');
    addedModeIds.add(dial.abilityId);
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
  if (canToggle2HGrip) {
    addMode('two_handed_grip', is2H ? '2H Grip' : '1H Grip', is2H, 'Toggle Grip Mode (1H vs 2H)');
  }

  const activeGroups = doctrine?.activeStanceGroups ?? {};
  const effectiveClasses = sysClasses ?? getLastLoadedDnD35SystemContent()?.classes;
  for (const featureId of dndData.activeClassFeatures ?? []) {
    for (const track of dndData.tracks ?? []) {
      const detail = effectiveClasses?.[track.trackId]?.featureDetails?.[featureId];
      if (!detail) continue;
      const classLevel = Math.max(1, track.levels);
      for (const act of detail.activatedAbilities ?? []) {
        if (act.minClassLevel !== undefined && classLevel < act.minClassLevel) continue;
        const label = act.shortLabel ?? act.name;
        const tooltip = act.description ?? act.name;
        if (act.doctrineToggleKey === 'decisiveStrike') {
          addMode(act.abilityId, label, (doctrine?.decisiveStrike ?? false) && !tDef, tooltip);
        } else if (act.doctrineToggleKey === 'whirlingFrenzy') {
          addMode(act.abilityId, label, doctrine?.whirlingFrenzy ?? false, tooltip);
        } else if (act.toggleGroup) {
          const activeVal = activeGroups[act.toggleGroup];
          const shortKey = act.abilityId.startsWith(`${featureId}_`)
            ? act.abilityId.slice(featureId.length + 1)
            : act.abilityId;
          const isActive =
            activeVal !== undefined
              ? activeVal === act.abilityId || activeVal === shortKey
              : act.isDefaultInGroup === true;
          addMode(act.abilityId, label, isActive, tooltip, act.toggleGroup);
        }
      }
    }
  }

  const effectiveFeats = sysFeats ?? getLastLoadedDnD35SystemContent()?.feats;
  for (const featId of dndData.feats ?? []) {
    for (const act of effectiveFeats?.[featId]?.activatedAbilities ?? []) {
      if (act.toggleGroup) {
        addMode(
          act.abilityId,
          act.shortLabel ?? act.name,
          activeGroups[act.toggleGroup] === act.abilityId,
          act.description ?? `${act.name} (${act.toggleGroup})`,
          act.toggleGroup
        );
      }
    }
  }

  for (const opt of auraStanceOptions ?? []) {
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
  const sys = (state ? getDnD35SystemContent(state.campaign) : null) ?? getLastLoadedDnD35SystemContent() ?? undefined;
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

  if (state && entityId !== undefined && getComponent(state, entityId, ComponentType.Fighter) !== undefined) {
    const budget = dndData.actionBudget;
    const chargeDisabled =
      budget !== undefined &&
      (budget.standardRemaining < 1 || budget.moveRemaining < 1 || budget.distanceMovedThisRoundFt > 0);
    pushCand(
      'Charge',
      '⚡',
      'Charge (Full-Round Action): Move up to 2x speed in a straight line and strike (+2 Attack, -2 AC until next turn).',
      { kind: 'ability', id: 'charge', verb: 'charge' },
      chargeDisabled
    );
  }

  for (const [poolId, entry] of Object.entries((resourcePools ?? dndData.resourcePools)?.pools ?? {})) {
    if (entry.max <= 0) continue;
    const displayName = entry.label ?? poolId.replace(/_/g, ' ');
    const actionType = ACTION_COST_LABELS[resolveResourcePoolActionCost(poolId, entry, sys)] ?? 'Standard Action';
    pushCand(
      `${displayName} (${entry.current}/${entry.max})`,
      entry.icon ?? getPoolAbilityIcon(poolId),
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
        const payload: NonNullable<UIHotbarSlot['actionPayload']> = {
          kind: 'spell',
          id: grp.spellId,
          classId,
          slotIdx: slotIdx++,
          ...(grp.slotId !== undefined ? { slotId: grp.slotId } : {}),
          ...(grp.level !== undefined ? { spellLevel: grp.level } : {}),
          remainingCount: grp.count
        };
        pushCand(
          grp.count > 1 ? `${name} ×${grp.count}` : name,
          '✨',
          `Cast ${name} (${classId.toUpperCase()}, ${grp.count} left)`,
          payload
        );
      }
    } else {
      const usedMap = book.spontaneousSlotsUsedByLevel ?? {};
      book.knownSpellIds.forEach((spellId, slotIdx) => {
        const spDef = sys?.spells?.[spellId];
        const name = spDef?.name ?? spellId.replace(/_/g, ' ');
        const lvl = spDef?.levelByClass[classId] ?? spDef?.level ?? 0;
        const total = book.spellsPerDay[String(lvl)] ?? 0;
        const isAtWill = (lvl === 0 && total === 0) || book.castingMode === 'innate';
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
    if (ranks <= 0 || !isSkillUsableActive(skillId, sys?.skills)) continue;
    const skillDef = sys?.skills?.[skillId];
    const name = skillDef?.name ?? skillId.replace(/_/g, ' ');
    pushCand(name, '🎯', `Use Skill: ${name} (${ranks} ranks)`, {
      kind: 'skill',
      id: skillId,
      ...(skillDef?.activeVerb !== undefined ? { verb: skillDef.activeVerb } : {})
    });
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
    {
      id: 'std',
      label: 'STD',
      available: stdOk,
      detailText: stdOk ? 'Standard Action Available' : 'Standard Action Spent'
    },
    { id: 'mov', label: movLabel, available: b.moveRemaining > 0 || b.movementRemainingFt > 0, detailText: movDetail },
    { id: 'swf', label: 'SWF', available: swfOk, detailText: swfOk ? 'Swift Action Available' : 'Swift Action Spent' },
    {
      id: 'aoo',
      label: `AoO (${b.aooRemaining})`,
      available: b.aooRemaining > 0,
      detailText: `${b.aooRemaining}/${b.aooMax} AoO Remaining`
    }
  ];
}

export const DND35E_ACTION_PIPS: ReadonlyArray<UIActionEconomyPip> = [
  { id: 'std', label: 'STD', available: true, detailText: 'Standard Action' },
  { id: 'mov', label: 'MOV', available: true, detailText: 'Move Action' },
  { id: 'swf', label: 'SWF', available: true, detailText: 'Swift Action' },
  { id: 'aoo', label: 'AoO', available: true, detailText: 'Attack of Opportunity' }
];
