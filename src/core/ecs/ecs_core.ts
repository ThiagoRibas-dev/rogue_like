import {
  type Component,
  ComponentType,
  type MemoryComponent,
  type PositionComponent
} from '../../types/components.types.ts';
import { type EntityId, type GameState, toEntityId } from '../../types/game-state.types.ts';

import type { DormantChunkEntityRecord } from '../../types/world-chunk.types.ts';
import { toSpatialKey } from '../../utils/grid.ts';

function isEntityInDormantChunkMap(
  evicted: Readonly<Record<string, ReadonlyArray<DormantChunkEntityRecord>>> | undefined,
  id: EntityId
): boolean {
  if (!evicted) return false;
  for (const list of Object.values(evicted)) {
    for (const rec of list) {
      if (rec.entityId === id) return true;
      for (const owned of rec.ownedEntities) {
        if (owned.entityId === id) return true;
      }
    }
  }
  return false;
}

/**
 * Checks whether `id` is already allocated in active components, persistent entities,
 * dormant chunk cold storage, or any saved dormant area floor so stale `nextEntityId` values never collide.
 */
export function isEntityIdInUse(state: Readonly<GameState>, id: EntityId): boolean {
  if (state.components.has(id)) return true;
  if (state.persistentEntities?.has(id)) return true;
  if (isEntityInDormantChunkMap(state.map?.chunkGrid?.evictedChunkEntities, id)) return true;
  if (state.areas) {
    for (const area of state.areas.values()) {
      if (area.components.has(id)) return true;
      if (isEntityInDormantChunkMap(area.map.chunkGrid?.evictedChunkEntities, id)) return true;
    }
  }
  return false;
}

/**
 * Creates a new entity in the game state, returning the updated state and the new entity's ID.
 * @param state The current game state.
 * @returns A tuple of the updated game state and the newly created EntityId.
 */
export function createEntity(state: GameState): [GameState, EntityId] {
  let candidateId = state.nextEntityId;
  let newId: EntityId = toEntityId(candidateId);
  while (isEntityIdInUse(state, newId)) {
    candidateId++;
    newId = toEntityId(candidateId);
  }

  const nextEntities: ReadonlyArray<EntityId> = [...state.entities, newId];

  const nextComponents: Map<EntityId, Readonly<Record<string, Component>>> = new Map(state.components);
  nextComponents.set(newId, {});

  const nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    nextEntityId: candidateId + 1
  };

  return [nextState, newId];
}

function getPositionFootprintKeys(pos: PositionComponent | undefined): ReadonlyArray<string> {
  if (pos === undefined) return [];
  const z = pos.z ?? 0;
  const footprintWidth = Math.max(1, pos.footprintWidth ?? 1);
  const footprintHeight = Math.max(1, pos.footprintHeight ?? 1);
  const footprintDepth = Math.max(1, pos.footprintDepth ?? 1);
  if (footprintWidth === 1 && footprintHeight === 1 && footprintDepth === 1) {
    return [toSpatialKey(pos.x, pos.y, z)];
  }
  const keys: string[] = [];
  for (let dz = 0; dz < footprintDepth; dz++) {
    for (let dy = 0; dy < footprintHeight; dy++) {
      for (let dx = 0; dx < footprintWidth; dx++) {
        keys.push(toSpatialKey(pos.x + dx, pos.y + dy, z + dz));
      }
    }
  }
  return keys;
}

function sameSpatialFootprint(a: PositionComponent | undefined, b: PositionComponent | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.x === b.x &&
    a.y === b.y &&
    (a.z ?? 0) === (b.z ?? 0) &&
    Math.max(1, a.footprintWidth ?? 1) === Math.max(1, b.footprintWidth ?? 1) &&
    Math.max(1, a.footprintHeight ?? 1) === Math.max(1, b.footprintHeight ?? 1) &&
    Math.max(1, a.footprintDepth ?? 1) === Math.max(1, b.footprintDepth ?? 1)
  );
}

/**
 * Incrementally patches a working spatialIndex Map in place with copy-on-write per touched bucket array,
 * ensuring frozen or shared prior-snapshot bucket arrays are never mutated directly.
 *
 * @param workingIndex Mutable working spatial index Map.
 * @param copiedKeys Set of bucket keys already cloned during the current transaction.
 * @param entityId Entity whose spatial footprint changed.
 * @param prevPos Previous PositionComponent (or undefined if newly added).
 * @param nextPos Next PositionComponent (or undefined if removed).
 */
