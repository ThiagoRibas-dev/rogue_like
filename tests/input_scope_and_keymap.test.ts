import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { getGameState, setGameState } from '../src/core/game-loop.ts';
import { clearInputQueue, dequeueIntent, getInputQueueSize } from '../src/core/input_queue.ts';
import { clearModals } from '../src/core/modal_manager.ts';
import { commandRegistry, chordFromKeyboardEvent, formatKeyChord, matchesChord } from '../src/core/input/command_registry.ts';
import { resetMoveThrottle } from '../src/core/input/gameplay_input.ts';
import { InputScopeManager } from '../src/core/input/input_scope_manager.ts';
import { migrateV1KeybindsToV2 } from '../src/core/input/keybind_migration.ts';
import { isEditableElement, isEditableEventTarget } from '../src/core/input/text_input_guard.ts';
import {
  applyKeybindPreset,
  clearCommandSlot,
  getBindingsForCommand,
  migrateSettingsPayload,
  rebindCommandSlot,
  resetCommandBindings,
  resetSettings
} from '../src/core/settings.ts';
import { registerClassicUIAdapter } from '../src/rendering/ui/cartridges/classic/classic_ui_registration.tsx';
import { registerDnD35eUIAdapter } from '../src/rendering/ui/cartridges/dnd35e/dnd35e_ui_registration.tsx';
import { ComponentType } from '../src/types/components.types.ts';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { EngineMode, type EntityId, type GameState, toEntityId, UIMode } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import type { MoveIntent } from '../src/types/intents/movement.intents.ts';

function buildMinimalCampaign(rulesetId: 'classic' | 'dnd35e' = 'dnd35e'): CampaignData {
  return {
    manifest: { id: 'test-camp', name: 'Test', rulesetId, version: '1.0.0' },
    rules: {
      map: { width: 20, height: 20, startingAreaId: 'area1' },
      player: { startX: 5, startY: 5, maxHp: 20, attack: 3, defense: 2 }
    },
    tiles: {},
    items: {},
    actors: {},
    factions: {},
    quests: {},
    dialogues: {},
    areas: {}
  } as unknown as CampaignData;
}

function buildTestState(uiMode: UIMode = UIMode.Game, rulesetId: 'classic' | 'dnd35e' = 'dnd35e'): GameState {
  const playerId = toEntityId(1);
  const components = new Map<EntityId, Record<string, unknown>>();
  components.set(playerId, {
    [ComponentType.Player]: { type: ComponentType.Player },
    [ComponentType.Position]: { type: ComponentType.Position, x: 5, y: 5 },
    [ComponentType.Fighter]: { type: ComponentType.Fighter, hp: 20, maxHp: 20, attack: 3, defense: 2 }
  });

  return {
    campaignId: 'test-camp',
    campaign: buildMinimalCampaign(rulesetId),
    entities: [playerId],
    components: components as GameState['components'],
    map: { width: 20, height: 20, tiles: [] },
    nextEntityId: 2,
    nextItemInstanceId: 1,
    nextQuestId: 1,
    dynamicQuests: {},
    messages: [],
    events: [],
    currentAreaId: 'area1',
    areas: new Map(),
    persistentEntities: new Map(),
    spatialIndex: new Map([['5,5', [playerId]]]),
    isGameOver: false,
    uiMode,
    identifiedItems: new Set(),
    itemUnidentifiedNames: new Map(),
    engineMode: EngineMode.TurnBased,
    visualEffects: [],
    rtwpState: { paused: false, speedMultiplier: 1 },
    isRotated: false,
    is3D: false,
    zoomLevel: 1,
    fovNeedsUpdate: false,
    cachedFov: new Set([5 * 20 + 5]),
    playerCommandQueue: [],
    activeRooms: [],
    lastSpawnTurn: 0,
    pendingKnowledge: [],
    pendingRumors: [],
    pendingRivalries: [],
    factionEntityIds: {},
    areaEntityIds: {},
    investigation: { knownActors: [], exposedAgreements: [], lastClueTurn: 0 },
    historicalLedger: [],
    nemesisSlots: {},
    vacancyTurns: {},
    globalTurn: 1,
    lastCheatDeathTurn: -9999,
    dramaTracker: { globalBudget: 100, domainBudgets: {}, activeCooldowns: {}, lastMajorEventTurn: 0 },
    telemetry: { playerDeaths: 0, damageTaken: 0, resourcesConsumed: 0, questsCompleted: 0 }
  } as unknown as GameState;
}

