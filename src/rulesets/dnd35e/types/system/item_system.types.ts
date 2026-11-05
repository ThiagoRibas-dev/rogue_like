import { z } from 'zod';
import { ItemDefinitionSchema } from '../../../../types/campaign/item.ts';
import { DnD35DamageTypeSchema } from './base_system.types.ts';
import { DnD35EffectBundleSchema } from './effect_system.types.ts';

/** Canonical D&D 3.5e special material types. */
export const DnD35SpecialMaterialSchema = z.enum([
  'mundane',
  'masterwork',
  'mithral',
  'adamantine',
  'darkwood',
  'alchemical_silver',
  'silver',
  'cold_iron'
]);
export type DnD35SpecialMaterial = z.infer<typeof DnD35SpecialMaterialSchema>;

/** Structured D&D 3.5e weapon statistics driving `weapon_profile_parser.ts` without hardcoded IDs. */
export const DnD35WeaponStatsSchema = z.object({
  proficiencyCategory: z.enum(['simple', 'martial', 'exotic']),
  weaponCategory: z.enum(['unarmed', 'melee', 'ranged', 'thrown']),
  effort: z.enum(['light', 'one_handed', 'two_handed']),
  damageDice: z.string(),
  damageType: DnD35DamageTypeSchema,
  secondaryDamageTypes: z.array(DnD35DamageTypeSchema).optional(),
  critThreatMin: z.number().int().min(15).max(20).default(20),
  critMultiplier: z.number().int().min(2).max(4).default(2),
  rangeIncrementFt: z.number().int().positive().optional(),
  reachFt: z.number().int().positive().default(5),
  strikesAdjacent: z.boolean().default(true),
  isDoubleWeapon: z.boolean().default(false),
  offHandDamageDice: z.string().optional(),
  offHandDamageType: DnD35DamageTypeSchema.optional(),
  offHandCritThreatMin: z.number().int().min(15).max(20).optional(),
  offHandCritMultiplier: z.number().int().min(2).max(4).optional(),
  isFinesseEligible: z.boolean().default(false),
  cannotTwoHandStr: z.boolean().default(false),
  isExotic1HMartial2H: z.boolean().default(false),
  familiaritySubtypes: z.array(z.string()).default([]),
  maneuverTags: z
    .array(z.enum(['trip', 'disarm', 'brace_vs_charge', 'monk', 'nonlethal_only', 'composite_str']))
    .default([])
});
export type DnD35WeaponStats = z.infer<typeof DnD35WeaponStatsSchema>;

/** Structured D&D 3.5e armor & shield statistics driving `semantic_tags.ts` and Stage 3/4 Stat DAG. */
export const DnD35ArmorStatsSchema = z.object({
  armorCategory: z.enum(['light', 'medium', 'heavy', 'shield', 'tower_shield']),
  armorBonus: z.number().int().nonnegative(),
  maxDexBonus: z.number().int().nonnegative().nullable().default(null),
  armorCheckPenalty: z.number().int().max(0).default(0),
  arcaneSpellFailure: z.number().int().min(0).max(100).default(0),
  speed30Ft: z.number().int().positive().optional(),
  speed20Ft: z.number().int().positive().optional(),
  isMetal: z.boolean().default(false)
});
export type DnD35ArmorStats = z.infer<typeof DnD35ArmorStatsSchema>;

/** Structured magical armament properties. */
export const DnD35MagicalPropertiesSchema = z.object({
  enhancementBonus: z.number().int().min(0).max(5).default(0),
  isMasterwork: z.boolean().default(false),
  keen: z.boolean().optional(),
  ghostTouch: z.boolean().optional(),
  animated: z.boolean().optional(),
  fortificationType: z.enum(['light', 'moderate', 'heavy']).optional(),
  baneCreatureType: z.string().optional(),
  energyRiders: z
    .array(
      z.object({
        propertyId: z.string(),
        dice: z.string(),
        damageType: DnD35DamageTypeSchema
      })
    )
    .optional(),
  onHitEffectIds: z.array(z.string()).optional()
});
export type DnD35MagicalProperties = z.infer<typeof DnD35MagicalPropertiesSchema>;

/** Complete D&D 3.5e Item Definition schema (`public/data/rulesets/dnd35e/items/<id>.json`). */
export const DnD35ItemDefinitionSchema = ItemDefinitionSchema.extend({
  weaponStats: DnD35WeaponStatsSchema.optional(),
  armorStats: DnD35ArmorStatsSchema.optional(),
  specialMaterial: DnD35SpecialMaterialSchema.optional(),
  magicalProperties: DnD35MagicalPropertiesSchema.optional(),
  effectBundle: DnD35EffectBundleSchema.optional()
});
export type DnD35ItemDefinition = z.infer<typeof DnD35ItemDefinitionSchema>;
