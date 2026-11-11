import { z } from 'zod';
import {
  BabCurveIdSchema,
  DnD35AdvancementRangeSchema,
  DnD35DamageReductionSchema,
  DnD35DamageTypeSchema,
  DnD35MagicImmunityExceptionSchema,
  DnD35MovementModesSchema,
  DnD35ProgressionTrackSchema,
  DnD35SensoryProfileSchema,
  NaturalWeaponDescriptorSchema,
  RawAbilityScoresSchema,
  SaveCurveIdSchema,
  SizeCategorySchema
} from './base_system.types.ts';
import {
  DnD35DeclarativeModifierSchema,
  DnD35EffectBundleSchema,
  DnD35RacialConditionalModifierSchema,
  DnD35RuleOverrideEntrySchema
} from './effect_system.types.ts';

/** Zod schema for a declarative System Content creature/character archetype (`archetypes.json` or hydrated from `races/<id>.json`). */
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
  magicImmunityExceptions: z.array(DnD35MagicImmunityExceptionSchema).optional(),
  cr: z.number().optional()
});
/** Inferred type for a declarative System Content archetype. */
export type DnD35Archetype = z.infer<typeof DnD35ArchetypeSchema>;

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
  stripClassLevels: z.boolean().optional(),
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
  specialQualityBundles: z.array(DnD35EffectBundleSchema).default([]),
  stripNaturalArmor: z.boolean().optional(),
  deflectionBonusFromChaMinOne: z.boolean().optional(),
  levelAdjustmentDelta: z.number().int().default(0)
});
export type DnD35Template = z.infer<typeof DnD35TemplateSchema>;

/** Zod schema for a single tier in a race's RHD progression ladder (e.g. Dragon age category or Elemental size step). */
export const DnD35ProgressionTierSchema = z.object({
  tierId: z.string(),
  name: z.string(),
  tierIndex: z.number().int().positive(),
  hitDice: z.number().int().positive(),
  sizeCategory: SizeCategorySchema,
  abilityAdjustmentsDelta: z
    .object({
      str: z.number().int().default(0),
      dex: z.number().int().default(0),
      con: z.number().int().default(0),
      int: z.number().int().default(0),
      wis: z.number().int().default(0),
      cha: z.number().int().default(0)
    })
    .default({}),
  naturalArmorBonusDelta: z.number().int().default(0),
  breathDiceCount: z.number().int().positive().optional(),
  frightfulPresence: z.boolean().default(false),
  spellResistance: z.number().int().nonnegative().optional(),
  damageReduction: DnD35DamageReductionSchema.optional(),
  unlockedNaturalWeapons: z.array(NaturalWeaponDescriptorSchema).default([]),
  cr: z.number().positive()
});
export type DnD35ProgressionTier = z.infer<typeof DnD35ProgressionTierSchema>;

/** Zod schema for a creature's Racial Hit Dice (RHD) progression track (`rhdProgression` on `DnD35RaceDefinitionSchema`). */
export const DnD35RhdProgressionSchema = z.object({
  baseHdCount: z.number().int().nonnegative().default(0),
  saveCurveOverrides: z
    .object({
      fortCurve: SaveCurveIdSchema.optional(),
      refCurve: SaveCurveIdSchema.optional(),
      willCurve: SaveCurveIdSchema.optional()
    })
    .optional(),
  advancementRanges: z.array(DnD35AdvancementRangeSchema).default([]),
  tiers: z.array(DnD35ProgressionTierSchema).default([])
});
export type DnD35RhdProgression = z.infer<typeof DnD35RhdProgressionSchema>;

