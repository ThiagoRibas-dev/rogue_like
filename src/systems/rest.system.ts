/**
 * @file Ruleset-agnostic party rest safety evaluation, watch-chunked camp ambush resolution,
 * sleeping actor awareness, bulk time-skip world-event digesting, and wait-until-diurnal-phase
 * simulation primitives for any RPG ruleset cartridge.
 */

import { ROUNDS_PER_HOUR } from '../constants/world_clock.constants.ts';
import { addComponent, getComponent, spawnEntity } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import { getRuleset } from '../rulesets/registry.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type HungerComponent,
  type InventoryComponent,
  type ItemComponent,
  type LightEmitterComponent,
  type PositionComponent,
  type StatusEffectsComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { getPlayerCompanions } from './companion_commands.system.ts';
import { queryActiveFieldsAtPosition } from './field.system.ts';
import { getHungerState, HungerState } from './hunger.system.ts';
import { isPositionIlluminatedByActiveLightEmitter } from './light_emitter.system.ts';
import { triggerActiveAreaRespawnIfDue } from './map/map_wake_respawn.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import {
  computeTurnsUntilPhase,
  formatWorldClockShort,
  getClockPhaseLabel,
  isActorThreatenedByVisibleHostiles,
  readWorldClock,
  resolveAreaRestPressure
} from './world_clock.system.ts';
import { advanceWorldTimeBulk, advanceWorldTimeBulkAsync, type BulkTimeAdvanceResult } from './world_time_skip.ts';

/** Maximum world event summary lines appended to the message log after resting or waiting. */
const MAX_REST_DIGEST_LINES = 5;

/** Declarative tag identifying camp bedding/shelter items (`bedroll`, `winter_blanket`, `tent`). */
const CAMP_GEAR_TAG = 'camp_gear';

/** Declarative tag identifying carried light source items (`torch`, `hooded_lantern`, `bullseye_lantern`). */
const LIGHT_SOURCE_TAG = 'light_source';

/** Declarative tag identifying active campfire spatial fields. */
const CAMP_FIRE_TAG = 'campfire';

/** Ambush chance reduction granted per distinct camp gear item carried by the party (`3%`). */
const CAMP_GEAR_RISK_REDUCTION_PER_ITEM = 0.03;

/** Maximum cumulative ambush chance reduction from camp gear (`9%`). */
const MAX_CAMP_GEAR_RISK_REDUCTION = 0.09;

/** Additional ambush chance reduction granted by an active camp light or campfire (`3%`). */
const CAMP_LIGHT_RISK_REDUCTION = 0.03;

/** Default watch perception Spot/Listen DC to detect an approaching camp ambush before surprise (`15`). */
export const DEFAULT_WATCH_AMBUSH_SPOT_DC = 15;

/** D&D 3.5e Listen check penalty applied while an actor is sleeping (`-10`). */
export const SLEEPING_AWARENESS_PENALTY = -10;

/** Canonical status effect ID representing a sleeping actor (`'sleeping'`). */
export const SLEEPING_STATUS_ID = 'sleeping';

/** Minimum Chebyshev tile distance from the player when spawning a camp ambush patrol (`2`). */
const AMBUSH_SPAWN_MIN_DIST = 2;

/** Maximum Chebyshev tile distance from the player when spawning a camp ambush patrol (`6`). */
const AMBUSH_SPAWN_MAX_DIST = 6;

/** Fallback d20 die sides (`20`). */
const D20_SIDES = 20;

/** Result of evaluating whether an actor and active party can safely rest, camp, or prepare actions. */
interface RestSafetyEvaluation {
  readonly safe: boolean;
  readonly reason?: string | undefined;
}

/** Summary of a party's camp preparedness from carried bedding/shelter gear and lighting. */
export interface CampPreparednessEvaluation {
  readonly campGearCount: number;
  readonly hasCampLight: boolean;
  readonly ambushRiskReduction: number;
}

/** Result of evaluating the highest watch awareness check across the party during a camp watch shift. */
export interface WatchAwarenessResult {
  readonly bestWatcherId: EntityId;
  readonly bestModifier: number;
  readonly naturalRoll: number;
  readonly totalRoll: number;
  readonly dc: number;
  readonly detectedAmbush: boolean;
}

