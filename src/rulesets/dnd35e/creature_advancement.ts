import { scaleWeaponDamageDice } from './equipment_physics.ts';
import { dndFloor } from './math/multipliers.ts';
import { SIZE_METRICS } from './spatial/grid_geometry.ts';
import type { CreatureSizeCategory } from './types/dnd35e.types.ts';
import type { DnD35Archetype } from './types/dnd35e_system.types.ts';

interface SizeStatRow {
  readonly str: number;
  readonly dex: number;
  readonly con: number;
  readonly naturalArmor: number;
}

/**
 * Cumulative size delta benchmarks from Medium (`rankIndex === 0`).
 * Based on SRD "Improving Monsters" Table: Changes to Statistics by Size.
 * Small -> Medium: STR +4, DEX -2, CON +2, NA +0
 * Medium -> Large: STR +8, DEX -2, CON +4, NA +2
 * Large -> Huge: STR +8, DEX -2, CON +4, NA +3
 * Huge -> Gargantuan: STR +8, DEX +0, CON +4, NA +4
 * Gargantuan -> Colossal: STR +8, DEX +0, CON +4, NA +5
 */
const CUMULATIVE_SIZE_OFFSETS: Readonly<Record<CreatureSizeCategory, SizeStatRow>> = {
  fine:       { str: -10, dex: 8,  con: -4, naturalArmor: 0 },
  diminutive: { str: -8,  dex: 6,  con: -4, naturalArmor: 0 },
  tiny:       { str: -6,  dex: 4,  con: -2, naturalArmor: 0 },
  small:      { str: -4,  dex: 2,  con: -2, naturalArmor: 0 },
  medium:     { str: 0,   dex: 0,  con: 0,  naturalArmor: 0 },
  large:      { str: 8,   dex: -2, con: 4,  naturalArmor: 2 },
  huge:       { str: 16,  dex: -4, con: 8,  naturalArmor: 5 },
  gargantuan: { str: 24,  dex: -4, con: 12, naturalArmor: 9 },
  colossal:   { str: 32,  dex: -4, con: 16, naturalArmor: 14 }
};

/**
 * Advances a D&D 3.5e Monster Archetype to a target Hit Dice count,
 * applying size category shifts (if matching an advancementRanges bracket),
 * SRD ability adjustments, natural armor scaling, natural weapon dice scaling,
 * BAB, saves, and CR calculations.
 *
 * @param archetype Baseline DnD35Archetype definition.
 * @param targetHitDice New target racial Hit Dice count.
 * @returns Advanced DnD35Archetype.
 */
export function advanceMonsterByHitDice(
  archetype: DnD35Archetype,
  targetHitDice: number
): DnD35Archetype {
  const currentHd = archetype.tracks.reduce((sum, t) => sum + t.levels, 0);
  const clampedTargetHd = Math.max(1, targetHitDice);
  const additionalHd = Math.max(0, clampedTargetHd - currentHd);

  // 1. Determine target size category from advancementRanges
  let targetSize: CreatureSizeCategory = archetype.sizeCategory;
  let rangeCrAdjustment = 0;

  if (archetype.advancementRanges && archetype.advancementRanges.length > 0) {
    for (const range of archetype.advancementRanges) {
      if (clampedTargetHd >= range.minHd && clampedTargetHd <= range.maxHd) {
        targetSize = range.sizeCategory;
        rangeCrAdjustment = range.crAdjustment;
        break;
      }
    }
  }

  // 2. Compute size deltas
  const currentSizeOffsets = CUMULATIVE_SIZE_OFFSETS[archetype.sizeCategory];
  const targetSizeOffsets = CUMULATIVE_SIZE_OFFSETS[targetSize];

  const deltaStr = targetSizeOffsets.str - currentSizeOffsets.str;
  const deltaDex = targetSizeOffsets.dex - currentSizeOffsets.dex;
  const deltaCon = targetSizeOffsets.con - currentSizeOffsets.con;
  const deltaNatArmor = targetSizeOffsets.naturalArmor - currentSizeOffsets.naturalArmor;

  // 3. Adjust Ability Scores (size deltas + +1 per 4th Hit Die milestone to highest ability score)
  const earnedHdAbilityIncreases = Math.max(0, dndFloor(clampedTargetHd / 4) - dndFloor(currentHd / 4));
  const rawAdjusted: Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number | null> = {
    str: archetype.abilityScores.str !== null ? Math.max(1, archetype.abilityScores.str + deltaStr) : null,
    dex: archetype.abilityScores.dex !== null ? Math.max(1, archetype.abilityScores.dex + deltaDex) : null,
    con: archetype.abilityScores.con !== null ? Math.max(1, archetype.abilityScores.con + deltaCon) : null,
    int: archetype.abilityScores.int,
    wis: archetype.abilityScores.wis,
    cha: archetype.abilityScores.cha
  };

  if (earnedHdAbilityIncreases > 0) {
    const statOrder: ReadonlyArray<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'> = [
      'str',
      'dex',
      'con',
      'int',
      'wis',
      'cha'
    ];
    let highestStat: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' | null = null;
    let highestVal = -1;
    for (const key of statOrder) {
      const val = rawAdjusted[key];
      if (val !== null && val > highestVal) {
        highestVal = val;
        highestStat = key;
      }
    }
    if (highestStat !== null && rawAdjusted[highestStat] !== null) {
      rawAdjusted[highestStat] = rawAdjusted[highestStat]! + earnedHdAbilityIncreases;
    }
  }

  const nextAbilityScores = rawAdjusted;

  // 4. Scale Natural Armor
  const nextNaturalArmor = Math.max(0, archetype.naturalArmorBonus + deltaNatArmor);

  // 5. Scale Weapon & Natural Attack Dice
  const nextWeaponDice = scaleWeaponDamageDice(archetype.weaponDice, archetype.sizeCategory, targetSize);
  const nextNaturalWeapons = archetype.naturalWeapons.map((nw) => ({
    ...nw,
    damageDice: scaleWeaponDamageDice(nw.damageDice, archetype.sizeCategory, targetSize)
  }));

  // 6. Update Hit Die Track
  const firstTrack = archetype.tracks[0];
  const nextTracks = firstTrack
    ? [
        {
          ...firstTrack,
          levels: clampedTargetHd
        },
        ...archetype.tracks.slice(1)
      ]
    : archetype.tracks;

  // 7. CR adjustment (+1 per size category step up, +1 per 2-4 HD added depending on type)
  const baseCr = archetype.cr ?? 1;
  const sizeStepUp = Math.max(
    0,
    SIZE_METRICS[targetSize].rankIndex - SIZE_METRICS[archetype.sizeCategory].rankIndex
  );
  const hdCrDivisor = archetype.creatureType === 'dragon' || archetype.creatureType === 'outsider' ? 2 : 3;
  const hdCrBonus = dndFloor(additionalHd / hdCrDivisor);
  const computedCr = baseCr + sizeStepUp + hdCrBonus + rangeCrAdjustment;

  return {
    ...archetype,
    sizeCategory: targetSize,
    abilityScores: nextAbilityScores,
    tracks: nextTracks,
    naturalArmorBonus: nextNaturalArmor,
    weaponDice: nextWeaponDice,
    naturalWeapons: nextNaturalWeapons,
    cr: computedCr
  };
}
