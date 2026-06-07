import type { Display } from 'rot-js';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent, queryEntities } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import { TILE_REGISTRY } from '../constants/tile.constants.ts';
import { COLOR_WALL_DIM_FG, COLOR_FLOOR_DIM_FG } from '../constants/colors.constants.ts';
import { coordToIndex } from '../utils/grid.ts';
import { computeFOV } from '../map/fov.ts';
import { getCameraOffset } from './camera.ts';

/**
 * Renders the visible and explored map tiles and all visible renderable entities
 * to the ROT.js Display, taking the camera scrolling viewport offset into account.
 *
 * @param display The ROT.js Display instance.
 * @param state The current GameState.
 */
export function render(display: Display, state: GameState): void {
  display.clear();

  // 1. Get viewport size from display
  const options = display.getOptions();
  const viewportW = options.width ?? state.map.width;
  const viewportH = options.height ?? state.map.height;

  // 2. Compute camera offset centered on the player
  const { x: cameraX, y: cameraY } = getCameraOffset(state, viewportW, viewportH);

  // 3. Compute active FOV visible set from player position
  const players = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
  const playerEntityId = players[0];
  let visibleIndices = new Set<number>();

  if (playerEntityId !== undefined) {
    const playerPos = getComponent(state, playerEntityId, ComponentType.Position);
    if (playerPos !== undefined) {
      visibleIndices = computeFOV(state, playerPos.x, playerPos.y);
    }
  }

  // 4. Draw the visible/explored map tiles in the camera viewport
  for (let vy = 0; vy < viewportH; vy++) {
    for (let vx = 0; vx < viewportW; vx++) {
      const mapX = vx + cameraX;
      const mapY = vy + cameraY;

      const tileIndex = coordToIndex(mapX, mapY, state.map.width);
      const tile = state.map.tiles[tileIndex];
      const isTileExplored = tile !== undefined && (state.map.isFullyExplored || tile.explored);

      if (isTileExplored) {
        const tileDef = TILE_REGISTRY[tile.tileId];
        if (tileDef !== undefined) {
          const isVisible = state.map.isFullyExplored || visibleIndices.has(tileIndex);

          // Determine foreground color based on visibility (Fog of War)
          let fgColor = tileDef.fg;
          if (!isVisible) {
            if (tile.tileId === 'stone_wall') {
              fgColor = COLOR_WALL_DIM_FG;
            } else {
              fgColor = COLOR_FLOOR_DIM_FG;
            }
          }

          display.draw(vx, vy, tileDef.glyph, fgColor, tileDef.bg);
        }
      }
    }
  }

  // 5. Query and draw all entities that are in the player's line of sight
  const renderableEntities: ReadonlyArray<EntityId> = queryEntities(state, [
    ComponentType.Position,
    ComponentType.Renderable,
  ]);

  for (const entityId of renderableEntities) {
    const position = getComponent(state, entityId, ComponentType.Position);
    const renderable = getComponent(state, entityId, ComponentType.Renderable);

    if (position !== undefined && renderable !== undefined) {
      const tileIndex = coordToIndex(position.x, position.y, state.map.width);

      // Only draw entities that are in the player's active field of view (or if map is fully explored)
      if (state.map.isFullyExplored || visibleIndices.has(tileIndex)) {
        const vx = position.x - cameraX;
        const vy = position.y - cameraY;

        // Draw only if within the display viewport bounds
        if (vx >= 0 && vx < viewportW && vy >= 0 && vy < viewportH) {
          display.draw(
            vx,
            vy,
            renderable.glyph,
            renderable.fg,
            renderable.bg
          );
        }
      }
    }
  }

  // 6. Draw Targeting Highlight
  if (state.targetingMode?.active) {
    const vx = state.targetingMode.x - cameraX;
    const vy = state.targetingMode.y - cameraY;
    if (vx >= 0 && vx < viewportW && vy >= 0 && vy < viewportH) {
      // Draw a yellow targeting crosshair over whatever is there
      display.draw(vx, vy, 'X', '#000000', '#ffff00'); 
    }
  }
}

