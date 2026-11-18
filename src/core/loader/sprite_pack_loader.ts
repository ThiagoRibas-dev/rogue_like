/**
 * @file Browser loader & hydration helpers for shared sprite pack bundles (`public/data/sprite_packs/<id>/pack.json`).
 */

import { SpritePackSchema, type CampaignData, type SpritePack } from '../../types/campaign.types.ts';
import {
  SPRITE_PACKS_DATA_SUBPATH,
  SPRITE_PACK_MANIFEST_FILENAME,
  attachLoadedSpritePacks,
  getReferencedSpritePackIds
} from '../../utils/sprite_pack.ts';

const spritePackCache = new Map<string, SpritePack>();

/**
 * Resolves the fetch base path (no trailing slash) for a shared sprite pack.
 *
 * @param packId Unique sprite pack identifier.
 * @param baseUrl Optional application base URL (defaults to Vite `import.meta.env.BASE_URL` or `'/'`).
 * @returns Normalized URL prefix pointing to the pack directory.
 */
export function buildSpritePackBaseUrl(packId: string, baseUrl?: string): string {
  const rawRoot = baseUrl ?? (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  const normalizedRoot = rawRoot.endsWith('/') ? rawRoot : `${rawRoot}/`;
  return `${normalizedRoot}${SPRITE_PACKS_DATA_SUBPATH}/${packId}`;
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
 * Hydrates `campaign.theme.loadedSpritePacks` for every bundle referenced in `campaign.theme.spritePacks`.
 *
 * @param campaign Loaded or imported `CampaignData`.
 * @returns Updated `CampaignData` with stamped `loadedSpritePacks` attached.
 */
export async function hydrateCampaignSpritePacks(campaign: CampaignData): Promise<CampaignData> {
  const packIds = getReferencedSpritePackIds(campaign.theme);
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
