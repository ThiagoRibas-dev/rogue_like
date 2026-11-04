import type { TacticalDoctrineComponent } from '../../../types/components.types.ts';
import { dndFloor } from '../math/multipliers.ts';
import type { CreatureSizeCategory } from '../types/dnd35e.types.ts';
import type { AttackRollParams } from './attack_roll.ts';

/** Minimum whole ranks in Tumble required for enhanced defensive fighting (+3 / +6 Dodge AC). */
const TUMBLE_SYNERGY_MIN_RANKS = 5;

const FIXED_CAP_FIVE = 5;

/**
 * Declarative descriptor for a variable doctrine dial (e.g., Power Attack, Combat Expertise).
 */
export interface TacticalDialDescriptor {
  readonly abilityId: string;
  readonly name?: string | undefined;
  readonly min: number;
  readonly maxCapRule: 'bab' | 'fixed_5' | 'class_level';
  readonly attackDeltaPerPoint: number;
  readonly damageDeltaPerPoint: number;
  readonly acDeltaPerPoint: number;
  readonly twoHandedMultiplier?: number | undefined;
  readonly legacyPropertyKey?: 'powerAttackAmount' | 'combatExpertiseAmount' | undefined;
}

/** Canonical fallback doctrine dials for SRD feats. */
export const CANONICAL_TACTICAL_DIALS: ReadonlyArray<TacticalDialDescriptor> = [
  {
    abilityId: 'power_attack',
    name: 'Power Attack',
    min: 0,
    maxCapRule: 'bab',
    attackDeltaPerPoint: -1,
    damageDeltaPerPoint: 1,
    acDeltaPerPoint: 0,
    twoHandedMultiplier: 2,
    legacyPropertyKey: 'powerAttackAmount'
  },
  {
    abilityId: 'combat_expertise',
    name: 'Combat Expertise',
    min: 0,
    maxCapRule: 'fixed_5',
    attackDeltaPerPoint: -1,
    damageDeltaPerPoint: 0,
    acDeltaPerPoint: 1,
    legacyPropertyKey: 'combatExpertiseAmount'
  }
];

/**
 * Evaluates attack roll and damage/AC adjustments resulting from active tactical doctrines
 * (Power Attack, Combat Expertise, Fighting Defensively, Total Defense), including 5-rank
 * Tumble synergy (`+3` Dodge AC when Fighting Defensively, `+6` Dodge AC in Total Defense).
 */
export function evaluateTacticalDoctrineModifiers(
  doctrine: TacticalDoctrineComponent,
  bab: number,
  handedness: 'light' | 'one_handed' | 'two_handed',
  tumbleRanks = 0,
  customDials?: ReadonlyArray<TacticalDialDescriptor>
): {
  readonly attackPenalty: number;
  readonly damageBonus: number;
  readonly dodgeAcBonus: number;
  readonly canAttack: boolean;
} {
  const hasTumbleSynergy = dndFloor(tumbleRanks) >= TUMBLE_SYNERGY_MIN_RANKS;

  if (doctrine.totalDefense === true) {
    return {
      attackPenalty: 0,
      damageBonus: 0,
      dodgeAcBonus: hasTumbleSynergy ? 6 : 4,
      canAttack: false
    };
  }

  let attackPenalty = 0;
  let damageBonus = 0;
  let dodgeAcBonus = 0;

  const dials = customDials ?? CANONICAL_TACTICAL_DIALS;
  for (const dial of dials) {
    let dialValue = 0;
    if (doctrine.settings) {
      const settingVal = doctrine.settings[dial.abilityId] ?? doctrine.settings[`${dial.abilityId}_dial`];
      if (typeof settingVal === 'number') dialValue = settingVal;
    }
    if (dialValue === 0 && dial.legacyPropertyKey !== undefined) {
      const legacyVal = doctrine[dial.legacyPropertyKey];
      if (typeof legacyVal === 'number') dialValue = legacyVal;
    }

    if (dialValue > 0) {
      let maxCap = bab;
      if (dial.maxCapRule === 'fixed_5') maxCap = Math.min(FIXED_CAP_FIVE, bab);
      const clamped = Math.max(dial.min, Math.min(dialValue, maxCap));
      if (clamped > 0) {
        if (dial.attackDeltaPerPoint !== 0) attackPenalty += clamped * Math.abs(dial.attackDeltaPerPoint);
        if (dial.acDeltaPerPoint > 0) dodgeAcBonus += clamped * dial.acDeltaPerPoint;
        if (dial.damageDeltaPerPoint > 0) {
          if (handedness === 'two_handed') {
            damageBonus += clamped * dial.damageDeltaPerPoint * (dial.twoHandedMultiplier ?? 2);
          } else if (handedness !== 'light') {
            damageBonus += clamped * dial.damageDeltaPerPoint;
          }
        }
      }
    }
  }

  if (doctrine.fightingDefensively === true) {
    attackPenalty += 4;
    dodgeAcBonus += hasTumbleSynergy ? 3 : 2;
  }

  return {
    attackPenalty: -attackPenalty,
    damageBonus,
    dodgeAcBonus,
    canAttack: true
  };
}

/**
 * Computes the doctrine damage bonus (e.g., Power Attack) specifically for an individual strike
 * based on its handedness and whether it is a manufactured vs. natural/unarmed attack.
 */
export function computeStrikeDoctrineDamageBonus(
  doctrine: TacticalDoctrineComponent | undefined,
  bab: number,
  strikeHandedness: AttackRollParams['handedness'],
  isNaturalOrUnarmed: boolean,
  cannotTwoHandStr?: boolean,
  customDials?: ReadonlyArray<TacticalDialDescriptor>
): number {
  if (!doctrine) return 0;
  const dials = customDials ?? CANONICAL_TACTICAL_DIALS;
  let totalDmgBonus = 0;

  for (const dial of dials) {
    if (dial.damageDeltaPerPoint <= 0) continue;
    let dialValue = 0;
    if (doctrine.settings) {
      const settingVal = doctrine.settings[dial.abilityId] ?? doctrine.settings[`${dial.abilityId}_dial`];
      if (typeof settingVal === 'number') dialValue = settingVal;
    }
    if (dialValue === 0 && dial.legacyPropertyKey !== undefined) {
      const legacyVal = doctrine[dial.legacyPropertyKey];
      if (typeof legacyVal === 'number') dialValue = legacyVal;
    }
    if (dialValue <= 0) continue;

    let maxCap = bab;
    if (dial.maxCapRule === 'fixed_5') maxCap = Math.min(FIXED_CAP_FIVE, bab);
    const clamped = Math.max(dial.min, Math.min(dialValue, maxCap));
    if (clamped <= 0) continue;

    if (!isNaturalOrUnarmed && (strikeHandedness === 'light' || strikeHandedness === 'off_hand')) {
      continue;
    }

    if (strikeHandedness === 'two_handed' || strikeHandedness === 'primary_natural_sole') {
      totalDmgBonus += cannotTwoHandStr
        ? clamped * dial.damageDeltaPerPoint
        : clamped * dial.damageDeltaPerPoint * (dial.twoHandedMultiplier ?? 2);
    } else {
      totalDmgBonus += clamped * dial.damageDeltaPerPoint;
    }
  }

  return totalDmgBonus;
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

/** Base heavy load table for Strength 1–20 in pounds. */
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
