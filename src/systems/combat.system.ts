import type { GameState } from '../types/game-state.types.ts';
import type { MeleeAttackIntent } from '../types/intents.types.ts';
import { ComponentType, type FighterComponent } from '../types/components.types.ts';
import { getComponent, removeEntity } from '../core/ecs.ts';
import { removeActor } from '../core/scheduler.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { getEffectiveStats } from '../utils/stats.ts';

/**
 * Processes a MeleeAttackIntent.
 * Calculates damage based on attacker's attack and defender's defense.
 * Applies damage to the defender's FighterComponent.
 * If the defender's HP drops to 0, it removes the entity and emits a death message.
 * @param state The current GameState.
 * @param intent The MeleeAttackIntent to process.
 * @returns The updated GameState.
 */
export function processMeleeAttackIntent(state: GameState, intent: MeleeAttackIntent): GameState {
  const { entityId, defenderId } = intent;

  const attackerFighter = getComponent(state, entityId, ComponentType.Fighter);
  const defenderFighter = getComponent(state, defenderId, ComponentType.Fighter);
  const attackerRenderable = getComponent(state, entityId, ComponentType.Renderable);
  const defenderRenderable = getComponent(state, defenderId, ComponentType.Renderable);

  if (!attackerFighter || !defenderFighter) {
    return state;
  }

  const attackerName = attackerRenderable ? attackerRenderable.glyph : 'Someone';
  const defenderName = defenderRenderable ? defenderRenderable.glyph : 'Someone';

  // God mode check for player
  const isDefenderPlayer = getComponent(state, defenderId, ComponentType.Player) !== undefined;
  const isDefenderGod = getComponent(state, defenderId, ComponentType.GodMode) !== undefined;

  // Use effective stats so equipment bonuses are applied
  const attackerStats = getEffectiveStats(state, entityId);
  const defenderStats = getEffectiveStats(state, defenderId);

  let damage = Math.max(1, attackerStats.attack - defenderStats.defense);

  if (isDefenderGod) {
    damage = 0;
  }

  let nextState = state;

  if (damage > 0) {
    nextState = addMessage(
      nextState,
      `${attackerName} hits ${defenderName} for ${damage} damage.`,
      MessageLogCategory.CombatHit
    );
    const newHp = Math.max(0, defenderFighter.hp - damage);

    const nextFighter: FighterComponent = {
      ...defenderFighter,
      hp: newHp
    };

    const nextComponents = new Map(nextState.components);
    const entityComponents = nextComponents.get(defenderId) ?? [];
    nextComponents.set(
      defenderId,
      entityComponents.map((c) => (c.type === ComponentType.Fighter ? nextFighter : c))
    );

    nextState = {
      ...nextState,
      components: nextComponents
    };

    if (newHp === 0) {
      nextState = addMessage(nextState, `${defenderName} dies!`, MessageLogCategory.CombatDeath);

      if (isDefenderPlayer) {
        nextState = addMessage(nextState, `Game Over! You have been slain.`, MessageLogCategory.CombatDeath);
        nextState = { ...nextState, isGameOver: true };
      } else {
        // Strip the dead entity from the world
        nextState = removeEntity(nextState, defenderId);
        removeActor(defenderId);
      }
    }
  } else {
    nextState = addMessage(
      nextState,
      `${attackerName} attacks ${defenderName} but deals no damage.`,
      MessageLogCategory.CombatMiss
    );
  }

  return nextState;
}
