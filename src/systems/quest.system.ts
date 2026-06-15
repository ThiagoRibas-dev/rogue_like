import type { GameState } from '../types/game-state.types.ts';
import { getComponent, addComponent } from '../core/ecs.ts';
import { ComponentType, type QuestLogComponent } from '../types/components.types.ts';
import type { Quest } from '../types/quests.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { grantXp } from './death.system.ts';
import { GameEventType, type QuestCompletedEvent, type QuestStageChangedEvent } from '../types/events.types.ts';
import type { QuestState } from '../types/components.types.ts';
import type { EntityId } from '../types/game-state.types.ts';

/**
 * Gets a quest definition from either the static campaign registry or dynamic quests.
 */
export function getQuestDef(state: GameState, questId: string): Quest | undefined {
  return state.campaign.quests[questId] || state.dynamicQuests[questId];
}

/**
 * Rebuilds the active triggers bucket for O(1) event routing.
 */
export function rebuildQuestTriggers(state: GameState, quests: Record<string, QuestState>): Record<string, string[]> {
  const triggers: Record<string, string[]> = {};
  for (const [questId, qState] of Object.entries(quests)) {
    if (qState.status !== 'active') continue;
    const def = getQuestDef(state, questId);
    if (!def) continue;
    for (const obj of def.objectives) {
      const key = `${obj.type}:${obj.targetId}`;
      if (!triggers[key]) triggers[key] = [];
      if (!triggers[key].includes(questId)) triggers[key].push(questId);
    }
  }
  return triggers;
}

/**
 * Manually completes a quest, granting rewards and updating its status.
 */
export function completeQuest(state: GameState, playerId: EntityId, questId: string): GameState {
  const questLog = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent | undefined;
  if (!questLog) return state;

  const qState = questLog.quests[questId];
  if (!qState) return state;

  const questDef = getQuestDef(state, questId);
  if (!questDef) return state;

  const nextQuests = { ...questLog.quests };
  nextQuests[questId] = { ...qState, status: 'completed' };

  let nextState = addMessage(state, `Quest Completed: ${questDef.title}`, MessageLogCategory.System);

  if (questDef.rewards) {
    for (const reward of questDef.rewards) {
      if (reward.type === 'xp' && reward.amount) {
        nextState = grantXp(nextState, playerId, reward.amount);
      }
      // Future: handle item/standing rewards here
    }
  }

  nextState = {
    ...nextState,
    events: [
      ...nextState.events,
      {
        type: GameEventType.QuestCompleted,
        questId
      } as QuestCompletedEvent
    ]
  };

  const nextTriggers = rebuildQuestTriggers(nextState, nextQuests);

  const nextQuestLog: QuestLogComponent = { ...questLog, quests: nextQuests, activeTriggers: nextTriggers };
  return addComponent(nextState, playerId, nextQuestLog);
}

/**
 * Grants a new quest to a player.
 */
export function grantQuest(state: GameState, playerId: EntityId, questId: string): GameState {
  const questLog = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent | undefined;
  if (!questLog) return state;
  if (questLog.quests[questId]) return state; // Already has quest

  const questDef = getQuestDef(state, questId);
  if (!questDef) return state;

  const nextQuests = { ...questLog.quests };
  nextQuests[questId] = { questId, status: 'active', objectiveProgress: {} };

  const nextState = addMessage(state, `New Quest: ${questDef.title}`, MessageLogCategory.System);

  const nextTriggers = rebuildQuestTriggers(nextState, nextQuests);

  const nextQuestLog: QuestLogComponent = { ...questLog, quests: nextQuests, activeTriggers: nextTriggers };
  return addComponent(nextState, playerId, nextQuestLog);
}

/**
 * Processes an event (e.g., 'kill', 'gather') and updates any active quests.
 */
export function processQuestEvent(
  state: GameState,
  eventType: string,
  targetId: string,
  amount: number = 1
): GameState {
  const playerEntities = state.entities.filter((e) => getComponent(state, e, ComponentType.Player));
  if (playerEntities.length === 0) return state;
  const playerId = playerEntities[0];
  if (playerId === undefined) return state;

  const questLog = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent | undefined;
  if (!questLog) return state;

  let nextState = state;
  let questsModified = false;
  const nextQuests = { ...questLog.quests };

  // Use the bucket cache, falling back to full rebuild if it's missing (e.g. from an old save)
  const triggers = questLog.activeTriggers ?? rebuildQuestTriggers(state, nextQuests);
  const relevantQuestIds = triggers[`${eventType}:${targetId}`];

  if (!relevantQuestIds || relevantQuestIds.length === 0) return state;

  for (const questId of relevantQuestIds) {
    const qState = nextQuests[questId];
    if (!qState || qState.status !== 'active') continue;

    const questDef = getQuestDef(state, questId);
    if (!questDef) continue;

    let progressChanged = false;
    const nextProgress = { ...qState.objectiveProgress };

    for (const obj of questDef.objectives) {
      if (obj.type === eventType && obj.targetId === targetId) {
        const currentProgress = nextProgress[obj.id] ?? 0;
        if (currentProgress < obj.requiredAmount) {
          nextProgress[obj.id] = Math.min(currentProgress + amount, obj.requiredAmount);
          progressChanged = true;
          nextState = addMessage(
            nextState,
            `Quest Progress: ${obj.description} (${nextProgress[obj.id]}/${obj.requiredAmount})`,
            MessageLogCategory.System
          );
          nextState = {
            ...nextState,
            events: [
              ...nextState.events,
              {
                type: GameEventType.QuestStageChanged,
                questId,
                objectiveId: obj.id
              } as QuestStageChangedEvent
            ]
          };
        }
      }
    }

    if (progressChanged) {
      questsModified = true;
      nextQuests[questId] = { ...qState, objectiveProgress: nextProgress };

      // Check for completion
      const isComplete = questDef.objectives.every((obj) => (nextProgress[obj.id] ?? 0) >= obj.requiredAmount);
      // For now, auto-complete quests if they are done, or require speaking to NPC.
      // If autoComplete is false, we wait for a dialogue action 'complete_quest' which we can add later.
      // For simplicity in Phase B, let's just auto-complete it if there's no explicitly false flag.
      if (isComplete && questDef.autoComplete !== false) {
        // We defer to completeQuest, but we need the intermediate state updates to persist first.
        nextQuests[questId] = { ...nextQuests[questId], status: 'completed' };
      }
    }
  }

  if (questsModified) {
    const nextTriggers = rebuildQuestTriggers(nextState, nextQuests);
    const nextQuestLog: QuestLogComponent = { ...questLog, quests: nextQuests, activeTriggers: nextTriggers };
    nextState = addComponent(nextState, playerId, nextQuestLog);
  }

  // Now process completions
  for (const [questId, qState] of Object.entries(nextQuests)) {
    if (qState.status === 'completed' && questLog.quests[questId]?.status !== 'completed') {
      nextState = completeQuest(nextState, playerId, questId);
    }
  }

  return nextState;
}
