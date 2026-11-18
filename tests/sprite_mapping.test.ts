import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SpritePackCatalogSchema,
  type CampaignData,
  type SpritePack,
  type ThemeConfig
} from '../src/types/campaign.types.ts';
import { loadCampaignFromDisk } from './helpers.ts';
import { campaignUsesSprites, collectMissingSpriteMappings, findSpriteProblem } from '../src/rendering/sprite_keys.ts';
import { resolvePlaybackThemeConfig } from '../src/rendering/procedural_sprites.ts';
import { getSettings } from '../src/core/settings.ts';
import { validateCampaign } from '../src/editor/campaign_validator.ts';
import {
  DEFAULT_PREFERRED_SPRITE_PACK,
  SPRITE_PACKS_CATALOG_FILENAME,
  SPRITE_PACKS_DATA_SUBPATH,
  attachLoadedSpritePacks,
  resolveEffectiveThemeWithPreference,
  resolveThemeSpriteSheets,
  stripTransientThemeHydration
} from '../src/utils/sprite_pack.ts';

for (const id of ['default', 'dnd35e-crypt', 'realms-of-shroudgarde']) {
  test(
    `sprite campaign (${id}): every tile/entity/item/field resolves a sprite and resolved spritesheet PNGs exist on disk`,
    () => {
      const campaign = loadCampaignFromDisk(id);
      expect(campaign.theme.spritePacks).toEqual([
        {
          packId: 'dcss',
          includeSheets: ['dungeon', 'monsters', 'items', 'actors', 'effects', 'spells', 'misc']
        },
        '32rogues'
      ]);
      expect(campaign.theme.spriteSheets).toBeUndefined();
      expect(campaignUsesSprites(campaign)).toBe(true);
      expect(collectMissingSpriteMappings(campaign)).toEqual([]);

      // Also verify standalone DCSS without 32rogues fallback covers 100% of campaign spriteIds
      const dcssOnlyCampaign: CampaignData = {
        ...campaign,
        theme: {
          ...campaign.theme,
          spritePacks: [{ packId: 'dcss', includeSheets: ['dungeon', 'monsters', 'items', 'actors', 'effects', 'spells', 'misc'] }]
        }
      };
      expect(collectMissingSpriteMappings(dcssOnlyCampaign)).toEqual([]);

      const campaignDir = join(process.cwd(), 'public', 'data', 'campaigns', id);
      const resolvedSheets = resolveThemeSpriteSheets(campaign.theme);
      expect(resolvedSheets).toBeDefined();
      for (const sheet of Object.values(resolvedSheets ?? {})) {
        const assetPath =
          sheet.srcBasePath !== undefined
            ? join(process.cwd(), 'public', sheet.srcBasePath.replace(/^\/+/, ''), sheet.src)
            : join(campaignDir, sheet.src);
        expect(existsSync(assetPath)).toBe(true);
      }
    },
    15_000
  );
}

test('ASCII campaigns report no sprite issues', () => {
  for (const id of ['megacampaign', 'shroudgarde']) {
    const campaign = loadCampaignFromDisk(id);
    expect(campaignUsesSprites(campaign)).toBe(false);
    expect(collectMissingSpriteMappings(campaign)).toEqual([]);
  }
});

test('findSpriteProblem distinguishes missing vs unresolved vs valid', () => {
  const available = new Set(['tile_ok']);
  expect(findSpriteProblem('tile', 'a', undefined, available)).toEqual({ kind: 'tile', id: 'a', reason: 'no-spriteId' });
  expect(findSpriteProblem('tile', 'b', 'tile_nope', available)).toEqual({
    kind: 'tile',
    id: 'b',
    reason: 'unresolved-spriteId',
    spriteId: 'tile_nope'
  });
  expect(findSpriteProblem('tile', 'c', 'tile_ok', available)).toBeNull();
});

test('collectMissingSpriteMappings covers tiles, entities, items and fields', () => {
  const fake = {
    theme: { spriteSheets: { s: { tileMap: { tile_ok: [0, 0] } } } },
    tiles: { t: {} },
    entities: { e: {} },
    items: { i: { spriteId: 'item_nope' } },
    fields: { f: {} }
  } as unknown as CampaignData;

  const kinds = collectMissingSpriteMappings(fake)
    .map((issue) => issue.kind)
    .sort();
  expect(kinds).toEqual(['entity', 'field', 'item', 'tile']);
});

