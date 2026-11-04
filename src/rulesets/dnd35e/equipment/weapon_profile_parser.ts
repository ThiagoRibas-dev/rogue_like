import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentSlotInstance,
  type ItemComponent,
  type WeaponGripMode
} from '../../../types/components.types.ts';
import type { GameState } from '../../../types/game-state.types.ts';
import { SIZE_METRICS } from '../spatial/grid_geometry.ts';
import type { CreatureSizeCategory, DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35DamageType } from '../types/dnd35e_system.types.ts';
import { applyMaterialPhysics, computeMaterialEquipmentStats } from './special_materials.ts';
import { evaluateWeaponWieldingProfile, scaleWeaponDamageDice } from './weapon_scaling.ts';

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
  readonly cannotTwoHandStr?: boolean | undefined;
  readonly isExotic1HMartial2H?: boolean | undefined;
  readonly attackBonus: number;
  readonly sizeAttackPenalty: number;
  readonly nonproficiencyPenalty: number;
  readonly damageBonus: number;
  readonly bypassTags: ReadonlyArray<string>;
  readonly slotId?: string | undefined;
  readonly limbGroupId?: string | undefined;
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
const BLADED_CRIT_THREAT_MIN = 19;
const DEFAULT_CRIT_MULTIPLIER = 2;
const MAX_CRIT_MULTIPLIER = 5;
const MIN_WEAPON_DAMAGE_BONUS = -10;
const NONPROFICIENCY_ATTACK_PENALTY = -4;

/**
 * Evaluates the nonproficiency attack penalty (`0` or `-4`) for a weapon based on its
 * resolved grip handedness and the actor's proficiencies/racial familiarity.
 */
export function evaluateNonproficiencyPenalty(
  weaponItemId: string | undefined,
  isExotic1HMartial2H: boolean | undefined,
  finalHandedness: 'light' | 'one_handed' | 'two_handed',
  dndData: Partial<DnD35EntityData> | undefined
): number {
  if (!isExotic1HMartial2H) {
    return 0;
  }
  if (finalHandedness === 'two_handed') {
    return 0;
  }
  const feats = dndData?.feats ?? [];
  const hasExoticProficiency = feats.some(
    (f) =>
      f === 'exotic_weapon_proficiency' ||
      (weaponItemId !== undefined && f === `exotic_weapon_proficiency_${weaponItemId}`)
  );
  if (hasExoticProficiency) {
    return 0;
  }
  const isDwarvenWeapon = weaponItemId !== undefined && weaponItemId.includes('dwarven');
  const isDwarf = dndData?.raceId === 'dwarf' || dndData?.subtypes?.includes('dwarf') === true;
  if (isDwarvenWeapon && isDwarf) {
    return 0;
  }
  return NONPROFICIENCY_ATTACK_PENALTY;
}

/**
 * Builds an unarmed strike profile for an actor of size `wielderSize`.
 */
export function buildUnarmedProfile(wielderSize: CreatureSizeCategory, isOffHand: boolean): EquippedWeaponProfile {
  let unarmedDice = '1d3';
  if (wielderSize === 'fine' || wielderSize === 'diminutive') unarmedDice = '1';
  else if (wielderSize === 'tiny' || wielderSize === 'small') unarmedDice = '1d2';
  else if (wielderSize === 'medium') unarmedDice = '1d3';
  else if (wielderSize === 'large') unarmedDice = '1d4';
  else if (wielderSize === 'huge') unarmedDice = '1d6';
  else if (wielderSize === 'gargantuan') unarmedDice = '1d8';
  else if (wielderSize === 'colossal') unarmedDice = '2d6';

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
    attackBonus: 0,
    sizeAttackPenalty: 0,
    nonproficiencyPenalty: 0,
    damageBonus: 0,
    bypassTags: ['bludgeoning']
  };
}

