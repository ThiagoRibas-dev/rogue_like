import type { GameState, EntityId } from '../../types/game-state.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { ConditionPredicate, ConsequenceAction } from '../../types/trigger.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type {
  AgreementComponent,
  ClueComponent,
  PositionComponent,
  QuestLogComponent
} from '../../types/components.types.ts';
import { toItemInstanceId } from '../../types/components.types.ts';
import type { EntityDiedEvent } from '../../types/events.types.ts';
import { getComponent, addComponent, createEntity } from '../../core/ecs.ts';
import { completeQuest, grantQuest } from '../quest.system.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';

/**
 * Condition evaluators specific to quests and agreements.
 */
export const questConditions = {
  has_agreement: (
    state: Readonly<GameState>,
    event: GameEvent,
    _condition: Extract<ConditionPredicate, { type: 'has_agreement' }>
  ): boolean => {
    if (event.type !== GameEventType.EntityDied) return false;
    const diedEvent = event as EntityDiedEvent;
    return getComponent(state, diedEvent.victimId, ComponentType.Agreement) !== undefined;
  },

  quest_status: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'quest_status' }>
  ): boolean => {
    const playerEntityId = condition._playerEntityId ?? condition.entityId;
    if (playerEntityId === undefined) return false;

    const questLog = getComponent(state, playerEntityId, ComponentType.QuestLog) as QuestLogComponent | undefined;
    const qStatus = questLog?.quests[condition.target]?.status;
    const numStatus = qStatus === 'active' ? 0 : qStatus === 'completed' ? 1 : qStatus === 'failed' ? 2 : -1;

    const operator = condition.operator;
    const value = condition.value;

    if (operator === '>=') return numStatus >= value;
    if (operator === '<=') return numStatus <= value;
    return numStatus === value;
  }
} satisfies Partial<
  Record<ConditionPredicate['type'], (state: Readonly<GameState>, event: GameEvent, condition: never) => boolean>
>;

/**
 * Consequence appliers specific to quests and agreements.
 */
export const questConsequences = {
  spawn_clue: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'spawn_clue' }>
  ): GameState => {
    if (event.type !== GameEventType.EntityDied) return state;
    const diedEvent = event as EntityDiedEvent;
    const victimId = diedEvent.victimId;

    const agreement = getComponent(state, victimId, ComponentType.Agreement) as AgreementComponent | undefined;
    const pos = getComponent(state, victimId, ComponentType.Position) as PositionComponent | undefined;
    const renderable = getComponent(state, victimId, ComponentType.Renderable);
    const name = renderable ? renderable.glyph : 'Someone';

    if (!agreement || !pos) return state;

    const agreementDef = state.campaign.agreements[agreement.agreementId];
    if (!agreementDef || agreementDef.clueTemplates.length === 0) return state;

    const clueTemplateId = agreementDef.clueTemplates[0]!;
    let nextState = state;
    const [newState, clueEntity] = createEntity(nextState);
    nextState = newState;

    nextState = addComponent(nextState, clueEntity, pos);
    nextState = addComponent(nextState, clueEntity, {
      type: ComponentType.Renderable,
      glyph: '?',
      fg: '#ffff00',
      bg: 'transparent'
    });

    const instanceId = toItemInstanceId(`clue_item_${nextState.nextItemInstanceId}`);
    nextState = { ...nextState, nextItemInstanceId: nextState.nextItemInstanceId + 1 };

    nextState = addComponent(nextState, clueEntity, {
      type: ComponentType.Item,
      itemId: 'clue_item',
      instanceId
    });
    nextState = addComponent(nextState, clueEntity, {
      type: ComponentType.Clue,
      clueId: clueTemplateId,
      text: `Incriminating evidence regarding a ${agreementDef.task}...`,
      implicatesEntityId: agreement.mastermindId
    } as ClueComponent);

    const msg = consequence.message ?? 'dropped something suspicious!';
    return addMessage(nextState, `${name} ${msg}`, MessageLogCategory.System);
  },

  grant_quest: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'grant_quest' }>
  ): GameState => {
    const questId = consequence.questId ?? consequence.targetId;
    const playerId =
      consequence._playerEntityId ??
      consequence.entityId ??
      ('entityId' in event ? ((event as unknown as Record<string, unknown>).entityId as EntityId) : undefined);

    if (playerId !== undefined && questId) {
      return grantQuest(state, playerId, questId);
    }
    return state;
  },

  complete_quest: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'complete_quest' }>
  ): GameState => {
    const questId = consequence.questId ?? consequence.targetId;
    const playerId =
      consequence._playerEntityId ??
      consequence.entityId ??
      ('entityId' in event ? ((event as unknown as Record<string, unknown>).entityId as EntityId) : undefined);

    if (playerId !== undefined && questId) {
      return completeQuest(state, playerId, questId);
    }
    return state;
  }
} satisfies Partial<
  Record<ConsequenceAction['type'], (state: GameState, event: GameEvent, consequence: never) => GameState>
>;
