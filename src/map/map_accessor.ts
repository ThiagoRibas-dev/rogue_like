import {
  CHUNK_DIRTY_FLUID,
  CHUNK_DIRTY_PERSIST,
  CHUNK_DIRTY_REGION,
  CHUNK_DIRTY_TEMP,
  CHUNK_FLAG_EXPLORED,
  DEFAULT_AMBIENT_TEMP_C,
  DEFAULT_RANDOM_WALKABLE_ATTEMPTS,
  MAX_CELL_TEMP_C,
  MIN_CELL_TEMP_C
} from '../constants/world_chunk.constants.ts';
import type { TileDefinition } from '../types/campaign/world.ts';
import type { FinitePhysicsSlice, GameMap, GameState, Tile } from '../types/game-state.types.ts';
import type { TileSnapshot, WorldChunk } from '../types/world-chunk.types.ts';
import {
  coordToIndex,
  isInBounds,
  packWorldCoord3D,
  unpackWorldCoord3D,
  worldToChunkCoord,
  worldToLocalIndex
} from '../utils/grid.ts';
import { getPaletteIndexForTileId, getTileIdFromPaletteIndex } from './tile_palette.ts';
import { cloneWorldChunk } from './world_chunk.ts';

function getSliceTiles(map: Readonly<GameMap>, z: number): ReadonlyArray<Tile> | undefined {
  if (z === 0) return map.tiles;
  return map.zSlices?.[z];
}

/**
 * Resolves the inclusive vertical `(minZ, maxZ)` bounds configured or populated on a `GameMap`.
 */
export function getMapZBounds(map: Readonly<GameMap>): { readonly minZ: number; readonly maxZ: number } {
  if (map.chunkGrid !== undefined) {
    return { minZ: map.chunkGrid.minZ ?? 0, maxZ: map.chunkGrid.maxZ ?? 0 };
  }
  if (map.minZ !== undefined && map.maxZ !== undefined) {
    return { minZ: map.minZ, maxZ: map.maxZ };
  }
  if (map.zSlices !== undefined) {
    const zs = Object.keys(map.zSlices).map((k) => Number(k));
    if (zs.length > 0) {
      return { minZ: Math.min(0, ...zs), maxZ: Math.max(0, ...zs) };
    }
  }
  return { minZ: 0, maxZ: 0 };
}

/**
 * Returns true if the `GameMap` spans more than a single vertical Z-level.
 */
export function isMultiZMap(map: Readonly<GameMap>): boolean {
  const bounds = getMapZBounds(map);
  return bounds.minZ < bounds.maxZ;
}

/**
 * Checks whether coordinates `(x, y, z)` lie within loaded map storage —
 * either inside `[0, width) x [0, height)` on finite maps/slices or inside a currently loaded `WorldChunk`.
 *
 * @param map Active or dormant GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @param z World Z coordinate (defaults to `0`).
 * @returns True if a tile cell exists at `(x, y, z)`.
 */
export function isInMapBounds(map: Readonly<GameMap>, x: number, y: number, z = 0): boolean {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    return grid.chunks.has(packWorldCoord3D(cx, cy, z));
  }
  if (!isInBounds(x, y, map.width, map.height)) return false;
  return z === 0 || map.zSlices?.[z] !== undefined;
}

/**
 * Computes the canonical FOV/lookup numeric key for `(x, y, z)` on either finite or chunked maps.
 * Finite Z=0 maps keep `y * width + x` for backwards compatibility; other Z-levels and chunked maps use 3D packing.
 *
 * @param map Target GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @param z World Z coordinate (defaults to `0`).
 * @returns Numeric tile lookup key matching `GameState.cachedFov`.
 */
export function toMapTileKey(map: Readonly<GameMap>, x: number, y: number, z = 0): number {
  if (map.chunkGrid !== undefined) {
    return packWorldCoord3D(x, y, z);
  }
  return z === 0 ? coordToIndex(x, y, map.width) : packWorldCoord3D(x, y, z);
}

/**
 * Returns true if world coordinate `(x, y, z)` is currently visible in player FOV (or `map.isFullyExplored`).
 *
 * @param state Current GameState.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @param z World Z coordinate (defaults to `0`).
 * @returns True when tile visibility applies at `(x, y, z)`.
 */
export function isTileKeyInFov(state: Readonly<GameState>, x: number, y: number, z = 0): boolean {
  if (state.map.isFullyExplored) return true;
  if (!isInMapBounds(state.map, x, y, z)) return false;
  return state.cachedFov.has(toMapTileKey(state.map, x, y, z));
}

