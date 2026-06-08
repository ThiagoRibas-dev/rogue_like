import type { GameState, EntityId } from '../types/game-state.types.ts';
import { ComponentType, type InventoryComponent, type EquipmentComponent } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { ITEM_REGISTRY, type EquipmentSlot } from '../constants/items.constants.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

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
  const slots = [equipment.weapon, equipment.armor] as const;
  for (const itemEntityId of slots) {
    if (itemEntityId !== null) {
      const item = getComponent(state, itemEntityId, ComponentType.Item);
      if (item) {
        const def = ITEM_REGISTRY[item.itemId];
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
export function processPickUpIntent(state: GameState, entityId: EntityId): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return state;

  const key = `${pos.x},${pos.y}`;
  const entitiesAtTile = state.spatialIndex.get(key) ?? [];

  // Find first item entity at this position
  let itemEntityId: EntityId | undefined;
  for (const id of entitiesAtTile) {
    if (id !== entityId && getComponent(state, id, ComponentType.Item) !== undefined) {
      itemEntityId = id;
      break;
    }
  }

  if (itemEntityId === undefined) {
    return addMessage(state, 'There is nothing here to pick up.', MessageLogCategory.System);
  }

  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  if (!inventory) return state;

  const effectiveCapacity = getEffectiveCapacity(state, entityId);
  if (inventory.items.length >= effectiveCapacity) {
    return addMessage(state, 'Your inventory is full!', MessageLogCategory.System);
  }

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return state;

  const def = ITEM_REGISTRY[itemComp.itemId];
  const itemName = (itemComp.identified ? def?.name : def?.unidentifiedName) ?? itemComp.itemId;

  // Remove PositionComponent from the item (takes it off the map / spatial index)
  const nextComponents = new Map(state.components);
  const itemComps = nextComponents.get(itemEntityId) ?? [];
  nextComponents.set(
    itemEntityId,
    itemComps.filter((c) => c.type !== ComponentType.Position)
  );

  // Add item to inventory
  const nextInventory: InventoryComponent = {
    ...inventory,
    items: [...inventory.items, itemEntityId]
  };
  const entityComps = nextComponents.get(entityId) ?? [];
  nextComponents.set(
    entityId,
    entityComps.map((c) => (c.type === ComponentType.Inventory ? nextInventory : c))
  );

  // Rebuild the spatial index since a Position was removed
  const newSpatialIndex = new Map<string, EntityId[]>();
  const stateWithNewComponents = { ...state, components: nextComponents };
  for (const id of stateWithNewComponents.entities) {
    const p = getComponent(stateWithNewComponents, id, ComponentType.Position);
    if (p !== undefined) {
      const k = `${p.x},${p.y}`;
      const arr = newSpatialIndex.get(k) ?? [];
      arr.push(id);
      newSpatialIndex.set(k, arr);
    }
  }

  return addMessage(
    { ...stateWithNewComponents, spatialIndex: newSpatialIndex },
    `You pick up the ${itemName}.`,
    MessageLogCategory.System
  );
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
export function processDropIntent(state: GameState, entityId: EntityId, itemIndex: number): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position);
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  if (!pos || !inventory) return state;

  const itemEntityId = inventory.items[itemIndex];
  if (itemEntityId === undefined) return state;

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return state;

  const def = ITEM_REGISTRY[itemComp.itemId];
  const itemName = (itemComp.identified ? def?.name : def?.unidentifiedName) ?? itemComp.itemId;

  // Check if the item is equipped — must unequip first
  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (equipment && (equipment.weapon === itemEntityId || equipment.armor === itemEntityId)) {
    return addMessage(state, `You must unequip the ${itemName} before dropping it.`, MessageLogCategory.System);
  }

  const nextComponents = new Map(state.components);

  // Remove item from inventory
  const nextInventory: InventoryComponent = {
    ...inventory,
    items: inventory.items.filter((_, i) => i !== itemIndex)
  };
  const entityComps = nextComponents.get(entityId) ?? [];
  nextComponents.set(
    entityId,
    entityComps.map((c) => (c.type === ComponentType.Inventory ? nextInventory : c))
  );

  // Add PositionComponent back to the item (place it on the map)
  const itemComps = nextComponents.get(itemEntityId) ?? [];
  const droppedPos = { type: ComponentType.Position as const, x: pos.x, y: pos.y };
  nextComponents.set(itemEntityId, [...itemComps, droppedPos]);

  // Rebuild spatial index
  const newSpatialIndex = new Map<string, EntityId[]>();
  const stateWithNewComponents = { ...state, components: nextComponents };
  for (const id of stateWithNewComponents.entities) {
    const p = getComponent(stateWithNewComponents, id, ComponentType.Position);
    if (p !== undefined) {
      const k = `${p.x},${p.y}`;
      const arr = newSpatialIndex.get(k) ?? [];
      arr.push(id);
      newSpatialIndex.set(k, arr);
    }
  }

  return addMessage(
    { ...stateWithNewComponents, spatialIndex: newSpatialIndex },
    `You drop the ${itemName}.`,
    MessageLogCategory.System
  );
}

/**
 * Processes an EquipItem intent.
 * Moves the item from inventory into the appropriate equipment slot.
 * If a slot is already occupied, the old item is swapped back to inventory.
 *
 * @param state The current GameState.
 * @param entityId The entity equipping the item.
 * @param itemIndex The index of the item in the inventory array.
 * @returns The updated GameState.
 */
export function processEquipItemIntent(state: GameState, entityId: EntityId, itemIndex: number): GameState {
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (!inventory || !equipment) return state;

  const itemEntityId = inventory.items[itemIndex];
  if (itemEntityId === undefined) return state;

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return state;

  const def = ITEM_REGISTRY[itemComp.itemId];
  if (!def?.equippable) {
    const itemName = (itemComp.identified ? def?.name : def?.unidentifiedName) ?? itemComp.itemId;
    return addMessage(state, `The ${itemName} cannot be equipped.`, MessageLogCategory.System);
  }

  const slot = def.equippable.slot;
  const itemName = itemComp.identified ? def.name : def.unidentifiedName;

  // We no longer remove the item from inventory, it just stays there.
  // We don't need to swap items back into inventory since they never left.
  const currentlyEquipped = slot === 'weapon' ? equipment.weapon : equipment.armor;
  if (currentlyEquipped !== null && currentlyEquipped !== itemEntityId) {
    const oldDef = ITEM_REGISTRY[getComponent(state, currentlyEquipped, ComponentType.Item)?.itemId ?? ''];
    const oldName = oldDef?.name ?? 'item';
    state = addMessage(state, `You unequip the ${oldName}.`, MessageLogCategory.System);
  }

  const nextEquipment: EquipmentComponent = {
    ...equipment,
    weapon: slot === 'weapon' ? itemEntityId : equipment.weapon,
    armor: slot === 'armor' ? itemEntityId : equipment.armor
  };

  const nextComponents = new Map(state.components);
  const entityComps = nextComponents.get(entityId) ?? [];
  nextComponents.set(
    entityId,
    entityComps.map((c) => {
      if (c.type === ComponentType.Equipment) return nextEquipment;
      return c;
    })
  );

  return addMessage({ ...state, components: nextComponents }, `You equip the ${itemName}.`, MessageLogCategory.System);
}

/**
 * Processes an UnequipItem intent.
 * Moves the item in the given slot back to inventory, if capacity allows.
 *
 * @param state The current GameState.
 * @param entityId The entity unequipping the item.
 * @param slot The equipment slot to unequip from.
 * @returns The updated GameState.
 */
export function processUnequipItemIntent(state: GameState, entityId: EntityId, slot: EquipmentSlot): GameState {
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (!inventory || !equipment) return state;

  const itemEntityId = slot === 'weapon' ? equipment.weapon : equipment.armor;
  if (itemEntityId === null) {
    return addMessage(state, 'Nothing equipped in that slot.', MessageLogCategory.System);
  }
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  const def = itemComp ? ITEM_REGISTRY[itemComp.itemId] : undefined;
  const itemName = (itemComp?.identified ? def?.name : def?.unidentifiedName) ?? 'item';

  const nextEquipment: EquipmentComponent = {
    ...equipment,
    weapon: slot === 'weapon' ? null : equipment.weapon,
    armor: slot === 'armor' ? null : equipment.armor
  };

  const nextComponents = new Map(state.components);
  const entityComps = nextComponents.get(entityId) ?? [];
  nextComponents.set(
    entityId,
    entityComps.map((c) => {
      if (c.type === ComponentType.Equipment) return nextEquipment;
      return c;
    })
  );

  return addMessage(
    { ...state, components: nextComponents },
    `You unequip the ${itemName}.`,
    MessageLogCategory.System
  );
}
