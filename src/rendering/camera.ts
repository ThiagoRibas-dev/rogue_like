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
 * Computes the top-left offset coordinate of the camera viewport to keep the player
 * unconditionally centered in the viewport (allowing full overscroll into out-of-bounds
 * void so actors and map edges never get forced underneath edge HUD overlays).
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

  return {
    x: position.x - Math.floor(viewportWidth / 2),
    y: position.y - Math.floor(viewportHeight / 2)
  };
}