/**
 * Reads normalized tile snapshot (`tileId`, `x`, `y`, `z?`, `explored`) uniformly from finite `GameMap.tiles`/`zSlices`
 * or chunked `GameMap.chunkGrid`.
 *
 * @param map Source GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @param z World Z coordinate (defaults to `0`).
 * @returns TileSnapshot or `undefined` when unloaded/out of bounds.
 */
export function getTileAt(map: Readonly<GameMap>, x: number, y: number, z = 0): TileSnapshot | undefined {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord3D(cx, cy, z));
    if (!chunk) return undefined;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    const paletteIdx = chunk.tileType[localIdx] ?? 0;
    const tileId = getTileIdFromPaletteIndex(grid.palette, paletteIdx);
    if (!tileId) return undefined;
    const explored = ((chunk.flags[localIdx] ?? 0) & CHUNK_FLAG_EXPLORED) !== 0;
    return { tileId, x, y, ...(z !== 0 ? { z } : {}), explored };
  }
  if (!isInBounds(x, y, map.width, map.height)) return undefined;
  const slice = getSliceTiles(map, z);
  return slice?.[coordToIndex(x, y, map.width)];
}

/**
 * Reads only the string `tileId` at `(x, y, z)` with zero snapshot object allocation on chunked maps.
 *
 * @param map Source GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @param z World Z coordinate (defaults to `0`).
 * @returns Tile ID string or `undefined`.
 */
export function getTileIdAt(map: Readonly<GameMap>, x: number, y: number, z = 0): string | undefined {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord3D(cx, cy, z));
    if (!chunk) return undefined;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    return getTileIdFromPaletteIndex(grid.palette, chunk.tileType[localIdx] ?? 0);
  }
  if (!isInBounds(x, y, map.width, map.height)) return undefined;
  return getSliceTiles(map, z)?.[coordToIndex(x, y, map.width)]?.tileId;
}

/**
 * Resolves the campaign `TileDefinition` for world coordinate `(x, y, z)`.
 *
 * @param state Current GameState.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @param z World Z coordinate (defaults to `0`).
 * @returns Matching `TileDefinition` or `undefined`.
 */
export function getTileDefAt(state: Readonly<GameState>, x: number, y: number, z = 0): TileDefinition | undefined {
  const tileId = getTileIdAt(state.map, x, y, z);
  return tileId ? state.campaign.tiles[tileId] : undefined;
}

/**
 * Returns true if the tile at `(x, y, z)` is currently explored (or `map.isFullyExplored`).
 *
 * @param map Source GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @param z World Z coordinate (defaults to `0`).
 * @returns True if explored.
 */
export function isTileExploredAt(map: Readonly<GameMap>, x: number, y: number, z = 0): boolean {
  if (map.isFullyExplored) return isInMapBounds(map, x, y, z);
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord3D(cx, cy, z));
    if (!chunk) return false;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    return ((chunk.flags[localIdx] ?? 0) & CHUNK_FLAG_EXPLORED) !== 0;
  }
  if (!isInBounds(x, y, map.width, map.height)) return false;
  return getSliceTiles(map, z)?.[coordToIndex(x, y, map.width)]?.explored === true;
}

/**
 * Immutably updates the `tileId` at `(x, y, z)`, cloning either the touched finite tile slice
 * or the enclosing `WorldChunk` and flagging it `CHUNK_DIRTY_PERSIST | CHUNK_DIRTY_REGION`.
 *
 * @param map Source GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @param tileId Replacement tile ID registered in campaign tiles.
 * @param z World Z coordinate (defaults to `0`).
 * @returns Updated GameMap (or original reference when unchanged/out of bounds).
 */
