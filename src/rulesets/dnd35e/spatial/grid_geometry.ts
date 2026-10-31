import { dndFloor } from '../math/multipliers.ts';
import type { CreatureSizeCategory, ReachProfile } from '../types/dnd35e.types.ts';

/** Standard length of a single tactical grid square in D&D 3.5e (`5` feet). */
export const FEET_PER_GRID_SQUARE = 5;

/** Diagonal multiplier (`1.5` squares per diagonal step, floored, yielding `1-2-1-2`). */
const DIAGONAL_STEP_RATIO = 1.5;

/** Dimensional and modifier metrics for a single D&D 3.5e creature size category. */
export interface SizeCategoryMetric {
  readonly rankIndex: number;
  readonly attackAndAcModifier: number;
  readonly specialSizeModifier: number;
  readonly hideModifier: number;
  readonly footprintTiles: number;
  readonly naturalReachTallFt: number;
  readonly naturalReachLongFt: number;
  readonly canShareTileWithMedium: boolean;
}

/** Canonical 9-tier D&D 3.5e Creature Size table (`Fine` through `Colossal`). */
export const SIZE_METRICS: Readonly<Record<CreatureSizeCategory, SizeCategoryMetric>> = {
  fine: {
    rankIndex: -4,
    attackAndAcModifier: 8,
    specialSizeModifier: -16,
    hideModifier: 16,
    footprintTiles: 1,
    naturalReachTallFt: 0,
    naturalReachLongFt: 0,
    canShareTileWithMedium: true
  },
  diminutive: {
    rankIndex: -3,
    attackAndAcModifier: 4,
    specialSizeModifier: -12,
    hideModifier: 12,
    footprintTiles: 1,
    naturalReachTallFt: 0,
    naturalReachLongFt: 0,
    canShareTileWithMedium: true
  },
  tiny: {
    rankIndex: -2,
    attackAndAcModifier: 2,
    specialSizeModifier: -8,
    hideModifier: 8,
    footprintTiles: 1,
    naturalReachTallFt: 0,
    naturalReachLongFt: 0,
    canShareTileWithMedium: true
  },
  small: {
    rankIndex: -1,
    attackAndAcModifier: 1,
    specialSizeModifier: -4,
    hideModifier: 4,
    footprintTiles: 1,
    naturalReachTallFt: 5,
    naturalReachLongFt: 5,
    canShareTileWithMedium: false
  },
  medium: {
    rankIndex: 0,
    attackAndAcModifier: 0,
    specialSizeModifier: 0,
    hideModifier: 0,
    footprintTiles: 1,
    naturalReachTallFt: 5,
    naturalReachLongFt: 5,
    canShareTileWithMedium: false
  },
  large: {
    rankIndex: 1,
    attackAndAcModifier: -1,
    specialSizeModifier: 4,
    hideModifier: -4,
    footprintTiles: 2,
    naturalReachTallFt: 10,
    naturalReachLongFt: 5,
    canShareTileWithMedium: false
  },
  huge: {
    rankIndex: 2,
    attackAndAcModifier: -2,
    specialSizeModifier: 8,
    hideModifier: -8,
    footprintTiles: 3,
    naturalReachTallFt: 15,
    naturalReachLongFt: 10,
    canShareTileWithMedium: false
  },
  gargantuan: {
    rankIndex: 3,
    attackAndAcModifier: -4,
    specialSizeModifier: 12,
    hideModifier: -12,
    footprintTiles: 4,
    naturalReachTallFt: 20,
    naturalReachLongFt: 15,
    canShareTileWithMedium: false
  },
  colossal: {
    rankIndex: 4,
    attackAndAcModifier: -8,
    specialSizeModifier: 16,
    hideModifier: -16,
    footprintTiles: 6,
    naturalReachTallFt: 30,
    naturalReachLongFt: 20,
    canShareTileWithMedium: false
  }
};

/**
 * Measures tactical grid distance in feet between two coordinates using the D&D 3.5e
 * `1-2-1-2` diagonal rule:
 *
 * $$\text{Squares} = \text{orth} + \lfloor 1.5 \times \text{diag} \rfloor, \quad \text{DistanceFt} = 5 \times \text{Squares}$$
 *
 * (1st diagonal = `5 ft`, 2nd diagonal = `+10 ft` (`15 ft` total), 3rd = `20 ft`, 4th = `30 ft`).
 *
 * @param x1 Origin X tile coordinate.
 * @param y1 Origin Y tile coordinate.
 * @param x2 Target X tile coordinate.
 * @param y2 Target Y tile coordinate.
 * @returns Tactical distance in feet (`0, 5, 10, 15, ...`).
 */
export function measureDnD35DistanceFt(x1: number, y1: number, x2: number, y2: number): number {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const diag = Math.min(dx, dy);
  const orth = Math.max(dx, dy) - diag;
  const totalSquares = orth + dndFloor(diag * DIAGONAL_STEP_RATIO);
  return totalSquares * FEET_PER_GRID_SQUARE;
}

