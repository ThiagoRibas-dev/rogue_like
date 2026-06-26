import * as ROT from 'rot-js';

/**
 * Checks if a given coordinate is adjacent (8-way) to any already aggregated floor tile.
 * @param x The X coordinate to check.
 * @param y The Y coordinate to check.
 * @param floors The set of currently aggregated floor coordinates in "x,y" format.
 * @returns True if the coordinate is adjacent to at least one floor tile, false otherwise.
 */
function isAdjacentToFloor(x: number, y: number, floors: Set<string>): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (floors.has(`${x + dx},${y + dy}`)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Runs a Diffusion-Limited Aggregation (DLA) walker algorithm to carve out organic cave maps.
 * @param width The width of the map.
 * @param height The height of the map.
 * @param targetFloorCount The number of floor tiles we want to carve out.
 * @returns A Set of coordinate strings ("x,y") representing the carved floor tiles.
 */
export function runDLA(width: number, height: number, targetFloorCount: number): Set<string> {
  const floors = new Set<string>();

  // Start with a seed at the center of the map
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  floors.add(`${centerX},${centerY}`);

  // Prevent infinite loops in edge cases where target is unreachable/too high
  const maxSafeFloors = Math.min(targetFloorCount, (width - 2) * (height - 2));
  const maxStepsPerWalker = 2000;

  while (floors.size < maxSafeFloors) {
    // Start walker at a random position inside the border
    let x = ROT.RNG.getUniformInt(1, width - 2);
    let y = ROT.RNG.getUniformInt(1, height - 2);

    let walking = true;
    let steps = 0;

    while (walking && steps < maxStepsPerWalker) {
      steps++;

      // If the walker is already a floor tile, or adjacent to one, it aggregates
      if (floors.has(`${x},${y}`) || isAdjacentToFloor(x, y, floors)) {
        floors.add(`${x},${y}`);
        walking = false;
      } else {
        // Move in one of 8 directions randomly
        const dirs = ROT.DIRS[8];
        const dir = ROT.RNG.getItem(dirs);
        if (dir) {
          const dx = dir[0];
          const dy = dir[1];
          if (dx !== undefined && dy !== undefined) {
            x = Math.max(1, Math.min(width - 2, x + dx));
            y = Math.max(1, Math.min(height - 2, y + dy));
          }
        }
      }
    }
  }

  return floors;
}
