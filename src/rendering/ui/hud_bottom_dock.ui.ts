/**
 * @file Persistent Bottom-Center HUD Hotbar & Combat Stance Dock (Milestone 118.1).
 * Pure Tier 1 Console host that queries `getActiveCartridgeUI(state)` for stances, action economy pips,
 * and hotbar slots, and dispatches user interactions back to the active cartridge.
 */

import { createApplyAction } from '../../actions/interaction.actions.ts';
import { createWaitAction } from '../../actions/core.actions.ts';
import { QUICK_BELT_SLOT_COUNT } from '../../constants/ui.constants.ts';
import { getComponent } from '../../core/ecs.ts';
import { getGameState, queuePlayerIntent } from '../../core/game-loop.ts';
import { markAllDomainsDirty, markDomainDirty, PresentationDomain } from '../../core/presentation_queue.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent
} from '../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import { getActiveCartridgeUI } from './cartridge_ui_registry.ts';
import {
  type ConsoleHotbarCallbacks,
  renderConsoleHotbar,
  type UIActionEconomyPipData,
  type UIHotbarSlotData,
  type UIStanceActionData
} from './console_hotbar.ui.ts';

let activeBank = 1;
const HOTBAR_SLOT_COUNT = 12;

/**
 * Collects up to `QUICK_BELT_SLOT_COUNT` unequipped consumable, zappable, or throwable items from the player's inventory.
 *
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId.
 * @returns Array of item EntityIds mapped to quick-belt slots `[1]-[5]`.
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
 *
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId.
 * @param beltIndex Zero-based quick-belt slot index.
 * @returns True if an item was present and queued.
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
 * or falling back to quick-belt items.
 */
export function executeHotbarSlotByKey(state: GameState, playerEntityId: EntityId, slotIndex: number): boolean {
  const cartridgeUI = getActiveCartridgeUI(state);
  if (cartridgeUI?.onExecuteHotbarSlot) {
    cartridgeUI.onExecuteHotbarSlot(state, playerEntityId, slotIndex, activeBank);
    return true;
  }
  return triggerQuickBeltSlot(state, playerEntityId, slotIndex);
}

const EMPTY_HOTBAR_SLOTS: ReadonlyArray<UIHotbarSlotData> = Array.from({ length: HOTBAR_SLOT_COUNT }, (_, i) => ({
  slotIndex: i,
  keyLabel: i === 9 ? '0' : i === 10 ? '-' : i === 11 ? '=' : `${i + 1}`,
  label: ''
}));

/**
 * Renders the persistent bottom HUD dock on the main screen by delegating to the active Cartridge UI Definition.
 *
 * @param state The current GameState.
 */
export function renderHudBottomDock(state: GameState): void {
  const container = document.getElementById('hud-bottom-dock');
  if (!container) return;

  const isPlayMode = state.uiMode === UIMode.Game;
  if (!isPlayMode) {
    container.replaceChildren();
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  const playerId = state.entities.find((id: EntityId) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) {
    container.replaceChildren();
    return;
  }

  const cartridgeUI = getActiveCartridgeUI(state);
  const hotbarData = cartridgeUI?.getHotbarData ? cartridgeUI.getHotbarData(state, playerId, activeBank) : undefined;

  const stanceActions: ReadonlyArray<UIStanceActionData> = (hotbarData?.stanceModes ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    isActive: s.isActive,
    ...(s.numericValue !== undefined ? { numericValue: s.numericValue } : {}),
    ...(s.minNumericValue !== undefined ? { minNumericValue: s.minNumericValue } : {}),
    ...(s.maxNumericValue !== undefined ? { maxNumericValue: s.maxNumericValue } : {}),
    ...(s.tooltipText !== undefined ? { tooltipText: s.tooltipText } : {})
  }));

  const actionPips: ReadonlyArray<UIActionEconomyPipData> = hotbarData?.actionPips ?? [];
  const slots: ReadonlyArray<UIHotbarSlotData> =
    hotbarData?.slots && hotbarData.slots.length > 0
      ? (hotbarData.slots as ReadonlyArray<UIHotbarSlotData>)
      : EMPTY_HOTBAR_SLOTS;

  const callbacks: ConsoleHotbarCallbacks = {
    onChangeBank: (newBank) => {
      activeBank = newBank;
      markDomainDirty(PresentationDomain.HUD);
    },
    onExecuteSlot: (slotIndex) => {
      const liveState = getGameState() ?? state;
      if (cartridgeUI?.onExecuteHotbarSlot) {
        cartridgeUI.onExecuteHotbarSlot(liveState, playerId, slotIndex, activeBank);
      } else {
        triggerQuickBeltSlot(liveState, playerId, slotIndex);
      }
      markAllDomainsDirty();
    },
    onToggleStance: (stanceId) => {
      const liveState = getGameState() ?? state;
      if (cartridgeUI?.onToggleStance) {
        cartridgeUI.onToggleStance(liveState, playerId, stanceId);
      } else {
        markDomainDirty(PresentationDomain.HUD);
      }
    },
    onStanceStep: (stanceId, delta) => {
      const liveState = getGameState() ?? state;
      if (cartridgeUI?.onStepStance) {
        cartridgeUI.onStepStance(liveState, playerId, stanceId, delta);
      }
    },
    ...(state.engineMode === EngineMode.TurnBased
      ? {
          onEndTurn: () => {
            queuePlayerIntent(createWaitAction(playerId));
          }
        }
      : {})
  };

  renderConsoleHotbar(container, slots, stanceActions, callbacks, actionPips);
}
