import { DEFAULT_MACRO_TICK_INTERVAL_TURNS } from '../../constants/macro_world.constants.ts';
import type { GameState } from '../../types/game-state.types.ts';
import {
  consumeReadyMacroTickBatches,
  dispatchMacroWorldTickOffload,
  hasPendingMacroTickJob
} from '../../worker/worker_bridge.ts';
import { advanceMacroWorldTicks, applyMacroTickBatchToGameState, buildMacroSimContext } from './macro_world.system.ts';

/**
 * Deterministic turn-boundary coordinator for Ring 2 macro-world simulation:
 * 1. Drains any completed `MacroTickDeltaBatch`es returned by `world_sim.worker.ts` (or headless inline runs)
 *    and merges them cleanly at the exact turn boundary.
 * 2. When `globalTurn` crosses the next `tickIntervalTurns` boundary, dispatches the next Ring 2 batch.
 *
 * @param state Current immutable GameState at turn boundary.
 * @returns Updated GameState with any ready Ring 2 deltas applied and dispatch watermark updated.
 */
export function syncMacroWorldAtTurnBoundary(state: GameState): GameState {
  if (!state.macroWorld) return state;

  let nextState = state;
  const readyBatches = consumeReadyMacroTickBatches(nextState.macroWorld!.currentTick);
  for (const batch of readyBatches) {
    nextState = applyMacroTickBatchToGameState(nextState, batch);
  }

  const macro = nextState.macroWorld;
  if (!macro) return nextState;

  const interval = Math.max(1, macro.tickIntervalTurns || DEFAULT_MACRO_TICK_INTERVAL_TURNS);
  const expectedTick = Math.floor(Math.max(0, nextState.globalTurn) / interval);
  if (expectedTick > macro.currentTick && !hasPendingMacroTickJob()) {
    const context = buildMacroSimContext(nextState.campaign);
    const dispatched = dispatchMacroWorldTickOffload(macro, expectedTick, context);
    if (dispatched) {
      // Drain immediately if dispatch ran synchronously in headless mode
      const immediateBatches = consumeReadyMacroTickBatches(nextState.macroWorld!.currentTick);
      if (immediateBatches.length > 0) {
        for (const batch of immediateBatches) {
          nextState = applyMacroTickBatchToGameState(nextState, batch);
        }
      } else {
        nextState = {
          ...nextState,
          macroWorld: {
            ...nextState.macroWorld!,
            lastDispatchedTick: expectedTick
          }
        };
      }
    }
  }

  return nextState;
}

/**
 * Synchronously catches Ring 2 macro-world state up to `state.globalTurn` after bulk rest/time-skip
 * operations, discarding stale queued worker outputs below the caught-up tick.
 *
 * @param state Current immutable GameState after bulk turn advancement.
 * @returns Synchronized GameState caught up to current turn.
 */
export function flushMacroWorldSyncForBulkTurns(state: GameState): GameState {
  if (!state.macroWorld) return state;

  let nextState = state;
  const readyBatches = consumeReadyMacroTickBatches(nextState.macroWorld!.currentTick);
  for (const batch of readyBatches) {
    nextState = applyMacroTickBatchToGameState(nextState, batch);
  }

  const macro = nextState.macroWorld!;
  const interval = Math.max(1, macro.tickIntervalTurns || DEFAULT_MACRO_TICK_INTERVAL_TURNS);
  const targetTick = Math.floor(Math.max(0, nextState.globalTurn) / interval);
  if (targetTick <= macro.currentTick) {
    return nextState;
  }

  const context = buildMacroSimContext(nextState.campaign);
  const batch = advanceMacroWorldTicks(macro, targetTick, context);
  return applyMacroTickBatchToGameState(nextState, batch);
}
