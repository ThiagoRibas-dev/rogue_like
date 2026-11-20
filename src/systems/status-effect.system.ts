import type { GameState, EntityId } from '../types/game-state.types.ts';
import {
  ComponentType,
  type FighterComponent,
  type StatusEffectsComponent,
  type ActiveStatusEffect
} from '../types/components.types.ts';
import { getComponent, addComponent, removeComponent, resolveEntityDisplayName } from '../core/ecs.ts';

import { getRuleset } from '../rulesets/registry.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import type { DamageComponent, DamageInstance } from '../types/components.types.ts';

/**
 * Ticks active status effects on an entity.
 * This should be called at the start of the entity's turn.
 * It applies per-turn damage/heals, reduces durations, and removes expired effects.
 *
 * @param state The current GameState.
 * @param entityId The entity whose turn is starting.
 * @returns The updated GameState.
 */
export function processStatusEffectsTick(state: GameState, entityId: EntityId): GameState {
  const statuses = getComponent(state, entityId, ComponentType.StatusEffects);
  if (!statuses || statuses.activeEffects.length === 0) return state;

  let nextState = state;
  const nextActiveEffects: ActiveStatusEffect[] = [];
  let damageTaken = 0;
  let healthGained = 0;

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
  const name = resolveEntityDisplayName(state, entityId, 'Someone');

  let xpToGrant: { source: EntityId; amount: number } | null = null;

  for (const active of statuses.activeEffects) {
    const def = state.campaign.status[active.effectId];
    let nextElapsed = active.elapsedTurns ?? 0;
    let nextSecondaryResolved = active.secondaryResolved === true;

    if (def) {
      if (def.perTurnDamage) damageTaken += def.perTurnDamage;
      if (def.perTurnHeal) healthGained += def.perTurnHeal;

      if (def.perTurnDamage && active.sourceEntityId) {
        // In case this damage kills the entity, we track who should get XP
        const fighter = getComponent(nextState, entityId, ComponentType.Fighter);
        if (fighter && fighter.xpGiven > 0) {
          xpToGrant = { source: active.sourceEntityId, amount: fighter.xpGiven };
        }
      }

      if (def.secondaryTriggerAfterTurns !== undefined && !nextSecondaryResolved) {
        nextElapsed += 1;
        if (nextElapsed >= def.secondaryTriggerAfterTurns) {
          nextSecondaryResolved = true;
          const ruleset = getRuleset(nextState.campaign?.manifest?.rulesetId);
          if (ruleset.resolveStatusSecondaryStage) {
            const stageRes = ruleset.resolveStatusSecondaryStage(nextState, entityId, active, def);
            nextState = stageRes.state;
            if (!stageRes.resisted && def.secondaryDamage !== undefined && def.secondaryDamage > 0) {
              damageTaken += def.secondaryDamage;
            }
          } else if (def.secondaryDamage !== undefined && def.secondaryDamage > 0) {
            damageTaken += def.secondaryDamage;
          }
        }
      }
    }

    if (active.duration > 1) {
      nextActiveEffects.push({
        ...active,
        duration: active.duration - 1,
        ...(def?.secondaryTriggerAfterTurns !== undefined
          ? { elapsedTurns: nextElapsed, secondaryResolved: nextSecondaryResolved }
          : {})
      });
    } else {
      if (isPlayer) {
        nextState = addMessage(
          nextState,
          `You are no longer ${def?.name ?? active.effectId}.`,
          MessageLogCategory.System
        );
      }
    }
  }

  // Apply damage and healing
  const fighter = getComponent(nextState, entityId, ComponentType.Fighter);
  if (fighter && (damageTaken > 0 || healthGained > 0)) {
    const isGod = getComponent(nextState, entityId, ComponentType.GodMode) !== undefined;
    const actualDamage = isGod ? 0 : damageTaken;

    if (healthGained > 0) {
      const stats = getEffectiveStats(nextState, entityId);
      const newHp = Math.min(stats.maxHp, fighter.hp + healthGained);
      const nextFighter: FighterComponent = { ...fighter, hp: newHp };
      nextState = addComponent(nextState, entityId, nextFighter);
    }

    if (actualDamage > 0) {
      nextState = addMessage(nextState, `${name} suffers from afflictions.`, MessageLogCategory.CombatHit);

      const existingDamageComp = getComponent(nextState, entityId, ComponentType.Damage) as DamageComponent | undefined;

      const damageInstance: DamageInstance = {
        amount: actualDamage,
        sourceEntityId: xpToGrant ? xpToGrant.source : undefined,
        tags: ['status_effect', 'dot']
      };

      if (existingDamageComp) {
        const newDamageComp = { ...existingDamageComp, instances: [...existingDamageComp.instances, damageInstance] };
        nextState = addComponent(nextState, entityId, newDamageComp);
      } else {
        const newDamageComp: DamageComponent = {
          type: ComponentType.Damage,
          instances: [damageInstance]
        };
        nextState = addComponent(nextState, entityId, newDamageComp);
      }
    }
  }

  // Update StatusEffectsComponent
  // Note: if entity died, it was removed from nextState, so we don't update its components
  if (getComponent(nextState, entityId, ComponentType.Fighter)) {
    if (nextActiveEffects.length === 0) {
      nextState = removeComponent(nextState, entityId, ComponentType.StatusEffects);
    } else {
      const nextStatuses: StatusEffectsComponent = {
        type: ComponentType.StatusEffects,
        activeEffects: nextActiveEffects
      };
      nextState = addComponent(nextState, entityId, nextStatuses);
    }
  }

  return nextState;
}

