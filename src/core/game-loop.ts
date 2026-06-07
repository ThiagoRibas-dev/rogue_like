import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { ComponentType, type GodModeComponent, type PositionComponent, type RenderableComponent, type ActorComponent } from '../types/components.types.ts';
import { getComponent, createEntity, addComponent, updateSpatialIndex } from './ecs.ts';
import { lockEngine, unlockEngine } from './scheduler.ts';
import { IntentType, type Intent } from '../types/intents.types.ts';
import { processMoveIntent } from '../systems/movement.system.ts';
import { processInteractIntent, processChangeFloorIntent } from '../systems/map.system.ts';
import { addMessage } from '../systems/message.system.ts';
import { updateExploredTiles } from '../systems/map.system.ts';
import { processToggleTargetingIntent, processMoveTargetIntent, processFireAimedIntent } from '../systems/targeting.system.ts';
import { coordToIndex } from '../utils/grid.ts';
import { TILE_REGISTRY } from '../constants/tile.constants.ts';

let currentState: GameState | null = null;
let stateChangeCallback: ((state: GameState) => void) | null = null;

export function setGameState(state: GameState): void {
  currentState = state;
}

export function getGameState(): GameState {
  if (!currentState) throw new Error("Game state not initialized");
  return currentState;
}

export function onStateChange(callback: (state: GameState) => void): void {
  stateChangeCallback = callback;
}

function updateState(newState: GameState): void {
  currentState = newState;
  if (stateChangeCallback) {
    stateChangeCallback(newState);
  }
}

// The command queue for the player
const playerQueue: Intent[] = [];

/**
 * Pushes an intent into the player's queue and resumes the engine if it was locked.
 */
export function queuePlayerIntent(intent: Intent): void {
  playerQueue.push(intent);
  unlockEngine();
}

/**
 * Called by ROT.Engine when it is an actor's turn.
 */
export function processTurn(entityId: EntityId): void {
  const state = getGameState();
  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  if (isPlayer) {
    if (playerQueue.length === 0) {
      // Pause engine, wait for UI to call queuePlayerIntent()
      lockEngine();
      return;
    }
    
    const intent = playerQueue.shift();
    if (intent) {
      const nextState = applyIntent(state, intent);
      if (nextState !== state) {
         // After player acts, always update FOV
         updateState(updateExploredTiles(nextState));
      }
    }
  } else {
    // For now (M3), AI just skips its turn.
  }
}

/**
 * Dispatches an intent to the appropriate system for validation and execution.
 */
function applyIntent(state: GameState, intent: Intent): GameState {
  switch (intent.type) {
    case IntentType.Move:
      return processMoveIntent(state, intent);
    case IntentType.Wait:
      return addMessage(state, 'You wait a moment.', 'system');
    case IntentType.Interact:
      return processInteractIntent(state, intent);
    case IntentType.ChangeFloor:
      return processChangeFloorIntent(state, intent);
      
    // --- TARGETING INTENTS ---
    case IntentType.ToggleTargeting:
      return processToggleTargetingIntent(state, intent);
    case IntentType.MoveTarget:
      return processMoveTargetIntent(state, intent);
    case IntentType.FireAimed:
      return processFireAimedIntent(state, intent);
      
    // --- DEBUG INTENTS ---
    case IntentType.DebugRevealMap: {
      const nextMap = { ...state.map, isFullyExplored: !state.map.isFullyExplored };
      const msg = nextMap.isFullyExplored ? '[DEBUG] Map Revealed.' : '[DEBUG] Map Hidden.';
      return addMessage({ ...state, map: nextMap }, msg, 'system');
    }
    
    case IntentType.DebugGodMode: {
      const { entityId } = intent;
      const hasGodMode = getComponent(state, entityId, ComponentType.GodMode) !== undefined;
      
      let nextComponents = new Map(state.components);
      let entityComps = state.components.get(entityId) || [];
      
      if (hasGodMode) {
        // Remove GodMode
        nextComponents.set(entityId, entityComps.filter(c => c.type !== ComponentType.GodMode));
        return addMessage({ ...state, components: nextComponents }, '[DEBUG] God Mode Disabled.', 'system');
      } else {
        // Add GodMode
        const godCmp: GodModeComponent = { type: ComponentType.GodMode };
        nextComponents.set(entityId, [...entityComps, godCmp]);
        return addMessage({ ...state, components: nextComponents }, '[DEBUG] God Mode Enabled.', 'system');
      }
    }
    
    case IntentType.DebugSpawnEntity: {
      const pos = getComponent(state, intent.entityId, ComponentType.Position);
      if (!pos) return state;
      
      // Find an empty adjacent tile
      const neighbors = [
        { x: pos.x + 1, y: pos.y }, { x: pos.x - 1, y: pos.y },
        { x: pos.x, y: pos.y + 1 }, { x: pos.x, y: pos.y - 1 }
      ];
      
      let spawnX = -1;
      let spawnY = -1;
      
      for (const n of neighbors) {
        const idx = coordToIndex(n.x, n.y, state.map.width);
        const tile = state.map.tiles[idx];
        if (tile && TILE_REGISTRY[tile.tileId]?.walkable) {
          const entitiesAt = state.spatialIndex.get(`${n.x},${n.y}`);
          if (!entitiesAt || entitiesAt.length === 0) {
            spawnX = n.x;
            spawnY = n.y;
            break;
          }
        }
      }
      
      if (spawnX === -1) {
         return addMessage(state, '[DEBUG] No room to spawn entity.', 'system');
      }
      
      let nextState = state;
      let newEntityId: EntityId;
      [nextState, newEntityId] = createEntity(nextState);
      
      const newPos: PositionComponent = { type: ComponentType.Position, x: spawnX, y: spawnY };
      const render: RenderableComponent = { type: ComponentType.Renderable, glyph: 'o', fg: '#2ecc71', bg: 'transparent' };
      const actor: ActorComponent = { type: ComponentType.Actor, speed: 100 };
      
      nextState = addComponent(nextState, newEntityId, newPos);
      nextState = addComponent(nextState, newEntityId, render);
      nextState = addComponent(nextState, newEntityId, actor);
      
      nextState = updateSpatialIndex(nextState);
      
      return addMessage(nextState, `[DEBUG] Spawned dummy Orc at ${spawnX}, ${spawnY}.`, 'system');
    }
    
    default:
      return state;
  }
}
