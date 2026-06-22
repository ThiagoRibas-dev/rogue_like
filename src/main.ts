import * as ROT from 'rot-js';
import './index.css';
import { loadCampaign, loadCampaignRegistry } from './core/loader.ts';
import { type GameState } from './types/game-state.types.ts';
import { UIMode, EngineMode } from './types/game-state.types.ts';
import { render } from './rendering/renderer.ts';
import { initRNG } from './core/rng.ts';
import { initSettings, getSettings, updateSettings, resetSettings, type ActionType } from './core/settings.ts';
import {
  renderInventoryPanel,
  renderMenus,
  renderMessageLog,
  renderPlayerStats,
  renderRTwPControls,
  renderViewControls,
  initUITooltips,
  applySettingsToDOM,
  renderSettingsMenu,
  populateCampaignList,
  renderFactionsPanel,
  renderQuestJournal,
  renderDialoguePanel,
  renderInvestigationBoard,
  renderDebugOverlay,
  renderVerbMenu,
  renderDossierUI
} from './rendering/ui.ts';
import { renderEditorUI } from './rendering/editor_ui.ts';
import { hasSaveGame, getSaveData, setSaveData } from './core/save.ts';
import { setGameState, onStateChange, queuePlayerIntent, getGameState } from './core/game-loop.ts';
import { startNewGame, continueGame, startSandboxEncounter } from './core/bootstrap.ts';
import { handleKeyDown } from './core/input_handler.ts';
import {
  createToggleEngineModeAction,
  createTogglePauseAction,
  createSetRTwPSpeedAction,
  createToggleRotatedAction,
  createToggle3DAction,
  createSetZoomLevelAction,
  createToggleSettingsAction
} from './actions/core.actions.ts';
import { createDebugFastForwardSchemesAction, createDebugPromoteAction } from './actions/debug.actions.ts';
import { getComponent } from './core/ecs.ts';
import { ComponentType } from './types/components.types.ts';
import { CampaignEditor } from './editor/campaign_editor.ts';
import { clearScheduler } from './core/scheduler.ts';
import { installCampaign, getInstalledCampaign, uninstallCampaign } from './core/campaign_store.ts';
import { readCampaignFromZip } from './editor/workspace_file_service.ts';
import { GAME_ASPECT_RATIO_STRING, DEFAULT_ZOOM_LEVEL } from './constants/display.constants.ts';
import { syncDisplayLayout } from './rendering/display.ts';

// 0. Initialize RNG
initRNG();

// Inject CSS Aspect Ratio variable
document.documentElement.style.setProperty('--game-aspect-ratio', GAME_ASPECT_RATIO_STRING);

// Await the default campaign data and settings to bootstrap the engine
const defaultCampaign = await loadCampaign('default');
await initSettings('default');
applySettingsToDOM();

// Initialize the global Editor Controller
const globalCampaignEditor = new CampaignEditor(defaultCampaign);

// 1. Initialize Display Options
const displayOptions = {
  width: defaultCampaign.theme.ui.displayWidth,
  height: defaultCampaign.theme.ui.displayHeight,
  fontSize: defaultCampaign.theme.ui.fontSize,
  fontFamily: defaultCampaign.theme.ui.fontFamily,
  bg: defaultCampaign.theme.colors.background ?? '#000000',
  fg: defaultCampaign.theme.colors.playerFg ?? '#ffffff'
};

// 2. Create the Display
const display: ROT.Display = new ROT.Display(displayOptions);

// 3. Mount the Display to the DOM wrapper
const container: HTMLElement | null = document.getElementById('game-canvas-wrapper');
if (container) {
  const canvasElement: HTMLCanvasElement | null = display.getContainer() as HTMLCanvasElement | null;
  if (canvasElement) {
    container.appendChild(canvasElement);
  }
} else {
  console.error("Failed to find '#game-canvas-wrapper' element in the DOM.");
}

