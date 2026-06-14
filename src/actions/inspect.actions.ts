import { IntentType } from '../types/intents/intent.enum.ts';
import type { EntityId } from '../types/game-state.types.ts';

import type { ToggleInspectIntent, MoveInspectIntent } from '../types/intents/inspect.intents.ts';

export function createToggleInspectAction(entityId: EntityId): ToggleInspectIntent {
  return { type: IntentType.ToggleInspect, entityId, isImmediate: true };
}

export function createMoveInspectAction(entityId: EntityId, dx: number, dy: number): MoveInspectIntent {
  return { type: IntentType.MoveInspect, entityId, dx, dy, isImmediate: true };
}