/** Result of evaluating a single camp watch shift for wandering patrol ambushes. */
export interface WatchAmbushCycleResult {
  readonly state: GameState;
  readonly ambushed: boolean;
  readonly surprised: boolean;
  readonly effectiveAmbushChance: number;
  readonly spawnedEntityIds: ReadonlyArray<EntityId>;
  readonly watchAwareness?: WatchAwarenessResult | undefined;
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
 * Evaluates a party's camp preparedness by scanning inventory and equipped items across the player
 * and controlled companions for declarative `camp_gear` (`bedroll`, `winter_blanket`, `tent`) and
 * `light_source` tags or nearby `campfire` fields.
 *
 * @param state Current immutable GameState.
 * @param playerId Player EntityId.
 * @returns Structured `CampPreparednessEvaluation`.
 */
export function evaluatePartyCampPreparedness(state: GameState, playerId: EntityId): CampPreparednessEvaluation {
  const partyIds = Array.from(new Set<EntityId>([playerId, ...getPlayerCompanions(state, playerId)]));
  const distinctCampGearIds = new Set<string>();
  let hasCampLight = false;

  for (const actorId of partyIds) {
    const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
    const eq = getComponent(state, actorId, ComponentType.Equipment) as EquipmentComponent | undefined;
    const itemEntityIds: EntityId[] = [...(inv?.items ?? [])];
    for (const slot of eq?.slots ?? []) {
      if (slot.equippedItem !== null) {
        itemEntityIds.push(slot.equippedItem);
      }
    }

    for (const itemEntId of itemEntityIds) {
      const itemComp = getComponent(state, itemEntId, ComponentType.Item) as ItemComponent | undefined;
      if (!itemComp) continue;
      const itemDef = state.campaign.items[itemComp.itemId];
      const tags = itemDef?.tags ?? [];
      if (tags.includes(CAMP_GEAR_TAG)) {
        distinctCampGearIds.add(itemComp.itemId);
      }
      if (tags.includes(LIGHT_SOURCE_TAG)) {
        const emitter = getComponent(state, itemEntId, ComponentType.LightEmitter) as LightEmitterComponent | undefined;
        if (emitter !== undefined && emitter.isLit && (emitter.fuelTurns === undefined || emitter.fuelTurns > 0)) {
          hasCampLight = true;
        }
      }
    }

    const pos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
    if (pos && !hasCampLight) {
      if (isPositionIlluminatedByActiveLightEmitter(state, pos.x, pos.y)) {
        hasCampLight = true;
      } else {
        for (const activeField of queryActiveFieldsAtPosition(state, pos.x, pos.y)) {
          if (activeField.field.fieldType.includes(CAMP_FIRE_TAG)) {
            hasCampLight = true;
          }
        }
      }
    }
  }

  const campGearCount = distinctCampGearIds.size;
  const gearReduction = Math.min(MAX_CAMP_GEAR_RISK_REDUCTION, campGearCount * CAMP_GEAR_RISK_REDUCTION_PER_ITEM);
  const lightReduction = hasCampLight ? CAMP_LIGHT_RISK_REDUCTION : 0;

  return {
    campGearCount,
    hasCampLight,
    ambushRiskReduction: gearReduction + lightReduction
  };
}

/**
 * Evaluates the party's highest watch awareness (`spot` / `listen` skill modifier via the active ruleset)
 * against a watch ambush DC.
 *
 * @param state Current immutable GameState.
 * @param playerId Player EntityId.
 * @param dc Target watch perception DC (defaults to `15`).
 * @param forcedD20 Optional deterministic d20 roll override (`1..20`).
 * @returns `WatchAwarenessResult`.
 */
export function evaluateHighestPartyWatchAwareness(
  state: GameState,
  playerId: EntityId,
  dc = DEFAULT_WATCH_AMBUSH_SPOT_DC,
  forcedD20?: number
): WatchAwarenessResult {
  const ruleset = getRuleset(state.campaign?.manifest?.rulesetId);
  const partyIds = Array.from(new Set<EntityId>([playerId, ...getPlayerCompanions(state, playerId)]));

  let bestWatcherId = playerId;
  let bestModifier = -Infinity;

  for (const actorId of partyIds) {
    const spotMod = ruleset.getActorSkillModifier ? ruleset.getActorSkillModifier(state, actorId, 'spot') : 0;
    const listenMod = ruleset.getActorSkillModifier ? ruleset.getActorSkillModifier(state, actorId, 'listen') : 0;
    const candidateMod = Math.max(spotMod, listenMod);
    if (candidateMod > bestModifier) {
      bestModifier = candidateMod;
      bestWatcherId = actorId;
    }
  }

  if (!Number.isFinite(bestModifier)) {
    bestModifier = 0;
  }

  const naturalRoll =
    forcedD20 !== undefined
      ? Math.max(1, Math.min(D20_SIDES, Math.floor(forcedD20)))
      : Math.floor(rng.getUniform() * D20_SIDES) + 1;
  const totalRoll = naturalRoll + bestModifier;

  return {
    bestWatcherId,
    bestModifier,
    naturalRoll,
    totalRoll,
    dc,
    detectedAmbush: totalRoll >= dc
  };
}

/**
 * Selects a hostile creature template from the active area's encounter profile / campaign spawn weights
 * and spawns a wandering ambush patrol on a walkable tile near `targetEntityId`.
 *
 * @param state Current immutable GameState.
 * @param targetEntityId Camp anchor entity ID (usually the player).
 * @returns Updated GameState and spawned patrol EntityIds.
 */
export function spawnCampAmbushPatrol(
  state: GameState,
  targetEntityId: EntityId
): { readonly state: GameState; readonly spawnedEntityIds: ReadonlyArray<EntityId> } {
  const targetPos = getComponent(state, targetEntityId, ComponentType.Position) as PositionComponent | undefined;
  if (!targetPos) {
    return { state, spawnedEntityIds: [] };
  }

  const candidateTemplates: string[] = [];
  for (const [tid, weight] of Object.entries(state.campaign.rules.spawning.spawnWeights ?? {})) {
    const tpl = state.campaign.entities[tid];
    if (weight > 0 && tpl?.isActor && tpl.fighter && tpl.faction !== 'player') {
      candidateTemplates.push(tid);
    }
  }
  if (candidateTemplates.length === 0) {
    for (const [tid, tpl] of Object.entries(state.campaign.entities)) {
      if (tid !== 'player' && tpl.isActor && tpl.fighter && tpl.faction === 'monster') {
        candidateTemplates.push(tid);
      }
    }
  }

  const chosenTemplateId = candidateTemplates[0];
  if (!chosenTemplateId) {
    return { state, spawnedEntityIds: [] };
  }

  const candidateCoords: Array<{ readonly x: number; readonly y: number }> = [];
  for (let dy = -AMBUSH_SPAWN_MAX_DIST; dy <= AMBUSH_SPAWN_MAX_DIST; dy++) {
    for (let dx = -AMBUSH_SPAWN_MAX_DIST; dx <= AMBUSH_SPAWN_MAX_DIST; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (dist < AMBUSH_SPAWN_MIN_DIST || dist > AMBUSH_SPAWN_MAX_DIST) continue;
      const tx = targetPos.x + dx;
      const ty = targetPos.y + dy;
      if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) continue;
      const tile = state.map.tiles[coordToIndex(tx, ty, state.map.width)];
      if (!tile || !state.campaign.tiles[tile.tileId]?.walkable) continue;
      const occupants = state.spatialIndex.get(`${tx},${ty}`) ?? [];
      if (occupants.some((id) => getComponent(state, id, ComponentType.Fighter) !== undefined)) continue;
      candidateCoords.push({ x: tx, y: ty });
    }
  }

