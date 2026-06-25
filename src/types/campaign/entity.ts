import { z } from 'zod';
import { EquipmentSlotEnum } from './item.ts';
import { KnowledgeItemSchema, RumorItemSchema, LeverageTypeEnum } from './social.ts';

/** Zod schema describing entity template configs. */
export const EntityTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  glyph: z.string().length(1),
  fg: z.string(),
  bg: z.string(),
  isActor: z.boolean(),
  speed: z.number().int().positive().optional(),
  fighter: z
    .object({
      maxHp: z.number().int().positive(),
      attack: z.number().int().nonnegative(),
      defense: z.number().int().nonnegative(),
      xpGiven: z.number().int().nonnegative().optional()
    })
    .optional(),
  ai: z
    .object({
      profileId: z.string(),
      aggroRadius: z.number().int().positive().optional(),
      wanders: z.boolean().optional()
    })
    .optional(),
  inventoryConfig: z
    .object({
      baseCapacity: z.number().int().nonnegative()
    })
    .optional(),
  equipmentSlots: z.array(EquipmentSlotEnum).optional(),
  faction: z.string().optional(),
  tags: z.array(z.string()).optional(),
  traits: z.array(z.string()).optional(),
  persistent: z.boolean().optional(),
  memory: z
    .object({
      factionStandings: z.record(z.string(), z.number().int()).optional(),
      facts: z.array(z.string()).optional(),
      grudges: z.array(z.string()).optional(),
      facets: z.record(z.string(), z.number().int().min(0).max(100)).optional(),
      values: z.record(z.string(), z.number().int().min(-50).max(50)).optional(),
      relationshipAxes: z.record(z.string(), z.number().int().min(-100).max(100)).optional(),
      stress: z.number().int().min(0).max(100).optional(),
      thoughts: z
        .array(
          z.object({
            turn: z.number().int().nonnegative(),
            eventSummary: z.string(),
            stressDelta: z.number().int(),
            relatedEntityId: z.number().int().optional()
          })
        )
        .optional(),
      knowledge: z.record(z.string(), KnowledgeItemSchema).optional(),
      timesTalked: z.number().int().nonnegative().optional(),
      timesTraded: z.number().int().nonnegative().optional(),
      timesIntimidated: z.number().int().nonnegative().optional(),
      timesHelped: z.number().int().nonnegative().optional(),
      timesBetrayed: z.number().int().nonnegative().optional(),
      patienceThreshold: z.number().int().nonnegative().optional(),
      annoyedDuration: z.number().int().nonnegative().optional(),
      gratefulDuration: z.number().int().nonnegative().optional(),
      deflectionLines: z.array(z.string()).optional(),
      rumorPool: z.array(RumorItemSchema).optional()
    })
    .optional(),
  dialogueId: z.string().optional(),
  attitude: z.enum(['hostile', 'neutral', 'friendly']).optional(),
  trap: z
    .object({
      triggerId: z.string()
    })
    .optional(),
  lock: z
    .object({
      difficulty: z.number().int().nonnegative(),
      keyTag: z.string().optional(),
      locked: z.boolean(),
      jammed: z.boolean().optional(),
      breakable: z.boolean().optional()
    })
    .optional(),
  renderable: z.boolean().optional(),
  crCost: z.number().int().nonnegative().optional(),
  roleTags: z.array(z.string()).optional(),
  encounterTags: z.array(z.string()).optional(),
  directorHints: z.record(z.string(), z.unknown()).optional(),
  shop: z
    .object({
      inventory: z.array(z.string()).optional(),
      markupMultiplier: z.number().nonnegative(),
      buyTags: z.array(z.string()).default([]),
      sellTags: z.array(z.string()).default([]),
      supplierHierarchyId: z.string().optional()
    })
    .optional(),
  services: z
    .array(
      z.object({
        serviceId: z.string(),
        name: z.string(),
        cost: z.number().int().nonnegative(),
        effectId: z.string()
      })
    )
    .optional()
});
/** Inferred type for an entity template definition. */
export type EntityTemplate = z.infer<typeof EntityTemplateSchema>;

/** Zod schema defining static status effect templates. */
export const StatusEffectDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string(),
  statModifiers: z
    .object({
      attack: z.number().int().optional(),
      defense: z.number().int().optional(),
      maxHp: z.number().int().optional(),
      speed: z.number().int().optional()
    })
    .optional(),
  perTurnDamage: z.number().int().nonnegative().optional(),
  perTurnHeal: z.number().int().nonnegative().optional(),
  flags: z
    .object({
      skipTurn: z.boolean().optional(),
      confused: z.boolean().optional()
    })
    .optional()
});
/** Inferred type for a status effect definition. */
export type StatusEffectDefinition = z.infer<typeof StatusEffectDefinitionSchema>;

