import { afterEach, describe, expect, it } from 'bun:test';
import {
  clearChunkStoreScope,
  loadWorldChunkDelta,
  putWorldChunkDeltaSync,
  rehydrateStreamingWorldAsync,
  resetInMemoryChunkStore,
  resolveDefaultChunkScopeKey,
  flushDirtyChunksToStore
} from '../src/core/chunk_store.ts';
import { addComponent, getComponent, spawnEntity } from '../src/core/ecs.ts';
import { applyIntentWithCost, setGameState } from '../src/core/game-loop.ts';
import { deleteSave, deserializeGameState, saveGame, serializeGameState } from '../src/core/save.ts';
import { addActor, getActorRemainingScheduleTime, initEngine } from '../src/core/scheduler.ts';
import { generateArea } from '../src/map/generator.ts';
import {
  buildChunkSynthesisParams,
  generateWorldChunk,
  generateWorldChunkFromParams
} from '../src/map/chunk_generator.ts';
import { getTileIdFromPaletteIndex } from '../src/map/tile_palette.ts';
import { computeFOV } from '../src/map/fov.ts';
import { getTileAt, isInMapBounds, isTileExploredAt, setTileIdAt } from '../src/map/map_accessor.ts';
import { buildViewportSnapshot } from '../src/rendering/viewport_snapshot.ts';
import { validateChargeLine } from '../src/rulesets/dnd35e/combat/charge_resolver.ts';
import { clearStreamingPrefetchCache, updateStreamingWorldWindow } from '../src/systems/map/chunk_streaming.ts';
import { processChangeAreaIntent, updateExploredTiles } from '../src/systems/map.system.ts';
import { ComponentType, type PositionComponent } from '../src/types/components.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { packWorldCoord, packWorldCoord3D } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function createFakeIndexedDb(backing: Map<string, ArrayBuffer>): IDBFactory {
  const storeNames = new Set<string>();
  const makeRequest = <T>(executor: () => T): IDBRequest<T> => {
    const req = {
      result: undefined as unknown as T,
      error: null as DOMException | null,
      onsuccess: null as ((ev: Event) => void) | null,
      onerror: null as ((ev: Event) => void) | null
    };
    queueMicrotask(() => {
      try {
        req.result = executor();
        req.onsuccess?.({ target: req } as unknown as Event);
      } catch (err) {
        req.error = err as DOMException;
        req.onerror?.({ target: req } as unknown as Event);
      }
    });
    return req as unknown as IDBRequest<T>;
  };

  const fakeStore = {
    put: (value: ArrayBuffer, key: IDBValidKey): IDBRequest<IDBValidKey> =>
      makeRequest(() => {
        backing.set(String(key), value.slice(0));
        return key;
      }),
    get: (key: IDBValidKey): IDBRequest<ArrayBuffer | undefined> =>
      makeRequest(() => backing.get(String(key))?.slice(0)),
    openCursor: (): IDBRequest<IDBCursorWithValue | null> => {
      const entries = Array.from(backing.entries());
      let index = 0;
      const cursorReq = {
        result: null as IDBCursorWithValue | null,
        error: null as DOMException | null,
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null
      };
      const advance = (): void => {
        queueMicrotask(() => {
          if (index >= entries.length) {
            cursorReq.result = null;
            cursorReq.onsuccess?.({ target: cursorReq } as unknown as Event);
            return;
          }
          const [k, v] = entries[index++]!;
          const cursor = {
            key: k,
            value: v,
            delete: (): IDBRequest<undefined> =>
              makeRequest(() => {
                backing.delete(k);
                return undefined;
              }),
            continue: (): void => {
              advance();
            }
          };
          cursorReq.result = cursor as unknown as IDBCursorWithValue;
          cursorReq.onsuccess?.({ target: cursorReq } as unknown as Event);
        });
      };
      advance();
      return cursorReq as unknown as IDBRequest<IDBCursorWithValue | null>;
    }
  };

  const fakeDb = {
    objectStoreNames: {
      contains: (name: string): boolean => storeNames.has(name)
    },
    createObjectStore: (name: string): IDBObjectStore => {
      storeNames.add(name);
      return fakeStore as unknown as IDBObjectStore;
    },
    transaction: (): IDBTransaction =>
      ({
        objectStore: (): IDBObjectStore => fakeStore as unknown as IDBObjectStore
      }) as unknown as IDBTransaction
  };

  return {
    open: (_name: string, _version?: number): IDBOpenDBRequest => {
      const openReq = {
        result: fakeDb as unknown as IDBDatabase,
        error: null as DOMException | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null
      };
      queueMicrotask(() => {
        openReq.onupgradeneeded?.({ target: openReq } as unknown as IDBVersionChangeEvent);
        openReq.onsuccess?.({ target: openReq } as unknown as Event);
      });
      return openReq as unknown as IDBOpenDBRequest;
    }
  } as unknown as IDBFactory;
}

