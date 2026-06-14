import type { EntityId } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import {
  type DebugRevealMapIntent,
  type DebugGodModeIntent,
  type DebugSpawnEntityIntent,
  type DebugFastForwardSchemesIntent
} from '../types/intents/debug.intents.ts';

/**
 * Creates a debug intent to reveal the map.
 * @param entityId The entity invoking the debug tool.
 * @returns The generated DebugRevealMapIntent.
 */
export function createDebugRevealMapAction(entityId: EntityId): DebugRevealMapIntent {
  return {
    type: IntentType.DebugRevealMap,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a debug intent to toggle god mode.
 * @param entityId The entity invoking the debug tool.
 * @returns The generated DebugGodModeIntent.
 */
export function createDebugGodModeAction(entityId: EntityId): DebugGodModeIntent {
  return {
    type: IntentType.DebugGodMode,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a debug intent to spawn an entity.
 * @param entityId The entity invoking the debug tool.
 * @returns The generated DebugSpawnEntityIntent.
 */
export function createDebugSpawnEntityAction(entityId: EntityId): DebugSpawnEntityIntent {
  return {
    type: IntentType.DebugSpawnEntity,
    entityId,
    isImmediate: true
  };
}

/**
 * Creates a debug intent to fast-forward mastermind schemes.
 * @param entityId The entity invoking the debug tool.
 * @param iterations The number of scheme turns to process.
 * @returns The generated DebugFastForwardSchemesIntent.
 */
export function createDebugFastForwardSchemesAction(
  entityId: EntityId,
  iterations: number = 10
): DebugFastForwardSchemesIntent {
  return {
    type: IntentType.DebugFastForwardSchemes,
    entityId,
    isImmediate: true,
    iterations
  };
}
