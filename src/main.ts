import * as ROT from 'rot-js';
import './index.css';
import { clearScheduler } from './core/scheduler.ts';
import { getGameState, setGameState } from './core/game-loop.ts';
import { UIMode } from './types/game-state.types.ts';
import { loadCampaign } from './core/loader.ts';
import { initRNG } from './core/rng.ts';
import { initSettings } from './core/settings.ts';
import { applySettingsToDOM } from './rendering/ui.ts';
import { CampaignEditor } from './editor/campaign_editor.ts';
import { GAME_ASPECT_RATIO_STRING } from './constants/display.constants.ts';
import { createDisplay, mountDisplayWithFogOverlay } from './rendering/display.ts';
import { createInitialMenuState, initSession } from './core/session_controller.ts';
import { registerDnD35eUIAdapter } from './rendering/ui/dnd35e_ui_adapter.ts';

// Global error boundary overlay setup
window.addEventListener('error', (e) => showCrashModal(e.error));
window.addEventListener('unhandledrejection', (e) => showCrashModal(e.reason));

function showCrashModal(err: unknown): void {
  try {
    clearScheduler(); // Stop game loop immediately
  } catch (e) {
    // Ignore if scheduler was not running or not initialized
  }

  let overlay = document.getElementById('crash-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'crash-overlay';
    document.body.appendChild(overlay);
  }

  const stackTrace = err instanceof Error ? err.stack : String(err);
  const errorMessage = err instanceof Error ? err.message : String(err);

  overlay.innerHTML = `
    <div class="crash-modal">
      <h2>Fatal Engine Error</h2>
      <p>The game encountered an unrecoverable error and had to stop.</p>
      <pre class="crash-stacktrace">${errorMessage}\n\n${stackTrace}</pre>
      <div class="crash-actions">
        <button id="btn-crash-menu" class="modal-btn">Return to Main Menu</button>
        <button id="btn-crash-export" class="modal-btn">Download Crash Report</button>
      </div>
    </div>
  `;

  document.getElementById('btn-crash-menu')?.addEventListener('click', () => {
    overlay?.remove();
    // Return to main menu
    const current = getGameState();
    const state = { ...current, uiMode: UIMode.MainMenu };
    setGameState(state);
  });

  document.getElementById('btn-crash-export')?.addEventListener('click', () => {
    const report = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      error: errorMessage,
      stack: stackTrace,
      gameState: getGameState()
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roguelike_crash_report_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// 0. Initialize RNG and Aspect Ratio
initRNG();
registerDnD35eUIAdapter();
document.documentElement.style.setProperty('--game-aspect-ratio', GAME_ASPECT_RATIO_STRING);

// 1. Load default campaign and apply user settings
const defaultCampaign = await loadCampaign('default');
await initSettings('default');
applySettingsToDOM();

// 2. Initialize global editor instance
const globalCampaignEditor = new CampaignEditor(defaultCampaign);

// 3. Create and mount ROT.Display with fog overlay
const defaultCampaignBasePath = `${import.meta.env.BASE_URL}data/campaigns/default`;
const display: ROT.Display = await createDisplay(defaultCampaign, defaultCampaignBasePath, {
  width: defaultCampaign.theme.ui.displayWidth,
  height: defaultCampaign.theme.ui.displayHeight,
  bg: defaultCampaign.theme.colors.background ?? '#000000',
  fg: defaultCampaign.theme.colors.playerFg ?? '#ffffff'
});
mountDisplayWithFogOverlay(display, defaultCampaign);

// 4. Initialize initial menu state and launch presentation session
const initialState = createInitialMenuState('default', defaultCampaign);
initSession(display, globalCampaignEditor, initialState);
