import {
  type GameState,
  type AreaData,
  type SerializedGameState,
  type SerializedAreaData,
  EngineMode
} from '../types/game-state.types.ts';
import { updateSpatialIndex } from './ecs.ts';
import { loadCampaign } from './loader.ts';

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
 * Serializes the GameState and saves it to localStorage.
 * Converts Map objects to arrays of tuples for JSON compatibility.
 */
export function saveGame(state: GameState): void {
  const serializedAreas: Array<[string, SerializedAreaData]> = Array.from(state.areas.entries()).map(
    ([areaId, areaData]) => {
      const sAreaData: SerializedAreaData = {
        map: areaData.map,
        entities: areaData.entities,
        components: Array.from(areaData.components.entries())
      };
      return [areaId, sAreaData];
    }
  );

  const serializedState: SerializedGameState = {
    campaignId: state.campaignId,
    entities: state.entities,
    components: Array.from(state.components.entries()),
    map: state.map,
    nextEntityId: state.nextEntityId,
    nextItemInstanceId: state.nextItemInstanceId,
    messages: state.messages,
    currentAreaId: state.currentAreaId,
    areas: serializedAreas,
    isGameOver: state.isGameOver,
    uiMode: state.uiMode,
    identifiedItems: Array.from(state.identifiedItems),
    itemUnidentifiedNames: Array.from(state.itemUnidentifiedNames.entries()),
    engineMode: state.engineMode,
    rtwpState: state.rtwpState,
    visualEffects: state.visualEffects,
    isRotated: state.isRotated,
    is3D: state.is3D,
    zoomLevel: state.zoomLevel
  };

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

    // Default to 'default' if an old save is loaded
    const campaignId = sState.campaignId || 'default';
    const campaign = await loadCampaign(campaignId);

    const rehydratedAreas = new Map<string, AreaData>();
    for (const [areaId, sAreaData] of sState.areas) {
      rehydratedAreas.set(areaId, {
        map: sAreaData.map,
        entities: sAreaData.entities,
        components: new Map(sAreaData.components),
        spatialIndex: new Map()
      });
    }

    const stateWithoutIndex: GameState = {
      campaignId,
      campaign,
      entities: sState.entities,
      components: new Map(sState.components),
      map: sState.map,
      nextEntityId: sState.nextEntityId,
      nextItemInstanceId: sState.nextItemInstanceId,
      messages: sState.messages,
      events: [], // Events are transient per-turn, so we start with empty on load
      currentAreaId: sState.currentAreaId,
      areas: rehydratedAreas,
      spatialIndex: new Map(), // Will be rebuilt below
      isGameOver: sState.isGameOver,
      uiMode: sState.uiMode,
      identifiedItems: new Set(sState.identifiedItems || []),
      itemUnidentifiedNames: new Map(sState.itemUnidentifiedNames || []),
      engineMode: sState.engineMode || EngineMode.TurnBased,
      rtwpState: sState.rtwpState || { paused: false, speedMultiplier: 1 },
      visualEffects: sState.visualEffects || [],
      isRotated: sState.isRotated || false,
      is3D: sState.is3D || false,
      zoomLevel: sState.zoomLevel ?? 1.0,
      playerCommandQueue: []
    };

    // Rebuild the spatial index for the active floor
    return updateSpatialIndex(stateWithoutIndex);
  } catch (err) {
    console.error('Failed to load game from localStorage', err);
    return null;
  }
}
