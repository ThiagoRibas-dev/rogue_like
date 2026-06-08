import type { GameState, EntityId } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import {
  ComponentType,
  type FighterComponent,
  type StatusEffectsComponent,
  type ActiveStatusEffect
} from '../types/components.types.ts';
import { getComponent, removeEntity } from '../core/ecs.ts';
import { STATUS_EFFECTS } from '../constants/status.constants.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { removeActor } from '../core/scheduler.ts';
import { deleteSave } from '../core/save.ts';
import { grantXp } from './combat.system.ts';
import { getEffectiveStats } from '../utils/stats.ts';

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
  const renderable = getComponent(state, entityId, ComponentType.Renderable);
  const name = renderable ? renderable.glyph : 'Someone';

  let xpToGrant: { source: EntityId; amount: number } | null = null;

  for (const active of statuses.activeEffects) {
    const def = STATUS_EFFECTS[active.effectId];
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
    }

    if (active.duration > 1) {
      nextActiveEffects.push({ ...active, duration: active.duration - 1 });
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

    let newHp = fighter.hp;
    if (actualDamage > 0) {
      newHp = Math.max(0, newHp - actualDamage);
      nextState = addMessage(
        nextState,
        `${name} takes ${actualDamage} damage from status effects.`,
        MessageLogCategory.CombatHit
      );
    }

    if (healthGained > 0 && newHp > 0) {
      const stats = getEffectiveStats(nextState, entityId);
      newHp = Math.min(stats.maxHp, newHp + healthGained);
    }

    const nextFighter: FighterComponent = { ...fighter, hp: newHp };
    const nextComponents = new Map(nextState.components);
    const comps = nextComponents.get(entityId) ?? [];
    nextComponents.set(
      entityId,
      comps.map((c) => (c.type === ComponentType.Fighter ? nextFighter : c))
    );
    nextState = { ...nextState, components: nextComponents };

    if (newHp === 0) {
      nextState = addMessage(nextState, `${name} dies from status effects!`, MessageLogCategory.CombatDeath);

      if (isPlayer) {
        nextState = addMessage(
          nextState,
          `Game Over! You have succumbed to your afflictions.`,
          MessageLogCategory.CombatDeath
        );
        nextState = { ...nextState, isGameOver: true, uiMode: UIMode.GameOver };
        deleteSave();
      } else {
        nextState = removeEntity(nextState, entityId);
        removeActor(entityId);

        if (xpToGrant) {
          nextState = grantXp(nextState, xpToGrant.source, xpToGrant.amount);
        }
      }
    }
  }

  // Update StatusEffectsComponent
  // Note: if entity died, it was removed from nextState, so we don't update its components
  if (getComponent(nextState, entityId, ComponentType.Fighter)) {
    const nextComponents = new Map(nextState.components);
    const comps = nextComponents.get(entityId) ?? [];

    if (nextActiveEffects.length === 0) {
      nextComponents.set(
        entityId,
        comps.filter((c) => c.type !== ComponentType.StatusEffects)
      );
    } else {
      const nextStatuses: StatusEffectsComponent = {
        type: ComponentType.StatusEffects,
        activeEffects: nextActiveEffects
      };
      nextComponents.set(
        entityId,
        comps.map((c) => (c.type === ComponentType.StatusEffects ? nextStatuses : c))
      );
    }
    nextState = { ...nextState, components: nextComponents };
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
    const def = STATUS_EFFECTS[e.effectId];
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
  const nextActive: ActiveStatusEffect =
    sourceEntityId !== undefined ? { effectId, duration, sourceEntityId } : { effectId, duration };

  const nextComponents = new Map(state.components);
  const comps = nextComponents.get(entityId) ?? [];

  if (statuses) {
    // If the effect is already active, we refresh the duration to the max of current vs new
    const existingIndex = statuses.activeEffects.findIndex((e) => e.effectId === effectId);
    const nextEffects = [...statuses.activeEffects];

    if (existingIndex >= 0) {
      const existing = nextEffects[existingIndex]!;
      const newDuration = Math.max(existing.duration, duration);
      nextEffects[existingIndex] =
        sourceEntityId !== undefined
          ? { ...existing, duration: newDuration, sourceEntityId }
          : { ...existing, duration: newDuration };
    } else {
      nextEffects.push(nextActive);
    }

    const nextStatuses: StatusEffectsComponent = { type: ComponentType.StatusEffects, activeEffects: nextEffects };
    nextComponents.set(
      entityId,
      comps.map((c) => (c.type === ComponentType.StatusEffects ? nextStatuses : c))
    );
  } else {
    const nextStatuses: StatusEffectsComponent = { type: ComponentType.StatusEffects, activeEffects: [nextActive] };
    nextComponents.set(entityId, [...comps, nextStatuses]);
  }

  const def = STATUS_EFFECTS[effectId];
  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
  let nextState: GameState = { ...state, components: nextComponents };

  if (isPlayer && def) {
    nextState = addMessage(nextState, `You are now ${def.name}.`, MessageLogCategory.System);
  }

  return nextState;
}
