import type { Component, ComponentType } from '../types/components.types.ts';
import { type EntityId, type GameState, toEntityId } from '../types/game-state.types.ts';

/**
 * Creates a new entity in the game state, returning the updated state and the new entity's ID.
 * @param state The current game state.
 * @returns A tuple of the updated game state and the newly created EntityId.
 */
export function createEntity(state: GameState): [GameState, EntityId] {
  const newId: EntityId = toEntityId(state.nextEntityId);
  
  const nextEntities: ReadonlyArray<EntityId> = [...state.entities, newId];
  
  const nextComponents: Map<EntityId, ReadonlyArray<Component>> = new Map(state.components);
  nextComponents.set(newId, []);
  
  const nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    nextEntityId: state.nextEntityId + 1,
  };
  
  return [nextState, newId];
}

/**
 * Attaches a component to an entity in the game state.
 * @param state The current game state.
 * @param entityId The target EntityId to add the component to.
 * @param component The Component to add.
 * @returns The updated game state.
 */
export function addComponent<C extends Component>(
  state: GameState,
  entityId: EntityId,
  component: C
): GameState {
  const entityComponents: ReadonlyArray<Component> = state.components.get(entityId) ?? [];
  
  const nextComponents: Map<EntityId, ReadonlyArray<Component>> = new Map(state.components);
  nextComponents.set(entityId, [...entityComponents, component]);
  
  return {
    ...state,
    components: nextComponents,
  };
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
  const entityComponents: ReadonlyArray<Component> | undefined = state.components.get(entityId);
  if (entityComponents === undefined) {
    return undefined;
  }
  
  const match: Component | undefined = entityComponents.find((c: Component) => c.type === type);
  return match as Extract<Component, { readonly type: T }> | undefined;
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
    const entityComponents: ReadonlyArray<Component> | undefined = state.components.get(entityId);
    if (entityComponents === undefined) {
      return false;
    }
    return types.every((type: T) =>
      entityComponents.some((c: Component) => c.type === type)
    );
  });
}
