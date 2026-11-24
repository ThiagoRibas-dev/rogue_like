import {
  CHUNK_DIRTY_PERSIST,
  CHUNK_FLAG_EXPLORED,
  DEFAULT_RANDOM_WALKABLE_ATTEMPTS
} from '../constants/world_chunk.constants.ts';
import type { TileDefinition } from '../types/campaign/world.ts';
import type { GameMap, GameState } from '../types/game-state.types.ts';
import type { TileSnapshot, WorldChunk } from '../types/world-chunk.types.ts';
import {
  coordToIndex,
  isInBounds,
  packWorldCoord,
  unpackWorldCoord,
  worldToChunkCoord,
  worldToLocalIndex
} from '../utils/grid.ts';
import { getPaletteIndexForTileId, getTileIdFromPaletteIndex } from './tile_palette.ts';
import { cloneWorldChunk } from './world_chunk.ts';

/**
 * Checks whether coordinates `(x, y)` lie within loaded map storage —
 * either inside `[0, width) x [0, height)` on finite maps or inside a currently loaded `WorldChunk`.
 *
 * @param map Active or dormant GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @returns True if a tile cell exists at `(x, y)`.
 */
export function isInMapBounds(map: Readonly<GameMap>, x: number, y: number): boolean {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    return grid.chunks.has(packWorldCoord(cx, cy));
  }
  return isInBounds(x, y, map.width, map.height);
}

/**
 * Computes the canonical FOV/lookup numeric key for `(x, y)` on either finite or chunked maps.
 * Finite maps keep `y * width + x` for 100% compatibility; chunked maps use signed 26-bit coordinate packing.
 *
 * @param map Target GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @returns Numeric tile lookup key matching `GameState.cachedFov`.
 */
export function toMapTileKey(map: Readonly<GameMap>, x: number, y: number): number {
  return map.chunkGrid !== undefined ? packWorldCoord(x, y) : coordToIndex(x, y, map.width);
}

/**
 * Returns true if world coordinate `(x, y)` is currently visible in player FOV (or `map.isFullyExplored`).
 *
 * @param state Current GameState.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @returns True when tile visibility applies at `(x, y)`.
 */
export function isTileKeyInFov(state: Readonly<GameState>, x: number, y: number): boolean {
  if (state.map.isFullyExplored) return true;
  if (!isInMapBounds(state.map, x, y)) return false;
  return state.cachedFov.has(toMapTileKey(state.map, x, y));
}

/**
 * Reads normalized tile snapshot (`tileId`, `x`, `y`, `explored`) uniformly from finite `GameMap.tiles`
 * or chunked `GameMap.chunkGrid`.
 *
 * @param map Source GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @returns TileSnapshot or `undefined` when unloaded/out of bounds.
 */
export function getTileAt(map: Readonly<GameMap>, x: number, y: number): TileSnapshot | undefined {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord(cx, cy));
    if (!chunk) return undefined;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    const paletteIdx = chunk.tileType[localIdx] ?? 0;
    const tileId = getTileIdFromPaletteIndex(grid.palette, paletteIdx);
    if (!tileId) return undefined;
    const explored = ((chunk.flags[localIdx] ?? 0) & CHUNK_FLAG_EXPLORED) !== 0;
    return { tileId, x, y, explored };
  }
  if (!isInBounds(x, y, map.width, map.height)) return undefined;
  return map.tiles[coordToIndex(x, y, map.width)];
}

/**
 * Reads only the string `tileId` at `(x, y)` with zero snapshot object allocation on chunked maps.
 *
 * @param map Source GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @returns Tile ID string or `undefined`.
 */
export function getTileIdAt(map: Readonly<GameMap>, x: number, y: number): string | undefined {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord(cx, cy));
    if (!chunk) return undefined;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    return getTileIdFromPaletteIndex(grid.palette, chunk.tileType[localIdx] ?? 0);
  }
  if (!isInBounds(x, y, map.width, map.height)) return undefined;
  return map.tiles[coordToIndex(x, y, map.width)]?.tileId;
}

/**
 * Resolves the campaign `TileDefinition` for world coordinate `(x, y)`.
 *
 * @param state Current GameState.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @returns Matching `TileDefinition` or `undefined`.
 */
export function getTileDefAt(state: Readonly<GameState>, x: number, y: number): TileDefinition | undefined {
  const tileId = getTileIdAt(state.map, x, y);
  return tileId ? state.campaign.tiles[tileId] : undefined;
}

/**
 * Returns true if the tile at `(x, y)` is currently explored (or `map.isFullyExplored`).
 *
 * @param map Source GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @returns True if explored.
 */
export function isTileExploredAt(map: Readonly<GameMap>, x: number, y: number): boolean {
  if (map.isFullyExplored) return isInMapBounds(map, x, y);
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord(cx, cy));
    if (!chunk) return false;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    return ((chunk.flags[localIdx] ?? 0) & CHUNK_FLAG_EXPLORED) !== 0;
  }
  if (!isInBounds(x, y, map.width, map.height)) return false;
  return map.tiles[coordToIndex(x, y, map.width)]?.explored === true;
}

