import * as ROT from 'rot-js';
import { type GameState } from '../types/game-state.types.ts';
import { GAME_ASPECT_RATIO } from '../constants/display.constants.ts';

/**
 * Internal interface representing a ROT.js rectangular layout backend
 * that exposes the horizontal and vertical cell spacing.
 */
interface RectBackend {
  readonly _spacingX: number;
  readonly _spacingY: number;
}

/**
 * Type guard to determine if a ROT.js display backend is a rectangular backend
 * exposing the expected _spacingX and _spacingY properties.
 *
 * @param obj The unknown object to check.
 * @returns True if the object matches the RectBackend shape, false otherwise.
 */
function isRectBackend(obj: unknown): obj is RectBackend {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    '_spacingX' in obj &&
    typeof (obj as { readonly _spacingX: unknown })._spacingX === 'number' &&
    '_spacingY' in obj &&
    typeof (obj as { readonly _spacingY: unknown })._spacingY === 'number'
  );
}

/**
 * Synchronizes the ROT.js Display grid width, height, and font size based on
 * the active campaign's theme settings, the current zoom level, and the global aspect ratio.
 *
 * @param display The ROT.js Display instance.
 * @param state The current immutable GameState.
 * @returns void
 */
export function syncDisplayLayout(display: ROT.Display, state: GameState): void {
  const theme = state.campaign.theme;
  const baseCols = theme.ui.displayWidth;
  const baseRows = theme.ui.displayHeight;
  const baseFontSize = theme.ui.fontSize;
  const fontFamily = theme.ui.fontFamily;

  const activeFontSize = Math.round(baseFontSize * state.zoomLevel);

  display.setOptions({
    fontSize: activeFontSize,
    fontFamily
  });

  const backend = (display as unknown as { readonly _backend: unknown })._backend;
  if (!isRectBackend(backend)) return;

  const cellWidth = backend._spacingX;
  const cellHeight = backend._spacingY;

  const baseColsAtZoom = Math.max(1, Math.round(baseCols / state.zoomLevel));
  const baseRowsAtZoom = Math.max(1, Math.round(baseRows / state.zoomLevel));

  const targetRatio = GAME_ASPECT_RATIO * (cellHeight / cellWidth);
  const currentRatio = baseColsAtZoom / baseRowsAtZoom;

  let finalCols = baseColsAtZoom;
  let finalRows = baseRowsAtZoom;

  if (currentRatio < targetRatio) {
    finalCols = Math.max(1, Math.round(baseRowsAtZoom * targetRatio));
  } else if (currentRatio > targetRatio) {
    finalRows = Math.max(1, Math.round(baseColsAtZoom / targetRatio));
  }

  display.setOptions({
    width: finalCols,
    height: finalRows
  });
}
