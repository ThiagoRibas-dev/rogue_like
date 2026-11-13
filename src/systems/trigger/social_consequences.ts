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
import {
  assignCompanionCommandTarget,
  beginCompanionTargetSelection,
  isPlayerControlledCompanion,
  setCompanionStance
} from '../companion_commands.system.ts';

function getTargetMemory(
  state: GameState,
  consequence: { readonly _npcEntityId?: EntityId | undefined; readonly entityId?: EntityId | undefined }
): { readonly ownerId: EntityId; readonly memory: MemoryComponent } | null {
  const ownerId = consequence._npcEntityId ?? consequence.entityId;
  if (ownerId === undefined) return null;
  const memory = getComponent(state, ownerId, ComponentType.Memory) as MemoryComponent | undefined;
  return memory ? { ownerId, memory } : null;
}

function resolveConsequenceTargetEntityId(event: GameEvent, targetId?: string): EntityId | undefined {
  if (targetId === 'event.entityId' && 'entityId' in event) {
    return (event as unknown as { entityId: EntityId }).entityId;
  }
  if (targetId) return parseInt(targetId, 10) as EntityId;
  if (event.type === GameEventType.ReactionResolved) {
    const targetPayload = (event as unknown as { target?: ApplyIntentTarget }).target;
    if (targetPayload?.type === 'entity') return targetPayload.entityId;
  }
  return undefined;
}

/**
 * Consequence appliers specific to NPCs, social interactions, and memory.
 */