/** Zod schema for a unified playable or monstrous race definition (`races/<id>.json`). */
export const DnD35RaceDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPlayableRace: z.boolean().default(false),
  creatureType: z.string().default('humanoid'),
  subtypes: z.array(z.string()).default([]),
  alignment: z.string().optional(),
  size: SizeCategorySchema.default('medium'),
  baseLandSpeedFt: z.number().int().nonnegative().default(30),
  movementModes: DnD35MovementModesSchema.optional(),
  unencumberedSpeedInHeavyArmor: z.boolean().default(false),
  abilityAdjustments: z
    .object({
      str: z.number().int().nullable().default(0),
      dex: z.number().int().nullable().default(0),
      con: z.number().int().nullable().default(0),
      int: z.number().int().nullable().default(0),
      wis: z.number().int().nullable().default(0),
      cha: z.number().int().nullable().default(0)
    })
    .default({}),
  defaultAbilityScores: RawAbilityScoresSchema.optional(),
  senses: DnD35SensoryProfileSchema.optional(),
  darkvisionFt: z.number().int().nonnegative().optional(),
  lowLightVision: z.boolean().optional(),
  naturalArmorBonus: z.number().int().nonnegative().optional(),
  rhdProgression: DnD35RhdProgressionSchema.default({}),
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
  defaultClassLevels: z
    .array(
      z.object({
        classId: z.string(),
        levels: z.number().int().positive()
      })
    )
    .default([]),
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
  spellResistance: z.number().int().nonnegative().optional(),
  damageReduction: DnD35DamageReductionSchema.optional(),
  energyResistances: z.record(z.string(), z.number().int().nonnegative()).default({}),
  immunities: z.array(z.string()).default([]),
  vulnerabilities: z.array(z.string()).default([]),
  saveBonuses: z
    .object({
      fort: z.number().int().optional(),
      ref: z.number().int().optional(),
      will: z.number().int().optional()
    })
    .optional(),
  conditionalModifiers: z.array(DnD35RacialConditionalModifierSchema).default([]),
  traitBundles: z.array(DnD35EffectBundleSchema).default([]),
  weaponFamiliarityIds: z.array(z.string()).default([]),
  automaticLanguages: z.array(z.string()).default(['common']),
  anatomyBodyPlan: z.enum(['humanoid_biped', 'quadruped', 'marilith_6arm', 'avian', 'serpentine']).optional(),
  naturalWeapons: z.array(NaturalWeaponDescriptorSchema).default([]),
  weaponDice: z.string().optional(),
  weaponDamageType: DnD35DamageTypeSchema.optional(),
  weaponCritThreatMin: z.number().int().min(1).max(20).optional(),
  weaponCritMultiplier: z.number().int().min(2).max(4).optional(),
  weaponBypassTags: z.array(z.string()).optional(),
  armorBonus: z.number().int().nonnegative().optional(),
  shieldBonus: z.number().int().nonnegative().optional(),
  feats: z.array(z.string()).default([]),
  skillRanks: z.record(z.string(), z.number().nonnegative()).default({}),
  hasPounce: z.boolean().default(false),
  singleActionsOnly: z.boolean().default(false),
  magicImmunityExceptions: z.array(DnD35MagicImmunityExceptionSchema).optional(),
  companionTags: z.array(z.string()).default([]),
  masterEffectBundle: DnD35EffectBundleSchema.optional(),
  breathWeapon: z
    .object({
      shape: z.enum(['cone', 'line']),
      rangeFtAtMedium: z.number().int().positive(),
      damageType: DnD35DamageTypeSchema,
      dieType: z.union([z.literal('d4'), z.literal('d6'), z.literal('d8'), z.literal('d10')]),
      saveType: z.enum(['fort', 'ref', 'will'])
    })
    .optional(),
  cr: z.number().optional()
});
export type DnD35RaceDefinition = z.infer<typeof DnD35RaceDefinitionSchema>;

/** Zod schema for one of the 15 SRD Creature Type Racial HD engines (`creature_types/<id>.json`). */
export const DnD35CreatureTypeEngineSchema = z.object({
  typeId: z.string(),
  name: z.string(),
  hitDieSides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  babCurve: BabCurveIdSchema,
  fortCurve: SaveCurveIdSchema,
  refCurve: SaveCurveIdSchema,
  willCurve: SaveCurveIdSchema,
  goodSaveBySubtype: z
    .record(
      z.string(),
      z.object({
        fortCurve: SaveCurveIdSchema,
        refCurve: SaveCurveIdSchema,
        willCurve: SaveCurveIdSchema
      })
    )
    .optional(),
  skillPointsPerLevel: z.number().int().nonnegative(),
  defaultTraits: z.array(z.string()).default([]),
  immunities: z.array(z.string()).default([]),
  hasConstitutionScore: z.boolean().default(true),
  hasIntelligenceScore: z.boolean().default(true),
  nonabilities: z.array(z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha'])).default([]),
  weaponProficiencies: z.array(z.string()).default(['natural']),
  armorProficiencies: z.array(z.string()).default([]),
  physiology: z
    .object({
      eats: z.boolean().default(true),
      breathes: z.boolean().default(true),
      sleeps: z.boolean().default(true)
    })
    .default({}),
  traitBundles: z.array(DnD35EffectBundleSchema).default([]),
  constructBonusHpBySize: z.record(SizeCategorySchema, z.number().int().nonnegative()).optional()
});
export type DnD35CreatureTypeEngine = z.infer<typeof DnD35CreatureTypeEngineSchema>;

/** Zod schema for a modular Creature Subtype definition (`subtypes/<id>.json`). */
export const DnD35SubtypeDefinitionSchema = z.object({
  subtypeId: z.string(),
  name: z.string(),
  description: z.string(),
  immunities: z.array(z.string()).default([]),
  vulnerabilities: z.array(z.string()).default([]),
  grantedTags: z.array(z.string()).default([]),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  ruleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([]),
  traitBundles: z.array(DnD35EffectBundleSchema).default([])
});
export type DnD35SubtypeDefinition = z.infer<typeof DnD35SubtypeDefinitionSchema>;
