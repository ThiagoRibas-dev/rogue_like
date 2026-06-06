import { ComponentType, type PositionComponent, type Component } from '../types/components.types.ts';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent, queryEntities } from '../core/ecs.ts';
import { type Direction, getDirectionDelta } from '../utils/direction.ts';
import { TILE_REGISTRY } from '../constants/tile.constants.ts';
import { coordToIndex, isInBounds } from '../utils/grid.ts';

/**
 * Attempts to move the player in the specified direction.
 * Returns the updated GameState if movement was successful, or the original GameState if blocked.
 * @param state The current GameState.
 * @param dir The Direction to move.
 * @returns The new or original GameState.
 */
export function tryMovePlayer(state: GameState, dir: Direction): GameState {
  const players: ReadonlyArray<EntityId> = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
  const playerEntityId = players[0];
  if (playerEntityId === undefined) {
    return state;
  }

  const playerPosition = getComponent(state, playerEntityId, ComponentType.Position);
  if (playerPosition === undefined) {
    return state;
  }

  const { dx, dy } = getDirectionDelta(dir);
  const targetX: number = playerPosition.x + dx;
  const targetY: number = playerPosition.y + dy;

  if (!isInBounds(targetX, targetY, state.map.width, state.map.height)) {
    return state;
  }

  const targetTileIndex: number = coordToIndex(targetX, targetY, state.map.width);
  const targetTile = state.map.tiles[targetTileIndex];
  if (targetTile === undefined) {
    return state;
  }

  const tileDef = TILE_REGISTRY[targetTile.tileId];
  if (tileDef === undefined || !tileDef.walkable) {
    return state;
  }

  const nextPlayerPosition: PositionComponent = {
    type: ComponentType.Position,
    x: targetX,
    y: targetY,
  };

  const entityComponents: ReadonlyArray<Component> | undefined = state.components.get(playerEntityId);
  if (entityComponents === undefined) {
    return state;
  }

  const nextEntityComponents: ReadonlyArray<Component> = entityComponents.map((c: Component) =>
    c.type === ComponentType.Position ? nextPlayerPosition : c
  );

  const nextComponents: Map<EntityId, ReadonlyArray<Component>> = new Map(state.components);
  nextComponents.set(playerEntityId, nextEntityComponents);

  return {
    ...state,
    components: nextComponents,
  };
}
