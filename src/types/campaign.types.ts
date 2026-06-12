import { z } from 'zod';

// ==========================================
// 1. MANIFEST & REGISTRY
// ==========================================
export const CampaignManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string(),
  version: z.string()
});
export type CampaignManifest = z.infer<typeof CampaignManifestSchema>;

export const CampaignRegistryEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  mapSize: z.string(),
  startingAreaId: z.string()
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
  colors: z.record(z.string(), z.string()),
  glyphs: z.record(z.string(), z.string()),
  ui: z.object({
    displayWidth: z.number().int().positive(),
    displayHeight: z.number().int().positive(),
    fontSize: z.number().int().positive(),
    fontFamily: z.string()
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
      grudges: z.array(z.string()).optional()
    })
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
export const FactionRelationEnum = z.enum(['hostile', 'neutral', 'friendly']);
export const FactionMatrixSchema = z.record(z.string(), z.record(z.string(), FactionRelationEnum));
export type FactionMatrix = z.infer<typeof FactionMatrixSchema>;

// ==========================================
// 10. AI PROFILES
// ==========================================
export const AIBehaviorEntrySchema = z.object({
  behaviorId: z.string(),
  params: z.record(z.string(), z.unknown())
});

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
  direction: z.enum(['up', 'down', 'edge', 'portal'])
});
export type AreaConnection = z.infer<typeof AreaConnectionSchema>;

export const StaticMapLayoutSchema = z.object({
  layout: z.array(z.string()),
  legend: z.record(z.string(), z.string())
});

export const AreaDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  generatorType: AreaGeneratorTypeEnum,
  dangerRating: z.number().int().nonnegative(),
  tags: z.array(z.string()).optional(),
  connections: z.array(AreaConnectionSchema).optional(),
  staticMap: StaticMapLayoutSchema.optional()
});
export type AreaDefinition = z.infer<typeof AreaDefinitionSchema>;

// ==========================================
// THE MEGA CAMPAIGN DATA SCHEMA
// ==========================================
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
  ai: z.record(z.string(), AIProfileSchema)
});
export type CampaignData = z.infer<typeof CampaignDataSchema>;
