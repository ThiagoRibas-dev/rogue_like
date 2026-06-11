import type { GameState } from '../types/game-state.types.ts';
import type { Intent } from '../types/intents.types.ts';
import { IntentType } from '../types/intents.types.ts';
import { assertNever } from '../utils/assert.ts';

// Handlers
import { getComponent, spawnEntity } from '../core/ecs.ts';
import { addActor, switchEngineMode } from '../core/scheduler.ts';
import { processMeleeAttackIntent } from '../systems/combat.system.ts';
import { processUseAbilityIntent, processUseItemIntent } from '../systems/effects.system.ts';
import { processMoveInspectIntent, processToggleInspectIntent } from '../systems/inspect.system.ts';
import {
  processDropIntent,
  processEquipItemIntent,
  processPickUpIntent,
  processUnequipItemIntent
} from '../systems/inventory.system.ts';
import { processChangeAreaIntent, processInteractIntent } from '../systems/map.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { processMoveIntent } from '../systems/movement.system.ts';
import {
  processFireAimedIntent,
  processMoveTargetIntent,
  processToggleTargetingIntent
} from '../systems/targeting.system.ts';
import { ComponentType, type GodModeComponent } from '../types/components.types.ts';
import { EngineMode, UIMode } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';

export type ActionHandler<T extends Intent> = (state: GameState, intent: T) => { state: GameState; success: boolean };

/**
 * Dispatches an intent to the appropriate system for validation and execution.
 * This replaces the monolithic switch statement in game-loop.ts.
 */
export function dispatchAction(state: GameState, intent: Intent): { state: GameState; success: boolean } {
  switch (intent.type) {
    case IntentType.Move:
      return processMoveIntent(state, intent);
    case IntentType.Wait:
      return { state: addMessage(state, 'You wait a moment.', MessageLogCategory.System), success: true };
    case IntentType.Interact:
      return processInteractIntent(state, intent);
    case IntentType.ChangeArea:
      return processChangeAreaIntent(state, intent);
    case IntentType.MeleeAttack:
      return processMeleeAttackIntent(state, intent);

    // --- TARGETING INTENTS ---
    case IntentType.ToggleTargeting:
      return processToggleTargetingIntent(state, intent);
    case IntentType.MoveTarget:
      return processMoveTargetIntent(state, intent);
    case IntentType.FireAimed:
      return processFireAimedIntent(state, intent);

    // --- INSPECT INTENTS ---
    case IntentType.ToggleInspect:
      return processToggleInspectIntent(state, intent);
    case IntentType.MoveInspect:
      return processMoveInspectIntent(state, intent);

    // --- INVENTORY INTENTS ---
    case IntentType.PickUp:
      return processPickUpIntent(state, intent.entityId);
    case IntentType.Drop:
      return processDropIntent(state, intent.entityId, intent.itemIndex);
    case IntentType.UseItem:
      return processUseItemIntent(state, intent.entityId, intent.itemIndex);
    case IntentType.UseAbility:
      return processUseAbilityIntent(state, intent as import('../types/intents.types.ts').UseAbilityIntent);
    case IntentType.EquipItem:
      return processEquipItemIntent(state, intent.entityId, intent.itemIndex);
    case IntentType.UnequipItem:
      return processUnequipItemIntent(state, intent.entityId, intent.slotId);
    case IntentType.ToggleInventory: {
      const nextUiModeInv = state.uiMode === UIMode.Game ? UIMode.Inventory : UIMode.Game;
      const invPaused = state.engineMode === EngineMode.RTwP ? nextUiModeInv !== UIMode.Game : state.rtwpState.paused;
      return {
        state: { ...state, uiMode: nextUiModeInv, rtwpState: { ...state.rtwpState, paused: invPaused } },
        success: false
      };
    }
    case IntentType.ToggleSettings: {
      const isGameStarted = state.entities.length > 0;
      const defaultMode = isGameStarted ? UIMode.Game : UIMode.MainMenu;
      const nextUiModeSettings = state.uiMode !== UIMode.Settings ? UIMode.Settings : defaultMode;
      const settingsPaused =
        state.engineMode === EngineMode.RTwP ? nextUiModeSettings !== UIMode.Game : state.rtwpState.paused;
      return {
        state: { ...state, uiMode: nextUiModeSettings, rtwpState: { ...state.rtwpState, paused: settingsPaused } },
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

    case IntentType.ToggleRotated: {
      return {
        state: { ...state, isRotated: !state.isRotated },
        success: false
      };
    }

    case IntentType.Toggle3D: {
      return {
        state: { ...state, is3D: !state.is3D },
        success: false
      };
    }

    case IntentType.SetZoomLevel: {
      const nextZoom = Math.max(0.5, Math.min(3.0, state.zoomLevel + intent.zoomDelta));
      return {
        state: { ...state, zoomLevel: nextZoom },
        success: false
      };
    }

    default:
      return assertNever(intent);
  }
}