export function setTileIdAt(map: Readonly<GameMap>, x: number, y: number, tileId: string, z = 0): GameMap {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunkKey = packWorldCoord3D(cx, cy, z);
    const existingChunk = grid.chunks.get(chunkKey);
    if (!existingChunk) return map;

    const nextIdx = getPaletteIndexForTileId(grid.palette, tileId);
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    if (existingChunk.tileType[localIdx] === nextIdx) return map;

    const cloned = cloneWorldChunk(existingChunk);
    cloned.tileType[localIdx] = nextIdx;
    const nextChunk: WorldChunk = {
      ...cloned,
      dirtyFlags:
        existingChunk.dirtyFlags | CHUNK_DIRTY_PERSIST | CHUNK_DIRTY_REGION | CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP
    };

    const nextChunks = new Map(grid.chunks);
    nextChunks.set(chunkKey, nextChunk);
    const nextDirtyKeys = new Set(grid.dirtyChunkKeys);
    nextDirtyKeys.add(chunkKey);

    const lx = ((x % grid.chunkSize) + grid.chunkSize) % grid.chunkSize;
    const ly = ((y % grid.chunkSize) + grid.chunkSize) % grid.chunkSize;
    const borderOffsets: Array<readonly [number, number]> = [];
    if (lx === 0) borderOffsets.push([-1, 0]);
    if (lx === grid.chunkSize - 1) borderOffsets.push([1, 0]);
    if (ly === 0) borderOffsets.push([0, -1]);
    if (ly === grid.chunkSize - 1) borderOffsets.push([0, 1]);
    for (const [dcx, dcy] of borderOffsets) {
      const nKey = packWorldCoord3D(cx + dcx, cy + dcy, z);
      const neighbor = nextChunks.get(nKey);
      if (neighbor) {
        nextChunks.set(nKey, {
          ...neighbor,
          dirtyFlags: neighbor.dirtyFlags | CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP
        });
      }
    }
    for (const dz of [-1, 1]) {
      const vKey = packWorldCoord3D(cx, cy, z + dz);
      const vNeighbor = nextChunks.get(vKey);
      if (vNeighbor) {
        nextChunks.set(vKey, {
          ...vNeighbor,
          dirtyFlags: vNeighbor.dirtyFlags | CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP
        });
      }
    }

    return {
      ...map,
      chunkGrid: {
        ...grid,
        chunks: nextChunks,
        dirtyChunkKeys: nextDirtyKeys
      }
    };
  }

  if (!isInBounds(x, y, map.width, map.height)) return map;
  const idx = coordToIndex(x, y, map.width);
  const flagFiniteDirty = (sourceMap: GameMap): GameMap => {
    const existingSlices = sourceMap.physicsOverlay?.slices;
    if (!existingSlices) return sourceMap;
    let nextSlices: Record<number, FinitePhysicsSlice> | undefined;
    for (const targetZ of [z, z + 1, z - 1]) {
      const existingSlice = existingSlices[targetZ];
      if (!existingSlice) continue;
      const neededFlags = existingSlice.dirtyFlags | CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP;
      if (neededFlags === existingSlice.dirtyFlags) continue;
      if (!nextSlices) nextSlices = { ...existingSlices };
      nextSlices[targetZ] = {
        ...existingSlice,
        dirtyFlags: neededFlags
      };
    }
    if (!nextSlices) return sourceMap;
    return {
      ...sourceMap,
      physicsOverlay: {
        slices: nextSlices
      }
    };
  };

  if (z === 0) {
    const existingTile = map.tiles[idx];
    if (!existingTile || existingTile.tileId === tileId) return map;
    const nextTiles = [...map.tiles];
    nextTiles[idx] = { ...existingTile, tileId };
    if (map.zSlices !== undefined) {
      return flagFiniteDirty({
        ...map,
        tiles: nextTiles,
        zSlices: { ...map.zSlices, '0': nextTiles }
      });
    }
    return flagFiniteDirty({ ...map, tiles: nextTiles });
  }

  const slice = map.zSlices?.[z];
  if (!slice) return map;
  const existingTile = slice[idx];
  if (!existingTile || existingTile.tileId === tileId) return map;
  const nextSlice = [...slice];
  nextSlice[idx] = { ...existingTile, tileId };
  return flagFiniteDirty({
    ...map,
    zSlices: { ...map.zSlices, [z]: nextSlice }
  });
}

/**
 * Marks all tiles whose key (matching {@link toMapTileKey}) appears in `visibleKeys` as explored.
 * On chunked maps, clones only newly touched chunks and sets `CHUNK_DIRTY_PERSIST`.
 *
 * @param map Source GameMap.
 * @param visibleKeys Set of keys emitted by `computeFOV` / `computeFOV3D`.
 * @returns Updated GameMap (or original reference when no new tiles became explored).
 */
