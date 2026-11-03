import type { ItemDefinition } from '../../types/campaign/item.ts';
import { getComponent } from '../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type EquipmentSlotInstance,
  type ItemComponent,
  type TacticalDoctrineComponent,
  type WeaponGripMode
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { rollD20 } from './math/dice.ts';
import { dndFloor } from './math/multipliers.ts';
import { SIZE_METRICS } from './spatial/grid_geometry.ts';
import type { CreatureSizeCategory, DnD35EntityData } from './types/dnd35e.types.ts';
import type { DnD35DamageType } from './types/dnd35e_system.types.ts';

/**
 * Canonical D&D 3.5e Special Material types from the Dungeon Master's Guide.
 */
export type SpecialMaterialType = 'mithral' | 'adamantine' | 'silver' | 'cold_iron' | 'darkwood';

/**
 * Armor weight categories used for Mithral category reduction and Adamantine innate DR.
 */
export type ArmorWeightCategory = 'light' | 'medium' | 'heavy' | 'shield';

/**
 * Computed mechanical adjustments granted by a special material (PRIM-5.1 / DMG p. 283-284).
 */
export interface MaterialEquipmentAdjustments {
  readonly effectiveArmorCategory?: ArmorWeightCategory | undefined;
  readonly maxDexBonusDelta: number;
  readonly acpReduction: number;
  readonly asfReductionPercent: number;
  readonly grantedDrAmount: number;
  readonly weaponDamagePenalty: number;
  readonly ignoresHardnessBelow: number;
  readonly weightMultiplier: number;
}

const MITHRAL_MAX_DEX_BONUS_DELTA = 2;
const MITHRAL_ACP_REDUCTION = 3;
const MITHRAL_ASF_REDUCTION_PERCENT = 10;
const DARKWOOD_ACP_REDUCTION = 2;
const HALF_WEIGHT_MULTIPLIER = 0.5;
const FULL_WEIGHT_MULTIPLIER = 1.0;
const ADAMANTINE_HARDNESS_THRESHOLD = 20;
const ADAMANTINE_LIGHT_DR = 1;
const ADAMANTINE_MEDIUM_DR = 2;
const ADAMANTINE_HEAVY_DR = 3;
const SILVER_WEAPON_DAMAGE_PENALTY = 1;

/**
 * Computes the exact mechanical stat adjustments for an item crafted from a Special Material
 * (Mithral armor category step reduction, Max Dex +2, ACP -3, ASF -10%; Adamantine innate DR 1/-/2/-/3/-;
 * Alchemical Silver -1 weapon damage penalty; Darkwood ACP -2).
 *
 * @param material Special material type.
 * @param armorCategory Optional base armor category if the item is armor or a shield.
 * @returns MaterialEquipmentAdjustments descriptor.
 */
export function computeMaterialEquipmentStats(
  material: SpecialMaterialType,
  armorCategory?: ArmorWeightCategory
): MaterialEquipmentAdjustments {
  switch (material) {
    case 'mithral': {
      let effectiveCategory = armorCategory;
      if (armorCategory === 'heavy') {
        effectiveCategory = 'medium';
      } else if (armorCategory === 'medium') {
        effectiveCategory = 'light';
      }
      return {
        ...(effectiveCategory !== undefined ? { effectiveArmorCategory: effectiveCategory } : {}),
        maxDexBonusDelta: MITHRAL_MAX_DEX_BONUS_DELTA,
        acpReduction: MITHRAL_ACP_REDUCTION,
        asfReductionPercent: MITHRAL_ASF_REDUCTION_PERCENT,
        grantedDrAmount: 0,
        weaponDamagePenalty: 0,
        ignoresHardnessBelow: 0,
        weightMultiplier: HALF_WEIGHT_MULTIPLIER
      };
    }

    case 'adamantine': {
      let dr = 0;
      if (armorCategory === 'light') dr = ADAMANTINE_LIGHT_DR;
      else if (armorCategory === 'medium') dr = ADAMANTINE_MEDIUM_DR;
      else if (armorCategory === 'heavy') dr = ADAMANTINE_HEAVY_DR;

      return {
        ...(armorCategory !== undefined ? { effectiveArmorCategory: armorCategory } : {}),
        maxDexBonusDelta: 0,
        acpReduction: 1, // Masterwork component included in Adamantine
        asfReductionPercent: 0,
        grantedDrAmount: dr,
        weaponDamagePenalty: 0,
        ignoresHardnessBelow: ADAMANTINE_HARDNESS_THRESHOLD,
        weightMultiplier: FULL_WEIGHT_MULTIPLIER
      };
    }

    case 'silver':
      return {
        ...(armorCategory !== undefined ? { effectiveArmorCategory: armorCategory } : {}),
        maxDexBonusDelta: 0,
        acpReduction: 0,
        asfReductionPercent: 0,
        grantedDrAmount: 0,
        weaponDamagePenalty: SILVER_WEAPON_DAMAGE_PENALTY,
        ignoresHardnessBelow: 0,
        weightMultiplier: FULL_WEIGHT_MULTIPLIER
      };

    case 'cold_iron':
      return {
        ...(armorCategory !== undefined ? { effectiveArmorCategory: armorCategory } : {}),
        maxDexBonusDelta: 0,
        acpReduction: 0,
        asfReductionPercent: 0,
        grantedDrAmount: 0,
        weaponDamagePenalty: 0,
        ignoresHardnessBelow: 0,
        weightMultiplier: FULL_WEIGHT_MULTIPLIER
      };

    case 'darkwood':
      return {
        ...(armorCategory !== undefined ? { effectiveArmorCategory: armorCategory } : {}),
        maxDexBonusDelta: 0,
        acpReduction: DARKWOOD_ACP_REDUCTION,
        asfReductionPercent: 0,
        grantedDrAmount: 0,
        weaponDamagePenalty: 0,
        ignoresHardnessBelow: 0,
        weightMultiplier: HALF_WEIGHT_MULTIPLIER
      };
  }
}

