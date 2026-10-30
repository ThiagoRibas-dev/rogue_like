/**
 * @file Pure dumb canvas renderer that draws ViewportSnapshot DTOs to ROT.Display with dirty-cell diffing.
 */

import type { Display } from 'rot-js';
import { drawCell } from './display.ts';
import type { ViewportSnapshot, ViewportCellDTO } from './viewport_snapshot.types.ts';

/**
 * Default empty cell fallback used when an unexplored or empty tile is cleared.
 */
const EMPTY_CELL = {
  glyph: ' ',
  fg: '#000000',
  bg: '#000000'
} as const;

/**
 * Checks shallow equality between two ViewportCellDTO instances to determine whether redrawing is required.
 *
 * @param a The current frame's cell DTO.
 * @param b The previous frame's cell DTO.
 * @returns True if both cells have identical visual rendering properties; false if redrawing is needed.
 */
function cellEquals(a: ViewportCellDTO, b?: ViewportCellDTO): boolean {
  if (!b) return false;
  if (
    a.glyph !== b.glyph ||
    a.fg !== b.fg ||
    a.bg !== b.bg ||
    a.spriteId !== b.spriteId ||
    a.isVisible !== b.isVisible ||
    a.isExplored !== b.isExplored ||
    a.entities.length !== b.entities.length
  ) {
    return false;
  }

  if (Boolean(a.highlight) !== Boolean(b.highlight)) return false;
  if (a.highlight && b.highlight) {
    if (
      a.highlight.glyph !== b.highlight.glyph ||
      a.highlight.fg !== b.highlight.fg ||
      a.highlight.bg !== b.highlight.bg
    ) {
      return false;
    }
  }

  for (let i = 0; i < a.entities.length; i++) {
    const ea = a.entities[i]!;
    const eb = b.entities[i]!;
    if (ea.glyph !== eb.glyph || ea.fg !== eb.fg || ea.bg !== eb.bg || ea.spriteId !== eb.spriteId) {
      return false;
    }
  }

  return true;
}

/**
 * Renders the pure presentational ViewportSnapshot to the ROT.Display canvas,
 * updating only cells that differ from prevSnapshot.
 *
 * @param display The ROT.js Display instance.
 * @param snapshot The current frame's ViewportSnapshot projection.
 * @param prevSnapshot The previous frame's ViewportSnapshot projection (if any).
 * @returns The number of cell draw operations emitted (for diagnostics).
 */
export function render(display: Display, snapshot: ViewportSnapshot, prevSnapshot?: ViewportSnapshot): number {
  const isFullRedraw =
    !prevSnapshot ||
    prevSnapshot.viewportW !== snapshot.viewportW ||
    prevSnapshot.viewportH !== snapshot.viewportH ||
    prevSnapshot.isSpriteMode !== snapshot.isSpriteMode;

  if (isFullRedraw) {
    display.clear();
  }

  let drawCalls = 0;

  for (let i = 0; i < snapshot.cells.length; i++) {
    const curr = snapshot.cells[i]!;
    if (!isFullRedraw && prevSnapshot && cellEquals(curr, prevSnapshot.cells[i])) {
      continue;
    }

    if (!curr.isExplored && curr.entities.length === 0 && !curr.highlight) {
      if (!isFullRedraw) {
        drawCell(display, curr.vx, curr.vy, snapshot.isSpriteMode, EMPTY_CELL, []);
        drawCalls++;
      }
      continue;
    }

    if (curr.highlight) {
      if (snapshot.isSpriteMode) {
        // ROT's tile backend cannot draw text; the highlight glyph is painted on
        // the overlay canvas via snapshot.glyphOverlays instead of as a sprite key.
        drawCell(display, curr.vx, curr.vy, true, curr, curr.entities);
      } else {
        drawCell(display, curr.vx, curr.vy, false, curr, curr.entities);
        display.draw(curr.vx, curr.vy, curr.highlight.glyph, curr.highlight.fg, curr.highlight.bg);
      }
      drawCalls++;
    } else {
      drawCell(display, curr.vx, curr.vy, snapshot.isSpriteMode, curr, curr.entities);
      drawCalls++;
    }
  }

  return drawCalls;
}
