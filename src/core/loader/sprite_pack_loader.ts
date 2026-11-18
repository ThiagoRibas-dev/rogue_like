/**
 * @file Browser loader & hydration helpers for shared sprite pack bundles (`public/data/sprite_packs/<id>/pack.json`).
 */

import {
  SpritePackCatalogSchema,
  SpritePackSchema,
  type CampaignData,
  type SpritePack,
  type SpritePackCatalog,
  type ThemeConfig
} from '../../types/campaign.types.ts';
import {
  SPRITE_PACKS_CATALOG_FILENAME,
  SPRITE_PACKS_DATA_SUBPATH,
  SPRITE_PACK_MANIFEST_FILENAME,
  attachLoadedSpritePacks,
  getReferencedSpritePackIds
} from '../../utils/sprite_pack.ts';

const spritePackCache = new Map<string, SpritePack>();
let spritePackCatalogCache: SpritePackCatalog | null = null;

/**
 * Resolves the fetch base path (no trailing slash) for the shared sprite packs root or one pack.
 *
 * @param packId Optional unique sprite pack identifier.
 * @param baseUrl Optional application base URL (defaults to Vite `import.meta.env.BASE_URL` or `'/'`).
 * @returns Normalized URL prefix pointing to the pack directory or packs root.
 */
export function buildSpritePackBaseUrl(packId?: string, baseUrl?: string): string {
  const rawRoot = baseUrl ?? (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  const normalizedRoot = rawRoot.endsWith('/') ? rawRoot : `${rawRoot}/`;
  return packId
    ? `${normalizedRoot}${SPRITE_PACKS_DATA_SUBPATH}/${packId}`
    : `${normalizedRoot}${SPRITE_PACKS_DATA_SUBPATH}`;
}

/**
 * Fetches and Zod-validates the shared sprite pack catalog (`public/data/sprite_packs/catalog.json`),
 * caching the result in memory. Returns `{ packs: [] }` if unavailable.
 *
 * @returns Validated `SpritePackCatalog`.
 */
export async function loadSpritePackCatalog(): Promise<SpritePackCatalog> {
  if (spritePackCatalogCache) return spritePackCatalogCache;
  if (typeof fetch !== 'function') return { packs: [] };

  try {
    const res = await fetch(`${buildSpritePackBaseUrl()}/${SPRITE_PACKS_CATALOG_FILENAME}`);
    if (!res.ok) {
      return { packs: [] };
    }
    const rawJson: unknown = await res.json();
    const parsed = SpritePackCatalogSchema.safeParse(rawJson);
    if (!parsed.success) {
      console.warn('Invalid sprite pack catalog:', parsed.error.message);
      return { packs: [] };
    }
    spritePackCatalogCache = parsed.data;
    return parsed.data;
  } catch {
    return { packs: [] };
  }
}

/**
 * Synchronously returns the previously loaded `SpritePackCatalog`, or `undefined` if not yet fetched.
 */
export function getCachedSpritePackCatalog(): SpritePackCatalog | undefined {
  return spritePackCatalogCache ?? undefined;
}

/**
 * Synchronously returns a previously loaded `SpritePack` from cache, if present.
 */
export function getCachedSpritePack(packId: string): SpritePack | undefined {
  return spritePackCache.get(packId);
}

/**
 * Fetches and Zod-validates a shared sprite pack manifest (`pack.json`), caching in memory.
 *
 * @param packId Shared sprite pack identifier.
 * @returns Validated `SpritePack` definition.
 */
export async function loadSpritePack(packId: string): Promise<SpritePack> {
  const cached = spritePackCache.get(packId);
  if (cached) return cached;

  const packBase = buildSpritePackBaseUrl(packId);
  const res = await fetch(`${packBase}/${SPRITE_PACK_MANIFEST_FILENAME}`);
  if (!res.ok) {
    throw new Error(`Failed to load sprite pack "${packId}": ${res.status} ${res.statusText}`);
  }
  const rawJson: unknown = await res.json();
  const parsed = SpritePackSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new Error(`Invalid sprite pack "${packId}": ${parsed.error.message}`);
  }
  spritePackCache.set(packId, parsed.data);
  return parsed.data;
}

/**
 * Hydrates `campaign.theme.loadedSpritePacks` for every bundle referenced in `targetTheme.spritePacks`.
 *
 * @param campaign Loaded or active `CampaignData`.
 * @param targetTheme Optional resolved theme whose `spritePacks` should be hydrated (defaults to `campaign.theme`).
 * @returns Updated `CampaignData` with stamped `loadedSpritePacks` attached.
 */
export async function hydrateCampaignSpritePacksForTheme(
  campaign: CampaignData,
  targetTheme: ThemeConfig
): Promise<CampaignData> {
  const packIds = getReferencedSpritePackIds(targetTheme);
  if (packIds.length === 0) return campaign;

  const existing = campaign.theme.loadedSpritePacks ?? {};
  const missingIds = packIds.filter((id) => existing[id] === undefined);
  if (missingIds.length === 0) return campaign;

  const loadedEntries = await Promise.all(
    missingIds.map(
      async (packId): Promise<readonly [string, { readonly pack: SpritePack; readonly packBasePath: string }]> => {
        const pack = await loadSpritePack(packId);
        return [packId, { pack, packBasePath: buildSpritePackBaseUrl(packId) }] as const;
      }
    )
  );

  const packsById: Record<string, { readonly pack: SpritePack; readonly packBasePath: string }> = {};
  for (const [packId, entry] of loadedEntries) {
    packsById[packId] = entry;
  }

  return {
    ...campaign,
    theme: attachLoadedSpritePacks(campaign.theme, packsById)
  };
}

/**
 * Hydrates `campaign.theme.loadedSpritePacks` for every bundle referenced in `campaign.theme.spritePacks`.
 *
 * @param campaign Loaded or imported `CampaignData`.
 * @returns Updated `CampaignData` with stamped `loadedSpritePacks` attached.
 */
export async function hydrateCampaignSpritePacks(campaign: CampaignData): Promise<CampaignData> {
  return hydrateCampaignSpritePacksForTheme(campaign, campaign.theme);
}
