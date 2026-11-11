import { z } from 'zod';
import { DnD35DamageTypeSchema } from './base_system.types.ts';
import {
  DnD35EffectBundleSchema,
  DnD35ModifierTagConditionSchema,
  DnD35SpellStrikeDescriptorSchema
} from './effect_system.types.ts';

/**
 * Declarative Caster Level scaling formula (`DnD35SpellScalingRuleSchema`).
 * Supports linear scaling (`1/CL`), stepped intervals (`+1 per 3 CL`), delayed start thresholds
 * (`startAboveCL: 9` for *Battletide* Quicken scaling or `startAboveCL: 3` for *Barkskin*), and min/max caps.
 */
export const DnD35SpellScalingRuleSchema = z.object({
  baseValue: z.number().default(0),
  perCL: z.number().default(0),
  clStepInterval: z.number().int().positive().default(1),
  startAboveCL: z.number().int().nonnegative().default(0),
  minCap: z.number().optional(),
  maxCap: z.number().optional()
});
export type DnD35SpellScalingRule = z.infer<typeof DnD35SpellScalingRuleSchema>;

/** Cost paid by the caster upon casting or at spell expiration (GP material, Focus, XP, Sacrifice, Corrupt). */
export const DnD35SpellCasterCostSchema = z.discriminatedUnion('costType', [
  z.object({
    costType: z.literal('material_gp'),
    amountGp: z.number().nonnegative(),
    consumedItemTag: z.string().optional(),
    description: z.string().optional()
  }),
  z.object({
    costType: z.literal('focus_gp'),
    minimumValueGp: z.number().nonnegative(),
    requiredItemTag: z.string().optional(),
    description: z.string().optional()
  }),
  z.object({
    costType: z.literal('xp'),
    xpAmount: z.number().int().nonnegative(),
    description: z.string().optional()
  }),
  z.object({
    costType: z.literal('ability_sacrifice'),
    ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
    harmKind: z.enum(['damage', 'drain', 'penalty']).default('drain'),
    diceFormula: z.string(),
    timing: z.enum(['on_cast', 'on_expiration']).default('on_cast'),
    description: z.string().optional()
  }),
  z.object({
    costType: z.literal('hp_sacrifice'),
    diceFormula: z.string(),
    description: z.string().optional()
  })
]);
export type DnD35SpellCasterCost = z.infer<typeof DnD35SpellCasterCostSchema>;

/** Spell component flags and exotic caster costs. */
export const DnD35SpellComponentsSchema = z.object({
  verbal: z.boolean().default(false),
  somatic: z.boolean().default(false),
  material: z.boolean().default(false),
  focus: z.boolean().default(false),
  divineFocus: z.boolean().default(false),
  sacrifice: z.boolean().default(false),
  corrupt: z.boolean().default(false),
  xpCost: z.number().int().nonnegative().optional(),
  materialCostGp: z.number().nonnegative().optional(),
  focusCostGp: z.number().nonnegative().optional(),
  casterCosts: z.array(DnD35SpellCasterCostSchema).default([])
});
export type DnD35SpellComponents = z.infer<typeof DnD35SpellComponentsSchema>;

/** Saving throw descriptor for a spell or individual spell effect unit. */
export const DnD35SpellSavingThrowSchema = z.object({
  saveType: z.enum(['fort', 'ref', 'will', 'none']),
  effect: z.enum(['negates', 'half', 'partial', 'disbelief', 'harmless', 'none']).default('negates')
});
export type DnD35SpellSavingThrow = z.infer<typeof DnD35SpellSavingThrowSchema>;

/** Multi-role targeting and cluster distance constraints. */
export const DnD35SpellTargetingSchema = z.object({
  mode: z
    .enum([
      'personal',
      'single_creature',
      'multi_creature',
      'caster_and_multi_creature',
      'ray',
      'area',
      'object_or_creature',
      'spatial_zone'
    ])
    .default('single_creature'),
  maxTargetsScaling: DnD35SpellScalingRuleSchema.optional(),
  maxClusterSpanFt: z.number().int().positive().optional(),
  maxTargetHitDice: z.number().int().positive().optional(),
  totalHitDicePool: z.number().int().positive().optional()
});
export type DnD35SpellTargeting = z.infer<typeof DnD35SpellTargetingSchema>;