/**
 * Immutably updates the `tileId` at `(x, y)`, cloning either the touched finite tile element
 * or the enclosing `WorldChunk` and flagging it `CHUNK_DIRTY_PERSIST`.
 *
 * @param map Source GameMap.
 * @param x World X coordinate.
 * @param y World Y coordinate.
 * @param tileId Replacement tile ID registered in campaign tiles.
 * @returns Updated GameMap (or original reference when unchanged/out of bounds).
 */
export function setTileIdAt(map: Readonly<GameMap>, x: number, y: number, tileId: string): GameMap {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunkKey = packWorldCoord(cx, cy);
    const existingChunk = grid.chunks.get(chunkKey);
    if (!existingChunk) return map;

    const nextIdx = getPaletteIndexForTileId(grid.palette, tileId);
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    if (existingChunk.tileType[localIdx] === nextIdx) return map;

    const cloned = cloneWorldChunk(existingChunk);
    cloned.tileType[localIdx] = nextIdx;
    const nextChunk: WorldChunk = {
      ...cloned,
      dirtyFlags: existingChunk.dirtyFlags | CHUNK_DIRTY_PERSIST
    };

    const nextChunks = new Map(grid.chunks);
    nextChunks.set(chunkKey, nextChunk);
    const nextDirtyKeys = new Set(grid.dirtyChunkKeys);
    nextDirtyKeys.add(chunkKey);

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
  const existingTile = map.tiles[idx];
  if (!existingTile || existingTile.tileId === tileId) return map;
  const nextTiles = [...map.tiles];
  nextTiles[idx] = { ...existingTile, tileId };
  return { ...map, tiles: nextTiles };
}

/**
 * Marks all tiles whose key (matching {@link toMapTileKey}) appears in `visibleKeys` as explored.
 * On chunked maps, clones only newly touched chunks and sets `CHUNK_DIRTY_PERSIST`.
 *
 * @param map Source GameMap.
 * @param visibleKeys Set of keys emitted by `computeFOV`.
 * @returns Updated GameMap (or original reference when no new tiles became explored).
 */
export function markTilesExplored(map: Readonly<GameMap>, visibleKeys: ReadonlySet<number>): GameMap {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    let nextChunks: Map<number, WorldChunk> | null = null;
    let nextDirtyKeys: Set<number> | null = null;
    const clonedChunkKeys = new Set<number>();

    for (const packed of visibleKeys) {
      const { x, y } = unpackWorldCoord(packed);
      const cx = worldToChunkCoord(x, grid.chunkSize);
      const cy = worldToChunkCoord(y, grid.chunkSize);
      const chunkKey = packWorldCoord(cx, cy);
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

  let modified = false;
  const nextTiles = map.tiles.map((tile, idx) => {
    if (visibleKeys.has(idx) && !tile.explored) {
      modified = true;
      return { ...tile, explored: true };
    }
    return tile;
  });
  return modified ? { ...map, tiles: nextTiles } : map;
}

/**
 * Samples a walkable unoccupied (or walkable) coordinate across either finite map dimensions
 * or currently loaded Ring 0 streaming chunks.
 *
 * @param state Current GameState (or campaign + targetMap pair via helpers).
 * @param uniformRng Uniform RNG returning `[0, 1)`.
 * @param maxAttempts Maximum sampling attempts.
 * @returns Walkable coordinate or `null`.
 */
export function findRandomWalkableCoord(
  state: Readonly<GameState>,
  uniformRng: () => number,
  maxAttempts: number = DEFAULT_RANDOM_WALKABLE_ATTEMPTS
): { readonly x: number; readonly y: number } | null {
  const grid = state.map.chunkGrid;
  if (grid !== undefined) {
    const loadedChunks = Array.from(grid.chunks.values());
    if (loadedChunks.length === 0) return null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const chunk = loadedChunks[Math.floor(uniformRng() * loadedChunks.length)];
      if (!chunk) continue;
      const lx = Math.floor(uniformRng() * chunk.size);
      const ly = Math.floor(uniformRng() * chunk.size);
      const wx = chunk.cx * chunk.size + lx;
      const wy = chunk.cy * chunk.size + ly;
      const tileDef = getTileDefAt(state, wx, wy);
      if (tileDef?.walkable) {
        return { x: wx, y: wy };
      }
    }
    return null;
  }

  if (state.map.width <= 0 || state.map.height <= 0) return null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rx = Math.floor(uniformRng() * state.map.width);
    const ry = Math.floor(uniformRng() * state.map.height);
    const tileDef = getTileDefAt(state, rx, ry);
    if (tileDef?.walkable) {
      return { x: rx, y: ry };
    }
  }
  return null;
}

/**
 * Computes a safe center fallback coordinate across either finite map dimensions
 * or a streaming grid's active origin chunk center.
 *
 * @param map Target GameMap.
 * @returns Center coordinate `{ x, y }`.
 */
export function getMapCenterFallbackCoord(map: Readonly<GameMap>): { readonly x: number; readonly y: number } {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    return {
      x: grid.originChunkX * grid.chunkSize + Math.floor(grid.chunkSize / 2),
      y: grid.originChunkY * grid.chunkSize + Math.floor(grid.chunkSize / 2)
    };
  }
  return {
    x: Math.floor(map.width / 2),
    y: Math.floor(map.height / 2)
  };
}
