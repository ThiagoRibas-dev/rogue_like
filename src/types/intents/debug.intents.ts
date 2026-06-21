import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

export interface DebugRevealMapIntent extends BaseIntent {
  readonly type: IntentType.DebugRevealMap;
  readonly isImmediate: true;
}

export interface DebugGodModeIntent extends BaseIntent {
  readonly type: IntentType.DebugGodMode;
  readonly isImmediate: true;
}

export interface DebugSpawnEntityIntent extends BaseIntent {
  readonly type: IntentType.DebugSpawnEntity;
  readonly isImmediate: true;
}

export interface DebugFastForwardSchemesIntent extends BaseIntent {
  readonly type: IntentType.DebugFastForwardSchemes;
  readonly isImmediate: true;
  readonly iterations: number;
}

export interface DebugPromoteIntent extends BaseIntent {
  readonly type: IntentType.DebugPromote;
  readonly isImmediate: true;
}
