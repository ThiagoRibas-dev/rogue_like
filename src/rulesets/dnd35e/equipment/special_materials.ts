import type { ItemDefinition } from '../../../types/campaign/item.ts';
import { dndFloor } from '../math/multipliers.ts';

/**
 * Canonical D&D 3.5e Special Material types from the Dungeon Master's Guide.
 */
export type SpecialMaterialType = 'mithral' | 'adamantine' | 'silver' | 'cold_iron' | 'darkwood';

/**
 * Armor weight categories used for Mithral category reduction and Adamantine innate DR.
 */
export type ArmorWeightCategory = 'light' | 'medium' | 'heavy' | 'shield';

/**
 * Computed mechanical adjustments granted by a special material (PRIM-5.1 / DMG p. 283-284).
 */
export interface MaterialEquipmentAdjustments {
  readonly effectiveArmorCategory?: ArmorWeightCategory | undefined;
  readonly maxDexBonusDelta: number;
  readonly acpReduction: number;
  readonly asfReductionPercent: number;
  readonly grantedDrAmount: number;
  readonly weaponDamagePenalty: number;
  readonly ignoresHardnessBelow: number;
  readonly weightMultiplier: number;
}

const MITHRAL_MAX_DEX_BONUS_DELTA = 2;
const MITHRAL_ACP_REDUCTION = 3;
const MITHRAL_ASF_REDUCTION_PERCENT = 10;
const DARKWOOD_ACP_REDUCTION = 2;
const HALF_WEIGHT_MULTIPLIER = 0.5;
const FULL_WEIGHT_MULTIPLIER = 1.0;
const ADAMANTINE_HARDNESS_THRESHOLD = 20;
const ADAMANTINE_LIGHT_DR = 1;
const ADAMANTINE_MEDIUM_DR = 2;
const ADAMANTINE_HEAVY_DR = 3;
const SILVER_WEAPON_DAMAGE_PENALTY = 1;

/**
 * Computes the exact mechanical stat adjustments for an item crafted from a Special Material.
 */
export function computeMaterialEquipmentStats(
  material: SpecialMaterialType,
  armorCategory?: ArmorWeightCategory
): MaterialEquipmentAdjustments {
  switch (material) {
    case 'mithral': {
      let effectiveCategory = armorCategory;
      if (armorCategory === 'heavy') {
        effectiveCategory = 'medium';
      } else if (armorCategory === 'medium') {
        effectiveCategory = 'light';
      }
      return {
        ...(effectiveCategory !== undefined ? { effectiveArmorCategory: effectiveCategory } : {}),
        maxDexBonusDelta: MITHRAL_MAX_DEX_BONUS_DELTA,
        acpReduction: MITHRAL_ACP_REDUCTION,
        asfReductionPercent: MITHRAL_ASF_REDUCTION_PERCENT,
        grantedDrAmount: 0,
        weaponDamagePenalty: 0,
        ignoresHardnessBelow: 0,
        weightMultiplier: HALF_WEIGHT_MULTIPLIER
      };
    }

    case 'adamantine': {
      let dr = 0;
      if (armorCategory === 'light') dr = ADAMANTINE_LIGHT_DR;
      else if (armorCategory === 'medium') dr = ADAMANTINE_MEDIUM_DR;
      else if (armorCategory === 'heavy') dr = ADAMANTINE_HEAVY_DR;

      return {
        ...(armorCategory !== undefined ? { effectiveArmorCategory: armorCategory } : {}),
        maxDexBonusDelta: 0,
        acpReduction: 1,
        asfReductionPercent: 0,
        grantedDrAmount: dr,
        weaponDamagePenalty: 0,
        ignoresHardnessBelow: ADAMANTINE_HARDNESS_THRESHOLD,
        weightMultiplier: FULL_WEIGHT_MULTIPLIER
      };
    }

    case 'silver':
      return {
        ...(armorCategory !== undefined ? { effectiveArmorCategory: armorCategory } : {}),
        maxDexBonusDelta: 0,
        acpReduction: 0,
        asfReductionPercent: 0,
        grantedDrAmount: 0,
        weaponDamagePenalty: SILVER_WEAPON_DAMAGE_PENALTY,
        ignoresHardnessBelow: 0,
        weightMultiplier: FULL_WEIGHT_MULTIPLIER
      };

    case 'cold_iron':
      return {
        ...(armorCategory !== undefined ? { effectiveArmorCategory: armorCategory } : {}),
        maxDexBonusDelta: 0,
        acpReduction: 0,
        asfReductionPercent: 0,
        grantedDrAmount: 0,
        weaponDamagePenalty: 0,
        ignoresHardnessBelow: 0,
        weightMultiplier: FULL_WEIGHT_MULTIPLIER
      };

    case 'darkwood':
      return {
        ...(armorCategory !== undefined ? { effectiveArmorCategory: armorCategory } : {}),
        maxDexBonusDelta: 0,
        acpReduction: DARKWOOD_ACP_REDUCTION,
        asfReductionPercent: 0,
        grantedDrAmount: 0,
        weaponDamagePenalty: 0,
        ignoresHardnessBelow: 0,
        weightMultiplier: HALF_WEIGHT_MULTIPLIER
      };
  }
}

/**
 * Applies special material physics and rules modifications to an item definition.
 */
export function applyMaterialPhysics(baseItem: ItemDefinition, material: SpecialMaterialType): ItemDefinition {
  const existingTags = baseItem.tags ?? [];
  const nextTags = Array.from(new Set([...existingTags, material, `material:${material}`]));
  let nextWeight = baseItem.weight;
  const nextEquippable = baseItem.equippable ? { ...baseItem.equippable } : undefined;

  switch (material) {
    case 'mithral':
      nextWeight = Math.max(1, dndFloor(baseItem.weight * HALF_WEIGHT_MULTIPLIER));
      nextTags.push('bypass:silver', 'mithral_acp_reduce:3', 'mithral_max_dex_add:2', 'mithral_asf_reduce:10');
      break;

    case 'adamantine':
      nextTags.push('bypass:adamantine', 'bypass:hardness_20');
      break;

    case 'silver':
      nextTags.push('bypass:silver');
      if (baseItem.category === 'weapon') {
        nextTags.push('weapon_damage_penalty:1');
      }
      break;

    case 'cold_iron':
      nextTags.push('bypass:cold_iron');
      break;

    case 'darkwood':
      nextWeight = Math.max(1, dndFloor(baseItem.weight * HALF_WEIGHT_MULTIPLIER));
      nextTags.push('darkwood_acp_reduce:2');
      break;
  }

  return {
    ...baseItem,
    weight: nextWeight,
    tags: nextTags,
    ...(nextEquippable !== undefined ? { equippable: nextEquippable } : {})
  };
}
