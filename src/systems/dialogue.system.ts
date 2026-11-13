import { addComponent, getComponent } from '../core/ecs.ts';
import type { DialogueTree } from '../types/dialogue.types.ts';
import { ComponentType, type MemoryComponent, type TemplateComponent } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { buildCompanionOrdersDialogueTree, COMPANION_ORDERS_DIALOGUE_ID } from './companion_commands.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { processQuestEvent } from './quest.system.ts';

/**
 * Resolves a dialogue tree by ID, synthesizing dynamic Console dialogue trees
 * (such as `__companion_orders__`) when requested.
 *
 * @param state Current GameState.
 * @param treeId Dialogue tree identifier.
 * @param npcEntityId Target NPC or companion EntityId.
 * @returns Resolved DialogueTree, or `undefined` if not found.
 */
export function resolveDialogueTree(state: GameState, treeId: string, npcEntityId: EntityId): DialogueTree | undefined {
  if (treeId === COMPANION_ORDERS_DIALOGUE_ID) {
    return buildCompanionOrdersDialogueTree(state, npcEntityId);
  }
  return state.campaign.dialogues[treeId];
}

/**
 * Initializes and transitions the game state into an active dialogue tree session with an NPC.
 * Triggers quest events and increments interaction counters.
 *
 * @param state The current GameState.
 * @param targetId The entity ID of the NPC being addressed.
 * @param dialogueId The ID of the dialogue tree to open.
 * @returns Updated GameState and a success flag.
 */
export function startDialogue(
  state: GameState,
  targetId: EntityId,
  dialogueId: string
): { state: GameState; success: boolean } {
  const tree = resolveDialogueTree(state, dialogueId, targetId);

  if (!tree) {
    return {
      state: addMessage(state, 'They have nothing to say.', MessageLogCategory.System),
      success: false
    };
  }

  let targetTemplateId = targetId.toString();
  const templateComp = getComponent(state, targetId, ComponentType.Template) as TemplateComponent | undefined;
  if (templateComp) {
    targetTemplateId = templateComp.templateId;
  }

  // Trigger any "talk" quest objectives
  const nextState = processQuestEvent(state, 'talk', targetTemplateId, 1);

  let stateWithTimesTalked = nextState;
  const memory = getComponent(nextState, targetId, ComponentType.Memory) as MemoryComponent | undefined;
  if (memory) {
    const nextMemory = {
      ...memory,
      timesTalked: (memory.timesTalked ?? 0) + 1
    };
    stateWithTimesTalked = addComponent(nextState, targetId, nextMemory);
  }

  return {
    state: {
      ...stateWithTimesTalked,
      uiMode: UIMode.Dialogue,
      activeDialogue: {
        treeId: dialogueId,
        currentNodeId: tree.startNodeId,
        npcEntityId: targetId
      }
    },
    success: false
  };
}
