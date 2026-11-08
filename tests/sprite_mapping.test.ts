import { test, expect } from 'bun:test';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { loadCampaignFromDisk } from './helpers.ts';
import { campaignUsesSprites, collectMissingSpriteMappings, findSpriteProblem } from '../src/rendering/sprite_keys.ts';

test('sprite campaigns (default, dnd35e-crypt): every tile/entity/item/field resolves a sprite', () => {
  for (const id of ['default', 'dnd35e-crypt']) {
    const campaign = loadCampaignFromDisk(id);
    expect(campaignUsesSprites(campaign)).toBe(true);
    expect(collectMissingSpriteMappings(campaign)).toEqual([]);
  }
});

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