/** Illumination override descriptor for `[Light]` and `[Darkness]` spatial fields. */
export const DnD35FieldIlluminationOverrideSchema = z.object({
  level: z.enum(['bright', 'shadowy', 'darkness']),
  spellLevel: z.number().int().min(0).max(9).default(0),
  descriptors: z.array(z.string()).default([]),
  yieldsToDescriptors: z.array(z.string()).default([])
});
export type DnD35FieldIlluminationOverride = z.infer<typeof DnD35FieldIlluminationOverrideSchema>;

/** Common tag-conditioned envelope shared by all `DnD35SpellEffectUnit` variants. */
const SpellEffectUnitBaseSchema = z.object({
  unitId: z.string(),
  targetRole: z
    .enum(['primary_target', 'secondary_enemy', 'secondary_ally', 'caster', 'area_occupant'])
    .default('primary_target'),
  condition: DnD35ModifierTagConditionSchema.optional(),
  savingThrow: DnD35SpellSavingThrowSchema.optional(),
  allowsSpellResistance: z.boolean().optional(),
  /** When this unit is active on >= 1 target, projects this tag onto the caster's selfTags (e.g. tether:battletide:enemy_affected). */
  emitsTetherTagToCaster: z.string().optional()
});

/** Discriminated union of modular spell effect units (`DnD35SpellEffectUnitSchema`). */
export const DnD35SpellEffectUnitSchema = z.discriminatedUnion('type', [
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('damage'),
    dice: z.string(),
    diceCountScaling: DnD35SpellScalingRuleSchema.optional(),
    flatBonusScaling: DnD35SpellScalingRuleSchema.optional(),
    projectileCountScaling: DnD35SpellScalingRuleSchema.optional(),
    damageType: DnD35DamageTypeSchema.default('untyped'),
    metamagicScalable: z.boolean().default(true)
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('healing'),
    dice: z.string(),
    flatBonusScaling: DnD35SpellScalingRuleSchema.optional(),
    invertsForUndead: z.boolean().default(true),
    isTemporaryHp: z.boolean().default(false),
    metamagicScalable: z.boolean().default(true)
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('ability_harm'),
    ability: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
    harmKind: z.enum(['penalty', 'damage', 'drain']).default('penalty'),
    dice: z.string(),
    flatBonusScaling: DnD35SpellScalingRuleSchema.optional(),
    minimumScore: z.number().int().nonnegative().default(1),
    metamagicScalable: z.boolean().default(true)
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('condition'),
    conditionId: z.string(),
    durationRoundsScaling: DnD35SpellScalingRuleSchema.optional(),
    eachRoundSaveRetry: z.boolean().default(false),
    maxTargetHitDice: z.number().int().positive().optional(),
    curesConditions: z.array(z.string()).default([])
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('stat_bundle'),
    effectBundle: DnD35EffectBundleSchema,
    /** Optional CL-based dynamic scaling overrides keyed by modifier.targetStat. */
    statScalingRules: z.record(z.string(), DnD35SpellScalingRuleSchema).optional()
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('spatial_field'),
    fieldType: z.string(),
    radiusFt: z.number().int().positive().default(10),
    anchorToCaster: z.boolean().default(false),
    blocksLoS: z.boolean().default(false),
    blocksLoE: z.boolean().default(false),
    movementCostMultiplier: z.number().positive().optional(),
    suppressedTags: z.array(z.string()).default([]),
    illuminationOverride: DnD35FieldIlluminationOverrideSchema.optional()
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('retaliation_rider'),
    triggerCondition: z
      .enum(['melee_adjacent', 'melee_or_spell_adjacent', 'any_hit'])
      .default('melee_or_spell_adjacent'),
    dice: z.string().default('1d8'),
    flatBonusScaling: DnD35SpellScalingRuleSchema.optional(),
    damageType: DnD35DamageTypeSchema.default('force'),
    bypassesDr: z.boolean().default(true),
    maxUsesPerRound: z.number().int().positive().default(1)
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('spell_strike'),
    spellStrike: DnD35SpellStrikeDescriptorSchema
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('dispel'),
    maxCasterLevelBonus: z.number().int().positive().default(10),
    revokesPathPrefix: z.string().default('spell:')
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('quicken_cast_grant'),
    maxSpellLevelScaling: DnD35SpellScalingRuleSchema
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('energy_drain'),
    dice: z.string().default('1d4'),
    durationHoursScaling: DnD35SpellScalingRuleSchema.optional(),
    isPermanent: z.boolean().default(false)
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('save_or_die'),
    onFailOutcome: z.enum(['dead', 'blinded', 'stunned', 'petrified', 'banished']).default('dead'),
    minTargetCurrentHp: z.number().int().optional(),
    maxTargetCurrentHp: z.number().int().optional(),
    minTargetHitDice: z.number().int().positive().optional(),
    maxTargetHitDice: z.number().int().positive().optional(),
    durationFormula: z.string().optional(),
    onSavePartialDamageDice: z.string().optional(),
    onSavePartialFlatScaling: DnD35SpellScalingRuleSchema.optional(),
    onSaveDamageType: DnD35DamageTypeSchema.optional()
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('summon'),
    summonPool: z
      .array(
        z.object({
          raceId: z.string(),
          templateId: z.string().optional(),
          countDice: z.string().default('1'),
          minCasterLevel: z.number().int().positive().default(1)
        })
      )
      .default([]),
    durationRoundsScaling: DnD35SpellScalingRuleSchema.optional()
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('form_overlay'),
    overlayMode: z.enum(['baleful_polymorph', 'polymorph', 'shapechange']).default('polymorph'),
    allowedCreatureTypes: z.array(z.string()).default([]),
    maxHitDiceScaling: z.number().int().positive().or(DnD35SpellScalingRuleSchema).optional(),
    grantsExAbilities: z.boolean().default(false),
    grantsSuAbilities: z.boolean().default(false),
    freeActionFormShift: z.boolean().default(false)
  })
]);
export type DnD35SpellEffectUnit = z.infer<typeof DnD35SpellEffectUnitSchema>;