  if (candidateCoords.length === 0) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const tx = targetPos.x + dx;
        const ty = targetPos.y + dy;
        if (tx < 0 || tx >= state.map.width || ty < 0 || ty >= state.map.height) continue;
        const tile = state.map.tiles[coordToIndex(tx, ty, state.map.width)];
        if (!tile || !state.campaign.tiles[tile.tileId]?.walkable) continue;
        const occupants = state.spatialIndex.get(`${tx},${ty}`) ?? [];
        if (occupants.some((id) => getComponent(state, id, ComponentType.Fighter) !== undefined)) continue;
        candidateCoords.push({ x: tx, y: ty });
      }
    }
  }

  const spawnCoord = candidateCoords[0];
  if (!spawnCoord) {
    return { state, spawnedEntityIds: [] };
  }

  const [nextState, spawnedId] = spawnEntity(state, chosenTemplateId, spawnCoord.x, spawnCoord.y);
  return {
    state: nextState,
    spawnedEntityIds: [spawnedId]
  };
}

/**
 * Evaluates a single camp watch shift for a wandering patrol ambush using the active area's
 * `RestPressureConfig` ("Doom Clock") and the party's `CampPreparednessEvaluation`.
 * When an ambush occurs, spawns a hostile patrol, rolls the party's highest watch perception check,
 * and invokes `ruleset.onAmbushSurprise` (`flat_footed`) on the party if the watch check fails.
 *
 * @param state Current immutable GameState.
 * @param playerId Player EntityId.
 * @param forcedAmbushRoll Optional deterministic `[0, 1)` roll override for ambush occurrence.
 * @param forcedWatchD20 Optional deterministic `1..20` d20 roll override for the watch Spot/Listen check.
 * @returns Structured `WatchAmbushCycleResult`.
 */
