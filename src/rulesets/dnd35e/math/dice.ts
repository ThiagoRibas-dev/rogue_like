import { rng } from '../../../core/rng.ts';
import type { D20RollMode, D20RollResult, DiceRollResult } from '../types/dnd35e.types.ts';

/** Standard number of sides on a d20 die. */
const D20_SIDES = 20;

/** Natural roll value that triggers automatic failure on attacks and saves. */
const NATURAL_ONE = 1;

/** Natural roll value that triggers automatic success on attacks and saves. */
const NATURAL_TWENTY = 20;

/** Regular expression matching `NdX`, `NdXkhK`, and optional `+C` / `-C` modifier. */
const DICE_EXPRESSION_REGEX = /^(\d+)d(\d+)(?:kh(\d+))?(?:([+-])(\d+))?$/i;

/**
 * Rolls a single die with `sides` faces deterministically using the shared engine RNG.
 *
 * @param sides Number of faces on the die (must be >= 1).
 * @returns Integer roll in `[1, sides]`.
 */
export function rollSingleDie(sides: number): number {
  if (sides <= 1) return 1;
  return Math.floor(rng.getUniform() * sides) + 1;
}

/**
 * Evaluates a D&D 3.5e dice expression such as `"1d8+3"`, `"2d6"`, or `"4d6kh3"`
 * using the deterministic engine PRNG (`src/core/rng.ts`).
 *
 * @param expression Dice notation string (e.g. `"1d8+2"`, `"4d6kh3"`).
 * @returns Full breakdown of raw rolls, kept rolls, flat modifier, and total.
 */
export function evaluateDiceExpression(expression: string): DiceRollResult {
  const normalized = expression.replace(/\s+/g, '');
  const match = DICE_EXPRESSION_REGEX.exec(normalized);
  if (!match) {
    const parsedConstant = Number.parseInt(normalized, 10);
    const flatVal = Number.isNaN(parsedConstant) ? 0 : parsedConstant;
    return {
      expression: normalized,
      total: flatVal,
      rolls: [],
      keptRolls: [],
      flatModifier: flatVal
    };
  }

  const count = Number.parseInt(match[1] ?? '1', 10);
  const sides = Number.parseInt(match[2] ?? '6', 10);
  const keepHighestRaw = match[3] !== undefined ? Number.parseInt(match[3], 10) : count;
  const sign = match[4] === '-' ? -1 : 1;
  const flatMagnitude = match[5] !== undefined ? Number.parseInt(match[5], 10) : 0;
  const flatModifier = sign * flatMagnitude;

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(rollSingleDie(sides));
  }

  const keepCount = Math.max(0, Math.min(count, keepHighestRaw));
  const keptRolls = keepCount === count ? [...rolls] : [...rolls].sort((a, b) => b - a).slice(0, keepCount);

  let diceSum = 0;
  for (const r of keptRolls) {
    diceSum += r;
  }

  return {
    expression: normalized,
    total: diceSum + flatModifier,
    rolls,
    keptRolls,
    flatModifier
  };
}

/**
 * Checks whether a given `D20RollMode` enforces natural 1 automatic failure
 * and natural 20 automatic success per D&D 3.5e SRD rules.
 *
 * @param mode The roll context mode.
 * @returns True only for `'attack'` and `'save'` rolls.
 */
export function hasNaturalOneTwentyAutoBounds(mode: D20RollMode): boolean {
  switch (mode) {
    case 'attack':
    case 'save':
      return true;
    case 'skill_check':
    case 'ability_check':
    case 'caster_level_check':
    case 'initiative':
      return false;
  }
}

/**
 * Rolls a deterministic `1d20 + modifier` and evaluates mode-specific automatic bounds.
 *
 * @param mode The `D20RollMode` context (`'attack'`, `'save'`, `'skill_check'`, etc.).
 * @param modifier Total numeric modifier added to the natural d20 roll.
 * @param forcedNaturalRoll Optional deterministic override for unit testing specific natural rolls.
 * @returns Structured `D20RollResult`.
 */
export function rollD20(mode: D20RollMode, modifier: number, forcedNaturalRoll?: number): D20RollResult {
  const naturalRoll =
    forcedNaturalRoll !== undefined
      ? Math.max(NATURAL_ONE, Math.min(D20_SIDES, Math.floor(forcedNaturalRoll)))
      : rollSingleDie(D20_SIDES);

  const usesAutoBounds = hasNaturalOneTwentyAutoBounds(mode);
  return {
    mode,
    naturalRoll,
    modifier,
    total: naturalRoll + modifier,
    isAutoFailure: usesAutoBounds && naturalRoll === NATURAL_ONE,
    isAutoSuccess: usesAutoBounds && naturalRoll === NATURAL_TWENTY
  };
}
