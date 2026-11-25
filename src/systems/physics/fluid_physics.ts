import {
  CHUNK_DIRTY_FLUID,
  CHUNK_DIRTY_PERSIST,
  CHUNK_DIRTY_TEMP,
  FLUID_SUBMERSION_DEPTH,
  FluidKindCode,
  MAGMA_SOURCE_TEMP_C,
  MAX_FLUID_DEPTH,
  OBSIDIAN_CONTACT_TEMP_BOOST_C,
  OIL_IGNITION_TEMP_C,
  WATER_BOIL_TEMP_C,
  WATER_FREEZE_TEMP_C,
  type FluidKind
} from '../../constants/world_chunk.constants.ts';
import { addComponent, getComponent, getEntitiesAtPosition } from '../../core/ecs.ts';
import {
  collectDirtyPhysicsRegions,
  getFluidByteAt,
  getMapZBounds,
  getTemperatureAt,
  getTileDefAt,
  getTileIdAt,
  isInMapBounds,
  isMultiZMap,
  markMapPhysicsDirtyAt,
  setFluidByteAt,
  setTemperatureAt,
  setTileIdAt,
  updatePhysicsRegionStatus
} from '../../map/map_accessor.ts';
import { ComponentType, type DamageComponent, type FieldComponent } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { setActorSubmersionState } from '../breath.system.ts';
import { ejectEntitiesFromBlockedVoxel } from '../construction.system.ts';
import { queryCrossingAtPosition, spawnCrossingEntity } from '../crossing.system.ts';
import { spawnField } from '../field.system.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { packFluidCell, unpackFluidCell, type FluidCellInfo } from './fluid_codec.ts';

export { packFluidCell, unpackFluidCell, type FluidCellInfo };

const ORTHOGONAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

const MAGMA_CONTACT_DAMAGE = 10;
const MAGMA_EQUALIZATION_INTERVAL_TURNS = 2;
const STEAM_CLOUD_DURATION_TURNS = 4;
const OIL_FIRE_DURATION_TURNS = 5;
const FROZEN_ICE_DURATION_TURNS = 12;

function canFluidEnterCell(state: Readonly<GameState>, x: number, y: number, z: number): boolean {
  if (!isInMapBounds(state.map, x, y, z)) return false;
  const def = getTileDefAt(state, x, y, z);
  if (!def) return false;
  if (def.isSolidObstacle === true) return false;
  return def.walkable === true || def.isOpenAir === true || def.verticalLink !== undefined;
}

function canFluidFallThroughCell(state: Readonly<GameState>, x: number, y: number, z: number): boolean {
  const def = getTileDefAt(state, x, y, z);
  if (!def) return false;
  return (
    def.isOpenAir === true ||
    def.hasFloorSupport === false ||
    def.verticalLink === 'stairs_down' ||
    def.verticalLink === 'stairs_both' ||
    def.hazardKind === 'pit' ||
    def.hazardKind === 'chasm'
  );
}

/**
 * Adds or updates fluid depth at voxel `(x, y, z)`, flagging `CHUNK_DIRTY_FLUID` and setting
 * thermal baselines when placing magma.
 */
export function applyFluidToVoxel(
  state: GameState,
  x: number,
  y: number,
  z: number,
  kind: FluidKind,
  depthDelta: number
): GameState {
  if (!isInMapBounds(state.map, x, y, z)) return state;
  if (depthDelta === 0) return state;

  const existing = unpackFluidCell(getFluidByteAt(state.map, x, y, z));
  const resolvedKind = kind === 'none' ? existing.kind : kind;
  if (resolvedKind === 'none') return state;

  const baseDepth = existing.kind === resolvedKind || existing.kind === 'none' ? existing.depth : 0;
  const nextDepth = Math.max(0, Math.min(MAX_FLUID_DEPTH, baseDepth + depthDelta));
  const nextByte = nextDepth <= 0 ? 0 : packFluidCell(resolvedKind, nextDepth);
  let nextMap = setFluidByteAt(state.map, x, y, nextByte, z, state.globalTurn);

  if (resolvedKind === 'magma' && nextDepth > 0) {
    nextMap = setTemperatureAt(nextMap, x, y, MAGMA_SOURCE_TEMP_C, z, state.globalTurn);
  }
  return nextMap === state.map ? state : { ...state, map: nextMap };
}

