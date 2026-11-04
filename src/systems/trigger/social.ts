import type { GameState, EntityId } from '../../types/game-state.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import type { ConditionPredicate } from '../../types/trigger.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { MemoryComponent } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { assertNever } from '../../utils/assert.ts';
import { socialConsequences } from './social_consequences.ts';

export { socialConsequences };

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
        count = 0;
        break;
      case 'persuade':
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
