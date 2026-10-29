import { addComponent, getComponent } from '../core/ecs.ts';
import { ComponentType, type MemoryComponent, type TemplateComponent } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { processQuestEvent } from './quest.system.ts';

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
  const tree = state.campaign.dialogues[dialogueId];

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
