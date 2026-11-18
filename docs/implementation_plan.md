# Implementation Plan — DCSS Master Sprite Pack, Multi-Pack Per-Sprite Fallback, Settings Tileset Selector & In-Game Attributions

## 1. Architectural Rules & Standards Reiteration

- **Rules 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any`, obey `exactOptionalPropertyTypes: true` (conditional spreads instead of `undefined` assignments), explicit return types on every function, and named constants (`DEFAULT_PREFERRED_SPRITE_PACK = 'auto'`, `SPRITE_PACKS_CATALOG_FILENAME = 'catalog.json'`, `DEFAULT_PACK_TILE_PX = 32`).
- **Rule 9 (Engineering Design Decision — Isometric 64×64 `rltiles-pack` Archived):**
  Visual inspection of [`brick.png`](../scratch/%20rltiles-pack/rltiles-pack/brick.png) and [`64x64.png`](../scratch/%20rltiles-pack/rltiles-pack/64x64.png) confirms `rltiles-pack` uses **45-degree isometric diamond floors and walls**, which cannot tile cleanly inside our orthogonal `32×32` `ROT.Display` grid without a dedicated isometric renderer, while its standalone monsters, portals, statues, and bursts already exist redrawn in crisp native `32×32` orthogonal pixel art inside `DCSS Full`.
  - **Agreed Action:** Archive `scratch/ rltiles-pack/` into [`docs/archive/rltiles-pack/`](../docs/archive/) (preserving the 26 PNG sheets, `attribution.txt`, and a short `README.md` note for future isometric renderer work) and document `RLTiles` attribution in [`CREDITS.md`](../CREDITS.md), keeping it out of runtime `public/data/sprite_packs/`.
- **Rule 16 & 21 (Three-Tier Placement & Zero Hardcoding):**
  - **Tier 1 (Core Console):** Generic `SpritePackAttributionSchema`, `SpritePackCatalogSchema`, priority-ordered per-`spriteId` fallback in [`resolveThemeSpriteSheets`](../src/utils/sprite_pack.ts), `preferredSpritePack` setting + on-demand pack hydration in [`sprite_pack_loader.ts`](../src/core/loader/sprite_pack_loader.ts) & [`display.ts`](../src/rendering/display.ts), and data-driven Settings Tileset Selector + Attributions panel. Zero pack IDs (`'dcss'`, `'32rogues'`) hardcoded in `.ts`!
  - **Tier 3 (System Content):** `public/data/sprite_packs/catalog.json`, `public/data/sprite_packs/dcss/` (`CC0 1.0`), expanded `public/data/sprite_packs/32rogues/` (adding `animals`, `animated-tiles`, `autotiles`, `items-palette-swaps`), campaign `theme.json` defaults (`["dcss", "32rogues"]`), SRD item `spriteId` upgrades, and `CREDITS.md`.
- **Module Layering (`.dependency-cruiser.cjs`):** Pure pack/preference resolution stays inside [`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts) (importing only `src/types/`). Runtime hydration stays in [`src/core/loader/sprite_pack_loader.ts`](../src/core/loader/sprite_pack_loader.ts); DOM rendering stays in [`src/rendering/ui/settings.ui.ts`](../src/rendering/ui/settings.ui.ts).

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner | Duplicated / Split-Brain Pattern Being Replaced |
| :--- | :--- | :--- |
| **Pack Priority & Per-`spriteId` Fallback Resolution** | [`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts) (`resolveThemeSpriteSheets`, `resolveThemeWithPreferredPack`) | Current `merged[sheetId] = sheet` clobbers whole sheets across packs (preventing `32rogues` fallback under `dcss` when sheets share names) |
| **Available Packs & License/Credit Catalog** | [`public/data/sprite_packs/catalog.json`](../public/data/sprite_packs/catalog.json) + `pack.json` `attribution` (`SpritePackAttributionSchema`) | Unattributed tilesets in UI/repo; any hardcoded pack dropdown options in `index.html` or `settings.ui.ts` |
| **DCSS Atlas Build & Canonical ID Aliases** | [`scripts/pack-dcss-sprites.ts`](../scripts/pack-dcss-sprites.ts) -> `public/data/sprite_packs/dcss/pack.json` | Manual pixel-coordinate tables or copying `ProjectUtumno_full.png` without semantic metadata |
| **32rogues Full Pack Sync (incl. Animals & Animated Tiles)** | [`scripts/generate_sprite_mappings.ts`](../scripts/generate_sprite_mappings.ts) -> `public/data/sprite_packs/32rogues/` | Missing `animals.png`, `animated-tiles.png`, `autotiles.png`, `items-palette-swaps.png` from `32rogues/pack.json` |
| **Live User Tileset Switching & Hydration** | [`src/core/loader/sprite_pack_loader.ts`](../src/core/loader/sprite_pack_loader.ts) + [`src/rendering/display.ts`](../src/rendering/display.ts) (`configureDisplayForCampaign`) | Hydrating only `campaign.theme.spritePacks`, failing if Settings selects another installed pack at runtime |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Populating Settings Tileset Dropdown** | Hardcoding `<option value="dcss">` and `<option value="32rogues">` in HTML/TS | Load `public/data/sprite_packs/catalog.json` validated by `SpritePackCatalogSchema` and build `<option>`s from `catalog.packs` | Yes — adding a new pack to `catalog.json` shows it in Settings immediately |
| **Rendering Attributions & Licenses** | Hardcoding credit paragraphs in `settings.ui.ts` | Read `attribution` (`author`, `license`, `licenseUrl`, `sourceUrl`, `restrictions`, `contributors`) from `catalog.json` / `pack.json` | Yes — any modded pack supplies its own attribution cleanly |
| **Primary + Fallback Pack Resolution** | `if (pack === '32rogues') fallback = 'dcss'` in TS | Ordered `theme.spritePacks` (`["dcss", "32rogues"]`) + `catalog.defaultFallbackPackIds` stacked lowest-to-highest priority in `resolveThemeSpriteSheets` | Yes — works identically for any custom pack chain |
| **Preserving ASCII-Only Campaigns** | Overriding ASCII campaigns when `preferredSpritePack !== 'auto'` | Apply `preferredSpritePack` only when campaign already uses native sprites (`theme.spritePacks?.length \|\| theme.spriteSheets`) or explicit `renderMode === 'sprites'` | Yes — `shroudgarde` & `megacampaign` remain ASCII by default |

---

## 4. Cascading Effects Matrix

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| **Extend `SpritePackSchema` (`attribution`) & add `SpritePackCatalogSchema`** ([`src/types/campaign/meta.ts`](../src/types/campaign/meta.ts)) | `public/data/sprite_packs/catalog.json`, `*/pack.json` | `loadSpritePack`, `loadSpritePackCatalog`, `validateSpritePacksDiskParity` | Optional fields keep `32rogues` / mod packs backwards-compatible if `attribution` is initially validated gently or populated across all repo packs |
| **Priority-ordered per-`spriteId` fallback in `resolveThemeSpriteSheets` + `resolveThemeWithPreferredPack`** ([`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts)) | `campaign.theme` + optional `preferredSpritePack` (`settings.ts`) | `compositeAtlas`, `getAvailableSpriteKeys`, `collectMissingSpriteMappings`, `isEffectiveSpriteMode`, `viewport_snapshot`, `editor` | Sheet keys from `spritePacks` are pack-scoped (`packId__sheetId`) in reverse order so higher-priority packs overwrite `tileMap[spriteId]`, while same-name `theme.spriteSheets` replace shadowed pack sheets cleanly |
| **Add `preferredSpritePack` to `VisualFeedbackSettings`** ([`src/core/settings.ts`](../src/core/settings.ts)) | `DEFAULT_SETTINGS`, `localStorage` persisted settings | `bindSettingsControls` ([`session_settings.ts`](../src/core/session/session_settings.ts)), [`settings.ui.ts`](../src/rendering/ui/settings.ui.ts), [`display.ts`](../src/rendering/display.ts), `viewport_snapshot.ts` | Missing key in old saved `localStorage` defaults cleanly to `'auto'` (`Campaign Default`) via merge in `loadSettings` |
| **Pack `dcss` (`scripts/pack-dcss-sprites.ts`) + expand `32rogues` (`generate_sprite_mappings.ts`)** | `scratch/crawl-tiles/` (`DCSS Full` + `Oct-5-2010/spells`), `references/tilesets/32rogues/` | `public/data/sprite_packs/dcss/*`, `public/data/sprite_packs/32rogues/*`, `public/data/sprite_packs/catalog.json` | Canonical `32rogues` aliases in `dcss/pack.json` ensure `default`, `dnd35e-crypt`, `realms-of-shroudgarde`, and 160 `dnd35e` SRD items have `0` missing sprites on `dcss` alone OR `["dcss", "32rogues"]` |
| **Update campaigns (`["dcss", "32rogues"]`) & SRD item sprites** | `default`, `dnd35e-crypt`, `realms-of-shroudgarde`, `build-realms-of-shroudgarde.ts` | `scripts/generate-ai-prompt-kit.ts` -> updates `ai-prompt-kit/default-campaign/theme.json` | Must run `bun scripts/generate-ai-prompt-kit.ts` so `run-validator.ts` Stage `[8/8]` parity passes; add regression checks in [`tests/sprite_mapping.test.ts`](../tests/sprite_mapping.test.ts) |
| **Attributions panel in Settings (`index.html`, `settings.ui.ts`) & `CREDITS.md`** | `catalog.json` + `pack.json` `attribution` + engine notice (`ROT.js`) | Rendered safely (`textContent` / sanitized links) in Settings overlay (`#settings-attributions-container`) | Covers all 32rogues terms (`Copyright 2024 Seth Boyles`, no NFT/AI-ML, no redistribution), ~60 DCSS CC0 artists, and RLTiles notice |

