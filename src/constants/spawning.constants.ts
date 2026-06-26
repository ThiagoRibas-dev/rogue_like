/**
 * Maximum attempts to find a random valid floor tile in a room.
 */
export const MAX_TILE_SPAWN_ATTEMPTS = 20 as const;

/**
 * Dijkstra map pathfinding topology (8-way movement).
 */
export const DIJKSTRA_TOPOLOGY = 8 as const;

/**
 * Default radius (thickness) of the hot path for digger maps.
 */
export const DEFAULT_HOT_PATH_RADIUS = 1 as const;

/**
 * Cellular map denominator used for dynamic hot path radius scaling (min(width, height) / 30).
 */
export const CELLULAR_HOT_PATH_RADIUS_DENOMINATOR = 30 as const;

/**
 * Fallback minimum radius for cellular map hot paths.
 */
export const MIN_CELLULAR_HOT_PATH_RADIUS = 1 as const;
