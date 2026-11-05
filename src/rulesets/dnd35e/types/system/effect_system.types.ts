import { z } from 'zod';
import type { PrerequisiteNode } from '../../prerequisites.ts';
import {
  DnD35AlignmentSchema,
  DnD35DamageReductionSchema,
  DnD35SensoryProfileSchema,
  SizeCategorySchema
} from './base_system.types.ts';

/** Zod schema for tag-matching conditions on declarative modifiers and effect units. */
export const DnD35ModifierTagConditionSchema = z.object({
  selfTagsAll: z.array(z.string()).optional(),
  selfTagsAny: z.array(z.string()).optional(),
  selfTagsNone: z.array(z.string()).optional(),
  targetTagsAll: z.array(z.string()).optional(),
  targetTagsAny: z.array(z.string()).optional(),
  targetTagsNone: z.array(z.string()).optional(),
  effectTagsAll: z.array(z.string()).optional(),
  effectTagsAny: z.array(z.string()).optional(),
  effectTagsNone: z.array(z.string()).optional()
});
export type DnD35ModifierTagCondition = z.infer<typeof DnD35ModifierTagConditionSchema>;

/** Zod schema for a declarative Effect Provider modifier entry on a class feature, domain, feat, or race. */
export const DnD35DeclarativeModifierSchema = z.object({
  id: z.string(),
  target: z.string(),
  value: z.number(),
  type: z.enum([
    'alchemical',
    'armor',
    'armor_enhancement',
    'base',
    'circumstance',
    'competence',
    'deflection',
    'dodge',
    'enhancement',
    'form_override',
    'inherent',
    'insight',
    'luck',
    'morale',
    'natural_armor',
    'natural_armor_enhancement',
    'profane',
    'racial',
    'resistance',
    'sacred',
    'shield',
    'shield_enhancement',
    'size',
    'size_step',
    'threat_expansion',
    'untyped'
  ]),
  effectTags: z.array(z.string()).optional(),
  condition: DnD35ModifierTagConditionSchema.optional()
});
export type DnD35DeclarativeModifier = z.infer<typeof DnD35DeclarativeModifierSchema>;

/** Zod schema for canonical D&D 3.5e bonus types usable in declarative modifiers. */
export const DnD35BonusTypeSchema = DnD35DeclarativeModifierSchema.shape.type;
export type DnD35BonusType = z.infer<typeof DnD35BonusTypeSchema>;

/** Zod schema for a declarative Rule Override entry inside an Effect Bundle. */
export const DnD35RuleOverrideEntrySchema = z.object({
  id: z.string(),
  ruleKey: z.string(),
  value: z.union([z.boolean(), z.number(), z.string()]),
  priority: z.number().int().default(10)
});
export type DnD35RuleOverrideEntry = z.infer<typeof DnD35RuleOverrideEntrySchema>;

/** Zod schema for a structured or virtual feat grant (e.g., Ranger Combat Style or Monk Bonus Feats that bypass prerequisites). */
export const DnD35FeatGrantDescriptorSchema = z.object({
  featId: z.string(),
  ignorePrerequisites: z.boolean().default(false)
});
export type DnD35FeatGrantDescriptor = z.infer<typeof DnD35FeatGrantDescriptorSchema>;

/** Zod schema for an activated, toggled, variable-dial, or spell-like ability granted by an Effect Bundle. */
export const DnD35ActivatedAbilityDescriptorSchema = z.object({
  abilityId: z.string(),
  name: z.string(),
  actionCost: z.enum(['standard', 'move', 'full_round', 'swift', 'immediate', 'free', 'none']).default('standard'),
  usageLimitPoolId: z.string().optional(),
  spellLikeSpellId: z.string().optional(),
  casterLevelFormula: z.enum(['character_level', 'class_level', 'racial_hd', 'half_class_level', 'fixed_1']).optional(),
  variableDial: z
    .object({
      min: z.number().int().nonnegative().default(0),
      maxCapRule: z.enum(['bab', 'fixed_5', 'class_level']),
      attackDeltaPerPoint: z.number().default(0),
      damageDeltaPerPoint: z.number().default(0),
      acDeltaPerPoint: z.number().default(0)
    })
    .optional()
});
export type DnD35ActivatedAbilityDescriptor = z.infer<typeof DnD35ActivatedAbilityDescriptorSchema>;

