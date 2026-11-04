import type { PresentationDomain } from '../core/presentation_queue.ts';
import { getDrawLog, sampleLiveCanvas } from './render_debug_sampler.ts';

export * from './render_debug_sampler.ts';

/** Aggregate counters/diagnostics for the render pipeline. */
export interface RenderDebugMetrics {
  /** Presenter-loop iterations observed. */
  frames: number;
  /** Iterations that carried at least one dirty domain. */
  framesWithDirty: number;
  /** Iterations that carried the Map domain. */
  framesWithMapDirty: number;
  /** Times the canvas snapshot + renderer actually ran. */
  mapRenderCount: number;
  /** Early-return reasons, keyed by reason, counted. */
  earlyReturns: Record<string, number>;
  /** Domain names present on the most recent frame. */
  lastDirtyDomains: ReadonlyArray<string>;
  /** UI mode of the most recent frame. */
  lastUiMode: string;
  /** Cell count of the most recent snapshot. */
  lastSnapshotCells: number;
  /** Explored cells in the most recent snapshot. */
  lastExploredCells: number;
  /** Visible cells in the most recent snapshot. */
  lastVisibleCells: number;
  /** Cells the renderer emitted draw calls for on the most recent render. */
  lastDrawCalls: number;
  /** Whether the most recent render took the full-redraw path. */
  lastFullRedraw: boolean;
  /** Snapshot viewport width. */
  viewportW: number;
  /** Snapshot viewport height. */
  viewportH: number;
  /** `display.getOptions().width`. */
  displayWidth: number;
  /** `display.getOptions().height`. */
  displayHeight: number;
  /** Mounted canvas `clientWidth` (0 when absent). */
  canvasWidth: number;
  /** Mounted canvas `clientHeight` (0 when absent). */
  canvasHeight: number;
  /** `performance.now()` of the most recent frame. */
  lastFrameAt: number;
  /** Number of `<canvas>` elements inside `#game-canvas-wrapper`. */
  canvasCount: number;
  /** Whether `display.getContainer()` is currently attached to the DOM wrapper. */
  liveCanvasMounted: boolean;
  /** Backing-store width of the live display canvas. */
  liveBackingWidth: number;
  /** Backing-store height of the live display canvas. */
  liveBackingHeight: number;
  /** CSS width of the live display canvas. */
  liveCssWidth: number;
  /** CSS height of the live display canvas. */
  liveCssHeight: number;
  /** Unique templates observed with unresolvable art (e.g. `entity:goblin (no-spriteId)`). */
  missingSprites: string[];
}

/** Live metrics object. Always populated; read via `getRenderDebugMetrics()`. */
export const renderDebugMetrics: RenderDebugMetrics = {
  frames: 0,
  framesWithDirty: 0,
  framesWithMapDirty: 0,
  mapRenderCount: 0,
  earlyReturns: {},
  lastDirtyDomains: [],
  lastUiMode: 'unknown',
  lastSnapshotCells: 0,
  lastExploredCells: 0,
  lastVisibleCells: 0,
  lastDrawCalls: 0,
  lastFullRedraw: false,
  viewportW: 0,
  viewportH: 0,
  displayWidth: 0,
  displayHeight: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  lastFrameAt: 0,
  canvasCount: 0,
  liveCanvasMounted: false,
  liveBackingWidth: 0,
  liveBackingHeight: 0,
  liveCssWidth: 0,
  liveCssHeight: 0,
  missingSprites: []
};

const reportedMissingSprites = new Set<string>();

/**
 * Records a template whose art could not be resolved. Each identifier is stored
 * once (deduplicated), so `__renderDebug.missingSprites` lists exactly which
 * templates fall back to the placeholder sprite.
 *
 * @param identifier Stable identifier, e.g. `entity:goblin (no-spriteId)`.
 */
export function recordMissingSprite(identifier: string): void {
  if (reportedMissingSprites.has(identifier)) return;
  reportedMissingSprites.add(identifier);
  renderDebugMetrics.missingSprites.push(identifier);
  renderDebugLog(`missing sprite: ${identifier}`);
}

let debugEnabled: boolean | undefined;

/**
 * Reports whether verbose render logging is enabled.
 *
 * @returns True when `?renderdebug` is in the URL or `renderDebug` is `'1'` in localStorage.
 */
