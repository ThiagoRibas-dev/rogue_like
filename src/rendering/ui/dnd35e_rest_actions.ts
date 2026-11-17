import { getGameState, setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { BULK_REST_PROGRESS_DOTS, CLOCK_PHASE_ICONS } from '../../constants/world_clock.constants.ts';
import { EIGHT_HOURS_IN_ROUNDS } from '../../rulesets/dnd35e/magic/aoe_rest.ts';
import { getPlayerCompanions } from '../../systems/companion_commands.system.ts';
import { triggerActiveAreaRespawnIfDue } from '../../systems/map/map_wake_respawn.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import {
  computeTurnsUntilPhase,
  formatWorldClockShort,
  getClockPhaseLabel,
  readWorldClock
} from '../../systems/world_clock.system.ts';
import {
  advanceWorldTimeBulk,
  advanceWorldTimeBulkAsync,
  type BulkTimeAdvanceResult
} from '../../systems/world_time_skip.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import {
  applyEightHourRestToActor,
  evaluateActorRestSafety,
  type RestSafetyEvaluation
} from './dnd35e_rest_recovery.ts';
import { hideLoadingOverlay, showLoadingOverlay, updateLoadingProgress } from './loading_overlay.ui.ts';

export { evaluateActorRestSafety, type RestSafetyEvaluation };

/** Maximum world event summary lines appended to the message log after resting or waiting. */
const MAX_REST_DIGEST_LINES = 5;

/**
 * Triggers active area lazy respawn if due and logs `"While you <verb>:"` digest entries
 * summarizing world events, promotions, and rivalries that fired during elapsed time.
 */
function finalizeBulkTimeEventsAndRespawn(
  state: GameState,
  summaryEvents: ReadonlyArray<string>,
  verb: 'rested' | 'waited'
): GameState {
  const respawned = triggerActiveAreaRespawnIfDue(state);
  let nextState = respawned.state;
  const allNotes = [...summaryEvents];
  if (respawned.spawnedCount > 0) {
    allNotes.push(`${respawned.spawnedCount} new threat(s) moved into the area.`);
  }

  if (allNotes.length > 0) {
    const displayed = allNotes.slice(0, MAX_REST_DIGEST_LINES).join(' • ');
    const overflow =
      allNotes.length > MAX_REST_DIGEST_LINES ? ` (+${allNotes.length - MAX_REST_DIGEST_LINES} more)` : '';
    nextState = addMessage(nextState, `While you ${verb}: ${displayed}${overflow}`, MessageLogCategory.System);
  }
  return nextState;
}

/**
 * Applies post-bulk-time-advance rest recovery (natural healing, 1 pt ability damage healing,
 * spell slot refresh with 8h retention, `rest_8h` pool recharge, fatigue removal, companion recovery,
 * active-area respawn, and world event digest), or reports interruption when aborted mid-rest.
 */
function finalizeEightHourRestRecovery(bulkRes: BulkTimeAdvanceResult, playerId: EntityId): GameState {
  if (bulkRes.interruptedReason !== undefined) {
    const respawnedState = finalizeBulkTimeEventsAndRespawn(bulkRes.state, bulkRes.summaryEvents, 'rested');
    return addMessage(
      respawnedState,
      `Rest interrupted at ${formatWorldClockShort(readWorldClock(respawnedState))}: ${bulkRes.interruptedReason}`,
      MessageLogCategory.System
    );
  }

  let nextState = bulkRes.state;
  const partyIds = Array.from(new Set<EntityId>([playerId, ...getPlayerCompanions(nextState, playerId)]));
  let totalRetainedRecentCasts = 0;

  for (const actorId of partyIds) {
    const recovered = applyEightHourRestToActor(nextState, actorId);
    nextState = recovered.state;
    totalRetainedRecentCasts += recovered.retainedRecentCastCount;
  }

  nextState = finalizeBulkTimeEventsAndRespawn(nextState, bulkRes.summaryEvents, 'rested');

  const retentionNote =
    totalRetainedRecentCasts > 0
      ? ` (${totalRetainedRecentCasts} slot(s) cast within the last 8 hours remained expended.)`
      : '';
  return addMessage(
    nextState,
    `Rest completed (8 hours). It is now ${formatWorldClockShort(readWorldClock(nextState))}. All eligible daily spell slots and abilities refreshed.${retentionNote}`,
    MessageLogCategory.System
  );
}

/**
 * Performs an 8-hour rest synchronously when safe, interrupting cleanly if a hazard emerges mid-rest.
 */
export function executeEightHourRest(state: GameState, playerId: EntityId): GameState {
  const safety = evaluateActorRestSafety(state, playerId);
  if (!safety.safe) {
    return addMessage(state, safety.reason ?? 'You cannot rest right now!', MessageLogCategory.System);
  }
  const bulkRes = advanceWorldTimeBulk(state, EIGHT_HOURS_IN_ROUNDS, playerId, (current) => {
    const check = evaluateActorRestSafety(current, playerId);
    return check.safe ? undefined : check.reason;
  });
  return finalizeEightHourRestRecovery(bulkRes, playerId);
}

/**
 * Waits synchronously until the next occurrence of `targetPhaseId` (from `rules.worldClock.waitTargets`),
 * advancing world time and macro simulations in bulk unless unsafe or interrupted.
 */
