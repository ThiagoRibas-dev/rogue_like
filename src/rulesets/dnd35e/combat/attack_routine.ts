import type { TacticalDoctrineComponent, WeaponGripMode } from '../../../types/components.types.ts';
import type { ResolvedActorWeapons } from '../equipment_physics.ts';
import type { DnD35DamageType } from '../types/dnd35e_system.types.ts';
import { type AttackRollParams, computeHandednessStrDamage } from './attack_roll.ts';
import {
  buildFullAttackSequence,
  type CombatRuleOverrides,
  type NaturalWeaponLimbEntry
} from './full_attack_sequence.ts';
import { computeStrikeDoctrineDamageBonus, evaluateTacticalDoctrineModifiers } from './tactical_doctrine.ts';

/**
 * Resolved profile for an individual attack strike within an actor's attack routine.
 */
export interface DnD35ResolvedStrikeProfile {
  readonly index: number;
  readonly label: string;
  readonly attackSource: 'manufactured_primary' | 'manufactured_offhand' | 'natural_primary' | 'natural_secondary';
  readonly handedness: AttackRollParams['handedness'];
  readonly isNaturalOrUnarmed: boolean;
  readonly attackBonus: number;
  readonly weaponDice: string;
  readonly weaponDamageType: DnD35DamageType;
  readonly strDamageBonus: number;
  readonly doctrineDamageBonus: number;
  readonly flatDamageBonus: number;
  readonly critThreatMin: number;
  readonly critMultiplier: number;
  readonly bypassTags: ReadonlyArray<string>;
  readonly weaponId?: string | undefined;
  readonly naturalWeaponId?: string | undefined;
}

/**
 * Full resolved attack routine for an actor synthesized by Stage 4 of the Topological Stat DAG.
 */
export interface DnD35ResolvedAttackRoutine {
  readonly isPureNaturalRoutine: boolean;
  readonly gripMode: WeaponGripMode;
  readonly occupiedLimbGroupIds: ReadonlyArray<string>;
  readonly strikes: ReadonlyArray<DnD35ResolvedStrikeProfile>;
}

/**
 * Stage 4 Stat DAG routine synthesizer: Combines resolved manufactured weapons, grip mode,
 * occupied limbs, and demoted natural weapons into a complete ordered attack routine with
 * per-strike attack bonuses, STR damage, and Power Attack multipliers.
 */
