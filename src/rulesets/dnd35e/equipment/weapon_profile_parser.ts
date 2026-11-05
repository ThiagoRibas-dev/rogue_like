import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentSlotInstance,
  type ItemComponent,
  type WeaponGripMode
} from '../../../types/components.types.ts';
import type { GameState } from '../../../types/game-state.types.ts';
import { SIZE_METRICS } from '../spatial/grid_geometry.ts';
import type {
  CreatureSizeCategory,
  DnD35EntityData,
  StatModifier,
  StatResolutionBreakdown
} from '../types/dnd35e.types.ts';
import type { DnD35DamageType, DnD35ItemDefinition } from '../types/dnd35e_system.types.ts';
import { type SpecialMaterialType, applyMaterialPhysics, computeMaterialEquipmentStats } from './special_materials.ts';
import { evaluateWeaponWieldingProfile, scaleWeaponDamageDice } from './weapon_scaling.ts';
import { resolveTypedModifiersWithBreakdown } from '../modifiers/stacking_engine.ts';

/**
 * Resolved combat profile of an equipped weapon (or unarmed strike fallback) in a hand/held slot.
 */
export interface EquippedWeaponProfile {
  readonly isArmed: boolean;
  readonly wieldable: boolean;
  readonly weaponItemId?: string | undefined;
  readonly weaponName: string;
  readonly weaponSize: CreatureSizeCategory;
  readonly weaponDice: string;
  readonly weaponDamageType: DnD35DamageType;
  readonly critThreatMin: number;
  readonly critMultiplier: number;
  readonly inherentEffort: 'light' | 'one_handed' | 'two_handed';
  readonly effectiveEffort: 'light' | 'one_handed' | 'two_handed';
  readonly handedness: 'light' | 'one_handed' | 'two_handed';
  readonly isDoubleWeapon?: boolean | undefined;
  readonly isFinesseEligible?: boolean | undefined;
  readonly cannotTwoHandStr?: boolean | undefined;
  readonly isExotic1HMartial2H?: boolean | undefined;
  readonly reachFt?: number | undefined;
  readonly strikesAdjacent?: boolean | undefined;
  readonly attackBonus: number;
  readonly sizeAttackPenalty: number;
  readonly nonproficiencyPenalty: number;
  readonly damageBonus: number;
  readonly bypassTags: ReadonlyArray<string>;
  readonly slotId?: string | undefined;
  readonly limbGroupId?: string | undefined;
  readonly critThreatBreakdown?: StatResolutionBreakdown | undefined;
}

/**
 * Complete set of resolved actor weapons, occupied limbs, and active grip mode.
 */
export interface ResolvedActorWeapons {
  readonly primaryWeapon: EquippedWeaponProfile;
  readonly offHandWeapons: ReadonlyArray<EquippedWeaponProfile>;
  readonly occupiedLimbGroupIds: ReadonlyArray<string>;
  readonly gripMode: WeaponGripMode;
}

const DEFAULT_CRIT_THREAT_MIN = 20;
const DEFAULT_CRIT_MULTIPLIER = 2;
const MAX_CRIT_MULTIPLIER = 5;
const MIN_WEAPON_DAMAGE_BONUS = -10;
const NONPROFICIENCY_ATTACK_PENALTY = -4;
const UNARMED_BASE_MEDIUM_DICE = '1d3';
const DEFAULT_WEAPON_MEDIUM_DICE = '1d8';
const CRIT_THREAT_CEILING = 21;
const MIN_CRIT_THREAT_ROLL = 2;

/**
 * Doubles a weapon's critical threat range (e.g. 20 -> 19, 19 -> 17, 18 -> 15) for Keen or Improved Critical.
 * Per SRD rules, Keen and Improved Critical do not stack with each other.
 */
export function computeExpandedCritThreatMin(baseCritThreatMin: number, expandThreatRange: boolean | number): number {
  const expansionSteps = typeof expandThreatRange === 'boolean' ? (expandThreatRange ? 1 : 0) : expandThreatRange;
  if (expansionSteps <= 0) return baseCritThreatMin;
  const span = Math.max(1, CRIT_THREAT_CEILING - baseCritThreatMin);
  return Math.max(MIN_CRIT_THREAT_ROLL, CRIT_THREAT_CEILING - span * (1 + expansionSteps));
}