// 4. Initialize the Game State in Main Menu mode
let state: GameState = {
  campaignId: 'default',
  campaign: defaultCampaign,
  entities: [],
  components: new Map(),
  map: { width: defaultCampaign.rules.map.width, height: defaultCampaign.rules.map.height, tiles: [] },
  nextEntityId: 1,
  nextItemInstanceId: 1,
  nextQuestId: 1,
  dynamicQuests: {},
  messages: [],
  events: [],
  currentAreaId: defaultCampaign.rules.map.startingAreaId,
  areas: new Map(),
  persistentEntities: new Map(),
  spatialIndex: new Map(),
  isGameOver: false,
  uiMode: UIMode.MainMenu,
  identifiedItems: new Set(),
  itemUnidentifiedNames: new Map(),
  engineMode: EngineMode.TurnBased,
  visualEffects: [],
  rtwpState: { paused: false, speedMultiplier: 1 },
  isRotated: false,
  is3D: false,
  zoomLevel: DEFAULT_ZOOM_LEVEL,
  fovNeedsUpdate: true,
  cachedFov: new Set(),
  playerCommandQueue: [],
  areaMutations: {},
  pendingKnowledge: [],
  pendingRumors: [],
  investigation: {
    knownActors: [],
    discoveredClues: [],
    exposedAgreements: []
  },
  nemesisSlots: {},
  vacancyTurns: {},
  globalTurn: 0,
  lastCheatDeathTurn: -9999
};

let selectedCampaignId: string | null = null;

async function refreshCampaignList() {
  const registry = await loadCampaignRegistry();
  populateCampaignList(
    registry.campaigns,
    (campaign) => {
      selectedCampaignId = campaign.id;
    },
    async (campaignId) => {
      if (hasSaveGame()) {
        const saveStr = getSaveData();
        if (saveStr && saveStr.includes(`"campaignId":"${campaignId}"`)) {
          if (!confirm('Uninstalling this campaign will orphan your current save file. Continue?')) {
            return;
          }
        }
      } else {
        if (!confirm('Are you sure you want to uninstall this campaign?')) return;
      }
      try {
        await uninstallCampaign(campaignId);
        selectedCampaignId = null;
        await refreshCampaignList();
      } catch (err) {
        alert(`Failed to uninstall campaign: ${(err as Error).message}`);
      }
    }
  );
}
refreshCampaignList();

if (sessionStorage.getItem('editor_playtest') === 'true') {
  sessionStorage.removeItem('editor_playtest');
  setTimeout(() => {
    startNewGame('default', getGameState(), display, (newState) => {
      state = newState;
      setGameState(newState);
    }).catch(console.error);
  }, 50);
}

// Sandbox playtest event from Editor
window.addEventListener('PlaySandboxEncounter', (e: Event) => {
  const customEvent = e as CustomEvent;
  const generatedArea = customEvent.detail.generatedArea;
  if (!generatedArea) return;

  // Clear any running game loops
  clearScheduler();

  startSandboxEncounter('default', getGameState(), display, generatedArea, (newState) => {
    state = newState;
    setGameState(newState);
  }).catch(console.error);
});

// DOM Event Bindings
document.getElementById('btn-new-game')?.addEventListener('click', () => {
  state = { ...getGameState(), uiMode: UIMode.CampaignSelect };
  setGameState(state);
});

document.getElementById('btn-campaign-back')?.addEventListener('click', () => {
  state = { ...getGameState(), uiMode: UIMode.MainMenu };
  setGameState(state);
});

const fileInstallCampaign = document.getElementById('file-install-campaign') as HTMLInputElement | null;
document.getElementById('btn-install-campaign')?.addEventListener('click', () => {
  fileInstallCampaign?.click();
});

fileInstallCampaign?.addEventListener('change', async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  try {
    const campaignData = await readCampaignFromZip(file);
    const existing = await getInstalledCampaign(campaignData.manifest.id);
    if (existing) {
      if (!confirm(`Campaign "${campaignData.manifest.name}" is already installed. Overwrite?`)) {
        target.value = '';
        return;
      }
    }
    await installCampaign(campaignData);
    await refreshCampaignList();
    alert(`Campaign "${campaignData.manifest.name}" installed successfully!`);
    target.value = '';
  } catch (err) {
    alert(`Failed to install campaign: ${(err as Error).message}`);
    console.error(err);
    target.value = '';
  }
});

document.getElementById('btn-campaign-start')?.addEventListener('click', (e) => {
  if (selectedCampaignId) {
    const btn = e.target as HTMLButtonElement;
    const originalText = btn.textContent;
    btn.textContent = 'Loading...';
    btn.disabled = true;

    // Yield to browser to render the loading state
    setTimeout(() => {
      startNewGame(selectedCampaignId!, getGameState(), display, (newState) => {
        state = newState;
        setGameState(newState);
      }).finally(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      });
    }, 50);
  }
});

