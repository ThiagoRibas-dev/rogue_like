import * as ROT from 'rot-js';
import type { CampaignData } from '../types/campaign.types.ts';
import { type GameState, type EntityId, UIMode, EngineMode } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from './ecs.ts';
import { DEFAULT_ZOOM_LEVEL, RESIZE_DEBOUNCE_MS } from '../constants/display.constants.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../constants/pacing.constants.ts';
import { loadCampaignRegistry } from './loader.ts';
import type { CampaignEditor } from '../editor/campaign_editor.ts';
import { clearScheduler } from './scheduler.ts';
import { installCampaign, getInstalledCampaign, uninstallCampaign } from './campaign_store.ts';
import { readCampaignFromZip } from '../editor/workspace_file_service.ts';
import { hasSaveGame, getSaveData, setSaveData, CampaignNotFoundError } from './save.ts';
import { setGameState, onStateChange, queuePlayerIntent, getGameState } from './game-loop.ts';
import { startNewGame, continueGame } from './bootstrap.ts';
import { startSandboxEncounter } from './bootstrap_sandbox.ts';
import { handleKeyDown } from './input_handler.ts';
import { perfTracker } from './performance.ts';
import { trapFocus } from '../utils/a11y.ts';
import { getActiveReplay } from './replay.ts';
import { getSettings, updateSettings, resetSettings, type ActionType } from './settings.ts';
import {
  applySettingsToDOM,
  initUITooltips,
  renderSettingsMenu,
  populateCampaignList,
  renderMenus
} from '../rendering/ui.ts';
import { consumeDirtyDomains, markAllDomainsDirty, markDomainDirty, PresentationDomain } from './presentation_queue.ts';
import { renderPresenterFrame, invalidateViewportSnapshot } from '../rendering/presenter.ts';
import { recordEarlyReturn, recordPresenterFrame } from '../rendering/render_debug.ts';
import { flushPendingSave } from './persistence_service.ts';
import { syncDisplayLayout, configureDisplayForCampaign, syncFogOverlayCanvas } from '../rendering/display.ts';
import {
  createToggleEngineModeAction,
  createTogglePauseAction,
  createSetRTwPSpeedAction,
  createToggleRotatedAction,
  createToggle3DAction,
  createSetZoomLevelAction,
  createToggleSettingsAction
} from '../actions/core.actions.ts';
import { createDebugFastForwardSchemesAction, createDebugPromoteAction } from '../actions/debug.actions.ts';
import { initRNG } from './rng.ts';

let selectedCampaignId: string | null = null;
let rebindingAction: ActionType | null = null;
let activeFocusCleanup: (() => void) | null = null;
let currentFocusMode: UIMode | null = null;
let lastKnownState: GameState | null = null;

/**
 * Creates the initial default GameState in MainMenu mode.
 */
export function createInitialMenuState(campaignId: string, campaign: CampaignData): GameState {
  return {
    campaignId,
    campaign,
    entities: [],
    components: new Map(),
    map: { width: campaign.rules.map.width, height: campaign.rules.map.height, tiles: [] },
    nextEntityId: 1,
    nextItemInstanceId: 1,
    nextQuestId: 1,
    dynamicQuests: {},
    messages: [],
    events: [],
    currentAreaId: campaign.rules.map.startingAreaId,
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
    activeRooms: [],
    lastSpawnTurn: 0,
    pendingKnowledge: [],
    pendingRumors: [],
    pendingRivalries: [],
    factionEntityIds: {},
    areaEntityIds: {},
    investigation: {
      knownActors: [],
      exposedAgreements: [],
      lastClueTurn: 0
    },
    historicalLedger: [],
    nemesisSlots: {},
    vacancyTurns: {},
    globalTurn: 0,
    lastCheatDeathTurn: -9999,
    dramaTracker: {
      globalBudget: DEFAULT_GLOBAL_DRAMA_BUDGET,
      domainBudgets: {},
      activeCooldowns: {},
      lastMajorEventTurn: 0
    },
    telemetry: {
      playerDeaths: 0,
      damageTaken: 0,
      resourcesConsumed: 0,
      questsCompleted: 0
    }
  };
}

/**
 * Refreshes the campaign list in the campaign selection modal.
 */
