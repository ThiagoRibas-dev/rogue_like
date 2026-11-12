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
import type {
  DnD35ClassDefinition,
  DnD35DamageType,
  DnD35FeatDefinition,
  DnD35ItemDefinition,
  DnD35ItemEnhancement,
  DnD35WeaponDamageRider
} from '../types/dnd35e_system.types.ts';
import { buildFeatEffectModifiers } from '../progression/ledger_modifiers.ts';
import {
  computeExpandedCritThreatMin,
  evaluateNonproficiencyPenalty,
  getCanonicalBaseWeapons,
  resolveEffectiveItemDefinition
} from './item_inheritance.ts';
import { type SpecialMaterialType, applyMaterialPhysics, computeMaterialEquipmentStats } from './special_materials.ts';
import { evaluateWeaponWieldingProfile, scaleWeaponDamageDice } from './weapon_scaling.ts';
import { resolveTypedModifiersWithBreakdown } from '../modifiers/stacking_engine.ts';

export {
  computeExpandedCritThreatMin,
  evaluateNonproficiencyPenalty,
  getCanonicalBaseWeapons,
  resolveEffectiveItemDefinition
};

/**
 * Resolved combat profile of an equipped weapon (or unarmed strike fallback) in a hand/held slot.
 */
export interface EquippedWeaponProfile {
  readonly isArmed: boolean;
  readonly wieldable: boolean;
  readonly weaponItemId?: string | undefined;
  readonly baseWeaponId?: string | undefined;
  readonly weaponName: string;
  readonly weaponSize: CreatureSizeCategory;
  readonly weaponDice: string;
  readonly weaponDamageType: DnD35DamageType;
  readonly baseCritThreatMin?: number | undefined;
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
  readonly damageRiders?: ReadonlyArray<DnD35WeaponDamageRider> | undefined;
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
const UNARMED_BASE_MEDIUM_DICE = '1d3';
const DEFAULT_WEAPON_MEDIUM_DICE = '1d8';

/**
 * Builds an unarmed strike profile for an actor of size `wielderSize` using `scaleWeaponDamageDice`.
 */
export function buildUnarmedProfile(wielderSize: CreatureSizeCategory, isOffHand: boolean): EquippedWeaponProfile {
  const unarmedDice = scaleWeaponDamageDice(UNARMED_BASE_MEDIUM_DICE, 'medium', wielderSize);

  return {
    isArmed: false,
    wieldable: true,
    weaponItemId: 'unarmed_strike',
    baseWeaponId: 'unarmed_strike',
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

  const rawItemDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
  if (!rawItemDef || rawItemDef.category !== 'weapon') return undefined;

  const baseItemDef = resolveEffectiveItemDefinition(rawItemDef, state.campaign.items, itemComp);
  const baseWeaponId = baseItemDef.baseItemId ?? baseItemDef.id;

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
      weaponPenalty += computeMaterialEquipmentStats(mat).weaponDamagePenalty;
    }
  }

  for (const tag of finalItemDef.tags ?? []) {
    if (tag.startsWith('bypass:') || tag.startsWith('material:')) bypassTags.push(tag);
  }
  if ((magicalProps?.enhancementBonus ?? 0) >= 1) bypassTags.push('bypass:magic');

  const sysEnhancements =
    (state.campaign.systemContent?.['itemEnhancements'] as Record<string, DnD35ItemEnhancement> | undefined) ?? {};
  const damageRiders: DnD35WeaponDamageRider[] = [];
  const enhancementsList = magicalProps?.enhancements ?? [];
  for (const enhId of enhancementsList) {
    const enh = sysEnhancements[enhId];
    if (enh?.damageRiders) damageRiders.push(...enh.damageRiders);
    if (enh?.effectBundle?.grantedTags) bypassTags.push(...enh.effectBundle.grantedTags);
  }

