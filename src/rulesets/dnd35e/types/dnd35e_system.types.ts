import { z } from 'zod';
import type { CampaignData } from '../../../types/campaign.types.ts';
import type { PrerequisiteNode } from '../prerequisites.ts';

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
  naturalType: z.enum([
    'bite',
    'claw',
    'gore',
    'slam',
    'sting',
    'tentacle',
    'talon',
    'tail_slap',
    'wings',
    'crush',
    'tail_sweep'
  ]),
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

/** Zod schema for an SRD monster advancement size/HD range. */
export const DnD35AdvancementRangeSchema = z.object({
  minHd: z.number().int().positive(),
  maxHd: z.number().int().positive(),
  sizeCategory: SizeCategorySchema,
  crAdjustment: z.number().default(0)
});
export type DnD35AdvancementRange = z.infer<typeof DnD35AdvancementRangeSchema>;

/** Zod schema for sensory profile on an archetype. */
export const DnD35SensoryProfileSchema = z.object({
  lowLightVision: z.boolean().default(false),
  darkvisionRangeFt: z.number().int().nonnegative().default(0),
  blindsenseRangeFt: z.number().int().nonnegative().default(0),
  blindsightRangeFt: z.number().int().nonnegative().default(0),
  tremorsenseRangeFt: z.number().int().nonnegative().default(0),
  scentRangeFt: z.number().int().nonnegative().default(0)
});

/** Zod schema for multi-mode movement speeds on an archetype. */
export const DnD35MovementModesSchema = z.object({
  land: z.number().int().nonnegative().default(30),
  burrow: z.number().int().nonnegative().optional(),
  climb: z.number().int().nonnegative().optional(),
  fly: z.number().int().nonnegative().optional(),
  swim: z.number().int().nonnegative().optional(),
  maneuverability: z.enum(['clumsy', 'poor', 'average', 'good', 'perfect']).optional()
});

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
  immunities: z.array(z.string()).default([]),
  vulnerabilities: z.array(z.string()).default([]),
  spellResistance: z.number().int().nonnegative().optional(),
  feats: z.array(z.string()).default([]),
  skillRanks: z.record(z.string(), z.number().nonnegative()).default({}),
  creatureType: z.string().optional(),
  subtypes: z.array(z.string()).default([]),
  levelAdjustment: z.number().int().nonnegative().default(0),
  senses: DnD35SensoryProfileSchema.optional(),
  movementModes: DnD35MovementModesSchema.optional(),
  anatomyBodyPlan: z.enum(['humanoid_biped', 'quadruped', 'marilith_6arm', 'avian', 'serpentine']).optional(),
  naturalWeapons: z.array(NaturalWeaponDescriptorSchema).default([]),
  hasPounce: z.boolean().default(false),
  singleActionsOnly: z.boolean().default(false),
  advancementRanges: z.array(DnD35AdvancementRangeSchema).default([]),
  cr: z.number().optional()
});
/** Inferred type for a declarative System Content archetype. */
export type DnD35Archetype = z.infer<typeof DnD35ArchetypeSchema>;

/** Zod schema for the 9 canonical D&D 3.5e alignments. */
export const DnD35AlignmentSchema = z.enum(['LG', 'NG', 'CG', 'LN', 'N', 'CN', 'LE', 'NE', 'CE']);
export type DnD35AlignmentSchemaType = z.infer<typeof DnD35AlignmentSchema>;

/** Zod schema for a declarative Effect Provider modifier entry on a class feature, domain, or race. */
export const DnD35DeclarativeModifierSchema = z.object({
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
  condition: z
    .object({
      selfTagsAll: z.array(z.string()).optional(),
      selfTagsAny: z.array(z.string()).optional(),
      selfTagsNone: z.array(z.string()).optional(),
      targetTagsAll: z.array(z.string()).optional(),
      targetTagsAny: z.array(z.string()).optional(),
      targetTagsNone: z.array(z.string()).optional(),
      effectTagsAny: z.array(z.string()).optional()
    })
    .optional()
});
export type DnD35DeclarativeModifier = z.infer<typeof DnD35DeclarativeModifierSchema>;

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

