import type { GameState } from '../types/game-state.types.ts';
import type { MeleeAttackIntent } from '../types/intents.types.ts';
import { ComponentType, type FighterComponent } from '../types/components.types.ts';
import { getComponent, removeEntity } from '../core/ecs.ts';
import { removeActor } from '../core/scheduler.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { getAdvancementForLevel } from '../constants/advancement.constants.ts';
import { type EntityId } from '../types/game-state.types.ts';

/**
 * Helper to grant XP to an entity and handle level ups.
 * @param state The current GameState.
 * @param entityId The ID of the entity receiving XP.
 * @param amount The amount of XP to grant.
 * @returns The updated GameState.
 */
function grantXp(state: GameState, entityId: EntityId, amount: number): GameState {
  if (amount <= 0) return state;

  const fighter = getComponent(state, entityId, ComponentType.Fighter);
  if (!fighter) return state;

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  let nextState = state;
  let nextFighter = { ...fighter, xp: fighter.xp + amount };

  if (isPlayer) {
    nextState = addMessage(nextState, `You gained ${amount} XP.`, MessageLogCategory.System);
  }

  let nextLevelDef = getAdvancementForLevel(nextFighter.level + 1);

  while (nextLevelDef && nextFighter.xp >= nextLevelDef.requiredXp) {
    nextFighter = {
      ...nextFighter,
      level: nextLevelDef.level,
      maxHp: nextFighter.maxHp + nextLevelDef.hpGain,
      attack: nextFighter.attack + nextLevelDef.attackGain,
      defense: nextFighter.defense + nextLevelDef.defenseGain
    };
    // Full heal on level up
    nextFighter.hp = nextFighter.maxHp;

    if (isPlayer) {
      nextState = addMessage(nextState, `You reached level ${nextFighter.level}!`, MessageLogCategory.System);
    }

    nextLevelDef = getAdvancementForLevel(nextFighter.level + 1);
  }

  const nextComponents = new Map(nextState.components);
  const entityComponents = nextComponents.get(entityId) ?? [];
  nextComponents.set(
    entityId,
    entityComponents.map((c) => (c.type === ComponentType.Fighter ? nextFighter : c))
  );

  return {
    ...nextState,
    components: nextComponents
  };
}

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

        // Grant XP to attacker
        if (defenderFighter.xpGiven > 0) {
          nextState = grantXp(nextState, entityId, defenderFighter.xpGiven);
        }
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
