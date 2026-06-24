import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

/** Intent to debug-reveal the entire map, marking all tiles as explored. */
export interface DebugRevealMapIntent extends BaseIntent {
  readonly type: IntentType.DebugRevealMap;
  readonly isImmediate: true;
}

/** Intent to toggle god mode (invincibility/no damage) on the player. */
export interface DebugGodModeIntent extends BaseIntent {
  readonly type: IntentType.DebugGodMode;
  readonly isImmediate: true;
}

/** Intent to debug-spawn an entity at the target cursor location. */
export interface DebugSpawnEntityIntent extends BaseIntent {
  readonly type: IntentType.DebugSpawnEntity;
  readonly isImmediate: true;
}

/** Intent to debug-advance villain mastermind schemes by a given number of turns. */
export interface DebugFastForwardSchemesIntent extends BaseIntent {
  readonly type: IntentType.DebugFastForwardSchemes;
  readonly isImmediate: true;
  readonly iterations: number;
}

/** Intent to debug-promote the nearest target entity into the faction hierarchy. */
export interface DebugPromoteIntent extends BaseIntent {
  readonly type: IntentType.DebugPromote;
  readonly isImmediate: true;
}
