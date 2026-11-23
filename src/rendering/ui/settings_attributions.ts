import { getCachedSpritePack, loadSpritePack } from '../../core/loader/sprite_pack_loader.ts';
import type { SpritePackAttribution, SpritePackCatalog } from '../../types/campaign.types.ts';

/** Normalized attribution card item rendered in the Settings Credits & Attributions section. */
export interface AttributionCardItem {
  readonly id: string;
  readonly title: string;
  readonly attribution: SpritePackAttribution;
}

const ENGINE_THIRD_PARTY_ATTRIBUTIONS: ReadonlyArray<AttributionCardItem> = [
  {
    id: 'rltiles',
    title: 'RLTiles 64x64 Isometric (Archived Reference)',
    attribution: {
      author: 'RLTiles Contributors',
      license: 'Public Domain',
      sourceUrl: 'https://opengameart.org/content/64x64-isometric-roguelike-tiles',
      notes: 'Archived in docs/archive/rltiles-pack/ for future isometric renderer work (http://rltiles.sf.net).'
    }
  },
  {
    id: 'rotjs',
    title: 'ROT.js Roguelike Toolkit',
    attribution: {
      author: 'Ondrej Zara & Contributors',
      license: 'BSD-3-Clause',
      sourceUrl: 'https://ondras.github.io/rot.js/'
    }
  },
  {
    id: 'srd35-ogl',
    title: 'System Reference Document v3.5 (Open Game Content)',
    attribution: {
      author: 'Wizards of the Coast, Inc.',
      license: 'Open Game License v1.0a (OGL)',
      sourceUrl: 'https://www.d20srd.org/index.htm',
      licenseUrl: 'https://www.d20srd.org/ogl.htm',
      notes:
        'Core 3.5e ruleset mechanics, classes, feats, spells, and creatures are derived from Open Game Content distributed under the Open Game License v1.0a.',
      restrictions: [
        'Open Game License v 1.0a Copyright 2000, Wizards of the Coast, Inc.',
        'System Reference Document Copyright 2000-2003, Wizards of the Coast, Inc.; Authors Jonathan Tweet, Monte Cook, Skip Williams, Rich Baker, Andy Collins, David Noonan, Rich Redman, Bruce R. Cordell, John D. Rateliff, Thomas Reid, James Wyatt, based on original material by E. Gary Gygax and Dave Arneson.'
      ]
    }
  }
];

/**
 * Projects sprite-pack, archived-asset, and library attribution descriptors from the loaded catalog.
 *
 * @param catalog Optional loaded `SpritePackCatalog`.
 * @returns Array of `AttributionCardItem` ready for declarative Preact rendering.
 */
export function getAttributionCardItems(catalog: SpritePackCatalog | null): ReadonlyArray<AttributionCardItem> {
  const items: AttributionCardItem[] = [];
  if (catalog) {
    for (const entry of catalog.packs) {
      const fullPack = getCachedSpritePack(entry.id);
      const attr = fullPack?.attribution ?? entry.attribution;
      if (attr) {
        items.push({
          id: entry.id,
          title: entry.name,
          attribution: attr
        });
      }
    }
  }
  for (const extra of ENGINE_THIRD_PARTY_ATTRIBUTIONS) {
    items.push(extra);
  }
  return items;
}

/**
 * Hydrates full `pack.json` contributor metadata for all catalog packs.
 *
 * @param catalog Loaded `SpritePackCatalog`.
 */
export async function hydrateAttributionContributors(catalog: SpritePackCatalog): Promise<void> {
  const missingPacks = catalog.packs.filter((p) => !getCachedSpritePack(p.id));
  if (missingPacks.length === 0) return;
  await Promise.all(missingPacks.map((p) => loadSpritePack(p.id).catch(() => undefined)));
}
