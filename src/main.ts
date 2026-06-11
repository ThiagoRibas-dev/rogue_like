import * as ROT from 'rot-js';
import './index.css';
import { loadCampaign, loadCampaignRegistry } from './core/loader.ts';
import { type GameState, type EntityId } from './types/game-state.types.ts';
import {
  ComponentType,
  type PositionComponent,
  type RenderableComponent,
  type InteractableComponent,
  type InventoryComponent,
  type EquipmentComponent,
  type ItemComponent
} from './types/components.types.ts';
import { addComponent, createEntity, spawnEntity, spawnItem, getComponent } from './core/ecs.ts';
import { Direction } from './utils/direction.ts';
import { render } from './rendering/renderer.ts';
import { initRNG } from './core/rng.ts';
import {
  initSettings,
  isAction,
  getSettings,
  updateSettings,
  rebindAction,
  resetSettings,
  type ActionType
} from './core/settings.ts';
import { addMessage, MessageLogCategory } from './systems/message.system.ts';
import {
  renderMessageLog,
  renderInventoryPanel,
  renderPlayerStats,
  renderMenus,
  renderRTwPControls,
  renderViewControls,
  initUITooltips,
  applySettingsToDOM,
  renderSettingsMenu,
  populateCampaignList
} from './rendering/ui.ts';
import { hasSaveGame, deleteSave, loadGame, getSaveData, setSaveData } from './core/save.ts';
import { clearScheduler } from './core/scheduler.ts';
import { generateArea } from './map/generator.ts';
import { updateExploredTiles } from './systems/map.system.ts';
import { initEngine, startEngine, addActor } from './core/scheduler.ts';
import { setGameState, onStateChange, queuePlayerIntent, getGameState } from './core/game-loop.ts';
import {
  createMoveAction,
  createWaitAction,
  createInteractAction,
  createToggleEngineModeAction,
  createTogglePauseAction,
  createSetRTwPSpeedAction,
  createToggleRotatedAction,
  createToggle3DAction,
  createSetZoomLevelAction,
  createToggleSettingsAction
} from './actions/core.actions.ts';
import {
  createDebugRevealMapAction,
  createDebugGodModeAction,
  createDebugSpawnEntityAction
} from './actions/debug.actions.ts';
import {
  createToggleTargetingAction,
  createMoveTargetAction,
  createFireAimedAction
} from './actions/targeting.actions.ts';
import { createToggleInspectAction, createMoveInspectAction } from './actions/inspect.actions.ts';
import {
  createPickUpAction,
  createDropAction,
  createUseItemAction,
  createToggleInventoryAction,
  createEquipItemAction,
  createUnequipItemAction
} from './actions/inventory.actions.ts';
import { IntentType, type ChangeAreaIntent } from './types/intents.types.ts';
import { UIMode, EngineMode } from './types/game-state.types.ts';
import { getDirectionDelta } from './utils/direction.ts';

// 0. Initialize RNG
initRNG();

// Await the default campaign data and settings to bootstrap the engine
const defaultCampaign = await loadCampaign('default');
const campaignRegistry = await loadCampaignRegistry();
await initSettings('default');
applySettingsToDOM();

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
let playerEntityId: EntityId = -1 as unknown as EntityId; // Will be set when game starts

let state: GameState = {
  campaignId: 'default',
  campaign: defaultCampaign,
  entities: [],
  components: new Map(),
  map: { width: defaultCampaign.rules.map.width, height: defaultCampaign.rules.map.height, tiles: [] },
  nextEntityId: 1,
  nextItemInstanceId: 1,
  messages: [],
  events: [],
  currentAreaId: defaultCampaign.rules.map.startingAreaId,
  areas: new Map(),
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
  zoomLevel: 1.0,
  playerCommandQueue: []
};

const POTION_DESCRIPTORS = [
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Purple',
  'Murky',
  'Bubbling',
  'Clear',
  'Swirling',
  'Thick'
];
const SCROLL_DESCRIPTORS = ['Scorched', 'Runed', 'Faded', 'Tattered', 'Glowing', 'Crumbling', 'Blood-Stained', 'Dusty'];

