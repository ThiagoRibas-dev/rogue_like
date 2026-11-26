import {
  type EntityId,
  type GameState,
  type AreaData,
  type SerializedGameState,
  type SerializedAreaData,
  EngineMode,
  UIMode
} from '../types/game-state.types.ts';
import { updateSpatialIndex, collectOwnedEntityIds } from './ecs.ts';
import {
  clearChunkStoreScope,
  flushDirtyChunksToStore,
  getCachedWorldChunkDeltaSync,
  putWorldChunkDeltaSync,
  rehydrateStreamingWorldAsync,
  resolveDefaultChunkScopeKey
} from './chunk_store.ts';
import { createInitialStreamingGrid } from '../map/chunk_generator.ts';
import { loadCampaign } from './loader.ts';
import { getTelemetryStore, setTelemetryStore } from './telemetry.ts';
import type { GameMap, SerializedPersistentEntityRecord, PersistentEntityRecord } from '../types/game-state.types.ts';
import type { ChunkedWorldGrid, SerializedStreamingWorldState } from '../types/world-chunk.types.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent,
  type ShopComponent
} from '../types/components.types.ts';
import { CHUNK_DIRTY_PERSIST } from '../constants/world_chunk.constants.ts';
import { DEFAULT_ZOOM_LEVEL } from '../constants/display.constants.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../constants/pacing.constants.ts';

export class CampaignNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignNotFoundError';
  }
}

const SAVE_KEY = 'roguelike_save';

/**
 * Checks if a save game exists in localStorage.
 */
export function hasSaveGame(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SAVE_KEY) !== null;
}

/**
 * Deletes the save game from localStorage and clears persisted streaming chunk deltas
 * for the saved campaign (or the supplied fallback `campaignId`).
 */
export function deleteSave(campaignId?: string): void {
  let resolvedCampaignId = campaignId;
  if (typeof localStorage !== 'undefined') {
    if (resolvedCampaignId === undefined) {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { readonly campaignId?: unknown };
          if (typeof parsed.campaignId === 'string' && parsed.campaignId.trim().length > 0) {
            resolvedCampaignId = parsed.campaignId;
          }
        } catch {
          // Ignore malformed save strings and clear default scope below.
        }
      }
    }
    localStorage.removeItem(SAVE_KEY);
  }
  void clearChunkStoreScope(resolveDefaultChunkScopeKey(resolvedCampaignId ?? 'default'));
}

/**
 * Gets the raw serialized save string (useful for exporting to a file).
 */
export function getSaveData(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(SAVE_KEY);
}

/**
 * Overwrites the save game with a raw serialized string (useful for importing from a file).
 */
export function setSaveData(data: string): void {
  localStorage.setItem(SAVE_KEY, data);
}

function serializeStreamingGridMetadata(grid: ChunkedWorldGrid): SerializedStreamingWorldState {
  return {
    areaId: grid.areaId,
    worldSeed: grid.worldSeed,
    chunkSize: grid.chunkSize,
    activeRadiusChunks: grid.activeRadiusChunks,
    prefetchRadiusChunks: grid.prefetchRadiusChunks,
    evictRadiusChunks: grid.evictRadiusChunks,
    originChunkX: grid.originChunkX,
    originChunkY: grid.originChunkY,
    ...(grid.originChunkZ !== undefined ? { originChunkZ: grid.originChunkZ } : {}),
    ...(grid.activeRadiusZ !== undefined ? { activeRadiusZ: grid.activeRadiusZ } : {}),
    ...(grid.minZ !== undefined ? { minZ: grid.minZ } : {}),
    ...(grid.maxZ !== undefined ? { maxZ: grid.maxZ } : {}),
    dirtyChunkKeys: Array.from(grid.dirtyChunkKeys),
    evictedChunkEntities: grid.evictedChunkEntities
  };
}