/**
 * Evaluates the nonproficiency attack penalty (`0` or `-4`) for a weapon based on its
 * resolved grip handedness and the actor's proficiencies/racial familiarity.
 */
export function evaluateNonproficiencyPenalty(
  weaponItemId: string | undefined,
  isExotic1HMartial2H: boolean | undefined,
  finalHandedness: 'light' | 'one_handed' | 'two_handed',
  dndData: Partial<DnD35EntityData> | undefined,
  familiaritySubtypes: ReadonlyArray<string> = [],
  proficiencyCategory?: 'simple' | 'martial' | 'exotic'
): number {
  const isExotic = proficiencyCategory === 'exotic' || isExotic1HMartial2H === true;
  if (!isExotic || (isExotic1HMartial2H === true && finalHandedness === 'two_handed')) {
    return 0;
  }
  const feats = dndData?.feats ?? [];
  const hasExoticProficiency = feats.some(
    (f) =>
      f === 'exotic_weapon_proficiency' ||
      (weaponItemId !== undefined &&
        (f === `exotic_weapon_proficiency_${weaponItemId}` || f === `exotic_weapon_proficiency:${weaponItemId}`))
  );
  if (hasExoticProficiency) {
    return 0;
  }
  if (familiaritySubtypes.length > 0) {
    const actorSubtypes = new Set<string>([...(dndData?.raceId ? [dndData.raceId] : []), ...(dndData?.subtypes ?? [])]);
    if (familiaritySubtypes.some((sub) => actorSubtypes.has(sub))) {
      return 0;
    }
  }
  return NONPROFICIENCY_ATTACK_PENALTY;
}

/**
 * Builds an unarmed strike profile for an actor of size `wielderSize` using `scaleWeaponDamageDice`.
 */
export function buildUnarmedProfile(wielderSize: CreatureSizeCategory, isOffHand: boolean): EquippedWeaponProfile {
  const unarmedDice = scaleWeaponDamageDice(UNARMED_BASE_MEDIUM_DICE, 'medium', wielderSize);

  return {
    isArmed: false,
    wieldable: true,
    weaponName: isOffHand ? 'Unarmed Strike (Off-Hand)' : 'Unarmed Strike',
    weaponSize: wielderSize,
    weaponDice: unarmedDice,
    weaponDamageType: 'bludgeoning',
    critThreatMin: DEFAULT_CRIT_THREAT_MIN,
    critMultiplier: DEFAULT_CRIT_MULTIPLIER,
    inherentEffort: 'light',
    effectiveEffort: 'light',
    handedness: 'light',
    isFinesseEligible: true,
    reachFt: 5,
    strikesAdjacent: true,
    attackBonus: 0,
    sizeAttackPenalty: 0,
    nonproficiencyPenalty: 0,
    damageBonus: 0,
    bypassTags: ['bludgeoning']
  };
}

/**
 * Parses an equipped weapon item into an `EquippedWeaponProfile` using declarative `weaponStats`,
 * `specialMaterial`, and `magicalProperties` from `DnD35ItemDefinition` (with tag fallbacks for custom items).
 */
