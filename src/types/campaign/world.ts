import { z } from 'zod';

/** Zod enum for faction stances. */
export const FactionRelationEnum = z.enum(['hostile', 'neutral', 'friendly']);
/** Inferred type representing a faction stance. */
export type FactionRelation = z.infer<typeof FactionRelationEnum>;

/** Zod schema defining structural map tiles. */
export const TileDefinitionSchema = z.object({
  walkable: z.boolean(),
  transparent: z.boolean(),
  glyph: z.string().length(1),
  fg: z.string(),
  bg: z.string(),
  spriteId: z.string().optional(),
  movementCost: z.number().int().positive().optional(),
  bumpTransition: z.string().optional(),
  interactTransition: z.string().optional(),
  interactMessage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  traversableBy: z.array(z.enum(['fly', 'swim', 'burrow', 'climb'])).optional(),
  isSolidObstacle: z.boolean().optional(),
  hazardKind: z.string().optional(),
  blocksCharge: z.boolean().optional(),
  soundAttenuation: z.number().nonnegative().optional()
});
/** Inferred type for a tile definition. */
export type TileDefinition = z.infer<typeof TileDefinitionSchema>;

/** Zod schema representing relations between factions. */
export const FactionMatrixSchema = z.record(z.string(), z.record(z.string(), FactionRelationEnum));
/** Inferred type for the faction matrix registry. */
export type FactionMatrix = z.infer<typeof FactionMatrixSchema>;

/** Zod enum for physical area enclosure / setting classification. */
export const AreaEnvironmentTypeEnum = z.enum(['outdoors', 'indoors', 'underground']);
/** Inferred type for an area's physical environment classification. */
export type AreaEnvironmentType = z.infer<typeof AreaEnvironmentTypeEnum>;

/** Zod enum for baseline area ambient illumination levels. */
export const AreaIlluminationEnum = z.enum(['bright', 'shadowy', 'darkness']);
/** Inferred type for baseline area illumination level. */
export type AreaIllumination = z.infer<typeof AreaIlluminationEnum>;

/** Zod enum for generation strategies. */
export const AreaGeneratorTypeEnum = z.enum(['digger', 'cellular', 'static', 'dla']);
/** Inferred type representing an area generator type. */
export type AreaGeneratorType = z.infer<typeof AreaGeneratorTypeEnum>;

/** Zod schema defining a Voronoi sub-biome rule. */
export const VoronoiSubBiomeRuleSchema = z.object({
  tag: z.string(),
  seedPoints: z.number().int().positive().default(1)
});
/** Inferred type representing a Voronoi sub-biome rule. */
export type VoronoiSubBiomeRule = z.infer<typeof VoronoiSubBiomeRuleSchema>;

/** Zod schema representing connections between different area maps. */
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
/** Inferred type for an area connection definition. */
export type AreaConnection = z.infer<typeof AreaConnectionSchema>;

/** Zod schema outlining the layout, legend, and entities of a static map. */
export const StaticMapLayoutSchema = z.object({
  layout: z.array(z.string()),
  legend: z.record(z.string(), z.string()),
  entityLegend: z.record(z.string(), z.string()).optional()
});
/** Inferred type for a static map layout. */
export type StaticMapLayout = z.infer<typeof StaticMapLayoutSchema>;

const RestPressureFields = {
  safeRest: z.boolean(),
  ambushChancePerWatch: z.number().min(0).max(1),
  watchDurationHours: z.number().int().positive(),
  schemeTickMultiplier: z.number().min(0),
  respawnRateMultiplier: z.number().min(0),
  alarmDecayTurns: z.number().int().nonnegative()
};

/** Zod schema for campaign-default rest pressure ("Doom Clock") configuration. */
export const RestPressureConfigSchema = z.object({
  safeRest: RestPressureFields.safeRest.default(false),
  ambushChancePerWatch: RestPressureFields.ambushChancePerWatch.default(0.15),
  watchDurationHours: RestPressureFields.watchDurationHours.default(2),
  schemeTickMultiplier: RestPressureFields.schemeTickMultiplier.default(1),
  respawnRateMultiplier: RestPressureFields.respawnRateMultiplier.default(1),
  alarmDecayTurns: RestPressureFields.alarmDecayTurns.default(50)
});
/** Inferred type for per-area or campaign-level rest pressure configuration. */
export type RestPressureConfig = z.infer<typeof RestPressureConfigSchema>;

