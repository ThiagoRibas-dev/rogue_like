import { IntentType } from '../types/intents.types.ts';
import type { EntityId } from '../types/game-state.types.ts';

export interface ToggleInspectIntent {
  readonly type: IntentType.ToggleInspect;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

export interface MoveInspectIntent {
  readonly type: IntentType.MoveInspect;
  readonly entityId: EntityId;
  readonly dx: number;
  readonly dy: number;
  readonly isImmediate: true;
}

export function createToggleInspectAction(entityId: EntityId): ToggleInspectIntent {
  return { type: IntentType.ToggleInspect, entityId, isImmediate: true };
}

export function createMoveInspectAction(entityId: EntityId, dx: number, dy: number): MoveInspectIntent {
  return { type: IntentType.MoveInspect, entityId, dx, dy, isImmediate: true };
}
