import { z } from 'zod';
import { DialogueTreeSchema, DialogueConditionSchema, DialogueEffectSchema } from './dialogue.types.ts';
export { DialogueConditionSchema, DialogueEffectSchema };
export type { DialogueCondition, DialogueEffect } from './dialogue.types.ts';

import { QuestSchema } from './quests.types.ts';
import { TriggerDefinitionSchema, ConsequenceActionSchema } from './trigger.types.ts';

// ==========================================
// 1. MANIFEST & REGISTRY
// ==========================================
export const CampaignManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string(),
  version: z.string(),
  author: z.string().default('Unknown'),
  tags: z.array(z.string()).default([]),
  schemaVersion: z.number().int().nonnegative().default(0)
});
export type CampaignManifest = z.infer<typeof CampaignManifestSchema>;

export const CampaignRegistryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  mapSize: z.string(),
  startingAreaId: z.string(),
  source: z.enum(['builtin', 'installed', 'editor']).default('builtin'),
  author: z.string().default('Unknown')
});
export type CampaignRegistryEntry = z.infer<typeof CampaignRegistryEntrySchema>;

export const CampaignRegistrySchema = z.object({
  campaigns: z.array(CampaignRegistryEntrySchema)
});
export type CampaignRegistry = z.infer<typeof CampaignRegistrySchema>;

// ==========================================
// 2. RULES
// ==========================================
export const AdvancementLevelSchema = z.object({
  level: z.number().int().positive(),
  requiredXp: z.number().int().nonnegative(),
  hpGain: z.number().int().nonnegative(),
  attackGain: z.number().int().nonnegative(),
  defenseGain: z.number().int().nonnegative()
});
export type AdvancementLevel = z.infer<typeof AdvancementLevelSchema>;

export const RulesConfigSchema = z.object({
  map: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    minRoomWidth: z.number().int().positive(),
    maxRoomWidth: z.number().int().positive(),
    minRoomHeight: z.number().int().positive(),
    maxRoomHeight: z.number().int().positive(),
    minCorridorLength: z.number().int().positive(),
    maxCorridorLength: z.number().int().positive(),
    dugPercentage: z.number().positive().max(1),
    waterScatterChance: z.number().nonnegative().max(1).default(0),
    startingAreaId: z.string(),
    fovRadius: z.number().int().positive()
  }),
  hunger: z.object({
    maxSatiation: z.number().int().positive(),
    thresholds: z.object({
      satiated: z.number().int().nonnegative(),
      normal: z.number().int().nonnegative(),
      hungry: z.number().int().nonnegative(),
      starving: z.number().int().nonnegative()
    })
  }),
  spawning: z.object({
    maxMonstersPerRoom: z.number().int().nonnegative(),
    maxItemsPerRoom: z.number().int().nonnegative(),
    spawnWeights: z.record(z.string(), z.number().int().nonnegative()),
    lootTable: z.record(z.string(), z.number().int().nonnegative()),
    lootDropChance: z.number().nonnegative().max(1).default(0)
  })
});
export type RulesConfig = z.infer<typeof RulesConfigSchema>;

// ==========================================
// 3. THEME
// ==========================================
export const ThemeConfigSchema = z.object({
  colors: z.object({
    background: z.string().describe('Canvas Background Color'),
    floorDimFg: z.string().describe('Floor Fog of War Color'),
    playerFg: z.string().describe('Default Canvas Text Color'),
    stairsFg: z.string().describe('Procedural Stairs Color'),
    transparent: z.string().describe('Transparency Key'),
    wallDimFg: z.string().describe('Wall Fog of War Color')
  }),
  glyphs: z.object({
    stairsDown: z.string().length(1).describe('Stairs Down Glyph'),
    stairsUp: z.string().length(1).describe('Stairs Up Glyph')
  }),
  ui: z.object({
    displayWidth: z.number().int().positive().describe('Display Width (Tiles)'),
    displayHeight: z.number().int().positive().describe('Display Height (Tiles)'),
    fontSize: z.number().int().positive().describe('Font Size (px)'),
    fontFamily: z.string().describe('Font Family')
  })
});
export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;

// ==========================================
// 4. ITEMS
// ==========================================
export const ItemCategoryEnum = z.enum(['consumable', 'weapon', 'armor', 'tool']);
export const EquipmentSlotEnum = z.enum(['head', 'neck', 'torso', 'back', 'arm', 'hand', 'finger', 'leg', 'foot']);
export type EquipmentSlot = z.infer<typeof EquipmentSlotEnum>;

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
export type ItemDefinition = z.infer<typeof ItemDefinitionSchema>;

