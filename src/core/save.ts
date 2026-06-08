import {
  type GameState,
  type LevelData,
  type SerializedGameState,
  type SerializedLevelData
} from '../types/game-state.types.ts';
import { updateSpatialIndex } from './ecs.ts';

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
 * Serializes the GameState and saves it to localStorage.
 * Converts Map objects to arrays of tuples for JSON compatibility.
 */
export function saveGame(state: GameState): void {
  const serializedLevels: Array<[number, SerializedLevelData]> = Array.from(state.levels.entries()).map(
    ([depth, levelData]) => {
      const sLevelData: SerializedLevelData = {
        map: levelData.map,
        entities: levelData.entities,
        components: Array.from(levelData.components.entries())
      };
      return [depth, sLevelData];
    }
  );

  const serializedState: SerializedGameState = {
    entities: state.entities,
    components: Array.from(state.components.entries()),
    map: state.map,
    nextEntityId: state.nextEntityId,
    nextItemInstanceId: state.nextItemInstanceId,
    messages: state.messages,
    currentDepth: state.currentDepth,
    levels: serializedLevels,
    isGameOver: state.isGameOver,
    uiMode: state.uiMode,
    identifiedItems: Array.from(state.identifiedItems),
    itemUnidentifiedNames: Array.from(state.itemUnidentifiedNames.entries())
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
export function loadGame(): GameState | null {
  const data = localStorage.getItem(SAVE_KEY);
  if (!data) return null;

  try {
    const sState: SerializedGameState = JSON.parse(data);

    const rehydratedLevels = new Map<number, LevelData>();
    for (const [depth, sLevelData] of sState.levels) {
      rehydratedLevels.set(depth, {
        map: sLevelData.map,
        entities: sLevelData.entities,
        components: new Map(sLevelData.components),
        spatialIndex: new Map()
      });
    }

    const stateWithoutIndex: GameState = {
      entities: sState.entities,
      components: new Map(sState.components),
      map: sState.map,
      nextEntityId: sState.nextEntityId,
      nextItemInstanceId: sState.nextItemInstanceId,
      messages: sState.messages,
      currentDepth: sState.currentDepth,
      levels: rehydratedLevels,
      spatialIndex: new Map(), // Will be rebuilt below
      isGameOver: sState.isGameOver,
      uiMode: sState.uiMode,
      identifiedItems: new Set(sState.identifiedItems || []),
      itemUnidentifiedNames: new Map(sState.itemUnidentifiedNames || [])
    };

    // Rebuild the spatial index for the active floor
    return updateSpatialIndex(stateWithoutIndex);
  } catch (err) {
    console.error('Failed to load game from localStorage', err);
    return null;
  }
}
