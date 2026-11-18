import type { GameState, EntityId } from '../types/game-state.types.ts';
import {
  ComponentType,
  type InventoryComponent,
  type ClueComponent,
  type PositionComponent
} from '../types/components.types.ts';
import {
  getComponent,
  addComponent,
  removeComponent,
  removeEntity,
  spawnItem,
  resolveEntityDisplayName
} from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { GameEventType, type GameEvent } from '../types/events.types.ts';
import { processQuestEvent } from './quest.system.ts';
import type { ActionResult } from '../types/intents/intent.union.ts';
import { absorbCurrencyItemGrant, formatCurrency } from './currency.system.ts';
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
 * Finds the first item entity at the actor's position, absorbs currency items directly into wallet,
 * or validates inventory capacity, removes PositionComponent, and adds to inventory.
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

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return { state, success: false, energyCost: 0 };

  const def = state.campaign.items[itemComp.itemId];
  if (!def) return { state, success: false, energyCost: 0 };
  const itemName = resolveEntityDisplayName(state, itemEntityId, itemComp.itemId);

  if (def.currencyGrant) {
    const stackCount = itemComp.charges ?? 1;
    const totalCount = def.currencyGrant.amount * stackCount;
    const credit = absorbCurrencyItemGrant(state, entityId, def, stackCount);
    let nextState = removeComponent(credit.state, itemEntityId, ComponentType.Position);
    nextState = removeEntity(nextState, itemEntityId);
    if (getComponent(nextState, entityId, ComponentType.Player)) {
      nextState = processQuestEvent(nextState, 'gather', itemComp.itemId, totalCount);
    }
    const formattedAmount = formatCurrency(credit.amountBaseUnits, credit.currencyCfg);
    return {
      state: addMessage(nextState, `You collect ${formattedAmount} (${itemName}).`, MessageLogCategory.System),
      success: true,
      energyCost: 100,
      events: []
    };
  }

  const effectiveCapacity = getEffectiveCapacity(state, entityId);
  if (inventory.items.length >= effectiveCapacity) {
    return {
      state: addMessage(state, 'Your inventory is full!', MessageLogCategory.System),
      success: false,
      energyCost: 0
    };
  }

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
  const itemName = resolveEntityDisplayName(state, itemEntityId, itemComp.itemId);

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

/**
 * Grants `count` instances of an item definition directly to an actor's wallet (when `currencyGrant`
 * is present) or inventory (dropping excess items at the actor's coordinates if capacity is full).
 */
export function grantItemToActorInventory(
  state: GameState,
  recipientId: EntityId,
  itemId: string,
  count = 1
): {
  readonly state: GameState;
  readonly droppedOnGround: boolean;
  readonly absorbedCurrencyFormatted?: string | undefined;
  readonly itemName: string;
} {
  const safeCount = Math.max(0, Math.floor(count));
  const itemDef = state.campaign.items[itemId];
  const itemName = itemDef?.name ?? itemId;
  if (!itemDef || safeCount <= 0) {
    return { state, droppedOnGround: false, itemName };
  }

  const isPlayer = getComponent(state, recipientId, ComponentType.Player) !== undefined;
  if (itemDef.currencyGrant) {
    const credit = absorbCurrencyItemGrant(state, recipientId, itemDef, safeCount);
    let nextState = credit.state;
    if (isPlayer) {
      nextState = processQuestEvent(nextState, 'gather', itemId, itemDef.currencyGrant.amount * safeCount);
    }
    const formatted = formatCurrency(credit.amountBaseUnits, credit.currencyCfg);
    return {
      state: nextState,
      droppedOnGround: false,
      absorbedCurrencyFormatted: formatted,
      itemName
    };
  }

  let nextState = state;
  const inventory = getComponent(nextState, recipientId, ComponentType.Inventory) as InventoryComponent | undefined;
  const pos = getComponent(nextState, recipientId, ComponentType.Position) as PositionComponent | undefined;
  const px = pos?.x ?? 0;
  const py = pos?.y ?? 0;

  const currentInventoryItems = inventory ? [...inventory.items] : [];
  const capacity = getEffectiveCapacity(nextState, recipientId);
  let droppedOnGround = false;

  for (let i = 0; i < safeCount; i++) {
    let itemEntityId: EntityId;
    [nextState, itemEntityId] = spawnItem(nextState, itemId, px, py);
    if (inventory && currentInventoryItems.length < capacity) {
      nextState = removeComponent(nextState, itemEntityId, ComponentType.Position);
      currentInventoryItems.push(itemEntityId);
    } else {
      droppedOnGround = true;
    }
  }

  if (inventory) {
    nextState = addComponent(nextState, recipientId, { ...inventory, items: currentInventoryItems });
  }
  if (isPlayer) {
    nextState = processQuestEvent(nextState, 'gather', itemId, safeCount);
  }

  return { state: nextState, droppedOnGround, itemName };
}
