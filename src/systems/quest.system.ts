import type { GameState } from '../types/game-state.types.ts';
import { getComponent, addComponent, spawnItem, removeComponent } from '../core/ecs.ts';
import {
  ComponentType,
  type QuestLogComponent,
  type InventoryComponent,
  type PositionComponent,
  type MemoryComponent,
  type ItemComponent
} from '../types/components.types.ts';
import type { Quest, QuestReward } from '../types/quests.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { grantXp } from './death.system.ts';
import { getEffectiveCapacity } from './inventory.system.ts';
import {
  GameEventType,
  type QuestCompletedEvent,
  type QuestFailedEvent,
  type QuestStageChangedEvent
} from '../types/events.types.ts';
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
 * Mapped reward applier contract enforcing compile-time exhaustiveness.
 */
export type QuestRewardApplier<K extends QuestReward['type']> = (
  state: GameState,
  recipientId: EntityId,
  reward: Extract<QuestReward, { type: K }>,
  questId: string
) => GameState;

export type QuestRewardApplierMap = {
  readonly [K in QuestReward['type']]: QuestRewardApplier<K>;
};

export const QUEST_REWARD_APPLIERS: QuestRewardApplierMap = {
  xp: (state, recipientId, reward) => {
    const amount = reward.amount ?? 0;
    if (amount <= 0) return state;
    const nextState = grantXp(state, recipientId, amount);
    return addMessage(nextState, `Gained ${amount} XP.`, MessageLogCategory.System);
  },
  item: (state, recipientId, reward) => {
    const count = reward.amount ?? 1;
    if (count <= 0) return state;
    let nextState = state;
    const inventory = getComponent(nextState, recipientId, ComponentType.Inventory) as InventoryComponent | undefined;
    const pos = getComponent(nextState, recipientId, ComponentType.Position) as PositionComponent | undefined;
    const px = pos?.x ?? 0;
    const py = pos?.y ?? 0;

    const currentInventoryItems = inventory ? [...inventory.items] : [];
    const capacity = getEffectiveCapacity(nextState, recipientId);
    let droppedOnGround = false;

    for (let i = 0; i < count; i++) {
      let itemEntityId: EntityId;
      [nextState, itemEntityId] = spawnItem(nextState, reward.itemId, px, py);
      if (inventory && currentInventoryItems.length < capacity) {
        nextState = removeComponent(nextState, itemEntityId, ComponentType.Position);
        currentInventoryItems.push(itemEntityId);
      } else {
        droppedOnGround = true;
      }
    }

    if (inventory) {
      nextState = addComponent(nextState, recipientId, { ...inventory, items: currentInventoryItems });
    }

    const itemName = nextState.campaign.items[reward.itemId]?.name ?? reward.itemId;
    nextState = addMessage(nextState, `Received reward: ${count}x ${itemName}.`, MessageLogCategory.System);
    if (droppedOnGround) {
      nextState = addMessage(nextState, `Inventory full! Some items dropped at your feet.`, MessageLogCategory.System);
    }
    return processQuestEvent(nextState, 'gather', reward.itemId, count);
  },
  standing: (state, recipientId, reward) => {
    const amount = reward.amount ?? 0;
    const memory = getComponent(state, recipientId, ComponentType.Memory) as MemoryComponent | undefined;
    if (!memory) return state;
    const currentStandings = memory.factionStandings ?? {};
    const newStanding = (currentStandings[reward.factionId] ?? 0) + amount;
    const nextMemory: MemoryComponent = {
      ...memory,
      factionStandings: { ...currentStandings, [reward.factionId]: newStanding }
    };
    const nextState = addComponent(state, recipientId, nextMemory);
    const sign = amount >= 0 ? `+${amount}` : `${amount}`;
    return addMessage(
      nextState,
      `Faction standing with ${reward.factionId} changed by ${sign} (${newStanding}).`,
      MessageLogCategory.System
    );
  },
  event: (state, _recipientId, reward) => {
    return {
      ...state,
      events: [
        ...state.events,
        {
          type: GameEventType.WorldEventFired,
          eventId: reward.eventType
        }
      ]
    };
  }
};

/**
 * Type-safe dispatcher for individual quest rewards via QUEST_REWARD_APPLIERS.
 *
 * @param state The current GameState.
 * @param recipientId The EntityId receiving the reward.
 * @param reward The QuestReward discriminated union member.
 * @param questId The completed quest ID.
 * @returns The updated GameState.
 */
