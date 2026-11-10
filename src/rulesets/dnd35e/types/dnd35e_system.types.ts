import { z } from 'zod';
import type { CampaignData } from '../../../types/campaign.types.ts';
import { DnD35AlignmentSchema, DnD35DragonFamiliesDataSchema } from './system/base_system.types.ts';
import {
  DnD35AcfSwapSchema,
  DnD35ActivatedAbilityDescriptorSchema,
  DnD35ClassFeatureDetailSchema,
  DnD35DeclarativeModifierSchema,
  DnD35DomainDefinitionSchema,
  DnD35EffectBundleSchema,
  DnD35RuleOverrideEntrySchema,
  PrerequisiteNodeSchema
} from './system/effect_system.types.ts';
import {
  DnD35ArchetypeSchema,
  DnD35CreatureTypeEngineSchema,
  DnD35RaceDefinitionSchema,
  DnD35SubtypeDefinitionSchema,
  DnD35TemplateSchema
} from './system/creature_system.types.ts';
import { DnD35ItemDefinitionSchema, DnD35ItemEnhancementSchema } from './system/item_system.types.ts';

// Re-export base types and schemas
export * from './system/base_system.types.ts';

// Re-export effect types and schemas
export * from './system/effect_system.types.ts';

// Re-export creature and race types and schemas
export * from './system/creature_system.types.ts';

// Re-export item types and schemas
export * from './system/item_system.types.ts';

// Re-export spell types and schemas
export * from './system/spell_system.types.ts';
import { DnD35SpellDefinitionSchema } from './system/spell_system.types.ts';

/** Zod schema for a single row in a class's level-by-level progression table (levels 1..maxLevel). */
export const DnD35ClassLevelRowSchema = z.object({
  level: z.number().int().positive(),
  bab: z.number().int().nonnegative(),
  fortSave: z.number().int().nonnegative(),
  refSave: z.number().int().nonnegative(),
  willSave: z.number().int().nonnegative(),
  features: z.array(z.string()).default([]),
  bonusFeatSlot: z.boolean().optional(),
  spellsPerDay: z.record(z.string(), z.number().int().nonnegative()).optional(),
  domainSpellSlots: z.record(z.string(), z.number().int().nonnegative()).optional(),
  spellsKnown: z.record(z.string(), z.number().int().nonnegative()).optional(),
  advancesSpellcasting: z.enum(['arcane', 'divine', 'both', 'any']).optional(),
  scalingValues: z.record(z.string(), z.union([z.number(), z.string()])).optional()
});
/** Inferred type for a single class level progression row. */
export type DnD35ClassLevelRow = z.infer<typeof DnD35ClassLevelRowSchema>;

/** Zod schema for a declarative character class definition (`classes.json` & `classes/<id>.json`). */
export const DnD35ClassDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPrestige: z.boolean().default(false),
  isNpcClass: z.boolean().default(false),
  maxLevel: z.number().int().positive().default(20),
  hitDieSides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  skillPointsPerLevel: z.number().int().nonnegative(),
  classSkills: z.array(z.string()).default([]),
  grantsLiteracy: z.boolean().default(true),
  castingMode: z.enum(['none', 'prepared', 'spontaneous']).default('none'),
  castingTradition: z.enum(['none', 'arcane', 'divine']).default('none'),
  spellAcquisitionMode: z.enum(['none', 'spellbook_scribed', 'spontaneous_known', 'prayerbook_full_list']).optional(),
  castingKeyAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
  allowedAlignments: z.array(DnD35AlignmentSchema).optional(),
  prerequisites: PrerequisiteNodeSchema.optional(),
  proficiencies: z
    .object({
      weapons: z.array(z.string()).default([]),
      armor: z.array(z.string()).default([]),
      shields: z.array(z.string()).default([])
    })
    .optional(),
  progression: z.array(DnD35ClassLevelRowSchema).min(1),
  featureDetails: z.record(z.string(), DnD35ClassFeatureDetailSchema).default({}),
  acfSwaps: z.array(DnD35AcfSwapSchema).default([])
});
/** Inferred type for a declarative class definition. */
export type DnD35ClassDefinition = z.infer<typeof DnD35ClassDefinitionSchema>;