async function startNewGame(campaignId: string) {
  const newCampaign = await loadCampaign(campaignId);

  state = {
    ...state,
    campaignId,
    campaign: newCampaign
  };

  display.setOptions({
    width: newCampaign.theme.ui.displayWidth,
    height: newCampaign.theme.ui.displayHeight,
    fontSize: newCampaign.theme.ui.fontSize,
    fontFamily: newCampaign.theme.ui.fontFamily,
    bg: newCampaign.theme.colors.background ?? '#000000',
    fg: newCampaign.theme.colors.playerFg ?? '#ffffff'
  });

  deleteSave();
  clearScheduler();
  initEngine();

  const itemUnidentifiedNames = new Map<string, string>();
  const potionDesc = [...POTION_DESCRIPTORS].sort(() => ROT.RNG.getUniform() - 0.5);
  const scrollDesc = [...SCROLL_DESCRIPTORS].sort(() => ROT.RNG.getUniform() - 0.5);

  let pIdx = 0;
  let sIdx = 0;

  for (const [id, def] of Object.entries(state.campaign.items)) {
    if (def.category === 'consumable') {
      if (def.id.includes('potion')) {
        itemUnidentifiedNames.set(id, `${potionDesc[pIdx++ % potionDesc.length]} Potion`);
      } else if (def.id.includes('scroll')) {
        itemUnidentifiedNames.set(id, `${scrollDesc[sIdx++ % scrollDesc.length]} Scroll`);
      }
    }
  }

  const {
    map: initialMap,
    startPos,
    portals,
    rooms
  } = generateArea(state.campaign, state.campaign.rules.map.startingAreaId);
  state = {
    ...state,
    map: initialMap,
    uiMode: UIMode.Game,
    isGameOver: false,
    entities: [],
    components: new Map(),
    spatialIndex: new Map(),
    messages: [],
    currentAreaId: state.campaign.rules.map.startingAreaId,
    areas: new Map(),
    identifiedItems: new Set(),
    itemUnidentifiedNames,
    visualEffects: [],
    isRotated: state.isRotated, // preserve setting
    is3D: state.is3D, // preserve setting
    zoomLevel: state.zoomLevel, // preserve setting
    playerCommandQueue: []
  };

  // Spawn the player entity
  const [stateAfterPlayerSpawn, newPlayerEntityId] = spawnEntity(state, 'player', startPos.x, startPos.y);
  state = stateAfterPlayerSpawn;
  playerEntityId = newPlayerEntityId;

  // Spawn monsters in rooms
  for (let i = 1; i < rooms.length; i++) {
    const room = rooms[i];
    if (!room) continue;

    const numMonsters = ROT.RNG.getUniformInt(0, state.campaign.rules.spawning.maxMonstersPerRoom);
    for (let m = 0; m < numMonsters; m++) {
      const mx = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
      const my = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
      const template =
        ROT.RNG.getWeightedValue(state.campaign.rules.spawning.spawnWeights as Record<string, number>) || 'orc';
      [state] = spawnEntity(state, template, mx, my);
    }

    // Spawn items in this room
    const numItems = ROT.RNG.getUniformInt(0, state.campaign.rules.spawning.maxItemsPerRoom);
    for (let n = 0; n < numItems; n++) {
      const ix = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
      const iy = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
      const itemId =
        ROT.RNG.getWeightedValue(state.campaign.rules.spawning.lootTable as Record<string, number>) || 'health_potion';
      [state] = spawnItem(state, itemId, ix, iy);
    }
  }

  // Spawn the portals for the first floor
  for (const portal of portals) {
    let stairId: EntityId;
    [state, stairId] = createEntity(state);

    const pos: PositionComponent = { type: ComponentType.Position, x: portal.x, y: portal.y };
    const renderCmp: RenderableComponent = {
      type: ComponentType.Renderable,
      glyph:
        portal.connection.direction === 'up'
          ? (state.campaign.theme.glyphs.stairsUp ?? '<')
          : (state.campaign.theme.glyphs.stairsDown ?? '>'),
      fg: state.campaign.theme.colors.stairsFg ?? '#ffffff',
      bg: state.campaign.theme.colors.transparent ?? 'transparent'
    };
    const interactable: InteractableComponent = {
      type: ComponentType.Interactable,
      intents: [
        {
          type: IntentType.ChangeArea,
          targetAreaId: portal.connection.targetAreaId,
          targetX: portal.connection.targetX,
          targetY: portal.connection.targetY
        } as ChangeAreaIntent
      ]
    };

    state = addComponent(state, stairId, pos);
    state = addComponent(state, stairId, renderCmp);
    state = addComponent(state, stairId, interactable);
  }

  // Initial FOV compute
  state = updateExploredTiles(state);

  // Add initial startup messages
  state = addMessage(state, 'Welcome to the Dungeon, Adventurer!', MessageLogCategory.System);

  for (const id of state.entities) {
    const actor = getComponent(state, id, ComponentType.Actor);
    if (actor) {
      addActor(id);
    }
  }

  setGameState(state);
  startEngine();
}

