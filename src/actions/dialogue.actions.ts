import { addComponent, getComponent } from '../core/ecs.ts';
import { ComponentType, type MemoryComponent } from '../types/components.types.ts';
import { GameEventType, type DialogueSelectedEvent } from '../types/events.types.ts';
import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import type {
  CloseDialogueIntent,
  SelectDialogueOptionIntent,
  StartDialogueIntent,
  AskAboutIntent,
  GossipIntent
} from '../types/intents/ui.intents.ts';
import { rng } from '../core/rng.ts';
import { DEFAULT_DEFLECTION_LINES } from '../constants/knowledge.constants.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { applyConsequence } from '../systems/trigger.system.ts';
import { resolveDialogueTree, startDialogue } from '../systems/dialogue.system.ts';
import { transferKnowledge } from '../systems/knowledge.system.ts';
export { transferKnowledge };

/**
 * Processes the intent to begin a dialogue interaction with an NPC.
 */
export function processStartDialogueIntent(
  state: GameState,
  intent: StartDialogueIntent
): { state: GameState; success: boolean } {
  return startDialogue(state, intent.targetId, intent.dialogueId);
}

/**
 * Processes the intent when a player selects an option in the active dialogue.
 */
export function processSelectDialogueOptionIntent(
  state: GameState,
  intent: SelectDialogueOptionIntent
): { state: GameState; success: boolean } {
  if (!state.activeDialogue) {
    return { state, success: false };
  }

  const { treeId, currentNodeId, npcEntityId } = state.activeDialogue;
  const tree = resolveDialogueTree(state, treeId, npcEntityId);
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
      const evalCons = { ...consequence, _npcEntityId: npcEntityId, _playerEntityId: intent.entityId };
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

  const nextNodeId = option.nextNodeId;
  const nextNode = tree.nodes[nextNodeId];
  if (nextNode) {
    if (nextNode.dynamicType === 'trade') {
      return {
        state: {
          ...nextState,
          uiMode: UIMode.Trade,
          activeTrade: { npcEntityId },
          activeDialogue: undefined
        },
        success: false
      };
    }
    if (nextNode.dynamicType === 'inject_rumor' && nextNode.injectRumorId) {
      const rule = state.campaign.rumorPropagation?.find((r) => r.id === nextNode.injectRumorId);
      if (rule) {
        const npcMemory = getComponent(nextState, npcEntityId, ComponentType.Memory) as MemoryComponent | undefined;
        if (npcMemory) {
          const rumorPool = npcMemory.rumorPool || [];
          const alreadyHas = rumorPool.some((r) => r.id === rule.rumorTemplate.id);
          if (!alreadyHas) {
            const nextRumorPool = [
              ...rumorPool,
              {
                id: rule.rumorTemplate.id,
                text: rule.rumorTemplate.text,
                turnCreated: 0,
                persistent: rule.rumorTemplate.persistent
              }
            ];
            nextState = addComponent(nextState, npcEntityId, {
              ...npcMemory,
              rumorPool: nextRumorPool
            });
            nextState = addMessage(nextState, `They learned a new rumor.`, MessageLogCategory.System);
          }
        }
      }
    }
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

/**
 * Processes the intent to close/end the active dialogue.
 */
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

/**
 * Validates and routes dialog after checking if the NPC possesses the queried topic.
 * @param state The current GameState.
 * @param intent The AskAboutIntent.
 * @returns State with updated activeDialogue.
 */
export function processAskAboutIntent(
  state: GameState,
  intent: AskAboutIntent
): { state: GameState; success: boolean } {
  if (!state.activeDialogue) return { state, success: false };

  const { npcEntityId, treeId, currentNodeId } = state.activeDialogue;
  const tree = resolveDialogueTree(state, treeId, npcEntityId);
  if (!tree) return { state, success: false };

  const currentNode = tree.nodes[currentNodeId];
  if (!currentNode || currentNode.dynamicType !== 'ask_about') return { state, success: false };

  const npcMemory = getComponent(state, npcEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  const npcKnowledge = npcMemory?.knowledge ?? {};

  let nextState = state;
  let textOverride: string | undefined = undefined;

  if (npcKnowledge[intent.topicId]) {
    nextState = transferKnowledge(nextState, npcEntityId, intent.entityId, intent.topicId);

    const targetNodeId = currentNode.onKnownNodeId ?? currentNodeId;
    const targetNode = tree.nodes[targetNodeId];
    if (targetNode) {
      const item = npcKnowledge[intent.topicId]!;
      textOverride = targetNode.text.replace(/{topic}/g, item.id).replace(/{description}/g, item.description);
    }

    return {
      state: {
        ...nextState,
        activeDialogue: {
          treeId,
          npcEntityId,
          currentNodeId: targetNodeId,
          ...(textOverride !== undefined ? { textOverride } : {})
        }
      },
      success: false
    };
  } else {
    const targetNodeId = currentNode.onUnknownNodeId ?? currentNodeId;
    const targetNode = tree.nodes[targetNodeId];

    const lines = npcMemory?.deflectionLines ?? DEFAULT_DEFLECTION_LINES;
    const index = rng.getUniformInt(0, lines.length - 1);
    const deflectionLine = lines[index] ?? DEFAULT_DEFLECTION_LINES[0]!;

    if (targetNode) {
      textOverride = targetNode.text.includes('{deflection}')
        ? targetNode.text.replace(/{deflection}/g, deflectionLine)
        : deflectionLine;
    } else {
      textOverride = deflectionLine;
    }

    return {
      state: {
        ...nextState,
        activeDialogue: {
          treeId,
          npcEntityId,
          currentNodeId: targetNodeId,
          textOverride
        }
      },
      success: false
    };
  }
}

/**
 * Handles the Gossip intent, dispensing a rumor to the player.
 */
export function processGossipIntent(state: GameState, intent: GossipIntent): { state: GameState; success: boolean } {
  if (!state.activeDialogue) return { state, success: false };

  const { npcEntityId, treeId, currentNodeId } = state.activeDialogue;
  const tree = resolveDialogueTree(state, treeId, npcEntityId);
  if (!tree) return { state, success: false };

  const currentNode = tree.nodes[currentNodeId];
  if (!currentNode || currentNode.dynamicType !== 'gossip') return { state, success: false };

  const npcMemory = getComponent(state, npcEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (!npcMemory || !npcMemory.rumorPool || npcMemory.rumorPool.length === 0) {
    return { state, success: false };
  }

  const index = rng.getUniformInt(0, npcMemory.rumorPool.length - 1);
  const rumor = npcMemory.rumorPool[index]!;

  const playerMemory = getComponent(state, intent.entityId, ComponentType.Memory) as MemoryComponent | undefined;
  let nextState = state;

  if (playerMemory) {
    const nextKnowledge = {
      ...playerMemory.knowledge,
      [rumor.id]: {
        id: rumor.id,
        type: 'rumor' as const,
        description: rumor.text,
        tags: []
      }
    };
    nextState = addComponent(nextState, intent.entityId, {
      ...playerMemory,
      knowledge: nextKnowledge
    });
  }

  nextState = addMessage(nextState, `You heard a rumor.`, MessageLogCategory.System);

  return {
    state: {
      ...nextState,
      activeDialogue: {
        treeId,
        npcEntityId,
        currentNodeId: currentNode.onKnownNodeId ?? currentNodeId,
        textOverride: `They lean in closely. "${rumor.text}"`
      }
    },
    success: false
  };
}
