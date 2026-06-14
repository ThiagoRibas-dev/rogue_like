import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';
import type { EntityId } from '../game-state.types.ts';

export interface ToggleInventoryIntent extends BaseIntent {
  readonly type: IntentType.ToggleInventory;
  readonly isImmediate: true;
}

export interface ToggleFactionsIntent extends BaseIntent {
  readonly type: IntentType.ToggleFactions;
  readonly isImmediate: true;
}

export interface ToggleSettingsIntent extends BaseIntent {
  readonly type: IntentType.ToggleSettings;
  readonly isImmediate: true;
}

export interface StartDialogueIntent extends BaseIntent {
  readonly type: IntentType.StartDialogue;
  readonly targetId: EntityId;
  readonly dialogueId: string;
}

export interface SelectDialogueOptionIntent extends BaseIntent {
  readonly type: IntentType.SelectDialogueOption;
  readonly optionId: string;
  readonly isImmediate: true;
}

export interface CloseDialogueIntent extends BaseIntent {
  readonly type: IntentType.CloseDialogue;
  readonly isImmediate: true;
}

export interface ToggleQuestsIntent extends BaseIntent {
  readonly type: IntentType.ToggleQuests;
  readonly isImmediate: true;
}

export interface ToggleInvestigationIntent extends BaseIntent {
  readonly type: IntentType.ToggleInvestigation;
  readonly isImmediate: true;
}

export interface ToggleDebugIntent extends BaseIntent {
  readonly type: IntentType.ToggleDebug;
  readonly isImmediate: true;
}
