import type {
  ACBreakdownDTO,
  BonusType,
  CreatureSizeCategory,
  StatModifier,
  StatQueryContext
} from './types/dnd35e.types.ts';
import { matchesEntityTagCondition } from '../../systems/reaction.system.ts';

/** Base Armor Class before modifiers in D&D 3.5e (`10`). */
export const DND35E_BASE_AC = 10;

/** Size modifiers to Armor Class and Attack Rolls across all 9 creature sizes. */
export const SIZE_AC_AND_ATTACK_MODIFIERS: Readonly<Record<CreatureSizeCategory, number>> = {
  fine: 8,
  diminutive: 4,
  tiny: 2,
  small: 1,
  medium: 0,
  large: -1,
  huge: -2,
  gargantuan: -4,
  colossal: -8
};

/**
 * Checks if a modifier origin is suppressed inside an Antimagic Field (`su`, `sp`, `spell`, `magical`).
 *
 * @param modifier The `StatModifier` to test.
 * @returns True if suppressed by Antimagic Field.
 */
function isSuppressedByAntimagic(modifier: StatModifier): boolean {
  if (modifier.origin === undefined) return false;
  switch (modifier.origin) {
    case 'magical':
    case 'spell':
    case 'sp':
    case 'su':
      return true;
    case 'ex':
    case 'mundane':
      return false;
  }
}

/**
 * Checks if a bonus type is a physical armor/shield/natural armor type ignored by Touch Attacks.
 *
 * @param bonusType The `BonusType` to check.
 * @returns True if ignored by Touch AC.
 */
function isArmorOrNaturalBonus(bonusType: BonusType): boolean {
  switch (bonusType) {
    case 'armor':
    case 'armor_enhancement':
    case 'shield':
    case 'shield_enhancement':
    case 'natural_armor':
    case 'natural_armor_enhancement':
      return true;
    default:
      return false;
  }
}

/**
 * Resolves a list of `StatModifier` entries according to the D&D 3.5e 18-type Bonus Stacking Matrix:
 * - Filters out `magical`/`spell`/`sp`/`su` modifiers when `context.inAntimagicField === true`.
 * - Folds `armor_enhancement`, `shield_enhancement`, and `natural_armor_enhancement` into the
 *   best base `armor`, `shield`, and `natural_armor` bonuses.
 * - Positive `dodge` bonuses (unless `ignorePositiveDexAndDodge === true`), `untyped` bonuses,
 *   and `circumstance` bonuses from distinct `sourceId`s stack additively.
 * - All other positive bonus types take only `Math.max` per `BonusType`.
 * - All penalties (`value < 0`) stack additively regardless of type.
 *
 * @param modifiers Candidate `StatModifier` entries for the target stat.
 * @param context Optional query context (`inAntimagicField`, `ignoreArmorAndNatural`, etc.).
 * @returns Net resolved integer modifier sum.
 */
