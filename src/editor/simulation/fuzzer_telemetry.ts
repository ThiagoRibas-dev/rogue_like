import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { FuzzerReport, FuzzerTelemetry } from './fuzzer.types.ts';

/**
 * Result of processing ledger events for telemetry tracking.
 */
export interface ProcessLedgerResult {
  readonly dramaCountDelta: number;
  readonly clueCountDelta: number;
  readonly schemeMutationsDelta: number;
  readonly timelineEntries: ReadonlyArray<string>;
}

/**
 * Parses new ledger events from the historical ledger and updates metric counts.
 */
export function processLedgerEvents(events: ReadonlyArray<GameEvent>, turns: number): ProcessLedgerResult {
  let dramaCountDelta = 0;
  let clueCountDelta = 0;
  let schemeMutationsDelta = 0;
  const timelineEntries: string[] = [];

  for (const event of events) {
    let isNarrativeRelevant = false;
    let eventSummary = event.summary || '';

    switch (event.type) {
      case GameEventType.NemesisPromoted:
        isNarrativeRelevant = true;
        dramaCountDelta++;
        eventSummary = eventSummary || `Nemesis Promoted: Entity ${event.entityId} to Rank ${event.newRankId}`;
        break;
      case GameEventType.CoreValueViolated:
        isNarrativeRelevant = true;
        dramaCountDelta++;
        eventSummary = eventSummary || `Core Value Violated: Entity ${event.entityId}`;
        break;
      case GameEventType.SchemeMutatedArea:
        isNarrativeRelevant = true;
        schemeMutationsDelta++;
        eventSummary = eventSummary || `Scheme Mutated Area: ${event.areaId}`;
        break;
      case GameEventType.ClueDiscovered:
        isNarrativeRelevant = true;
        clueCountDelta++;
        eventSummary = eventSummary || `Clue Discovered: ${event.clueId}`;
        break;
      case GameEventType.QuestCompleted:
        isNarrativeRelevant = true;
        eventSummary = eventSummary || `Quest Completed: ${event.questId}`;
        break;
      case GameEventType.SchemeAdvanced:
        isNarrativeRelevant = true;
        dramaCountDelta++;
        eventSummary = eventSummary || `Scheme Advanced: ${event.schemeId} to Phase ${event.newPhase}`;
        break;
      case GameEventType.RivalryResolved:
        isNarrativeRelevant = true;
        dramaCountDelta++;
        eventSummary = eventSummary || `Rivalry Resolved: ${event.rivalryId}`;
        break;
      default:
        break;
    }

    if (isNarrativeRelevant) {
      timelineEntries.push(`Turn ${turns}: ${eventSummary}`);
    }
  }

  return {
    dramaCountDelta,
    clueCountDelta,
    schemeMutationsDelta,
    timelineEntries
  };
}

/**
 * Aggregates results of multiple runs into a FuzzerReport.
 */
export function compileFuzzerReport(results: ReadonlyArray<FuzzerTelemetry>): FuzzerReport {
  const totalRuns = results.length;
  const failedRuns = results.filter((r) => r.error !== null).length;
  const successfulRuns = totalRuns - failedRuns;

  const avgTurns = totalRuns > 0 ? results.reduce((sum, r) => sum + r.turnsElapsed, 0) / totalRuns : 0;
  const avgSaveSize = totalRuns > 0 ? results.reduce((sum, r) => sum + r.finalSaveSize, 0) / totalRuns : 0;

  // Average drama events per hour (assuming 1 hour = ~1000 turns)
  const totalTurns = results.reduce((sum, r) => sum + r.turnsElapsed, 0);
  const totalDrama = results.reduce((sum, r) => sum + r.dramaCount, 0);
  const avgDramaEventsPerHour = totalTurns > 0 ? (totalDrama / totalTurns) * 1000 : 0;

  const totalClues = results.reduce((sum, r) => sum + r.clueCount, 0);
  const clueToEventRatio = totalDrama > 0 ? totalClues / totalDrama : 0;

  return {
    results,
    aggregate: {
      totalRuns,
      successfulRuns,
      failedRuns,
      avgTurns,
      avgDramaEventsPerHour,
      clueToEventRatio,
      avgSaveSize
    }
  };
}
