import * as ROT from 'rot-js';
import { type GameState } from '../types/game-state.types.ts';
import { getTileDefAt, toMapTileKey } from './map_accessor.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType, type TagsComponent, type FieldComponent } from '../types/components.types.ts';
/**
 * Computes the Field of View from a specific center point using Precise Shadowcasting.
 * Returns a Set of numeric coordinate keys (`coordToIndex` on finite maps, `packWorldCoord` on chunked maps)
 * representing visible cells.
 *
 * @param state The current GameState.
 * @param px The center grid x coordinate (usually player position).
 * @param py The center grid y coordinate (usually player position).
 * @returns A Set containing numeric tile keys of visible coordinates.
 */
export function computeFOV(state: GameState, px: number, py: number, radius?: number): Set<number> {
  const visibleIndices = new Set<number>();

  // Create the Precise Shadowcasting FOV instance
  const fov = new ROT.FOV.PreciseShadowcasting((x: number, y: number): boolean => {
    const tileDef = getTileDefAt(state, x, y);
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
      visibleIndices.add(toMapTileKey(state.map, x, y));
    }
  });

  return visibleIndices;
}