/**
 * Checks whether any active status effect on this entity has the `skipTurn` flag.
 * The game loop uses this to decide if the entity's turn should be skipped entirely.
 *
 * @param state The current GameState.
 * @param entityId The entity to check.
 * @returns `true` if the entity should skip its turn.
 */
export function shouldSkipTurn(state: GameState, entityId: EntityId): boolean {
  const statuses = getComponent(state, entityId, ComponentType.StatusEffects);
  if (!statuses) return false;
  return statuses.activeEffects.some((e) => {
    const def = state.campaign.status[e.effectId];
    return def?.flags?.skipTurn === true;
  });
}

/**
 * Helper to apply a status effect to an entity.
 */
export function applyStatusEffect(
  state: GameState,
  entityId: EntityId,
  effectId: string,
  duration: number,
  sourceEntityId?: EntityId
): GameState {
  const statuses = getComponent(state, entityId, ComponentType.StatusEffects);
  const def = state.campaign.status[effectId];
  const hasSecondaryStage = def?.secondaryTriggerAfterTurns !== undefined;
  const nextActive: ActiveStatusEffect = {
    effectId,
    duration,
    ...(sourceEntityId !== undefined ? { sourceEntityId } : {}),
    ...(hasSecondaryStage ? { elapsedTurns: 0, secondaryResolved: false } : {})
  };

  let nextState = state;

  if (statuses) {
    // If the effect is already active, we refresh the duration to the max of current vs new
    const existingIndex = statuses.activeEffects.findIndex((e) => e.effectId === effectId);
    const nextEffects = [...statuses.activeEffects];

    if (existingIndex >= 0) {
      const existing = nextEffects[existingIndex]!;
      const newDuration = Math.max(existing.duration, duration);
      nextEffects[existingIndex] = {
        ...existing,
        duration: newDuration,
        ...(sourceEntityId !== undefined ? { sourceEntityId } : {}),
        ...(hasSecondaryStage ? { elapsedTurns: 0, secondaryResolved: false } : {})
      };
    } else {
      nextEffects.push(nextActive);
    }

    const nextStatuses: StatusEffectsComponent = { type: ComponentType.StatusEffects, activeEffects: nextEffects };
    nextState = addComponent(nextState, entityId, nextStatuses);
  } else {
    const nextStatuses: StatusEffectsComponent = { type: ComponentType.StatusEffects, activeEffects: [nextActive] };
    nextState = addComponent(nextState, entityId, nextStatuses);
  }

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  if (isPlayer && def) {
    nextState = addMessage(nextState, `You are now ${def.name}.`, MessageLogCategory.System);
  }

  return nextState;
}

/**
 * Neutralizes any unresolved secondary-stage status effects (such as multi-stage poisons)
 * on `entityId` by marking `secondaryResolved: true` without triggering secondary damage.
 *
 * @param state Current immutable GameState.
 * @param entityId Patient EntityId.
 * @returns Updated GameState and count of neutralized pending secondary stages.
 */
export function neutralizePendingSecondaryStatuses(
  state: GameState,
  entityId: EntityId
): { readonly state: GameState; readonly neutralizedCount: number } {
  const statuses = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  if (!statuses || statuses.activeEffects.length === 0) {
    return { state, neutralizedCount: 0 };
  }

  let neutralizedCount = 0;
  const updatedEffects = statuses.activeEffects.map((eff) => {
    const def = state.campaign.status[eff.effectId];
    if (def?.secondaryTriggerAfterTurns !== undefined && eff.secondaryResolved !== true) {
      neutralizedCount++;
      return { ...eff, secondaryResolved: true };
    }
    return eff;
  });

  if (neutralizedCount === 0) {
    return { state, neutralizedCount: 0 };
  }

  return {
    state: addComponent(state, entityId, { ...statuses, activeEffects: updatedEffects }),
    neutralizedCount
  };
}