/**
 * Applies special material physics and rules modifications to an item definition:
 * - Mithral: Reduces armor category by one step (heavy -> medium, medium -> light); increases max Dex bonus by +2;
 *   reduces Armor Check Penalty by 3 (min 0); halves item weight; reduces arcane spell failure by 10%.
 * - Adamantine: Weapons bypass hardness < 20 and overcome DR/adamantine. Suits of armor grant Damage Reduction
 *   (DR 1/- for light, DR 2/- for medium, DR 3/- for heavy).
 * - Silver (Alchemical Silver): Overcomes DR/silver; weapons suffer a -1 penalty to damage rolls (min 1).
 * - Cold Iron: Overcomes DR/cold_iron without damage penalty.
 * - Darkwood: Halves weight of wooden items/shields; reduces Armor Check Penalty by 2 (min 0).
 *
 * @param baseItem Base item definition from campaign registry.
 * @param material Special material type to apply.
 * @returns Modified immutable ItemDefinition.
 */
export function applyMaterialPhysics(baseItem: ItemDefinition, material: SpecialMaterialType): ItemDefinition {
  const existingTags = baseItem.tags ?? [];
  const nextTags = Array.from(new Set([...existingTags, material, `material:${material}`]));
  let nextWeight = baseItem.weight;
  const nextEquippable = baseItem.equippable ? { ...baseItem.equippable } : undefined;

  switch (material) {
    case 'mithral':
      nextWeight = Math.max(1, dndFloor(baseItem.weight * HALF_WEIGHT_MULTIPLIER));
      nextTags.push('bypass:silver', 'mithral_acp_reduce:3', 'mithral_max_dex_add:2', 'mithral_asf_reduce:10');
      break;

    case 'adamantine':
      nextTags.push('bypass:adamantine', 'bypass:hardness_20');
      break;

    case 'silver':
      nextTags.push('bypass:silver');
      if (baseItem.category === 'weapon') {
        nextTags.push('weapon_damage_penalty:1');
      }
      break;

    case 'cold_iron':
      nextTags.push('bypass:cold_iron');
      break;

    case 'darkwood':
      nextWeight = Math.max(1, dndFloor(baseItem.weight * HALF_WEIGHT_MULTIPLIER));
      nextTags.push('darkwood_acp_reduce:2');
      break;
  }

  return {
    ...baseItem,
    weight: nextWeight,
    tags: nextTags,
    ...(nextEquippable !== undefined ? { equippable: nextEquippable } : {})
  };
}

