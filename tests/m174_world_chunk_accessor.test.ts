import { describe, expect, it } from 'bun:test';
import { CHUNK_DIRTY_PERSIST, CHUNK_FLAG_EXPLORED } from '../src/constants/world_chunk.constants.ts';
import { computeFOV } from '../src/map/fov.ts';
import {
  getTileAt,
  getTileDefAt,
  isInMapBounds,
  isTileExploredAt,
  isTileKeyInFov,
  markTilesExplored,
  setTileIdAt,
  toMapTileKey
} from '../src/map/map_accessor.ts';
import {
  buildTilePaletteRegistry,
  getPaletteIndexForTileId,
  getTileIdFromPaletteIndex
} from '../src/map/tile_palette.ts';
import {
  createEmptyWorldChunk,
  deserializeWorldChunkFromBuffer,
  serializeWorldChunkToBuffer
} from '../src/map/world_chunk.ts';
import type { ChunkedWorldGrid, WorldChunk } from '../src/types/world-chunk.types.ts';
import type { GameMap, GameState } from '../src/types/game-state.types.ts';
import {
  packWorldCoord,
  unpackWorldCoord,
  worldToChunkCoord,
  worldToLocalCoord,
  worldToLocalIndex
} from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 174: WorldChunk SoA, TilePaletteRegistry, packWorldCoord & MapAccessor', () => {
  const campaign = loadCampaignFromDisk('default');

  it('packs and unpacks signed 26-bit world coordinates accurately across negative and extreme ranges', () => {
    const samples: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [-1, -1],
      [-16, 15],
      [-50_000, 123_456],
      [-33_554_431, 33_554_431],
      [33_554_431, -33_554_431]
    ];

    for (const [x, y] of samples) {
      const packed = packWorldCoord(x, y);
      expect(Number.isSafeInteger(packed)).toBe(true);
      expect(unpackWorldCoord(packed)).toEqual({ x, y });
    }
    expect(worldToChunkCoord(-1, 16)).toBe(-1);
    expect(worldToLocalCoord(-1, 16)).toBe(15);
    expect(worldToChunkCoord(-17, 16)).toBe(-2);
    expect(worldToLocalIndex(-1, -1, 16)).toBe(255);
  });

  it('builds deterministic TilePaletteRegistry independent of tile key insertion order', () => {
    const reversedTiles = Object.fromEntries(Object.entries(campaign.tiles).reverse());
    const p1 = buildTilePaletteRegistry(campaign.tiles);
    const p2 = buildTilePaletteRegistry(reversedTiles);

    expect(p1.indexToTileId).toEqual(p2.indexToTileId);
    expect(p1.indexToTileId[0]).toBe('');
    const floorIdx = getPaletteIndexForTileId(p1, 'stone_floor');
    expect(floorIdx).toBeGreaterThan(0);
    expect(getTileIdFromPaletteIndex(p1, floorIdx)).toBe('stone_floor');
    expect(getTileIdFromPaletteIndex(p1, 0)).toBeUndefined();
  });

  it('round-trips WorldChunk SoA planes via binary ArrayBuffer serialization for 16x16 and 32x32 chunks', () => {
    for (const size of [16, 32] as const) {
      const chunk = createEmptyWorldChunk(-3, 7, 0, size);
      chunk.tileType[0] = 2;
      chunk.tileType[size * size - 1] = 5;
      chunk.materialId[3] = 11;
      chunk.fluid[4] = 0x25;
      chunk.temperature[5] = -12;
      chunk.flags[6] = CHUNK_FLAG_EXPLORED;
      chunk.regionId[7] = 42;
      const dirtyChunk: WorldChunk = { ...chunk, dirtyFlags: CHUNK_DIRTY_PERSIST, lastSimulatedTurn: 123 };

      const buffer = serializeWorldChunkToBuffer(dirtyChunk);
      expect(buffer.byteLength).toBe(32 + size * size * 10);

      const restored = deserializeWorldChunkFromBuffer(buffer);
      expect(restored.cx).toBe(-3);
      expect(restored.cy).toBe(7);
      expect(restored.cz).toBe(0);
      expect(restored.size).toBe(size);
      expect(restored.dirtyFlags).toBe(CHUNK_DIRTY_PERSIST);
      expect(restored.lastSimulatedTurn).toBe(123);
      expect(restored.tileType[0]).toBe(2);
      expect(restored.tileType[size * size - 1]).toBe(5);
      expect(restored.materialId[3]).toBe(11);
      expect(restored.fluid[4]).toBe(0x25);
      expect(restored.temperature[5]).toBe(-12);
      expect(restored.flags[6]).toBe(CHUNK_FLAG_EXPLORED);
      expect(restored.regionId[7]).toBe(42);
    }
  });

  it('bridges finite GameMap and ChunkedWorldGrid uniformly through MapAccessor and computeFOV across (-1 <-> 0) borders', () => {
    const baseState = buildGameState(campaign);
    const palette = buildTilePaletteRegistry(campaign.tiles);
    const floorIdx = getPaletteIndexForTileId(palette, 'stone_floor');
    const wallIdx = getPaletteIndexForTileId(palette, 'stone_wall');

    const chunks = new Map<number, WorldChunk>();
    for (const [cx, cy] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0]
    ] as const) {
      const c = createEmptyWorldChunk(cx, cy, 0, 16);
      c.tileType.fill(floorIdx);
      chunks.set(packWorldCoord(cx, cy), c);
    }

    // Place a wall at (-2, 0) in chunk (-1, 0)
    const westChunk = chunks.get(packWorldCoord(-1, 0))!;
    westChunk.tileType[worldToLocalIndex(-2, 0, 16)] = wallIdx;

    const grid: ChunkedWorldGrid = {
      areaId: 'test_chunked',
      worldSeed: 1,
      chunkSize: 16,
      activeRadiusChunks: 1,
      prefetchRadiusChunks: 2,
      evictRadiusChunks: 3,
      originChunkX: 0,
      originChunkY: 0,
      palette,
      chunks,
      dirtyChunkKeys: new Set(),
      evictedChunkEntities: {}
    };

    let map: GameMap = { width: 0, height: 0, tiles: [], chunkGrid: grid };
    expect(isInMapBounds(map, -1, 0)).toBe(true);
    expect(isInMapBounds(map, -100, 0)).toBe(false);
    expect(getTileAt(map, -2, 0)?.tileId).toBe('stone_wall');
    expect(getTileAt(map, 0, 0)?.tileId).toBe('stone_floor');

    map = setTileIdAt(map, -1, -1, 'shallow_water');
    expect(getTileAt(map, -1, -1)?.tileId).toBe('shallow_water');
    expect(map.chunkGrid?.dirtyChunkKeys.has(packWorldCoord(-1, -1))).toBe(true);

    const chunkState: GameState = { ...baseState, map };
    expect(getTileDefAt(chunkState, -2, 0)?.walkable).toBe(false);

    const fovKeys = computeFOV(chunkState, 0, 0, 5);
    expect(fovKeys.has(toMapTileKey(map, -1, 0))).toBe(true);
    expect(fovKeys.has(toMapTileKey(map, -3, 0))).toBe(false); // occluded by wall at (-2, 0)

    const exploredMap = markTilesExplored(map, fovKeys);
    expect(isTileExploredAt(exploredMap, -1, 0)).toBe(true);
    expect(isTileExploredAt(exploredMap, -15, -15)).toBe(false);

    const withFovState: GameState = { ...chunkState, map: exploredMap, cachedFov: fovKeys };
    expect(isTileKeyInFov(withFovState, -1, 0)).toBe(true);
    expect(isTileKeyInFov(withFovState, -3, 0)).toBe(false);
  });
});