export function markTilesExplored(map: Readonly<GameMap>, visibleKeys: ReadonlySet<number>): GameMap {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    let nextChunks: Map<number, WorldChunk> | null = null;
    let nextDirtyKeys: Set<number> | null = null;
    const clonedChunkKeys = new Set<number>();

    for (const packed of visibleKeys) {
      const { x, y, z } = unpackWorldCoord3D(packed);
      const cx = worldToChunkCoord(x, grid.chunkSize);
      const cy = worldToChunkCoord(y, grid.chunkSize);
      const chunkKey = packWorldCoord3D(cx, cy, z);
      const curChunk = (nextChunks ?? grid.chunks).get(chunkKey);
      if (!curChunk) continue;
      const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
      const curFlag = curChunk.flags[localIdx] ?? 0;
      if ((curFlag & CHUNK_FLAG_EXPLORED) !== 0) continue;

      let writable = curChunk;
      if (!clonedChunkKeys.has(chunkKey)) {
        const cloned = cloneWorldChunk(curChunk);
        writable = {
          ...cloned,
          dirtyFlags: curChunk.dirtyFlags | CHUNK_DIRTY_PERSIST
        };
        if (!nextChunks) nextChunks = new Map(grid.chunks);
        nextChunks.set(chunkKey, writable);
        clonedChunkKeys.add(chunkKey);
        if (!nextDirtyKeys) nextDirtyKeys = new Set(grid.dirtyChunkKeys);
        nextDirtyKeys.add(chunkKey);
      }
      writable.flags[localIdx] = curFlag | CHUNK_FLAG_EXPLORED;
    }

    if (!nextChunks) return map;
    return {
      ...map,
      chunkGrid: {
        ...grid,
        chunks: nextChunks,
        dirtyChunkKeys: nextDirtyKeys ?? grid.dirtyChunkKeys
      }
    };
  }

  let modifiedZ0 = false;
  const nextTiles = map.tiles.map((tile, idx) => {
    if (visibleKeys.has(idx) && !tile.explored) {
      modifiedZ0 = true;
      return { ...tile, explored: true };
    }
    return tile;
  });

  const finiteSize = map.width * map.height;
  let nextZSlices: Record<number, ReadonlyArray<Tile>> | null = null;
  if (map.zSlices !== undefined) {
    for (const packed of visibleKeys) {
      if (packed >= 0 && packed < finiteSize) continue;
      const { x, y, z } = unpackWorldCoord3D(packed);
      if (!isInBounds(x, y, map.width, map.height)) continue;
      const sourceSlice = (nextZSlices ?? map.zSlices)[z];
      if (!sourceSlice) continue;
      const idx = coordToIndex(x, y, map.width);
      const existingTile = sourceSlice[idx];
      if (!existingTile || existingTile.explored) continue;
      if (!nextZSlices) nextZSlices = { ...map.zSlices };
      const writableSlice = [...sourceSlice];
      writableSlice[idx] = { ...existingTile, explored: true };
      nextZSlices[z] = writableSlice;
    }
  }

  if (!modifiedZ0 && !nextZSlices) return map;
  if (map.zSlices !== undefined) {
    const mergedSlices: Record<number, ReadonlyArray<Tile>> = {
      ...(nextZSlices ?? map.zSlices),
      ...(modifiedZ0 ? { 0: nextTiles } : {})
    };
    return {
      ...map,
      tiles: modifiedZ0 ? nextTiles : map.tiles,
      zSlices: mergedSlices
    };
  }
  return { ...map, tiles: nextTiles };
}

/**
 * Samples a walkable coordinate across either finite map dimensions/slices or loaded streaming chunks.
 *
 * @param state Current GameState.
 * @param uniformRng Uniform RNG returning `[0, 1)`.
 * @param maxAttempts Maximum sampling attempts.
 * @param z Optional explicit Z-level filter.
 * @returns Walkable coordinate or `null`.
 */
export function findRandomWalkableCoord(
  state: Readonly<GameState>,
  uniformRng: () => number,
  maxAttempts: number = DEFAULT_RANDOM_WALKABLE_ATTEMPTS,
  z?: number
): { readonly x: number; readonly y: number; readonly z: number } | null {
  const grid = state.map.chunkGrid;
  if (grid !== undefined) {
    const allChunks = Array.from(grid.chunks.values());
    const loadedChunks = z !== undefined ? allChunks.filter((c) => c.cz === z) : allChunks;
    if (loadedChunks.length === 0) return null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const chunk = loadedChunks[Math.floor(uniformRng() * loadedChunks.length)];
      if (!chunk) continue;
      const lx = Math.floor(uniformRng() * chunk.size);
      const ly = Math.floor(uniformRng() * chunk.size);
      const wx = chunk.cx * chunk.size + lx;
      const wy = chunk.cy * chunk.size + ly;
      const tileDef = getTileDefAt(state, wx, wy, chunk.cz);
      if (tileDef?.walkable) {
        return { x: wx, y: wy, z: chunk.cz };
      }
    }
    return null;
  }

  if (state.map.width <= 0 || state.map.height <= 0) return null;
  const targetZ = z ?? 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rx = Math.floor(uniformRng() * state.map.width);
    const ry = Math.floor(uniformRng() * state.map.height);
    const tileDef = getTileDefAt(state, rx, ry, targetZ);
    if (tileDef?.walkable) {
      return { x: rx, y: ry, z: targetZ };
    }
  }
  return null;
}

