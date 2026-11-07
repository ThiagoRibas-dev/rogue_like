import { collectOwnedEntityIds, getComponent, queryEntities, updateSpatialIndex } from '../core/ecs.ts';
import { computeFOV } from '../map/fov.ts';
import type { RoomBounds } from '../types/encounter.types.ts';
import {
  ComponentType,
  type Component,
  type PortalComponent,
  type PositionComponent,
  type NemesisComponent,
  type AttitudeComponent
} from '../types/components.types.ts';
import { type AreaData, type EntityId, type GameMap, type GameState } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import type { ChangeAreaIntent } from '@/types/intents/movement.intents.ts';
import { addActor, clearScheduler } from '../core/scheduler.ts';
import { deliverPendingKnowledgeToArea } from './knowledge.system.ts';
import { wakeSavedAreaFloor } from './map/map_wake_respawn.ts';
import { generateAndPopulateAreaFloor } from './map/map_generation_spawner.ts';

/**
 * Evaluates the player's line of sight and marks newly visible tiles as explored.
 */
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

/**
 * Returns the IDs of hostile or nemesis entities currently visible to the player.
 *
 * Pure read of `cachedFov`: performs no mutation and emits no events, keeping the
 * systems layer event-free. The caller (the RTwP auto-pause evaluator) is
 * responsible for diffing successive results and emitting `EntitySpotted`.
 *
 * @param state The current GameState.
 * @returns ReadonlyArray of currently visible hostile or nemesis EntityIds.
 */
export function getVisibleHostileEntityIds(state: GameState): ReadonlyArray<EntityId> {
  const visible: EntityId[] = [];

  for (const entityId of state.entities) {
    const position = getComponent(state, entityId, ComponentType.Position);
    if (position === undefined) continue;

    const index = coordToIndex(position.x, position.y, state.map.width);
    if (!state.cachedFov.has(index)) continue;

    const attitude = getComponent(state, entityId, ComponentType.Attitude) as AttitudeComponent | undefined;
    const isNemesis = getComponent(state, entityId, ComponentType.Nemesis) !== undefined;
    const isHostile = attitude !== undefined && attitude.attitude === 'hostile';

    if (isHostile || isNemesis) visible.push(entityId);
  }

  return visible;
}

/**
 * Transition handling to move entities between area instances, saving the current area state and unpacking the destination map.
 */
