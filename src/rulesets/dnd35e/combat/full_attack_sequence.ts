import { getIterativeBabSequence } from '../progression.ts';
import type { DnD35DamageType } from '../types/dnd35e_system.types.ts';

/** Secondary natural weapon attack penalty without Multiattack (`-5`). */
const SECONDARY_NATURAL_PENALTY = -5;

/** Secondary natural weapon attack penalty with Multiattack feat (`-2`). */
const MULTIATTACK_SECONDARY_PENALTY = -2;

/**
 * Declarative rule overrides parameterizing full attacks and two-weapon/natural combat.
 */
export interface CombatRuleOverrides {
  readonly secondaryNaturalPenalty?: number | undefined;
  readonly twfPrimaryPenalty?: number | undefined;
  readonly twfOffHandPenalty?: number | undefined;
  readonly extraOffHandAttacks?: number | undefined;
  readonly naturalAttacksCountMultiplier?: number | undefined;
  readonly manufacturedPrimaryCount?: number | undefined;
}

/**
 * An individual attack entry in a full attack sequence.
 */
export interface FullAttackSequenceEntry {
  readonly attackSource: 'manufactured_primary' | 'manufactured_offhand' | 'natural_primary' | 'natural_secondary';
  readonly attackBonus: number;
  readonly weaponId?: string | undefined;
  readonly naturalWeaponId?: string | undefined;
}

/**
 * Descriptor for a natural weapon limb entry used when filtering out limbs occupied by manufactured weapons.
 */
export interface NaturalWeaponLimbEntry {
  readonly id: string;
  readonly isPrimary: boolean;
  readonly count: number;
  readonly limbGroupId?: string | undefined;
  readonly name?: string | undefined;
  readonly dice?: string | undefined;
  readonly damageType?: DnD35DamageType | undefined;
  readonly critThreatMin?: number | undefined;
  readonly critMultiplier?: number | undefined;
}

/**
 * Builds the ordered attack bonus sequence for a `Full-Round Attack` combining:
 * 1. **Pure Natural Routine** (`isPureNaturalRoutine === true`): Primary natural weapons at full `BAB`
 *    (`attackSource: 'natural_primary'`) + secondary natural weapons at `BAB + secondaryNaturalPenalty`
 *    (`attackSource: 'natural_secondary'`).
 * 2. **Combined Manufactured + Natural Routine** (default): Primary manufactured weapon executes full
 *    iterative `BAB` sequence (plus any off-hand weapon attacks across extra limbs), while all natural
 *    weapons whose `limbGroupId` is NOT occupied by a manufactured weapon (`occupiedLimbGroupIds`)
 *    are automatically demoted to secondary natural attacks (`-5` baseline, `-2` with *Multiattack*)
 *    without imposing TWF penalties on the primary manufactured weapon.
 *
 * @param options Full attack configuration with optional declarative overrides.
 * @returns Object with primaryAttacks, offHandAttacks, naturalAttacks, and entries.
 */