/** Zod schema for partial per-area rest pressure overrides (preserving omitted fields for campaign inheritance). */
export const RestPressureOverrideSchema = z.object(RestPressureFields).partial();
/** Inferred type for partial per-area rest pressure overrides. */
export type RestPressureOverride = z.infer<typeof RestPressureOverrideSchema>;

/** Zod schema outlining an area definition config. */
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
    .describe('Map of sub-biome tag to probability (0-1) for room assignment'),
  voronoiSubBiomes: z.array(VoronoiSubBiomeRuleSchema).optional(),
  dlaTargetFloorPercentage: z
    .number()
    .positive()
    .max(1)
    .optional()
    .describe('Percentage (0-1) of map tiles to carve as floor for DLA.'),
  respawnTimerTurns: z.number().int().positive().optional(),
  respawnEscalationPerCycle: z
    .number()
    .nonnegative()
    .optional()
    .describe('Additional CR budget added per elapsed respawnTimerTurns cycle.'),
  maxRespawnEscalation: z
    .number()
    .nonnegative()
    .optional()
    .describe('Maximum cumulative CR budget escalation added by elapsed respawn cycles.'),
  environmentType: AreaEnvironmentTypeEnum.optional().describe(
    'Physical setting (outdoors follows day/night clock; indoors defaults bright; underground defaults darkness).'
  ),
  ambientIllumination: AreaIlluminationEnum.optional().describe(
    'Explicit baseline illumination override for indoors or underground areas.'
  ),
  hotPathRadius: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Overrides the auto-calculated hot path thickness.'),
  restPressure: RestPressureOverrideSchema.optional().describe(
    'Per-area override for camp rest ambush risk, watch duration, scheme acceleration, and respawn scaling.'
  )
});
/** Inferred type for an area definition. */
export type AreaDefinition = z.infer<typeof AreaDefinitionSchema>;

/** Zod schema for persistent area field definitions. */
export const FieldDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  glyph: z.string().length(1),
  fg: z.string(),
  bg: z.string(),
  spriteId: z.string().optional(),
  blocksSight: z.boolean().default(false),
  damagePerTurn: z.number().int().nonnegative().optional(),
  statusEffectId: z.string().optional(),
  tags: z.array(z.string()).optional()
});
/** Inferred type for an area field definition. */
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

/** Zod enum for Tier 1 crossing surface types. */
export const CrossingKindEnum = z.enum(['bridge', 'rope_line', 'ladder_span', 'frozen_surface']);

/** Zod schema for a declarative tag-driven field chemistry / transmutation rule. */
export const FieldInteractionRuleSchema = z.object({
  id: z.string(),
  incomingTags: z.array(z.string()).min(1),
  targetTags: z.array(z.string()).min(1),
  spawnFieldType: z.string().optional(),
  spawnFieldDuration: z.number().int().positive().optional(),
  spawnFieldIntensity: z.number().int().positive().optional(),
  spawnCrossingKind: CrossingKindEnum.optional(),
  spawnCrossingDuration: z.number().int().positive().optional(),
  extinguishTarget: z.boolean().optional(),
  chainSpreadOrthogonal: z.boolean().optional(),
  shockDamageDice: z.string().optional(),
  message: z.string().optional()
});
/** Inferred type for a declarative field interaction rule. */
export type FieldInteractionRule = z.infer<typeof FieldInteractionRuleSchema>;

/** Zod schema for global narrative world events pools. */
export const WorldEventsConfigSchema = z.object({
  areaEvents: z.array(z.string()).default([]),
  factionEvents: z.array(z.string()).default([])
});
/** Inferred type for world events configuration. */
export type WorldEventsConfig = z.infer<typeof WorldEventsConfigSchema>;
