import type { GameState, EntityId } from '../types/game-state.types.ts';
import { ComponentType, type HungerComponent, type FighterComponent } from '../types/components.types.ts';
import { getComponent, addComponent } from '../core/ecs.ts';
export enum HungerState {
  Satiated = 'Satiated',
  Normal = 'Normal',
  Hungry = 'Hungry',
  Starving = 'Starving'
}
import { addMessage, MessageLogCategory } from './message.system.ts';

/**
 * Returns the current HungerState for a given satiation value.
 */
export function getHungerState(state: GameState, satiation: number): HungerState {
  const t = state.campaign.rules.hunger.thresholds;
  if (satiation >= t.satiated) return HungerState.Satiated;
  if (satiation >= t.normal) return HungerState.Normal;
  if (satiation >= t.hungry) return HungerState.Hungry;
  return HungerState.Starving;
}

/**
 * Processes hunger for an entity, reducing its satiation and applying starvation damage if necessary.
 * Designed to be called after an entity acts, passing the energy cost of their action.
 *
 * @param state The current GameState.
 * @param entityId The entity to process hunger for.
 * @param energyCost The energy cost of the action just taken (100 = 1 standard turn).
 * @returns The updated GameState.
 */
export function processHungerTick(state: GameState, entityId: EntityId, energyCost: number): GameState {
  const hunger = getComponent(state, entityId, ComponentType.Hunger);
  if (!hunger || energyCost <= 0) return state;

  // 1 energy = 0.01 satiation loss (so 100 energy = 1 satiation lost)
  // Feel free to tweak this rate!
  const satiationLoss = energyCost / 100;
  const newSatiation = Math.max(0, hunger.satiation - satiationLoss);

  const oldState = getHungerState(state, hunger.satiation);
  const newState = getHungerState(state, newSatiation);

  let nextState = state;
  const nextComponents = new Map(nextState.components);
  const entityComps = nextComponents.get(entityId) ?? [];
  const nextHunger: HungerComponent = { ...hunger, satiation: newSatiation };
  nextComponents.set(
    entityId,
    entityComps.map((c) => (c.type === ComponentType.Hunger ? nextHunger : c))
  );
  nextState = { ...nextState, components: nextComponents };

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  // Log message on state change
  if (isPlayer && oldState !== newState) {
    if (newState === HungerState.Hungry) {
      nextState = addMessage(nextState, 'You are starting to feel hungry.', MessageLogCategory.System);
    } else if (newState === HungerState.Starving) {
      nextState = addMessage(nextState, 'You are starving! You must eat soon.', MessageLogCategory.System);
    } else if (newState === HungerState.Normal && oldState === HungerState.Hungry) {
      nextState = addMessage(nextState, 'You are no longer hungry.', MessageLogCategory.System);
    }
  }

  // Starvation damage
  if (newState === HungerState.Starving) {
    const fighter = getComponent(nextState, entityId, ComponentType.Fighter);
    if (fighter) {
      // 1 damage per 100 energy spent while starving
      const damage = Math.max(1, Math.floor(energyCost / 100));
      const newHp = Math.max(0, fighter.hp - damage);
      const nextFighter: FighterComponent = { ...fighter, hp: newHp };

      const newEntityComps = nextState.components.get(entityId) ?? [];
      const updatedComponents = new Map(nextState.components);
      updatedComponents.set(
        entityId,
        newEntityComps.map((c) => (c.type === ComponentType.Fighter ? nextFighter : c))
      );
      nextState = { ...nextState, components: updatedComponents };

      if (isPlayer && damage > 0) {
        nextState = addMessage(nextState, `You suffer ${damage} starvation damage!`, MessageLogCategory.CombatHit);
      }

      if (newHp === 0) {
        nextState = addComponent(nextState, entityId, {
          type: ComponentType.Death,
          causeOfDeath: 'starvation'
        });
      }
    }
  }

  return nextState;
}
