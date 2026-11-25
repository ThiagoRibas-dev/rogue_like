import {
  CHUNK_DIRTY_PERSIST,
  CHUNK_DIRTY_TEMP,
  CHUNK_FLAG_OUTDOOR,
  COLD_FIELD_SOURCE_TEMP_C,
  DEFAULT_AMBIENT_TEMP_C,
  DEFAULT_THERMAL_CONDUCTIVITY,
  FIRE_FIELD_SOURCE_TEMP_C,
  MAGMA_SOURCE_TEMP_C,
  MAX_CELL_TEMP_C,
  MIN_CELL_TEMP_C,
  TEMP_AMBIENT_RELAXATION_LAMBDA,
  TEMP_CONVERGENCE_EPSILON_C,
  TEMP_DIFFUSION_RATE
} from '../../constants/world_chunk.constants.ts';
import { getActiveOutdoorWeatherAt } from '../macro/macro_world.system.ts';
import { getComponent } from '../../core/ecs.ts';
import {
  collectDirtyPhysicsRegions,
  getFluidByteAt,
  getMapZBounds,
  getTemperatureAt,
  getTileDefAt,
  isInMapBounds,
  isMultiZMap,
  markMapPhysicsDirtyAt,
  setTemperatureAt,
  setTileIdAt,
  updatePhysicsRegionStatus
} from '../../map/map_accessor.ts';
import { ComponentType, type FieldComponent, type PositionComponent } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { spawnField } from '../field.system.ts';
import { unpackFluidKindCode } from './fluid_codec.ts';

const HORIZONTAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

/** Applies a clamped temperature delta or target value to voxel `(x, y, z)`, flagging `CHUNK_DIRTY_TEMP`. */
export function applyHeatDeltaToVoxel(state: GameState, x: number, y: number, z: number, deltaC: number): GameState {
  if (!isInMapBounds(state.map, x, y, z)) return state;
  const cur = getTemperatureAt(state.map, x, y, z);
  const next = Math.max(MIN_CELL_TEMP_C, Math.min(MAX_CELL_TEMP_C, cur + deltaC));
  return {
    ...state,
    map: setTemperatureAt(state.map, x, y, next, z, state.globalTurn)
  };
}

function injectThermalFieldEmitters(state: GameState): GameState {
  let nextMap = state.map;
  for (const entityId of state.entities) {
    const field = getComponent(state, entityId, ComponentType.Field) as FieldComponent | undefined;
    if (!field) continue;
    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;
    const z = pos.z ?? 0;
    if (!isInMapBounds(nextMap, pos.x, pos.y, z)) continue;

    const fieldDef = state.campaign.fields[field.fieldType];
    const tags = new Set<string>([field.fieldType, ...(fieldDef?.tags ?? [])]);
    if (tags.has('fire') || tags.has('lava') || tags.has('heat')) {
      const cur = getTemperatureAt(nextMap, pos.x, pos.y, z);
      if (cur < FIRE_FIELD_SOURCE_TEMP_C) {
        nextMap = setTemperatureAt(nextMap, pos.x, pos.y, FIRE_FIELD_SOURCE_TEMP_C, z, state.globalTurn);
      } else {
        nextMap = markMapPhysicsDirtyAt(nextMap, pos.x, pos.y, z, CHUNK_DIRTY_TEMP, state.globalTurn);
      }
    } else if (tags.has('cold') || tags.has('ice') || tags.has('frost')) {
      const cur = getTemperatureAt(nextMap, pos.x, pos.y, z);
      if (cur > COLD_FIELD_SOURCE_TEMP_C) {
        nextMap = setTemperatureAt(nextMap, pos.x, pos.y, COLD_FIELD_SOURCE_TEMP_C, z, state.globalTurn);
      } else {
        nextMap = markMapPhysicsDirtyAt(nextMap, pos.x, pos.y, z, CHUNK_DIRTY_TEMP, state.globalTurn);
      }
    }
  }
  return nextMap === state.map ? state : { ...state, map: nextMap };
}

