import { dndFloor } from './math/multipliers.ts';
import type { AggregatedChassis, BabCurveType, HitDieTrack, SaveCurveType } from './types/dnd35e.types.ts';

export * from './progression/class_features_xp.ts';
export * from './progression/prestige_casting.ts';

/** Multiplier for the Three-Quarters (0.75) BAB progression curve. */
const BAB_THREE_QUARTERS_RATIO = 0.75;

/** Multiplier for the Half (0.5) BAB progression curve. */
const BAB_HALF_RATIO = 0.5;

/** Iterative BAB step-down interval (`-5` per iterative attack). */
const ITERATIVE_BAB_STEP = 5;

/** Maximum number of iterative attacks granted by Base Attack Bonus (`4` at BAB +16). */
const MAX_ITERATIVE_ATTACKS = 4;

/** Base constant added to Good saving throw progression at Level 1 (`+2`). */
const GOOD_SAVE_BASE_OFFSET = 2;

/** Divisor for Good saving throw progression (`floor(level / 2)`). */
const GOOD_SAVE_DIVISOR = 2;

/** Divisor for Poor saving throw progression (`floor(level / 3)`). */
const POOR_SAVE_DIVISOR = 3;

/** Hit Dice interval for general feat slots (`1 + floor(HD / 3)`). */
const FEAT_SLOT_HD_INTERVAL = 3;

/** Hit Dice interval for ability score increases (`floor(HD / 4)`). */
const ABILITY_INCREASE_HD_INTERVAL = 4;

/** Base XP multiplier per Effective Character Level (`1000`). */
export const DND35E_XP_STEP_MULTIPLIER = 1000;

/** Minimum Hit Points gained per Hit Die regardless of negative CON modifier (`1`). */
const MIN_HP_PER_HIT_DIE = 1;

/**
 * Evaluates a Base Attack Bonus (`BAB`) progression curve for a given track level $L$.
 * - `full`: $L$
 * - `three_quarters`: $\lfloor 0.75 L \rfloor$
 * - `half`: $\lfloor 0.5 L \rfloor$
 *
 * @param curve The `BabCurveType` (`'full' | 'three_quarters' | 'half'`).
 * @param level Track level ($\ge 0$).
 * @returns Computed integer BAB for that track.
 */
export function evaluateBabCurve(curve: BabCurveType, level: number): number {
  const safeLevel = Math.max(0, dndFloor(level));
  switch (curve) {
    case 'full':
      return safeLevel;
    case 'three_quarters':
      return dndFloor(safeLevel * BAB_THREE_QUARTERS_RATIO);
    case 'half':
      return dndFloor(safeLevel * BAB_HALF_RATIO);
  }
}

/**
 * Computes the iterative Base Attack Bonus sequence `[B, B-5, B-10, B-15]` from a total BAB.
 * Temporary attack bonuses never grant extra iterative attacks; only `totalBab` governs count,
 * capped at 4 iterative attacks while $B - 5k \ge 1$.
 *
 * @param totalBab Total Base Attack Bonus.
 * @returns Array of iterative base attack bonuses (at least `[totalBab]`).
 */
export function getIterativeBabSequence(totalBab: number): ReadonlyArray<number> {
  if (totalBab < 1) {
    return [totalBab];
  }

  const sequence: number[] = [];
  for (let i = 0; i < MAX_ITERATIVE_ATTACKS; i++) {
    const iterBab = totalBab - i * ITERATIVE_BAB_STEP;
    if (iterBab >= 1) {
      sequence.push(iterBab);
    } else {
      break;
    }
  }
  return sequence;
}

/**
 * Evaluates a Base Saving Throw progression curve for a given track level $L$.
 * - `good`: $2 + \lfloor L / 2 \rfloor$ (or `0` when $L = 0$)
 * - `poor`: $\lfloor L / 3 \rfloor$
 *
 * @param curve The `SaveCurveType` (`'good' | 'poor'`).
 * @param level Track level ($\ge 0$).
 * @returns Computed integer base save bonus for that track.
 */
