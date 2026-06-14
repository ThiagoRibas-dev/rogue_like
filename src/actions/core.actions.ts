import { type EntityId } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { type InteractIntent, type MoveIntent } from '../types/intents/movement.intents.ts';
import {
  type SetRTwPSpeedIntent,
  type ToggleEngineModeIntent,
  type TogglePauseIntent,
  type WaitIntent
} from '../types/intents/core.intents.ts';
import {
  type SetZoomLevelIntent,
  type Toggle3DIntent,
  type ToggleRotatedIntent
} from '../types/intents/camera.intents.ts';
import {
  type ToggleFactionsIntent,
  type ToggleInvestigationIntent,
  type ToggleQuestsIntent,
  type ToggleSettingsIntent,
  type ToggleDebugIntent
} from '../types/intents/ui.intents.ts';

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

/**
 * Creates a toggle rotated mode intent.
 */
export function createToggleRotatedAction(entityId: EntityId): ToggleRotatedIntent {
  return {
    type: IntentType.ToggleRotated,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a toggle 3D tilt mode intent.
 */
export function createToggle3DAction(entityId: EntityId): Toggle3DIntent {
  return {
    type: IntentType.Toggle3D,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a set zoom level intent.
 */
export function createSetZoomLevelAction(entityId: EntityId, zoomDelta: number): SetZoomLevelIntent {
  return {
    type: IntentType.SetZoomLevel,
    entityId,
    zoomDelta,
    isImmediate: true
  };
}

/**
 * Creates a toggle settings intent.
 */
export function createToggleSettingsAction(entityId: EntityId): ToggleSettingsIntent {
  return {
    type: IntentType.ToggleSettings,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a toggle factions intent.
 */
export function createToggleFactionsAction(entityId: EntityId): ToggleFactionsIntent {
  return {
    type: IntentType.ToggleFactions,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a toggle quests intent.
 */
export function createToggleQuestsAction(entityId: EntityId): ToggleQuestsIntent {
  return {
    type: IntentType.ToggleQuests,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a toggle investigation intent.
 */
export function createToggleInvestigationAction(entityId: EntityId): ToggleInvestigationIntent {
  return {
    type: IntentType.ToggleInvestigation,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a toggle debug intent.
 */
export function createToggleDebugAction(entityId: EntityId): ToggleDebugIntent {
  return {
    type: IntentType.ToggleDebug,
    entityId,
    isImmediate: true
  };
}