/**
 * Evaluates directional vertical traversal legality between adjacent Z strata (`fromDef` at `z` -> `toDef` at `z + dz`)
 * via matching stairs, ladders, ramps, or climbable faces.
 */
export function canTraverseVerticalTiles(
  fromDef: TileDefinition | undefined,
  toDef: TileDefinition | undefined,
  dz: number
): boolean {
  if (!fromDef || !toDef || dz === 0) return false;
  if (toDef.isSolidObstacle === true) return false;
  const destOpenOrNavigable =
    toDef.walkable === true ||
    toDef.isOpenAir === true ||
    toDef.verticalLink !== undefined ||
    toDef.isClimbable === true;
  if (!destOpenOrNavigable) return false;

  if (fromDef.isClimbable === true || toDef.isClimbable === true) {
    return true;
  }

  if (dz > 0) {
    return (
      fromDef.verticalLink === 'stairs_up' ||
      fromDef.verticalLink === 'stairs_both' ||
      fromDef.verticalLink === 'ladder' ||
      fromDef.verticalLink === 'ramp' ||
      toDef.verticalLink === 'stairs_down' ||
      toDef.verticalLink === 'stairs_both' ||
      toDef.verticalLink === 'ladder'
    );
  }

  return (
    fromDef.verticalLink === 'stairs_down' ||
    fromDef.verticalLink === 'stairs_both' ||
    fromDef.verticalLink === 'ladder' ||
    fromDef.verticalLink === 'ramp' ||
    toDef.verticalLink === 'stairs_up' ||
    toDef.verticalLink === 'stairs_both' ||
    toDef.verticalLink === 'ladder'
  );
}

/**
 * Computes a safe center fallback coordinate across either finite map dimensions
 * or a streaming grid's active origin chunk center.
 *
 * @param map Target GameMap.
 * @returns Center coordinate `{ x, y, z }`.
 */
export function getMapCenterFallbackCoord(map: Readonly<GameMap>): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
} {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    return {
      x: grid.originChunkX * grid.chunkSize + Math.floor(grid.chunkSize / 2),
      y: grid.originChunkY * grid.chunkSize + Math.floor(grid.chunkSize / 2),
      z: grid.originChunkZ ?? 0
    };
  }
  return {
    x: Math.floor(map.width / 2),
    y: Math.floor(map.height / 2),
    z: 0
  };
}

/** Descriptor for an active dirty chunk or finite Z-slice processed by cellular physics passes. */
export interface PhysicsRegionBounds {
  readonly kind: 'chunk' | 'finite';
  readonly z: number;
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  readonly chunkKey?: number | undefined;
  readonly dirtyFlags: number;
  readonly lastSimulatedTurn: number;
}

function createEmptyFinitePhysicsSlice(width: number, height: number, currentTurn: number): FinitePhysicsSlice {
  const cellCount = Math.max(0, width * height);
  return {
    fluid: new Array<number>(cellCount).fill(0),
    temperature: new Array<number>(cellCount).fill(DEFAULT_AMBIENT_TEMP_C),
    materialId: new Array<number>(cellCount).fill(0),
    dirtyFlags: 0,
    lastSimulatedTurn: currentTurn
  };
}

function getOrCreateFinitePhysicsSlice(map: Readonly<GameMap>, z: number, currentTurn: number): FinitePhysicsSlice {
  return map.physicsOverlay?.slices[z] ?? createEmptyFinitePhysicsSlice(map.width, map.height, currentTurn);
}

/** Reads the packed 8-bit fluid value at `(x, y, z)` across chunked or finite maps (`0` when dry/unloaded). */
export function getFluidByteAt(map: Readonly<GameMap>, x: number, y: number, z = 0): number {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord3D(cx, cy, z));
    if (!chunk) return 0;
    return chunk.fluid[worldToLocalIndex(x, y, grid.chunkSize)] ?? 0;
  }
  if (!isInMapBounds(map, x, y, z)) return 0;
  const slice = map.physicsOverlay?.slices[z];
  if (!slice) return 0;
  return slice.fluid[coordToIndex(x, y, map.width)] ?? 0;
}

