import type { EntityId } from '../../types/game-state.types.ts';
import { isAction, type ActionType } from '../settings.ts';
import { getGameState, queuePlayerIntent } from '../game-loop.ts';
import {
  createToggleCartridgeModalAction,
  createToggleDebugAction,
  createToggleDossierAction,
  createToggleFactionsAction,
  createToggleInvestigationAction,
  createToggleLedgerAction,
  createToggleQuestsAction
} from '../../actions/core.actions.ts';
import { getActiveCartridgeUI } from '../../rendering/ui/cartridge_ui_registry.ts';
import {
  createDebugGodModeAction,
  createDebugRevealMapAction,
  createDebugSpawnEntityAction
} from '../../actions/debug.actions.ts';
import { createPickUpAction, createToggleInventoryAction } from '../../actions/inventory.actions.ts';
import type { Intent } from '../../types/intents/intent.union.ts';
import { executeHotbarSlotByKey } from '../../rendering/ui/hud_bottom_dock.ui.ts';
import { toggleAllHudPanelsFolded } from './mouse_input.ts';

/**
 * Resolves a keyboard event to a 0-based hotbar slot index (0..11) from top-row keys,
 * strictly distinguishing top-row digits from numpad digits.
 */
function resolveTopRowHotbarSlotIndex(event: KeyboardEvent): number | null {
  // If user is holding Ctrl, Alt, or Meta, do not intercept as hotbar activation
  if (event.ctrlKey || event.altKey || event.metaKey) return null;

  // Prefer event.code for unequivocal physical top-row key discrimination
  switch (event.code) {
    case 'Digit1':
      return 0;
    case 'Digit2':
      return 1;
    case 'Digit3':
      return 2;
    case 'Digit4':
      return 3;
    case 'Digit5':
      return 4;
    case 'Digit6':
      return 5;
    case 'Digit7':
      return 6;
    case 'Digit8':
      return 7;
    case 'Digit9':
      return 8;
    case 'Digit0':
      return 9;
    case 'Minus':
      return 10;
    case 'Equal':
      return 11;
  }

  // Fallback for non-numpad key events
  if (!event.code.startsWith('Numpad')) {
    if (event.key >= '1' && event.key <= '9') {
      return Number(event.key) - 1;
    }
    if (event.key === '0') return 9;
    if (event.key === '-') return 10;
    if (event.key === '=') return 11;
  }

  return null;
}

/** Keyboard key that always toggles the debug overlay while in game mode. */
const DEBUG_OVERLAY_KEY = '`';

/**
 * A game-mode keyboard shortcut bound to an intent factory.
 */
interface ShortcutBinding {
  readonly action: ActionType;
  readonly buildIntent: (playerEntityId: EntityId) => Intent;
}

/**
 * Global game-mode shortcuts dispatched before movement and interaction handling.
 * Ordered so that debug actions resolve before overlapping player actions.
 */
const SHORTCUT_BINDINGS: ReadonlyArray<ShortcutBinding> = [
  { action: 'debug_reveal_map', buildIntent: createDebugRevealMapAction },
  { action: 'debug_god_mode', buildIntent: createDebugGodModeAction },
  { action: 'debug_spawn_entity', buildIntent: createDebugSpawnEntityAction },
  { action: 'pick_up', buildIntent: createPickUpAction },
  { action: 'inventory', buildIntent: createToggleInventoryAction },
  { action: 'factions', buildIntent: createToggleFactionsAction },
  { action: 'quests', buildIntent: createToggleQuestsAction },
  { action: 'investigation', buildIntent: createToggleInvestigationAction },
  { action: 'dossier', buildIntent: createToggleDossierAction },
  { action: 'ledger', buildIntent: createToggleLedgerAction }
];

/**
 * Dispatches a game-mode global shortcut key, if one matches.
 *
 * @param event The originating KeyboardEvent.
 * @param playerEntityId The player's EntityId.
 * @returns True when a shortcut consumed the event.
 */
export function handleGameShortcutKey(event: KeyboardEvent, playerEntityId: EntityId): boolean {
  if (event.key === DEBUG_OVERLAY_KEY) {
    event.preventDefault();
    queuePlayerIntent(createToggleDebugAction(playerEntityId));
    return true;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    toggleAllHudPanelsFolded();
    return true;
  }

  // Hotbar slots [1]-[9], [0], [-], [=] (slots 0..11) from top-row keys
  const hotbarIndex = resolveTopRowHotbarSlotIndex(event);
  if (hotbarIndex !== null) {
    if (executeHotbarSlotByKey(getGameState(), playerEntityId, hotbarIndex)) {
      event.preventDefault();
      return true;
    }
  }

  const binding = SHORTCUT_BINDINGS.find((candidate) => isAction(event, candidate.action));
  if (binding !== undefined) {
    event.preventDefault();
    queuePlayerIntent(binding.buildIntent(playerEntityId));
    return true;
  }

  const state = getGameState();
  const cartridgeUI = getActiveCartridgeUI(state);
  if (cartridgeUI?.dockCommands) {
    for (const cmd of cartridgeUI.dockCommands) {
      const isMatch = isAction(event, cmd.id as ActionType) || event.key.toLowerCase() === cmd.defaultKey.toLowerCase();
      if (isMatch) {
        if (cmd.isAvailable && !cmd.isAvailable(state, playerEntityId)) {
          continue;
        }
        event.preventDefault();
        queuePlayerIntent(createToggleCartridgeModalAction(playerEntityId, cmd.modalId));
        return true;
      }
    }
  }

  return false;
}
