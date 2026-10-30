import { type GameState } from '../types/game-state.types.ts';
import { processKnowledgePropagationEvents, tickPendingKnowledge } from '../systems/knowledge.system.ts';
import {
  processRumorPropagationEvents,
  tickPendingRumors,
  cullStaleAndConfirmedRumors
} from '../systems/gossip.system.ts';
import { processPersonalitySystem } from '../systems/personality.system.ts';
import { processNemesisSystem } from '../systems/nemesis.system.ts';
import { processRivalries } from '../systems/rivalry.system.ts';
import { processWorldEvents } from '../systems/world_events.system.ts';
import {
  LOCAL_NARRATIVE_TICK_INTERVAL,
  NEMESIS_EVALUATION_INTERVAL,
  RIVALRY_EVALUATION_INTERVAL
} from '../constants/scheduler.constants.ts';
import {
  MAX_GLOBAL_DRAMA_BUDGET,
  DRAMA_BUDGET_REGEN_PER_TURN,
  WORLD_EVENT_TICK_INTERVAL
} from '../constants/pacing.constants.ts';

/**
 * Advances global turn counters and regenerates the global drama budget.
 *
 * @param state Current GameState.
 * @returns Updated GameState with incremented global turn and regenerated drama budget.
 */
export function advanceGlobalTurnCounter(state: GameState): GameState {
  const prevBudget = state.dramaTracker.globalBudget;
  const nextBudget = Math.min(MAX_GLOBAL_DRAMA_BUDGET, prevBudget + DRAMA_BUDGET_REGEN_PER_TURN);
  return {
    ...state,
    globalTurn: (state.globalTurn || 0) + 1,
    dramaTracker: {
      ...state.dramaTracker,
      globalBudget: nextBudget
    }
  };
}

/**
 * Evaluates Tier 2 local narrative cadence (knowledge propagation, rumors, and personality thoughts).
 * Immediate event propagation runs on every action; timer ticks and reflections run on coarse intervals.
 *
 * @param state Current GameState.
 * @param didGlobalTurnAdvance Whether a player action consumed energy, advancing time.
 * @returns Updated GameState.
 */
export function processTier2LocalCadence(state: GameState, didGlobalTurnAdvance: boolean): GameState {
  let nextState = state;

  // Event propagation must always digest fresh turn events
  nextState = processKnowledgePropagationEvents(nextState);
  nextState = processRumorPropagationEvents(nextState);

  // Periodic delay decay, rumor culling, and personality reflection
  const globalTurn = nextState.globalTurn || 0;
  if (didGlobalTurnAdvance && globalTurn % LOCAL_NARRATIVE_TICK_INTERVAL === 0) {
    nextState = tickPendingKnowledge(nextState);
    nextState = tickPendingRumors(nextState);
    nextState = cullStaleAndConfirmedRumors(nextState);
    nextState = processPersonalitySystem(nextState);
  }

  return nextState;
}

/**
 * Evaluates Tier 3 global macro-simulation cadence.
 * Decoupled from active combat/movement ticks to eliminate per-turn spikes.
 *
 * @param state Current GameState.
 * @param didGlobalTurnAdvance Whether a player action consumed energy, advancing time.
 * @returns Updated GameState.
 */
export function processTier3GlobalCadence(state: GameState, didGlobalTurnAdvance: boolean): GameState {
  if (!didGlobalTurnAdvance) return state;

  let nextState = advanceGlobalTurnCounter(state);
  const globalTurn = nextState.globalTurn;

  // Nemesis hierarchy advancement
  if (globalTurn % NEMESIS_EVALUATION_INTERVAL === 0) {
    nextState = processNemesisSystem(nextState);
  }

  // Persistent rivalry conflict resolution
  if (globalTurn % RIVALRY_EVALUATION_INTERVAL === 0) {
    nextState = processRivalries(nextState);
  }

  // Global world events
  if (globalTurn % WORLD_EVENT_TICK_INTERVAL === 0) {
    nextState = processWorldEvents(nextState);
  }

  return nextState;
}