function findThermalFireFieldId(state: Readonly<GameState>): string | undefined {
  for (const def of Object.values(state.campaign.fields)) {
    if (
      def.tags?.includes('fire') ||
      def.tags?.includes('heat') ||
      (def.tags === undefined && (def.damagePerTurn ?? 0) > 0 && def.statusEffectId === undefined)
    ) {
      return def.id;
    }
  }
  return undefined;
}

/**
 * Advances 3D cellular heat diffusion and ambient convergence exclusively across chunks/slices
 * carrying `CHUNK_DIRTY_TEMP`, auto-clearing `CHUNK_DIRTY_TEMP` when cells converge within `±1°C`.
 */
export function processDirtyTemperatureChunks(state: GameState): GameState {
  let nextState = injectThermalFieldEmitters(state);
  const regions = collectDirtyPhysicsRegions(nextState.map, CHUNK_DIRTY_TEMP);
  if (regions.length === 0) return nextState;

  const baseAmbientTemp = DEFAULT_AMBIENT_TEMP_C;
  const isOutdoorArea = nextState.campaign.areas[nextState.currentAreaId]?.environmentType === 'outdoors';
  const multiZ = isMultiZMap(nextState.map);
  const zBounds = getMapZBounds(nextState.map);
  const fireFieldId = findThermalFireFieldId(nextState);
  let nextMap = nextState.map;

  for (const region of regions) {
    const chunkRef =
      region.kind === 'chunk' && region.chunkKey !== undefined
        ? nextMap.chunkGrid?.chunks.get(region.chunkKey)
        : undefined;
    const regionAmbientTemp = ((): number => {
      if (!nextState.macroWorld) return baseAmbientTemp;
      const sampleX = region.minX + Math.floor(region.width / 2);
      const sampleY = region.minY + Math.floor(region.height / 2);
      const hasOutdoorCells =
        isOutdoorArea ||
        (chunkRef !== undefined && region.z >= 0 && chunkRef.flags.some((f) => (f & CHUNK_FLAG_OUTDOOR) !== 0));
      if (!hasOutdoorCells) return baseAmbientTemp;
      const weather = getActiveOutdoorWeatherAt(nextState, sampleX, sampleY);
      return weather
        ? Math.max(MIN_CELL_TEMP_C, Math.min(MAX_CELL_TEMP_C, baseAmbientTemp + weather.tempDeltaC))
        : baseAmbientTemp;
    })();
    const ambientTemp = regionAmbientTemp;
    const updates: Array<{ readonly x: number; readonly y: number; readonly z: number; readonly temp: number }> = [];
    const ignitedTiles: Array<{
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly burnedTileId: string;
    }> = [];
    let anyActiveCell = false;

    for (let ly = 0; ly < region.height; ly++) {
      for (let lx = 0; lx < region.width; lx++) {
        const wx = region.minX + lx;
        const wy = region.minY + ly;
        const wz = region.z;
        if (!isInMapBounds(nextMap, wx, wy, wz)) continue;

        const fluidByte = getFluidByteAt(nextMap, wx, wy, wz);
        if (fluidByte !== 0 && unpackFluidKindCode(fluidByte) === 2) {
          // Active magma anchors cell temperature at magma source level
          if (getTemperatureAt(nextMap, wx, wy, wz) !== MAGMA_SOURCE_TEMP_C) {
            updates.push({ x: wx, y: wy, z: wz, temp: MAGMA_SOURCE_TEMP_C });
          }
          anyActiveCell = true;
          continue;
        }

        const curTemp = getTemperatureAt(nextMap, wx, wy, wz);
        let neighborSum = 0;
        let neighborCount = 0;
        for (const [dx, dy] of HORIZONTAL_OFFSETS) {
          const nx = wx + dx;
          const ny = wy + dy;
          if (!isInMapBounds(nextMap, nx, ny, wz)) continue;
          neighborSum += getTemperatureAt(nextMap, nx, ny, wz);
          neighborCount += 1;
        }
        if (multiZ) {
          for (const dz of [-1, 1]) {
            const nz = wz + dz;
            if (nz < zBounds.minZ || nz > zBounds.maxZ) continue;
            if (!isInMapBounds(nextMap, wx, wy, nz)) continue;
            neighborSum += getTemperatureAt(nextMap, wx, wy, nz);
            neighborCount += 1;
          }
        }

        const neighborAvg = neighborCount > 0 ? neighborSum / neighborCount : ambientTemp;
        const tileDef = getTileDefAt({ ...nextState, map: nextMap }, wx, wy, wz);
        const conductivity = tileDef?.thermalConductivity ?? DEFAULT_THERMAL_CONDUCTIVITY;
        const diffused =
          curTemp +
          conductivity * TEMP_DIFFUSION_RATE * (neighborAvg - curTemp) +
          TEMP_AMBIENT_RELAXATION_LAMBDA * (ambientTemp - curTemp);
        let nextTemp = Math.round(diffused);
        if (nextTemp === curTemp && curTemp !== ambientTemp && Math.sign(diffused - curTemp) !== 0) {
          nextTemp = curTemp + (diffused < curTemp ? -1 : 1);
        }
        if (
          Math.abs(nextTemp - ambientTemp) <= TEMP_CONVERGENCE_EPSILON_C &&
          Math.abs(neighborAvg - ambientTemp) <= 2
        ) {
          nextTemp = ambientTemp;
        }

        if (tileDef?.ignitionTempC !== undefined && nextTemp >= tileDef.ignitionTempC) {
          const burnedTile =
            tileDef.burnedTileId && nextState.campaign.tiles[tileDef.burnedTileId] ? tileDef.burnedTileId : undefined;
          if (burnedTile) {
            ignitedTiles.push({ x: wx, y: wy, z: wz, burnedTileId: burnedTile });
          }
        }

        if (nextTemp !== ambientTemp) {
          anyActiveCell = true;
        }
        if (nextTemp !== curTemp) {
          updates.push({ x: wx, y: wy, z: wz, temp: nextTemp });
        }
      }
    }

    for (const u of updates) {
      nextMap = setTemperatureAt(nextMap, u.x, u.y, u.temp, u.z, nextState.globalTurn);
      for (const [dx, dy] of HORIZONTAL_OFFSETS) {
        if (
          Math.abs(u.temp - ambientTemp) > TEMP_CONVERGENCE_EPSILON_C * 2 &&
          isInMapBounds(nextMap, u.x + dx, u.y + dy, u.z)
        ) {
          nextMap = markMapPhysicsDirtyAt(nextMap, u.x + dx, u.y + dy, u.z, CHUNK_DIRTY_TEMP, nextState.globalTurn);
        }
      }
    }
    for (const ig of ignitedTiles) {
      nextMap = setTileIdAt(nextMap, ig.x, ig.y, ig.burnedTileId, ig.z);
    }

    const latestDirty =
      (region.kind === 'chunk' && region.chunkKey !== undefined
        ? nextMap.chunkGrid?.chunks.get(region.chunkKey)?.dirtyFlags
        : nextMap.physicsOverlay?.slices[region.z]?.dirtyFlags) ?? region.dirtyFlags;
    const baseFlags =
      (updates.length > 0 || ignitedTiles.length > 0 ? latestDirty | CHUNK_DIRTY_PERSIST : latestDirty) &
      ~CHUNK_DIRTY_TEMP;
    const nextFlags =
      anyActiveCell || updates.length > 0 || ignitedTiles.length > 0 ? baseFlags | CHUNK_DIRTY_TEMP : baseFlags;
    nextMap = updatePhysicsRegionStatus(nextMap, region, nextFlags, nextState.globalTurn);
    nextState = { ...nextState, map: nextMap, ...(ignitedTiles.length > 0 ? { fovNeedsUpdate: true } : {}) };

    if (fireFieldId) {
      for (const ig of ignitedTiles) {
        [nextState] = spawnField(nextState, fireFieldId, ig.x, ig.y, 1, 5, undefined, undefined, ig.z);
      }
      nextMap = nextState.map;
    }
  }

  return nextState;
}