/**
 * Universal Zod schema for a named, atomic Effect Bundle (`DnD35EffectBundleSchema`).
 * Reusable across Feats, Class Features, ACFs, Domain Granted Powers, Racial Traits,
 * Creature Types, Subtypes, and Templates.
 */
export const DnD35EffectBundleSchema = z.object({
  bundleId: z.string(),
  name: z.string(),
  category: z
    .enum(['ex', 'su', 'sp', 'trait', 'domain_power', 'feat', 'class_feature', 'acf', 'proficiency'])
    .default('trait'),
  usageMode: z.enum(['passive', 'activated', 'toggle', 'variable_dial', 'spell_like', 'triggered']).default('passive'),
  description: z.string().optional(),
  activationCondition: z
    .object({
      selfTagsAll: z.array(z.string()).optional(),
      selfTagsAny: z.array(z.string()).optional(),
      selfTagsNone: z.array(z.string()).optional()
    })
    .optional(),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  ruleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([]),
  grantedTags: z.array(z.string()).default([]),
  grantedFeats: z.array(z.string()).default([]),
  virtualFeatGrants: z.array(DnD35FeatGrantDescriptorSchema).default([]),
  bonusFeatPool: z.array(z.string()).optional(),
  classSkillsAdded: z.array(z.string()).default([]),
  grantedSenses: DnD35SensoryProfileSchema.optional(),
  immunities: z.array(z.string()).default([]),
  vulnerabilities: z.array(z.string()).default([]),
  energyResistances: z.record(z.string(), z.number().int().nonnegative()).default({}),
  damageReduction: DnD35DamageReductionSchema.optional(),
  spellResistance: z.number().int().nonnegative().optional(),
  activatedAbilities: z.array(DnD35ActivatedAbilityDescriptorSchema).default([]),
  resourcePool: z
    .object({
      poolId: z.string(),
      maxBase: z.number().int().nonnegative(),
      perClassLevel: z.number().nonnegative().optional(),
      abilityModStat: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
      refreshCycle: z.enum(['round', 'encounter', 'short_rest', 'rest_8h']).default('rest_8h')
    })
    .optional()
});
export type DnD35EffectBundle = z.infer<typeof DnD35EffectBundleSchema>;

/** Recursive Zod schema for PrerequisiteNode ASTs (`prerequisites.ts`). */
export const PrerequisiteNodeSchema: z.ZodType<PrerequisiteNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('and'), children: z.array(PrerequisiteNodeSchema) }),
    z.object({ type: z.literal('or'), children: z.array(PrerequisiteNodeSchema) }),
    z.object({ type: z.literal('not'), child: PrerequisiteNodeSchema }),
    z.object({
      type: z.literal('min_ability'),
      ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
      minScore: z.number().int()
    }),
    z.object({ type: z.literal('min_bab'), minBab: z.number().int() }),
    z.object({ type: z.literal('min_skill_ranks'), skillId: z.string(), minRanks: z.number() }),
    z.object({ type: z.literal('has_feat'), featId: z.string() }),
    z.object({ type: z.literal('has_tag'), tag: z.string() }),
    z.object({ type: z.literal('min_caster_level'), minCasterLevel: z.number().int() }),
    z.object({ type: z.literal('size_in'), allowedSizes: z.array(SizeCategorySchema) }),
    z.object({ type: z.literal('alignment_in'), allowedAlignments: z.array(DnD35AlignmentSchema) }),
    z.object({
      type: z.literal('min_spell_level'),
      tradition: z.enum(['arcane', 'divine', 'any']),
      minSpellLevel: z.number().int().min(0).max(9)
    }),
    z.object({ type: z.literal('race_in'), allowedRaces: z.array(z.string()) })
  ])
);

