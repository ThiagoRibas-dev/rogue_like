import { z } from 'zod';

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

/** Zod schema for the 9 canonical D&D 3.5e alignments. */
export const DnD35AlignmentSchema = z.enum(['LG', 'NG', 'CG', 'LN', 'N', 'CN', 'LE', 'NE', 'CE']);
/** Inferred type for D&D 3.5e alignments. */
export type DnD35AlignmentSchemaType = z.infer<typeof DnD35AlignmentSchema>;

/** Zod schema for a single Hit Dice / Class progression track on an archetype. */
export const DnD35ProgressionTrackSchema = z.object({
  trackId: z.string(),
  levels: z.number().int().positive(),
  hitDieSides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  babCurve: BabCurveIdSchema,
  fortCurve: SaveCurveIdSchema,
  refCurve: SaveCurveIdSchema,
  willCurve: SaveCurveIdSchema,
  skillPointsPerLevel: z.number().int().nonnegative(),
  trackCategory: z.enum(['racial_hd', 'pc', 'npc', 'prestige']).optional()
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
/** Inferred type for on-hit rider descriptors. */
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
/** Inferred type for natural weapon descriptors. */
export type NaturalWeaponDescriptor = z.infer<typeof NaturalWeaponDescriptorSchema>;

/** Zod schema for an SRD monster advancement size/HD range. */
export const DnD35AdvancementRangeSchema = z.object({
  minHd: z.number().int().positive(),
  maxHd: z.number().int().positive(),
  sizeCategory: SizeCategorySchema,
  crAdjustment: z.number().default(0)
});
/** Inferred type for monster advancement ranges. */
export type DnD35AdvancementRange = z.infer<typeof DnD35AdvancementRangeSchema>;

/** Zod schema for sensory profile on an archetype or race. */
export const DnD35SensoryProfileSchema = z.object({
  lowLightVision: z.boolean().default(false),
  darkvisionRangeFt: z.number().int().nonnegative().default(0),
  blindsenseRangeFt: z.number().int().nonnegative().default(0),
  blindsightRangeFt: z.number().int().nonnegative().default(0),
  tremorsenseRangeFt: z.number().int().nonnegative().default(0),
  scentRangeFt: z.number().int().nonnegative().default(0)
});
/** Inferred type for sensory profiles. */
export type DnD35SensoryProfile = z.infer<typeof DnD35SensoryProfileSchema>;

/** Zod schema for multi-mode movement speeds on an archetype or race. */
export const DnD35MovementModesSchema = z.object({
  land: z.number().int().nonnegative().default(30),
  burrow: z.number().int().nonnegative().optional(),
  climb: z.number().int().nonnegative().optional(),
  fly: z.number().int().nonnegative().optional(),
  swim: z.number().int().nonnegative().optional(),
  maneuverability: z.enum(['clumsy', 'poor', 'average', 'good', 'perfect']).optional()
});
/** Inferred type for movement modes. */
export type DnD35MovementModes = z.infer<typeof DnD35MovementModesSchema>;

/** Zod schema for True Dragon 12 age categories (`dragon_families.json`). */
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

/** Zod schema for a True Dragon variety (`dragon_families.json`). */
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

/** Zod schema for an Elemental size step (`dragon_families.json`). */
export const DnD35ElementalStepSchema = z.object({
  stepId: z.string(),
  name: z.string(),
  hitDice: z.number().int().positive(),
  sizeCategory: SizeCategorySchema,
  cr: z.number().positive()
});
export type DnD35ElementalStep = z.infer<typeof DnD35ElementalStepSchema>;

/** Zod schema for `dragon_families.json` top-level container. */
export const DnD35DragonFamiliesDataSchema = z.object({
  ageCategories: z.record(z.string(), DnD35DragonAgeCategorySchema),
  varieties: z.record(z.string(), DnD35DragonVarietySchema),
  elementalSteps: z.record(z.string(), DnD35ElementalStepSchema)
});
export type DnD35DragonFamiliesData = z.infer<typeof DnD35DragonFamiliesDataSchema>;

/** Zod schema for a declarative magic immunity exception rule (e.g. SRD Golem elemental/spell interactions). */
export const DnD35MagicImmunityExceptionSchema = z.object({
  triggerTagsAny: z.array(z.string()).min(1),
  effectType: z.enum(['heal_per_damage_divisor', 'slow', 'bypass_immunity']),
  damageDivisor: z.number().int().positive().optional(),
  slowRounds: z.number().int().positive().optional(),
  breaksHaste: z.boolean().optional(),
  description: z.string()
});
/** Inferred type for a declarative magic immunity exception rule. */
export type DnD35MagicImmunityException = z.infer<typeof DnD35MagicImmunityExceptionSchema>;
