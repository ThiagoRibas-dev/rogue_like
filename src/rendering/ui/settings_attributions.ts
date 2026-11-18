import { getCachedSpritePack, loadSpritePack } from '../../core/loader/sprite_pack_loader.ts';
import type { SpritePackAttribution, SpritePackCatalog } from '../../types/campaign.types.ts';

const ENGINE_THIRD_PARTY_ATTRIBUTIONS: ReadonlyArray<{
  readonly title: string;
  readonly attribution: SpritePackAttribution;
}> = [
  {
    title: 'RLTiles 64x64 Isometric (Archived Reference)',
    attribution: {
      author: 'RLTiles Contributors',
      license: 'Public Domain',
      sourceUrl: 'https://opengameart.org/content/64x64-isometric-roguelike-tiles',
      notes: 'Archived in docs/archive/rltiles-pack/ for future isometric renderer work (http://rltiles.sf.net).'
    }
  },
  {
    title: 'ROT.js Roguelike Toolkit',
    attribution: {
      author: 'Ondrej Zara & Contributors',
      license: 'BSD-3-Clause',
      sourceUrl: 'https://ondras.github.io/rot.js/'
    }
  }
];

function appendSafeLink(parent: HTMLElement, label: string, rawUrl: string): void {
  if (!/^https?:\/\//i.test(rawUrl)) return;
  const link = document.createElement('a');
  link.href = rawUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  link.style.color = '#7fb3ff';
  link.style.marginRight = '10px';
  parent.appendChild(link);
}

function createAttributionCard(title: string, attr: SpritePackAttribution): HTMLElement {
  const card = document.createElement('div');
  card.style.marginBottom = '10px';
  card.style.padding = '8px 10px';
  card.style.borderRadius = '4px';
  card.style.background = 'rgba(255, 255, 255, 0.04)';
  card.style.border = '1px solid rgba(255, 255, 255, 0.1)';

  const heading = document.createElement('div');
  heading.style.fontWeight = '600';
  heading.textContent = `${title} — ${attr.license}`;
  card.appendChild(heading);

  const authorLine = document.createElement('div');
  authorLine.style.opacity = '0.9';
  authorLine.textContent = `Author: ${attr.author}`;
  card.appendChild(authorLine);

  if (attr.notes) {
    const notesLine = document.createElement('div');
    notesLine.style.opacity = '0.82';
    notesLine.style.marginTop = '2px';
    notesLine.textContent = attr.notes;
    card.appendChild(notesLine);
  }

  if (attr.restrictions && attr.restrictions.length > 0) {
    const list = document.createElement('ul');
    list.style.margin = '4px 0 4px 18px';
    list.style.padding = '0';
    for (const term of attr.restrictions) {
      const li = document.createElement('li');
      li.textContent = term;
      list.appendChild(li);
    }
    card.appendChild(list);
  }

  if (attr.sourceUrl || attr.licenseUrl) {
    const linksRow = document.createElement('div');
    linksRow.style.marginTop = '4px';
    if (attr.sourceUrl) appendSafeLink(linksRow, 'Source', attr.sourceUrl);
    if (attr.licenseUrl) appendSafeLink(linksRow, 'License', attr.licenseUrl);
    card.appendChild(linksRow);
  }

  if (attr.contributors && attr.contributors.length > 0) {
    const details = document.createElement('details');
    details.style.marginTop = '4px';
    const summary = document.createElement('summary');
    summary.style.cursor = 'pointer';
    summary.textContent = `Contributors (${attr.contributors.length})`;
    details.appendChild(summary);
    const body = document.createElement('div');
    body.style.opacity = '0.82';
    body.style.marginTop = '4px';
    body.textContent = attr.contributors.join(' · ');
    details.appendChild(body);
    card.appendChild(details);
  }

  return card;
}

/**
 * Renders sprite-pack, archived-asset, and library attribution cards into `#settings-attributions-container`.
 *
 * @param catalog Loaded `SpritePackCatalog` containing pack credits and license terms.
 */
export function renderAttributionsPanel(catalog: SpritePackCatalog): void {
  const container = document.getElementById('settings-attributions-container');
  if (!container) return;
  container.replaceChildren();

  for (const entry of catalog.packs) {
    const fullPack = getCachedSpritePack(entry.id);
    const attr = fullPack?.attribution ?? entry.attribution;
    if (attr) {
      container.appendChild(createAttributionCard(entry.name, attr));
    }
  }

  for (const extra of ENGINE_THIRD_PARTY_ATTRIBUTIONS) {
    container.appendChild(createAttributionCard(extra.title, extra.attribution));
  }
}

/**
 * Hydrates full `pack.json` contributor metadata for all catalog packs and updates the Credits view.
 *
 * @param catalog Loaded `SpritePackCatalog`.
 */
export async function hydrateAttributionContributorsAndRender(catalog: SpritePackCatalog): Promise<void> {
  renderAttributionsPanel(catalog);
  const missingPacks = catalog.packs.filter((p) => !getCachedSpritePack(p.id));
  if (missingPacks.length === 0) return;

  await Promise.all(missingPacks.map((p) => loadSpritePack(p.id).catch(() => undefined)));
  renderAttributionsPanel(catalog);
}
