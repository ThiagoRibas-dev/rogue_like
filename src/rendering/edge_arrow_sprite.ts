/**
 * @file Canvas2D renderer for built-in cardinal area edge-transition directional arrow sprites.
 */

import type { EdgeTransitionDirection } from '../constants/display.constants.ts';
import { assertNever } from '../utils/assert.ts';

const EDGE_ARROW_OUTLINE_COLOR = 'rgba(12, 10, 8, 0.92)';
const EDGE_ARROW_PRIMARY_COLOR = '#f5d782';
const EDGE_ARROW_SECONDARY_COLOR = '#d4a94e';
const EDGE_ARROW_HIGHLIGHT_COLOR = '#fff7d6';
const EDGE_ARROW_OUTLINE_WIDTH_RATIO = 0.2;
const EDGE_ARROW_STROKE_WIDTH_RATIO = 0.1;
const EDGE_ARROW_HIGHLIGHT_WIDTH_RATIO = 0.045;
const EDGE_ARROW_HALF_SPAN_RATIO = 0.28;
const EDGE_ARROW_CHEVRON_DROP_RATIO = 0.2;
const EDGE_ARROW_PRIMARY_TIP_Y_RATIO = -0.32;
const EDGE_ARROW_SECONDARY_TIP_Y_RATIO = 0.04;
const EDGE_ARROW_SECONDARY_SPAN_SCALE = 0.78;
const EDGE_ARROW_MIN_OUTLINE_PX = 2.5;
const EDGE_ARROW_MIN_STROKE_PX = 1.5;
const EDGE_ARROW_MIN_HIGHLIGHT_PX = 1;
const QUARTER_TURN_RAD = Math.PI / 2;
const HALF_TURN_RAD = Math.PI;

/**
 * Resolves the clockwise canvas rotation angle (radians) for a cardinal edge-transition arrow,
 * where `0` points North (upward).
 *
 * @param direction Cardinal compass direction.
 * @returns Rotation angle in radians.
 */
function resolveEdgeArrowRotationRad(direction: EdgeTransitionDirection): number {
  switch (direction) {
    case 'north':
      return 0;
    case 'east':
      return QUARTER_TURN_RAD;
    case 'south':
      return HALF_TURN_RAD;
    case 'west':
      return -QUARTER_TURN_RAD;
    default:
      return assertNever(direction);
  }
}

/**
 * Paints a crisp, dark-outlined double-chevron directional transition arrow over a transparent tile cell.
 * Used in both composited sprite-pack atlases and procedural sprite atlases so edge exits remain
 * visually distinct from indoor doors across all themes and sprite packs.
 *
 * @param ctx 2D canvas context of the atlas.
 * @param ox Cell origin X in pixels.
 * @param oy Cell origin Y in pixels.
 * @param tileWidth Cell width in pixels.
 * @param tileHeight Cell height in pixels.
 * @param direction Cardinal direction the arrow points toward.
 */
export function paintEdgeTransitionArrowSprite(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  tileWidth: number,
  tileHeight: number,
  direction: EdgeTransitionDirection
): void {
  const span = Math.min(tileWidth, tileHeight);
  const cx = ox + tileWidth / 2;
  const cy = oy + tileHeight / 2;
  const halfSpan = span * EDGE_ARROW_HALF_SPAN_RATIO;
  const drop = span * EDGE_ARROW_CHEVRON_DROP_RATIO;
  const primaryTipY = span * EDGE_ARROW_PRIMARY_TIP_Y_RATIO;
  const secondaryTipY = span * EDGE_ARROW_SECONDARY_TIP_Y_RATIO;
  const secondaryHalfSpan = halfSpan * EDGE_ARROW_SECONDARY_SPAN_SCALE;
  const outlineWidth = Math.max(EDGE_ARROW_MIN_OUTLINE_PX, span * EDGE_ARROW_OUTLINE_WIDTH_RATIO);
  const strokeWidth = Math.max(EDGE_ARROW_MIN_STROKE_PX, span * EDGE_ARROW_STROKE_WIDTH_RATIO);
  const highlightWidth = Math.max(EDGE_ARROW_MIN_HIGHLIGHT_PX, span * EDGE_ARROW_HIGHLIGHT_WIDTH_RATIO);

  const traceChevron = (tipY: number, wingHalfSpan: number): void => {
    ctx.beginPath();
    ctx.moveTo(-wingHalfSpan, tipY + drop);
    ctx.lineTo(0, tipY);
    ctx.lineTo(wingHalfSpan, tipY + drop);
  };

  ctx.save();
  ctx.clearRect(ox, oy, tileWidth, tileHeight);
  ctx.translate(cx, cy);
  ctx.rotate(resolveEdgeArrowRotationRad(direction));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Dark contrast outline for both bright outdoor roads and dark cavern floors
  ctx.strokeStyle = EDGE_ARROW_OUTLINE_COLOR;
  ctx.lineWidth = outlineWidth;
  traceChevron(secondaryTipY, secondaryHalfSpan);
  ctx.stroke();
  traceChevron(primaryTipY, halfSpan);
  ctx.stroke();

  // Warm gold/ivory directional chevrons
  ctx.strokeStyle = EDGE_ARROW_SECONDARY_COLOR;
  ctx.lineWidth = strokeWidth;
  traceChevron(secondaryTipY, secondaryHalfSpan);
  ctx.stroke();

  ctx.strokeStyle = EDGE_ARROW_PRIMARY_COLOR;
  ctx.lineWidth = strokeWidth;
  traceChevron(primaryTipY, halfSpan);
  ctx.stroke();

  // Bright crest accent on the leading chevron
  ctx.strokeStyle = EDGE_ARROW_HIGHLIGHT_COLOR;
  ctx.lineWidth = highlightWidth;
  traceChevron(primaryTipY, halfSpan * EDGE_ARROW_SECONDARY_SPAN_SCALE);
  ctx.stroke();

  ctx.restore();
}
