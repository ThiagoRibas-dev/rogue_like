import type { PrerequisiteEvalContext, PrerequisiteNode } from './prerequisite_types.ts';

/** Targets for weapon feats that are universally proficient per D&D 3.5e SRD. */
const AUTO_PROFICIENT_WEAPON_TARGETS: ReadonlySet<string> = new Set([
  'unarmed_strike',
  'grapple',
  'ray',
  'bite',
  'claw',
  'slam',
  'gore',
  'sting',
  'tail_slap',
  'tentacle',
  'hoof',
  'wing',
  'talon',
  'pincers',
  'spikes'
]);

/** Canonical SRD Simple Weapon IDs for fallback category resolution. */
const SRD_SIMPLE_WEAPON_IDS: ReadonlySet<string> = new Set([
  'gauntlet',
  'unarmed_strike',
  'dagger',
  'punching_dagger',
  'spiked_gauntlet',
  'light_mace',
  'Mace, Light',
  'mace_light',
  'sickle',
  'club',
  'heavy_mace',
  'mace_heavy',
  'morningstar',
  'shortspear',
  'longspear',
  'quarterstaff',
  'spear',
  'heavy_crossbow',
  'crossbow_heavy',
  'light_crossbow',
  'crossbow_light',
  'dart',
  'javelin',
  'sling'
]);

/** Canonical SRD Martial Weapon IDs for fallback category resolution. */
const SRD_MARTIAL_WEAPON_IDS: ReadonlySet<string> = new Set([
  'throwing_axe',
  'light_hammer',
  'handaxe',
  'kukri',
  'light_pick',
  'sap',
  'short_sword',
  'battleaxe',
  'flail',
  'longsword',
  'heavy_pick',
  'rapier',
  'scimitar',
  'trident',
  'warhammer',
  'falchion',
  'glaive',
  'greataxe',
  'greatclub',
  'heavy_flail',
  'greatsword',
  'guisarme',
  'halberd',
  'lance',
  'ranseur',
  'scythe',
  'longbow',
  'composite_longbow',
  'shortbow',
  'composite_shortbow'
]);

/**
 * Returns the composite/standard bow equivalent ID if applicable per SRD rules.
 */
export function getEquivalentBowWeaponId(weaponId: string): string | undefined {
  if (weaponId === 'longbow') return 'composite_longbow';
  if (weaponId === 'composite_longbow') return 'longbow';
  if (weaponId === 'shortbow') return 'composite_shortbow';
  if (weaponId === 'composite_shortbow') return 'shortbow';
  return undefined;
}

/**
 * Checks whether `feats` contains `baseFeatId` parameterized for `targetId`
 * (including SRD composite bow equivalence).
 */
export function hasTargetedFeatInList(feats: ReadonlyArray<string>, baseFeatId: string, targetId: string): boolean {
  if (feats.includes(`${baseFeatId}:${targetId}`) || feats.includes(`${baseFeatId}_${targetId}`)) {
    return true;
  }
  const equivBow = getEquivalentBowWeaponId(targetId);
  if (equivBow !== undefined) {
    return feats.includes(`${baseFeatId}:${equivBow}`) || feats.includes(`${baseFeatId}_${equivBow}`);
  }
  return false;
}

/**
 * Evaluates a `has_proficiency` node against `PrerequisiteEvalContext`.
 */
export function evaluateProficiencyPrerequisite(
  node: Extract<PrerequisiteNode, { readonly type: 'has_proficiency' }>,
  context: PrerequisiteEvalContext
): boolean {
  const categories = context.proficientWeaponCategories ?? [];
  const weaponIds = context.proficientWeaponIds ?? [];
  const armorCats = context.proficientArmorCategories ?? [];
  const shieldCats = context.proficientShieldCategories ?? [];

  switch (node.scope) {
    case 'martial_all':
      return (
        categories.includes('martial') ||
        context.tags.includes('proficiency:martial') ||
        context.feats.includes('martial_weapon_proficiency_all')
      );
    case 'simple_all':
      return (
        categories.includes('simple') ||
        context.tags.includes('proficiency:simple') ||
        context.feats.includes('simple_weapon_proficiency')
      );
    case 'armor_light':
      return (
        armorCats.includes('light') ||
        context.tags.includes('proficiency:armor_light') ||
        context.feats.includes('armor_proficiency_light')
      );
    case 'armor_medium':
      return (
        armorCats.includes('medium') ||
        context.tags.includes('proficiency:armor_medium') ||
        context.feats.includes('armor_proficiency_medium')
      );
    case 'armor_heavy':
      return (
        armorCats.includes('heavy') ||
        context.tags.includes('proficiency:armor_heavy') ||
        context.feats.includes('armor_proficiency_heavy')
      );
    case 'shield':
      return (
        shieldCats.includes('shield') ||
        context.tags.includes('proficiency:shields') ||
        context.feats.includes('shield_proficiency')
      );
    case 'tower_shield':
      return (
        shieldCats.includes('tower') ||
        context.tags.includes('proficiency:tower_shield') ||
        context.feats.includes('tower_shield_proficiency')
      );
    case 'selected_weapon':
    case 'weapon': {
      const targetWeaponId = node.weaponId ?? context.targetId;
      if (targetWeaponId === undefined) {
        if (context.proficientWeaponCategories === undefined && context.proficientWeaponIds === undefined) {
          return true;
        }
        return categories.length > 0 || weaponIds.length > 0;
      }
      if (AUTO_PROFICIENT_WEAPON_TARGETS.has(targetWeaponId)) return true;
      if (weaponIds.includes(targetWeaponId)) return true;
      const equivBow = getEquivalentBowWeaponId(targetWeaponId);
      if (equivBow !== undefined && weaponIds.includes(equivBow)) return true;
      if (
        hasTargetedFeatInList(context.feats, 'exotic_weapon_proficiency', targetWeaponId) ||
        hasTargetedFeatInList(context.feats, 'martial_weapon_proficiency', targetWeaponId) ||
        context.tags.includes(`proficiency:${targetWeaponId}`)
      ) {
        return true;
      }
      if (SRD_SIMPLE_WEAPON_IDS.has(targetWeaponId)) {
        return (
          categories.includes('simple') ||
          context.tags.includes('proficiency:simple') ||
          context.feats.includes('simple_weapon_proficiency') ||
          (context.proficientWeaponCategories === undefined && context.proficientWeaponIds === undefined)
        );
      }
      if (SRD_MARTIAL_WEAPON_IDS.has(targetWeaponId)) {
        return (
          categories.includes('martial') ||
          context.tags.includes('proficiency:martial') ||
          (context.proficientWeaponCategories === undefined && context.proficientWeaponIds === undefined)
        );
      }
      return categories.includes('exotic');
    }
  }
}
