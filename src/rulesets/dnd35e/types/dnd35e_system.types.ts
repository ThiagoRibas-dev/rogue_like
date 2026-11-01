import { z } from 'zod';
import type { CampaignData } from '../../../types/campaign.types.ts';

/** Zod schema for a 6-ability score map where `null` represents a Nonability (`—`). */
export const RawAbilityScoresSchema = z.object({
  str: z.number().int().nullable(),
  dex: z.number().int().nullable(),
  con: z.number().int().nullable(),
  int: z.number().int().nullable(),
  wis: z.number().int().nullable(),
  cha: z.number().int().nullable()
});
/** Inferred type for raw ability scores (`number | null`). */
export type RawAbilityScores = z.infer<typeof RawAbilityScoresSchema>;

/** Zod schema for BAB progression curve identifiers. */
export const BabCurveIdSchema = z.enum(['full', 'three_quarters', 'half']);
/** Inferred type for BAB progression curves. */
export type BabCurveId = z.infer<typeof BabCurveIdSchema>;

/** Zod schema for Saving Throw progression curve identifiers. */
export const SaveCurveIdSchema = z.enum(['good', 'poor']);
/** Inferred type for Saving Throw progression curves. */
export type SaveCurveId = z.infer<typeof SaveCurveIdSchema>;

/** Zod schema for D&D 3.5e 9-tier size categories. */
export const SizeCategorySchema = z.enum([
  'fine',
  'diminutive',
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
  'colossal'
]);
/** Inferred type for D&D 3.5e size categories. */
export type SizeCategory = z.infer<typeof SizeCategorySchema>;

/** Zod schema for D&D 3.5e damage types. */
export const DnD35DamageTypeSchema = z.enum([
  'bludgeoning',
  'piercing',
  'slashing',
  'acid',
  'cold',
  'electricity',
  'fire',
  'sonic',
  'force',
  'positive',
  'negative',
  'untyped'
]);
/** Inferred type for D&D 3.5e damage types. */
export type DnD35DamageType = z.infer<typeof DnD35DamageTypeSchema>;

/** Zod schema for a single Hit Dice / Class progression track on an archetype. */
export const DnD35ProgressionTrackSchema = z.object({
  trackId: z.string(),
  levels: z.number().int().positive(),
  hitDieSides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  babCurve: BabCurveIdSchema,
  fortCurve: SaveCurveIdSchema,
  refCurve: SaveCurveIdSchema,
  willCurve: SaveCurveIdSchema,
  skillPointsPerLevel: z.number().int().nonnegative()
});
/** Inferred type for a declarative progression track. */
export type DnD35ProgressionTrack = z.infer<typeof DnD35ProgressionTrackSchema>;

/** Zod schema for a Damage Reduction (`DR X / bypass`) rule. */
export const DnD35DamageReductionSchema = z.object({
  amount: z.number().int().nonnegative(),
  bypassTags: z.array(z.string()),
  requireAllTags: z.boolean().optional()
});
/** Inferred type for Damage Reduction rules. */
export type DnD35DamageReduction = z.infer<typeof DnD35DamageReductionSchema>;

/** Zod schema for an on-hit poison, disease, or curse rider. */
export const OnHitRiderDescriptorSchema = z.object({
  riderId: z.string(),
  type: z.enum(['poison', 'disease', 'energy_drain', 'curse', 'paralysis']),
  delivery: z.enum(['injury', 'contact']),
  saveType: z.enum(['fort', 'ref', 'will']),
  dc: z.number().int().positive(),
  initialEffectDescription: z.string(),
  secondaryEffectDescription: z.string().optional(),
  secondaryDelayRounds: z.number().int().positive().optional()
});
export type OnHitRiderDescriptor = z.infer<typeof OnHitRiderDescriptorSchema>;