export function executeWaitUntilPhase(state: GameState, playerId: EntityId, targetPhaseId: string): GameState {
  const safety = evaluateActorRestSafety(state, playerId);
  if (!safety.safe) {
    return addMessage(state, safety.reason ?? 'You cannot wait right now!', MessageLogCategory.System);
  }
  const turns = computeTurnsUntilPhase(state, targetPhaseId);
  if (turns === undefined) {
    return addMessage(state, `Unknown time phase "${targetPhaseId}".`, MessageLogCategory.System);
  }

  const bulkRes = advanceWorldTimeBulk(state, turns, playerId, (current) => {
    const check = evaluateActorRestSafety(current, playerId);
    return check.safe ? undefined : check.reason;
  });
  let nextState = finalizeBulkTimeEventsAndRespawn(bulkRes.state, bulkRes.summaryEvents, 'waited');
  if (bulkRes.interruptedReason !== undefined) {
    return addMessage(
      nextState,
      `Waiting interrupted at ${formatWorldClockShort(readWorldClock(nextState))}: ${bulkRes.interruptedReason}`,
      MessageLogCategory.System
    );
  }
  const phaseLabel = getClockPhaseLabel(nextState, targetPhaseId);
  nextState = addMessage(
    nextState,
    `Waited until ${phaseLabel}. It is now ${formatWorldClockShort(readWorldClock(nextState))}.`,
    MessageLogCategory.System
  );
  return nextState;
}

/**
 * Executes an 8-hour rest asynchronously with progress bar and cycling ellipses overlay.
 */
export async function applyRestActionAsync(
  state: GameState,
  playerId: EntityId,
  onComplete?: () => void
): Promise<void> {
  const safety = evaluateActorRestSafety(state, playerId);
  if (!safety.safe) {
    const blocked = addMessage(state, safety.reason ?? 'You cannot rest right now!', MessageLogCategory.System);
    setGameState(blocked);
    markAllDomainsDirty();
    onComplete?.();
    return;
  }

  showLoadingOverlay('Resting for 8 Hours...');
  let dotIdx = 0;
  try {
    const bulkRes = await advanceWorldTimeBulkAsync(
      state,
      EIGHT_HOURS_IN_ROUNDS,
      playerId,
      (fraction) => {
        const dots = BULK_REST_PROGRESS_DOTS[dotIdx % BULK_REST_PROGRESS_DOTS.length] ?? '...';
        dotIdx++;
        updateLoadingProgress({ progress: fraction, message: `The world stirs${dots}` });
      },
      (current) => {
        const check = evaluateActorRestSafety(current, playerId);
        return check.safe ? undefined : check.reason;
      }
    );
    const finalState = finalizeEightHourRestRecovery(bulkRes, playerId);
    setGameState(finalState);
    markAllDomainsDirty();
    onComplete?.();
  } finally {
    hideLoadingOverlay();
  }
}

/**
 * Executes a "Wait until <Phase>" time-skip asynchronously with progress overlay and cycling ellipses.
 */
export async function applyWaitUntilPhaseAsync(
  state: GameState,
  playerId: EntityId,
  targetPhaseId: string,
  onComplete?: () => void
): Promise<void> {
  const safety = evaluateActorRestSafety(state, playerId);
  if (!safety.safe) {
    const blocked = addMessage(state, safety.reason ?? 'You cannot wait right now!', MessageLogCategory.System);
    setGameState(blocked);
    markAllDomainsDirty();
    onComplete?.();
    return;
  }
  const turns = computeTurnsUntilPhase(state, targetPhaseId);
  if (turns === undefined) return;

  const phaseLabel = getClockPhaseLabel(state, targetPhaseId);
  const icon = CLOCK_PHASE_ICONS[targetPhaseId] ?? '⏳';
  showLoadingOverlay(`${icon} Waiting until ${phaseLabel}...`);
  let dotIdx = 0;
  try {
    const bulkRes = await advanceWorldTimeBulkAsync(
      state,
      turns,
      playerId,
      (fraction) => {
        const dots = BULK_REST_PROGRESS_DOTS[dotIdx % BULK_REST_PROGRESS_DOTS.length] ?? '...';
        dotIdx++;
        updateLoadingProgress({ progress: fraction, message: `Time passes${dots}` });
      },
      (current) => {
        const check = evaluateActorRestSafety(current, playerId);
        return check.safe ? undefined : check.reason;
      }
    );
    let nextState = finalizeBulkTimeEventsAndRespawn(bulkRes.state, bulkRes.summaryEvents, 'waited');
    if (bulkRes.interruptedReason !== undefined) {
      nextState = addMessage(
        nextState,
        `Waiting interrupted at ${formatWorldClockShort(readWorldClock(nextState))}: ${bulkRes.interruptedReason}`,
        MessageLogCategory.System
      );
    } else {
      nextState = addMessage(
        nextState,
        `Waited until ${phaseLabel}. It is now ${formatWorldClockShort(readWorldClock(nextState))}.`,
        MessageLogCategory.System
      );
    }
    setGameState(nextState);
    markAllDomainsDirty();
    onComplete?.();
  } finally {
    const live = getGameState();
    if (live) markAllDomainsDirty();
    hideLoadingOverlay();
  }
}
