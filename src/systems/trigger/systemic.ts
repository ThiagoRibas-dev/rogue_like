import { rng } from '../../core/rng.ts';
import type { GameState, EntityId } from '../../types/game-state.types.ts';
import { UIMode } from '../../types/game-state.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { ConsequenceAction, RunScriptConsequenceFn } from '../../types/trigger.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { TrapComponent, DamageComponent, DamageInstance, PortalComponent } from '../../types/components.types.ts';
import { getComponent, addComponent, removeEntity } from '../../core/ecs.ts';
import { processChangeAreaIntent } from '../map.system.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import { systemicEntityConsequences } from './systemic_entity.ts';

/**
 * Checks if the entity stepped on any physical traps.
 * Marks them triggered, reveals them, and emits a TrapTriggeredEvent.
 * @param state The current game state.
 * @param entityId The ID of the entity that is moving and potentially stepping on traps.
 * @returns The updated game state after evaluating trap triggers.
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
      const nextTrap = { ...trap, triggered: true };
      nextState = addComponent(nextState, id, nextTrap);

      const renderCmp = getComponent(nextState, id, ComponentType.Renderable);
      if (!renderCmp) {
        nextState = addComponent(nextState, id, {
          type: ComponentType.Renderable,
          glyph: '^',
          fg: '#e74c3c',
          bg: 'transparent',
          spriteId: 'trap'
        });
      }

      const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
      const targetName = isPlayer ? 'You' : 'Something';
      nextState = addMessage(nextState, `${targetName} triggered a trap!`, MessageLogCategory.System);

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
 * Consequence appliers specific to world events, traps, and systemic interactions.
 */
export const systemicConsequences = {
  remove_entity: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'remove_entity' }>
  ): GameState => {
    let eId: EntityId | undefined;
    if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
      eId = (event as unknown as { entityId: EntityId }).entityId;
    } else if (consequence.targetId) {
      eId = parseInt(consequence.targetId) as EntityId;
    } else {
      const targetPayload = (
        event as unknown as { target?: { type: string; entityId?: EntityId; itemEntityId?: EntityId } }
      ).target;
      if (targetPayload) {
        if (targetPayload.type === 'entity') eId = targetPayload.entityId;
        else if (targetPayload.type === 'item') eId = targetPayload.itemEntityId;
      }
    }

    if (eId !== undefined) {
      return removeEntity(state, eId);
    }
    return state;
  },

  run_script: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'run_script' }>,
    apply: (state: GameState, event: GameEvent, consequence: ConsequenceAction) => GameState
  ): GameState => {
    const code = consequence.scriptCode;
    if (!code) return state;
    let nextState = state;
    try {
      const sandboxFn = new Function('context', code) as RunScriptConsequenceFn;
      const context = { event, state, rng };
      const dynamicConsequences = sandboxFn(code, context);
      if (dynamicConsequences && Array.isArray(dynamicConsequences)) {
        for (const dynCons of dynamicConsequences) {
          nextState = apply(nextState, event, dynCons);
        }
      }
    } catch (e) {
      console.error('Failed to run trigger script:', e);
    }
    return nextState;
  },

  damage: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'damage' }>
  ): GameState => {
    const targetId = consequence.targetId;
    const amount = consequence.amount;

    let eId: EntityId | undefined;
    if (targetId === 'event.entityId' && 'entityId' in event) {
      eId = (event as unknown as { entityId: EntityId }).entityId;
    }

    if (eId === undefined || amount <= 0) return state;

    const fighter = getComponent(state, eId, ComponentType.Fighter);
    if (!fighter) return state;

    const existingDamageComp = getComponent(state, eId, ComponentType.Damage) as DamageComponent | undefined;

    const damageInstance: DamageInstance = {
      amount,
      tags: ['trigger', 'physical']
    };

    if (existingDamageComp) {
      return addComponent(state, eId, {
        ...existingDamageComp,
        instances: [...existingDamageComp.instances, damageInstance]
      });
    }
    return addComponent(state, eId, {
      type: ComponentType.Damage,
      instances: [damageInstance]
    });
  },

  open_barter: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'open_barter' }>
  ): GameState => {
    let npcId: EntityId | undefined;
    if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
      npcId = (event as unknown as { entityId: EntityId }).entityId;
    } else if (consequence.targetId) {
      npcId = parseInt(consequence.targetId) as EntityId;
    } else if ('targetId' in event) {
      npcId = (event as unknown as { targetId: EntityId }).targetId;
    }

    if (npcId !== undefined) {
      return {
        ...state,
        uiMode: UIMode.Trade,
        activeTrade: { npcEntityId: npcId }
      };
    }
    return state;
  },

  trigger_service: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'trigger_service' }>
  ): GameState => {
    let npcId: EntityId | undefined;
    if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
      npcId = (event as unknown as { entityId: EntityId }).entityId;
    } else if (consequence.targetId) {
      npcId = parseInt(consequence.targetId) as EntityId;
    } else if ('targetId' in event) {
      npcId = (event as unknown as { targetId: EntityId }).targetId;
    }

    if (npcId !== undefined) {
      return {
        ...state,
        uiMode: UIMode.Services,
        activeService: { npcEntityId: npcId }
      };
    }
    return state;
  },

  emit_event: (
    state: GameState,
    _event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'emit_event' }>
  ): GameState => {
    const eventType = consequence.eventType;
    const payload = consequence.payload;

    if (!eventType) return state;

    return {
      ...state,
      events: [
        ...state.events,
        {
          type: eventType as GameEventType,
          ...payload
        } as unknown as GameEvent
      ]
    };
  },

  change_area: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'change_area' }>
  ): GameState => {
    let targetAreaId = consequence.targetAreaId;
    let targetX = consequence.targetX;
    let targetY = consequence.targetY;

    let eId: EntityId | undefined;
    if ('entityId' in event) {
      eId = (event as unknown as { entityId: EntityId }).entityId;
    }

    let nextState = state;
    if (!targetAreaId && event.type === GameEventType.ReactionResolved) {
      const rxEvent = event as unknown as { target: unknown };
      const targetPayload = rxEvent.target as { type: string; entityId?: EntityId } | undefined;
      if (targetPayload?.type === 'entity' && targetPayload.entityId !== undefined) {
        const portalComp = getComponent(state, targetPayload.entityId, ComponentType.Portal) as
          PortalComponent | undefined;
        if (portalComp) {
          targetAreaId = portalComp.targetAreaId;
          targetX = portalComp.targetX;
          targetY = portalComp.targetY;
        }
      }
    }

    if (eId !== undefined && targetAreaId) {
      const result = processChangeAreaIntent(state, {
        type: IntentType.ChangeArea,
        entityId: eId,
        targetAreaId,
        targetX,
        targetY
      });
      if (result.success) {
        nextState = result.state;
      }
    }
    return nextState;
  },

  ...systemicEntityConsequences
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