document.getElementById('btn-continue')?.addEventListener('click', () => {
  continueGame((newState) => {
    state = newState;
    syncDisplayLayout(display, newState);
    setGameState(newState);
  });
});

document.getElementById('btn-return-menu')?.addEventListener('click', () => {
  state = { ...getGameState(), uiMode: UIMode.MainMenu };
  setGameState(state);
});

document.getElementById('btn-dev-tools')?.addEventListener('click', () => {
  // Clear any running game loops
  clearScheduler();
  state = { ...getGameState(), uiMode: UIMode.Editor };
  setGameState(state);
});

const getPlayerId = () => getGameState().entities.find((id) => getComponent(getGameState(), id, ComponentType.Player));

document.getElementById('btn-engine-mode')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createToggleEngineModeAction(pId));
});
document.getElementById('btn-pause')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createTogglePauseAction(pId));
});
document.getElementById('btn-speed-1')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createSetRTwPSpeedAction(pId, 1));
});
document.getElementById('btn-speed-2')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createSetRTwPSpeedAction(pId, 2));
});
document.getElementById('btn-speed-4')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createSetRTwPSpeedAction(pId, 4));
});

document.getElementById('btn-toggle-rotate')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createToggleRotatedAction(pId));
});
document.getElementById('btn-toggle-3d')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createToggle3DAction(pId));
});
document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createSetZoomLevelAction(pId, 0.2));
});
document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createSetZoomLevelAction(pId, -0.2));
});

// Debug
document.getElementById('btn-debug-ff-schemes')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createDebugFastForwardSchemesAction(pId, 10));
});

document.getElementById('btn-debug-promote')?.addEventListener('click', () => {
  const pId = getPlayerId();
  if (pId) queuePlayerIntent(createDebugPromoteAction(pId));
});

// Settings UI Listeners
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnMainMenuSettings = document.getElementById('btn-main-menu-settings');

if (btnOpenSettings && btnCloseSettings) {
  btnOpenSettings.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createToggleSettingsAction(pId));
  });

  btnCloseSettings.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) {
      queuePlayerIntent(createToggleSettingsAction(pId));
    } else {
      state = { ...getGameState(), uiMode: UIMode.MainMenu };
      setGameState(state);
    }
  });
}

if (btnMainMenuSettings) {
  btnMainMenuSettings.addEventListener('click', () => {
    state = { ...getGameState(), uiMode: UIMode.Settings };
    setGameState(state);
  });
}

// Bind settings inputs
const bindSetting = (id: string, key: string, category: 'visualFeedback' | 'accessibility', isCheckbox = true) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const value = isCheckbox ? (target as HTMLInputElement).checked : target.value;
    const current = getSettings();
    if (category === 'visualFeedback') {
      updateSettings({
        visualFeedback: { ...current.visualFeedback, [key]: value } as typeof current.visualFeedback
      });
    } else if (category === 'accessibility') {
      updateSettings({
        accessibility: { ...current.accessibility, [key]: value } as typeof current.accessibility
      });
    }
    applySettingsToDOM();
  });
};

bindSetting('setting-dmg-numbers', 'showDamageNumbers', 'visualFeedback');
bindSetting('setting-status-text', 'showStatusText', 'visualFeedback');
bindSetting('setting-danger-telegraphs', 'showDangerTelegraphs', 'visualFeedback');
bindSetting('setting-ui-scale', 'uiScale', 'accessibility', false);
bindSetting('setting-high-contrast', 'highContrast', 'accessibility');
bindSetting('setting-disable-animations', 'disableAnimations', 'accessibility');

// Rebinding State
let rebindingAction: ActionType | null = null;
const rebindingOverlay = document.getElementById('rebinding-overlay');
const rebindingActionName = document.getElementById('rebinding-action-name');

document.getElementById('keybinds-container')?.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('.keybind-btn') as HTMLButtonElement | null;
  if (!target) return;
  const action = target.dataset.action as ActionType | undefined;
  if (action) {
    rebindingAction = action;
    if (rebindingActionName) {
      rebindingActionName.textContent = action.replace(/_/g, ' ').toUpperCase();
    }
    rebindingOverlay?.classList.remove('hidden');
  }
});