export function processChangeAreaIntent(
  state: GameState,
  intent: ChangeAreaIntent
): { state: GameState; success: boolean } {
  const { targetAreaId, targetX, targetY, entityId } = intent;

  // 1. Determine which entities migrate with the player (inventory, equipment, shop)
  const migratingEntities = new Set<EntityId>(collectOwnedEntityIds(state, entityId));

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
      .spatialIndex,
    rooms: state.activeRooms ?? [],
    lastSpawnTurn: state.lastSpawnTurn ?? 0,
    lastVisitedTurn: state.globalTurn ?? 0
  };

  const nextAreas = new Map(state.areas);
  nextAreas.set(state.currentAreaId, currentAreaData);

  // 2. Load or generate target floor
  let targetMap: GameMap;
  let nextEntities: ReadonlyArray<EntityId> = [];
  let nextComponents = new Map<EntityId, Readonly<Record<string, Component>>>();
  let spawnX: number = targetX ?? -1;
  let spawnY: number = targetY ?? -1;
  let targetRooms: ReadonlyArray<RoomBounds> = [];
  let targetLastSpawnTurn: number = 0;

  const savedTargetArea = nextAreas.get(targetAreaId);

  if (savedTargetArea !== undefined) {
    targetMap = savedTargetArea.map;
    nextEntities = [...savedTargetArea.entities];
    nextComponents = new Map(savedTargetArea.components);
    targetRooms = savedTargetArea.rooms ?? [];
    targetLastSpawnTurn = savedTargetArea.lastSpawnTurn ?? 0;

    // Delta Catch-Up on Area Wake
    const lastVisited = savedTargetArea.lastVisitedTurn ?? savedTargetArea.lastSpawnTurn ?? 0;
    const deltaTurns = Math.max(0, (state.globalTurn ?? 0) - lastVisited);
    if (deltaTurns > 0) {
      targetLastSpawnTurn = Math.min(state.globalTurn ?? 0, targetLastSpawnTurn + deltaTurns);
    }

    const wakeResult = wakeSavedAreaFloor(
      state,
      targetAreaId,
      targetMap,
      targetRooms,
      nextEntities,
      nextComponents,
      nextPersistentEntities,
      targetLastSpawnTurn
    );
    state = wakeResult.state;
    nextEntities = wakeResult.nextEntities;
    nextComponents = wakeResult.nextComponents;
    targetLastSpawnTurn = wakeResult.targetLastSpawnTurn;

    // Find the corresponding stairs
    let foundStairs = false;
    for (const id of nextEntities) {
      const portal = nextComponents.get(id)?.[ComponentType.Portal] as PortalComponent | undefined;
      if (portal && portal.targetAreaId === state.currentAreaId) {
        const pos = nextComponents.get(id)?.[ComponentType.Position] as PositionComponent | undefined;
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
    const genResult = generateAndPopulateAreaFloor(state, targetAreaId, spawnX, spawnY, nextPersistentEntities);
    targetMap = genResult.targetMap;
    targetRooms = genResult.targetRooms;
    targetLastSpawnTurn = genResult.targetLastSpawnTurn;
    spawnX = genResult.spawnX;
    spawnY = genResult.spawnY;
    nextEntities = genResult.nextEntities;
    nextComponents = genResult.nextComponents;
  }

  // Wake up persistent entities that belong to the target area
  const nextEntitiesArray = [...nextEntities];
  for (const [id, record] of nextPersistentEntities.entries()) {
    if (record.areaId === targetAreaId) {
      const nemesis = record.components[ComponentType.Nemesis] as NemesisComponent | undefined;
      if (nemesis && nemesis.returnDelay !== undefined && nemesis.returnDelay > 0) {
        continue;
      }
      nextEntitiesArray.push(id);
      nextComponents.set(id, record.components);
      nextPersistentEntities.delete(id);
    }
  }
  nextEntities = nextEntitiesArray;

  // 3. Move Player, their owned items, and linked companions
  const migratingArray = Array.from(migratingEntities);
  nextEntities = [...migratingArray, ...nextEntities];

  const occupiedTileKeys = new Set<string>([`${spawnX},${spawnY}`]);
  const candidateOffsets = [
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: -1, y: 0 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 }
  ];

  for (const id of migratingArray) {
    let comps = state.components.get(id) ?? {};
    if (id === entityId) {
      comps = {
        ...comps,
        [ComponentType.Position]: { ...(comps[ComponentType.Position] as PositionComponent), x: spawnX, y: spawnY }
      };
    } else if (comps[ComponentType.ControllerLink] !== undefined && comps[ComponentType.Position] !== undefined) {
      let placed = false;
      for (const off of candidateOffsets) {
        const cx = spawnX + off.x;
        const cy = spawnY + off.y;
        const cKey = `${cx},${cy}`;
        if (cx >= 0 && cx < targetMap.width && cy >= 0 && cy < targetMap.height) {
          const tile = targetMap.tiles[cy * targetMap.width + cx];
          const tileDef = tile ? state.campaign.tiles[tile.tileId] : undefined;
          if (tile && tileDef?.walkable !== false && !occupiedTileKeys.has(cKey)) {
            occupiedTileKeys.add(cKey);
            comps = {
              ...comps,
              [ComponentType.Position]: { ...(comps[ComponentType.Position] as PositionComponent), x: cx, y: cy }
            };
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        comps = {
          ...comps,
          [ComponentType.Position]: { ...(comps[ComponentType.Position] as PositionComponent), x: spawnX, y: spawnY }
        };
      }
    }
    nextComponents.set(id, comps);
  }

  let nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    map: targetMap,
    currentAreaId: targetAreaId,
    activeRooms: targetRooms,
    lastSpawnTurn: targetLastSpawnTurn,
    areas: nextAreas,
    persistentEntities: nextPersistentEntities,
    fovNeedsUpdate: true,
    cachedFov: new Set()
  };

  nextState = updateSpatialIndex(nextState);
  nextState = deliverPendingKnowledgeToArea(nextState, targetAreaId);

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
