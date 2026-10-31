import type * as ROT from 'rot-js';
import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { PresentationDomain } from '../core/presentation_queue.ts';
import { render } from './renderer.ts';
import { buildViewportSnapshot } from './viewport_snapshot.ts';
import type { ViewportSnapshot } from './viewport_snapshot.types.ts';
import { renderInspectView } from './ui/inspect_view.ui.ts';
import { renderVFXAndFogOverlay } from './ui/vfx_overlay.ui.ts';
import { renderTacticalOverlay } from './ui/tactical_overlay.ui.ts';
import { renderMessageLog, renderPlayerStats, updateHUD } from './ui/hud.ui.ts';
import { renderHudPaperdoll } from './ui/hud_paperdoll.ui.ts';
import { renderHudAlerts } from './ui/hud_alerts.ui.ts';
import { renderHudDock } from './ui/hud_dock.ui.ts';
import { renderInventoryPanel } from './ui/inventory.ui.ts';
import { renderMenus } from './ui/menus.ui.ts';
import { renderRTwPControls, renderViewControls } from './ui/controls.ui.ts';
import { renderSettingsMenu } from './ui/settings.ui.ts';
import { renderFactionsPanel } from './ui/factions.ui.ts';
import { renderDialoguePanel } from './ui/dialogue.ui.ts';
import { renderQuestJournal } from './ui/quest.ui.ts';
import { renderInvestigationBoard } from './ui/investigation.ui.ts';
import { renderDebugOverlay } from './ui/debug.ui.ts';
import { renderVerbMenu } from './ui/verb_menu.ui.ts';
import { renderDossierUI } from './ui/dossier.ui.ts';
import { renderDebugLedgerUI } from './ui/debug_ledger.ui.ts';
import { renderEditorUI } from './editor_ui.ts';
import type { CampaignEditor } from '../editor/campaign_editor.ts';
import { hasSaveGame } from '../core/save.ts';
import { recordEarlyReturn, recordDisplayCanvas, recordMapRender } from './render_debug.ts';

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
 * Selectively renders only the visual and DOM domains that have been marked dirty.
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

  const gameLayout = document.getElementById('game-layout');
  const editorLayout = document.getElementById('editor-layout');

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

  // Canvas Viewport Redraw (Map / Entities / Visual Effects)
  if (
    dirtyDomains.has(PresentationDomain.Map) ||
    dirtyDomains.has(PresentationDomain.Entities) ||
    dirtyDomains.has(PresentationDomain.VFX)
  ) {
    const options = display.getOptions();
    const viewportW = options.width ?? state.map.width;
    const viewportH = options.height ?? state.map.height;

    const snapshot = buildViewportSnapshot(state, viewportW, viewportH);
    recordDisplayCanvas(display);
    const previous = lastViewportSnapshot;
    const wasFullRedraw =
      !previous ||
      previous.viewportW !== snapshot.viewportW ||
      previous.viewportH !== snapshot.viewportH ||
      previous.isSpriteMode !== snapshot.isSpriteMode;
    const drawCalls = render(display, snapshot, previous);
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

    renderInspectView(snapshot.inspectTooltip, display, viewportW, viewportH, snapshot.is3D);
    renderVFXAndFogOverlay(
      snapshot.visualEffects,
      snapshot.fogOverlay,
      snapshot.glyphOverlays,
      display,
      viewportW,
      viewportH
    );
    renderTacticalOverlay(snapshot.tactical, display, viewportW, viewportH);
  }

  // HUD & Stats Panels
  if (dirtyDomains.has(PresentationDomain.HUD)) {
    renderPlayerStats(state);
    updateHUD(state);
    renderHudPaperdoll(state);
    renderHudAlerts(state);
    renderHudDock(state);
    renderRTwPControls(state);
    renderViewControls(state);
    renderMenus(state, hasSaveGame());
  }

  // Message Log
  if (dirtyDomains.has(PresentationDomain.Log)) {
    renderMessageLog(state);
  }

  // Inventory & Equipment
  if (dirtyDomains.has(PresentationDomain.Inventory)) {
    renderInventoryPanel(state);
    renderHudPaperdoll(state);
  }

  // Modals & Overlays
  if (dirtyDomains.has(PresentationDomain.Modals)) {
    renderDialoguePanel(state);
    renderVerbMenu(state);
    renderSettingsMenu(state);
    renderFactionsPanel(state);
    renderQuestJournal(state);
    renderInvestigationBoard(state);
    renderDossierUI(state);
    renderHudDock(state);
  }

  // Debug Overlays
  if (dirtyDomains.has(PresentationDomain.Debug)) {
    renderDebugOverlay(state);
    renderDebugLedgerUI(state);
  }
}