/**
 * Checks whether a single diagonal step `(x1, y1) -> (x2, y2)` is blocked by a hard wall corner.
 * In D&D 3.5e, an actor cannot move or make a melee attack diagonally past a corner if either
 * orthogonal neighbor `(x2, y1)` or `(x1, y2)` is an impassable wall.
 *
 * @param x1 Start X coordinate.
 * @param y1 Start Y coordinate.
 * @param x2 Destination X coordinate.
 * @param y2 Destination Y coordinate.
 * @param isWallAt Predicate returning `true` if `(x, y)` is an impassable wall.
 * @returns True if the diagonal step is blocked by a hard corner.
 */
export function isDiagonalStepBlockedByHardCorner(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  isWallAt: (x: number, y: number) => boolean
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) {
    return false;
  }
  return isWallAt(x2, y1) || isWallAt(x1, y2);
}

/**
 * Computes all constituent grid coordinates `{ x, y }` occupied by an entity of `sizeCategory`
 * anchored at top-left tile `(anchorX, anchorY)`.
 *
 * @param anchorX Top-left X coordinate.
 * @param anchorY Top-left Y coordinate.
 * @param sizeCategory Entity's `CreatureSizeCategory`.
 * @returns Array of occupied `{ x, y }` tile coordinates.
 */
export function computeFootprintSquares(
  anchorX: number,
  anchorY: number,
  sizeCategory: CreatureSizeCategory
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const span = SIZE_METRICS[sizeCategory].footprintTiles;
  const squares: Array<{ readonly x: number; readonly y: number }> = [];
  for (let dy = 0; dy < span; dy++) {
    for (let dx = 0; dx < span; dx++) {
      squares.push({ x: anchorX + dx, y: anchorY + dy });
    }
  }
  return squares;
}

/**
 * Computes the minimum D&D 3.5e `1-2-1-2` distance in feet from any square of an entity's
 * footprint to a target tile `(targetX, targetY)`.
 *
 * @param anchorX Entity top-left X coordinate.
 * @param anchorY Entity top-left Y coordinate.
 * @param sizeCategory Entity `CreatureSizeCategory`.
 * @param targetX Target X coordinate.
 * @param targetY Target Y coordinate.
 * @returns Minimum distance in feet (`0` if inside footprint).
 */
export function measureDistanceFromFootprintFt(
  anchorX: number,
  anchorY: number,
  sizeCategory: CreatureSizeCategory,
  targetX: number,
  targetY: number
): number {
  const footprint = computeFootprintSquares(anchorX, anchorY, sizeCategory);
  let minDistance = Number.POSITIVE_INFINITY;
  for (const sq of footprint) {
    const dist = measureDnD35DistanceFt(sq.x, sq.y, targetX, targetY);
    if (dist < minDistance) {
      minDistance = dist;
    }
  }
  return minDistance;
}

/**
 * Computes all grid squares threatened by an entity given its anchor coordinate, size category,
 * and `ReachProfile`:
 * - Creatures with `maxReachFt === 0` (`Tiny`, `Diminutive`, `Fine` without reach weapons)
 *   do not threaten any adjacent squares (they only threaten their own square `[0, 0]`).
 * - A reach weapon (`minReachFt: 10, maxReachFt: 10` without `hasFlexibleReach`) creates an
 *   adjacent `5-ft` dead zone and threatens only squares at `10 ft`.
 *
 * @param anchorX Entity top-left X coordinate.
 * @param anchorY Entity top-left Y coordinate.
 * @param sizeCategory Entity `CreatureSizeCategory`.
 * @param reach `ReachProfile` (`minReachFt`, `maxReachFt`, `hasFlexibleReach`).
 * @param isWallAt Optional wall predicate to exclude hard-corner diagonal squares.
 * @returns Array of threatened `{ x, y }` coordinates.
 */
export function computeThreatenedSquares(
  anchorX: number,
  anchorY: number,
  sizeCategory: CreatureSizeCategory,
  reach: ReachProfile,
  isWallAt?: (x: number, y: number) => boolean
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  if (reach.maxReachFt <= 0) {
    return [];
  }

  const effectiveMinReach = reach.hasFlexibleReach === true ? FEET_PER_GRID_SQUARE : reach.minReachFt;
  const maxTileRadius = dndFloor(reach.maxReachFt / FEET_PER_GRID_SQUARE);
  const span = SIZE_METRICS[sizeCategory].footprintTiles;
  const threatened: Array<{ readonly x: number; readonly y: number }> = [];

  for (let y = anchorY - maxTileRadius; y < anchorY + span + maxTileRadius; y++) {
    for (let x = anchorX - maxTileRadius; x < anchorX + span + maxTileRadius; x++) {
      const distFt = measureDistanceFromFootprintFt(anchorX, anchorY, sizeCategory, x, y);
      if (distFt < effectiveMinReach || distFt > reach.maxReachFt) {
        continue;
      }
      if (
        distFt === FEET_PER_GRID_SQUARE &&
        isWallAt !== undefined &&
        span === 1 &&
        isDiagonalStepBlockedByHardCorner(anchorX, anchorY, x, y, isWallAt)
      ) {
        continue;
      }
      threatened.push({ x, y });
    }
  }
  return threatened;
}
