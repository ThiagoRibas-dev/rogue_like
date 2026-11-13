import { dndFloor } from './math/multipliers.ts';
import type { AbilityId, CreatureSizeCategory, DnD35Alignment, DnD35SpellSchool } from './types/dnd35e.types.ts';

/** Scope categories for declarative proficiency checks (`has_proficiency`). */
export type ProficiencyPrerequisiteScope =
  | 'selected_weapon'
  | 'weapon'
  | 'martial_all'
  | 'simple_all'
  | 'armor_light'
  | 'armor_medium'
  | 'armor_heavy'
  | 'shield'
  | 'tower_shield';

/**
 * Recursive AST node representing a declarative D&D 3.5e prerequisite requirement
 * (used by Feats, Prestige Classes, ACFs, Templates, Special Actions, and Campaign Editor validators).
 */
export type PrerequisiteNode =
  | { readonly type: 'and'; readonly children: ReadonlyArray<PrerequisiteNode> }
  | { readonly type: 'or'; readonly children: ReadonlyArray<PrerequisiteNode> }
  | { readonly type: 'not'; readonly child: PrerequisiteNode }
  | { readonly type: 'min_ability'; readonly ability: AbilityId; readonly minScore: number }
  | { readonly type: 'min_bab'; readonly minBab: number }
  | { readonly type: 'min_skill_ranks'; readonly skillId: string; readonly minRanks: number }
  | {
      readonly type: 'min_skill_count_at_ranks';
      readonly skillPrefix: string;
      readonly minRanks: number;
      readonly minCount: number;
    }
  | {
      readonly type: 'has_feat';
      readonly featId: string;
      readonly targetId?: string | undefined;
      readonly targetPrefix?: string | undefined;
      readonly targetIdsAny?: ReadonlyArray<string> | undefined;
    }
  | {
      readonly type: 'min_feat_count';
      readonly pool: 'metamagic_or_item_creation';
      readonly minCount: number;
    }
  | { readonly type: 'has_tag'; readonly tag: string }
  | { readonly type: 'min_caster_level'; readonly minCasterLevel: number }
  | { readonly type: 'min_class_level'; readonly classId: string; readonly minLevel: number }
  | { readonly type: 'min_character_level'; readonly minLevel: number }
  | {
      readonly type: 'has_proficiency';
      readonly scope: ProficiencyPrerequisiteScope;
      readonly weaponId?: string | undefined;
    }
  | { readonly type: 'min_natural_attacks'; readonly minCount: number }
  | { readonly type: 'min_hands'; readonly minHands: number }
  | { readonly type: 'min_natural_armor'; readonly minBonus: number }
  | { readonly type: 'min_fly_speed'; readonly minSpeedFt: number }
  | { readonly type: 'min_sla_caster_level'; readonly minCasterLevel: number }
  | {
      readonly type: 'size_in';
      readonly allowedSizes: ReadonlyArray<CreatureSizeCategory>;
    }
  | {
      readonly type: 'alignment_in';
      readonly allowedAlignments: ReadonlyArray<DnD35Alignment>;
    }
  | {
      readonly type: 'min_spell_level';
      readonly tradition: 'arcane' | 'divine' | 'any';
      readonly minSpellLevel: number;
      readonly castingMode?: 'prepared' | 'spontaneous' | 'any' | undefined;
      readonly school?: DnD35SpellSchool | undefined;
      readonly minSchoolSpellCount?: number | undefined;
    }
  | {
      readonly type: 'race_in';
      readonly allowedRaces: ReadonlyArray<string>;
    };

