import { dndFloor } from './math/multipliers.ts';
import type { AggregatedChassis, BabCurveType, HitDieTrack, SaveCurveType } from './types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35ClassLevelRow } from './types/dnd35e_system.types.ts';

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
 * Looks up the exact progression row for a class at `classLevel` (1..maxLevel).
 *
 * @param classDef Class definition from System Content.
 * @param classLevel Target class level (1-indexed).
 * @returns The matching `DnD35ClassLevelRow`, or `undefined` if out of bounds.
 */
export function getClassLevelRow(classDef: DnD35ClassDefinition, classLevel: number): DnD35ClassLevelRow | undefined {
  const clamped = dndFloor(classLevel);
  if (clamped < 1) return undefined;
  return classDef.progression.find((row) => row.level === clamped);
}

/**
 * Builds a `HitDieTrack` for a character class at `classLevel`, reading exact BAB and base saves
 * from the class's level-by-level progression table.
 *
 * @param classDef Class definition from System Content.
 * @param classLevel Class level achieved (>= 1).
 * @returns Populated `HitDieTrack` with explicit table BAB and saves.
 */
export function buildHitDieTrackFromClass(classDef: DnD35ClassDefinition, classLevel: number): HitDieTrack {
  const clamped = Math.max(1, Math.min(classDef.maxLevel, dndFloor(classLevel)));
  const row = getClassLevelRow(classDef, clamped) ?? classDef.progression[classDef.progression.length - 1]!;
  return {
    trackId: classDef.id,
    levels: clamped,
    hitDieSides: classDef.hitDieSides,
    babCurve: 'half',
    fortCurve: 'poor',
    refCurve: 'poor',
    willCurve: 'poor',
    skillPointsPerLevel: classDef.skillPointsPerLevel,
    explicitBab: row.bab,
    explicitFort: row.fortSave,
    explicitRef: row.refSave,
    explicitWill: row.willSave
  };
}

/**
 * Computes the effective class casting level for a base casting class across all tracks,
 * adding base class levels plus any levels in Prestige Classes that advance this tradition.
 *
 * @param tracks All active tracks on the actor.
 * @param baseClassDef The base casting class definition.
 * @param classRegistry The full class registry.
 * @returns Total effective caster level in this class's spell progression.
 */