export function buildFullAttackSequence(options: {
  readonly totalBab: number;
  readonly baseAttackModifier: number;
  readonly isPureNaturalRoutine?: boolean | undefined;
  readonly primaryNaturalCount?: number | undefined;
  readonly primaryNaturalIds?: ReadonlyArray<string> | undefined;
  readonly hasOffHandWeapon?: boolean | undefined;
  readonly offHandIsLight?: boolean | undefined;
  readonly hasTwoWeaponFightingFeat?: boolean | undefined;
  readonly secondaryNaturalCount?: number | undefined;
  readonly hasMultiattackFeat?: boolean | undefined;
  readonly overrides?: CombatRuleOverrides | undefined;
  readonly weaponId?: string | undefined;
  readonly offHandWeaponId?: string | undefined;
  readonly offHandWeaponIds?: ReadonlyArray<string | undefined> | undefined;
  readonly secondaryNaturalIds?: ReadonlyArray<string> | undefined;
  readonly naturalWeaponLimbs?: ReadonlyArray<NaturalWeaponLimbEntry> | undefined;
  readonly occupiedLimbGroupIds?: ReadonlyArray<string> | undefined;
}): {
  readonly primaryAttacks: ReadonlyArray<number>;
  readonly offHandAttacks: ReadonlyArray<number>;
  readonly naturalAttacks: ReadonlyArray<number>;
  readonly entries: ReadonlyArray<FullAttackSequenceEntry>;
} {
  const nonBabMod = options.baseAttackModifier - options.totalBab;

  let natPenalty = SECONDARY_NATURAL_PENALTY;
  if (options.overrides?.secondaryNaturalPenalty !== undefined) {
    natPenalty = options.overrides.secondaryNaturalPenalty;
  } else if (options.hasMultiattackFeat === true) {
    natPenalty = MULTIATTACK_SECONDARY_PENALTY;
  }

  const occupiedSet = new Set<string>(options.occupiedLimbGroupIds ?? []);
  const unblockedNaturalLimbs = (options.naturalWeaponLimbs ?? []).filter(
    (nw) => nw.limbGroupId === undefined || !occupiedSet.has(nw.limbGroupId)
  );

  // Branch 1: Pure Natural Attack Routine (no manufactured weapon wielded)
  if (options.isPureNaturalRoutine === true) {
    const primaryAttacks: number[] = [];
    const naturalAttacks: number[] = [];
    const entries: FullAttackSequenceEntry[] = [];

    if (unblockedNaturalLimbs.length > 0) {
      for (const nw of unblockedNaturalLimbs) {
        for (let i = 0; i < nw.count; i++) {
          if (nw.isPrimary) {
            const bonus = options.totalBab + nonBabMod;
            primaryAttacks.push(bonus);
            entries.push({
              attackSource: 'natural_primary',
              attackBonus: bonus,
              naturalWeaponId: nw.id
            });
          } else {
            const bonus = options.totalBab + nonBabMod + natPenalty;
            naturalAttacks.push(bonus);
            entries.push({
              attackSource: 'natural_secondary',
              attackBonus: bonus,
              naturalWeaponId: nw.id
            });
          }
        }
      }
    } else {
      const primCount = options.primaryNaturalCount ?? 1;
      for (let i = 0; i < primCount; i++) {
        const bonus = options.totalBab + nonBabMod;
        primaryAttacks.push(bonus);
        entries.push({
          attackSource: 'natural_primary',
          attackBonus: bonus,
          naturalWeaponId: options.primaryNaturalIds?.[i]
        });
      }
      const secCount = options.secondaryNaturalCount ?? 0;
      for (let i = 0; i < secCount; i++) {
        const bonus = options.totalBab + nonBabMod + natPenalty;
        naturalAttacks.push(bonus);
        entries.push({
          attackSource: 'natural_secondary',
          attackBonus: bonus,
          naturalWeaponId: options.secondaryNaturalIds?.[i]
        });
      }
    }

    return {
      primaryAttacks,
      offHandAttacks: [],
      naturalAttacks,
      entries
    };
  }

  // Branch 2: Manufactured Weapon + Demoted Secondary Natural Weapons
  const iterBabs = getIterativeBabSequence(options.totalBab);
  let twfPrimaryPenalty = 0;
  let twfOffHandPenalty = 0;

  if (options.overrides?.twfPrimaryPenalty !== undefined) {
    twfPrimaryPenalty = options.overrides.twfPrimaryPenalty;
  } else if (options.hasOffHandWeapon === true) {
    if (options.hasTwoWeaponFightingFeat === true) {
      twfPrimaryPenalty = options.offHandIsLight === true ? -2 : -4;
    } else {
      twfPrimaryPenalty = options.offHandIsLight === true ? -4 : -6;
    }
  }

  if (options.overrides?.twfOffHandPenalty !== undefined) {
    twfOffHandPenalty = options.overrides.twfOffHandPenalty;
  } else if (options.hasOffHandWeapon === true) {
    if (options.hasTwoWeaponFightingFeat === true) {
      twfOffHandPenalty = options.offHandIsLight === true ? -2 : -4;
    } else {
      twfOffHandPenalty = options.offHandIsLight === true ? -8 : -10;
    }
  }

  const primaryAttacks = iterBabs.map((b) => b + nonBabMod + twfPrimaryPenalty);

  const offHandCount =
    options.offHandWeaponIds && options.offHandWeaponIds.length > 0
      ? options.offHandWeaponIds.length + (options.overrides?.extraOffHandAttacks ?? 0)
      : options.hasOffHandWeapon === true
        ? 1 + (options.overrides?.extraOffHandAttacks ?? 0)
        : 0;
  const offHandAttacks: number[] = [];
  for (let i = 0; i < offHandCount; i++) {
    const offHandBabPenalty = options.offHandWeaponIds && i < options.offHandWeaponIds.length ? 0 : i * 5;
    offHandAttacks.push(Math.max(1, options.totalBab - offHandBabPenalty) + nonBabMod + twfOffHandPenalty);
  }

  const naturalAttacks: number[] = [];
  const resolvedSecondaryNaturalIds: (string | undefined)[] = [];

  if (unblockedNaturalLimbs.length > 0) {
    for (const nw of unblockedNaturalLimbs) {
      for (let i = 0; i < nw.count; i++) {
        naturalAttacks.push(options.totalBab + nonBabMod + natPenalty);
        resolvedSecondaryNaturalIds.push(nw.id);
      }
    }
  } else {
    const natCount = options.secondaryNaturalCount ?? 0;
    for (let i = 0; i < natCount; i++) {
      naturalAttacks.push(options.totalBab + nonBabMod + natPenalty);
      resolvedSecondaryNaturalIds.push(options.secondaryNaturalIds?.[i]);
    }
  }

  const entries: FullAttackSequenceEntry[] = [];
  for (const atk of primaryAttacks) {
    entries.push({
      attackSource: 'manufactured_primary',
      attackBonus: atk,
      weaponId: options.weaponId
    });
  }
  for (let i = 0; i < offHandAttacks.length; i++) {
    const atk = offHandAttacks[i]!;
    const wId = options.offHandWeaponIds?.[i] ?? options.offHandWeaponId;
    entries.push({
      attackSource: 'manufactured_offhand',
      attackBonus: atk,
      weaponId: wId
    });
  }
  for (let i = 0; i < naturalAttacks.length; i++) {
    const atk = naturalAttacks[i]!;
    entries.push({
      attackSource: 'natural_secondary',
      attackBonus: atk,
      naturalWeaponId: resolvedSecondaryNaturalIds[i]
    });
  }

  return {
    primaryAttacks,
    offHandAttacks,
    naturalAttacks,
    entries
  };
}
