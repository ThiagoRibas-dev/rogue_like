import { z } from 'zod';

/** Zod schema for the campaign manifest. */
export const CampaignManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string(),
  version: z.string(),
  author: z.string().default('Unknown'),
  tags: z.array(z.string()).default([]),
  schemaVersion: z.number().int().nonnegative().default(0)
});
/** Inferred type for the campaign manifest. */
export type CampaignManifest = z.infer<typeof CampaignManifestSchema>;

/** Zod schema for campaign registry entry metadata. */
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
/** Inferred type for a campaign registry entry. */
export type CampaignRegistryEntry = z.infer<typeof CampaignRegistryEntrySchema>;

/** Zod schema for the campaign registry. */
export const CampaignRegistrySchema = z.object({
  campaigns: z.array(CampaignRegistryEntrySchema)
});
/** Inferred type for the campaign registry. */
export type CampaignRegistry = z.infer<typeof CampaignRegistrySchema>;

/** Zod schema for level advancement thresholds and stat upgrades. */
export const AdvancementLevelSchema = z.object({
  level: z.number().int().positive(),
  requiredXp: z.number().int().nonnegative(),
  hpGain: z.number().int().nonnegative(),
  attackGain: z.number().int().nonnegative(),
  defenseGain: z.number().int().nonnegative()
});
/** Inferred type for level advancement requirements. */
export type AdvancementLevel = z.infer<typeof AdvancementLevelSchema>;

/** Zod schema for campaign engine configuration rules. */
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
/** Inferred type for rules configuration parameters. */
export type RulesConfig = z.infer<typeof RulesConfigSchema>;

/** Zod schema for theme and display graphics configuration. */
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
/** Inferred type for theme configuration properties. */
export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;