test('resolveThemeSpriteSheets mixes cherry-picked packs and layers campaign overrides', () => {
  const bundleA: SpritePack = {
    id: 'bundle_tiles',
    name: 'Alt Tiles',
    spriteSheets: {
      tiles: { src: 'tiles/alt_tiles.png', tileWidth: 32, tileHeight: 32, tileMap: { tile_floor_stone_1: [0, 0] } },
      ignored: { src: 'tiles/ignored.png', tileWidth: 32, tileHeight: 32, tileMap: { ignored_key: [0, 0] } }
    }
  };
  const bundleB: SpritePack = {
    id: 'bundle_actors',
    name: 'Actors',
    spriteSheets: {
      tiles: { src: 'tiles/old_tiles.png', tileWidth: 32, tileHeight: 32, tileMap: { tile_floor_stone_1: [32, 0] } },
      monsters: { src: 'sprites/monsters.png', tileWidth: 32, tileHeight: 32, tileMap: { monster_goblin: [64, 0] } }
    }
  };

  const baseTheme: ThemeConfig = {
    colors: {
      background: '#000',
      floorDimFg: '#111',
      playerFg: '#fff',
      stairsFg: '#fff',
      transparent: 'transparent',
      wallDimFg: '#222'
    },
    glyphs: { stairsDown: '>', stairsUp: '<' },
    ui: { displayWidth: 50, displayHeight: 25, fontSize: 18, fontFamily: 'monospace' },
    spritePacks: [
      { packId: 'bundle_tiles', includeSheets: ['tiles'] },
      { packId: 'bundle_actors', includeSheets: ['monsters'] }
    ],
    spriteSheets: {
      overrides: {
        src: 'sprites/custom.png',
        tileWidth: 32,
        tileHeight: 32,
        tileMap: { custom_boss: [0, 0] }
      }
    }
  };

  const hydratedTheme = attachLoadedSpritePacks(baseTheme, {
    bundle_tiles: { pack: bundleA, packBasePath: '/data/sprite_packs/bundle_tiles' },
    bundle_actors: { pack: bundleB, packBasePath: '/data/sprite_packs/bundle_actors' }
  });

  const merged = resolveThemeSpriteSheets(hydratedTheme);
  expect(Object.keys(merged ?? {})).toEqual(['monsters', 'tiles', 'overrides']);
  expect(merged?.tiles?.srcBasePath).toBe('/data/sprite_packs/bundle_tiles');
  expect(merged?.tiles?.src).toBe('tiles/alt_tiles.png');
  expect(merged?.monsters?.srcBasePath).toBe('/data/sprite_packs/bundle_actors');
  expect(merged?.overrides?.srcBasePath).toBeUndefined();

  // Verify priority-ordered per-spriteId fallback when two packs share a sheetId ('tiles')
  const stackedTheme = attachLoadedSpritePacks(
    {
      ...baseTheme,
      spritePacks: ['bundle_tiles', 'bundle_actors'],
      spriteSheets: undefined
    },
    {
      bundle_tiles: { pack: bundleA, packBasePath: '/data/sprite_packs/bundle_tiles' },
      bundle_actors: { pack: bundleB, packBasePath: '/data/sprite_packs/bundle_actors' }
    }
  );
  const stackedSheets = resolveThemeSpriteSheets(stackedTheme);
  // Fallback bundle_actors renders first (using scoped key for shadowed 'tiles'), primary bundle_tiles renders on top
  expect(Object.keys(stackedSheets ?? {})).toEqual(['bundle_actors__tiles', 'monsters', 'tiles', 'ignored']);
  expect(stackedSheets?.tiles?.srcBasePath).toBe('/data/sprite_packs/bundle_tiles');
  expect(stackedSheets?.bundle_actors__tiles?.srcBasePath).toBe('/data/sprite_packs/bundle_actors');

  // Verify player Tileset Pack preference puts chosen pack first while keeping fallbacks,
  // preserves existing includeSheets refs, applies preferredIncludeSheets when absent, and ignores ASCII themes
  const prefApplied = resolveEffectiveThemeWithPreference(stackedTheme, '32rogues', ['dcss']);
  expect(prefApplied.spritePacks).toEqual(['32rogues', 'bundle_tiles', 'bundle_actors', 'dcss']);
  const prefWithDefaultSheets = resolveEffectiveThemeWithPreference(stackedTheme, 'dcss', ['32rogues'], [
    'dungeon',
    'monsters'
  ]);
  expect(prefWithDefaultSheets.spritePacks).toEqual([
    { packId: 'dcss', includeSheets: ['dungeon', 'monsters'] },
    'bundle_tiles',
    'bundle_actors',
    '32rogues'
  ]);
  const scopedTheme: ThemeConfig = {
    ...baseTheme,
    spritePacks: [{ packId: 'bundle_tiles', includeSheets: ['tiles'] }, 'bundle_actors']
  };
  expect(
    resolveEffectiveThemeWithPreference(scopedTheme, 'bundle_tiles', ['32rogues'], ['tiles', 'ignored']).spritePacks
  ).toEqual([{ packId: 'bundle_tiles', includeSheets: ['tiles'] }, 'bundle_actors', '32rogues']);

  const asciiTheme: ThemeConfig = { ...baseTheme, spritePacks: undefined, spriteSheets: undefined };
  expect(resolveEffectiveThemeWithPreference(asciiTheme, 'dcss', ['32rogues'])).toEqual(asciiTheme);

  const exported = stripTransientThemeHydration(hydratedTheme);
  expect(exported.loadedSpritePacks).toBeUndefined();
  expect(exported.spritePacks).toEqual(baseTheme.spritePacks);
  expect(exported.spriteSheets?.overrides?.srcBasePath).toBeUndefined();
});

