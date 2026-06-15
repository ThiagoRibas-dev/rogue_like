import * as ROT from 'rot-js';
import { addComponent, getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import type { GameEvent } from '../types/events.types.ts';
import { GameEventType } from '../types/events.types.ts';
import { type EntityId, type GameState } from '../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { completeQuest, grantQuest } from './quest.system.ts';

/**
 * Checks if the entity stepped on any physical traps.
 * Marks them triggered, reveals them, and emits a TrapTriggeredEvent.
 */
export function processTraps(state: GameState, entityId: EntityId): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return state;

  const targetKey = `${pos.x},${pos.y}`;
  const entitiesAtNewTarget = state.spatialIndex.get(targetKey) || [];

  let nextState = state;

  for (const id of entitiesAtNewTarget) {
    if (id === entityId) continue;

    const trap = getComponent(nextState, id, ComponentType.Trap) as TrapComponent | undefined;
    if (trap && !trap.triggered) {
      // Trigger it!
      const nextTrap = { ...trap, triggered: true };
      nextState = addComponent(nextState, id, nextTrap);

      // Add a RenderableComponent so the trap becomes visible (or update existing)
      const renderCmp = getComponent(nextState, id, ComponentType.Renderable);
      if (!renderCmp) {
        nextState = addComponent(nextState, id, {
          type: ComponentType.Renderable,
          glyph: '^',
          fg: '#e74c3c',
          bg: 'transparent'
        });
      }

      const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
      const targetName = isPlayer ? 'You' : 'Something';
      nextState = addMessage(nextState, `${targetName} triggered a trap!`, MessageLogCategory.System);

      // Push TrapTriggeredEvent instead of hardcoded damage
      nextState = {
        ...nextState,
        events: [
          ...nextState.events,
          {
            type: GameEventType.TrapTriggered,
            entityId: entityId,
            triggerId: trap.triggerId
          }
        ]
      };
    }
  }

  return nextState;
}

/**
 * Evaluates a single condition predicate against the game state and event.
 */
export function evaluateCondition(
  state: Readonly<GameState>,
  event: GameEvent,
  condition: ConditionPredicate
): boolean {
  switch (condition.type) {
    case 'is_player':
      return (
        'entityId' in event &&
        getComponent(state, (event as unknown as { entityId: EntityId }).entityId, ComponentType.Player) !== undefined
      );

    case 'has_agreement': {
      if (event.type !== GameEventType.EntityDied) return false;
      const diedEvent = event as EntityDiedEvent;
      return getComponent(state, diedEvent.victimId, ComponentType.Agreement) !== undefined;
    }

    case 'faction_standing': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return false;

      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      const standing = memory?.factionStandings[condition.target] ?? 0;

      const operator = condition.operator;
      const value = condition.value;

      if (operator === '>=') return standing >= value;
      if (operator === '<=') return standing <= value;
      return standing === value;
    }

    case 'has_fact': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return false;

      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      return memory?.facts.includes(condition.target) ?? false;
    }

    case 'not_has_fact': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return true;

      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      return !(memory?.facts.includes(condition.target) ?? false);
    }

    case 'quest_status': {
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

    default:
      return true;
  }
}

import { createEntity } from '../core/ecs.ts';
import type {
  AgreementComponent,
  ClueComponent,
  DamageComponent,
  DamageInstance,
  MemoryComponent,
  PositionComponent,
  QuestLogComponent,
  TrapComponent
} from '../types/components.types.ts';
import { toItemInstanceId } from '../types/components.types.ts';
import type { DebugTriggerTraceEvent, EntityDiedEvent, TrapTriggeredEvent } from '../types/events.types.ts';
import type { ConditionPredicate, ConsequenceAction, RunScriptConsequenceFn } from '../types/trigger.types.ts';

/**
 * Applies a single consequence to the game state.
 */
