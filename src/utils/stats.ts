import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { EffectiveStats } from '../types/ruleset.types.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';

export type { EffectiveStats };

/**
 * Computes the effective combat stats for an entity by delegating to the
 * active ruleset cartridge (`getActiveRuleset(state).getEffectiveActorStats`).
 *
 * @param state The current GameState.
 * @param entityId The entity whose stats to compute.
 * @returns The effective EffectiveStats, or zeroed stats if combat components are missing.
 */
export function getEffectiveStats(state: GameState, entityId: EntityId): EffectiveStats {
  return getActiveRuleset(state).getEffectiveActorStats(state, entityId);
}
