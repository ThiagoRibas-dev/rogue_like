import * as ROT from 'rot-js';
import {
  ComponentType,
  type PositionComponent,
  type Component,
  type InteractableComponent,
  type RenderableComponent
} from '../types/components.types.ts';
import { type GameState, type LevelData, type EntityId, type GameMap } from '../types/game-state.types.ts';
import {
  getComponent,
  queryEntities,
  updateSpatialIndex,
  createEntity,
  addComponent,
  spawnEntity,
  spawnItem
} from '../core/ecs.ts';
import { computeFOV } from '../map/fov.ts';
import { generateDungeon } from '../map/generator.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

import { IntentType, type ChangeFloorIntent, type InteractIntent, type Intent } from '../types/intents.types.ts';
import { queuePlayerIntent } from '../core/game-loop.ts';
import { clearScheduler, addActor } from '../core/scheduler.ts';
import { coordToIndex } from '../utils/grid.ts';

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
    map: { ...state.map, tiles: nextTiles }
  };
}

export function processInteractIntent(
  state: GameState,
  intent: InteractIntent
): { state: GameState; success: boolean } {
  const pos = getComponent(state, intent.entityId, ComponentType.Position);
  if (!pos) return { state, success: false };

  const key = `${pos.x},${pos.y}`;
  const entities = state.spatialIndex.get(key) || [];

  let nextState = state;
  let interacted = false;

  for (const targetId of entities) {
    if (targetId === intent.entityId) continue;

    const interactable = getComponent(state, targetId, ComponentType.Interactable);
    if (interactable) {
      for (const i of interactable.intents) {
        if (i.type === IntentType.ChangeFloor) {
          const boundIntent = { ...i, entityId: intent.entityId } as ChangeFloorIntent;
          const result = processChangeFloorIntent(nextState, boundIntent);
          nextState = result.state;
        } else {
          // Queue other intents if necessary, but ChangeFloor should be synchronous
          const boundIntent = { ...i, entityId: intent.entityId };
          queuePlayerIntent(boundIntent as Intent);
        }
      }
      interacted = true;
    }
  }

  if (!interacted) {
    const tileIdx = coordToIndex(pos.x, pos.y, state.map.width);
    const tile = state.map.tiles[tileIdx];
    if (tile) {
      const tileDef = state.campaign.tiles[tile.tileId];
      if (tileDef?.interactTransition) {
        const nextTiles = [...state.map.tiles];
        nextTiles[tileIdx] = { ...tile, tileId: tileDef.interactTransition };
        const nextMap = { ...state.map, tiles: nextTiles };
        let nextState: GameState = { ...state, map: nextMap };

        const isPlayer = getComponent(state, intent.entityId, ComponentType.Player) !== undefined;
        if (isPlayer) {
          const msg = tileDef.interactMessage ?? 'You interact with it.';
          nextState = addMessage(nextState, msg, MessageLogCategory.System);
        }
        return { state: nextState, success: true };
      }
    }

    const isPlayer = getComponent(state, intent.entityId, ComponentType.Player) !== undefined;
    if (isPlayer) {
      return {
        state: addMessage(nextState, 'There is nothing here to interact with.', MessageLogCategory.System),
        success: false
      };
    }
  }

  return { state: nextState, success: interacted };
}

