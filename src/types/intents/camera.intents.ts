import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

/** Intent to toggle the map canvas rotation. */
export interface ToggleRotatedIntent extends BaseIntent {
  readonly type: IntentType.ToggleRotated;
  readonly isImmediate: true;
}

/** Intent to toggle the map canvas 3D tilt transformation. */
export interface Toggle3DIntent extends BaseIntent {
  readonly type: IntentType.Toggle3D;
  readonly isImmediate: true;
}

/** Intent to adjust the map canvas zoom level delta. */
export interface SetZoomLevelIntent extends BaseIntent {
  readonly type: IntentType.SetZoomLevel;
  readonly zoomDelta: number;
  readonly isImmediate: true;
}