function stripRuntimeChunkGrid(map: GameMap): GameMap {
  if (map.chunkGrid === undefined) return map;
  return {
    width: map.width,
    height: map.height,
    tiles: [],
    ...(map.zSlices !== undefined ? { zSlices: map.zSlices } : {}),
    ...(map.minZ !== undefined ? { minZ: map.minZ } : {}),
    ...(map.maxZ !== undefined ? { maxZ: map.maxZ } : {}),
    ...(map.isFullyExplored !== undefined ? { isFullyExplored: map.isFullyExplored } : {}),
    ...(map.physicsOverlay !== undefined ? { physicsOverlay: map.physicsOverlay } : {})
  };
}

function hydrateStreamingMapSync(
  rawMap: GameMap,
  streamingState: SerializedStreamingWorldState | undefined,
  campaign: GameState['campaign'],
  campaignId: string
): GameMap {
  if (!streamingState) return rawMap;
  const areaDef = campaign.areas[streamingState.areaId];
  if (!areaDef) return rawMap;
  const baseGrid = createInitialStreamingGrid(
    campaign,
    areaDef,
    streamingState.originChunkX,
    streamingState.originChunkY,
    streamingState,
    streamingState.originChunkZ ?? 0
  );
  const scopeKey = resolveDefaultChunkScopeKey(campaignId);
  const nextChunks = new Map(baseGrid.chunks);
  let patched = false;
  for (const [packed, chunk] of nextChunks.entries()) {
    const cached = getCachedWorldChunkDeltaSync(scopeKey, baseGrid.areaId, chunk.cx, chunk.cy, chunk.cz);
    if (cached) {
      nextChunks.set(packed, cached);
      patched = true;
    }
  }
  const finalGrid = patched ? { ...baseGrid, chunks: nextChunks } : baseGrid;
  return {
    width: rawMap.width,
    height: rawMap.height,
    tiles: [],
    ...(finalGrid.minZ !== undefined ? { minZ: finalGrid.minZ } : {}),
    ...(finalGrid.maxZ !== undefined ? { maxZ: finalGrid.maxZ } : {}),
    ...(rawMap.isFullyExplored !== undefined ? { isFullyExplored: rawMap.isFullyExplored } : {}),
    ...(rawMap.physicsOverlay !== undefined ? { physicsOverlay: rawMap.physicsOverlay } : {}),
    chunkGrid: finalGrid
  };
}

function markEvictedEntitiesReachable(
  grid: ChunkedWorldGrid | undefined,
  mark: (id: EntityId) => void,
  reachable: Set<EntityId>
): void {
  if (!grid) return;
  for (const list of Object.values(grid.evictedChunkEntities)) {
    for (const rec of list) {
      reachable.add(rec.entityId);
      mark(rec.entityId);
      for (const child of rec.ownedEntities) {
        reachable.add(child.entityId);
      }
    }
  }
}

/**
 * Prunes unreferenced entity components from state.components that are no longer
 * reachable by the active floor, sleeping areas, dormant streaming chunks, factions, or persistent entities.
 *
 * @param state The current game state.
 * @returns The sanitized game state with orphan components purged.
 */
export function pruneOrphanEntities(state: GameState): GameState {
  const reachable = new Set<EntityId>();
  const mark = (id: EntityId): void => {
    for (const ownedId of collectOwnedEntityIds(state, id)) reachable.add(ownedId);
  };

  for (const id of state.entities) mark(id);
  for (const area of state.areas.values()) {
    for (const id of area.entities) mark(id);
    markEvictedEntitiesReachable(area.map.chunkGrid, mark, reachable);
  }
  markEvictedEntitiesReachable(state.map.chunkGrid, mark, reachable);
  for (const id of Object.values(state.factionEntityIds || {})) mark(id);
  for (const id of Object.values(state.areaEntityIds || {})) mark(id);

  for (const [id, record] of state.persistentEntities.entries()) {
    mark(id);
    const inv = record.components[ComponentType.Inventory] as InventoryComponent | undefined;
    inv?.items.forEach(mark);
    const equip = record.components[ComponentType.Equipment] as EquipmentComponent | undefined;
    equip?.slots.forEach((s) => s.equippedItem !== null && mark(s.equippedItem));
    const shop = record.components[ComponentType.Shop] as ShopComponent | undefined;
    shop?.inventory.forEach(mark);
  }

  let modified = false;
  const nextComponents = new Map(state.components);
  for (const entityId of nextComponents.keys()) {
    if (!reachable.has(entityId)) {
      nextComponents.delete(entityId);
      modified = true;
    }
  }

  return modified ? updateSpatialIndex({ ...state, components: nextComponents }) : state;
}

