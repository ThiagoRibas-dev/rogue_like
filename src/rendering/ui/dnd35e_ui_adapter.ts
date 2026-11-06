/**
 * @file D&D 3.5e Ruleset UI Adapter (Phase 26 / Milestone 118).
 * Bridges headless D&D 3.5e systems with the Console Slot/Modal Host API.
 */

import { openModal } from '../../core/modal_manager.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import { setGameState, getGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { type CartridgeUIDefinition, closeCartridgeModal, registerCartridgeUI } from './cartridge_ui_registry.ts';
import { renderDnD35eCharBuilderModal, resetDnD35eCharBuilderDraft } from './dnd35e_char_builder.ui.ts';
import { canPlayerLevelUpDnD35e, renderDnD35eLevelUpModal } from './dnd35e_level_up.ui.ts';

import { renderDnD35eSheetModal as renderSheetModalImpl } from './dnd35e_sheet.ui.ts';

let closeListenersBound = false;

function bindModalCloseButtons(): void {
  if (closeListenersBound) return;
  closeListenersBound = true;
  document.getElementById('btn-close-dnd35e-sheet')?.addEventListener('click', () => {
    setGameState(closeCartridgeModal(getGameState()));
    markAllDomainsDirty();
  });
  document.getElementById('btn-close-dnd35e-spellbook')?.addEventListener('click', () => {
    setGameState(closeCartridgeModal(getGameState()));
    markAllDomainsDirty();
  });
}

/**
 * Renders the D&D 3.5e Character Sheet modal (Milestone 118).
 */
export function renderDnD35eSheetModal(state: GameState): void {
  bindModalCloseButtons();
  const overlay = document.getElementById('dnd35e-sheet-overlay');
  if (!overlay) return;
  if (state.uiMode !== UIMode.CartridgeModal || state.activeCartridgeModalId !== 'character_sheet') {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  renderSheetModalImpl(state);
}

import { renderDnD35eSpellbookModal as renderSpellbookModalImpl } from './dnd35e_spellbook.ui.ts';

/**
 * Renders the D&D 3.5e Vancian Spellbook modal (Milestone 118).
 */
export function renderDnD35eSpellbookModal(state: GameState): void {
  bindModalCloseButtons();
  const overlay = document.getElementById('dnd35e-spellbook-overlay');
  if (!overlay) return;
  if (state.uiMode !== UIMode.CartridgeModal || state.activeCartridgeModalId !== 'spellbook') {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  renderSpellbookModalImpl(state);
}

import { renderDnD35eDoctrineBar } from './dnd35e_doctrine_bar.ui.ts';

/**
 * Canonical D&D 3.5e Cartridge UI Definition.
 */
export const dnd35eUIDefinition: CartridgeUIDefinition = {
  rulesetId: 'dnd35e',

  onStartNewGame(state: GameState): GameState {
    resetDnD35eCharBuilderDraft(state);
    return openModal(state, UIMode.CartridgeModal, 'char_creation');
  },

  dockCommands: [
    {
      id: 'dnd35e_sheet',
      label: 'Sheet',
      icon: '📜',
      modalId: 'character_sheet',
      defaultKey: 'c'
    },
    {
      id: 'dnd35e_spellbook',
      label: 'Spells',
      icon: '✨',
      modalId: 'spellbook',
      defaultKey: 'b'
    },
    {
      id: 'dnd35e_level_up',
      label: 'Level Up',
      icon: '⭐',
      modalId: 'level_up',
      defaultKey: 'u',
      isAvailable: (state: GameState, playerId: EntityId): boolean => canPlayerLevelUpDnD35e(state, playerId)
    }
  ],

  projectHudAlerts(state: GameState, playerId: EntityId) {
    if (canPlayerLevelUpDnD35e(state, playerId)) {
      return [
        {
          label: 'Level Up Available!',
          detail: 'Your hero has acquired enough XP to advance in level. Press [U] to open advancement.',
          severity: 'warning' as const
        }
      ];
    }
    return [];
  },

  renderHudPanel(container: HTMLElement, state: GameState, playerId: EntityId): void {
    renderDnD35eDoctrineBar(container, state, playerId);
  },

  modals: {
    char_creation: {
      modalId: 'char_creation',
      overlayElementId: 'char-creation-overlay',
      allowEscapeClose: false,
      render: renderDnD35eCharBuilderModal
    },
    level_up: {
      modalId: 'level_up',
      overlayElementId: 'level-up-overlay',
      allowEscapeClose: true,
      render: renderDnD35eLevelUpModal
    },
    character_sheet: {
      modalId: 'character_sheet',
      overlayElementId: 'dnd35e-sheet-overlay',
      allowEscapeClose: true,
      render: renderDnD35eSheetModal
    },
    spellbook: {
      modalId: 'spellbook',
      overlayElementId: 'dnd35e-spellbook-overlay',
      allowEscapeClose: true,
      render: renderDnD35eSpellbookModal
    }
  }
};

/**
 * Registers the D&D 3.5e UI Adapter into the Console Cartridge UI Registry.
 */
export function registerDnD35eUIAdapter(): void {
  registerCartridgeUI(dnd35eUIDefinition);
}