export function patchSpatialIndexInPlace(
  workingIndex: Map<string, ReadonlyArray<EntityId>>,
  copiedKeys: Set<string>,
  entityId: EntityId,
  prevPos: PositionComponent | undefined,
  nextPos: PositionComponent | undefined
): void {
  if (sameSpatialFootprint(prevPos, nextPos)) return;

  for (const oldKey of getPositionFootprintKeys(prevPos)) {
    const existing = workingIndex.get(oldKey);
    if (!existing) continue;
    const filtered = existing.filter((id) => id !== entityId);
    if (filtered.length === 0) {
      workingIndex.delete(oldKey);
      copiedKeys.delete(oldKey);
    } else if (filtered.length !== existing.length) {
      workingIndex.set(oldKey, filtered);
      copiedKeys.add(oldKey);
    }
  }

  for (const newKey of getPositionFootprintKeys(nextPos)) {
    const existing = workingIndex.get(newKey);
    if (!existing) {
      workingIndex.set(newKey, [entityId]);
      copiedKeys.add(newKey);
      continue;
    }
    if (existing.includes(entityId)) continue;
    if (copiedKeys.has(newKey)) {
      (existing as EntityId[]).push(entityId);
    } else {
      workingIndex.set(newKey, [...existing, entityId]);
      copiedKeys.add(newKey);
    }
  }
}

/**
 * Incrementally patches `spatialIndex` for a single entity's previous vs. next `PositionComponent` in O(k).
 *
 * @param spatialIndex Current spatial index Map.
 * @param entityId Target EntityId.
 * @param prevPos Previous PositionComponent or undefined.
 * @param nextPos Next PositionComponent or undefined.
 * @returns Updated spatial index Map (or the original reference if unchanged).
 */
export function patchSpatialIndexForEntity(
  spatialIndex: ReadonlyMap<string, ReadonlyArray<EntityId>>,
  entityId: EntityId,
  prevPos: PositionComponent | undefined,
  nextPos: PositionComponent | undefined
): ReadonlyMap<string, ReadonlyArray<EntityId>> {
  if (sameSpatialFootprint(prevPos, nextPos)) {
    return spatialIndex;
  }
  const nextIndex = new Map<string, ReadonlyArray<EntityId>>(spatialIndex);
  const copiedKeys = new Set<string>();
  patchSpatialIndexInPlace(nextIndex, copiedKeys, entityId, prevPos, nextPos);
  return nextIndex;
}

/**
 * Rebuilds the spatial index by scanning all entities for Position components.
 * Reserved for full save rehydration and area transitions.
 * @param state The current game state.
 * @returns The updated game state with the new spatial index.
 */
export function updateSpatialIndex(state: GameState): GameState {
  const newIndex = new Map<string, EntityId[]>();
  for (const entityId of state.entities) {
    const pos = getComponent(state, entityId, ComponentType.Position);
    if (pos !== undefined) {
      for (const key of getPositionFootprintKeys(pos)) {
        let arr = newIndex.get(key);
        if (!arr) {
          arr = [];
          newIndex.set(key, arr);
        }
        if (!arr.includes(entityId)) {
          arr.push(entityId);
        }
      }
    }
  }
  return {
    ...state,
    spatialIndex: newIndex
  };
}

/**
 * Queries entities occupying the given 3D grid coordinate via the uniform 3D spatial index.
 * @param state The current game state.
 * @param x The map X coordinate.
 * @param y The map Y coordinate.
 * @param z The map Z coordinate (defaults to 0).
 * @returns Read-only array of EntityIds at `(x, y, z)`.
 */
export function getEntitiesAtPosition(state: GameState, x: number, y: number, z = 0): ReadonlyArray<EntityId> {
  return state.spatialIndex.get(toSpatialKey(x, y, z)) ?? [];
}

/**
 * Attaches a component to an entity in the game state.
 * @param state The current game state.
 * @param entityId The target EntityId to add the component to.
 * @param component The Component to add.
 * @returns The updated game state.
 */
export function addComponent<C extends Component>(state: GameState, entityId: EntityId, component: C): GameState {
  const entityComponents = state.components.get(entityId) ?? {};
  const prevPos =
    component.type === ComponentType.Position
      ? (entityComponents[ComponentType.Position] as PositionComponent | undefined)
      : undefined;

  const nextComponents = new Map(state.components);
  nextComponents.set(entityId, { ...entityComponents, [component.type]: component });

  const nextSpatialIndex =
    component.type === ComponentType.Position
      ? patchSpatialIndexForEntity(state.spatialIndex, entityId, prevPos, component)
      : state.spatialIndex;

  return {
    ...state,
    components: nextComponents,
    spatialIndex: nextSpatialIndex
  };
}

/**
 * Removes a component of a specific type from an entity.
 * @param state The current game state.
 * @param entityId The EntityId to modify.
 * @param type The ComponentType to remove.
 * @returns The updated game state.
 */
export function removeComponent<T extends ComponentType>(state: GameState, entityId: EntityId, type: T): GameState {
  const entityComponents = state.components.get(entityId);
  if (!entityComponents || entityComponents[type] === undefined) return state;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [type]: removed, ...rest } = entityComponents;

  const nextComponents = new Map(state.components);
  nextComponents.set(entityId, rest);

  const prevPos =
    type === (ComponentType.Position as ComponentType) ? (removed as PositionComponent | undefined) : undefined;
  const nextSpatialIndex =
    prevPos !== undefined
      ? patchSpatialIndexForEntity(state.spatialIndex, entityId, prevPos, undefined)
      : state.spatialIndex;

  return { ...state, components: nextComponents, spatialIndex: nextSpatialIndex };
}

