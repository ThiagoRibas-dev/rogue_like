import { createMoveAction, createTogglePauseAction, createWaitAction } from '../../actions/core.actions.ts';
import { createMoveInspectAction, createToggleInspectAction } from '../../actions/inspect.actions.ts';
import { createApplyAction } from '../../actions/interaction.actions.ts';
import {
  createFireAimedAction,
  createMoveTargetAction,
  createToggleTargetingAction
} from '../../actions/targeting.actions.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { getValidVerbsForTarget, getVerbOptionsForTarget } from '../../systems/apply.system.ts';
import { ComponentType, type FighterComponent, type PositionComponent } from '../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import type { ApplyIntentTarget } from '../../types/intents/interaction.intents.ts';
import { Direction, getDirectionDelta } from '../../utils/direction.ts';
import { isHostile } from '../../utils/faction.ts';
import { getComponent } from '../ecs.ts';
import { queuePlayerIntent, setGameState } from '../game-loop.ts';
import { getCommandBindings } from '../settings.ts';
import { commandRegistry, matchesChord } from './command_registry.ts';
import { handleGameShortcutKey } from './shortcut_input.ts';

/** Minimum milliseconds between accepted movement/wait inputs in turn-based mode. */
const MOVE_THROTTLE_MS = 200;

let lastMoveTime = 0;

/** Resets the turn-based movement throttle timer (used by unit tests). */
export function resetMoveThrottle(): void {
  lastMoveTime = 0;
}

/**
 * Opens the contextual verb menu for a target, or executes the sole valid verb directly.
 */
