import { rng } from '../../../core/rng.ts';
import { evaluateDiceExpression, rollD20 } from '../math/dice.ts';
import { combineAbstractMultipliers, dndFloor } from '../math/multipliers.ts';

/** Percentage roll modulus (`100`). */
const PERCENT_ROLL_MODULUS = 100;

/** Strength multiplier for a weapon wielded in two hands (`1.5x`). */
const TWO_HANDED_STR_MULTIPLIER = 1.5;

/** Strength multiplier for an off-hand or secondary natural weapon (`0.5x`). */
const OFF_HAND_STR_MULTIPLIER = 0.5;

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
