/**
 * @file Ruleset-agnostic party rest safety evaluation, bulk time-skip world-event digesting,
 * and wait-until-diurnal-phase simulation primitives for any RPG ruleset cartridge.
 */

import { getPlayerCompanions } from './companion_commands.system.ts';
import { queryActiveFieldsAtPosition } from './field.system.ts';
import { getHungerState, HungerState } from './hunger.system.ts';
import { triggerActiveAreaRespawnIfDue } from './map/map_wake_respawn.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import {
  computeTurnsUntilPhase,
  formatWorldClockShort,
  getClockPhaseLabel,
  isActorThreatenedByVisibleHostiles,
  readWorldClock
} from './world_clock.system.ts';
import { advanceWorldTimeBulk, type BulkTimeAdvanceResult } from './world_time_skip.ts';
import { getComponent } from '../core/ecs.ts';
import {
  ComponentType,
  type HungerComponent,
  type PositionComponent,
  type StatusEffectsComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';

/** Maximum world event summary lines appended to the message log after resting or waiting. */
const MAX_REST_DIGEST_LINES = 5;

/** Result of evaluating whether an actor and active party can safely rest, camp, or prepare actions. */
interface RestSafetyEvaluation {
  readonly safe: boolean;
  readonly reason?: string | undefined;
}

/**
 * Checks declaratively whether `playerId` and all controlled companions are in safe conditions
 * to rest or wait: no visible hostiles, no active damaging status afflictions,
 * non-starving satiation, and no standing hazardous spatial fields.
 *
 * @param state Current immutable GameState.
 * @param playerId Player EntityId.
 * @returns `{ safe: true }` or `{ safe: false, reason }`.
 */
export function evaluateActorRestSafety(state: GameState, playerId: EntityId): RestSafetyEvaluation {
  if (isActorThreatenedByVisibleHostiles(state, playerId)) {
    return {
      safe: false,
      reason: 'Cannot rest while hostile creatures are visible!'
    };
  }

  const partyIds = Array.from(new Set<EntityId>([playerId, ...getPlayerCompanions(state, playerId)]));
  for (const actorId of partyIds) {
    const statusComp = getComponent(state, actorId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
    for (const eff of statusComp?.activeEffects ?? []) {
      const def = state.campaign.status[eff.effectId];
      if (def && def.perTurnDamage !== undefined && def.perTurnDamage > 0) {
        return {
          safe: false,
          reason: 'Cannot rest while you or a companion suffers from ongoing damaging afflictions!'
        };
      }
    }

    const pos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
    if (pos) {
      for (const activeField of queryActiveFieldsAtPosition(state, pos.x, pos.y)) {
        const fDef = state.campaign.fields[activeField.field.fieldType];
        const fieldHasDotStatus =
          fDef?.statusEffectId !== undefined && (state.campaign.status[fDef.statusEffectId]?.perTurnDamage ?? 0) > 0;
        if ((fDef && (fDef.damagePerTurn ?? 0) > 0) || fieldHasDotStatus) {
          return {
            safe: false,
            reason: 'Cannot rest while standing in a hazardous area!'
          };
        }
      }
    }
  }

  const hunger = getComponent(state, playerId, ComponentType.Hunger) as HungerComponent | undefined;
  if (hunger && (getHungerState(state, hunger.satiation) === HungerState.Starving || hunger.satiation <= 0)) {
    return {
      safe: false,
      reason: 'Cannot rest while starving! Eat food before resting.'
    };
  }

  return { safe: true };
}

/**
 * Triggers active area lazy respawn if due and logs `"While you <verb>:"` digest entries
 * summarizing world events, promotions, and rivalries that fired during elapsed time.
 *
 * @param state Current immutable GameState.
 * @param summaryEvents Digest lines emitted during bulk time progression.
 * @param verb Action label (`'rested'` or `'waited'`).
 * @returns Updated GameState.
 */
export function finalizeBulkTimeEventsAndRespawn(
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
 * Finalizes a completed or interrupted bulk wait-until-phase operation by triggering active-area
 * lazy respawn, logging `"While you waited:"` digests, and emitting the completion/interruption notice.
 *
 * @param bulkRes Completed or interrupted bulk time progression result.
 * @param targetPhaseId Target diurnal clock phase identifier.
 * @returns Updated GameState.
 */
export function finalizeWaitUntilPhase(bulkRes: BulkTimeAdvanceResult, targetPhaseId: string): GameState {
  const nextState = finalizeBulkTimeEventsAndRespawn(bulkRes.state, bulkRes.summaryEvents, 'waited');
  if (bulkRes.interruptedReason !== undefined) {
    return addMessage(
      nextState,
      `Waiting interrupted at ${formatWorldClockShort(readWorldClock(nextState))}: ${bulkRes.interruptedReason}`,
      MessageLogCategory.System
    );
  }
  const phaseLabel = getClockPhaseLabel(nextState, targetPhaseId);
  return addMessage(
    nextState,
    `Waited until ${phaseLabel}. It is now ${formatWorldClockShort(readWorldClock(nextState))}.`,
    MessageLogCategory.System
  );
}

/**
 * Waits synchronously until the next occurrence of `targetPhaseId` (from `rules.worldClock.waitTargets`),
 * advancing world time and macro simulations in bulk unless unsafe or interrupted.
 *
 * @param state Current immutable GameState.
 * @param playerId Player EntityId.
 * @param targetPhaseId Target diurnal clock phase identifier.
 * @returns Updated GameState.
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
  return finalizeWaitUntilPhase(bulkRes, targetPhaseId);
}
