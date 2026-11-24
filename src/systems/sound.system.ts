import { addComponent, getComponent } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import {
  ComponentType,
  type AIAlertnessState,
  type AIComponent,
  type FighterComponent,
  type LockComponent,
  type PositionComponent,
  type StatusEffectsComponent,
  type TacticalDoctrineComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import type { InteractionChain } from '../types/interaction_provenance.types.ts';
import { isHostile } from '../utils/faction.ts';
import { getTileDefAt, isInMapBounds, isTileKeyInFov } from '../map/map_accessor.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { SLEEPING_AWARENESS_PENALTY, SLEEPING_STATUS_ID, wakeSleepingActor } from './rest.system.ts';

/** Default sound attenuation (dB) per open walkable floor tile (`5` dB). */
export const DEFAULT_OPEN_TILE_SOUND_ATTENUATION = 5;

/** Default sound attenuation (dB) through a closed door or locked portal (`15` dB). */
export const DEFAULT_CLOSED_DOOR_SOUND_ATTENUATION = 15;

/** Default sound attenuation (dB) through a solid stone wall (`25` dB). */
export const DEFAULT_WALL_SOUND_ATTENUATION = 25;

/** Minimum received dB required to make an unaware listener `'suspicious'` (`5` dB). */
export const SOUND_SUSPICIOUS_THRESHOLD_DB = 5;

/** Minimum received dB required to escalate a listener directly to `'alerted'` (`25` dB). */
export const SOUND_ALERTED_THRESHOLD_DB = 25;

/** Default number of turns an AI retains acoustic alertness before stepping down (`10` turns). */
export const DEFAULT_ALERTNESS_DECAY_TURNS = 10;

/** Canonical sound intensity for quiet cautious movement (`15` dB). */
export const SOUND_DB_QUIET_STEP = 15;

/** Canonical sound intensity for normal walking movement (`25` dB). */
export const SOUND_DB_NORMAL_MOVE = 25;

/** Canonical sound intensity for active melee/spell combat (`45` dB). */
export const SOUND_DB_COMBAT = 45;

/** Canonical sound intensity for kicking/bashing a door (`60` dB). */
export const SOUND_DB_DOOR_KICK = 60;

/** Canonical sound intensity for a thunderstone or explosive detonation (`80` dB). */
export const SOUND_DB_THUNDERSTONE = 80;

/** Maximum BFS radius in tiles for a single acoustic ripple (`24` tiles). */
const MAX_SOUND_PROPAGATION_RADIUS_TILES = 24;

/** Baseline passive Listen DC when opposing an unstealthed sound at threshold volume (`10`). */
const BASE_LISTEN_DC = 10;

const CARDINAL_OFFSETS: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 }
];

/** Options configuring `emitSoundEvent` behavior and deterministic test hooks. */
export interface EmitSoundEventOptions {
  readonly cueLabel?: string | undefined;
  readonly stealthRoll?: number | undefined;
  readonly forcedListenerRolls?: Readonly<Record<string, number>> | undefined;
  readonly interaction?: InteractionChain | undefined;
}

/** Result returned by `emitSoundEvent`. */
export interface SoundEventResult {
  readonly state: GameState;
  readonly heardByEntityIds: ReadonlyArray<EntityId>;
  readonly soundMap: ReadonlyMap<string, number>;
}

/**
 * Resolves the acoustic attenuation (in dB) incurred when sound passes through tile `(x, y)`.
 * Uses explicit `TileDefinition.soundAttenuation` first, then checks for closed/locked doors,
 * then solid opaque walls, falling back to `DEFAULT_OPEN_TILE_SOUND_ATTENUATION`.
 *
 * @param state Current immutable GameState.
 * @param x Grid X coordinate.
 * @param y Grid Y coordinate.
 * @returns Acoustic attenuation in dB.
 */
