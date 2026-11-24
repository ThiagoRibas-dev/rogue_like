import {
  CHUNK_DIRTY_PERSIST,
  WORLD_CHUNKS_DB_NAME,
  WORLD_CHUNKS_DB_VERSION,
  WORLD_CHUNKS_STORE
} from '../constants/world_chunk.constants.ts';
import { deserializeWorldChunkFromBuffer, serializeWorldChunkToBuffer } from '../map/world_chunk.ts';
import type { GameState } from '../types/game-state.types.ts';
import type { ChunkedWorldGrid, WorldChunk } from '../types/world-chunk.types.ts';
import { unpackWorldCoord } from '../utils/grid.ts';

let chunkDbPromise: Promise<IDBDatabase> | null = null;
const memoryChunkStore = new Map<string, ArrayBuffer>();

/**
 * Formats a unique storage key identifying a delta chunk record for a save slot / campaign scope.
 *
 * @param scopeKey Save slot / campaign identifier.
 * @param areaId Streaming area ID.
 * @param cx Chunk X coordinate.
 * @param cy Chunk Y coordinate.
 * @param cz Chunk Z coordinate (default `0`).
 * @returns Canonical IndexedDB / memory-store key.
 */
export function buildChunkStorageKey(scopeKey: string, areaId: string, cx: number, cy: number, cz = 0): string {
  return `${scopeKey}:${areaId}:${cx}:${cy}:${cz}`;
}

/**
 * Derives the default chunk persistence scope key for a live or serialized campaign run.
 *
 * @param campaignId Active campaign ID.
 * @returns Deterministic storage scope key.
 */
export function resolveDefaultChunkScopeKey(campaignId: string): string {
  return `save:${campaignId || 'default'}`;
}

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openChunkDb(): Promise<IDBDatabase> {
  if (chunkDbPromise) return chunkDbPromise;
  chunkDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(WORLD_CHUNKS_DB_NAME, WORLD_CHUNKS_DB_VERSION);
    request.onupgradeneeded = (event: IDBVersionChangeEvent): void => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(WORLD_CHUNKS_STORE)) {
        db.createObjectStore(WORLD_CHUNKS_STORE);
      }
    };
    request.onsuccess = (event: Event): void => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
    request.onerror = (event: Event): void => {
      chunkDbPromise = null;
      reject((event.target as IDBOpenDBRequest).error ?? new Error('Failed to open world chunks IndexedDB'));
    };
  });
  return chunkDbPromise;
}

/**
 * Synchronously mirrors a modified `WorldChunk` buffer into the in-memory delta cache so
 * immediate round-trip reloads / streaming re-entry see unsaved dirty edits before async IndexedDB flushes settle.
 *
 * @param scopeKey Persistence scope key.
 * @param areaId Area ID.
 * @param chunk Dirty WorldChunk to cache.
 */
export function putWorldChunkDeltaSync(scopeKey: string, areaId: string, chunk: WorldChunk): void {
  const key = buildChunkStorageKey(scopeKey, areaId, chunk.cx, chunk.cy, chunk.cz);
  memoryChunkStore.set(key, serializeWorldChunkToBuffer(chunk));
}

/**
 * Synchronously reads a cached/in-memory delta chunk buffer if present.
 *
 * @param scopeKey Persistence scope key.
 * @param areaId Area ID.
 * @param cx Chunk X coordinate.
 * @param cy Chunk Y coordinate.
 * @param cz Chunk Z coordinate.
 * @returns Restored `WorldChunk` or `undefined`.
 */
export function getCachedWorldChunkDeltaSync(
  scopeKey: string,
  areaId: string,
  cx: number,
  cy: number,
  cz = 0
): WorldChunk | undefined {
  const key = buildChunkStorageKey(scopeKey, areaId, cx, cy, cz);
  const buffer = memoryChunkStore.get(key);
  if (!buffer) return undefined;
  return deserializeWorldChunkFromBuffer(buffer);
}

