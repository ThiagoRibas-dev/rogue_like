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
import { loadCampaign } from './loader.ts';
import { getTelemetryStore, setTelemetryStore } from './telemetry.ts';
import type { SerializedPersistentEntityRecord, PersistentEntityRecord } from '../types/game-state.types.ts';
import {
  ComponentType,
  type InventoryComponent,
  type EquipmentComponent,
  type ShopComponent
} from '../types/components.types.ts';
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
  return localStorage.getItem(SAVE_KEY) !== null;
}

/**
 * Deletes the save game from localStorage.
 */
export function deleteSave(): void {
  localStorage.removeItem(SAVE_KEY);
}

/**
 * Gets the raw serialized save string (useful for exporting to a file).
 */
export function getSaveData(): string | null {
  return localStorage.getItem(SAVE_KEY);
}

/**
 * Overwrites the save game with a raw serialized string (useful for importing from a file).
 */
export function setSaveData(data: string): void {
  localStorage.setItem(SAVE_KEY, data);
}

/**
 * Prunes unreferenced entity components from state.components that are no longer
 * reachable by the active floor, sleeping areas, factions, or persistent entities.
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
  }
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
        map: areaData.map,
        entities: areaData.entities,
        components: Array.from(areaData.components.entries()),
        rooms: areaData.rooms,
        lastSpawnTurn: areaData.lastSpawnTurn,
        lastVisitedTurn: areaData.lastVisitedTurn
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
    map: sanitized.map,
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
    telemetry: getTelemetryStore()
  };
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
      map: sAreaData.map,
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
    map: sState.map,
    fovNeedsUpdate: true,
    cachedFov: new Set(),
    nextEntityId: sState.nextEntityId,
    nextItemInstanceId: sState.nextItemInstanceId,
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
    }
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

  const serializedState = serializeGameState(state);

  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializedState));
  } catch (err) {
    console.error('Failed to save game to localStorage', err);
  }
}

/**
 * Loads and deserializes the GameState from localStorage.
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

    return deserializeGameState(sState, campaign, campaignId);
  } catch (err) {
    console.error('Failed to load game from localStorage', err);
    return null;
  }
}
