/**
 * @file Classic / Sci-Fi Ruleset UI Adapter (Milestone 118.1).
 * Connects the default / classic ruleset to the unified Tier 1 Console Master Dossier and Retro CRT theme.
 */

import { createApplyAction } from '../../actions/interaction.actions.ts';
import { createEquipItemAction, createUnequipItemAction } from '../../actions/inventory.actions.ts';
import { getComponent } from '../../core/ecs.ts';
import { getGameState, queuePlayerIntent, setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { DefaultSciFiUIAdapter } from '../../rulesets/classic/ui/classic_ui_adapter.ts';
import { ComponentType } from '../../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import { type CartridgeUIDefinition, closeCartridgeModal, registerCartridgeUI } from './cartridge_ui_registry.ts';
import { renderConsoleMasterDossier } from './console_dossier.ui.ts';
import { hideConsoleItemInspectCard, showConsoleItemInspectCard } from './console_inspect_card.ui.ts';
import { setConsoleThemeMode } from './console_theme.ts';
import { triggerQuickBeltSlot } from './hud_bottom_dock.ui.ts';

const sciFiAdapter = new DefaultSciFiUIAdapter();

/**
 * Renders the Classic / Sci-Fi Master Dossier overlay modal into `#dnd35e-sheet-overlay`.
 */
export function renderClassicSheetModal(state: GameState): void {
  const overlay = document.getElementById('dnd35e-sheet-overlay');
  if (!overlay) return;

  const isModalActive =
    (state.uiMode === UIMode.CartridgeModal &&
      (state.activeCartridgeModalId === 'character_sheet' || state.activeCartridgeModalId === 'inventory')) ||
    state.uiMode === UIMode.Inventory;

  if (!isModalActive) {
    hideConsoleItemInspectCard();
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  setConsoleThemeMode('retro-crt');

  const content = document.getElementById('dnd35e-sheet-body');
  if (!content) return;

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  const ctx = playerId !== undefined ? { state, entityId: playerId } : {};
  const sheetData = sciFiAdapter.getCharacterSheetData(ctx);
  const invData = sciFiAdapter.getInventoryData(ctx);

  renderConsoleMasterDossier(content, sheetData, invData, {
    onClose: () => {
      hideConsoleItemInspectCard();
      setGameState(closeCartridgeModal(getGameState()));
      markAllDomainsDirty();
    },
    onHoverItem: (item, event) => {
      if (item?.inspectData) showConsoleItemInspectCard(item.inspectData, event);
      else hideConsoleItemInspectCard();
    },
    onEquipItem: (_itemId, _slotId, item) => {
      if (playerId !== undefined && item?.inventoryIndex !== undefined) {
        queuePlayerIntent(createEquipItemAction(playerId, item.inventoryIndex));
        markAllDomainsDirty();
      }
    },
    onUnequipItem: (slotId) => {
      if (playerId !== undefined) {
        queuePlayerIntent(createUnequipItemAction(playerId, slotId));
        markAllDomainsDirty();
      }
    },
    onUseItem: (_itemId, item) => {
      if (playerId !== undefined && item?.entityId !== undefined) {
        queuePlayerIntent(
          createApplyAction(playerId, 'apply', { type: 'item', itemEntityId: item.entityId as EntityId })
        );
        markAllDomainsDirty();
      }
    }
  });
}

/**
 * Canonical Classic / Sci-Fi Cartridge UI Definition.
 */
export const classicUIDefinition: CartridgeUIDefinition = {
  rulesetId: 'classic',
  defaultThemeMode: 'retro-crt',

  dockCommands: [
    {
      id: 'classic_sheet',
      label: 'Profile',
      icon: '👤',
      modalId: 'character_sheet',
      defaultKey: 'c'
    },
    {
      id: 'classic_inventory',
      label: 'Pack',
      icon: '🎒',
      modalId: 'character_sheet',
      defaultKey: 'i'
    }
  ],

  getHotbarData: (state, playerId, bank) => sciFiAdapter.getHotbarData({ state, entityId: playerId }, bank),

  onExecuteHotbarSlot: (state, playerId, slotIndex) => {
    triggerQuickBeltSlot(state, playerId, slotIndex);
  },

  modals: {
    character_sheet: {
      modalId: 'character_sheet',
      overlayElementId: 'dnd35e-sheet-overlay',
      allowEscapeClose: true,
      render: renderClassicSheetModal
    },
    inventory: {
      modalId: 'inventory',
      overlayElementId: 'dnd35e-sheet-overlay',
      allowEscapeClose: true,
      render: renderClassicSheetModal
    }
  }
};

/**
 * Registers the Classic Cartridge UI definition into the Console Cartridge Registry.
 */
export function registerClassicUIAdapter(): void {
  registerCartridgeUI(classicUIDefinition);
}
