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

/**
 * Fraction of the viewport's reference span (height in landscape, width in portrait)
 * occupied by a single grid tile at `zoomLevel = 1.0`.
 * `0.04` yields 25 rows at 1.0x (matching ~2.5-3x zoom-in clicks from the legacy 38-row baseline).
 */
export const DEFAULT_VIEWPORT_TILE_HEIGHT_PERCENT = 0.04;

/**
 * Minimum font size (px) enforced when calculating ASCII mode cell sizes.
 */
export const MIN_ASCII_FONT_SIZE_PX = 8;

/**
 * Minimum allowed camera zoom multiplier.
 */
export const MIN_ZOOM_LEVEL = 0.5;

/**
 * Maximum allowed camera zoom multiplier.
 */
export const MAX_ZOOM_LEVEL = 3.0;

/**
 * Incremental delta applied per `+` or `-` zoom button click.
 */
export const ZOOM_STEP_DELTA = 0.2;

/**
 * Debounce delay (ms) applied before re-synchronising the display after a
 * window resize. Prevents re-laying out the display on every resize event.
 */
export const RESIZE_DEBOUNCE_MS = 150;
