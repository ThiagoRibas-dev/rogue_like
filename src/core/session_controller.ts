import * as ROT from 'rot-js';
import type { CampaignData } from '../types/campaign.types.ts';
import { type GameState, UIMode, EngineMode } from '../types/game-state.types.ts';
import { DEFAULT_ZOOM_LEVEL, RESIZE_DEBOUNCE_MS } from '../constants/display.constants.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../constants/pacing.constants.ts';
import type { CampaignEditor } from '../editor/campaign_editor.ts';
import { setGameState, onStateChange, getGameState } from './game-loop.ts';
import { handleKeyDown } from './input_handler.ts';
import { bindCanvasMouseControls } from './input/mouse_input.ts';
import { perfTracker } from './performance.ts';
import { trapFocus } from '../utils/a11y.ts';
import { initUITooltips } from '../rendering/ui.ts';
import { consumeDirtyDomains, markAllDomainsDirty, markDomainDirty, PresentationDomain } from './presentation_queue.ts';
import { renderPresenterFrame, invalidateViewportSnapshot } from '../rendering/presenter.ts';
import { recordEarlyReturn, recordPresenterFrame } from '../rendering/render_debug.ts';
import { flushPendingSave } from './persistence_service.ts';
import { syncDisplayLayout, configureDisplayForCampaign, syncFogOverlayCanvas } from '../rendering/display.ts';
import { bindDOMControls, refreshRulesetList, refreshCampaignList } from './session/session_dom.ts';
import { bindSettingsControls, rebindingAction, setRebindingAction } from './session/session_settings.ts';

// Re-export DOM and settings helpers
export * from './session/session_dom.ts';
export * from './session/session_settings.ts';

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
      } else if (newState.uiMode === UIMode.RulesetSelect) {
        targetEl = document.getElementById('ruleset-selection-overlay');
      } else if (newState.uiMode === UIMode.CampaignSelect) {
        targetEl = document.getElementById('campaign-selection-overlay');
      } else if (newState.uiMode === UIMode.CharCreation) {
        targetEl = document.getElementById('char-creation-overlay');
      } else if (newState.uiMode === UIMode.LevelUp) {
        targetEl = document.getElementById('level-up-overlay');
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
  refreshRulesetList();
  refreshCampaignList().catch(console.error);
  bindDOMControls(display);
  bindCanvasMouseControls(display);
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
      setRebindingAction(newAction);
    });
  });

  // Start unified 60Hz presenter loop
  startGlobalPresenterLoop(display, globalCampaignEditor);
}
