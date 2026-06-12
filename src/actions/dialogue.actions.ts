import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import type { CloseDialogueIntent, SelectDialogueOptionIntent, StartDialogueIntent } from '../types/intents.types.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { processQuestEvent, completeQuest, getQuestDef, rebuildQuestTriggers } from '../systems/quest.system.ts';
import { generateProceduralQuest } from '../systems/procedural-quest.system.ts';

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
  let nextState = state;
  if (option.actions) {
    for (const action of option.actions) {
      if (action.type === 'grant_quest') {
        const questLog = getComponent(nextState, intent.entityId, ComponentType.QuestLog) as
          | import('../types/components.types.ts').QuestLogComponent
          | undefined;
        if (questLog) {
          const questId = action.targetId;
          const questDef = nextState.campaign.quests[questId];
          if (questDef && !questLog.quests[questId]) {
            const nextQuests = { ...questLog.quests };
            const initialProgress: Record<string, number> = {};
            questDef.objectives.forEach((obj) => {
              initialProgress[obj.id] = 0;
            });
            nextQuests[questId] = {
              questId,
              status: 'active',
              objectiveProgress: initialProgress
            };
            const nextTriggers = rebuildQuestTriggers(nextState, nextQuests);
            const nextComps = new Map(nextState.components);
            const playerComps =
              nextComps
                .get(intent.entityId)
                ?.map((c) =>
                  c.type === ComponentType.QuestLog ? { ...c, quests: nextQuests, activeTriggers: nextTriggers } : c
                ) ?? [];
            nextComps.set(intent.entityId, playerComps);
            nextState = { ...nextState, components: nextComps };
          }
        }
      } else if (action.type === 'complete_quest') {
        const questLog = getComponent(nextState, intent.entityId, ComponentType.QuestLog) as
          | import('../types/components.types.ts').QuestLogComponent
          | undefined;
        if (questLog) {
          const questId = action.targetId;
          const questDef = getQuestDef(nextState, questId);
          const qState = questLog.quests[questId];

          if (questDef && qState && qState.status === 'active') {
            // Verify objectives are met
            const isComplete = questDef.objectives.every(
              (obj) => (qState.objectiveProgress[obj.id] ?? 0) >= obj.requiredAmount
            );
            if (isComplete) {
              nextState = completeQuest(nextState, intent.entityId, questId);
            }
          }
        }
      } else if (action.type === 'grant_dynamic_quest') {
        const { nextState: newState, questId } = generateProceduralQuest(nextState, action.targetId);
        nextState = newState;
        if (questId) {
          const questLog = getComponent(nextState, intent.entityId, ComponentType.QuestLog) as
            | import('../types/components.types.ts').QuestLogComponent
            | undefined;
          if (questLog && !questLog.quests[questId]) {
            const nextQuests = {
              ...questLog.quests,
              [questId]: { questId, status: 'active' as const, objectiveProgress: {} }
            };
            const nextTriggers = rebuildQuestTriggers(nextState, nextQuests);
            const nextComps = new Map(nextState.components);
            const playerComps =
              nextComps
                .get(intent.entityId)
                ?.map((c) =>
                  c.type === ComponentType.QuestLog ? { ...c, quests: nextQuests, activeTriggers: nextTriggers } : c
                ) ?? [];
            nextComps.set(intent.entityId, playerComps);
            nextState = { ...nextState, components: nextComps };

            const questDef = getQuestDef(nextState, questId);
            if (questDef) {
              nextState = addMessage(nextState, `New Quest: ${questDef.title}`, MessageLogCategory.System);
            }
          }

          // Give NPC a memory that they granted this template
          const npcMemory = getComponent(nextState, npcEntityId, ComponentType.Memory) as
            | import('../types/components.types.ts').MemoryComponent
            | undefined;
          if (npcMemory) {
            const nextFacts = [...npcMemory.facts, `gave_${action.targetId}`];
            const nextComps = new Map(nextState.components);
            const npcComps =
              nextComps
                .get(npcEntityId)
                ?.map((c) => (c.type === ComponentType.Memory ? { ...c, facts: nextFacts } : c)) ?? [];
            nextComps.set(npcEntityId, npcComps);
            nextState = { ...nextState, components: nextComps };
          }
        }
      } else if (action.type === 'emit_event') {
        // Just log it for now
        nextState = addMessage(nextState, `[Event Emitted: ${action.targetId}]`, MessageLogCategory.System);
      }
      // other actions...
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
