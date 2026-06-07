import {
  type Component,
  ComponentType,
  type PositionComponent,
  type RenderableComponent,
  type ActorComponent,
  type FighterComponent,
  type AIComponent,
  type PlayerComponent,
  type ItemComponent,
  type InventoryComponent,
  type EquipmentComponent,
  toItemInstanceId
} from '../types/components.types.ts';
import { type EntityId, type GameState, toEntityId } from '../types/game-state.types.ts';
import { ENTITY_TEMPLATES } from '../constants/spawning.constants.ts';
import { ITEM_REGISTRY } from '../constants/items.constants.ts';

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
    nextEntityId: state.nextEntityId + 1
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
export function addComponent<C extends Component>(state: GameState, entityId: EntityId, component: C): GameState {
  const entityComponents: ReadonlyArray<Component> = state.components.get(entityId) ?? [];

  const nextComponents: Map<EntityId, ReadonlyArray<Component>> = new Map(state.components);
  nextComponents.set(entityId, [...entityComponents, component]);

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
 * Rebuilds the spatial index by scanning all entities for Position components.
 * @param state The current game state.
 * @returns The updated game state with the new spatial index.
 */
export function updateSpatialIndex(state: GameState): GameState {
  const newIndex = new Map<string, EntityId[]>();
  for (const entityId of state.entities) {
    const pos = getComponent(state, entityId, ComponentType.Position);
    if (pos !== undefined) {
      const key = `${pos.x},${pos.y}`;
      let arr = newIndex.get(key);
      if (!arr) {
        arr = [];
        newIndex.set(key, arr);
      }
      arr.push(entityId);
    }
  }
  return {
    ...state,
    spatialIndex: newIndex
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
    return types.every((type: T) => entityComponents.some((c: Component) => c.type === type));
  });
}

/**
 * Spawns an entity from a template at the given coordinates.
 * @param state The current game state.
 * @param templateId The ID of the template from ENTITY_TEMPLATES.
 * @param x The map X coordinate.
 * @param y The map Y coordinate.
 * @returns A tuple of the updated state and the new EntityId.
 */
export function spawnEntity(state: GameState, templateId: string, x: number, y: number): [GameState, EntityId] {
  const template = ENTITY_TEMPLATES[templateId];
  if (!template) throw new Error(`Unknown entity template: ${templateId}`);

  const [stateAfterCreate, entityId] = createEntity(state);
  let nextState = stateAfterCreate;

  const pos: PositionComponent = { type: ComponentType.Position, x, y };
  const render: RenderableComponent = {
    type: ComponentType.Renderable,
    glyph: template.glyph,
    fg: template.fg,
    bg: template.bg
  };

  nextState = addComponent(nextState, entityId, pos);
  nextState = addComponent(nextState, entityId, render);

  if (template.isActor) {
    const actor: ActorComponent = { type: ComponentType.Actor, speed: template.speed ?? 100 };
    nextState = addComponent(nextState, entityId, actor);
  }

  if (template.fighter) {
    const fighter: FighterComponent = {
      type: ComponentType.Fighter,
      maxHp: template.fighter.maxHp,
      hp: template.fighter.maxHp,
      attack: template.fighter.attack,
      defense: template.fighter.defense
    };
    nextState = addComponent(nextState, entityId, fighter);
  }

  if (template.ai) {
    const ai: AIComponent = { type: ComponentType.AI, behavior: template.ai.behavior };
    nextState = addComponent(nextState, entityId, ai);
  }

  if (templateId === 'player') {
    const player: PlayerComponent = { type: ComponentType.Player };
    nextState = addComponent(nextState, entityId, player);

    // Attach Inventory and Equipment components to the player
    const template = ENTITY_TEMPLATES[templateId];
    const inventoryCmp: InventoryComponent = {
      type: ComponentType.Inventory,
      items: [],
      baseCapacity: template?.inventoryConfig?.baseCapacity ?? 10
    };
    const equipmentCmp: EquipmentComponent = {
      type: ComponentType.Equipment,
      weapon: null,
      armor: null
    };
    nextState = addComponent(nextState, entityId, inventoryCmp);
    nextState = addComponent(nextState, entityId, equipmentCmp);
  }

  return [nextState, entityId];
}

/**
 * Spawns an item entity on the map from an ITEM_REGISTRY definition.
 * Creates the entity with Position, Renderable, and Item components.
 * @param state The current game state.
 * @param itemId The ID of the item definition in ITEM_REGISTRY.
 * @param x The map X coordinate.
 * @param y The map Y coordinate.
 * @returns A tuple of the updated state and the new EntityId.
 */
export function spawnItem(state: GameState, itemId: string, x: number, y: number): [GameState, EntityId] {
  const def = ITEM_REGISTRY[itemId];
  if (!def) throw new Error(`Unknown item ID: ${itemId}`);

  const [stateAfterCreate, entityId] = createEntity(state);
  let nextState = stateAfterCreate;

  const pos: PositionComponent = { type: ComponentType.Position, x, y };
  const render: RenderableComponent = {
    type: ComponentType.Renderable,
    glyph: def.glyph,
    fg: def.fg,
    bg: def.bg
  };
  const instanceId = toItemInstanceId(`${itemId}_${nextState.nextItemInstanceId}`);
  const item: ItemComponent = {
    type: ComponentType.Item,
    itemId: def.id,
    instanceId,
    identified: true, // M8: change to false for unidentified items
    ...(def.consumable !== undefined ? { charges: def.consumable.charges } : {})
  };

  nextState = addComponent(nextState, entityId, pos);
  nextState = addComponent(nextState, entityId, render);
  nextState = addComponent(nextState, entityId, item);
  nextState = { ...nextState, nextItemInstanceId: nextState.nextItemInstanceId + 1 };

  return [nextState, entityId];
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