/** Zod schema for a natural weapon attack entry. */
export const NaturalWeaponDescriptorSchema = z.object({
  id: z.string(),
  name: z.string(),
  naturalType: z.enum(['bite', 'claw', 'gore', 'slam', 'sting', 'tentacle', 'talon', 'tail_slap']),
  isPrimary: z.boolean().default(false),
  count: z.number().int().positive().default(1),
  damageDice: z.string(),
  damageType: DnD35DamageTypeSchema,
  critThreatMin: z.number().int().min(1).max(20).default(20),
  critMultiplier: z.number().int().min(2).max(4).default(2),
  reachFt: z.number().int().positive().optional(),
  riders: z.array(OnHitRiderDescriptorSchema).optional()
});
export type NaturalWeaponDescriptor = z.infer<typeof NaturalWeaponDescriptorSchema>;

/** Zod schema for a declarative System Content creature/character archetype (`archetypes.json`). */
export const DnD35ArchetypeSchema = z.object({
  archetypeId: z.string(),
  sizeCategory: SizeCategorySchema,
  abilityScores: RawAbilityScoresSchema,
  tracks: z.array(DnD35ProgressionTrackSchema).min(1),
  weaponDice: z.string(),
  weaponDamageType: DnD35DamageTypeSchema,
  weaponCritThreatMin: z.number().int().min(1).max(20),
  weaponCritMultiplier: z.number().int().min(2).max(4),
  weaponBypassTags: z.array(z.string()),
  armorBonus: z.number().int().nonnegative(),
  shieldBonus: z.number().int().nonnegative(),
  naturalArmorBonus: z.number().int().nonnegative(),
  damageReduction: DnD35DamageReductionSchema.optional(),
  energyResistance: z.record(z.string(), z.number().int().nonnegative()).default({}),
  immunities: z.array(DnD35DamageTypeSchema).default([]),
  vulnerabilities: z.array(DnD35DamageTypeSchema).default([]),
  spellResistance: z.number().int().nonnegative().optional(),
  feats: z.array(z.string()).default([]),
  skillRanks: z.record(z.string(), z.number().nonnegative()).default({}),
  creatureType: z.string().optional(),
  subtypes: z.array(z.string()).default([]),
  levelAdjustment: z.number().int().nonnegative().default(0),
  naturalWeapons: z.array(NaturalWeaponDescriptorSchema).default([]),
  hasPounce: z.boolean().default(false),
  singleActionsOnly: z.boolean().default(false)
});
/** Inferred type for a declarative System Content archetype. */
export type DnD35Archetype = z.infer<typeof DnD35ArchetypeSchema>;

/** Zod schema for an Alternate Class Feature (ACF) swap. */
export const DnD35AcfSwapSchema = z.object({
  acfId: z.string(),
  name: z.string(),
  replacesFeature: z.string(),
  grantedFeature: z.string(),
  level: z.number().int().positive()
});
export type DnD35AcfSwap = z.infer<typeof DnD35AcfSwapSchema>;

/** Zod schema for a declarative character class definition (`classes.json`). */
export const DnD35ClassDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  hitDieSides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  babCurve: BabCurveIdSchema,
  fortCurve: SaveCurveIdSchema,
  refCurve: SaveCurveIdSchema,
  willCurve: SaveCurveIdSchema,
  skillPointsPerLevel: z.number().int().nonnegative(),
  classSkills: z.array(z.string()).default([]),
  castingMode: z.enum(['none', 'prepared', 'spontaneous']).default('none'),
  castingKeyAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
  acfSwaps: z.array(DnD35AcfSwapSchema).default([])
});
/** Inferred type for a declarative class definition. */
export type DnD35ClassDefinition = z.infer<typeof DnD35ClassDefinitionSchema>;

/** Zod schema for an inherited or acquired template definition (`templates.json`). */
export const DnD35TemplateSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  kind: z.enum(['inherited', 'acquired']),
  targetCreatureTypes: z.array(z.string()).optional(),
  resultCreatureType: z.string().optional(),
  addSubtypes: z.array(z.string()).default([]),
  sizeCategoryChange: SizeCategorySchema.optional(),
  abilityScoreModifiers: z
    .object({
      str: z.number().int().optional(),
      dex: z.number().int().optional(),
      con: z.number().int().optional(),
      int: z.number().int().optional(),
      wis: z.number().int().optional(),
      cha: z.number().int().optional()
    })
    .default({}),
  naturalArmorBonusDelta: z.number().int().default(0),
  damageReduction: DnD35DamageReductionSchema.optional(),
  energyResistance: z.record(z.string(), z.number().int().nonnegative()).default({}),
  immunities: z.array(DnD35DamageTypeSchema).default([]),
  spellResistanceBonus: z.number().int().nonnegative().optional(),
  grantedFeats: z.array(z.string()).default([]),
  grantedTags: z.array(z.string()).default([]),
  levelAdjustmentDelta: z.number().int().default(0)
});
export type DnD35Template = z.infer<typeof DnD35TemplateSchema>;