---

## 5. Step-by-Step Implementation Plan & Integration Snippets

### Step 1 — Schemas for Attribution & Pack Catalog ([`src/types/campaign/meta.ts`](../src/types/campaign/meta.ts))
Add `SpritePackAttributionSchema`, attach optional `attribution` to `SpritePackSchema`, and define `SpritePackCatalogSchema`:

```ts
/** Zod schema describing license and author attribution metadata for a sprite pack. */
export const SpritePackAttributionSchema = z.object({
  author: z.string().min(1).describe('Creator or project collective name'),
  license: z.string().min(1).describe('Short SPDX or license label (e.g., CC0-1.0, Custom Non-Redistributable)'),
  licenseUrl: z.string().optional().describe('Optional reference URL for full license text'),
  sourceUrl: z.string().optional().describe('Optional upstream URL for the tileset'),
  restrictions: z.array(z.string()).optional().describe('Explicit license constraints (e.g., No NFT/AI-ML)'),
  notes: z.string().optional().describe('Additional attribution or distribution notes'),
  contributors: z.array(z.string()).optional().describe('Optional individual contributor list')
});
export type SpritePackAttribution = z.infer<typeof SpritePackAttributionSchema>;

export const SpritePackSchema = z.object({
  id: z.string().min(1).describe('Unique Sprite Pack Identifier'),
  name: z.string().min(1).describe('Human-readable Sprite Pack Name'),
  description: z.string().optional().describe('Optional Sprite Pack Description'),
  attribution: SpritePackAttributionSchema.optional().describe('Creator, license, and credit metadata'),
  spriteSheets: z.record(z.string(), SpriteSheetSourceSchema)
});

/** Catalog entry listing a discoverable sprite pack in `public/data/sprite_packs/catalog.json`. */
export const SpritePackCatalogEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  selectableInSettings: z.boolean().default(true),
  fallbackPackIds: z.array(z.string().min(1)).optional(),
  attribution: SpritePackAttributionSchema.optional()
});

export const SpritePackCatalogSchema = z.object({
  packs: z.array(SpritePackCatalogEntrySchema)
});
export type SpritePackCatalog = z.infer<typeof SpritePackCatalogSchema>;
```