// ==========================================
// 5. EFFECTS (Item Effects)
// ==========================================
export const FactionRelationEnum = z.enum(['hostile', 'neutral', 'friendly']);

export const ItemEffectTypeEnum = z.enum([
  'heal',
  'damage',
  'damage_nearest',
  'damage_area',
  'apply_status',
  'identify',
  'satiate'
]);

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
export type ItemEffectDefinition = z.infer<typeof ItemEffectDefinitionSchema>;

export const KnowledgeItemSchema = z.object({
  id: z.string(),
  type: z.enum(['rumor', 'location', 'weakness', 'secret']),
  description: z.string(),
  tags: z.array(z.string()).default([])
});
export type KnowledgeItemType = z.infer<typeof KnowledgeItemSchema>;

export const KnowledgePropagationRuleSchema = z.object({
  id: z.string(),
  /** The GameEventType string this rule listens to. */
  eventType: z.string(),
  /** Tags an NPC entity must have (on TagsComponent) to receive this knowledge. Empty = all NPCs with Memory. */
  eligibleTags: z.array(z.string()).default([]),
  /** Faction IDs that make an NPC eligible. Empty = any faction. */
  eligibleFactions: z.array(z.string()).default([]),
  /** If true, only NPCs in the same area or a connected area receive the knowledge. */
  requireAreaProximity: z.boolean().default(true),
  /** Delay in game ticks before the knowledge becomes available. */
  delay: z.number().int().nonnegative().default(50),
  /** The knowledge item template to create. The `id` can use `{eventId}` or other placeholders. */
  knowledgeTemplate: KnowledgeItemSchema
});
export type KnowledgePropagationRule = z.infer<typeof KnowledgePropagationRuleSchema>;

export const RumorItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  sourceEventId: z.string().optional(),
  turnCreated: z.number().int().nonnegative(),
  persistent: z.boolean().optional()
});
export type RumorItemData = z.infer<typeof RumorItemSchema>;

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
export type RumorPropagationRule = z.infer<typeof RumorPropagationRuleSchema>;

// ==========================================
// 6. ENTITIES
// ==========================================
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
export type EntityTemplate = z.infer<typeof EntityTemplateSchema>;

// ==========================================
// 7. STATUS EFFECTS
// ==========================================
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
export type StatusEffectDefinition = z.infer<typeof StatusEffectDefinitionSchema>;

// ==========================================
// 8. TILES
// ==========================================
export const TileDefinitionSchema = z.object({
  walkable: z.boolean(),
  transparent: z.boolean(),
  glyph: z.string().length(1),
  fg: z.string(),
  bg: z.string(),
  movementCost: z.number().int().positive().optional(),
  bumpTransition: z.string().optional(),
  interactTransition: z.string().optional(),
  interactMessage: z.string().optional(),
  tags: z.array(z.string()).optional()
});
export type TileDefinition = z.infer<typeof TileDefinitionSchema>;

// ==========================================
// 9. FACTIONS
// ==========================================
export const FactionMatrixSchema = z.record(z.string(), z.record(z.string(), FactionRelationEnum));
export type FactionMatrix = z.infer<typeof FactionMatrixSchema>;

// ==========================================
// 10. AI PROFILES
// ==========================================
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

export const AIProfileSchema = z.object({
  id: z.string(),
  behaviors: z.array(AIBehaviorEntrySchema),
  barks: z.record(z.string(), z.array(z.string())).optional()
});
export type AIProfile = z.infer<typeof AIProfileSchema>;

// ==========================================
// 11. AREAS & WORLD MAP
// ==========================================
export const AreaGeneratorTypeEnum = z.enum(['digger', 'cellular', 'static']);
export type AreaGeneratorType = z.infer<typeof AreaGeneratorTypeEnum>;

export const AreaConnectionSchema = z.object({
  targetAreaId: z.string(),
  targetX: z.number().int().nonnegative().optional(),
  targetY: z.number().int().nonnegative().optional(),
  placementX: z.number().int().nonnegative().optional(),
  placementY: z.number().int().nonnegative().optional(),
  direction: z.enum(['up', 'down', 'edge', 'portal']),
  portalTemplateId: z.string().optional(),
  placementSide: z.enum(['top', 'bottom', 'left', 'right', 'any']).optional()
});
export type AreaConnection = z.infer<typeof AreaConnectionSchema>;