export function resolveWatchAmbushCycle(
  state: GameState,
  playerId: EntityId,
  forcedAmbushRoll?: number,
  forcedWatchD20?: number
): WatchAmbushCycleResult {
  const pressure = resolveAreaRestPressure(state);
  if (pressure.safeRest || pressure.ambushChancePerWatch <= 0) {
    return {
      state,
      ambushed: false,
      surprised: false,
      effectiveAmbushChance: 0,
      spawnedEntityIds: []
    };
  }

  const preparedness = evaluatePartyCampPreparedness(state, playerId);
  const effectiveAmbushChance = Math.max(
    0,
    Math.min(1, pressure.ambushChancePerWatch - preparedness.ambushRiskReduction)
  );
  const roll = forcedAmbushRoll !== undefined ? forcedAmbushRoll : rng.getUniform();

  if (roll >= effectiveAmbushChance || effectiveAmbushChance <= 0) {
    return {
      state,
      ambushed: false,
      surprised: false,
      effectiveAmbushChance,
      spawnedEntityIds: []
    };
  }

  const spawned = spawnCampAmbushPatrol(state, playerId);
  if (spawned.spawnedEntityIds.length === 0) {
    return {
      state,
      ambushed: false,
      surprised: false,
      effectiveAmbushChance,
      spawnedEntityIds: []
    };
  }

  let nextState = spawned.state;
  const watchAwareness = evaluateHighestPartyWatchAwareness(
    nextState,
    playerId,
    DEFAULT_WATCH_AMBUSH_SPOT_DC,
    forcedWatchD20
  );
  const surprised = !watchAwareness.detectedAmbush;

  if (surprised) {
    const partyIds = Array.from(new Set<EntityId>([playerId, ...getPlayerCompanions(nextState, playerId)]));
    const ruleset = getRuleset(nextState.campaign?.manifest?.rulesetId);
    if (ruleset.onAmbushSurprise) {
      nextState = ruleset.onAmbushSurprise(nextState, partyIds);
    }
    nextState = addMessage(
      nextState,
      `Camp Ambush! Sentry watch failed (Perception ${watchAwareness.totalRoll} vs DC ${watchAwareness.dc}) — your party is caught flat-footed!`,
      MessageLogCategory.CombatHit
    );
  } else {
    nextState = addMessage(
      nextState,
      `Camp Ambush! Your sentry spots the approaching patrol in time (Perception ${watchAwareness.totalRoll} vs DC ${watchAwareness.dc})!`,
      MessageLogCategory.System
    );
  }

  return {
    state: nextState,
    ambushed: true,
    surprised,
    effectiveAmbushChance,
    spawnedEntityIds: spawned.spawnedEntityIds,
    watchAwareness
  };
}