/**
 * Retrieves a component of a specific type from an entity.
 * @param state The current game state.
 * @param entityId The EntityId to inspect.
 * @param type The ComponentType to search for.
 * @returns The matching Component, or undefined if not found.
 */
export function getComponent<T extends ComponentType>(
  state: GameState,
  entityId: EntityId,
  type: T
): Extract<Component, { readonly type: T }> | undefined {
  const entityComponents = state.components.get(entityId);
  if (entityComponents === undefined) {
    return undefined;
  }

  return entityComponents[type] as Extract<Component, { readonly type: T }> | undefined;
}

/**
 * Queries all entities that possess all of the requested component types.
 * @param state The current game state.
 * @param types The list of ComponentTypes that entities must have.
 * @returns An array of EntityIds that match the query.
 */
export function queryEntities<T extends ComponentType>(
  state: GameState,
  types: ReadonlyArray<T>
): ReadonlyArray<EntityId> {
  return state.entities.filter((entityId: EntityId) => {
    const entityComponents = state.components.get(entityId);
    if (entityComponents === undefined) {
      return false;
    }
    return types.every((type: T) => entityComponents[type] !== undefined);
  });
}

/**
 * Completely removes an entity and all its components from the game state.
 * @param state The current game state.
 * @param entityId The ID of the entity to remove.
 * @returns The updated game state.
 */
export function removeEntity(state: GameState, entityId: EntityId): GameState {
  const prevPos = getComponent(state, entityId, ComponentType.Position);
  const nextEntities = state.entities.filter((id) => id !== entityId);
  const nextComponents = new Map(state.components);
  nextComponents.delete(entityId);

  return {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    spatialIndex:
      prevPos !== undefined
        ? patchSpatialIndexForEntity(state.spatialIndex, entityId, prevPos, undefined)
        : state.spatialIndex
  };
}

/**
 * Resolves the human-readable display name for any entity or item reactively from its ECS components
 * using the strict fallback hierarchy: Name -> ID -> Icon (glyph) -> fallback.
 *
 * @param state The current GameState.
 * @param entityId The target entity ID.
 * @param fallback Optional fallback label if the entity has no name, ID, or glyph.
 * @returns The resolved display name string.
 */
export function resolveEntityDisplayName(state: GameState, entityId: EntityId, fallback?: string): string {
  const compMap = state.components.get(entityId) ?? state.persistentEntities?.get(entityId)?.components;
  const readComp = <T extends ComponentType>(type: T): Extract<Component, { readonly type: T }> | undefined =>
    compMap?.[type] as Extract<Component, { readonly type: T }> | undefined;

  const identity = readComp(ComponentType.Identity);
  if (identity && identity.name.trim().length > 0) {
    return `${identity.name} ${identity.title ?? ''}`.trim();
  }

  const item = readComp(ComponentType.Item);
  if (item) {
    const itemDef = state.campaign.items[item.itemId];
    const isIdentified = state.identifiedItems.has(item.itemId);
    const resolvedItemName = isIdentified
      ? itemDef?.name
      : (state.itemUnidentifiedNames.get(item.itemId) ?? itemDef?.unidentifiedName);
    if (resolvedItemName && resolvedItemName.trim().length > 0) {
      return resolvedItemName;
    }
    if (item.itemId.trim().length > 0) {
      return item.itemId;
    }
  }

  const field = readComp(ComponentType.Field);
  if (field) {
    const fieldName = state.campaign.fields[field.fieldType]?.name;
    if (fieldName && fieldName.trim().length > 0) {
      return fieldName;
    }
    if (field.fieldType.trim().length > 0) {
      return field.fieldType;
    }
  }

  const template = readComp(ComponentType.Template);
  if (template) {
    const templateDef = state.campaign.entities[template.templateId];
    if (templateDef?.name && templateDef.name.trim().length > 0) {
      return templateDef.name;
    }
    if (template.templateId.trim().length > 0) {
      return template.templateId;
    }
  }

  if (readComp(ComponentType.Player) !== undefined) {
    return 'Adventurer';
  }

  const portal = readComp(ComponentType.Portal);
  if (portal) {
    const targetAreaName = state.campaign.areas[portal.targetAreaId]?.name ?? portal.targetAreaId;
    return `Passage (${targetAreaName})`;
  }

  const renderable = readComp(ComponentType.Renderable);
  if (renderable && renderable.glyph.trim().length > 0) {
    return renderable.glyph;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  return readComp(ComponentType.Actor) !== undefined ? 'Actor' : 'Feature';
}

/**
 * Returns an initialized default `MemoryComponent` for players, merchants, and dialogue NPCs.
 */
export function createDefaultMemoryComponent(): MemoryComponent {
  return {
    type: ComponentType.Memory,
    factionStandings: {},
    grudges: [],
    facts: [],
    knowledge: {}
  };
}