export async function refreshCampaignList(): Promise<void> {
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

function getPlayerId(): EntityId | undefined {
  return getGameState().entities.find((id) => getComponent(getGameState(), id, ComponentType.Player));
}

function triggerReplayDownload(): void {
  const replay = getActiveReplay();
  if (replay) {
    const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roguelike_replay_${replay.campaignId}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    alert('No active replay found!');
  }
}

/**
 * Binds DOM action buttons and editor playtest hooks.
 */
export function bindDOMControls(display: ROT.Display): void {
  document.getElementById('btn-new-game')?.addEventListener('click', () => {
    setGameState({ ...getGameState(), uiMode: UIMode.CampaignSelect });
  });

  document.getElementById('btn-campaign-back')?.addEventListener('click', () => {
    setGameState({ ...getGameState(), uiMode: UIMode.MainMenu });
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

      setTimeout(() => {
        startNewGame(selectedCampaignId!, getGameState(), display, (newState) => {
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
      syncDisplayLayout(display, newState);
      setGameState(newState);
    }).catch((err) => {
      if (err instanceof CampaignNotFoundError) {
        alert(`Failed to load save game: ${err.message}\n\nPlease reinstall the missing campaign or start a new game.`);
      } else {
        throw err;
      }
    });
  });

  document.getElementById('btn-return-menu')?.addEventListener('click', () => {
    setGameState({ ...getGameState(), uiMode: UIMode.MainMenu });
  });

  document.getElementById('btn-dev-tools')?.addEventListener('click', () => {
    clearScheduler();
    setGameState({ ...getGameState(), uiMode: UIMode.Editor });
  });

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

  document.getElementById('btn-debug-ff-schemes')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createDebugFastForwardSchemesAction(pId, 10));
  });
  document.getElementById('btn-debug-promote')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createDebugPromoteAction(pId));
  });

  // Editor playtest bootstrapping
  if (sessionStorage.getItem('editor_playtest') === 'true') {
    sessionStorage.removeItem('editor_playtest');
    const playtestSeed = sessionStorage.getItem('editor_playtest_seed');
    if (playtestSeed) {
      sessionStorage.removeItem('editor_playtest_seed');
      initRNG(Number(playtestSeed));
    }

    // Read contextual spawn override if set by area editor (Decision D5)
    const spawnOverrideRaw = sessionStorage.getItem('editor_playtest_spawn');
    let spawnOverride: { areaId: string; x: number; y: number } | undefined;
    if (spawnOverrideRaw) {
      try {
        const parsed = JSON.parse(spawnOverrideRaw);
        if (
          parsed &&
          typeof parsed.areaId === 'string' &&
          typeof parsed.x === 'number' &&
          typeof parsed.y === 'number'
        ) {
          spawnOverride = parsed;
        }
      } catch {
        // Ignore invalid spawn override
      }
      sessionStorage.removeItem('editor_playtest_spawn');
    }

    setTimeout(() => {
      startNewGame(
        'default',
        getGameState(),
        display,
        (newState) => {
          setGameState(newState);
        },
        undefined,
        spawnOverride
      ).catch(console.error);
    }, 50);
  }

  // Sandbox playtest event from Editor
  window.addEventListener('PlaySandboxEncounter', (e: Event) => {
    const customEvent = e as CustomEvent;
    const generatedArea = customEvent.detail.generatedArea;
    if (!generatedArea) return;

    clearScheduler();
    startSandboxEncounter('default', getGameState(), display, generatedArea, (newState) => {
      setGameState(newState);
    }).catch(console.error);
  });
}

/**
 * Binds Settings panel inputs, key rebinding overlay, save import/export, and replay download.
 */
export function bindSettingsControls(): void {
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
        setGameState({ ...getGameState(), uiMode: UIMode.MainMenu });
      }
    });
  }

  if (btnMainMenuSettings) {
    btnMainMenuSettings.addEventListener('click', () => {
      setGameState({ ...getGameState(), uiMode: UIMode.Settings });
    });
  }

  const bindSetting = (
    id: string,
    key: string,
    category: 'visualFeedback' | 'accessibility',
    isCheckbox = true
  ): void => {
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

  document.getElementById('btn-download-replay-settings')?.addEventListener('click', triggerReplayDownload);
  document.getElementById('btn-download-replay-gameover')?.addEventListener('click', triggerReplayDownload);

  const fileInput = document.getElementById('file-import-save') as HTMLInputElement | null;
  document.getElementById('btn-import-save')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        if (!parsed.campaignId) {
          throw new Error('Save file is missing required campaign information.');
        }

        const registry = await loadCampaignRegistry();
        const exists = registry.campaigns.some((c) => c.id === parsed.campaignId);
        if (!exists) {
          throw new Error(
            `This save requires campaign "${parsed.campaignId}", which is not installed. Please install it first.`
          );
        }

        setSaveData(content);
        renderMenus(getGameState(), hasSaveGame());
        alert('Save game imported successfully!');
        target.value = '';
      } catch (err) {
        alert(`Failed to import save: ${(err as Error).message}`);
        console.error(err);
        target.value = '';
      }
    };
    reader.readAsText(file);
  });
}

/**
 * Binds the reactive state subscriber for display synchronization and focus trapping.
 */
