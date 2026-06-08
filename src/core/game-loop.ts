import { type GameState, type EntityId, EngineMode } from '../types/game-state.types.ts';
import { ComponentType, type GodModeComponent } from '../types/components.types.ts';
import { setTurnDuration } from './scheduler.ts';
import { getComponent, spawnEntity } from './ecs.ts';
import { lockEngine, unlockEngine, addActor, switchEngineMode } from './scheduler.ts';
import { saveGame } from './save.ts';
import { IntentType, type Intent, type ActionResult } from '../types/intents.types.ts';
import { processMoveIntent } from '../systems/movement.system.ts';
import { processInteractIntent, processChangeFloorIntent } from '../systems/map.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { updateExploredTiles } from '../systems/map.system.ts';
import { processTriggers } from '../systems/trigger.system.ts';
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
import { processUseItemIntent, processUseAbilityIntent } from '../systems/effects.system.ts';
import { UIMode } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { assertNever } from '../utils/assert.ts';

import { processStatusEffectsTick, shouldSkipTurn } from '../systems/status-effect.system.ts';
import { processHungerTick } from '../systems/hunger.system.ts';

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
 * Queues or immediately executes a player intent.
 */
export function queuePlayerIntent(intent: Intent): void {
  const state = getGameState();
  if (state.isGameOver) return;

  const isImmediate = 'isImmediate' in intent && intent.isImmediate;

  if (isImmediate) {
    const result = applyIntentWithCost(state, intent);
    updateState(result.state);
    return;
  }

  if (state.engineMode === EngineMode.RTwP && !state.rtwpState.paused) {
    // Unpaused override
    updateState({ ...state, playerCommandQueue: [intent] });
  } else {
    // Append to queue
    const nextQueue = [...state.playerCommandQueue, intent];
    updateState({ ...state, playerCommandQueue: nextQueue });
  }

  if (state.engineMode === EngineMode.TurnBased) {
    unlockEngine();
  }
}

import { getEffectiveStats } from '../utils/stats.ts';

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
    setTurnDuration(100);
    if (
      getComponent(state, entityId, ComponentType.Player) !== undefined &&
      state.engineMode === EngineMode.TurnBased
    ) {
      unlockEngine();
    }
    return;
  }

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  // Check if any active effect requires this entity to skip its turn
  if (shouldSkipTurn(state, entityId)) {
    if (isPlayer) {
      updateState(addMessage(state, `You are unable to act and skip your turn!`, MessageLogCategory.System));
      setTurnDuration(100);
      if (state.engineMode === EngineMode.TurnBased) unlockEngine();
    } else {
      setTurnDuration(100);
    }
    return;
  }

  if (isPlayer) {
    if (state.playerCommandQueue.length > 0) {
      const intent = state.playerCommandQueue[0];
      const nextQueue = state.playerCommandQueue.slice(1);

      const stateWithPoppedQueue = { ...state, playerCommandQueue: nextQueue };
      updateState(stateWithPoppedQueue);

      const result = applyIntentWithCost(stateWithPoppedQueue, intent as Intent);
      let nextState = result.state;

      if (result.energyCost > 0) {
        nextState = processHungerTick(nextState, entityId, result.energyCost);
        setTurnDuration(result.energyCost);
      } else {
        setTurnDuration(0);
      }

      if (nextState !== stateWithPoppedQueue) {
        updateState(updateExploredTiles(nextState));
      }
      return;
    }

    if (state.engineMode === EngineMode.TurnBased) {
      lockEngine();
      return;
    } else {
      setTurnDuration(10);
      const nextState = processHungerTick(state, entityId, 10);
      updateState(nextState);
      return;
    }
  } else {
    // AI Turn
    const intent = processAITurn(state, entityId);
    if (intent !== null) {
      const result = applyIntentWithCost(state, intent);
      let nextState = result.state;
      if (result.energyCost > 0) {
        nextState = processHungerTick(nextState, entityId, result.energyCost);
        setTurnDuration(result.energyCost);
      } else {
        // AI failed to execute its intended action (e.g., bumped into a friendly unit).
        // Force a turn duration to prevent an infinite 0-energy loop.
        setTurnDuration(100);
      }
      if (nextState !== state) {
        updateState(nextState);
      }
    } else {
      // AI waited / skipped turn
      const nextState = processHungerTick(state, entityId, 100);
      if (nextState !== state) {
        updateState(nextState);
      }
      setTurnDuration(100);
    }
  }
}

/**
 * Executes an intent and computes its energy cost based on success.
 */
