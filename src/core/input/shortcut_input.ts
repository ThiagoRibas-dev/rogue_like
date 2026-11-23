import {
  createToggleCartridgeModalAction,
  createToggleDebugAction,
  createToggleDossierAction,
  createToggleFactionsAction,
  createToggleInvestigationAction,
  createToggleLedgerAction,
  createToggleQuestsAction
} from '../../actions/core.actions.ts';
import {
  createDebugGodModeAction,
  createDebugRevealMapAction,
  createDebugSpawnEntityAction
} from '../../actions/debug.actions.ts';
import { createPickUpAction, createToggleInventoryAction } from '../../actions/inventory.actions.ts';
import { getActiveCartridgeUI } from '../../rendering/ui/cartridge_ui_registry.ts';
import { cycleHotbarBank, executeHotbarSlotByKey } from '../../rendering/ui/hud_bottom_dock.ui.ts';
import type { EntityId } from '../../types/game-state.types.ts';
import type { Intent } from '../../types/intents/intent.union.ts';
import { getGameState, queuePlayerIntent } from '../game-loop.ts';
import { getCommandBindings, isAction, type ActionType } from '../settings.ts';
import { commandRegistry, matchesChord } from './command_registry.ts';
import { toggleAllHudPanelsFolded } from './mouse_input.ts';

/**
 * Resolves a keyboard event to a 0-based hotbar slot index (0..11) from top-row keys,
 * strictly distinguishing top-row digits from numpad digits.
 */
function resolveTopRowHotbarSlotIndex(event: KeyboardEvent): number | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;

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

  if (!event.code?.startsWith('Numpad')) {
    if (event.key >= '1' && event.key <= '9') {
      return Number(event.key) - 1;
    }
    if (event.key === '0') return 9;
    if (event.key === '-') return 10;
    if (event.key === '=') return 11;
  }

  return null;
}

interface ShortcutBinding {
  readonly commandId: string;
  readonly legacyAction?: ActionType;
  readonly buildIntent: (playerEntityId: EntityId) => Intent;
}

const SHORTCUT_BINDINGS: ReadonlyArray<ShortcutBinding> = [
  { commandId: 'debug.reveal_map', legacyAction: 'debug_reveal_map', buildIntent: createDebugRevealMapAction },
  { commandId: 'debug.god_mode', legacyAction: 'debug_god_mode', buildIntent: createDebugGodModeAction },
  { commandId: 'debug.spawn_entity', legacyAction: 'debug_spawn_entity', buildIntent: createDebugSpawnEntityAction },
  { commandId: 'action.pick_up', legacyAction: 'pick_up', buildIntent: createPickUpAction },
  { commandId: 'panel.inventory', legacyAction: 'inventory', buildIntent: createToggleInventoryAction },
  { commandId: 'panel.factions', legacyAction: 'factions', buildIntent: createToggleFactionsAction },
  { commandId: 'panel.quests', legacyAction: 'quests', buildIntent: createToggleQuestsAction },
  { commandId: 'panel.investigation', legacyAction: 'investigation', buildIntent: createToggleInvestigationAction },
  { commandId: 'panel.dossier', legacyAction: 'dossier', buildIntent: createToggleDossierAction },
  { commandId: 'panel.ledger', legacyAction: 'ledger', buildIntent: createToggleLedgerAction },
  { commandId: 'panel.debug', buildIntent: createToggleDebugAction }
];

function isCommandMatch(event: KeyboardEvent, commandId: string): boolean {
  const overrides = getCommandBindings();
  const chords = commandRegistry.getEffectiveBindings(commandId, overrides);
  return chords.some((c) => matchesChord(event, c));
}

/**
 * Dispatches a game-mode global shortcut key, if one matches.
 *
 * @param event The originating KeyboardEvent.
 * @param playerEntityId The player's EntityId.
 * @returns True when a shortcut consumed the event.
 */
export function handleGameShortcutKey(event: KeyboardEvent, playerEntityId: EntityId): boolean {
  if (isCommandMatch(event, 'hud.toggle_fold_all')) {
    event.preventDefault();
    toggleAllHudPanelsFolded();
    return true;
  }

  if (isCommandMatch(event, 'hotbar.bank_prev')) {
    event.preventDefault();
    cycleHotbarBank(-1);
    return true;
  }

  if (isCommandMatch(event, 'hotbar.bank_next')) {
    event.preventDefault();
    cycleHotbarBank(1);
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

  const binding = SHORTCUT_BINDINGS.find((candidate) =>
    candidate.legacyAction ? isAction(event, candidate.legacyAction) : isCommandMatch(event, candidate.commandId)
  );
  if (binding !== undefined) {
    event.preventDefault();
    queuePlayerIntent(binding.buildIntent(playerEntityId));
    return true;
  }

  const state = getGameState();
  const cartridgeUI = getActiveCartridgeUI(state);
  const overrides = getCommandBindings();
  if (cartridgeUI?.dockCommands) {
    for (const cmd of cartridgeUI.dockCommands) {
      const cmdId = cmd.commandId ?? cmd.id;
      const registeredChords = commandRegistry.getEffectiveBindings(cmdId, overrides);
      const isMatch =
        registeredChords.length > 0
          ? registeredChords.some((chord) => matchesChord(event, chord))
          : event.key.toLowerCase() === cmd.defaultKey.toLowerCase();

      if (isMatch) {
        if (cmd.isAvailable && !cmd.isAvailable(state, playerEntityId)) {
          continue;
        }
        event.preventDefault();
        if (cmd.onTrigger) {
          cmd.onTrigger(state, playerEntityId);
        } else if (cmd.modalId !== undefined) {
          queuePlayerIntent(createToggleCartridgeModalAction(playerEntityId, cmd.modalId));
        }
        return true;
      }
    }
  }

  return false;
}