/** Immutably writes the packed 8-bit fluid value at `(x, y, z)`, flagging dirty fluid & neighbor chunks. */
export function setFluidByteAt(
  map: Readonly<GameMap>,
  x: number,
  y: number,
  fluidByte: number,
  z = 0,
  currentTurn = 0
): GameMap {
  const clampedByte = Math.max(0, Math.min(255, Math.round(fluidByte)));
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunkKey = packWorldCoord3D(cx, cy, z);
    const existing = grid.chunks.get(chunkKey);
    if (!existing) return map;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    if (existing.fluid[localIdx] === clampedByte) return map;

    const cloned = cloneWorldChunk(existing);
    cloned.fluid[localIdx] = clampedByte;
    const nextChunk: WorldChunk = {
      ...cloned,
      dirtyFlags: existing.dirtyFlags | CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP | CHUNK_DIRTY_PERSIST
    };
    const nextChunks = new Map(grid.chunks);
    nextChunks.set(chunkKey, nextChunk);
    const nextDirtyKeys = new Set(grid.dirtyChunkKeys);
    nextDirtyKeys.add(chunkKey);

    const lx = ((x % grid.chunkSize) + grid.chunkSize) % grid.chunkSize;
    const ly = ((y % grid.chunkSize) + grid.chunkSize) % grid.chunkSize;
    const neighbors: Array<readonly [number, number]> = [];
    if (lx === 0) neighbors.push([-1, 0]);
    if (lx === grid.chunkSize - 1) neighbors.push([1, 0]);
    if (ly === 0) neighbors.push([0, -1]);
    if (ly === grid.chunkSize - 1) neighbors.push([0, 1]);
    for (const [dcx, dcy] of neighbors) {
      const nKey = packWorldCoord3D(cx + dcx, cy + dcy, z);
      const nChunk = nextChunks.get(nKey);
      if (nChunk) {
        nextChunks.set(nKey, { ...nChunk, dirtyFlags: nChunk.dirtyFlags | CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP });
      }
    }

    return {
      ...map,
      chunkGrid: { ...grid, chunks: nextChunks, dirtyChunkKeys: nextDirtyKeys }
    };
  }

  if (!isInMapBounds(map, x, y, z)) return map;
  const idx = coordToIndex(x, y, map.width);
  const existing = getOrCreateFinitePhysicsSlice(map, z, currentTurn);
  if ((existing.fluid[idx] ?? 0) === clampedByte && map.physicsOverlay?.slices[z] !== undefined) {
    return map;
  }
  const nextFluid = [...existing.fluid];
  nextFluid[idx] = clampedByte;
  return {
    ...map,
    physicsOverlay: {
      slices: {
        ...(map.physicsOverlay?.slices ?? {}),
        [z]: {
          ...existing,
          fluid: nextFluid,
          dirtyFlags: existing.dirtyFlags | CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP
        }
      }
    }
  };
}

/** Reads the cellular temperature in °C at `(x, y, z)`, defaulting to `DEFAULT_AMBIENT_TEMP_C`. */
export function getTemperatureAt(map: Readonly<GameMap>, x: number, y: number, z = 0): number {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord3D(cx, cy, z));
    if (!chunk) return DEFAULT_AMBIENT_TEMP_C;
    return chunk.temperature[worldToLocalIndex(x, y, grid.chunkSize)] ?? DEFAULT_AMBIENT_TEMP_C;
  }
  if (!isInMapBounds(map, x, y, z)) return DEFAULT_AMBIENT_TEMP_C;
  const slice = map.physicsOverlay?.slices[z];
  if (!slice) return DEFAULT_AMBIENT_TEMP_C;
  return slice.temperature[coordToIndex(x, y, map.width)] ?? DEFAULT_AMBIENT_TEMP_C;
}

