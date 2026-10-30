import { type GameState, type EntityId, UIMode, EngineMode } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from './ecs.ts';
import { isAction, type ActionType, rebindAction } from './settings.ts';
import { queuePlayerIntent, setGameState } from './game-loop.ts';
import { getIsPlayingReplay } from './replay.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { getDirectionDelta, Direction } from '../utils/direction.ts';
import { renderSettingsMenu } from '../rendering/ui.ts';
import { getValidVerbsForTarget, getVerbOptionsForTarget } from '../systems/apply.system.ts';
import type { ApplyIntentTarget } from '../types/intents/interaction.intents.ts';
import { isModalUIMode, handleModalKey } from './input/modal_input.ts';
import { handleGameShortcutKey } from './input/shortcut_input.ts';

import { createMoveAction, createWaitAction, createTogglePauseAction } from '../actions/core.actions.ts';
import { createApplyAction } from '../actions/interaction.actions.ts';
import {
  createToggleTargetingAction,
  createMoveTargetAction,
  createFireAimedAction
} from '../actions/targeting.actions.ts';
import { createToggleInspectAction, createMoveInspectAction } from '../actions/inspect.actions.ts';

/** Minimum milliseconds between accepted movement/wait inputs in turn-based mode. */
const MOVE_THROTTLE_MS = 200;

let lastMoveTime = 0;

/**
 * Opens the contextual verb menu for a target, or executes the sole valid verb directly.
 *
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId.
 * @param target The interaction target.
 * @param toolEntityId Optional tool entity in hand.
 */
function handleSmartInteraction(
  state: GameState,
  playerEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): void {
  const validVerbs = getValidVerbsForTarget(state, playerEntityId, target, toolEntityId);

  if (validVerbs.length === 0) {
    setGameState(addMessage(state, `Nothing interesting to interact with there.`, MessageLogCategory.System));
    return;
  }

  const soleVerb = validVerbs[0];
  if (validVerbs.length === 1 && soleVerb !== undefined) {
    queuePlayerIntent(createApplyAction(playerEntityId, soleVerb, target, toolEntityId));
    return;
  }

  // All verbs are carried so the view can illuminate which ones actually apply.
  const verbOptions = getVerbOptionsForTarget(state, playerEntityId, target, toolEntityId);

  setGameState({
    ...state,
    uiMode: UIMode.VerbMenu,
    verbMenu:
      toolEntityId !== undefined
        ? { target, toolEntityId, availableVerbs: validVerbs, verbOptions }
        : { target, availableVerbs: validVerbs, verbOptions }
  });
}

/**
 * Interacts with whatever occupies the player's tile or a targeting/inspect cursor tile.
 *
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId.
 * @param tileX The target tile X coordinate.
 * @param tileY The target tile Y coordinate.
 */
function interactWithTile(state: GameState, playerEntityId: EntityId, tileX: number, tileY: number): void {
  const entitiesOnTile = state.spatialIndex.get(`${tileX},${tileY}`) ?? [];
  const interactableEntity = entitiesOnTile.find((id) => id !== playerEntityId);

  if (interactableEntity !== undefined) {
    handleSmartInteraction(state, playerEntityId, { type: 'entity', entityId: interactableEntity });
    return;
  }

  handleSmartInteraction(state, playerEntityId, { type: 'tile', x: tileX, y: tileY });
}

/**
 * Entry point for keyboard input processing in the game, routing keystrokes based on the active UI mode.
 *
 * @param event The originating KeyboardEvent.
 * @param currentState The current GameState.
 * @param rebindingAction The action currently being rebound, if any.
 * @param setRebindingAction Setter used to clear the rebinding overlay.
 */
