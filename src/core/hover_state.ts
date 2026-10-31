/**
 * @file Transient pointer hover and context-menu anchor state.
 * Kept strictly outside GameState so mouse movement never pollutes save serialization or deterministic replay state.
 */

/**
 * 2D integer coordinate pair.
 */
export interface GridCoord {
  readonly x: number;
  readonly y: number;
}

/**
 * Immutable snapshot of transient pointer state for viewport overlays and floating popovers.
 */
export interface TransientHoverState {
  readonly hoveredTile: GridCoord | null;
  readonly contextMenuAnchor: GridCoord | null;
}

let currentHover: TransientHoverState = {
  hoveredTile: null,
  contextMenuAnchor: null
};

/**
 * Returns the current transient pointer hover state.
 *
 * @returns The active TransientHoverState snapshot.
 */
export function getHoverState(): TransientHoverState {
  return currentHover;
}

/**
 * Updates the hovered world tile coordinate.
 *
 * @param tile World grid coordinates `(x, y)` or `null` when pointer leaves the canvas.
 * @returns True if the hovered tile changed, false if identical.
 */
export function setHoveredTile(tile: GridCoord | null): boolean {
  const prev = currentHover.hoveredTile;
  const isUnchanged =
    (prev === null && tile === null) || (prev !== null && tile !== null && prev.x === tile.x && prev.y === tile.y);
  if (isUnchanged) {
    return false;
  }
  currentHover = {
    ...currentHover,
    hoveredTile: tile
  };
  return true;
}

/**
 * Records the client screen coordinates `(clientX, clientY)` where a right-click context menu was invoked,
 * or `null` when opened via keyboard.
 *
 * @param anchor Screen pixel coordinate or `null`.
 */
export function setContextMenuAnchor(anchor: GridCoord | null): void {
  currentHover = {
    ...currentHover,
    contextMenuAnchor: anchor
  };
}
