import {
  BIOME_FOREST_MOISTURE_MIN,
  BIOME_RIDGE_ELEVATION_MIN,
  BIOME_SHORE_ELEVATION_MAX,
  BIOME_WATER_ELEVATION_MAX,
  CHUNK_FLAG_NATURAL,
  CHUNK_FLAG_OUTDOOR,
  DEFAULT_ACTIVE_RADIUS_CHUNKS,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_EVICT_RADIUS_CHUNKS,
  DEFAULT_PREFETCH_RADIUS_CHUNKS,
  DEFAULT_SPAWN_CLEARING_RADIUS,
  DEFAULT_STREAMING_WORLD_SEED,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  NOISE_OCTAVE1_SPAN,
  NOISE_OCTAVE1_WEIGHT,
  NOISE_OCTAVE2_SPAN,
  NOISE_OCTAVE2_WEIGHT,
  NOISE_OCTAVE3_SPAN,
  NOISE_OCTAVE3_WEIGHT,
  SPAWN_CLEARING_ROAD_DIST_SQ
} from '../constants/world_chunk.constants.ts';
import type { AreaDefinition, CampaignData } from '../types/campaign.types.ts';
import type {
  ChunkedWorldGrid,
  SerializedStreamingWorldState,
  TilePaletteRegistry,
  WorldChunk
} from '../types/world-chunk.types.ts';
import { packWorldCoord } from '../utils/grid.ts';
import { buildTilePaletteRegistry, getPaletteIndexForTileId } from './tile_palette.ts';
import { createEmptyWorldChunk } from './world_chunk.ts';

/**
 * Resolved numeric palette indices for fast zero-allocation chunk synthesis inside main or worker threads.
 */
export interface StreamingBiomePaletteIndices {
  readonly water: number;
  readonly shore: number;
  readonly plains: number;
  readonly forest: number;
  readonly ridge: number;
  readonly road: number;
}

/**
 * Pre-resolved scalar configuration passed deterministically across main thread and chunk workers.
 */
export interface ChunkSynthesisParams {
  readonly worldSeed: number;
  readonly areaId: string;
  readonly chunkSize: number;
  readonly spawnClearingRadius: number;
  readonly isOutdoor: boolean;
  readonly biomeIndices: StreamingBiomePaletteIndices;
}