/**
 * Ordered progression ladder of standard D&D 3.5e weapon damage dice across 9 creature sizes.
 * Based on PHB p. 114 Table 7-4: Tiny and Large Weapon Damage.
 */
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
 *
 * @param baseDice Starting damage dice (e.g. "1d6", "1d8", "2d6").
 * @param baseSize Size category the weapon was authored for (usually 'medium').
 * @param targetSize Target creature size category.
 * @returns Scaled damage dice expression.
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

  // Pick ladder
  let ladder = DICE_PROGRESSION_LADDER;
  if (baseDice === '1d8') ladder = ALTERNATE_DICE_LADDER_D8;
  else if (baseDice === '1d10') ladder = ALTERNATE_DICE_LADDER_D10;
  else if (baseDice === '1d12') ladder = ALTERNATE_DICE_LADDER_D12;

  const index = ladder.indexOf(baseDice);
  if (index === -1) {
    return baseDice; // If not in standard ladder, preserve original expression
  }

  const newIndex = Math.max(0, Math.min(ladder.length - 1, index + stepDiff));
  return ladder[newIndex]!;
}

/**
 * Evaluates whether a creature of size `wielderSize` can wield a weapon of size `weaponSize`,
 * applying the -2 attack roll penalty per size category difference and shifting effort categories.
 * (PHB p. 113: Inappropriately Sized Weapons).
 *
 * @param weaponSize Size category for which the weapon was made.
 * @param weaponHandedness Natural handedness of the weapon ('light', 'one_handed', 'two_handed').
 * @param wielderSize Size category of the creature attempting to wield it.
 * @returns Object with wieldability, shifted effective handedness, and attack penalty.
 */
const EFFORT_LADDER: ReadonlyArray<'light' | 'one_handed' | 'two_handed'> = ['light', 'one_handed', 'two_handed'];
const SIZE_MISMATCH_PENALTY_PER_STEP = 2;

/**
 * Evaluates whether a creature of size `wielderSize` can wield a weapon of size `weaponSize`,
 * applying the -2 attack roll penalty per size category difference and shifting effort categories.
 * (PHB p. 113: Inappropriately Sized Weapons).
 *
 * @param weaponSize Size category for which the weapon was made.
 * @param weaponHandedness Natural handedness of the weapon ('light', 'one_handed', 'two_handed').
 * @param wielderSize Size category of the creature attempting to wield it.
 * @returns Object with wieldability, shifted effective handedness, and attack penalty.
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
  const stepDiff = wSizeRank - cSizeRank; // positive if weapon is larger than wielder
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
 * Resolves magic item activation across the 4 canonical D&D 3.5e activation modes (DMG p. 213):
 * - `use_activated`: Drinking a potion, swinging a magic sword, wearing a ring. No skill check required.
 * - `command_word`: Speaking a word. Standard action, no check needed.
 * - `spell_trigger`: Wands and staves. Requires spell on class spell list. If not, requires UMD DC 20.
 * - `spell_completion`: Scrolls. Requires spell on class spell list. If not, requires UMD DC (20 + spellLevel).
 *
 * @param activationType One of the 4 canonical activation modes.
 * @param userHasSpellOnList Whether the user has the spell on their class spell list.
 * @param options Additional DC, UMD skill bonus, and forced roll options.
 * @returns Activation result descriptor.
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

  // If user has the spell on their class spell list:
  if (userHasSpellOnList) {
    if (activationType === 'spell_trigger') {
      return { activated: true };
    }

    // For spell_completion (scrolls), check if caster level is sufficient
    const userCl = options?.casterLevel ?? 1;
    const scrollCl = options?.scrollCasterLevel ?? 1;
    if (userCl >= scrollCl) {
      return { activated: true };
    }

    // Caster level check required: 1d20 + userCl >= scrollCl + 1
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

  // User does NOT have spell on class list: Use Magic Device check required
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
function evaluateNonproficiencyPenalty(
  weaponItemId: string | undefined,
  isExotic1HMartial2H: boolean | undefined,
  finalHandedness: 'light' | 'one_handed' | 'two_handed',
  dndData: Partial<DnD35EntityData> | undefined
): number {
  if (!isExotic1HMartial2H) {
    return 0;
  }
  // Bastard Sword / Dwarven Waraxe wielded in two hands is a Martial weapon (0 penalty)
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
function buildUnarmedProfile(wielderSize: CreatureSizeCategory, isOffHand: boolean): EquippedWeaponProfile {
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
function parseEquippedItem(
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

  // Special material physics
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

  // Parse weapon physical size
  let weaponSize: CreatureSizeCategory = wielderSize;
  const sizeTag = itemTags.find((t) => t.startsWith('weaponSize:') || t.startsWith('size:'));
  if (sizeTag) {
    const raw = sizeTag.replace(/^(?:weaponSize:|size:)/, '');
    if (Object.prototype.hasOwnProperty.call(SIZE_METRICS, raw)) {
      weaponSize = raw as CreatureSizeCategory;
    }
  }

  // Parse weapon dice
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

  // Scale dice to weaponSize
  const scaledDice = scaleWeaponDamageDice(baseDice, 'medium', weaponSize);

  // Parse damage type
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

  // Parse critical threat & multiplier
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

  // Inherent effort
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

  // Evaluate effort ladder & attack penalty
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

/**
 * Canonical Single Source of Truth for resolving all equipped weapons, grip modes,
 * effort shifting, double weapon splitting, and occupied limbs on an actor.
 *
 * @param state Current GameState.
 * @param entityId Target entity ID.
 * @param effectiveWielderSizeOverride Optional size override (e.g., from Stage 1 Stat DAG).
 * @returns Complete ResolvedActorWeapons.
 */
