import { ComponentType } from '../types/components.types.ts';
import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { getComponent } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { GameEventType } from '../types/events.types.ts';
import type { GameEvent } from '../types/events.types.ts';
import * as ROT from 'rot-js';
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

    const trap = getComponent(nextState, id, ComponentType.Trap) as
      | import('../types/components.types.ts').TrapComponent
      | undefined;
    if (trap && !trap.triggered) {
      // Trigger it!
      const nextTrap = { ...trap, triggered: true };

      const newCompsMap = new Map(nextState.components);
      const trapComps = newCompsMap.get(id) ?? [];

      // Update TrapComponent to triggered
      newCompsMap.set(
        id,
        trapComps.map((c) => (c.type === ComponentType.Trap ? nextTrap : c))
      );

      // Add a RenderableComponent so the trap becomes visible (or update existing)
      const renderCmp = newCompsMap.get(id)?.find((c) => c.type === ComponentType.Renderable);
      if (!renderCmp) {
        newCompsMap.set(id, [
          ...(newCompsMap.get(id) ?? []),
          { type: ComponentType.Renderable, glyph: '^', fg: '#e74c3c', bg: 'transparent' }
        ]);
      }

      nextState = { ...nextState, components: newCompsMap };

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
  condition: import('../types/trigger.types.ts').ConditionPredicate
): boolean {
  switch (condition.type) {
    case 'is_player':
      return (
        'entityId' in event &&
        getComponent(state, (event as unknown as { entityId: EntityId }).entityId, ComponentType.Player) !== undefined
      );

    case 'has_agreement': {
      if (event.type !== GameEventType.EntityDied) return false;
      const diedEvent = event as import('../types/events.types.ts').EntityDiedEvent;
      return getComponent(state, diedEvent.victimId, ComponentType.Agreement) !== undefined;
    }

    case 'faction_standing': {
      const memoryOwnerId = (condition.params['_npcEntityId'] ?? condition.params['entityId']) as EntityId | undefined;
      if (memoryOwnerId === undefined) return false;

      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as
        | import('../types/components.types.ts').MemoryComponent
        | undefined;
      const standing = memory?.factionStandings[condition.params['target'] as string] ?? 0;

      const operator = condition.params['operator'] as string | undefined;
      const value = (condition.params['value'] as number) ?? 0;

      if (operator === '>=') return standing >= value;
      if (operator === '<=') return standing <= value;
      return standing === value;
    }

    case 'has_fact': {
      const memoryOwnerId = (condition.params['_npcEntityId'] ?? condition.params['entityId']) as EntityId | undefined;
      if (memoryOwnerId === undefined) return false;

      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as
        | import('../types/components.types.ts').MemoryComponent
        | undefined;
      return memory?.facts.includes(condition.params['target'] as string) ?? false;
    }

    case 'not_has_fact': {
      const memoryOwnerId = (condition.params['_npcEntityId'] ?? condition.params['entityId']) as EntityId | undefined;
      if (memoryOwnerId === undefined) return true;

      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as
        | import('../types/components.types.ts').MemoryComponent
        | undefined;
      return !(memory?.facts.includes(condition.params['target'] as string) ?? false);
    }

    case 'quest_status': {
      const playerEntityId = (condition.params['_playerEntityId'] ?? condition.params['entityId']) as
        | EntityId
        | undefined;
      if (playerEntityId === undefined) return false;

      const questLog = getComponent(state, playerEntityId, ComponentType.QuestLog) as
        | import('../types/components.types.ts').QuestLogComponent
        | undefined;
      const qStatus = questLog?.quests[condition.params['target'] as string]?.status;
      const numStatus = qStatus === 'active' ? 0 : qStatus === 'completed' ? 1 : qStatus === 'failed' ? 2 : -1;

      const operator = condition.params['operator'] as string | undefined;
      const value = condition.params['value'] as number;

      if (operator === '>=') return numStatus >= value;
      if (operator === '<=') return numStatus <= value;
      return numStatus === value;
    }

    default:
      return true;
  }
}

import { createEntity, addComponent } from '../core/ecs.ts';
import { toItemInstanceId } from '../types/components.types.ts';

/**
 * Applies a single consequence to the game state.
 */
