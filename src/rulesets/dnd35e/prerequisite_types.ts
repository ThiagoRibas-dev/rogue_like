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
