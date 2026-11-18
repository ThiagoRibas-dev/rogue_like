# Research Notes — Shared Sprite Pack Repository & Per-Campaign Override Architecture

## 1. Architectural Standards & Constraints Baseline

Reviewed against [`AGENTS.md`](../AGENTS.md), [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md), and [`docs/SSOT_CONSOLE.md`](./SSOT_CONSOLE.md):

- **Three-Tier Placement (Rule 16):**
  - **Tier 1 (Core Console Engine — `src/types/`, `src/utils/`, `src/core/loader/`, `src/rendering/`, `src/editor/`):** Shared sprite pack schema (`SpritePackSchema`), pure pack/override sheet merger (`resolveThemeSpriteSheets`), pack loader + offline hydration, `compositeAtlas` per-sheet base-path resolution, and export stripping.
  - **Tier 2 (Ruleset Cartridges):** Unchanged — sprites remain completely ruleset-agnostic at Console level.
  - **Tier 3 (System Content — `public/data/sprite_packs/<packId>/`, `public/data/campaigns/*/theme.json`):** Centralized atlas bundle `public/data/sprite_packs/32rogues/` (`pack.json`, `tiles/tiles.png`, `sprites/{rogues,monsters,items}.png`) referenced declaratively via `"spritePackId": "32rogues"`, with optional per-campaign `"spriteSheets"` overrides.
- **Layer Boundaries (`.dependency-cruiser.cjs`):**
  - `src/types/` cannot import from `src/core/`, `src/utils/`, or `src/rendering/`.
  - `src/utils/` cannot import from `src/rendering/` or `src/editor/`.
  - Pure theme resolution logic (`resolveThemeSpriteSheets`, `stripTransientThemeHydration`) belongs in `src/utils/` (importing only `src/types/`), so **both** `src/rendering/`, `src/core/`, `src/editor/`, `scripts/`, and `tests/` can share a single SSOT entry point without layering violations.
- **ECS & Serialization Discipline:**
  - `GameState` components remain untouched; `CampaignData.theme` stays plain JSON-serializable (`Record<string, SpriteSheetSource>`).
  - Export/persistence (`writeCampaignToZip`) must strip runtime-hydrated pack payloads so authored `"spritePackId"` + overrides round-trip cleanly without re-inlining the 28 KB pack dictionary.
  - TypeScript strictness (`exactOptionalPropertyTypes: true`, no `any`, explicit return types).

---

## 2. Current State & Duplication Audit

1. **Duplicated Data & Binaries Across Campaigns:**
   - [`public/data/campaigns/default/`](../public/data/campaigns/default), [`public/data/campaigns/dnd35e-crypt/`](../public/data/campaigns/dnd35e-crypt), and [`public/data/campaigns/realms-of-shroudgarde/`](../public/data/campaigns/realms-of-shroudgarde) currently duplicate:
     - **12 identical `.png` binaries** (`tiles.png`, `rogues.png`, `monsters.png`, `items.png` — identical SHA-256 across all 3 campaigns).
     - **3 copies of the ~1,590-line (`28 KB`) `spriteSheets` coordinate map** inside `theme.json`.
   - `default` and `dnd35e-crypt` have `diff -u` parity on `theme.json`, and `build-realms-of-shroudgarde.ts` copies both `theme.json` and the 4 PNGs from `dnd35e-crypt`.
   - ASCII campaigns (`shroudgarde`, `megacampaign`) have no `spriteSheets` and no `.png` files.

