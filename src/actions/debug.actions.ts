import type { EntityId } from '../types/game-state.types.ts';
import { IntentType, type DebugRevealMapIntent, type DebugGodModeIntent, type DebugSpawnEntityIntent } from '../types/intents.types.ts';

/**
 * Creates a debug intent to reveal the map.
 * @param entityId The entity invoking the debug tool.
 * @returns The generated DebugRevealMapIntent.
 */
export function createDebugRevealMapAction(entityId: EntityId): DebugRevealMapIntent {
  return {
    type: IntentType.DebugRevealMap,
    entityId
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
    entityId
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
    entityId
  };
}
