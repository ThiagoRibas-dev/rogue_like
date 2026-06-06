import { ComponentType, type PositionComponent, type Component } from '../types/components.types.ts';
import { type GameState, type LevelData, type EntityId, type GameMap } from '../types/game-state.types.ts';
import { getComponent, queryEntities } from '../core/ecs.ts';
import { computeFOV } from '../map/fov.ts';
import { generateDungeon } from '../map/generator.ts';
import { addMessage } from './message.system.ts';
import { MAP_WIDTH, MAP_HEIGHT, MAX_DUNGEON_DEPTH } from '../constants/map.constants.ts';

/**
 * Pure system function that computes the player's field of view
 * and marks visible tiles as explored in the GameState.
 *
 * @param state The current GameState.
 * @returns The updated GameState with newly explored tiles.
 */
export function updateExploredTiles(state: GameState): GameState {
  const players: ReadonlyArray<EntityId> = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
  const playerEntityId = players[0];
  if (playerEntityId === undefined) {
    return state;
  }

  const playerPos = getComponent(state, playerEntityId, ComponentType.Position);
  if (playerPos === undefined) {
    return state;
  }

  const visibleIndices: Set<number> = computeFOV(state, playerPos.x, playerPos.y);

  let modified = false;
  const nextTiles = state.map.tiles.map((tile, idx) => {
    if (visibleIndices.has(idx) && !tile.explored) {
      modified = true;
      return {
        ...tile,
        explored: true,
      };
    }
    return tile;
  });

  if (!modified) {
    return state;
  }

  return {
    ...state,
    map: {
      ...state.map,
      tiles: nextTiles,
    },
  };
}

/**
 * Transition the player between dungeon levels.
 * Saves the current floor's non-player entities and level layout,
 * and loads/generates the destination level.
 *
 * @param state The current GameState.
 * @param direction Whether ascending ('up') or descending ('down').
 * @returns The updated GameState.
 */
export function transitionFloor(state: GameState, direction: 'up' | 'down'): GameState {
  const players: ReadonlyArray<EntityId> = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
  const playerEntityId = players[0];
  if (playerEntityId === undefined) {
    return state;
  }

  const playerPos = getComponent(state, playerEntityId, ComponentType.Position);
  if (playerPos === undefined) {
    return state;
  }

  // Check if player is actually standing on the appropriate stair tile
  const playerIndex = playerPos.y * state.map.width + playerPos.x;
  const currentTile = state.map.tiles[playerIndex];
  const requiredTileId = direction === 'up' ? 'stairs_up' : 'stairs_down';

  if (currentTile === undefined || currentTile.tileId !== requiredTileId) {
    return addMessage(state, `There are no stairs leading ${direction} here.`, 'system');
  }

  const targetDepth: number = state.currentDepth + (direction === 'up' ? -1 : 1);

  if (targetDepth <= 0) {
    return addMessage(
      state,
      "You cannot escape back to the surface yet! The Goblin King still lives.",
      "system"
    );
  }

  if (targetDepth > MAX_DUNGEON_DEPTH) {
    return addMessage(
      state,
      "You have reached the bottom of the dungeon. There is nowhere deeper to go.",
      "system"
    );
  }

  // 1. Pack and save the current floor's non-player entities and map
  const nonPlayerEntityIds = state.entities.filter((id) => id !== playerEntityId);
  const currentLevelComponents = new Map<EntityId, ReadonlyArray<Component>>();
  for (const id of nonPlayerEntityIds) {
    const comps = state.components.get(id);
    if (comps !== undefined) {
      currentLevelComponents.set(id, comps);
    }
  }

  const currentLevelData: LevelData = {
    map: state.map,
    entities: nonPlayerEntityIds,
    components: currentLevelComponents,
  };

  const nextLevels = new Map(state.levels);
  nextLevels.set(state.currentDepth, currentLevelData);

  // 2. Load or generate the target floor
  let targetMap: GameMap;
  let nextEntities: ReadonlyArray<EntityId>;
  let nextComponents: Map<EntityId, ReadonlyArray<Component>>;
  let spawnX: number;
  let spawnY: number;

  const savedTargetLevel = nextLevels.get(targetDepth);

  if (savedTargetLevel !== undefined) {
    // Return to an existing floor
    targetMap = savedTargetLevel.map;
    nextEntities = [playerEntityId, ...savedTargetLevel.entities];
    nextComponents = new Map(savedTargetLevel.components);

    // Find the corresponding stairs on the target map to place the player on
    const entryStairsId = direction === 'up' ? 'stairs_down' : 'stairs_up';
    const entryTile = targetMap.tiles.find((t) => t.tileId === entryStairsId);
    if (entryTile !== undefined) {
      spawnX = entryTile.x;
      spawnY = entryTile.y;
    } else {
      // Fallback to center
      spawnX = Math.floor(targetMap.width / 2);
      spawnY = Math.floor(targetMap.height / 2);
    }
  } else {
    // Generate a new floor
    const generated = generateDungeon(MAP_WIDTH, MAP_HEIGHT, targetDepth);
    targetMap = generated.map;
    nextEntities = [playerEntityId];
    nextComponents = new Map();
    spawnX = generated.startPos.x;
    spawnY = generated.startPos.y;
  }

  // 3. Move the player entity to the spawn position on the target floor
  const playerComponents = state.components.get(playerEntityId) ?? [];
  const nextPlayerComponents = playerComponents.map((c) => {
    if (c.type === ComponentType.Position) {
      const nextPos: PositionComponent = {
        type: ComponentType.Position,
        x: spawnX,
        y: spawnY,
      };
      return nextPos;
    }
    return c;
  });
  nextComponents.set(playerEntityId, nextPlayerComponents);

  // 4. Construct the new GameState
  let nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    map: targetMap,
    currentDepth: targetDepth,
    levels: nextLevels,
  };

  // 5. Append a descriptive message log entry
  const msg = direction === 'up'
    ? `You ascend to level ${targetDepth}.`
    : `You descend to level ${targetDepth}.`;
  nextState = addMessage(nextState, msg, 'system');

  // 6. Refresh FOV for the player on the new floor
  return updateExploredTiles(nextState);
}
