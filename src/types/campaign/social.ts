import { z } from 'zod';
import { ConsequenceActionSchema } from '../trigger.types.ts';

/** Zod schema for static knowledge templates. */
export const KnowledgeItemSchema = z.object({
  id: z.string(),
  type: z.enum(['rumor', 'location', 'weakness', 'secret']),
  description: z.string(),
  tags: z.array(z.string()).default([])
});
/** Inferred type for a knowledge item template. */
export type KnowledgeItemType = z.infer<typeof KnowledgeItemSchema>;

/** Zod schema for knowledge propagation parameters. */
export const KnowledgePropagationRuleSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  eligibleTags: z.array(z.string()).default([]),
  eligibleFactions: z.array(z.string()).default([]),
  requireAreaProximity: z.boolean().default(true),
  delay: z.number().int().nonnegative().default(50),
  knowledgeTemplate: KnowledgeItemSchema
});
/** Inferred type for knowledge propagation rules. */
export type KnowledgePropagationRule = z.infer<typeof KnowledgePropagationRuleSchema>;

/** Zod schema for rumor items. */
export const RumorItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourceEventId: z.string().optional(),
  turnCreated: z.number().int().nonnegative(),
  persistent: z.boolean().optional()
});
/** Inferred type for a rumor item template. */
export type RumorItemData = z.infer<typeof RumorItemSchema>;

/** Zod schema for rumor propagation rules. */
export const RumorPropagationRuleSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  eligibleTags: z.array(z.string()).default([]),
  eligibleFactions: z.array(z.string()).default([]),
  requireAreaProximity: z.boolean().default(true),
  delay: z.number().int().nonnegative().default(100),
  rumorTemplate: z.object({
    id: z.string(),
    text: z.string(),
    persistent: z.boolean().optional()
  })
});
/** Inferred type for rumor propagation rules. */
export type RumorPropagationRule = z.infer<typeof RumorPropagationRuleSchema>;

/** Zod enum for villain leverages in MICE. */
export const LeverageTypeEnum = z.enum(['money', 'ideology', 'coercion', 'ego']);
/** Inferred type for leverage category identifiers. */
export type LeverageType = z.infer<typeof LeverageTypeEnum>;

/** Zod schema defining villain-minion agreements. */
export const AgreementDefinitionSchema = z.object({
  id: z.string(),
  task: z.string(),
  incriminatingWeight: z.number().int().positive(),
  clueTemplates: z.array(z.string())
});
/** Inferred type for agreement definitions. */
export type AgreementDefinition = z.infer<typeof AgreementDefinitionSchema>;

/** Zod schema defining mastermind villain archetypes. */
export const VillainArchetypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  goals: z.array(z.string()),
  recruitmentPreferences: z.object({
    targetTags: z.array(z.string()),
    leverageWeight: z.record(LeverageTypeEnum, z.number())
  })
});
/** Inferred type for villain archetypes. */
export type VillainArchetype = z.infer<typeof VillainArchetypeSchema>;

/** Zod schema defining scheme mutation changes applied to areas. */
export const SchemePhaseMutationSchema = z.object({
  targetAreaId: z.string(),
  addedTags: z.array(z.string()).optional(),
  budgetModifier: z.number().int().optional(),
  encounterProfileId: z.string().optional(),
  subBiomes: z.record(z.string(), z.number().positive().max(1)).optional()
});
/** Inferred type for scheme phase mutations. */
export type SchemePhaseMutation = z.infer<typeof SchemePhaseMutationSchema>;

/** Zod schema defining threat schemes and phases. */
export const SchemeTemplateSchema = z.object({
  id: z.string(),
  villainArchetypeId: z.string(),
  phases: z.array(
    z.object({
      requiredAgreements: z.number().int().nonnegative(),
      missionIntents: z.array(z.string()),
      mutations: z.array(SchemePhaseMutationSchema).optional()
    })
  )
});
/** Inferred type for scheme templates. */
export type SchemeTemplate = z.infer<typeof SchemeTemplateSchema>;

/** Zod schema defining tag configuration metadata. */
export const TagDefinitionSchema = z.object({
  category: z.string(),
  color: z.string(),
  description: z.string(),
  barks: z.record(z.string(), z.array(z.string())).optional()
});
/** Inferred type for a tag definition. */
export type TagDefinition = z.infer<typeof TagDefinitionSchema>;

/** Zod schema for matching entity targets in reactions. */
export const ReactionEntityMatcherSchema = z.object({
  targetType: z.literal('entity'),
  tags: z.array(z.string()).optional(),
  traits: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  entityId: z.string().optional()
});
/** Inferred type for dynamic reaction entity matcher. */
export type ReactionEntityMatcher = z.infer<typeof ReactionEntityMatcherSchema>;

/** Zod schema for matching tile targets in reactions. */
export const ReactionTileMatcherSchema = z.object({
  targetType: z.literal('tile'),
  tags: z.array(z.string()).optional(),
  tileId: z.string().optional(),
  fieldTypes: z.array(z.string()).optional()
});
/** Inferred type for dynamic reaction tile matcher. */
export type ReactionTileMatcher = z.infer<typeof ReactionTileMatcherSchema>;

/** Zod schema for matching generic target types (entities or tiles) in reactions. */
export const ReactionTargetMatcherSchema = z.discriminatedUnion('targetType', [
  ReactionEntityMatcherSchema,
  ReactionTileMatcherSchema
]);
/** Inferred type for dynamic reaction target matcher. */
export type ReactionTargetMatcher = z.infer<typeof ReactionTargetMatcherSchema>;

/** Zod schema for matching target context (like faction standings) in reactions. */
export const ReactionContextMatcherSchema = z.object({
  factionStanding: z
    .object({
      factionId: z.string(),
      min: z.number().int().optional(),
      max: z.number().int().optional()
    })
    .optional()
});
/** Inferred type for dynamic reaction context matcher. */
export type ReactionContextMatcher = z.infer<typeof ReactionContextMatcherSchema>;

/** Zod schema for tag-driven reactions. */
export const ReactionDefinitionSchema = z.object({
  id: z.string(),
  verb: z.string(),
  priority: z.number().int().default(0),
  sourceMatcher: ReactionTargetMatcherSchema,
  targetMatcher: ReactionTargetMatcherSchema,
  contextMatcher: ReactionContextMatcherSchema.optional(),
  consequences: z.array(ConsequenceActionSchema),
  message: z.string().optional()
});
/** Inferred type for a reaction definition. */
export type ReactionDefinition = z.infer<typeof ReactionDefinitionSchema>;

/** Zod schema defining templates for procedural quests. */
export const ProceduralQuestTemplateSchema = z.object({
  id: z.string(),
  titleTemplate: z.string(),
  descriptionTemplate: z.string(),
  objectiveType: z.enum(['kill', 'gather', 'explore', 'talk']),
  targetTags: z.array(z.string()).optional(),
  targetFactions: z.array(z.string()).optional(),
  amountRange: z.tuple([z.number(), z.number()]),
  rewardXpMultiplier: z.number()
});
/** Inferred type for procedural quest templates. */
export type ProceduralQuestTemplate = z.infer<typeof ProceduralQuestTemplateSchema>;

/** Zod schema defining dynamic relationship milestone triggers. */
export const RelationshipThresholdSchema = z.object({
  axis: z.string(),
  operator: z.enum(['>=', '<=', '==']),
  value: z.number().int(),
  consequence: ConsequenceActionSchema
});
/** Inferred type for a relationship threshold definition. */
export type RelationshipThreshold = z.infer<typeof RelationshipThresholdSchema>;