Re-export `SpritePackAttribution`, `SpritePackAttributionSchema`, `SpritePackCatalog`, `SpritePackCatalogEntry`, and `SpritePackCatalogSchema` from [`src/types/campaign.types.ts`](../src/types/campaign.types.ts).

---

### Step 2 — Priority-Ordered Per-`spriteId` Fallback & User Pack Preference Resolution ([`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts))
Fix whole-sheet clobbering so `spritePacks` (`["dcss", "32rogues"]`) stacks **fallback -> primary** into `compositeAtlas` (higher-priority pack overwrites individual `spriteId` coordinates while preserving every fallback sprite not redefined), and add pure `resolveEffectiveThemeWithPreference`:

```ts
export const DEFAULT_PREFERRED_SPRITE_PACK = 'auto';
export const SPRITE_PACKS_CATALOG_FILENAME = 'catalog.json';

/**
 * Returns an effective `ThemeConfig` prioritizing a player's `preferredSpritePack` override
 * (keeping the campaign's declared packs behind it as fallbacks) when sprite mode is active.
 */
export function resolveEffectiveThemeWithPreference(
  theme: ThemeConfig,
  preferredSpritePack: string | undefined,
  catalogFallbacks?: ReadonlyArray<string>
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

  const orderedRefs: SpritePackRef[] = [preferredSpritePack];
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
```