/** Snapshot of an entity's stats used to evaluate a `PrerequisiteNode` AST. */
export interface PrerequisiteEvalContext {
  readonly abilityScores: Readonly<Record<AbilityId, number | null>>;
  readonly totalBab: number;
  readonly skillRanks: Readonly<Record<string, number>>;
  readonly feats: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly casterLevel: number;
  readonly sizeCategory: CreatureSizeCategory;
  readonly alignment?: DnD35Alignment | undefined;
  readonly raceId?: string | undefined;
  readonly maxArcaneSpellLevel?: number | undefined;
  readonly maxDivineSpellLevel?: number | undefined;
  readonly maxPreparedArcaneSpellLevel?: number | undefined;
  readonly maxSpontaneousArcaneSpellLevel?: number | undefined;
  readonly maxPreparedDivineSpellLevel?: number | undefined;
  readonly maxSpontaneousDivineSpellLevel?: number | undefined;
  readonly classLevels?: Readonly<Record<string, number>> | undefined;
  readonly characterLevel?: number | undefined;
  readonly proficientWeaponCategories?: ReadonlyArray<'simple' | 'martial' | 'exotic'> | undefined;
  readonly proficientWeaponIds?: ReadonlyArray<string> | undefined;
  readonly proficientArmorCategories?: ReadonlyArray<'light' | 'medium' | 'heavy'> | undefined;
  readonly proficientShieldCategories?: ReadonlyArray<'shield' | 'tower'> | undefined;
  readonly naturalAttackCount?: number | undefined;
  readonly handCount?: number | undefined;
  readonly naturalArmorBonus?: number | undefined;
  readonly flySpeedFt?: number | undefined;
  readonly maxSlaCasterLevel?: number | undefined;
  readonly metamagicOrItemCreationFeatCount?: number | undefined;
  readonly spellCountBySchool?: Readonly<Partial<Record<DnD35SpellSchool, number>>> | undefined;
  readonly maxSpellLevelBySchool?: Readonly<Partial<Record<DnD35SpellSchool, number>>> | undefined;
  readonly arcaneSchool?: DnD35SpellSchool | 'universal' | undefined;
  readonly targetId?: string | undefined;
}

/** Targets for weapon feats that are universally proficient per D&D 3.5e SRD (unarmed, grapple, ray, natural weapons). */
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

/** Canonical SRD Simple Weapon IDs for fallback category resolution when `proficientWeaponIds` is not pre-expanded. */
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

/** Canonical SRD Martial Weapon IDs for fallback category resolution when `proficientWeaponIds` is not pre-expanded. */
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
 * Returns the composite/standard bow equivalent ID if applicable per SRD weapon proficiency & feat sharing rules.
 */
