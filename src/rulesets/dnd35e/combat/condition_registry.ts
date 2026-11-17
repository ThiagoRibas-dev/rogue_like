import type { DnD35ConditionId, StatModifier } from '../types/dnd35e.types.ts';
import { getLastLoadedDnD35SystemContent, type DnD35ConditionDefinition } from '../types/dnd35e_system.types.ts';

/** Default condition penalty prefix for provenance paths. */
const CONDITION_SOURCE_PREFIX = 'condition:';

/**
 * Resolves the effective condition definition map from an explicit override or the active
 * loaded system content registry.
 */
function resolveConditionRegistry(
  override?: Readonly<Record<string, DnD35ConditionDefinition>>
): Readonly<Record<string, DnD35ConditionDefinition>> {
  return override ?? getLastLoadedDnD35SystemContent()?.conditionEffects ?? {};
}

/**
 * Applies a condition to an entity's active condition list while enforcing declarative
 * `escalationGroup` + `escalationOrder` progression chains (e.g., Fear: `shaken -> frightened -> panicked`,
 * Fatigue: `fatigued -> exhausted`).
 *
 * @param currentConditions Existing active `DnD35ConditionId` array.
 * @param incomingCondition Incoming `DnD35ConditionId`.
 * @param conditionRegistry Optional declarative `conditionEffects` registry override.
 * @returns Updated deduplicated `ReadonlyArray<DnD35ConditionId>`.
 */
export function applyConditionWithEscalation(
  currentConditions: ReadonlyArray<DnD35ConditionId>,
  incomingCondition: DnD35ConditionId,
  conditionRegistry?: Readonly<Record<string, DnD35ConditionDefinition>>
): ReadonlyArray<DnD35ConditionId> {
  const registry = resolveConditionRegistry(conditionRegistry);
  const incomingDef = registry[incomingCondition];
  const group = incomingDef?.escalationGroup;
  const incomingOrder = incomingDef?.escalationOrder;

  if (group !== undefined && incomingOrder !== undefined) {
    const groupMembers = Object.values(registry).filter(
      (def) => def.escalationGroup === group && def.escalationOrder !== undefined
    );
    const maxGroupOrder = groupMembers.reduce((max, def) => Math.max(max, def.escalationOrder ?? 0), incomingOrder);

    let existingMaxOrder = -1;
    const filtered: DnD35ConditionId[] = [];
    for (const c of currentConditions) {
      const def = registry[c];
      if (def?.escalationGroup === group && def.escalationOrder !== undefined) {
        existingMaxOrder = Math.max(existingMaxOrder, def.escalationOrder);
      } else {
        filtered.push(c);
      }
    }

    if (existingMaxOrder >= 0) {
      const nextOrder = Math.min(maxGroupOrder, Math.max(existingMaxOrder, incomingOrder) + 1);
      const escalated = groupMembers.find((def) => def.escalationOrder === nextOrder);
      const targetCondition = (escalated?.id ?? incomingCondition) as DnD35ConditionId;
      if (!filtered.includes(targetCondition)) {
        filtered.push(targetCondition);
      }
      return filtered;
    }
  }

  const next = new Array<DnD35ConditionId>(...currentConditions);
  if (!next.includes(incomingCondition)) {
    next.push(incomingCondition);
  }
  return next;
}

/**
 * Emits declarative `StatModifier` entries for all active `conditions` from the loaded
 * `conditionEffects` registry, preserving hierarchical `condition:<id>/<modId>` provenance.
 *
 * @param conditions Active `DnD35ConditionId` list.
 * @param conditionRegistry Optional declarative `conditionEffects` registry override.
 * @returns Array of `StatModifier`s declared by the active conditions.
 */
export function buildConditionStatModifiers(
  conditions: ReadonlyArray<DnD35ConditionId>,
  conditionRegistry?: Readonly<Record<string, DnD35ConditionDefinition>>
): ReadonlyArray<StatModifier> {
  const registry = resolveConditionRegistry(conditionRegistry);
  const modifiers: StatModifier[] = [];

  for (const condId of conditions) {
    const def = registry[condId];
    if (!def) continue;
    for (const mod of def.modifiers) {
      modifiers.push({
        targetStat: mod.target,
        value: mod.value,
        bonusType: mod.type,
        sourceId: `${CONDITION_SOURCE_PREFIX}${condId}:${mod.id}`,
        sourcePath: `${CONDITION_SOURCE_PREFIX}${condId}/${mod.id}`,
        origin: 'ex',
        ...(mod.effectTags !== undefined ? { effectTags: mod.effectTags } : {}),
        ...(mod.condition !== undefined ? { condition: mod.condition } : {})
      });
    }
  }

  return modifiers;
}

/**
 * Computes aggregate combat and stat penalties from an entity's active D&D 3.5e conditions
 * by reading declarative `conditionEffects` definitions (`conditions/*.json`).
 *
 * @param conditions Active `DnD35ConditionId` list.
 * @param conditionRegistry Optional declarative `conditionEffects` registry override.
 * @returns `{ meleeAttackPenalty: number, acPenalty: number, losesDexToAC: boolean, strPenalty: number, dexPenalty: number, canTakeActions: boolean }`.
 */
export function summarizeConditionEffects(
  conditions: ReadonlyArray<DnD35ConditionId>,
  conditionRegistry?: Readonly<Record<string, DnD35ConditionDefinition>>
): {
  readonly meleeAttackPenalty: number;
  readonly acPenalty: number;
  readonly losesDexToAC: boolean;
  readonly strPenalty: number;
  readonly dexPenalty: number;
  readonly canTakeActions: boolean;
} {
  const registry = resolveConditionRegistry(conditionRegistry);
  let meleeAttackPenalty = 0;
  let acPenalty = 0;
  let losesDexToAC = false;
  let canTakeActions = true;
  const maxStrByGroup: Record<string, number> = {};
  const maxDexByGroup: Record<string, number> = {};

  for (const c of conditions) {
    const def = registry[c];
    if (!def) continue;

    for (const mod of def.modifiers) {
      if (mod.target === 'attack' || mod.target === 'melee_attack') {
        meleeAttackPenalty += mod.value;
      } else if (mod.target === 'ac') {
        acPenalty += mod.value;
      }
    }

    for (const override of def.ruleOverrides) {
      if (override.ruleKey === 'loses_dex_to_ac' && override.value === true) {
        losesDexToAC = true;
      } else if (override.ruleKey === 'can_take_actions' && override.value === false) {
        canTakeActions = false;
      }
    }

    if (def.abilityPenalties) {
      const groupKey = def.abilityPenaltyGroup ?? c;
      if (def.abilityPenalties.str > 0) {
        maxStrByGroup[groupKey] = Math.max(maxStrByGroup[groupKey] ?? 0, def.abilityPenalties.str);
      }
      if (def.abilityPenalties.dex > 0) {
        maxDexByGroup[groupKey] = Math.max(maxDexByGroup[groupKey] ?? 0, def.abilityPenalties.dex);
      }
    }
  }

  let strPenalty = 0;
  for (const val of Object.values(maxStrByGroup)) strPenalty += val;
  let dexPenalty = 0;
  for (const val of Object.values(maxDexByGroup)) dexPenalty += val;

  return {
    meleeAttackPenalty,
    acPenalty,
    losesDexToAC,
    strPenalty,
    dexPenalty,
    canTakeActions
  };
}
