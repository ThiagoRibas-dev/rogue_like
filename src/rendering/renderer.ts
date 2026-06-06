import type { Display } from 'rot-js';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent, queryEntities } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import { TILE_REGISTRY } from '../constants/tile.constants.ts';
import { coordToIndex } from '../utils/grid.ts';

/**
 * Renders the map tiles and all renderable entities to the ROT.js Display.
 * @param display The ROT.js Display instance.
 * @param state The current GameState.
 */
export function render(display: Display, state: GameState): void {
  display.clear();

  const mapWidth: number = state.map.width;
  const mapHeight: number = state.map.height;

  // 1. Draw the map tiles
  for (let y: number = 0; y < mapHeight; y++) {
    for (let x: number = 0; x < mapWidth; x++) {
      const tileIndex: number = coordToIndex(x, y, mapWidth);
      const tile = state.map.tiles[tileIndex];
      if (tile !== undefined) {
        const tileDef = TILE_REGISTRY[tile.tileId];
        if (tileDef !== undefined) {
          display.draw(x, y, tileDef.glyph, tileDef.fg, tileDef.bg);
        }
      }
    }
  }

  // 2. Query and draw all entities with Position and Renderable components
  const renderableEntities: ReadonlyArray<EntityId> = queryEntities(state, [
    ComponentType.Position,
    ComponentType.Renderable,
  ]);

  for (const entityId of renderableEntities) {
    const position = getComponent(state, entityId, ComponentType.Position);
    const renderable = getComponent(state, entityId, ComponentType.Renderable);

    if (position !== undefined && renderable !== undefined) {
      display.draw(
        position.x,
        position.y,
        renderable.glyph,
        renderable.fg,
        renderable.bg
      );
    }
  }
}
