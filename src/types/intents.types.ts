import type { GameState, EntityId } from './game-state.types.ts';

/**
 * Result of processing an Intent, containing the new state and the energy cost of the action.
 */
export interface ActionResult {
  readonly state: GameState;
  readonly success: boolean;
  readonly energyCost: number;
}

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
  MeleeAttack = 'MeleeAttack',
  PickUp = 'PickUp',
  Drop = 'Drop',
  UseItem = 'UseItem',
  EquipItem = 'EquipItem',
  UnequipItem = 'UnequipItem',
  ToggleInventory = 'ToggleInventory',
  UseAbility = 'UseAbility',
  ToggleEngineMode = 'ToggleEngineMode',
  TogglePause = 'TogglePause',
  SetRTwPSpeed = 'SetRTwPSpeed'
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
  readonly isImmediate: true;
}

/**
 * Intent to toggle God Mode (Debug).
 */
export interface DebugGodModeIntent {
  readonly type: IntentType.DebugGodMode;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

/**
 * Intent to spawn a dummy entity (Debug).
 */
export interface DebugSpawnEntityIntent {
  readonly type: IntentType.DebugSpawnEntity;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

/**
 * Intent to toggle aiming/targeting mode.
 */
export interface ToggleTargetingIntent {
  readonly type: IntentType.ToggleTargeting;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

/**
 * Intent to move the targeting crosshair.
 */
export interface MoveTargetIntent {
  readonly type: IntentType.MoveTarget;
  readonly entityId: EntityId;
  readonly dx: number;
  readonly dy: number;
  readonly isImmediate: true;
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
 * Intent to pick up an item at the entity's current position.
 */
export interface PickUpIntent {
  readonly type: IntentType.PickUp;
  readonly entityId: EntityId;
}

/**
 * Intent to drop an item from inventory onto the current tile.
 * itemIndex is the position of the item in the entity's inventory array.
 */
export interface DropIntent {
  readonly type: IntentType.Drop;
  readonly entityId: EntityId;
  readonly itemIndex: number;
}

/**
 * Intent to use a consumable item from inventory.
 * itemIndex is the position of the item in the entity's inventory array.
 */
export interface UseItemIntent {
  readonly type: IntentType.UseItem;
  readonly entityId: EntityId;
  readonly itemIndex: number;
}

/**
 * Intent to equip an item from inventory into its appropriate equipment slot.
 * itemIndex is the position of the item in the entity's inventory array.
 */
export interface EquipItemIntent {
  readonly type: IntentType.EquipItem;
  readonly entityId: EntityId;
  readonly itemIndex: number;
}

/**
 * Intent to unequip a piece of gear from a slot back into inventory.
 */
export interface UnequipItemIntent {
  readonly type: IntentType.UnequipItem;
  readonly entityId: EntityId;
  readonly slot: import('../types/campaign.types.ts').EquipmentSlot;
}

/**
 * Intent to toggle the inventory panel open or closed.
 * Does not consume a turn.
 */
export interface ToggleInventoryIntent {
  readonly type: IntentType.ToggleInventory;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

/**
 * Intent to use an innate ability or spell (used by AI).
 */
export interface UseAbilityIntent {
  readonly type: IntentType.UseAbility;
  readonly entityId: EntityId;
  readonly effectId: string;
  readonly abilityName: string;
}

/**
 * Intent to toggle the engine mode between turn-based and RTwP.
 */
export interface ToggleEngineModeIntent {
  readonly type: IntentType.ToggleEngineMode;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

/**
 * Intent to toggle pause in RTwP mode.
 */
export interface TogglePauseIntent {
  readonly type: IntentType.TogglePause;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

/**
 * Intent to set the RTwP simulation speed.
 */
export interface SetRTwPSpeedIntent {
  readonly type: IntentType.SetRTwPSpeed;
  readonly entityId: EntityId;
  readonly speedMultiplier: number;
  readonly isImmediate: true;
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
  | MeleeAttackIntent
  | PickUpIntent
  | DropIntent
  | UseItemIntent
  | EquipItemIntent
  | UnequipItemIntent
  | ToggleInventoryIntent
  | UseAbilityIntent
  | ToggleEngineModeIntent
  | TogglePauseIntent
  | SetRTwPSpeedIntent;