/**
 * Persists a single dirty `WorldChunk` binary buffer asynchronously into IndexedDB `WORLD_CHUNKS_STORE`
 * (or keeps it in the headless in-memory fallback when `indexedDB` is unavailable).
 *
 * @param scopeKey Persistence scope key.
 * @param areaId Area ID.
 * @param chunk Modified WorldChunk.
 */
export async function saveWorldChunkDelta(scopeKey: string, areaId: string, chunk: WorldChunk): Promise<void> {
  const key = buildChunkStorageKey(scopeKey, areaId, chunk.cx, chunk.cy, chunk.cz);
  const buffer = serializeWorldChunkToBuffer(chunk);
  memoryChunkStore.set(key, buffer);

  if (!isIndexedDbAvailable()) {
    return;
  }

  try {
    const db = await openChunkDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(WORLD_CHUNKS_STORE, 'readwrite');
      const store = tx.objectStore(WORLD_CHUNKS_STORE);
      const req = store.put(buffer, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to persist world chunk delta to IndexedDB:', err);
  }
}

/**
 * Loads a previously saved dirty `WorldChunk` delta from synchronous cache or IndexedDB.
 *
 * @param scopeKey Persistence scope key.
 * @param areaId Area ID.
 * @param cx Chunk X coordinate.
 * @param cy Chunk Y coordinate.
 * @param cz Chunk Z coordinate.
 * @returns Restored `WorldChunk`, or `undefined` if never dirtied.
 */
export async function loadWorldChunkDelta(
  scopeKey: string,
  areaId: string,
  cx: number,
  cy: number,
  cz = 0
): Promise<WorldChunk | undefined> {
  const cached = getCachedWorldChunkDeltaSync(scopeKey, areaId, cx, cy, cz);
  if (cached) return cached;

  if (!isIndexedDbAvailable()) {
    return undefined;
  }

  const key = buildChunkStorageKey(scopeKey, areaId, cx, cy, cz);
  try {
    const db = await openChunkDb();
    const buffer = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      const tx = db.transaction(WORLD_CHUNKS_STORE, 'readonly');
      const store = tx.objectStore(WORLD_CHUNKS_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!buffer) return undefined;
    memoryChunkStore.set(key, buffer);
    return deserializeWorldChunkFromBuffer(buffer);
  } catch (err) {
    console.warn('Failed to load world chunk delta from IndexedDB:', err);
    return undefined;
  }
}

async function flushGridDirtyChunks(grid: ChunkedWorldGrid, scopeKey: string): Promise<number> {
  let flushedCount = 0;
  const tasks: Array<Promise<void>> = [];
  for (const chunk of grid.chunks.values()) {
    if ((chunk.dirtyFlags & CHUNK_DIRTY_PERSIST) !== 0) {
      putWorldChunkDeltaSync(scopeKey, grid.areaId, chunk);
      tasks.push(saveWorldChunkDelta(scopeKey, grid.areaId, chunk));
      flushedCount++;
    }
  }
  await Promise.all(tasks);
  return flushedCount;
}

/**
 * Flushes all modified chunks (`CHUNK_DIRTY_PERSIST`) in the active area and dormant streaming areas
 * to delta storage while skipping untouched chunks cleanly.
 *
 * @param state Current GameState.
 * @param scopeKey Optional override for the persistence scope key.
 * @returns Number of dirty chunks flushed.
 */
export async function flushDirtyChunksToStore(state: Readonly<GameState>, scopeKey?: string): Promise<number> {
  const effectiveScope = scopeKey ?? resolveDefaultChunkScopeKey(state.campaignId);
  let total = 0;
  if (state.map.chunkGrid !== undefined) {
    total += await flushGridDirtyChunks(state.map.chunkGrid, effectiveScope);
  }
  for (const area of state.areas.values()) {
    if (area.map.chunkGrid !== undefined) {
      total += await flushGridDirtyChunks(area.map.chunkGrid, effectiveScope);
    }
  }
  return total;
}

/**
 * Deletes all stored chunk delta records belonging to a specific persistence scope key.
 *
 * @param scopeKey Scope prefix to clear (e.g. `save:default`).
 */
export async function clearChunkStoreScope(scopeKey: string): Promise<void> {
  const prefix = `${scopeKey}:`;
  for (const key of Array.from(memoryChunkStore.keys())) {
    if (key.startsWith(prefix)) {
      memoryChunkStore.delete(key);
    }
  }

  if (!isIndexedDbAvailable()) return;

  try {
    const db = await openChunkDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(WORLD_CHUNKS_STORE, 'readwrite');
      const store = tx.objectStore(WORLD_CHUNKS_STORE);
      const req = store.openCursor();
      req.onsuccess = (event: Event): void => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor) {
          resolve();
          return;
        }
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to clear chunk store scope from IndexedDB:', err);
  }
}

