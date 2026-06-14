import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

export interface MoveIntent extends BaseIntent {
  readonly type: IntentType.Move;
  readonly dx: number;
  readonly dy: number;
}

export interface InteractIntent extends BaseIntent {
  readonly type: IntentType.Interact;
}

export interface ChangeAreaIntent extends BaseIntent {
  readonly type: IntentType.ChangeArea;
  readonly targetAreaId: string;
  readonly targetX?: number;
  readonly targetY?: number;
}
