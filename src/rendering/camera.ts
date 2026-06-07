import { type GameState } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent, queryEntities } from '../core/ecs.ts';

/**
 * Interface representing the top-left coordinate offsets of the camera viewport.
 */
export interface CameraOffset {
  readonly x: number;
  readonly y: number;
}

/**
 * Computes the top-left offset coordinate of the camera viewport to keep the player centered.
 * Clamps the camera offsets to ensure it never shows out-of-bounds space outside the map.
 *
 * @param state The current GameState.
 * @param viewportWidth The width of the screen viewport in cells.
 * @param viewportHeight The height of the screen viewport in cells.
 * @returns The CameraOffset coordinate object.
 */
export function getCameraOffset(state: GameState, viewportWidth: number, viewportHeight: number): CameraOffset {
  const players = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
  const playerEntityId = players[0];

  // If no player or position is found, default camera to top-left (0, 0)
  if (playerEntityId === undefined) {
    return { x: 0, y: 0 };
  }

  const position = getComponent(state, playerEntityId, ComponentType.Position);
  if (position === undefined) {
    return { x: 0, y: 0 };
  }

  const mapWidth = state.map.width;
  const mapHeight = state.map.height;

  // Calculate centered position
  let cameraX = position.x - Math.floor(viewportWidth / 2);
  let cameraY = position.y - Math.floor(viewportHeight / 2);

  // Clamp camera position to map boundaries
  cameraX = Math.max(0, Math.min(cameraX, mapWidth - viewportWidth));
  cameraY = Math.max(0, Math.min(cameraY, mapHeight - viewportHeight));

  // If the map is smaller than the viewport, set camera to 0 to prevent negative offsets
  if (mapWidth < viewportWidth) {
    cameraX = 0;
  }
  if (mapHeight < viewportHeight) {
    cameraY = 0;
  }

  return { x: cameraX, y: cameraY };
}
