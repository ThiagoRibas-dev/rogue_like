/**
 * Converts 2D grid coordinates to a 1D flat array index.
 * @param x The grid x coordinate.
 * @param y The grid y coordinate.
 * @param width The width of the grid/map.
 * @returns The 1D flat index.
 */
export function coordToIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

/**
 * Checks if a coordinate is within the boundaries of the grid.
 * @param x The grid x coordinate.
 * @param y The grid y coordinate.
 * @param width The width of the grid/map.
 * @param height The height of the grid/map.
 * @returns True if the coordinate is in bounds.
 */
export function isInBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}

/**
 * Returns an array of points representing a line from (x0, y0) to (x1, y1)
 * using Bresenham's line algorithm.
 */
export function getBresenhamLine(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const points = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return points;
}
