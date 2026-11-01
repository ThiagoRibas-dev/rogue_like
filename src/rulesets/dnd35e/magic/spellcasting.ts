import { rng } from '../../../core/rng.ts';
import { computeAbilityModifier } from '../abilities.ts';
import { evaluateDiceExpression, rollD20 } from '../math/dice.ts';
import { dndFloor } from '../math/multipliers.ts';
import type { CapabilityClassification } from '../types/dnd35e.types.ts';

/** Minimum ability score base (`10 + spellLevel`) required to cast a spell of that level. */
const CASTING_ABILITY_BASE_THRESHOLD = 10;

/** Verbal spell failure chance when the caster is Deafened (`20%`). */
const DEAFENED_VERBAL_FAILURE_PERCENT = 20;

/** Base DC for Casting Defensively (`15 + spellLevel`). */
const DEFENSIVE_CASTING_BASE_DC = 15;

/** Base DC for Concentration when damaged during casting (`10 + damageTaken + spellLevel`). */
const DAMAGE_CONCENTRATION_BASE_DC = 10;

/** Base DC for Saving Throws against spells (`10 + spellLevel + keyAbilityModifier`). */
const SPELL_SAVE_BASE_DC = 10;

/** Canonical rules matrix for `Spell`, `Ex` (Extraordinary), `Sp` (Spell-Like), and `Su` (Supernatural). */
export interface CapabilityRuleDescriptor {
  readonly suppressedByAntimagic: boolean;
  readonly subjectToSpellResistance: boolean;
  readonly subjectToDispel: boolean;
  readonly provokesAoO: boolean;
  readonly requiresConcentration: boolean;
}

/** Canonical D&D 3.5e `Spell` / `Ex` / `Sp` / `Su` classification matrix. */
export const CAPABILITY_RULES: Readonly<Record<CapabilityClassification, CapabilityRuleDescriptor>> = {
  spell: {
    suppressedByAntimagic: true,
    subjectToSpellResistance: true,
    subjectToDispel: true,
    provokesAoO: true,
    requiresConcentration: true
  },
  sp: {
    suppressedByAntimagic: true,
    subjectToSpellResistance: true,
    subjectToDispel: true,
    provokesAoO: true,
    requiresConcentration: true
  },
  su: {
    suppressedByAntimagic: true,
    subjectToSpellResistance: false,
    subjectToDispel: false,
    provokesAoO: false,
    requiresConcentration: false
  },
  ex: {
    suppressedByAntimagic: false,
    subjectToSpellResistance: false,
    subjectToDispel: false,
    provokesAoO: false,
    requiresConcentration: false
  }
};

/** State of a single Vancian prepared spell slot. */
export interface PreparedSpellSlot {
  readonly spellLevel: number;
  readonly status: 'open' | 'prepared' | 'expended';
  readonly preparedSpellId?: string;
  readonly castTimestampTurn?: number;
}

/**
 * Checks whether an actor's governing casting ability score is high enough (`>= 10 + spellLevel`)
 * to prepare or cast a spell of `spellLevel`.
 *
 * @param abilityScore Effective governing ability score (`number | null`).
 * @param spellLevel Spell level (`0..9`).
 * @returns True if `abilityScore >= 10 + spellLevel`.
 */
export function canCastSpellOfLevel(abilityScore: number | null, spellLevel: number): boolean {
  if (abilityScore === null) return false;
  return abilityScore >= CASTING_ABILITY_BASE_THRESHOLD + Math.max(0, spellLevel);
}

/**
 * Computes the number of bonus daily spell slots of `spellLevel` (`1..9`) granted by a
 * high governing ability score:
 * - Cantrips / Orisons (`spellLevel === 0`) never receive bonus slots from ability scores.
 * - For `spellLevel >= 1` and `abilityModifier >= spellLevel`:
 *   $$\text{BonusSlots} = \lfloor (\text{Mod} - \text{Level} + 4) / 4 \rfloor$$
 *
 * @param abilityScore Effective governing ability score (`number | null`).
 * @param spellLevel Spell level (`0..9`).
 * @returns Bonus daily spell slots ($\ge 0$).
 */
