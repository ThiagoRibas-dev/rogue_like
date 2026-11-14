import { ComponentType } from '../types/components.types.ts';
import { EngineMode, type EntityId, type GameState, UIMode } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { getComponent } from './ecs.ts';
import { recordIntent } from './replay.ts';
import { recordAISample } from './performance.ts';
import { addActor, lockEngine, setTurnDuration, unlockEngine } from './scheduler.ts';
import { enqueueIntent, dequeueIntent, hasPendingIntents, clearInputQueue } from './input_queue.ts';
import { markDirtyFromStateDiff } from './presentation_queue.ts';
import { scheduleDebouncedSave, saveCheckpoint, checkpointGameOver } from './persistence_service.ts';
import { DEFAULT_ACTOR_TURN_DURATION } from '../constants/scheduler.constants.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { processHungerTick } from '../systems/hunger.system.ts';
import { shouldSkipTurn } from '../systems/status-effect.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { processAITurn } from '../systems/ai.system.ts';
import { resolveActorActionEnergyCost, runActorTurnStart } from '../systems/lifecycle.system.ts';
import { processSchemeTurn } from '../systems/scheme.system.ts';
import { applyIntentWithCost } from './loop/intent_cost_resolver.ts';

export { applyIntentWithCost };

/** Safety cap preventing infinite synchronous AI intra-turn loops (`24`). */
const MAX_INTRA_TURN_ACTIONS = 24;

/** Fallback energy duration when an active turn concludes without a specific speed cost (`10`). */
const RTWP_IDLE_WAIT_DURATION = 10;

let currentState: GameState | null = null;
let stateChangeCallback: ((state: GameState) => void) | null = null;
let turnStartProcessedForActor: EntityId | null = null;
let intraTurnActionCount = 0;

/**
 * Sets/updates the global GameState and triggers state change listeners.
 */
export function setGameState(state: GameState): void {
  turnStartProcessedForActor = null;
  intraTurnActionCount = 0;
  updateState(state);
}

/**
 * Retrieves the current global GameState. Throws if not initialized.
 */
export function getGameState(): GameState {
  if (!currentState) throw new Error('Game state not initialized');
  return currentState;
}

/**
 * Registers a listener callback to run whenever the global GameState updates.
 */
export function onStateChange(callback: (state: GameState) => void): void {
  stateChangeCallback = callback;
}

function updateState(newState: GameState): void {
  const prevState = currentState;
  currentState = newState;

  if (prevState === null || prevState.entities !== newState.entities) {
    for (const id of newState.entities) {
      if (getComponent(newState, id, ComponentType.Actor) !== undefined) {
        addActor(id);
      }
    }
  }

  markDirtyFromStateDiff(prevState, newState);

  if (newState.isGameOver && prevState && !prevState.isGameOver) {
    checkpointGameOver(newState);
  } else if (prevState && prevState.currentAreaId !== newState.currentAreaId) {
    saveCheckpoint(newState);
  } else if (newState.uiMode === UIMode.Game) {
    const onlyVfxChanged =
      prevState !== null &&
      prevState.components === newState.components &&
      prevState.entities === newState.entities &&
      prevState.map === newState.map &&
      prevState.globalTurn === newState.globalTurn &&
      prevState.currentAreaId === newState.currentAreaId &&
      prevState.visualEffects !== newState.visualEffects;
    if (!onlyVfxChanged) {
      scheduleDebouncedSave(newState);
    }
  }

  if (stateChangeCallback) {
    stateChangeCallback(newState);
  }
}

/**
 * Queues or immediately executes a player intent.
 */
export function queuePlayerIntent(intent: Intent): void {
  const state = getGameState();
  if (state.isGameOver) return;

  recordIntent(intent);

  const isImmediate = 'isImmediate' in intent && intent.isImmediate;

  if (isImmediate) {
    const result = applyIntentWithCost(state, intent);
    updateState(result.state);
    return;
  }

  if (state.engineMode === EngineMode.RTwP && !state.rtwpState.paused) {
    clearInputQueue();
    enqueueIntent(intent);
  } else {
    enqueueIntent(intent);
  }

  if (state.engineMode === EngineMode.TurnBased) {
    unlockEngine();
  }
}

function concludeSkippedTurn(state: GameState, entityId: EntityId): GameState {
  const waitCost = resolveActorActionEnergyCost(
    state,
    { type: IntentType.Wait, entityId },
    DEFAULT_ACTOR_TURN_DURATION
  );
  return waitCost.state;
}

/**
 * Called by ROT.Engine when it is an actor's turn.
 */
