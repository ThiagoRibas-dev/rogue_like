import * as ROT from 'rot-js';
import './index.css';
import { DISPLAY_WIDTH, DISPLAY_HEIGHT, FONT_SIZE, FONT_FAMILY } from './constants/ui.constants.ts';
import { COLOR_BACKGROUND, COLOR_PLAYER_FG, COLOR_STAIRS_FG } from './constants/colors.constants.ts';
import { GLYPH_STAIRS_UP, GLYPH_STAIRS_DOWN } from './constants/glyphs.constants.ts';
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
  MOVEMENT_KEYS,
  WAIT_KEY,
  DEBUG_REVEAL_MAP_KEY,
  DEBUG_GOD_MODE_KEY,
  DEBUG_SPAWN_ENTITY_KEY,
  TARGET_TOGGLE_KEY,
  TARGET_CONFIRM_KEY,
  PICK_UP_KEY,
  INVENTORY_TOGGLE_KEY
} from './constants/keybinds.constants.ts';
import { addMessage, MessageLogCategory } from './systems/message.system.ts';
import { renderMessageLog, renderInventoryPanel, renderPlayerStats, renderMenus } from './rendering/ui.ts';
import { hasSaveGame, deleteSave, loadGame } from './core/save.ts';
import { clearScheduler } from './core/scheduler.ts';
import { generateDungeon } from './map/generator.ts';
import { updateExploredTiles } from './systems/map.system.ts';
import { MAP_WIDTH, MAP_HEIGHT } from './constants/map.constants.ts';
import { MAX_MONSTERS_PER_ROOM, SPAWN_WEIGHTS } from './constants/spawning.constants.ts';
import { LOOT_TABLE, MAX_ITEMS_PER_ROOM, ITEM_REGISTRY } from './constants/items.constants.ts';
import { initEngine, startEngine, addActor } from './core/scheduler.ts';
import { setGameState, onStateChange, queuePlayerIntent, getGameState } from './core/game-loop.ts';
import { createMoveAction, createWaitAction, createInteractAction } from './actions/core.actions.ts';
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
import {
  createPickUpAction,
  createDropAction,
  createUseItemAction,
  createToggleInventoryAction,
  createEquipItemAction,
  createUnequipItemAction
} from './actions/inventory.actions.ts';
import { IntentType, type ChangeFloorIntent } from './types/intents.types.ts';
import { UIMode } from './types/game-state.types.ts';
import { getDirectionDelta } from './utils/direction.ts';

// 0. Initialize RNG
initRNG();

// 1. Initialize Display Options
const displayOptions = {
  width: DISPLAY_WIDTH,
  height: DISPLAY_HEIGHT,
  fontSize: FONT_SIZE,
  fontFamily: FONT_FAMILY,
  bg: COLOR_BACKGROUND,
  fg: COLOR_PLAYER_FG
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
  entities: [],
  components: new Map(),
  map: { width: MAP_WIDTH, height: MAP_HEIGHT, tiles: [] },
  nextEntityId: 1,
  nextItemInstanceId: 1,
  messages: [],
  currentDepth: 1,
  levels: new Map(),
  spatialIndex: new Map(),
  isGameOver: false,
  uiMode: UIMode.MainMenu,
  identifiedItems: new Set(),
  itemUnidentifiedNames: new Map()
};

import { POTION_DESCRIPTORS, SCROLL_DESCRIPTORS, ItemCategory } from './constants/items.constants.ts';

