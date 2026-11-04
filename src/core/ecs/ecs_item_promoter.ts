import {
  ComponentType,
  type PositionComponent,
  type RenderableComponent,
  type ItemComponent,
  type ChronicleComponent,
  type IdentityComponent,
  toItemInstanceId
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { rng } from '../rng.ts';
import { addComponent, createEntity, getComponent } from './ecs_core.ts';

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
    bg: def.bg,
    ...(def.spriteId !== undefined ? { spriteId: def.spriteId } : {})
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

  if (def.isArtifact) {
    nextState = promoteEntity(nextState, entityId);
  }

  return [nextState, entityId];
}

/**
 * Promotes a generic entity to a named, persistent entity.
 * Generates an identity, creates a chronicle, and marks them persistent.
 *
 * @param state The current game state.
 * @param entityId The ID of the entity to promote.
 * @returns The updated game state.
 */
export function promoteEntity(state: GameState, entityId: EntityId): GameState {
  if (getComponent(state, entityId, ComponentType.Chronicle)) {
    return state;
  }

  let nextState = state;
  const templateCmp = getComponent(state, entityId, ComponentType.Template);
  const templateId = templateCmp ? templateCmp.templateId : 'orc';

  const identityKey = `${templateId}_identity`;
  let table = state.campaign.identityGeneration[identityKey];
  if (!table) {
    const keys = Object.keys(state.campaign.identityGeneration);
    if (keys.length > 0) {
      table = state.campaign.identityGeneration[keys[0]!]!;
    }
  }

  const name = table && table.firstNames.length > 0 ? (rng.getItem(table.firstNames) ?? 'Gruk') : 'Gruk';
  const title = table && table.titles.length > 0 ? (rng.getItem(table.titles) ?? 'the Unknown') : 'the Unknown';
  const mannerism =
    table && table.mannerisms.length > 0 ? (rng.getItem(table.mannerisms) ?? 'stares blankly') : 'stares blankly';
  const color = table && table.colors && table.colors.length > 0 ? rng.getItem(table.colors) : undefined;

  const identity: IdentityComponent = {
    type: ComponentType.Identity,
    name,
    title,
    mannerisms: [mannerism],
    colorOverride: color ?? undefined
  };

  nextState = addComponent(nextState, entityId, identity);

  const chronicle: ChronicleComponent = {
    type: ComponentType.Chronicle,
    pis: 1,
    scars: [],
    coreMemories: [],
    eventExcerpts: []
  };

  nextState = addComponent(nextState, entityId, chronicle);
  nextState = addComponent(nextState, entityId, { type: ComponentType.Persistent });

  return nextState;
}