function getEquivalentBowWeaponId(weaponId: string): string | undefined {
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
function hasTargetedFeatInList(feats: ReadonlyArray<string>, baseFeatId: string, targetId: string): boolean {
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
function evaluateProficiencyPrerequisite(
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
      if (AUTO_PROFICIENT_WEAPON_TARGETS.has(targetWeaponId)) {
        return true;
      }
      if (weaponIds.includes(targetWeaponId)) {
        return true;
      }
      const equivBow = getEquivalentBowWeaponId(targetWeaponId);
      if (equivBow !== undefined && weaponIds.includes(equivBow)) {
        return true;
      }
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

/**
 * Evaluates a recursive `PrerequisiteNode` AST against an entity's `PrerequisiteEvalContext`.
 * Note: Nonability scores (`null`) never satisfy a positive `min_ability` requirement.
 *
 * @param node The root `PrerequisiteNode` to evaluate.
 * @param context The entity's `PrerequisiteEvalContext`.
 * @returns True if all requirements in the AST are satisfied.
 */
export function evaluatePrerequisiteAST(node: PrerequisiteNode, context: PrerequisiteEvalContext): boolean {
  switch (node.type) {
    case 'and':
      return node.children.every((child) => evaluatePrerequisiteAST(child, context));
    case 'or':
      return node.children.some((child) => evaluatePrerequisiteAST(child, context));
    case 'not':
      return !evaluatePrerequisiteAST(node.child, context);
    case 'min_ability': {
      const score = context.abilityScores[node.ability];
      return score !== null && score >= node.minScore;
    }
    case 'min_bab':
      return context.totalBab >= node.minBab;
    case 'min_skill_ranks': {
      const wholeRanks = dndFloor(context.skillRanks[node.skillId] ?? 0);
      return wholeRanks >= node.minRanks;
    }
    case 'min_skill_count_at_ranks': {
      let matchingCount = 0;
      for (const [skillId, rawRanks] of Object.entries(context.skillRanks)) {
        if (skillId.startsWith(node.skillPrefix) && dndFloor(rawRanks) >= node.minRanks) {
          matchingCount++;
        }
      }
      return matchingCount >= node.minCount;
    }
    case 'has_feat': {
      if (node.featId.includes(':') || node.targetId !== undefined) {
        const parts = node.featId.split(':');
        const baseFeatId = parts[0]!;
        const reqTarget = node.targetId ?? parts[1];
        if (reqTarget !== undefined) {
          return hasTargetedFeatInList(context.feats, baseFeatId, reqTarget);
        }
      }
      if (node.targetIdsAny !== undefined && node.targetIdsAny.length > 0) {
        return node.targetIdsAny.some((t) => hasTargetedFeatInList(context.feats, node.featId, t));
      }
      if (node.targetPrefix !== undefined) {
        const colonPrefix = `${node.featId}:${node.targetPrefix}`;
        const underscorePrefix = `${node.featId}_${node.targetPrefix}`;
        return context.feats.some((f) => f.startsWith(colonPrefix) || f.startsWith(underscorePrefix));
      }
      if (context.targetId !== undefined) {
        return (
          hasTargetedFeatInList(context.feats, node.featId, context.targetId) || context.feats.includes(node.featId)
        );
      }
      if (context.feats.includes(node.featId)) return true;
      return context.feats.some((f) => f.startsWith(`${node.featId}:`) || f.startsWith(`${node.featId}_`));
    }
    case 'min_feat_count': {
      if (context.metamagicOrItemCreationFeatCount !== undefined) {
        return context.metamagicOrItemCreationFeatCount >= node.minCount;
      }
      const fallbackPool = new Set([
        'empower_spell',
        'enlarge_spell',
        'extend_spell',
        'heighten_spell',
        'maximize_spell',
        'quicken_spell',
        'silent_spell',
        'still_spell',
        'widen_spell',
        'brew_potion',
        'craft_magic_arms_and_armor',
        'craft_rod',
        'craft_staff',
        'craft_wand',
        'craft_wondrous_item',
        'forge_ring',
        'scribe_scroll'
      ]);
      const count = context.feats.filter((f) => fallbackPool.has(f.split(':')[0]!)).length;
      return count >= node.minCount;
    }
    case 'has_tag':
      return context.tags.includes(node.tag);
    case 'min_caster_level':
      return context.casterLevel >= node.minCasterLevel;
    case 'min_class_level':
      return (context.classLevels?.[node.classId] ?? 0) >= node.minLevel;
    case 'min_character_level':
      return (context.characterLevel ?? 1) >= node.minLevel;
    case 'has_proficiency':
      return evaluateProficiencyPrerequisite(node, context);
    case 'min_natural_attacks':
      return (context.naturalAttackCount ?? 0) >= node.minCount;
    case 'min_hands':
      return (context.handCount ?? 2) >= node.minHands;
    case 'min_natural_armor':
      return (context.naturalArmorBonus ?? 0) >= node.minBonus;
    case 'min_fly_speed':
      return (context.flySpeedFt ?? 0) >= node.minSpeedFt || context.tags.includes('movement:fly');
    case 'min_sla_caster_level':
      return (context.maxSlaCasterLevel ?? 0) >= node.minCasterLevel;
    case 'size_in':
      return node.allowedSizes.includes(context.sizeCategory);
    case 'alignment_in':
      return context.alignment !== undefined && node.allowedAlignments.includes(context.alignment);
    case 'min_spell_level': {
      if (node.school !== undefined) {
        const schoolMaxLevel = context.maxSpellLevelBySchool?.[node.school] ?? -1;
        if (schoolMaxLevel < node.minSpellLevel) return false;
        if (node.minSchoolSpellCount !== undefined) {
          const schoolCount = context.spellCountBySchool?.[node.school] ?? 0;
          if (schoolCount < node.minSchoolSpellCount) return false;
        }
      }
      const mode = node.castingMode ?? 'any';
      if (mode === 'spontaneous') {
        const spArcane = context.maxSpontaneousArcaneSpellLevel ?? -1;
        const spDivine = context.maxSpontaneousDivineSpellLevel ?? -1;
        if (node.tradition === 'arcane') return spArcane >= node.minSpellLevel;
        if (node.tradition === 'divine') return spDivine >= node.minSpellLevel;
        return Math.max(spArcane, spDivine) >= node.minSpellLevel;
      }
      if (mode === 'prepared') {
        const prepArcane = context.maxPreparedArcaneSpellLevel ?? -1;
        const prepDivine = context.maxPreparedDivineSpellLevel ?? -1;
        if (node.tradition === 'arcane') return prepArcane >= node.minSpellLevel;
        if (node.tradition === 'divine') return prepDivine >= node.minSpellLevel;
        return Math.max(prepArcane, prepDivine) >= node.minSpellLevel;
      }
      const arcaneMax = context.maxArcaneSpellLevel ?? -1;
      const divineMax = context.maxDivineSpellLevel ?? -1;
      if (node.tradition === 'arcane') {
        return arcaneMax >= node.minSpellLevel;
      }
      if (node.tradition === 'divine') {
        return divineMax >= node.minSpellLevel;
      }
      return Math.max(arcaneMax, divineMax) >= node.minSpellLevel;
    }
    case 'race_in':
      return context.raceId !== undefined && node.allowedRaces.includes(context.raceId);
  }
}
