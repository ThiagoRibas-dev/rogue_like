import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import type { UseAbilityIntent } from '../types/intents/combat.intents.ts';
import type { DebugFastForwardSchemesIntent } from '../types/intents/debug.intents.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { assertNever } from '../utils/assert.ts';

// Handlers
import { getComponent, spawnEntity, removeComponent, addComponent } from '../core/ecs.ts';
import { addActor, switchEngineMode } from '../core/scheduler.ts';
import { processMeleeAttackIntent } from '../systems/combat.system.ts';
import { processUseAbilityIntent } from '../systems/effects.system.ts';
import { processMoveInspectIntent, processToggleInspectIntent } from '../systems/inspect.system.ts';
import {
  processDropIntent,
  processEquipItemIntent,
  processPickUpIntent,
  processUnequipItemIntent
} from '../systems/inventory.system.ts';
import { processChangeAreaIntent } from '../systems/map.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { processMoveIntent } from '../systems/movement.system.ts';
import {
  processFireAimedIntent,
  processMoveTargetIntent,
  processToggleTargetingIntent
} from '../systems/targeting.system.ts';
import { processSchemeTurn } from '../systems/scheme.system.ts';
import { processApplyIntent } from '../systems/apply.system.ts';
import {
  processCloseDialogueIntent,
  processSelectDialogueOptionIntent,
  processStartDialogueIntent
} from './dialogue.actions.ts';
import { processInteractIntent } from '../systems/intent.system.ts';
import { ComponentType, type GodModeComponent, type SchemeComponent } from '../types/components.types.ts';
import { EngineMode, UIMode } from '../types/game-state.types.ts';
import { GameEventType, type ClueDiscoveredEvent, type GameEvent } from '../types/events.types.ts';
import { coordToIndex } from '../utils/grid.ts';

export type ActionHandler<T extends Intent> = (
  state: GameState,
  intent: T
) => { state: GameState; success: boolean; events?: readonly GameEvent[] };

/**
 * Dispatches an intent to the appropriate system for validation and execution.
 * This replaces the monolithic switch statement in game-loop.ts.
 */
export function dispatchAction(
  state: GameState,
  intent: Intent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } {
  switch (intent.type) {
    case IntentType.Move:
      return processMoveIntent(state, intent);
    case IntentType.Wait:
      return { state: addMessage(state, 'You wait a moment.', MessageLogCategory.System), success: true };
    case IntentType.ChangeArea:
      return processChangeAreaIntent(state, intent);
    case IntentType.MeleeAttack:
      return processMeleeAttackIntent(state, intent);
    case IntentType.Apply:
      return processApplyIntent(state, intent);

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
    case IntentType.UseAbility:
      return processUseAbilityIntent(state, intent as UseAbilityIntent);
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
    case IntentType.ToggleFactions: {
      const nextUiModeFactions = state.uiMode === UIMode.Game ? UIMode.Factions : UIMode.Game;
      const factionsPaused =
        state.engineMode === EngineMode.RTwP ? nextUiModeFactions !== UIMode.Game : state.rtwpState.paused;
      return {
        state: { ...state, uiMode: nextUiModeFactions, rtwpState: { ...state.rtwpState, paused: factionsPaused } },
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
    case IntentType.ToggleQuests: {
      const nextUiMode = state.uiMode === UIMode.Game ? UIMode.Quests : UIMode.Game;
      const questsPaused = state.engineMode === EngineMode.RTwP ? nextUiMode !== UIMode.Game : state.rtwpState.paused;
      return {
        state: { ...state, uiMode: nextUiMode, rtwpState: { ...state.rtwpState, paused: questsPaused } },
        success: false
      };
    }
    case IntentType.ToggleInvestigation: {
      const nextUiMode = state.uiMode === UIMode.Game ? UIMode.Investigation : UIMode.Game;
      const invPaused = state.engineMode === EngineMode.RTwP ? nextUiMode !== UIMode.Game : state.rtwpState.paused;
      return {
        state: { ...state, uiMode: nextUiMode, rtwpState: { ...state.rtwpState, paused: invPaused } },
        success: false
      };
    }
    case IntentType.ToggleDebug: {
      const nextUiMode = state.uiMode === UIMode.Game ? UIMode.Debug : UIMode.Game;
      const debugPaused = state.engineMode === EngineMode.RTwP ? nextUiMode !== UIMode.Game : state.rtwpState.paused;
      return {
        state: { ...state, uiMode: nextUiMode, rtwpState: { ...state.rtwpState, paused: debugPaused } },
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

      if (hasGodMode) {
        return {
          state: addMessage(
            removeComponent(state, entityId, ComponentType.GodMode),
            '[DEBUG] God Mode Disabled.',
            MessageLogCategory.System
          ),
          success: false
        };
      } else {
        const godCmp: GodModeComponent = { type: ComponentType.GodMode };
        return {
          state: addMessage(
            addComponent(state, entityId, godCmp),
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

    case IntentType.DebugFastForwardSchemes: {
      const intentFF = intent as DebugFastForwardSchemesIntent;
      let nextState = state;

      // Find all masterminds
      const masterminds: EntityId[] = [];
      for (const id of state.entities) {
        if (getComponent(state, id, ComponentType.Scheme)) masterminds.push(id);
      }
      for (const [id, record] of state.persistentEntities.entries()) {
        if (record.components[ComponentType.Scheme]) masterminds.push(id);
      }

      if (masterminds.length === 0) {
        return {
          state: addMessage(state, '[DEBUG] No masterminds found to fast-forward.', MessageLogCategory.System),
          success: false
        };
      }

      // Fast-forward loop
      for (let i = 0; i < intentFF.iterations; i++) {
        for (const mastermindId of masterminds) {
          nextState = processSchemeTurn(nextState, mastermindId);
        }
      }

      // Artificially inject clues for recently recruited minions
      let cluesInjected = 0;
      for (const mastermindId of masterminds) {
        const schemeComp = getComponent(nextState, mastermindId, ComponentType.Scheme) as SchemeComponent | undefined;
        if (!schemeComp) continue;

        for (const minionId of schemeComp.activeMinions) {
          // For the sake of the simulation, we'll just force a clue to drop if they have a minion
          const clueEvent: ClueDiscoveredEvent = {
            type: GameEventType.ClueDiscovered,
            clueId: `simulated_clue_${minionId}`,
            sourceEntityId: minionId,
            implicatesEntityId: mastermindId
          };
          nextState = { ...nextState, events: [...nextState.events, clueEvent] };
          cluesInjected++;
        }
      }

      nextState = addMessage(
        nextState,
        `[DEBUG] Fast-forwarded schemes ${intentFF.iterations} turns. Injected ${cluesInjected} simulated clues.`,
        MessageLogCategory.System
      );

      return { state: nextState, success: false };
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

    case IntentType.Interact:
      return processInteractIntent(state, intent);
    case IntentType.StartDialogue:
      return processStartDialogueIntent(state, intent);
    case IntentType.SelectDialogueOption:
      return processSelectDialogueOptionIntent(state, intent);
    case IntentType.CloseDialogue:
      return processCloseDialogueIntent(state, intent);
    default:
      return assertNever(intent);
  }
}
