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
  RIVALRY_EVALUATION_INTERVAL,
  SCHEME_CADENCE_INTERVAL
} from '../constants/scheduler.constants.ts';
import { addComponent, getComponent, queryEntities, removeComponent } from '../core/ecs.ts';
import { tickControllerLinksAndOverlays } from '../core/ecs/ecs_lifecycle.ts';
import { ComponentType, type CoatingComponent, type FighterComponent } from '../types/components.types.ts';
import { type GameEvent, GameEventType } from '../types/events.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { advanceActorBreathByTurns } from './breath.system.ts';
import { tickCorpseDecay } from './corpse.system.ts';
import { advanceCrossingsByTurns } from './crossing.system.ts';
import { processDamageSystem } from './damage.system.ts';
import { processDeathSystem } from './death.system.ts';
import { advanceFieldsByTurns } from './field.system.ts';
import { cullStaleAndConfirmedRumors, processRumorPropagationEvents, tickPendingRumors } from './gossip.system.ts';
import { processHungerTick } from './hunger.system.ts';
import { processKnowledgePropagationEvents, tickPendingKnowledge } from './knowledge.system.ts';
import { advanceActorLightEmittersByTurns } from './light_emitter.system.ts';
import { processNemesisSystem } from './nemesis.system.ts';
import { processPersonalitySystem } from './personality.system.ts';
import { processRivalries } from './rivalry.system.ts';
import { processSchemeTurn } from './scheme.system.ts';
import { advanceAIAlertnessDecayByTurns } from './sound.system.ts';
import { advanceActorStatusEffectsByTurns } from './status-effect.system.ts';
import { applyElapsedWorldHours, resolveAreaRestPressure } from './world_clock.system.ts';
import { processWorldEvents } from './world_events.system.ts';

/** Result returned after advancing world time in bulk (for rest or waiting). */
export interface BulkTimeAdvanceResult {
  readonly state: GameState;
  readonly turnsAdvanced: number;
  readonly summaryEvents: ReadonlyArray<string>;
  readonly interruptedReason?: string | undefined;
}

/** Result returned by domain-shared local actor/world elapsed-time advancement. */
export interface ActorElapsedTimeResult {
  readonly state: GameState;
  readonly turnsAdvanced: number;
  readonly interruptedReason?: string | undefined;
}

function hasActivePerTurnLocalHazard(state: GameState): boolean {
  for (const entityId of state.entities) {
    if (getComponent(state, entityId, ComponentType.StatusEffects) !== undefined) return true;
    if (getComponent(state, entityId, ComponentType.Breath) !== undefined) return true;
    if (getComponent(state, entityId, ComponentType.Field) !== undefined) return true;
  }
  return false;
}

/**
 * Advances all local domain-owned elapsed-time resolvers across `turnsElapsed` turns:
 * - Actor status primary/secondary elapsed stages (`advanceActorStatusEffectsByTurns`)
 * - Actor breath/submersion countdown & drowning (`advanceActorBreathByTurns`)
 * - Light emitter fuel countdown & burnout (`advanceActorLightEmittersByTurns`)
 * - AI acoustic alertness decay (`advanceAIAlertnessDecayByTurns`)
 * - World temporary crossings (`advanceCrossingsByTurns`)
 * - Spatial fields (`advanceFieldsByTurns`)
 * - Corpse decay (`tickCorpseDecay`)
 * - Weapon coating durations (`CoatingComponent`)
 * - Passive overlays & temporary controller links (`tickControllerLinksAndOverlays`)
 * - Queued damage & death resolution (`processDamageSystem`, `processDeathSystem`)
 *
 * @param state Current immutable GameState.
 * @param turnsElapsed Number of turns elapsed in this step.
 * @returns Updated GameState.
 */
export function advanceLocalElapsedTimeByTurns(state: GameState, turnsElapsed: number): GameState {
  if (turnsElapsed <= 0) return state;
  let nextState = state;
  const entitySnapshot = [...nextState.entities];

  for (const entityId of entitySnapshot) {
    if (getComponent(nextState, entityId, ComponentType.StatusEffects) !== undefined) {
      nextState = advanceActorStatusEffectsByTurns(nextState, entityId, turnsElapsed);
    }
    if (getComponent(nextState, entityId, ComponentType.Breath) !== undefined) {
      nextState = advanceActorBreathByTurns(nextState, entityId, turnsElapsed);
    }
    if (
      getComponent(nextState, entityId, ComponentType.Player) !== undefined ||
      getComponent(nextState, entityId, ComponentType.Equipment) !== undefined ||
      getComponent(nextState, entityId, ComponentType.Inventory) !== undefined
    ) {
      nextState = advanceActorLightEmittersByTurns(nextState, entityId, turnsElapsed);
    }
    if (getComponent(nextState, entityId, ComponentType.AI) !== undefined) {
      nextState = advanceAIAlertnessDecayByTurns(nextState, entityId, turnsElapsed);
    }
    const coating = getComponent(nextState, entityId, ComponentType.Coating) as CoatingComponent | undefined;
    if (coating) {
      const nextDuration = coating.duration - turnsElapsed;
      if (nextDuration <= 0) {
        nextState = removeComponent(nextState, entityId, ComponentType.Coating);
      } else {
        nextState = addComponent(nextState, entityId, {
          ...coating,
          duration: nextDuration
        });
      }
    }
  }

  nextState = advanceCrossingsByTurns(nextState, turnsElapsed);
  nextState = advanceFieldsByTurns(nextState, turnsElapsed);
  nextState = tickCorpseDecay(nextState);
  nextState = tickControllerLinksAndOverlays(nextState, turnsElapsed);

  if (queryEntities(nextState, [ComponentType.Damage]).length > 0) {
    nextState = processDamageSystem(nextState);
    nextState = processDeathSystem(nextState);
  }

  return nextState;
}