export function computeBonusSpellSlots(abilityScore: number | null, spellLevel: number): number {
  if (spellLevel <= 0 || abilityScore === null) {
    return 0;
  }
  const mod = computeAbilityModifier(abilityScore);
  if (mod < spellLevel) {
    return 0;
  }
  return dndFloor((mod - spellLevel + 4) / 4);
}

/**
 * Spontaneously converts a prepared Vancian spell slot into a target spell (e.g. a Cleric
 * converting a prepared non-domain spell into a `cure` or `inflict` spell of `<=` slot level).
 *
 * @param slot The `PreparedSpellSlot` to convert.
 * @param replacementSpellId The ID of the spontaneous conversion spell.
 * @param replacementSpellLevel Level of the replacement spell.
 * @param currentTurn Current global turn timestamp.
 * @returns `{ success: boolean, slot: PreparedSpellSlot }`.
 */
export function convertPreparedSlotSpontaneously(
  slot: PreparedSpellSlot,
  replacementSpellId: string,
  replacementSpellLevel: number,
  currentTurn: number
): {
  readonly success: boolean;
  readonly slot: PreparedSpellSlot;
} {
  if (slot.status !== 'prepared' || replacementSpellLevel > slot.spellLevel) {
    return { success: false, slot };
  }
  return {
    success: true,
    slot: {
      spellLevel: slot.spellLevel,
      status: 'expended',
      preparedSpellId: replacementSpellId,
      castTimestampTurn: currentTurn
    }
  };
}

/** Input parameters for the 7-step D&D 3.5e Cast & Ability Resolution Pipeline. */
export interface CastResolutionParams {
  readonly classification: CapabilityClassification;
  readonly spellLevel: number;
  readonly casterLevel: number;
  readonly keyAbilityScore: number | null;
  readonly concentrationModifier: number;
  readonly hasVerbalComponent?: boolean;
  readonly hasSomaticComponent?: boolean;
  readonly arcaneSpellFailurePercent?: number;
  readonly isCasterDeafened?: boolean;
  readonly inAntimagicField?: boolean;
  readonly inSilenceField?: boolean;
  readonly castDefensively?: boolean;
  readonly aooDamageTakenDuringCast?: number;
  readonly targetSpellResistance?: number;
  readonly spellPenetrationBonus?: number;
  readonly dcBonus?: number;
  readonly forcedConcentrationRoll?: number;
  readonly forcedSrRoll?: number;
}

/** Result of the 7-step D&D 3.5e Cast & Ability Resolution Pipeline. */
export interface CastResolutionResult {
  readonly succeeded: boolean;
  readonly failureReason?:
    | 'insufficient_ability_score'
    | 'antimagic_suppressed'
    | 'silence_blocked_verbal'
    | 'deafened_verbal_mishap'
    | 'arcane_spell_failure'
    | 'defensive_concentration_failed'
    | 'damage_concentration_failed'
    | 'blocked_by_spell_resistance';
  readonly provokedAoO: boolean;
  readonly saveDC: number;
}

/**
 * Executes the 7-step D&D 3.5e Cast & Ability Resolution Pipeline:
 * 1. Governing Ability Score gate (`>= 10 + spellLevel` for spells) & Antimagic/Silence check.
 * 2. Verbal (`20%` Deafened failure) & Somatic (`Arcane Spell Failure %`) checks.
 * 3. Cast Defensively (`DC 15 + spellLevel`) or AoO provocation + damage Concentration check (`DC 10 + dmg + spellLevel`).
 * 4. Spell Resistance check (`1d20 + casterLevel + spellPenetrationBonus >= targetSpellResistance`).
 * 5. Saving Throw DC calculation (`10 + spellLevel + keyAbilityModifier + dcBonus`).
 *
 * @param params Structured `CastResolutionParams`.
 * @returns Complete `CastResolutionResult`.
 */