export function processChangeFloorIntent(
  state: GameState,
  intent: ChangeFloorIntent
): { state: GameState; success: boolean } {
  const { direction, entityId } = intent;

  const targetDepth: number = state.currentDepth + (direction === 'up' ? -1 : 1);

  if (targetDepth <= 0) {
    return {
      state: addMessage(
        state,
        'You cannot escape back to the surface yet! The Goblin King still lives.',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  if (targetDepth > state.campaign.rules.map.maxDungeonDepth) {
    return {
      state: addMessage(
        state,
        'You have reached the bottom of the dungeon. There is nowhere deeper to go.',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  // 1. Determine which entities migrate with the player (inventory, equipment)
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  const equipment = getComponent(state, entityId, ComponentType.Equipment);

  const migratingEntities = new Set<EntityId>([entityId]);
  if (inventory) {
    inventory.items.forEach((id) => migratingEntities.add(id));
  }
  if (equipment) {
    if (equipment.weapon !== null) migratingEntities.add(equipment.weapon);
    if (equipment.armor !== null) migratingEntities.add(equipment.armor);
  }

  // Pack and save the current floor (excluding migrating entities)
  const savedEntityIds = state.entities.filter((id) => !migratingEntities.has(id));
  const currentLevelComponents = new Map<EntityId, ReadonlyArray<Component>>();
  for (const id of savedEntityIds) {
    const comps = state.components.get(id);
    if (comps !== undefined) {
      currentLevelComponents.set(id, comps);
    }
  }

  // Remove the migrating entities' positions from the saved index
  const currentLevelData: LevelData = {
    map: state.map,
    entities: savedEntityIds,
    components: currentLevelComponents,
    spatialIndex: updateSpatialIndex({ ...state, entities: savedEntityIds, components: currentLevelComponents })
      .spatialIndex
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
      const interactable = nextComponents
        .get(id)
        ?.find((c) => c.type === ComponentType.Interactable) as InteractableComponent;
      if (
        interactable &&
        interactable.intents.some(
          (i) => i.type === IntentType.ChangeFloor && (i as ChangeFloorIntent).direction !== direction
        )
      ) {
        const pos = nextComponents.get(id)?.find((c) => c.type === ComponentType.Position) as PositionComponent;
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
    const generated = generateDungeon(
      state.campaign.rules.map.width,
      state.campaign.rules.map.height,
      targetDepth,
      state.campaign.rules.map
    );
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
        glyph:
          stair.direction === 'up'
            ? (state.campaign.theme.glyphs.stairsUp ?? '<')
            : (state.campaign.theme.glyphs.stairsDown ?? '>'),
        fg: state.campaign.theme.colors.stairsFg ?? '#ffffff',
        bg: state.campaign.theme.colors.transparent ?? 'transparent'
      };
      const interactable: InteractableComponent = {
        type: ComponentType.Interactable,
        intents: [{ type: IntentType.ChangeFloor, direction: stair.direction } as ChangeFloorIntent]
      };

      tempState = addComponent(
        addComponent(addComponent(tempState, stairId, pos), stairId, render),
        stairId,
        interactable
      );
    }

    // Spawn monsters and items in all rooms except the first one (where the player spawns)
    for (let i = 1; i < generated.rooms.length; i++) {
      const room = generated.rooms[i];
      if (!room) continue;

      const numMonsters = ROT.RNG.getUniformInt(0, state.campaign.rules.spawning.maxMonstersPerRoom);
      for (let m = 0; m < numMonsters; m++) {
        const mx = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
        const my = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
        const template =
          ROT.RNG.getWeightedValue(state.campaign.rules.spawning.spawnWeights as Record<string, number>) || 'orc';
        [tempState] = spawnEntity(tempState, template, mx, my);
      }

      const numItems = ROT.RNG.getUniformInt(0, state.campaign.rules.spawning.maxItemsPerRoom);
      for (let n = 0; n < numItems; n++) {
        const ix = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
        const iy = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
        const itemId =
          ROT.RNG.getWeightedValue(state.campaign.rules.spawning.lootTable as Record<string, number>) ||
          'health_potion';
        [tempState] = spawnItem(tempState, itemId, ix, iy);
      }
    }

    nextEntities = tempState.entities;
    nextComponents = tempState.components as Map<EntityId, ReadonlyArray<Component>>;
  }

  // 3. Move Player and their owned items
  const migratingArray = Array.from(migratingEntities);
  nextEntities = [...migratingArray, ...nextEntities];

  // Bring migrating components into the new floor
  for (const id of migratingArray) {
    let comps = state.components.get(id) ?? [];
    if (id === entityId) {
      // Update player position
      comps = comps.map((c) => (c.type === ComponentType.Position ? { ...c, x: spawnX, y: spawnY } : c));
    }
    nextComponents.set(id, comps);
  }

  let nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    map: targetMap,
    currentDepth: targetDepth,
    levels: nextLevels
  };

  nextState = updateSpatialIndex(nextState);

  // 4. Update Scheduler
  clearScheduler();
  for (const id of nextState.entities) {
    if (id === entityId) {
      const actor = getComponent(nextState, id, ComponentType.Actor);
      if (actor) addActor(id);
      continue;
    }
    const actor = getComponent(nextState, id, ComponentType.Actor);
    if (actor) {
      addActor(id);
    }
  }

  const msg = direction === 'up' ? `You ascend to level ${targetDepth}.` : `You descend to level ${targetDepth}.`;
  nextState = addMessage(nextState, msg, MessageLogCategory.System);

  return { state: updateExploredTiles(nextState), success: true };
}
