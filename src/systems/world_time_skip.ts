import {
  BULK_CADENCE_STEP_SIZE,
  BULK_REST_CHUNK_TURNS,
  STANDARD_ENERGY_PER_TURN
} from '../constants/world_clock.constants.ts';
import {
  DRAMA_BUDGET_REGEN_PER_TURN,
  MAX_GLOBAL_DRAMA_BUDGET,
  WORLD_EVENT_TICK_INTERVAL
} from '../constants/pacing.constants.ts';
import {
  LOCAL_NARRATIVE_TICK_INTERVAL,
  NEMESIS_EVALUATION_INTERVAL,
  RIVALRY_EVALUATION_INTERVAL
} from '../constants/scheduler.constants.ts';
import { addComponent, getComponent, removeEntity } from '../core/ecs.ts';
import { tickControllerLinksAndOverlays } from '../core/ecs/ecs_lifecycle.ts';
import { ComponentType, type FieldComponent, type StatusEffectsComponent } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { cullStaleAndConfirmedRumors, processRumorPropagationEvents, tickPendingRumors } from './gossip.system.ts';
import { processHungerTick } from './hunger.system.ts';
import { processKnowledgePropagationEvents, tickPendingKnowledge } from './knowledge.system.ts';
import { processNemesisSystem } from './nemesis.system.ts';
import { processPersonalitySystem } from './personality.system.ts';
import { processRivalries } from './rivalry.system.ts';
import { applyElapsedWorldHours } from './world_clock.system.ts';
import { processWorldEvents } from './world_events.system.ts';

/** Result returned after advancing world time in bulk (for rest or waiting). */
export interface BulkTimeAdvanceResult {
  readonly state: GameState;
  readonly turnsAdvanced: number;
  readonly summaryEvents: ReadonlyArray<string>;
  readonly interruptedReason?: string | undefined;
}

/**
 * Fast-forwards active durations (`StatusEffectsComponent`, `FieldComponent`, `PropertyOverlayComponent`,
 * and temporary `ControllerLinkComponent` summons) in O(entities) when advancing time in bulk.
 */
function fastForwardEntityDurations(state: GameState, turnsElapsed: number): GameState {
  if (turnsElapsed <= 0) return state;
  let nextState = state;
  let fovNeedsUpdate = false;

  for (const entityId of [...nextState.entities]) {
    const statusCmp = getComponent(nextState, entityId, ComponentType.StatusEffects) as
      StatusEffectsComponent | undefined;
    if (statusCmp && statusCmp.activeEffects.length > 0) {
      const remaining = statusCmp.activeEffects
        .map((eff) => ({ ...eff, duration: eff.duration - turnsElapsed }))
        .filter((eff) => eff.duration > 0);
      if (remaining.length !== statusCmp.activeEffects.length || remaining.length > 0) {
        nextState = addComponent(nextState, entityId, { ...statusCmp, activeEffects: remaining });
      }
    }

    const fieldCmp = getComponent(nextState, entityId, ComponentType.Field) as FieldComponent | undefined;
    if (fieldCmp) {
      const remainingDur = fieldCmp.duration - turnsElapsed;
      if (remainingDur <= 0) {
        const def = nextState.campaign.fields[fieldCmp.fieldType];
        if (def?.blocksSight) fovNeedsUpdate = true;
        nextState = removeEntity(nextState, entityId);
        continue;
      }
      nextState = addComponent(nextState, entityId, { ...fieldCmp, duration: remainingDur });
    }
  }

  nextState = tickControllerLinksAndOverlays(nextState, turnsElapsed);
  return fovNeedsUpdate ? { ...nextState, fovNeedsUpdate: true } : nextState;
}

/**
 * Executes a single GCD-aligned macro-cadence step of up to `BULK_CADENCE_STEP_SIZE` turns,
 * evaluating Narrative, Nemesis, Rivalry, and World Events on their exact interval multiples
 * and capturing newly emitted world event summaries.
 */
