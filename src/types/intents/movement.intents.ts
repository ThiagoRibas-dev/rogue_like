import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

/** Intent to move an entity by a relative coordinate offset. */
export interface MoveIntent extends BaseIntent {
  readonly type: IntentType.Move;
  readonly dx: number;
  readonly dy: number;
}

/** Intent to transition the player/actors to a new campaign map area. */
export interface ChangeAreaIntent extends BaseIntent {
  readonly type: IntentType.ChangeArea;
  readonly targetAreaId: string;
  readonly targetX?: number | undefined;
  readonly targetY?: number | undefined;
}
