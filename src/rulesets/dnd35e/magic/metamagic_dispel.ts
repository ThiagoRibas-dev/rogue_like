import { evaluateDiceExpression, rollD20 } from '../math/dice.ts';
import { dndFloor } from '../math/multipliers.ts';

/**
 * Metamagic feat modifiers applied to a spell instance.
 */
export interface MetamagicSpellModifiers {
  readonly empower?: boolean | undefined;
  readonly maximize?: boolean | undefined;
  readonly extend?: boolean | undefined;
  readonly widen?: boolean | undefined;
  readonly silent?: boolean | undefined;
  readonly still?: boolean | undefined;
}

/**
 * Evaluates damage dealt by a spell with optional Empower Spell and Maximize Spell metamagic applied.
 * - Maximize: All variable numeric dice deal maximum possible damage.
 * - Empower: Increases all variable numeric damage by 50% (+0.5x, floored).
 * - Empower + Maximize: Yields maximized damage PLUS 50% of the rolled damage (official D&D 3.5e FAQ ruling).
 *
 * @param baseExpression Dice expression (e.g. "10d6" or "5d6+5").
 * @param metamagic Optional active metamagic modifiers.
 * @param forcedRollTotal Optional override for the non-maximized roll.
 * @returns Object containing total damage, maximized flag, and empowered flag.
 */
export function evaluateMetamagicDamage(
  baseExpression: string,
  metamagic?: MetamagicSpellModifiers,
  forcedRollTotal?: number
): {
  readonly totalDamage: number;
  readonly maximized: boolean;
  readonly empowered: boolean;
} {
  const isMax = metamagic?.maximize === true;
  const isEmp = metamagic?.empower === true;

  const normalResult = evaluateDiceExpression(baseExpression);
  const normalTotal = forcedRollTotal !== undefined ? forcedRollTotal : normalResult.total;

  if (!isMax && !isEmp) {
    return {
      totalDamage: normalTotal,
      maximized: false,
      empowered: false
    };
  }

  const regex = /^(\d+)d(\d+)(?:([+-])(\d+))?$/i;
  const match = regex.exec(baseExpression.replace(/\s+/g, ''));
  let maxTotal = normalTotal;

  if (match) {
    const count = Number.parseInt(match[1] ?? '1', 10);
    const sides = Number.parseInt(match[2] ?? '6', 10);
    const sign = match[3] === '-' ? -1 : 1;
    const flat = match[4] !== undefined ? Number.parseInt(match[4], 10) : 0;
    maxTotal = count * sides + sign * flat;
  }

  if (isMax && isEmp) {
    const total = maxTotal + dndFloor(normalTotal * 0.5);
    return { totalDamage: total, maximized: true, empowered: true };
  }

  if (isMax) {
    return { totalDamage: maxTotal, maximized: true, empowered: false };
  }

  return {
    totalDamage: dndFloor(normalTotal * 1.5),
    maximized: false,
    empowered: true
  };
}

/**
 * Computes casting action requirement for spontaneous casters (Sorcerers, Bards) applying metamagic.
 * Spontaneous metamagic extends standard action casting time to a Full-Round Action.
 *
 * @param isSpontaneous Whether the caster casts spontaneously.
 * @param metamagicActive Whether any metamagic is applied.
 * @returns 'standard' or 'full_round'.
 */
export function getSpontaneousMetamagicActionType(
  isSpontaneous: boolean,
  metamagicActive: boolean
): 'standard' | 'full_round' {
  if (isSpontaneous && metamagicActive) {
    return 'full_round';
  }
  return 'standard';
}

/**
 * Resolves Concentration checks to maintain a spell or ongoing effect when damaged or distracted.
 * DC = 10 + damageTaken + spellLevel (or 10 + spellLevel if vigorous motion).
 *
 * @param params Concentration check parameters.
 * @returns Result with maintained flag, dc, and roll total.
 */
export function maintainOrDisruptConcentration(params: {
  readonly damageTaken: number;
  readonly spellLevel: number;
  readonly concentrationModifier: number;
  readonly isVigorouslyActive?: boolean | undefined;
  readonly forcedRoll?: number | undefined;
}): {
  readonly maintained: boolean;
  readonly dc: number;
  readonly rollTotal: number;
} {
  const dc = params.isVigorouslyActive === true ? 10 + params.spellLevel : 10 + params.damageTaken + params.spellLevel;

  const roll = rollD20('skill_check', params.concentrationModifier, params.forcedRoll);
  return {
    maintained: roll.total >= dc,
    dc,
    rollTotal: roll.total
  };
}

/**
 * Resolves a Dispel Magic or Greater Dispel Magic caster level check against an ongoing effect or spell.
 * Check = 1d20 + min(casterLevel, maxCap) vs DC (11 + targetSpellCasterLevel).
 * Max cap: +10 for Dispel Magic, +20 for Greater Dispel Magic.
 *
 * @param casterLevel Caster Level of the dispeller.
 * @param targetSpellCasterLevel Caster Level of the spell being dispelled.
 * @param isGreaterDispel Whether Greater Dispel Magic is used (+20 cap instead of +10).
 * @param forcedRoll Optional forced d20 roll for testing.
 * @returns Result with dispelled flag, checkTotal, and dc.
 */
export function resolveDispelCheck(
  casterLevel: number,
  targetSpellCasterLevel: number,
  isGreaterDispel?: boolean,
  forcedRoll?: number
): {
  readonly dispelled: boolean;
  readonly checkTotal: number;
  readonly dc: number;
} {
  const cap = isGreaterDispel === true ? 20 : 10;
  const effectiveModifier = Math.min(casterLevel, cap);
  const dc = 11 + targetSpellCasterLevel;

  const roll = rollD20('caster_level_check', effectiveModifier, forcedRoll);
  return {
    dispelled: roll.total >= dc,
    checkTotal: roll.total,
    dc
  };
}

/**
 * Evaluates whether a ready-action counterspell attempt succeeds in countering an incoming spell.
 * - Exact spell match or Dispel Magic / Greater Dispel Magic automatically counters.
 * - With Improved Counterspell: can counter with a spell of the same school that is 1 or more levels higher.
 *
 * @param reactorSpell ID of the spell being used to counter.
 * @param targetSpell ID of the incoming target spell.
 * @param options Additional school and level parameters for Improved Counterspell.
 * @returns True if the counterspell succeeds.
 */
export function resolveCounterspellAttempt(
  reactorSpell: string,
  targetSpell: string,
  options?: {
    readonly hasImprovedCounterspell?: boolean | undefined;
    readonly reactorSchool?: string | undefined;
    readonly targetSchool?: string | undefined;
    readonly reactorLevel?: number | undefined;
    readonly targetLevel?: number | undefined;
  }
): boolean {
  if (reactorSpell === targetSpell) {
    return true;
  }

  if (reactorSpell === 'dispel_magic' || reactorSpell === 'greater_dispel_magic') {
    return true;
  }

  if (
    options?.hasImprovedCounterspell === true &&
    options.reactorSchool &&
    options.targetSchool &&
    options.reactorSchool === options.targetSchool &&
    options.reactorLevel !== undefined &&
    options.targetLevel !== undefined &&
    options.reactorLevel >= options.targetLevel + 1
  ) {
    return true;
  }

  return false;
}