function stepBulkMacroCadence(
  state: GameState,
  stepTurns: number,
  collectedSummaries: string[],
  seenEventIds: Set<string>
): GameState {
  const prevTurn = state.globalTurn || 0;
  const targetTurn = prevTurn + stepTurns;
  const prevBudget = state.dramaTracker.globalBudget;
  const nextBudget = Math.min(MAX_GLOBAL_DRAMA_BUDGET, prevBudget + stepTurns * DRAMA_BUDGET_REGEN_PER_TURN);

  let nextState: GameState = {
    ...state,
    globalTurn: targetTurn,
    dramaTracker: {
      ...state.dramaTracker,
      globalBudget: nextBudget
    }
  };

  for (let t = prevTurn + 1; t <= targetTurn; t++) {
    let stepped = nextState.globalTurn === t ? nextState : { ...nextState, globalTurn: t };

    if (t % LOCAL_NARRATIVE_TICK_INTERVAL === 0) {
      stepped = tickPendingKnowledge(stepped);
      stepped = tickPendingRumors(stepped);
      stepped = cullStaleAndConfirmedRumors(stepped);
      stepped = processPersonalitySystem(stepped);
    }
    if (t % NEMESIS_EVALUATION_INTERVAL === 0) {
      stepped = processNemesisSystem(stepped);
    }
    if (t % RIVALRY_EVALUATION_INTERVAL === 0) {
      stepped = processRivalries(stepped);
    }
    if (t % WORLD_EVENT_TICK_INTERVAL === 0) {
      stepped = processWorldEvents(stepped);
    }

    if (stepped.events.length > 0) {
      stepped = processKnowledgePropagationEvents(stepped);
      stepped = processRumorPropagationEvents(stepped);
      for (const evt of stepped.events) {
        if (!evt.summary) continue;
        const evtKey = evt.id ?? evt.summary;
        if (!seenEventIds.has(evtKey)) {
          seenEventIds.add(evtKey);
          collectedSummaries.push(evt.summary);
        }
      }
      stepped = { ...stepped, events: [] };
    }
    nextState = stepped;
  }

  const finalizedTurnState = nextState.globalTurn === targetTurn ? nextState : { ...nextState, globalTurn: targetTurn };
  return applyElapsedWorldHours(finalizedTurnState, prevTurn, targetTurn);
}

/**
 * Advances world time synchronously by `turns`:
 * 1. Advances `globalTurn`, Drama Budget, and Tier 2/3 macro simulations (`Nemesis`, `Rivalry`, `World Events`, `Rumors`).
 * 2. Fast-forwards status/field/overlay/summon durations in O(entities).
 * 3. Applies normal hunger progression (`rules.hunger.satiationLossPerStandardTurn`) for the player.
 * 4. Aborts cleanly if `shouldInterrupt` returns a non-empty interruption reason.
 */
export function advanceWorldTimeBulk(
  state: GameState,
  turns: number,
  playerId?: EntityId,
  shouldInterrupt?: (currentState: GameState) => string | undefined
): BulkTimeAdvanceResult {
  if (turns <= 0) {
    return { state, turnsAdvanced: 0, summaryEvents: [] };
  }

  const summaryEvents: string[] = [];
  const seenEventIds = new Set<string>();
  let nextState = state;
  let remaining = turns;
  let advanced = 0;
  let interruptedReason: string | undefined;

  while (remaining > 0) {
    const step = Math.min(BULK_CADENCE_STEP_SIZE, remaining);
    nextState = stepBulkMacroCadence(nextState, step, summaryEvents, seenEventIds);
    remaining -= step;
    advanced += step;

    const reason = shouldInterrupt?.(nextState);
    if (reason) {
      interruptedReason = reason;
      break;
    }
  }

  nextState = fastForwardEntityDurations(nextState, advanced);

  if (playerId !== undefined && advanced > 0) {
    nextState = processHungerTick(nextState, playerId, advanced * STANDARD_ENERGY_PER_TURN);
  }

  return {
    state: nextState,
    turnsAdvanced: advanced,
    summaryEvents,
    ...(interruptedReason !== undefined ? { interruptedReason } : {})
  };
}

/**
 * Asynchronous chunked variant of `advanceWorldTimeBulk` for browser UI overlays,
 * yielding once per `BULK_REST_CHUNK_TURNS` chunk so progress bars and cycling ellipses animate smoothly.
 */
export async function advanceWorldTimeBulkAsync(
  state: GameState,
  turns: number,
  playerId: EntityId | undefined,
  onProgress?: (fraction: number) => void,
  shouldInterrupt?: (currentState: GameState) => string | undefined
): Promise<BulkTimeAdvanceResult> {
  if (turns <= 0) {
    onProgress?.(1);
    return { state, turnsAdvanced: 0, summaryEvents: [] };
  }

  const summaryEvents: string[] = [];
  const seenEventIds = new Set<string>();
  let nextState = state;
  let completed = 0;
  let interruptedReason: string | undefined;

  while (completed < turns && interruptedReason === undefined) {
    const chunk = Math.min(BULK_REST_CHUNK_TURNS, turns - completed);
    let chunkRemaining = chunk;
    while (chunkRemaining > 0) {
      const step = Math.min(BULK_CADENCE_STEP_SIZE, chunkRemaining);
      nextState = stepBulkMacroCadence(nextState, step, summaryEvents, seenEventIds);
      chunkRemaining -= step;
      completed += step;

      const reason = shouldInterrupt?.(nextState);
      if (reason) {
        interruptedReason = reason;
        break;
      }
    }
    onProgress?.(Math.min(1, completed / turns));
    if (completed < turns && interruptedReason === undefined) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  nextState = fastForwardEntityDurations(nextState, completed);
  if (playerId !== undefined && completed > 0) {
    nextState = processHungerTick(nextState, playerId, completed * STANDARD_ENERGY_PER_TURN);
  }

  return {
    state: nextState,
    turnsAdvanced: completed,
    summaryEvents,
    ...(interruptedReason !== undefined ? { interruptedReason } : {})
  };
}
