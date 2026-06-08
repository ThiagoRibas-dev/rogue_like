import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { ComponentType, type GodModeComponent } from '../types/components.types.ts';
import { getComponent, spawnEntity } from './ecs.ts';
import { lockEngine, unlockEngine, addActor } from './scheduler.ts';
import { saveGame } from './save.ts';
import { IntentType, type Intent } from '../types/intents.types.ts';
import { processMoveIntent } from '../systems/movement.system.ts';
import { processInteractIntent, processChangeFloorIntent } from '../systems/map.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { updateExploredTiles } from '../systems/map.system.ts';
import {
  processToggleTargetingIntent,
  processMoveTargetIntent,
  processFireAimedIntent
} from '../systems/targeting.system.ts';
import { processMeleeAttackIntent } from '../systems/combat.system.ts';
import { processAITurn } from '../systems/ai.system.ts';
import {
  processPickUpIntent,
  processDropIntent,
  processEquipItemIntent,
  processUnequipItemIntent
} from '../systems/inventory.system.ts';
import { processUseItemIntent } from '../systems/effects.system.ts';
import { UIMode } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { assertNever } from '../utils/assert.ts';
import { TILE_REGISTRY } from '../constants/tile.constants.ts';
import { processStatusEffectsTick, shouldSkipTurn } from '../systems/status-effect.system.ts';

let currentState: GameState | null = null;
let stateChangeCallback: ((state: GameState) => void) | null = null;

export function setGameState(state: GameState): void {
  updateState(state);
}

export function getGameState(): GameState {
  if (!currentState) throw new Error('Game state not initialized');
  return currentState;
}

export function onStateChange(callback: (state: GameState) => void): void {
  stateChangeCallback = callback;
}

function updateState(newState: GameState): void {
  currentState = newState;
  if (newState.uiMode === UIMode.Game) {
    saveGame(newState);
  }
  if (stateChangeCallback) {
    stateChangeCallback(newState);
  }
}

/**
 * Immediately applies the player's intent and unlocks the engine so AI can act.
 */
export function queuePlayerIntent(intent: Intent): void {
  const state = getGameState();
  if (state.isGameOver) return;

  const nextState = applyIntent(state, intent);
  if (nextState !== state) {
    // Always update FOV after the player acts
    updateState(updateExploredTiles(nextState));
  }

  // Only unlock the engine if the intent consumes a turn (time)
  const consumesTurn = [
    IntentType.Move,
    IntentType.Wait,
    IntentType.Interact,
    IntentType.ChangeFloor,
    IntentType.MeleeAttack,
    IntentType.FireAimed,
    IntentType.PickUp
  ].includes(intent.type);

  // Opening/closing inventory does not consume a turn
  if (consumesTurn) {
    unlockEngine();
  }
}

/**
 * Called by ROT.Engine when it is an actor's turn.
 */