/** Zod schema for cross-class scaling pool contributions (e.g. Uncanny Dodge, Turn Undead, Familiar master level). */
export const DnD35ScalingPoolContributionSchema = z.object({
  poolId: z.string(),
  multiplier: z.number().default(1),
  offset: z.number().int().default(0),
  minClassLevel: z.number().int().positive().default(1)
});
export type DnD35ScalingPoolContribution = z.infer<typeof DnD35ScalingPoolContributionSchema>;

/** Zod schema for a structured class feature definition. */
export const DnD35ClassFeatureDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['ex', 'su', 'sp', 'bonus_feat', 'proficiency', 'caster_advancement']).default('ex'),
  usageMode: z.enum(['passive', 'activated', 'toggle', 'variable_dial', 'spell_like', 'triggered']).default('passive'),
  description: z.string().optional(),
  activationCondition: z
    .object({
      selfTagsAll: z.array(z.string()).optional(),
      selfTagsAny: z.array(z.string()).optional(),
      selfTagsNone: z.array(z.string()).optional()
    })
    .optional(),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  ruleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([]),
  grantedTags: z.array(z.string()).default([]),
  grantedFeats: z.array(z.string()).default([]),
  virtualFeatGrants: z.array(DnD35FeatGrantDescriptorSchema).default([]),
  activatedAbilities: z.array(DnD35ActivatedAbilityDescriptorSchema).default([]),
  upgradeOnDuplicateFeatureId: z.string().optional(),
  scalingPoolContribution: DnD35ScalingPoolContributionSchema.optional(),
  resourcePool: z
    .object({
      poolId: z.string(),
      maxBase: z.number().int().nonnegative(),
      perClassLevel: z.number().nonnegative().optional(),
      abilityModStat: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
      refreshCycle: z.enum(['round', 'encounter', 'short_rest', 'rest_8h']).default('rest_8h')
    })
    .optional(),
  bonusFeatPool: z.array(z.string()).optional()
});
export type DnD35ClassFeatureDetail = z.infer<typeof DnD35ClassFeatureDetailSchema>;

/** Zod schema for an Alternate Class Feature (ACF) swap. */
export const DnD35AcfSwapSchema = z.object({
  acfId: z.string(),
  name: z.string(),
  replacesFeature: z.string(),
  grantedFeature: z.string(),
  level: z.number().int().positive(),
  description: z.string().optional(),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  effectBundle: DnD35EffectBundleSchema.optional()
});
export type DnD35AcfSwap = z.infer<typeof DnD35AcfSwapSchema>;

/** Zod schema for a Cleric Domain definition (`domains.json` & `domains/<id>.json`). */
export const DnD35DomainDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  grantedPowerDescription: z.string(),
  grantedPowerBundle: DnD35EffectBundleSchema.optional(),
  classSkillsAdded: z.array(z.string()).default([]),
  featGrants: z.array(z.string()).default([]),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  resourcePool: z
    .object({
      poolId: z.string(),
      maxBase: z.number().int().nonnegative(),
      abilityModStat: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
      refreshCycle: z.enum(['round', 'encounter', 'short_rest', 'rest_8h']).default('rest_8h')
    })
    .optional(),
  domainSpells: z.record(z.string(), z.string()).default({})
});
export type DnD35DomainDefinition = z.infer<typeof DnD35DomainDefinitionSchema>;

/** Zod schema for a racial conditional modifier (e.g. +4 dodge vs giants). */
export const DnD35RacialConditionalModifierSchema = z.object({
  id: z.string(),
  target: z.string(),
  value: z.number(),
  type: z.enum([
    'alchemical',
    'armor',
    'base',
    'circumstance',
    'competence',
    'deflection',
    'dodge',
    'enhancement',
    'form_override',
    'inherent',
    'insight',
    'luck',
    'morale',
    'natural_armor',
    'profane',
    'racial',
    'resistance',
    'sacred',
    'shield',
    'size',
    'size_step',
    'untyped'
  ]),
  condition: DnD35ModifierTagConditionSchema
});
export type DnD35RacialConditionalModifier = z.infer<typeof DnD35RacialConditionalModifierSchema>;