export function resolveCastPipeline(params: CastResolutionParams): CastResolutionResult {
  const rules = CAPABILITY_RULES[params.classification];

  if (params.classification === 'spell' && !canCastSpellOfLevel(params.keyAbilityScore, params.spellLevel)) {
    return {
      succeeded: false,
      failureReason: 'insufficient_ability_score',
      provokedAoO: false,
      saveDC: 0
    };
  }

  if (params.inAntimagicField === true && rules.suppressedByAntimagic) {
    return {
      succeeded: false,
      failureReason: 'antimagic_suppressed',
      provokedAoO: false,
      saveDC: 0
    };
  }

  if (params.hasVerbalComponent === true && params.inSilenceField === true) {
    return {
      succeeded: false,
      failureReason: 'silence_blocked_verbal',
      provokedAoO: false,
      saveDC: 0
    };
  }

  if (params.hasVerbalComponent === true && params.isCasterDeafened === true) {
    const roll = Math.floor(rng.getUniform() * 100) + 1;
    if (roll <= DEAFENED_VERBAL_FAILURE_PERCENT) {
      return {
        succeeded: false,
        failureReason: 'deafened_verbal_mishap',
        provokedAoO: false,
        saveDC: 0
      };
    }
  }

  const asf = params.arcaneSpellFailurePercent ?? 0;
  if (params.hasSomaticComponent === true && asf > 0) {
    const roll = Math.floor(rng.getUniform() * 100) + 1;
    if (roll <= asf) {
      return {
        succeeded: false,
        failureReason: 'arcane_spell_failure',
        provokedAoO: false,
        saveDC: 0
      };
    }
  }

  let provokedAoO = false;
  if (rules.provokesAoO) {
    if (params.castDefensively === true) {
      const defensiveDc = DEFENSIVE_CASTING_BASE_DC + params.spellLevel;
      const concRoll = rollD20('skill_check', params.concentrationModifier, params.forcedConcentrationRoll);
      if (concRoll.total < defensiveDc) {
        return {
          succeeded: false,
          failureReason: 'defensive_concentration_failed',
          provokedAoO: false,
          saveDC: 0
        };
      }
    } else {
      provokedAoO = true;
      const dmg = params.aooDamageTakenDuringCast ?? 0;
      if (dmg > 0 && rules.requiresConcentration) {
        const dmgDc = DAMAGE_CONCENTRATION_BASE_DC + dmg + params.spellLevel;
        const concRoll = rollD20('skill_check', params.concentrationModifier, params.forcedConcentrationRoll);
        if (concRoll.total < dmgDc) {
          return {
            succeeded: false,
            failureReason: 'damage_concentration_failed',
            provokedAoO: true,
            saveDC: 0
          };
        }
      }
    }
  }

  const targetSr = params.targetSpellResistance ?? 0;
  if (rules.subjectToSpellResistance && targetSr > 0) {
    const clMod = params.casterLevel + (params.spellPenetrationBonus ?? 0);
    const srRoll = rollD20('caster_level_check', clMod, params.forcedSrRoll);
    if (srRoll.total < targetSr) {
      return {
        succeeded: false,
        failureReason: 'blocked_by_spell_resistance',
        provokedAoO,
        saveDC: 0
      };
    }
  }

  const keyMod = computeAbilityModifier(params.keyAbilityScore);
  const saveDC = SPELL_SAVE_BASE_DC + params.spellLevel + keyMod + (params.dcBonus ?? 0);

  return {
    succeeded: true,
    provokedAoO,
    saveDC
  };
}

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

  // Evaluate normal roll
  const normalResult = evaluateDiceExpression(baseExpression);
  const normalTotal = forcedRollTotal !== undefined ? forcedRollTotal : normalResult.total;

  if (!isMax && !isEmp) {
    return {
      totalDamage: normalTotal,
      maximized: false,
      empowered: false
    };
  }

  // Calculate maximized value: replace dice with count * sides
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
    // Maximize + Empower: Max damage + 50% of rolled normal damage
    const total = maxTotal + dndFloor(normalTotal * 0.5);
    return { totalDamage: total, maximized: true, empowered: true };
  }

  if (isMax) {
    return { totalDamage: maxTotal, maximized: true, empowered: false };
  }

  // Only Empower
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
  const dc =
    params.isVigorouslyActive === true
      ? 10 + params.spellLevel
      : 10 + params.damageTaken + params.spellLevel;

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
  // 1. Exact match
  if (reactorSpell === targetSpell) {
    return true;
  }

  // 2. Dispel Magic / Greater Dispel Magic universal counter
  if (reactorSpell === 'dispel_magic' || reactorSpell === 'greater_dispel_magic') {
    return true;
  }

  // 3. Improved Counterspell: same school and higher level
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

