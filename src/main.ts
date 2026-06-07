import * as ROT from 'rot-js';
import './index.css';
import { DISPLAY_WIDTH, DISPLAY_HEIGHT, FONT_SIZE, FONT_FAMILY } from './constants/ui.constants.ts';
import { COLOR_BACKGROUND, COLOR_PLAYER_FG, COLOR_STAIRS_FG } from './constants/colors.constants.ts';
import { GLYPH_PLAYER, GLYPH_STAIRS_UP, GLYPH_STAIRS_DOWN } from './constants/glyphs.constants.ts';
import { type GameState, type EntityId } from './types/game-state.types.ts';
import { ComponentType, type PlayerComponent, type PositionComponent, type RenderableComponent, type ActorComponent, type InteractableComponent } from './types/components.types.ts';
import { addComponent, createEntity } from './core/ecs.ts';
import { Direction } from './utils/direction.ts';
import { render } from './rendering/renderer.ts';
import { initRNG } from './core/rng.ts';
import { MOVEMENT_KEYS, WAIT_KEY, DEBUG_REVEAL_MAP_KEY, DEBUG_GOD_MODE_KEY, DEBUG_SPAWN_ENTITY_KEY, TARGET_TOGGLE_KEY, TARGET_CONFIRM_KEY } from './constants/keybinds.constants.ts';
import { addMessage } from './systems/message.system.ts';
import { renderMessageLog } from './rendering/ui.ts';
import { generateDungeon } from './map/generator.ts';
import { updateExploredTiles } from './systems/map.system.ts';
import { MAP_WIDTH, MAP_HEIGHT } from './constants/map.constants.ts';
import { initEngine, startEngine, addActor } from './core/scheduler.ts';
import { setGameState, onStateChange, queuePlayerIntent, getGameState } from './core/game-loop.ts';
import { createMoveAction, createWaitAction, createInteractAction } from './actions/core.actions.ts';
import { createDebugRevealMapAction, createDebugGodModeAction, createDebugSpawnEntityAction } from './actions/debug.actions.ts';
import { createToggleTargetingAction, createMoveTargetAction, createFireAimedAction } from './actions/targeting.actions.ts';
import { IntentType } from './types/intents.types.ts';
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
const { map: initialMap, startPos, stairs } = generateDungeon(MAP_WIDTH, MAP_HEIGHT, 1);

let state: GameState = {
  entities: [],
  components: new Map(),
  map: initialMap,
  nextEntityId: 1,
  messages: [],
  currentDepth: 1,
  levels: new Map(),
  spatialIndex: new Map()
};

// Spawn the player entity
let playerEntityId: EntityId;
[state, playerEntityId] = createEntity(state);

const playerPos: PositionComponent = { type: ComponentType.Position, x: startPos.x, y: startPos.y };
const playerRender: RenderableComponent = { type: ComponentType.Renderable, glyph: GLYPH_PLAYER, fg: COLOR_PLAYER_FG, bg: COLOR_BACKGROUND };
const playerTag: PlayerComponent = { type: ComponentType.Player };
const playerActor: ActorComponent = { type: ComponentType.Actor, speed: 100 };

state = addComponent(state, playerEntityId, playerPos);
state = addComponent(state, playerEntityId, playerRender);
state = addComponent(state, playerEntityId, playerTag);
state = addComponent(state, playerEntityId, playerActor);

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
    intents: [ { type: IntentType.ChangeFloor, direction: stair.direction } as any ]
  };
  
  state = addComponent(state, stairId, pos);
  state = addComponent(state, stairId, renderCmp);
  state = addComponent(state, stairId, interactable);
}

// Initial FOV compute
state = updateExploredTiles(state);

// Add initial startup messages
state = addMessage(state, 'Milestone 3: Engine, Scheduling & Intents active.', 'system');

/**
 * Updates the HTML-based HUD sidebar to show the current level depth.
 * @param s The current GameState.
 */
function updateHUD(s: GameState): void {
  const depthElement = document.getElementById('dungeon-depth');
  if (depthElement !== null) {
    depthElement.textContent = `B${s.currentDepth}`;
  }
}

// Subscribe to state changes to update the UI
onStateChange((newState: GameState) => {
  render(display, newState);
  renderMessageLog(newState);
  updateHUD(newState);
});

// Initialize HUD display values and pass the initial state
updateHUD(state);
setGameState(state);

// 5. Initial Render
render(display, state);
renderMessageLog(state);

// 6. Hook up Keyboard input handlers to the Command Queue
window.addEventListener('keydown', (event: KeyboardEvent) => {
  const currentState = getGameState();
  const isTargeting = currentState.targetingMode?.active;

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
  } else if (!isTargeting && (event.key === '>' || event.key === '<' || event.keyCode === ROT.KEYS.VK_LESS_THAN || event.keyCode === ROT.KEYS.VK_GREATER_THAN)) {
    event.preventDefault();
    queuePlayerIntent(createInteractAction(playerEntityId));
  }
});

// 7. Start the Engine
initEngine();
addActor(playerEntityId, 100);
startEngine();
