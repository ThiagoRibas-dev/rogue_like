import { dispatchAction } from '../actions/action.registry.ts';
import { ComponentType } from '../types/components.types.ts';
import { EngineMode, type EntityId, type GameState, UIMode } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { type ActionResult, type Intent } from '../types/intents/intent.union.ts';
import { addComponent, getComponent } from './ecs.ts';
import { saveGame } from './save.ts';
import { lockEngine, setTurnDuration, unlockEngine } from './scheduler.ts';

import { processHungerTick } from '../systems/hunger.system.ts';
import { processStatusEffectsTick, shouldSkipTurn } from '../systems/status-effect.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { updateExploredTiles } from '../systems/map.system.ts';
import { processAITurn } from '../systems/ai.system.ts';
import { coordToIndex } from '../utils/grid.ts';
import { processTraps, processGlobalTriggers } from '../systems/trigger.system.ts';
import { processDamageSystem } from '../systems/damage.system.ts';
import { processDeathSystem } from '../systems/death.system.ts';
import { processSchemeTurn } from '../systems/scheme.system.ts';
import { processInvestigationEvents } from '../systems/investigation.system.ts';
import { processFieldsTick } from '../systems/field.system.ts';
import { processPersonalitySystem } from '../systems/personality.system.ts';
import { processKnowledgePropagationEvents, tickPendingKnowledge } from '../systems/knowledge.system.ts';

let currentState: GameState | null = null;
let stateChangeCallback: ((state: GameState) => void) | null = null;

export function setGameState(state: GameState): void {
  updateState(state);
}

export function getGameState(): GameState {
  if (!currentState) throw new Error('Game state not initialized');
  return currentState;
}

export function onStateChange(callback: (state: GameState) => void): void {
  stateChangeCallback = callback;
}