export function resolveTileSoundAttenuation(state: Readonly<GameState>, x: number, y: number): number {
  if (!isInMapBounds(state.map, x, y)) {
    return DEFAULT_WALL_SOUND_ATTENUATION * 4;
  }
  const tileDef = getTileDefAt(state, x, y);
  if (tileDef?.soundAttenuation !== undefined) {
    return tileDef.soundAttenuation;
  }

  const entitiesAt = state.spatialIndex.get(`${x},${y}`) ?? [];
  for (const eid of entitiesAt) {
    const lock = getComponent(state, eid, ComponentType.Lock) as LockComponent | undefined;
    if (lock !== undefined && (lock.locked || lock.jammed === true)) {
      return DEFAULT_CLOSED_DOOR_SOUND_ATTENUATION;
    }
  }

  if (tileDef && !tileDef.walkable && !tileDef.transparent) {
    return DEFAULT_WALL_SOUND_ATTENUATION;
  }
  if (tileDef && !tileDef.walkable) {
    return DEFAULT_CLOSED_DOOR_SOUND_ATTENUATION;
  }
  return DEFAULT_OPEN_TILE_SOUND_ATTENUATION;
}

/**
 * Runs a bounded attenuation-weighted flood-fill from `(originX, originY)` at `dbLevel`,
 * returning a map of `"x,y"` keys to the strongest received acoustic intensity (`> 0` dB).
 *
 * @param state Current immutable GameState.
 * @param originX Sound origin X coordinate.
 * @param originY Sound origin Y coordinate.
 * @param dbLevel Initial acoustic intensity in dB.
 * @returns Map of reachable tile coordinates (`"x,y"`) to received dB.
 */
export function propagateSoundField(
  state: Readonly<GameState>,
  originX: number,
  originY: number,
  dbLevel: number
): Map<string, number> {
  const bestDb = new Map<string, number>();
  if (dbLevel <= 0 || !isInMapBounds(state.map, originX, originY)) {
    return bestDb;
  }

  const startKey = `${originX},${originY}`;
  bestDb.set(startKey, dbLevel);
  const queue: Array<{ x: number; y: number; db: number }> = [{ x: originX, y: originY, db: dbLevel }];

  while (queue.length > 0) {
    // Pick highest remaining dB entry (small bounded frontier <= 24 radius)
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i]!.db > queue[bestIdx]!.db) {
        bestIdx = i;
      }
    }
    const current = queue.splice(bestIdx, 1)[0]!;
    const known = bestDb.get(`${current.x},${current.y}`) ?? 0;
    if (current.db < known) continue;

    for (const off of CARDINAL_OFFSETS) {
      const nx = current.x + off.dx;
      const ny = current.y + off.dy;
      if (!isInMapBounds(state.map, nx, ny)) continue;
      if (
        Math.abs(nx - originX) > MAX_SOUND_PROPAGATION_RADIUS_TILES ||
        Math.abs(ny - originY) > MAX_SOUND_PROPAGATION_RADIUS_TILES
      ) {
        continue;
      }

      const attenuation = resolveTileSoundAttenuation(state, nx, ny);
      const nextDb = current.db - attenuation;
      if (nextDb <= 0) continue;

      const nextKey = `${nx},${ny}`;
      const prevBest = bestDb.get(nextKey) ?? 0;
      if (nextDb > prevBest) {
        bestDb.set(nextKey, nextDb);
        queue.push({ x: nx, y: ny, db: nextDb });
      }
    }
  }

  return bestDb;
}

/**
 * Translates a 2D vector `(dx, dy)` into a human-readable compass direction string.
 *
 * @param dx Target X minus listener X.
 * @param dy Target Y minus listener Y.
 * @returns Compass direction phrase (e.g., `'east'`, `'northwest'`, `'nearby'`).
 */
export function describeSoundDirection(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'nearby';
  const ns = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
  const ew = dx > 0 ? 'east' : dx < 0 ? 'west' : '';
  if (ns && ew) return `${ns}${ew}`;
  return ns || ew || 'nearby';
}

