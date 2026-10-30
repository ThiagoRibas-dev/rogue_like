import { type EntityId, type GameState } from '../../types/game-state.types.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent
} from '../../types/components.types.ts';
import { getComponent } from '../ecs.ts';
import { queuePlayerIntent, setGameState } from '../game-loop.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import {
  createDropAction,
  createEquipItemAction,
  createToggleInventoryAction,
  createUnequipItemAction
} from '../../actions/inventory.actions.ts';
import { createApplyAction } from '../../actions/interaction.actions.ts';

/** Lowest lowercase ASCII letter code used for inventory slot selection. */
const SLOT_KEY_MIN_CHAR_CODE = 97;

/** Highest lowercase ASCII letter code used for inventory slot selection. */
const SLOT_KEY_MAX_CHAR_CODE = 122;

/**
 * Handles a keypress while the inventory panel is open.
 *
 * Supports closing with Escape, plus per-slot letter keys:
 * plain letter uses the item, Shift+letter drops it, Alt+letter equips or unequips it.
 *
 * @param event The originating KeyboardEvent.
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId.
 */
export function handleInventoryKey(event: KeyboardEvent, state: GameState, playerEntityId: EntityId): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    queuePlayerIntent(createToggleInventoryAction(playerEntityId));
    return;
  }

  // Ignore multi-character keys and non a-z keys.
  if (event.key.length !== 1) return;
  const code = event.key.toLowerCase().charCodeAt(0);
  if (code < SLOT_KEY_MIN_CHAR_CODE || code > SLOT_KEY_MAX_CHAR_CODE) return;

  event.preventDefault();
  const slotIndex = code - SLOT_KEY_MIN_CHAR_CODE;

  const inventory = getComponent(state, playerEntityId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (inventory === undefined || slotIndex >= inventory.items.length) return;

  const itemEntityId = inventory.items[slotIndex];
  const equipment = getComponent(state, playerEntityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const itemComponent =
    itemEntityId !== undefined
      ? (getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined)
      : undefined;
  const definition = itemComponent !== undefined ? state.campaign.items[itemComponent.itemId] : undefined;

  let itemName = 'item';
  if (definition !== undefined && itemComponent !== undefined) {
    const isIdentified = state.identifiedItems.has(itemComponent.itemId);
    itemName = isIdentified
      ? definition.name
      : (state.itemUnidentifiedNames.get(itemComponent.itemId) ?? definition.unidentifiedName ?? itemComponent.itemId);
  }

  if (event.shiftKey) {
    setGameState(addMessage(state, `Queued: Drop ${itemName}`, MessageLogCategory.System));
    queuePlayerIntent(createDropAction(playerEntityId, slotIndex));
    return;
  }

  if (event.altKey) {
    if (itemEntityId !== undefined && equipment !== undefined && definition?.equippable) {
      const equippedSlot = equipment.slots.find((slot) => slot.equippedItem === itemEntityId);
      if (equippedSlot !== undefined) {
        setGameState(addMessage(state, `Queued: Unequip ${itemName}`, MessageLogCategory.System));
        queuePlayerIntent(createUnequipItemAction(playerEntityId, equippedSlot.id));
        return;
      }
    }

    setGameState(addMessage(state, `Queued: Equip ${itemName}`, MessageLogCategory.System));
    queuePlayerIntent(createEquipItemAction(playerEntityId, slotIndex));
    return;
  }

  setGameState(addMessage(state, `Queued: Use ${itemName}`, MessageLogCategory.System));
  if (itemEntityId !== undefined) {
    queuePlayerIntent(createApplyAction(playerEntityId, 'apply', { type: 'item', itemEntityId }));
  }
}