export function applyQuestReward<K extends QuestReward['type']>(
  state: GameState,
  recipientId: EntityId,
  reward: Extract<QuestReward, { type: K }>,
  questId: string
): GameState {
  const applier: QuestRewardApplier<K> = QUEST_REWARD_APPLIERS[reward.type];
  return applier(state, recipientId, reward, questId);
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

  // Commit completed status and rebuilt activeTriggers BEFORE applying rewards
  // so that 'item' rewards emitting 'gather' events cannot overwrite or re-trigger this quest.
  const nextTriggers = rebuildQuestTriggers(nextState, nextQuests);
  const nextQuestLog: QuestLogComponent = { ...questLog, quests: nextQuests, activeTriggers: nextTriggers };
  nextState = addComponent(nextState, playerId, nextQuestLog);

  if (questDef.rewards) {
    for (const reward of questDef.rewards) {
      nextState = applyQuestReward(
        nextState,
        playerId,
        reward as Extract<QuestReward, { type: typeof reward.type }>,
        questId
      );
    }
  }

  const completedEvent: QuestCompletedEvent = {
    type: GameEventType.QuestCompleted,
    questId
  };

  nextState = {
    ...nextState,
    events: [...nextState.events, completedEvent]
  };

  // Auto-chain follow-up quest if defined
  if (questDef.nextQuestId) {
    nextState = grantQuest(nextState, playerId, questDef.nextQuestId);
  }

  return nextState;
}

/**
 * Fails an active quest, updating its status and emitting QuestFailedEvent.
 */
export function failQuest(state: GameState, playerId: EntityId, questId: string): GameState {
  const questLog = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent | undefined;
  if (!questLog) return state;

  const qState = questLog.quests[questId];
  if (!qState || qState.status !== 'active') return state;

  const questDef = getQuestDef(state, questId);
  if (!questDef) return state;

  const nextQuests = { ...questLog.quests };
  nextQuests[questId] = { ...qState, status: 'failed' };

  let nextState = addMessage(state, `Quest Failed: ${questDef.title}`, MessageLogCategory.System);

  nextState = {
    ...nextState,
    events: [
      ...nextState.events,
      {
        type: GameEventType.QuestFailed,
        questId
      } as QuestFailedEvent
    ]
  };

  const nextTriggers = rebuildQuestTriggers(nextState, nextQuests);
  const nextQuestLog: QuestLogComponent = { ...questLog, quests: nextQuests, activeTriggers: nextTriggers };
  return addComponent(nextState, playerId, nextQuestLog);
}

/**
 * Grants a new quest to a player, calculating retroactive progress for items and current area.
 */
export function grantQuest(state: GameState, playerId: EntityId, questId: string): GameState {
  const questLog = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent | undefined;
  if (!questLog) return state;
  if (questLog.quests[questId]) return state; // Already has quest

  const questDef = getQuestDef(state, questId);
  if (!questDef) return state;

  // Calculate retroactive progress for already-owned items or current area
  const objectiveProgress: Record<string, number> = {};
  const inventory = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;

  for (const obj of questDef.objectives) {
    if (obj.type === 'gather' && inventory) {
      let count = 0;
      for (const itemEntityId of inventory.items) {
        const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
        if (itemComp && itemComp.itemId === obj.targetId) {
          count++;
        }
      }
      if (count > 0) {
        objectiveProgress[obj.id] = Math.min(count, obj.requiredAmount);
      }
    } else if (obj.type === 'explore' && state.currentAreaId === obj.targetId) {
      objectiveProgress[obj.id] = Math.min(1, obj.requiredAmount);
    }
  }

  const nextQuests = { ...questLog.quests };
  nextQuests[questId] = { questId, status: 'active', objectiveProgress };

  let nextState = addMessage(state, `New Quest: ${questDef.title}`, MessageLogCategory.System);

  const nextTriggers = rebuildQuestTriggers(nextState, nextQuests);
  const nextQuestLog: QuestLogComponent = { ...questLog, quests: nextQuests, activeTriggers: nextTriggers };
  nextState = addComponent(nextState, playerId, nextQuestLog);

  // Check if retroactive progress immediately completes the quest
  const isComplete =
    questDef.logicalOperator === 'OR'
      ? questDef.objectives.some((obj) => (objectiveProgress[obj.id] ?? 0) >= obj.requiredAmount)
      : questDef.objectives.every((obj) => (objectiveProgress[obj.id] ?? 0) >= obj.requiredAmount);

  if (isComplete && questDef.autoComplete !== false) {
    nextState = completeQuest(nextState, playerId, questId);
  }

  return nextState;
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
      const isComplete =
        questDef.logicalOperator === 'OR'
          ? questDef.objectives.some((obj) => (nextProgress[obj.id] ?? 0) >= obj.requiredAmount)
          : questDef.objectives.every((obj) => (nextProgress[obj.id] ?? 0) >= obj.requiredAmount);
      // For now, auto-complete quests if they are done, or require speaking to NPC.
      // If autoComplete is false, we wait for a dialogue action 'complete_quest' which we can add later.
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
