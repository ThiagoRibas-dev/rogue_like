import type { GameState, EntityId } from '../types/game-state.types.ts';
import { ComponentType, type InventoryComponent, type ClueComponent } from '../types/components.types.ts';
import { getComponent, addComponent, removeComponent } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { GameEventType, type GameEvent } from '../types/events.types.ts';
import { processQuestEvent } from './quest.system.ts';
import type { ActionResult } from '../types/intents/intent.union.ts';
import {
  processEquipItemIntent,
  processUnequipItemIntent,
  type AnatomyBodyPlan,
  buildAnatomyEquipmentSlots
} from './inventory/equipment_slots.ts';

export type { AnatomyBodyPlan };
export { processEquipItemIntent, processUnequipItemIntent, buildAnatomyEquipmentSlots };

/**
 * Computes the effective inventory capacity for an entity by summing
 * the base capacity from InventoryComponent with any carry bonuses from equipped items.
 * This is the canonical "query time" approach — no mutation of base values.
 *
 * @param state The current GameState.
 * @param entityId The entity whose capacity to compute.
 * @returns The effective maximum number of items the entity can carry.
 */
export function getEffectiveCapacity(state: GameState, entityId: EntityId): number {
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  if (!inventory) return 0;

  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (!equipment) return inventory.baseCapacity;

  let bonus = 0;
  for (const slot of equipment.slots) {
    if (slot.equippedItem !== null && slot.suppressed !== true) {
      const item = getComponent(state, slot.equippedItem, ComponentType.Item);
      if (item) {
        const def = state.campaign.items[item.itemId];
        bonus += def?.equippable?.carryBonus ?? 0;
      }
    }
  }

  return inventory.baseCapacity + bonus;
}

/**
 * Processes a PickUp intent.
 * Finds the first item entity at the actor's position, validates inventory capacity,
 * removes its PositionComponent (taking it off the map), and adds it to inventory.
 *
 * @param state The current GameState.
 * @param entityId The entity picking up the item.
 * @returns The updated GameState.
 */
export function processPickUpIntent(state: GameState, entityId: EntityId): ActionResult {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return { state, success: false, energyCost: 0 };

  const key = `${pos.x},${pos.y}`;
  const entitiesAtTile = state.spatialIndex.get(key) ?? [];

  let itemEntityId: EntityId | undefined;
  for (const id of entitiesAtTile) {
    if (id !== entityId && getComponent(state, id, ComponentType.Item) !== undefined) {
      itemEntityId = id;
      break;
    }
  }

  if (itemEntityId === undefined) {
    return {
      state: addMessage(state, 'There is nothing here to pick up.', MessageLogCategory.System),
      success: false,
      energyCost: 0
    };
  }

  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  if (!inventory) return { state, success: false, energyCost: 0 };

  const effectiveCapacity = getEffectiveCapacity(state, entityId);
  if (inventory.items.length >= effectiveCapacity) {
    return {
      state: addMessage(state, 'Your inventory is full!', MessageLogCategory.System),
      success: false,
      energyCost: 0
    };
  }

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return { state, success: false, energyCost: 0 };

  const def = state.campaign.items[itemComp.itemId];
  if (!def) return { state, success: false, energyCost: 0 };
  const isIdentified = state.identifiedItems.has(def.id);
  const itemName =
    (isIdentified ? def?.name : (state.itemUnidentifiedNames.get(def.id) ?? def?.unidentifiedName)) ?? itemComp.itemId;

  let nextState = removeComponent(state, itemEntityId, ComponentType.Position);

  const nextInventory: InventoryComponent = {
    ...inventory,
    items: [...inventory.items, itemEntityId]
  };
  nextState = addComponent(nextState, entityId, nextInventory);

  if (getComponent(nextState, entityId, ComponentType.Player)) {
    nextState = processQuestEvent(nextState, 'gather', itemComp.itemId, 1);
  }

  const clueComp = getComponent(nextState, itemEntityId, ComponentType.Clue) as ClueComponent | undefined;
  const events: GameEvent[] = [];
  if (clueComp) {
    events.push({
      type: GameEventType.ClueDiscovered,
      clueId: clueComp.clueId,
      sourceEntityId: itemEntityId,
      implicatesEntityId: clueComp.implicatesEntityId
    });
  }

  return {
    state: addMessage(nextState, `You pick up the ${itemName}.`, MessageLogCategory.System),
    success: true,
    energyCost: 100,
    events
  };
}

/**
 * Processes a Drop intent.
 * Removes the item at the given inventory index from the entity's inventory
 * and places it back on the map at the entity's current position.
 *
 * @param state The current GameState.
 * @param entityId The entity dropping the item.
 * @param itemIndex The index of the item in the inventory array.
 * @returns The updated GameState.
 */
export function processDropIntent(
  state: GameState,
  entityId: EntityId,
  itemIndex: number
): { state: GameState; success: boolean } {
  const pos = getComponent(state, entityId, ComponentType.Position);
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  if (!pos || !inventory) return { state, success: false };

  const itemEntityId = inventory.items[itemIndex];
  if (itemEntityId === undefined) return { state, success: false };

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return { state, success: false };

  const def = state.campaign.items[itemComp.itemId];
  if (!def) return { state, success: false };
  const isIdentified = state.identifiedItems.has(def.id);
  const itemName =
    (isIdentified ? def?.name : (state.itemUnidentifiedNames.get(def.id) ?? def?.unidentifiedName)) ?? itemComp.itemId;

  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (equipment && equipment.slots.some((s) => s.equippedItem === itemEntityId)) {
    return {
      state: addMessage(state, `You must unequip the ${itemName} before dropping it.`, MessageLogCategory.System),
      success: false
    };
  }

  let nextState = state;

  const nextInventory: InventoryComponent = {
    ...inventory,
    items: inventory.items.filter((_, i) => i !== itemIndex)
  };
  nextState = addComponent(nextState, entityId, nextInventory);

  const droppedPos = { type: ComponentType.Position as const, x: pos.x, y: pos.y };
  nextState = addComponent(nextState, itemEntityId, droppedPos);

  return {
    state: addMessage(nextState, `You drop the ${itemName}.`, MessageLogCategory.System),
    success: true
  };
}
