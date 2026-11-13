import { ComponentType } from '../types/components.types.ts';
import { EngineMode, type EntityId, type GameState, UIMode } from '../types/game-state.types.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { getComponent } from './ecs.ts';
import { recordIntent } from './replay.ts';
import { recordAISample } from './performance.ts';
import { addActor, lockEngine, setTurnDuration, unlockEngine } from './scheduler.ts';
import { enqueueIntent, dequeueIntent, hasPendingIntents, clearInputQueue } from './input_queue.ts';
import { markDirtyFromStateDiff } from './presentation_queue.ts';
import { scheduleDebouncedSave, saveCheckpoint, checkpointGameOver } from './persistence_service.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { processHungerTick } from '../systems/hunger.system.ts';
import { shouldSkipTurn } from '../systems/status-effect.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { processAITurn } from '../systems/ai.system.ts';
import { runActorTurnStart } from '../systems/lifecycle.system.ts';
import { processSchemeTurn } from '../systems/scheme.system.ts';
import { applyIntentWithCost } from './loop/intent_cost_resolver.ts';

export { applyIntentWithCost };

let currentState: GameState | null = null;
let stateChangeCallback: ((state: GameState) => void) | null = null;
let turnStartProcessedForActor: EntityId | null = null;

/**
 * Sets/updates the global GameState and triggers state change listeners.
 */
export function setGameState(state: GameState): void {
  turnStartProcessedForActor = null;
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
    const stateAfterTurnStart = runActorTurnStart(state, entityId);
    if (stateAfterTurnStart !== state) {
      updateState(stateAfterTurnStart);
      state = stateAfterTurnStart;
    }
  }

  const fighter = getComponent(state, entityId, ComponentType.Fighter);
  if (!fighter && getComponent(state, entityId, ComponentType.Actor)) {
    turnStartProcessedForActor = null;
    setTurnDuration(100);
    if (
      getComponent(state, entityId, ComponentType.Player) !== undefined &&
      state.engineMode === EngineMode.TurnBased
    ) {
      unlockEngine();
    }
    return;
  }

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  if (shouldSkipTurn(state, entityId)) {
    turnStartProcessedForActor = null;
    if (isPlayer) {
      updateState(addMessage(state, `You are unable to act and skip your turn!`, MessageLogCategory.System));
      setTurnDuration(100);
      if (state.engineMode === EngineMode.TurnBased) unlockEngine();
    } else {
      setTurnDuration(100);
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
    } else {
      turnStartProcessedForActor = null;
      setTurnDuration(10);
      const nextState = processHungerTick(state, entityId, 10);
      updateState(nextState);
      return;
    }
  } else {
    turnStartProcessedForActor = null;
    if (getComponent(state, entityId, ComponentType.Scheme)) {
      try {
        const nextState = processSchemeTurn(state, entityId);
        if (nextState !== state) {
          updateState(nextState);
        }

        const stats = getEffectiveStats(state, entityId);
        const speed = Math.max(1, stats.speed);
        setTurnDuration(Math.max(1, Math.round(10000 / speed)));
      } catch (e) {
        console.error(`Scheme Turn Error for ${entityId}:`, e);
        setTurnDuration(100);
      }
      return;
    }

    let aiTurnState = state;

    try {
      const aiTime0 = performance.now();
      const aiResult = processAITurn(aiTurnState, entityId);
      recordAISample({
        entityId,
        durationMs: performance.now() - aiTime0,
        intentType: aiResult.intent?.type ?? 'none'
      });

      aiTurnState = aiResult.state;
      const intent = aiResult.intent;

      if (intent !== null) {
        const result = applyIntentWithCost(aiTurnState, intent);
        let nextState = result.state;
        if (result.energyCost > 0) {
          nextState = processHungerTick(nextState, entityId, result.energyCost);
          setTurnDuration(result.energyCost);
        } else {
          setTurnDuration(100);
        }
        if (nextState !== state) {
          updateState(nextState);
        }
      } else {
        const nextState = processHungerTick(state, entityId, 100);
        if (nextState !== state) {
          updateState(nextState);
        }
        setTurnDuration(100);
      }
    } catch (e) {
      console.error(`AI Turn Error for ${entityId}:`, e);
      setTurnDuration(100);
    }
  }
}