function handleSmartInteraction(
  state: GameState,
  playerEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): void {
  const validVerbs = getValidVerbsForTarget(state, playerEntityId, target, toolEntityId);

  if (validVerbs.length === 0) {
    setGameState(addMessage(state, 'Nothing interesting to interact with there.', MessageLogCategory.System));
    return;
  }

  const soleVerb = validVerbs[0];
  if (validVerbs.length === 1 && soleVerb !== undefined) {
    queuePlayerIntent(createApplyAction(playerEntityId, soleVerb, target, toolEntityId));
    return;
  }

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

function interactWithTile(state: GameState, playerEntityId: EntityId, tileX: number, tileY: number): void {
  const entitiesOnTile = state.spatialIndex.get(`${tileX},${tileY}`) ?? [];
  const interactableEntity = entitiesOnTile.find((id) => id !== playerEntityId);

  if (interactableEntity !== undefined) {
    handleSmartInteraction(state, playerEntityId, { type: 'entity', entityId: interactableEntity });
    return;
  }

  handleSmartInteraction(state, playerEntityId, { type: 'tile', x: tileX, y: tileY });
}

function isCommandMatched(event: KeyboardEvent, commandId: string): boolean {
  const overrides = getCommandBindings();
  return commandRegistry.getEffectiveBindings(commandId, overrides).some((chord) => matchesChord(event, chord));
}

function cycleVisibleTarget(state: GameState, playerEntityId: EntityId, delta: number): boolean {
  const targeting = state.targetingMode;
  if (!targeting?.active) return false;

  const candidates: Array<{ readonly id: EntityId; readonly x: number; readonly y: number }> = [];
  for (const id of state.entities) {
    if (id === playerEntityId) continue;
    const fighter = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
    const pos = getComponent(state, id, ComponentType.Position) as PositionComponent | undefined;
    if (!fighter || fighter.hp <= 0 || !pos) continue;
    if (!isHostile(state, playerEntityId, id)) continue;
    const tileIdx = pos.y * state.map.width + pos.x;
    if (!state.cachedFov.has(tileIdx) && !state.map.isFullyExplored) continue;
    candidates.push({ id, x: pos.x, y: pos.y });
  }

  if (candidates.length === 0) return false;
  candidates.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

  const currentIdx = candidates.findIndex((c) => c.x === targeting.x && c.y === targeting.y);
  const nextIdx =
    currentIdx >= 0
      ? (((currentIdx + delta) % candidates.length) + candidates.length) % candidates.length
      : delta >= 0
        ? 0
        : candidates.length - 1;
  const chosen = candidates[nextIdx];
  if (!chosen) return false;

  queuePlayerIntent(createMoveTargetAction(playerEntityId, chosen.x - targeting.x, chosen.y - targeting.y));
  return true;
}

function resolveMoveDirection(event: KeyboardEvent): Direction | undefined {
  if (isCommandMatched(event, 'move.north')) return Direction.North;
  if (isCommandMatched(event, 'move.south')) return Direction.South;
  if (isCommandMatched(event, 'move.east')) return Direction.East;
  if (isCommandMatched(event, 'move.west')) return Direction.West;
  if (isCommandMatched(event, 'move.nw')) return Direction.NorthWest;
  if (isCommandMatched(event, 'move.ne')) return Direction.NorthEast;
  if (isCommandMatched(event, 'move.sw')) return Direction.SouthWest;
  if (isCommandMatched(event, 'move.se')) return Direction.SouthEast;
  return undefined;
}

/**
 * Handles world exploration, targeting reticle, and look/inspect keyboard commands.
 *
 * @returns True if the event was matched and handled.
 */
export function handleGameplayOrTargetingKey(
  event: KeyboardEvent,
  currentState: GameState,
  playerEntityId: EntityId
): boolean {
  if (handleGameShortcutKey(event, playerEntityId)) return true;

  const isTargeting = currentState.targetingMode?.active === true;
  const targeting = currentState.targetingMode;

  if (isTargeting && isCommandMatched(event, 'combat.target_prev')) {
    event.preventDefault();
    cycleVisibleTarget(currentState, playerEntityId, -1);
    return true;
  }

  if (isTargeting && isCommandMatched(event, 'combat.target_next')) {
    event.preventDefault();
    cycleVisibleTarget(currentState, playerEntityId, 1);
    return true;
  }

  if (isCommandMatched(event, 'combat.target_toggle')) {
    event.preventDefault();
    queuePlayerIntent(createToggleTargetingAction(playerEntityId));
    return true;
  }

  if (isTargeting && targeting !== undefined && isCommandMatched(event, 'combat.target_confirm')) {
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
    return true;
  }

  if (isTargeting && targeting !== undefined && isCommandMatched(event, 'action.verb_menu')) {
    event.preventDefault();
    handleSmartInteraction(currentState, playerEntityId, { type: 'tile', x: targeting.x, y: targeting.y });
    return true;
  }

  if (isCommandMatched(event, 'action.inspect')) {
    event.preventDefault();
    queuePlayerIntent(createToggleInspectAction(playerEntityId));
    return true;
  }

  const direction = resolveMoveDirection(event);
  if (direction !== undefined) {
    event.preventDefault();

    if (currentState.engineMode === EngineMode.TurnBased) {
      const now = performance.now();
      if (now - lastMoveTime < MOVE_THROTTLE_MS) return true;
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
    return true;
  }

  if (isCommandMatched(event, 'action.wait')) {
    event.preventDefault();
    if (currentState.engineMode === EngineMode.RTwP) {
      queuePlayerIntent(createTogglePauseAction(playerEntityId));
      return true;
    }

    const now = performance.now();
    if (now - lastMoveTime < MOVE_THROTTLE_MS) return true;
    lastMoveTime = now;

    queuePlayerIntent(createWaitAction(playerEntityId));
    return true;
  }

  if (isCommandMatched(event, 'action.interact')) {
    event.preventDefault();
    if (isTargeting && targeting !== undefined) {
      interactWithTile(currentState, playerEntityId, targeting.x, targeting.y);
      return true;
    }
    const inspectMode = currentState.inspectMode;
    if (inspectMode?.active === true) {
      interactWithTile(currentState, playerEntityId, inspectMode.x, inspectMode.y);
      return true;
    }
    const position = getComponent(currentState, playerEntityId, ComponentType.Position);
    if (position === undefined) return false;
    interactWithTile(currentState, playerEntityId, position.x, position.y);
    return true;
  }

  if (isCommandMatched(event, 'action.verb_menu')) {
    event.preventDefault();
    const position = getComponent(currentState, playerEntityId, ComponentType.Position);
    if (position === undefined) return false;
    interactWithTile(currentState, playerEntityId, position.x, position.y);
    return true;
  }

  return false;
}
