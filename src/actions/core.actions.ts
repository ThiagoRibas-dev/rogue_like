import type { EntityId } from '../types/game-state.types.ts';
import { IntentType, type MoveIntent, type WaitIntent, type InteractIntent } from '../types/intents.types.ts';

/**
 * Creates a move intent.
 * @param entityId The entity taking the action.
 * @param dx The delta x.
 * @param dy The delta y.
 * @returns The generated MoveIntent.
 */
export function createMoveAction(entityId: EntityId, dx: number, dy: number): MoveIntent {
  return {
    type: IntentType.Move,
    entityId,
    dx,
    dy
  };
}

/**
 * Creates a wait intent.
 * @param entityId The entity taking the action.
 * @returns The generated WaitIntent.
 */
export function createWaitAction(entityId: EntityId): WaitIntent {
  return {
    type: IntentType.Wait,
    entityId
  };
}

/**
 * Creates an interact intent.
 * @param entityId The entity taking the action.
 * @returns The generated InteractIntent.
 */
export function createInteractAction(entityId: EntityId): InteractIntent {
  return {
    type: IntentType.Interact,
    entityId
  };
}
