import type * as ROT from 'rot-js';
import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { PresentationDomain } from '../core/presentation_queue.ts';
import { render } from './renderer.ts';
import { renderMessageLog, renderPlayerStats, updateHUD } from './ui/hud.ui.ts';
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
  if (dirtyDomains.size === 0) return;

  const gameLayout = document.getElementById('game-layout');
  const editorLayout = document.getElementById('editor-layout');

  if (state.uiMode === UIMode.Editor) {
    if (gameLayout) gameLayout.classList.add('hidden');
    if (editorLayout) editorLayout.classList.remove('hidden');
    if (dirtyDomains.has(PresentationDomain.Editor) || dirtyDomains.has(PresentationDomain.Modals)) {
      renderEditorUI(state, globalCampaignEditor);
    }
    return;
  }

  if (gameLayout) gameLayout.classList.remove('hidden');
  if (editorLayout) editorLayout.classList.add('hidden');

  // Canvas Viewport Redraw (Map / Entities / Visual Effects)
  if (
    dirtyDomains.has(PresentationDomain.Map) ||
    dirtyDomains.has(PresentationDomain.Entities) ||
    dirtyDomains.has(PresentationDomain.VFX)
  ) {
    render(display, state);
  }

  // HUD & Stats Panels
  if (dirtyDomains.has(PresentationDomain.HUD)) {
    renderPlayerStats(state);
    updateHUD(state);
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
  }

  // Debug Overlays
  if (dirtyDomains.has(PresentationDomain.Debug)) {
    renderDebugOverlay(state);
    renderDebugLedgerUI(state);
  }
}