/**
 * Purely serializes a live GameState (after pruning orphan entities) into a JSON-ready SerializedGameState DTO.
 * Stripping runtime `chunkGrid` TypedArrays keeps the JSON save slim while emitting `streamingState` metadata.
 *
 * @param state The current live GameState.
 * @returns The JSON-serializable SerializedGameState DTO.
 */
export function serializeGameState(state: GameState): SerializedGameState {
  const sanitized = pruneOrphanEntities(state);

  const serializedAreas: Array<[string, SerializedAreaData]> = Array.from(sanitized.areas.entries()).map(
    ([areaId, areaData]) => [
      areaId,
      {
        map: stripRuntimeChunkGrid(areaData.map),
        entities: areaData.entities,
        components: Array.from(areaData.components.entries()),
        rooms: areaData.rooms,
        lastSpawnTurn: areaData.lastSpawnTurn,
        lastVisitedTurn: areaData.lastVisitedTurn,
        ...(areaData.map.chunkGrid !== undefined
          ? { streamingState: serializeStreamingGridMetadata(areaData.map.chunkGrid) }
          : {})
      }
    ]
  );

  const serializedPersistentEntities: Array<[EntityId, SerializedPersistentEntityRecord]> = Array.from(
    sanitized.persistentEntities.entries()
  ).map(([id, record]) => [id, { areaId: record.areaId, components: record.components }]);

  return {
    campaignId: sanitized.campaignId,
    entities: sanitized.entities,
    components: Array.from(sanitized.components.entries()),
    map: stripRuntimeChunkGrid(sanitized.map),
    ...(sanitized.map.chunkGrid !== undefined
      ? { streamingState: serializeStreamingGridMetadata(sanitized.map.chunkGrid) }
      : {}),
    nextEntityId: sanitized.nextEntityId,
    nextItemInstanceId: sanitized.nextItemInstanceId,
    nextQuestId: sanitized.nextQuestId,
    dynamicQuests: sanitized.dynamicQuests,
    messages: sanitized.messages,
    currentAreaId: sanitized.currentAreaId,
    activeRooms: sanitized.activeRooms,
    lastSpawnTurn: sanitized.lastSpawnTurn,
    areas: serializedAreas,
    persistentEntities: serializedPersistentEntities,
    isGameOver: sanitized.isGameOver,
    uiMode: sanitized.uiMode,
    nemesisSlots: sanitized.nemesisSlots || {},
    vacancyTurns: sanitized.vacancyTurns || {},
    globalTurn: sanitized.globalTurn || 0,
    lastCheatDeathTurn: sanitized.lastCheatDeathTurn || -9999,
    activeDialogue: sanitized.activeDialogue
      ? {
          treeId: sanitized.activeDialogue.treeId,
          currentNodeId: sanitized.activeDialogue.currentNodeId,
          npcEntityId: sanitized.activeDialogue.npcEntityId,
          ...(sanitized.activeDialogue.textOverride !== undefined
            ? { textOverride: sanitized.activeDialogue.textOverride }
            : {})
        }
      : undefined,
    identifiedItems: Array.from(sanitized.identifiedItems),
    itemUnidentifiedNames: Array.from(sanitized.itemUnidentifiedNames.entries()),
    engineMode: sanitized.engineMode,
    rtwpState: sanitized.rtwpState,
    visualEffects: sanitized.visualEffects,
    isRotated: sanitized.isRotated,
    is3D: sanitized.is3D,
    zoomLevel: sanitized.zoomLevel,
    investigation: sanitized.investigation,
    historicalLedger: sanitized.historicalLedger,
    factionEntityIds: sanitized.factionEntityIds,
    areaEntityIds: sanitized.areaEntityIds,
    pendingKnowledge: sanitized.pendingKnowledge,
    pendingRumors: sanitized.pendingRumors,
    pendingRivalries: sanitized.pendingRivalries,
    dramaTracker: sanitized.dramaTracker,
    telemetry: getTelemetryStore(),
    ...(sanitized.colonyState !== undefined ? { colonyState: sanitized.colonyState } : {}),
    ...(sanitized.macroWorld !== undefined ? { macroWorld: sanitized.macroWorld } : {}),
    ...(sanitized.automapNotes && sanitized.automapNotes.length > 0 ? { automapNotes: sanitized.automapNotes } : {})
  };
}

