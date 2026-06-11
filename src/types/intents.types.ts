import type { GameEvent } from './events.types.ts';
import type { EntityId, GameState } from './game-state.types.ts';

/**
 * Result of processing an Intent, containing the new state and the energy cost of the action.
 */
export interface ActionResult {
  readonly state: GameState;
  readonly success: boolean;
  readonly energyCost: number;
  readonly events?: ReadonlyArray<GameEvent>;
}

/**
 * Enum defining the different types of Intents that can be returned by Actions.
 */
export const enum IntentType {
  Move = 'Move',
  Wait = 'Wait',
  Interact = 'Interact',
  ChangeArea = 'ChangeArea',
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
  ToggleSettings = 'ToggleSettings',
  UseAbility = 'UseAbility',
  ToggleEngineMode = 'ToggleEngineMode',
  TogglePause = 'TogglePause',
  SetRTwPSpeed = 'SetRTwPSpeed',
  ToggleInspect = 'ToggleInspect',
  MoveInspect = 'MoveInspect',
  ToggleRotated = 'ToggleRotated',
  Toggle3D = 'Toggle3D',
  SetZoomLevel = 'SetZoomLevel'
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
 * Intent to change the area (used by stairs and portals).
 */
export interface ChangeAreaIntent {
  readonly type: IntentType.ChangeArea;
  readonly entityId: EntityId;
  readonly targetAreaId: string;
  readonly targetX?: number;
  readonly targetY?: number;
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
  readonly slotId: string;
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
 * Intent to toggle the settings panel open or closed.
 * Does not consume a turn.
 */
export interface ToggleSettingsIntent {
  readonly type: IntentType.ToggleSettings;
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
  readonly cooldown?: number;
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
 * Intent to toggle inspect mode.
 */
export interface ToggleInspectIntent {
  readonly type: IntentType.ToggleInspect;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

/**
 * Intent to move the inspect cursor.
 */
export interface MoveInspectIntent {
  readonly type: IntentType.MoveInspect;
  readonly entityId: EntityId;
  readonly dx: number;
  readonly dy: number;
  readonly isImmediate: true;
}

/**
 * Intent to toggle 45-degree rotated view mode.
 */
export interface ToggleRotatedIntent {
  readonly type: IntentType.ToggleRotated;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

/**
 * Intent to toggle 3D tilt perspective mode.
 */
export interface Toggle3DIntent {
  readonly type: IntentType.Toggle3D;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}

/**
 * Intent to set the zoom level of the canvas.
 */
export interface SetZoomLevelIntent {
  readonly type: IntentType.SetZoomLevel;
  readonly entityId: EntityId;
  readonly zoomDelta: number;
  readonly isImmediate: true;
}

/**
 * Discriminated union of all possible Intents.
 */
export type Intent =
  | MoveIntent
  | WaitIntent
  | InteractIntent
  | ChangeAreaIntent
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
  | ToggleSettingsIntent
  | UseAbilityIntent
  | ToggleEngineModeIntent
  | TogglePauseIntent
  | SetRTwPSpeedIntent
  | ToggleInspectIntent
  | MoveInspectIntent
  | ToggleRotatedIntent
  | Toggle3DIntent
  | SetZoomLevelIntent;
