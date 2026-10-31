import { rng } from '../../../core/rng.ts';
import { evaluateDiceExpression, rollD20 } from '../math/dice.ts';
import { combineAbstractMultipliers, dndFloor } from '../math/multipliers.ts';
import { getIterativeBabSequence } from '../progression.ts';
import type { CreatureSizeCategory } from '../types/dnd35e.types.ts';

/** Percentage roll modulus (`100`). */
const PERCENT_ROLL_MODULUS = 100;

/** Strength multiplier for a weapon wielded in two hands (`1.5x`). */
const TWO_HANDED_STR_MULTIPLIER = 1.5;

/** Strength multiplier for an off-hand or secondary natural weapon (`0.5x`). */
const OFF_HAND_STR_MULTIPLIER = 0.5;

/** Secondary natural weapon attack penalty without Multiattack (`-5`). */
const SECONDARY_NATURAL_PENALTY = -5;

/** Secondary natural weapon attack penalty with Multiattack feat (`-2`). */
const MULTIATTACK_SECONDARY_PENALTY = -2;

/** Input parameters for a single D&D 3.5e attack roll and critical confirmation. */
export interface AttackRollParams {
  readonly attackBonus: number;
  readonly targetAC: number;
  readonly weaponDice: string;
  readonly strModifier: number;
  readonly handedness: 'light' | 'one_handed' | 'two_handed' | 'off_hand' | 'primary_natural_sole';
  readonly flatDamageBonus: number;
  readonly critThreatMin: number;
  readonly critMultiplier: number;
  readonly extraCritMultipliers?: ReadonlyArray<number>;
  readonly bonusUnmultipliedDice?: ReadonlyArray<string>;
  readonly precisionDice?: ReadonlyArray<string>;
  readonly concealmentMissChancePercent?: 0 | 20 | 50;
  readonly hasBlindFight?: boolean;
  readonly targetImmuneToCrits?: boolean;
  readonly forcedAttackRoll?: number;
  readonly forcedConfirmRoll?: number;
}

/** Result of resolving a single attack roll, concealment check, and critical confirmation. */
export interface AttackResolutionResult {
  readonly missedDueToConcealment: boolean;
  readonly hit: boolean;
  readonly isThreat: boolean;
  readonly isCriticalConfirmed: boolean;
  readonly naturalAttackRoll: number;
  readonly totalAttackRoll: number;
  readonly confirmNaturalRoll?: number;
  readonly confirmTotalRoll?: number;
  readonly totalDamage: number;
  readonly baseMultipliedDamage: number;
  readonly unmultipliedExtraDamage: number;
}

/**
 * Computes the effective Strength damage bonus based on weapon handedness:
 * - Negative `STR` modifier is ALWAYS applied at `1.0x` (never `1.5x` or `0.5x`).
 * - Positive `STR` modifier is multiplied by `1.5x` (two-handed or sole primary natural weapon)
 *   or `0.5x` (off-hand or secondary natural weapon), floored.
 *
 * @param strModifier Raw Strength ability modifier.
 * @param handedness Weapon handedness category.
 * @returns Effective Strength bonus to damage.
 */
export function computeHandednessStrDamage(strModifier: number, handedness: AttackRollParams['handedness']): number {
  if (strModifier <= 0) {
    return strModifier;
  }
  switch (handedness) {
    case 'two_handed':
    case 'primary_natural_sole':
      return dndFloor(strModifier * TWO_HANDED_STR_MULTIPLIER);
    case 'off_hand':
      return dndFloor(strModifier * OFF_HAND_STR_MULTIPLIER);
    case 'light':
    case 'one_handed':
      return strModifier;
  }
}

/**
 * Resolves a single D&D 3.5e attack roll against a target AC (`Full`, `Touch`, or `Flat-Footed`):
 * 1. Rolls Concealment miss-chance % (re-rolling once on a miss if `hasBlindFight === true`).
 * 2. Rolls `1d20 + attackBonus` (Nat 1 = auto-miss, Nat 20 = auto-hit).
 * 3. Checks if `naturalAttackRoll >= critThreatMin` and hits AC; if so (and `!targetImmuneToCrits`),
 *    rolls a Critical Confirmation (`1d20 + attackBonus >= targetAC`).
 * 4. Multiplies base weapon dice + flat bonuses using `combineAbstractMultipliers`, while keeping
 *    elemental and precision dice unmultiplied (and stripping precision dice if concealment `> 0%`
 *    or `targetImmuneToCrits`).
 *
 * @param params Structured `AttackRollParams`.
 * @returns Complete `AttackResolutionResult`.
 */
