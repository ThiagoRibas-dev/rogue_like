import type { GameState, EntityId } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';

/**
 * The effective combat stats for an entity after applying all equipment bonuses.
 * Use this everywhere stats are needed — never read FighterComponent directly in combat.
 */
export interface EffectiveStats {
  readonly attack: number;
  readonly defense: number;
  readonly maxHp: number;
  readonly speed: number;
}

/**
 * Computes the effective combat stats for an entity by summing base FighterComponent
 * values with bonuses from all equipped items.
 *
 * This is the canonical stat query function. Any future sources of stat modification
 * (M6 level bonuses, M8 status effects) should add to this function as additional sources.
 *
 * @param state The current GameState.
 * @param entityId The entity whose stats to compute.
 * @returns The effective EffectiveStats, or zeroed stats if FighterComponent is missing.
 */
export function getEffectiveStats(state: GameState, entityId: EntityId): EffectiveStats {
  const fighter = getComponent(state, entityId, ComponentType.Fighter);
  const actor = getComponent(state, entityId, ComponentType.Actor);

  let baseAttack = 0;
  let baseDefense = 0;
  let baseMaxHp = 0;
  let baseSpeed = 100;

  if (fighter) {
    baseAttack = fighter.attack;
    baseDefense = fighter.defense;
    baseMaxHp = fighter.maxHp;
  }

  if (actor) {
    baseSpeed = actor.speed;
  }

  let attackBonus = 0;
  let defenseBonus = 0;
  let maxHpBonus = 0;
  let speedBonus = 0;

  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (equipment) {
    for (const slot of equipment.slots) {
      if (slot.equippedItem !== null) {
        const item = getComponent(state, slot.equippedItem, ComponentType.Item);
        if (item) {
          const def = state.campaign.items[item.itemId];
          if (def?.equippable) {
            attackBonus += def.equippable.attackBonus;
            defenseBonus += def.equippable.defenseBonus;
            maxHpBonus += def.equippable.maxHpBonus;
          }
        }
      }
    }
  }

  const statuses = getComponent(state, entityId, ComponentType.StatusEffects);
  if (statuses) {
    for (const active of statuses.activeEffects) {
      const def = state.campaign.status[active.effectId];
      if (def?.statModifiers) {
        attackBonus += def.statModifiers.attack ?? 0;
        defenseBonus += def.statModifiers.defense ?? 0;
        maxHpBonus += def.statModifiers.maxHp ?? 0;
        speedBonus += def.statModifiers.speed ?? 0;
      }
    }
  }

  return {
    attack: baseAttack + attackBonus,
    defense: baseDefense + defenseBonus,
    maxHp: baseMaxHp + maxHpBonus,
    speed: baseSpeed + speedBonus
  };
}
