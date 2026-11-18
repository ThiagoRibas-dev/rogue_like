/**
 * @file Canonical utilities for shared sprite pack resolution, bundle mixing,
 * campaign overrides, and clean transient-field stripping for persistence/export.
 */

import type { SpritePack, SpritePackRef, SpriteSheetSource, ThemeConfig } from '../types/campaign.types.ts';

/** Relative subpath under `public/` (and fetched under `BASE_URL`) storing shared sprite packs. */
export const SPRITE_PACKS_DATA_SUBPATH = 'data/sprite_packs';

/** Manifest filename inside each shared sprite pack bundle folder. */
export const SPRITE_PACK_MANIFEST_FILENAME = 'pack.json';

/**
 * Normalized descriptor parsed from a `SpritePackRef` union entry.
 */
export interface NormalizedSpritePackRef {
  readonly packId: string;
  readonly includeSheets?: ReadonlyArray<string>;
}

/**
 * Normalizes a `SpritePackRef` (`string` or `{ packId, includeSheets }`) into a uniform descriptor.
 *
 * @param ref Raw pack reference from `theme.spritePacks`.
 * @returns Normalized `{ packId, includeSheets? }`.
 */
export function normalizeSpritePackRef(ref: SpritePackRef): NormalizedSpritePackRef {
  if (typeof ref === 'string') {
    return { packId: ref };
  }
  return ref.includeSheets !== undefined
    ? { packId: ref.packId, includeSheets: ref.includeSheets }
    : { packId: ref.packId };
}

/**
 * Collects unique sprite pack IDs referenced by a theme configuration in declaration order.
 *
 * @param theme Optional theme config containing `spritePacks`.
 * @returns Array of unique pack IDs.
 */
export function getReferencedSpritePackIds(theme: Pick<ThemeConfig, 'spritePacks'> | undefined): ReadonlyArray<string> {
  if (!theme?.spritePacks || theme.spritePacks.length === 0) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const rawRef of theme.spritePacks) {
    const { packId } = normalizeSpritePackRef(rawRef);
    if (!seen.has(packId)) {
      seen.add(packId);
      ids.push(packId);
    }
  }
  return ids;
}

/**
 * Stamps every sheet inside a `SpritePack` with its pack `srcBasePath` (preserving any pre-stamped base path).
 *
 * @param pack Validated sprite pack definition.
 * @param packBasePath Base URL or relative data subpath for the pack directory.
 * @returns Stamped clone of the pack.
 */
export function stampSpritePackBasePath(pack: SpritePack, packBasePath: string): SpritePack {
  const normalizedBase = packBasePath.replace(/\/+$/, '');
  const stampedSheets: Record<string, SpriteSheetSource> = {};
  for (const [sheetId, sheet] of Object.entries(pack.spriteSheets)) {
    stampedSheets[sheetId] = {
      ...sheet,
      srcBasePath: sheet.srcBasePath ?? normalizedBase
    };
  }
  return { ...pack, spriteSheets: stampedSheets };
}

/**
 * Merges hydrated shared sprite packs (resolved in declared `theme.spritePacks` order, respecting optional
 * `includeSheets` filters) with campaign-local `theme.spriteSheets` overrides layered on top.
 *
 * @param theme Theme config (or minimal `{ spritePacks, loadedSpritePacks, spriteSheets }` slice).
 * @returns Merged spritesheet dictionary, or `undefined` if no sheets are configured.
 */
export function resolveThemeSpriteSheets(
  theme: Pick<ThemeConfig, 'spritePacks' | 'loadedSpritePacks' | 'spriteSheets'> | undefined
): Readonly<Record<string, SpriteSheetSource>> | undefined {
  if (!theme) return undefined;

  const merged: Record<string, SpriteSheetSource> = {};
  const loadedPacks = theme.loadedSpritePacks ?? {};

  if (theme.spritePacks) {
    for (const rawRef of theme.spritePacks) {
      const { packId, includeSheets } = normalizeSpritePackRef(rawRef);
      const pack = loadedPacks[packId];
      if (!pack) continue;

      if (includeSheets && includeSheets.length > 0) {
        for (const sheetId of includeSheets) {
          const sheet = pack.spriteSheets[sheetId];
          if (sheet) {
            merged[sheetId] = sheet;
          }
        }
      } else {
        for (const [sheetId, sheet] of Object.entries(pack.spriteSheets)) {
          merged[sheetId] = sheet;
        }
      }
    }
  }

  if (theme.spriteSheets) {
    for (const [sheetId, sheet] of Object.entries(theme.spriteSheets)) {
      merged[sheetId] = sheet;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Attaches hydrated shared sprite packs to a `ThemeConfig`, stamping each pack's sheets with its base path.
 *
 * @param theme Authored theme configuration.
 * @param packsById Dictionary mapping `packId` -> `{ pack, packBasePath }`.
 * @returns Updated `ThemeConfig` carrying `loadedSpritePacks`.
 */
export function attachLoadedSpritePacks(
  theme: ThemeConfig,
  packsById: Readonly<Record<string, { readonly pack: SpritePack; readonly packBasePath: string }>>
): ThemeConfig {
  const stampedPacks: Record<string, SpritePack> = { ...(theme.loadedSpritePacks ?? {}) };
  for (const [packId, entry] of Object.entries(packsById)) {
    stampedPacks[packId] = stampSpritePackBasePath(entry.pack, entry.packBasePath);
  }
  return Object.keys(stampedPacks).length > 0 ? { ...theme, loadedSpritePacks: stampedPacks } : theme;
}

/**
 * Strips transient runtime pack hydration (`loadedSpritePacks` and synthetic `srcBasePath`) prior to ZIP/disk export
 * so authored `spritePacks` references and lightweight campaign overrides serialize cleanly.
 *
 * @param theme Active theme config.
 * @returns Export-safe `ThemeConfig`.
 */
export function stripTransientThemeHydration(theme: ThemeConfig): ThemeConfig {
  const { loadedSpritePacks: _omittedPacks, spriteSheets, ...restTheme } = theme;
  if (!spriteSheets) {
    return restTheme;
  }
  const cleanSheets: Record<string, SpriteSheetSource> = {};
  for (const [sheetId, sheet] of Object.entries(spriteSheets)) {
    const { srcBasePath: _omittedBase, ...cleanSheet } = sheet;
    cleanSheets[sheetId] = cleanSheet;
  }
  return {
    ...restTheme,
    spriteSheets: cleanSheets
  };
}