export const StaticMapLayoutSchema = z.object({
  layout: z.array(z.string()),
  legend: z.record(z.string(), z.string()),
  entityLegend: z.record(z.string(), z.string()).optional()
});

export const AreaDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  generatorType: AreaGeneratorTypeEnum,
  dangerRating: z.number().int().nonnegative(),
  tags: z.array(z.string()).optional(),
  connections: z.array(AreaConnectionSchema).optional(),
  staticMap: StaticMapLayoutSchema.optional(),
  placedEntities: z
    .array(
      z.object({
        templateId: z.string(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        inventory: z.array(z.string()).optional()
      })
    )
    .optional(),
  proceduralPalette: z
    .object({
      floor: z.string().describe('Floor Tile ID'),
      wall: z.string().describe('Wall Tile ID'),
      door: z.string().describe('Door Entity ID'),
      water: z.string().describe('Liquid/Water Tile ID')
    })
    .optional()
    .describe('Procedural Generator Biome Palette'),
  crBudget: z.number().int().nonnegative().optional(),
  encounterProfileId: z.string().optional(),
  directorTags: z.array(z.string()).optional(),
  budgetScaling: z.object({ baseBudget: z.number(), scalingFactor: z.number() }).optional(),
  subBiomes: z
    .record(z.string(), z.number().positive().max(1))
    .optional()
    .describe('Map of sub-biome tag to probability (0-1) for room assignment')
});
export type AreaDefinition = z.infer<typeof AreaDefinitionSchema>;

// ==========================================
// 12. ADVERSARIAL LAYER (SCHEMES)
// ==========================================
export const LeverageTypeEnum = z.enum(['money', 'ideology', 'coercion', 'ego']);
export type LeverageType = z.infer<typeof LeverageTypeEnum>;

export const AgreementDefinitionSchema = z.object({
  id: z.string(),
  task: z.string(),
  incriminatingWeight: z.number().int().positive(),
  clueTemplates: z.array(z.string())
});
export type AgreementDefinition = z.infer<typeof AgreementDefinitionSchema>;

export const VillainArchetypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  goals: z.array(z.string()),
  recruitmentPreferences: z.object({
    targetTags: z.array(z.string()),
    leverageWeight: z.record(LeverageTypeEnum, z.number())
  })
});
export type VillainArchetype = z.infer<typeof VillainArchetypeSchema>;

export const SchemePhaseMutationSchema = z.object({
  targetAreaId: z.string(),
  addedTags: z.array(z.string()).optional(),
  budgetModifier: z.number().int().optional(),
  encounterProfileId: z.string().optional(),
  subBiomes: z.record(z.string(), z.number().positive().max(1)).optional()
});
export type SchemePhaseMutation = z.infer<typeof SchemePhaseMutationSchema>;

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
export type SchemeTemplate = z.infer<typeof SchemeTemplateSchema>;

// ==========================================
// 13. FIELDS
// ==========================================
export const FieldDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  glyph: z.string().length(1),
  fg: z.string(),
  bg: z.string(),
  blocksSight: z.boolean().default(false),
  damagePerTurn: z.number().int().nonnegative().optional(),
  statusEffectId: z.string().optional()
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

// ==========================================
// THE MEGA CAMPAIGN DATA SCHEMA
// ==========================================
// ==========================================
// TAGS & REACTIONS (Phase 2)
// ==========================================
export const TagDefinitionSchema = z.object({
  category: z.string(),
  color: z.string(),
  description: z.string()
});
export type TagDefinition = z.infer<typeof TagDefinitionSchema>;

export const ReactionEntityMatcherSchema = z.object({
  targetType: z.literal('entity'),
  tags: z.array(z.string()).optional(),
  traits: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(), // e.g., 'consumable', 'weapon'
  entityId: z.string().optional()
});

export const ReactionTileMatcherSchema = z.object({
  targetType: z.literal('tile'),
  tags: z.array(z.string()).optional(),
  tileId: z.string().optional(),
  fieldTypes: z.array(z.string()).optional()
});

export const ReactionTargetMatcherSchema = z.discriminatedUnion('targetType', [
  ReactionEntityMatcherSchema,
  ReactionTileMatcherSchema
]);

export const ReactionContextMatcherSchema = z.object({
  factionStanding: z
    .object({
      factionId: z.string(),
      min: z.number().int().optional(),
      max: z.number().int().optional()
    })
    .optional()
});

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
export type ReactionDefinition = z.infer<typeof ReactionDefinitionSchema>;

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

