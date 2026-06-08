import * as ROT from 'rot-js';
import { type GameState } from '../types/game-state.types.ts';

import { coordToIndex } from '../utils/grid.ts';
/**
 * Computes the Field of View from a specific center point using Precise Shadowcasting.
 * Returns a Set of 1D coordinate indices representing visible cells.
 *
 * @param state The current GameState.
 * @param px The center grid x coordinate (usually player position).
 * @param py The center grid y coordinate (usually player position).
 * @returns A Set containing the 1D flat indices of visible coordinates.
 */
export function computeFOV(state: GameState, px: number, py: number): Set<number> {
  const visibleIndices = new Set<number>();
  const mapWidth = state.map.width;

  // Create the Precise Shadowcasting FOV instance
  const fov = new ROT.FOV.PreciseShadowcasting((x: number, y: number): boolean => {
    // Return whether light passes through the cell
    const index = coordToIndex(x, y, mapWidth);
    const tile = state.map.tiles[index];
    if (tile === undefined) {
      return false;
    }
    const tileDef = state.campaign.tiles[tile.tileId];
    return tileDef ? tileDef.transparent : false;
  });

  // Compute visibility
  fov.compute(
    px,
    py,
    state.campaign.rules.map.fovRadius,
    (x: number, y: number, _r: number, visibility: number): void => {
      if (visibility > 0) {
        visibleIndices.add(coordToIndex(x, y, mapWidth));
      }
    }
  );

  return visibleIndices;
}
