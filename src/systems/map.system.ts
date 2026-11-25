import { collectOwnedEntityIds, getComponent, queryEntities, updateSpatialIndex } from '../core/ecs.ts';
import { computeFOV } from '../map/fov.ts';
import {
  getMapCenterFallbackCoord,
  getTileIdAt,
  isInMapBounds,
  isTileKeyInFov,
  markTilesExplored
} from '../map/map_accessor.ts';
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
import { addMessage, MessageLogCategory } from './message.system.ts';
import type { ChangeAreaIntent } from '../types/intents/movement.intents.ts';
import { addActor, resetSchedulerActors } from '../core/scheduler.ts';
import { deliverPendingKnowledgeToArea } from './knowledge.system.ts';
import { wakeSavedAreaFloor } from './map/map_wake_respawn.ts';
import { generateAndPopulateAreaFloor } from './map/map_generation_spawner.ts';
import { updateStreamingWorldWindow } from './map/chunk_streaming.ts';
import { materializeMacroSitesForArea } from './map/site_materializer.ts';
import { flushDirtyChunksToStore } from '../core/chunk_store.ts';
import { processQuestEvent } from './quest.system.ts';
import { applyAnalyticalActiveGridCatchUp } from './physics/chunk_catchup.ts';
import { tickTimedTerrainReverts } from './construction.system.ts';

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

  const visibleIndices: Set<number> = computeFOV(state, playerPos.x, playerPos.y, undefined, playerPos.z ?? 0);
  const nextMap = markTilesExplored(state.map, visibleIndices);

  return {
    ...state,
    fovNeedsUpdate: false,
    cachedFov: visibleIndices,
    map: nextMap
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

    if (!isTileKeyInFov(state, position.x, position.y, position.z ?? 0)) continue;

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
  const { targetAreaId, targetX, targetY, targetZ, entityId } = intent;

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
  if (state.map.chunkGrid !== undefined) {
    void flushDirtyChunksToStore(state);
  }

  // 2. Load or generate target floor
  let targetMap: GameMap;
  let nextEntities: ReadonlyArray<EntityId> = [];
  let nextComponents = new Map<EntityId, Readonly<Record<string, Component>>>();
  let spawnX: number = targetX ?? -1;
  let spawnY: number = targetY ?? -1;
  let spawnZ: number = targetZ ?? 0;
  let targetRooms: ReadonlyArray<RoomBounds> = [];
  let targetLastSpawnTurn: number = 0;
  let nextEntityId: number = state.nextEntityId;
  let nextItemInstanceId: number = state.nextItemInstanceId;

  const savedTargetArea = nextAreas.get(targetAreaId);

  if (savedTargetArea !== undefined) {
    targetMap = savedTargetArea.map;
    nextEntities = [...savedTargetArea.entities];
    nextComponents = new Map(savedTargetArea.components);
    targetRooms = savedTargetArea.rooms ?? [];
    targetLastSpawnTurn = savedTargetArea.lastSpawnTurn ?? 0;

    const wakeResult = wakeSavedAreaFloor(
      state,
      targetAreaId,
      targetMap,
      targetRooms,
      nextEntities,
      nextComponents,
      nextPersistentEntities,
      targetLastSpawnTurn,
      nextAreas
    );
    state = wakeResult.state;
    nextEntities = wakeResult.nextEntities;
    nextComponents = wakeResult.nextComponents;
    targetLastSpawnTurn = wakeResult.targetLastSpawnTurn;
    nextEntityId = state.nextEntityId;
    nextItemInstanceId = state.nextItemInstanceId;

    // Find the corresponding stairs
    let foundStairs = false;
    for (const id of nextEntities) {
      const portal = nextComponents.get(id)?.[ComponentType.Portal] as PortalComponent | undefined;
      if (portal && portal.targetAreaId === state.currentAreaId) {
        const pos = nextComponents.get(id)?.[ComponentType.Position] as PositionComponent | undefined;
        if (pos && spawnX === -1) {
          spawnX = pos.x;
          spawnY = pos.y;
          if (targetZ === undefined) {
            spawnZ = pos.z ?? 0;
          }
          foundStairs = true;
          break;
        }
      }
    }

    if (!foundStairs && spawnX === -1 && targetMap.chunkGrid !== undefined) {
      for (const records of Object.values(targetMap.chunkGrid.evictedChunkEntities)) {
        for (const rec of records) {
          const portal = rec.components[ComponentType.Portal] as PortalComponent | undefined;
          if (portal && portal.targetAreaId === state.currentAreaId) {
            const pos = rec.components[ComponentType.Position] as PositionComponent | undefined;
            if (pos) {
              spawnX = pos.x;
              spawnY = pos.y;
              if (targetZ === undefined) {
                spawnZ = pos.z ?? 0;
              }
              foundStairs = true;
              break;
            }
          }
        }
        if (foundStairs) break;
      }
    }

    if (!foundStairs && spawnX === -1) {
      const center = getMapCenterFallbackCoord(targetMap);
      spawnX = center.x;
      spawnY = center.y;
      if (targetZ === undefined) {
        spawnZ = center.z;
      }
    }
  } else {
    const genResult = generateAndPopulateAreaFloor(
      state,
      targetAreaId,
      spawnX,
      spawnY,
      nextPersistentEntities,
      nextAreas,
      spawnZ,
      targetZ !== undefined
    );
    targetMap = genResult.targetMap;
    targetRooms = genResult.targetRooms;
    targetLastSpawnTurn = genResult.targetLastSpawnTurn;
    spawnX = genResult.spawnX;
    spawnY = genResult.spawnY;
    spawnZ = genResult.spawnZ;
    nextEntities = genResult.nextEntities;
    nextComponents = genResult.nextComponents;
    nextEntityId = genResult.nextEntityId;
    nextItemInstanceId = genResult.nextItemInstanceId;
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

  const occupiedTileKeys = new Set<string>([`${spawnX},${spawnY},${spawnZ}`]);
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
      const prevPos = comps[ComponentType.Position] as PositionComponent | undefined;
      const updatedPos: PositionComponent = {
        ...prevPos,
        type: ComponentType.Position,
        x: spawnX,
        y: spawnY
      };
      if (spawnZ !== 0) {
        comps = { ...comps, [ComponentType.Position]: { ...updatedPos, z: spawnZ } };
      } else {
        const { z: _removedZ, ...restPos } = updatedPos;
        comps = { ...comps, [ComponentType.Position]: restPos };
      }
    } else if (comps[ComponentType.ControllerLink] !== undefined && comps[ComponentType.Position] !== undefined) {
      let placed = false;
      for (const off of candidateOffsets) {
        const cx = spawnX + off.x;
        const cy = spawnY + off.y;
        const cKey = `${cx},${cy},${spawnZ}`;
        if (isInMapBounds(targetMap, cx, cy, spawnZ)) {
          const tileId = getTileIdAt(targetMap, cx, cy, spawnZ);
          const tileDef = tileId ? state.campaign.tiles[tileId] : undefined;
          if (tileId && tileDef?.walkable !== false && !occupiedTileKeys.has(cKey)) {
            occupiedTileKeys.add(cKey);
            const prevCompPos = comps[ComponentType.Position] as PositionComponent;
            const nextCompPos: PositionComponent = {
              ...prevCompPos,
              x: cx,
              y: cy
            };
            if (spawnZ !== 0) {
              comps = { ...comps, [ComponentType.Position]: { ...nextCompPos, z: spawnZ } };
            } else {
              const { z: _removedZ, ...restPos } = nextCompPos;
              comps = { ...comps, [ComponentType.Position]: restPos };
            }
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        const prevCompPos = comps[ComponentType.Position] as PositionComponent;
        const nextCompPos: PositionComponent = {
          ...prevCompPos,
          x: spawnX,
          y: spawnY
        };
        if (spawnZ !== 0) {
          comps = { ...comps, [ComponentType.Position]: { ...nextCompPos, z: spawnZ } };
        } else {
          const { z: _removedZ, ...restPos } = nextCompPos;
          comps = { ...comps, [ComponentType.Position]: restPos };
        }
      }
    }
    nextComponents.set(id, comps);
  }

  let nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    map: targetMap,
    nextEntityId,
    nextItemInstanceId,
    currentAreaId: targetAreaId,
    activeRooms: targetRooms,
    lastSpawnTurn: targetLastSpawnTurn,
    areas: nextAreas,
    persistentEntities: nextPersistentEntities,
    cameraZOffset: 0,
    fovNeedsUpdate: true,
    cachedFov: new Set()
  };

  nextState = updateSpatialIndex(nextState);
  if (savedTargetArea?.lastVisitedTurn !== undefined && nextState.globalTurn > savedTargetArea.lastVisitedTurn) {
    nextState = applyAnalyticalActiveGridCatchUp(nextState, nextState.globalTurn - savedTargetArea.lastVisitedTurn);
  }
  nextState = tickTimedTerrainReverts(nextState);
  if (nextState.map.chunkGrid !== undefined) {
    nextState = updateStreamingWorldWindow(nextState, spawnX, spawnY, { anchorZ: spawnZ });
  } else {
    nextState = materializeMacroSitesForArea(nextState, targetAreaId);
  }
  nextState = deliverPendingKnowledgeToArea(nextState, targetAreaId);

  // 4. Update Scheduler
  resetSchedulerActors();
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

  if (getComponent(nextState, entityId, ComponentType.Player)) {
    nextState = processQuestEvent(nextState, 'explore', targetAreaId, 1);
  }

  return { state: updateExploredTiles(nextState), success: true };
}