function formatBulkEventSummary(evt: GameEvent): string | undefined {
  if (evt.summary) return evt.summary;
  if (evt.type === GameEventType.SchemeAdvanced) {
    const areaNote = evt.targetAreaId ? ` targeting ${evt.targetAreaId}` : '';
    return `Villain scheme "${evt.schemeId}" advanced to phase ${evt.newPhase}${areaNote}.`;
  }
  if (evt.type === GameEventType.SchemeMutatedArea) {
    return `Villain agents shifted conditions in ${evt.areaId}.`;
  }
  return undefined;
}

/**
 * Executes a single GCD-aligned macro-cadence step of up to `BULK_CADENCE_STEP_SIZE` turns,
 * evaluating Narrative, Nemesis, Rivalry, Scheme, and World Events on their interval multiples
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
  const schemeMult = resolveAreaRestPressure(state).schemeTickMultiplier;
  const effectiveSchemeInterval = schemeMult > 0 ? Math.max(1, Math.round(SCHEME_CADENCE_INTERVAL / schemeMult)) : 0;

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
    if (effectiveSchemeInterval > 0 && t % effectiveSchemeInterval === 0) {
      for (const mastermindId of queryEntities(stepped, [ComponentType.Scheme])) {
        stepped = processSchemeTurn(stepped, mastermindId);
      }
    }
    if (t % WORLD_EVENT_TICK_INTERVAL === 0) {
      stepped = processWorldEvents(stepped);
    }

    if (stepped.events.length > 0) {
      stepped = processKnowledgePropagationEvents(stepped);
      stepped = processRumorPropagationEvents(stepped);
      for (const evt of stepped.events) {
        const summary = formatBulkEventSummary(evt);
        if (!summary) continue;
        const evtKey = evt.id ?? summary;
        if (!seenEventIds.has(evtKey)) {
          seenEventIds.add(evtKey);
          collectedSummaries.push(summary);
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
 * 2. Advances domain-owned local elapsed-time resolvers (statuses, breath, light emitters, crossings, fields, alertness, corpses) on each step.
 * 3. Applies normal hunger progression (`rules.hunger.satiationLossPerStandardTurn`) for the player.
 * 4. Aborts cleanly if `shouldInterrupt` returns a non-empty interruption reason after any step.
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
    const stepCap = hasActivePerTurnLocalHazard(nextState) ? 1 : BULK_CADENCE_STEP_SIZE;
    const step = Math.min(stepCap, remaining);
    nextState = stepBulkMacroCadence(nextState, step, summaryEvents, seenEventIds);
    nextState = advanceLocalElapsedTimeByTurns(nextState, step);
    remaining -= step;
    advanced += step;

    const playerDeadReason =
      playerId !== undefined &&
      (nextState.isGameOver ||
        ((getComponent(nextState, playerId, ComponentType.Fighter) as FighterComponent | undefined)?.hp ?? 1) <= 0)
        ? 'You collapsed or died during the time skip!'
        : undefined;
    const reason = shouldInterrupt?.(nextState) ?? playerDeadReason;
    if (reason) {
      interruptedReason = reason;
      break;
    }
  }

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
      const stepCap = hasActivePerTurnLocalHazard(nextState) ? 1 : BULK_CADENCE_STEP_SIZE;
      const step = Math.min(stepCap, chunkRemaining);
      nextState = stepBulkMacroCadence(nextState, step, summaryEvents, seenEventIds);
      nextState = advanceLocalElapsedTimeByTurns(nextState, step);
      chunkRemaining -= step;
      completed += step;

      const playerDeadReason =
        playerId !== undefined &&
        (nextState.isGameOver ||
          ((getComponent(nextState, playerId, ComponentType.Fighter) as FighterComponent | undefined)?.hp ?? 1) <= 0)
          ? 'You collapsed or died during the time skip!'
          : undefined;
      const reason = shouldInterrupt?.(nextState) ?? playerDeadReason;
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