/** Zod schema for a declarative Skill Action inside a skill definition (`skills/<id>.json`). */
export const DnD35SkillActionDescriptorSchema = z.object({
  actionId: z.string(),
  name: z.string(),
  actionCost: z.enum(['none', 'free', 'move', 'standard', 'full_round', 'part_of_movement']),
  dc: z.number().int().optional(),
  opposedBySkill: z.string().optional(),
  description: z.string(),
  onSuccessModifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  onSuccessRuleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([])
});
export type DnD35SkillActionDescriptor = z.infer<typeof DnD35SkillActionDescriptorSchema>;

/** Zod schema for a skill rank threshold grant (e.g. at 5 ranks unlock Dodge AC or grantedTags). */
export const DnD35SkillRankThresholdGrantSchema = z.object({
  minRanks: z.number().int().positive(),
  name: z.string().optional(),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  ruleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([]),
  grantedTags: z.array(z.string()).default([]),
  effectBundle: DnD35EffectBundleSchema.optional()
});
export type DnD35SkillRankThresholdGrant = z.infer<typeof DnD35SkillRankThresholdGrantSchema>;

/** Zod schema for a declarative skill definition (`skills/<id>.json`). */
export const DnD35SkillDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
  trainedOnly: z.boolean().default(false),
  acpMultiplier: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  retryAllowed: z.boolean().default(true),
  take10Allowed: z.boolean().default(true),
  take20Allowed: z.boolean().default(true),
  synergyFromSkills: z.array(z.string()).default([]),
  synergyNotes: z.string().optional(),
  actions: z.array(DnD35SkillActionDescriptorSchema).default([]),
  rankThresholdModifiers: z.array(DnD35SkillRankThresholdGrantSchema).default([]),
  effectBundle: DnD35EffectBundleSchema.optional()
});
/** Inferred type for a declarative skill definition. */
export type DnD35SkillDefinition = z.infer<typeof DnD35SkillDefinitionSchema>;

/** Repeatable feat configuration distinguishing stacking vs targeted mechanics. */
export const DnD35FeatRepeatableSchema = z.object({
  mode: z.enum(['stacking', 'targeted']),
  targetCategory: z.enum(['weapon', 'school', 'skill', 'ability']).optional()
});
export type DnD35FeatRepeatable = z.infer<typeof DnD35FeatRepeatableSchema>;

/** Structured metamagic feat descriptor (`feats/<id>.json`). */
export const DnD35MetamagicDescriptorSchema = z.object({
  slotLevelAdjustment: z.number().int().min(0).max(9),
  isVariableHeighten: z.boolean().optional(),
  actionTimeOverride: z.enum(['swift', 'full_round']).optional(),
  rangeMultiplier: z.number().positive().optional(),
  durationMultiplier: z.number().positive().optional(),
  areaMultiplier: z.number().positive().optional(),
  empowerDamageMultiplier: z.number().positive().optional(),
  maximizeVariableDice: z.boolean().optional(),
  suppressVerbalComponent: z.boolean().optional(),
  suppressSomaticComponent: z.boolean().optional()
});
export type DnD35MetamagicDescriptor = z.infer<typeof DnD35MetamagicDescriptorSchema>;

