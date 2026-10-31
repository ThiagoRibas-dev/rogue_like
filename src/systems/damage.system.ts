import { getComponent } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import { ComponentType } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';

/** Duration in milliseconds for floating combat text overlays. */
const FLOATING_TEXT_DURATION_MS = 1000;

/** Random ID range for floating text visual effects. */
const VFX_ID_MAX = 1000000;

/** Coordinate jitter factor for floating combat text. */
const FLOATING_TEXT_JITTER = 0.8;

/**
 * Appends a floating combat text visual effect above an entity.
 *
 * @param state The current GameState.
 * @param entityId The target entity ID.
 * @param content The text content to display.
 * @param color The CSS color string.
 * @returns The updated GameState.
 */
export function addFloatingText(state: GameState, entityId: EntityId, content: string, color: string): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return state;

  const visualEffect = {
    id: `txt_${Math.floor(rng.getUniform() * VFX_ID_MAX)}`,
    type: 'floating_text' as const,
    x: pos.x + (rng.getUniform() - 0.5) * FLOATING_TEXT_JITTER,
    y: pos.y + (rng.getUniform() - 0.5) * FLOATING_TEXT_JITTER,
    content,
    color,
    expiresAt: performance.now() + FLOATING_TEXT_DURATION_MS
  };

  return { ...state, visualEffects: [...state.visualEffects, visualEffect] };
}

/**
 * Processes all entities that have a DamageComponent by delegating to the
 * active ruleset cartridge (`getActiveRuleset(state).processDamage`).
 *
 * @param state The current GameState.
 * @returns The updated GameState.
 */
export function processDamageSystem(state: GameState): GameState {
  return getActiveRuleset(state).processDamage(state);
}
