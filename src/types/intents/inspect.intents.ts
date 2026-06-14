import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

export interface ToggleInspectIntent extends BaseIntent {
  readonly type: IntentType.ToggleInspect;
  readonly isImmediate: true;
}

export interface MoveInspectIntent extends BaseIntent {
  readonly type: IntentType.MoveInspect;
  readonly dx: number;
  readonly dy: number;
  readonly isImmediate: true;
}
