# Implementation Plan — Shared Sprite Pack Repository & Per-Campaign Override Architecture

## 1. Architectural Rules & Standards Reiteration

- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any` casts, obey `exactOptionalPropertyTypes: true` (conditionally spread optional properties rather than assigning `undefined`), explicit return types on all functions, and named constants for shared paths (`SPRITE_PACKS_SUBPATH`, `SPRITE_PACK_MANIFEST_FILENAME`, `DEFAULT_CAMPAIGN_SEGMENT`).
- **Rule 15 (Cascading Effects Matrix):** All schema, loader, compositor, editor, ZIP export, generator, parity, and test impacts are mapped in Section 4.
- **Rule 16 & 21 (Three-Tier Placement & Zero Hardcoding):**
  - **Tier 1 Console (`src/types/`, `src/utils/`, `src/core/loader/`, `src/rendering/`, `src/editor/`):** Generic `SpritePackSchema`, `spritePackId` lookup, `resolveThemeSpriteSheets` merge, `srcBasePath` resolution, and ZIP round-trip stripping. Zero pack IDs (`'32rogues'`) or PNG filenames hardcoded in `.ts` engine code.
  - **Tier 3 Content (`public/data/sprite_packs/32rogues/`, `public/data/campaigns/*/theme.json`):** Declarative pack bundle and lightweight campaign references/overrides.
- **Module Layering (`.dependency-cruiser.cjs`):** Pure pack resolution helpers reside in [`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts) (importing only `src/types/`), preserving strict downward imports for `src/core/`, `src/rendering/`, and `src/editor/`.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner | Duplicated / Split-Brain Pattern Being Evicted |
| :--- | :--- | :--- |
| **Shared Tileset & Sprite Sheet Storage** | [`public/data/sprite_packs/32rogues/pack.json`](../public/data/sprite_packs/32rogues/pack.json) + `tiles/` & `sprites/` PNGs | Copying identical `tiles.png`, `rogues.png`, `monsters.png`, `items.png` (`12` PNGs) + `1,590`-line `spriteSheets` blocks across `default`, `dnd35e-crypt`, `realms-of-shroudgarde` |
| **Effective Sheet Resolution (Pack + Overrides)** | [`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts) (`resolveThemeSpriteSheets`, `stripTransientThemeHydration`) | Direct scattered reads of `campaign.theme.spriteSheets` across renderer, viewport snapshot, sprite diagnostics, and editor UI |
| **Runtime Pack Fetch & Browser Hydration** | [`src/core/loader/sprite_pack_loader.ts`](../src/core/loader/sprite_pack_loader.ts) (`loadSpritePack`, `hydrateCampaignThemeSpritePack`) | Missing pack loading on disk/installed/editor campaigns; blind 404 on per-campaign PNGs |
| **Atlas Composition with Per-Sheet Origin** | [`src/rendering/sprite_atlas.ts`](../src/rendering/sprite_atlas.ts) (`compositeAtlas`) | Single `basePath` assumption unable to stitch pack PNGs with campaign-local override PNGs |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Selecting shared sprite bundle** | `if (campaignId === 'dnd35e-crypt' \|\| ...)` fallback in TS | `theme.json` field `"spritePackId": "32rogues"` resolved via `public/data/sprite_packs/<packId>/pack.json` | Yes — adding `"my_pack"` requires zero TS edits |
| **Organizing tiles vs actor/item sheets** | Hardcoding `'tiles/'` or `'sprites/'` subdirectories in `compositeAtlas` | Relative `sheet.src` in `pack.json` (`"tiles/tiles.png"`, `"sprites/monsters.png"`) resolved against `sheet.srcBasePath ?? basePath` | Yes — any folder layout inside a pack or campaign works |
| **Overriding a whole sheet or single sprite** | Special override lookup table or hardcoded merge flags | Standard `theme.spriteSheets` dictionary merged atop pack sheets in order (same sheet ID replaces sheet; extra sheet e.g. `overrides` overwrites specific `spriteId` keys in `mergedTileMap`) | Yes — campaigns author standard `SpriteSheetSource` JSON entries |
| **Preserving clean authoring on export** | Re-serializing 28 KB pack maps on ZIP export | Transient `loadedSpritePack` stripped by `stripTransientThemeHydration` in `writeCampaignToZip` | Yes — works uniformly for all pack-backed campaigns |

---

## 4. Cascading Effects Matrix

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| **Add `SpritePackSchema`, `spritePackId`, `loadedSpritePack`, `SpriteSheetSource.srcBasePath`** ([`src/types/campaign/meta.ts`](../src/types/campaign/meta.ts)) | Authored `theme.json` & `pack.json` data; Zod schema validators | `CampaignDataSchema` parsing in [`loader.ts`](../src/core/loader.ts), [`workspace_file_service.ts`](../src/editor/workspace_file_service.ts), [`tests/helpers.ts`](../tests/helpers.ts), [`scripts/run-validator.ts`](../scripts/run-validator.ts) | `BlankSlateCampaign` & `ai-prompt-kit/schema-contract.md` remain schema-compatible (`spritePackId` optional) |
| **Add `resolveThemeSpriteSheets` & `stripTransientThemeHydration`** ([`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts)) | Populated `theme.loadedSpritePack` and/or `theme.spriteSheets` | [`display.ts`](../src/rendering/display.ts), [`procedural_sprites.ts`](../src/rendering/procedural_sprites.ts), [`sprite_keys.ts`](../src/rendering/sprite_keys.ts), [`viewport_snapshot.ts`](../src/rendering/viewport_snapshot.ts), [`ui_utils.ts`](../src/rendering/ui/ui_utils.ts), [`area_editor.ts`](../src/rendering/ui/area_editor.ts), [`area_static_painter.ts`](../src/rendering/ui/area_static_painter.ts), [`workspace_file_service.ts`](../src/editor/workspace_file_service.ts) | Single SSOT entry point prevents editor/validator/renderer divergence; must register in `docs/ssot/ssot_console.json` |
| **Hydrate `loadedSpritePack` at all campaign entrypoints** ([`sprite_pack_loader.ts`](../src/core/loader/sprite_pack_loader.ts), [`loader.ts`](../src/core/loader.ts), [`workspace_file_service.ts`](../src/editor/workspace_file_service.ts), [`tests/helpers.ts`](../tests/helpers.ts), [`run-validator.ts`](../scripts/run-validator.ts)) | `spritePackId` in JSON, `editor_active_document` in `sessionStorage`, IndexedDB `installedCampaign`, or ZIP upload | All `resolveThemeSpriteSheets(campaign.theme)` readers see complete merged tilemaps immediately | Offline validators/tests load from `public/data/sprite_packs/<id>/pack.json` synchronously on disk without network fetch; must register new file in `docs/ssot/ssot_console.json` |
| **Per-sheet `srcBasePath` resolution in `compositeAtlas`** ([`src/rendering/sprite_atlas.ts`](../src/rendering/sprite_atlas.ts)) | [`configureDisplayForCampaign`](../src/rendering/display.ts) passing `resolveThemeSpriteSheets(campaign.theme)` | Browser HTML5 canvas atlas composition loads pack sheets from `data/sprite_packs/<id>/...` and override sheets from `data/campaigns/<id>/...` | Unpacks cleanly even on subpath Vite `BASE_URL` deployments (e.g. itch.io); keeps procedural fallback if missing |
| **Consolidate PNGs & `pack.json` into `public/data/sprite_packs/32rogues/`** | [`scripts/generate_sprite_mappings.ts`](../scripts/generate_sprite_mappings.ts) -> writes `pack.json`; [`scripts/build-realms-of-shroudgarde.ts`](../scripts/build-realms-of-shroudgarde.ts) -> references `spritePackId: '32rogues'` | Removes duplicate `.png`s and inline `spriteSheets` from `default`, `dnd35e-crypt`, `realms-of-shroudgarde` | Must regenerate `ai-prompt-kit` via `bun scripts/generate-ai-prompt-kit.ts` so `run-validator.ts` parity passes; update [`tests/sprite_mapping.test.ts`](../tests/sprite_mapping.test.ts) disk PNG assertion |

---

## 5. Step-by-Step Implementation & Diffs

### Step 1: Extend Theme & Sprite Pack Schemas ([`src/types/campaign/meta.ts`](../src/types/campaign/meta.ts))

Add optional `srcBasePath` to `SpriteSheetSourceSchema`, define `SpritePackSchema` (`SpritePack`), and add optional `spritePackId` and `loadedSpritePack` to `ThemeConfigSchema`:

```ts
export const SpriteSheetSourceSchema = z.object({
  src: z.string().describe('Image filename or subpath relative to its pack or campaign folder (e.g., "tiles/tiles.png")'),
  srcBasePath: z
    .string()
    .optional()
    .describe('Runtime-resolved base URL or disk subpath when hydrated from a shared sprite pack'),
  tileWidth: z.number().int().positive().describe('Tile Width (px)'),
  tileHeight: z.number().int().positive().describe('Tile Height (px)'),
  tileMap: z
    // ...unchanged...
});

export const SpritePackSchema = z.object({
  id: z.string().min(1).describe('Unique Sprite Pack Identifier'),
  name: z.string().min(1).describe('Human-readable Sprite Pack Name'),
  description: z.string().optional().describe('Optional Sprite Pack Description'),
  spriteSheets: z.record(z.string(), SpriteSheetSourceSchema)
});
export type SpritePack = z.infer<typeof SpritePackSchema>;

export const ThemeConfigSchema = z.object({
  colors: z.object({ /* ... */ }),
  glyphs: z.object({ /* ... */ }),
  ui: z.object({ /* ... */ }),
  spritePackId: z.string().min(1).optional().describe('Optional shared sprite pack ID from data/sprite_packs/'),
  spriteSheets: z.record(z.string(), SpriteSheetSourceSchema).optional(),
  loadedSpritePack: SpritePackSchema.optional().describe('Transient hydrated shared pack loaded at runtime')
});
```

Wait — also re-export `SpritePackSchema` & `SpritePack` through `src/types/campaign.types.ts` (already does `export * from './campaign/meta.ts'`? Verify before editing!).

---

### Step 2: Create Tier 1 Pure Resolution Utility ([`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts))

