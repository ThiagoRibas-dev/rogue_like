import { isRenderDebugEnabled, renderDebugMetrics } from './render_debug.ts';

/** Anything exposing a ROT-style `getContainer()`. */
export interface DisplayContainerSource {
  getContainer(): unknown;
}

/** A single cell draw request handed to ROT. */
export interface DrawCommandRecord {
  readonly x: number;
  readonly y: number;
  readonly glyph: string;
  readonly sprite: boolean;
}

const MAX_DRAW_LOG = 512;
const drawLog: DrawCommandRecord[] = new Array<DrawCommandRecord>(MAX_DRAW_LOG);
let drawLogCount = 0;
let liveDisplay: DisplayContainerSource | undefined;

/**
 * Records one cell draw request (the last point our code controls before ROT).
 * Recording is gated on debug mode to avoid per-cell overhead in normal play.
 *
 * @param x Viewport column.
 * @param y Viewport row.
 * @param glyph Glyph or sprite key being drawn.
 * @param sprite Whether the draw used the tile backend.
 */
export function recordDrawCommand(x: number, y: number, glyph: string, sprite: boolean): void {
  if (!isRenderDebugEnabled()) return;
  drawLog[drawLogCount % MAX_DRAW_LOG] = { x, y, glyph, sprite };
  drawLogCount++;
}

/**
 * Returns the recorded draw-command log (newest last) plus the total count.
 *
 * Run from the browser console: `window.__renderDebugDraws()`.
 *
 * @returns Total recorded draws and the bounded recent window.
 */
export function getDrawLog(): { readonly total: number; readonly recent: ReadonlyArray<DrawCommandRecord> } {
  const size = Math.min(drawLogCount, MAX_DRAW_LOG);
  const start = drawLogCount > MAX_DRAW_LOG ? drawLogCount : 0;
  const recent: DrawCommandRecord[] = [];
  for (let i = 0; i < size; i++) {
    const entry = drawLog[(start + i) % MAX_DRAW_LOG];
    if (entry !== undefined) recent.push(entry);
  }
  return { total: drawLogCount, recent };
}

/**
 * Records identity/size information for the canvas the display actually draws to,
 * and verifies it is the one mounted in the DOM.
 *
 * @param display The ROT display (or anything exposing `getContainer()`).
 */
export function recordDisplayCanvas(display: DisplayContainerSource): void {
  liveDisplay = display;
  const m = renderDebugMetrics;
  if (typeof document === 'undefined') return;

  const container = document.getElementById('game-canvas-wrapper');
  const canvases = container ? Array.from(container.querySelectorAll('canvas')) : [];
  const live = display.getContainer();

  m.canvasCount = canvases.length;
  m.liveCanvasMounted =
    typeof HTMLCanvasElement !== 'undefined' && live instanceof HTMLCanvasElement && live.parentElement === container;

  if (typeof HTMLCanvasElement !== 'undefined' && live instanceof HTMLCanvasElement) {
    m.liveBackingWidth = live.width;
    m.liveBackingHeight = live.height;
    m.liveCssWidth = live.clientWidth;
    m.liveCssHeight = live.clientHeight;
  }
}

/**
 * Samples the live display canvas to prove whether it contains any drawn pixels,
 * and reports what element sits on top of its centre point.
 *
 * Run from the browser console: `window.__renderDebugSample()`.
 *
 * @returns Pixel counts and overlay info, or null when unavailable.
 */
export function sampleLiveCanvas(): {
  readonly nonBlack: number;
  readonly totalPixels: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly mounted: boolean;
  readonly topElement: string;
  readonly topIsCanvas: boolean;
} | null {
  if (typeof HTMLCanvasElement === 'undefined' || typeof document === 'undefined') return null;

  const live = liveDisplay?.getContainer();
  if (!(live instanceof HTMLCanvasElement)) return null;

  const ctx = live.getContext('2d');
  if (!ctx || live.width === 0 || live.height === 0) return null;

  const data = ctx.getImageData(0, 0, live.width, live.height).data;
  let nonBlack = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 0;
    if (a > 0 && (r > 8 || g > 8 || b > 8)) nonBlack++;
  }

  const rect = live.getBoundingClientRect();
  const topElement =
    rect.width > 0 && rect.height > 0
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null;

  return {
    nonBlack,
    totalPixels: live.width * live.height,
    canvasWidth: live.width,
    canvasHeight: live.height,
    mounted: live.parentElement === document.getElementById('game-canvas-wrapper'),
    topElement: topElement ? `${topElement.tagName.toLowerCase()}#${topElement.id}` : 'none',
    topIsCanvas: topElement === live
  };
}