/** Zod schema for a declarative feat definition (`feats.json` & `feats/<id>.json`). */
export const DnD35FeatDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isFighterBonusFeat: z.boolean().default(false),
  repeatable: DnD35FeatRepeatableSchema.optional(),
  metamagicDescriptor: DnD35MetamagicDescriptorSchema.optional(),
  prerequisites: PrerequisiteNodeSchema.optional(),
  effectBundle: DnD35EffectBundleSchema.optional(),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  ruleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([]),
  activatedAbilities: z.array(DnD35ActivatedAbilityDescriptorSchema).default([])
});
/** Inferred type for a declarative feat definition. */
export type DnD35FeatDefinition = z.infer<typeof DnD35FeatDefinitionSchema>;

/**
 * Zod schema for the D&D 3.5e System Content ("Core Rulebook") registries loaded from
 * `public/data/rulesets/dnd35e/`.
 */
export const DnD35SystemContentSchema = z.object({
  archetypes: z.record(z.string(), DnD35ArchetypeSchema).default({}),
  classes: z.record(z.string(), DnD35ClassDefinitionSchema).default({}),
  domains: z.record(z.string(), DnD35DomainDefinitionSchema).default({}),
  skills: z.record(z.string(), DnD35SkillDefinitionSchema).default({}),
  feats: z.record(z.string(), DnD35FeatDefinitionSchema).default({}),
  items: z.record(z.string(), DnD35ItemDefinitionSchema).default({}),
  itemEnhancements: z.record(z.string(), DnD35ItemEnhancementSchema).default({}),
  spells: z.record(z.string(), DnD35SpellDefinitionSchema).default({}),
  templates: z.record(z.string(), DnD35TemplateSchema).default({}),
  races: z.record(z.string(), DnD35RaceDefinitionSchema).default({}),
  creatureTypes: z.record(z.string(), DnD35CreatureTypeEngineSchema).default({}),
  subtypes: z.record(z.string(), DnD35SubtypeDefinitionSchema).default({}),
  dragonFamilies: DnD35DragonFamiliesDataSchema.optional()
});
/** Inferred type for D&D 3.5e System Content registries. */
export type DnD35SystemContent = z.infer<typeof DnD35SystemContentSchema>;

/**
 * WeakMap cache mapping a raw `campaign.systemContent` object reference to its validated
 * `DnD35SystemContent` instance (or `null` if invalid). Eliminates repeated O(N) Zod schema
 * parsing across 750+ SRD definitions during hot turn, stat DAG, and 60Hz render loops,
 * while automatically invalidating if the Campaign Editor or a test replaces `systemContent`.
 */
const systemContentCache = new WeakMap<object, DnD35SystemContent | null>();

/**
 * Safely parses raw system content records into a validated DnD35SystemContent structure.
 * @param raw Raw system content record dictionary.
 * @returns Validated DnD35SystemContent object.
 */
export function parseDnD35SystemContent(raw: unknown): DnD35SystemContent {
  if (typeof raw === 'object' && raw !== null) {
    const cached = systemContentCache.get(raw);
    if (cached) return cached;
    const parsed = DnD35SystemContentSchema.parse(raw);
    systemContentCache.set(raw, parsed);
    systemContentCache.set(parsed, parsed);
    return parsed;
  }
  return DnD35SystemContentSchema.parse(raw ?? {});
}

/**
 * Retrieves and parses the D&D 3.5e system content from a campaign document if available.
 * Memoized by `campaign.systemContent` object identity for O(1) hot-path lookups.
 * @param campaign The campaign data structure.
 * @returns Validated DnD35SystemContent or null.
 */
export function getDnD35SystemContent(campaign: CampaignData): DnD35SystemContent | null {
  if (!campaign.systemContent || campaign.manifest?.rulesetId !== 'dnd35e') return null;
  const rawRef = campaign.systemContent;
  if (systemContentCache.has(rawRef)) {
    return systemContentCache.get(rawRef) ?? null;
  }
  const result = DnD35SystemContentSchema.safeParse(rawRef);
  const parsed = result.success ? result.data : null;
  systemContentCache.set(rawRef, parsed);
  if (parsed) {
    systemContentCache.set(parsed, parsed);
  }
  return parsed;
}
