import { addComponent, getComponent, removeComponent } from '../../../core/ecs.ts';
import { ComponentType, type ResourcePoolComponent, type ResourcePoolEntry } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { resolveTypedModifiers } from '../modifiers/stacking_engine.ts';
import { collectClassFeaturesUpToLevel } from '../progression.ts';
import type { AbilityId, DnD35EntityData, StatModifier } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** Canonical legacy statModifier target aliases mapped to `ResourcePoolComponent` pool IDs. */
const POOL_MODIFIER_TARGET_ALIASES: Readonly<Record<string, ReadonlyArray<string>>> = {
  turn_undead: ['turn_attempts_per_day']
};

/**
 * Resolves unconditional `StatModifier` bonuses targeting a modular resource pool capacity
 * (`<poolId>`, `<poolId>_uses`, `<poolId>_per_day`, `<poolId>_attempts_per_day`, or canonical aliases)
 * via the D&D 3.5e 18-type bonus stacking engine.
 */
function resolvePoolModifierBonus(poolId: string, statModifiers: ReadonlyArray<StatModifier> | undefined): number {
  if (!statModifiers || statModifiers.length === 0) return 0;
  const acceptedTargets = new Set<string>([
    poolId,
    `${poolId}_uses`,
    `${poolId}_per_day`,
    `${poolId}_attempts_per_day`,
    ...(POOL_MODIFIER_TARGET_ALIASES[poolId] ?? [])
  ]);
  const matching = statModifiers.filter((m) => m.condition === undefined && acceptedTargets.has(m.targetStat));
  return matching.length > 0 ? resolveTypedModifiers(matching) : 0;
}

/**
 * Computes a `ResourcePoolComponent` strictly from active class features and domains that
 * explicitly declare a `resourcePool` block in system JSON, incorporating unconditional
 * pool modifiers (e.g. Extra Turning) and preserving remaining `current` charges across
 * rebuilds/level-ups when `previousPoolComp` is supplied.
 *
 * @param dndData Actor's hydrated D&D 3.5e entity data.
 * @param sysContent Loaded D&D 3.5e system content.
 * @param previousPoolComp Optional existing `ResourcePoolComponent` to preserve spent uses.
 * @returns Hydrated `ResourcePoolComponent`, or `undefined` if no active feature/domain defines a `resourcePool`.
 */
export function buildActorResourcePoolsComponent(
  dndData: DnD35EntityData,
  sysContent: DnD35SystemContent,
  previousPoolComp?: ResourcePoolComponent
): ResourcePoolComponent | undefined {
  const pools: Record<string, ResourcePoolEntry> = {};
  const suppressedIds = dndData.suppressedBundleIds ?? [];

  const getAbilityMod = (ab: AbilityId): number => {
    const score = computeEffectiveAbilityScore(dndData.abilityScores[ab]);
    return score === null ? 0 : computeAbilityModifier(score);
  };

  for (const track of dndData.tracks) {
    if (track.levels <= 0) continue;
    const classDef = sysContent.classes[track.trackId];
    if (!classDef) continue;

    const trackFeatures = collectClassFeaturesUpToLevel(classDef, track.levels, dndData.selectedAcfs ?? []);
    for (const featId of trackFeatures) {
      if (suppressedIds.includes(featId)) continue;
      const detail = classDef.featureDetails[featId];
      const rp = detail?.resourcePool;
      if (!rp) continue;

      const levelContrib = rp.perClassLevel !== undefined ? Math.floor(rp.perClassLevel * track.levels) : 0;
      const abilContrib = rp.abilityModStat !== undefined ? Math.max(0, getAbilityMod(rp.abilityModStat)) : 0;
      const max = Math.max(0, rp.maxBase + levelContrib + abilContrib);
      if (max <= 0) continue;

      const existing = pools[rp.poolId];
      const combinedMax = (existing?.max ?? 0) + max;
      const prevCurrent = previousPoolComp?.pools[rp.poolId]?.current;
      pools[rp.poolId] = {
        current: prevCurrent !== undefined ? Math.min(combinedMax, prevCurrent) : combinedMax,
        max: combinedMax,
        resetOnRest: rp.refreshCycle === 'rest_8h' || rp.refreshCycle === 'short_rest',
        label: detail.name,
        refreshCycle: rp.refreshCycle
      };
    }
  }

  for (const domId of dndData.domains ?? []) {
    const domDef = sysContent.domains[domId];
    const rp = domDef?.resourcePool ?? domDef?.grantedPowerBundle?.resourcePool;
    if (!rp) continue;

    const abilContrib = rp.abilityModStat !== undefined ? Math.max(0, getAbilityMod(rp.abilityModStat)) : 0;
    const max = Math.max(0, rp.maxBase + abilContrib);
    if (max <= 0) continue;

    const existing = pools[rp.poolId];
    const combinedMax = (existing?.max ?? 0) + max;
    const prevCurrent = previousPoolComp?.pools[rp.poolId]?.current;
    pools[rp.poolId] = {
      current: prevCurrent !== undefined ? Math.min(combinedMax, prevCurrent) : combinedMax,
      max: combinedMax,
      resetOnRest: rp.refreshCycle === 'rest_8h' || rp.refreshCycle === 'short_rest',
      ...(domDef?.name !== undefined ? { label: domDef.name } : {}),
      refreshCycle: rp.refreshCycle
    };
  }

  for (const [poolId, entry] of Object.entries(pools)) {
    const modBonus = resolvePoolModifierBonus(poolId, dndData.statModifiers);
    if (modBonus === 0) continue;
    const adjustedMax = Math.max(0, entry.max + modBonus);
    if (adjustedMax <= 0) {
      delete pools[poolId];
      continue;
    }
    const prevCurrent = previousPoolComp?.pools[poolId]?.current;
    pools[poolId] = {
      ...entry,
      max: adjustedMax,
      current: prevCurrent !== undefined ? Math.min(adjustedMax, prevCurrent) : adjustedMax
    };
  }

  if (Object.keys(pools).length === 0) {
    return undefined;
  }

  return {
    type: ComponentType.ResourcePool,
    pools
  };
}

/**
 * Synchronizes an entity's `ComponentType.ResourcePool` in `GameState` from declared class and domain
 * `resourcePool` definitions, removing the component if no pools remain active.
 *
 * @param state Current immutable GameState.
 * @param entityId Target actor EntityId.
 * @param dndData Hydrated D&D 3.5e entity data for the actor.
 * @param sysContent Loaded D&D 3.5e system content.
 * @returns Updated GameState.
 */
export function syncActorResourcePoolsComponent(
  state: GameState,
  entityId: EntityId,
  dndData: DnD35EntityData,
  sysContent: DnD35SystemContent
): GameState {
  const existingComp = getComponent(state, entityId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  const nextComp = buildActorResourcePoolsComponent(dndData, sysContent, existingComp);
  if (!nextComp) {
    return existingComp ? removeComponent(state, entityId, ComponentType.ResourcePool) : state;
  }
  return addComponent(state, entityId, nextComp);
}
