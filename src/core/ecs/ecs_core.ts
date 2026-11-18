import { type Component, ComponentType, type MemoryComponent } from '../../types/components.types.ts';
import { type EntityId, type GameState, toEntityId } from '../../types/game-state.types.ts';

/**
 * Creates a new entity in the game state, returning the updated state and the new entity's ID.
 * @param state The current game state.
 * @returns A tuple of the updated game state and the newly created EntityId.
 */
export function createEntity(state: GameState): [GameState, EntityId] {
  const newId: EntityId = toEntityId(state.nextEntityId);

  const nextEntities: ReadonlyArray<EntityId> = [...state.entities, newId];

  const nextComponents: Map<EntityId, Readonly<Record<string, Component>>> = new Map(state.components);
  nextComponents.set(newId, {});

  const nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    nextEntityId: state.nextEntityId + 1
  };

  return [nextState, newId];
}

/**
 * Rebuilds the spatial index by scanning all entities for Position components.
 * @param state The current game state.
 * @returns The updated game state with the new spatial index.
 */
export function updateSpatialIndex(state: GameState): GameState {
  const newIndex = new Map<string, EntityId[]>();
  for (const entityId of state.entities) {
    const pos = getComponent(state, entityId, ComponentType.Position);
    if (pos !== undefined) {
      const footprintWidth = Math.max(1, pos.footprintWidth ?? 1);
      const footprintHeight = Math.max(1, pos.footprintHeight ?? 1);
      for (let dy = 0; dy < footprintHeight; dy++) {
        for (let dx = 0; dx < footprintWidth; dx++) {
          const key = `${pos.x + dx},${pos.y + dy}`;
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
  }
  return {
    ...state,
    spatialIndex: newIndex
  };
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

  const nextComponents = new Map(state.components);
  nextComponents.set(entityId, { ...entityComponents, [component.type]: component });

  const nextState = {
    ...state,
    components: nextComponents
  };

  if (component.type === ComponentType.Position) {
    return updateSpatialIndex(nextState);
  }

  return nextState;
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
  if (!entityComponents) return state;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [type]: removed, ...rest } = entityComponents;

  const nextComponents = new Map(state.components);
  nextComponents.set(entityId, rest);

  const nextState = { ...state, components: nextComponents };

  if (type === (ComponentType.Position as ComponentType)) {
    return updateSpatialIndex(nextState);
  }

  return nextState;
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
  const nextEntities = state.entities.filter((id) => id !== entityId);
  const nextComponents = new Map(state.components);
  nextComponents.delete(entityId);

  return updateSpatialIndex({
    ...state,
    entities: nextEntities,
    components: nextComponents
  });
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