function startNewGame() {
  deleteSave();
  clearScheduler();
  initEngine();

  const itemUnidentifiedNames = new Map<string, string>();
  const potionDesc = [...POTION_DESCRIPTORS].sort(() => ROT.RNG.getUniform() - 0.5);
  const scrollDesc = [...SCROLL_DESCRIPTORS].sort(() => ROT.RNG.getUniform() - 0.5);

  let pIdx = 0;
  let sIdx = 0;

  for (const [id, def] of Object.entries(ITEM_REGISTRY)) {
    if (def.category === ItemCategory.Consumable) {
      if (def.id.includes('potion')) {
        itemUnidentifiedNames.set(id, `${potionDesc[pIdx++ % potionDesc.length]} Potion`);
      } else if (def.id.includes('scroll')) {
        itemUnidentifiedNames.set(id, `${scrollDesc[sIdx++ % scrollDesc.length]} Scroll`);
      }
    }
  }

  const { map: initialMap, startPos, stairs, rooms } = generateDungeon(MAP_WIDTH, MAP_HEIGHT, 1);
  state = {
    ...state,
    map: initialMap,
    uiMode: UIMode.Game,
    isGameOver: false,
    entities: [],
    components: new Map(),
    spatialIndex: new Map(),
    messages: [],
    currentDepth: 1,
    levels: new Map(),
    identifiedItems: new Set(),
    itemUnidentifiedNames
  };

  // Spawn the player entity
  const [stateAfterPlayerSpawn, newPlayerEntityId] = spawnEntity(state, 'player', startPos.x, startPos.y);
  state = stateAfterPlayerSpawn;
  playerEntityId = newPlayerEntityId;

  // Spawn monsters in rooms
  for (let i = 1; i < rooms.length; i++) {
    const room = rooms[i];
    if (!room) continue;

    const numMonsters = ROT.RNG.getUniformInt(0, MAX_MONSTERS_PER_ROOM);
    for (let m = 0; m < numMonsters; m++) {
      const mx = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
      const my = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
      const template = ROT.RNG.getWeightedValue(SPAWN_WEIGHTS as Record<string, number>) || 'orc';
      [state] = spawnEntity(state, template, mx, my);
    }

    // Spawn items in this room
    const numItems = ROT.RNG.getUniformInt(0, MAX_ITEMS_PER_ROOM);
    for (let n = 0; n < numItems; n++) {
      const ix = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
      const iy = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
      const itemId = ROT.RNG.getWeightedValue(LOOT_TABLE as Record<string, number>) || 'health_potion';
      [state] = spawnItem(state, itemId, ix, iy);
    }
  }

  // Spawn the stairs for the first floor
  for (const stair of stairs) {
    let stairId: EntityId;
    [state, stairId] = createEntity(state);

    const pos: PositionComponent = { type: ComponentType.Position, x: stair.x, y: stair.y };
    const renderCmp: RenderableComponent = {
      type: ComponentType.Renderable,
      glyph: stair.direction === 'up' ? GLYPH_STAIRS_UP : GLYPH_STAIRS_DOWN,
      fg: COLOR_STAIRS_FG,
      bg: 'transparent'
    };
    const interactable: InteractableComponent = {
      type: ComponentType.Interactable,
      intents: [{ type: IntentType.ChangeFloor, direction: stair.direction } as ChangeFloorIntent]
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

function continueGame() {
  const loadedState = loadGame();
  if (loadedState) {
    state = loadedState;
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

document.getElementById('btn-new-game')?.addEventListener('click', startNewGame);
document.getElementById('btn-continue')?.addEventListener('click', continueGame);
document.getElementById('btn-return-menu')?.addEventListener('click', () => {
  state = { ...state, uiMode: UIMode.MainMenu };
  setGameState(state);
});

// Export Save
document.getElementById('btn-export-save')?.addEventListener('click', () => {
  const data = localStorage.getItem('roguelike_save');
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
      localStorage.setItem('roguelike_save', content);

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
    depthElement.textContent = `B${s.currentDepth}`;
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
});

// Initialize HUD display values and pass the initial state
setGameState(state);

// 6. Hook up Keyboard input handlers to the Command Queue
window.addEventListener('keydown', (event: KeyboardEvent) => {
  const currentState = getGameState();

  if (currentState.uiMode === UIMode.MainMenu || currentState.uiMode === UIMode.GameOver) {
    return; // Menu buttons handle input
  }

  const isTargeting = currentState.targetingMode?.active;
  const isInventoryOpen = currentState.uiMode === UIMode.Inventory;

  // Inventory panel: letter keys select a slot, Escape closes
  if (isInventoryOpen) {
    if (event.key === 'Escape' || event.keyCode === INVENTORY_TOGGLE_KEY) {
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

    if (event.shiftKey) {
      queuePlayerIntent(createDropAction(playerEntityId, slotIndex));
      return;
    }

    if (event.altKey) {
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
      const def = itemComp ? ITEM_REGISTRY[itemComp.itemId] : undefined;

      if (
        itemEntityId &&
        equipment &&
        (equipment.weapon === itemEntityId || equipment.armor === itemEntityId) &&
        def?.equippable
      ) {
        queuePlayerIntent(createUnequipItemAction(playerEntityId, def.equippable.slot));
        return;
      }

      queuePlayerIntent(createEquipItemAction(playerEntityId, slotIndex));
      return;
    }

    queuePlayerIntent(createUseItemAction(playerEntityId, slotIndex));
    return;
  }

  if (event.shiftKey) {
    if (event.keyCode === DEBUG_REVEAL_MAP_KEY) {
      event.preventDefault();
      queuePlayerIntent(createDebugRevealMapAction(playerEntityId));
      return;
    }
    if (event.keyCode === DEBUG_GOD_MODE_KEY) {
      event.preventDefault();
      queuePlayerIntent(createDebugGodModeAction(playerEntityId));
      return;
    }
    if (event.keyCode === DEBUG_SPAWN_ENTITY_KEY) {
      event.preventDefault();
      queuePlayerIntent(createDebugSpawnEntityAction(playerEntityId));
      return;
    }
  }

  // Item interaction
  if (event.keyCode === PICK_UP_KEY) {
    event.preventDefault();
    queuePlayerIntent(createPickUpAction(playerEntityId));
    return;
  }

  if (event.keyCode === INVENTORY_TOGGLE_KEY) {
    event.preventDefault();
    queuePlayerIntent(createToggleInventoryAction(playerEntityId));
    return;
  }

  // Handle targeting specific keys
  if (event.keyCode === TARGET_TOGGLE_KEY) {
    event.preventDefault();
    queuePlayerIntent(createToggleTargetingAction(playerEntityId));
    return;
  }

  if (isTargeting && event.keyCode === TARGET_CONFIRM_KEY) {
    event.preventDefault();
    queuePlayerIntent(createFireAimedAction(playerEntityId));
    return;
  }

  const direction: Direction | undefined = MOVEMENT_KEYS[event.keyCode];

  if (direction !== undefined) {
    event.preventDefault(); // Prevent standard page scroll
    const { dx, dy } = getDirectionDelta(direction);

    if (isTargeting) {
      queuePlayerIntent(createMoveTargetAction(playerEntityId, dx, dy));
    } else {
      queuePlayerIntent(createMoveAction(playerEntityId, dx, dy));
    }
  } else if (event.keyCode === WAIT_KEY) {
    event.preventDefault();
    queuePlayerIntent(createWaitAction(playerEntityId));
  } else if (!isTargeting && (event.key === '>' || event.key === '<' || event.key === '.' || event.key === ',')) {
    event.preventDefault();
    queuePlayerIntent(createInteractAction(playerEntityId));
  }
});
