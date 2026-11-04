import type { GameState, EntityId } from '../../types/game-state.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { ConsequenceAction } from '../../types/trigger.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type {
  TagsComponent,
  RenderableComponent,
  LockComponent,
  InteractableComponent,
  PositionComponent,
  DamageComponent,
  DamageInstance
} from '../../types/components.types.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { Intent } from '../../types/intents/intent.union.ts';
import type { Verb } from '../../constants/verbs.constants.ts';
import type { ApplyIntentTarget } from '../../types/intents/interaction.intents.ts';
import { getComponent, addComponent, spawnEntity, spawnItem } from '../../core/ecs.ts';
import { addActor } from '../../core/scheduler.ts';
import { applyStatusEffect } from '../status-effect.system.ts';
import { rng } from '../../core/rng.ts';
import { compileScheme } from '../scheme_compiler.ts';

function resolveReactionTargetEntityId(event: GameEvent): EntityId | undefined {
  if (event.type === GameEventType.ReactionResolved) {
    const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
    if (targetPayload.type === 'entity') {
      return targetPayload.entityId;
    }
  }
  return undefined;
}

function resolveSpatialConsequenceTarget(
  state: GameState,
  event: GameEvent,
  rawTargetId?: string
): { readonly entityId?: EntityId | undefined; readonly pos?: PositionComponent | undefined } {
  let targetId: EntityId | undefined;
  let pos: PositionComponent | undefined;

  if (rawTargetId === 'event.entityId' && 'entityId' in event) {
    targetId = (event as unknown as { entityId: EntityId }).entityId;
  } else if (rawTargetId) {
    targetId = parseInt(rawTargetId, 10) as EntityId;
  } else if (event.type === GameEventType.ReactionResolved) {
    const rxEvent = event as unknown as { target: ApplyIntentTarget };
    if (rxEvent.target.type === 'entity') {
      targetId = rxEvent.target.entityId;
    } else if (rxEvent.target.type === 'item') {
      targetId = rxEvent.target.itemEntityId;
    } else if (rxEvent.target.type === 'tile') {
      pos = { type: ComponentType.Position, x: rxEvent.target.x, y: rxEvent.target.y };
    }
  }

  if (targetId !== undefined && !pos) {
    pos = getComponent(state, targetId, ComponentType.Position) as PositionComponent | undefined;
  }

  return { entityId: targetId, pos };
}

/**
 * Entity, spatial area, and scheme consequence appliers for the systemic trigger engine.
 */
export const systemicEntityConsequences = {
  modify_tags: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'modify_tags' }>
  ): GameState => {
    const eId = resolveReactionTargetEntityId(event);
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

    let nextState = tagsCmp
      ? addComponent(state, eId, { ...tagsCmp, tags: newTags })
      : addComponent(state, eId, { type: ComponentType.Tags, tags: newTags });

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
    const eId = resolveReactionTargetEntityId(event);
    if (eId === undefined) return state;

    const rendCmp = getComponent(state, eId, ComponentType.Renderable) as RenderableComponent | undefined;
    return rendCmp ? addComponent(state, eId, { ...rendCmp, glyph: consequence.glyph }) : state;
  },

  set_lock_state: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'set_lock_state' }>
  ): GameState => {
    const eId = resolveReactionTargetEntityId(event);
    if (eId === undefined) return state;

    const lockCmp = getComponent(state, eId, ComponentType.Lock) as LockComponent | undefined;
    return lockCmp ? addComponent(state, eId, { ...lockCmp, locked: consequence.locked }) : state;
  },

  change_intents: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'change_intents' }>
  ): GameState => {
    const eId = resolveReactionTargetEntityId(event);
    if (eId === undefined) return state;

    const interactable = getComponent(state, eId, ComponentType.Interactable) as InteractableComponent | undefined;
    if (!interactable) return state;

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
  },

  spawn_entity: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'spawn_entity' }>
  ): GameState => {
    const templateId = consequence.entityTemplateId;
    if (!templateId) return state;

    const { pos } = resolveSpatialConsequenceTarget(state, event, consequence.targetId);
    if (!pos) return state;

    if (state.campaign.items[templateId]) {
      const [stateAfterSpawn] = spawnItem(state, templateId, pos.x, pos.y);
      return stateAfterSpawn;
    }
    if (state.campaign.entities[templateId]) {
      const [stateAfterSpawn, entityId] = spawnEntity(state, templateId, pos.x, pos.y);
      if (getComponent(stateAfterSpawn, entityId, ComponentType.Actor)) {
        addActor(entityId);
      }
      return stateAfterSpawn;
    }
    console.warn(`Template ${templateId} not found in campaign items/entities during spawn_entity consequence.`);
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

    const { pos: centerPos } = resolveSpatialConsequenceTarget(state, event, consequence.targetId);
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

        nextState = existingDamageComp
          ? addComponent(nextState, id, {
              ...existingDamageComp,
              instances: [...existingDamageComp.instances, damageInstance]
            })
          : addComponent(nextState, id, {
              type: ComponentType.Damage,
              instances: [damageInstance]
            });
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
    const { entityId } = resolveSpatialConsequenceTarget(state, event, consequence.targetId);
    if (entityId !== undefined) {
      return applyStatusEffect(state, entityId, consequence.statusId, consequence.duration ?? 10);
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
      const chosenStr = rng.getWeightedValue(weightMap);
      chosenIndex = chosenStr !== undefined ? parseInt(chosenStr, 10) : 0;
    } else {
      chosenIndex = rng.getUniformInt(0, choices.length - 1);
    }

    const chosenConsequences = choices[chosenIndex];
    let nextState = state;
    if (chosenConsequences) {
      for (const childCons of chosenConsequences) {
        nextState = apply(nextState, event, childCons);
      }
    }
    return nextState;
  },

  compile_scheme: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'compile_scheme' }>
  ): GameState => {
    let targetId: EntityId | undefined;
    if (consequence.targetRef === 'event.entityId' && 'entityId' in event) {
      targetId = (event as unknown as { entityId: EntityId }).entityId;
    } else if (consequence.targetRef) {
      const parsed = parseInt(consequence.targetRef, 10);
      if (!isNaN(parsed)) {
        targetId = parsed as EntityId;
      }
    }

    if (targetId !== undefined) {
      return compileScheme(state, consequence.recipeId, targetId);
    }
    return state;
  }
};
