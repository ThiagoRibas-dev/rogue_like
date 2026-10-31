import type { EntityId } from '../../types/game-state.types.ts';
import { isAction, type ActionType } from '../settings.ts';
import { getGameState, queuePlayerIntent } from '../game-loop.ts';
import {
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
import type { Intent } from '../../types/intents/intent.union.ts';
import { triggerQuickBeltSlot } from '../../rendering/ui/hud_paperdoll.ui.ts';
import { toggleAllHudPanelsFolded } from './mouse_input.ts';

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

  // Quick-belt slots [1]-[5] (when not using numpad movement 2/4/6/8)
  if (event.key === '1' || event.key === '3' || event.key === '5') {
    if (triggerQuickBeltSlot(getGameState(), playerEntityId, Number(event.key) - 1)) {
      event.preventDefault();
      return true;
    }
  }

  const binding = SHORTCUT_BINDINGS.find((candidate) => isAction(event, candidate.action));
  if (binding === undefined) return false;

  event.preventDefault();
  queuePlayerIntent(binding.buildIntent(playerEntityId));
  return true;
}
