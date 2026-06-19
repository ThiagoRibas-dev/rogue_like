import * as ROT from 'rot-js';
import {
  ComponentType,
  type PositionComponent,
  type Component,
  type PortalComponent,
  type RenderableComponent,
  type TagsComponent
} from '../types/components.types.ts';
import { type GameState, type AreaData, type EntityId, type GameMap } from '../types/game-state.types.ts';
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
import { generateArea } from '../map/generator.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

import { clearScheduler, addActor } from '../core/scheduler.ts';
import type { ChangeAreaIntent } from '@/types/intents/movement.intents.ts';

export function updateExploredTiles(state: GameState): GameState {
  if (!state.fovNeedsUpdate) return state;

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

  return {
    ...state,
    fovNeedsUpdate: false,
    cachedFov: visibleIndices,
    map: modified ? { ...state.map, tiles: nextTiles } : state.map
  };
}

export function processChangeAreaIntent(
  state: GameState,
  intent: ChangeAreaIntent
): { state: GameState; success: boolean } {
  const { targetAreaId, targetX, targetY, entityId } = intent;

  // 1. Determine which entities migrate with the player (inventory, equipment)
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  const equipment = getComponent(state, entityId, ComponentType.Equipment);

  const migratingEntities = new Set<EntityId>([entityId]);
  if (inventory) {
    inventory.items.forEach((id) => migratingEntities.add(id));
  }
  if (equipment) {
    equipment.slots.forEach((s) => {
      if (s.equippedItem !== null) migratingEntities.add(s.equippedItem);
    });
  }

  // Pack and save the current floor (excluding migrating entities and persistent entities)
  const savedEntityIds = state.entities.filter((id) => !migratingEntities.has(id));
  const regularSavedEntityIds: EntityId[] = [];
  const nextPersistentEntities = new Map(state.persistentEntities);

  const currentLevelComponents = new Map<EntityId, Readonly<Record<string, Component>>>();

  for (const id of savedEntityIds) {
    const comps = state.components.get(id);
    if (comps === undefined) continue;

    const isPersistent = comps[ComponentType.Persistent] !== undefined;
    if (isPersistent) {
      nextPersistentEntities.set(id, {
        areaId: state.currentAreaId,
        components: comps
      });
    } else {
      regularSavedEntityIds.push(id);
      currentLevelComponents.set(id, comps);
    }
  }

  // Remove the migrating & persistent entities' positions from the saved index
  const currentAreaData: AreaData = {
    map: state.map,
    entities: regularSavedEntityIds,
    components: currentLevelComponents,
    spatialIndex: updateSpatialIndex({ ...state, entities: regularSavedEntityIds, components: currentLevelComponents })
      .spatialIndex
  };

  const nextAreas = new Map(state.areas);
  nextAreas.set(state.currentAreaId, currentAreaData);

  // 2. Load or generate target floor
  let targetMap: GameMap;
  let nextEntities: ReadonlyArray<EntityId> = [];
  let nextComponents = new Map<EntityId, Readonly<Record<string, Component>>>();
  let spawnX: number = targetX ?? -1;
  let spawnY: number = targetY ?? -1;

  const savedTargetArea = nextAreas.get(targetAreaId);

  if (savedTargetArea !== undefined) {
    targetMap = savedTargetArea.map;
    nextEntities = [...savedTargetArea.entities];
    nextComponents = new Map(savedTargetArea.components);

    // Find the corresponding stairs
    let foundStairs = false;
    for (const id of nextEntities) {
      const portal = nextComponents.get(id)?.[ComponentType.Portal] as PortalComponent;
      if (portal && portal.targetAreaId === state.currentAreaId) {
        const pos = nextComponents.get(id)?.[ComponentType.Position] as PositionComponent;
        if (pos && spawnX === -1) {
          spawnX = pos.x;
          spawnY = pos.y;
          foundStairs = true;
          break;
        }
      }
    }

    if (!foundStairs && spawnX === -1) {
      spawnX = Math.floor(targetMap.width / 2);
      spawnY = Math.floor(targetMap.height / 2);
    }
  } else {
    // Generate new floor
    const generated = generateArea(state.campaign, targetAreaId);
    targetMap = generated.map;
    spawnX = generated.startPos.x;
    spawnY = generated.startPos.y;

    // We can't use createEntity easily without a state object.
    // Let's create a temporary state to use ECS functions.
    let tempState: GameState = { ...state, entities: [], components: new Map(), map: targetMap };

    for (const portal of generated.portals) {
      let stairId: EntityId;

      const portalComp: PortalComponent = {
        type: ComponentType.Portal,
        targetAreaId: portal.connection.targetAreaId,
        targetX: portal.connection.targetX,
        targetY: portal.connection.targetY
      };

      if (
        (portal.connection.direction === 'portal' || portal.connection.direction === 'edge') &&
        portal.connection.portalTemplateId
      ) {
        if (state.campaign.entities[portal.connection.portalTemplateId]) {
          [tempState, stairId] = spawnEntity(tempState, portal.connection.portalTemplateId, portal.x, portal.y);
          tempState = addComponent(tempState, stairId, portalComp);
        } else if (state.campaign.items[portal.connection.portalTemplateId]) {
          [tempState, stairId] = spawnItem(tempState, portal.connection.portalTemplateId, portal.x, portal.y);
          tempState = addComponent(tempState, stairId, portalComp);
        } else {
          console.warn(`Portal template ${portal.connection.portalTemplateId} not found.`);
          [tempState, stairId] = createEntity(tempState);
          const pos: PositionComponent = { type: ComponentType.Position, x: portal.x, y: portal.y };
          tempState = addComponent(addComponent(tempState, stairId, pos), stairId, portalComp);
        }
      } else {
        [tempState, stairId] = createEntity(tempState);

        const pos: PositionComponent = { type: ComponentType.Position, x: portal.x, y: portal.y };
        const render: RenderableComponent = {
          type: ComponentType.Renderable,
          glyph:
            portal.connection.direction === 'portal' || portal.connection.direction === 'edge'
              ? 'O'
              : portal.connection.direction === 'up'
                ? (state.campaign.theme.glyphs.stairsUp ?? '<')
                : (state.campaign.theme.glyphs.stairsDown ?? '>'),
          fg: state.campaign.theme.colors.stairsFg ?? '#ffffff',
          bg: state.campaign.theme.colors.transparent ?? 'transparent'
        };

        const tags: TagsComponent = {
          type: ComponentType.Tags,
          tags: ['portal']
        };

        tempState = addComponent(
          addComponent(addComponent(addComponent(tempState, stairId, pos), stairId, render), stairId, portalComp),
          stairId,
          tags
        );
      }
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

    if (generated.placedEntities) {
      for (const ent of generated.placedEntities) {
        if (state.campaign.items[ent.templateId]) {
          [tempState] = spawnItem(tempState, ent.templateId, ent.x, ent.y);
        } else if (state.campaign.entities[ent.templateId]) {
          [tempState] = spawnEntity(tempState, ent.templateId, ent.x, ent.y, ent.dynamicTraits);
        } else {
          console.warn(`Placed entity template ${ent.templateId} not found in items or entities registries.`);
        }
      }
    }

    nextEntities = tempState.entities;
    nextComponents = tempState.components as Map<EntityId, Readonly<Record<string, Component>>>;
  }

  // Wake up persistent entities that belong to the target area
  const nextEntitiesArray = [...nextEntities];
  for (const [id, record] of nextPersistentEntities.entries()) {
    if (record.areaId === targetAreaId) {
      nextEntitiesArray.push(id);
      nextComponents.set(id, record.components);
      nextPersistentEntities.delete(id); // Remove from global cold storage, it's now in active ECS
    }
  }
  nextEntities = nextEntitiesArray;

  // 3. Move Player and their owned items
  const migratingArray = Array.from(migratingEntities);
  nextEntities = [...migratingArray, ...nextEntities];

  // Bring migrating components into the new floor
  for (const id of migratingArray) {
    let comps = state.components.get(id) ?? {};
    if (id === entityId) {
      // Update player position
      comps = {
        ...comps,
        [ComponentType.Position]: { ...(comps[ComponentType.Position] as PositionComponent), x: spawnX, y: spawnY }
      };
    }
    nextComponents.set(id, comps);
  }

  let nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    map: targetMap,
    currentAreaId: targetAreaId,
    areas: nextAreas,
    persistentEntities: nextPersistentEntities,
    fovNeedsUpdate: true,
    cachedFov: new Set()
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

  const msg = `You travel to ${targetAreaId}.`;
  nextState = addMessage(nextState, msg, MessageLogCategory.System);

  return { state: updateExploredTiles(nextState), success: true };
}
