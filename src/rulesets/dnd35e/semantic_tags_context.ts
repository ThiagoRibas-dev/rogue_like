import { getComponent } from '../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type ItemComponent,
  type TacticalDoctrineComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { computeMaterialEquipmentStats } from './equipment/special_materials.ts';
import { resolveEffectiveItemDefinition } from './equipment/item_inheritance.ts';
import type { DnD35EntityData } from './types/dnd35e.types.ts';
import type { DnD35ItemDefinition } from './types/dnd35e_system.types.ts';

/** Live situational equipment and encumbrance context for Horizon 3 semantic tag projection. */
export interface SituationalTagContext {
  readonly armorCategory?: 'none' | 'light' | 'medium' | 'heavy' | undefined;
  readonly hasShield?: boolean | undefined;
  readonly isMetalArmorOrShield?: boolean | undefined;
  readonly loadCategory?: 'light' | 'medium' | 'heavy' | undefined;
  readonly doctrine?: TacticalDoctrineComponent | undefined;
}

/** Minimum armor bonus threshold heuristic for Heavy Armor when no item tag is present. */
export const HEAVY_ARMOR_BONUS_THRESHOLD = 6;

/** Minimum armor bonus threshold heuristic for Medium Armor when no item tag is present. */
export const MEDIUM_ARMOR_BONUS_THRESHOLD = 4;

/**
 * Resolves an entity's live situational tag context (armor category with Mithral reduction,
 * shield presence, metal composition, and load category) by inspecting live ECS equipment slots.
 *
 * @param state Current GameState.
 * @param entityId Entity ID to inspect.
 * @param dndData Current DnD35EntityData of the actor.
 * @returns SituationalTagContext with resolved categories.
 */
export function resolveEntitySituationalTagContext(
  state: GameState,
  entityId: EntityId,
  dndData: DnD35EntityData
): SituationalTagContext {
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  let armorCategory: 'none' | 'light' | 'medium' | 'heavy' | undefined;
  let hasShield = dndData.shieldBonus > 0;
  let isMetalArmorOrShield = false;

  if (equipment && Array.isArray(equipment.slots)) {
    for (const slot of equipment.slots) {
      if (slot.equippedItem === null || slot.suppressed === true) continue;
      const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
      const rawItemDef = itemComp
        ? (state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined)
        : undefined;
      if (!rawItemDef) continue;
      const itemDef = resolveEffectiveItemDefinition(rawItemDef, state.campaign.items, itemComp);

      const itemTags = itemDef.tags ?? [];
      const armorStats = itemDef.armorStats;
      const isMithral =
        itemDef.specialMaterial === 'mithral' || itemTags.includes('mithral') || itemTags.includes('material:mithral');

      if (armorStats) {
        if (armorStats.isMetal && itemDef.specialMaterial !== 'darkwood') {
          isMetalArmorOrShield = true;
        }
        if (armorStats.armorCategory === 'shield' || armorStats.armorCategory === 'tower_shield') {
          hasShield = true;
        } else {
          const effectiveCat = isMithral
            ? (computeMaterialEquipmentStats('mithral', armorStats.armorCategory).effectiveArmorCategory ??
              armorStats.armorCategory)
            : armorStats.armorCategory;
          if (effectiveCat === 'heavy') {
            armorCategory = 'heavy';
          } else if (effectiveCat === 'medium' && armorCategory !== 'heavy') {
            armorCategory = 'medium';
          } else if (effectiveCat === 'light' && !armorCategory) {
            armorCategory = 'light';
          }
        }
        continue;
      }

      if (itemTags.includes('metal') || itemTags.includes('armor_material:metal')) {
        isMetalArmorOrShield = true;
      }
      if (slot.slotType === 'off_hand' || itemTags.includes('shield')) {
        if ((itemDef.equippable?.defenseBonus ?? 0) > 0 || itemTags.includes('shield')) {
          hasShield = true;
        }
      }
      if (slot.slotType === 'torso' || slot.slotType === 'body' || (itemDef.equippable?.defenseBonus ?? 0) > 0) {
        const defBonus = itemDef.equippable?.defenseBonus ?? 0;
        let rawCat: 'light' | 'medium' | 'heavy' | undefined;
        if (
          itemTags.includes('armor:heavy') ||
          itemTags.includes('heavy_armor') ||
          defBonus >= HEAVY_ARMOR_BONUS_THRESHOLD
        ) {
          rawCat = 'heavy';
        } else if (
          itemTags.includes('armor:medium') ||
          itemTags.includes('medium_armor') ||
          defBonus >= MEDIUM_ARMOR_BONUS_THRESHOLD
        ) {
          rawCat = 'medium';
        } else if (defBonus >= 1 || itemTags.includes('armor:light') || itemTags.includes('light_armor')) {
          rawCat = 'light';
        }
        if (rawCat) {
          const effectiveCat = isMithral
            ? ((computeMaterialEquipmentStats('mithral', rawCat).effectiveArmorCategory as
                'light' | 'medium' | 'heavy') ?? rawCat)
            : rawCat;
          if (effectiveCat === 'heavy') armorCategory = 'heavy';
          else if (effectiveCat === 'medium' && armorCategory !== 'heavy') armorCategory = 'medium';
          else if (effectiveCat === 'light' && !armorCategory) armorCategory = 'light';
        }
      }
    }
  }

  if (!armorCategory) {
    armorCategory =
      dndData.armorBonus >= HEAVY_ARMOR_BONUS_THRESHOLD
        ? 'heavy'
        : dndData.armorBonus >= MEDIUM_ARMOR_BONUS_THRESHOLD
          ? 'medium'
          : dndData.armorBonus >= 1
            ? 'light'
            : 'none';
  }

  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;

  return {
    armorCategory,
    hasShield,
    isMetalArmorOrShield,
    loadCategory: 'light',
    ...(doctrine !== undefined ? { doctrine } : {})
  };
}
