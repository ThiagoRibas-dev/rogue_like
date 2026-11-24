import { CHUNK_DIRTY_PERSIST, MAX_PREFETCH_CACHE_CHUNKS } from '../../constants/world_chunk.constants.ts';
import {
  getCachedWorldChunkDeltaSync,
  putWorldChunkDeltaSync,
  resolveDefaultChunkScopeKey,
  saveWorldChunkDelta
} from '../../core/chunk_store.ts';
import { collectOwnedEntityIds, getComponent, patchSpatialIndexInPlace } from '../../core/ecs.ts';
import {
  buildChunkSynthesisParams,
  type ChunkSynthesisParams,
  generateWorldChunkFromParams
} from '../../map/chunk_generator.ts';
import { ComponentType, type ControllerLinkComponent, type PositionComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type {
  ChunkedWorldGrid,
  DormantChunkEntityRecord,
  OwnedDormantEntityRecord,
  WorldChunk
} from '../../types/world-chunk.types.ts';
import { formatChunkKey, packWorldCoord, worldToChunkCoord } from '../../utils/grid.ts';
import { generateChunkBatchOffload } from '../../worker/worker_bridge.ts';
import type { StreamingChunkCoord } from '../../worker/worker.types.ts';

const prefetchChunkCache = new Map<string, WorldChunk>();

function buildPrefetchKey(scopeKey: string, areaId: string, worldSeed: number, cx: number, cy: number, cz = 0): string {
  return `${scopeKey}:${areaId}:${worldSeed}:${cx},${cy},${cz}`;
}

function storePrefetchChunk(key: string, chunk: WorldChunk): void {
  if (prefetchChunkCache.has(key)) {
    prefetchChunkCache.delete(key);
  }
  prefetchChunkCache.set(key, chunk);
  while (prefetchChunkCache.size > MAX_PREFETCH_CACHE_CHUNKS) {
    const oldestKey = prefetchChunkCache.keys().next().value;
    if (oldestKey === undefined) break;
    prefetchChunkCache.delete(oldestKey);
  }
}

function consumePrefetchChunk(key: string): WorldChunk | undefined {
  const hit = prefetchChunkCache.get(key);
  if (hit) {
    prefetchChunkCache.delete(key);
  }
  return hit;
}

/**
 * Clears any prefetched chunk cache entries matching the specified area ID (and optional scopeKey).
 *
 * @param areaId Streaming area identifier.
 * @param scopeKey Optional persistence scope key filter.
 */
export function clearStreamingPrefetchCache(areaId?: string, scopeKey?: string): void {
  if (!areaId && !scopeKey) {
    prefetchChunkCache.clear();
    return;
  }
  for (const key of Array.from(prefetchChunkCache.keys())) {
    if (scopeKey && !key.startsWith(`${scopeKey}:`)) continue;
    if (areaId && !key.includes(`:${areaId}:`)) continue;
    prefetchChunkCache.delete(key);
  }
}

function packOutOfWindowEntities(
  state: GameState,
  evictedChunkKeys: ReadonlySet<string>,
  chunkSize: number,
  existingEvicted: Readonly<Record<string, ReadonlyArray<DormantChunkEntityRecord>>>
): {
  readonly state: GameState;
  readonly evictedChunkEntities: Readonly<Record<string, ReadonlyArray<DormantChunkEntityRecord>>>;
} {
  if (evictedChunkKeys.size === 0) {
    return { state, evictedChunkEntities: existingEvicted };
  }

  // Player, Persistent entities, and everything they own/command (companions, inventory, gear) stay active.
  const protectedIds = new Set<EntityId>();
  for (const entityId of state.entities) {
    if (
      getComponent(state, entityId, ComponentType.Player) !== undefined ||
      getComponent(state, entityId, ComponentType.Persistent) !== undefined
    ) {
      for (const ownedId of collectOwnedEntityIds(state, entityId)) {
        protectedIds.add(ownedId);
      }
    }
  }

  const rootToChunkKey = new Map<EntityId, string>();
  for (const entityId of state.entities) {
    if (protectedIds.has(entityId)) continue;
    const link = getComponent(state, entityId, ComponentType.ControllerLink) as ControllerLinkComponent | undefined;
    if (link && state.components.has(link.controllerEntityId)) {
      // Controlled minions/summons pack with their controller root rather than duplicating as roots.
      continue;
    }
    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;

    const cx = worldToChunkCoord(pos.x, chunkSize);
    const cy = worldToChunkCoord(pos.y, chunkSize);
    const key = formatChunkKey(cx, cy, 0);
    if (evictedChunkKeys.has(key)) {
      rootToChunkKey.set(entityId, key);
    }
  }

  if (rootToChunkKey.size === 0) {
    return { state, evictedChunkEntities: existingEvicted };
  }

  const nextEvicted: Record<string, ReadonlyArray<DormantChunkEntityRecord>> = { ...existingEvicted };
  const removeIds = new Set<EntityId>();

  for (const [rootId, chunkKey] of rootToChunkKey.entries()) {
    if (protectedIds.has(rootId) || removeIds.has(rootId)) continue;
    const ownedAll = collectOwnedEntityIds(state, rootId);
    const rootComps = state.components.get(rootId);
    if (!rootComps) continue;

    const ownedEntities: OwnedDormantEntityRecord[] = [];
    removeIds.add(rootId);
    for (const childId of ownedAll) {
      if (childId === rootId || protectedIds.has(childId) || removeIds.has(childId)) continue;
      const childComps = state.components.get(childId);
      if (childComps) {
        ownedEntities.push({ entityId: childId, components: childComps });
        removeIds.add(childId);
      }
    }

    const prevBucket = nextEvicted[chunkKey] ?? [];
    nextEvicted[chunkKey] = [...prevBucket, { entityId: rootId, components: rootComps, ownedEntities }];
  }

  if (removeIds.size === 0) {
    return { state, evictedChunkEntities: nextEvicted };
  }

  const nextEntities = state.entities.filter((id) => !removeIds.has(id));
  const nextComponents = new Map(state.components);
  const nextSpatial = new Map(state.spatialIndex);
  const copiedKeys = new Set<string>();

  for (const id of removeIds) {
    const comps = nextComponents.get(id);
    const prevPos = comps?.[ComponentType.Position] as PositionComponent | undefined;
    if (prevPos !== undefined) {
      patchSpatialIndexInPlace(nextSpatial, copiedKeys, id, prevPos, undefined);
    }
    nextComponents.delete(id);
  }

  return {
    state: {
      ...state,
      entities: nextEntities,
      components: nextComponents,
      spatialIndex: nextSpatial
    },
    evictedChunkEntities: nextEvicted
  };
}

function wakeEntitiesForChunks(
  state: GameState,
  wokenChunkKeys: ReadonlyArray<string>,
  existingEvicted: Readonly<Record<string, ReadonlyArray<DormantChunkEntityRecord>>>
): {
  readonly state: GameState;
  readonly evictedChunkEntities: Readonly<Record<string, ReadonlyArray<DormantChunkEntityRecord>>>;
} {
  let hasAnyToWake = false;
  for (const key of wokenChunkKeys) {
    if ((existingEvicted[key]?.length ?? 0) > 0) {
      hasAnyToWake = true;
      break;
    }
  }
  if (!hasAnyToWake) {
    return { state, evictedChunkEntities: existingEvicted };
  }

  const nextEvicted: Record<string, ReadonlyArray<DormantChunkEntityRecord>> = { ...existingEvicted };
  const recordsToWake: DormantChunkEntityRecord[] = [];
  for (const key of wokenChunkKeys) {
    const list = nextEvicted[key];
    if (list && list.length > 0) {
      recordsToWake.push(...list);
      delete nextEvicted[key];
    }
  }

  const existingIds = new Set(state.entities);
  const nextEntities = [...state.entities];
  const nextComponents = new Map(state.components);
  const nextSpatial = new Map(state.spatialIndex);
  const copiedKeys = new Set<string>();

  for (const record of recordsToWake) {
    if (!existingIds.has(record.entityId)) {
      nextEntities.push(record.entityId);
      existingIds.add(record.entityId);
    }
    nextComponents.set(record.entityId, record.components);
    const rootPos = record.components[ComponentType.Position] as PositionComponent | undefined;
    if (rootPos !== undefined) {
      patchSpatialIndexInPlace(nextSpatial, copiedKeys, record.entityId, undefined, rootPos);
    }
    for (const child of record.ownedEntities) {
      if (!existingIds.has(child.entityId)) {
        nextEntities.push(child.entityId);
        existingIds.add(child.entityId);
      }
      nextComponents.set(child.entityId, child.components);
      const childPos = child.components[ComponentType.Position] as PositionComponent | undefined;
      if (childPos !== undefined) {
        patchSpatialIndexInPlace(nextSpatial, copiedKeys, child.entityId, undefined, childPos);
      }
    }
  }

  return {
    state: {
      ...state,
      entities: nextEntities,
      components: nextComponents,
      spatialIndex: nextSpatial
    },
    evictedChunkEntities: nextEvicted
  };
}

function scheduleRing1Prefetch(
  scopeKey: string,
  params: ChunkSynthesisParams,
  originCx: number,
  originCy: number,
  activeRadius: number,
  prefetchRadius: number,
  loadedChunks: ReadonlyMap<number, WorldChunk>
): void {
  if (prefetchRadius <= activeRadius) return;
  const coordsToFetch: StreamingChunkCoord[] = [];

  for (let cy = originCy - prefetchRadius; cy <= originCy + prefetchRadius; cy++) {
    for (let cx = originCx - prefetchRadius; cx <= originCx + prefetchRadius; cx++) {
      if (Math.max(Math.abs(cx - originCx), Math.abs(cy - originCy)) <= activeRadius) continue;
      if (loadedChunks.has(packWorldCoord(cx, cy))) continue;
      const cacheKey = buildPrefetchKey(scopeKey, params.areaId, params.worldSeed, cx, cy, 0);
      if (prefetchChunkCache.has(cacheKey)) continue;
      coordsToFetch.push({ cx, cy, cz: 0 });
    }
  }

  if (coordsToFetch.length === 0) return;

  void generateChunkBatchOffload(params, coordsToFetch)
    .then((generatedChunks) => {
      for (const chunk of generatedChunks) {
        const key = buildPrefetchKey(scopeKey, params.areaId, params.worldSeed, chunk.cx, chunk.cy, chunk.cz);
        storePrefetchChunk(key, chunk);
      }
    })
    .catch(() => {
      // Background prefetch failures remain non-fatal because Ring 0 synthesizes deterministically on demand.
    });
}

/**
 * Slides the Ring 0 active chunk window to stay centered around `(anchorX, anchorY)`,
 * waking/loading newly entered chunks, sleeping/evicting distant chunks beyond `evictRadiusChunks`,
 * and issuing non-blocking batched worker prefetch requests across Ring 1.
 *
 * @param state Current immutable GameState.
 * @param anchorX Player/anchor X coordinate.
 * @param anchorY Player/anchor Y coordinate.
 * @param options Optional persistence scope key and prefetch control.
 * @returns Updated GameState with synchronized chunks and active/dormant entities.
 */
export function updateStreamingWorldWindow(
  state: GameState,
  anchorX: number,
  anchorY: number,
  options?: { readonly scopeKey?: string | undefined; readonly enablePrefetch?: boolean | undefined }
): GameState {
  const grid = state.map.chunkGrid;
  if (!grid) return state;

  const areaDef = state.campaign.areas[grid.areaId];
  if (!areaDef) return state;

  const targetCx = worldToChunkCoord(anchorX, grid.chunkSize);
  const targetCy = worldToChunkCoord(anchorY, grid.chunkSize);
  const activeRadius = grid.activeRadiusChunks;
  const evictRadius = Math.max(activeRadius + 1, grid.evictRadiusChunks);
  const scopeKey = options?.scopeKey ?? resolveDefaultChunkScopeKey(state.campaignId);
  const baseSynthParams = buildChunkSynthesisParams(grid.palette, areaDef);
  const synthParams: ChunkSynthesisParams = {
    ...baseSynthParams,
    worldSeed: grid.worldSeed,
    chunkSize: grid.chunkSize
  };

  // Fast-path: check whether origin matches and every Ring 0 chunk is already resident
  let missingRing0 = false;
  for (let cy = targetCy - activeRadius; cy <= targetCy + activeRadius && !missingRing0; cy++) {
    for (let cx = targetCx - activeRadius; cx <= targetCx + activeRadius; cx++) {
      if (!grid.chunks.has(packWorldCoord(cx, cy))) {
        missingRing0 = true;
        break;
      }
    }
  }
  if (!missingRing0 && grid.originChunkX === targetCx && grid.originChunkY === targetCy) {
    return state;
  }

  const nextChunks = new Map(grid.chunks);
  const wokenChunkKeys: string[] = [];

  for (let cy = targetCy - activeRadius; cy <= targetCy + activeRadius; cy++) {
    for (let cx = targetCx - activeRadius; cx <= targetCx + activeRadius; cx++) {
      const packed = packWorldCoord(cx, cy);
      if (nextChunks.has(packed)) continue;

      const deltaChunk = getCachedWorldChunkDeltaSync(scopeKey, grid.areaId, cx, cy, 0);
      if (deltaChunk) {
        nextChunks.set(packed, deltaChunk);
      } else {
        const prefetched = consumePrefetchChunk(buildPrefetchKey(scopeKey, grid.areaId, grid.worldSeed, cx, cy, 0));
        nextChunks.set(packed, prefetched ?? generateWorldChunkFromParams(synthParams, cx, cy, 0));
      }
      wokenChunkKeys.push(formatChunkKey(cx, cy, 0));
    }
  }

  const evictedKeys = new Set<string>();
  for (const [packed, chunk] of Array.from(nextChunks.entries())) {
    const dist = Math.max(Math.abs(chunk.cx - targetCx), Math.abs(chunk.cy - targetCy));
    if (dist > evictRadius) {
      if ((chunk.dirtyFlags & CHUNK_DIRTY_PERSIST) !== 0) {
        putWorldChunkDeltaSync(scopeKey, grid.areaId, chunk);
        void saveWorldChunkDelta(scopeKey, grid.areaId, chunk);
      }
      nextChunks.delete(packed);
      evictedKeys.add(formatChunkKey(chunk.cx, chunk.cy, chunk.cz));
    }
  }

  let workingState = state;
  let nextEvictedEntities = grid.evictedChunkEntities;

  const sleepRes = packOutOfWindowEntities(workingState, evictedKeys, grid.chunkSize, nextEvictedEntities);
  workingState = sleepRes.state;
  nextEvictedEntities = sleepRes.evictedChunkEntities;

  const wakeRes = wakeEntitiesForChunks(workingState, wokenChunkKeys, nextEvictedEntities);
  workingState = wakeRes.state;
  nextEvictedEntities = wakeRes.evictedChunkEntities;

  const nextGrid: ChunkedWorldGrid = {
    ...grid,
    originChunkX: targetCx,
    originChunkY: targetCy,
    chunks: nextChunks,
    evictedChunkEntities: nextEvictedEntities
  };

  if (options?.enablePrefetch !== false) {
    scheduleRing1Prefetch(
      scopeKey,
      synthParams,
      targetCx,
      targetCy,
      activeRadius,
      grid.prefetchRadiusChunks,
      nextChunks
    );
  }

  return {
    ...workingState,
    map: {
      ...workingState.map,
      chunkGrid: nextGrid
    }
  };
}