/** Zod schema for a declarative skill definition (`skills.json`). */
export const DnD35SkillDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
  trainedOnly: z.boolean().default(false),
  acpMultiplier: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  synergyFromSkills: z.array(z.string()).default([])
});
/** Inferred type for a declarative skill definition. */
export type DnD35SkillDefinition = z.infer<typeof DnD35SkillDefinitionSchema>;

/** Zod schema for a declarative feat definition (`feats.json`). */
export const DnD35FeatDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isFighterBonusFeat: z.boolean().default(false),
  prerequisites: z.record(z.string(), z.unknown()).optional()
});
/** Inferred type for a declarative feat definition. */
export type DnD35FeatDefinition = z.infer<typeof DnD35FeatDefinitionSchema>;

/** Zod schema for a declarative spell definition (`spells.json`). */
export const DnD35SpellDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number().int().min(0).max(9),
  school: z.string(),
  classification: z.enum(['spell', 'ex', 'sp', 'su']).default('spell'),
  components: z.object({
    verbal: z.boolean().default(false),
    somatic: z.boolean().default(false),
    material: z.boolean().default(false)
  }),
  allowsSpellResistance: z.boolean().default(true),
  savingThrow: z
    .object({
      saveType: z.enum(['fort', 'ref', 'will']),
      effect: z.enum(['negates', 'half', 'partial'])
    })
    .optional(),
  aoeShape: z.enum(['single', 'burst', 'spread', 'cone', 'line']).default('single'),
  aoeRadiusFt: z.number().int().nonnegative().default(0),
  damageDice: z.string().optional(),
  damageType: DnD35DamageTypeSchema.optional(),
  tags: z.array(z.string()).default([])
});
/** Inferred type for a declarative spell definition. */
export type DnD35SpellDefinition = z.infer<typeof DnD35SpellDefinitionSchema>;

/**
 * Zod schema for the D&D 3.5e System Content ("Core Rulebook") registries loaded from
 * `public/data/rulesets/dnd35e/`.
 */
export const DnD35SystemContentSchema = z.object({
  archetypes: z.record(z.string(), DnD35ArchetypeSchema).default({}),
  classes: z.record(z.string(), DnD35ClassDefinitionSchema).default({}),
  skills: z.record(z.string(), DnD35SkillDefinitionSchema).default({}),
  feats: z.record(z.string(), DnD35FeatDefinitionSchema).default({}),
  spells: z.record(z.string(), DnD35SpellDefinitionSchema).default({}),
  templates: z.record(z.string(), DnD35TemplateSchema).default({})
});
/** Inferred type for D&D 3.5e System Content registries. */
export type DnD35SystemContent = z.infer<typeof DnD35SystemContentSchema>;

/**
 * Safely parses raw system content records into a validated DnD35SystemContent structure.
 * @param raw Raw system content record dictionary.
 * @returns Validated DnD35SystemContent object.
 */
export function parseDnD35SystemContent(raw: unknown): DnD35SystemContent {
  return DnD35SystemContentSchema.parse(raw ?? {});
}

/**
 * Retrieves and parses the D&D 3.5e system content from a campaign document if available.
 * @param campaign The campaign data structure.
 * @returns Validated DnD35SystemContent or null.
 */
export function getDnD35SystemContent(campaign: CampaignData): DnD35SystemContent | null {
  if (!campaign.systemContent || campaign.manifest?.rulesetId !== 'dnd35e') return null;
  const result = DnD35SystemContentSchema.safeParse(campaign.systemContent);
  return result.success ? result.data : null;
}
