/**
 * @file Persistent Bottom-Center HUD Hotbar & Combat Stance Dock helpers.
 * Unifies `activeBank` (`1..10`) directly with `uiStore` as the single source of truth.
 */

import { createApplyAction } from '../../actions/interaction.actions.ts';
import { QUICK_BELT_SLOT_COUNT } from '../../constants/ui.constants.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { markDomainDirty, PresentationDomain } from '../../core/presentation_queue.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { getActiveCartridgeUI } from './cartridge_ui_registry.ts';
import { uiStore } from './core/ui_store.ts';

/**
 * Returns the currently selected 1-based hotbar bank (`1..10`) from the single `uiStore` source of truth.
 */
export function getActiveHotbarBank(): number {
  return uiStore.getSnapshot().activeBank;
}

/**
 * Cycles the active hotbar bank (`1..10`) by `delta` (`-1` or `+1`) in `uiStore` and marks HUD dirty.
 */
export function cycleHotbarBank(delta: number): number {
  const next = uiStore.cycleActiveBank(delta);
  markDomainDirty(PresentationDomain.HUD);
  return next;
}

/**
 * Collects up to `QUICK_BELT_SLOT_COUNT` unequipped consumable, zappable, or throwable items from the player's inventory.
 */
export function getQuickBeltItems(state: GameState, playerEntityId: EntityId): ReadonlyArray<EntityId> {
  const inventory = getComponent(state, playerEntityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equipment = getComponent(state, playerEntityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!inventory) return [];

  const equippedIds = new Set<EntityId>();
  if (equipment) {
    for (const slot of equipment.slots) {
      if (slot.equippedItem !== null) {
        equippedIds.add(slot.equippedItem);
      }
    }
  }

  const beltItems: EntityId[] = [];
  for (const itemId of inventory.items) {
    if (beltItems.length >= QUICK_BELT_SLOT_COUNT) break;
    if (equippedIds.has(itemId)) continue;

    const itemComp = getComponent(state, itemId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const def = state.campaign.items[itemComp.itemId];
    if (!def) continue;

    if (def.category === 'consumable' || def.zappable || def.throwable || !def.equippable) {
      beltItems.push(itemId);
    }
  }

  return beltItems;
}

/**
 * Triggers the quick-belt item at 0-based index `beltIndex` (`0..4` corresponding to keys `1..5`).
 */
export function triggerQuickBeltSlot(state: GameState, playerEntityId: EntityId, beltIndex: number): boolean {
  const beltItems = getQuickBeltItems(state, playerEntityId);
  const itemEntityId = beltItems[beltIndex];
  if (itemEntityId === undefined) return false;

  queuePlayerIntent(createApplyAction(playerEntityId, 'apply', { type: 'item', itemEntityId }));
  return true;
}

/**
 * Executes a hotbar slot at 0-based index `slotIndex` (`0..11`), delegating to the active cartridge
 * or falling back to quick-belt items using the canonical `uiStore.activeBank`.
 */
export function executeHotbarSlotByKey(state: GameState, playerEntityId: EntityId, slotIndex: number): boolean {
  const activeBank = getActiveHotbarBank();
  const cartridgeUI = getActiveCartridgeUI(state);
  if (cartridgeUI?.onExecuteHotbarSlot) {
    cartridgeUI.onExecuteHotbarSlot(state, playerEntityId, slotIndex, activeBank);
    return true;
  }
  return triggerQuickBeltSlot(state, playerEntityId, slotIndex);
}