export function handleKeyDown(
  event: KeyboardEvent,
  currentState: GameState,
  rebindingAction: ActionType | null,
  setRebindingAction: (action: ActionType | null) => void
): void {
  if (getIsPlayingReplay()) {
    event.preventDefault();
    return;
  }

  const rebindingOverlay = document.getElementById('rebinding-overlay');

  if (rebindingAction) {
    event.preventDefault();
    if (event.key === 'Escape') {
      setRebindingAction(null);
      rebindingOverlay?.classList.add('hidden');
      return;
    }
    // Only bind single characters, arrows, space, enter, etc. Ignore modifiers alone.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;

    rebindAction(rebindingAction, event.key);
    setRebindingAction(null);
    rebindingOverlay?.classList.add('hidden');
    renderSettingsMenu(currentState);
    return;
  }

  if (
    currentState.uiMode === UIMode.MainMenu ||
    currentState.uiMode === UIMode.GameOver ||
    currentState.uiMode === UIMode.CampaignSelect ||
    currentState.uiMode === UIMode.Editor
  ) {
    return; // Menu buttons and editor forms handle their own input
  }

  const playerEntityId = currentState.entities.find((id) => getComponent(currentState, id, ComponentType.Player));
  if (playerEntityId === undefined) return;

  // Modal overlays capture all input, including the global shortcuts below.
  if (isModalUIMode(currentState.uiMode)) {
    handleModalKey(event, currentState, playerEntityId);
    return;
  }

  if (handleGameShortcutKey(event, playerEntityId)) return;

  const isTargeting = currentState.targetingMode?.active === true;
  const targeting = currentState.targetingMode;

  if (isAction(event, 'target_toggle')) {
    event.preventDefault();
    queuePlayerIntent(createToggleTargetingAction(playerEntityId));
    return;
  }

  if (isTargeting && targeting !== undefined && isAction(event, 'target_confirm')) {
    event.preventDefault();
    const context = targeting.context;

    if (context?.verb === 'throw' && context.toolEntityId !== undefined) {
      queuePlayerIntent(
        createApplyAction(
          playerEntityId,
          'throw',
          { type: 'tile', x: targeting.x, y: targeting.y },
          context.toolEntityId
        )
      );
      queuePlayerIntent(createToggleTargetingAction(playerEntityId));
    } else {
      queuePlayerIntent(createFireAimedAction(playerEntityId));
    }
    return;
  }

  if (isTargeting && targeting !== undefined && isAction(event, 'verb_menu')) {
    event.preventDefault();
    handleSmartInteraction(currentState, playerEntityId, { type: 'tile', x: targeting.x, y: targeting.y });
    return;
  }

  if (isAction(event, 'inspect')) {
    event.preventDefault();
    queuePlayerIntent(createToggleInspectAction(playerEntityId));
    return;
  }

  let direction: Direction | undefined;
  if (isAction(event, 'move_north')) direction = Direction.North;
  else if (isAction(event, 'move_south')) direction = Direction.South;
  else if (isAction(event, 'move_east')) direction = Direction.East;
  else if (isAction(event, 'move_west')) direction = Direction.West;

  if (direction !== undefined) {
    event.preventDefault(); // Prevent standard page scroll

    // Throttle movement in turn-based mode to prevent teleporting/spam
    if (currentState.engineMode === EngineMode.TurnBased) {
      const now = performance.now();
      if (now - lastMoveTime < MOVE_THROTTLE_MS) return;
      lastMoveTime = now;
    }

    const { dx, dy } = getDirectionDelta(direction);

    if (isTargeting) {
      queuePlayerIntent(createMoveTargetAction(playerEntityId, dx, dy));
    } else if (currentState.inspectMode?.active === true) {
      queuePlayerIntent(createMoveInspectAction(playerEntityId, dx, dy));
    } else {
      queuePlayerIntent(createMoveAction(playerEntityId, dx, dy));
    }
    return;
  }

  if (isAction(event, 'wait')) {
    event.preventDefault();
    if (currentState.engineMode === EngineMode.RTwP) {
      queuePlayerIntent(createTogglePauseAction(playerEntityId));
      return;
    }

    // Throttle waiting in turn-based mode
    const now = performance.now();
    if (now - lastMoveTime < MOVE_THROTTLE_MS) return;
    lastMoveTime = now;

    queuePlayerIntent(createWaitAction(playerEntityId));
    return;
  }

  if (isAction(event, 'interact')) {
    event.preventDefault();

    if (isTargeting && targeting !== undefined) {
      interactWithTile(currentState, playerEntityId, targeting.x, targeting.y);
      return;
    }

    const inspectMode = currentState.inspectMode;
    if (inspectMode?.active === true) {
      interactWithTile(currentState, playerEntityId, inspectMode.x, inspectMode.y);
      return;
    }

    const position = getComponent(currentState, playerEntityId, ComponentType.Position);
    if (position === undefined) return;
    interactWithTile(currentState, playerEntityId, position.x, position.y);
    return;
  }

  if (isAction(event, 'verb_menu')) {
    event.preventDefault();
    const position = getComponent(currentState, playerEntityId, ComponentType.Position);
    if (position === undefined) return;
    interactWithTile(currentState, playerEntityId, position.x, position.y);
  }
}
