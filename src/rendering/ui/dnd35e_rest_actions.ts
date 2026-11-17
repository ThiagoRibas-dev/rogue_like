import { addComponent, getComponent, refreshResourcePools } from '../../core/ecs.ts';
import { getGameState, setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { BULK_REST_PROGRESS_DOTS, CLOCK_PHASE_ICONS } from '../../constants/world_clock.constants.ts';
import { EIGHT_HOURS_IN_ROUNDS } from '../../rulesets/dnd35e/magic/aoe_rest.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import { triggerActiveAreaRespawnIfDue } from '../../systems/map/map_wake_respawn.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import {
  computeTurnsUntilPhase,
  formatWorldClockShort,
  getClockPhaseLabel,
  isActorThreatenedByVisibleHostiles,
  readWorldClock
} from '../../systems/world_clock.system.ts';
import {
  advanceWorldTimeBulk,
  advanceWorldTimeBulkAsync,
  type BulkTimeAdvanceResult
} from '../../systems/world_time_skip.ts';
import { ComponentType, type RulesetDataComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { hideLoadingOverlay, showLoadingOverlay, updateLoadingProgress } from './loading_overlay.ui.ts';

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
 * spell slot refresh, `rest_8h` pool recharge, active-area respawn, and world event digest).
 */
function finalizeEightHourRestRecovery(bulkRes: BulkTimeAdvanceResult, playerId: EntityId): GameState {
  let nextState = bulkRes.state;
  const dndData = getDnD35EntityData(nextState, playerId);
  const fighter = getComponent(nextState, playerId, ComponentType.Fighter);
  if (!fighter) return nextState;

  const totalTrackLevels = dndData.tracks.reduce((sum, t) => sum + t.levels, 0);
  const effectiveLevel = Math.max(1, totalTrackLevels > 0 ? totalTrackLevels : fighter.level || 1);
  const healedHp = Math.min(fighter.maxHp, fighter.hp + effectiveLevel);
  nextState = addComponent(nextState, playerId, { ...fighter, hp: healedHp });

  const abilities = dndData.abilityScores;
  const healedAbilities = {
    str: { ...abilities.str, damage: Math.max(0, abilities.str.damage - 1) },
    dex: { ...abilities.dex, damage: Math.max(0, abilities.dex.damage - 1) },
    con: { ...abilities.con, damage: Math.max(0, abilities.con.damage - 1) },
    int: { ...abilities.int, damage: Math.max(0, abilities.int.damage - 1) },
    wis: { ...abilities.wis, damage: Math.max(0, abilities.wis.damage - 1) },
    cha: { ...abilities.cha, damage: Math.max(0, abilities.cha.damage - 1) }
  };

  const classBooks = dndData.spellbooksByClass ?? {};
  const refreshedBooks: Record<string, (typeof classBooks)[string]> = {};
  let booksChanged = false;

  for (const [cid, book] of Object.entries(classBooks)) {
    let slots = book.preparedSlots;
    if (slots && slots.length > 0) {
      slots = slots.map((s) => (s.expended ? { ...s, expended: false } : s));
    }
    const preparedSpellIds = slots
      ? slots.filter((s) => s.preparedSpellId !== undefined).map((s) => s.preparedSpellId!)
      : book.preparedSpellIds;

    refreshedBooks[cid] = {
      ...book,
      preparedSlots: slots,
      preparedSpellIds,
      spontaneousSlotsUsedByLevel: {}
    };
    booksChanged = true;
  }

  const updatedDndData = {
    ...dndData,
    abilityScores: healedAbilities,
    ...(booksChanged ? { spellbooksByClass: refreshedBooks } : {})
  };
  nextState = addComponent(nextState, playerId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: updatedDndData
  } as RulesetDataComponent);

  nextState = refreshResourcePools(nextState, playerId, 'rest_8h');
  nextState = finalizeBulkTimeEventsAndRespawn(nextState, bulkRes.summaryEvents, 'rested');

  return addMessage(
    nextState,
    `Rest completed (8 hours). It is now ${formatWorldClockShort(readWorldClock(nextState))}. All daily spell slots and abilities refreshed.`,
    MessageLogCategory.System
  );
}

/**
 * Performs an 8-hour rest synchronously when unthreatened by visible hostiles.
 */
export function executeEightHourRest(state: GameState, playerId: EntityId): GameState {
  if (isActorThreatenedByVisibleHostiles(state, playerId)) {
    return addMessage(state, 'You cannot rest while hostile creatures are visible!', MessageLogCategory.System);
  }
  const bulkRes = advanceWorldTimeBulk(state, EIGHT_HOURS_IN_ROUNDS, playerId);
  return finalizeEightHourRestRecovery(bulkRes, playerId);
}

/**
 * Waits synchronously until the next occurrence of `targetPhaseId` (from `rules.worldClock.waitTargets`),
 * advancing world time and macro simulations in bulk unless threatened by visible hostiles.
 */
export function executeWaitUntilPhase(state: GameState, playerId: EntityId, targetPhaseId: string): GameState {
  if (isActorThreatenedByVisibleHostiles(state, playerId)) {
    return addMessage(state, 'You cannot wait while hostile creatures are visible!', MessageLogCategory.System);
  }
  const turns = computeTurnsUntilPhase(state, targetPhaseId);
  if (turns === undefined) {
    return addMessage(state, `Unknown time phase "${targetPhaseId}".`, MessageLogCategory.System);
  }

  const bulkRes = advanceWorldTimeBulk(state, turns, playerId);
  let nextState = finalizeBulkTimeEventsAndRespawn(bulkRes.state, bulkRes.summaryEvents, 'waited');
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
  if (isActorThreatenedByVisibleHostiles(state, playerId)) {
    const blocked = addMessage(
      state,
      'You cannot rest while hostile creatures are visible!',
      MessageLogCategory.System
    );
    setGameState(blocked);
    markAllDomainsDirty();
    onComplete?.();
    return;
  }

  showLoadingOverlay('Resting for 8 Hours...');
  let dotIdx = 0;
  try {
    const bulkRes = await advanceWorldTimeBulkAsync(state, EIGHT_HOURS_IN_ROUNDS, playerId, (fraction) => {
      const dots = BULK_REST_PROGRESS_DOTS[dotIdx % BULK_REST_PROGRESS_DOTS.length] ?? '...';
      dotIdx++;
      updateLoadingProgress({ progress: fraction, message: `The world stirs${dots}` });
    });
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
  if (isActorThreatenedByVisibleHostiles(state, playerId)) {
    const blocked = addMessage(
      state,
      'You cannot wait while hostile creatures are visible!',
      MessageLogCategory.System
    );
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
    const bulkRes = await advanceWorldTimeBulkAsync(state, turns, playerId, (fraction) => {
      const dots = BULK_REST_PROGRESS_DOTS[dotIdx % BULK_REST_PROGRESS_DOTS.length] ?? '...';
      dotIdx++;
      updateLoadingProgress({ progress: fraction, message: `Time passes${dots}` });
    });
    let nextState = finalizeBulkTimeEventsAndRespawn(bulkRes.state, bulkRes.summaryEvents, 'waited');
    nextState = addMessage(
      nextState,
      `Waited until ${phaseLabel}. It is now ${formatWorldClockShort(readWorldClock(nextState))}.`,
      MessageLogCategory.System
    );
    setGameState(nextState);
    markAllDomainsDirty();
    onComplete?.();
  } finally {
    const live = getGameState();
    if (live) markAllDomainsDirty();
    hideLoadingOverlay();
  }
}