/**
 * Evaluates whether a sleeping actor (NPC, monster, or player with the `'sleeping'` status effect)
 * hears a nearby disturbance (`Listen` check with a `-10` sleeping penalty) and wakes up.
 * If the check fails, the sleeper remains asleep and is marked surprised (`ruleset.onAmbushSurprise`).
 *
 * @param state Current immutable GameState.
 * @param sleeperId Sleeping actor EntityId.
 * @param dc Noise or stealth DC to wake up (defaults to `15`).
 * @param forcedD20 Optional deterministic `1..20` d20 roll override.
 * @returns Updated GameState and whether the sleeper woke up.
 */
export function evaluateSleepingActorAwareness(
  state: GameState,
  sleeperId: EntityId,
  dc = DEFAULT_WATCH_AMBUSH_SPOT_DC,
  forcedD20?: number
): { readonly state: GameState; readonly wokeUp: boolean; readonly totalRoll: number } {
  const ruleset = getRuleset(state.campaign?.manifest?.rulesetId);
  const baseListen = ruleset.getActorSkillModifier ? ruleset.getActorSkillModifier(state, sleeperId, 'listen') : 0;
  const statusComp = getComponent(state, sleeperId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  const isSleeping = statusComp?.activeEffects.some((e) => e.effectId === SLEEPING_STATUS_ID) ?? false;
  const effectiveMod = baseListen + (isSleeping ? SLEEPING_AWARENESS_PENALTY : 0);

  const naturalRoll =
    forcedD20 !== undefined
      ? Math.max(1, Math.min(D20_SIDES, Math.floor(forcedD20)))
      : Math.floor(rng.getUniform() * D20_SIDES) + 1;
  const totalRoll = naturalRoll + effectiveMod;

  if (totalRoll >= dc) {
    return {
      state: wakeSleepingActor(state, sleeperId),
      wokeUp: true,
      totalRoll
    };
  }

  const nextState = ruleset.onAmbushSurprise ? ruleset.onAmbushSurprise(state, [sleeperId]) : state;
  return {
    state: nextState,
    wokeUp: false,
    totalRoll
  };
}

/**
 * Wakes a sleeping actor by removing the `'sleeping'` status effect.
 *
 * @param state Current immutable GameState.
 * @param sleeperId Actor EntityId to wake.
 * @returns Updated GameState.
 */
export function wakeSleepingActor(state: GameState, sleeperId: EntityId): GameState {
  const statusComp = getComponent(state, sleeperId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  if (!statusComp) return state;
  const filtered = statusComp.activeEffects.filter((e) => e.effectId !== SLEEPING_STATUS_ID);
  if (filtered.length === statusComp.activeEffects.length) return state;
  return addComponent(state, sleeperId, { ...statusComp, activeEffects: filtered });
}

/**
 * Executes a long rest synchronously in watch-duration chunks (`RestPressureConfig.watchDurationHours`),
 * rolling camp watch ambush checks between chunks in non-safe areas and aborting cleanly with partial
 * elapsed time if an ambush or environmental hazard interrupts the rest.
 *
 * @param state Current immutable GameState.
 * @param playerId Player EntityId.
 * @param totalTurns Total rest duration in turns (e.g. `4800` for 8 hours).
 * @param shouldInterrupt Optional per-cadence safety callback.
 * @param forcedAmbushRollPerWatch Optional deterministic `[0, 1)` roll override for watch ambush tests.
 * @param forcedWatchD20 Optional deterministic `1..20` d20 roll override for sentry watch perception tests.
 * @returns Combined `BulkTimeAdvanceResult`.
 */
export function executeWatchChunkedBulkRest(
  state: GameState,
  playerId: EntityId,
  totalTurns: number,
  shouldInterrupt?: (currentState: GameState) => string | undefined,
  forcedAmbushRollPerWatch?: number,
  forcedWatchD20?: number
): BulkTimeAdvanceResult {
  const pressure = resolveAreaRestPressure(state);
  if (pressure.safeRest || pressure.ambushChancePerWatch <= 0) {
    return advanceWorldTimeBulk(state, totalTurns, playerId, shouldInterrupt);
  }

  const watchTurns = Math.max(1, pressure.watchDurationHours * ROUNDS_PER_HOUR);
  let nextState = state;
  let remaining = totalTurns;
  let totalAdvanced = 0;
  const allSummaries: string[] = [];

  while (remaining > 0) {
    const chunkTurns = Math.min(watchTurns, remaining);
    const chunkRes = advanceWorldTimeBulk(nextState, chunkTurns, playerId, shouldInterrupt);
    nextState = chunkRes.state;
    totalAdvanced += chunkRes.turnsAdvanced;
    for (const s of chunkRes.summaryEvents) {
      if (!allSummaries.includes(s)) allSummaries.push(s);
    }
    remaining -= chunkRes.turnsAdvanced;

    if (chunkRes.interruptedReason !== undefined) {
      return {
        state: nextState,
        turnsAdvanced: totalAdvanced,
        summaryEvents: allSummaries,
        interruptedReason: chunkRes.interruptedReason
      };
    }

    const ambushRes = resolveWatchAmbushCycle(nextState, playerId, forcedAmbushRollPerWatch, forcedWatchD20);
    nextState = ambushRes.state;
    if (ambushRes.ambushed) {
      return {
        state: nextState,
        turnsAdvanced: totalAdvanced,
        summaryEvents: allSummaries,
        interruptedReason: 'Your camp was ambushed during watch!'
      };
    }
  }

  return {
    state: nextState,
    turnsAdvanced: totalAdvanced,
    summaryEvents: allSummaries
  };
}

/**
 * Asynchronous variant of `executeWatchChunkedBulkRest` for browser UI loading overlays.
 */
export async function executeWatchChunkedBulkRestAsync(
  state: GameState,
  playerId: EntityId,
  totalTurns: number,
  onProgress?: (fraction: number) => void,
  shouldInterrupt?: (currentState: GameState) => string | undefined
): Promise<BulkTimeAdvanceResult> {
  const pressure = resolveAreaRestPressure(state);
  if (pressure.safeRest || pressure.ambushChancePerWatch <= 0) {
    return advanceWorldTimeBulkAsync(state, totalTurns, playerId, onProgress, shouldInterrupt);
  }

  const watchTurns = Math.max(1, pressure.watchDurationHours * ROUNDS_PER_HOUR);
  let nextState = state;
  let remaining = totalTurns;
  let totalAdvanced = 0;
  const allSummaries: string[] = [];

  while (remaining > 0) {
    const chunkTurns = Math.min(watchTurns, remaining);
    const startCompleted = totalAdvanced;
    const chunkRes = await advanceWorldTimeBulkAsync(
      nextState,
      chunkTurns,
      playerId,
      (chunkFraction) => {
        const overall = (startCompleted + chunkFraction * chunkTurns) / Math.max(1, totalTurns);
        onProgress?.(Math.min(1, overall));
      },
      shouldInterrupt
    );
    nextState = chunkRes.state;
    totalAdvanced += chunkRes.turnsAdvanced;
    for (const s of chunkRes.summaryEvents) {
      if (!allSummaries.includes(s)) allSummaries.push(s);
    }
    remaining -= chunkRes.turnsAdvanced;

    if (chunkRes.interruptedReason !== undefined) {
      return {
        state: nextState,
        turnsAdvanced: totalAdvanced,
        summaryEvents: allSummaries,
        interruptedReason: chunkRes.interruptedReason
      };
    }

    const ambushRes = resolveWatchAmbushCycle(nextState, playerId);
    nextState = ambushRes.state;
    if (ambushRes.ambushed) {
      return {
        state: nextState,
        turnsAdvanced: totalAdvanced,
        summaryEvents: allSummaries,
        interruptedReason: 'Your camp was ambushed during watch!'
      };
    }
  }

  return {
    state: nextState,
    turnsAdvanced: totalAdvanced,
    summaryEvents: allSummaries
  };
}

/**
 * Triggers active area lazy respawn if due and logs `"While you <verb>:"` digest entries
 * summarizing world events, promotions, schemes, and rivalries that fired during elapsed time.
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
