import type { GameState, EntityId } from '../../types/game-state.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { ConsequenceAction } from '../../types/trigger.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { MemoryComponent, FactionComponent } from '../../types/components.types.ts';
import type { ApplyIntentTarget } from '../../types/intents/interaction.intents.ts';
import { getComponent, addComponent } from '../../core/ecs.ts';
import { executeSay } from '../message.system.ts';
import { transferKnowledge } from '../knowledge.system.ts';

/**
 * Consequence appliers specific to NPCs, social interactions, and memory.
 */
export const socialConsequences = {
  modify_standing: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'modify_standing' }>
  ): GameState => {
    const amount = consequence.amount;
    const factionId = consequence.factionId;
    const memoryOwnerId = consequence._npcEntityId ?? consequence.entityId;

    if (memoryOwnerId === undefined || !factionId || !amount) return state;

    const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    if (!memory) return state;

    const newStanding = (memory.factionStandings[factionId] ?? 0) + amount;
    const newMemory = { ...memory, factionStandings: { ...memory.factionStandings, [factionId]: newStanding } };

    return addComponent(state, memoryOwnerId, newMemory);
  },

  set_fact: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'set_fact' }>
  ): GameState => {
    const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
    if (memOwnerId === undefined) return state;

    const memory = getComponent(state, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    if (memory && !memory.facts.includes(consequence.target)) {
      return addComponent(state, memOwnerId, {
        ...memory,
        facts: [...memory.facts, consequence.target]
      });
    }
    return state;
  },

  change_faction: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'change_faction' }>
  ): GameState => {
    let eId: EntityId | undefined;
    if (consequence.targetId) {
      eId = parseInt(consequence.targetId) as EntityId;
    } else if (event.type === GameEventType.ReactionResolved) {
      const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
      if (targetPayload.type === 'entity') {
        eId = targetPayload.entityId;
      }
    }

    if (eId === undefined) return state;

    const faction = getComponent(state, eId, ComponentType.Faction) as FactionComponent | undefined;
    if (faction) {
      return addComponent(state, eId, {
        ...faction,
        factionId: consequence.factionId
      });
    }
    return state;
  },

  record_interaction: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'record_interaction' }>
  ): GameState => {
    const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
    if (memOwnerId === undefined) return state;
    const memory = getComponent(state, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    if (memory) {
      const nextMemory: MemoryComponent = {
        ...memory,
        timesTalked: consequence.interactionType === 'talk' ? (memory.timesTalked ?? 0) + 1 : memory.timesTalked,
        timesTraded: consequence.interactionType === 'trade' ? (memory.timesTraded ?? 0) + 1 : memory.timesTraded,
        timesIntimidated:
          consequence.interactionType === 'intimidate' ? (memory.timesIntimidated ?? 0) + 1 : memory.timesIntimidated,
        timesHelped: consequence.interactionType === 'help' ? (memory.timesHelped ?? 0) + 1 : memory.timesHelped,
        timesBetrayed: consequence.interactionType === 'betray' ? (memory.timesBetrayed ?? 0) + 1 : memory.timesBetrayed
      };
      return addComponent(state, memOwnerId, nextMemory);
    }
    return state;
  },

  set_patience: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'set_patience' }>
  ): GameState => {
    const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
    if (memOwnerId === undefined) return state;
    const memory = getComponent(state, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    if (memory) {
      return addComponent(state, memOwnerId, { ...memory, patienceThreshold: consequence.value });
    }
    return state;
  },

  modify_knowledge: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'modify_knowledge' }>
  ): GameState => {
    const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
    if (memOwnerId === undefined) return state;
    const memory = getComponent(state, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    if (memory) {
      const nextKnowledge = { ...(memory.knowledge ?? {}) };
      if (consequence.action === 'add' && consequence.knowledgeType && consequence.description) {
        nextKnowledge[consequence.knowledgeId] = {
          id: consequence.knowledgeId,
          type: consequence.knowledgeType,
          description: consequence.description,
          tags: consequence.tags ?? []
        };
      } else if (consequence.action === 'remove') {
        delete nextKnowledge[consequence.knowledgeId];
      }
      return addComponent(state, memOwnerId, { ...memory, knowledge: nextKnowledge });
    }
    return state;
  },

  set_social_state: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'set_social_state' }>
  ): GameState => {
    const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
    if (memOwnerId === undefined) return state;
    const memory = getComponent(state, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    if (memory) {
      const nextMemory: MemoryComponent = {
        ...memory,
        annoyedDuration: consequence.state === 'annoyed' ? consequence.duration : memory.annoyedDuration,
        gratefulDuration: consequence.state === 'grateful' ? consequence.duration : memory.gratefulDuration
      };
      return addComponent(state, memOwnerId, nextMemory);
    }
    return state;
  },

  transfer_knowledge: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'transfer_knowledge' }>
  ): GameState => {
    const npcId = consequence._npcEntityId ?? consequence.entityId;
    const playerId = consequence._playerEntityId;
    if (npcId === undefined || playerId === undefined) return state;

    const npcMemory = getComponent(state, npcId, ComponentType.Memory) as MemoryComponent | undefined;
    if (!npcMemory) return state;

    const item = npcMemory.knowledge?.[consequence.knowledgeId];
    if (!item) return state;

    let nextState = transferKnowledge(state, npcId, playerId, consequence.knowledgeId);

    if (consequence.addToInvestigationBoard) {
      const clueText = `${item.type}: ${item.description}`;
      const playerMemory = getComponent(nextState, playerId, ComponentType.Memory) as MemoryComponent | undefined;

      if (playerMemory && !playerMemory.knowledge?.[clueText]) {
        const nextKnowledge = { ...(playerMemory.knowledge ?? {}) };
        nextKnowledge[clueText] = {
          id: item.id,
          type: item.type,
          description: item.description,
          tags: item.tags
        };
        nextState = addComponent(nextState, playerId, {
          ...playerMemory,
          knowledge: nextKnowledge
        });
      }
    }
    return nextState;
  },

  modify_relationship_axis: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'modify_relationship_axis' }>,
    apply: (state: GameState, event: GameEvent, consequence: ConsequenceAction) => GameState
  ): GameState => {
    let eId = consequence._npcEntityId;
    if (eId === undefined) {
      if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
        eId = (event as unknown as { entityId: EntityId }).entityId;
      } else if (consequence.targetId) {
        eId = parseInt(consequence.targetId) as EntityId;
      } else if (event.type === GameEventType.ReactionResolved) {
        const targetPayload = (event as unknown as { target?: { type: string; entityId?: EntityId } }).target;
        if (targetPayload && targetPayload.type === 'entity') {
          eId = targetPayload.entityId;
        }
      }
    }

    if (eId === undefined) return state;

    const memory = getComponent(state, eId, ComponentType.Memory) as MemoryComponent | undefined;
    if (!memory) return state;

    const currentAxes = memory.relationshipAxes ?? {};
    const newValue = Math.max(-100, Math.min(100, (currentAxes[consequence.axis] ?? 0) + consequence.amount));

    const newMemory = {
      ...memory,
      relationshipAxes: { ...currentAxes, [consequence.axis]: newValue }
    };

    let nextState = addComponent(state, eId, newMemory);

    for (const threshold of nextState.campaign.relationshipThresholds ?? []) {
      if (threshold.axis === consequence.axis) {
        let conditionMet = false;
        if (threshold.operator === '>=') conditionMet = newValue >= threshold.value;
        else if (threshold.operator === '<=') conditionMet = newValue <= threshold.value;
        else if (threshold.operator === '==') conditionMet = newValue === threshold.value;

        if (conditionMet) {
          nextState = apply(nextState, event, {
            ...threshold.consequence,
            _npcEntityId: eId,
            targetId: eId.toString()
          } as ConsequenceAction);
        }
      }
    }
    return nextState;
  },

  force_say: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'force_say' }>
  ): GameState => {
    let eId: EntityId | undefined;
    if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
      eId = (event as unknown as { entityId: EntityId }).entityId;
    } else if (consequence.targetId) {
      eId = parseInt(consequence.targetId) as EntityId;
    } else {
      if (event.type === GameEventType.ReactionResolved) {
        const rxEvent = event as unknown as { target: ApplyIntentTarget };
        if (rxEvent.target.type === 'entity') {
          eId = rxEvent.target.entityId;
        }
      }
    }

    if (eId !== undefined) {
      const sayResult = executeSay(state, eId, consequence.message);
      return {
        ...sayResult.state,
        events: [...sayResult.state.events, sayResult.event]
      };
    }
    return state;
  }
} satisfies Partial<
  Record<
    ConsequenceAction['type'],
    (
      state: GameState,
      event: GameEvent,
      consequence: never,
      apply: (state: GameState, event: GameEvent, consequence: ConsequenceAction) => GameState
    ) => GameState
  >
>;