export function parseEquippedItem(
  state: GameState,
  slot: EquipmentSlotInstance,
  wielderSize: CreatureSizeCategory,
  dndData?: Partial<DnD35EntityData>
): EquippedWeaponProfile | undefined {
  if (slot.equippedItem === null) return undefined;
  const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return undefined;

  const baseItemDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
  if (!baseItemDef || baseItemDef.category !== 'weapon') return undefined;

  const entityTagsComp = getComponent(state, slot.equippedItem, ComponentType.Tags) as
    { tags?: ReadonlyArray<string> } | undefined;
  const dynamicItemTags = (itemComp as { tags?: ReadonlyArray<string> }).tags ?? entityTagsComp?.tags ?? [];
  const itemTags = Array.from(new Set([...(baseItemDef.tags ?? []), ...dynamicItemTags]));
  const weaponStats = baseItemDef.weaponStats;
  const magicalProps = baseItemDef.magicalProperties;

  let finalItemDef = baseItemDef;
  let weaponPenalty = 0;
  const bypassTags: string[] = [];

  const declaredMat = baseItemDef.specialMaterial === 'alchemical_silver' ? 'silver' : baseItemDef.specialMaterial;

  for (const mat of [
    'mithral',
    'adamantine',
    'silver',
    'cold_iron',
    'darkwood'
  ] as const satisfies ReadonlyArray<SpecialMaterialType>) {
    if (declaredMat === mat || itemTags.includes(mat) || itemTags.includes(`material:${mat}`)) {
      finalItemDef = applyMaterialPhysics(finalItemDef, mat) as DnD35ItemDefinition;
      const adjustments = computeMaterialEquipmentStats(mat);
      weaponPenalty += adjustments.weaponDamagePenalty;
    }
  }

  for (const tag of finalItemDef.tags ?? []) {
    if (tag.startsWith('bypass:') || tag.startsWith('material:')) {
      bypassTags.push(tag);
    }
  }
  if ((magicalProps?.enhancementBonus ?? 0) >= 1) {
    bypassTags.push('bypass:magic');
  }

  let weaponSize: CreatureSizeCategory = wielderSize;
  const sizeTag = itemTags.find((t) => t.startsWith('weaponSize:') || t.startsWith('size:'));
  if (sizeTag) {
    const raw = sizeTag.replace(/^(?:weaponSize:|size:)/, '');
    if (Object.prototype.hasOwnProperty.call(SIZE_METRICS, raw)) {
      weaponSize = raw as CreatureSizeCategory;
    }
  }

  const diceTag = itemTags.find((t) => t.startsWith('weaponDice:') || t.startsWith('dice:'));
  const baseDice =
    weaponStats?.damageDice ?? (diceTag ? diceTag.replace(/^(?:weaponDice:|dice:)/, '') : DEFAULT_WEAPON_MEDIUM_DICE);

  const scaledDice = scaleWeaponDamageDice(baseDice, 'medium', weaponSize);

  let damageType: DnD35DamageType = weaponStats?.damageType ?? 'slashing';
  if (!weaponStats?.damageType) {
    if (itemTags.includes('bludgeoning')) damageType = 'bludgeoning';
    else if (itemTags.includes('piercing')) damageType = 'piercing';
    else if (itemTags.includes('slashing')) damageType = 'slashing';
  }
  bypassTags.push(damageType);

  let critThreatMin = weaponStats?.critThreatMin ?? DEFAULT_CRIT_THREAT_MIN;
  const threatTag = itemTags.find((t) => t.startsWith('critThreatMin:') || t.startsWith('threat:'));
  if (threatTag) {
    const parsed = Number(threatTag.replace(/^(?:critThreatMin:|threat:)/, ''));
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= DEFAULT_CRIT_THREAT_MIN) critThreatMin = parsed;
  }

  const candidateCritMods: StatModifier[] = [
    ...(dndData?.statModifiers ?? []).filter((m) => m.targetStat === 'crit_threat_doubling')
  ];
  if (magicalProps?.keen === true || itemTags.includes('keen')) {
    candidateCritMods.push({
      targetStat: 'crit_threat_doubling',
      value: 1,
      bonusType: 'threat_expansion',
      sourceId: `item:${baseItemDef.id}:keen`,
      sourcePath: `item:${baseItemDef.id}/keen`,
      origin: 'magical',
      condition: { effectTagsAny: [`weapon:${baseItemDef.id}`] }
    });
  }
  const feats = dndData?.feats ?? [];
  const hasImprovedCrit = feats.some(
    (f) =>
      f === 'improved_critical' ||
      f === `improved_critical:${baseItemDef.id}` ||
      f === `improved_critical_${baseItemDef.id}`
  );
  if (hasImprovedCrit && !candidateCritMods.some((m) => (m.sourcePath ?? '').startsWith('feat:improved_critical'))) {
    candidateCritMods.push({
      targetStat: 'crit_threat_doubling',
      value: 1,
      bonusType: 'threat_expansion',
      sourceId: `feat:improved_critical:${baseItemDef.id}`,
      sourcePath: `feat:improved_critical/${baseItemDef.id}`,
      origin: 'ex',
      condition: { effectTagsAny: [`weapon:${baseItemDef.id}`] }
    });
  }

  const threatDoublingBreakdown = resolveTypedModifiersWithBreakdown(candidateCritMods, {
    effectTags: [`weapon:${baseItemDef.id}`]
  });
  critThreatMin = computeExpandedCritThreatMin(critThreatMin, threatDoublingBreakdown.total);

  let critMultiplier = weaponStats?.critMultiplier ?? DEFAULT_CRIT_MULTIPLIER;
  const critMultTag = itemTags.find((t) => t.startsWith('critMultiplier:') || t.startsWith('crit:x'));
  if (critMultTag) {
    const parsed = Number(critMultTag.replace(/^(?:critMultiplier:|crit:x)/, ''));
    if (!Number.isNaN(parsed) && parsed >= DEFAULT_CRIT_MULTIPLIER && parsed <= MAX_CRIT_MULTIPLIER) {
      critMultiplier = parsed;
    }
  }

  let inherentEffort: 'light' | 'one_handed' | 'two_handed' = weaponStats?.effort ?? 'one_handed';
  if (!weaponStats?.effort) {
    if (itemTags.includes('two_handed')) inherentEffort = 'two_handed';
    else if (itemTags.includes('light')) inherentEffort = 'light';
    else if (itemTags.includes('one_handed')) inherentEffort = 'one_handed';
  }

  const wieldProfile = evaluateWeaponWieldingProfile(weaponSize, inherentEffort, wielderSize);
  const effectiveEffort = wieldProfile.effectiveHandedness ?? inherentEffort;
  const isDoubleWeapon = weaponStats?.isDoubleWeapon === true || itemTags.includes('double_weapon');
  const cannotTwoHandStr = weaponStats?.cannotTwoHandStr === true || itemTags.includes('cannot_two_hand_str');
  const isExotic1HMartial2H = weaponStats?.isExotic1HMartial2H === true || itemTags.includes('exotic_1h_martial_2h');
  const isFinesseEligible =
    weaponStats?.isFinesseEligible === true || effectiveEffort === 'light' || itemTags.includes('finesse');

  const enhBonus = magicalProps?.enhancementBonus ?? 0;
  const masterworkAtk = magicalProps?.isMasterwork === true && enhBonus === 0 ? 1 : 0;
  const attackBonus = Math.max(baseItemDef.equippable?.attackBonus ?? 0, enhBonus, masterworkAtk);
  const nonproficiencyPenalty = evaluateNonproficiencyPenalty(
    baseItemDef.id,
    isExotic1HMartial2H,
    effectiveEffort,
    dndData,
    weaponStats?.familiaritySubtypes ?? [],
    weaponStats?.proficiencyCategory
  );
  const damageBonus = Math.max(MIN_WEAPON_DAMAGE_BONUS, enhBonus - weaponPenalty);

  return {
    isArmed: true,
    wieldable: wieldProfile.wieldable,
    weaponItemId: baseItemDef.id,
    weaponName: baseItemDef.name,
    weaponSize,
    weaponDice: scaledDice,
    weaponDamageType: damageType,
    critThreatMin,
    critMultiplier,
    inherentEffort,
    effectiveEffort,
    handedness: effectiveEffort,
    isDoubleWeapon,
    isFinesseEligible,
    cannotTwoHandStr,
    isExotic1HMartial2H,
    reachFt: weaponStats?.reachFt ?? (itemTags.includes('reach_10ft') ? 10 : 5),
    strikesAdjacent: weaponStats?.strikesAdjacent ?? !itemTags.includes('reach_10ft'),
    attackBonus,
    sizeAttackPenalty: wieldProfile.attackPenalty,
    nonproficiencyPenalty,
    damageBonus,
    bypassTags: Array.from(new Set(bypassTags)),
    slotId: slot.id,
    limbGroupId: slot.limbGroupId,
    critThreatBreakdown: threatDoublingBreakdown
  };
}
