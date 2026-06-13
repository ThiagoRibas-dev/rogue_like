import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import { GameEventType, type DialogueSelectedEvent } from '../types/events.types.ts';
import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import type { CloseDialogueIntent, SelectDialogueOptionIntent, StartDialogueIntent } from '../types/intents.types.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { processQuestEvent } from '../systems/quest.system.ts';
import { applyConsequence } from '../systems/trigger.system.ts';

export function processStartDialogueIntent(
  state: GameState,
  intent: StartDialogueIntent
): { state: GameState; success: boolean } {
  const { targetId, dialogueId } = intent;
  const tree = state.campaign.dialogues[dialogueId];

  if (!tree) {
    return {
      state: addMessage(state, 'They have nothing to say.', MessageLogCategory.System),
      success: false
    };
  }

  let targetTemplateId = targetId.toString();
  const templateComp = getComponent(state, targetId, ComponentType.Template) as
    | import('../types/components.types.ts').TemplateComponent
    | undefined;
  if (templateComp) {
    targetTemplateId = templateComp.templateId;
  }

  // Trigger any "talk" quest objectives
  const nextState = processQuestEvent(state, 'talk', targetTemplateId, 1);

  return {
    state: {
      ...nextState,
      uiMode: UIMode.Dialogue,
      activeDialogue: {
        treeId: dialogueId,
        currentNodeId: tree.startNodeId,
        npcEntityId: targetId
      }
    },
    success: false // Doesn't consume a turn to just open UI, or maybe it does? In RTwP it might pause.
  };
}

export function processSelectDialogueOptionIntent(
  state: GameState,
  intent: SelectDialogueOptionIntent
): { state: GameState; success: boolean } {
  if (!state.activeDialogue) {
    return { state, success: false };
  }

  const { treeId, currentNodeId, npcEntityId } = state.activeDialogue;
  const tree = state.campaign.dialogues[treeId];
  if (!tree) return { state, success: false };

  const node = tree.nodes[currentNodeId];
  if (!node) return { state, success: false };

  const option = node.options.find((o) => o.id === intent.optionId);
  if (!option) return { state, success: false };

  // Evaluate actions
  let nextState: GameState = {
    ...state,
    events: [
      ...state.events,
      {
        type: GameEventType.DialogueSelected as const,
        dialogueId: treeId,
        optionId: intent.optionId
      }
    ]
  };

  if (option.consequences) {
    const dummyEvent: DialogueSelectedEvent = {
      type: GameEventType.DialogueSelected,
      dialogueId: treeId,
      optionId: intent.optionId
    };

    for (const consequence of option.consequences) {
      const evalCons = {
        ...consequence,
        params: { ...consequence.params, _npcEntityId: npcEntityId, _playerEntityId: intent.entityId }
      };
      nextState = applyConsequence(nextState, dummyEvent, evalCons);
    }
  }

  if (!option.nextNodeId) {
    // End conversation
    return {
      state: {
        ...nextState,
        uiMode: UIMode.Game,
        activeDialogue: undefined
      },
      success: false
    };
  }

  return {
    state: {
      ...nextState,
      activeDialogue: {
        treeId,
        currentNodeId: option.nextNodeId,
        npcEntityId
      }
    },
    success: false
  };
}

export function processCloseDialogueIntent(
  state: GameState,
  _intent: CloseDialogueIntent
): { state: GameState; success: boolean } {
  return {
    state: {
      ...state,
      uiMode: UIMode.Game,
      activeDialogue: undefined
    },
    success: false
  };
}