export const socialConsequences = {
  modify_standing: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'modify_standing' }>
  ): GameState => {
    const { amount, factionId } = consequence;
    if (!factionId || !amount) return state;
    const target = getTargetMemory(state, consequence);
    if (!target) return state;
    const newStanding = (target.memory.factionStandings[factionId] ?? 0) + amount;
    return addComponent(state, target.ownerId, {
      ...target.memory,
      factionStandings: { ...target.memory.factionStandings, [factionId]: newStanding }
    });
  },

  set_fact: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'set_fact' }>
  ): GameState => {
    const target = getTargetMemory(state, consequence);
    if (!target || target.memory.facts.includes(consequence.target)) return state;
    return addComponent(state, target.ownerId, {
      ...target.memory,
      facts: [...target.memory.facts, consequence.target]
    });
  },

  change_faction: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'change_faction' }>
  ): GameState => {
    const eId = resolveConsequenceTargetEntityId(event, consequence.targetId);
    if (eId === undefined || Number.isNaN(eId)) return state;
    const faction = getComponent(state, eId, ComponentType.Faction) as FactionComponent | undefined;
    return faction ? addComponent(state, eId, { ...faction, factionId: consequence.factionId }) : state;
  },

  record_interaction: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'record_interaction' }>
  ): GameState => {
    const target = getTargetMemory(state, consequence);
    if (!target) return state;
    const { ownerId, memory } = target;
    const kind = consequence.interactionType;
    return addComponent(state, ownerId, {
      ...memory,
      timesTalked: kind === 'talk' ? (memory.timesTalked ?? 0) + 1 : memory.timesTalked,
      timesTraded: kind === 'trade' ? (memory.timesTraded ?? 0) + 1 : memory.timesTraded,
      timesIntimidated: kind === 'intimidate' ? (memory.timesIntimidated ?? 0) + 1 : memory.timesIntimidated,
      timesHelped: kind === 'help' ? (memory.timesHelped ?? 0) + 1 : memory.timesHelped,
      timesBetrayed: kind === 'betray' ? (memory.timesBetrayed ?? 0) + 1 : memory.timesBetrayed
    });
  },

  set_patience: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'set_patience' }>
  ): GameState => {
    const target = getTargetMemory(state, consequence);
    return target
      ? addComponent(state, target.ownerId, { ...target.memory, patienceThreshold: consequence.value })
      : state;
  },

  modify_knowledge: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'modify_knowledge' }>
  ): GameState => {
    const target = getTargetMemory(state, consequence);
    if (!target) return state;
    const nextKnowledge = { ...(target.memory.knowledge ?? {}) };
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
    return addComponent(state, target.ownerId, { ...target.memory, knowledge: nextKnowledge });
  },

  set_social_state: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'set_social_state' }>
  ): GameState => {
    const target = getTargetMemory(state, consequence);
    if (!target) return state;
    const { ownerId, memory } = target;
    return addComponent(state, ownerId, {
      ...memory,
      annoyedDuration: consequence.state === 'annoyed' ? consequence.duration : memory.annoyedDuration,
      gratefulDuration: consequence.state === 'grateful' ? consequence.duration : memory.gratefulDuration
    });
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
    const item = npcMemory?.knowledge?.[consequence.knowledgeId];
    if (!item) return state;

    let nextState = transferKnowledge(state, npcId, playerId, consequence.knowledgeId);
    if (!consequence.addToInvestigationBoard) return nextState;

    const clueText = `${item.type}: ${item.description}`;
    const playerMemory = getComponent(nextState, playerId, ComponentType.Memory) as MemoryComponent | undefined;
    if (playerMemory && !playerMemory.knowledge?.[clueText]) {
      const nextKnowledge = {
        ...(playerMemory.knowledge ?? {}),
        [clueText]: { id: item.id, type: item.type, description: item.description, tags: item.tags }
      };
      nextState = addComponent(nextState, playerId, { ...playerMemory, knowledge: nextKnowledge });
    }
    return nextState;
  },

  modify_relationship_axis: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'modify_relationship_axis' }>,
    apply: (state: GameState, event: GameEvent, consequence: ConsequenceAction) => GameState
  ): GameState => {
    const eId = consequence._npcEntityId ?? resolveConsequenceTargetEntityId(event, consequence.targetId);
    if (eId === undefined || Number.isNaN(eId)) return state;
    const memory = getComponent(state, eId, ComponentType.Memory) as MemoryComponent | undefined;
    if (!memory) return state;

    const currentAxes = memory.relationshipAxes ?? {};
    const newValue = Math.max(-100, Math.min(100, (currentAxes[consequence.axis] ?? 0) + consequence.amount));
    let nextState = addComponent(state, eId, {
      ...memory,
      relationshipAxes: { ...currentAxes, [consequence.axis]: newValue }
    });

    for (const threshold of nextState.campaign.relationshipThresholds ?? []) {
      if (threshold.axis !== consequence.axis) continue;
      const met =
        (threshold.operator === '>=' && newValue >= threshold.value) ||
        (threshold.operator === '<=' && newValue <= threshold.value) ||
        (threshold.operator === '==' && newValue === threshold.value);
      if (met) {
        nextState = apply(nextState, event, {
          ...threshold.consequence,
          _npcEntityId: eId,
          targetId: eId.toString()
        } as ConsequenceAction);
      }
    }
    return nextState;
  },

  force_say: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'force_say' }>
  ): GameState => {
    const eId = resolveConsequenceTargetEntityId(event, consequence.targetId);
    if (eId === undefined || Number.isNaN(eId)) return state;
    const sayResult = executeSay(state, eId, consequence.message);
    return { ...sayResult.state, events: [...sayResult.state.events, sayResult.event] };
  },

  set_companion_stance: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'set_companion_stance' }>
  ): GameState => {
    const parsedTargetId =
      consequence.targetId !== undefined ? (parseInt(consequence.targetId, 10) as EntityId) : undefined;
    const companionId =
      parsedTargetId !== undefined && !Number.isNaN(parsedTargetId)
        ? parsedTargetId
        : (consequence._npcEntityId ?? consequence.entityId);
    return companionId !== undefined ? setCompanionStance(state, companionId, consequence.stance) : state;
  },

  order_companion_target: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'order_companion_target' }>
  ): GameState => {
    const controllerId =
      consequence._playerEntityId ??
      state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
    if (controllerId === undefined) return state;

    const parsedId = consequence.targetId !== undefined ? (parseInt(consequence.targetId, 10) as EntityId) : undefined;
    if (parsedId !== undefined && !Number.isNaN(parsedId)) {
      if (isPlayerControlledCompanion(state, controllerId, parsedId)) {
        return beginCompanionTargetSelection(state, controllerId, parsedId);
      }
      return assignCompanionCommandTarget(state, controllerId, parsedId).state;
    }

    const npcId = consequence._npcEntityId;
    const specificId =
      npcId !== undefined && isPlayerControlledCompanion(state, controllerId, npcId) ? npcId : undefined;
    return beginCompanionTargetSelection(state, controllerId, specificId);
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