export function processTurn(entityId: EntityId): void {
  let state = getGameState();
  if (state.isGameOver) {
    lockEngine();
    return;
  }

  const stateAfterTick = processStatusEffectsTick(state, entityId);
  if (stateAfterTick !== state) {
    updateState(stateAfterTick);
    state = stateAfterTick;
  }

  // If the entity died from DoT (like poison), end their turn
  const fighter = getComponent(state, entityId, ComponentType.Fighter);
  if (!fighter && getComponent(state, entityId, ComponentType.Actor)) {
    // Wait, if they are dead, they might have been removed. But just in case:
    return;
  }

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  // Check if any active effect requires this entity to skip its turn
  if (shouldSkipTurn(state, entityId)) {
    if (isPlayer) {
      updateState(addMessage(state, `You are unable to act and skip your turn!`, MessageLogCategory.System));
    }
    return;
  }

  if (isPlayer) {
    // It's the player's turn. We lock the engine and wait for UI input.
    // The UI will call queuePlayerIntent() which executes the move and unlocks the engine.
    lockEngine();
  } else {
    // AI Turn
    const nextState = processAITurn(state, entityId);
    if (nextState !== state) {
      updateState(nextState);
    }
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
      return addMessage(state, 'You wait a moment.', MessageLogCategory.System);
    case IntentType.Interact:
      return processInteractIntent(state, intent);
    case IntentType.ChangeFloor:
      return processChangeFloorIntent(state, intent);
    case IntentType.MeleeAttack:
      return processMeleeAttackIntent(state, intent);

    // --- TARGETING INTENTS ---
    case IntentType.ToggleTargeting:
      return processToggleTargetingIntent(state, intent);
    case IntentType.MoveTarget:
      return processMoveTargetIntent(state, intent);
    case IntentType.FireAimed:
      return processFireAimedIntent(state, intent);

    // --- INVENTORY INTENTS ---
    case IntentType.PickUp:
      return processPickUpIntent(state, intent.entityId);
    case IntentType.Drop:
      return processDropIntent(state, intent.entityId, intent.itemIndex);
    case IntentType.UseItem:
      return processUseItemIntent(state, intent.entityId, intent.itemIndex);
    case IntentType.EquipItem:
      return processEquipItemIntent(state, intent.entityId, intent.itemIndex);
    case IntentType.UnequipItem:
      return processUnequipItemIntent(state, intent.entityId, intent.slot);
    case IntentType.ToggleInventory:
      return { ...state, uiMode: state.uiMode === UIMode.Game ? UIMode.Inventory : UIMode.Game };

    // --- DEBUG INTENTS ---
    case IntentType.DebugRevealMap: {
      const nextMap = { ...state.map, isFullyExplored: !state.map.isFullyExplored };
      const msg = nextMap.isFullyExplored ? '[DEBUG] Map Revealed.' : '[DEBUG] Map Hidden.';
      return addMessage({ ...state, map: nextMap }, msg, MessageLogCategory.System);
    }

    case IntentType.DebugGodMode: {
      const { entityId } = intent;
      const hasGodMode = getComponent(state, entityId, ComponentType.GodMode) !== undefined;

      const nextComponents = new Map(state.components);
      const entityComps = state.components.get(entityId) || [];

      if (hasGodMode) {
        // Remove GodMode
        nextComponents.set(
          entityId,
          entityComps.filter((c) => c.type !== ComponentType.GodMode)
        );
        return addMessage(
          { ...state, components: nextComponents },
          '[DEBUG] God Mode Disabled.',
          MessageLogCategory.System
        );
      } else {
        // Add GodMode
        const godCmp: GodModeComponent = { type: ComponentType.GodMode };
        nextComponents.set(entityId, [...entityComps, godCmp]);
        return addMessage(
          { ...state, components: nextComponents },
          '[DEBUG] God Mode Enabled.',
          MessageLogCategory.System
        );
      }
    }

    case IntentType.DebugSpawnEntity: {
      const pos = getComponent(state, intent.entityId, ComponentType.Position);
      if (!pos) return state;

      // Find an empty adjacent tile
      const neighbors = [
        { x: pos.x + 1, y: pos.y },
        { x: pos.x - 1, y: pos.y },
        { x: pos.x, y: pos.y + 1 },
        { x: pos.x, y: pos.y - 1 }
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
        return addMessage(state, '[DEBUG] No room to spawn entity.', MessageLogCategory.System);
      }

      const [stateAfterSpawn, newEntityId] = spawnEntity(state, 'orc', spawnX, spawnY);
      const nextState = stateAfterSpawn;

      const actorSpeed = getComponent(nextState, newEntityId, ComponentType.Actor)?.speed ?? 100;
      addActor(newEntityId, actorSpeed);

      return addMessage(nextState, `[DEBUG] Spawned dummy Orc at ${spawnX}, ${spawnY}.`, MessageLogCategory.System);
    }

    default:
      return assertNever(intent);
  }
}
