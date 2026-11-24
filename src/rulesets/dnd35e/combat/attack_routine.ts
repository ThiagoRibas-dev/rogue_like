import type { TacticalDoctrineComponent, WeaponGripMode } from '../../../types/components.types.ts';
import type { EntityId } from '../../../types/game-state.types.ts';
import type { ResolvedActorWeapons } from '../equipment_physics.ts';
import type { DnD35DamageType, DnD35WeaponDamageRider } from '../types/dnd35e_system.types.ts';
import { type AttackRollParams, computeHandednessStrDamage } from './attack_roll.ts';
import {
  buildFullAttackSequence,
  type CombatRuleOverrides,
  type NaturalWeaponLimbEntry
} from './full_attack_sequence.ts';
import { resolveTypedModifiers, resolveTypedModifiersWithBreakdown } from '../modifiers/stacking_engine.ts';
import type { OnHitRiderDescriptor, StatModifier, StatResolutionBreakdown } from '../types/dnd35e.types.ts';
import { computeExpandedCritThreatMin } from '../equipment/weapon_profile_parser.ts';
import { computeStrikeDoctrineDamageBonus, evaluateTacticalDoctrineModifiers } from './tactical_doctrine.ts';

const WHIRLING_FRENZY_FALLBACK_ATK_PENALTY = -2;
const DECISIVE_STRIKE_DAMAGE_MULTIPLIER = 2;

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
  readonly onHitRiders?: ReadonlyArray<OnHitRiderDescriptor> | undefined;
  readonly critThreatBreakdown?: StatResolutionBreakdown | undefined;
  readonly weaponId?: string | undefined;
  readonly baseWeaponId?: string | undefined;
  readonly weaponEntityId?: EntityId | undefined;
  readonly weaponSlotId?: string | undefined;
  readonly reachFt?: number | undefined;
  readonly strikesAdjacent?: boolean | undefined;
  readonly naturalWeaponId?: string | undefined;
  readonly damageMultiplier?: number | undefined;
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

  const whirlingActive =
    params.doctrine?.whirlingFrenzy === true ||
    (params.selfTags?.includes('status:pool_whirling_frenzy_active') ?? false) ||
    (params.selfTags?.includes('status:whirling_frenzy_active') ?? false);
  const extraFullBabMods = (params.statModifiers ?? []).filter((m) => m.targetStat === 'extra_full_bab_attacks');
  const hasWhirlingAtkMod = (params.statModifiers ?? []).some((m) => m.sourceId === 'whirling_frenzy_attack');
  const hasWhirlingExtraMod = extraFullBabMods.some((m) => m.sourceId === 'whirling_frenzy_extra_attack');
  const whirlingFallbackPenalty = whirlingActive && !hasWhirlingAtkMod ? WHIRLING_FRENZY_FALLBACK_ATK_PENALTY : 0;
  const whirlingFallbackExtra = whirlingActive && !hasWhirlingExtraMod ? 1 : 0;

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
    (params.overrides?.extraPrimaryFullBabAttacks ?? 0) + extraFullBabFromMods + whirlingFallbackExtra
  );

  const seq = buildFullAttackSequence({
    totalBab: params.totalBab,
    baseAttackModifier: params.baseAttackModifier + doctrineAtkPenalty + whirlingFallbackPenalty,
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
        ? (offHands[offHandCounter % Math.max(1, offHands.length)] ??
          offHands.find((w) => w.weaponItemId === entry.weaponId) ??
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

    if (entry.attackSource === 'manufactured_primary' || entry.attackSource === 'manufactured_offhand') {
      const isOffHand = entry.attackSource === 'manufactured_offhand';
      const wpn = isOffHand ? (offWeapon ?? primary) : primary;
      if (isOffHand) offHandCounter++;

      const strikeHandedness: AttackRollParams['handedness'] = isOffHand ? 'off_hand' : wpn.handedness;
      const isNaturalOrUnarmed = !wpn.isArmed;
      const strDmg =
        !isOffHand && wpn.cannotTwoHandStr && strikeHandedness === 'two_handed'
          ? computeHandednessStrDamage(params.strModifier, 'one_handed')
          : computeHandednessStrDamage(params.strModifier, strikeHandedness);
      const doctrineDmg = computeStrikeDoctrineDamageBonus(
        params.doctrine,
        params.totalBab,
        strikeHandedness,
        isNaturalOrUnarmed,
        wpn.cannotTwoHandStr
      );
      const wpnFinesseBonus =
        wpn.isFinesseEligible === true || wpn.handedness === 'light' || isNaturalOrUnarmed ? finesseDelta : 0;
      const critMin =
        critThreatExpansionSteps > 0
          ? computeExpandedCritThreatMin(wpn.baseCritThreatMin ?? wpn.critThreatMin, critThreatExpansionSteps)
          : wpn.critThreatMin;

      const hasMagicWeaponTag = params.selfTags?.includes('weapon:magic') === true;
      const strikeBypassTags = hasMagicWeaponTag ? Array.from(new Set([...wpn.bypassTags, 'magic'])) : wpn.bypassTags;

      strikes.push({
        index: i,
        label: wpn.weaponName,
        attackSource: entry.attackSource,
        handedness: strikeHandedness,
        isNaturalOrUnarmed,
        attackBonus:
          entry.attackBonus +
          wpn.attackBonus +
          wpn.sizeAttackPenalty +
          wpn.nonproficiencyPenalty +
          wpnFinesseBonus +
          strikeAttackMod,
        weaponDice: wpn.weaponDice,
        weaponDamageType: wpn.weaponDamageType,
        strDamageBonus: strDmg,
        doctrineDamageBonus: doctrineDmg,
        flatDamageBonus: params.flatDamageBonus + wpn.damageBonus + strikeDamageMod,
        critThreatMin: critMin,
        critMultiplier: wpn.critMultiplier,
        bypassTags: strikeBypassTags,
        damageRiders: wpn.damageRiders,
        critThreatBreakdown,
        weaponId: wpn.weaponItemId,
        baseWeaponId: wpn.baseWeaponId ?? wpn.weaponItemId,
        ...(wpn.itemEntityId !== undefined ? { weaponEntityId: wpn.itemEntityId } : {}),
        ...(wpn.slotId !== undefined ? { weaponSlotId: wpn.slotId } : {}),
        ...(wpn.reachFt !== undefined ? { reachFt: wpn.reachFt } : {}),
        ...(wpn.strikesAdjacent !== undefined ? { strikesAdjacent: wpn.strikesAdjacent } : {})
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

      const hasMagicNaturalTag =
        params.selfTags?.includes('natural_weapon:magic') === true ||
        params.selfTags?.includes('weapon:magic') === true;
      const natBypass = hasMagicNaturalTag
        ? Array.from(new Set([natLimb?.damageType ?? 'slashing', 'magic']))
        : [natLimb?.damageType ?? 'slashing'];

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
        bypassTags: natBypass,
        ...(natLimb?.riders !== undefined ? { onHitRiders: natLimb.riders } : {}),
        critThreatBreakdown,
        naturalWeaponId: entry.naturalWeaponId,
        reachFt: 5,
        strikesAdjacent: true
      });
    }
  }

  if (params.doctrine?.decisiveStrike === true && params.doctrine.totalDefense !== true && strikes.length > 0) {
    const primaryStrike = strikes[0]!;
    return {
      isPureNaturalRoutine,
      gripMode: params.resolvedWeapons.gripMode,
      occupiedLimbGroupIds: params.resolvedWeapons.occupiedLimbGroupIds,
      strikes: [
        {
          ...primaryStrike,
          index: 0,
          label: `${primaryStrike.label} [Decisive Strike 2x]`,
          damageMultiplier: DECISIVE_STRIKE_DAMAGE_MULTIPLIER
        }
      ]
    };
  }

  return {
    isPureNaturalRoutine,
    gripMode: params.resolvedWeapons.gripMode,
    occupiedLimbGroupIds: params.resolvedWeapons.occupiedLimbGroupIds,
    strikes
  };
}