And in `resolveThemeSpriteSheets(theme)`:
```ts
  const overrideSheetIds = new Set<string>(Object.keys(theme.spriteSheets ?? {}));

  if (theme.spritePacks) {
    // Iterate lowest-priority fallback -> index 0 primary so compositeAtlas draws/maps
    // fallback sprites first and lets primary pack entries override per spriteId cleanly.
    for (let i = theme.spritePacks.length - 1; i >= 0; i--) {
      const { packId, includeSheets } = normalizeSpritePackRef(theme.spritePacks[i]!);
      const pack = loadedPacks[packId];
      if (!pack) continue;

      const sheetIds =
        includeSheets && includeSheets.length > 0 ? includeSheets : Object.keys(pack.spriteSheets);
      for (const sheetId of sheetIds) {
        if (overrideSheetIds.has(sheetId)) continue; // Campaign sheet with same ID replaces pack sheet
        const sheet = pack.spriteSheets[sheetId];
        if (sheet) {
          merged[`${packId}__${sheetId}`] = sheet;
        }
      }
    }
  }
```
Notice this preserves **both**:
1. Campaign-local sheet replacement (if a campaign declares `spriteSheets.monsters`, it cleanly replaces any pack's `monsters` sheet and renders last).
2. Cross-pack per-`spriteId` fallback (e.g., `32rogues__monsters` draws first, `dcss__monsters` overlays `monster_goblin` with DCSS art while `32rogues`'s fallback-only IDs stay mapped in `mergedTileMap`!).

---

### Step 3 — User Setting + On-Demand Pack Hydration + Live Re-Render
1. **[`src/core/settings.ts`](../src/core/settings.ts):**
   - Add `preferredSpritePack: string` to `VisualFeedbackSettings` (default: `DEFAULT_PREFERRED_SPRITE_PACK`, `'auto'`).
2. **[`src/core/loader/sprite_pack_loader.ts`](../src/core/loader/sprite_pack_loader.ts):**
   - Add `loadSpritePackCatalog(): Promise<SpritePackCatalog>` (fetches `${SPRITE_PACKS_DATA_SUBPATH}/${SPRITE_PACKS_CATALOG_FILENAME}`, cached cleanly, returns `{ packs: [] }` on 404 in legacy test fixtures).
   - Add `hydrateCampaignSpritePacksForTheme(campaign: CampaignData, theme: ThemeConfig): Promise<CampaignData>` so any pack IDs injected by `preferredSpritePack` (and `catalog.fallbackPackIds`) are hydrated before atlas composition.
3. **[`src/rendering/display.ts`](../src/rendering/display.ts) & [`src/rendering/procedural_sprites.ts`](../src/rendering/procedural_sprites.ts) & [`src/rendering/viewport_snapshot.ts`](../src/rendering/viewport_snapshot.ts):**
   - Resolve `effectiveTheme = resolveEffectiveThemeWithPreference(campaign.theme, getSettings().visualFeedback.preferredSpritePack)` for playback rendering (while Editor & Validator keep using raw `campaign.theme` directly!).
   - In [`src/core/session/session_settings.ts`](../src/core/session/session_settings.ts) (`bindSettingsControls`), when `setting-sprite-pack` changes mid-run: persist setting, hydrate selected pack onto active campaign via `hydrateCampaignSpritePacksForTheme`, call `configureDisplayForCampaign` + `syncFogOverlayCanvas` + `syncDisplayLayout`, `invalidateViewportSnapshot()`, and `markAllDomainsDirty()`.

---

### Step 4 — Offline Content & Asset Packers
1. **Pure PNG Stitcher & Pack Builder ([`scripts/pack-dcss-sprites.ts`](../scripts/pack-dcss-sprites.ts)):**
   - Zero-dependency pure TypeScript PNG decoder/encoder using `node:zlib` (`inflateSync` / `deflateSync`, supporting all PNG filter modes `0–4` and color types `0/2/3/4/6`, normalizing every tile to `32×32` RGBA).
   - Reads **all** `32×32` PNGs from:
     - `scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/dungeon/` -> `sheets/dungeon.png` (`dungeon` sheet)
     - `scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/monster/` -> `sheets/monsters.png` (`monsters` sheet)
     - `scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/item/` -> `sheets/items.png` (`items` sheet)
     - `scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/player/base/` + iconic presets -> `sheets/actors.png` (`actors` sheet)
     - `scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/player/` (all `975` modular paperdoll layers) -> `sheets/player_layers.png` (`player_layers` sheet)
     - `scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/effect/` -> `sheets/effects.png` (`effects` sheet)
     - `scratch/crawl-tiles/crawl-tiles Oct-5-2010/spells/` (`156`) + `DCSS Full/gui/spells/` -> `sheets/spells.png` (`spells` sheet)
     - `scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/misc/` + `emissaries/` -> `sheets/misc.png` (`misc` sheet)
     - `scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/gui/` -> `sheets/gui.png` (`gui` sheet)
   - Emits canonical IDs (`dcss_<category>_<path_slug>`) **plus** explicit semantic aliases matching every `tile_*`, `actor_*`, `monster_*`, and `item_*` referenced in `default`, `dnd35e-crypt`, `realms-of-shroudgarde`, and `public/data/rulesets/dnd35e/items/` so **all existing campaigns pass `collectMissingSpriteMappings` with 0 missing sprites under `dcss` alone**.
   - Parses the full artist list from [`Dungeon Crawl Stone Soup Full/README.txt`](../scratch/crawl-tiles/Dungeon%20Crawl%20Stone%20Soup%20Full/README.txt) into `dcss/pack.json`'s `attribution.contributors` + writes `public/data/sprite_packs/dcss/LICENSE.txt` and `NOTICE.txt`.
2. **Expand `32rogues` Pack ([`scripts/generate_sprite_mappings.ts`](../scripts/generate_sprite_mappings.ts)):**
   - Copy `animals.png`, `animated-tiles.png`, `autotiles.png`, `items-palette-swaps.png` from `references/tilesets/32rogues/` to `public/data/sprite_packs/32rogues/sprites/` (or `tiles/`), parse `animals.txt`, `animated-tiles.txt` (`32×32` cell parsing with dimension verification!), and add `32rogues` full `attribution` (`Copyright 2024 Seth Boyles`, constraints, source info) into `public/data/sprite_packs/32rogues/pack.json`.
   - Keep `spriteSheets` keys clean (`tiles`, `rogues`, `monsters`, `items`, `animals`, `animated_tiles`) and verify every PNG cell coordinate stays within image bounds!
3. **Pack Catalog ([`public/data/sprite_packs/catalog.json`](../public/data/sprite_packs/catalog.json)), [`CREDITS.md`](../CREDITS.md) & `rltiles-pack` Archive:**
   - List `dcss` (`"DCSS Stone Soup (CC0 32×32)"`) and `32rogues` (`"32rogues Fantasy Set (Fallback)"`, `fallbackPackIds: ["dcss"]`), plus complete attribution entries for Seth Boyles (`32rogues`), Dungeon Crawl Stone Soup contributors (`~60` names), `RLTiles`, and `ROT.js`.
   - Copy/move [`scratch/ rltiles-pack/`](../scratch/%20rltiles-pack/) into `docs/archive/rltiles-pack/` (retaining `attribution.txt` + all 26 PNG sheets + a brief `README.md` note on future isometric renderer support).

---

### Step 5 — Campaigns & D&D 3.5e SRD Sprite Upgrades
- Update `theme.json` in `public/data/campaigns/default/`, `dnd35e-crypt/`, `realms-of-shroudgarde/` + [`scripts/build-realms-of-shroudgarde.ts`](../scripts/build-realms-of-shroudgarde.ts):
  ```json
  "spritePacks": [
    {
      "packId": "dcss",
      "includeSheets": ["dungeon", "monsters", "items", "actors", "effects", "spells", "misc"]
    },
    "32rogues"
  ]
  ```
  *(Omits heavy `gui` and `player_layers` sheets from default atlas boot unless opted in, keeping browser startup lean while `dcss` & `32rogues` provide complete sprite coverage.)*
- Upgrade duplicated SRD item `spriteId`s in `public/data/rulesets/dnd35e/items/` (e.g. distinct DCSS sprites for greataxes, battleaxes, halberds, shields, belts, boots, rings, amulets, wands, staves, potions, scrolls) and optionally assign richer `dcss_*` sprites to campaign doors, altars, fountains, bosses, and creatures in `dnd35e-crypt` and `realms-of-shroudgarde` — every `dcss_*` ID works identically whether the player selects `dcss` or `32rogues` (via fallback to `dcss`!).
- Regenerate `ai-prompt-kit` via `bun scripts/generate-ai-prompt-kit.ts`.

---

### Step 6 — Settings UI (`Tileset Pack` Selector + `Credits & Attributions` Section) & Validator Parity
- **[`index.html`](../index.html) & [`src/rendering/ui/settings.ui.ts`](../src/rendering/ui/settings.ui.ts):**
  - Add `<label class="settings-label"><span>Tileset Pack</span><select id="setting-sprite-pack" class="settings-select"><option value="auto">Auto (Campaign Default)</option></select></label>` inside Accessibility & Visuals, dynamically populated from `loadSpritePackCatalog()`.
  - Add `<div class="settings-group"><h3 class="settings-group-title">Credits &amp; Attributions</h3><div id="settings-attributions-container"></div></div>` displaying pack licenses, restrictions (`NO NFT/AI/ML`, `No Redistribution` for `32rogues`, `CC0 1.0` for `DCSS`), upstream links, and expandable contributor lists cleanly from `catalog.json` / `pack.json`.
- **[`scripts/run-validator.ts`](../scripts/run-validator.ts) & [`tests/sprite_mapping.test.ts`](../tests/sprite_mapping.test.ts):**
  - Validate `public/data/sprite_packs/catalog.json` against `SpritePackCatalogSchema`, check all catalog entries exist on disk, verify every `tileMap` pixel coordinate lies inside its PNG's actual dimensions, and test both `resolveThemeWithPreference` and per-`spriteId` fallback merging (`["dcss", "32rogues"]` vs `["32rogues", "dcss"]`).
  - Verify `realms-of-shroudgarde`, `dnd35e-crypt`, and `default` pass `collectMissingSpriteMappings` with `0` errors both with `dcss` alone and with `["32rogues", "dcss"]`.

---

## 6. Verification Plan (Before Marking Complete)
1. Generate `public/data/sprite_packs/dcss/` (`bun run scripts/pack-dcss-sprites.ts`), sync `32rogues` (`bun run scripts/generate_sprite_mappings.ts`), and sync `ai-prompt-kit`.
2. Update `docs/ssot/ssot_console.json` if any new `src/` files are added, and run `bun scripts/map-codebase.ts`.
3. Run `./verify.sh` across all 8 stages (`tsc`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `build`, `run-validator.ts`).
