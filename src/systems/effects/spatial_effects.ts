import { getComponent, addComponent } from '../../core/ecs.ts';
import {
  ComponentType,
  type DamageComponent,
  type DamageInstance,
  type TagsComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { applyStatusEffect } from '../status-effect.system.ts';
import type { ItemEffectDefinition } from '../../types/campaign.types.ts';
import { getFactionRelation } from '../../utils/faction.ts';

/**
 * Evaluates whether a target entity matches an ItemEffectDefinition's tag and faction filters.
 */
export function matchesTargetFilters(
  state: GameState,
  sourceId: EntityId,
  targetId: EntityId,
  effectDef: ItemEffectDefinition
): boolean {
  const filters = effectDef.targetFilters;
  if (!filters) return true;

  if (filters.requireTags || filters.excludeTags) {
    const targetTags = getComponent(state, targetId, ComponentType.Tags) as TagsComponent | undefined;
    const tagsArray = targetTags?.tags || [];

    if (filters.requireTags && filters.requireTags.length > 0) {
      if (!filters.requireTags.every((tag) => tagsArray.includes(tag))) return false;
    }

    if (filters.excludeTags && filters.excludeTags.length > 0) {
      if (filters.excludeTags.some((tag) => tagsArray.includes(tag))) return false;
    }
  }

  if (filters.factions && filters.factions.length > 0) {
    let relation: 'friendly' | 'neutral' | 'hostile' = 'neutral';
    if (sourceId === targetId) {
      relation = 'friendly';
    } else {
      relation = getFactionRelation(state, sourceId, targetId);
    }
    if (!filters.factions.includes(relation)) return false;
  }

  return true;
}

/**
 * Resolves a 'damage_nearest' item effect.
 */
export function resolveDamageNearestEffect(
  state: GameState,
  userId: EntityId,
  effectDef: ItemEffectDefinition
): GameState {
  const userPos = getComponent(state, userId, ComponentType.Position);
  if (!userPos) return state;

  const range = effectDef.range ?? 8;
  let nearestId: EntityId | undefined;
  let nearestDist = Infinity;

  for (const id of state.entities) {
    if (id === userId) continue;
    const targetFighter = getComponent(state, id, ComponentType.Fighter);
    const targetPos = getComponent(state, id, ComponentType.Position);
    if (!targetFighter || !targetPos) continue;

    if (!matchesTargetFilters(state, userId, id, effectDef)) continue;

    const dist = Math.sqrt(Math.pow(targetPos.x - userPos.x, 2) + Math.pow(targetPos.y - userPos.y, 2));
    if (dist <= range && dist < nearestDist) {
      nearestDist = dist;
      nearestId = id;
    }
  }

  if (nearestId === undefined) {
    return addMessage(state, 'The scroll crackles... but finds no target.', MessageLogCategory.System);
  }

  const targetFighter = getComponent(state, nearestId, ComponentType.Fighter);
  if (!targetFighter) return state;

  const targetRenderable = getComponent(state, nearestId, ComponentType.Renderable);
  const targetName = targetRenderable?.glyph ?? 'target';

  const msg = effectDef.message.replace('{target}', targetName).replace('{value}', String(effectDef.value));
  const nextState = addMessage(state, msg, MessageLogCategory.CombatHit);

  const existingDamageComp = getComponent(nextState, nearestId, ComponentType.Damage) as DamageComponent | undefined;
  const damageInstance: DamageInstance = {
    amount: effectDef.value,
    sourceEntityId: userId,
    tags: ['spell', 'magic']
  };

  if (existingDamageComp) {
    return addComponent(nextState, nearestId, {
      ...existingDamageComp,
      instances: [...existingDamageComp.instances, damageInstance]
    });
  }
  return addComponent(nextState, nearestId, {
    type: ComponentType.Damage,
    instances: [damageInstance]
  });
}

/**
 * Resolves a 'damage_area' PBAoE item effect.
 */
export function resolveDamageAreaEffect(
  state: GameState,
  userId: EntityId,
  effectDef: ItemEffectDefinition
): GameState {
  const userPos = getComponent(state, userId, ComponentType.Position);
  if (!userPos) return state;

  const radius = effectDef.radius ?? 3;
  let nextState = state;
  let hitSomeone = false;

  for (const id of state.entities) {
    if (id === userId) continue;
    const targetFighter = getComponent(state, id, ComponentType.Fighter);
    const targetPos = getComponent(state, id, ComponentType.Position);
    if (!targetFighter || !targetPos) continue;

    if (!matchesTargetFilters(state, userId, id, effectDef)) continue;

    const dist = Math.sqrt(Math.pow(targetPos.x - userPos.x, 2) + Math.pow(targetPos.y - userPos.y, 2));
    if (dist <= radius) {
      hitSomeone = true;
      const targetRenderable = getComponent(state, id, ComponentType.Renderable);
      const targetName = targetRenderable?.glyph ?? 'target';
      const msg = effectDef.message.replace('{target}', targetName).replace('{value}', String(effectDef.value));
      nextState = addMessage(nextState, msg, MessageLogCategory.CombatHit);

      const existingDamageComp = getComponent(nextState, id, ComponentType.Damage) as DamageComponent | undefined;
      const damageInstance: DamageInstance = {
        amount: effectDef.value,
        sourceEntityId: userId,
        tags: ['spell', 'magic', 'aoe']
      };

      if (existingDamageComp) {
        nextState = addComponent(nextState, id, {
          ...existingDamageComp,
          instances: [...existingDamageComp.instances, damageInstance]
        });
      } else {
        nextState = addComponent(nextState, id, {
          type: ComponentType.Damage,
          instances: [damageInstance]
        });
      }
    }
  }

  if (!hitSomeone) {
    nextState = addMessage(nextState, 'The area is blasted, but nothing was hit.', MessageLogCategory.System);
  }
  return nextState;
}

/**
 * Resolves an 'apply_status' item effect.
 */
export function resolveApplyStatusEffect(
  state: GameState,
  userId: EntityId,
  effectDef: ItemEffectDefinition,
  itemName: string,
  explicitTargetId?: EntityId
): GameState {
  if (!effectDef.statusId || !effectDef.duration) return state;

  if (explicitTargetId !== undefined) {
    if (!matchesTargetFilters(state, userId, explicitTargetId, effectDef)) return state;

    const targetRenderable = getComponent(state, explicitTargetId, ComponentType.Renderable);
    const isPlayer = getComponent(state, explicitTargetId, ComponentType.Player) !== undefined;
    const targetName = isPlayer ? 'You' : (targetRenderable?.glyph ?? 'target');
    const msg = effectDef.message.replace('{target}', targetName);

    let nextState = addMessage(state, msg, MessageLogCategory.CombatHit);
    nextState = applyStatusEffect(nextState, explicitTargetId, effectDef.statusId, effectDef.duration, userId);
    return nextState;
  }

  if (effectDef.range) {
    const userPos = getComponent(state, userId, ComponentType.Position);
    if (!userPos) return state;

    let nearestId: EntityId | undefined;
    let nearestDist = Infinity;

    for (const id of state.entities) {
      if (id === userId) continue;
      const targetFighter = getComponent(state, id, ComponentType.Fighter);
      const targetPos = getComponent(state, id, ComponentType.Position);
      if (!targetFighter || !targetPos) continue;

      if (!matchesTargetFilters(state, userId, id, effectDef)) continue;

      const dist = Math.sqrt(Math.pow(targetPos.x - userPos.x, 2) + Math.pow(targetPos.y - userPos.y, 2));
      if (dist <= effectDef.range && dist < nearestDist) {
        nearestDist = dist;
        nearestId = id;
      }
    }

    if (nearestId === undefined) {
      return addMessage(state, 'The magic crackles... but finds no target.', MessageLogCategory.System);
    }

    const targetRenderable = getComponent(state, nearestId, ComponentType.Renderable);
    const isPlayer = getComponent(state, nearestId, ComponentType.Player) !== undefined;
    const targetName = isPlayer ? 'You' : (targetRenderable?.glyph ?? 'target');
    const msg = effectDef.message.replace('{target}', targetName);

    let nextState = addMessage(state, msg, MessageLogCategory.CombatHit);
    nextState = applyStatusEffect(nextState, nearestId, effectDef.statusId, effectDef.duration, userId);
    return nextState;
  }

  if (!matchesTargetFilters(state, userId, userId, effectDef)) {
    return addMessage(state, `The magic fizzles, having no effect on you.`, MessageLogCategory.System);
  }
  const isPlayer = getComponent(state, userId, ComponentType.Player) !== undefined;
  const targetName = isPlayer ? 'You' : (getComponent(state, userId, ComponentType.Renderable)?.glyph ?? 'Something');
  const msg = effectDef.message.replace('{item}', itemName).replace('{target}', targetName);
  let nextState = addMessage(state, msg, MessageLogCategory.System);
  nextState = applyStatusEffect(nextState, userId, effectDef.statusId, effectDef.duration, userId);
  return nextState;
}