/** Zod schema for a structured class feature definition. */
export const DnD35ClassFeatureDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['ex', 'su', 'sp', 'bonus_feat', 'proficiency', 'caster_advancement']).default('ex'),
  description: z.string().optional(),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
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
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([])
});
export type DnD35AcfSwap = z.infer<typeof DnD35AcfSwapSchema>;

/** Zod schema for a Cleric Domain definition (`domains.json`). */
export const DnD35DomainDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  grantedPowerDescription: z.string(),
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

/** Zod schema for a declarative character class definition (`classes.json` & `classes/<id>.json`). */
export const DnD35ClassDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPrestige: z.boolean().default(false),
  maxLevel: z.number().int().positive().default(20),
  hitDieSides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  babCurve: BabCurveIdSchema,
  fortCurve: SaveCurveIdSchema,
  refCurve: SaveCurveIdSchema,
  willCurve: SaveCurveIdSchema,
  skillPointsPerLevel: z.number().int().nonnegative(),
  classSkills: z.array(z.string()).default([]),
  castingMode: z.enum(['none', 'prepared', 'spontaneous']).default('none'),
  castingTradition: z.enum(['none', 'arcane', 'divine']).default('none'),
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
  featuresByLevel: z.record(z.string(), z.array(z.string())).default({}),
  featureDetails: z.record(z.string(), DnD35ClassFeatureDetailSchema).default({}),
  bonusFeatLevels: z.array(z.number().int().positive()).default([]),
  spellsPerDayTable: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())).optional(),
  spellsKnownTable: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())).optional(),
  advancesExistingSpellcasting: z
    .object({
      tradition: z.enum(['arcane', 'divine', 'both', 'any']),
      atLevels: z.array(z.number().int().positive())
    })
    .optional(),
  acfSwaps: z.array(DnD35AcfSwapSchema).default([])
});
/** Inferred type for a declarative class definition. */
export type DnD35ClassDefinition = z.infer<typeof DnD35ClassDefinitionSchema>;

/** Zod schema for HD-tiered scaling on templates (e.g., Celestial/Fiendish DR & energy resistance). */
export const DnD35TemplateHdTierSchema = z.object({
  minHd: z.number().int().positive(),
  maxHd: z.number().int().positive().optional(),
  damageReduction: DnD35DamageReductionSchema.optional(),
  energyResistance: z.record(z.string(), z.number().int().nonnegative()).optional(),
  energyResistances: z.record(z.string(), z.number().int().nonnegative()).optional(),
  crAdjustment: z.number().optional()
});
export type DnD35TemplateHdTier = z.infer<typeof DnD35TemplateHdTierSchema>;

/** Zod schema for an inherited or acquired template definition (`templates.json`). */
export const DnD35TemplateSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  kind: z.enum(['inherited', 'acquired']),
  targetCreatureTypes: z.array(z.string()).optional(),
  resultCreatureType: z.string().optional(),
  convertTypeMap: z.record(z.string(), z.string()).optional(),
  addSubtypes: z.array(z.string()).default([]),
  sizeCategoryChange: SizeCategorySchema.optional(),
  hitDieOverride: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]).optional(),
  hdMultiplier: z.number().positive().optional(),
  bonusHitDice: z.number().int().nonnegative().optional(),
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
  minimumIntelligence: z.number().int().positive().optional(),
  naturalArmorBonusDelta: z.number().int().default(0),
  sizeTieredNaturalArmor: z.record(SizeCategorySchema, z.number().int().nonnegative()).optional(),
  damageReduction: DnD35DamageReductionSchema.optional(),
  energyResistance: z.record(z.string(), z.number().int().nonnegative()).default({}),
  energyResistances: z.record(z.string(), z.number().int().nonnegative()).optional(),
  hdTieredScaling: z.array(DnD35TemplateHdTierSchema).optional(),
  spellResistanceFormula: z
    .object({
      base: z.number().int().nonnegative(),
      perHitDie: z.number().int().nonnegative(),
      max: z.number().int().positive().optional()
    })
    .optional(),
  immunities: z.array(z.string()).default([]),
  spellResistanceBonus: z.number().int().nonnegative().optional(),
  grantedFeats: z.array(z.string()).default([]),
  grantedTags: z.array(z.string()).default([]),
  grantedNaturalWeapons: z.array(NaturalWeaponDescriptorSchema).optional(),
  stripNaturalArmor: z.boolean().optional(),
  deflectionBonusFromChaMinOne: z.boolean().optional(),
  levelAdjustmentDelta: z.number().int().default(0)
});
export type DnD35Template = z.infer<typeof DnD35TemplateSchema>;

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
  condition: z.object({
    selfTagsAll: z.array(z.string()).optional(),
    selfTagsAny: z.array(z.string()).optional(),
    selfTagsNone: z.array(z.string()).optional(),
    targetTagsAll: z.array(z.string()).optional(),
    targetTagsAny: z.array(z.string()).optional(),
    targetTagsNone: z.array(z.string()).optional(),
    effectTagsAny: z.array(z.string()).optional()
  })
});
export type DnD35RacialConditionalModifier = z.infer<typeof DnD35RacialConditionalModifierSchema>;

