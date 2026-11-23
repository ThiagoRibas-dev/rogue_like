/**
 * @file Classic / Sci-Fi Cartridge UI Adapter (Milestone 163).
 * Mounts the Classic Master Dossier onto the Preact ConsoleModalHost without
 * legacy `#dnd35e-sheet-overlay` coupling or forced theme overrides.
 */

import type { ComponentChildren, JSX } from 'preact';
import { createApplyAction } from '../../../../actions/interaction.actions.ts';
import {
  createDropAction,
  createEquipItemAction,
  createUnequipItemAction
} from '../../../../actions/inventory.actions.ts';
import { getComponent } from '../../../../core/ecs.ts';
import { getGameState, queuePlayerIntent, setGameState } from '../../../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../../../core/presentation_queue.ts';
import { DefaultSciFiUIAdapter } from '../../../../rulesets/classic/ui/classic_ui_adapter.ts';
import { ComponentType } from '../../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import type { UIInventoryItem } from '../../../../types/ui_adapter.types.ts';
import { type CartridgeUIDefinition, closeCartridgeModal, registerCartridgeUI } from '../../cartridge_ui_registry.ts';
import { triggerQuickBeltSlot } from '../../hud_bottom_dock.ui.ts';
import { ConsoleDossierView } from '../../modals/ConsoleDossierView.tsx';
import { ModalShell } from '../../primitives/ModalShell.tsx';

const sciFiAdapter = new DefaultSciFiUIAdapter();

interface ClassicSheetModalProps {
  readonly state: GameState;
}

function ClassicSheetModal({ state }: ClassicSheetModalProps): JSX.Element {
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  const ctx = playerId !== undefined ? { state, entityId: playerId } : {};
  const sheetData = sciFiAdapter.getCharacterSheetData(ctx);
  const invData = sciFiAdapter.getInventoryData(ctx);

  const handleClose = (): void => {
    const live = getGameState() ?? state;
    setGameState(closeCartridgeModal(live));
    markAllDomainsDirty();
  };

  const handleEquip = (_itemId: string, _slotId: string, item?: UIInventoryItem): void => {
    if (playerId === undefined || item?.inventoryIndex === undefined) return;
    queuePlayerIntent(createEquipItemAction(playerId, item.inventoryIndex));
    markAllDomainsDirty();
  };

  const handleUnequip = (slotId: string): void => {
    if (playerId === undefined) return;
    queuePlayerIntent(createUnequipItemAction(playerId, slotId));
    markAllDomainsDirty();
  };

  const handleUse = (_itemId: string, item?: UIInventoryItem): void => {
    if (playerId === undefined || item?.entityId === undefined) return;
    queuePlayerIntent(createApplyAction(playerId, 'apply', { type: 'item', itemEntityId: item.entityId as EntityId }));
    markAllDomainsDirty();
  };

  const handleDrop = (_itemId: string, item?: UIInventoryItem): void => {
    if (playerId === undefined || item?.inventoryIndex === undefined) return;
    queuePlayerIntent(createDropAction(playerId, item.inventoryIndex));
    markAllDomainsDirty();
  };

  return (
    <ModalShell
      title={sheetData.name || 'Character Sheet'}
      subtitle={`${sheetData.raceName} • ${sheetData.levelSummary}`}
      size="xl"
      showHelpHint
      onClose={handleClose}
    >
      <ConsoleDossierView
        sheet={sheetData}
        inv={invData}
        onEquipItem={handleEquip}
        onUnequipItem={handleUnequip}
        onUseItem={handleUse}
        onDropItem={handleDrop}
        onClose={handleClose}
      />
    </ModalShell>
  );
}

/**
 * Renders the Preact Classic / Sci-Fi Master Dossier inside `ConsoleModalHost`.
 *
 * @param state Live immutable game state.
 * @returns Preact modal tree.
 */
export function renderClassicSheetPreact(state: GameState): ComponentChildren {
  return <ClassicSheetModal state={state} />;
}

/**
 * Canonical Classic / Sci-Fi Cartridge UI Definition.
 */
export const classicUIDefinition: CartridgeUIDefinition = {
  rulesetId: 'classic',
  defaultThemeMode: sciFiAdapter.defaultThemeMode,

  commands: [
    {
      id: 'classic:sheet',
      label: 'Profile',
      description: 'Open or close the character dossier.',
      category: 'cartridge',
      scopes: ['world_gameplay', 'active_modal'],
      defaultBindings: [{ key: 'c' }],
      preventDefault: true,
      source: 'cartridge:classic'
    },
    {
      id: 'classic:inventory',
      label: 'Pack',
      description: 'Open or close inventory and equipped gear.',
      category: 'cartridge',
      scopes: ['world_gameplay', 'active_modal'],
      defaultBindings: [{ key: 'i' }],
      preventDefault: true,
      source: 'cartridge:classic'
    }
  ],

  helpSections: [
    {
      id: 'classic_combat_and_energy',
      title: 'Tactical Turn & Energy Economy',
      icon: '⚔️',
      entries: [
        {
          title: 'Melee & Ranged Engagement',
          summary:
            'Move into an adjacent hostile to strike in melee, or press R to aim ranged weapons and Enter/F to fire.'
        },
        {
          title: 'Context Verbs & RTwP',
          summary:
            'Press V for context interactions on adjacent tiles, or Backspace to toggle Turn-Based vs Real-Time with Pause.'
        }
      ]
    },
    {
      id: 'classic_equipment_and_quickbelt',
      title: 'Anatomical Paperdoll & Quick-Belt',
      icon: '🎒',
      entries: [
        {
          title: 'Character Sheet & Gear',
          summary:
            'Press C or I to open your Character Sheet, equip items across body slots, and inspect stats with ? or Alt+I.'
        },
        {
          title: 'Multi-Bank Hotbar',
          summary: 'Trigger slots 1–0 on the active hotbar bank and cycle banks 1–10 with [ and ] or Shift+Up/Down.'
        }
      ]
    }
  ],

  dockCommands: [
    {
      id: 'classic_sheet',
      commandId: 'classic:sheet',
      label: 'Profile',
      icon: '👤',
      modalId: 'character_sheet',
      defaultKey: 'c'
    },
    {
      id: 'classic_inventory',
      commandId: 'classic:inventory',
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
      allowEscapeClose: true,
      handlesInventoryHotkeys: true,
      renderPreact: renderClassicSheetPreact
    },
    inventory: {
      modalId: 'inventory',
      allowEscapeClose: true,
      handlesInventoryHotkeys: true,
      renderPreact: renderClassicSheetPreact
    }
  }
};

/**
 * Registers the Classic Cartridge UI definition into the Console Cartridge Registry.
 */
export function registerClassicUIAdapter(): void {
  registerCartridgeUI(classicUIDefinition);
}