export function resolveAttackRoll(params: AttackRollParams): AttackResolutionResult {
  const missChance = params.concealmentMissChancePercent ?? 0;
  if (missChance > 0) {
    const firstRoll = Math.floor(rng.getUniform() * PERCENT_ROLL_MODULUS) + 1;
    let missed = firstRoll <= missChance;
    if (missed && params.hasBlindFight === true) {
      const reroll = Math.floor(rng.getUniform() * PERCENT_ROLL_MODULUS) + 1;
      missed = reroll <= missChance;
    }
    if (missed) {
      return {
        missedDueToConcealment: true,
        hit: false,
        isThreat: false,
        isCriticalConfirmed: false,
        naturalAttackRoll: 0,
        totalAttackRoll: 0,
        totalDamage: 0,
        baseMultipliedDamage: 0,
        unmultipliedExtraDamage: 0
      };
    }
  }

  const atkRoll = rollD20('attack', params.attackBonus, params.forcedAttackRoll);
  const hit = !atkRoll.isAutoFailure && (atkRoll.isAutoSuccess || atkRoll.total >= params.targetAC);

  if (!hit) {
    return {
      missedDueToConcealment: false,
      hit: false,
      isThreat: false,
      isCriticalConfirmed: false,
      naturalAttackRoll: atkRoll.naturalRoll,
      totalAttackRoll: atkRoll.total,
      totalDamage: 0,
      baseMultipliedDamage: 0,
      unmultipliedExtraDamage: 0
    };
  }

  const isThreat = atkRoll.naturalRoll >= params.critThreatMin && params.targetImmuneToCrits !== true;
  let isCriticalConfirmed = false;
  let confirmNaturalRoll: number | undefined;
  let confirmTotalRoll: number | undefined;

  if (isThreat) {
    const confirmRoll = rollD20('attack', params.attackBonus, params.forcedConfirmRoll);
    confirmNaturalRoll = confirmRoll.naturalRoll;
    confirmTotalRoll = confirmRoll.total;
    isCriticalConfirmed =
      !confirmRoll.isAutoFailure && (confirmRoll.isAutoSuccess || confirmRoll.total >= params.targetAC);
  }

  const effectiveMultiplier = isCriticalConfirmed
    ? combineAbstractMultipliers([params.critMultiplier, ...(params.extraCritMultipliers ?? [])])
    : 1;

  const strDmg = computeHandednessStrDamage(params.strModifier, params.handedness);
  let baseMultipliedDamage = 0;
  for (let i = 0; i < effectiveMultiplier; i++) {
    const dieRoll = evaluateDiceExpression(params.weaponDice).total;
    baseMultipliedDamage += Math.max(1, dieRoll + strDmg + params.flatDamageBonus);
  }

  let unmultipliedExtraDamage = 0;
  for (const expr of params.bonusUnmultipliedDice ?? []) {
    unmultipliedExtraDamage += Math.max(0, evaluateDiceExpression(expr).total);
  }

  // Precision damage (Sneak Attack) is denied against any concealment or crit-immune target
  if (missChance === 0 && params.targetImmuneToCrits !== true) {
    for (const expr of params.precisionDice ?? []) {
      unmultipliedExtraDamage += Math.max(0, evaluateDiceExpression(expr).total);
    }
  }

  return {
    missedDueToConcealment: false,
    hit: true,
    isThreat,
    isCriticalConfirmed,
    naturalAttackRoll: atkRoll.naturalRoll,
    totalAttackRoll: atkRoll.total,
    ...(confirmNaturalRoll !== undefined ? { confirmNaturalRoll } : {}),
    ...(confirmTotalRoll !== undefined ? { confirmTotalRoll } : {}),
    totalDamage: Math.max(1, baseMultipliedDamage + unmultipliedExtraDamage),
    baseMultipliedDamage,
    unmultipliedExtraDamage
  };
}

/**
 * Builds the ordered attack bonus sequence for a `Full-Round Attack` combining primary
 * iterative attacks, Two-Weapon Fighting off-hand attack(s), and secondary natural weapons.
 *
 * @param options Full attack configuration.
 * @returns `{ primaryAttacks: ReadonlyArray<number>, offHandAttacks: ReadonlyArray<number>, naturalAttacks: ReadonlyArray<number> }`.
 */