/** Immutably updates cell temperature in °C at `(x, y, z)`, setting `CHUNK_DIRTY_TEMP`. */
export function setTemperatureAt(
  map: Readonly<GameMap>,
  x: number,
  y: number,
  tempC: number,
  z = 0,
  currentTurn = 0
): GameMap {
  const clampedTemp = Math.max(MIN_CELL_TEMP_C, Math.min(MAX_CELL_TEMP_C, Math.round(tempC)));
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunkKey = packWorldCoord3D(cx, cy, z);
    const existing = grid.chunks.get(chunkKey);
    if (!existing) return map;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    if (existing.temperature[localIdx] === clampedTemp) return map;

    const cloned = cloneWorldChunk(existing);
    cloned.temperature[localIdx] = clampedTemp;
    const nextChunk: WorldChunk = {
      ...cloned,
      dirtyFlags: existing.dirtyFlags | CHUNK_DIRTY_TEMP | CHUNK_DIRTY_PERSIST
    };
    const nextChunks = new Map(grid.chunks);
    nextChunks.set(chunkKey, nextChunk);
    const nextDirtyKeys = new Set(grid.dirtyChunkKeys);
    nextDirtyKeys.add(chunkKey);
    return {
      ...map,
      chunkGrid: { ...grid, chunks: nextChunks, dirtyChunkKeys: nextDirtyKeys }
    };
  }

  if (!isInMapBounds(map, x, y, z)) return map;
  const idx = coordToIndex(x, y, map.width);
  const existing = getOrCreateFinitePhysicsSlice(map, z, currentTurn);
  if ((existing.temperature[idx] ?? DEFAULT_AMBIENT_TEMP_C) === clampedTemp && map.physicsOverlay?.slices[z]) {
    return map;
  }
  const nextTemps = [...existing.temperature];
  nextTemps[idx] = clampedTemp;
  return {
    ...map,
    physicsOverlay: {
      slices: {
        ...(map.physicsOverlay?.slices ?? {}),
        [z]: {
          ...existing,
          temperature: nextTemps,
          dirtyFlags: existing.dirtyFlags | CHUNK_DIRTY_TEMP
        }
      }
    }
  };
}

/** Reads the `MaterialPaletteRegistry` index at `(x, y, z)`. */
export function getMaterialIndexAt(map: Readonly<GameMap>, x: number, y: number, z = 0): number {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord3D(cx, cy, z));
    if (!chunk) return 0;
    return chunk.materialId[worldToLocalIndex(x, y, grid.chunkSize)] ?? 0;
  }
  if (!isInMapBounds(map, x, y, z)) return 0;
  return map.physicsOverlay?.slices[z]?.materialId[coordToIndex(x, y, map.width)] ?? 0;
}

/** Immutably updates the `MaterialPaletteRegistry` index at `(x, y, z)`. */
export function setMaterialIndexAt(
  map: Readonly<GameMap>,
  x: number,
  y: number,
  materialIdx: number,
  z = 0,
  currentTurn = 0
): GameMap {
  const clamped = Math.max(0, Math.min(65535, Math.round(materialIdx)));
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunkKey = packWorldCoord3D(cx, cy, z);
    const existing = grid.chunks.get(chunkKey);
    if (!existing) return map;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    if (existing.materialId[localIdx] === clamped) return map;

    const cloned = cloneWorldChunk(existing);
    cloned.materialId[localIdx] = clamped;
    const nextChunks = new Map(grid.chunks);
    nextChunks.set(chunkKey, { ...cloned, dirtyFlags: existing.dirtyFlags | CHUNK_DIRTY_PERSIST });
    const nextDirtyKeys = new Set(grid.dirtyChunkKeys);
    nextDirtyKeys.add(chunkKey);
    return {
      ...map,
      chunkGrid: { ...grid, chunks: nextChunks, dirtyChunkKeys: nextDirtyKeys }
    };
  }

  if (!isInMapBounds(map, x, y, z)) return map;
  const idx = coordToIndex(x, y, map.width);
  const existing = getOrCreateFinitePhysicsSlice(map, z, currentTurn);
  const nextMats = [...existing.materialId];
  nextMats[idx] = clamped;
  return {
    ...map,
    physicsOverlay: {
      slices: {
        ...(map.physicsOverlay?.slices ?? {}),
        [z]: { ...existing, materialId: nextMats }
      }
    }
  };
}