export function isRenderDebugEnabled(): boolean {
  if (debugEnabled !== undefined) return debugEnabled;

  let enabled = false;
  try {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      enabled = params.has('renderdebug');
    }
    if (!enabled && typeof localStorage !== 'undefined') {
      enabled = localStorage.getItem('renderDebug') === '1';
    }
  } catch {
    enabled = false;
  }

  debugEnabled = enabled;
  return enabled;
}

/**
 * Returns the live metrics object (read-only view).
 *
 * @returns The current render debug metrics.
 */
export function getRenderDebugMetrics(): Readonly<RenderDebugMetrics> {
  return renderDebugMetrics;
}

/**
 * Emits a render-debug log line when verbose logging is enabled.
 *
 * @param message Human-readable message.
 * @param data Optional structured payload.
 */
export function renderDebugLog(message: string, data?: Record<string, unknown>): void {
  if (!isRenderDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.log(`[render-debug] ${message}`, data ?? '');
}

/**
 * Records one presenter-loop iteration.
 *
 * @param dirty Domains consumed for this frame.
 * @param uiMode Current UI mode.
 */
export function recordPresenterFrame(dirty: ReadonlySet<PresentationDomain>, uiMode: string): void {
  const m = renderDebugMetrics;
  m.frames++;
  m.lastUiMode = uiMode;
  m.lastDirtyDomains = Array.from(dirty);
  m.lastFrameAt = typeof performance !== 'undefined' ? performance.now() : 0;

  if (dirty.size > 0) m.framesWithDirty++;
  if (dirty.has('Map' as PresentationDomain)) m.framesWithMapDirty++;

  if (isRenderDebugEnabled() && m.frames <= 3) {
    renderDebugLog(`frame ${m.frames}`, {
      uiMode,
      dirty: m.lastDirtyDomains,
      mapRenders: m.mapRenderCount,
      earlyReturns: m.earlyReturns
    });
  }
}

/**
 * Records an early return (a frame that did not reach the renderer).
 *
 * @param reason Short stable reason key.
 * @param silent When true, count only and never log.
 */
export function recordEarlyReturn(reason: string, silent = false): void {
  const m = renderDebugMetrics;
  const count = (m.earlyReturns[reason] ?? 0) + 1;
  m.earlyReturns[reason] = count;

  if (silent || !isRenderDebugEnabled()) return;
  if (count > 2 && count % 300 !== 0) return;

  renderDebugLog(`early return: ${reason}`, { counts: m.earlyReturns });
}

/**
 * Records a completed canvas map render.
 *
 * @param info Snapshot + renderer outcome for this frame.
 */
export function recordMapRender(info: {
  readonly cells: number;
  readonly explored: number;
  readonly visible: number;
  readonly drawCalls: number;
  readonly fullRedraw: boolean;
  readonly viewportW: number;
  readonly viewportH: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
}): void {
  const m = renderDebugMetrics;
  m.mapRenderCount++;
  m.lastSnapshotCells = info.cells;
  m.lastExploredCells = info.explored;
  m.lastVisibleCells = info.visible;
  m.lastDrawCalls = info.drawCalls;
  m.lastFullRedraw = info.fullRedraw;
  m.viewportW = info.viewportW;
  m.viewportH = info.viewportH;
  m.displayWidth = info.displayWidth;
  m.displayHeight = info.displayHeight;

  const canvas = typeof document !== 'undefined' ? document.querySelector('#game-canvas-wrapper canvas') : null;
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
    m.canvasWidth = canvas.clientWidth;
    m.canvasHeight = canvas.clientHeight;
  } else {
    m.canvasWidth = 0;
    m.canvasHeight = 0;
  }

  const suspicious = info.explored > 0 && info.drawCalls === 0;
  if (suspicious || (isRenderDebugEnabled() && m.mapRenderCount <= 3)) {
    renderDebugLog('map render', {
      cells: info.cells,
      explored: info.explored,
      visible: info.visible,
      drawCalls: info.drawCalls,
      fullRedraw: info.fullRedraw,
      viewport: `${info.viewportW}x${info.viewportH}`,
      display: `${info.displayWidth}x${info.displayHeight}`,
      canvas: `${m.canvasWidth}x${m.canvasHeight}`
    });
  }
}

if (typeof window !== 'undefined') {
  const debugWindow = window as unknown as {
    __renderDebug?: RenderDebugMetrics;
    __renderDebugSample?: () => unknown;
    __renderDebugDraws?: () => unknown;
  };
  debugWindow.__renderDebug = renderDebugMetrics;
  debugWindow.__renderDebugSample = sampleLiveCanvas;
  debugWindow.__renderDebugDraws = getDrawLog;
}
