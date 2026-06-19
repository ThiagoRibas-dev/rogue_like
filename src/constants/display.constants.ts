/**
 * The target width multiplier/scaling for the game aspect ratio.
 */
export const GAME_ASPECT_RATIO_WIDTH = 4;

/**
 * The target height multiplier/scaling for the game aspect ratio.
 */
export const GAME_ASPECT_RATIO_HEIGHT = 3;

/**
 * The evaluated game aspect ratio.
 */
export const GAME_ASPECT_RATIO = GAME_ASPECT_RATIO_WIDTH / GAME_ASPECT_RATIO_HEIGHT;

/**
 * String representation of the aspect ratio for CSS property bindings.
 */
export const GAME_ASPECT_RATIO_STRING = `${GAME_ASPECT_RATIO_WIDTH} / ${GAME_ASPECT_RATIO_HEIGHT}`;

/**
 * The default engine-wide zoom level.
 */
export const DEFAULT_ZOOM_LEVEL = 1.0;
