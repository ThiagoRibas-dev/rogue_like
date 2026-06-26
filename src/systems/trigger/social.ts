import type { GameState, EntityId } from '../../types/game-state.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { ConditionPredicate, ConsequenceAction } from '../../types/trigger.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { MemoryComponent, FactionComponent } from '../../types/components.types.ts';
import type { ApplyIntentTarget } from '../../types/intents/interaction.intents.ts';
import { getComponent, addComponent } from '../../core/ecs.ts';
import { processSayIntent } from '../../actions/say.action.ts';
import { transferKnowledge } from '../../actions/dialogue.actions.ts';
import { assertNever } from '../../utils/assert.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';

/**
 * Condition evaluators specific to NPCs, social interactions, and memory.
 */
export const socialConditions = {
  faction_standing: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'faction_standing' }>
  ): boolean => {
    const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
    if (memoryOwnerId === undefined) return false;

    const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    const standing = memory?.factionStandings[condition.target] ?? 0;

    const operator = condition.operator;
    const value = condition.value;

    if (operator === '>=') return standing >= value;
    if (operator === '<=') return standing <= value;
    return standing === value;
  },

  has_fact: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'has_fact' }>
  ): boolean => {
    const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
    if (memoryOwnerId === undefined) return false;

    const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    return memory?.facts.includes(condition.target) ?? false;
  },

  not_has_fact: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'not_has_fact' }>
  ): boolean => {
    const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
    if (memoryOwnerId === undefined) return true;

    const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    return !(memory?.facts.includes(condition.target) ?? false);
  },

  personality_facet: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'personality_facet' }>
  ): boolean => {
    const entityId = condition._npcEntityId ?? condition.entityId;
    if (entityId === undefined) return false;
    const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
    const facetVal = memory?.facets?.[condition.facet] ?? 0;
    if (condition.operator === '>=') return facetVal >= condition.value;
    if (condition.operator === '<=') return facetVal <= condition.value;
    return facetVal === condition.value;
  },

  stress_threshold: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'stress_threshold' }>
  ): boolean => {
    const entityId = condition._npcEntityId ?? condition.entityId;
    if (entityId === undefined) return false;
    const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
    const stress = memory?.stress ?? 0;
    if (condition.operator === '>=') return stress >= condition.value;
    if (condition.operator === '<=') return stress <= condition.value;
    return stress === condition.value;
  },

  has_memory: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'has_memory' }>
  ): boolean => {
    const entityId = condition._npcEntityId ?? condition.entityId;
    if (entityId === undefined) return false;
    const chronicle = getComponent(state, entityId, ComponentType.Chronicle);
    if (!chronicle) return false;
    return chronicle.coreMemories.some((m) => m.includes(condition.target));
  },

  has_grudge: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'has_grudge' }>
  ): boolean => {
    const entityId = condition._npcEntityId ?? condition.entityId;
    if (entityId === undefined) return false;
    const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
    return memory?.grudges?.includes(condition.targetId) ?? false;
  },

  pis: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'pis' }>
  ): boolean => {
    const entityId = condition._npcEntityId ?? condition.entityId;
    if (entityId === undefined) return false;
    const chronicle = getComponent(state, entityId, ComponentType.Chronicle);
    const pisVal = chronicle?.pis ?? 0;
    if (condition.operator === '>=') return pisVal >= condition.value;
    if (condition.operator === '<=') return pisVal <= condition.value;
    return pisVal === condition.value;
  },

  has_knowledge: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'has_knowledge' }>
  ): boolean => {
    const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
    if (memoryOwnerId === undefined) return false;
    const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    return memory?.knowledge?.[condition.knowledgeId] !== undefined;
  },

  interaction_count: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'interaction_count' }>
  ): boolean => {
    const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
    if (memoryOwnerId === undefined) return false;
    const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    if (!memory) return false;
    let count = 0;
    switch (condition.interactionType) {
      case 'talk':
        count = memory.timesTalked ?? 0;
        break;
      case 'trade':
        count = memory.timesTraded ?? 0;
        break;
      case 'intimidate':
        count = memory.timesIntimidated ?? 0;
        break;
      case 'help':
        count = memory.timesHelped ?? 0;
        break;
      case 'betray':
        count = memory.timesBetrayed ?? 0;
        break;
      case 'barter':
        // Defaulting to 0 since we don't have timesBartered in MemoryComponent yet
        count = 0;
        break;
      case 'persuade':
        // Defaulting to 0 since we don't have timesPersuaded in MemoryComponent yet
        count = 0;
        break;
      default:
        return assertNever(condition.interactionType);
    }
    if (condition.operator === '>=') return count >= condition.value;
    if (condition.operator === '<=') return count <= condition.value;
    return count === condition.value;
  },

  patience_below: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'patience_below' }>
  ): boolean => {
    const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
    if (memoryOwnerId === undefined) return false;
    const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    if (!memory) return false;
    const threshold = memory.patienceThreshold ?? 5;
    const remaining = threshold - (memory.timesTalked ?? 0);
    return remaining < condition.value;
  },

  is_annoyed: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'is_annoyed' }>
  ): boolean => {
    const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
    if (memoryOwnerId === undefined) return false;
    const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    return (memory?.annoyedDuration ?? 0) > 0;
  },

  is_grateful: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'is_grateful' }>
  ): boolean => {
    const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
    if (memoryOwnerId === undefined) return false;
    const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
    return (memory?.gratefulDuration ?? 0) > 0;
  },

  relationship_axis: (
    state: Readonly<GameState>,
    event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'relationship_axis' }>
  ): boolean => {
    let eId = condition._npcEntityId ?? condition.entityId;
    if (condition.target) {
      if (condition.target === 'event.entityId' && 'entityId' in event) {
        eId = (event as unknown as { entityId: EntityId }).entityId;
      } else {
        eId = parseInt(condition.target) as EntityId;
      }
    }
    if (eId === undefined) return false;
    const memory = getComponent(state, eId, ComponentType.Memory) as MemoryComponent | undefined;
    const axisVal = memory?.relationshipAxes?.[condition.axis] ?? 0;
    if (condition.operator === '>=') return axisVal >= condition.value;
    if (condition.operator === '<=') return axisVal <= condition.value;
    return axisVal === condition.value;
  }
} satisfies Partial<
  Record<ConditionPredicate['type'], (state: Readonly<GameState>, event: GameEvent, condition: never) => boolean>
>;

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

    // Evaluate declarative relationship thresholds
    for (const threshold of nextState.campaign.relationshipThresholds ?? []) {
      if (threshold.axis === consequence.axis) {
        let conditionMet = false;
        if (threshold.operator === '>=') conditionMet = newValue >= threshold.value;
        else if (threshold.operator === '<=') conditionMet = newValue <= threshold.value;
        else if (threshold.operator === '==') conditionMet = newValue === threshold.value;

        if (conditionMet) {
          // Apply consequence injected with this entity's ID context
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

    if (eId === undefined) return state;

    const sayResult = processSayIntent(state, {
      type: IntentType.Say,
      entityId: eId,
      message: consequence.message
    });
    let nextState = sayResult.state;
    if (sayResult.events && sayResult.events.length > 0) {
      nextState = { ...nextState, events: [...nextState.events, ...sayResult.events] };
    }
    return nextState;
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
