import { rollD20 } from '../math/dice.ts';
import { SIZE_METRICS } from '../spatial/grid_geometry.ts';
import type { CreatureSizeCategory } from '../types/dnd35e.types.ts';

const DICE_PROGRESSION_LADDER: ReadonlyArray<string> = [
  '1',
  '1d2',
  '1d3',
  '1d4',
  '1d6',
  '1d8',
  '2d6',
  '3d6',
  '4d6',
  '6d6',
  '8d6',
  '12d6'
];

const ALTERNATE_DICE_LADDER_D8: ReadonlyArray<string> = [
  '1',
  '1d2',
  '1d3',
  '1d4',
  '1d6',
  '1d8',
  '2d6',
  '2d8',
  '3d8',
  '4d8',
  '6d8',
  '8d8',
  '12d8'
];

const ALTERNATE_DICE_LADDER_D10: ReadonlyArray<string> = [
  '1d2',
  '1d3',
  '1d4',
  '1d6',
  '1d8',
  '1d10',
  '2d8',
  '3d8',
  '4d8',
  '6d8',
  '8d8'
];

const ALTERNATE_DICE_LADDER_D12: ReadonlyArray<string> = [
  '1d3',
  '1d4',
  '1d6',
  '1d8',
  '1d10',
  '1d12',
  '3d6',
  '4d6',
  '6d6',
  '8d6',
  '12d6'
];

/**
 * Scales a weapon's base damage dice from a base creature size to a target creature size.
 */
export function scaleWeaponDamageDice(
  baseDice: string,
  baseSize: CreatureSizeCategory,
  targetSize: CreatureSizeCategory
): string {
  if (baseSize === targetSize) return baseDice;

  const baseRank = SIZE_METRICS[baseSize].rankIndex;
  const targetRank = SIZE_METRICS[targetSize].rankIndex;
  const stepDiff = targetRank - baseRank;

  let ladder = DICE_PROGRESSION_LADDER;
  if (baseDice === '1d8') ladder = ALTERNATE_DICE_LADDER_D8;
  else if (baseDice === '1d10') ladder = ALTERNATE_DICE_LADDER_D10;
  else if (baseDice === '1d12') ladder = ALTERNATE_DICE_LADDER_D12;

  const index = ladder.indexOf(baseDice);
  if (index === -1) {
    return baseDice;
  }

  const newIndex = Math.max(0, Math.min(ladder.length - 1, index + stepDiff));
  return ladder[newIndex]!;
}

const EFFORT_LADDER: ReadonlyArray<'light' | 'one_handed' | 'two_handed'> = ['light', 'one_handed', 'two_handed'];
const SIZE_MISMATCH_PENALTY_PER_STEP = 2;

/**
 * Evaluates whether a creature of size `wielderSize` can wield a weapon of size `weaponSize`,
 * applying the -2 attack roll penalty per size category difference and shifting effort categories.
 * (PHB p. 113: Inappropriately Sized Weapons).
 */
export function evaluateWeaponWieldingProfile(
  weaponSize: CreatureSizeCategory,
  weaponHandedness: 'light' | 'one_handed' | 'two_handed',
  wielderSize: CreatureSizeCategory
): {
  readonly wieldable: boolean;
  readonly effectiveHandedness?: 'light' | 'one_handed' | 'two_handed' | undefined;
  readonly attackPenalty: number;
  readonly reason?: string | undefined;
} {
  const wSizeRank = SIZE_METRICS[weaponSize].rankIndex;
  const cSizeRank = SIZE_METRICS[wielderSize].rankIndex;
  const stepDiff = wSizeRank - cSizeRank;
  const attackPenalty = stepDiff === 0 ? 0 : -Math.abs(stepDiff) * SIZE_MISMATCH_PENALTY_PER_STEP;

  const baseEffortIndex = EFFORT_LADDER.indexOf(weaponHandedness);
  const effectiveIndex = baseEffortIndex + stepDiff;

  if (effectiveIndex < 0 || effectiveIndex >= EFFORT_LADDER.length) {
    return {
      wieldable: false,
      attackPenalty,
      reason:
        effectiveIndex < 0
          ? 'Weapon is too small to be wielded effectively by this creature.'
          : 'Weapon is too large to be wielded by this creature.'
    };
  }

  return {
    wieldable: true,
    effectiveHandedness: EFFORT_LADDER[effectiveIndex]!,
    attackPenalty
  };
}

/**
 * Resolves magic item activation across the 4 canonical D&D 3.5e activation modes (DMG p. 213).
 */
export function resolveMagicItemActivation(
  activationType: 'use_activated' | 'command_word' | 'spell_completion' | 'spell_trigger',
  userHasSpellOnList: boolean,
  options?: {
    readonly userUmdModifier?: number | undefined;
    readonly spellLevel?: number | undefined;
    readonly casterLevel?: number | undefined;
    readonly scrollCasterLevel?: number | undefined;
    readonly forcedUmdRoll?: number | undefined;
  }
): {
  readonly activated: boolean;
  readonly dc?: number | undefined;
  readonly checkTotal?: number | undefined;
  readonly failureReason?: string | undefined;
} {
  if (activationType === 'use_activated' || activationType === 'command_word') {
    return { activated: true };
  }

  if (userHasSpellOnList) {
    if (activationType === 'spell_trigger') {
      return { activated: true };
    }

    const userCl = options?.casterLevel ?? 1;
    const scrollCl = options?.scrollCasterLevel ?? 1;
    if (userCl >= scrollCl) {
      return { activated: true };
    }

    const clRoll = rollD20('caster_level_check', userCl, options?.forcedUmdRoll);
    const clDc = scrollCl + 1;
    if (clRoll.total >= clDc) {
      return { activated: true, dc: clDc, checkTotal: clRoll.total };
    }
    return {
      activated: false,
      dc: clDc,
      checkTotal: clRoll.total,
      failureReason: 'caster_level_check_failed'
    };
  }

  const umdMod = options?.userUmdModifier ?? 0;
  const dc = activationType === 'spell_trigger' ? 20 : 20 + (options?.spellLevel ?? 1);
  const umdRoll = rollD20('skill_check', umdMod, options?.forcedUmdRoll);

  if (umdRoll.total >= dc) {
    return { activated: true, dc, checkTotal: umdRoll.total };
  }

  return {
    activated: false,
    dc,
    checkTotal: umdRoll.total,
    failureReason: 'use_magic_device_check_failed'
  };
}