export function bindStateSubscription(display: ROT.Display, _globalCampaignEditor: CampaignEditor): void {
  onStateChange((newState: GameState) => {
    if (lastKnownState && newState.campaignId !== lastKnownState.campaignId) {
      const basePath = `${import.meta.env.BASE_URL}data/campaigns/${newState.campaignId}`;
      configureDisplayForCampaign(display, newState.campaign, basePath)
        .then(() => {
          syncFogOverlayCanvas(newState.campaign);
          syncDisplayLayout(display, newState);
          invalidateViewportSnapshot();
          markAllDomainsDirty();
        })
        .catch(console.error);
    }

    if (lastKnownState && newState.zoomLevel !== lastKnownState.zoomLevel) {
      syncDisplayLayout(display, newState);
      invalidateViewportSnapshot();
      markDomainDirty(PresentationDomain.Map);
    }
    lastKnownState = newState;

    if (newState.uiMode !== currentFocusMode) {
      if (activeFocusCleanup) {
        activeFocusCleanup();
        activeFocusCleanup = null;
      }
      currentFocusMode = newState.uiMode;

      let targetEl: HTMLElement | null = null;
      if (newState.uiMode === UIMode.Settings) {
        targetEl = document.getElementById('settings-overlay');
      } else if (newState.uiMode === UIMode.Dialogue) {
        targetEl = document.getElementById('dialogue-overlay');
      } else if (newState.uiMode === UIMode.CampaignSelect) {
        targetEl = document.getElementById('campaign-selection-overlay');
      } else if (newState.uiMode === UIMode.GameOver) {
        targetEl = document.getElementById('game-over-screen');
      }

      if (targetEl) {
        setTimeout(() => {
          if (targetEl && currentFocusMode === newState.uiMode) {
            activeFocusCleanup = trapFocus(targetEl);
          }
        }, 50);
      }
    }
  });
}

/**
 * Starts the unified 60Hz presentation loop, rendering dirty domains and pruning expired VFX.
 */
export function startGlobalPresenterLoop(display: ROT.Display, globalCampaignEditor: CampaignEditor): void {
  function presenterLoop(): void {
    requestAnimationFrame(presenterLoop);
    const currentState = getGameState();
    if (!currentState) return;

    // Check transient visual effect expiration without triggering full persistence cascades
    const now = performance.now();
    if (currentState.visualEffects.some((e) => now > e.expiresAt)) {
      const nextEffects = currentState.visualEffects.filter((e) => now <= e.expiresAt);
      setGameState({ ...currentState, visualEffects: nextEffects });
      markDomainDirty(PresentationDomain.VFX);
    }

    const dirtyDomains = consumeDirtyDomains();
    recordPresenterFrame(dirtyDomains, currentState.uiMode);
    if (dirtyDomains.size === 0) {
      // Idle frames fire every animation frame; count them, never log them.
      recordEarlyReturn('loop-idle', true);
      return;
    }

    const renderTime0 = performance.now();
    renderPresenterFrame(display, currentState, globalCampaignEditor, dirtyDomains);
    perfTracker.lastRenderTimeMs = performance.now() - renderTime0;
  }

  requestAnimationFrame(presenterLoop);
}

/**
 * Re-synchronises the display layout, fog overlay and canvas after the viewport
 * size changes, forcing a full redraw (dirty-cell diffing would otherwise skip
 * cells because the snapshot dimensions changed).
 *
 * Exported so regression tests can exercise it without a real window resize.
 *
 * @param display The ROT.Display instance.
 * @param state The current GameState (supplies theme + zoom + campaign).
 */
export function applyViewportResize(display: ROT.Display, state: GameState): void {
  syncDisplayLayout(display, state);
  syncFogOverlayCanvas(state.campaign);
  invalidateViewportSnapshot();
  markAllDomainsDirty();
}

/**
 * Initializes the full presentation and session lifecycle.
 */
export function initSession(display: ROT.Display, globalCampaignEditor: CampaignEditor, initialState: GameState): void {
  lastKnownState = initialState;
  refreshCampaignList().catch(console.error);
  bindDOMControls(display);
  bindSettingsControls();
  bindStateSubscription(display, globalCampaignEditor);

  // Hook window beforeunload to flush pending saves
  window.addEventListener('beforeunload', () => {
    flushPendingSave();
  });

  // Re-layout and fully redraw after a viewport resize (debounced).
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyViewportResize(display, getGameState());
    }, RESIZE_DEBOUNCE_MS);
  });

  // Initialize HUD and pass initial state to loop
  setGameState(initialState);
  markAllDomainsDirty();
  syncDisplayLayout(display, initialState);
  initUITooltips(getGameState);

  // Hook keyboard input
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    handleKeyDown(event, getGameState(), rebindingAction, (newAction) => {
      rebindingAction = newAction;
    });
  });

  // Start unified 60Hz presenter loop
  startGlobalPresenterLoop(display, globalCampaignEditor);
}