export function resolveAllEquippedWeaponProfiles(
  state: GameState,
  entityId: EntityId,
  effectiveWielderSizeOverride?: CreatureSizeCategory
): ResolvedActorWeapons {
  const rulesetComp = getComponent(state, entityId, ComponentType.RulesetData);
  const dndData = (rulesetComp?.rulesetId === 'dnd35e' ? rulesetComp.payload : undefined) as
    Partial<DnD35EntityData> | undefined;
  const wielderSize = effectiveWielderSizeOverride ?? dndData?.sizeCategory ?? 'medium';

  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const requestedGrip = doctrine?.gripMode;

  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;

  const isHandSlot = (s: EquipmentSlotInstance): boolean =>
    s.suppressed !== true &&
    (s.slotType === 'held' ||
      s.slotType === 'hand' ||
      s.slotType === 'main_hand' ||
      s.slotType === 'off_hand' ||
      s.id.startsWith('hand_') ||
      s.id.startsWith('main_hand') ||
      s.id.startsWith('off_hand'));

  const handSlots = (equipment?.slots ?? []).filter(isHandSlot);

  // Identify primary slot
  const primarySlot =
    handSlots.find((s) => s.equippedItem !== null && (s.slotType === 'main_hand' || s.id === 'main_hand_1')) ??
    handSlots.find((s) => s.equippedItem !== null);

  const otherHandSlots = handSlots.filter((s) => s !== primarySlot);
  const emptyHandSlots = otherHandSlots.filter((s) => s.equippedItem === null);
  const hasFreeHand = emptyHandSlots.length > 0;

  // Track all occupied limb groups from any equipped items (armor, shields, weapons)
  const occupiedLimbGroups = new Set<string>();
  for (const s of equipment?.slots ?? []) {
    if (s.equippedItem !== null && s.suppressed !== true && s.limbGroupId) {
      occupiedLimbGroups.add(s.limbGroupId);
    }
  }

  // Branch 1: Unarmed
  if (!primarySlot || primarySlot.equippedItem === null) {
    const unarmed = buildUnarmedProfile(wielderSize, false);
    return {
      primaryWeapon: unarmed,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'one_handed'
    };
  }

  const parsedPrimary = parseEquippedItem(state, primarySlot, wielderSize, dndData);
  if (!parsedPrimary) {
    const unarmed = buildUnarmedProfile(wielderSize, false);
    return {
      primaryWeapon: unarmed,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'one_handed'
    };
  }

  // Branch 2: Double Weapon in TWF mode
  if (parsedPrimary.isDoubleWeapon && requestedGrip === 'double_weapon_twf') {
    const secondHandLimb = emptyHandSlots[0]?.limbGroupId ?? 'hand_off';
    occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');
    occupiedLimbGroups.add(secondHandLimb);

    const primaryWeapon: EquippedWeaponProfile = {
      ...parsedPrimary,
      handedness: 'one_handed',
      nonproficiencyPenalty: evaluateNonproficiencyPenalty(
        parsedPrimary.weaponItemId,
        parsedPrimary.isExotic1HMartial2H,
        'one_handed',
        dndData
      )
    };

    const synthesizedOffHand: EquippedWeaponProfile = {
      ...parsedPrimary,
      weaponName: `${parsedPrimary.weaponName} (Off-Hand)`,
      inherentEffort: 'light',
      effectiveEffort: 'light',
      handedness: 'light',
      nonproficiencyPenalty: primaryWeapon.nonproficiencyPenalty,
      slotId: 'off_hand_double',
      limbGroupId: secondHandLimb
    };

    return {
      primaryWeapon,
      offHandWeapons: [synthesizedOffHand],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'double_weapon_twf'
    };
  }

  // Branch 3: Two-Handed Weapon (inherent or shifted)
  if (parsedPrimary.effectiveEffort === 'two_handed') {
    const secondHandLimb = emptyHandSlots[0]?.limbGroupId ?? 'hand_off';
    occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');
    occupiedLimbGroups.add(secondHandLimb);

    const primaryWeapon: EquippedWeaponProfile = {
      ...parsedPrimary,
      handedness: 'two_handed',
      nonproficiencyPenalty: evaluateNonproficiencyPenalty(
        parsedPrimary.weaponItemId,
        parsedPrimary.isExotic1HMartial2H,
        'two_handed',
        dndData
      )
    };

    return {
      primaryWeapon,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'two_handed'
    };
  }

  // Branch 4: One-Handed Weapon gripped in two hands (when user requested and free hand available)
  if (parsedPrimary.effectiveEffort === 'one_handed' && requestedGrip === 'two_handed' && hasFreeHand) {
    const secondHandLimb = emptyHandSlots[0]?.limbGroupId ?? 'hand_off';
    occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');
    occupiedLimbGroups.add(secondHandLimb);

    const primaryWeapon: EquippedWeaponProfile = {
      ...parsedPrimary,
      handedness: 'two_handed',
      nonproficiencyPenalty: evaluateNonproficiencyPenalty(
        parsedPrimary.weaponItemId,
        parsedPrimary.isExotic1HMartial2H,
        'two_handed',
        dndData
      )
    };

    return {
      primaryWeapon,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'two_handed'
    };
  }

  // Branch 5: Light weapon gripped in two hands (no 2H damage benefit per PHB p. 113)
  if (parsedPrimary.effectiveEffort === 'light' && requestedGrip === 'two_handed' && hasFreeHand) {
    const secondHandLimb = emptyHandSlots[0]?.limbGroupId ?? 'hand_off';
    occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');
    occupiedLimbGroups.add(secondHandLimb);

    const primaryWeapon: EquippedWeaponProfile = {
      ...parsedPrimary,
      handedness: 'light' // Stays light for damage purposes
    };

    return {
      primaryWeapon,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'two_handed'
    };
  }

  // Branch 6: One-Handed or Light weapon wielded in one hand (plus any off-hand weapons)
  occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');

  const primaryWeapon: EquippedWeaponProfile = {
    ...parsedPrimary,
    handedness: parsedPrimary.effectiveEffort,
    nonproficiencyPenalty: evaluateNonproficiencyPenalty(
      parsedPrimary.weaponItemId,
      parsedPrimary.isExotic1HMartial2H,
      parsedPrimary.effectiveEffort,
      dndData
    )
  };

  const offHandWeapons: EquippedWeaponProfile[] = [];
  for (const slot of otherHandSlots) {
    if (slot.equippedItem !== null) {
      const parsedOffHand = parseEquippedItem(state, slot, wielderSize, dndData);
      if (parsedOffHand) {
        const offHandedness =
          parsedOffHand.effectiveEffort === 'two_handed' ? 'one_handed' : parsedOffHand.effectiveEffort;
        offHandWeapons.push({
          ...parsedOffHand,
          handedness: offHandedness,
          nonproficiencyPenalty: evaluateNonproficiencyPenalty(
            parsedOffHand.weaponItemId,
            parsedOffHand.isExotic1HMartial2H,
            offHandedness,
            dndData
          )
        });
      }
    }
  }

  return {
    primaryWeapon,
    offHandWeapons,
    occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
    gripMode: 'one_handed'
  };
}

/**
 * Resolves the primary or off-hand equipped weapon profile for an actor.
 *
 * @param state Current GameState.
 * @param entityId Target entity ID.
 * @param slotType 'main_hand' or 'off_hand'.
 * @returns Complete EquippedWeaponProfile.
 */
export function resolveEquippedWeaponProfile(
  state: GameState,
  entityId: EntityId,
  slotType: 'main_hand' | 'off_hand' = 'main_hand'
): EquippedWeaponProfile {
  const resolved = resolveAllEquippedWeaponProfiles(state, entityId);
  if (slotType === 'main_hand') {
    return resolved.primaryWeapon;
  }
  return resolved.offHandWeapons[0] ?? buildUnarmedProfile(resolved.primaryWeapon.weaponSize, true);
}
