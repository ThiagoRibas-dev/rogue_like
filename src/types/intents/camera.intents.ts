import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

export interface ToggleRotatedIntent extends BaseIntent {
  readonly type: IntentType.ToggleRotated;
  readonly isImmediate: true;
}

export interface Toggle3DIntent extends BaseIntent {
  readonly type: IntentType.Toggle3D;
  readonly isImmediate: true;
}

export interface SetZoomLevelIntent extends BaseIntent {
  readonly type: IntentType.SetZoomLevel;
  readonly zoomDelta: number;
  readonly isImmediate: true;
}
