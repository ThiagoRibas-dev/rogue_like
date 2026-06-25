import type { GameState, EntityId } from '../../types/game-state.types.ts';
import {
  ComponentType,
  type Component,
  type NemesisComponent,
  type PositionComponent
} from '../../types/components.types.ts';
import { getComponent, updateSpatialIndex } from '../../core/ecs.ts';
import type { NemesisInfo } from '../../types/rivalry.types.ts';

/**
 * Searches active entities, persistent limbo, and inactive area data to locate the components of a given entity.
 * @param state The current global game state.
 * @param entityId The ID of the target entity.
 * @returns The location and components map if found, undefined otherwise.
 */
export function findNemesisComponents(
  state: GameState,
  entityId: EntityId
):
  | {
      readonly location: 'active' | 'persistent' | 'area';
      readonly areaId?: string;
      readonly components: Record<string, Component>;
    }
  | undefined {
  // 1. Check active entities
  const activeComps = state.components.get(entityId);
  if (activeComps) {
    return { location: 'active', components: activeComps };
  }

  // 2. Check persistent entities
  const persistentRecord = state.persistentEntities.get(entityId);
  if (persistentRecord) {
    return { location: 'persistent', components: persistentRecord.components };
  }

  // 3. Check areas
  for (const [areaId, areaData] of state.areas.entries()) {
    const areaComps = areaData.components.get(entityId);
    if (areaComps) {
      return { location: 'area', areaId, components: areaComps };
    }
  }

  return undefined;
}

/**
 * Updates the components of an entity wherever it resides in the game state.
 * @param state The current global game state.
 * @param entityId The ID of the entity to update.
 * @param updater The function that mutates/replaces component mappings.
 * @returns The updated global game state.
 */
export function updateNemesisComponents(
  state: GameState,
  entityId: EntityId,
  updater: (components: Record<string, Component>) => Record<string, Component>
): GameState {
  // 1. Check active entities
  if (state.components.has(entityId)) {
    const activeComps = state.components.get(entityId) ?? {};
    const nextComps = new Map(state.components);
    nextComps.set(entityId, updater(activeComps));
    return {
      ...state,
      components: nextComps
    };
  }

  // 2. Check persistent entities
  if (state.persistentEntities.has(entityId)) {
    const record = state.persistentEntities.get(entityId)!;
    const nextPersistent = new Map(state.persistentEntities);
    nextPersistent.set(entityId, {
      ...record,
      components: updater(record.components)
    });
    return {
      ...state,
      persistentEntities: nextPersistent
    };
  }

  // 3. Check areas
  for (const [areaId, areaData] of state.areas.entries()) {
    if (areaData.components.has(entityId)) {
      const areaComps = areaData.components.get(entityId) ?? {};
      const nextAreaComponents = new Map(areaData.components);
      nextAreaComponents.set(entityId, updater(areaComps));

      const nextAreas = new Map(state.areas);
      nextAreas.set(areaId, {
        ...areaData,
        components: nextAreaComponents
      });
      return {
        ...state,
        areas: nextAreas
      };
    }
  }

  return state;
}

/**
 * Removes an entity completely from the game state (active entities, persistent registry, or inactive floors).
 * @param state The current global game state.
 * @param entityId The ID of the entity to delete.
 * @returns The updated global game state.
 */
export function removeNemesisEntity(state: GameState, entityId: EntityId): GameState {
  let nextState = state;

  // 1. Remove from active entities
  if (nextState.entities.includes(entityId)) {
    nextState = {
      ...nextState,
      entities: nextState.entities.filter((id) => id !== entityId)
    };
    const nextComponents = new Map(nextState.components);
    nextComponents.delete(entityId);
    nextState = {
      ...nextState,
      components: nextComponents
    };
    nextState = updateSpatialIndex(nextState);
  }

  // 2. Remove from persistent entities
  if (nextState.persistentEntities.has(entityId)) {
    const nextPersistent = new Map(nextState.persistentEntities);
    nextPersistent.delete(entityId);
    nextState = {
      ...nextState,
      persistentEntities: nextPersistent
    };
  }

  // 3. Remove from other areas
  let modifiedArea = false;
  const nextAreas = new Map(nextState.areas);
  for (const [areaId, areaData] of nextState.areas.entries()) {
    if (areaData.entities.includes(entityId)) {
      const nextAreaEntities = areaData.entities.filter((id) => id !== entityId);
      const nextAreaComponents = new Map(areaData.components);
      nextAreaComponents.delete(entityId);

      const nextSpatialIndex = new Map<string, EntityId[]>();
      for (const id of nextAreaEntities) {
        const pos = nextAreaComponents.get(id)?.[ComponentType.Position] as PositionComponent | undefined;
        if (pos) {
          const key = `${pos.x},${pos.y}`;
          let arr = nextSpatialIndex.get(key);
          if (!arr) {
            arr = [];
            nextSpatialIndex.set(key, arr);
          }
          arr.push(id);
        }
      }

      nextAreas.set(areaId, {
        ...areaData,
        entities: nextAreaEntities,
        components: nextAreaComponents,
        spatialIndex: nextSpatialIndex
      });
      modifiedArea = true;
    }
  }

  if (modifiedArea) {
    nextState = {
      ...nextState,
      areas: nextAreas
    };
  }

  return nextState;
}

/**
 * Finds all nemeses registered in the global game state across active, persistent, and inactive areas.
 * @param state The current global game state.
 * @returns A list of brief nemesis information descriptors.
 */
export function findAllNemeses(state: GameState): ReadonlyArray<NemesisInfo> {
  const result: NemesisInfo[] = [];

  // 1. Check active entities
  for (const entityId of state.entities) {
    const nemesis = getComponent(state, entityId, ComponentType.Nemesis) as NemesisComponent | undefined;
    if (nemesis) {
      result.push({
        entityId,
        hierarchyId: nemesis.hierarchyId,
        rankId: nemesis.rankId,
        tier: nemesis.tier
      });
    }
  }

  // 2. Check persistent entities
  for (const [entityId, record] of state.persistentEntities.entries()) {
    const nemesis = record.components[ComponentType.Nemesis] as NemesisComponent | undefined;
    if (nemesis) {
      result.push({
        entityId,
        hierarchyId: nemesis.hierarchyId,
        rankId: nemesis.rankId,
        tier: nemesis.tier
      });
    }
  }

  // 3. Check saved areas
  for (const areaData of state.areas.values()) {
    for (const entityId of areaData.entities) {
      const comps = areaData.components.get(entityId);
      const nemesis = comps?.[ComponentType.Nemesis] as NemesisComponent | undefined;
      if (nemesis) {
        result.push({
          entityId,
          hierarchyId: nemesis.hierarchyId,
          rankId: nemesis.rankId,
          tier: nemesis.tier
        });
      }
    }
  }

  return result;
}
