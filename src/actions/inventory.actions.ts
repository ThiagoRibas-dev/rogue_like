import type { EntityId } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import {
  type PickUpIntent,
  type DropIntent,
  type UseItemIntent,
  type EquipItemIntent,
  type UnequipItemIntent
} from '../types/intents/inventory.intents.ts';
import { type ToggleInventoryIntent } from '../types/intents/ui.intents.ts';

/**
 * Creates a PickUp intent.
 * @param entityId The entity picking up an item from their current tile.
 * @returns The generated PickUpIntent.
 */
export function createPickUpAction(entityId: EntityId): PickUpIntent {
  return { type: IntentType.PickUp, entityId };
}

/**
 * Creates a Drop intent.
 * @param entityId The entity dropping the item.
 * @param itemIndex The position of the item in the inventory array.
 * @returns The generated DropIntent.
 */
export function createDropAction(entityId: EntityId, itemIndex: number): DropIntent {
  return { type: IntentType.Drop, entityId, itemIndex };
}

/**
 * Creates a UseItem intent.
 * @param entityId The entity using the item.
 * @param itemIndex The position of the item in the inventory array.
 * @returns The generated UseItemIntent.
 */
export function createUseItemAction(entityId: EntityId, itemIndex: number): UseItemIntent {
  return { type: IntentType.UseItem, entityId, itemIndex };
}

/**
 * Creates an EquipItem intent.
 * @param entityId The entity equipping the item.
 * @param itemIndex The position of the item in the inventory array.
 * @returns The generated EquipItemIntent.
 */
export function createEquipItemAction(entityId: EntityId, itemIndex: number): EquipItemIntent {
  return { type: IntentType.EquipItem, entityId, itemIndex };
}

/**
 * Creates an UnequipItem intent.
 * @param entityId The entity unequipping the item.
 * @param slotId The equipment slot instance id to unequip from.
 * @returns The generated UnequipItemIntent.
 */
export function createUnequipItemAction(entityId: EntityId, slotId: string): UnequipItemIntent {
  return { type: IntentType.UnequipItem, entityId, slotId };
}

/**
 * Creates a ToggleInventory intent to open or close the inventory panel.
 * Does not consume a turn.
 * @param entityId The entity toggling the inventory.
 * @returns The generated ToggleInventoryIntent.
 */
export function createToggleInventoryAction(entityId: EntityId): ToggleInventoryIntent {
  return { type: IntentType.ToggleInventory, entityId, isImmediate: true };
}
