import { ComponentType, type PositionComponent, type Component, type InteractableComponent, type RenderableComponent } from '../types/components.types.ts';
import { type GameState, type LevelData, type EntityId, type GameMap } from '../types/game-state.types.ts';
import { getComponent, queryEntities, updateSpatialIndex, createEntity, addComponent } from '../core/ecs.ts';
import { computeFOV } from '../map/fov.ts';
import { generateDungeon } from '../map/generator.ts';
import { addMessage } from './message.system.ts';
import { MAP_WIDTH, MAP_HEIGHT, MAX_DUNGEON_DEPTH } from '../constants/map.constants.ts';
import { IntentType, type ChangeFloorIntent, type InteractIntent } from '../types/intents.types.ts';
import { queuePlayerIntent } from '../core/game-loop.ts';

export function updateExploredTiles(state: GameState): GameState {
  const players: ReadonlyArray<EntityId> = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
  const playerEntityId = players[0];
  if (playerEntityId === undefined) return state;

  const playerPos = getComponent(state, playerEntityId, ComponentType.Position);
  if (playerPos === undefined) return state;

  const visibleIndices: Set<number> = computeFOV(state, playerPos.x, playerPos.y);

  let modified = false;
  const nextTiles = state.map.tiles.map((tile, idx) => {
    if (visibleIndices.has(idx) && !tile.explored) {
      modified = true;
      return { ...tile, explored: true };
    }
    return tile;
  });

  if (!modified) return state;

  return {
    ...state,
    map: { ...state.map, tiles: nextTiles },
  };
}

export function processInteractIntent(state: GameState, intent: InteractIntent): GameState {
  const pos = getComponent(state, intent.entityId, ComponentType.Position);
  if (!pos) return state;
  
  const key = `${pos.x},${pos.y}`;
  const entities = state.spatialIndex.get(key) || [];
  
  let interacted = false;
  for (const targetId of entities) {
    if (targetId === intent.entityId) continue;
    
    const interactable = getComponent(state, targetId, ComponentType.Interactable);
    if (interactable) {
      interactable.intents.forEach(i => {
        const boundIntent = { ...i, entityId: intent.entityId };
        queuePlayerIntent(boundIntent as any);
      });
      interacted = true;
    }
  }
  
  if (!interacted) {
    const isPlayer = getComponent(state, intent.entityId, ComponentType.Player) !== undefined;
    if (isPlayer) {
      return addMessage(state, 'There is nothing here to interact with.', 'system');
    }
  }
  
  return state;
}

export function processChangeFloorIntent(state: GameState, intent: ChangeFloorIntent): GameState {
  const { direction, entityId } = intent;
  
  const targetDepth: number = state.currentDepth + (direction === 'up' ? -1 : 1);

  if (targetDepth <= 0) {
    return addMessage(state, "You cannot escape back to the surface yet! The Goblin King still lives.", "system");
  }

  if (targetDepth > MAX_DUNGEON_DEPTH) {
    return addMessage(state, "You have reached the bottom of the dungeon. There is nowhere deeper to go.", "system");
  }

  // 1. Pack and save the current floor
  const nonPlayerEntityIds = state.entities.filter((id) => id !== entityId);
  const currentLevelComponents = new Map<EntityId, ReadonlyArray<Component>>();
  for (const id of nonPlayerEntityIds) {
    const comps = state.components.get(id);
    if (comps !== undefined) {
      currentLevelComponents.set(id, comps);
    }
  }

  // Remove the player's position from the saved index so they don't block stairs for others
  const currentLevelData: LevelData = {
    map: state.map,
    entities: nonPlayerEntityIds,
    components: currentLevelComponents,
    spatialIndex: updateSpatialIndex({ ...state, entities: nonPlayerEntityIds, components: currentLevelComponents }).spatialIndex,
  };

  const nextLevels = new Map(state.levels);
  nextLevels.set(state.currentDepth, currentLevelData);

  // 2. Load or generate target floor
  let targetMap: GameMap;
  let nextEntities: ReadonlyArray<EntityId> = [];
  let nextComponents = new Map<EntityId, ReadonlyArray<Component>>();
  let spawnX: number;
  let spawnY: number;

  const savedTargetLevel = nextLevels.get(targetDepth);

  if (savedTargetLevel !== undefined) {
    targetMap = savedTargetLevel.map;
    nextEntities = [...savedTargetLevel.entities];
    nextComponents = new Map(savedTargetLevel.components);

    // Find the corresponding stairs
    let foundStairs = false;
    for (const id of nextEntities) {
      const interactable = nextComponents.get(id)?.find(c => c.type === ComponentType.Interactable) as InteractableComponent;
      if (interactable && interactable.intents.some(i => i.type === IntentType.ChangeFloor && (i as ChangeFloorIntent).direction !== direction)) {
        const pos = nextComponents.get(id)?.find(c => c.type === ComponentType.Position) as PositionComponent;
        if (pos) {
          spawnX = pos.x;
          spawnY = pos.y;
          foundStairs = true;
          break;
        }
      }
    }
    
    if (!foundStairs) {
      spawnX = Math.floor(targetMap.width / 2);
      spawnY = Math.floor(targetMap.height / 2);
    }
  } else {
    // Generate new floor
    const generated = generateDungeon(MAP_WIDTH, MAP_HEIGHT, targetDepth);
    targetMap = generated.map;
    spawnX = generated.startPos.x;
    spawnY = generated.startPos.y;
    
    // We can't use createEntity easily without a state object.
    // Let's create a temporary state to use ECS functions.
    let tempState: GameState = { ...state, entities: [], components: new Map(), map: targetMap };
    
    for (const stair of generated.stairs) {
      let stairId: EntityId;
      [tempState, stairId] = createEntity(tempState);
      
      const pos: PositionComponent = { type: ComponentType.Position, x: stair.x, y: stair.y };
      const render: RenderableComponent = {
        type: ComponentType.Renderable,
        glyph: stair.direction === 'up' ? '<' : '>',
        fg: '#fff',
        bg: '#000'
      };
      const interactable: InteractableComponent = {
        type: ComponentType.Interactable,
        intents: [ { type: IntentType.ChangeFloor, direction: stair.direction } as any ]
      };
      
      tempState = addComponent(addComponent(addComponent(tempState, stairId, pos), stairId, render), stairId, interactable);
    }
    
    nextEntities = tempState.entities;
    nextComponents = tempState.components as Map<EntityId, ReadonlyArray<Component>>;
  }

  // 3. Move Player
  nextEntities = [entityId, ...nextEntities];
  const playerComponents = state.components.get(entityId) ?? [];
  const nextPlayerComponents = playerComponents.map((c) =>
    c.type === ComponentType.Position ? { ...c, x: spawnX, y: spawnY } : c
  );
  nextComponents.set(entityId, nextPlayerComponents);

  let nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    map: targetMap,
    currentDepth: targetDepth,
    levels: nextLevels,
  };
  
  nextState = updateSpatialIndex(nextState);

  const msg = direction === 'up' ? `You ascend to level ${targetDepth}.` : `You descend to level ${targetDepth}.`;
  nextState = addMessage(nextState, msg, 'system');

  return updateExploredTiles(nextState);
}
