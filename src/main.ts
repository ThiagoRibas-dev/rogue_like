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
  type InteractableComponent
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
import { renderMessageLog, renderInventoryPanel } from './rendering/ui.ts';
import { generateDungeon } from './map/generator.ts';
import { updateExploredTiles } from './systems/map.system.ts';
import { MAP_WIDTH, MAP_HEIGHT } from './constants/map.constants.ts';
import { MAX_MONSTERS_PER_ROOM, SPAWN_WEIGHTS } from './constants/spawning.constants.ts';
import { LOOT_TABLE, MAX_ITEMS_PER_ROOM } from './constants/items.constants.ts';
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
  createToggleInventoryAction
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

// 4. Initialize the Game State with a procedurally generated level
const { map: initialMap, startPos, stairs, rooms } = generateDungeon(MAP_WIDTH, MAP_HEIGHT, 1);

let state: GameState = {
  entities: [],
  components: new Map(),
  map: initialMap,
  nextEntityId: 1,
  nextItemInstanceId: 1,
  messages: [],
  currentDepth: 1,
  levels: new Map(),
  spatialIndex: new Map(),
  isGameOver: false,
  uiMode: UIMode.Game
};

// Spawn the player entity
const [stateAfterPlayerSpawn, playerEntityId] = spawnEntity(state, 'player', startPos.x, startPos.y);
state = stateAfterPlayerSpawn;

// Spawn monsters in rooms
for (let i = 1; i < rooms.length; i++) {
  const room = rooms[i];
  if (!room) continue;

  const numMonsters = ROT.RNG.getUniformInt(0, MAX_MONSTERS_PER_ROOM);
  for (let m = 0; m < numMonsters; m++) {
    const mx = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
    const my = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
    const template = ROT.RNG.getWeightedValue(SPAWN_WEIGHTS as Record<string, number>) || 'orc';

    // Quick check to avoid spawning exactly on stairs or another entity (for now, just spawn)
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
state = addMessage(state, 'Milestone 3: Engine, Scheduling & Intents active.', MessageLogCategory.System);

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
  renderInventoryPanel(newState);
  updateHUD(newState);
});

// Initialize HUD display values and pass the initial state
updateHUD(state);
renderInventoryPanel(state);
setGameState(state);

// 5. Initial Render
render(display, state);
renderMessageLog(state);

// 6. Hook up Keyboard input handlers to the Command Queue
window.addEventListener('keydown', (event: KeyboardEvent) => {
  const currentState = getGameState();
  const isTargeting = currentState.targetingMode?.active;
  const isInventoryOpen = currentState.uiMode === UIMode.Inventory;

  // Inventory panel: letter keys select a slot, Escape closes
  if (isInventoryOpen) {
    if (event.key === 'Escape' || event.keyCode === INVENTORY_TOGGLE_KEY) {
      event.preventDefault();
      queuePlayerIntent(createToggleInventoryAction(playerEntityId));
      return;
    }
    // a-z selects inventory slot 0-25
    if (event.key.length === 1) {
      const code = event.key.toLowerCase().charCodeAt(0);
      if (code >= 97 && code <= 122) {
        event.preventDefault();
        const slotIndex = code - 97;
        // Use with Shift = drop, plain = use/equip
        if (event.shiftKey) {
          queuePlayerIntent(createDropAction(playerEntityId, slotIndex));
        } else {
          queuePlayerIntent(createUseItemAction(playerEntityId, slotIndex));
        }
      }
    }
    return; // Swallow all other keys when inventory is open
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

// 7. Start the Engine
initEngine();
for (const id of state.entities) {
  const actor = getComponent(state, id, ComponentType.Actor);
  if (actor) {
    addActor(id, actor.speed);
  }
}
startEngine();
