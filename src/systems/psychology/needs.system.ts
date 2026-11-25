import {
  DEFAULT_NEED_VALUE,
  MAX_NEED_VALUE,
  MIN_NEED_VALUE,
  NEED_COMFORT_EXTREME_TEMP_DRAIN,
  NEED_COMFORT_FURNITURE_RECOVERY,
  NEED_COMFORT_IDEAL_FURNITURE_RECOVERY,
  NEED_CRITICAL_THRESHOLD,
  NEED_HIGH_THRESHOLD,
  NEED_INJURED_HP_RATIO,
  NEED_LOW_THRESHOLD,
  NEED_REST_BED_RECOVERY,
  NEED_SAFETY_SAFE_RECOVERY,
  NEED_SAFETY_THREAT_DRAIN,
  NEED_SHELTER_INDOOR_RECOVERY,
  NEED_SOCIAL_ALLY_RECOVERY,
  NEEDS_NEIGHBORHOOD_RADIUS,
  THOUGHT_MOOD_EXHAUSTED,
  THOUGHT_MOOD_EXTREME_TEMP,
  THOUGHT_MOOD_UNCOMFORTABLE,
  THOUGHT_MOOD_WELL_RESTED
} from '../../constants/personality.constants.ts';
import { CHUNK_FLAG_OUTDOOR, DEFAULT_AMBIENT_TEMP_C } from '../../constants/world_chunk.constants.ts';
import { addComponent, getComponent, getEntitiesAtPosition } from '../../core/ecs.ts';
import { getMapZBounds, getTemperatureAt, getTileDefAt, isInMapBounds, isMultiZMap } from '../../map/map_accessor.ts';
import { worldToChunkCoord, worldToLocalIndex, packWorldCoord3D } from '../../utils/grid.ts';
import { isHostile } from '../../utils/faction.ts';
import {
  ComponentType,
  type CanonicalNeedId,
  type FighterComponent,
  type HungerComponent,
  type NeedMeterState,
  type NeedsComponent,
  type PositionComponent,
  type TagsComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { addTimedThought, evaluateEntityPsychologyMood } from './thoughts.system.ts';

const DEFAULT_DECAY_PER_INTERVAL: Readonly<Record<CanonicalNeedId, number>> = {
  rest: 2,
  nourishment: 2,
  shelter: 1,
  comfort: 1,
  social: 1,
  safety: 1
};

const COMFORTABLE_TEMP_MIN_C = 12;
const COMFORTABLE_TEMP_MAX_C = 28;
const FREEZING_TEMP_C = 0;
const SCORCHING_TEMP_C = 40;
const THOUGHT_DURATION_MEDIUM = 60;

/** Creates a universal `NeedsComponent` initialized across all 6 canonical needs (`rest`, `nourishment`, `shelter`, `comfort`, `social`, `safety`). */
export function createDefaultNeedsComponent(
  initialOverrides?: Readonly<Record<string, number>>,
  decayMultipliers?: Readonly<Record<string, number>>
): NeedsComponent {
  const needs: Record<string, NeedMeterState> = {};
  const keys: CanonicalNeedId[] = ['rest', 'nourishment', 'shelter', 'comfort', 'social', 'safety'];

  for (const id of keys) {
    const val = Math.max(MIN_NEED_VALUE, Math.min(MAX_NEED_VALUE, initialOverrides?.[id] ?? DEFAULT_NEED_VALUE));
    needs[id] = {
      current: val,
      max: MAX_NEED_VALUE,
      decayPerInterval: DEFAULT_DECAY_PER_INTERVAL[id] * (decayMultipliers?.[id] ?? 1)
    };
  }

  if (initialOverrides) {
    for (const [customId, customVal] of Object.entries(initialOverrides)) {
      if (needs[customId]) continue;
      needs[customId] = {
        current: Math.max(MIN_NEED_VALUE, Math.min(MAX_NEED_VALUE, customVal)),
        max: MAX_NEED_VALUE,
        decayPerInterval: 1 * (decayMultipliers?.[customId] ?? 1)
      };
    }
  }

  return {
    type: ComponentType.Needs,
    needs
  };
}

/** Adjusts a single need meter on `entityId` clamped within `[0, max]`. */
export function satisfyActorNeed(state: GameState, entityId: EntityId, needId: string, delta: number): GameState {
  const comp = getComponent(state, entityId, ComponentType.Needs) as NeedsComponent | undefined;
  if (!comp) return state;
  const meter = comp.needs[needId];
  if (!meter) return state;
  const nextVal = Math.max(MIN_NEED_VALUE, Math.min(meter.max, meter.current + delta));
  if (nextVal === meter.current) return state;
  return addComponent(state, entityId, {
    ...comp,
    needs: {
      ...comp.needs,
      [needId]: { ...meter, current: nextVal }
    }
  });
}

function hasOverheadShelter(state: Readonly<GameState>, x: number, y: number, z: number): boolean {
  const area = state.campaign.areas[state.currentAreaId];
  if (area && area.environmentType && area.environmentType !== 'outdoors') {
    return true;
  }
  if (isMultiZMap(state.map)) {
    const { maxZ } = getMapZBounds(state.map);
    if (z + 1 <= maxZ && isInMapBounds(state.map, x, y, z + 1)) {
      const aboveDef = getTileDefAt(state, x, y, z + 1);
      if (aboveDef && aboveDef.isOpenAir !== true) return true;
    }
  }
  const grid = state.map.chunkGrid;
  if (grid !== undefined) {
    const chunk = grid.chunks.get(
      packWorldCoord3D(worldToChunkCoord(x, grid.chunkSize), worldToChunkCoord(y, grid.chunkSize), z)
    );
    if (chunk) {
      const flag = chunk.flags[worldToLocalIndex(x, y, grid.chunkSize)] ?? 0;
      return (flag & CHUNK_FLAG_OUTDOOR) === 0;
    }
  }
  return false;
}

/**
 * Evaluates all actor needs (`rest`, `nourishment` synced with `HungerComponent`, `shelter`, `comfort`
 * from M180 thermal temperature & furniture, `social`, `safety`) and emits situational thoughts.
 */
export function processActorNeedsTick(state: GameState, entityId: EntityId, elapsedIntervals = 1): GameState {
  const needsComp = getComponent(state, entityId, ComponentType.Needs) as NeedsComponent | undefined;
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!needsComp || !pos) return state;

  const z = pos.z ?? 0;
  const hunger = getComponent(state, entityId, ComponentType.Hunger) as HungerComponent | undefined;
  const cellTemp = getTemperatureAt(state.map, pos.x, pos.y, z) ?? DEFAULT_AMBIENT_TEMP_C;
  const sheltered = hasOverheadShelter(state, pos.x, pos.y, z);

  // Inspect local 4-tile neighborhood for furniture, allies, and hostiles
  let nearBed = false;
  let nearComfortFurniture = false;
  let nearAlly = false;
  let nearHostile = false;
  for (let dy = -NEEDS_NEIGHBORHOOD_RADIUS; dy <= NEEDS_NEIGHBORHOOD_RADIUS; dy++) {
    for (let dx = -NEEDS_NEIGHBORHOOD_RADIUS; dx <= NEEDS_NEIGHBORHOOD_RADIUS; dx++) {
      const ents = getEntitiesAtPosition(state, pos.x + dx, pos.y + dy, z);
      for (const otherId of ents) {
        if (otherId === entityId) continue;
        const tags = (getComponent(state, otherId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
        if (tags.includes('furniture:bed') && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) nearBed = true;
        if (tags.some((t) => t.startsWith('furniture:'))) nearComfortFurniture = true;
        if (getComponent(state, otherId, ComponentType.Actor) !== undefined) {
          if (isHostile(state, entityId, otherId)) nearHostile = true;
          else nearAlly = true;
        }
      }
    }
  }

  const nextNeeds: Record<string, NeedMeterState> = {};
  for (const [needId, meter] of Object.entries(needsComp.needs)) {
    let delta = -meter.decayPerInterval * elapsedIntervals;
    if (needId === 'nourishment' && hunger) {
      const maxSat = Math.max(1, state.campaign.rules.hunger.maxSatiation || 1000);
      const synced = Math.max(0, Math.min(meter.max, Math.round((hunger.satiation / maxSat) * meter.max)));
      nextNeeds[needId] = { ...meter, current: synced };
      continue;
    }
    if (needId === 'rest' && nearBed) {
      delta = NEED_REST_BED_RECOVERY * elapsedIntervals;
    } else if (needId === 'shelter') {
      delta = sheltered ? NEED_SHELTER_INDOOR_RECOVERY * elapsedIntervals : -meter.decayPerInterval * elapsedIntervals;
    } else if (needId === 'comfort') {
      if (cellTemp < FREEZING_TEMP_C || cellTemp > SCORCHING_TEMP_C) {
        delta = -NEED_COMFORT_EXTREME_TEMP_DRAIN * elapsedIntervals;
      } else if (cellTemp >= COMFORTABLE_TEMP_MIN_C && cellTemp <= COMFORTABLE_TEMP_MAX_C && nearComfortFurniture) {
        delta = NEED_COMFORT_IDEAL_FURNITURE_RECOVERY * elapsedIntervals;
      } else if (nearComfortFurniture) {
        delta = NEED_COMFORT_FURNITURE_RECOVERY * elapsedIntervals;
      }
    } else if (needId === 'social') {
      delta = nearAlly ? NEED_SOCIAL_ALLY_RECOVERY * elapsedIntervals : -meter.decayPerInterval * elapsedIntervals;
    } else if (needId === 'safety') {
      const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
      const injured = fighter !== undefined && fighter.hp < fighter.maxHp * NEED_INJURED_HP_RATIO;
      delta =
        nearHostile || injured
          ? -NEED_SAFETY_THREAT_DRAIN * elapsedIntervals
          : NEED_SAFETY_SAFE_RECOVERY * elapsedIntervals;
    }

    nextNeeds[needId] = {
      ...meter,
      current: Math.max(MIN_NEED_VALUE, Math.min(meter.max, Math.round(meter.current + delta)))
    };
  }

  let nextState = addComponent(state, entityId, { ...needsComp, needs: nextNeeds });

  if (cellTemp < FREEZING_TEMP_C) {
    nextState = addTimedThought(nextState, entityId, {
      thoughtId: 'freezing_cold',
      eventSummary: 'Chilled to the bone',
      moodDelta: THOUGHT_MOOD_EXTREME_TEMP,
      durationTurns: THOUGHT_DURATION_MEDIUM
    });
  } else if (cellTemp > SCORCHING_TEMP_C) {
    nextState = addTimedThought(nextState, entityId, {
      thoughtId: 'sweltering_heat',
      eventSummary: 'Suffering in scorching heat',
      moodDelta: THOUGHT_MOOD_EXTREME_TEMP,
      durationTurns: THOUGHT_DURATION_MEDIUM
    });
  }

  const restCur = nextNeeds['rest']?.current ?? DEFAULT_NEED_VALUE;
  if (restCur <= NEED_CRITICAL_THRESHOLD) {
    nextState = addTimedThought(nextState, entityId, {
      thoughtId: 'exhausted',
      eventSummary: 'Desperately exhausted',
      moodDelta: THOUGHT_MOOD_EXHAUSTED,
      durationTurns: THOUGHT_DURATION_MEDIUM
    });
  } else if (restCur >= NEED_HIGH_THRESHOLD) {
    nextState = addTimedThought(nextState, entityId, {
      thoughtId: 'well_rested',
      eventSummary: 'Feeling well rested',
      moodDelta: THOUGHT_MOOD_WELL_RESTED,
      durationTurns: THOUGHT_DURATION_MEDIUM
    });
  }

  const comfortCur = nextNeeds['comfort']?.current ?? DEFAULT_NEED_VALUE;
  if (comfortCur <= NEED_LOW_THRESHOLD) {
    nextState = addTimedThought(nextState, entityId, {
      thoughtId: 'uncomfortable',
      eventSummary: 'Uncomfortable surroundings',
      moodDelta: THOUGHT_MOOD_UNCOMFORTABLE,
      durationTurns: THOUGHT_DURATION_MEDIUM
    });
  }

  return nextState;
}

/**
 * Runs one universal psychology evaluation tick (needs + thought decay + mood aggregation)
 * across all actors carrying `NeedsComponent` or `MemoryComponent`.
 */
export function processActorPsychologyTick(state: GameState, elapsedIntervals = 1): GameState {
  let nextState = state;
  for (const entityId of [...state.entities]) {
    if (getComponent(nextState, entityId, ComponentType.Needs) !== undefined) {
      nextState = processActorNeedsTick(nextState, entityId, elapsedIntervals);
    }
    if (getComponent(nextState, entityId, ComponentType.Memory) !== undefined) {
      nextState = evaluateEntityPsychologyMood(nextState, entityId);
    }
  }
  return nextState;
}