/**
 * Overlays any persisted dirty `WorldChunk` deltas onto a deserialized `ChunkedWorldGrid`.
 */
async function overlayPersistedDeltasOnGrid(grid: ChunkedWorldGrid, scopeKey: string): Promise<ChunkedWorldGrid> {
  if (grid.dirtyChunkKeys.size === 0) return grid;
  const nextChunks = new Map(grid.chunks);
  let modified = false;

  for (const packed of grid.dirtyChunkKeys) {
    const existing = nextChunks.get(packed);
    const coords = existing ? { x: existing.cx, y: existing.cy } : unpackWorldCoord(packed);
    const loaded = await loadWorldChunkDelta(scopeKey, grid.areaId, coords.x, coords.y, 0);
    if (loaded && existing) {
      nextChunks.set(packed, loaded);
      modified = true;
    }
  }

  return modified ? { ...grid, chunks: nextChunks } : grid;
}

/**
 * Asynchronously restores any IndexedDB-persisted dirty `WorldChunk` deltas on top of
 * a newly deserialized streaming `GameState` (active floor + dormant saved streaming areas).
 *
 * @param state Synchronously deserialized GameState.
 * @param scopeKey Optional persistence scope override.
 * @returns Hydrated GameState with dirty chunk edits restored.
 */
export async function rehydrateStreamingWorldAsync(state: GameState, scopeKey?: string): Promise<GameState> {
  const effectiveScope = scopeKey ?? resolveDefaultChunkScopeKey(state.campaignId);
  let nextState = state;

  if (nextState.map.chunkGrid !== undefined) {
    const hydratedGrid = await overlayPersistedDeltasOnGrid(nextState.map.chunkGrid, effectiveScope);
    if (hydratedGrid !== nextState.map.chunkGrid) {
      nextState = {
        ...nextState,
        fovNeedsUpdate: true,
        map: {
          ...nextState.map,
          chunkGrid: hydratedGrid
        }
      };
    }
  }

  if (nextState.areas.size > 0) {
    let areasModified = false;
    const nextAreas = new Map(nextState.areas);
    for (const [areaId, areaData] of nextState.areas.entries()) {
      if (areaData.map.chunkGrid !== undefined) {
        const hydratedGrid = await overlayPersistedDeltasOnGrid(areaData.map.chunkGrid, effectiveScope);
        if (hydratedGrid !== areaData.map.chunkGrid) {
          areasModified = true;
          nextAreas.set(areaId, {
            ...areaData,
            map: {
              ...areaData.map,
              chunkGrid: hydratedGrid
            }
          });
        }
      }
    }
    if (areasModified) {
      nextState = { ...nextState, areas: nextAreas };
    }
  }

  return nextState;
}

/**
 * Resets the in-memory delta chunk fallback cache (used in headless unit tests).
 */
export function resetInMemoryChunkStore(): void {
  memoryChunkStore.clear();
  chunkDbPromise = null;
}
