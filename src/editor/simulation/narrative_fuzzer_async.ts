import * as ROT from 'rot-js';
import { rng } from '../../core/rng.ts';
import type { FuzzerOptions, FuzzerReport, FuzzerTelemetry, FuzzerError, FuzzerErrorType } from './fuzzer.types.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent, queryEntities } from '../../core/ecs.ts';
import { FUZZER_YIELD_TURN_INTERVAL } from '../../constants/scheduler.constants.ts';
import {
  tickHeadlessTurn,
  createMockFuzzerState,
  checkFuzzerSoftlock,
  checkSaveBloat,
  processLedgerEvents,
  compileFuzzerReport
} from './narrative_fuzzer.ts';

/** Progress update emitted during async fuzzer batches. */
export interface FuzzerProgress {
  readonly currentRun: number;
  readonly totalRuns: number;
  readonly currentTurn: number;
  readonly maxTurns: number;
  readonly percent: number;
  readonly message: string;
}

/**
 * Executes a batch of headless fuzzer simulations cooperatively as an async generator pipeline.
 * Snapshots and restores ROT.RNG across every yield to preserve deterministic execution.
 */
export function* runNarrativeFuzzerAsync(
  campaign: Readonly<CampaignData>,
  options: FuzzerOptions
): Generator<FuzzerProgress, FuzzerReport, void> {
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
    let lastSaveSize = 0;

    // Yield initial run progress
    let rngState = ROT.RNG.getState();
    yield {
      currentRun: i + 1,
      totalRuns: options.runs,
      currentTurn: 0,
      maxTurns: options.maxTurns,
      percent: i / options.runs,
      message: `Starting run ${i + 1}/${options.runs} (Seed: ${seed})...`
    };
    ROT.RNG.setState(rngState);

    while (turns < options.maxTurns && !state.isGameOver) {
      turns++;

      const activeActors = state.entities.filter((id) => getComponent(state, id, ComponentType.Actor) !== undefined);
      const persistentActors = Array.from(state.persistentEntities.entries())
        .filter(([, record]) => record.components[ComponentType.Actor] !== undefined)
        .map(([id]) => id);

      const allActors = [...activeActors, ...persistentActors];
      const startEventsCount = state.historicalLedger.length;

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

      const players = queryEntities(state, [ComponentType.Player]);
      if (players.length === 0) {
        timeline.push(`Turn ${turns}: Player died.`);
        break;
      }

      const newLedgerEvents = state.historicalLedger.slice(startEventsCount);
      const ledgerResult = processLedgerEvents(newLedgerEvents, turns);
      dramaCount += ledgerResult.dramaCountDelta;
      clueCount += ledgerResult.clueCountDelta;
      schemeMutations += ledgerResult.schemeMutationsDelta;
      for (const entry of ledgerResult.timelineEntries) {
        timeline.push(entry);
      }

      const softlockError = checkFuzzerSoftlock(turns, state.globalTurn, seed);
      if (softlockError) {
        error = softlockError;
        break;
      }

      const bloatResult = checkSaveBloat(turns, state, seed, lastSaveSize);
      lastSaveSize = bloatResult.saveSize;
      if (bloatResult.error) {
        error = bloatResult.error;
        break;
      }

      if (turns % FUZZER_YIELD_TURN_INTERVAL === 0) {
        const runProgress = (i + turns / options.maxTurns) / options.runs;
        rngState = ROT.RNG.getState();
        yield {
          currentRun: i + 1,
          totalRuns: options.runs,
          currentTurn: turns,
          maxTurns: options.maxTurns,
          percent: runProgress,
          message: `Run ${i + 1}/${options.runs} - Turn ${turns}/${options.maxTurns}`
        };
        ROT.RNG.setState(rngState);
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

  const rngState = ROT.RNG.getState();
  yield {
    currentRun: options.runs,
    totalRuns: options.runs,
    currentTurn: options.maxTurns,
    maxTurns: options.maxTurns,
    percent: 1.0,
    message: 'Simulation batch completed.'
  };
  ROT.RNG.setState(rngState);

  return compileFuzzerReport(results);
}