export function processTurn(entityId: EntityId): void {
  let state = getGameState();
  if (state.isGameOver) {
    lockEngine();
    return;
  }

  if (turnStartProcessedForActor !== entityId) {
    turnStartProcessedForActor = entityId;
    intraTurnActionCount = 0;
    const stateAfterTurnStart = runActorTurnStart(state, entityId);
    if (stateAfterTurnStart !== state) {
      updateState(stateAfterTurnStart);
      state = stateAfterTurnStart;
    }
  }

  const fighter = getComponent(state, entityId, ComponentType.Fighter);
  if (!fighter && getComponent(state, entityId, ComponentType.Actor)) {
    turnStartProcessedForActor = null;
    intraTurnActionCount = 0;
    const settledState = concludeSkippedTurn(state, entityId);
    if (settledState !== state) {
      updateState(settledState);
    }
    setTurnDuration(DEFAULT_ACTOR_TURN_DURATION);
    if (
      getComponent(settledState, entityId, ComponentType.Player) !== undefined &&
      settledState.engineMode === EngineMode.TurnBased
    ) {
      unlockEngine();
    }
    return;
  }

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  if (shouldSkipTurn(state, entityId)) {
    turnStartProcessedForActor = null;
    intraTurnActionCount = 0;
    const settledState = concludeSkippedTurn(state, entityId);
    if (isPlayer) {
      updateState(addMessage(settledState, `You are unable to act and skip your turn!`, MessageLogCategory.System));
      setTurnDuration(DEFAULT_ACTOR_TURN_DURATION);
      if (settledState.engineMode === EngineMode.TurnBased) unlockEngine();
    } else {
      if (settledState !== state) {
        updateState(settledState);
      }
      setTurnDuration(DEFAULT_ACTOR_TURN_DURATION);
    }
    return;
  }

  if (isPlayer) {
    if (hasPendingIntents()) {
      const intent = dequeueIntent();
      if (intent) {
        try {
          const result = applyIntentWithCost(state, intent);
          let nextState = result.state;

          if (result.energyCost > 0) {
            turnStartProcessedForActor = null;
            intraTurnActionCount = 0;
            nextState = processHungerTick(nextState, entityId, result.energyCost);
            setTurnDuration(result.energyCost);
          } else {
            setTurnDuration(0);
          }

          if (nextState !== state) {
            updateState(nextState);
            saveCheckpoint(nextState);
          }
        } catch (e) {
          console.error(`Error processing player intent:`, e);
          setTurnDuration(0);
        }
      }
      return;
    }

    if (state.engineMode === EngineMode.TurnBased) {
      lockEngine();
      return;
    }

    turnStartProcessedForActor = null;
    intraTurnActionCount = 0;
    setTurnDuration(RTWP_IDLE_WAIT_DURATION);
    const nextState = processHungerTick(state, entityId, RTWP_IDLE_WAIT_DURATION);
    updateState(nextState);
    return;
  }

  if (getComponent(state, entityId, ComponentType.Scheme)) {
    turnStartProcessedForActor = null;
    intraTurnActionCount = 0;
    try {
      const nextState = processSchemeTurn(state, entityId);
      if (nextState !== state) {
        updateState(nextState);
      }

      const stats = getEffectiveStats(state, entityId);
      const speed = Math.max(1, stats.speed);
      setTurnDuration(Math.max(1, Math.round((DEFAULT_ACTOR_TURN_DURATION * DEFAULT_ACTOR_TURN_DURATION) / speed)));
    } catch (e) {
      console.error(`Scheme Turn Error for ${entityId}:`, e);
      setTurnDuration(DEFAULT_ACTOR_TURN_DURATION);
    }
    return;
  }

  let aiTurnState = state;

  try {
    const aiTime0 = performance.now();
    const hitCap = intraTurnActionCount >= MAX_INTRA_TURN_ACTIONS;
    const aiResult = hitCap ? { intent: null, state: aiTurnState } : processAITurn(aiTurnState, entityId);
    recordAISample({
      entityId,
      durationMs: performance.now() - aiTime0,
      intentType: aiResult.intent?.type ?? 'none'
    });

    aiTurnState = aiResult.state;
    const intent = aiResult.intent;

    if (intent !== null) {
      const result = applyIntentWithCost(aiTurnState, intent);
      if (result.success && result.energyCost === 0) {
        intraTurnActionCount += 1;
        if (result.state !== state) {
          updateState(result.state);
        }
        setTurnDuration(0);
        return;
      }

      const finalActionResult = result.success
        ? result
        : applyIntentWithCost(result.state, { type: IntentType.Wait, entityId });
      const finalDuration =
        finalActionResult.energyCost > 0 ? finalActionResult.energyCost : DEFAULT_ACTOR_TURN_DURATION;
      turnStartProcessedForActor = null;
      intraTurnActionCount = 0;
      const nextState = processHungerTick(finalActionResult.state, entityId, finalDuration);
      if (nextState !== state) {
        updateState(nextState);
      }
      setTurnDuration(finalDuration);
      return;
    }

    const waitResult = applyIntentWithCost(aiTurnState, { type: IntentType.Wait, entityId });
    const endDuration = waitResult.energyCost > 0 ? waitResult.energyCost : DEFAULT_ACTOR_TURN_DURATION;
    turnStartProcessedForActor = null;
    intraTurnActionCount = 0;
    const nextState = processHungerTick(waitResult.state, entityId, endDuration);
    if (nextState !== state) {
      updateState(nextState);
    }
    setTurnDuration(endDuration);
  } catch (e) {
    console.error(`AI Turn Error for ${entityId}:`, e);
    turnStartProcessedForActor = null;
    intraTurnActionCount = 0;
    setTurnDuration(DEFAULT_ACTOR_TURN_DURATION);
  }
}
