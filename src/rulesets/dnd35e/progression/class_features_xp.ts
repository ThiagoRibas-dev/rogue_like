import { dndFloor } from '../math/multipliers.ts';
import type { DnD35ClassDefinition } from '../types/dnd35e_system.types.ts';

/** CR contribution for a 1st-level NPC class character (`0.5` per DMG p. 38). */
const NPC_CLASS_LEVEL_1_CR = 0.5;

/** CR contribution per NPC class level when added to a monster with Racial HD (`0.5` per MM p. 294). */
const MONSTER_NONASSOCIATED_NPC_CR_PER_LEVEL = 0.5;

/** Multiclass XP penalty per uneven non-favored base class (20% per offending class). */
export const MULTICLASS_XP_PENALTY_PER_CLASS = 0.2;

/** Minimum XP multiplier floor when multiple base classes are uneven. */
export const MIN_MULTICLASS_XP_MULTIPLIER = 0.2;

/** Maximum allowed level difference between non-favored base classes before XP penalty applies. */
export const MAX_UNPENALIZED_BASE_CLASS_GAP = 1;

/**
 * Computes the Challenge Rating (CR) contribution of NPC class levels per DMG p. 38 & MM p. 294:
 * - For a standard NPC without Racial HD: Level 1 = CR 1/2 (`0.5`), Level >= 2 = `Level - 1`.
 * - For a monster with Racial HD: NPC class levels are always nonassociated (`+0.5 CR` per level).
 *
 * @param npcClassLevels Total levels in NPC classes (`isNpcClass === true`).
 * @param hasMonsterRacialHd True if the creature also has >= 1 Racial Hit Dice.
 * @returns CR contribution from the NPC class levels.
 */
export function computeNpcClassCrContribution(npcClassLevels: number, hasMonsterRacialHd = false): number {
  const safeLevels = Math.max(0, dndFloor(npcClassLevels));
  if (safeLevels === 0) return 0;
  if (hasMonsterRacialHd) {
    return safeLevels * MONSTER_NONASSOCIATED_NPC_CR_PER_LEVEL;
  }
  return safeLevels === 1 ? NPC_CLASS_LEVEL_1_CR : safeLevels - 1;
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
