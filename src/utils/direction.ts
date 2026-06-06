import { assertNever } from './assert.ts';

/**
 * Enum of possible movement directions.
 */
export const enum Direction {
  North = "North",
  South = "South",
  East = "East",
  West = "West",
}

/**
 * Coordinate deltas for a movement direction.
 */
export interface DirectionDelta {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Returns the grid coordinate offset delta for a given direction.
 * @param dir The Direction.
 * @returns The DirectionDelta containing dx and dy coordinate offsets.
 */
export function getDirectionDelta(dir: Direction): DirectionDelta {
  switch (dir) {
    case Direction.North:
      return { dx: 0, dy: -1 };
    case Direction.South:
      return { dx: 0, dy: 1 };
    case Direction.East:
      return { dx: 1, dy: 0 };
    case Direction.West:
      return { dx: -1, dy: 0 };
    default:
      return assertNever(dir);
  }
}
