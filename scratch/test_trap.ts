import { getGameState, setGameState, queuePlayerIntent, processTurn } from '../src/core/game-loop.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { EngineMode, UIMode } from '../src/types/game-state.types.ts';
import { createEntity, addComponent, updateSpatialIndex, spawnEntity } from '../src/core/ecs.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { unlockEngine } from '../src/core/scheduler.ts';

// Mock localStorage for the test
(global as any).localStorage = {
  setItem: () => {},
  getItem: () => null,
  removeItem: () => {}
};

// We just want to mock enough state to run the game loop for a move.
const initialState = {
  entities: [],
  components: new Map(),
  nextEntityId: 1,
  nextItemInstanceId: 1,
  spatialIndex: new Map(),
  messages: [],
  map: { width: 10, height: 10, tiles: Array(100).fill({ tileId: 'stone_floor', explored: true }) },
  levels: new Map(),
  currentDepth: 1,
  isGameOver: false,
  uiMode: UIMode.Game,
  engineMode: EngineMode.TurnBased,
  rtwpState: { paused: false, speedMultiplier: 1 },
  identifiedItems: new Set(),
  itemUnidentifiedNames: new Map(),
  playerCommandQueue: [],
  campaign: {
    tiles: { 'stone_floor': { walkable: true, movementCost: 100 } },
    items: {},
    entities: {
      'player': { isActor: true, fighter: { maxHp: 100, attack: 1, defense: 1 } },
      'hidden_trap': { isActor: false }
    },
    rules: { 
      map: { width: 10, height: 10 }, 
      spawning: {},
      hunger: { maxSatiation: 2000, thresholds: { satiated: 1500, normal: 1000, hungry: 300, starving: 0 } }
    },
    theme: { glyphs: {}, colors: {} }
  }
};

let [state, playerId] = spawnEntity(initialState, 'player', 5, 5);
let [state2, trapId] = spawnEntity(state, 'hidden_trap', 6, 5); // Trap at 6,5

state2 = updateSpatialIndex(state2);
setGameState(state2);

console.log("Initial player pos:", state2.components.get(playerId).find(c => c.type === 'Position'));
console.log("Initial trap pos:", state2.components.get(trapId).find(c => c.type === 'Position'));

// Step ON trap
queuePlayerIntent({ type: IntentType.Move, entityId: playerId, dx: 1, dy: 0 });
processTurn(playerId);

const state3 = getGameState();
console.log("After step ON trap:");
console.log("Player pos:", state3.components.get(playerId).find(c => c.type === 'Position'));
console.log("Trap pos:", state3.components.get(trapId).find(c => c.type === 'Position'));
console.log("Trap triggered?", state3.components.get(trapId).find(c => c.type === 'Trap').triggered);
console.log("Player HP:", state3.components.get(playerId).find(c => c.type === 'Fighter').hp);
console.log("Messages:", state3.messages.map(m => m.text));

// Step OFF trap
queuePlayerIntent({ type: IntentType.Move, entityId: playerId, dx: 1, dy: 0 }); // Move to 7,5
processTurn(playerId);

const state4 = getGameState();
console.log("\nAfter step OFF trap:");
console.log("Player pos:", state4.components.get(playerId).find(c => c.type === 'Position'));
console.log("Trap pos:", state4.components.get(trapId).find(c => c.type === 'Position'));
console.log("Trap triggered?", state4.components.get(trapId).find(c => c.type === 'Trap').triggered);
console.log("Player HP:", state4.components.get(playerId).find(c => c.type === 'Fighter').hp);

// Step BACK ON trap
queuePlayerIntent({ type: IntentType.Move, entityId: playerId, dx: -1, dy: 0 }); // Move back to 6,5
processTurn(playerId);

const state5 = getGameState();
console.log("\nAfter step BACK ON trap:");
console.log("Player pos:", state5.components.get(playerId).find(c => c.type === 'Position'));
console.log("Trap pos:", state5.components.get(trapId).find(c => c.type === 'Position'));
console.log("Trap triggered?", state5.components.get(trapId).find(c => c.type === 'Trap').triggered);
console.log("Player HP:", state5.components.get(playerId).find(c => c.type === 'Fighter').hp);
