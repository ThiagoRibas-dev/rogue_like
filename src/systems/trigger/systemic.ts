import * as ROT from 'rot-js';
import type { GameState, EntityId } from '../../types/game-state.types.ts';
import { UIMode } from '../../types/game-state.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { ConsequenceAction, RunScriptConsequenceFn } from '../../types/trigger.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type {
  TrapComponent,
  DamageComponent,
  DamageInstance,
  PortalComponent,
  TagsComponent,
  RenderableComponent,
  LockComponent,
  InteractableComponent,
  PositionComponent
} from '../../types/components.types.ts';
import { getComponent, addComponent, removeEntity, spawnItem, spawnEntity } from '../../core/ecs.ts';
import { applyStatusEffect } from '../status-effect.system.ts';
import { processChangeAreaIntent } from '../map.system.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import type { ApplyIntentTarget } from '../../types/intents/interaction.intents.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { Verb } from '../../constants/verbs.constants.ts';
import type { Intent } from '../../types/intents/intent.union.ts';

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
      const context = { event, state, rng: ROT.RNG };
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
      const newDamageComp = {
        ...existingDamageComp,
        instances: [...existingDamageComp.instances, damageInstance]
      };
      return addComponent(state, eId, newDamageComp);
    } else {
      const newDamageComp: DamageComponent = {
        type: ComponentType.Damage,
        instances: [damageInstance]
      };
      return addComponent(state, eId, newDamageComp);
    }
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
          | PortalComponent
          | undefined;
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

  modify_tags: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'modify_tags' }>
  ): GameState => {
    let eId: EntityId | undefined;
    if (event.type === GameEventType.ReactionResolved) {
      const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
      if (targetPayload.type === 'entity') {
        eId = targetPayload.entityId;
      }
    }
    if (eId === undefined) return state;

    const tagsCmp = getComponent(state, eId, ComponentType.Tags) as TagsComponent | undefined;
    let newTags = [...(tagsCmp?.tags ?? [])];

    let requiresFovUpdate = false;
    if (consequence.remove) {
      if (consequence.remove.includes('opaque')) requiresFovUpdate = true;
      newTags = newTags.filter((t) => !consequence.remove!.includes(t));
    }
    if (consequence.add) {
      if (consequence.add.includes('opaque')) requiresFovUpdate = true;
      for (const t of consequence.add) {
        if (!newTags.includes(t)) newTags.push(t);
      }
    }

    let nextState = state;
    if (tagsCmp) {
      nextState = addComponent(state, eId, { ...tagsCmp, tags: newTags });
    } else {
      nextState = addComponent(state, eId, { type: ComponentType.Tags, tags: newTags });
    }

    if (requiresFovUpdate) {
      nextState = { ...nextState, fovNeedsUpdate: true };
    }
    return nextState;
  },

  change_glyph: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'change_glyph' }>
  ): GameState => {
    let eId: EntityId | undefined;
    if (event.type === GameEventType.ReactionResolved) {
      const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
      if (targetPayload.type === 'entity') {
        eId = targetPayload.entityId;
      }
    }
    if (eId === undefined) return state;

    const rendCmp = getComponent(state, eId, ComponentType.Renderable) as RenderableComponent | undefined;
    if (rendCmp) {
      return addComponent(state, eId, { ...rendCmp, glyph: consequence.glyph });
    }
    return state;
  },

  set_lock_state: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'set_lock_state' }>
  ): GameState => {
    let eId: EntityId | undefined;
    if (event.type === GameEventType.ReactionResolved) {
      const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
      if (targetPayload.type === 'entity') {
        eId = targetPayload.entityId;
      }
    }
    if (eId === undefined) return state;

    const lockCmp = getComponent(state, eId, ComponentType.Lock) as LockComponent | undefined;
    if (lockCmp) {
      return addComponent(state, eId, { ...lockCmp, locked: consequence.locked });
    }
    return state;
  },

  change_intents: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'change_intents' }>
  ): GameState => {
    let eId: EntityId | undefined;
    if (event.type === GameEventType.ReactionResolved) {
      const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
      if (targetPayload.type === 'entity') {
        eId = targetPayload.entityId;
      }
    }
    if (eId === undefined) return state;

    const interactable = getComponent(state, eId, ComponentType.Interactable) as InteractableComponent | undefined;
    if (interactable) {
      const newIntents = consequence.intents.map(
        (v) =>
          ({
            type: IntentType.Apply,
            entityId: -1 as unknown as EntityId,
            verb: v as Verb,
            target: { type: 'self' } as const
          }) as Intent
      );
      return addComponent(state, eId, { ...interactable, intents: newIntents });
    }
    return state;
  },

  spawn_entity: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'spawn_entity' }>
  ): GameState => {
    const templateId = consequence.entityTemplateId;
    if (!templateId) return state;

    let pos: PositionComponent | undefined;
    let targetId: EntityId | undefined;

    if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
      targetId = (event as unknown as { entityId: EntityId }).entityId;
    } else if (consequence.targetId) {
      targetId = parseInt(consequence.targetId) as EntityId;
    } else {
      if (event.type === GameEventType.ReactionResolved) {
        const rxEvent = event as unknown as { target: ApplyIntentTarget };
        if (rxEvent.target.type === 'entity') {
          targetId = rxEvent.target.entityId;
        } else if (rxEvent.target.type === 'item') {
          targetId = rxEvent.target.itemEntityId;
        } else if (rxEvent.target.type === 'tile') {
          pos = { type: ComponentType.Position, x: rxEvent.target.x, y: rxEvent.target.y };
        }
      }
    }

    if (targetId !== undefined && !pos) {
      pos = getComponent(state, targetId, ComponentType.Position) as PositionComponent | undefined;
    }

    if (pos) {
      let nextState = state;
      if (state.campaign.items[templateId]) {
        const [stateAfterSpawn] = spawnItem(state, templateId, pos.x, pos.y);
        nextState = stateAfterSpawn;
      } else if (state.campaign.entities[templateId]) {
        const [stateAfterSpawn] = spawnEntity(state, templateId, pos.x, pos.y);
        nextState = stateAfterSpawn;
      } else {
        console.warn(`Template ${templateId} not found in campaign items/entities during spawn_entity consequence.`);
      }
      return nextState;
    }
    return state;
  },

  damage_area: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'damage_area' }>
  ): GameState => {
    const radius = consequence.radius ?? 1;
    const amount = consequence.amount ?? 0;
    if (amount <= 0) return state;

    let centerPos: PositionComponent | undefined;
    let targetId: EntityId | undefined;

    if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
      targetId = (event as unknown as { entityId: EntityId }).entityId;
    } else if (consequence.targetId) {
      targetId = parseInt(consequence.targetId) as EntityId;
    } else {
      if (event.type === GameEventType.ReactionResolved) {
        const rxEvent = event as unknown as { target: ApplyIntentTarget };
        if (rxEvent.target.type === 'entity') {
          targetId = rxEvent.target.entityId;
        } else if (rxEvent.target.type === 'item') {
          targetId = rxEvent.target.itemEntityId;
        } else if (rxEvent.target.type === 'tile') {
          centerPos = { type: ComponentType.Position, x: rxEvent.target.x, y: rxEvent.target.y };
        }
      }
    }

    if (targetId !== undefined && !centerPos) {
      centerPos = getComponent(state, targetId, ComponentType.Position) as PositionComponent | undefined;
    }

    if (!centerPos) return state;

    let nextState = state;
    for (const id of state.entities) {
      const fighter = getComponent(state, id, ComponentType.Fighter);
      const pos = getComponent(state, id, ComponentType.Position);
      if (!fighter || !pos) continue;

      const dist = Math.sqrt(Math.pow(pos.x - centerPos.x, 2) + Math.pow(pos.y - centerPos.y, 2));
      if (dist <= radius) {
        const existingDamageComp = getComponent(nextState, id, ComponentType.Damage) as DamageComponent | undefined;
        const damageInstance: DamageInstance = {
          amount,
          tags: consequence.tags ?? ['trigger', 'area']
        };

        if (existingDamageComp) {
          const newDamageComp = {
            ...existingDamageComp,
            instances: [...existingDamageComp.instances, damageInstance]
          };
          nextState = addComponent(nextState, id, newDamageComp);
        } else {
          const newDamageComp: DamageComponent = {
            type: ComponentType.Damage,
            instances: [damageInstance]
          };
          nextState = addComponent(nextState, id, newDamageComp);
        }
      }
    }
    return nextState;
  },

  apply_status: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'apply_status' }>
  ): GameState => {
    if (!consequence.statusId) return state;

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
        } else if (rxEvent.target.type === 'item') {
          eId = rxEvent.target.itemEntityId;
        }
      }
    }

    if (eId !== undefined) {
      return applyStatusEffect(state, eId, consequence.statusId, consequence.duration ?? 10);
    }
    return state;
  },

  random_choice: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'random_choice' }>,
    apply: (state: GameState, event: GameEvent, consequence: ConsequenceAction) => GameState
  ): GameState => {
    const choices = consequence.choices as unknown as ReadonlyArray<ReadonlyArray<ConsequenceAction>>;
    if (!choices || choices.length === 0) return state;

    let chosenIndex = 0;
    const weights = consequence.weights;
    if (weights && weights.length === choices.length) {
      const weightMap: Record<string, number> = {};
      for (let i = 0; i < weights.length; i++) {
        weightMap[i.toString()] = weights[i]!;
      }
      const chosenStr = ROT.RNG.getWeightedValue(weightMap);
      chosenIndex = chosenStr !== undefined ? parseInt(chosenStr, 10) : 0;
    } else {
      chosenIndex = ROT.RNG.getUniformInt(0, choices.length - 1);
    }

    const chosenConsequences = choices[chosenIndex];
    let nextState = state;
    if (chosenConsequences) {
      for (const childCons of chosenConsequences) {
        nextState = apply(nextState, event, childCons);
      }
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