/**
 * Parses an equipped weapon item into an EquippedWeaponProfile.
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

  const baseItemDef = state.campaign.items[itemComp.itemId];
  if (!baseItemDef || baseItemDef.category !== 'weapon') return undefined;

  const itemTags = baseItemDef.tags ?? [];

  let finalItemDef = baseItemDef;
  let weaponPenalty = 0;
  const bypassTags: string[] = [];

  for (const mat of ['mithral', 'adamantine', 'silver', 'cold_iron', 'darkwood'] as const) {
    if (itemTags.includes(mat) || itemTags.includes(`material:${mat}`)) {
      finalItemDef = applyMaterialPhysics(finalItemDef, mat);
      const adjustments = computeMaterialEquipmentStats(mat);
      weaponPenalty += adjustments.weaponDamagePenalty;
    }
  }

  for (const tag of finalItemDef.tags ?? []) {
    if (tag.startsWith('bypass:') || tag.startsWith('material:')) {
      bypassTags.push(tag);
    }
  }

  let weaponSize: CreatureSizeCategory = wielderSize;
  const sizeTag = itemTags.find((t) => t.startsWith('weaponSize:') || t.startsWith('size:'));
  if (sizeTag) {
    const raw = sizeTag.replace(/^(?:weaponSize:|size:)/, '');
    if (Object.prototype.hasOwnProperty.call(SIZE_METRICS, raw)) {
      weaponSize = raw as CreatureSizeCategory;
    }
  }

  let baseDice = '1d8';
  const diceTag = itemTags.find((t) => t.startsWith('weaponDice:') || t.startsWith('dice:'));
  if (diceTag) {
    baseDice = diceTag.replace(/^(?:weaponDice:|dice:)/, '');
  } else if (baseItemDef.id === 'longsword' || baseItemDef.id === 'heavy_mace') {
    baseDice = '1d8';
  } else if (baseItemDef.id === 'short_sword' || baseItemDef.id === 'quarterstaff') {
    baseDice = '1d6';
  } else if (baseItemDef.id.includes('dagger') || baseItemDef.id.includes('knife')) {
    baseDice = '1d4';
  } else if (baseItemDef.id.includes('greatsword')) {
    baseDice = '2d6';
  } else if (baseItemDef.id.includes('bastard_sword') || baseItemDef.id.includes('dwarven_waraxe')) {
    baseDice = '1d10';
  }

  const scaledDice = scaleWeaponDamageDice(baseDice, 'medium', weaponSize);

  let damageType: DnD35DamageType = 'slashing';
  if (itemTags.includes('bludgeoning') || baseItemDef.id.includes('mace') || baseItemDef.id.includes('staff')) {
    damageType = 'bludgeoning';
  } else if (
    itemTags.includes('piercing') ||
    baseItemDef.id.includes('short_sword') ||
    baseItemDef.id.includes('dagger')
  ) {
    damageType = 'piercing';
  } else if (itemTags.includes('slashing') || baseItemDef.id.includes('longsword')) {
    damageType = 'slashing';
  }

  let critThreatMin = DEFAULT_CRIT_THREAT_MIN;
  const threatTag = itemTags.find((t) => t.startsWith('critThreatMin:') || t.startsWith('threat:'));
  if (threatTag) {
    const parsed = Number(threatTag.replace(/^(?:critThreatMin:|threat:)/, ''));
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= DEFAULT_CRIT_THREAT_MIN) critThreatMin = parsed;
  } else if (baseItemDef.id === 'longsword' || baseItemDef.id === 'short_sword' || baseItemDef.id.includes('dagger')) {
    critThreatMin = BLADED_CRIT_THREAT_MIN;
  }

  let critMultiplier = DEFAULT_CRIT_MULTIPLIER;
  const critMultTag = itemTags.find((t) => t.startsWith('critMultiplier:') || t.startsWith('crit:x'));
  if (critMultTag) {
    const parsed = Number(critMultTag.replace(/^(?:critMultiplier:|crit:x)/, ''));
    if (!Number.isNaN(parsed) && parsed >= DEFAULT_CRIT_MULTIPLIER && parsed <= MAX_CRIT_MULTIPLIER) {
      critMultiplier = parsed;
    }
  }

  let inherentEffort: 'light' | 'one_handed' | 'two_handed' = 'one_handed';
  if (
    itemTags.includes('two_handed') ||
    baseItemDef.id.includes('greatsword') ||
    baseItemDef.id.includes('greataxe') ||
    baseItemDef.id.includes('quarterstaff') ||
    baseItemDef.id.includes('staff')
  ) {
    inherentEffort = 'two_handed';
  } else if (itemTags.includes('light') || baseItemDef.id.includes('dagger') || baseItemDef.id === 'short_sword') {
    inherentEffort = 'light';
  } else if (
    itemTags.includes('one_handed') ||
    baseItemDef.id === 'longsword' ||
    baseItemDef.id === 'heavy_mace' ||
    baseItemDef.id.includes('rapier')
  ) {
    inherentEffort = 'one_handed';
  }

  const wieldProfile = evaluateWeaponWieldingProfile(weaponSize, inherentEffort, wielderSize);
  const effectiveEffort = wieldProfile.effectiveHandedness ?? inherentEffort;
  const isDoubleWeapon =
    itemTags.includes('double_weapon') || baseItemDef.id.includes('quarterstaff') || baseItemDef.id.includes('double_');
  const cannotTwoHandStr = itemTags.includes('cannot_two_hand_str') || baseItemDef.id.includes('rapier');
  const isExotic1HMartial2H =
    itemTags.includes('exotic_1h_martial_2h') ||
    baseItemDef.id.includes('bastard_sword') ||
    baseItemDef.id.includes('dwarven_waraxe');

  const attackBonus = baseItemDef.equippable?.attackBonus ?? 0;
  const nonproficiencyPenalty = evaluateNonproficiencyPenalty(
    baseItemDef.id,
    isExotic1HMartial2H,
    effectiveEffort,
    dndData
  );
  const damageBonus = Math.max(MIN_WEAPON_DAMAGE_BONUS, -weaponPenalty);

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
    cannotTwoHandStr,
    isExotic1HMartial2H,
    attackBonus,
    sizeAttackPenalty: wieldProfile.attackPenalty,
    nonproficiencyPenalty,
    damageBonus,
    bypassTags: Array.from(new Set(bypassTags)),
    slotId: slot.id,
    limbGroupId: slot.limbGroupId
  };
}
