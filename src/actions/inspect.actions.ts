import { IntentType } from '../types/intents/intent.enum.ts';
import type { EntityId } from '../types/game-state.types.ts';

import type { ToggleInspectIntent, MoveInspectIntent } from '../types/intents/inspect.intents.ts';

/**
 * Creates a ToggleInspectIntent to toggle look/inspect mode.
 */
export function createToggleInspectAction(entityId: EntityId): ToggleInspectIntent {
  return { type: IntentType.ToggleInspect, entityId, isImmediate: true };
}

/**
 * Creates a MoveInspectIntent to move the look cursor.
 */
export function createMoveInspectAction(entityId: EntityId, dx: number, dy: number): MoveInspectIntent {
  return { type: IntentType.MoveInspect, entityId, dx, dy, isImmediate: true };
}
