import { z } from 'zod';
import type { PrerequisiteNode } from '../../prerequisites.ts';
import { DnD35AlignmentSchema, SizeCategorySchema } from './base_system.types.ts';

/** Canonical D&D 3.5e school of magic enum schema. */
export const DnD35SpellSchoolSchema = z.enum([
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation'
]);

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
    z.object({
      type: z.literal('min_skill_count_at_ranks'),
      skillPrefix: z.string(),
      minRanks: z.number(),
      minCount: z.number().int().positive()
    }),
    z.object({
      type: z.literal('has_feat'),
      featId: z.string(),
      targetId: z.string().optional(),
      targetPrefix: z.string().optional(),
      targetIdsAny: z.array(z.string()).optional()
    }),
    z.object({
      type: z.literal('min_feat_count'),
      pool: z.enum(['metamagic_or_item_creation']),
      minCount: z.number().int().positive()
    }),
    z.object({ type: z.literal('has_tag'), tag: z.string() }),
    z.object({ type: z.literal('min_caster_level'), minCasterLevel: z.number().int() }),
    z.object({
      type: z.literal('min_class_level'),
      classId: z.string(),
      minLevel: z.number().int().positive()
    }),
    z.object({
      type: z.literal('min_character_level'),
      minLevel: z.number().int().positive()
    }),
    z.object({
      type: z.literal('has_proficiency'),
      scope: z.enum([
        'selected_weapon',
        'weapon',
        'martial_all',
        'simple_all',
        'armor_light',
        'armor_medium',
        'armor_heavy',
        'shield',
        'tower_shield'
      ]),
      weaponId: z.string().optional()
    }),
    z.object({
      type: z.literal('min_natural_attacks'),
      minCount: z.number().int().positive()
    }),
    z.object({
      type: z.literal('min_hands'),
      minHands: z.number().int().positive()
    }),
    z.object({
      type: z.literal('min_natural_armor'),
      minBonus: z.number().int().positive()
    }),
    z.object({
      type: z.literal('min_fly_speed'),
      minSpeedFt: z.number().int().positive()
    }),
    z.object({
      type: z.literal('min_sla_caster_level'),
      minCasterLevel: z.number().int().positive()
    }),
    z.object({ type: z.literal('size_in'), allowedSizes: z.array(SizeCategorySchema) }),
    z.object({ type: z.literal('alignment_in'), allowedAlignments: z.array(DnD35AlignmentSchema) }),
    z.object({
      type: z.literal('min_spell_level'),
      tradition: z.enum(['arcane', 'divine', 'any']),
      minSpellLevel: z.number().int().min(0).max(9),
      castingMode: z.enum(['prepared', 'spontaneous', 'any']).optional(),
      school: DnD35SpellSchoolSchema.optional(),
      minSchoolSpellCount: z.number().int().positive().optional()
    }),
    z.object({ type: z.literal('race_in'), allowedRaces: z.array(z.string()) })
  ])
);