document.getElementById('btn-reset-keybinds')?.addEventListener('click', () => {
  resetSettings();
  renderSettingsMenu();
});

// Export Save
document.getElementById('btn-export-save')?.addEventListener('click', () => {
  const data = getSaveData();
  if (data) {
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roguelike_save_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
});

// Import Save
const fileInput = document.getElementById('file-import-save') as HTMLInputElement | null;
document.getElementById('btn-import-save')?.addEventListener('click', () => {
  fileInput?.click();
});

fileInput?.addEventListener('change', (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const content = event.target?.result as string;
      JSON.parse(content);
      setSaveData(content);
      renderMenus(getGameState(), hasSaveGame());
      target.value = '';
    } catch (err) {
      alert('Invalid save file format!');
      console.error(err);
    }
  };
  reader.readAsText(file);
});

function updateHUD(s: GameState): void {
  const depthElement = document.getElementById('dungeon-depth');
  if (depthElement !== null) {
    depthElement.textContent = s.campaign.areas[s.currentAreaId]?.name ?? s.currentAreaId;
  }

  const hpBarFill = document.querySelector('.health-bar') as HTMLElement | null;
  const hpBarText = document.querySelector('.health-bar + .bar-text') as HTMLElement | null;

  const players = s.entities.filter((id) => getComponent(s, id, ComponentType.Player));
  if (players.length > 0 && players[0] !== undefined) {
    const fighter = getComponent(s, players[0], ComponentType.Fighter);
    if (fighter) {
      if (hpBarFill) {
        const percent = Math.max(0, Math.min(100, Math.round((fighter.hp / fighter.maxHp) * 100)));
        hpBarFill.style.width = `${percent}%`;
      }
      if (hpBarText) {
        hpBarText.textContent = `${fighter.hp} / ${fighter.maxHp}`;
      }
    }
  } else if (s.isGameOver) {
    if (hpBarFill) hpBarFill.style.width = '0%';
    if (hpBarText) hpBarText.textContent = 'DEAD';
  }
}

// Subscribe to state changes to update the UI
onStateChange((newState: GameState) => {
  const gameLayout = document.getElementById('game-layout');
  const editorLayout = document.getElementById('editor-layout');

  if (newState.zoomLevel !== state.zoomLevel) {
    syncDisplayLayout(display, newState);
  }
  state = newState;

  if (newState.uiMode === UIMode.Editor) {
    if (gameLayout) gameLayout.classList.add('hidden');
    if (editorLayout) editorLayout.classList.remove('hidden');
    renderEditorUI(newState, globalCampaignEditor);
  } else {
    if (gameLayout) gameLayout.classList.remove('hidden');
    if (editorLayout) editorLayout.classList.add('hidden');

    render(display, newState);
    renderMessageLog(newState);
    renderPlayerStats(newState);
    renderInventoryPanel(newState);
    renderMenus(newState, hasSaveGame());
    updateHUD(newState);
    renderRTwPControls(newState);
    renderViewControls(newState);
    renderSettingsMenu(newState);
    renderFactionsPanel(newState);
    renderDialoguePanel(newState);
    renderQuestJournal(newState);
    renderInvestigationBoard(newState);
    renderDebugOverlay(newState);
    renderVerbMenu(newState);
    renderDossierUI(newState);
  }
});

// Initialize HUD display values and pass the initial state
setGameState(state);
syncDisplayLayout(display, state);

// Initialize global UI hover tooltips
initUITooltips(getGameState);

// 6. Hook up Keyboard input handlers
window.addEventListener('keydown', (event: KeyboardEvent) => {
  handleKeyDown(event, getGameState(), rebindingAction, (newAction) => {
    rebindingAction = newAction;
  });
});

// 7. Global UI Loop (for transient visual effects)
function globalUILoop() {
  requestAnimationFrame(globalUILoop);
  const currentState = getGameState();
  if (!currentState) return;

  const now = performance.now();
  if (currentState.visualEffects.some((e) => now > e.expiresAt)) {
    const nextEffects = currentState.visualEffects.filter((e) => now <= e.expiresAt);
    setGameState({ ...currentState, visualEffects: nextEffects });
  }
}
requestAnimationFrame(globalUILoop);
