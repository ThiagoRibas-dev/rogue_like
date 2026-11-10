import type { TacticalDoctrineComponent, WeaponGripMode } from '../../../types/components.types.ts';
import type { ResolvedActorWeapons } from '../equipment_physics.ts';
import type { DnD35DamageType, DnD35WeaponDamageRider } from '../types/dnd35e_system.types.ts';
import { type AttackRollParams, computeHandednessStrDamage } from './attack_roll.ts';
import {
  buildFullAttackSequence,
  type CombatRuleOverrides,
  type NaturalWeaponLimbEntry
} from './full_attack_sequence.ts';
import { resolveTypedModifiers, resolveTypedModifiersWithBreakdown } from '../modifiers/stacking_engine.ts';
import type { StatModifier, StatResolutionBreakdown } from '../types/dnd35e.types.ts';
import { computeExpandedCritThreatMin } from '../equipment/weapon_profile_parser.ts';
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
  readonly damageRiders?: ReadonlyArray<DnD35WeaponDamageRider> | undefined;
  readonly critThreatBreakdown?: StatResolutionBreakdown | undefined;
  readonly weaponId?: string | undefined;
  readonly baseWeaponId?: string | undefined;
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
  readonly dexModifier?: number | undefined;
  readonly hasWeaponFinesse?: boolean | undefined;
  readonly doctrine?: TacticalDoctrineComponent | undefined;
  readonly flatDamageBonus: number;
  readonly hasTwoWeaponFightingFeat?: boolean | undefined;
  readonly hasMultiattackFeat?: boolean | undefined;
  readonly overrides?: CombatRuleOverrides | undefined;
  readonly statModifiers?: ReadonlyArray<StatModifier> | undefined;
  readonly selfTags?: ReadonlyArray<string> | undefined;
  readonly targetTags?: ReadonlyArray<string> | undefined;
}): DnD35ResolvedAttackRoutine {
  const primary = params.resolvedWeapons.primaryWeapon;
  const offHands = params.resolvedWeapons.offHandWeapons;
  const isPureNaturalRoutine = !primary.isArmed && (params.naturalWeapons ?? []).length > 0;
  const finesseDelta =
    params.hasWeaponFinesse === true && params.dexModifier !== undefined
      ? Math.max(0, params.dexModifier - params.strModifier)
      : 0;

  const hasOffHand = offHands.length > 0;
  const offHandIsLight = hasOffHand && offHands.every((w) => w.handedness === 'light');
  const offHandWeaponIds = offHands.map((w) => w.weaponItemId);

  let doctrineAtkPenalty = 0;
  if (params.doctrine) {
    const doctrineEval = evaluateTacticalDoctrineModifiers(params.doctrine, params.totalBab, primary.handedness, 0);
    doctrineAtkPenalty = doctrineEval.attackPenalty;
  }

  const extraFullBabMods = (params.statModifiers ?? []).filter((m) => m.targetStat === 'extra_full_bab_attacks');
  const primaryWeaponTags = primary.weaponItemId
    ? [`weapon:${primary.weaponItemId}`, ...(primary.baseWeaponId ? [`weapon:${primary.baseWeaponId}`] : [])]
    : undefined;
  const extraFullBabFromMods = resolveTypedModifiers(extraFullBabMods, {
    selfTags: params.selfTags,
    targetTags: params.targetTags,
    effectTags: primaryWeaponTags
  });
  const extraPrimaryFullBabAttacks = Math.max(
    0,
    (params.overrides?.extraPrimaryFullBabAttacks ?? 0) + extraFullBabFromMods
  );

  const seq = buildFullAttackSequence({
    totalBab: params.totalBab,
    baseAttackModifier: params.baseAttackModifier + doctrineAtkPenalty,
    isPureNaturalRoutine,
    hasOffHandWeapon: hasOffHand,
    offHandIsLight,
    hasTwoWeaponFightingFeat: params.hasTwoWeaponFightingFeat,
    hasMultiattackFeat: params.hasMultiattackFeat,
    overrides: {
      ...params.overrides,
      extraPrimaryFullBabAttacks
    },
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
    const isManufactured =
      entry.attackSource === 'manufactured_primary' || entry.attackSource === 'manufactured_offhand';
    const offWeapon =
      entry.attackSource === 'manufactured_offhand'
        ? (offHands.find((w) => w.weaponItemId === entry.weaponId) ??
          offHands[offHandCounter % Math.max(1, offHands.length)] ??
          primary)
        : undefined;

    const strikeWeaponId = isManufactured
      ? entry.attackSource === 'manufactured_primary'
        ? primary.weaponItemId
        : (offWeapon?.weaponItemId ?? entry.weaponId)
      : entry.naturalWeaponId;

    const strikeBaseWeaponId = isManufactured
      ? entry.attackSource === 'manufactured_primary'
        ? (primary.baseWeaponId ?? primary.weaponItemId)
        : (offWeapon?.baseWeaponId ?? offWeapon?.weaponItemId ?? entry.weaponId)
      : entry.naturalWeaponId;

    const strikeEffectTags: string[] = [
      ...(strikeBaseWeaponId !== undefined ? [`weapon:${strikeBaseWeaponId}`] : []),
      ...(strikeWeaponId !== undefined && strikeWeaponId !== strikeBaseWeaponId ? [`weapon:${strikeWeaponId}`] : []),
      `attack_source:${entry.attackSource}`,
      isManufactured ? 'weapon_group:manufactured' : 'weapon_group:natural'
    ];

    const strikeCandidateMods = params.statModifiers ?? [];
    let strikeAttackMod = 0;
    let strikeDamageMod = 0;
    let critThreatExpansionSteps = 0;
    let critThreatBreakdown: StatResolutionBreakdown | undefined;

    if (strikeCandidateMods.length > 0) {
      const atkBreakdown = resolveTypedModifiersWithBreakdown(
        strikeCandidateMods.filter((m) => m.targetStat === 'strike_attack'),
        { selfTags: params.selfTags, targetTags: params.targetTags, effectTags: strikeEffectTags }
      );
      strikeAttackMod = atkBreakdown.total;

      const dmgBreakdown = resolveTypedModifiersWithBreakdown(
        strikeCandidateMods.filter((m) => m.targetStat === 'strike_damage'),
        { selfTags: params.selfTags, targetTags: params.targetTags, effectTags: strikeEffectTags }
      );
      strikeDamageMod = dmgBreakdown.total;

      critThreatBreakdown = resolveTypedModifiersWithBreakdown(
        strikeCandidateMods.filter((m) => m.targetStat === 'crit_threat_doubling'),
        { selfTags: params.selfTags, targetTags: params.targetTags, effectTags: strikeEffectTags }
      );
      critThreatExpansionSteps = critThreatBreakdown.total;
    }

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
      const primaryFinesseBonus =
        primary.isFinesseEligible === true || primary.handedness === 'light' || isNaturalOrUnarmed ? finesseDelta : 0;
      const critMin =
        critThreatExpansionSteps > 0
          ? computeExpandedCritThreatMin(primary.baseCritThreatMin ?? primary.critThreatMin, critThreatExpansionSteps)
          : primary.critThreatMin;

      strikes.push({
        index: i,
        label: primary.weaponName,
        attackSource: 'manufactured_primary',
        handedness: strikeHandedness,
        isNaturalOrUnarmed,
        attackBonus:
          entry.attackBonus +
          primary.attackBonus +
          primary.sizeAttackPenalty +
          primary.nonproficiencyPenalty +
          primaryFinesseBonus +
          strikeAttackMod,
        weaponDice: primary.weaponDice,
        weaponDamageType: primary.weaponDamageType,
        strDamageBonus: strDmg,
        doctrineDamageBonus: doctrineDmg,
        flatDamageBonus: params.flatDamageBonus + primary.damageBonus + strikeDamageMod,
        critThreatMin: critMin,
        critMultiplier: primary.critMultiplier,
        bypassTags: primary.bypassTags,
        damageRiders: primary.damageRiders,
        critThreatBreakdown,
        weaponId: primary.weaponItemId,
        baseWeaponId: primary.baseWeaponId ?? primary.weaponItemId
      });
    } else if (entry.attackSource === 'manufactured_offhand') {
      const currentOffWeapon = offWeapon ?? primary;
      offHandCounter++;

      const strikeHandedness: AttackRollParams['handedness'] = 'off_hand';
      const isNaturalOrUnarmed = !currentOffWeapon.isArmed;
      const strDmg = computeHandednessStrDamage(params.strModifier, strikeHandedness);
      const doctrineDmg = computeStrikeDoctrineDamageBonus(
        params.doctrine,
        params.totalBab,
        strikeHandedness,
        isNaturalOrUnarmed,
        currentOffWeapon.cannotTwoHandStr
      );
      const offFinesseBonus =
        currentOffWeapon.isFinesseEligible === true || currentOffWeapon.handedness === 'light' || isNaturalOrUnarmed
          ? finesseDelta
          : 0;
      const critMin =
        critThreatExpansionSteps > 0
          ? computeExpandedCritThreatMin(
              currentOffWeapon.baseCritThreatMin ?? currentOffWeapon.critThreatMin,
              critThreatExpansionSteps
            )
          : currentOffWeapon.critThreatMin;

      strikes.push({
        index: i,
        label: currentOffWeapon.weaponName,
        attackSource: 'manufactured_offhand',
        handedness: strikeHandedness,
        isNaturalOrUnarmed,
        attackBonus:
          entry.attackBonus +
          currentOffWeapon.attackBonus +
          currentOffWeapon.sizeAttackPenalty +
          currentOffWeapon.nonproficiencyPenalty +
          offFinesseBonus +
          strikeAttackMod,
        weaponDice: currentOffWeapon.weaponDice,
        weaponDamageType: currentOffWeapon.weaponDamageType,
        strDamageBonus: strDmg,
        doctrineDamageBonus: doctrineDmg,
        flatDamageBonus: params.flatDamageBonus + currentOffWeapon.damageBonus + strikeDamageMod,
        critThreatMin: critMin,
        critMultiplier: currentOffWeapon.critMultiplier,
        bypassTags: currentOffWeapon.bypassTags,
        damageRiders: currentOffWeapon.damageRiders,
        critThreatBreakdown,
        weaponId: currentOffWeapon.weaponItemId,
        baseWeaponId: currentOffWeapon.baseWeaponId ?? currentOffWeapon.weaponItemId
      });
    } else {
      const isPrimary = entry.attackSource === 'natural_primary';
      const natLimb = params.naturalWeapons?.find((nw) => nw.id === entry.naturalWeaponId);
      const isSole =
        isPrimary && (params.naturalWeapons?.length ?? 0) === 1 && (params.naturalWeapons?.[0]?.count ?? 0) === 1;
      const strikeHandedness: AttackRollParams['handedness'] = isPrimary
        ? isSole
          ? 'primary_natural_sole'
          : 'one_handed'
        : 'off_hand';
      const strDmg = computeHandednessStrDamage(params.strModifier, strikeHandedness);
      const doctrineDmg = computeStrikeDoctrineDamageBonus(params.doctrine, params.totalBab, strikeHandedness, true);
      const baseCrit = natLimb?.critThreatMin ?? 20;
      const critMin =
        critThreatExpansionSteps > 0 ? computeExpandedCritThreatMin(baseCrit, critThreatExpansionSteps) : baseCrit;

      strikes.push({
        index: i,
        label:
          natLimb?.name ?? entry.naturalWeaponId ?? (isPrimary ? 'Primary Natural Attack' : 'Secondary Natural Attack'),
        attackSource: entry.attackSource,
        handedness: strikeHandedness,
        isNaturalOrUnarmed: true,
        attackBonus: entry.attackBonus + finesseDelta + strikeAttackMod,
        weaponDice: natLimb?.dice ?? '1d4',
        weaponDamageType: natLimb?.damageType ?? 'slashing',
        strDamageBonus: strDmg,
        doctrineDamageBonus: doctrineDmg,
        flatDamageBonus: params.flatDamageBonus + strikeDamageMod,
        critThreatMin: critMin,
        critMultiplier: natLimb?.critMultiplier ?? 2,
        bypassTags: [natLimb?.damageType ?? 'slashing'],
        critThreatBreakdown,
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