Centralize pack/override merging and transient stripping without violating `.dependency-cruiser.cjs`:

```ts
import type { SpritePack, SpriteSheetSource, ThemeConfig } from '../types/campaign.types.ts';

/** Standard relative folder under `data/` holding shared sprite pack bundles. */
export const SPRITE_PACKS_DATA_SUBPATH = 'data/sprite_packs';

/** Manifest filename inside each shared sprite pack bundle folder. */
export const SPRITE_PACK_MANIFEST_FILENAME = 'pack.json';

/**
 * Stamps every sheet in a `SpritePack` with its pack `srcBasePath`, preserving any existing override base path.
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
 * Resolves the effective spritesheet dictionary for a theme by layering campaign-local `theme.spriteSheets`
 * atop `theme.loadedSpritePack?.spriteSheets` (per-sheet key replacement or additive override sheets).
 */
export function resolveThemeSpriteSheets(
  theme: Pick<ThemeConfig, 'spriteSheets' | 'loadedSpritePack'> | undefined
): Readonly<Record<string, SpriteSheetSource>> | undefined {
  if (!theme) return undefined;
  const packSheets = theme.loadedSpritePack?.spriteSheets;
  const localSheets = theme.spriteSheets;
  if (!packSheets && !localSheets) return undefined;
  const merged: Record<string, SpriteSheetSource> = {
    ...(packSheets ?? {}),
    ...(localSheets ?? {})
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Attaches a hydrated `loadedSpritePack` to a `ThemeConfig` cleanly under `exactOptionalPropertyTypes`.
 */
export function withLoadedSpritePack(theme: ThemeConfig, pack: SpritePack, packBasePath: string): ThemeConfig {
  return {
    ...theme,
    loadedSpritePack: stampSpritePackBasePath(pack, packBasePath)
  };
}

/**
 * Strips runtime-only hydration fields (`loadedSpritePack` and synthetic `srcBasePath`) before exporting JSON.
 */
export function stripTransientThemeHydration(theme: ThemeConfig): ThemeConfig {
  const { loadedSpritePack: _omitted, spriteSheets, ...restTheme } = theme;
  if (!spriteSheets) {
    return restTheme;
  }
  const cleanSheets: Record<string, SpriteSheetSource> = {};
  for (const [sheetId, sheet] of Object.entries(spriteSheets)) {
    const { srcBasePath: _baseOmitted, ...cleanSheet } = sheet;
    cleanSheets[sheetId] = cleanSheet;
  }
  return {
    ...restTheme,
    spriteSheets: cleanSheets
  };
}
```

