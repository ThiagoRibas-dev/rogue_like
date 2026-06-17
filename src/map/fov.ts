import * as ROT from 'rot-js';
import { type GameState } from '../types/game-state.types.ts';

import { coordToIndex } from '../utils/grid.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType, type TagsComponent, type FieldComponent } from '../types/components.types.ts';
/**
 * Computes the Field of View from a specific center point using Precise Shadowcasting.
 * Returns a Set of 1D coordinate indices representing visible cells.
 *
 * @param state The current GameState.
 * @param px The center grid x coordinate (usually player position).
 * @param py The center grid y coordinate (usually player position).
 * @returns A Set containing the 1D flat indices of visible coordinates.
 */
export function computeFOV(state: GameState, px: number, py: number, radius?: number): Set<number> {
  const visibleIndices = new Set<number>();
  const mapWidth = state.map.width;

  // Create the Precise Shadowcasting FOV instance
  const fov = new ROT.FOV.PreciseShadowcasting((x: number, y: number): boolean => {
    // Bounds check to prevent light wrapping on smaller maps
    if (x < 0 || x >= state.map.width || y < 0 || y >= state.map.height) {
      return false;
    }
    // Return whether light passes through the cell
    const index = coordToIndex(x, y, mapWidth);
    const tile = state.map.tiles[index];
    if (tile === undefined) {
      return false;
    }
    const tileDef = state.campaign.tiles[tile.tileId];
    if (!tileDef || !tileDef.transparent) {
      return false;
    }

    const targetKey = `${x},${y}`;
    const entitiesAtTarget = state.spatialIndex.get(targetKey);
    if (entitiesAtTarget) {
      for (const eId of entitiesAtTarget) {
        const tagsCmp = getComponent(state, eId, ComponentType.Tags) as TagsComponent | undefined;
        if (tagsCmp && tagsCmp.tags.includes('opaque')) {
          return false;
        }

        const fieldCmp = getComponent(state, eId, ComponentType.Field) as FieldComponent | undefined;
        if (fieldCmp) {
          const fieldDef = state.campaign.fields[fieldCmp.fieldType];
          if (fieldDef && fieldDef.blocksSight) return false;
        }
      }
    }

    return true;
  });

  const fovRadius = radius ?? state.campaign.rules.map.fovRadius;

  // Compute visibility
  fov.compute(px, py, fovRadius, (x: number, y: number, _r: number, visibility: number): void => {
    if (visibility > 0) {
      visibleIndices.add(coordToIndex(x, y, mapWidth));
    }
  });

  return visibleIndices;
}
