import type { GameState, EntityId } from '../types/game-state.types.ts';
import { ComponentType, type InventoryComponent, type EquipmentComponent } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { GameEventType, type GameEvent } from '../types/events.types.ts';

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
    if (slot.equippedItem !== null) {
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
export function processPickUpIntent(
  state: GameState,
  entityId: EntityId
): import('../types/intents/intent.union.ts').ActionResult {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return { state, success: false, energyCost: 0 };

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

  const clueComp = getComponent(stateWithNewComponents, itemEntityId, ComponentType.Clue) as
    | import('../types/components.types.ts').ClueComponent
    | undefined;
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
    state: addMessage(
      { ...stateWithNewComponents, spatialIndex: newSpatialIndex },
      `You pick up the ${itemName}.`,
      MessageLogCategory.System
    ),
    success: true,
    energyCost: 100, // ActionRegistry defaults
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

  // Check if the item is equipped — must unequip first
  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (equipment && equipment.slots.some((s) => s.equippedItem === itemEntityId)) {
    return {
      state: addMessage(state, `You must unequip the ${itemName} before dropping it.`, MessageLogCategory.System),
      success: false
    };
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

  return {
    state: addMessage(
      { ...stateWithNewComponents, spatialIndex: newSpatialIndex },
      `You drop the ${itemName}.`,
      MessageLogCategory.System
    ),
    success: true
  };
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
export function processEquipItemIntent(
  state: GameState,
  entityId: EntityId,
  itemIndex: number
): { state: GameState; success: boolean } {
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (!inventory || !equipment) return { state, success: false };

  const itemEntityId = inventory.items[itemIndex];
  if (itemEntityId === undefined) return { state, success: false };

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return { state, success: false };

  const def = state.campaign.items[itemComp.itemId];
  if (!def?.equippable) {
    const isIdentified = state.identifiedItems.has(def?.id ?? '');
    const itemName =
      (isIdentified ? def?.name : (state.itemUnidentifiedNames.get(def?.id ?? '') ?? def?.unidentifiedName)) ??
      itemComp.itemId;
    return {
      state: addMessage(state, `The ${itemName} cannot be equipped.`, MessageLogCategory.System),
      success: false
    };
  }

  const slotType = def.equippable.slot;
  const isIdentified = state.identifiedItems.has(def.id);
  const itemName =
    (isIdentified ? def?.name : (state.itemUnidentifiedNames.get(def.id) ?? def?.unidentifiedName)) ?? itemComp.itemId;

  // Find an available slot of this type
  const matchingSlots = equipment.slots.filter((s) => s.slotType === slotType);
  if (matchingSlots.length === 0) {
    return {
      state: addMessage(state, `You have no ${slotType} slot to equip the ${itemName}.`, MessageLogCategory.System),
      success: false
    };
  }

  // Find the first empty slot, or if all full, swap the first one
  let targetSlot = matchingSlots.find((s) => s.equippedItem === null);
  if (!targetSlot) {
    targetSlot = matchingSlots[0]!;
  }

  if (targetSlot.equippedItem !== null && targetSlot.equippedItem !== itemEntityId) {
    const oldDef = state.campaign.items[getComponent(state, targetSlot.equippedItem, ComponentType.Item)?.itemId ?? ''];
    const oldName = oldDef?.name ?? 'item';
    state = addMessage(state, `You unequip the ${oldName}.`, MessageLogCategory.System);
  }

  const nextEquipment: EquipmentComponent = {
    ...equipment,
    slots: equipment.slots.map((s) => (s.id === targetSlot!.id ? { ...s, equippedItem: itemEntityId } : s))
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

  return {
    state: addMessage(
      { ...state, components: nextComponents },
      `You equip the ${itemName}.`,
      MessageLogCategory.System
    ),
    success: true
  };
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
export function processUnequipItemIntent(
  state: GameState,
  entityId: EntityId,
  slotId: string
): { state: GameState; success: boolean } {
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (!inventory || !equipment) return { state, success: false };

  const targetSlot = equipment.slots.find((s) => s.id === slotId);
  if (!targetSlot || targetSlot.equippedItem === null) {
    return { state: addMessage(state, 'Nothing equipped in that slot.', MessageLogCategory.System), success: false };
  }
  const itemEntityId = targetSlot.equippedItem;
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  const def = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
  if (!itemComp || !def) return { state, success: false };
  const isIdentified = state.identifiedItems.has(def.id);
  const itemName =
    (isIdentified ? def?.name : (state.itemUnidentifiedNames.get(def.id) ?? def?.unidentifiedName)) ?? itemComp.itemId;

  const nextEquipment: EquipmentComponent = {
    ...equipment,
    slots: equipment.slots.map((s) => (s.id === slotId ? { ...s, equippedItem: null } : s))
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

  return {
    state: addMessage(
      { ...state, components: nextComponents },
      `You unequip the ${itemName}.`,
      MessageLogCategory.System
    ),
    success: true
  };
}
