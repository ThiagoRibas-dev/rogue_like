import { rng } from '../../../core/rng.ts';
import { computeAbilityModifier } from '../abilities.ts';
import { rollD20 } from '../math/dice.ts';
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
