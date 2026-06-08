import type { EntityId } from '../types/game-state.types.ts';
import {
  IntentType,
  type MoveIntent,
  type WaitIntent,
  type InteractIntent,
  type ToggleEngineModeIntent,
  type TogglePauseIntent,
  type SetRTwPSpeedIntent
} from '../types/intents.types.ts';

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

/**
 * Creates a toggle engine mode intent.
 */
export function createToggleEngineModeAction(entityId: EntityId): ToggleEngineModeIntent {
  return {
    type: IntentType.ToggleEngineMode,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a toggle pause intent.
 */
export function createTogglePauseAction(entityId: EntityId): TogglePauseIntent {
  return {
    type: IntentType.TogglePause,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a set RTwP speed intent.
 */
export function createSetRTwPSpeedAction(entityId: EntityId, speedMultiplier: number): SetRTwPSpeedIntent {
  return {
    type: IntentType.SetRTwPSpeed,
    entityId,
    speedMultiplier,
    isImmediate: true
  };
}