export function resolveActorAttackRoutine(params: {
  readonly resolvedWeapons: ResolvedActorWeapons;
  readonly naturalWeapons?: ReadonlyArray<NaturalWeaponLimbEntry> | undefined;
  readonly totalBab: number;
  readonly baseAttackModifier: number;
  readonly strModifier: number;
  readonly doctrine?: TacticalDoctrineComponent | undefined;
  readonly flatDamageBonus: number;
  readonly hasTwoWeaponFightingFeat?: boolean | undefined;
  readonly hasMultiattackFeat?: boolean | undefined;
  readonly overrides?: CombatRuleOverrides | undefined;
}): DnD35ResolvedAttackRoutine {
  const primary = params.resolvedWeapons.primaryWeapon;
  const offHands = params.resolvedWeapons.offHandWeapons;
  const isPureNaturalRoutine = !primary.isArmed && (params.naturalWeapons ?? []).length > 0;

  const hasOffHand = offHands.length > 0;
  const offHandIsLight = hasOffHand && offHands.every((w) => w.handedness === 'light');
  const offHandWeaponIds = offHands.map((w) => w.weaponItemId);

  let doctrineAtkPenalty = 0;
  if (params.doctrine) {
    const doctrineEval = evaluateTacticalDoctrineModifiers(params.doctrine, params.totalBab, primary.handedness, 0);
    doctrineAtkPenalty = doctrineEval.attackPenalty;
  }

  const seq = buildFullAttackSequence({
    totalBab: params.totalBab,
    baseAttackModifier: params.baseAttackModifier + doctrineAtkPenalty,
    isPureNaturalRoutine,
    hasOffHandWeapon: hasOffHand,
    offHandIsLight,
    hasTwoWeaponFightingFeat: params.hasTwoWeaponFightingFeat,
    hasMultiattackFeat: params.hasMultiattackFeat,
    overrides: params.overrides,
    weaponId: primary.weaponItemId,
    offHandWeaponId: offHands[0]?.weaponItemId,
    offHandWeaponIds,
    naturalWeaponLimbs: params.naturalWeapons,
    occupiedLimbGroupIds: params.resolvedWeapons.occupiedLimbGroupIds
  });

  const strikes: DnD35ResolvedStrikeProfile[] = [];
  let offHandCounter = 0;

  for (let i = 0; i < seq.entries.length; i++) {
    const entry = seq.entries[i]!;

    if (entry.attackSource === 'manufactured_primary') {
      const strikeHandedness = primary.handedness;
      const isNaturalOrUnarmed = !primary.isArmed;
      const strDmg =
        primary.cannotTwoHandStr && strikeHandedness === 'two_handed'
          ? computeHandednessStrDamage(params.strModifier, 'one_handed')
          : computeHandednessStrDamage(params.strModifier, strikeHandedness);
      const doctrineDmg = computeStrikeDoctrineDamageBonus(
        params.doctrine,
        params.totalBab,
        strikeHandedness,
        isNaturalOrUnarmed,
        primary.cannotTwoHandStr
      );

      strikes.push({
        index: i,
        label: primary.weaponName,
        attackSource: 'manufactured_primary',
        handedness: strikeHandedness,
        isNaturalOrUnarmed,
        attackBonus:
          entry.attackBonus + primary.attackBonus + primary.sizeAttackPenalty + primary.nonproficiencyPenalty,
        weaponDice: primary.weaponDice,
        weaponDamageType: primary.weaponDamageType,
        strDamageBonus: strDmg,
        doctrineDamageBonus: doctrineDmg,
        flatDamageBonus: params.flatDamageBonus + primary.damageBonus,
        critThreatMin: primary.critThreatMin,
        critMultiplier: primary.critMultiplier,
        bypassTags: primary.bypassTags,
        weaponId: primary.weaponItemId
      });
    } else if (entry.attackSource === 'manufactured_offhand') {
      const offWeapon =
        offHands.find((w) => w.weaponItemId === entry.weaponId) ??
        offHands[offHandCounter % Math.max(1, offHands.length)] ??
        primary;
      offHandCounter++;

      const strikeHandedness: AttackRollParams['handedness'] = 'off_hand';
      const isNaturalOrUnarmed = !offWeapon.isArmed;
      const strDmg = computeHandednessStrDamage(params.strModifier, strikeHandedness);
      const doctrineDmg = computeStrikeDoctrineDamageBonus(
        params.doctrine,
        params.totalBab,
        strikeHandedness,
        isNaturalOrUnarmed,
        offWeapon.cannotTwoHandStr
      );

      strikes.push({
        index: i,
        label: offWeapon.weaponName,
        attackSource: 'manufactured_offhand',
        handedness: strikeHandedness,
        isNaturalOrUnarmed,
        attackBonus:
          entry.attackBonus + offWeapon.attackBonus + offWeapon.sizeAttackPenalty + offWeapon.nonproficiencyPenalty,
        weaponDice: offWeapon.weaponDice,
        weaponDamageType: offWeapon.weaponDamageType,
        strDamageBonus: strDmg,
        doctrineDamageBonus: doctrineDmg,
        flatDamageBonus: params.flatDamageBonus + offWeapon.damageBonus,
        critThreatMin: offWeapon.critThreatMin,
        critMultiplier: offWeapon.critMultiplier,
        bypassTags: offWeapon.bypassTags,
        weaponId: offWeapon.weaponItemId
      });
    } else if (entry.attackSource === 'natural_primary') {
      const natLimb = params.naturalWeapons?.find((nw) => nw.id === entry.naturalWeaponId);
      const isSole = (params.naturalWeapons?.length ?? 0) === 1 && (params.naturalWeapons?.[0]?.count ?? 0) === 1;
      const strikeHandedness: AttackRollParams['handedness'] = isSole ? 'primary_natural_sole' : 'one_handed';
      const strDmg = computeHandednessStrDamage(params.strModifier, strikeHandedness);
      const doctrineDmg = computeStrikeDoctrineDamageBonus(params.doctrine, params.totalBab, strikeHandedness, true);

      strikes.push({
        index: i,
        label: natLimb?.name ?? entry.naturalWeaponId ?? 'Primary Natural Attack',
        attackSource: 'natural_primary',
        handedness: strikeHandedness,
        isNaturalOrUnarmed: true,
        attackBonus: entry.attackBonus,
        weaponDice: natLimb?.dice ?? '1d4',
        weaponDamageType: natLimb?.damageType ?? 'slashing',
        strDamageBonus: strDmg,
        doctrineDamageBonus: doctrineDmg,
        flatDamageBonus: params.flatDamageBonus,
        critThreatMin: natLimb?.critThreatMin ?? 20,
        critMultiplier: natLimb?.critMultiplier ?? 2,
        bypassTags: [natLimb?.damageType ?? 'slashing'],
        naturalWeaponId: entry.naturalWeaponId
      });
    } else if (entry.attackSource === 'natural_secondary') {
      const natLimb = params.naturalWeapons?.find((nw) => nw.id === entry.naturalWeaponId);
      const strikeHandedness: AttackRollParams['handedness'] = 'off_hand';
      const strDmg = computeHandednessStrDamage(params.strModifier, strikeHandedness);
      const doctrineDmg = computeStrikeDoctrineDamageBonus(params.doctrine, params.totalBab, strikeHandedness, true);

      strikes.push({
        index: i,
        label: natLimb?.name ?? entry.naturalWeaponId ?? 'Secondary Natural Attack',
        attackSource: 'natural_secondary',
        handedness: strikeHandedness,
        isNaturalOrUnarmed: true,
        attackBonus: entry.attackBonus,
        weaponDice: natLimb?.dice ?? '1d4',
        weaponDamageType: natLimb?.damageType ?? 'slashing',
        strDamageBonus: strDmg,
        doctrineDamageBonus: doctrineDmg,
        flatDamageBonus: params.flatDamageBonus,
        critThreatMin: natLimb?.critThreatMin ?? 20,
        critMultiplier: natLimb?.critMultiplier ?? 2,
        bypassTags: [natLimb?.damageType ?? 'slashing'],
        naturalWeaponId: entry.naturalWeaponId
      });
    }
  }

  return {
    isPureNaturalRoutine,
    gripMode: params.resolvedWeapons.gripMode,
    occupiedLimbGroupIds: params.resolvedWeapons.occupiedLimbGroupIds,
    strikes
  };
}