/** Marks cellular dirty flags (`CHUNK_DIRTY_FLUID` / `CHUNK_DIRTY_TEMP`) on the chunk or slice owning `(x, y, z)`. */
export function markMapPhysicsDirtyAt(
  map: Readonly<GameMap>,
  x: number,
  y: number,
  z = 0,
  flags: number = CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP,
  currentTurn = 0
): GameMap {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunkKey = packWorldCoord3D(cx, cy, z);
    const existing = grid.chunks.get(chunkKey);
    if (
      !existing ||
      ((existing.dirtyFlags & flags) === flags &&
        ((flags & CHUNK_DIRTY_PERSIST) === 0 || grid.dirtyChunkKeys.has(chunkKey)))
    ) {
      return map;
    }
    const nextFlags = existing.dirtyFlags | flags;
    const nextChunks = new Map(grid.chunks);
    nextChunks.set(chunkKey, { ...existing, dirtyFlags: nextFlags });
    let nextDirtyKeys: ReadonlySet<number> = grid.dirtyChunkKeys;
    if ((nextFlags & CHUNK_DIRTY_PERSIST) !== 0 && !grid.dirtyChunkKeys.has(chunkKey)) {
      const mutableDirty = new Set(grid.dirtyChunkKeys);
      mutableDirty.add(chunkKey);
      nextDirtyKeys = mutableDirty;
    }
    return { ...map, chunkGrid: { ...grid, chunks: nextChunks, dirtyChunkKeys: nextDirtyKeys } };
  }
  if (!isInMapBounds(map, x, y, z)) return map;
  const existing = getOrCreateFinitePhysicsSlice(map, z, currentTurn);
  if ((existing.dirtyFlags & flags) === flags && map.physicsOverlay?.slices[z] !== undefined) return map;
  return {
    ...map,
    physicsOverlay: {
      slices: {
        ...(map.physicsOverlay?.slices ?? {}),
        [z]: { ...existing, dirtyFlags: existing.dirtyFlags | flags }
      }
    }
  };
}

/** Collects only chunks or finite slices whose `dirtyFlags` match `requiredDirtyMask`. */
export function collectDirtyPhysicsRegions(
  map: Readonly<GameMap>,
  requiredDirtyMask: number
): ReadonlyArray<PhysicsRegionBounds> {
  const regions: PhysicsRegionBounds[] = [];
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    for (const [chunkKey, chunk] of grid.chunks.entries()) {
      if ((chunk.dirtyFlags & requiredDirtyMask) === 0) continue;
      regions.push({
        kind: 'chunk',
        z: chunk.cz,
        minX: chunk.cx * chunk.size,
        minY: chunk.cy * chunk.size,
        width: chunk.size,
        height: chunk.size,
        chunkKey,
        dirtyFlags: chunk.dirtyFlags,
        lastSimulatedTurn: chunk.lastSimulatedTurn
      });
    }
    return regions;
  }

  const slices = map.physicsOverlay?.slices;
  if (!slices) return regions;
  for (const [zStr, slice] of Object.entries(slices)) {
    if ((slice.dirtyFlags & requiredDirtyMask) === 0) continue;
    regions.push({
      kind: 'finite',
      z: Number(zStr),
      minX: 0,
      minY: 0,
      width: map.width,
      height: map.height,
      dirtyFlags: slice.dirtyFlags,
      lastSimulatedTurn: slice.lastSimulatedTurn
    });
  }
  return regions;
}

/** Updates `dirtyFlags` and `lastSimulatedTurn` on a processed chunk or finite physics slice. */
export function updatePhysicsRegionStatus(
  map: Readonly<GameMap>,
  region: PhysicsRegionBounds,
  nextDirtyFlags: number,
  currentTurn: number
): GameMap {
  if (region.kind === 'chunk' && region.chunkKey !== undefined && map.chunkGrid !== undefined) {
    const existing = map.chunkGrid.chunks.get(region.chunkKey);
    if (!existing) return map;
    const nextChunks = new Map(map.chunkGrid.chunks);
    nextChunks.set(region.chunkKey, {
      ...existing,
      dirtyFlags: nextDirtyFlags,
      lastSimulatedTurn: currentTurn
    });
    let nextDirtyKeys: ReadonlySet<number> = map.chunkGrid.dirtyChunkKeys;
    if ((nextDirtyFlags & CHUNK_DIRTY_PERSIST) !== 0 && !map.chunkGrid.dirtyChunkKeys.has(region.chunkKey)) {
      const mutableDirty = new Set(map.chunkGrid.dirtyChunkKeys);
      mutableDirty.add(region.chunkKey);
      nextDirtyKeys = mutableDirty;
    }
    return {
      ...map,
      chunkGrid: { ...map.chunkGrid, chunks: nextChunks, dirtyChunkKeys: nextDirtyKeys }
    };
  }

  const existingSlice = map.physicsOverlay?.slices[region.z];
  if (!existingSlice) return map;
  return {
    ...map,
    physicsOverlay: {
      slices: {
        ...map.physicsOverlay!.slices,
        [region.z]: {
          ...existingSlice,
          dirtyFlags: nextDirtyFlags,
          lastSimulatedTurn: currentTurn
        }
      }
    }
  };
}