function makeKeyEvent(
  key: string,
  options: {
    readonly code?: string;
    readonly shiftKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly altKey?: boolean;
    readonly metaKey?: boolean;
    readonly target?: EventTarget | null;
  } = {}
): KeyboardEvent & { readonly defaultPrevented: boolean } {
  let prevented = false;
  return {
    key,
    code: options.code ?? '',
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    target: options.target ?? null,
    preventDefault: (): void => {
      prevented = true;
    },
    get defaultPrevented(): boolean {
      return prevented;
    }
  } as unknown as KeyboardEvent & { readonly defaultPrevented: boolean };
}

describe('Milestone 158: Scoped InputScopeManager, TextInputGuard & Keymap Engine', () => {
  beforeEach(() => {
    resetSettings();
    clearInputQueue();
    clearModals();
    resetMoveThrottle();
  });

  afterEach(() => {
    clearInputQueue();
    clearModals();
    resetMoveThrottle();
  });

  test('TextInputGuard blocks printable/gameplay shortcuts in editable controls while preserving non-text buttons and checkboxes', () => {
    const domWindow = new Window();
    const doc = domWindow.document;

    const textInput = doc.createElement('input');
    textInput.type = 'text';
    const searchInput = doc.createElement('input');
    searchInput.type = 'search';
    const numberInput = doc.createElement('input');
    numberInput.type = 'number';
    const textarea = doc.createElement('textarea');
    const select = doc.createElement('select');
    const contentEditable = doc.createElement('div');
    contentEditable.setAttribute('contenteditable', 'true');
    const textboxRole = doc.createElement('div');
    textboxRole.setAttribute('role', 'textbox');

    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    const button = doc.createElement('button');

    expect(isEditableElement(textInput)).toBe(true);
    expect(isEditableElement(searchInput)).toBe(true);
    expect(isEditableElement(numberInput)).toBe(true);
    expect(isEditableElement(textarea)).toBe(true);
    expect(isEditableElement(select)).toBe(true);
    expect(isEditableElement(contentEditable)).toBe(true);
    expect(isEditableElement(textboxRole)).toBe(true);

    expect(isEditableElement(checkbox)).toBe(false);
    expect(isEditableElement(button)).toBe(false);

    const manager = new InputScopeManager();
    const modalState = buildTestState(UIMode.CartridgeModal);
    (modalState as { activeCartridgeModalId?: string }).activeCartridgeModalId = 'char_creation';

    // Typing 'c', 'i', 'w', ' ', 'z', 'q', 'b' inside character name input MUST NOT trigger shortcuts or enqueue intents
    for (const ch of ['c', 'i', 'w', ' ', 'z', 'q', 'b', 'v', 'n', 'u', 'l']) {
      const ev = makeKeyEvent(ch, { target: textInput as unknown as EventTarget });
      expect(isEditableEventTarget(ev)).toBe(true);
      const handled = manager.dispatchKeyEvent(ev, modalState);
      expect(handled).toBe(false);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(getInputQueueSize()).toBe(0);

    // Checkbox / non-text element in gameplay still allows gameplay keys
    const gameState = buildTestState(UIMode.Game);
    setGameState(gameState);
    const moveEv = makeKeyEvent('w', { code: 'KeyW', target: button as unknown as EventTarget });
    expect(manager.dispatchKeyEvent(moveEv, gameState)).toBe(true);
    expect(getInputQueueSize()).toBe(1);
  });

  test('Browser-safe F1 Help, F6 HUD Focus, Shift+L Ledger, Esc Pause, and unbound F5/F11/F12 work across scopes', () => {
    const manager = new InputScopeManager();
    let helpOpen = false;
    let hudFocusCount = 0;
    let hudFocusActive = false;

    manager.setHelpOverlayHook({
      isOpen: () => helpOpen,
      toggle: () => {
        helpOpen = !helpOpen;
      },
      close: () => {
        helpOpen = false;
      }
    });
    manager.setHudFocusHook({
      isActive: () => hudFocusActive,
      toggleOrCycle: () => {
        hudFocusActive = true;
        hudFocusCount += 1;
      },
      exit: () => {
        hudFocusActive = false;
      }
    });

    const gameState = buildTestState(UIMode.Game);
    setGameState(gameState);

    // F1 calls preventDefault even inside a text input
    const domWindow = new Window();
    const textInput = domWindow.document.createElement('input');
    const f1InText = makeKeyEvent('F1', { code: 'F1', target: textInput as unknown as EventTarget });
    expect(manager.dispatchKeyEvent(f1InText, gameState)).toBe(true);
    expect(f1InText.defaultPrevented).toBe(true);
    expect(helpOpen).toBe(true);
    expect(manager.getPrimaryScope(gameState)).toBe('help_overlay');

    // Esc closes Help without opening Settings
    const escCloseHelp = makeKeyEvent('Escape', { code: 'Escape' });
    expect(manager.dispatchKeyEvent(escCloseHelp, gameState)).toBe(true);
    expect(helpOpen).toBe(false);
    expect(getInputQueueSize()).toBe(0);

    // F6 enters HUD Focus and prevents browser address-bar jump; Esc exits HUD Focus without queuing Pause
    const f6Ev = makeKeyEvent('F6', { code: 'F6' });
    expect(manager.dispatchKeyEvent(f6Ev, gameState)).toBe(true);
    expect(f6Ev.defaultPrevented).toBe(true);
    expect(hudFocusActive).toBe(true);
    expect(hudFocusCount).toBe(1);
    expect(manager.getPrimaryScope(gameState)).toBe('hud_focus');

    const escExitHud = makeKeyEvent('Escape', { code: 'Escape' });
    expect(manager.dispatchKeyEvent(escExitHud, gameState)).toBe(true);
    expect(hudFocusActive).toBe(false);
    expect(getInputQueueSize()).toBe(0);

    // Esc in normal world_gameplay toggles Settings immediately
    const escPause = makeKeyEvent('Escape', { code: 'Escape' });
    expect(manager.dispatchKeyEvent(escPause, gameState)).toBe(true);
    expect(getGameState().uiMode).toBe(UIMode.Settings);

    // Return to Game and press Shift+L to open World Ledger without conflicting with movement
    setGameState(gameState);
    const shiftL = makeKeyEvent('L', { code: 'KeyL', shiftKey: true });
    expect(manager.dispatchKeyEvent(shiftL, gameState)).toBe(true);
    expect(getGameState().uiMode).toBe(UIMode.Ledger);

    // F5 / F11 / F12 remain unbound and never prevented
    setGameState(gameState);
    for (const fnKey of ['F5', 'F11', 'F12']) {
      const fnEv = makeKeyEvent(fnKey, { code: fnKey });
      expect(manager.dispatchKeyEvent(fnEv, gameState)).toBe(false);
      expect(fnEv.defaultPrevented).toBe(false);
    }
  });

  test('8-way diagonals (Numpad 7/9/1/3), Vi-Keys preset, and Editor TextInputGuard (Ctrl+Z vs Ctrl+S)', () => {
    const manager = new InputScopeManager();
    const gameState = buildTestState(UIMode.Game);
    setGameState(gameState);

    // Numpad 7 = NW (-1, -1)
    const num7 = makeKeyEvent('7', { code: 'Numpad7' });
    expect(manager.dispatchKeyEvent(num7, gameState)).toBe(true);
    const nwMove = dequeueIntent() as MoveIntent;
    expect(nwMove.type).toBe(IntentType.Move);
    expect(nwMove.dx).toBe(-1);
    expect(nwMove.dy).toBe(-1);

    // Top-row Digit7 must NOT move NW
    const top7 = makeKeyEvent('7', { code: 'Digit7' });
    expect(matchesChord(top7, { code: 'Numpad7' })).toBe(false);

    // Switching to classic_vi binds 'l' to east, 'y' to NW, and shifts factions to Shift+Y without conflicts
    applyKeybindPreset('classic_vi');
    const viConflicts = commandRegistry.detectConflicts(
      Object.fromEntries(
        commandRegistry.getAllCommands('dnd35e').map((c) => [c.id, getBindingsForCommand(c.id)])
      ),
      'dnd35e'
    );
    expect(viConflicts.some((c) => c.commandId === 'move.nw' || c.otherCommandId === 'move.nw')).toBe(false);

    // Editor scope: Ctrl+Z inside <input> leaves defaultPrevented=false for native undo; outside <input> runs campaign undo
    const domWindow = new Window();
    const editorInput = domWindow.document.createElement('input');
    let undoCalls = 0;
    let saveCalls = 0;
    manager.setEditorHook({
      onUndo: () => {
        undoCalls += 1;
      },
      onRedo: () => {},
      onSave: () => {
        saveCalls += 1;
      }
    });
    const editorState = buildTestState(UIMode.Editor);

    const ctrlZInInput = makeKeyEvent('z', {
      code: 'KeyZ',
      ctrlKey: true,
      target: editorInput as unknown as EventTarget
    });
    expect(manager.dispatchKeyEvent(ctrlZInInput, editorState)).toBe(false);
    expect(ctrlZInInput.defaultPrevented).toBe(false);
    expect(undoCalls).toBe(0);

    const ctrlSInInput = makeKeyEvent('s', {
      code: 'KeyS',
      ctrlKey: true,
      target: editorInput as unknown as EventTarget
    });
    expect(manager.dispatchKeyEvent(ctrlSInInput, editorState)).toBe(true);
    expect(ctrlSInInput.defaultPrevented).toBe(true);
    expect(saveCalls).toBe(1);

    const ctrlZCanvas = makeKeyEvent('z', { code: 'KeyZ', ctrlKey: true });
    expect(manager.dispatchKeyEvent(ctrlZCanvas, editorState)).toBe(true);
    expect(undoCalls).toBe(1);
  });

  test('Cartridge command registration, scoped conflict detection, multi-slot rebind, and lossless v1->v2 migration', () => {
    registerClassicUIAdapter();
    registerDnD35eUIAdapter();

    expect(commandRegistry.getCommand('dnd35e:quickcast')).toBeDefined();
    expect(commandRegistry.getCommand('classic:sheet')).toBeDefined();

    // Multi-slot rebind & conflict resolution
    resetCommandBindings('modern');
    rebindCommandSlot('dnd35e:quickcast', 0, { key: 'k', alt: true }, true);
    const updated = getBindingsForCommand('dnd35e:quickcast');
    expect(updated.length).toBe(1);
    expect(formatKeyChord(updated[0]!)).toBe('Alt+K');

    // Adding a duplicate chord in same scope triggers conflict detection
    rebindCommandSlot('dnd35e:spellbook', 1, { key: 'k', alt: true }, false);
    const conflicts = commandRegistry.detectConflicts(
      Object.fromEntries(
        commandRegistry.getAllCommands('dnd35e').map((c) => [c.id, getBindingsForCommand(c.id)])
      ),
      'dnd35e'
    );
    expect(
      conflicts.some(
        (c) =>
          (c.commandId === 'dnd35e:quickcast' && c.otherCommandId === 'dnd35e:spellbook') ||
          (c.commandId === 'dnd35e:spellbook' && c.otherCommandId === 'dnd35e:quickcast')
      )
    ).toBe(true);

    clearCommandSlot('dnd35e:spellbook', 1);

    // Lossless v1->v2 migration: fixes stock ledger=['l'] collision while keeping custom bindings
    const migrated = migrateV1KeybindsToV2({
      ledger: ['l'],
      inventory: ['b'],
      move_north: ['arrowup', 'w', 'k', '8']
    });
    expect(migrated['panel.ledger']).toEqual([{ key: 'l', shift: true }]);
    expect(migrated['panel.inventory']).toEqual([{ key: 'b' }]);
    expect(migrated['move.north']).toEqual([{ code: 'ArrowUp' }, { key: 'w' }, { code: 'Numpad8' }]);

    const fullSettings = migrateSettingsPayload({
      keybinds: { quests: ['j'] },
      accessibility: { uiScale: 'normal', highContrast: true, disableAnimations: false }
    });
    expect(fullSettings.settingsVersion).toBe(2);
    expect(fullSettings.commandBindings?.['panel.quests']).toEqual([{ key: 'j' }]);
    expect(fullSettings.accessibility.highContrast).toBe(true);

    const captured = chordFromKeyboardEvent(makeKeyEvent('L', { code: 'KeyL', shiftKey: true }));
    expect(captured).toEqual({ key: 'l', shift: true });
  });

  test('Turn-based move throttle never drops the first move at startup (< 200ms) while throttling rapid repeats', () => {
    const manager = new InputScopeManager();
    const gameState = buildTestState(UIMode.Game);
    setGameState(gameState);

    const originalNow = performance.now.bind(performance);
    let fakeNowMs = 10;
    (performance as { now: () => number }).now = (): number => fakeNowMs;

    try {
      resetMoveThrottle();
      expect(manager.dispatchKeyEvent(makeKeyEvent('w', { code: 'KeyW' }), gameState)).toBe(true);
      expect(getInputQueueSize()).toBe(1);

      // Subsequent move within 200ms is throttled
      fakeNowMs = 60;
      expect(manager.dispatchKeyEvent(makeKeyEvent('d', { code: 'KeyD' }), gameState)).toBe(true);
      expect(getInputQueueSize()).toBe(1);

      // Once >= 200ms has elapsed, movement resumes
      fakeNowMs = 215;
      expect(manager.dispatchKeyEvent(makeKeyEvent('d', { code: 'KeyD' }), gameState)).toBe(true);
      expect(getInputQueueSize()).toBe(2);
    } finally {
      (performance as { now: () => number }).now = originalNow;
      resetMoveThrottle();
    }
  });
});
