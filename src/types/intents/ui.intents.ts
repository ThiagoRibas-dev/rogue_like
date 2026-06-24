import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';
import type { EntityId } from '../game-state.types.ts';

/** Intent to toggle the visibility of the inventory screen overlay. */
export interface ToggleInventoryIntent extends BaseIntent {
  readonly type: IntentType.ToggleInventory;
  readonly isImmediate: true;
}

/** Intent to toggle the faction reputation display overlay. */
export interface ToggleFactionsIntent extends BaseIntent {
  readonly type: IntentType.ToggleFactions;
  readonly isImmediate: true;
}

/** Intent to toggle the gameplay settings menu overlay. */
export interface ToggleSettingsIntent extends BaseIntent {
  readonly type: IntentType.ToggleSettings;
  readonly isImmediate: true;
}

/** Intent to initialize dialogue session with a target NPC. */
export interface StartDialogueIntent extends BaseIntent {
  readonly type: IntentType.StartDialogue;
  readonly targetId: EntityId;
  readonly dialogueId: string;
}

/** Intent to choose a dialogue option inside active conversation. */
export interface SelectDialogueOptionIntent extends BaseIntent {
  readonly type: IntentType.SelectDialogueOption;
  readonly optionId: string;
  readonly isImmediate: true;
}

/** Intent to terminate active dialogue session. */
export interface CloseDialogueIntent extends BaseIntent {
  readonly type: IntentType.CloseDialogue;
  readonly isImmediate: true;
}

/** Intent to toggle the quest log dashboard overlay. */
export interface ToggleQuestsIntent extends BaseIntent {
  readonly type: IntentType.ToggleQuests;
  readonly isImmediate: true;
}

/** Intent to toggle the investigation board overlay. */
export interface ToggleInvestigationIntent extends BaseIntent {
  readonly type: IntentType.ToggleInvestigation;
  readonly isImmediate: true;
}

/** Intent to toggle the debug overlay developer panel. */
export interface ToggleDebugIntent extends BaseIntent {
  readonly type: IntentType.ToggleDebug;
  readonly isImmediate: true;
}

/** Intent to toggle the player chronicle/nemesis dossier overlay. */
export interface ToggleDossierIntent extends BaseIntent {
  readonly type: IntentType.ToggleDossier;
  readonly isImmediate: true;
}

/** Intent to ask an NPC about a specific knowledge topic. */
export interface AskAboutIntent extends BaseIntent {
  readonly type: IntentType.AskAbout;
  readonly entityId: EntityId;
  readonly topicId: string;
  readonly isImmediate: true;
}

/** Intent to prompt an NPC for gossip rumors in dynamic dialogue nodes. */
export interface GossipIntent extends BaseIntent {
  readonly type: IntentType.Gossip;
  readonly entityId: EntityId;
  readonly isImmediate: true;
}
