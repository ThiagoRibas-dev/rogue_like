import { dndFloor } from './math/multipliers.ts';
import type { AbilityCollapseState, AbilityId, AbilityScoresRecord, AbilityScoreState } from './types/dnd35e.types.ts';

/** Baseline ability score that yields a +0 modifier in D&D 3.5e. */
const ABILITY_SCORE_BASELINE = 10;

/** Divisor used to compute ability modifier (`floor((score - 10) / 2)`). */
const ABILITY_MODIFIER_DIVISOR = 2;

/** Maximum inherent bonus allowed to any single ability score (e.g. Wish/Tome). */
const MAX_INHERENT_BONUS = 5;

/** Minimum score to which temporary penalties (e.g. Ray of Enfeeblement, Fatigued) can reduce an ability. */
const PENALTY_MINIMUM_SCORE = 1;

/** Minimum score floor when reduced by Ability Damage or Ability Drain. */
const DAMAGE_DRAIN_MINIMUM_SCORE = 0;

/**
 * Creates a default `AbilityScoreState` for a given base score (or `null` for a Nonability).
 *
 * @param base Base ability score (`number`) or `null` for a Nonability (`—`).
 * @returns Initialized `AbilityScoreState`.
 */
export function createAbilityScoreState(base: number | null): AbilityScoreState {
  return {
    base,
    inherentBonus: 0,
    damage: 0,
    drain: 0,
    tempPenalty: 0
  };
}

/**
 * Computes the effective ability score after applying inherent bonuses, typed bonuses,
 * temporary penalties (floored at 1), and ability damage/drain (floored at 0).
 * Returns `null` if the ability is a Nonability (`base === null`).
 *
 * @param state The `AbilityScoreState` for the ability.
 * @param typedBonusNet Net bonus from typed modifiers (enhancement, morale, alchemical, size, etc.).
 * @returns Effective numeric ability score (`>= 0`), or `null` for a Nonability.
 */
export function computeEffectiveAbilityScore(state: AbilityScoreState, typedBonusNet = 0): number | null {
  if (state.base === null) {
    return null;
  }

  const clampedInherent = Math.max(0, Math.min(MAX_INHERENT_BONUS, state.inherentBonus));
  const scoreBeforePenalty = Math.max(
    DAMAGE_DRAIN_MINIMUM_SCORE,
    state.base + clampedInherent + typedBonusNet - Math.max(0, state.drain)
  );

  // Temporary penalties cannot reduce an active ability score below 1.
  const scoreAfterPenalty =
    state.tempPenalty > 0 && scoreBeforePenalty > 0
      ? Math.max(PENALTY_MINIMUM_SCORE, scoreBeforePenalty - state.tempPenalty)
      : scoreBeforePenalty;

  return Math.max(DAMAGE_DRAIN_MINIMUM_SCORE, scoreAfterPenalty - Math.max(0, state.damage));
}

/**
 * Computes the D&D 3.5e ability modifier: $\lfloor (\text{Score} - 10) / 2 \rfloor$.
 * A Nonability (`null`) always yields a `+0` modifier.
 *
 * @param effectiveScore Effective ability score (`number | null`).
 * @returns Integer ability modifier.
 */
export function computeAbilityModifier(effectiveScore: number | null): number {
  if (effectiveScore === null) {
    return 0;
  }
  return dndFloor((effectiveScore - ABILITY_SCORE_BASELINE) / ABILITY_MODIFIER_DIVISOR);
}

/**
 * Applies ability damage, drain, or temporary penalty to an `AbilityScoreState`.
 * Nonabilities (`base === null`) are completely immune to ability damage, drain, and penalties.
 *
 * @param state Current `AbilityScoreState`.
 * @param delta `{ damageDelta?, drainDelta?, tempPenalty? }`.
 * @returns Updated `AbilityScoreState`.
 */
export function applyAbilityScoreLoss(
  state: AbilityScoreState,
  delta: {
    readonly damageDelta?: number;
    readonly drainDelta?: number;
    readonly tempPenalty?: number;
  }
): AbilityScoreState {
  if (state.base === null) {
    return state;
  }

  return {
    ...state,
    damage: Math.max(0, state.damage + (delta.damageDelta ?? 0)),
    drain: Math.max(0, state.drain + (delta.drainDelta ?? 0)),
    tempPenalty: delta.tempPenalty !== undefined ? Math.max(0, delta.tempPenalty) : state.tempPenalty
  };
}

/**
 * Evaluates whether any active ability score has dropped to `0` from Damage or Drain
 * (Distinct from Nonabilities where `base === null`):
 * - `CON === 0` -> `'dead'`
 * - `STR === 0` or `DEX === 0` -> `'helpless_paralyzed'`
 * - `INT === 0`, `WIS === 0`, or `CHA === 0` -> `'unconscious'`
 *
 * @param scores Record of all 6 ability score states.
 * @returns The most severe `AbilityCollapseState`.
 */
export function evaluateAbilityCollapseState(scores: AbilityScoresRecord): AbilityCollapseState {
  const conScore = computeEffectiveAbilityScore(scores.con);
  if (conScore !== null && conScore <= 0) {
    return 'dead';
  }

  const strScore = computeEffectiveAbilityScore(scores.str);
  const dexScore = computeEffectiveAbilityScore(scores.dex);
  if ((strScore !== null && strScore <= 0) || (dexScore !== null && dexScore <= 0)) {
    return 'helpless_paralyzed';
  }

  const intScore = computeEffectiveAbilityScore(scores.int);
  const wisScore = computeEffectiveAbilityScore(scores.wis);
  const chaScore = computeEffectiveAbilityScore(scores.cha);
  if (
    (intScore !== null && intScore <= 0) ||
    (wisScore !== null && wisScore <= 0) ||
    (chaScore !== null && chaScore <= 0)
  ) {
    return 'unconscious';
  }

  return 'normal';
}

/**
 * Checks if an entity is immune to Fortitude saves (because `CON === null`, e.g. Undead/Constructs)
 * unless the effect also affects objects (`affectsObjects === true`).
 *
 * @param scores Entity's ability scores.
 * @param affectsObjects Whether the effect explicitly affects objects (e.g. Disintegrate).
 * @returns True if immune to the Fortitude save.
 */
export function isImmuneToFortitudeSave(scores: AbilityScoresRecord, affectsObjects = false): boolean {
  return scores.con.base === null && !affectsObjects;
}

/**
 * Checks if an entity is immune to mind-affecting effects because `INT === null` (Mindless).
 *
 * @param scores Entity's ability scores.
 * @returns True if `INT === null`.
 */
export function isMindlessImmune(scores: AbilityScoresRecord): boolean {
  return scores.int.base === null;
}

/**
 * Returns the governing ability ID for `Concentration` checks (`'con'` normally,
 * or `'cha'` when `CON === null` per SRD Nonability rules for Undead/Constructs).
 *
 * @param scores Entity's ability scores.
 * @returns `'con'` or `'cha'`.
 */
export function getConcentrationKeyAbility(scores: AbilityScoresRecord): AbilityId {
  return scores.con.base === null ? 'cha' : 'con';
}