/** Zod schema defining individual behavior entries for entities. */
export const AIBehaviorEntrySchema = z.discriminatedUnion('behaviorId', [
  z.object({
    behaviorId: z.literal('hunt'),
    aggroRadius: z.number().int().positive().optional(),
    weightModifiers: z.record(z.string(), z.number()).optional()
  }),
  z.object({
    behaviorId: z.literal('flee'),
    hpThreshold: z.number().optional(),
    weightModifiers: z.record(z.string(), z.number()).optional()
  }),
  z.object({
    behaviorId: z.literal('ranged'),
    spellId: z.string(),
    weightModifiers: z.record(z.string(), z.number()).optional()
  }),
  z.object({ behaviorId: z.literal('wander'), weightModifiers: z.record(z.string(), z.number()).optional() })
]);
/** Inferred type for an AI behavior entry. */
export type AIBehaviorEntry = z.infer<typeof AIBehaviorEntrySchema>;

/** Zod schema for entity AI profiles. */
export const AIProfileSchema = z.object({
  id: z.string(),
  behaviors: z.array(AIBehaviorEntrySchema),
  barks: z.record(z.string(), z.array(z.string())).optional()
});
/** Inferred type for an AI profile. */
export type AIProfile = z.infer<typeof AIProfileSchema>;

/** Zod schema defining encounter director spawn pools. */
export const SpawnPoolDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  conditions: z
    .object({
      areaTags: z.array(z.string()).optional(),
      biomeTags: z.array(z.string()).optional(),
      factionTags: z.array(z.string()).optional(),
      roleTags: z.array(z.string()).optional()
    })
    .optional(),
  entities: z.record(z.string(), z.number().int().positive())
});
/** Inferred type for spawn pool definitions. */
export type SpawnPoolDefinition = z.infer<typeof SpawnPoolDefinitionSchema>;

/** Zod schema defining encounter allocation profiles. */
export const EncounterProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  budgetAllocation: z.object({
    protein: z.number(),
    appetizer: z.number(),
    side: z.number(),
    dessert: z.number()
  })
});
/** Inferred type for encounter profiles. */
export type EncounterProfile = z.infer<typeof EncounterProfileSchema>;

/** Zod schema for scaling traits assigned to entities. */
export const TraitDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  crCostModifier: z.number().optional(),
  crCostMultiplier: z.number().optional(),
  statModifiers: z.record(z.string(), z.number()).optional(),
  tagsAdded: z.array(z.string()).optional(),
  barks: z.record(z.string(), z.array(z.string())).optional()
});
/** Inferred type for a scaling trait definition. */
export type TraitDefinition = z.infer<typeof TraitDefinitionSchema>;

/** Zod schema for identity generator tables. */
export const IdentityGenerationTableSchema = z.object({
  firstNames: z.array(z.string()),
  lastNames: z.array(z.string()).optional(),
  titles: z.array(z.string()),
  mannerisms: z.array(z.string()),
  colors: z.array(z.string()).optional()
});
/** Inferred type for identity generator tables. */
export type IdentityGenerationTable = z.infer<typeof IdentityGenerationTableSchema>;

/** Zod schema for personality generation configurations. */
export const PersonalityGenerationTableSchema = z.object({
  facets: z.array(z.string()).describe('List of personality facets to generate (e.g., cowardice, cruelty)'),
  values: z.array(z.string()).describe('List of personality values to generate (e.g., power, peace)'),
  leverageMappings: z
    .record(LeverageTypeEnum, z.array(z.string()))
    .optional()
    .describe('Maps MICE leverages to the facets that multiply their effectiveness.')
});
/** Inferred type for personality generation tables. */
export type PersonalityGenerationTable = z.infer<typeof PersonalityGenerationTableSchema>;

/** Zod schema representing individual ranks in a nemesis hierarchy. */
export const HierarchyRankSchema = z.object({
  rankId: z.string(),
  displayName: z.string(),
  tier: z.number().int().min(0),
  maxSlots: z.number().int().positive(),
  statMultipliers: z
    .object({
      maxHp: z.number().default(1.0),
      attack: z.number().default(1.0),
      defense: z.number().default(1.0),
      xpGiven: z.number().default(1.0)
    })
    .optional(),
  titlePool: z.array(z.string()).optional()
});
/** Inferred type for hierarchy ranks. */
export type HierarchyRank = z.infer<typeof HierarchyRankSchema>;

/** Zod schema for permanent scars resulting from defeats. */
export const ScarDefinitionSchema = z.object({
  id: z.string(),
  description: z.string(),
  statModifiers: z
    .object({
      maxHp: z.number().int().optional(),
      attack: z.number().int().optional(),
      defense: z.number().int().optional(),
      speed: z.number().int().optional()
    })
    .optional(),
  traitsAdded: z.array(z.string()).optional(),
  traitsRemoved: z.array(z.string()).optional(),
  dialogueModifier: z.string().optional()
});
/** Inferred type for a scar definition. */
export type ScarDefinition = z.infer<typeof ScarDefinitionSchema>;

/** Zod schema for the nemesis faction hierarchy. */
export const NemesisHierarchySchema = z.object({
  id: z.string(),
  factionId: z.string(),
  ranks: z.array(HierarchyRankSchema),
  promotionSources: z.array(z.string()).default([]),
  scarPool: z.array(ScarDefinitionSchema).default([])
});
/** Inferred type for nemesis hierarchies. */
export type NemesisHierarchy = z.infer<typeof NemesisHierarchySchema>;