function resolveSolidifiedMagmaTileId(state: Readonly<GameState>): string | undefined {
  for (const mat of Object.values(state.campaign.rules.materials ?? {})) {
    if (mat.obsidianTileId && state.campaign.tiles[mat.obsidianTileId]) {
      return mat.obsidianTileId;
    }
  }
  for (const [tid, def] of Object.entries(state.campaign.tiles)) {
    if (def.tags?.includes('obsidian')) return tid;
  }
  for (const [tid, def] of Object.entries(state.campaign.tiles)) {
    if (def.isSolidObstacle === true && def.isOpenAir !== true && def.mineable === true) return tid;
  }
  for (const [tid, def] of Object.entries(state.campaign.tiles)) {
    if (!def.walkable && def.isOpenAir !== true) return tid;
  }
  return undefined;
}

function isFireOrHeatField(state: Readonly<GameState>, fieldType: string): boolean {
  const def = state.campaign.fields[fieldType];
  if (!def) return false;
  if (def.tags?.includes('fire') || def.tags?.includes('heat') || def.tags?.includes('lava')) return true;
  return def.tags === undefined && (def.damagePerTurn ?? 0) > 0 && def.statusEffectId === undefined;
}

function findFireFieldId(state: Readonly<GameState>): string | undefined {
  for (const def of Object.values(state.campaign.fields)) {
    if (isFireOrHeatField(state, def.id)) return def.id;
  }
  return undefined;
}

function resolveFluidPhaseTransitions(
  state: GameState,
  wx: number,
  wy: number,
  wz: number
): {
  readonly state: GameState;
  readonly changed: boolean;
} {
  const cur = unpackFluidCell(getFluidByteAt(state.map, wx, wy, wz));
  if (cur.depth <= 0 || cur.kind === 'none') return { state, changed: false };

  let nextState = state;
  const temp = getTemperatureAt(nextState.map, wx, wy, wz);

  if (cur.kind === 'water') {
    // Check adjacent magma contact -> solidified stone/obsidian + thermal spike + steam cloud
    for (const [dx, dy] of ORTHOGONAL_DIRS) {
      const nx = wx + dx;
      const ny = wy + dy;
      if (!isInMapBounds(nextState.map, nx, ny, wz)) continue;
      const neighbor = unpackFluidCell(getFluidByteAt(nextState.map, nx, ny, wz));
      if (neighbor.kind === 'magma' && neighbor.depth > 0) {
        const obsidianTile = resolveSolidifiedMagmaTileId(nextState);
        if (obsidianTile) {
          nextState = ejectEntitiesFromBlockedVoxel(nextState, nx, ny, wz);
        }
        let updatedMap = obsidianTile ? setTileIdAt(nextState.map, nx, ny, obsidianTile, wz) : nextState.map;
        updatedMap = setFluidByteAt(updatedMap, nx, ny, 0, wz, nextState.globalTurn);
        updatedMap = setFluidByteAt(
          updatedMap,
          wx,
          wy,
          cur.depth > 1 ? packFluidCell('water', cur.depth - 1) : 0,
          wz,
          nextState.globalTurn
        );
        updatedMap = setTemperatureAt(
          updatedMap,
          wx,
          wy,
          temp + OBSIDIAN_CONTACT_TEMP_BOOST_C,
          wz,
          nextState.globalTurn
        );
        nextState = {
          ...nextState,
          map: updatedMap,
          fovNeedsUpdate: true
        };
        [nextState] = spawnField(
          nextState,
          'steam_cloud',
          wx,
          wy,
          1,
          STEAM_CLOUD_DURATION_TURNS,
          undefined,
          undefined,
          wz
        );
        nextState = addMessage(
          nextState,
          'Water meets magma in a hiss of steam, solidifying obsidian!',
          MessageLogCategory.System
        );
        return { state: nextState, changed: true };
      }
    }

    if (temp <= WATER_FREEZE_TEMP_C && !queryCrossingAtPosition(nextState, wx, wy, wz)) {
      [nextState] = spawnCrossingEntity({
        state: nextState,
        crossingKind: 'frozen_surface',
        x: wx,
        y: wy,
        z: wz,
        durationTurns: FROZEN_ICE_DURATION_TURNS
      });
      return { state: nextState, changed: true };
    }

    if (temp >= WATER_BOIL_TEMP_C) {
      nextState = {
        ...nextState,
        map: setFluidByteAt(
          nextState.map,
          wx,
          wy,
          cur.depth > 1 ? packFluidCell('water', cur.depth - 1) : 0,
          wz,
          nextState.globalTurn
        )
      };
      [nextState] = spawnField(
        nextState,
        'steam_cloud',
        wx,
        wy,
        1,
        STEAM_CLOUD_DURATION_TURNS,
        undefined,
        undefined,
        wz
      );
      return { state: nextState, changed: true };
    }
  } else if (cur.kind === 'oil') {
    const hasFireField = getEntitiesAtPosition(nextState, wx, wy, wz).some((eid) => {
      const f = getComponent(nextState, eid, ComponentType.Field) as FieldComponent | undefined;
      return f !== undefined && isFireOrHeatField(nextState, f.fieldType);
    });
    if (temp >= OIL_IGNITION_TEMP_C || hasFireField) {
      const fireFieldId = findFireFieldId(nextState);
      nextState = {
        ...nextState,
        map: setFluidByteAt(nextState.map, wx, wy, 0, wz, nextState.globalTurn)
      };
      if (fireFieldId) {
        [nextState] = spawnField(nextState, fireFieldId, wx, wy, 2, OIL_FIRE_DURATION_TURNS, undefined, undefined, wz);
      }
      return { state: nextState, changed: true };
    }
  }

  return { state: nextState, changed: false };
}