/**
 * Computes the strict high-water-mark `nextEntityId` across every entity ID present in active,
 * persistent, dormant area, faction, and area-tracking registries so stale saved counters never collide.
 */
function computeSafeNextEntityId(
  sState: SerializedGameState,
  rehydratedAreas: ReadonlyMap<string, AreaData>,
  rehydratedPersistentEntities: ReadonlyMap<EntityId, PersistentEntityRecord>
): number {
  let maxId = 0;
  const recordId = (id: number): void => {
    if (Number.isFinite(id) && id > maxId) maxId = id;
  };

  const inspectDormantStreaming = (streaming: SerializedStreamingWorldState | undefined): void => {
    if (!streaming) return;
    for (const list of Object.values(streaming.evictedChunkEntities)) {
      for (const rec of list) {
        recordId(rec.entityId);
        for (const child of rec.ownedEntities) {
          recordId(child.entityId);
        }
      }
    }
  };

  for (const id of sState.entities) recordId(id);
  for (const [id] of sState.components) recordId(id);
  for (const [id] of rehydratedPersistentEntities) recordId(id);
  inspectDormantStreaming(sState.streamingState);
  for (const [, sArea] of sState.areas) {
    inspectDormantStreaming(sArea.streamingState);
  }
  for (const area of rehydratedAreas.values()) {
    for (const id of area.entities) recordId(id);
    for (const [id] of area.components) recordId(id);
  }
  for (const id of Object.values(sState.factionEntityIds ?? {})) recordId(id);
  for (const id of Object.values(sState.areaEntityIds ?? {})) recordId(id);

  return Math.max(sState.nextEntityId, maxId + 1);
}