export function buildFullAttackSequence(options: {
  readonly totalBab: number;
  readonly baseAttackModifier: number;
  readonly hasOffHandWeapon?: boolean;
  readonly offHandIsLight?: boolean;
  readonly hasTwoWeaponFightingFeat?: boolean;
  readonly secondaryNaturalCount?: number;
  readonly hasMultiattackFeat?: boolean;
}): {
  readonly primaryAttacks: ReadonlyArray<number>;
  readonly offHandAttacks: ReadonlyArray<number>;
  readonly naturalAttacks: ReadonlyArray<number>;
} {
  const iterBabs = getIterativeBabSequence(options.totalBab);
  let twfPrimaryPenalty = 0;
  let twfOffHandPenalty = 0;

  if (options.hasOffHandWeapon === true) {
    if (options.hasTwoWeaponFightingFeat === true) {
      twfPrimaryPenalty = options.offHandIsLight === true ? -2 : -4;
      twfOffHandPenalty = options.offHandIsLight === true ? -2 : -4;
    } else {
      twfPrimaryPenalty = options.offHandIsLight === true ? -4 : -6;
      twfOffHandPenalty = options.offHandIsLight === true ? -8 : -10;
    }
  }

  const nonBabMod = options.baseAttackModifier - options.totalBab;
  const primaryAttacks = iterBabs.map((b) => b + nonBabMod + twfPrimaryPenalty);
  const offHandAttacks = options.hasOffHandWeapon === true ? [options.totalBab + nonBabMod + twfOffHandPenalty] : [];

  const natPenalty = options.hasMultiattackFeat === true ? MULTIATTACK_SECONDARY_PENALTY : SECONDARY_NATURAL_PENALTY;
  const naturalAttacks: number[] = [];
  for (let i = 0; i < (options.secondaryNaturalCount ?? 0); i++) {
    naturalAttacks.push(options.totalBab + nonBabMod + natPenalty);
  }

  return {
    primaryAttacks,
    offHandAttacks,
    naturalAttacks
  };
}

/** Size multipliers for carrying capacity (bipedal). */
const BIPED_SIZE_CARRY_MULTIPLIER: Readonly<Record<CreatureSizeCategory, number>> = {
  fine: 0.125,
  diminutive: 0.25,
  tiny: 0.5,
  small: 0.75,
  medium: 1,
  large: 2,
  huge: 4,
  gargantuan: 8,
  colossal: 16
};

/** Base heavy load table for Strength 1–10 in pounds. */
const BASE_STR_HEAVY_LOAD: Readonly<Record<number, number>> = {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
  5: 50,
  6: 60,
  7: 70,
  8: 80,
  9: 90,
  10: 100,
  11: 115,
  12: 130,
  13: 150,
  14: 175,
  15: 200,
  16: 230,
  17: 260,
  18: 300,
  19: 350,
  20: 400
};

/**
 * Computes Light/Medium/Heavy carrying capacity thresholds and effective encumbrance constraints.
 *
 * @param strScore Effective Strength score ($\ge 1$).
 * @param sizeCategory Entity's `CreatureSizeCategory`.
 * @param carriedWeightLb Total weight carried in pounds.
 * @param baseSpeedFt Unencumbered tactical speed in feet (`30` or `20`).
 * @returns `{ loadTier: 'light' | 'medium' | 'heavy' | 'overloaded', maxDexBonus: number | undefined, acp: number, effectiveSpeedFt: number }`.
 */
export function computeEncumbranceState(
  strScore: number,
  sizeCategory: CreatureSizeCategory,
  carriedWeightLb: number,
  baseSpeedFt = 30
): {
  readonly loadTier: 'light' | 'medium' | 'heavy' | 'overloaded';
  readonly lightMaxLb: number;
  readonly mediumMaxLb: number;
  readonly heavyMaxLb: number;
  readonly maxDexBonus: number | undefined;
  readonly acp: number;
  readonly effectiveSpeedFt: number;
} {
  const clampedStr = Math.max(1, Math.min(20, dndFloor(strScore)));
  const baseHeavy = BASE_STR_HEAVY_LOAD[clampedStr] ?? 100;
  const sizeMult = BIPED_SIZE_CARRY_MULTIPLIER[sizeCategory];
  const heavyMaxLb = dndFloor(baseHeavy * sizeMult);
  const lightMaxLb = dndFloor(heavyMaxLb / 3);
  const mediumMaxLb = dndFloor((heavyMaxLb * 2) / 3);
  const reducedSpeed = baseSpeedFt === 30 ? 20 : 15;

  if (carriedWeightLb <= lightMaxLb) {
    return {
      loadTier: 'light',
      lightMaxLb,
      mediumMaxLb,
      heavyMaxLb,
      maxDexBonus: undefined,
      acp: 0,
      effectiveSpeedFt: baseSpeedFt
    };
  }
  if (carriedWeightLb <= mediumMaxLb) {
    return {
      loadTier: 'medium',
      lightMaxLb,
      mediumMaxLb,
      heavyMaxLb,
      maxDexBonus: 3,
      acp: -3,
      effectiveSpeedFt: reducedSpeed
    };
  }
  if (carriedWeightLb <= heavyMaxLb) {
    return {
      loadTier: 'heavy',
      lightMaxLb,
      mediumMaxLb,
      heavyMaxLb,
      maxDexBonus: 1,
      acp: -6,
      effectiveSpeedFt: reducedSpeed
    };
  }
  return {
    loadTier: 'overloaded',
    lightMaxLb,
    mediumMaxLb,
    heavyMaxLb,
    maxDexBonus: 0,
    acp: -6,
    effectiveSpeedFt: 5
  };
}
