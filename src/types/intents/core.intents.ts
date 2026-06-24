import type { IntentType } from './intent.enum.ts';
import type { EntityId } from '../game-state.types.ts';

/** Base interface representing any player or AI command queue intent. */
export interface BaseIntent {
  readonly type: IntentType;
  readonly entityId: EntityId;
  readonly isImmediate?: boolean;
}

/** Intent to skip/pass a turn or wait for a tick. */
export interface WaitIntent extends BaseIntent {
  readonly type: IntentType.Wait;
}

/** Intent to toggle the gameplay mode between turn-based and RTwP. */
export interface ToggleEngineModeIntent extends BaseIntent {
  readonly type: IntentType.ToggleEngineMode;
  readonly isImmediate: true;
}

/** Intent to toggle pause/unpause in RTwP engine mode. */
export interface TogglePauseIntent extends BaseIntent {
  readonly type: IntentType.TogglePause;
  readonly isImmediate: true;
}

/** Intent to adjust the speed multiplier of real-time ticks in RTwP mode. */
export interface SetRTwPSpeedIntent extends BaseIntent {
  readonly type: IntentType.SetRTwPSpeed;
  readonly speedMultiplier: number;
  readonly isImmediate: true;
}