export function applyConsequence(state: GameState, event: GameEvent, consequence: ConsequenceAction): GameState {
  let nextState = state;

  switch (consequence.type) {
    case 'run_script': {
      const code = consequence.scriptCode;
      if (!code) break;
      try {
        const sandboxFn = new Function('context', code) as RunScriptConsequenceFn;
        const context = { event, state, rng: ROT.RNG };
        const dynamicConsequences = sandboxFn(code, context);
        if (dynamicConsequences && Array.isArray(dynamicConsequences)) {
          for (const dynCons of dynamicConsequences) {
            nextState = applyConsequence(nextState, event, dynCons);
          }
        }
      } catch (e) {
        console.error('Failed to run trigger script:', e);
      }
      break;
    }

    case 'damage': {
      const targetId = consequence.targetId;
      const amount = consequence.amount;

      let eId: EntityId | undefined;
      if (targetId === 'event.entityId' && 'entityId' in event) {
        eId = (event as unknown as { entityId: EntityId }).entityId;
      }

      if (eId === undefined || amount <= 0) break;

      const fighter = getComponent(nextState, eId, ComponentType.Fighter);
      if (!fighter) break;

      const existingDamageComp = getComponent(nextState, eId, ComponentType.Damage) as DamageComponent | undefined;

      const damageInstance: DamageInstance = {
        amount,
        tags: ['trigger', 'physical']
      };

      if (existingDamageComp) {
        const newDamageComp = {
          ...existingDamageComp,
          instances: [...existingDamageComp.instances, damageInstance]
        };
        nextState = addComponent(nextState, eId, newDamageComp);
      } else {
        const newDamageComp: DamageComponent = {
          type: ComponentType.Damage,
          instances: [damageInstance]
        };
        nextState = addComponent(nextState, eId, newDamageComp);
      }
      break;
    }

    case 'spawn_clue': {
      if (event.type !== GameEventType.EntityDied) break;
      const diedEvent = event as EntityDiedEvent;
      const victimId = diedEvent.victimId;

      const agreement = getComponent(nextState, victimId, ComponentType.Agreement) as AgreementComponent | undefined;
      const pos = getComponent(nextState, victimId, ComponentType.Position) as PositionComponent | undefined;
      const renderable = getComponent(nextState, victimId, ComponentType.Renderable);
      const name = renderable ? renderable.glyph : 'Someone';

      if (!agreement || !pos) break;

      const agreementDef = nextState.campaign.agreements[agreement.agreementId];
      if (!agreementDef || agreementDef.clueTemplates.length === 0) break;

      const clueTemplateId = agreementDef.clueTemplates[0]!;
      let clueEntity: EntityId;
      [nextState, clueEntity] = createEntity(nextState);

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
      nextState = addMessage(nextState, `${name} ${msg}`, MessageLogCategory.System);
      break;
    }

    case 'grant_quest': {
      const questId = consequence.targetId;
      const playerId =
        consequence._playerEntityId ??
        consequence.entityId ??
        ('entityId' in event ? ((event as unknown as Record<string, unknown>).entityId as EntityId) : undefined);

      if (playerId !== undefined && questId) {
        nextState = grantQuest(nextState, playerId, questId);
      }
      break;
    }

    case 'complete_quest': {
      const questId = consequence.targetId;
      const playerId =
        consequence._playerEntityId ??
        consequence.entityId ??
        ('entityId' in event ? ((event as unknown as Record<string, unknown>).entityId as EntityId) : undefined);

      if (playerId !== undefined && questId) {
        nextState = completeQuest(nextState, playerId, questId);
      }
      break;
    }

    case 'change_standing': {
      const amount = consequence.amount;
      const factionId = consequence.targetId;
      const memoryOwnerId = consequence._npcEntityId ?? consequence.entityId;

      if (memoryOwnerId === undefined || !factionId || !amount) break;

      const memory = getComponent(nextState, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;

      if (!memory) break;

      const newStanding = (memory.factionStandings[factionId] ?? 0) + amount;
      const newMemory = { ...memory, factionStandings: { ...memory.factionStandings, [factionId]: newStanding } };

      nextState = addComponent(nextState, memoryOwnerId, newMemory);
      break;
    }

    case 'emit_event': {
      const eventType = consequence.eventType;
      const payload = consequence.payload;

      if (!eventType) break;

      nextState = {
        ...nextState,
        events: [
          ...nextState.events,
          {
            type: eventType as GameEventType,
            ...payload
          } as unknown as GameEvent
        ]
      };
      break;
    }
  }

  return nextState;
}

/**
 * Processes all global events against the declarative trigger system.
 */
export function processGlobalTriggers(state: GameState): GameState {
  if (state.events.length === 0) return state;

  let nextState = state;

  let eventIndex = 0;
  // Using while loop to process newly pushed events from consequences recursively.
  while (eventIndex < nextState.events.length) {
    const event = nextState.events[eventIndex]!;
    eventIndex++;

    // O(1) bucket routing
    const triggers = nextState.campaign.triggerBuckets?.[event.type] ?? [];

    // Also include TrapTriggered triggers if we're evaluating a TrapTriggered event.
    // Wait, the bucket for GameEventType.TrapTriggered already contains them since we bucketed by `eventType`.
    // The previous loop was checking: trigger.eventType === event.type || (trigger.eventType === 'TrapTriggered' && event.type === GameEventType.TrapTriggered && ...)
    // But since the bucket handles `trigger.eventType === event.type`, we just need to filter traps by `triggerId`
    // Actually, triggers in the bucket are already of `eventType`. We just need to check the trap condition.

    for (const trigger of triggers) {
      if (event.type === GameEventType.TrapTriggered) {
        const trapEvent = event as TrapTriggeredEvent;
        // The trigger ID in the JSON must match the triggerId in the trap.
        // Or wait, does the JSON trigger use its own `id` as the physical triggerId? Yes, that was the design.
        if (trapEvent.triggerId !== trigger.id) {
          continue; // Skip if this trap trigger doesn't match the physical triggerId
        }
      }

      const conditionsMet = trigger.conditions.every((c) => evaluateCondition(nextState, event, c));
      if (conditionsMet) {
        for (const consequence of trigger.consequences) {
          nextState = applyConsequence(nextState, event, consequence);
        }
        const traceEvent: DebugTriggerTraceEvent = {
          type: GameEventType.DebugTriggerTrace,
          triggerId: trigger.id,
          triggeringEvent: event,
          executedConsequences: trigger.consequences.map((c) => c.type)
        };
        nextState = {
          ...nextState,
          events: [...nextState.events, traceEvent as unknown as GameEvent]
        };
      }
    }
  }

  return nextState;
}
