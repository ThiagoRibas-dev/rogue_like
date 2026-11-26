import { z } from 'zod';
import { DialogueTreeSchema, DialogueConditionSchema, DialogueEffectSchema } from './dialogue.types.ts';
export { DialogueConditionSchema, DialogueEffectSchema };
export type { DialogueCondition, DialogueEffect } from './dialogue.types.ts';

import { QuestSchema } from './quests.types.ts';
import { TriggerDefinitionSchema, TriggerTemplateSchema } from './trigger.types.ts';

// Import sub-domain types to assemble the main schemas
import {
  CampaignManifestSchema,
  AdvancementLevelSchema,
  RulesConfigSchema,
  ThemeConfigSchema
} from './campaign/meta.ts';

import {
  FactionMatrixSchema,
  AreaDefinitionSchema,
  FieldDefinitionSchema,
  TileDefinitionSchema,
  WorldEventsConfigSchema
} from './campaign/world.ts';

import { ItemDefinitionSchema, ItemEffectDefinitionSchema } from './campaign/item.ts';

import {
  KnowledgePropagationRuleSchema,
  RumorPropagationRuleSchema,
  AgreementDefinitionSchema,
  VillainArchetypeSchema,
  SchemeRecipeSchema,
  PhaseBlockSchema,
  TagDefinitionSchema,
  ReactionDefinitionSchema,
  ProceduralQuestTemplateSchema,
  RelationshipThresholdSchema
} from './campaign/social.ts';

import {
  EntityTemplateSchema,
  StatusEffectDefinitionSchema,
  AIProfileSchema,
  SpawnPoolDefinitionSchema,
  EncounterProfileSchema,
  TraitDefinitionSchema,
  IdentityGenerationTableSchema,
  PersonalityGenerationTableSchema,
  NemesisHierarchySchema
} from './campaign/entity.ts';
import { GenericSystemContentSchema } from './campaign/system_content.ts';

// Re-export all sub-domain schemas and types for public consumption
export * from './campaign/meta.ts';
export * from './campaign/world.ts';
export * from './campaign/item.ts';
export * from './campaign/social.ts';
export * from './campaign/entity.ts';
export * from './campaign/system_content.ts';

/** The root Zod schema for a full campaign JSON document. */
export const CampaignDataSchema = z.object({
  manifest: CampaignManifestSchema,
  rules: RulesConfigSchema,
  theme: ThemeConfigSchema,
  advancement: z.array(AdvancementLevelSchema),
  areas: z.record(z.string(), AreaDefinitionSchema),
  items: z.record(z.string(), ItemDefinitionSchema),
  effects: z.record(z.string(), ItemEffectDefinitionSchema),
  entities: z.record(z.string(), EntityTemplateSchema),
  status: z.record(z.string(), StatusEffectDefinitionSchema),
  tiles: z.record(z.string(), TileDefinitionSchema),
  factions: FactionMatrixSchema,
  ai: z.record(z.string(), AIProfileSchema),
  dialogues: z.record(z.string(), DialogueTreeSchema),
  quests: z.record(z.string(), QuestSchema),
  questTemplates: z.record(z.string(), ProceduralQuestTemplateSchema),
  triggers: z.record(z.string(), TriggerDefinitionSchema),
  triggerTemplates: z.record(z.string(), TriggerTemplateSchema).default({}),
  triggerBuckets: z.record(z.string(), z.array(TriggerDefinitionSchema)).optional(),
  villains: z.record(z.string(), VillainArchetypeSchema),
  schemeRecipes: z.record(z.string(), SchemeRecipeSchema).default({}),
  phaseBlocks: z.record(z.string(), PhaseBlockSchema).default({}),
  agreements: z.record(z.string(), AgreementDefinitionSchema),
  tagRegistry: z.record(z.string(), TagDefinitionSchema).default({}),
  reactions: z.array(ReactionDefinitionSchema).default([]),
  fields: z.record(z.string(), FieldDefinitionSchema).default({}),
  spawnPools: z.record(z.string(), SpawnPoolDefinitionSchema).default({}),
  encounterProfiles: z.record(z.string(), EncounterProfileSchema).default({}),
  traitRegistry: z.record(z.string(), TraitDefinitionSchema).default({}),
  identityGeneration: z.record(z.string(), IdentityGenerationTableSchema).default({}),
  personalityGeneration: z.record(z.string(), PersonalityGenerationTableSchema).default({}),
  nemesisHierarchies: z.record(z.string(), NemesisHierarchySchema).default({}),
  knowledgePropagation: z.array(KnowledgePropagationRuleSchema).default([]),
  rumorPropagation: z.array(RumorPropagationRuleSchema).default([]),
  relationshipThresholds: z.array(RelationshipThresholdSchema).default([]),
  worldEvents: WorldEventsConfigSchema.default({ areaEvents: [], factionEvents: [] }),
  systemContent: GenericSystemContentSchema.optional()
});
/** The inferred type for a complete campaign data structure. */
export type CampaignData = z.infer<typeof CampaignDataSchema>;

/**
 * Unwraps optional, nullable, default, and effects wrappers around a Zod schema.
 *
 * @param schema Arbitrary Zod schema node.
 * @returns The unwrapped inner Zod schema.
 */
export function unwrapZodSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let curr = schema;
  while (
    curr instanceof z.ZodOptional ||
    curr instanceof z.ZodNullable ||
    curr instanceof z.ZodDefault ||
    curr instanceof z.ZodEffects
  ) {
    if (curr instanceof z.ZodDefault) {
      curr = curr.removeDefault();
    } else if (curr instanceof z.ZodEffects) {
      curr = curr.innerType();
    } else {
      curr = (curr as z.ZodOptional<z.ZodTypeAny>).unwrap();
    }
  }
  return curr;
}

/**
 * Auto-derives the item/form Zod schema for each top-level CampaignData category:
 * - For dictionary categories (`z.record(z.string(), ItemSchema)`), returns `ItemSchema`
 *   (except `factions`, which uses a 2D `FactionMatrixSchema` grid).
 * - For singleton categories (`z.object(...)` or `z.array(...)`), returns the unwrapped schema.
 */
function buildCampaignCategorySchemas(): Record<keyof CampaignData, z.ZodTypeAny> {
  const result = {} as Record<keyof CampaignData, z.ZodTypeAny>;
  const shape = CampaignDataSchema.shape;
  for (const key of Object.keys(shape) as Array<keyof CampaignData>) {
    const raw = unwrapZodSchema(shape[key]);
    if (key !== 'factions' && raw instanceof z.ZodRecord) {
      result[key] = raw.valueSchema;
    } else {
      result[key] = raw;
    }
  }
  return result;
}

/** Helper registry mapping each campaign JSON database category to its respective Zod schema for editor validation. */
export const CampaignCategorySchemas: Record<keyof CampaignData, z.ZodTypeAny> = buildCampaignCategorySchemas();
