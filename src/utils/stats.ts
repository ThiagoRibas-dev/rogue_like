import type { GameState, EntityId } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { ITEM_REGISTRY } from '../constants/items.constants.ts';

/**
 * The effective combat stats for an entity after applying all equipment bonuses.
 * Use this everywhere stats are needed — never read FighterComponent directly in combat.
 */
export interface EffectiveStats {
  readonly attack: number;
  readonly defense: number;
  readonly maxHp: number;
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
  if (!fighter) {
    return { attack: 0, defense: 0, maxHp: 0 };
  }

  let attackBonus = 0;
  let defenseBonus = 0;
  let maxHpBonus = 0;

  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (equipment) {
    const slots = [equipment.weapon, equipment.armor] as const;
    for (const itemEntityId of slots) {
      if (itemEntityId !== null) {
        const item = getComponent(state, itemEntityId, ComponentType.Item);
        if (item) {
          const def = ITEM_REGISTRY[item.itemId];
          if (def?.equippable) {
            attackBonus += def.equippable.attackBonus;
            defenseBonus += def.equippable.defenseBonus;
            maxHpBonus += def.equippable.maxHpBonus;
          }
        }
      }
    }
  }

  return {
    attack: fighter.attack + attackBonus,
    defense: fighter.defense + defenseBonus,
    maxHp: fighter.maxHp + maxHpBonus
  };
}