function hashStringDeterministic(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

function hashCoordDeterministic(seed: number, x: number, y: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 374761393);
  h = Math.imul(h ^ (y | 0), 668265263);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

function sampleValueNoise2D(seed: number, wx: number, wy: number, cellSpan: number): number {
  const gx = Math.floor(wx / cellSpan);
  const gy = Math.floor(wy / cellSpan);
  const tx = smoothstep01((wx - gx * cellSpan) / cellSpan);
  const ty = smoothstep01((wy - gy * cellSpan) / cellSpan);

  const v00 = hashCoordDeterministic(seed, gx, gy);
  const v10 = hashCoordDeterministic(seed, gx + 1, gy);
  const v01 = hashCoordDeterministic(seed, gx, gy + 1);
  const v11 = hashCoordDeterministic(seed, gx + 1, gy + 1);

  const nx0 = v00 + (v10 - v00) * tx;
  const nx1 = v01 + (v11 - v01) * tx;
  return nx0 + (nx1 - nx0) * ty;
}

function sampleFractalNoise(seed: number, wx: number, wy: number): number {
  const n1 = sampleValueNoise2D(seed, wx, wy, NOISE_OCTAVE1_SPAN) * NOISE_OCTAVE1_WEIGHT;
  const n2 = sampleValueNoise2D(seed ^ 0x9e3779b9, wx, wy, NOISE_OCTAVE2_SPAN) * NOISE_OCTAVE2_WEIGHT;
  const n3 = sampleValueNoise2D(seed ^ 0x85ebca6b, wx, wy, NOISE_OCTAVE3_SPAN) * NOISE_OCTAVE3_WEIGHT;
  return n1 + n2 + n3;
}

/**
 * Resolves compact palette indices from a campaign `TilePaletteRegistry` and `AreaDefinition.streamingConfig`.
 *
 * @param palette Active TilePaletteRegistry.
 * @param areaDef Source area definition containing `streamingConfig`.
 * @returns Numeric biome indices and chunk synthesis parameters.
 */
export function buildChunkSynthesisParams(
  palette: TilePaletteRegistry,
  areaDef: Readonly<AreaDefinition>
): ChunkSynthesisParams {
  const cfg = areaDef.streamingConfig;
  const plainsTileId = cfg?.biomePalette.plains ?? palette.indexToTileId[1] ?? '';
  const plains = getPaletteIndexForTileId(palette, plainsTileId);
  const pickOrPlains = (tileId: string | undefined): number => {
    if (!tileId) return plains;
    const idx = getPaletteIndexForTileId(palette, tileId);
    return idx > 0 ? idx : plains;
  };

  return {
    worldSeed: cfg?.worldSeed ?? DEFAULT_STREAMING_WORLD_SEED,
    areaId: areaDef.id,
    chunkSize: Math.max(MIN_CHUNK_SIZE, Math.min(MAX_CHUNK_SIZE, cfg?.chunkSize ?? DEFAULT_CHUNK_SIZE)),
    spawnClearingRadius: cfg?.spawnClearingRadius ?? DEFAULT_SPAWN_CLEARING_RADIUS,
    isOutdoor: areaDef.environmentType !== 'underground',
    biomeIndices: {
      water: pickOrPlains(cfg?.biomePalette.water),
      shore: pickOrPlains(cfg?.biomePalette.shore),
      plains,
      forest: pickOrPlains(cfg?.biomePalette.forest),
      ridge: pickOrPlains(cfg?.biomePalette.ridge),
      road: pickOrPlains(cfg?.biomePalette.road)
    }
  };
}

/**
 * Deterministically synthesizes a single `WorldChunk` cleanly across seamless signed coordinates
 * with continuous multi-octave biome terrain and an open spawn clearing around `(0, 0)`.
 *
 * @param params Pre-resolved seed, chunkSize, and biome palette indices.
 * @param cx Signed chunk X coordinate.
 * @param cy Signed chunk Y coordinate.
 * @param cz Signed chunk Z coordinate (default `0`).
 * @returns Synthesized SoA `WorldChunk`.
 */
export function generateWorldChunkFromParams(params: ChunkSynthesisParams, cx: number, cy: number, cz = 0): WorldChunk {
  const chunk = createEmptyWorldChunk(cx, cy, cz, params.chunkSize);
  const areaHash = hashStringDeterministic(params.areaId);
  const elevSeed = (params.worldSeed ^ areaHash) | 0;
  const moistSeed = (params.worldSeed ^ Math.imul(areaHash, 31) ^ 0x51f23a9d) | 0;
  const clearingSq = params.spawnClearingRadius * params.spawnClearingRadius;
  const baseFlags = CHUNK_FLAG_NATURAL | (params.isOutdoor ? CHUNK_FLAG_OUTDOOR : 0);

  for (let ly = 0; ly < chunk.size; ly++) {
    const wy = cy * chunk.size + ly;
    for (let lx = 0; lx < chunk.size; lx++) {
      const wx = cx * chunk.size + lx;
      const localIdx = ly * chunk.size + lx;
      chunk.flags[localIdx] = baseFlags;

      const distSq = wx * wx + wy * wy;
      if (distSq <= clearingSq) {
        chunk.tileType[localIdx] =
          distSq <= SPAWN_CLEARING_ROAD_DIST_SQ ? params.biomeIndices.road : params.biomeIndices.plains;
        continue;
      }

      const elevation = sampleFractalNoise(elevSeed, wx, wy);
      const moisture = sampleFractalNoise(moistSeed, wx, wy);

      if (elevation < BIOME_WATER_ELEVATION_MAX) {
        chunk.tileType[localIdx] = params.biomeIndices.water;
      } else if (elevation < BIOME_SHORE_ELEVATION_MAX) {
        chunk.tileType[localIdx] = params.biomeIndices.shore;
      } else if (elevation > BIOME_RIDGE_ELEVATION_MIN) {
        chunk.tileType[localIdx] = params.biomeIndices.ridge;
      } else if (moisture > BIOME_FOREST_MOISTURE_MIN) {
        chunk.tileType[localIdx] = params.biomeIndices.forest;
      } else {
        chunk.tileType[localIdx] = params.biomeIndices.plains;
      }
    }
  }

  return chunk;
}

/**
 * Generates a single `WorldChunk` directly from campaign data and an area definition.
 *
 * @param campaign Active CampaignData.
 * @param areaDef Target streaming area definition.
 * @param cx Signed chunk X coordinate.
 * @param cy Signed chunk Y coordinate.
 * @param cz Signed chunk Z coordinate (default `0`).
 * @returns Deterministically synthesized `WorldChunk`.
 */
export function generateWorldChunk(
  campaign: Readonly<CampaignData>,
  areaDef: Readonly<AreaDefinition>,
  cx: number,
  cy: number,
  cz = 0
): WorldChunk {
  const palette = buildTilePaletteRegistry(campaign.tiles);
  const params = buildChunkSynthesisParams(palette, areaDef);
  return generateWorldChunkFromParams(params, cx, cy, cz);
}

/**
 * Constructs a `ChunkedWorldGrid` synchronously populated across the initial Ring 0 window around `(originCx, originCy)`.
 *
 * @param campaign Loaded CampaignData.
 * @param areaDef Target streaming area definition.
 * @param originCx Initial anchor chunk X coordinate (default `0`).
 * @param originCy Initial anchor chunk Y coordinate (default `0`).
 * @param overrideMetadata Optional persisted streaming metadata for save/load restoration.
 * @returns Initialized `ChunkedWorldGrid`.
 */
export function createInitialStreamingGrid(
  campaign: Readonly<CampaignData>,
  areaDef: Readonly<AreaDefinition>,
  originCx = 0,
  originCy = 0,
  overrideMetadata?: SerializedStreamingWorldState
): ChunkedWorldGrid {
  const palette = buildTilePaletteRegistry(campaign.tiles);
  const baseParams = buildChunkSynthesisParams(palette, areaDef);
  const chunkSize = overrideMetadata?.chunkSize ?? baseParams.chunkSize;
  const activeRadiusChunks =
    overrideMetadata?.activeRadiusChunks ?? areaDef.streamingConfig?.activeRadiusChunks ?? DEFAULT_ACTIVE_RADIUS_CHUNKS;
  const prefetchRadiusChunks =
    overrideMetadata?.prefetchRadiusChunks ??
    areaDef.streamingConfig?.prefetchRadiusChunks ??
    DEFAULT_PREFETCH_RADIUS_CHUNKS;
  const evictRadiusChunks =
    overrideMetadata?.evictRadiusChunks ??
    areaDef.streamingConfig?.evictRadiusChunks ??
    Math.max(activeRadiusChunks + 2, prefetchRadiusChunks + 1, DEFAULT_EVICT_RADIUS_CHUNKS);
  const worldSeed = overrideMetadata?.worldSeed ?? baseParams.worldSeed;

  const synthParams: ChunkSynthesisParams = {
    ...baseParams,
    chunkSize,
    worldSeed
  };

  const chunks = new Map<number, WorldChunk>();
  for (let cy = originCy - activeRadiusChunks; cy <= originCy + activeRadiusChunks; cy++) {
    for (let cx = originCx - activeRadiusChunks; cx <= originCx + activeRadiusChunks; cx++) {
      chunks.set(packWorldCoord(cx, cy), generateWorldChunkFromParams(synthParams, cx, cy, 0));
    }
  }

  return {
    areaId: areaDef.id,
    worldSeed,
    chunkSize,
    activeRadiusChunks,
    prefetchRadiusChunks,
    evictRadiusChunks,
    originChunkX: originCx,
    originChunkY: originCy,
    palette,
    chunks,
    dirtyChunkKeys: new Set(overrideMetadata?.dirtyChunkKeys ?? []),
    evictedChunkEntities: overrideMetadata?.evictedChunkEntities ?? {}
  };
}
