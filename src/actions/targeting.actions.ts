import type { EntityId } from '../types/game-state.types.ts';
import {
  IntentType,
  type ToggleTargetingIntent,
  type MoveTargetIntent,
  type FireAimedIntent
} from '../types/intents.types.ts';

/**
 * Creates an intent to toggle targeting mode.
 * @param entityId The entity aiming.
 * @returns The ToggleTargetingIntent.
 */
export function createToggleTargetingAction(entityId: EntityId): ToggleTargetingIntent {
  return {
    type: IntentType.ToggleTargeting,
    entityId
  };
}

/**
 * Creates an intent to move the targeting crosshair.
 * @param entityId The entity aiming.
 * @param dx The x delta.
 * @param dy The y delta.
 * @returns The MoveTargetIntent.
 */
export function createMoveTargetAction(entityId: EntityId, dx: number, dy: number): MoveTargetIntent {
  return {
    type: IntentType.MoveTarget,
    entityId,
    dx,
    dy
  };
}

/**
 * Creates an intent to fire at the current target.
 * @param entityId The entity firing.
 * @returns The FireAimedIntent.
 */
export function createFireAimedAction(entityId: EntityId): FireAimedIntent {
  return {
    type: IntentType.FireAimed,
    entityId
  };
}