function syncFluidOccupants(
  state: GameState,
  touchedCoords: ReadonlyArray<readonly [number, number, number]>
): GameState {
  let nextState = state;
  const seen = new Set<number>();

  for (const [x, y, z] of touchedCoords) {
    const fluid = unpackFluidCell(getFluidByteAt(nextState.map, x, y, z));
    const occupants = getEntitiesAtPosition(nextState, x, y, z);
    for (const entityId of occupants) {
      if (seen.has(entityId)) continue;
      seen.add(entityId);
      const isActor = getComponent(nextState, entityId, ComponentType.Actor) !== undefined;
      if (!isActor) continue;

      if (fluid.depth >= FLUID_SUBMERSION_DEPTH) {
        nextState = setActorSubmersionState(nextState, entityId, true);
      } else if (fluid.depth < FLUID_SUBMERSION_DEPTH && getComponent(nextState, entityId, ComponentType.Breath)) {
        const curTile = getTileIdAt(nextState.map, x, y, z);
        const def = curTile ? nextState.campaign.tiles[curTile] : undefined;
        if (!def?.tags?.includes('deep_water')) {
          nextState = setActorSubmersionState(nextState, entityId, false);
        }
      }

      if (fluid.kind === 'magma' && fluid.depth > 0 && getComponent(nextState, entityId, ComponentType.Fighter)) {
        const existingDmg = getComponent(nextState, entityId, ComponentType.Damage) as DamageComponent | undefined;
        const instance = { amount: MAGMA_CONTACT_DAMAGE, tags: ['fire', 'magma'] as const };
        nextState = addComponent(nextState, entityId, {
          type: ComponentType.Damage,
          instances: existingDmg ? [...existingDmg.instances, instance] : [instance]
        });
      }
    }
  }

  return nextState;
}

/**
 * Advances cellular fluid dynamics (vertical gravity spillover, hydrostatic horizontal equalization,
 * and obsidian/steam/ice/oil phase transitions) exclusively across dirty chunks/slices,
 * clearing `CHUNK_DIRTY_FLUID` when cells settle cleanly.
 */
