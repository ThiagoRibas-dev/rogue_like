import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CampaignData, SpritePack, ThemeConfig } from '../src/types/campaign.types.ts';
import { loadCampaignFromDisk } from './helpers.ts';
import { campaignUsesSprites, collectMissingSpriteMappings, findSpriteProblem } from '../src/rendering/sprite_keys.ts';
import { validateCampaign } from '../src/editor/campaign_validator.ts';
import {
  attachLoadedSpritePacks,
  resolveThemeSpriteSheets,
  stripTransientThemeHydration
} from '../src/utils/sprite_pack.ts';

for (const id of ['default', 'dnd35e-crypt', 'realms-of-shroudgarde']) {
  test(
    `sprite campaign (${id}): every tile/entity/item/field resolves a sprite and resolved spritesheet PNGs exist on disk`,
    () => {
      const campaign = loadCampaignFromDisk(id);
      expect(campaign.theme.spritePacks).toEqual(['32rogues']);
      expect(campaign.theme.spriteSheets).toBeUndefined();
      expect(campaignUsesSprites(campaign)).toBe(true);
      expect(collectMissingSpriteMappings(campaign)).toEqual([]);

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
  expect(Object.keys(merged ?? {})).toEqual(['tiles', 'monsters', 'overrides']);
  expect(merged?.tiles?.srcBasePath).toBe('/data/sprite_packs/bundle_tiles');
  expect(merged?.tiles?.src).toBe('tiles/alt_tiles.png');
  expect(merged?.monsters?.srcBasePath).toBe('/data/sprite_packs/bundle_actors');
  expect(merged?.overrides?.srcBasePath).toBeUndefined();

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