export function evaluateSaveCurve(curve: SaveCurveType, level: number): number {
  const safeLevel = Math.max(0, dndFloor(level));
  if (safeLevel === 0) return 0;

  switch (curve) {
    case 'good':
      return GOOD_SAVE_BASE_OFFSET + dndFloor(safeLevel / GOOD_SAVE_DIVISOR);
    case 'poor':
      return dndFloor(safeLevel / POOR_SAVE_DIVISOR);
  }
}

/**
 * Computes the cumulative XP required to reach Effective Character Level `ecl`:
 *
 * $$\text{XP}(\text{ECL}) = \frac{\text{ECL} \cdot (\text{ECL} - 1)}{2} \times 1000$$
 *
 * (Level 1 = `0`, Level 2 = `1,000`, Level 3 = `3,000`, Level 4 = `6,000`, etc.)
 *
 * @param ecl Effective Character Level ($\ge 1$).
 * @returns Cumulative XP floor for that level.
 */
export function computeXpThresholdForLevel(ecl: number): number {
  const clamped = Math.max(1, dndFloor(ecl));
  return ((clamped * (clamped - 1)) / 2) * DND35E_XP_STEP_MULTIPLIER;
}

/**
 * Aggregates multi-source Hit Dice / Class Level tracks (`racialHitDice` + `classLevels`)
 * into a unified `AggregatedChassis` containing total HD, ECL, XP thresholds, BAB,
 * iterative sequence, base saves, feat/ability entitlements, and Hit Points.
 *
 * @param tracks Array of `HitDieTrack` definitions.
 * @param conModifier Effective Constitution modifier (`0` if `CON === null`).
 * @param levelAdjustment Racial Level Adjustment (`LA >= 0`, default `0`).
 * @param flatBonusHp Additional flat HP (e.g. Toughness feat `+3` or Unholy Toughness).
 * @returns Complete `AggregatedChassis`.
 */
export function aggregateProgressionChassis(
  tracks: ReadonlyArray<HitDieTrack>,
  conModifier: number,
  levelAdjustment = 0,
  flatBonusHp = 0
): AggregatedChassis {
  let totalHD = 0;
  let totalBab = 0;
  let fortSave = 0;
  let refSave = 0;
  let willSave = 0;
  let totalHp = 0;
  let isFirstHitDie = true;

  for (const track of tracks) {
    const levels = Math.max(0, dndFloor(track.levels));
    if (levels === 0) continue;

    totalHD += levels;
    totalBab += track.explicitBab !== undefined ? track.explicitBab : evaluateBabCurve(track.babCurve, levels);
    fortSave += track.explicitFort !== undefined ? track.explicitFort : evaluateSaveCurve(track.fortCurve, levels);
    refSave += track.explicitRef !== undefined ? track.explicitRef : evaluateSaveCurve(track.refCurve, levels);
    willSave += track.explicitWill !== undefined ? track.explicitWill : evaluateSaveCurve(track.willCurve, levels);

    const avgRollPerSubsequentDie = dndFloor(track.hitDieSides / 2) + 1;
    for (let i = 0; i < levels; i++) {
      const baseDieHp = isFirstHitDie ? track.hitDieSides : avgRollPerSubsequentDie;
      isFirstHitDie = false;
      totalHp += Math.max(MIN_HP_PER_HIT_DIE, baseDieHp + conModifier);
    }
  }

  const effectiveHD = Math.max(1, totalHD);
  const ecl = Math.max(1, effectiveHD + Math.max(0, dndFloor(levelAdjustment)));
  const xpCurrentFloor = computeXpThresholdForLevel(ecl);
  const xpNextLevelThreshold = computeXpThresholdForLevel(ecl + 1);
  const generalFeatSlots = 1 + dndFloor(effectiveHD / FEAT_SLOT_HD_INTERVAL);
  const abilityIncreaseCount = dndFloor(effectiveHD / ABILITY_INCREASE_HD_INTERVAL);

  return {
    totalHD: effectiveHD,
    ecl,
    xpCurrentFloor,
    xpNextLevelThreshold,
    totalBab,
    iterativeBabSequence: getIterativeBabSequence(totalBab),
    baseSaves: {
      fort: fortSave,
      ref: refSave,
      will: willSave
    },
    generalFeatSlots,
    abilityIncreaseCount,
    maxHp: Math.max(MIN_HP_PER_HIT_DIE, totalHp + flatBonusHp)
  };
}