function resolveNextAlertnessState(current: AIAlertnessState | undefined, receivedDb: number): AIAlertnessState {
  if (receivedDb >= SOUND_ALERTED_THRESHOLD_DB) return 'alerted';
  if (current === 'alerted') return 'alerted';
  return 'suspicious';
}

function isActorSleeping(state: Readonly<GameState>, entityId: EntityId): boolean {
  const statusComp = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  return statusComp?.activeEffects.some((e) => e.effectId === SLEEPING_STATUS_ID) === true;
}

/**
 * Emits a Tier 1 acoustic ripple at `(originX, originY)` with intensity `dbLevel`.
 * - Propagates through walls and closed doors via `propagateSoundField`.
 * - Evaluates living listeners symmetrically:
 *   - Sleeping listeners suffer `SLEEPING_AWARENESS_PENALTY` (`-10` on `Listen`) and wake via `wakeSleepingActor` when they hear the sound.
 *   - Hostile/unaffiliated AI actors transition `unaware -> suspicious -> alerted` and record `lastHeardPos`.
 *   - The player receives directional sound cues in the message log when an unseen source makes noise outside FOV.
 *
 * @param state Current immutable GameState.
 * @param originX Sound origin X coordinate.
 * @param originY Sound origin Y coordinate.
 * @param dbLevel Initial acoustic intensity in dB.
 * @param sourceEntityId Optional emitting EntityId (excluded from hearing itself).
 * @param options Optional stealth roll opposition, cue label, and deterministic test rolls.
 * @returns `SoundEventResult` with updated state, alerted listener IDs, and acoustic field map.
 */
export function emitSoundEvent(
  state: GameState,
  originX: number,
  originY: number,
  dbLevel: number,
  sourceEntityId?: EntityId,
  options?: EmitSoundEventOptions
): SoundEventResult {
  const soundMap = propagateSoundField(state, originX, originY, dbLevel);
  if (soundMap.size === 0) {
    return { state, heardByEntityIds: [], soundMap };
  }

  const activeRuleset = getActiveRuleset(state);
  const sourceDoctrine =
    sourceEntityId !== undefined
      ? (getComponent(state, sourceEntityId, ComponentType.TacticalDoctrine) as TacticalDoctrineComponent | undefined)
      : undefined;
  const effectiveStealthRoll =
    options?.stealthRoll ??
    (sourceDoctrine?.stealth?.isStealthed === true ? sourceDoctrine.stealth.lastMoveSilentlyRoll : undefined);

  let nextState = state;
  const heardByEntityIds: EntityId[] = [];
  const isOriginVisibleToPlayer = isTileKeyInFov(state, originX, originY);

  for (const listenerId of state.entities) {
    if (listenerId === sourceEntityId) continue;
    const fighter = getComponent(nextState, listenerId, ComponentType.Fighter) as FighterComponent | undefined;
    const pos = getComponent(nextState, listenerId, ComponentType.Position) as PositionComponent | undefined;
    if (!fighter || fighter.hp <= 0 || !pos) continue;

    const receivedDb = soundMap.get(`${pos.x},${pos.y}`);
    if (receivedDb === undefined || receivedDb < SOUND_SUSPICIOUS_THRESHOLD_DB) continue;

    const sleeping = isActorSleeping(nextState, listenerId);
    let heard = true;
    if (effectiveStealthRoll !== undefined || sleeping) {
      const listenMod = activeRuleset.getActorSkillModifier?.(nextState, listenerId, 'listen') ?? 0;
      const forcedRoll = options?.forcedListenerRolls?.[String(listenerId)];
      const rawD20 = forcedRoll !== undefined ? forcedRoll : BASE_LISTEN_DC;
      const dbBonus = Math.floor((receivedDb - SOUND_SUSPICIOUS_THRESHOLD_DB) / 5);
      const sleepPenalty = sleeping ? SLEEPING_AWARENESS_PENALTY : 0;
      const targetDc = effectiveStealthRoll ?? BASE_LISTEN_DC;
      heard = rawD20 + listenMod + sleepPenalty + dbBonus >= targetDc;
    }

    if (!heard) continue;
    if (sleeping) {
      nextState = wakeSleepingActor(nextState, listenerId);
    }
    heardByEntityIds.push(listenerId);

    const isPlayer = getComponent(nextState, listenerId, ComponentType.Player) !== undefined;
    if (isPlayer) {
      if (!isOriginVisibleToPlayer) {
        const direction = describeSoundDirection(originX - pos.x, originY - pos.y);
        const cue = options?.cueLabel ?? (dbLevel >= SOUND_DB_COMBAT ? 'a loud commotion' : 'footsteps');
        nextState = addMessage(nextState, `You hear ${cue} to the ${direction}.`, MessageLogCategory.System);
      }
      continue;
    }

    const ai = getComponent(nextState, listenerId, ComponentType.AI) as AIComponent | undefined;
    if (!ai) continue;
    if (sourceEntityId !== undefined && !isHostile(nextState, listenerId, sourceEntityId)) {
      continue;
    }

    const nextAlertness = resolveNextAlertnessState(ai.alertnessState, receivedDb);
    nextState = addComponent(nextState, listenerId, {
      ...ai,
      alertnessState: nextAlertness,
      lastHeardPos: { x: originX, y: originY },
      alertnessDecayTurns: DEFAULT_ALERTNESS_DECAY_TURNS
    });
  }

  return { state: nextState, heardByEntityIds, soundMap };
}