/** Zod schema for a declarative, tag-driven D&D 3.5e spell definition (`spells/<id>.json`). */
export const DnD35SpellDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  level: z.number().int().min(0).max(9),
  levelByClass: z.record(z.string(), z.number().int().min(0).max(9)).default({}),
  levelByDomain: z.record(z.string(), z.number().int().min(1).max(9)).default({}),
  /** Tag-generalized access map (e.g. "feat:initiate_of_bane": 5, "special:sanctified": 8). */
  levelByAccessTag: z.record(z.string(), z.number().int().min(0).max(9)).default({}),
  school: z.string(),
  subschool: z.string().optional(),
  descriptors: z.array(z.string()).default([]),
  classification: z.enum(['spell', 'ex', 'sp', 'su']).default('spell'),
  castingTime: z
    .enum(['standard', 'full_round', '1_round', 'swift', 'immediate', '1_minute', '10_minutes', '1_hour'])
    .default('standard'),
  range: z.enum(['personal', 'touch', 'close', 'medium', 'long', 'fixed', 'unlimited']).default('close'),
  duration: z.string().default('instantaneous'),
  components: DnD35SpellComponentsSchema,
  allowsSpellResistance: z.boolean().default(true),
  savingThrow: DnD35SpellSavingThrowSchema.optional(),
  targeting: DnD35SpellTargetingSchema.optional(),
  aoeShape: z.enum(['single', 'burst', 'spread', 'cone', 'line', 'cylinder', 'emanation', 'wall']).default('single'),
  aoeRadiusFt: z.number().int().nonnegative().default(0),
  damageDice: z.string().optional(),
  damageType: DnD35DamageTypeSchema.optional(),
  effectBundle: DnD35EffectBundleSchema.optional(),
  effectUnits: z.array(DnD35SpellEffectUnitSchema).default([]),
  tags: z.array(z.string()).default([])
});
export type DnD35SpellDefinition = z.infer<typeof DnD35SpellDefinitionSchema>;