function extractTrailingSequenceNumber(rawInstanceId: string | undefined): number {
  if (!rawInstanceId) return 0;
  const match = /_(\d+)$/.exec(rawInstanceId);
  if (!match?.[1]) return 0;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Computes the strict high-water-mark `nextItemInstanceId` across all item components present
 * in active, persistent, and dormant area inventories so stale saved counters never duplicate `instanceId`s.
 */
function computeSafeNextItemInstanceId(
  sState: SerializedGameState,
  rehydratedAreas: ReadonlyMap<string, AreaData>,
  rehydratedPersistentEntities: ReadonlyMap<EntityId, PersistentEntityRecord>
): number {
  let maxSeq = 0;
  const inspectCompMap = (comps: Readonly<Record<string, unknown>>): void => {
    const item = comps[ComponentType.Item] as ItemComponent | undefined;
    if (!item) return;
    const seq = extractTrailingSequenceNumber(item.instanceId);
    if (seq > maxSeq) maxSeq = seq;
  };

  for (const [, comps] of sState.components) inspectCompMap(comps);
  for (const record of rehydratedPersistentEntities.values()) inspectCompMap(record.components);
  const inspectDormantStreamingItems = (streaming: SerializedStreamingWorldState | undefined): void => {
    if (!streaming) return;
    for (const list of Object.values(streaming.evictedChunkEntities)) {
      for (const rec of list) {
        inspectCompMap(rec.components);
        for (const child of rec.ownedEntities) {
          inspectCompMap(child.components);
        }
      }
    }
  };
  inspectDormantStreamingItems(sState.streamingState);
  for (const [, sArea] of sState.areas) inspectDormantStreamingItems(sArea.streamingState);
  for (const area of rehydratedAreas.values()) {
    for (const comps of area.components.values()) inspectCompMap(comps);
  }

  return Math.max(sState.nextItemInstanceId, maxSeq + 1);
}

/**
 * Purely deserializes a SerializedGameState DTO and its loaded CampaignData back into a live GameState.
 *
 * @param sState The parsed SerializedGameState DTO.
 * @param campaign The loaded CampaignData.
 * @param campaignIdOverride Optional campaignId fallback.
 * @returns The rehydrated GameState with rebuilt spatialIndex.
 */
export function deserializeGameState(
  sState: SerializedGameState,
  campaign: GameState['campaign'],
  campaignIdOverride?: string
): GameState {
  const campaignId = campaignIdOverride ?? (sState.campaignId || 'default');

  const rehydratedAreas = new Map<string, AreaData>();
  for (const [areaId, sAreaData] of sState.areas) {
    rehydratedAreas.set(areaId, {
      map: hydrateStreamingMapSync(sAreaData.map, sAreaData.streamingState, campaign, campaignId),
      entities: sAreaData.entities,
      components: new Map(sAreaData.components),
      spatialIndex: new Map(),
      rooms: sAreaData.rooms ?? [],
      lastSpawnTurn: sAreaData.lastSpawnTurn ?? 0,
      lastVisitedTurn: sAreaData.lastVisitedTurn
    });
  }

  const rehydratedPersistentEntities = new Map<EntityId, PersistentEntityRecord>();
  if (sState.persistentEntities) {
    for (const [id, record] of sState.persistentEntities) {
      rehydratedPersistentEntities.set(id, {
        areaId: record.areaId,
        components: record.components
      });
    }
  }

  const stateWithoutIndex: GameState = {
    campaignId,
    campaign,
    entities: sState.entities,
    components: new Map(sState.components),
    map: hydrateStreamingMapSync(sState.map, sState.streamingState, campaign, campaignId),
    fovNeedsUpdate: true,
    cachedFov: new Set(),
    nextEntityId: computeSafeNextEntityId(sState, rehydratedAreas, rehydratedPersistentEntities),
    nextItemInstanceId: computeSafeNextItemInstanceId(sState, rehydratedAreas, rehydratedPersistentEntities),
    nextQuestId: sState.nextQuestId ?? 1,
    dynamicQuests: sState.dynamicQuests ?? {},
    messages: sState.messages,
    events: [],
    currentAreaId: sState.currentAreaId,
    activeRooms: sState.activeRooms ?? [],
    lastSpawnTurn: sState.lastSpawnTurn ?? 0,
    areas: rehydratedAreas,
    persistentEntities: rehydratedPersistentEntities,
    spatialIndex: new Map(),
    isGameOver: sState.isGameOver,
    uiMode: sState.uiMode === UIMode.VerbMenu ? UIMode.Game : sState.uiMode,
    nemesisSlots: sState.nemesisSlots || {},
    vacancyTurns: sState.vacancyTurns || {},
    globalTurn: sState.globalTurn || 0,
    lastCheatDeathTurn: sState.lastCheatDeathTurn || -9999,
    activeDialogue: sState.activeDialogue
      ? {
          treeId: sState.activeDialogue.treeId,
          currentNodeId: sState.activeDialogue.currentNodeId,
          npcEntityId: sState.activeDialogue.npcEntityId as EntityId,
          ...(sState.activeDialogue.textOverride !== undefined
            ? { textOverride: sState.activeDialogue.textOverride }
            : {})
        }
      : undefined,
    identifiedItems: new Set(sState.identifiedItems || []),
    itemUnidentifiedNames: new Map(sState.itemUnidentifiedNames || []),
    engineMode: sState.engineMode || EngineMode.TurnBased,
    rtwpState: sState.rtwpState || { paused: false, speedMultiplier: 1 },
    visualEffects: sState.visualEffects || [],
    isRotated: sState.isRotated || false,
    is3D: sState.is3D || false,
    zoomLevel: sState.zoomLevel ?? DEFAULT_ZOOM_LEVEL,
    playerCommandQueue: [],
    investigation: sState.investigation
      ? {
          knownActors: sState.investigation.knownActors || [],
          exposedAgreements: sState.investigation.exposedAgreements || [],
          lastClueTurn: sState.investigation.lastClueTurn || 0,
          lastStallTriggerTurn: sState.investigation.lastStallTriggerTurn
        }
      : {
          knownActors: [],
          exposedAgreements: [],
          lastClueTurn: 0
        },
    historicalLedger: sState.historicalLedger || [],
    factionEntityIds: sState.factionEntityIds || {},
    areaEntityIds: sState.areaEntityIds || {},
    pendingKnowledge: sState.pendingKnowledge ?? [],
    pendingRumors: sState.pendingRumors ?? [],
    pendingRivalries: sState.pendingRivalries ?? [],
    dramaTracker: sState.dramaTracker || {
      globalBudget: DEFAULT_GLOBAL_DRAMA_BUDGET,
      domainBudgets: {},
      activeCooldowns: {},
      lastMajorEventTurn: 0
    },
    telemetry: sState.telemetry || {
      playerDeaths: 0,
      damageTaken: 0,
      resourcesConsumed: 0,
      questsCompleted: 0
    },
    ...(sState.colonyState !== undefined ? { colonyState: sState.colonyState } : {}),
    ...(sState.macroWorld !== undefined
      ? {
          macroWorld: {
            ...sState.macroWorld,
            lastDispatchedTick: Math.min(sState.macroWorld.lastDispatchedTick, sState.macroWorld.currentTick)
          }
        }
      : {}),
    ...(sState.automapNotes && sState.automapNotes.length > 0 ? { automapNotes: sState.automapNotes } : {})
  };

  setTelemetryStore(stateWithoutIndex.telemetry);

  return updateSpatialIndex(stateWithoutIndex);
}

/**
 * Serializes the GameState and saves it to localStorage.
 * Converts Map objects to arrays of tuples for JSON compatibility.
 */
export function saveGame(state: GameState): void {
  if (state.isSandbox) return;

  const scopeKey = resolveDefaultChunkScopeKey(state.campaignId);
  const putSync = (grid: ChunkedWorldGrid | undefined): void => {
    if (!grid) return;
    for (const chunk of grid.chunks.values()) {
      if ((chunk.dirtyFlags & CHUNK_DIRTY_PERSIST) !== 0) {
        putWorldChunkDeltaSync(scopeKey, grid.areaId, chunk);
      }
    }
  };
  putSync(state.map.chunkGrid);
  for (const area of state.areas.values()) putSync(area.map.chunkGrid);

  const serializedState = serializeGameState(state);

  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializedState));
    void flushDirtyChunksToStore(state, scopeKey);
  } catch (err) {
    console.error('Failed to save game to localStorage', err);
  }
}

/**
 * Loads and deserializes the GameState from localStorage and asynchronously overlays
 * persisted WorldChunk deltas from IndexedDB.
 * Reconstructs Map objects and rebuilds the spatial index.
 * @returns The GameState, or null if no save exists or loading fails.
 */
export async function loadGame(): Promise<GameState | null> {
  const data = localStorage.getItem(SAVE_KEY);
  if (!data) return null;

  try {
    const sState: SerializedGameState = JSON.parse(data);

    const campaignId = sState.campaignId || 'default';
    let campaign;
    try {
      campaign = await loadCampaign(campaignId);
    } catch {
      throw new CampaignNotFoundError(
        `Campaign "${campaignId}" could not be loaded. It may have been uninstalled or contains errors.`
      );
    }

    const syncState = deserializeGameState(sState, campaign, campaignId);
    return await rehydrateStreamingWorldAsync(syncState, resolveDefaultChunkScopeKey(campaignId));
  } catch (err) {
    console.error('Failed to load game from localStorage', err);
    return null;
  }
}
