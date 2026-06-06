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
