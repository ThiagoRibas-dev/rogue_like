import type { ItemDefinition } from '../../types/campaign/item.ts';
import { rollD20 } from './math/dice.ts';
import { dndFloor } from './math/multipliers.ts';
import { SIZE_METRICS } from './spatial/grid_geometry.ts';
import type { CreatureSizeCategory } from './types/dnd35e.types.ts';

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
 * Computes the exact mechanical stat adjustments for an item crafted from a Special Material
 * (Mithral armor category step reduction, Max Dex +2, ACP -3, ASF -10%; Adamantine innate DR 1/-/2/-/3/-;
 * Alchemical Silver -1 weapon damage penalty; Darkwood ACP -2).
 *
 * @param material Special material type.
 * @param armorCategory Optional base armor category if the item is armor or a shield.
 * @returns MaterialEquipmentAdjustments descriptor.
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
        acpReduction: 1, // Masterwork component included in Adamantine
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
 * Applies special material physics and rules modifications to an item definition:
 * - Mithral: Reduces armor category by one step (heavy -> medium, medium -> light); increases max Dex bonus by +2;
 *   reduces Armor Check Penalty by 3 (min 0); halves item weight; reduces arcane spell failure by 10%.
 * - Adamantine: Weapons bypass hardness < 20 and overcome DR/adamantine. Suits of armor grant Damage Reduction
 *   (DR 1/- for light, DR 2/- for medium, DR 3/- for heavy).
 * - Silver (Alchemical Silver): Overcomes DR/silver; weapons suffer a -1 penalty to damage rolls (min 1).
 * - Cold Iron: Overcomes DR/cold_iron without damage penalty.
 * - Darkwood: Halves weight of wooden items/shields; reduces Armor Check Penalty by 2 (min 0).
 *
 * @param baseItem Base item definition from campaign registry.
 * @param material Special material type to apply.
 * @returns Modified immutable ItemDefinition.
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

/**
 * Ordered progression ladder of standard D&D 3.5e weapon damage dice across 9 creature sizes.
 * Based on PHB p. 114 Table 7-4: Tiny and Large Weapon Damage.
 */
const DICE_PROGRESSION_LADDER: ReadonlyArray<string> = [
  '1',
  '1d2',
  '1d3',
  '1d4',
  '1d6',
  '1d8',
  '2d6',
  '3d6',
  '4d6',
  '6d6',
  '8d6',
  '12d6'
];

const ALTERNATE_DICE_LADDER_D8: ReadonlyArray<string> = [
  '1',
  '1d2',
  '1d3',
  '1d4',
  '1d6',
  '1d8',
  '2d6',
  '2d8',
  '3d8',
  '4d8',
  '6d8',
  '8d8',
  '12d8'
];

const ALTERNATE_DICE_LADDER_D10: ReadonlyArray<string> = [
  '1d2',
  '1d3',
  '1d4',
  '1d6',
  '1d8',
  '1d10',
  '2d8',
  '3d8',
  '4d8',
  '6d8',
  '8d8'
];

const ALTERNATE_DICE_LADDER_D12: ReadonlyArray<string> = [
  '1d3',
  '1d4',
  '1d6',
  '1d8',
  '1d10',
  '1d12',
  '3d6',
  '4d6',
  '6d6',
  '8d6',
  '12d6'
];

/**
 * Scales a weapon's base damage dice from a base creature size to a target creature size.
 *
 * @param baseDice Starting damage dice (e.g. "1d6", "1d8", "2d6").
 * @param baseSize Size category the weapon was authored for (usually 'medium').
 * @param targetSize Target creature size category.
 * @returns Scaled damage dice expression.
 */
export function scaleWeaponDamageDice(
  baseDice: string,
  baseSize: CreatureSizeCategory,
  targetSize: CreatureSizeCategory
): string {
  if (baseSize === targetSize) return baseDice;

  const baseRank = SIZE_METRICS[baseSize].rankIndex;
  const targetRank = SIZE_METRICS[targetSize].rankIndex;
  const stepDiff = targetRank - baseRank;

  // Pick ladder
  let ladder = DICE_PROGRESSION_LADDER;
  if (baseDice === '1d8') ladder = ALTERNATE_DICE_LADDER_D8;
  else if (baseDice === '1d10') ladder = ALTERNATE_DICE_LADDER_D10;
  else if (baseDice === '1d12') ladder = ALTERNATE_DICE_LADDER_D12;

  const index = ladder.indexOf(baseDice);
  if (index === -1) {
    return baseDice; // If not in standard ladder, preserve original expression
  }

  const newIndex = Math.max(0, Math.min(ladder.length - 1, index + stepDiff));
  return ladder[newIndex]!;
}

/**
 * Evaluates whether a creature of size `wielderSize` can wield a weapon of size `weaponSize`,
 * applying the -2 attack roll penalty per size category difference and shifting effort categories.
 * (PHB p. 113: Inappropriately Sized Weapons).
 *
 * @param weaponSize Size category for which the weapon was made.
 * @param weaponHandedness Natural handedness of the weapon ('light', 'one_handed', 'two_handed').
 * @param wielderSize Size category of the creature attempting to wield it.
 * @returns Object with wieldability, shifted effective handedness, and attack penalty.
 */