/**
 * Checks if a Cleave / Great Cleave follow-up attack is granted after dropping a foe to <= 0 HP.
 */
export function resolveCleaveFollowupEligibility(
  droppedFoe: boolean,
  cleavesUsedThisRound: number,
  hasGreatCleave: boolean
): boolean {
  if (!droppedFoe) return false;
  if (hasGreatCleave) return true;
  return cleavesUsedThisRound === 0;
}

/**
 * Resolves all eligible melee targets within reach for a Whirlwind Attack.
 */
export function resolveWhirlwindTargets(
  attackerPos: { readonly x: number; readonly y: number },
  reachFt: number,
  potentialTargets: ReadonlyArray<{
    readonly entityId: number;
    readonly pos: { readonly x: number; readonly y: number };
  }>
): ReadonlyArray<number> {
  const reachTiles = Math.max(1, Math.floor(reachFt / 5));
  const validTargetIds: number[] = [];

  for (const target of potentialTargets) {
    const dx = Math.abs(attackerPos.x - target.pos.x);
    const dy = Math.abs(attackerPos.y - target.pos.y);
    const dist = Math.max(dx, dy);
    if (dist <= reachTiles && (dx > 0 || dy > 0)) {
      validTargetIds.push(target.entityId);
    }
  }

  return validTargetIds;
}
