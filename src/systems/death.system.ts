import type { EntityId, GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { ComponentType, type DeathComponent } from '../types/components.types.ts';
import { getComponent, removeEntity } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { removeActor } from '../core/scheduler.ts';
import { deleteSave } from '../core/save.ts';
import { processQuestEvent } from './quest.system.ts';

/**
 * Helper to grant XP to an entity and handle level ups.
 * Moved from combat.system.ts to death.system.ts where it belongs.
 */
export function grantXp(state: GameState, entityId: EntityId, amount: number): GameState {
  if (amount <= 0) return state;

  const fighter = getComponent(state, entityId, ComponentType.Fighter);
  if (!fighter) return state;

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  let nextState = state;
  let nextFighter = { ...fighter, xp: fighter.xp + amount };

  if (isPlayer) {
    nextState = addMessage(nextState, `You gained ${amount} XP.`, MessageLogCategory.System);
  }

  let nextLevelDef = state.campaign.advancement.find((a) => a.level === nextFighter.level + 1);

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

    nextLevelDef = state.campaign.advancement.find((a) => a.level === nextFighter.level + 1);
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
 * Processes all entities that have a DeathComponent.
 * Removes them from the world, emits death messages, grants XP, and handles Game Over for the player.
 */
export function processDeathSystem(state: GameState): GameState {
  let nextState = state;

  // We copy the entities array because removing entities mutates the array
  // Wait, removeEntity returns a new state object, but state.entities is iterated.
  // It's safer to iterate a copy of the entities array
  const entities = [...nextState.entities];

  for (const entityId of entities) {
    const deathComp = getComponent(nextState, entityId, ComponentType.Death) as DeathComponent | undefined;
    if (!deathComp) continue;

    const renderable = getComponent(nextState, entityId, ComponentType.Renderable);
    const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
    const fighter = getComponent(nextState, entityId, ComponentType.Fighter);

    const name = renderable ? renderable.glyph : 'Someone';

    nextState = addMessage(nextState, `${name} dies!`, MessageLogCategory.CombatDeath);

    if (isPlayer) {
      let causeText = 'slain';
      if (deathComp.causeOfDeath) {
        causeText = `killed by a ${deathComp.causeOfDeath}`;
      }
      nextState = addMessage(nextState, `Game Over! You have been ${causeText}.`, MessageLogCategory.CombatDeath);
      nextState = { ...nextState, isGameOver: true, uiMode: UIMode.GameOver };
      deleteSave(); // Enforce permadeath
    } else {
      // Grant XP to killer if applicable
      if (deathComp.killerId !== undefined && fighter && fighter.xpGiven > 0) {
        nextState = grantXp(nextState, deathComp.killerId, fighter.xpGiven);

        // Notify quest system if player killed it
        if (deathComp.killerId === state.entities.find((e) => getComponent(state, e, ComponentType.Player))) {
          const templateComp = getComponent(nextState, entityId, ComponentType.Template) as
            | import('../types/components.types.ts').TemplateComponent
            | undefined;
          if (templateComp) {
            nextState = processQuestEvent(nextState, 'kill', templateComp.templateId, 1);
          }
        }
      }

      // Strip the dead entity from the world
      nextState = removeEntity(nextState, entityId);
      removeActor(entityId);
    }
  }

  return nextState;
}