2. **All Readers of `campaign.theme.spriteSheets` (Upstream / Downstream / Lateral Mapping):**
   - **Schema & Types:**
     - `src/types/campaign/meta.ts`: `SpriteSheetSourceSchema` (`src`, `tileWidth`, `tileHeight`, `tileMap`) and `ThemeConfigSchema` (`colors`, `glyphs`, `ui`, `spriteSheets`).
   - **Loading & Offline Builders:**
     - `src/core/loader.ts`: `loadCampaign()` fetches JSONs (plus checks `sessionStorage` `editor_active_document` and IndexedDB `getInstalledCampaign(campaignId)`), then parses via `CampaignDataSchema.safeParse(data)`. Notice `installedCampaign` and `editor_active_document` bypass HTTP JSON fetches, so pack hydration must run across **all three** paths.
     - `tests/helpers.ts`: `loadCampaignFromDisk(id)` assembles campaign JSONs from disk using `CampaignCategorySchemas` before `CampaignDataSchema.parse(assembled)`.
     - `scripts/run-validator.ts`: `loadAndValidateZod(dir)` loads campaign JSONs from disk before running `validateCampaign` (`collectMissingSpriteMappings`, etc.).
   - **Rendering & Sprite Diagnostics:**
     - `src/rendering/sprite_atlas.ts`: `compositeAtlas(sheets, basePath, fallbackBasePath)` constructs image URLs from a single `${basePath}/${sheet.src}` for every sheet in the dictionary. Mixing shared pack sheets and campaign override sheets requires per-sheet base paths (`sheet.srcBasePath ?? basePath`).
     - `src/rendering/display.ts`: `configureDisplayForCampaign()` checks `isEffectiveSpriteMode(campaign)`, passes `campaign.theme.spriteSheets` to `compositeAtlas`, and `syncDisplayLayout()` reads `tileWidth` / `tileHeight` from the first configured sheet.
     - `src/rendering/procedural_sprites.ts`: `isEffectiveSpriteMode()` returns `Boolean(campaign.theme.spriteSheets && Object.keys(campaign.theme.spriteSheets).length > 0)` in `'auto'` mode.
     - `src/rendering/viewport_snapshot.ts:45`: checks `state.campaign.theme.spriteSheets` to decide `isTileMode` (`useSprites`).
     - `src/rendering/sprite_keys.ts:27`: `getAvailableSpriteKeys(campaign)` iterates `campaign.theme.spriteSheets` (used by both runtime diagnostics and `src/editor/validator/` / `scripts/run-validator.ts` / `tests/sprite_mapping.test.ts`).
   - **Editor, Forms & Persistence:**
     - `src/rendering/ui/area_editor.ts:58` & `src/rendering/ui/area_static_painter.ts:139`: check `doc.theme.spriteSheets !== undefined` to determine `isSpriteMode`.
     - `src/rendering/ui/ui_utils.ts:132`: enumerates `doc.theme?.spriteSheets` to build `spriteId` dropdown options in editor entity/tile/item forms.
     - `src/editor/workspace_file_service.ts`: `readCampaignFromZip()` and `writeCampaignToZip()` serialize `data.theme` directly into `theme.json`. Any transient pack cache stored on `theme` must be stripped cleanly in `writeCampaignToZip` (and omitted in authored JSONs).
   - **Tooling, Generators & Parity Checks:**
     - `scripts/generate_sprite_mappings.ts`: currently parses `references/tilesets/32rogues/*.txt` directly into `public/data/campaigns/default/theme.json`. Should target `public/data/sprite_packs/32rogues/pack.json`.
     - `scripts/build-realms-of-shroudgarde.ts`: currently copies `theme.json` and 4 PNGs from `dnd35e-crypt`. Should reference `"spritePackId": "32rogues"` cleanly without copying PNGs.
     - `scripts/run-validator.ts` (`validateAiPromptKitParity`) + `scripts/generate-ai-prompt-kit.ts`: `ai-prompt-kit/default-campaign/theme.json` is parity-checked against `public/data/campaigns/default/theme.json` during Stage `[8/8]`; must be regenerated after updating `default/theme.json`.
     - `tests/sprite_mapping.test.ts`: asserts `existsSync(join(campaignDir, sheet.src))` directly inside each campaign directory — must be updated to resolve via `sheet.srcBasePath` (relative to `public/`) when provided, validating pack PNG existence without requiring campaign copies.

---

## 3. Target Architecture Summary

1. **Shared Bundle Structure (`public/data/sprite_packs/<packId>/`):**
   - `public/data/sprite_packs/32rogues/pack.json`: `{ id, name, description, spriteSheets }` where `src` paths use clean asset subdirectories:
     - `"tiles/tiles.png"`
     - `"sprites/rogues.png"`
     - `"sprites/monsters.png"`
     - `"sprites/items.png"`
   - Campaign `theme.json` replaces the 28 KB `spriteSheets` block and duplicate PNGs with an ordered, composable **`spritePacks`** list supporting both whole-bundle IDs and sheet cherry-picking (`{ packId, includeSheets }`):
     ```json
     {
       "colors": { ... },
       "glyphs": { ... },
       "ui": { ... },
       "spritePacks": ["32rogues"]
     }
     ```
   - Optional campaign overrides stay in `campaign/theme.json` under `"spriteSheets"`:
     - **Cross-bundle mixing:** `"spritePacks": [{ "packId": "other_pack", "includeSheets": ["tiles"] }, { "packId": "32rogues", "includeSheets": ["rogues", "monsters", "items"] }]` merges sheets left-to-right while preserving each sheet's `srcBasePath`.
     - **Sheet replacement:** defining `"monsters": { "src": "sprites/custom_monsters.png", ... }` in `theme.spriteSheets` replaces the pack's `monsters` sheet cleanly.
     - **Partial per-`spriteId` override:** defining e.g. `"overrides": { "src": "sprites/overrides.png", "tileWidth": 32, "tileHeight": 32, "tileMap": { "actor_knight": [0, 0] } }` appends after pack sheets in `compositeAtlas`, overwriting only those `spriteId` coordinates while preserving the rest of `32rogues`.
   - **Validator Hygiene Gap Closed:** `scripts/run-validator.ts` currently calls `collectMissingSpriteMappings(campaign)` (which only warns on `tileMap` key mismatches and does not check PNG files on disk). It must validate `public/data/sprite_packs/*/pack.json` and fail with a blocking **error** on missing `spritePacks` entries, unknown `includeSheets`, or missing PNG files on disk.

2. **Single Source of Truth Helper (`src/utils/sprite_pack.ts`):**
   - `resolveThemeSpriteSheets(theme)` returns the ordered merged `Record<string, SpriteSheetSource>` across `theme.spritePacks` (`theme.loadedSpritePacks`) and campaign `theme.spriteSheets`.
   - **Notice why this is crucial:** replacing direct reads of `campaign.theme.spriteSheets` across `display.ts`, `procedural_sprites.ts`, `sprite_keys.ts`, `viewport_snapshot.ts`, `ui_utils.ts`, `area_editor.ts`, and `area_static_painter.ts` guarantees runtime, editor preview, validation, and form dropdowns always evaluate the exact same merged sheet dictionary.
