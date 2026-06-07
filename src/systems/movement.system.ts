import { ComponentType, type PositionComponent, type Component } from '../types/components.types.ts';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent, updateSpatialIndex } from '../core/ecs.ts';
import { TILE_REGISTRY } from '../constants/tile.constants.ts';
import { coordToIndex, isInBounds } from '../utils/grid.ts';
import type { MoveIntent } from '../types/intents.types.ts';
import { IntentType } from '../types/intents.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { processMeleeAttackIntent } from './combat.system.ts';

/**
 * Processes a MoveIntent.
 * Checks for collision against walls and entities using the spatial index.
 * Returns updated GameState if movement was successful, or the original GameState (plus a message) if blocked.
 * @param state The current GameState.
 * @param intent The MoveIntent to process.
 * @returns The new or original GameState.
 */
export function processMoveIntent(state: GameState, intent: MoveIntent): GameState {
  const { entityId, dx, dy } = intent;

  const position = getComponent(state, entityId, ComponentType.Position);
  if (position === undefined) {
    return state;
  }

  const targetX: number = position.x + dx;
  const targetY: number = position.y + dy;

  if (!isInBounds(targetX, targetY, state.map.width, state.map.height)) {
    return state;
  }

  const targetTileIndex: number = coordToIndex(targetX, targetY, state.map.width);
  const targetTile = state.map.tiles[targetTileIndex];
  if (targetTile === undefined) {
    return state;
  }

  // 1. Wall Collision
  const tileDef = TILE_REGISTRY[targetTile.tileId];
  if (tileDef === undefined || !tileDef.walkable) {
    const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
    if (isPlayer) {
      return addMessage(state, 'Ouch! You bumped into a wall.', MessageLogCategory.CombatHit);
    }
    return state;
  }

  // 2. Entity Collision
  const targetKey = `${targetX},${targetY}`;
  const entitiesAtTarget = state.spatialIndex.get(targetKey);
  if (entitiesAtTarget !== undefined && entitiesAtTarget.length > 0) {
    let defenderId: EntityId | undefined;
    let isBlocked = false;

    for (const id of entitiesAtTarget) {
      if (getComponent(state, id, ComponentType.Fighter) !== undefined) {
        defenderId = id;
        isBlocked = true;
        break;
      }
      if (getComponent(state, id, ComponentType.Actor) !== undefined) {
        isBlocked = true;
      }
    }

    if (defenderId !== undefined) {
      return processMeleeAttackIntent(state, {
        type: IntentType.MeleeAttack,
        entityId,
        defenderId
      });
    }

    if (isBlocked) {
      const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
      if (isPlayer) {
        return addMessage(state, 'Something is in the way.', MessageLogCategory.CombatHit);
      }
      return state;
    }
  }

  // 3. Apply Movement
  const nextPosition: PositionComponent = {
    type: ComponentType.Position,
    x: targetX,
    y: targetY
  };

  const entityComponents: ReadonlyArray<Component> | undefined = state.components.get(entityId);
  if (entityComponents === undefined) {
    return state;
  }

  const nextEntityComponents: ReadonlyArray<Component> = entityComponents.map((c: Component) =>
    c.type === ComponentType.Position ? nextPosition : c
  );

  const nextComponents: Map<EntityId, ReadonlyArray<Component>> = new Map(state.components);
  nextComponents.set(entityId, nextEntityComponents);

  const nextState = {
    ...state,
    components: nextComponents
  };

  // Rebuild spatial index since a position changed
  return updateSpatialIndex(nextState);
}