async function continueGame() {
  const loadedState = await loadGame();
  if (loadedState) {
    state = { ...loadedState, playerCommandQueue: [] };
    playerEntityId = state.entities.find(
      (id) => getComponent(state, id, ComponentType.Player) !== undefined
    ) as EntityId;

    clearScheduler();
    initEngine();

    for (const id of state.entities) {
      const actor = getComponent(state, id, ComponentType.Actor);
      if (actor) {
        addActor(id);
      }
    }

    setGameState(state);
    startEngine();
  }
}

let selectedCampaignId: string | null = null;
populateCampaignList(campaignRegistry.campaigns, (campaign) => {
  selectedCampaignId = campaign.id;
});

document.getElementById('btn-new-game')?.addEventListener('click', () => {
  state = { ...state, uiMode: UIMode.CampaignSelect };
  setGameState(state);
});

document.getElementById('btn-campaign-back')?.addEventListener('click', () => {
  state = { ...state, uiMode: UIMode.MainMenu };
  setGameState(state);
});

document.getElementById('btn-campaign-start')?.addEventListener('click', () => {
  if (selectedCampaignId) {
    startNewGame(selectedCampaignId);
  }
});

document.getElementById('btn-continue')?.addEventListener('click', continueGame);
document.getElementById('btn-return-menu')?.addEventListener('click', () => {
  state = { ...state, uiMode: UIMode.MainMenu };
  setGameState(state);
});

document.getElementById('btn-engine-mode')?.addEventListener('click', () => {
  queuePlayerIntent(createToggleEngineModeAction(playerEntityId));
});
document.getElementById('btn-pause')?.addEventListener('click', () => {
  queuePlayerIntent(createTogglePauseAction(playerEntityId));
});
document.getElementById('btn-speed-1')?.addEventListener('click', () => {
  queuePlayerIntent(createSetRTwPSpeedAction(playerEntityId, 1));
});
document.getElementById('btn-speed-2')?.addEventListener('click', () => {
  queuePlayerIntent(createSetRTwPSpeedAction(playerEntityId, 2));
});
document.getElementById('btn-speed-4')?.addEventListener('click', () => {
  queuePlayerIntent(createSetRTwPSpeedAction(playerEntityId, 4));
});

document.getElementById('btn-toggle-rotate')?.addEventListener('click', () => {
  queuePlayerIntent(createToggleRotatedAction(playerEntityId));
});
document.getElementById('btn-toggle-3d')?.addEventListener('click', () => {
  queuePlayerIntent(createToggle3DAction(playerEntityId));
});
document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
  queuePlayerIntent(createSetZoomLevelAction(playerEntityId, 0.2));
});
document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
  queuePlayerIntent(createSetZoomLevelAction(playerEntityId, -0.2));
});

// Settings UI Listeners
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnMainMenuSettings = document.getElementById('btn-main-menu-settings');

if (btnOpenSettings && btnCloseSettings) {
  btnOpenSettings.addEventListener('click', () => {
    queuePlayerIntent(createToggleSettingsAction(playerEntityId));
  });

  btnCloseSettings.addEventListener('click', () => {
    queuePlayerIntent(createToggleSettingsAction(playerEntityId));
  });
}

