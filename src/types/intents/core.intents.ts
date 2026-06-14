import type { IntentType } from './intent.enum.ts';
import type { EntityId } from '../game-state.types.ts';

export interface BaseIntent {
  readonly type: IntentType;
  readonly entityId: EntityId;
  readonly isImmediate?: boolean;
}

export interface WaitIntent extends BaseIntent {
  readonly type: IntentType.Wait;
}

export interface ToggleEngineModeIntent extends BaseIntent {
  readonly type: IntentType.ToggleEngineMode;
  readonly isImmediate: true;
}

export interface TogglePauseIntent extends BaseIntent {
  readonly type: IntentType.TogglePause;
  readonly isImmediate: true;
}

export interface SetRTwPSpeedIntent extends BaseIntent {
  readonly type: IntentType.SetRTwPSpeed;
  readonly speedMultiplier: number;
  readonly isImmediate: true;
}
