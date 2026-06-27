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
  movementCost: z.number().int().positive().optional(),
  bumpTransition: z.string().optional(),
  interactTransition: z.string().optional(),
  interactMessage: z.string().optional(),
  tags: z.array(z.string()).optional()
});
/** Inferred type for a tile definition. */
export type TileDefinition = z.infer<typeof TileDefinitionSchema>;

/** Zod schema representing relations between factions. */
export const FactionMatrixSchema = z.record(z.string(), z.record(z.string(), FactionRelationEnum));
/** Inferred type for the faction matrix registry. */
export type FactionMatrix = z.infer<typeof FactionMatrixSchema>;

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
  hotPathRadius: z.number().int().nonnegative().optional().describe('Overrides the auto-calculated hot path thickness.')
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
  blocksSight: z.boolean().default(false),
  damagePerTurn: z.number().int().nonnegative().optional(),
  statusEffectId: z.string().optional()
});
/** Inferred type for an area field definition. */
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

/** Zod schema for global narrative world events pools. */
export const WorldEventsConfigSchema = z.object({
  areaEvents: z.array(z.string()).default([]),
  factionEvents: z.array(z.string()).default([])
});
/** Inferred type for world events configuration. */
export type WorldEventsConfig = z.infer<typeof WorldEventsConfigSchema>;
