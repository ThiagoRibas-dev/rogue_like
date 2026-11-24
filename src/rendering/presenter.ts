import type * as ROT from 'rot-js';
import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { PresentationDomain } from '../core/presentation_queue.ts';
import { render } from './renderer.ts';
import { buildViewportSnapshot } from './viewport_snapshot.ts';
import type { ViewportSnapshot } from './viewport_snapshot.types.ts';
import { renderVFXAndFogOverlay } from './ui/vfx_overlay.ui.ts';
import { renderTacticalOverlay } from './ui/tactical_overlay.ui.ts';
import { renderEditorUI } from './editor_ui.ts';
import type { CampaignEditor } from '../editor/campaign_editor.ts';
import { hasSaveGame } from '../core/save.ts';
import { recordRenderSample } from '../core/performance.ts';
import { recordEarlyReturn, recordDisplayCanvas, recordMapRender } from './render_debug.ts';
import { uiStore } from './ui/core/ui_store.ts';

/** Default viewport fallback width when neither ROT.Display nor GameMap provides finite dimensions. */
const DEFAULT_PRESENTER_VIEWPORT_W = 50;
/** Default viewport fallback height when neither ROT.Display nor GameMap provides finite dimensions. */
const DEFAULT_PRESENTER_VIEWPORT_H = 25;

/**
 * Module-level cache of the last rendered ViewportSnapshot to drive dirty-cell diffing.
 */
let lastViewportSnapshot: ViewportSnapshot | undefined;
let lastRenderedAreaId: string | undefined;
let lastRenderedCampaignId: string | undefined;

/**
 * Explicitly invalidates the cached ViewportSnapshot, forcing a full redraw on the next frame.
 */
export function invalidateViewportSnapshot(): void {
  lastViewportSnapshot = undefined;
}

/**
 * Selectively renders dirty Canvas2D viewport layers, pushes reactive UI snapshots into `uiStore`
 * for the Preact shell (`#ui-root`), and coordinates Phase 44 Campaign Editor visibility.
 *
 * @param display The ROT.Display instance for canvas rendering.
 * @param state The current GameState snapshot.
 * @param globalCampaignEditor The CampaignEditor instance for editor mode.
 * @param dirtyDomains Readonly set of presentation domains marked dirty for this frame.
 */
export function renderPresenterFrame(
  display: ROT.Display,
  state: GameState,
  globalCampaignEditor: CampaignEditor,
  dirtyDomains: ReadonlySet<PresentationDomain>
): void {
  if (dirtyDomains.size === 0) {
    recordEarlyReturn('no-dirty-domains');
    return;
  }

  const frameStartMs = performance.now();
  const gameLayout = document.getElementById('game-layout');
  const editorLayout = document.getElementById('editor-layout');

  const hasSave = hasSaveGame();
  uiStore.syncFromPresenter(state, hasSave, dirtyDomains);

  if (state.uiMode === UIMode.Editor) {
    if (gameLayout) gameLayout.classList.add('hidden');
    if (editorLayout) editorLayout.classList.remove('hidden');
    if (dirtyDomains.has(PresentationDomain.Editor) || dirtyDomains.has(PresentationDomain.Modals)) {
      renderEditorUI(state, globalCampaignEditor);
    }
    recordEarlyReturn('editor-mode');
    return;
  }

  if (gameLayout) gameLayout.classList.remove('hidden');
  if (editorLayout) editorLayout.classList.add('hidden');
  renderEditorUI(state, globalCampaignEditor);

  // Invalidate snapshot cache upon area transition or campaign change
  if (lastRenderedAreaId !== state.currentAreaId || lastRenderedCampaignId !== state.campaignId) {
    lastViewportSnapshot = undefined;
    lastRenderedAreaId = state.currentAreaId;
    lastRenderedCampaignId = state.campaignId;
  }

  let snapshotBuildMs = 0;
  let canvasDrawMs = 0;
  let overlaysMs = 0;
  let drawCalls = 0;
  let wasFullRedraw = false;

  // Canvas Viewport Redraw (Map / Entities / Visual Effects)
  if (
    dirtyDomains.has(PresentationDomain.Map) ||
    dirtyDomains.has(PresentationDomain.Entities) ||
    dirtyDomains.has(PresentationDomain.VFX)
  ) {
    const options = display.getOptions();
    const viewportW = options.width ?? (state.map.width > 0 ? state.map.width : DEFAULT_PRESENTER_VIEWPORT_W);
    const viewportH = options.height ?? (state.map.height > 0 ? state.map.height : DEFAULT_PRESENTER_VIEWPORT_H);

    const tSnap0 = performance.now();
    const snapshot = buildViewportSnapshot(state, viewportW, viewportH);
    snapshotBuildMs = performance.now() - tSnap0;

    recordDisplayCanvas(display);
    const previous = lastViewportSnapshot;
    wasFullRedraw =
      !previous ||
      previous.viewportW !== snapshot.viewportW ||
      previous.viewportH !== snapshot.viewportH ||
      previous.isSpriteMode !== snapshot.isSpriteMode;

    const tDraw0 = performance.now();
    drawCalls = render(display, snapshot, previous);
    canvasDrawMs = performance.now() - tDraw0;
    lastViewportSnapshot = snapshot;

    let exploredCells = 0;
    let visibleCells = 0;
    for (const cell of snapshot.cells) {
      if (cell.isExplored) exploredCells++;
      if (cell.isVisible) visibleCells++;
    }
    recordMapRender({
      cells: snapshot.cells.length,
      explored: exploredCells,
      visible: visibleCells,
      drawCalls,
      fullRedraw: wasFullRedraw,
      viewportW,
      viewportH,
      displayWidth: options.width ?? 0,
      displayHeight: options.height ?? 0
    });

    const tOverlays0 = performance.now();
    uiStore.setInspectTooltip(snapshot.inspectTooltip);
    renderVFXAndFogOverlay(
      snapshot.visualEffects,
      snapshot.fogOverlay,
      snapshot.glyphOverlays,
      display,
      viewportW,
      viewportH
    );
    renderTacticalOverlay(snapshot.tactical, display, viewportW, viewportH);
    overlaysMs = performance.now() - tOverlays0;
  }

  const totalRenderMs = performance.now() - frameStartMs;
  recordRenderSample({
    dirtyDomains: Array.from(dirtyDomains),
    snapshotBuildMs,
    canvasDrawMs,
    overlaysMs,
    hudDomainMs: 0,
    logDomainMs: 0,
    inventoryDomainMs: 0,
    modalsDomainMs: 0,
    debugDomainMs: 0,
    totalRenderMs,
    drawCalls,
    fullRedraw: wasFullRedraw
  });
}
