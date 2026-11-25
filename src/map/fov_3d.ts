import * as ROT from 'rot-js';
import { MAX_FOV_Z_RANGE } from '../constants/world_chunk.constants.ts';
import { getComponent, getEntitiesAtPosition } from '../core/ecs.ts';
import { ComponentType, type FieldComponent, type TagsComponent } from '../types/components.types.ts';
import type { GameState } from '../types/game-state.types.ts';
import { getBresenhamLine3D } from '../utils/grid.ts';
import { getMapZBounds, getTileDefAt, isInMapBounds, isMultiZMap, toMapTileKey } from './map_accessor.ts';

function isCellTransparent3D(state: Readonly<GameState>, x: number, y: number, z: number): boolean {
  const tileDef = getTileDefAt(state, x, y, z);
  if (!tileDef || !tileDef.transparent) {
    return false;
  }

  const entitiesAtTarget = getEntitiesAtPosition(state as GameState, x, y, z);
  for (const eId of entitiesAtTarget) {
    const tagsCmp = getComponent(state as GameState, eId, ComponentType.Tags) as TagsComponent | undefined;
    if (tagsCmp && tagsCmp.tags.includes('opaque')) {
      return false;
    }

    const fieldCmp = getComponent(state as GameState, eId, ComponentType.Field) as FieldComponent | undefined;
    if (fieldCmp) {
      const fieldDef = state.campaign.fields[fieldCmp.fieldType];
      if (fieldDef && fieldDef.blocksSight) return false;
    }
  }

  return true;
}

/**
 * Evaluates true 3D Line of Sight from `(x0, y0, z0)` to `(x1, y1, z1)` across voxel Z-slices,
 * enforcing intermediate wall/field occlusion and solid floor/ceiling opacity between Z strata.
 */
export function has3DLineOfSight(
  state: Readonly<GameState>,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number
): boolean {
  if (x0 === x1 && y0 === y1 && z0 === z1) return true;
  const line = getBresenhamLine3D(x0, y0, z0, x1, y1, z1);

  for (let i = 1; i < line.length; i++) {
    const pt = line[i]!;
    const prev = line[i - 1]!;
    const isEndpoint = i === line.length - 1;

    if (!isInMapBounds(state.map, pt.x, pt.y, pt.z)) return false;

    if (pt.z !== prev.z) {
      if (pt.z < prev.z) {
        // Descending ray crosses floor at prev.z (or open air above pt)
        const prevDef = getTileDefAt(state, prev.x, prev.y, prev.z);
        const abovePtDef = getTileDefAt(state, pt.x, pt.y, prev.z);
        const prevOpen =
          prevDef !== undefined &&
          (prevDef.isOpenAir === true || prevDef.verticalLink !== undefined || prevDef.blocksVerticalLoS === false);
        const aboveOpen =
          abovePtDef !== undefined &&
          (abovePtDef.isOpenAir === true ||
            abovePtDef.verticalLink !== undefined ||
            abovePtDef.blocksVerticalLoS === false);
        if (!prevOpen && !aboveOpen) {
          return false;
        }
      } else {
        // Ascending ray crosses ceiling at pt.z (or open air above prev)
        const abovePrevDef = getTileDefAt(state, prev.x, prev.y, pt.z);
        const ptDef = getTileDefAt(state, pt.x, pt.y, pt.z);
        const abovePrevOpen =
          abovePrevDef !== undefined &&
          (abovePrevDef.isOpenAir === true ||
            abovePrevDef.verticalLink !== undefined ||
            abovePrevDef.blocksVerticalLoS === false);
        const ptOpen =
          ptDef !== undefined &&
          (ptDef.isOpenAir === true || ptDef.verticalLink !== undefined || ptDef.blocksVerticalLoS === false);
        if (!abovePrevOpen && !ptOpen) {
          return false;
        }
      }
    }

    if (!isEndpoint && !isCellTransparent3D(state, pt.x, pt.y, pt.z)) {
      return false;
    }
  }

  return true;
}

/**
 * Computes true 3D Field of View from `(px, py, pz)`:
 * executes Precise Shadowcasting on the observer's active `pz` plane and casts 3D Bresenham LoS rays
 * across vertical strata within `MAX_FOV_Z_RANGE` and spherical `radius`.
 */
export function computeFOV3D(state: Readonly<GameState>, px: number, py: number, pz = 0, radius?: number): Set<number> {
  const visibleIndices = new Set<number>();
  const fovRadius = radius ?? state.campaign.rules.map.fovRadius;

  const fov2D = new ROT.FOV.PreciseShadowcasting((x: number, y: number): boolean => {
    return isCellTransparent3D(state, x, y, pz);
  });

  fov2D.compute(px, py, fovRadius, (x: number, y: number, _r: number, visibility: number): void => {
    if (visibility > 0 && isInMapBounds(state.map, x, y, pz)) {
      visibleIndices.add(toMapTileKey(state.map, x, y, pz));
    }
  });

  if (!isMultiZMap(state.map)) {
    return visibleIndices;
  }

  const { minZ, maxZ } = getMapZBounds(state.map);
  const scanMinZ = Math.max(minZ, pz - MAX_FOV_Z_RANGE);
  const scanMaxZ = Math.min(maxZ, pz + MAX_FOV_Z_RANGE);
  const radiusSq = fovRadius * fovRadius;

  for (let z = scanMinZ; z <= scanMaxZ; z++) {
    if (z === pz) continue;
    const dz = z - pz;
    const dzSq = dz * dz;
    if (dzSq > radiusSq) continue;

    for (let dy = -fovRadius; dy <= fovRadius; dy++) {
      const dyzSq = dzSq + dy * dy;
      if (dyzSq > radiusSq) continue;
      for (let dx = -fovRadius; dx <= fovRadius; dx++) {
        if (dyzSq + dx * dx > radiusSq) continue;
        const tx = px + dx;
        const ty = py + dy;
        if (!isInMapBounds(state.map, tx, ty, z)) continue;
        if (has3DLineOfSight(state, px, py, pz, tx, ty, z)) {
          visibleIndices.add(toMapTileKey(state.map, tx, ty, z));
        }
      }
    }
  }

  return visibleIndices;
}