  const baneType = magicalProps?.baneCreatureType;
  if (baneType) {
    damageRiders.push({
      id: `bane_${baneType}_hit`,
      trigger: 'on_hit',
      dice: '2d6',
      damageType: 'untyped',
      condition: {
        targetTagsAny: [`type:${baneType}`, `subtype:${baneType}`]
      }
    });
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

  const existingMods = dndData?.statModifiers ?? [];
  const hasFeatMods = existingMods.some((m) => (m.sourcePath ?? '').startsWith('feat:'));
  const sysFeats = state.campaign.systemContent?.['feats'] as Record<string, DnD35FeatDefinition> | undefined;
  const derivedFeatMods =
    !hasFeatMods && (dndData?.feats?.length ?? 0) > 0 && sysFeats
      ? buildFeatEffectModifiers(dndData?.feats ?? [], sysFeats, dndData?.suppressedBundleIds ?? [])
      : [];
  const candidateCritMods: StatModifier[] = [
    ...existingMods.filter((m) => m.targetStat === 'crit_threat_doubling'),
    ...derivedFeatMods.filter((m) => m.targetStat === 'crit_threat_doubling')
  ];
  if (magicalProps?.keen === true || itemTags.includes('keen') || enhancementsList.includes('keen')) {
    candidateCritMods.push({
      targetStat: 'crit_threat_doubling',
      value: 1,
      bonusType: 'threat_expansion',
      sourceId: `item:${baseItemDef.id}:keen`,
      sourcePath: `item:${baseItemDef.id}/keen`,
      origin: 'magical',
      condition: { effectTagsAny: [`weapon:${baseWeaponId}`, `weapon:${baseItemDef.id}`] }
    });
  }

  const baseCritThreatMin = critThreatMin;
  const threatDoublingBreakdown = resolveTypedModifiersWithBreakdown(candidateCritMods, {
    effectTags: [`weapon:${baseWeaponId}`, `weapon:${baseItemDef.id}`]
  });
  critThreatMin = computeExpandedCritThreatMin(baseCritThreatMin, threatDoublingBreakdown.total);

  const critMultTag = itemTags.find((t) => t.startsWith('critMultiplier:') || t.startsWith('crit:x'));
  const parsedCritMult = critMultTag ? Number(critMultTag.replace(/^(?:critMultiplier:|crit:x)/, '')) : NaN;
  const critMultiplier =
    !Number.isNaN(parsedCritMult) && parsedCritMult >= DEFAULT_CRIT_MULTIPLIER && parsedCritMult <= MAX_CRIT_MULTIPLIER
      ? parsedCritMult
      : (weaponStats?.critMultiplier ?? DEFAULT_CRIT_MULTIPLIER);

  const inherentEffort: 'light' | 'one_handed' | 'two_handed' =
    weaponStats?.effort ??
    (itemTags.includes('two_handed') ? 'two_handed' : itemTags.includes('light') ? 'light' : 'one_handed');

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
  const classesRegistry = state.campaign.systemContent?.['classes'] as Record<string, DnD35ClassDefinition> | undefined;
  const nonproficiencyPenalty = evaluateNonproficiencyPenalty(
    baseItemDef.id,
    baseWeaponId,
    isExotic1HMartial2H,
    effectiveEffort,
    dndData,
    weaponStats?.familiaritySubtypes ?? [],
    weaponStats?.proficiencyCategory,
    classesRegistry
  );
  const damageBonus = Math.max(MIN_WEAPON_DAMAGE_BONUS, enhBonus - weaponPenalty);

  return {
    isArmed: true,
    wieldable: wieldProfile.wieldable,
    weaponItemId: baseItemDef.id,
    baseWeaponId,
    weaponName: baseItemDef.name,
    weaponSize,
    weaponDice: scaledDice,
    weaponDamageType: damageType,
    baseCritThreatMin,
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
    damageRiders: damageRiders.length > 0 ? damageRiders : undefined,
    slotId: slot.id,
    limbGroupId: slot.limbGroupId,
    critThreatBreakdown: threatDoublingBreakdown
  };
}
