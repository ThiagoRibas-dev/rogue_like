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

/**
 * Maximum tile depth inward from the outermost walkable floor tile on a requested cardinal edge
 * when selecting border-aligned portals in cellular and DLA maps.
 */
export const CELLULAR_PORTAL_EDGE_BAND_TILES = 3 as const;

/**
 * Fraction of the perpendicular map span centered around the midpoint preferred for cardinal edge portals
 * so North/South/East/West exits avoid piling into shared map corners.
 */
export const CELLULAR_PORTAL_PERPENDICULAR_CENTER_BAND = 0.3 as const;

/**
 * Minimum Manhattan distance enforced between portals in cellular and DLA maps when space allows.
 */
export const MIN_CELLULAR_PORTAL_SEPARATION = 6 as const;
