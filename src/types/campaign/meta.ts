import { z } from 'zod';
import { RulesetIdSchema } from '../ruleset.types.ts';
import { AreaIlluminationEnum } from './world.ts';

/** Zod schema for the campaign manifest. */
export const CampaignManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string(),
  version: z.string(),
  author: z.string().default('Unknown'),
  tags: z.array(z.string()).default([]),
  schemaVersion: z.number().int().nonnegative().default(0),
  rulesetId: RulesetIdSchema.default('classic')
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
  author: z.string().default('Unknown'),
  rulesetId: RulesetIdSchema.default('classic')
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

/** Zod schema for a single diurnal phase in `rules.worldClock`. */
export const DayPhaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  startHour: z.number().int().min(0).max(23),
  skyIllumination: AreaIlluminationEnum,
  isNaturalSunlight: z.boolean()
});
/** Inferred type for a diurnal clock phase entry. */
export type DayPhaseConfig = z.infer<typeof DayPhaseSchema>;

/** Zod schema for campaign-wide diurnal clock and time-wait configuration. */
export const WorldClockConfigSchema = z.object({
  secondsPerGlobalTurn: z.number().int().positive().default(6),
  startHour: z.number().int().min(0).max(23).default(8),
  hoursPerDay: z.number().int().positive().default(24),
  waitTargets: z.array(z.string()).default(['dawn', 'night']),
  phases: z.array(DayPhaseSchema).min(1)
});
/** Inferred type for campaign World Clock configuration. */
export type WorldClockConfig = z.infer<typeof WorldClockConfigSchema>;

/** Zod schema for a single monetary denomination (e.g. copper, silver, gold, platinum). */
export const CurrencyDenominationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  abbreviation: z.string().min(1),
  baseMultiplier: z.number().int().positive(),
  color: z.string().optional(),
  itemId: z.string().optional()
});
/** Inferred type for a single currency denomination. */
export type CurrencyDenomination = z.infer<typeof CurrencyDenominationSchema>;

/** Zod schema for campaign-wide base-unit multi-denomination currency configuration. */
export const CurrencyConfigSchema = z.object({
  baseUnitId: z.string().min(1),
  defaultValueDenominationId: z.string().min(1).optional(),
  denominations: z.array(CurrencyDenominationSchema).min(1),
  displayOrder: z.array(z.string()).optional()
});
/** Inferred type for currency configuration. */
export type CurrencyConfig = z.infer<typeof CurrencyConfigSchema>;

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
    satiationLossPerStandardTurn: z.number().nonnegative().optional(),
    thresholds: z.object({
      satiated: z.number().int().nonnegative(),
      normal: z.number().int().nonnegative(),
      hungry: z.number().int().nonnegative(),
      starving: z.number().int().nonnegative()
    })
  }),
  worldClock: WorldClockConfigSchema.optional(),
  currency: CurrencyConfigSchema.optional(),
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

/** Zod schema for a single spritesheet source definition. */
export const SpriteSheetSourceSchema = z.object({
  src: z.string().describe('Relative path to the spritesheet image'),
  srcBasePath: z
    .string()
    .optional()
    .describe('Runtime-resolved base URL or disk subpath when hydrated from a shared sprite pack'),
  tileWidth: z.number().int().positive().describe('Width of each sprite cell in pixels'),
  tileHeight: z.number().int().positive().describe('Height of each sprite cell in pixels'),
  tileMap: z
    .record(
      z.string(),
      z.union([
        z.tuple([z.number(), z.number()]),
        z.object({
          default: z.tuple([z.number(), z.number()]),
          commonAlts: z.array(z.tuple([z.number(), z.number()])).optional(),
          rareAlts: z.array(z.tuple([z.number(), z.number()])).optional()
        })
      ])
    )
    .describe('Maps spriteId strings to pixel offsets or variant objects')
});
/** Inferred type for a spritesheet source configuration. */
export type SpriteSheetSource = z.infer<typeof SpriteSheetSourceSchema>;