export function computeEffectiveClassCastingLevel(
  tracks: ReadonlyArray<HitDieTrack>,
  baseClassDef: DnD35ClassDefinition,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>
): number {
  if (baseClassDef.castingTradition === 'none' || baseClassDef.castingMode === 'none') {
    return 0;
  }
  let effectiveLevel = 0;
  for (const track of tracks) {
    if (track.trackId === baseClassDef.id) {
      effectiveLevel += track.levels;
      continue;
    }
    const prcDef = classRegistry[track.trackId];
    if (!prcDef || !prcDef.isPrestige) continue;
    for (let lvl = 1; lvl <= track.levels; lvl++) {
      const row = getClassLevelRow(prcDef, lvl);
      if (
        row?.advancesSpellcasting === baseClassDef.castingTradition ||
        row?.advancesSpellcasting === 'both' ||
        row?.advancesSpellcasting === 'any'
      ) {
        effectiveLevel += 1;
      }
    }
  }
  return effectiveLevel;
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

/**
 * Resolves active class features for an actor given baseline features, active ACF selections,
 * and the class's declarative ACF swap tables.
 *
 * @param baseClassFeatures Array of feature IDs granted by base class level.
 * @param activeAcfIds Array of ACF IDs selected by the character.
 * @param classDef Class definition from System Content.
 * @returns Transformed array of active feature IDs.
 */
export function resolveActiveClassFeatures(
  baseClassFeatures: ReadonlyArray<string>,
  activeAcfIds: ReadonlyArray<string>,
  classDef: DnD35ClassDefinition
): ReadonlyArray<string> {
  let active = [...baseClassFeatures];

  for (const acfId of activeAcfIds) {
    const swap = classDef.acfSwaps.find((s) => s.acfId === acfId);
    if (swap) {
      active = active.filter((f) => f !== swap.replacesFeature);
      if (!active.includes(swap.grantedFeature)) {
        active.push(swap.grantedFeature);
      }
    }
  }

  return active;
}

/** Multiclass XP penalty per uneven non-favored base class (20% per offending class). */
export const MULTICLASS_XP_PENALTY_PER_CLASS = 0.2;

/** Minimum XP multiplier floor when multiple base classes are uneven. */
export const MIN_MULTICLASS_XP_MULTIPLIER = 0.2;

/** Maximum allowed level difference between non-favored base classes before XP penalty applies. */
export const MAX_UNPENALIZED_BASE_CLASS_GAP = 1;

/**
 * Collects all baseline feature IDs granted by a class from level 1 through `maxReachedLevel`,
 * applying any active ACF swaps at or below `maxReachedLevel`.
 *
 * @param classDef Class definition from System Content.
 * @param maxReachedLevel Current class level reached ($\ge 1$).
 * @param activeAcfIds Selected ACF swap IDs on the character.
 * @returns Ordered array of active class feature IDs.
 */
export function collectClassFeaturesUpToLevel(
  classDef: DnD35ClassDefinition,
  maxReachedLevel: number,
  activeAcfIds: ReadonlyArray<string> = []
): ReadonlyArray<string> {
  const baseFeatures: string[] = [];
  const clampedLevel = Math.max(0, dndFloor(maxReachedLevel));
  for (const row of classDef.progression) {
    if (row.level > clampedLevel) continue;
    for (const featId of row.features) {
      if (!baseFeatures.includes(featId)) {
        baseFeatures.push(featId);
      }
    }
  }
  const eligibleAcfs = activeAcfIds.filter((acfId) => {
    const swap = classDef.acfSwaps.find((s) => s.acfId === acfId);
    return swap !== undefined && swap.level <= clampedLevel;
  });
  return resolveActiveClassFeatures(baseFeatures, eligibleAcfs, classDef);
}

/**
 * Computes the D&D 3.5e multiclass XP multiplier (`1.0` = no penalty, `0.8` = `-20%`, etc.).
 * - Ignores all Prestige Classes (`isPrestige === true`) and Racial HD tracks.
 * - Ignores the actor's `favoredClass` (or the highest-level base class when `favoredClass === 'any'`).
 * - Applies `-0.20` for each remaining base class that is more than 1 level below the highest remaining base class.
 *
 * @param tracks The actor's HitDieTrack or class level array (`trackId` / `levels`).
 * @param classRegistry The loaded D&D 3.5e class definitions dictionary.
 * @param favoredClass The actor's racial favored class ID or `'any'` (e.g. Human / Half-Elf).
 * @param enforcePenalty Campaign rule toggle to enable/disable multiclass XP penalties.
 * @returns The XP multiplier in the range `[0.2, 1.0]`.
 */
export function calculateMulticlassXpMultiplier(
  tracks: ReadonlyArray<{ readonly trackId: string; readonly levels: number }>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  favoredClass: string = 'any',
  enforcePenalty: boolean = true
): number {
  if (!enforcePenalty) {
    return 1.0;
  }

  // Filter strictly to base classes (Prestige Classes and non-class racial HD tracks are exempt per PHB p. 60)
  const baseClassEntries = tracks.filter((entry) => {
    if (entry.levels <= 0) return false;
    const def = classRegistry[entry.trackId];
    return def !== undefined && !def.isPrestige;
  });

  if (baseClassEntries.length <= 1) {
    return 1.0;
  }

  let remainingBaseClasses: ReadonlyArray<{ readonly trackId: string; readonly levels: number }>;
  if (favoredClass === 'any') {
    let maxIdx = 0;
    for (let i = 1; i < baseClassEntries.length; i++) {
      const current = baseClassEntries[i];
      const best = baseClassEntries[maxIdx];
      if (current !== undefined && best !== undefined && current.levels > best.levels) {
        maxIdx = i;
      }
    }
    remainingBaseClasses = baseClassEntries.filter((_, idx) => idx !== maxIdx);
  } else {
    remainingBaseClasses = baseClassEntries.filter((entry) => entry.trackId !== favoredClass);
  }

  if (remainingBaseClasses.length <= 1) {
    return 1.0;
  }

  let highestRemainingLevel = 0;
  for (const entry of remainingBaseClasses) {
    if (entry.levels > highestRemainingLevel) {
      highestRemainingLevel = entry.levels;
    }
  }

  let offendingClasses = 0;
  for (const entry of remainingBaseClasses) {
    if (highestRemainingLevel - entry.levels > MAX_UNPENALIZED_BASE_CLASS_GAP) {
      offendingClasses += 1;
    }
  }

  if (offendingClasses === 0) {
    return 1.0;
  }

  return Math.max(
    MIN_MULTICLASS_XP_MULTIPLIER,
    Number((1.0 - offendingClasses * MULTICLASS_XP_PENALTY_PER_CLASS).toFixed(2))
  );
}