export function evaluateWeaponWieldingProfile(
  weaponSize: CreatureSizeCategory,
  weaponHandedness: 'light' | 'one_handed' | 'two_handed',
  wielderSize: CreatureSizeCategory
): {
  readonly wieldable: boolean;
  readonly effectiveHandedness?: 'light' | 'one_handed' | 'two_handed' | undefined;
  readonly attackPenalty: number;
  readonly reason?: string | undefined;
} {
  const wSizeRank = SIZE_METRICS[weaponSize].rankIndex;
  const cSizeRank = SIZE_METRICS[wielderSize].rankIndex;
  const stepDiff = wSizeRank - cSizeRank; // positive if weapon is larger than wielder

  if (stepDiff === 0) {
    return {
      wieldable: true,
      effectiveHandedness: weaponHandedness,
      attackPenalty: 0
    };
  }

  const attackPenalty = -Math.abs(stepDiff) * 2;

  // If size difference is greater than 1 step, weapon is fundamentally too large or small
  if (Math.abs(stepDiff) > 1) {
    return {
      wieldable: false,
      attackPenalty,
      reason: `Weapon size difference (${Math.abs(stepDiff)} steps) exceeds 1 step limit.`
    };
  }

  // Weapon is 1 step larger than wielder
  if (stepDiff === 1) {
    if (weaponHandedness === 'light') {
      return { wieldable: true, effectiveHandedness: 'one_handed', attackPenalty };
    }
    if (weaponHandedness === 'one_handed') {
      return { wieldable: true, effectiveHandedness: 'two_handed', attackPenalty };
    }
    // A two-handed weapon 1 step larger cannot be wielded
    return {
      wieldable: false,
      attackPenalty,
      reason: 'Two-handed weapon of a larger size category cannot be wielded.'
    };
  }

  // Weapon is 1 step smaller than wielder (stepDiff === -1)
  if (weaponHandedness === 'two_handed') {
    return { wieldable: true, effectiveHandedness: 'one_handed', attackPenalty };
  }
  if (weaponHandedness === 'one_handed') {
    return { wieldable: true, effectiveHandedness: 'light', attackPenalty };
  }

  // Light weapon 1 step smaller is wielded as light
  return { wieldable: true, effectiveHandedness: 'light', attackPenalty };
}

/**
 * Resolves magic item activation across the 4 canonical D&D 3.5e activation modes (DMG p. 213):
 * - `use_activated`: Drinking a potion, swinging a magic sword, wearing a ring. No skill check required.
 * - `command_word`: Speaking a word. Standard action, no check needed.
 * - `spell_trigger`: Wands and staves. Requires spell on class spell list. If not, requires UMD DC 20.
 * - `spell_completion`: Scrolls. Requires spell on class spell list. If not, requires UMD DC (20 + spellLevel).
 *
 * @param activationType One of the 4 canonical activation modes.
 * @param userHasSpellOnList Whether the user has the spell on their class spell list.
 * @param options Additional DC, UMD skill bonus, and forced roll options.
 * @returns Activation result descriptor.
 */
export function resolveMagicItemActivation(
  activationType: 'use_activated' | 'command_word' | 'spell_completion' | 'spell_trigger',
  userHasSpellOnList: boolean,
  options?: {
    readonly userUmdModifier?: number | undefined;
    readonly spellLevel?: number | undefined;
    readonly casterLevel?: number | undefined;
    readonly scrollCasterLevel?: number | undefined;
    readonly forcedUmdRoll?: number | undefined;
  }
): {
  readonly activated: boolean;
  readonly dc?: number | undefined;
  readonly checkTotal?: number | undefined;
  readonly failureReason?: string | undefined;
} {
  if (activationType === 'use_activated' || activationType === 'command_word') {
    return { activated: true };
  }

  // If user has the spell on their class spell list:
  if (userHasSpellOnList) {
    if (activationType === 'spell_trigger') {
      return { activated: true };
    }

    // For spell_completion (scrolls), check if caster level is sufficient
    const userCl = options?.casterLevel ?? 1;
    const scrollCl = options?.scrollCasterLevel ?? 1;
    if (userCl >= scrollCl) {
      return { activated: true };
    }

    // Caster level check required: 1d20 + userCl >= scrollCl + 1
    const clRoll = rollD20('caster_level_check', userCl, options?.forcedUmdRoll);
    const clDc = scrollCl + 1;
    if (clRoll.total >= clDc) {
      return { activated: true, dc: clDc, checkTotal: clRoll.total };
    }
    return {
      activated: false,
      dc: clDc,
      checkTotal: clRoll.total,
      failureReason: 'caster_level_check_failed'
    };
  }

  // User does NOT have spell on class list: Use Magic Device check required
  const umdMod = options?.userUmdModifier ?? 0;
  const dc = activationType === 'spell_trigger' ? 20 : 20 + (options?.spellLevel ?? 1);
  const umdRoll = rollD20('skill_check', umdMod, options?.forcedUmdRoll);

  if (umdRoll.total >= dc) {
    return { activated: true, dc, checkTotal: umdRoll.total };
  }

  return {
    activated: false,
    dc,
    checkTotal: umdRoll.total,
    failureReason: 'use_magic_device_check_failed'
  };
}