describe('Milestone 175: Streaming Overworld, Worker Prefetch & Delta Persistence', () => {
  const defaultCampaign = loadCampaignFromDisk('default');
  const dndCampaign = loadCampaignFromDisk('dnd35e-crypt');

  afterEach(() => {
    resetInMemoryChunkStore();
    clearStreamingPrefetchCache();
    initEngine();
  });

  it('deterministically generates seamless streaming_overworld chunks across positive and negative coordinates', () => {
    const frontierDef = defaultCampaign.areas['endless_frontier']!;
    expect(frontierDef).toBeDefined();
    expect(frontierDef.generatorType).toBe('streaming_overworld');

    const cNegA = generateWorldChunk(defaultCampaign, frontierDef, -1, -1, 0);
    const cNegB = generateWorldChunk(defaultCampaign, frontierDef, -1, -1, 0);
    expect(cNegA.tileType).toEqual(cNegB.tileType);
    expect(cNegA.size).toBe(16);

    const generated = generateArea(defaultCampaign, 'endless_frontier');
    expect(generated.map.chunkGrid).toBeDefined();
    expect(generated.startPos).toEqual({ x: 0, y: 0 });
    expect(isInMapBounds(generated.map, 0, 0)).toBe(true);
    expect(isInMapBounds(generated.map, -16, -16)).toBe(true);
  });

  it('streams chunks dynamically, sleeps distant chunk entities, and wakes them identically upon return', () => {
    let state: GameState = buildGameState(defaultCampaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    // Travel into endless_frontier via ChangeAreaIntent
    const enterRes = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'endless_frontier',
      targetX: 0,
      targetY: 0
    });
    expect(enterRes.success).toBe(true);
    state = enterRes.state;
    expect(state.map.chunkGrid?.areaId).toBe('endless_frontier');

    // Spawn an orc inside chunk (0, 0) carrying an item (alongside the chunk's return portal)
    const [withOrc, orcId] = spawnEntity(state, 'orc', 2, 2, undefined, ['health_potion']);
    state = withOrc;
    const orcInv = getComponent(state, orcId, ComponentType.Inventory)!;
    const carriedItemId = orcInv.items[0]!;
    const portalId = state.entities.find((id) => getComponent(state, id, ComponentType.Portal) !== undefined)!;

    // Move anchor > 130 tiles west (beyond default evictRadiusChunks=7 * 16 = 112)
    state = updateStreamingWorldWindow(state, -140, 0, { enablePrefetch: true });
    expect(isInMapBounds(state.map, -140, 0)).toBe(true);
    expect(isInMapBounds(state.map, 0, 0)).toBe(false);
    expect(state.entities.includes(orcId)).toBe(false);
    expect(state.entities.includes(carriedItemId)).toBe(false);
    expect(state.entities.includes(portalId)).toBe(false);
    const evictedChunkRecords = state.map.chunkGrid?.evictedChunkEntities['0,0,0'] ?? [];
    expect(evictedChunkRecords.some((rec) => rec.entityId === orcId)).toBe(true);
    expect(evictedChunkRecords.some((rec) => rec.entityId === portalId)).toBe(true);

    // Return anchor back to (0, 0) and confirm orc + carried item + portal wake up cleanly with spatial index intact
    state = updateStreamingWorldWindow(state, 0, 0, { enablePrefetch: false });
    expect(isInMapBounds(state.map, 0, 0)).toBe(true);
    expect(state.entities.includes(orcId)).toBe(true);
    expect(state.entities.includes(carriedItemId)).toBe(true);
    expect(state.entities.includes(portalId)).toBe(true);
    expect(state.spatialIndex.get('2,2,0')?.includes(orcId)).toBe(true);
    expect(state.map.chunkGrid?.evictedChunkEntities['0,0,0']).toBeUndefined();
  });

  it('persists only dirty chunks to delta store while keeping SerializedGameState JSON slim and round-tripping edits', async () => {
    let state: GameState = buildGameState(defaultCampaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'endless_frontier',
      targetX: 0,
      targetY: 0
    }).state;

    // Mutate only chunk (-1, -1) explicitly and run FOV on (0, 0)
    state = {
      ...state,
      fovNeedsUpdate: true,
      map: setTileIdAt(state.map, -2, -2, 'shallow_water')
    };
    state = updateExploredTiles(state);
    expect(getTileAt(state.map, -2, -2)?.tileId).toBe('shallow_water');
    expect(isTileExploredAt(state.map, 0, 0)).toBe(true);

    const scopeKey = resolveDefaultChunkScopeKey(state.campaignId);
    await clearChunkStoreScope(scopeKey);
    const flushedCount = await flushDirtyChunksToStore(state, scopeKey);
    expect(flushedCount).toBeGreaterThan(0);

    // Clean corner chunk (-4, -4) should NOT have been persisted into delta store
    const cleanDelta = await loadWorldChunkDelta(scopeKey, 'endless_frontier', -4, -4, 0);
    expect(cleanDelta).toBeUndefined();
    const mutatedDelta = await loadWorldChunkDelta(scopeKey, 'endless_frontier', -1, -1, 0);
    expect(mutatedDelta).toBeDefined();

    // SerializedGameState must contain slim streamingState and ZERO tile payloads
    const serialized = serializeGameState(state);
    expect(serialized.map.tiles.length).toBe(0);
    expect(serialized.streamingState?.dirtyChunkKeys.includes(packWorldCoord3D(-1, -1, 0))).toBe(true);

    // Round-trip deserialize + async delta rehydration restores custom tile & explored fog
    const rehydratedSync = deserializeGameState(serialized, defaultCampaign, state.campaignId);
    const rehydratedFull = await rehydrateStreamingWorldAsync(rehydratedSync, scopeKey);
    expect(getTileAt(rehydratedFull.map, -2, -2)?.tileId).toBe('shallow_water');
    expect(isTileExploredAt(rehydratedFull.map, 0, 0)).toBe(true);
  });

  it('supports configurable 32x32 chunkSize for benchmarking alongside 16x16 default', () => {
    const customCampaign = loadCampaignFromDisk('default');
    const moddedCampaign = {
      ...customCampaign,
      areas: {
        ...customCampaign.areas,
        endless_frontier: {
          ...customCampaign.areas['endless_frontier']!,
          streamingConfig: {
            ...customCampaign.areas['endless_frontier']!.streamingConfig!,
            chunkSize: 32,
            activeRadiusChunks: 2,
            prefetchRadiusChunks: 3
          }
        }
      }
    };

    let state = buildGameState(moddedCampaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'endless_frontier',
      targetX: 0,
      targetY: 0
    }).state;

    expect(state.map.chunkGrid?.chunkSize).toBe(32);
    expect(isInMapBounds(state.map, -32, -32)).toBe(true);

    const stepResult = applyIntentWithCost(state, {
      type: IntentType.Move,
      entityId: playerId,
      dx: 1,
      dy: 0
    });
    const movedPos = getComponent(stepResult.state, playerId, ComponentType.Position) as PositionComponent;
    expect(movedPos.x).toBe(1);
    const fov = computeFOV(stepResult.state, movedPos.x, movedPos.y, 4);
    expect(fov.size).toBeGreaterThan(0);
  });

  it('evicts sleeping chunk actors from ROT.Scheduler while keeping persistent world actors scheduled', () => {
    initEngine();
    let state: GameState = buildGameState(defaultCampaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'endless_frontier',
      targetX: 0,
      targetY: 0
    }).state;

    const [withOrc, orcId] = spawnEntity(state, 'orc', 2, 2);
    const worldSchemeId = (withOrc.nextEntityId + 10) as EntityId;
    state = {
      ...withOrc,
      nextEntityId: withOrc.nextEntityId + 11,
      persistentEntities: new Map([
        ...withOrc.persistentEntities.entries(),
        [
          worldSchemeId,
          {
            areaId: 'world',
            components: { [ComponentType.Actor]: { type: ComponentType.Actor, speed: 100 } }
          }
        ]
      ])
    };

    addActor(orcId, true, 50);
    addActor(worldSchemeId, true, 75);
    setGameState(state);
    expect(getActorRemainingScheduleTime(orcId)).toBe(50);
    expect(getActorRemainingScheduleTime(worldSchemeId)).toBe(75);

    // Walk far west so chunk (0, 0, 0) sleeps: orcId must leave scheduler, worldSchemeId must stay.
    const evictedState = updateStreamingWorldWindow(state, -140, 0, { enablePrefetch: false });
    setGameState(evictedState);
    expect(evictedState.entities.includes(orcId)).toBe(false);
    expect(getActorRemainingScheduleTime(orcId)).toBe(0);
    expect(getActorRemainingScheduleTime(worldSchemeId)).toBe(75);

    // Walk back to origin: orcId wakes cleanly into ECS + spatialIndex and is re-enrolled.
    const wokenState = updateStreamingWorldWindow(evictedState, 0, 0, { enablePrefetch: false });
    setGameState(wokenState);
    expect(wokenState.entities.includes(orcId)).toBe(true);
    expect(wokenState.spatialIndex.get('2,2,0')?.includes(orcId)).toBe(true);
    expect(getActorRemainingScheduleTime(orcId)).toBeGreaterThan(0);
  });

  it('hydrates off-screen dirty chunks from IndexedDB on cold reload and cleans dynamic campaign save scope', async () => {
    const idbBacking = new Map<string, ArrayBuffer>();
    const localBacking = new Map<string, string>();
    const prevIdb = globalThis.indexedDB;
    const prevLocalStorage = globalThis.localStorage;

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: createFakeIndexedDb(idbBacking)
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string): string | null => localBacking.get(k) ?? null,
        setItem: (k: string, v: string): void => {
          localBacking.set(k, v);
        },
        removeItem: (k: string): void => {
          localBacking.delete(k);
        }
      }
    });

    try {
      resetInMemoryChunkStore();
      let state: GameState = { ...buildGameState(defaultCampaign), campaignId: 'custom_frontier' };
      const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
      state = processChangeAreaIntent(state, {
        type: IntentType.ChangeArea,
        entityId: playerId,
        targetAreaId: 'endless_frontier',
        targetX: 0,
        targetY: 0
      }).state;

      state = {
        ...state,
        fovNeedsUpdate: true,
        map: setTileIdAt(state.map, -2, -2, 'shallow_water')
      };
      state = updateExploredTiles(state);

      // Move far west so (-1, -1, 0) and (0, 0, 0) are evicted out of Ring 0 while tracked in dirtyChunkKeys
      state = updateStreamingWorldWindow(state, -140, 0, { enablePrefetch: false });
      expect(isInMapBounds(state.map, -2, -2)).toBe(false);

      const scopeKey = resolveDefaultChunkScopeKey(state.campaignId);
      const dirtyMinus1Chunk = state.map.chunkGrid?.dirtyChunkKeys.has(packWorldCoord3D(-1, -1, 0));
      expect(dirtyMinus1Chunk).toBe(true);

      saveGame(state);
      const serialized = serializeGameState(state);
      await flushDirtyChunksToStore(state, scopeKey);
      // Wait one macrotask turn for fire-and-forget async IndexedDB puts from eviction to settle
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate full cold browser reload: memoryChunkStore is wiped while fake IndexedDB persists
      resetInMemoryChunkStore();
      const syncLoaded = deserializeGameState(serialized, defaultCampaign, state.campaignId);
      const asyncHydrated = await rehydrateStreamingWorldAsync(syncLoaded, scopeKey);

      // Walk back synchronously to (0, 0): off-screen (-1, -1) and (0, 0) must load warmed deltas
      const walkedBack = updateStreamingWorldWindow(asyncHydrated, 0, 0, { enablePrefetch: false });
      expect(getTileAt(walkedBack.map, -2, -2)?.tileId).toBe('shallow_water');
      expect(isTileExploredAt(walkedBack.map, 0, 0)).toBe(true);

      // Also verify deleteSave() clears the non-'default' campaign chunk scope
      putWorldChunkDeltaSync(scopeKey, 'endless_frontier', walkedBack.map.chunkGrid!.chunks.get(packWorldCoord3D(0, 0, 0))!);
      deleteSave();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(Array.from(idbBacking.keys()).some((k) => k.startsWith(`${scopeKey}:`))).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: prevIdb
      });
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: prevLocalStorage
      });
    }
  });

  it('validates D&D 3.5e Charge lines across negative streaming_overworld coordinates', () => {
    const moddedCampaign = {
      ...dndCampaign,
      areas: {
        ...dndCampaign.areas,
        endless_frontier: {
          ...defaultCampaign.areas['endless_frontier']!,
          streamingConfig: {
            ...defaultCampaign.areas['endless_frontier']!.streamingConfig!,
            biomePalette: {
              water: 'stone_floor',
              shore: 'stone_floor',
              plains: 'stone_floor',
              forest: 'stone_floor',
              ridge: 'stone_wall',
              road: 'stone_floor'
            }
          }
        }
      }
    };

    let state = buildGameState(moddedCampaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'endless_frontier',
      targetX: 0,
      targetY: 0
    }).state;

    for (let x = -4; x <= -1; x++) {
      state = { ...state, map: setTileIdAt(state.map, x, 0, 'stone_floor') };
    }
    state = addComponent(state, playerId, { type: ComponentType.Position, x: -4, y: 0 });
    const [withOrc, orcId] = spawnEntity(state, 'orc', -1, 0);
    state = withOrc;

    const chargeResult = validateChargeLine(state, playerId, orcId);
    expect(chargeResult.valid).toBe(true);
    expect(chargeResult.stepDeltas.length).toBeGreaterThanOrEqual(2);
  });

  it('restores player at evicted (0, 0) return portal when re-entering endless_frontier', () => {
    let state: GameState = buildGameState(defaultCampaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'endless_frontier',
      targetX: 0,
      targetY: 0
    }).state;

    const portalId = state.entities.find((id) => getComponent(state, id, ComponentType.Portal) !== undefined)!;
    expect(portalId).toBeDefined();

    // Evict (0, 0, 0) so the return portal sleeps inside evictedChunkEntities
    state = updateStreamingWorldWindow(state, -140, 0, { enablePrefetch: false });
    expect(state.entities.includes(portalId)).toBe(false);

    // Leave to outer_crossroads, then re-enter endless_frontier without targetX/targetY
    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'outer_crossroads'
    }).state;

    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'endless_frontier'
    }).state;

    const respawnPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    expect(respawnPos.x).toBe(0);
    expect(respawnPos.y).toBe(0);
    expect(state.entities.includes(portalId)).toBe(true);
    expect(state.spatialIndex.get('0,0,0')?.includes(portalId)).toBe(true);
  });

  it('keeps player companions active during eviction and avoids duplicate packing for NPC-controlled minions', () => {
    let state: GameState = buildGameState(defaultCampaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'endless_frontier',
      targetX: 0,
      targetY: 0
    }).state;

    const [s1, companionId] = spawnEntity(state, 'orc', 2, 2);
    state = addComponent(s1, companionId, {
      type: ComponentType.ControllerLink,
      controllerEntityId: playerId,
      relationship: 'companion',
      tags: ['companion'],
      shareInitiative: true
    });

    const [s2, bossId] = spawnEntity(state, 'orc', 3, 3);
    const [s3, minionId] = spawnEntity(s2, 'orc', 4, 4);
    state = addComponent(s3, minionId, {
      type: ComponentType.ControllerLink,
      controllerEntityId: bossId,
      relationship: 'summon',
      tags: ['summon'],
      shareInitiative: false
    });

    const evicted = updateStreamingWorldWindow(state, -140, 0, { enablePrefetch: false });
    // Player companion must NOT be evicted
    expect(evicted.entities.includes(companionId)).toBe(true);
    // Boss packs once with minion inside ownedEntities; minion must NOT appear as a duplicate root record
    const bucket = evicted.map.chunkGrid?.evictedChunkEntities['0,0,0'] ?? [];
    const bossRecords = bucket.filter((r) => r.entityId === bossId);
    const minionRootRecords = bucket.filter((r) => r.entityId === minionId);
    expect(bossRecords.length).toBe(1);
    expect(minionRootRecords.length).toBe(0);
    expect(bossRecords[0]!.ownedEntities.some((o) => o.entityId === minionId)).toBe(true);

    // Waking restores both boss and minion exactly once
    const woken = updateStreamingWorldWindow(evicted, 0, 0, { enablePrefetch: false });
    expect(woken.entities.filter((id) => id === bossId).length).toBe(1);
    expect(woken.entities.filter((id) => id === minionId).length).toBe(1);
  });

  it('projects ViewportSnapshot and honors grid worldSeed/chunkSize overrides across negative coordinates', () => {
    let state: GameState = buildGameState(defaultCampaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'endless_frontier',
      targetX: 0,
      targetY: 0
    }).state;

    // Override runtime chunkGrid worldSeed and move player to distant negative coords (-140, -140) -> chunk (-9, -9)
    const customGrid = {
      ...state.map.chunkGrid!,
      worldSeed: 99991
    };
    state = {
      ...state,
      fovNeedsUpdate: true,
      map: { ...state.map, chunkGrid: customGrid }
    };
    state = addComponent(state, playerId, { type: ComponentType.Position, x: -140, y: -140 });
    state = updateStreamingWorldWindow(state, -140, -140, { enablePrefetch: false });
    state = updateExploredTiles(state);

    // Newly synthesized chunk (-9, -9) must match generateWorldChunkFromParams with overridden worldSeed
    const expectedParams = {
      ...buildChunkSynthesisParams(customGrid.palette, defaultCampaign.areas['endless_frontier']!),
      worldSeed: 99991
    };
    const expectedChunk = generateWorldChunkFromParams(expectedParams, -9, -9, 0);
    const expectedLocalIdx = (((-140 % 16) + 16) % 16) * 16 + (((-140 % 16) + 16) % 16);
    const expectedTileId = getTileIdFromPaletteIndex(customGrid.palette, expectedChunk.tileType[expectedLocalIdx]!);
    const streamedTile = getTileAt(state.map, -140, -140);
    expect(streamedTile?.tileId).toBe(expectedTileId!);
    expect(streamedTile?.explored).toBe(true);

    const viewW = 21;
    const viewH = 15;
    const snap = buildViewportSnapshot(state, viewW, viewH);
    expect(snap.cameraX).toBe(-140 - Math.floor(viewW / 2));
    expect(snap.cameraY).toBe(-140 - Math.floor(viewH / 2));
    expect(snap.cells.length).toBe(viewW * viewH);

    const centerCell = snap.cells.find((c) => c.vx === Math.floor(viewW / 2) && c.vy === Math.floor(viewH / 2));
    expect(centerCell).toBeDefined();
    expect(centerCell?.isVisible).toBe(true);
    expect(centerCell?.entities.some((e) => e.glyph === '@')).toBe(true);
  });
});
