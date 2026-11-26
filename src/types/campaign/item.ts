import { z } from 'zod';
import { ContentSourceOriginSchema } from './meta.ts';
import { FactionRelationEnum } from './world.ts';

/** Zod enum for categories of items. */
export const ItemCategoryEnum = z.enum(['consumable', 'weapon', 'armor', 'tool']);
/** Inferred type representing an item category. */
export type ItemCategory = z.infer<typeof ItemCategoryEnum>;

/** Zod enum for available equipment slots. */
export const EquipmentSlotEnum = z.enum([
  'head',
  'neck',
  'torso',
  'back',
  'arm',
  'hand',
  'finger',
  'leg',
  'foot',
  'eyes',
  'shoulders',
  'body',
  'waist',
  'ring',
  'held',
  'main_hand',
  'off_hand',
  'two_handed',
  'ranged'
]);
/** Inferred type representing an equipment slot. */
export type EquipmentSlot = z.infer<typeof EquipmentSlotEnum>;

/** Zod schema defining an item registry template. */
export const ItemDefinitionSchema = z.object({
  id: z.string(),
  baseItemId: z.string().optional(),
  name: z.string(),
  unidentifiedName: z.string().default('Unidentified Item'),
  description: z.string(),
  glyph: z.string().length(1),
  fg: z.string(),
  bg: z.string(),
  spriteId: z.string().optional(),
  sourceOrigin: ContentSourceOriginSchema.optional(),
  category: ItemCategoryEnum,
  tags: z.array(z.string()).default([]),
  weight: z.number().nonnegative(),
  baseValue: z.number().nonnegative().default(0),
  currencyUnit: z.string().optional(),
  currencyGrant: z
    .object({
      denominationId: z.string().min(1),
      amount: z.number().int().positive()
    })
    .optional(),
  isArtifact: z.boolean().optional(),
  weaponStats: z.unknown().optional(),
  armorStats: z.unknown().optional(),
  specialMaterial: z.unknown().optional(),
  magicalProperties: z.unknown().optional(),
  enhancements: z.array(z.string()).optional(),
  effectBundle: z.unknown().optional(),
  consumable: z
    .object({
      effectId: z.string(),
      charges: z.number().int().positive()
    })
    .optional(),
  equippable: z
    .object({
      slot: EquipmentSlotEnum,
      attackBonus: z.number().int(),
      defenseBonus: z.number().int(),
      maxHpBonus: z.number().int(),
      carryBonus: z.number().int(),
      onHit: z
        .object({
          statusId: z.string(),
          duration: z.number().int().positive()
        })
        .optional()
    })
    .optional(),
  throwable: z
    .object({
      range: z.number().int().positive(),
      damage: z.number().int().nonnegative().optional(),
      destroyOnImpact: z.boolean().optional()
    })
    .optional(),
  zappable: z
    .object({
      range: z.number().int().positive(),
      pattern: z.enum(['beam', 'bolt', 'cone']),
      effectId: z.string(),
      charges: z.number().int().positive().optional(),
      maxCharges: z.number().int().positive().optional(),
      currentCharges: z.number().int().nonnegative().optional(),
      spellId: z.string().optional()
    })
    .optional(),
  lightSource: z
    .object({
      radiusFt: z.number().nonnegative(),
      shadowyRadiusFt: z.number().nonnegative().optional(),
      coneAngleDeg: z.number().min(1).max(360).optional(),
      fuelTurns: z.number().int().nonnegative().optional(),
      requiresIgnition: z.boolean().optional(),
      defaultLit: z.boolean().optional()
    })
    .optional(),
  coating: z
    .object({
      statusId: z.string(),
      charges: z.number().int().positive(),
      duration: z.number().int().positive(),
      bonusDamageDice: z.string().optional(),
      bonusDamageType: z.string().optional(),
      targetConditionTag: z.string().optional(),
      isPoison: z.boolean().optional()
    })
    .optional(),
  deployment: z
    .object({
      fieldId: z.string(),
      duration: z.number().int().positive()
    })
    .optional(),
  crossingRecipe: z
    .object({
      crossingKind: z.enum(['bridge', 'rope_line', 'ladder_span', 'frozen_surface']),
      requiredPartnerTags: z.array(z.string()).default([]),
      requiredSkill: z.string().optional(),
      skillDc: z.number().int().nonnegative().optional(),
      consumesItems: z.boolean().default(true),
      maxRangeTiles: z.number().int().positive().default(4)
    })
    .optional(),
  structural: z
    .object({
      materialId: z.string(),
      thicknessInches: z.number().positive(),
      hp: z.number().int().nonnegative().optional(),
      maxHp: z.number().int().positive().optional(),
      hardnessOverride: z.number().int().nonnegative().optional(),
      isDoor: z.boolean().optional(),
      isOpen: z.boolean().optional(),
      isLocked: z.boolean().optional(),
      openLockDc: z.number().int().nonnegative().optional(),
      isStuck: z.boolean().optional(),
      isSpiked: z.boolean().optional(),
      breakDc: z.number().int().nonnegative().optional(),
      isRuined: z.boolean().optional()
    })
    .optional()
});
/** Inferred type for an item definition. */
export type ItemDefinition = z.infer<typeof ItemDefinitionSchema>;

/** Zod enum for item usability side effects. */
export const ItemEffectTypeEnum = z.enum([
  'heal',
  'damage',
  'damage_nearest',
  'damage_area',
  'apply_status',
  'identify',
  'satiate'
]);
/** Inferred type representing an item effect type. */
export type ItemEffectType = z.infer<typeof ItemEffectTypeEnum>;

/** Zod schema describing an item effect template. */
export const ItemEffectDefinitionSchema = z.object({
  id: z.string(),
  type: ItemEffectTypeEnum,
  value: z.number(),
  range: z.number().int().positive().optional(),
  radius: z.number().int().positive().optional(),
  statusId: z.string().optional(),
  duration: z.number().int().positive().optional(),
  message: z.string(),
  tags: z.array(z.string()).optional(),
  targetFilters: z
    .object({
      requireTags: z.array(z.string()).optional(),
      excludeTags: z.array(z.string()).optional(),
      factions: z.array(FactionRelationEnum).optional()
    })
    .optional()
});
/** Inferred type for an item effect definition. */
export type ItemEffectDefinition = z.infer<typeof ItemEffectDefinitionSchema>;
