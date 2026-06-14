import { ComponentType, type PositionComponent, type Component } from '../types/components.types.ts';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { GameEventType } from '../types/events.types.ts';
import { getComponent, updateSpatialIndex } from '../core/ecs.ts';

import { coordToIndex, isInBounds } from '../utils/grid.ts';
import type { MoveIntent } from '../types/intents/movement.intents.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { processMeleeAttackIntent } from './combat.system.ts';
import { isHostile } from '../utils/faction.ts';
import type { GameEvent } from '../types/events.types.ts';

/**
 * Processes a MoveIntent.
 * Checks for collision against walls and entities using the spatial index.
 * Returns updated GameState if movement was successful, or the original GameState (plus a message) if blocked.
 * @param state The current GameState.
 * @param intent The MoveIntent to process.
 * @returns The new or original GameState.
 */
export function processMoveIntent(
  state: GameState,
  intent: MoveIntent
): { state: GameState; success: boolean; events?: GameEvent[] } {
  const { entityId, dx, dy } = intent;

  const position = getComponent(state, entityId, ComponentType.Position);
  if (position === undefined) {
    return { state, success: false };
  }

  const targetX: number = position.x + dx;
  const targetY: number = position.y + dy;

  if (!isInBounds(targetX, targetY, state.map.width, state.map.height)) {
    return { state, success: false };
  }

  const targetTileIndex: number = coordToIndex(targetX, targetY, state.map.width);
  const targetTile = state.map.tiles[targetTileIndex];
  if (targetTile === undefined) {
    return { state, success: false };
  }

  // 1. Wall Collision
  const tileDef = state.campaign.tiles[targetTile.tileId];
  if (tileDef === undefined || !tileDef.walkable) {
    const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
    if (tileDef?.bumpTransition) {
      // Bump to transition (e.g., open door)
      const nextTiles = [...state.map.tiles];
      nextTiles[targetTileIndex] = { ...targetTile, tileId: tileDef.bumpTransition };
      const nextMap = { ...state.map, tiles: nextTiles };
      let nextState: GameState = { ...state, map: nextMap };
      if (isPlayer) {
        const msg = tileDef.interactMessage ?? 'You bump into it.';
        nextState = addMessage(nextState, msg, MessageLogCategory.System);
      }
      return { state: nextState, success: true };
    }

    if (isPlayer) {
      return {
        state: addMessage(state, 'Ouch! You bumped into a wall.', MessageLogCategory.CombatHit),
        success: false
      };
    }
    return { state, success: false };
  }

  // 2. Entity Collision
  const targetKey = `${targetX},${targetY}`;
  const entitiesAtTarget = state.spatialIndex.get(targetKey);
  if (entitiesAtTarget !== undefined && entitiesAtTarget.length > 0) {
    let defenderId: EntityId | undefined;
    let isBlocked = false;

    for (const id of entitiesAtTarget) {
      if (getComponent(state, id, ComponentType.Fighter) !== undefined) {
        if (isHostile(state, entityId, id)) {
          defenderId = id;
          isBlocked = true;
          break;
        } else {
          isBlocked = true;
        }
      } else if (getComponent(state, id, ComponentType.Actor) !== undefined) {
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
        return { state: addMessage(state, 'Something is in the way.', MessageLogCategory.CombatHit), success: false };
      }
      return { state, success: false };
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
    return { state, success: false };
  }

  const nextEntityComponents: ReadonlyArray<Component> = entityComponents.map((c: Component) =>
    c.type === ComponentType.Position ? nextPosition : c
  );

  const nextComponents: Map<EntityId, ReadonlyArray<Component>> = new Map(state.components);
  nextComponents.set(entityId, nextEntityComponents);

  let nextState: GameState = {
    ...state,
    components: nextComponents
  };

  nextState = updateSpatialIndex(nextState);

  const tileTags = state.campaign.tiles[targetTile.tileId]?.tags ?? [targetTile.tileId];
  const events = tileTags.map((tag) => ({
    type: GameEventType.TileEntered as const,
    entityId,
    x: targetX,
    y: targetY,
    tileTag: tag
  }));

  return { state: nextState, success: true, events };
}
