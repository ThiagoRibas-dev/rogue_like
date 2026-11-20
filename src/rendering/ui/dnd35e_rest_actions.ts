/**
 * @file Thin UI async loading-overlay dispatchers for D&D 3.5e 8-hour rest and Console wait-until-phase.
 * Pure simulation lives in `src/systems/rest.system.ts` and `src/rulesets/dnd35e/magic/rest_recovery.ts`.
 */

import { getGameState, setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { BULK_REST_PROGRESS_DOTS, CLOCK_PHASE_ICONS } from '../../constants/world_clock.constants.ts';
import { EIGHT_HOURS_IN_ROUNDS } from '../../rulesets/dnd35e/magic/aoe_rest.ts';
import { finalizeEightHourRestRecovery } from '../../rulesets/dnd35e/magic/rest_recovery.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import {
  evaluateActorRestSafety,
  executeWatchChunkedBulkRestAsync,
  finalizeWaitUntilPhase
} from '../../systems/rest.system.ts';
import { computeTurnsUntilPhase, getClockPhaseLabel } from '../../systems/world_clock.system.ts';
import { advanceWorldTimeBulkAsync } from '../../systems/world_time_skip.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { hideLoadingOverlay, showLoadingOverlay, updateLoadingProgress } from './loading_overlay.ui.ts';

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
    const bulkRes = await executeWatchChunkedBulkRestAsync(
      state,
      playerId,
      EIGHT_HOURS_IN_ROUNDS,
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
    const nextState = finalizeWaitUntilPhase(bulkRes, targetPhaseId);
    setGameState(nextState);
    markAllDomainsDirty();
    onComplete?.();
  } finally {
    const live = getGameState();
    if (live) markAllDomainsDirty();
    hideLoadingOverlay();
  }
}
