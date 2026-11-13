import type { GameState } from '../types/game-state.types.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import type { UseAbilityIntent } from '../types/intents/combat.intents.ts';
import type { DebugFastForwardSchemesIntent } from '../types/intents/debug.intents.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL } from '../constants/display.constants.ts';
import { assertNever } from '../utils/assert.ts';
import { closeTopModal, getCurrentModal, openModal, toggleModal } from '../core/modal_manager.ts';
import { switchEngineMode } from '../core/scheduler.ts';
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
import { processApplyIntent } from '../systems/apply.system.ts';
import {
  processCloseDialogueIntent,
  processSelectDialogueOptionIntent,
  processStartDialogueIntent,
  processAskAboutIntent,
  processGossipIntent
} from './dialogue.actions.ts';
import { processInteractIntent } from '../systems/intent.system.ts';
import { processSayIntent } from './say.action.ts';
import {
  processDebugRevealMap,
  processDebugGodMode,
  processDebugSpawnEntity,
  processDebugFastForwardSchemes,
  processDebugPromote
} from './debug_handlers.actions.ts';
import { EngineMode, UIMode } from '../types/game-state.types.ts';
import type { GameEvent } from '../types/events.types.ts';

/**
 * Processes an intent of a specific type against the current GameState, returning the updated state.
 */
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

    case IntentType.ToggleTargeting:
      return processToggleTargetingIntent(state, intent);
    case IntentType.MoveTarget:
      return processMoveTargetIntent(state, intent);
    case IntentType.FireAimed:
      return processFireAimedIntent(state, intent);

    case IntentType.ToggleInspect:
      return processToggleInspectIntent(state, intent);
    case IntentType.MoveInspect:
      return processMoveInspectIntent(state, intent);

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
    case IntentType.ToggleInventory:
      return { state: toggleModal(state, UIMode.Inventory), success: false };
    case IntentType.ToggleFactions:
      return { state: toggleModal(state, UIMode.Factions), success: false };
    case IntentType.ToggleSettings: {
      const isOpen = state.uiMode === UIMode.Settings || getCurrentModal() === UIMode.Settings;
      if (!isOpen) return { state: openModal(state, UIMode.Settings), success: false };

      const closed = closeTopModal(state);
      const isGameStarted = state.entities.length > 0;
      return { state: isGameStarted ? closed : { ...closed, uiMode: UIMode.MainMenu }, success: false };
    }
    case IntentType.ToggleQuests:
      return { state: toggleModal(state, UIMode.Quests), success: false };
    case IntentType.ToggleInvestigation:
      return { state: toggleModal(state, UIMode.Investigation), success: false };
    case IntentType.ToggleDebug:
      return { state: toggleModal(state, UIMode.Debug), success: false };
    case IntentType.ToggleDossier:
      return { state: toggleModal(state, UIMode.Dossier), success: false };
    case IntentType.ToggleLedger:
      return { state: toggleModal(state, UIMode.Ledger), success: false };
    case IntentType.ToggleCartridgeModal:
      return { state: toggleModal(state, UIMode.CartridgeModal, intent.modalId), success: false };

    case IntentType.DebugRevealMap:
      return processDebugRevealMap(state);
    case IntentType.DebugGodMode:
      return processDebugGodMode(state, intent.entityId);
    case IntentType.DebugSpawnEntity:
      return processDebugSpawnEntity(state, intent.entityId);
    case IntentType.DebugFastForwardSchemes:
      return processDebugFastForwardSchemes(state, intent as DebugFastForwardSchemesIntent);
    case IntentType.DebugPromote:
      return processDebugPromote(state, intent.entityId);

    case IntentType.ToggleEngineMode: {
      const nextMode = state.engineMode === EngineMode.TurnBased ? EngineMode.RTwP : EngineMode.TurnBased;
      setTimeout(() => switchEngineMode(nextMode), 0);
      return { state: { ...state, engineMode: nextMode }, success: false };
    }

    case IntentType.TogglePause: {
      const nextPaused = !state.rtwpState.paused;
      return { state: { ...state, rtwpState: { ...state.rtwpState, paused: nextPaused } }, success: false };
    }

    case IntentType.SetRTwPSpeed:
      return {
        state: { ...state, rtwpState: { ...state.rtwpState, speedMultiplier: intent.speedMultiplier } },
        success: false
      };

    case IntentType.ToggleRotated:
      return {
        state: { ...state, isRotated: !state.isRotated },
        success: false
      };

    case IntentType.Toggle3D:
      return {
        state: { ...state, is3D: !state.is3D },
        success: false
      };

    case IntentType.SetZoomLevel: {
      const ZOOM_ROUNDING_FACTOR = 100;
      const clampedZoom = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, state.zoomLevel + intent.zoomDelta));
      const nextZoom = Math.round(clampedZoom * ZOOM_ROUNDING_FACTOR) / ZOOM_ROUNDING_FACTOR;
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
    case IntentType.AskAbout:
      return processAskAboutIntent(state, intent);
    case IntentType.Gossip:
      return processGossipIntent(state, intent);
    case IntentType.Say:
      return processSayIntent(state, intent);
    default:
      return assertNever(intent);
  }
}
