import type { EntityId } from './game-state.types.ts';

/**
 * Enum defining the different types of Intents that can be returned by Actions.
 */
export const enum IntentType {
  Move = 'Move',
  Wait = 'Wait',
  Interact = 'Interact',
  ChangeFloor = 'ChangeFloor',
  DebugRevealMap = 'DebugRevealMap',
  DebugGodMode = 'DebugGodMode',
  DebugSpawnEntity = 'DebugSpawnEntity',
  ToggleTargeting = 'ToggleTargeting',
  MoveTarget = 'MoveTarget',
  FireAimed = 'FireAimed',
  MeleeAttack = 'MeleeAttack'
}

/**
 * Intent to move to a new position.
 */
export interface MoveIntent {
  readonly type: IntentType.Move;
  readonly entityId: EntityId;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Intent to wait and do nothing for a turn.
 */
export interface WaitIntent {
  readonly type: IntentType.Wait;
  readonly entityId: EntityId;
}

/**
 * Intent to interact with the current tile or adjacent tile.
 */
export interface InteractIntent {
  readonly type: IntentType.Interact;
  readonly entityId: EntityId;
}

/**
 * Intent to change the floor (used by stairs and portals).
 */
export interface ChangeFloorIntent {
  readonly type: IntentType.ChangeFloor;
  readonly entityId: EntityId;
  readonly direction: 'up' | 'down';
}

/**
 * Intent to reveal the entire map (Debug).
 */
export interface DebugRevealMapIntent {
  readonly type: IntentType.DebugRevealMap;
  readonly entityId: EntityId;
}

/**
 * Intent to toggle God Mode (Debug).
 */
export interface DebugGodModeIntent {
  readonly type: IntentType.DebugGodMode;
  readonly entityId: EntityId;
}

/**
 * Intent to spawn a dummy entity (Debug).
 */
export interface DebugSpawnEntityIntent {
  readonly type: IntentType.DebugSpawnEntity;
  readonly entityId: EntityId;
}

/**
 * Intent to toggle aiming/targeting mode.
 */
export interface ToggleTargetingIntent {
  readonly type: IntentType.ToggleTargeting;
  readonly entityId: EntityId;
}

/**
 * Intent to move the targeting crosshair.
 */
export interface MoveTargetIntent {
  readonly type: IntentType.MoveTarget;
  readonly entityId: EntityId;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Intent to fire at the currently targeted tile.
 */
export interface FireAimedIntent {
  readonly type: IntentType.FireAimed;
  readonly entityId: EntityId;
}

/**
 * Intent to attack a specific entity in melee.
 */
export interface MeleeAttackIntent {
  readonly type: IntentType.MeleeAttack;
  readonly entityId: EntityId;
  readonly defenderId: EntityId;
}

/**
 * Discriminated union of all possible Intents.
 */
export type Intent =
  | MoveIntent
  | WaitIntent
  | InteractIntent
  | ChangeFloorIntent
  | DebugRevealMapIntent
  | DebugGodModeIntent
  | DebugSpawnEntityIntent
  | ToggleTargetingIntent
  | MoveTargetIntent
  | FireAimedIntent
  | MeleeAttackIntent;