if (btnMainMenuSettings) {
  btnMainMenuSettings.addEventListener('click', () => {
    // If we're in the main menu, clicking settings should transition to Settings Mode.
    // Wait, the main menu doesn't have a player entity acting? Actually, game logic uses intents.
    // We can just set UI mode directly if it's the main menu, or just dispatch the intent.
    queuePlayerIntent(createToggleSettingsAction(playerEntityId));
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
      // Basic validation (does it parse?)
      JSON.parse(content);
      setSaveData(content);

      // Update UI so continue button lights up immediately if we were on the menu
      renderMenus(state, hasSaveGame());

      // Clear the input so you can import the same file again if needed
      target.value = '';
    } catch (err) {
      alert('Invalid save file format!');
      console.error(err);
    }
  };
  reader.readAsText(file);
});

/**
 * Updates the HTML-based HUD sidebar to show the current level depth and player health.
 * @param s The current GameState.
 */
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
  render(display, newState);
  renderMessageLog(newState);
  renderPlayerStats(newState);
  renderInventoryPanel(newState);
  renderMenus(newState, hasSaveGame());
  updateHUD(newState);
  renderRTwPControls(newState);
  renderViewControls(newState);
  renderSettingsMenu(newState);
});

// Initialize HUD display values and pass the initial state
setGameState(state);

// Initialize global UI hover tooltips
initUITooltips(getGameState);