/** Zod schema for a playable or monstrous race definition (`races.json`). */
export const DnD35RaceDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  creatureType: z.string().default('humanoid'),
  subtypes: z.array(z.string()).default([]),
  size: SizeCategorySchema.default('medium'),
  baseLandSpeedFt: z.number().int().positive().default(30),
  unencumberedSpeedInHeavyArmor: z.boolean().default(false),
  abilityAdjustments: z
    .object({
      str: z.number().int().default(0),
      dex: z.number().int().default(0),
      con: z.number().int().default(0),
      int: z.number().int().default(0),
      wis: z.number().int().default(0),
      cha: z.number().int().default(0)
    })
    .default({}),
  darkvisionFt: z.number().int().nonnegative().optional(),
  lowLightVision: z.boolean().optional(),
  naturalArmorBonus: z.number().int().nonnegative().optional(),
  racialHitDice: z
    .object({
      count: z.number().int().positive(),
      hitDieSides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
      babCurve: BabCurveIdSchema,
      fortCurve: SaveCurveIdSchema,
      refCurve: SaveCurveIdSchema,
      willCurve: SaveCurveIdSchema,
      skillPointsPerLevel: z.number().int().nonnegative()
    })
    .optional(),
  levelAdjustment: z.number().int().nonnegative().default(0),
  favoredClass: z.string().default('fighter'),
  bonusFeatAtFirstLevel: z.boolean().default(false),
  extraSkillPointsFirstLevel: z.number().int().nonnegative().default(0),
  extraSkillPointsPerLevel: z.number().int().nonnegative().default(0),
  spellResistanceFormula: z
    .object({
      base: z.number().int().nonnegative(),
      perHitDie: z.number().int().nonnegative()
    })
    .optional(),
  energyResistances: z.record(z.string(), z.number().int().nonnegative()).default({}),
  saveBonuses: z
    .object({
      fort: z.number().int().optional(),
      ref: z.number().int().optional(),
      will: z.number().int().optional()
    })
    .optional(),
  conditionalModifiers: z.array(DnD35RacialConditionalModifierSchema).default([]),
  weaponFamiliarityIds: z.array(z.string()).default([]),
  automaticLanguages: z.array(z.string()).default(['common'])
});
export type DnD35RaceDefinition = z.infer<typeof DnD35RaceDefinitionSchema>;

/** Zod schema for one of the 15 SRD Creature Type Racial HD engines (`creature_types.json`). */
export const DnD35CreatureTypeEngineSchema = z.object({
  typeId: z.string(),
  name: z.string(),
  hitDieSides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  babCurve: BabCurveIdSchema,
  fortCurve: SaveCurveIdSchema,
  refCurve: SaveCurveIdSchema,
  willCurve: SaveCurveIdSchema,
  skillPointsPerLevel: z.number().int().nonnegative(),
  defaultTraits: z.array(z.string()).default([]),
  immunities: z.array(z.string()).default([]),
  hasConstitutionScore: z.boolean().default(true),
  hasIntelligenceScore: z.boolean().default(true),
  constructBonusHpBySize: z.record(SizeCategorySchema, z.number().int().nonnegative()).optional()
});
export type DnD35CreatureTypeEngine = z.infer<typeof DnD35CreatureTypeEngineSchema>;

