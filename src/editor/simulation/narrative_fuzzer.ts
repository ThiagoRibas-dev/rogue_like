import * as ROT from 'rot-js';
import { rng } from '../../core/rng.ts';
import type { FuzzerOptions, FuzzerReport, FuzzerTelemetry, FuzzerError, FuzzerErrorType } from './fuzzer.types.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import { type EntityId, type GameState } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent, queryEntities, addComponent } from '../../core/ecs.ts';
import { applyIntentWithCost } from '../../core/game-loop.ts';
import { processStatusEffectsTick, shouldSkipTurn } from '../../systems/status-effect.system.ts';
import { processDamageSystem } from '../../systems/damage.system.ts';
import { processDeathSystem } from '../../systems/death.system.ts';
import { processSchemeTurn } from '../../systems/scheme.system.ts';
import { processAITurn } from '../../systems/ai.system.ts';
import {
  createMockFuzzerState
} from './fuzzer_mock_state.ts';
import {
  generatePlayerFuzzerIntent,
  checkFuzzerSoftlock,
  checkSaveBloat
} from './fuzzer_invariants.ts';
import { processLedgerEvents, compileFuzzerReport } from './fuzzer_telemetry.ts';

export {
  createEntity,
  createMockFuzzerState
} from './fuzzer_mock_state.ts';

export {
  TriggerRunawayError,
  generatePlayerFuzzerIntent,
  checkFuzzerSoftlock,
  checkSaveBloat
} from './fuzzer_invariants.ts';

export {
  processLedgerEvents,
  compileFuzzerReport
} from './fuzzer_telemetry.ts';

/**
 * Ticks a single actor's turn in a pure-functional headless state.
 */
export function tickHeadlessTurn(state: GameState, entityId: EntityId): GameState {
  let tempState = state;

  // 1. Tick status effects, damage, death
  tempState = processStatusEffectsTick(tempState, entityId);
  tempState = processDamageSystem(tempState);
  tempState = processDeathSystem(tempState);

  const fighter = getComponent(tempState, entityId, ComponentType.Fighter);
  const isActor = getComponent(tempState, entityId, ComponentType.Actor) !== undefined;
  if (!fighter && !isActor) {
    return tempState; // Already dead / removed
  }

  if (shouldSkipTurn(tempState, entityId)) {
    return tempState;
  }

  const isPlayer = getComponent(tempState, entityId, ComponentType.Player) !== undefined;
  const isScheme = getComponent(tempState, entityId, ComponentType.Scheme) !== undefined;

  if (isPlayer) {
    const intent = generatePlayerFuzzerIntent(tempState, entityId);
    const result = applyIntentWithCost(tempState, intent);
    tempState = result.state;
  } else if (isScheme) {
    try {
      tempState = processSchemeTurn(tempState, entityId);
    } catch {
      // Let it continue but log if needed
    }
  } else {
    // AI Turn
    let aiTurnState = tempState;
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

    const aiResult = processAITurn(aiTurnState, entityId);
    aiTurnState = aiResult.state;
    const intent = aiResult.intent;

    if (intent !== null) {
      const result = applyIntentWithCost(aiTurnState, intent);
      tempState = result.state;
    } else {
      tempState = aiTurnState;
    }
  }

  return tempState;
}

/**
 * Runs a batch of headless fuzzer simulations.
 */
export function runFuzzerBatch(campaign: Readonly<CampaignData>, options: FuzzerOptions): FuzzerReport {
  const results: FuzzerTelemetry[] = [];

  for (let i = 0; i < options.runs; i++) {
    const seed = options.seedOverride || Math.floor(rng.getUniform() * 1000000).toString();
    ROT.RNG.setSeed(Number(seed));

    let state = createMockFuzzerState(campaign);

    let turns = 0;
    let error: FuzzerError | null = null;
    const timeline: string[] = [];

    let dramaCount = 0;
    let clueCount = 0;
    let schemeMutations = 0;

    // Detect save-size and turns stalled details
    let lastSaveSize = 0;

    while (turns < options.maxTurns && !state.isGameOver) {
      turns++;

      // We collect actors that can take actions
      const activeActors = state.entities.filter((id) => getComponent(state, id, ComponentType.Actor) !== undefined);
      const persistentActors = Array.from(state.persistentEntities.entries())
        .filter(([, record]) => record.components[ComponentType.Actor] !== undefined)
        .map(([id]) => id);

      const allActors = [...activeActors, ...persistentActors];

      const startEventsCount = state.historicalLedger.length;

      // Executing turns for all active actors
      try {
        for (const actorId of allActors) {
          state = tickHeadlessTurn(state, actorId);
        }
      } catch (err) {
        const type: FuzzerErrorType =
          err instanceof Error && err.message.includes('TriggerRunawayError')
            ? 'runaway_trigger'
            : 'unhandled_exception';
        error = {
          type,
          message: err instanceof Error ? err.message : String(err),
          turn: turns,
          seed
        };
        break;
      }

      // Check softlocks: if player is dead or game is over, we stop
      const players = queryEntities(state, [ComponentType.Player]);
      if (players.length === 0) {
        timeline.push(`Turn ${turns}: Player died.`);
        break;
      }

      // Process new events from historicalLedger to trace timeline and metrics
      const newLedgerEvents = state.historicalLedger.slice(startEventsCount);
      const ledgerResult = processLedgerEvents(newLedgerEvents, turns);
      dramaCount += ledgerResult.dramaCountDelta;
      clueCount += ledgerResult.clueCountDelta;
      schemeMutations += ledgerResult.schemeMutationsDelta;
      for (const entry of ledgerResult.timelineEntries) {
        timeline.push(entry);
      }

      // Softlock detection: if globalTurn isn't advancing but fuzzer ticks continue
      const softlockError = checkFuzzerSoftlock(turns, state.globalTurn, seed);
      if (softlockError) {
        error = softlockError;
        break;
      }

      // Check save-size explosion
      const bloatResult = checkSaveBloat(turns, state, seed, lastSaveSize);
      lastSaveSize = bloatResult.saveSize;
      if (bloatResult.error) {
        error = bloatResult.error;
        break;
      }

      if (options.stopOnFirstError && error) break;
    }

    results.push({
      seed,
      turnsElapsed: turns,
      error,
      events: timeline,
      dramaCount,
      clueCount,
      schemeMutations,
      finalSaveSize: lastSaveSize
    });

    if (options.stopOnFirstError && error) break;
  }

  return compileFuzzerReport(results);
}
