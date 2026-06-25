import { z } from 'zod';
import { FactionRelationEnum } from './world.ts';

/** Zod enum for categories of items. */
export const ItemCategoryEnum = z.enum(['consumable', 'weapon', 'armor', 'tool']);
/** Inferred type representing an item category. */
export type ItemCategory = z.infer<typeof ItemCategoryEnum>;

/** Zod enum for available equipment slots. */
export const EquipmentSlotEnum = z.enum(['head', 'neck', 'torso', 'back', 'arm', 'hand', 'finger', 'leg', 'foot']);
/** Inferred type representing an equipment slot. */
export type EquipmentSlot = z.infer<typeof EquipmentSlotEnum>;

/** Zod schema defining an item registry template. */
export const ItemDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  unidentifiedName: z.string(),
  description: z.string(),
  glyph: z.string().length(1),
  fg: z.string(),
  bg: z.string(),
  category: ItemCategoryEnum,
  tags: z.array(z.string()).default([]),
  weight: z.number().int().nonnegative(),
  baseValue: z.number().int().nonnegative().default(0),
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
      charges: z.number().int().positive().optional()
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
