import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

/** Intent to toggle inspect/look mode overlay. */
export interface ToggleInspectIntent extends BaseIntent {
  readonly type: IntentType.ToggleInspect;
  readonly isImmediate: true;
}

/** Intent to move the inspection cursor in grid offsets. */
export interface MoveInspectIntent extends BaseIntent {
  readonly type: IntentType.MoveInspect;
  readonly dx: number;
  readonly dy: number;
  readonly isImmediate: true;
}