export type ProceduralQuestTemplate = z.infer<typeof ProceduralQuestTemplateSchema>;

// ==========================================
// ENCOUNTER DIRECTOR (Phase 3)
// ==========================================
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
export type SpawnPoolDefinition = z.infer<typeof SpawnPoolDefinitionSchema>;

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
export type EncounterProfile = z.infer<typeof EncounterProfileSchema>;

export const TraitDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  crCostModifier: z.number().optional(),
  crCostMultiplier: z.number().optional(),
  statModifiers: z.record(z.string(), z.number()).optional(),
  tagsAdded: z.array(z.string()).optional()
});
export type TraitDefinition = z.infer<typeof TraitDefinitionSchema>;

// ==========================================
// 15. IDENTITY & CHRONICLE
// ==========================================
export const IdentityGenerationTableSchema = z.object({
  firstNames: z.array(z.string()),
  lastNames: z.array(z.string()).optional(),
  titles: z.array(z.string()),
  mannerisms: z.array(z.string()),
  colors: z.array(z.string()).optional()
});
export type IdentityGenerationTable = z.infer<typeof IdentityGenerationTableSchema>;

export const PersonalityGenerationTableSchema = z.object({
  facets: z.array(z.string()).describe('List of personality facets to generate (e.g., cowardice, cruelty)'),
  values: z.array(z.string()).describe('List of personality values to generate (e.g., power, peace)'),
  leverageMappings: z
    .record(LeverageTypeEnum, z.array(z.string()))
    .optional()
    .describe('Maps MICE leverages to the facets that multiply their effectiveness.')
});
export type PersonalityGenerationTable = z.infer<typeof PersonalityGenerationTableSchema>;

// ==========================================
// 16. NEMESIS HIERARCHIES
// ==========================================
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
export type HierarchyRank = z.infer<typeof HierarchyRankSchema>;

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
export type ScarDefinition = z.infer<typeof ScarDefinitionSchema>;

export const NemesisHierarchySchema = z.object({
  id: z.string(),
  factionId: z.string(),
  ranks: z.array(HierarchyRankSchema),
  promotionSources: z.array(z.string()).default([]),
  scarPool: z.array(ScarDefinitionSchema).default([])
});
export type NemesisHierarchy = z.infer<typeof NemesisHierarchySchema>;

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
  triggerBuckets: z.record(z.string(), z.array(TriggerDefinitionSchema)).optional(),
  villains: z.record(z.string(), VillainArchetypeSchema),
  schemes: z.record(z.string(), SchemeTemplateSchema),
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
  rumorPropagation: z.array(RumorPropagationRuleSchema).default([])
});
export type CampaignData = z.infer<typeof CampaignDataSchema>;

// Helper registry for editor to resolve specific schemas by category key
export const CampaignCategorySchemas: Record<keyof CampaignData, z.ZodTypeAny> = {
  manifest: CampaignManifestSchema,
  rules: RulesConfigSchema,
  theme: ThemeConfigSchema,
  advancement: AdvancementLevelSchema.array(),
  areas: AreaDefinitionSchema,
  items: ItemDefinitionSchema,
  effects: ItemEffectDefinitionSchema,
  entities: EntityTemplateSchema,
  status: StatusEffectDefinitionSchema,
  tiles: TileDefinitionSchema,
  factions: FactionMatrixSchema,
  ai: AIProfileSchema,
  dialogues: DialogueTreeSchema,
  quests: QuestSchema,
  questTemplates: ProceduralQuestTemplateSchema,
  triggers: TriggerDefinitionSchema,
  triggerBuckets: z.array(TriggerDefinitionSchema),
  villains: VillainArchetypeSchema,
  schemes: SchemeTemplateSchema,
  agreements: AgreementDefinitionSchema,
  tagRegistry: TagDefinitionSchema,
  reactions: ReactionDefinitionSchema,
  fields: FieldDefinitionSchema,
  spawnPools: SpawnPoolDefinitionSchema,
  encounterProfiles: EncounterProfileSchema,
  traitRegistry: TraitDefinitionSchema,
  identityGeneration: IdentityGenerationTableSchema,
  personalityGeneration: PersonalityGenerationTableSchema,
  nemesisHierarchies: NemesisHierarchySchema,
  knowledgePropagation: KnowledgePropagationRuleSchema.array(),
  rumorPropagation: RumorPropagationRuleSchema.array()
};
