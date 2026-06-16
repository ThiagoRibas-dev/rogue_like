import { z } from 'zod';
import { DialogueTreeSchema } from './dialogue.types.ts';

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
    lootTable: z.record(z.string(), z.number().int().nonnegative())
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
export const ItemCategoryEnum = z.enum(['consumable', 'weapon', 'armor']);
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
    .optional()
});
export type ItemDefinition = z.infer<typeof ItemDefinitionSchema>;

// ==========================================
// 5. EFFECTS (Item Effects)
// ==========================================
export const ItemEffectTypeEnum = z.enum([
  'heal',
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
  tags: z.array(z.string()).optional()
});
export type ItemEffectDefinition = z.infer<typeof ItemEffectDefinitionSchema>;

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
      grudges: z.array(z.string()).optional()
    })
    .optional(),
  dialogueId: z.string().optional(),
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
  renderable: z.boolean().optional()
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
export const FactionRelationEnum = z.enum(['hostile', 'neutral', 'friendly']);
export const FactionMatrixSchema = z.record(z.string(), z.record(z.string(), FactionRelationEnum));
export type FactionMatrix = z.infer<typeof FactionMatrixSchema>;

// ==========================================
// 10. AI PROFILES
// ==========================================
export const AIBehaviorEntrySchema = z.discriminatedUnion('behaviorId', [
  z.object({ behaviorId: z.literal('hunt'), aggroRadius: z.number().int().positive().optional() }),
  z.object({ behaviorId: z.literal('flee'), hpThreshold: z.number().optional() }),
  z.object({ behaviorId: z.literal('ranged'), spellId: z.string() }),
  z.object({ behaviorId: z.literal('wander') })
]);

export const AIProfileSchema = z.object({
  id: z.string(),
  behaviors: z.array(AIBehaviorEntrySchema)
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
  direction: z.enum(['up', 'down', 'edge', 'portal'])
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
        y: z.number().int().nonnegative()
      })
    )
    .optional(),
  proceduralPalette: z
    .object({
      floor: z.string().describe('Floor Tile ID'),
      wall: z.string().describe('Wall Tile ID'),
      door: z.string().describe('Door Tile ID'),
      water: z.string().describe('Liquid/Water Tile ID')
    })
    .optional()
    .describe('Procedural Generator Biome Palette')
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

export const SchemeTemplateSchema = z.object({
  id: z.string(),
  villainArchetypeId: z.string(),
  phases: z.array(
    z.object({
      requiredAgreements: z.number().int().nonnegative(),
      missionIntents: z.array(z.string())
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
  fields: z.record(z.string(), FieldDefinitionSchema).default({})
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
  fields: FieldDefinitionSchema
};