function applyIntentWithCost(state: GameState, intent: Intent): ActionResult {
  const result = applyIntent(state, intent);
  let nextState = result.state;

  let energyCost = 100; // default cost

  if (!result.success) {
    energyCost = 0;
  } else if (intent.type === IntentType.Move) {
    const posAfter = getComponent(nextState, intent.entityId, ComponentType.Position);
    if (posAfter) {
      const tileIdx = coordToIndex(posAfter.x, posAfter.y, state.map.width);
      const tile = state.map.tiles[tileIdx];
      if (tile) {
        energyCost = state.campaign.tiles[tile.tileId]?.movementCost ?? 100;
      }
    }
    nextState = processTriggers(nextState, intent.entityId);
  } else if ('isImmediate' in intent && intent.isImmediate) {
    energyCost = 0; // UI/Debug actions take no time
  }

  // Scale cost by actor speed
  if (energyCost > 0) {
    const actor = getComponent(state, intent.entityId, ComponentType.Actor);
    if (actor) {
      const stats = getEffectiveStats(state, intent.entityId);
      const speed = Math.max(1, stats.speed);
      energyCost = Math.max(1, Math.round((energyCost * 100) / speed));
    }
  }

  return { state: nextState, success: result.success, energyCost };
}

/**
 * Dispatches an intent to the appropriate system for validation and execution.
 */
function applyIntent(state: GameState, intent: Intent): { state: GameState; success: boolean } {
  switch (intent.type) {
    case IntentType.Move:
      return processMoveIntent(state, intent);
    case IntentType.Wait:
      return { state: addMessage(state, 'You wait a moment.', MessageLogCategory.System), success: true };
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
    case IntentType.UseAbility:
      return processUseAbilityIntent(state, intent.entityId, intent.effectId, intent.abilityName);
    case IntentType.EquipItem:
      return processEquipItemIntent(state, intent.entityId, intent.itemIndex);
    case IntentType.UnequipItem:
      return processUnequipItemIntent(state, intent.entityId, intent.slot);
    case IntentType.ToggleInventory: {
      const nextUiModeInv = state.uiMode === UIMode.Game ? UIMode.Inventory : UIMode.Game;
      const invPaused = state.engineMode === EngineMode.RTwP ? nextUiModeInv !== UIMode.Game : state.rtwpState.paused;
      return {
        state: { ...state, uiMode: nextUiModeInv, rtwpState: { ...state.rtwpState, paused: invPaused } },
        success: false
      };
    }

    // --- DEBUG INTENTS ---
    case IntentType.DebugRevealMap: {
      const nextMap = { ...state.map, isFullyExplored: !state.map.isFullyExplored };
      const msg = nextMap.isFullyExplored ? '[DEBUG] Map Revealed.' : '[DEBUG] Map Hidden.';
      return { state: addMessage({ ...state, map: nextMap }, msg, MessageLogCategory.System), success: false };
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
        return {
          state: addMessage(
            { ...state, components: nextComponents },
            '[DEBUG] God Mode Disabled.',
            MessageLogCategory.System
          ),
          success: false
        };
      } else {
        // Add GodMode
        const godCmp: GodModeComponent = { type: ComponentType.GodMode };
        nextComponents.set(entityId, [...entityComps, godCmp]);
        return {
          state: addMessage(
            { ...state, components: nextComponents },
            '[DEBUG] God Mode Enabled.',
            MessageLogCategory.System
          ),
          success: false
        };
      }
    }

    case IntentType.DebugSpawnEntity: {
      const pos = getComponent(state, intent.entityId, ComponentType.Position);
      if (!pos) return { state, success: false };

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
        if (tile && state.campaign.tiles[tile.tileId]?.walkable) {
          const entitiesAt = state.spatialIndex.get(`${n.x},${n.y}`);
          if (!entitiesAt || entitiesAt.length === 0) {
            spawnX = n.x;
            spawnY = n.y;
            break;
          }
        }
      }

      if (spawnX === -1) {
        return {
          state: addMessage(state, '[DEBUG] No room to spawn entity.', MessageLogCategory.System),
          success: false
        };
      }

      const [stateAfterSpawn, newEntityId] = spawnEntity(state, 'orc', spawnX, spawnY);
      const nextState = stateAfterSpawn;

      const actor = getComponent(nextState, newEntityId, ComponentType.Actor);
      if (actor) {
        addActor(newEntityId);
      }

      return {
        state: addMessage(nextState, `[DEBUG] Spawned dummy Orc at ${spawnX}, ${spawnY}.`, MessageLogCategory.System),
        success: false
      };
    }

    case IntentType.ToggleEngineMode: {
      const nextMode = state.engineMode === EngineMode.TurnBased ? EngineMode.RTwP : EngineMode.TurnBased;
      setTimeout(() => switchEngineMode(nextMode), 0);
      return { state: { ...state, engineMode: nextMode }, success: false };
    }

    case IntentType.TogglePause: {
      const nextPaused = !state.rtwpState.paused;
      return { state: { ...state, rtwpState: { ...state.rtwpState, paused: nextPaused } }, success: false };
    }

    case IntentType.SetRTwPSpeed: {
      return {
        state: { ...state, rtwpState: { ...state.rtwpState, speedMultiplier: intent.speedMultiplier } },
        success: false
      };
    }

    default:
      return assertNever(intent);
  }
}