/** Zod schema for True Dragon 12 age categories and varieties (`dragon_families.json`). */
export const DnD35DragonAgeCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  ageIndex: z.number().int().min(1).max(12),
  hdDeltaFromWyrmling: z.number().int().nonnegative(),
  strDelta: z.number().int().nonnegative(),
  dexDelta: z.number().int(),
  conDelta: z.number().int().nonnegative(),
  intDelta: z.number().int().nonnegative(),
  wisDelta: z.number().int().nonnegative(),
  chaDelta: z.number().int().nonnegative(),
  naturalArmorDelta: z.number().int().nonnegative(),
  breathDiceCount: z.number().int().positive(),
  frightfulPresence: z.boolean().default(false),
  spellResistance: z.number().int().nonnegative().optional(),
  cr: z.number().positive()
});
export type DnD35DragonAgeCategory = z.infer<typeof DnD35DragonAgeCategorySchema>;

export const DnD35DragonVarietySchema = z.object({
  varietyId: z.string(),
  name: z.string(),
  alignment: z.string(),
  subtypes: z.array(z.string()).default([]),
  wyrmlingBase: z.object({
    sizeCategory: SizeCategorySchema,
    hitDice: z.number().int().positive(),
    abilityScores: RawAbilityScoresSchema,
    naturalArmorBonus: z.number().int().nonnegative(),
    flySpeedFt: z.number().int().positive(),
    cr: z.number().positive()
  }),
  sizeProgression: z.record(z.string(), SizeCategorySchema),
  breathWeapon: z.object({
    shape: z.enum(['cone', 'line']),
    rangeFtAtMedium: z.number().int().positive(),
    damageType: DnD35DamageTypeSchema,
    dieType: z.union([z.literal('d4'), z.literal('d6'), z.literal('d8'), z.literal('d10')]),
    saveType: z.enum(['fort', 'ref', 'will'])
  }),
  immunities: z.array(z.string()).default([]),
  vulnerabilities: z.array(z.string()).default([])
});
export type DnD35DragonVariety = z.infer<typeof DnD35DragonVarietySchema>;

export const DnD35ElementalStepSchema = z.object({
  stepId: z.string(),
  name: z.string(),
  hitDice: z.number().int().positive(),
  sizeCategory: SizeCategorySchema,
  cr: z.number().positive()
});
export type DnD35ElementalStep = z.infer<typeof DnD35ElementalStepSchema>;

export const DnD35DragonFamiliesDataSchema = z.object({
  ageCategories: z.record(z.string(), DnD35DragonAgeCategorySchema),
  varieties: z.record(z.string(), DnD35DragonVarietySchema),
  elementalSteps: z.record(z.string(), DnD35ElementalStepSchema)
});
export type DnD35DragonFamiliesData = z.infer<typeof DnD35DragonFamiliesDataSchema>;

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
  prerequisites: PrerequisiteNodeSchema.optional()
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
  domains: z.record(z.string(), DnD35DomainDefinitionSchema).default({}),
  skills: z.record(z.string(), DnD35SkillDefinitionSchema).default({}),
  feats: z.record(z.string(), DnD35FeatDefinitionSchema).default({}),
  spells: z.record(z.string(), DnD35SpellDefinitionSchema).default({}),
  templates: z.record(z.string(), DnD35TemplateSchema).default({}),
  races: z.record(z.string(), DnD35RaceDefinitionSchema).default({}),
  creatureTypes: z.record(z.string(), DnD35CreatureTypeEngineSchema).default({}),
  dragonFamilies: DnD35DragonFamiliesDataSchema.optional()
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