export function applyConsequence(
  state: GameState,
  event: GameEvent,
  consequence: import('../types/trigger.types.ts').ConsequenceAction
): GameState {
  let nextState = state;

  switch (consequence.type) {
    case 'run_script': {
      const code = consequence.params['scriptCode'] as string | undefined;
      if (!code) break;
      try {
        const sandboxFn = new Function('context', code) as import('../types/trigger.types.ts').RunScriptConsequenceFn;
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
      const targetId = consequence.params['targetId'] as string;
      const amount = consequence.params['amount'] as number;

      let eId: EntityId | undefined;
      if (targetId === 'event.entityId' && 'entityId' in event) {
        eId = (event as unknown as { entityId: EntityId }).entityId;
      }

      if (eId === undefined || amount <= 0) break;

      const fighter = getComponent(nextState, eId, ComponentType.Fighter);
      if (!fighter) break;

      const existingDamageComp = nextState.components.get(eId)?.find((c) => c.type === ComponentType.Damage) as
        | import('../types/components.types.ts').DamageComponent
        | undefined;

      const damageInstance: import('../types/components.types.ts').DamageInstance = {
        amount,
        tags: ['trigger', 'physical']
      };

      const targetComps = nextState.components.get(eId) ?? [];
      const newCompsMap = new Map(nextState.components);

      if (existingDamageComp) {
        const newDamageComp = {
          ...existingDamageComp,
          instances: [...existingDamageComp.instances, damageInstance]
        };
        newCompsMap.set(
          eId,
          targetComps.map((c) => (c.type === ComponentType.Damage ? newDamageComp : c))
        );
      } else {
        const newDamageComp: import('../types/components.types.ts').DamageComponent = {
          type: ComponentType.Damage,
          instances: [damageInstance]
        };
        newCompsMap.set(eId, [...targetComps, newDamageComp]);
      }

      nextState = { ...nextState, components: newCompsMap };
      break;
    }

    case 'spawn_clue': {
      if (event.type !== GameEventType.EntityDied) break;
      const diedEvent = event as import('../types/events.types.ts').EntityDiedEvent;
      const victimId = diedEvent.victimId;

      const agreement = getComponent(nextState, victimId, ComponentType.Agreement) as
        | import('../types/components.types.ts').AgreementComponent
        | undefined;
      const pos = getComponent(nextState, victimId, ComponentType.Position) as
        | import('../types/components.types.ts').PositionComponent
        | undefined;
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
      } as import('../types/components.types.ts').ClueComponent);

      const msg = (consequence.params['message'] as string | undefined) ?? 'dropped something suspicious!';
      nextState = addMessage(nextState, `${name} ${msg}`, MessageLogCategory.System);
      break;
    }

    case 'grant_quest': {
      const questId = consequence.params['targetId'] as string | undefined;
      const playerId = (consequence.params['_playerEntityId'] ??
        consequence.params['entityId'] ??
        ('entityId' in event ? (event as unknown as Record<string, unknown>).entityId : undefined)) as
        | EntityId
        | undefined;

      if (playerId !== undefined && questId) {
        nextState = grantQuest(nextState, playerId, questId);
      }
      break;
    }

    case 'complete_quest': {
      const questId = consequence.params['targetId'] as string | undefined;
      const playerId = (consequence.params['_playerEntityId'] ??
        consequence.params['entityId'] ??
        ('entityId' in event ? (event as unknown as Record<string, unknown>).entityId : undefined)) as
        | EntityId
        | undefined;

      if (playerId !== undefined && questId) {
        nextState = completeQuest(nextState, playerId, questId);
      }
      break;
    }

    case 'change_standing': {
      const amount = consequence.params['amount'] as number | undefined;
      const factionId = consequence.params['targetId'] as string | undefined;
      const memoryOwnerId = (consequence.params['_npcEntityId'] ?? consequence.params['entityId']) as
        | EntityId
        | undefined;

      if (memoryOwnerId === undefined || !factionId || !amount) break;

      const targetComps = nextState.components.get(memoryOwnerId) ?? [];
      const memory = targetComps.find((c) => c.type === ComponentType.Memory) as
        | import('../types/components.types.ts').MemoryComponent
        | undefined;

      if (!memory) break;

      const newStanding = (memory.factionStandings[factionId] ?? 0) + amount;
      const newMemory = { ...memory, factionStandings: { ...memory.factionStandings, [factionId]: newStanding } };

      const newCompsMap = new Map(nextState.components);
      newCompsMap.set(
        memoryOwnerId,
        targetComps.map((c) => (c.type === ComponentType.Memory ? newMemory : c))
      );

      nextState = { ...nextState, components: newCompsMap };
      break;
    }

    case 'emit_event': {
      const eventType = consequence.params['targetId'] as string | undefined;
      const payload = consequence.params['payload'] as Record<string, unknown> | undefined;

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
        const trapEvent = event as import('../types/events.types.ts').TrapTriggeredEvent;
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
        const traceEvent: import('../types/events.types.ts').DebugTriggerTraceEvent = {
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