function tickAIAlertnessDecaySingleTurn(state: GameState, entityId: EntityId): GameState {
  const ai = getComponent(state, entityId, ComponentType.AI) as AIComponent | undefined;
  if (!ai || ai.alertnessState === undefined || ai.alertnessState === 'unaware') {
    return state;
  }

  const remaining = (ai.alertnessDecayTurns ?? 0) - 1;
  if (remaining > 0) {
    return addComponent(state, entityId, {
      ...ai,
      alertnessDecayTurns: remaining
    });
  }

  if (ai.alertnessState === 'alerted') {
    return addComponent(state, entityId, {
      ...ai,
      alertnessState: 'suspicious',
      alertnessDecayTurns: Math.max(1, Math.floor(DEFAULT_ALERTNESS_DECAY_TURNS / 2))
    });
  }

  const { lastHeardPos: _clearedPos, alertnessDecayTurns: _clearedDecay, ...restAi } = ai;
  return addComponent(state, entityId, {
    ...restAi,
    alertnessState: 'unaware'
  });
}

/**
 * Advances `AIComponent.alertnessDecayTurns` across `turnsElapsed` turns, stepping
 * `'alerted' -> 'suspicious' -> 'unaware'` and clearing `lastHeardPos` once decayed.
 * Shared between normal Turn Start and bulk time advancement.
 *
 * @param state Current immutable GameState.
 * @param entityId AI actor EntityId.
 * @param turnsElapsed Number of elapsed turns.
 * @returns Updated GameState.
 */
export function advanceAIAlertnessDecayByTurns(state: GameState, entityId: EntityId, turnsElapsed: number): GameState {
  if (turnsElapsed <= 0) return state;
  let nextState = state;
  for (let step = 0; step < turnsElapsed; step++) {
    const ai = getComponent(nextState, entityId, ComponentType.AI) as AIComponent | undefined;
    if (!ai || ai.alertnessState === undefined || ai.alertnessState === 'unaware') break;
    nextState = tickAIAlertnessDecaySingleTurn(nextState, entityId);
  }
  return nextState;
}

/**
 * Ticks down `AIComponent.alertnessDecayTurns` at an AI actor's turn start, stepping
 * `'alerted' -> 'suspicious' -> 'unaware'` and clearing `lastHeardPos` once decayed.
 *
 * @param state Current immutable GameState.
 * @param entityId AI actor EntityId.
 * @returns Updated GameState.
 */
export function tickAIAlertnessDecay(state: GameState, entityId: EntityId): GameState {
  return advanceAIAlertnessDecayByTurns(state, entityId, 1);
}