function updateState(newState: GameState): void {
  currentState = newState;
  if (newState.uiMode === UIMode.Game) {
    saveGame(newState);
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

  const isImmediate = 'isImmediate' in intent && intent.isImmediate;

  if (isImmediate) {
    const result = applyIntentWithCost(state, intent);
    updateState(result.state);
    return;
  }

  if (state.engineMode === EngineMode.RTwP && !state.rtwpState.paused) {
    // Unpaused override
    updateState({ ...state, playerCommandQueue: [intent] });
  } else {
    // Append to queue
    const nextQueue = [...state.playerCommandQueue, intent];
    updateState({ ...state, playerCommandQueue: nextQueue });
  }

  if (state.engineMode === EngineMode.TurnBased) {
    unlockEngine();
  }
}

import { getEffectiveStats } from '../utils/stats.ts';
import type { GameEvent } from '../types/events.types.ts';

/**
 * Called by ROT.Engine when it is an actor's turn.
 */
export function processTurn(entityId: EntityId): void {
  let state = getGameState();
  if (state.isGameOver) {
    lockEngine();
    return;
  }

  let stateAfterTick = processStatusEffectsTick(state, entityId);
  stateAfterTick = processDamageSystem(stateAfterTick);
  stateAfterTick = processDeathSystem(stateAfterTick);

  if (stateAfterTick !== state) {
    updateState(stateAfterTick);
    state = stateAfterTick;
  }

  // If the entity died from DoT (like poison), end their turn
  const fighter = getComponent(state, entityId, ComponentType.Fighter);
  if (!fighter && getComponent(state, entityId, ComponentType.Actor)) {
    // Wait, if they are dead, they might have been removed. But just in case:
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

  // Check if any active effect requires this entity to skip its turn
  if (shouldSkipTurn(state, entityId)) {
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
    if (state.playerCommandQueue.length > 0) {
      const intent = state.playerCommandQueue[0];
      const nextQueue = state.playerCommandQueue.slice(1);

      const stateWithPoppedQueue = { ...state, playerCommandQueue: nextQueue };
      updateState(stateWithPoppedQueue);

      try {
        const result = applyIntentWithCost(stateWithPoppedQueue, intent as Intent);
        let nextState = result.state;

        if (result.energyCost > 0) {
          nextState = processHungerTick(nextState, entityId, result.energyCost);
          setTurnDuration(result.energyCost);
        } else {
          setTurnDuration(0);
        }

        if (nextState !== stateWithPoppedQueue) {
          updateState(updateExploredTiles(nextState));
        }
      } catch (e) {
        console.error(`Error processing player intent:`, e);
        setTurnDuration(0);
      }
      return;
    }

    if (state.engineMode === EngineMode.TurnBased) {
      lockEngine();
      return;
    } else {
      setTurnDuration(10);
      const nextState = processHungerTick(state, entityId, 10);
      updateState(nextState);
      return;
    }
  } else {
    // Scheme Simulator
    if (getComponent(state, entityId, ComponentType.Scheme)) {
      try {
        const nextState = processSchemeTurn(state, entityId);
        if (nextState !== state) {
          updateState(nextState);
        }

        // Scheme actions take time relative to the mastermind's speed
        const stats = getEffectiveStats(state, entityId);
        const speed = Math.max(1, stats.speed);
        setTurnDuration(Math.max(1, Math.round(10000 / speed)));
      } catch (e) {
        console.error(`Scheme Turn Error for ${entityId}:`, e);
        setTurnDuration(100);
      }
      return;
    }

    // AI Turn
    let aiTurnState = state;
    const aiComponent = getComponent(aiTurnState, entityId, ComponentType.AI);
    if (aiComponent && aiComponent.cooldowns) {
      const newCooldowns: Record<string, number> = {};
      let changed = false;
      for (const [key, val] of Object.entries(aiComponent.cooldowns)) {
        if (val > 0) {
          newCooldowns[key] = val - 1;
          changed = true;
        } else {
          newCooldowns[key] = 0;
        }
      }
      if (changed) {
        aiTurnState = addComponent(aiTurnState, entityId, { ...aiComponent, cooldowns: newCooldowns });
      }
    }

    try {
      const aiResult = processAITurn(aiTurnState, entityId);
      aiTurnState = aiResult.state;
      const intent = aiResult.intent;

      if (intent !== null) {
        const result = applyIntentWithCost(aiTurnState, intent);
        let nextState = result.state;
        if (result.energyCost > 0) {
          nextState = processHungerTick(nextState, entityId, result.energyCost);
          setTurnDuration(result.energyCost);
        } else {
          // AI failed to execute its intended action (e.g., bumped into a friendly unit).
          // Force a turn duration to prevent an infinite 0-energy loop.
          setTurnDuration(100);
        }
        if (nextState !== state) {
          updateState(nextState);
        }
      } else {
        // AI waited / skipped turn
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

/**
 * Executes an intent and computes its energy cost based on success.
 */
function applyIntentWithCost(state: GameState, intent: Intent): ActionResult {
  const result = applyIntent(state, intent);
  let nextState = result.state;

  let energyCost = 100; // default cost

  if (!result.success) {
    energyCost = 0;
  } else if (intent.type === IntentType.Move) {
    const posAfter = getComponent(nextState, intent.entityId, ComponentType.Position);
    if (posAfter) {
      const tileIdx = coordToIndex(posAfter.x, posAfter.y, state.map.width);
      const tile = state.map.tiles[tileIdx];
      if (tile) {
        energyCost = state.campaign.tiles[tile.tileId]?.movementCost ?? 100;
      }
    }
    nextState = processTraps(nextState, intent.entityId);
  } else if ('isImmediate' in intent && intent.isImmediate) {
    energyCost = 0; // UI/Debug actions take no time
  }

  // Scale cost by actor speed
  if (energyCost > 0) {
    const actor = getComponent(state, intent.entityId, ComponentType.Actor);
    if (actor) {
      const stats = getEffectiveStats(state, intent.entityId);
      const speed = Math.max(1, stats.speed);
      energyCost = Math.max(1, Math.round((energyCost * 100) / speed));
    }
  }

  // Run the combat damage & death pipeline
  nextState = processDamageSystem(nextState);
  nextState = processDeathSystem(nextState);

  const finalResult: ActionResult = { state: nextState, success: result.success, energyCost };

  if (result.events && result.events.length > 0) {
    nextState = { ...nextState, events: [...nextState.events, ...result.events] };
  }

  // Run the new global triggers
  nextState = processGlobalTriggers(nextState);

  // Tick fields
  nextState = processFieldsTick(nextState);

  // Investigation system consumes events
  nextState = processInvestigationEvents(nextState);

  // Knowledge propagation processes events and ticks delay timers
  nextState = processKnowledgePropagationEvents(nextState);
  nextState = tickPendingKnowledge(nextState);

  // Personality System (Thoughts, Stress, Core Memories)
  nextState = processPersonalitySystem(nextState);

  // Clear events at the end of the intent tick so they don't persist
  const eventsToReturn = [...nextState.events];
  nextState = { ...nextState, events: [] };

  return {
    ...finalResult,
    state: nextState,
    events: eventsToReturn as ReadonlyArray<GameEvent>
  };
}

/**
 * Dispatches an intent to the appropriate system for validation and execution.
 */
function applyIntent(
  state: GameState,
  intent: Intent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } {
  return dispatchAction(state, intent);
}
