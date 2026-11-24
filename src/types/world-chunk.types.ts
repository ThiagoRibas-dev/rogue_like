import type { Component } from './components.types.ts';
import type { EntityId } from './game-state.types.ts';

/**
 * Deterministic flyweight lookup translating string tile IDs to compact Uint16Array indices
 * (`0` reserved for empty/void cells; `1..N` ordered deterministically by tile ID).
 */
export interface TilePaletteRegistry {
  readonly indexToTileId: ReadonlyArray<string>;
  readonly tileIdToIndex: Readonly<Record<string, number>>;
}

/**
 * Structure-of-Arrays (SoA) TypedArray chunk container holding dense terrain, material, fluid,
 * thermal, flag, and region connectivity planes (~10 bytes per tile).
 */
export interface WorldChunk {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly size: number;
  readonly tileType: Uint16Array;
  readonly materialId: Uint16Array;
  readonly fluid: Uint8Array;
  readonly temperature: Int16Array;
  readonly flags: Uint8Array;
  readonly regionId: Uint16Array;
  readonly dirtyFlags: number;
  readonly lastSimulatedTurn: number;
}

/**
 * Serialized child entity owned by a dormant chunk root entity (e.g., carried item or equipment).
 */
export interface OwnedDormantEntityRecord {
  readonly entityId: EntityId;
  readonly components: Readonly<Record<string, Component>>;
}

/**
 * Cold-storage snapshot of a root entity (and its owned entities) packed when its chunk leaves Ring 0.
 */
export interface DormantChunkEntityRecord {
  readonly entityId: EntityId;
  readonly components: Readonly<Record<string, Component>>;
  readonly ownedEntities: ReadonlyArray<OwnedDormantEntityRecord>;
}

/**
 * Live chunked overworld map container stored on `GameMap.chunkGrid` for streaming areas.
 */
export interface ChunkedWorldGrid {
  readonly areaId: string;
  readonly worldSeed: number;
  readonly chunkSize: number;
  readonly activeRadiusChunks: number;
  readonly prefetchRadiusChunks: number;
  readonly evictRadiusChunks: number;
  readonly originChunkX: number;
  readonly originChunkY: number;
  readonly palette: TilePaletteRegistry;
  readonly chunks: ReadonlyMap<number, WorldChunk>;
  readonly dirtyChunkKeys: ReadonlySet<number>;
  readonly evictedChunkEntities: Readonly<Record<string, ReadonlyArray<DormantChunkEntityRecord>>>;
}

/**
 * Slim JSON-serializable metadata describing a streaming world (excluding raw TypedArray chunk payloads,
 * which are stored asynchronously in IndexedDB as binary deltas).
 */
export interface SerializedStreamingWorldState {
  readonly areaId: string;
  readonly worldSeed: number;
  readonly chunkSize: number;
  readonly activeRadiusChunks: number;
  readonly prefetchRadiusChunks: number;
  readonly evictRadiusChunks: number;
  readonly originChunkX: number;
  readonly originChunkY: number;
  readonly dirtyChunkKeys: ReadonlyArray<number>;
  readonly evictedChunkEntities: Readonly<Record<string, ReadonlyArray<DormantChunkEntityRecord>>>;
}

/**
 * Lightweight normalized tile view returned uniformly by `MapAccessor` across finite and chunked maps.
 */
export interface TileSnapshot {
  readonly tileId: string;
  readonly x: number;
  readonly y: number;
  readonly explored: boolean;
}