/** Zod schema describing creator, license, and credit metadata for a shared sprite pack. */
export const SpritePackAttributionSchema = z.object({
  author: z.string().min(1).describe('Creator or collective project name'),
  license: z.string().min(1).describe('Short license label (e.g., CC0-1.0, Custom Free-Use)'),
  licenseUrl: z.string().optional().describe('Optional reference URL for full license text'),
  sourceUrl: z.string().optional().describe('Optional upstream project URL'),
  restrictions: z.array(z.string()).optional().describe('Explicit usage restrictions or terms'),
  notes: z.string().optional().describe('Additional attribution or distribution context'),
  contributors: z.array(z.string()).optional().describe('Optional individual contributor list')
});
/** Inferred type for sprite pack attribution metadata. */
export type SpritePackAttribution = z.infer<typeof SpritePackAttributionSchema>;

/** Zod schema for a shared sprite pack bundle definition (`public/data/sprite_packs/<id>/pack.json`). */
export const SpritePackSchema = z.object({
  id: z.string().min(1).describe('Unique Sprite Pack Identifier'),
  name: z.string().min(1).describe('Human-readable Sprite Pack Name'),
  description: z.string().optional().describe('Optional Sprite Pack Description'),
  attribution: SpritePackAttributionSchema.optional().describe('Creator, license, and attribution details'),
  spriteSheets: z.record(z.string(), SpriteSheetSourceSchema)
});
/** Inferred type for a shared sprite pack bundle. */
export type SpritePack = z.infer<typeof SpritePackSchema>;

/** Zod schema for one discoverable entry in `public/data/sprite_packs/catalog.json`. */
export const SpritePackCatalogEntrySchema = z.object({
  id: z.string().min(1).describe('Unique Sprite Pack Identifier matching pack directory'),
  name: z.string().min(1).describe('Human-readable label shown in Settings'),
  description: z.string().optional().describe('Short summary shown in Settings'),
  selectableInSettings: z.boolean().default(true).describe('Whether players can choose this pack in Settings'),
  defaultIncludeSheets: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('Optional default sheet subset when this pack is selected in Settings without a campaign ref'),
  fallbackPackIds: z
    .array(z.string().min(1))
    .optional()
    .describe('Fallback pack IDs layered underneath when the player selects this pack'),
  attribution: SpritePackAttributionSchema.optional().describe('License and creator attribution metadata')
});
/** Inferred type for a sprite pack catalog entry. */
export type SpritePackCatalogEntry = z.infer<typeof SpritePackCatalogEntrySchema>;

/** Zod schema for the central shared sprite pack catalog (`public/data/sprite_packs/catalog.json`). */
export const SpritePackCatalogSchema = z.object({
  packs: z.array(SpritePackCatalogEntrySchema)
});
/** Inferred type for the sprite pack catalog. */
export type SpritePackCatalog = z.infer<typeof SpritePackCatalogSchema>;

/** Zod schema for referencing a shared sprite pack (whole bundle ID or selective sheet cherry-pick). */
export const SpritePackRefSchema = z.union([
  z.string().min(1),
  z.object({
    packId: z.string().min(1).describe('Target Sprite Pack Identifier'),
    includeSheets: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe('Optional subset of sheet keys to import from this pack')
  })
]);
/** Inferred type for a campaign sprite pack reference. */
export type SpritePackRef = z.infer<typeof SpritePackRefSchema>;

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
  }),
  spritePacks: z
    .array(SpritePackRefSchema)
    .optional()
    .describe('Ordered list of shared sprite pack references merged left-to-right under campaign overrides'),
  spriteSheets: z.record(z.string(), SpriteSheetSourceSchema).optional(),
  loadedSpritePacks: z
    .record(z.string(), SpritePackSchema)
    .optional()
    .describe('Transient hydrated shared sprite packs keyed by pack ID (omitted on export)')
});
/** Inferred type for theme configuration properties. */
export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;