test('validateCampaign reports errors for unloaded spritePacks or invalid includeSheets', async () => {
  const base = loadCampaignFromDisk('dnd35e-crypt');
  const brokenPackCampaign: CampaignData = {
    ...base,
    theme: {
      ...base.theme,
      spritePacks: ['missing_pack', { packId: '32rogues', includeSheets: ['nonexistent_sheet'] }]
    }
  };
  const report = await validateCampaign(brokenPackCampaign);
  expect(report.errors.some((e) => e.path === 'theme.spritePacks[0]')).toBe(true);
  expect(report.errors.some((e) => e.path === 'theme.spritePacks[1].includeSheets')).toBe(true);
}, 15_000);

test('sprite_packs/catalog.json conforms to SpritePackCatalogSchema and resolvePlaybackThemeConfig honors preferredSpritePack', () => {
  const catalogPath = join(process.cwd(), 'public', SPRITE_PACKS_DATA_SUBPATH, SPRITE_PACKS_CATALOG_FILENAME);
  const parsed = SpritePackCatalogSchema.parse(JSON.parse(readFileSync(catalogPath, 'utf-8')));
  const dcssEntry = parsed.packs.find((p) => p.id === 'dcss');
  expect(dcssEntry).toBeDefined();
  expect(dcssEntry?.defaultIncludeSheets?.length).toBeGreaterThan(0);
  expect(dcssEntry?.attribution?.license).toBe('CC0-1.0');

  const campaign = loadCampaignFromDisk('default');
  const settings = getSettings();
  const prevPref = settings.visualFeedback.preferredSpritePack;
  try {
    settings.visualFeedback.preferredSpritePack = DEFAULT_PREFERRED_SPRITE_PACK;
    expect(resolvePlaybackThemeConfig(campaign)).toBe(campaign.theme);

    settings.visualFeedback.preferredSpritePack = '32rogues';
    const switched = resolvePlaybackThemeConfig(campaign);
    expect(switched.spritePacks?.[0]).toBe('32rogues');
    expect(switched.spritePacks?.[1]).toEqual({
      packId: 'dcss',
      includeSheets: ['dungeon', 'monsters', 'items', 'actors', 'effects', 'spells', 'misc']
    });
  } finally {
    settings.visualFeedback.preferredSpritePack = prevPref;
  }
});
