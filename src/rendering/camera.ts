import { type GameState } from '../types/game-state.types.ts';
import { ComponentType, type PositionComponent } from '../types/components.types.ts';
import { getComponent, queryEntities } from '../core/ecs.ts';
import { MAX_RENDER_DEPTH_LAYERS } from '../constants/world_chunk.constants.ts';
import { getMapZBounds, getTileAt, getTileDefAt, isInMapBounds, isMultiZMap } from '../map/map_accessor.ts';

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

/**
 * Resolves the camera's active elevation plane (`viewZ = clamp(playerZ + cameraZOffset, minZ..maxZ)`).
 */
export function resolveActiveViewZ(state: Readonly<GameState>): number {
  const players = queryEntities(state as GameState, [ComponentType.Player, ComponentType.Position]);
  const playerEntityId = players[0];
  const playerPos =
    playerEntityId !== undefined
      ? (getComponent(state, playerEntityId, ComponentType.Position) as PositionComponent | undefined)
      : undefined;
  const zBounds = getMapZBounds(state.map);
  return Math.max(zBounds.minZ, Math.min(zBounds.maxZ, (playerPos?.z ?? 0) + (state.cameraZOffset ?? 0)));
}

/**
 * Resolves the deepest visible/explored Z level rendered through `open_air` tiles at `(x, y)`
 * starting from `viewZ` down to `MAX_RENDER_DEPTH_LAYERS`.
 */
export function resolveRenderedCellZAt(
  state: Readonly<GameState>,
  x: number,
  y: number,
  viewZ: number
): { readonly z: number; readonly depthOffset: number } {
  if (!isMultiZMap(state.map) || !isInMapBounds(state.map, x, y, viewZ)) {
    return { z: viewZ, depthOffset: 0 };
  }
  const topTile = getTileAt(state.map, x, y, viewZ);
  if (!topTile) return { z: viewZ, depthOffset: 0 };
  const topDef = getTileDefAt(state, x, y, viewZ);
  if (topDef?.isOpenAir !== true) return { z: viewZ, depthOffset: 0 };

  const zBounds = getMapZBounds(state.map);
  for (let d = 1; d <= MAX_RENDER_DEPTH_LAYERS; d++) {
    const probeZ = viewZ - d;
    if (probeZ < zBounds.minZ || !isInMapBounds(state.map, x, y, probeZ)) break;
    const lowerTile = getTileAt(state.map, x, y, probeZ);
    if (!lowerTile) continue;
    if (!state.map.isFullyExplored && !lowerTile.explored) break;
    const lowerDef = state.campaign.tiles[lowerTile.tileId];
    if (lowerDef?.isOpenAir !== true || d === MAX_RENDER_DEPTH_LAYERS) {
      return { z: probeZ, depthOffset: d };
    }
  }
  return { z: viewZ, depthOffset: 0 };
}