export function resolveTypedModifiers(modifiers: ReadonlyArray<StatModifier>, context?: StatQueryContext): number {
  const inAntimagic = context?.inAntimagicField === true;
  const ignoreArmor = context?.ignoreArmorAndNatural === true;
  const ignoreDodge = context?.ignorePositiveDexAndDodge === true;

  let penaltySum = 0;
  let dodgeSum = 0;
  let untypedSum = 0;
  const circumstanceBySource: Record<string, number> = {};
  const maxByNonStackingType: Partial<Record<BonusType, number>> = {};

  for (const mod of modifiers) {
    if (inAntimagic && isSuppressedByAntimagic(mod)) {
      continue;
    }
    if (ignoreArmor && isArmorOrNaturalBonus(mod.bonusType)) {
      continue;
    }
    if (mod.condition && !matchesEntityTagCondition(mod.condition, context?.targetTags, context?.effectTags)) {
      continue;
    }

    if (mod.value < 0) {
      penaltySum += mod.value;
      continue;
    }

    if (mod.value === 0) {
      continue;
    }

    if (mod.bonusType === 'dodge') {
      if (!ignoreDodge) {
        dodgeSum += mod.value;
      }
      continue;
    }

    if (mod.bonusType === 'untyped') {
      untypedSum += mod.value;
      continue;
    }

    if (mod.bonusType === 'circumstance') {
      const prev = circumstanceBySource[mod.sourceId] ?? 0;
      if (mod.value > prev) {
        circumstanceBySource[mod.sourceId] = mod.value;
      }
      continue;
    }

    const prevMax = maxByNonStackingType[mod.bonusType] ?? 0;
    if (mod.value > prevMax) {
      maxByNonStackingType[mod.bonusType] = mod.value;
    }
  }

  // Fold compound enhancement bonuses into their parent armor/shield/natural_armor category
  const armorTotal = (maxByNonStackingType.armor ?? 0) + (maxByNonStackingType.armor_enhancement ?? 0);
  const shieldTotal = (maxByNonStackingType.shield ?? 0) + (maxByNonStackingType.shield_enhancement ?? 0);
  const naturalTotal =
    (maxByNonStackingType.natural_armor ?? 0) + (maxByNonStackingType.natural_armor_enhancement ?? 0);

  let nonStackingSum = armorTotal + shieldTotal + naturalTotal;
  const skipKeys: ReadonlyArray<BonusType> = [
    'armor',
    'armor_enhancement',
    'shield',
    'shield_enhancement',
    'natural_armor',
    'natural_armor_enhancement'
  ];

  for (const [key, val] of Object.entries(maxByNonStackingType)) {
    if (!skipKeys.includes(key as BonusType) && val !== undefined) {
      nonStackingSum += val;
    }
  }

  let circumstanceSum = 0;
  for (const val of Object.values(circumstanceBySource)) {
    circumstanceSum += val;
  }

  return nonStackingSum + dodgeSum + untypedSum + circumstanceSum + penaltySum;
}

/** Alias for resolveTypedModifiers. */
export const resolveStatModifiers = resolveTypedModifiers;

/**
 * Computes the Contextual Armor Class Triplet (`fullAC`, `touchAC`, `flatFootedAC`)
 * for an entity given its Dexterity modifier, size category, and active AC modifiers.
 *
 * @param dexModifier Raw Dexterity ability modifier.
 * @param sizeCategory Entity's 9-tier `CreatureSizeCategory`.
 * @param acModifiers Array of `StatModifier` entries targeting `'ac'`.
 * @param options Optional `{ maxDexBonus?, hasUncannyDodge?, inAntimagicField? }`.
 * @returns Complete `ACBreakdownDTO`.
 */
export function computeEffectiveAC(
  dexModifier: number,
  sizeCategory: CreatureSizeCategory,
  acModifiers: ReadonlyArray<StatModifier>,
  options?: {
    readonly maxDexBonus?: number;
    readonly hasUncannyDodge?: boolean;
    readonly inAntimagicField?: boolean;
  }
): ACBreakdownDTO {
  const effectiveDexMod = options?.maxDexBonus !== undefined ? Math.min(dexModifier, options.maxDexBonus) : dexModifier;
  const sizeMod = SIZE_AC_AND_ATTACK_MODIFIERS[sizeCategory];
  const inAntimagicField = options?.inAntimagicField === true;
  const hasUncannyDodge = options?.hasUncannyDodge === true;

  const fullMods = resolveTypedModifiers(acModifiers, { inAntimagicField });
  const touchMods = resolveTypedModifiers(acModifiers, {
    inAntimagicField,
    ignoreArmorAndNatural: true
  });
  const flatFootedMods = resolveTypedModifiers(acModifiers, {
    inAntimagicField,
    ignorePositiveDexAndDodge: !hasUncannyDodge
  });

  const flatFootedDex = hasUncannyDodge ? effectiveDexMod : Math.min(0, effectiveDexMod);

  return {
    fullAC: DND35E_BASE_AC + effectiveDexMod + sizeMod + fullMods,
    touchAC: DND35E_BASE_AC + effectiveDexMod + sizeMod + touchMods,
    flatFootedAC: DND35E_BASE_AC + flatFootedDex + sizeMod + flatFootedMods,
    baseAC: DND35E_BASE_AC,
    dexContribution: effectiveDexMod,
    sizeContribution: sizeMod,
    modifierTotal: fullMods
  };
}
