import * as ROT from 'rot-js';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { GameEventType } from '../types/events.types.ts';
import {
  ComponentType,
  type DeathComponent,
  type PositionComponent,
  type TagsComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import { getComponent, removeEntity, addComponent, spawnItem } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { removeActor } from '../core/scheduler.ts';
import { deleteSave } from '../core/save.ts';
import { processQuestEvent } from './quest.system.ts';
import { evaluateCheatDeath } from './nemesis.system.ts';

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

  return addComponent(nextState, entityId, nextFighter);
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

    const tagsComponent = getComponent(nextState, entityId, ComponentType.Tags) as TagsComponent | undefined;
    const tags = tagsComponent ? tagsComponent.tags : [];

    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.EntityDied,
          victimId: entityId,
          ...(deathComp.killerId !== undefined ? { killerId: deathComp.killerId } : {}),
          tags
        }
      ]
    };

    if (isPlayer) {
      let causeText = 'slain';
      if (deathComp.causeOfDeath) {
        causeText = `killed by a ${deathComp.causeOfDeath}`;
      }
      nextState = addMessage(nextState, `Game Over! You have been ${causeText}.`, MessageLogCategory.CombatDeath);
      nextState = { ...nextState, isGameOver: true, uiMode: UIMode.GameOver };
      deleteSave(); // Enforce permadeath
    } else {
      // Check for cheat death before removing entity
      const cheatResult = evaluateCheatDeath(nextState, entityId, deathComp.killerId);
      if (cheatResult.shouldCheatDeath) {
        nextState = cheatResult.state;
        continue; // Entity moves to limbo; do not remove completely or drop loot yet
      }

      // Grant XP to killer if applicable
      if (deathComp.killerId !== undefined && fighter && fighter.xpGiven > 0) {
        nextState = grantXp(nextState, deathComp.killerId, fighter.xpGiven);

        // Notify quest system if player killed it
        if (deathComp.killerId === state.entities.find((e) => getComponent(state, e, ComponentType.Player))) {
          const templateComp = getComponent(nextState, entityId, ComponentType.Template) as
            | TemplateComponent
            | undefined;
          if (templateComp) {
            nextState = processQuestEvent(nextState, 'kill', templateComp.templateId, 1);
          }
        }
      }

      // Let the Trigger system handle clue drops and narrative consequences.
      // E.g., `EntityDiedEvent` is evaluated by `processGlobalTriggers`.

      // Contextual loot drop: roll on the global loot table at configured chance
      const lootTable = nextState.campaign.rules.spawning.lootTable;
      const lootDropChance = nextState.campaign.rules.spawning.lootDropChance;
      if (Object.keys(lootTable).length > 0 && ROT.RNG.getUniform() < lootDropChance) {
        const pos = getComponent(nextState, entityId, ComponentType.Position) as PositionComponent | undefined;
        if (pos) {
          const itemId = ROT.RNG.getWeightedValue(lootTable as Record<string, number>);
          if (itemId && nextState.campaign.items[itemId]) {
            const itemDef = nextState.campaign.items[itemId]!;
            [nextState] = spawnItem(nextState, itemId, pos.x, pos.y);
            nextState = addMessage(nextState, `${name} drops ${itemDef.name}.`, MessageLogCategory.CombatDeath);
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