---

### Step 3: Browser Pack Loader & Campaign Hydration ([`src/core/loader/sprite_pack_loader.ts`](../src/core/loader/sprite_pack_loader.ts), [`src/core/loader.ts`](../src/core/loader.ts), [`src/editor/workspace_file_service.ts`](../src/editor/workspace_file_service.ts))

Create `src/core/loader/sprite_pack_loader.ts`:

```ts
import { SpritePackSchema, type CampaignData, type SpritePack } from '../../types/campaign.types.ts';
import {
  SPRITE_PACKS_DATA_SUBPATH,
  SPRITE_PACK_MANIFEST_FILENAME,
  withLoadedSpritePack
} from '../../utils/sprite_pack.ts';

const spritePackCache = new Map<string, SpritePack>();

/**
 * Resolves the base URL path (without trailing slash) for a shared sprite pack.
 */
export function buildSpritePackBaseUrl(packId: string, baseUrl: string = import.meta.env?.BASE_URL ?? '/'): string {
  const normalizedRoot = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedRoot}${SPRITE_PACKS_DATA_SUBPATH}/${packId}`;
}

/**
 * Fetches and Zod-validates a shared sprite pack manifest (`pack.json`) with in-memory caching.
 */
export async function loadSpritePack(packId: string): Promise<SpritePack> {
  const cached = spritePackCache.get(packId);
  if (cached) return cached;

  const packBase = buildSpritePackBaseUrl(packId);
  const res = await fetch(`${packBase}/${SPRITE_PACK_MANIFEST_FILENAME}`);
  if (!res.ok) {
    throw new Error(`Failed to load sprite pack "${packId}" (${res.status} ${res.statusText})`);
  }
  const json: unknown = await res.json();
  const parsed = SpritePackSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid sprite pack "${packId}": ${parsed.error.message}`);
  }
  spritePackCache.set(packId, parsed.data);
  return parsed.data;
}

/**
 * Hydrates `campaign.theme.loadedSpritePack` when `spritePackId` is configured (or when matching pack is missing).
 */
export async function hydrateCampaignSpritePack(campaign: CampaignData): Promise<CampaignData> {
  const packId = campaign.theme.spritePackId;
  if (!packId) return campaign;
  if (campaign.theme.loadedSpritePack?.id === packId) return campaign;

  const pack = await loadSpritePack(packId);
  return {
    ...campaign,
    theme: withLoadedSpritePack(campaign.theme, pack, buildSpritePackBaseUrl(packId))
  };
}
```

Wire `hydrateCampaignSpritePack(...)` into **all** load paths:
- [`src/core/loader.ts`](../src/core/loader.ts): after resolving `editorDoc`, `installedCampaign`, or fetched `campaignData` cleanly before returning!
- [`src/editor/workspace_file_service.ts`](../src/editor/workspace_file_service.ts): call `await hydrateCampaignSpritePack(campaign)` in `readCampaignFromZip()`, and use `stripTransientThemeHydration(data.theme)` when writing `theme.json` in `writeCampaignToZip()`!

---

### Step 4: Offline Disk Hydration (`tests/helpers.ts` & `scripts/run-validator.ts`)

Both `tests/helpers.ts` (`loadCampaignFromDisk`) and `scripts/run-validator.ts` (`loadAndValidateZod`) load campaign files via `node:fs`. Add a small shared or matching disk pack loader (`public/data/sprite_packs/<packId>/pack.json`):

```ts
const packId = assembledTheme['spritePackId'];
if (typeof packId === 'string' && packId.length > 0) {
  const packPath = join(ROOT, 'public', SPRITE_PACKS_DATA_SUBPATH, packId, SPRITE_PACK_MANIFEST_FILENAME);
  if (!existsSync(packPath)) {
    throw new Error(`Missing sprite pack "${packId}" at ${packPath}`);
  }
  const pack = SpritePackSchema.parse(JSON.parse(readFileSync(packPath, 'utf-8')));
  assembled['theme'] = withLoadedSpritePack(parsedTheme, pack, `/${SPRITE_PACKS_DATA_SUBPATH}/${packId}`);
}
```

---

### Step 5: Update Rendering, Diagnostics & Editor UI to Consume `resolveThemeSpriteSheets`

1. [`src/rendering/sprite_atlas.ts`](../src/rendering/sprite_atlas.ts):
   - In `compositeAtlas(sheets, basePath, fallbackBasePath)`, compute per sheet:
     ```ts
     const sheetBase = (sheet.srcBasePath ?? basePath).replace(/\/+$/, '');
     const primaryUrl = `${sheetBase}/${sheet.src}`;
     const fallbackUrl =
       sheet.srcBasePath !== undefined
         ? undefined
         : resolveDefaultSpritesheetFallbackUrl(basePath, sheet.src, fallbackBasePath);
     ```
     Because `Object.entries(sheets)` iterates pack sheets followed by campaign override sheets, any override `spriteId` written later overwrites `mergedTileMap[spriteId]`, while pack sheets still load from `data/sprite_packs/<packId>/...` and campaign override sheets load from `data/campaigns/<campaignId>/...`.
2. Update all remaining readers to call `resolveThemeSpriteSheets(campaign.theme)`:
   - [`src/rendering/display.ts`](../src/rendering/display.ts) (`configureDisplayForCampaign`, `syncDisplayLayout`)
   - [`src/rendering/procedural_sprites.ts`](../src/rendering/procedural_sprites.ts) (`isEffectiveSpriteMode`)
   - [`src/rendering/sprite_keys.ts`](../src/rendering/sprite_keys.ts) (`getAvailableSpriteKeys`)
   - [`src/rendering/viewport_snapshot.ts`](../src/rendering/viewport_snapshot.ts)
   - [`src/rendering/ui/ui_utils.ts`](../src/rendering/ui/ui_utils.ts)
   - [`src/rendering/ui/area_editor.ts`](../src/rendering/ui/area_editor.ts)
   - [`src/rendering/ui/area_static_painter.ts`](../src/rendering/ui/area_static_painter.ts)

---

### Step 6: Consolidate Assets, Update Generators, Parity, SSOT & Tests

1. Create `public/data/sprite_packs/32rogues/`:
   - `tiles/tiles.png` (moved from `default/tiles.png`)
   - `sprites/rogues.png`, `sprites/monsters.png`, `sprites/items.png` (moved from `default/`)
   - `pack.json`: `{ id: '32rogues', name: '32rogues Fantasy Tileset & Sprites', description: '...', spriteSheets: { tiles: { src: 'tiles/tiles.png', ... }, rogues: { src: 'sprites/rogues.png', ... }, monsters: { src: 'sprites/monsters.png', ... }, items: { src: 'sprites/items.png', ... } } }`
2. Slim `theme.json` in `default`, `dnd35e-crypt`, and `realms-of-shroudgarde` (`scripts/build-realms-of-shroudgarde.ts`):
   - Remove the inline 28 KB `spriteSheets` block; set `"spritePackId": "32rogues"`.
   - Remove the 12 duplicate `.png` files under `public/data/campaigns/{default,dnd35e-crypt,realms-of-shroudgarde}/`.
   - Update [`scripts/generate_sprite_mappings.ts`](../scripts/generate_sprite_mappings.ts) to target `public/data/sprite_packs/32rogues/pack.json` with `tiles/tiles.png` & `sprites/{rogues,monsters,items}.png`.
   - Update [`scripts/build-realms-of-shroudgarde.ts`](../scripts/build-realms-of-shroudgarde.ts) so it preserves `spritePackId` cleanly instead of copying `.png` binaries.
3. Run `bun scripts/generate-ai-prompt-kit.ts` to refresh `ai-prompt-kit/` parity with `default/theme.json`.
4. Update [`docs/ssot/ssot_console.json`](../docs/ssot/ssot_console.json) for `src/utils/sprite_pack.ts` and `src/core/loader/sprite_pack_loader.ts`, regenerate `docs/SSOT_CONSOLE.md` via `bun scripts/map-codebase.ts`, and verify 0 SSOT errors.
5. Update [`tests/sprite_mapping.test.ts`](../tests/sprite_mapping.test.ts):
   - Resolve `sheet.srcBasePath` relative to `public/` (when present) or `campaignDir` (for campaign overrides) and verify every referenced PNG exists on disk.
   - Add unit tests for `resolveThemeSpriteSheets` (whole-sheet replacement & partial `overrides` sheet layering), `stripTransientThemeHydration`, and per-sheet `srcBasePath` isolation.

---

## 6. Confirmation Checkpoints

Before executing:
1. Confirm pack layout `public/data/sprite_packs/32rogues/` with `pack.json`, `tiles/tiles.png`, and `sprites/{rogues,monsters,items}.png`.
2. Confirm deleting the 12 duplicate `.png` files in `default/`, `dnd35e-crypt/`, and `realms-of-shroudgarde/` once `32rogues` is wired.
3. Confirm whether `createBlankSlateCampaign()` should remain minimal ASCII-by-default or opt into `spritePackId: '32rogues'`.
