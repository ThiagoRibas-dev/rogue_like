/**
 * @file Canonical utilities for shared sprite pack resolution, bundle mixing,
 * campaign overrides, and clean transient-field stripping for persistence/export.
 */

import type { SpritePack, SpritePackRef, SpriteSheetSource, ThemeConfig } from '../types/campaign.types.ts';

/** Relative subpath under `public/` (and fetched under `BASE_URL`) storing shared sprite packs. */
export const SPRITE_PACKS_DATA_SUBPATH = 'data/sprite_packs';

/** Manifest filename inside each shared sprite pack bundle folder. */
export const SPRITE_PACK_MANIFEST_FILENAME = 'pack.json';

/** Catalog filename enumerating discoverable shared sprite packs and attributions. */
export const SPRITE_PACKS_CATALOG_FILENAME = 'catalog.json';

/** Default player setting delegating tileset selection to the active campaign's `theme.spritePacks`. */
export const DEFAULT_PREFERRED_SPRITE_PACK = 'auto';

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
 * Resolves an effective `ThemeConfig` prioritizing a player's `preferredSpritePack` override
 * (keeping campaign packs and catalog fallbacks underneath it) when sprite art is enabled.
 * ASCII-only campaigns (no `spritePacks` and no `spriteSheets`) are returned untouched.
 *
 * @param theme Authored or hydrated campaign theme configuration.
 * @param preferredSpritePack Player's Settings tileset preference (`'auto'` or a pack ID).
 * @param catalogFallbacks Optional default fallback pack IDs defined for `preferredSpritePack` in `catalog.json`.
 * @param preferredIncludeSheets Optional default sheet subset for `preferredSpritePack` when not already scoped in `theme.spritePacks`.
 * @returns Effective `ThemeConfig` with `spritePacks` ordered primary-first, fallback-last.
 */
export function resolveEffectiveThemeWithPreference(
  theme: ThemeConfig,
  preferredSpritePack: string | undefined,
  catalogFallbacks?: ReadonlyArray<string>,
  preferredIncludeSheets?: ReadonlyArray<string>
): ThemeConfig {
  if (!preferredSpritePack || preferredSpritePack === DEFAULT_PREFERRED_SPRITE_PACK) {
    return theme;
  }
  const hasNativeSprites =
    (theme.spritePacks !== undefined && theme.spritePacks.length > 0) ||
    (theme.spriteSheets !== undefined && Object.keys(theme.spriteSheets).length > 0);
  if (!hasNativeSprites) {
    return theme;
  }

  const existingPreferredRef = (theme.spritePacks ?? []).find(
    (ref) => normalizeSpritePackRef(ref).packId === preferredSpritePack
  );
  const primaryRef: SpritePackRef =
    existingPreferredRef ??
    (preferredIncludeSheets && preferredIncludeSheets.length > 0
      ? { packId: preferredSpritePack, includeSheets: [...preferredIncludeSheets] }
      : preferredSpritePack);

  const orderedRefs: SpritePackRef[] = [primaryRef];
  const seenIds = new Set<string>([preferredSpritePack]);
  for (const ref of theme.spritePacks ?? []) {
    const id = normalizeSpritePackRef(ref).packId;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      orderedRefs.push(ref);
    }
  }
  for (const fbId of catalogFallbacks ?? []) {
    if (!seenIds.has(fbId)) {
      seenIds.add(fbId);
      orderedRefs.push(fbId);
    }
  }
  return { ...theme, spritePacks: orderedRefs };
}

/**
 * Merges hydrated shared sprite packs (layering fallback -> primary so primary pack entries
 * override per `spriteId` inside `compositeAtlas` while preserving un-overwritten fallback sprites)
 * with campaign-local `theme.spriteSheets` overrides layered on top.
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
  const overrideSheetIds = new Set<string>(Object.keys(theme.spriteSheets ?? {}));

  if (theme.spritePacks) {
    // Identify which pack (lowest index = highest priority) owns each bare sheetId name.
    const highestPriorityOwnerBySheetId = new Map<string, number>();
    for (let i = 0; i < theme.spritePacks.length; i++) {
      const { packId, includeSheets } = normalizeSpritePackRef(theme.spritePacks[i]!);
      const pack = loadedPacks[packId];
      if (!pack) continue;
      const sheetIds = includeSheets && includeSheets.length > 0 ? includeSheets : Object.keys(pack.spriteSheets);
      for (const sheetId of sheetIds) {
        if (
          !overrideSheetIds.has(sheetId) &&
          pack.spriteSheets[sheetId] &&
          !highestPriorityOwnerBySheetId.has(sheetId)
        ) {
          highestPriorityOwnerBySheetId.set(sheetId, i);
        }
      }
    }

    // Layer from lowest-priority fallback -> index 0 primary so primary pack wins per spriteId.
    for (let i = theme.spritePacks.length - 1; i >= 0; i--) {
      const { packId, includeSheets } = normalizeSpritePackRef(theme.spritePacks[i]!);
      const pack = loadedPacks[packId];
      if (!pack) continue;

      const sheetIds = includeSheets && includeSheets.length > 0 ? includeSheets : Object.keys(pack.spriteSheets);
      for (const sheetId of sheetIds) {
        if (overrideSheetIds.has(sheetId)) continue;
        const sheet = pack.spriteSheets[sheetId];
        if (!sheet) continue;
        const outputKey = highestPriorityOwnerBySheetId.get(sheetId) === i ? sheetId : `${packId}__${sheetId}`;
        merged[outputKey] = sheet;
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
