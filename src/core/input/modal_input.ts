import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import { isAction, type ActionType } from '../settings.ts';
import { queuePlayerIntent, setGameState } from '../game-loop.ts';
import { createApplyAction } from '../../actions/interaction.actions.ts';
import {
  createToggleDebugAction,
  createToggleDossierAction,
  createToggleFactionsAction,
  createToggleInvestigationAction,
  createToggleLedgerAction,
  createToggleQuestsAction,
  createToggleSettingsAction
} from '../../actions/core.actions.ts';
import type { Intent } from '../../types/intents/intent.union.ts';
import { handleInventoryKey } from './inventory_input.ts';

/**
 * Declarative binding for a modal overlay: the intent that toggles it open/closed
 * and the optional in-game shortcut key that also closes it.
 */
interface ModalBinding {
  readonly mode: UIMode;
  readonly buildToggleIntent: (playerEntityId: EntityId) => Intent;
  readonly shortcut?: ActionType;
}

/**
 * All modal overlays that intercept input while open.
 *
 * `Inventory` and `VerbMenu` are deliberately absent: both have bespoke key
 * semantics and are handled by dedicated branches below.
 */
const MODAL_BINDINGS: ReadonlyArray<ModalBinding> = [
  { mode: UIMode.Debug, buildToggleIntent: createToggleDebugAction },
  { mode: UIMode.Settings, buildToggleIntent: createToggleSettingsAction },
  { mode: UIMode.Factions, buildToggleIntent: createToggleFactionsAction, shortcut: 'factions' },
  { mode: UIMode.Quests, buildToggleIntent: createToggleQuestsAction, shortcut: 'quests' },
  { mode: UIMode.Investigation, buildToggleIntent: createToggleInvestigationAction, shortcut: 'investigation' },
  { mode: UIMode.Dossier, buildToggleIntent: createToggleDossierAction, shortcut: 'dossier' },
  { mode: UIMode.Ledger, buildToggleIntent: createToggleLedgerAction, shortcut: 'ledger' }
];

/**
 * Reports whether a UI mode is a modal overlay that captures all keyboard input.
 *
 * @param mode The UIMode to test.
 * @returns True when the mode is a modal overlay.
 */
export function isModalUIMode(mode: UIMode): boolean {
  if (mode === UIMode.Inventory || mode === UIMode.VerbMenu) return true;
  return MODAL_BINDINGS.some((binding) => binding.mode === mode);
}

/**
 * Handles a keypress while a modal overlay is open. Modal overlays consume all
 * input, so the caller must not process anything else for this event.
 *
 * @param event The originating KeyboardEvent.
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId.
 */
export function handleModalKey(event: KeyboardEvent, state: GameState, playerEntityId: EntityId): void {
  if (state.uiMode === UIMode.VerbMenu) {
    handleVerbMenuKey(event, state, playerEntityId);
    return;
  }

  if (state.uiMode === UIMode.Inventory) {
    handleInventoryKey(event, state, playerEntityId);
    return;
  }

  const binding = MODAL_BINDINGS.find((candidate) => candidate.mode === state.uiMode);
  if (binding === undefined) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    queuePlayerIntent(binding.buildToggleIntent(playerEntityId));
    return;
  }

  // Another modal's shortcut opens it on top of the current one, enabling true
  // LIFO nesting (e.g. Dossier opened from the Investigation board).
  const nestedBinding = MODAL_BINDINGS.find(
    (candidate) => candidate.shortcut !== undefined && isAction(event, candidate.shortcut)
  );
  if (nestedBinding === undefined) return;

  event.preventDefault();
  queuePlayerIntent(nestedBinding.buildToggleIntent(playerEntityId));
}

/**
 * Handles the contextual verb menu: numeric selection, Enter for the first verb, Escape to cancel.
 *
 * @param event The originating KeyboardEvent.
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId.
 */
function handleVerbMenuKey(event: KeyboardEvent, state: GameState, playerEntityId: EntityId): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    // Targeting mode intentionally survives cancellation.
    setGameState({ ...state, uiMode: UIMode.Game, verbMenu: undefined });
    return;
  }

  const menu = state.verbMenu;
  if (menu === undefined) return;

  const { availableVerbs, target, toolEntityId } = menu;

  const numericSelection = parseInt(event.key, 10);
  if (!isNaN(numericSelection) && numericSelection > 0 && numericSelection <= availableVerbs.length) {
    const verb = availableVerbs[numericSelection - 1];
    if (verb !== undefined) {
      event.preventDefault();
      queuePlayerIntent(createApplyAction(playerEntityId, verb, target, toolEntityId));
      setGameState({ ...state, uiMode: UIMode.Game, verbMenu: undefined });
      return;
    }
  }

  if (event.key !== 'Enter' || availableVerbs.length === 0) return;

  const firstVerb = availableVerbs[0];
  if (firstVerb === undefined) return;

  event.preventDefault();
  queuePlayerIntent(createApplyAction(playerEntityId, firstVerb, target, toolEntityId));
  setGameState({ ...state, uiMode: UIMode.Game, verbMenu: undefined });
}
