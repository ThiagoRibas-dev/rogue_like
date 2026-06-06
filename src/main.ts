import * as ROT from 'rot-js';
import './index.css';
import { DISPLAY_WIDTH, DISPLAY_HEIGHT, FONT_SIZE, FONT_FAMILY } from './constants/ui.constants.ts';
import { COLOR_BACKGROUND, COLOR_PLAYER_FG } from './constants/colors.constants.ts';
import { GLYPH_PLAYER } from './constants/glyphs.constants.ts';
import { type GameState, type Tile } from './types/game-state.types.ts';
import { ComponentType, type PlayerComponent, type PositionComponent, type RenderableComponent } from './types/components.types.ts';
import { addComponent, createEntity } from './core/ecs.ts';
import { Direction } from './utils/direction.ts';
import { tryMovePlayer } from './systems/movement.system.ts';
import { render } from './rendering/renderer.ts';
import { initRNG } from './core/rng.ts';
import { MOVEMENT_KEYS, WAIT_KEY } from './constants/keybinds.constants.ts';
import { addMessage } from './systems/message.system.ts';
import { renderMessageLog } from './rendering/ui.ts';

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

// 4. Initialize the Game State with a simple walled room map and Player entity
const tiles: Tile[] = [];
for (let y: number = 0; y < DISPLAY_HEIGHT; y++) {
  for (let x: number = 0; x < DISPLAY_WIDTH; x++) {
    const isBoundary: boolean = x === 0 || x === DISPLAY_WIDTH - 1 || y === 0 || y === DISPLAY_HEIGHT - 1;
    tiles.push({
      tileId: isBoundary ? "stone_wall" : "stone_floor",
      x,
      y
    });
  }
}

const initialMap = {
  width: DISPLAY_WIDTH,
  height: DISPLAY_HEIGHT,
  tiles
};

const emptyState: GameState = {
  entities: [],
  components: new Map(),
  map: initialMap,
  nextEntityId: 1,
  messages: []
};

// Spawn the player entity
const [stateWithPlayer, playerEntityId] = createEntity(emptyState);
const playerX: number = Math.floor(DISPLAY_WIDTH / 2);
const playerY: number = Math.floor(DISPLAY_HEIGHT / 2);

const playerPos: PositionComponent = {
  type: ComponentType.Position,
  x: playerX,
  y: playerY
};

const playerRender: RenderableComponent = {
  type: ComponentType.Renderable,
  glyph: GLYPH_PLAYER,
  fg: COLOR_PLAYER_FG,
  bg: COLOR_BACKGROUND
};

const playerTag: PlayerComponent = {
  type: ComponentType.Player
};

let state: GameState = addComponent(
  addComponent(
    addComponent(stateWithPlayer, playerEntityId, playerPos),
    playerEntityId,
    playerRender
  ),
  playerEntityId,
  playerTag
);

// Add initial startup message
state = addMessage(state, 'ECS Core, Seeded RNG, and Keybinds loaded!', 'system');

// 5. Initial Render
render(display, state);
renderMessageLog(state);

// 6. Hook up Keyboard input handlers
window.addEventListener('keydown', (event: KeyboardEvent) => {
  const direction: Direction | undefined = MOVEMENT_KEYS[event.keyCode];
  let didAct = false;

  if (direction !== undefined) {
    event.preventDefault(); // Prevent standard page scroll
    const nextState = tryMovePlayer(state, direction);
    if (nextState !== state) {
      state = nextState;
      didAct = true;
    } else {
      // The player hit a wall; let's log it to test the message system
      state = addMessage(state, 'Ouch! You bumped into a wall.', 'combat-hit');
      didAct = true;
    }
  } else if (event.keyCode === WAIT_KEY) {
    event.preventDefault();
    state = addMessage(state, 'You wait a moment.', 'system');
    didAct = true;
  }

  // If the state changed or we logged a message, re-render
  if (didAct) {
    render(display, state);
    renderMessageLog(state);
  }
});