// 6. Hook up Keyboard input handlers to the Command Queue
window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (rebindingAction) {
    event.preventDefault();
    if (event.key === 'Escape') {
      rebindingAction = null;
      rebindingOverlay?.classList.add('hidden');
      return;
    }
    // Only bind single characters, arrows, space, enter, etc. Ignore modifiers alone.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;

    rebindAction(rebindingAction, event.key);
    rebindingAction = null;
    rebindingOverlay?.classList.add('hidden');
    renderSettingsMenu(getGameState());
    return;
  }

  const currentState = getGameState();

  if (
    currentState.uiMode === UIMode.MainMenu ||
    currentState.uiMode === UIMode.GameOver ||
    currentState.uiMode === UIMode.CampaignSelect
  ) {
    return; // Menu buttons handle input
  }

  const isTargeting = currentState.targetingMode?.active;
  const isInventoryOpen = currentState.uiMode === UIMode.Inventory;

  const isSettingsOpen = currentState.uiMode === UIMode.Settings;

  if (isSettingsOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      queuePlayerIntent(createToggleSettingsAction(playerEntityId));
    }
    return;
  }

  // Inventory panel: letter keys select a slot, Escape closes
  if (isInventoryOpen) {
    if (event.key === 'Escape' || isAction(event, 'inventory')) {
      event.preventDefault();
      queuePlayerIntent(createToggleInventoryAction(playerEntityId));
      return;
    }

    // Ignore multi-character keys or non a-z keys
    if (event.key.length !== 1) return;
    const code = event.key.toLowerCase().charCodeAt(0);
    if (code < 97 || code > 122) return;

    event.preventDefault();
    const slotIndex = code - 97;

    const inventory = getComponent(currentState, playerEntityId, ComponentType.Inventory) as
      | InventoryComponent
      | undefined;
    if (!inventory || slotIndex >= inventory.items.length) return;

    const itemEntityId = inventory.items[slotIndex];
    const equipment = getComponent(currentState, playerEntityId, ComponentType.Equipment) as
      | EquipmentComponent
      | undefined;
    const itemComp = itemEntityId
      ? (getComponent(currentState, itemEntityId, ComponentType.Item) as ItemComponent | undefined)
      : undefined;
    const def = itemComp ? currentState.campaign.items[itemComp.itemId] : undefined;

    let itemName = 'item';
    if (def && itemComp) {
      const isIdentified = currentState.identifiedItems.has(itemComp.itemId);
      itemName = isIdentified
        ? def.name
        : (currentState.itemUnidentifiedNames.get(itemComp.itemId) ?? def.unidentifiedName ?? itemComp.itemId);
    }

    if (event.shiftKey) {
      setGameState(addMessage(currentState, `Queued: Drop ${itemName}`, MessageLogCategory.System));
      queuePlayerIntent(createDropAction(playerEntityId, slotIndex));
      return;
    }

    if (event.altKey) {
      if (itemEntityId && equipment && def?.equippable) {
        const equippedSlot = equipment.slots.find((s) => s.equippedItem === itemEntityId);
        if (equippedSlot) {
          setGameState(addMessage(currentState, `Queued: Unequip ${itemName}`, MessageLogCategory.System));
          queuePlayerIntent(createUnequipItemAction(playerEntityId, equippedSlot.id));
          return;
        }
      }

      setGameState(addMessage(currentState, `Queued: Equip ${itemName}`, MessageLogCategory.System));
      queuePlayerIntent(createEquipItemAction(playerEntityId, slotIndex));
      return;
    }

    setGameState(addMessage(currentState, `Queued: Use ${itemName}`, MessageLogCategory.System));
    queuePlayerIntent(createUseItemAction(playerEntityId, slotIndex));
    return;
  }

  // Debug keys
  if (isAction(event, 'debug_reveal_map')) {
    event.preventDefault();
    queuePlayerIntent(createDebugRevealMapAction(playerEntityId));
    return;
  }
  if (isAction(event, 'debug_god_mode')) {
    event.preventDefault();
    queuePlayerIntent(createDebugGodModeAction(playerEntityId));
    return;
  }
  if (isAction(event, 'debug_spawn_entity')) {
    event.preventDefault();
    queuePlayerIntent(createDebugSpawnEntityAction(playerEntityId));
    return;
  }

  // Item interaction
  if (isAction(event, 'pick_up')) {
    event.preventDefault();
    queuePlayerIntent(createPickUpAction(playerEntityId));
    return;
  }

  if (isAction(event, 'inventory')) {
    event.preventDefault();
    queuePlayerIntent(createToggleInventoryAction(playerEntityId));
    return;
  }

  // Handle targeting specific keys
  if (isAction(event, 'target_toggle')) {
    event.preventDefault();
    queuePlayerIntent(createToggleTargetingAction(playerEntityId));
    return;
  }

  if (isTargeting && isAction(event, 'target_confirm')) {
    event.preventDefault();
    queuePlayerIntent(createFireAimedAction(playerEntityId));
    return;
  }

  // Handle inspect specific keys
  if (isAction(event, 'inspect')) {
    event.preventDefault();
    queuePlayerIntent(createToggleInspectAction(playerEntityId));
    return;
  }

  let direction: Direction | undefined;
  if (isAction(event, 'move_north')) direction = Direction.North;
  else if (isAction(event, 'move_south')) direction = Direction.South;
  else if (isAction(event, 'move_east')) direction = Direction.East;
  else if (isAction(event, 'move_west')) direction = Direction.West;

  if (direction !== undefined) {
    event.preventDefault(); // Prevent standard page scroll
    const { dx, dy } = getDirectionDelta(direction);

    if (isTargeting) {
      queuePlayerIntent(createMoveTargetAction(playerEntityId, dx, dy));
    } else if (currentState.inspectMode?.active) {
      queuePlayerIntent(createMoveInspectAction(playerEntityId, dx, dy));
    } else {
      queuePlayerIntent(createMoveAction(playerEntityId, dx, dy));
    }
  } else if (isAction(event, 'wait')) {
    event.preventDefault();
    if (currentState.engineMode === EngineMode.RTwP) {
      queuePlayerIntent(createTogglePauseAction(playerEntityId));
    } else {
      queuePlayerIntent(createWaitAction(playerEntityId));
    }
  } else if (!isTargeting && isAction(event, 'interact')) {
    event.preventDefault();
    queuePlayerIntent(createInteractAction(playerEntityId));
  }
});

// 7. Global UI Loop (for transient visual effects)
function globalUILoop() {
  requestAnimationFrame(globalUILoop);
  const currentState = getGameState();
  if (!currentState) return;

  const now = performance.now();
  if (currentState.visualEffects.some((e) => now > e.expiresAt)) {
    const nextEffects = currentState.visualEffects.filter((e) => now <= e.expiresAt);
    // Use an internal method or just queue an empty state update to avoid polluting command queue
    setGameState({ ...currentState, visualEffects: nextEffects });
  }
}
requestAnimationFrame(globalUILoop);
