import type * as ROT from 'rot-js';
import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { PresentationDomain } from '../core/presentation_queue.ts';
import { render } from './renderer.ts';
import { buildViewportSnapshot } from './viewport_snapshot.ts';
import type { ViewportSnapshot } from './viewport_snapshot.types.ts';
import { renderInspectView } from './ui/inspect_view.ui.ts';
import { renderVFXAndFogOverlay } from './ui/vfx_overlay.ui.ts';
import { renderTacticalOverlay } from './ui/tactical_overlay.ui.ts';
import { renderMessageLog, renderPlayerStats, updateHUD } from './ui/hud.ui.ts';
import { renderHudBottomDock } from './ui/hud_bottom_dock.ui.ts';
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
import { renderActiveCartridgeModal, renderCartridgeHudPanel } from './ui/cartridge_ui_registry.ts';
import { renderEditorUI } from './editor_ui.ts';
import type { CampaignEditor } from '../editor/campaign_editor.ts';
import { hasSaveGame } from '../core/save.ts';
import { recordRenderSample } from '../core/performance.ts';
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

  const frameStartMs = performance.now();
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

  let snapshotBuildMs = 0;
  let canvasDrawMs = 0;
  let overlaysMs = 0;
  let hudDomainMs = 0;
  let logDomainMs = 0;
  let inventoryDomainMs = 0;
  let modalsDomainMs = 0;
  let debugDomainMs = 0;
  let drawCalls = 0;
  let wasFullRedraw = false;

  // Canvas Viewport Redraw (Map / Entities / Visual Effects)
  if (
    dirtyDomains.has(PresentationDomain.Map) ||
    dirtyDomains.has(PresentationDomain.Entities) ||
    dirtyDomains.has(PresentationDomain.VFX)
  ) {
    const options = display.getOptions();
    const viewportW = options.width ?? state.map.width;
    const viewportH = options.height ?? state.map.height;

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
    overlaysMs = performance.now() - tOverlays0;
  }

  // HUD & Stats Panels
  if (dirtyDomains.has(PresentationDomain.HUD)) {
    const tHud0 = performance.now();
    renderPlayerStats(state);
    updateHUD(state);
    renderHudBottomDock(state);
    renderHudAlerts(state);
    renderHudDock(state);
    const cartridgeSlot = document.getElementById('hud-cartridge-panel-slot');
    if (cartridgeSlot) {
      const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
      if (playerEntityId !== undefined) {
        renderCartridgeHudPanel(cartridgeSlot, state, playerEntityId);
      } else {
        cartridgeSlot.replaceChildren();
      }
    }
    renderRTwPControls(state);
    renderViewControls(state);
    renderMenus(state, hasSaveGame());
    hudDomainMs = performance.now() - tHud0;
  }

  // Message Log
  if (dirtyDomains.has(PresentationDomain.Log)) {
    const tLog0 = performance.now();
    renderMessageLog(state);
    logDomainMs = performance.now() - tLog0;
  }

  // Inventory & Equipment
  if (dirtyDomains.has(PresentationDomain.Inventory)) {
    const tInv0 = performance.now();
    renderInventoryPanel(state);
    inventoryDomainMs = performance.now() - tInv0;
  }

  // Modals & Overlays
  if (dirtyDomains.has(PresentationDomain.Modals)) {
    const tMod0 = performance.now();
    renderDialoguePanel(state);
    renderVerbMenu(state);
    renderSettingsMenu(state);
    renderFactionsPanel(state);
    renderQuestJournal(state);
    renderInvestigationBoard(state);
    renderDossierUI(state);
    renderHudDock(state);
    renderActiveCartridgeModal(state);
    modalsDomainMs = performance.now() - tMod0;
  }

  // Debug Overlays
  if (dirtyDomains.has(PresentationDomain.Debug)) {
    const tDbg0 = performance.now();
    renderDebugOverlay(state);
    renderDebugLedgerUI(state);
    debugDomainMs = performance.now() - tDbg0;
  }

  const totalRenderMs = performance.now() - frameStartMs;
  recordRenderSample({
    dirtyDomains: Array.from(dirtyDomains),
    snapshotBuildMs,
    canvasDrawMs,
    overlaysMs,
    hudDomainMs,
    logDomainMs,
    inventoryDomainMs,
    modalsDomainMs,
    debugDomainMs,
    totalRenderMs,
    drawCalls,
    fullRedraw: wasFullRedraw
  });
}
