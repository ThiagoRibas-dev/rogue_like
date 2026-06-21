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
  type QuestLogComponent,
  type LockComponent,
  type InteractableComponent,
  toItemInstanceId
} from '../types/components.types.ts';
import { type EntityId, type GameState, toEntityId } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import type { StartDialogueIntent } from '../types/intents/ui.intents.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { rollFacetValue, rollPersonalityValue } from './rng.ts';

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
 * Spawns an entity from a template at the given coordinates.
 * @param state The current game state.
 * @param templateId The ID of the template from ENTITY_TEMPLATES.
 * @param x The map X coordinate.
 * @param y The map Y coordinate.
 * @param dynamicTraits Optional additional traits to apply to the entity at spawn.
 * @returns A tuple of the updated state and the new EntityId.
 */
export function spawnEntity(
  state: GameState,
  templateId: string,
  x: number,
  y: number,
  dynamicTraits?: ReadonlyArray<string>,
  staticInventory?: ReadonlyArray<string>
): [GameState, EntityId] {
  const template = state.campaign.entities[templateId];
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
  nextState = addComponent(nextState, entityId, { type: ComponentType.Template, templateId });

  if (template.renderable !== false) {
    nextState = addComponent(nextState, entityId, render);
  }

  if (template.trap) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Trap,
      triggerId: template.trap.triggerId,
      triggered: false
    });
  }

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
      defense: template.fighter.defense,
      xp: 0,
      level: 1,
      xpGiven: template.fighter.xpGiven ?? 0
    };
    nextState = addComponent(nextState, entityId, fighter);
  }

  if (template.ai) {
    const ai: AIComponent = {
      type: ComponentType.AI,
      profileId: template.ai.profileId,
      ...(template.ai.aggroRadius !== undefined ? { aggroRadius: template.ai.aggroRadius } : {}),
      ...(template.ai.wanders !== undefined ? { wanders: template.ai.wanders } : {})
    };
    nextState = addComponent(nextState, entityId, ai);
  }

  if (template.faction) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Faction,
      factionId: template.faction
    });
  }

  if (template.tags && template.tags.length > 0) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Tags,
      tags: template.tags
    });
  }

  const combinedTraits = [...(template.traits ?? []), ...(dynamicTraits ?? [])];
  if (combinedTraits.length > 0) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Traits,
      traits: combinedTraits
    });
  }

  if (template.inventoryConfig) {
    const inventoryCmp: InventoryComponent = {
      type: ComponentType.Inventory,
      items: [],
      baseCapacity: template.inventoryConfig.baseCapacity
    };
    nextState = addComponent(nextState, entityId, inventoryCmp);
  }

  if (template.equipmentSlots) {
    const equipmentCmp: EquipmentComponent = {
      type: ComponentType.Equipment,
      slots: template.equipmentSlots.map((slotType, index) => ({
        id: `${slotType}_${index}`,
        slotType,
        equippedItem: null
      }))
    };
    nextState = addComponent(nextState, entityId, equipmentCmp);
  }

  if (template.persistent) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Persistent
    });
  }

  if (template.memory) {
    let facets: Record<string, number> | undefined;
    let values: Record<string, number> | undefined;

    if (template.memory.facets) {
      facets = { ...template.memory.facets };
    }
    if (template.memory.values) {
      values = { ...template.memory.values };
    }

    if (!facets || !values) {
      const keys = Object.keys(state.campaign.personalityGeneration);
      if (keys.length > 0) {
        const table = state.campaign.personalityGeneration[keys[0]!];
        if (!facets && table && table.facets.length > 0) {
          facets = {};
          for (const f of table.facets) facets[f] = rollFacetValue();
        }
        if (!values && table && table.values.length > 0) {
          values = {};
          for (const v of table.values) values[v] = rollPersonalityValue();
        }
      }
    }

    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Memory,
      factionStandings: template.memory.factionStandings ?? {},
      grudges: template.memory.grudges ?? [],
      facts: template.memory.facts ?? [],
      facets,
      values,
      stress: 0,
      thoughts: []
    });
  }

  if (template.dialogueId) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Dialogue,
      dialogueId: template.dialogueId
    });
  }

  if (template.attitude) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Attitude,
      attitude: template.attitude
    });
  }

  if (template.lock) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Lock,
      difficulty: template.lock.difficulty,
      keyTag: template.lock.keyTag,
      locked: template.lock.locked,
      jammed: template.lock.jammed,
      breakable: template.lock.breakable
    } as LockComponent);

    // Initial interactable setup for locked/openable objects
    const interactable = getComponent(nextState, entityId, ComponentType.Interactable) as
      | InteractableComponent
      | undefined;
    const intents = interactable ? [...interactable.intents] : [];

    intents.push({
      type: IntentType.Apply,
      entityId: -1 as unknown as EntityId,
      verb: template.lock.locked ? 'unlock' : 'open',
      target: { type: 'self' } as const
    } as Intent);

    if (template.lock.breakable) {
      intents.push({
        type: IntentType.Apply,
        entityId: -1 as unknown as EntityId,
        verb: 'kick',
        target: { type: 'self' } as const
      } as Intent);
    }

    if (interactable) {
      nextState = addComponent(nextState, entityId, { ...interactable, intents });
    } else {
      nextState = addComponent(nextState, entityId, {
        type: ComponentType.Interactable,
        intents
      });
    }
  }

  if (template.dialogueId) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Interactable,
      intents: [
        {
          type: IntentType.StartDialogue,
          entityId: -1 as unknown as EntityId,
          targetId: entityId,
          dialogueId: template.dialogueId
        } as StartDialogueIntent
      ]
    });
  }

  if (templateId === 'player') {
    const player: PlayerComponent = { type: ComponentType.Player };
    nextState = addComponent(nextState, entityId, player);

    const hungerCmp = {
      type: ComponentType.Hunger,
      satiation: 1000 // Start at Normal threshold
    } as const;
    nextState = addComponent(nextState, entityId, hungerCmp);

    // Player automatically gets a Memory component for tracking faction standing
    if (!template.memory) {
      nextState = addComponent(nextState, entityId, {
        type: ComponentType.Memory,
        factionStandings: {},
        grudges: [],
        facts: []
      });
    }

    // Player automatically gets a QuestLog
    const questLog: QuestLogComponent = {
      type: ComponentType.QuestLog,
      quests: {}
    };
    nextState = addComponent(nextState, entityId, questLog);
  }

  if (staticInventory && staticInventory.length > 0) {
    const inventory = getComponent(nextState, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
    if (!inventory) {
      console.warn(`Entity template ${templateId} does not have an InventoryComponent, ignoring static inventory.`);
    } else {
      const itemEntityIds: EntityId[] = [];
      for (const itemId of staticInventory) {
        if (state.campaign.items[itemId]) {
          let itemEntityId: EntityId;
          [nextState, itemEntityId] = spawnItem(nextState, itemId, x, y);
          nextState = removeComponent(nextState, itemEntityId, ComponentType.Position);
          itemEntityIds.push(itemEntityId);
        } else {
          console.warn(`Static inventory item ${itemId} not found in items registry.`);
        }
      }
      if (itemEntityIds.length > 0) {
        const updatedInventory: InventoryComponent = {
          ...inventory,
          items: [...inventory.items, ...itemEntityIds]
        };
        nextState = addComponent(nextState, entityId, updatedInventory);
      }
    }
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
  const def = state.campaign.items[itemId];
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