export function processDirtyFluidChunks(state: GameState): GameState {
  const regions = collectDirtyPhysicsRegions(state.map, CHUNK_DIRTY_FLUID);
  if (regions.length === 0) return state;

  let nextState = state;
  const multiZ = isMultiZMap(nextState.map);
  const { minZ } = getMapZBounds(nextState.map);
  const touchedCoords: Array<readonly [number, number, number]> = [];
  const allowMagmaFlow = (nextState.globalTurn ?? 0) % MAGMA_EQUALIZATION_INTERVAL_TURNS === 0;
  const receivedThisTick = new Set<string>();

  for (const region of regions) {
    let anyChangedInRegion = false;

    for (let ly = 0; ly < region.height; ly++) {
      for (let lx = 0; lx < region.width; lx++) {
        const wx = region.minX + lx;
        const wy = region.minY + ly;
        const wz = region.z;
        if (!isInMapBounds(nextState.map, wx, wy, wz)) continue;
        if (receivedThisTick.has(`${wx},${wy},${wz}`)) {
          anyChangedInRegion = true;
          continue;
        }

        const cell = unpackFluidCell(getFluidByteAt(nextState.map, wx, wy, wz));
        if (cell.depth <= 0 || cell.kind === 'none') continue;

        const phaseRes = resolveFluidPhaseTransitions(nextState, wx, wy, wz);
        nextState = phaseRes.state;
        if (phaseRes.changed) {
          anyChangedInRegion = true;
          touchedCoords.push([wx, wy, wz]);
          continue;
        }

        // Pass A: Vertical gravity spillover to Z - 1
        if (
          multiZ &&
          wz > minZ &&
          canFluidFallThroughCell(nextState, wx, wy, wz) &&
          canFluidEnterCell(nextState, wx, wy, wz - 1)
        ) {
          const below = unpackFluidCell(getFluidByteAt(nextState.map, wx, wy, wz - 1));
          if (below.kind === 'none' || below.kind === cell.kind) {
            const transfer = Math.min(cell.depth, MAX_FLUID_DEPTH - below.depth);
            if (transfer > 0) {
              let m = setFluidByteAt(
                nextState.map,
                wx,
                wy,
                packFluidCell(cell.kind, cell.depth - transfer),
                wz,
                nextState.globalTurn
              );
              m = setFluidByteAt(
                m,
                wx,
                wy,
                packFluidCell(cell.kind, below.depth + transfer),
                wz - 1,
                nextState.globalTurn
              );
              nextState = { ...nextState, map: m };
              anyChangedInRegion = true;
              receivedThisTick.add(`${wx},${wy},${wz - 1}`);
              touchedCoords.push([wx, wy, wz], [wx, wy, wz - 1]);
              continue;
            }
          }
        }

        // Pass B: Horizontal hydrostatic equalization (strictly >= 2 gradient or >= 2 into empty cell prevents ping-pong)
        if (cell.kind === 'magma' && !allowMagmaFlow) {
          anyChangedInRegion = true;
          continue;
        }
        if (cell.depth < 2) continue;

        let bestTarget: { readonly x: number; readonly y: number; readonly depth: number } | undefined;
        for (const [dx, dy] of ORTHOGONAL_DIRS) {
          const nx = wx + dx;
          const ny = wy + dy;
          if (!canFluidEnterCell(nextState, nx, ny, wz)) continue;
          const neighbor = unpackFluidCell(getFluidByteAt(nextState.map, nx, ny, wz));
          if (neighbor.kind !== 'none' && neighbor.kind !== cell.kind) continue;
          if (neighbor.depth <= cell.depth - 2) {
            if (!bestTarget || neighbor.depth < bestTarget.depth) {
              bestTarget = { x: nx, y: ny, depth: neighbor.depth };
            }
          }
        }

        if (bestTarget) {
          let m = setFluidByteAt(
            nextState.map,
            wx,
            wy,
            packFluidCell(cell.kind, cell.depth - 1),
            wz,
            nextState.globalTurn
          );
          m = setFluidByteAt(
            m,
            bestTarget.x,
            bestTarget.y,
            packFluidCell(cell.kind, bestTarget.depth + 1),
            wz,
            nextState.globalTurn
          );
          m = markMapPhysicsDirtyAt(
            m,
            bestTarget.x,
            bestTarget.y,
            wz,
            CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP,
            nextState.globalTurn
          );
          nextState = { ...nextState, map: m };
          anyChangedInRegion = true;
          receivedThisTick.add(`${bestTarget.x},${bestTarget.y},${wz}`);
          touchedCoords.push([wx, wy, wz], [bestTarget.x, bestTarget.y, wz]);
        }
      }
    }

    const latestRegionDirty =
      (region.kind === 'chunk' && region.chunkKey !== undefined
        ? nextState.map.chunkGrid?.chunks.get(region.chunkKey)?.dirtyFlags
        : nextState.map.physicsOverlay?.slices[region.z]?.dirtyFlags) ?? region.dirtyFlags;
    const nextFlags = anyChangedInRegion
      ? latestRegionDirty | CHUNK_DIRTY_FLUID | CHUNK_DIRTY_PERSIST
      : latestRegionDirty & ~CHUNK_DIRTY_FLUID;
    nextState = {
      ...nextState,
      map: updatePhysicsRegionStatus(nextState.map, region, nextFlags, nextState.globalTurn)
    };
  }

  if (touchedCoords.length > 0) {
    nextState = syncFluidOccupants(nextState, touchedCoords);
  }

  return nextState;
}

/** Helper to check if a `FluidKindCode` matches an 8-bit fluid value. */
export function isFluidKindAtCell(byte: number, kind: FluidKindCode): boolean {
  const unpacked = unpackFluidCell(byte);
  if (kind === FluidKindCode.None) return unpacked.depth === 0;
  return ((byte >> 3) & 0x07) === kind && unpacked.depth > 0;
}
