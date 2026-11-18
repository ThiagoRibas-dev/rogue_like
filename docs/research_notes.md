# Research Notes — DCSS Master Sprite Pack, Multi-Pack Fallback, User Tileset Selection & Full Attribution

## 1. Architectural Standards & Constraints Baseline

Reviewed against [`AGENTS.md`](../AGENTS.md), [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md), and [`docs/SSOT_CONSOLE.md`](./SSOT_CONSOLE.md):

- **Three-Tier Placement (Rule 16):**
  - **Tier 1 (Core Console Engine — `src/types/`, `src/utils/`, `src/core/`, `src/rendering/`, `src/editor/`):** Extend `SpritePackSchema` declaratively with optional `attribution` / license metadata (and optional `spritePacks` catalog discovery), evolve [`resolveThemeSpriteSheets`](../src/utils/sprite_pack.ts) to support per-`spriteId` multi-pack fallback and user-selected pack overrides without breaking campaign-specific `spriteSheets`, wire a data-driven Tileset Pack selector + Attributions/Credits UI in Console Settings/Modals, and enforce validation & license/asset parity in [`scripts/run-validator.ts`](../scripts/run-validator.ts).
  - **Tier 2 (Ruleset Cartridges):** Unchanged in coupling — ruleset-neutral Console rendering stays separate. Any D&D 3.5e SRD item/spell/entity `spriteId` improvements remain purely Tier 3 JSON updates (`public/data/rulesets/dnd35e/*.json`, `public/data/campaigns/*/`) backed by the new `dcss` pack.
  - **Tier 3 (System Content — `public/data/sprite_packs/`, `public/data/campaigns/`, `CREDITS.md` / `NOTICE`):** Comprehensive CC0 `dcss` sprite pack built deterministically from [`scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/`](../scratch/crawl-tiles/Dungeon%20Crawl%20Stone%20Soup%20Full/) (+ `crawl-tiles Oct-5-2010/spells/`), alongside [`public/data/sprite_packs/32rogues/`](../public/data/sprite_packs/32rogues/), canonical `spriteId` alias coverage, and full creator attribution records.
- **Zero Hardcoding (Rule 21):**
  - Available user-selectable tileset packs in Settings must be discovered declaratively (e.g., from a shared `public/data/sprite_packs/catalog.json` / pack `pack.json` metadata), never hardcoded as `'dcss'` / `'32rogues'` options in TypeScript or `index.html`.
  - Attributions displayed in-game must read directly from pack/catalog metadata + a central attributions manifest rather than hardcoded UI copy.
- **Module Layering (`.dependency-cruiser.cjs`) & Strict TS:**
  - `src/types/` imports nothing upward; `src/utils/sprite_pack.ts` imports only `src/types/`; headless modules never import `src/rendering/` or `src/editor/`.
  - Obey `exactOptionalPropertyTypes: true`, zero `any`, explicit return types on all functions, and update `docs/ssot/ssot_console.json` if new `.ts` files are created.

---

## 2. Asset Inventory & Licensing / Attribution Audit

### 2.1 Assets Currently on Disk

| Source Directory | Count & Dimensions | Perspective / Compatibility | License & Restrictions | Author / Source Attribution |
| :--- | :--- | :--- | :--- | :--- |
| [`public/data/sprite_packs/32rogues/`](../public/data/sprite_packs/32rogues/) + [`references/tilesets/32rogues/`](../references/tilesets/32rogues/) | **Packed today:** `409` sprites across 4 sheets (`tiles`: 132, `rogues`: 40, `monsters`: 64, `items`: 149; all `32×32`). **Unpacked in references:** `animals.png`, `animated-tiles.png`, `autotiles.png`, `items-palette-swaps.png` | `32×32` orthogonal pixel art — native engine format | **Proprietary Free-Use License** (`Copyright 2024 Seth Boyles`, [`references/tilesets/32rogues/LICENSE.txt`](../references/tilesets/32rogues/LICENSE.txt)): Free for commercial & non-commercial projects; **NO NFT/blockchain**; **NO generative AI or machine learning**; modifications allowed; **may NOT redistribute or resell**; credit appreciated | Seth Boyles (`32rogues` — itch.io / BlueSky / Mastodon, Copyright 2024 Seth Boyles) |
| [`scratch/crawl-tiles/Dungeon Crawl Stone Soup Full/`](../scratch/crawl-tiles/Dungeon%20Crawl%20Stone%20Soup%20Full/) | **6,029** PNGs, **100% uniform `32×32`** (`dungeon`: 1,483; `monster`: 1,282; `player`: 975; `item`: 957; `misc`: 582; `gui`: 500; `effect`: 238; `emissaries`: 12) | `32×32` orthogonal 3/4 pixel art — matches `32rogues` cell size cleanly | **CC0 1.0 Universal (Public Domain Dedication)** ([`LICENSE.txt`](../scratch/crawl-tiles/Dungeon%20Crawl%20Stone%20Soup%20Full/LICENSE.txt), [`README.txt`](../scratch/crawl-tiles/Dungeon%20Crawl%20Stone%20Soup%20Full/README.txt)): Free for any purpose including redistribution; credit encouraged by convention | Dungeon Crawl Stone Soup (`https://github.com/crawl/tiles/tree/master/releases`), OpenGameArt `dungeon-crawl-32x32-tiles` & `-supplemental`, ~60 named DCSS contributors (`README.txt`), and original `RLTiles` (`http://rltiles.sf.net`) |
| [`scratch/crawl-tiles/crawl-tiles Oct-5-2010/`](../scratch/crawl-tiles/crawl-tiles%20Oct-5-2010/) | `3,039` PNGs (`2,988` `32×32` + `51` non-`32×32`), notably **`spells/`** (`156` uniform `32×32` spell/school icons) | `32×32` (`spells/` is cleanly `32×32`; older `dc-*` mostly superseded by `DCSS Full`) | **CC0 / Public Domain** ([`attribution.txt`](../scratch/crawl-tiles/attribution.txt)) | Crawl-tiles contributors (`utility/Filtered List.txt`) & OpenGameArt `crawl-tiles` |
| [`scratch/crawl-tiles/ProjectUtumno_full.png`](../scratch/crawl-tiles/ProjectUtumno_full.png) & [`DungeonCrawl_ProjectUtumnoTileset.png`](../scratch/crawl-tiles/DungeonCrawl_ProjectUtumnoTileset.png) | `2048×3040` (`64×95` @ `32×32`) & `2048×1536` (`64×48` @ `32×32`) | Pre-stitched atlases without accompanying `.txt` coordinate index | **CC0** (`crawl-tiles/attribution.txt`) | Same DCSS / OpenGameArt contributors ("Project Utumno" combined sheet) |
| [`scratch/ rltiles-pack/`](../scratch/%20rltiles-pack/) | `26` PNGs (`64×64.png` `1024×768` + 25 `512×192` biome/wall sheets) | **64×64 Isometric** — **incompatible** with current `32×32` orthogonal `ROT.Display` tile renderer | **Public Domain** ([`attribution.txt`](../scratch/%20rltiles-pack/attribution.txt)): Requires notice if distributed ("Part of (or All) the graphic tiles used in this program is the public domain roguelike tileset 'RLTiles'...") | `RLTiles` artists (`http://rltiles.sourceforge.net/author.html`, `http://rltiles.sf.net`) |

### 2.2 Critical Licensing Findings (`32rogues` Compliance & Attributions)

1. **Redistribution Boundary for `32rogues`:**
   - [`references/tilesets/32rogues/LICENSE.txt`](../references/tilesets/32rogues/LICENSE.txt) allows using (and modifying) `32rogues` in our non-NFT, non-AI/ML roguelike game, **but explicitly states *"You may not redistribute or resell it."***
   - Unlike `DCSS` (`CC0 1.0`, completely unrestricted redistribution), committing raw `32rogues` `.png` files into a **public** git repository or distributing standalone pack archives could cross the redistribution boundary, whereas compiled game builds distributed on itch.io (especially with `dcss` as the open CC0 base pack) or keeping `32rogues` optional / gitignored outside private builds avoids bundling/redistributing standalone raw sheets unintentionally.
   - Making **`dcss` (CC0 1.0)** the primary / default comprehensive base pack cleanly removes hard dependency on `32rogues`: if `32rogues` is absent in a stripped/public clone or disabled by a pack filter, the game **still renders 100% of entities, items, and dungeon tiles via `dcss`!**
2. **Attribution Coverage ("Regardless of Whether License Requires It"):**
   - Neither `README.md`, `index.html`, nor any in-game modal currently contains a Credits / Attributions notice for `32rogues`, `DCSS` (`~60` artists + RLTiles heritage), or `ROT.js`.
   - Adding:
     1. Declarative **`attribution`** metadata (`author`, `license`, `licenseUrl`, `sourceUrl`, `notes`, `contributors`) on `SpritePackSchema` (`pack.json`) and in a shared `CREDITS.md` / `NOTICE.md` at repo root.
     2. An accessible **"Credits & Attributions"** modal/section reachable from the Title Screen and/or Settings UI (`index.html` + `settings.ui.ts`) that renders active sprite pack attributions cleanly from the pack/catalog data.
     3. Explicit preservation of all `32rogues` exclusions (non-NFT/blockchain, non-AI/ML training, `Copyright 2024 Seth Boyles`) in `CREDITS.md` and `32rogues/pack.json`.

---

## 3. Codebase Integration Points & Gaps Found

### 3.1 Multi-Pack Merging & Per-`spriteId` Fallback Gap

1. **Current Sheet-Key Clobbering in [`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts):**
   - `resolveThemeSpriteSheets(theme)` currently iterates `theme.spritePacks` left-to-right and sets `merged[sheetId] = sheet`, then overlays `theme.spriteSheets` (`merged[sheetId] = sheet`).
   - Because `compositeAtlas(sheets, basePath)` in [`src/rendering/sprite_atlas.ts`](../src/rendering/sprite_atlas.ts#L55-L81) iterates `Object.entries(sheets)` in order and sets `mergedTileMap[spriteId] = [x, y + yOffset]` (later sheets overwrite earlier `spriteId`s cleanly while preserving un-overwritten keys from earlier sheets!):
     - **Problem 1:** If Pack 1 (`32rogues`) and Pack 2 (`dcss`) both use the same sheet IDs (`"tiles"`, `"monsters"`, `"items"`), `merged[sheetId] = sheet` causes Pack 2 to **completely erase** Pack 1's sheet rather than letting Pack 2 fill missing `spriteId`s!
     - **Problem 2:** Conversely, if `spritePacks` means `[primary, fallback]`, iterating left-to-right into `compositeAtlas` makes the **last** entry overwrite the first! True `[primary, fallback]` priority requires compositing lower-priority fallback sheets **before** higher-priority primary sheets (with namespaced sheet keys like `${packId}:${sheetId}` for packed sheets), while campaign-local `theme.spriteSheets` overrides still compose **last** (highest priority)!
   - **Clean Solution:**
     - Distinguish pack-sourced sheets vs campaign-local overrides: either name pack sheets cleanly with pack-scoped keys during resolution (e.g. `${packId}:${sheetId}` — except preserving exact sheet replacement if a campaign intentionally declares the same `sheetId` override, OR let `theme.spritePacks` entries compose from lowest-priority fallback -> highest-priority primary with scoped keys `${packId}:${sheetId}`, while campaign `theme.spriteSheets` matches bare `sheetId` to replace or append on top!).
     - Even better: check [`src/rendering/sprite_keys.ts`](../src/rendering/sprite_keys.ts), [`src/editor/campaign_validator.ts`](../src/editor/campaign_validator.ts), and [`src/rendering/ui/ui_utils.ts`](../src/rendering/ui/ui_utils.ts) — ALL THREE call `resolveThemeSpriteSheets(theme)`! Making `resolveThemeSpriteSheets` return the priority-ordered dictionary guarantees `compositeAtlas`, `getAvailableSpriteKeys`, `collectMissingSpriteMappings`, and editor sprite dropdowns behave **100% identically**.

### 3.2 Canonical `spriteId` Compatibility (`55`–`75` in Campaigns, `160` in D&D 3.5e SRD Items)

- Campaigns (`default`: `55` unique IDs, `dnd35e-crypt`: `63` unique IDs, `realms-of-shroudgarde`: `75` unique IDs) and `public/data/rulesets/dnd35e/items/` (`160` entries) currently reference `32rogues` sprite IDs (`tile_*`, `actor_*`, `monster_*`, `item_*`) — with many SRD items forced to reuse `"item_ankh"` or `"item_long_sword"`.
- Notice [`SpriteSheetSourceSchema`](../src/types/campaign/meta.ts#L144-L156): `tileMap` supports mapping **multiple `spriteId` keys** to the same pixel offset (`[x, y]`), or a sheet/pack can include canonical `32rogues`-compatible ID aliases **plus** rich `dcss_*` sprites!
- That gives us the best of both worlds:
  1. Every existing `tile_*`, `actor_*`, `monster_*`, `item_*` used across `default`, `dnd35e-crypt`, `realms-of-shroudgarde`, and `dnd35e` SRD items resolves cleanly in `dcss` (`0` missing sprite errors even when `32rogues` is disabled or used as fallback!).
  2. Dedicated D&D 3.5e items (`adamantine_greataxe`, `amulet_*`, `belt_*`, `boots_*`, `ring_*`, `potion_*`, `scroll_*`, `wand_*`, `staff_*`, `full_plate`, etc.) and rich `realms-of-shroudgarde` / `dnd35e-crypt` monsters/terrain can adopt distinct `dcss_*` sprites over time without losing `32rogues` fallback!
  3. And what if a user picks **`32rogues`** in Settings while playing a campaign that uses `dcss_*` IDs (or vice versa)? Because the active pack resolves with **fallback** (`["32rogues", "dcss"]`), any `dcss_*` sprite not present in `32rogues` falls back seamlessly to `dcss`, while shared canonical `actor_*`/`monster_*`/`tile_*`/`item_*` sprites switch to `32rogues` art!

### 3.3 Packing Strategy for `dcss` (`6,029` + `156` PNGs)

- Packing all ~6,185 PNGs into a single raw sheet would produce a ~2528×2528+ PNG (~3–5 MB), slow down `compositeAtlas`, and waste browser GPU memory if a user never opens the GUI/player-paperdoll sheets.
- Instead, we can slice `dcss` declaratively inside `public/data/sprite_packs/dcss/pack.json` into logical category sheets (generated cleanly by a deterministic script `scripts/pack-dcss-sprites.ts` using PNG chunk / `sharp` or pure JS PNG encoder/decoder, wait — verify available tooling before picking PNG library in implementation plan!):
  - Core gameplay sheets (small & fast to download/composite):
    - `dungeon` (`DCSS Full/dungeon/` — walls, floors, doors, stairs, chests, altars, fountains, portals)
    - `monsters` (`DCSS Full/monster/` — all D&D/roguelike creatures)
    - `items` (`DCSS Full/item/` — weapons, armor, shields, potions, scrolls, wands, staves, rings, amulets, gold, food)
    - `actors` (`DCSS Full/player/base/` + iconic humanoid class/NPC sprites or curated NPC sprites)
    - `effects` (`DCSS Full/effect/` — fire, ice, lightning, poison, spells, blood, telegraphs)
    - `spells` (`Oct-5-2010/spells/` + `DCSS Full/gui/spells/` — 32×32 spell & ability icons for hotbar/spellbook!)
    - `misc` (`DCSS Full/misc/` — traps, runes, props, markers)
  - Future / optional paperdoll & UI sheets (`player_layers`, `gui`, `emissaries`) available via `pack.json` or cherry-picked cleanly with `includeSheets` without penalizing initial canvas load!
- Also check `ProjectUtumno_full.png` vs `DCSS Full/`: `Dungeon Crawl Stone Soup Full/` has individual **named** PNG paths (`monster/undead/skeleton_humanoid.png`, `item/weapon/greataxe1.png`, `dungeon/doors/closed_door.png`), making automated ID naming + fuzzy/semantic matching against `32rogues` IDs & SRD item IDs 100x more maintainable than guessing anonymous grid coordinates in `ProjectUtumno_full.png`.

### 3.4 User-Selectable Tileset Preference & Settings Integration

- Current Settings ([`src/core/settings.ts`](../src/core/settings.ts), [`src/rendering/ui/settings.ui.ts`](../src/rendering/ui/settings.ui.ts), [`index.html`](../index.html)):
  - Has `visualFeedback.renderMode: 'auto' | 'sprites' | 'ascii'` + HUD dock toggle button [`toggleRenderMode`](../src/rendering/ui/hud_dock.ui.ts#L157-L188).
  - Does **not** have a user-selectable tileset pack preference (`preferredSpritePack?: string`) or preset picker.
- Wait — notice an architectural interaction across **all** campaign/render entrypoints when a user switches tileset pack in Settings:
  1. [`src/core/loader/sprite_pack_loader.ts`](../src/core/loader/sprite_pack_loader.ts) currently only hydrates packs referenced in `campaign.theme.spritePacks`! If a user selects `"32rogues"` (when the campaign specified `"dcss"`) or `"dcss"` (when the campaign specified `"32rogues"`), [`configureDisplayForCampaign`](../src/rendering/display.ts) needs that user-selected pack hydrated on demand before compositing the atlas!
  2. [`src/rendering/ui/settings.ui.ts`](../src/rendering/ui/settings.ui.ts) needs a `<select id="setting-sprite-pack">` (`Campaign Default`, plus options loaded declaratively from `public/data/sprite_packs/catalog.json`!), and changing it while a game is running should trigger live re-hydration + [`configureDisplayForCampaign`](../src/rendering/display.ts) + `syncFogOverlayCanvas` + `invalidateViewportSnapshot` cleanly (just like [`toggleRenderMode`](../src/rendering/ui/hud_dock.ui.ts#L157) already does).
  3. Notice **ASCII campaigns** (`shroudgarde`, `megacampaign`): they have NO `spritePacks` and NO `spriteId`s on templates! When `renderMode === 'auto'` on an ASCII campaign, `isEffectiveSpriteMode` returns `false` — user selecting a `preferredSpritePack` must **only** apply to sprite-enabled campaigns (when `campaignUsesSprites(campaign)` or `renderMode === 'sprites'`), preserving pure ASCII campaigns as ASCII by default!
  4. **Settings vs Editor purity:** `Campaign Editor` preview and `scripts/run-validator.ts` validate authored `campaign.theme` directly without applying local user browser `settings`, whereas runtime `configureDisplayForCampaign` / `viewport_snapshot` respects user `settings` (`resolveEffectiveThemeForPlayback(campaign.theme, settings)` or helper in `src/utils/sprite_pack.ts` receiving optional `preferredPackId`!).

### 3.5 Note on Existing Unpacked Assets in `references/` & `scratch/`

- `references/tilesets/32rogues/` also contains `animals.png` (`animals.txt`), `animated-tiles.png` (`animated-tiles.txt`), and `autotiles.png` (`autotiles.txt`) not yet in `public/data/sprite_packs/32rogues/pack.json`.
- `scratch/ rltiles-pack/` contains `64×64` **isometric** PNGs; our engine renders orthogonal `32×32` grids, so `rltiles-pack` should **not** be packed into 2D orthogonal packs right now (only attributed if kept/archived, or documented cleanly out of scope).

---

## 4. Mapping Tasks to Existing Systems (Upstream / Downstream / Lateral)

| Area / Task | Files & Symbols Touched | Architectural Rules & Interactions |
| :--- | :--- | :--- |
| **Schema & Attribution Metadata** | [`src/types/campaign/meta.ts`](../src/types/campaign/meta.ts) (`SpritePackSchema`, `SpritePackAttributionSchema`, `SpritePackCatalogSchema`) | Pure Tier 1 Zod schemas; keeps `exactOptionalPropertyTypes` and JSON serializability cleanly; backwards-compatible with existing `32rogues/pack.json` (`attribution` optional initially or added to all packs). |
| **Pack Catalog & Manifests** | `public/data/sprite_packs/catalog.json` (or `packs.json`), `public/data/sprite_packs/dcss/pack.json`, `public/data/sprite_packs/32rogues/pack.json`, `CREDITS.md` / `NOTICE.md` | Tier 3 declarative data (`Rule 21`): lists available packs, labels, licenses, and attributions without hardcoding pack IDs in TS. Validator checks catalog parity! |
| **DCSS Atlas Packer & Canonical Alias Mapper** | `scripts/pack-dcss-sprites.ts` -> outputs `public/data/sprite_packs/dcss/{pack.json,dungeon.png,monsters.png,items.png,actors.png,effects.png,spells.png,misc.png}` | Offline build script (`scripts/`); maps `DCSS Full` + `Oct-5-2010/spells` PNGs into clean `32×32` atlases, preserves `README.txt` artist list in `dcss/NOTICE.txt` & `attribution`, and generates canonical aliases so every `tile_*`/`actor_*`/`monster_*`/`item_*` in campaigns & D&D 3.5e SRD resolves. |
| **Priority-Ordered Per-`spriteId` Fallback Merging** | [`src/utils/sprite_pack.ts`](../src/utils/sprite_pack.ts) (`resolveThemeSpriteSheets`) | Single SSOT consumed by `compositeAtlas`, `sprite_keys.ts`, `procedural_sprites.ts`, `viewport_snapshot.ts`, and `editor/`. Resolves `spritePacks` from fallback -> primary so higher-priority packs win per `spriteId` instead of erasing whole sheets, with `theme.spriteSheets` last. |
| **On-Demand Pack Hydration & Runtime Switching** | [`src/core/loader/sprite_pack_loader.ts`](../src/core/loader/sprite_pack_loader.ts), [`src/core/settings.ts`](../src/core/settings.ts), [`src/rendering/display.ts`](../src/rendering/display.ts), [`src/rendering/ui/settings.ui.ts`](../src/rendering/ui/settings.ui.ts), [`src/rendering/ui/hud_dock.ui.ts`](../src/rendering/ui/hud_dock.ui.ts), [`index.html`](../index.html) | Adds `preferredSpritePack` (`'auto' \| string`) in `VisualFeedbackSettings`, loads pack catalog for Settings dropdown + in-game Credits/Attributions view, hydrates user-selected pack on demand + applies fallback pack, and re-composites `ROT.Display` live cleanly. |
| **Campaign Updates & SRD Sprite Enrichment** | [`public/data/campaigns/*/theme.json`](../public/data/campaigns/default/theme.json), `scripts/build-realms-of-shroudgarde.ts`, `scripts/generate-ai-prompt-kit.ts`, `public/data/rulesets/dnd35e/` (optional `spriteId` upgrades) | Campaigns declare e.g. `["dcss", "32rogues"]` or `["32rogues", "dcss"]` (depending on primary vs fallback choice); `ai-prompt-kit` mirror kept in sync for validator Stage `[8/8]`. |
| **Validator & Regression Tests** | [`scripts/run-validator.ts`](../scripts/run-validator.ts), [`tests/sprite_mapping.test.ts`](../tests/sprite_mapping.test.ts) | Validates `catalog.json`, pack `attribution`, missing PNGs, canonical fallback coverage across packs (`0` missing sprite mappings even under `dcss` alone!), and user override resolution parity. |

---

## 5. Open Questions Requiring User Confirmation Before Implementation Plan

Please confirm your preferences on these four points so I can draft [`docs/implementation_plan.md`](./implementation_plan.md) cleanly:

1. **`32rogues` Repository & Distribution Strategy (License Check):**
   [`references/tilesets/32rogues/LICENSE.txt`](../references/tilesets/32rogues/LICENSE.txt) forbids **redistribution or resale** (*"You may not redistribute or resell it"*, Copyright 2024 Seth Boyles, no NFT/blockchain, no AI/ML). Note `public/data/sprite_packs/32rogues/` and `references/tilesets/32rogues/` are currently tracked in this git repo:
   - **Option A:** Keep the repo private / itch.io compiled game build only, keep `32rogues` tracked alongside `dcss`, and document full attribution + license terms in `CREDITS.md`, `32rogues/pack.json`, and in-game Credits UI.
   - **Option B:** Make **`dcss` (CC0 1.0 Public Domain)** the **only** committed/default pack in git (gitignoring `32rogues` binaries or treating `32rogues` as an optional local creator-side pack via an import script for private/itch.io builds) if this repository will ever be public on GitHub.
2. **Default Visual Style & Fallback Order for Campaigns (`default`, `dnd35e-crypt`, `realms-of-shroudgarde`):**
   - **Option A (`dcss` Main Pack, `32rogues` Fallback/Mix or Optional Skin):** Set campaigns to `["dcss"]` (or `["dcss", "32rogues"]`) as default so DCSS covers terrain, monsters, 100+ SRD items, spells, and effects uniformly, while letting the player switch to `32rogues (with DCSS fallback)` in Settings.
   - **Option B (`32rogues` Primary, `dcss` Fallback for Everything Else):** Keep `32rogues`' iconic rogues/classic tiles on top (`["32rogues", "dcss"]`) and use `dcss` seamlessly as fallback for new monsters, D&D 3.5e items (`greataxe`, `full_plate`, rings, amulets, boots, belts), spells, and effects — also switchable in Settings.
   - **Option C (Per-Campaign Split):** Keep `default` (`classic` ruleset) using `32rogues` (`["32rogues", "dcss"]`), and switch D&D 3.5e campaigns (`dnd35e-crypt`, `realms-of-shroudgarde`) to `dcss` primary (`["dcss"]` or `["dcss", "32rogues"]`), while still giving the player a Settings override!
3. **`dcss` Pack Granularity & Included Assets:**
   - Pack all `6,029` `DCSS Full` PNGs + `156` `Oct-5-2010/spells` PNGs split cleanly by category sheet (`dungeon`, `monsters`, `items`, `actors`, `effects`, `spells`, `misc`, plus optional `gui` / `player_layers`) — **recommended** (~1.5–2.5 MB total, lazy/filtered via `includeSheets` where needed), **OR** pack a slimmer curated subset first?
   - Also: should we add `animals.png` / `animated-tiles.png` from `references/tilesets/32rogues/` into `32rogues/pack.json` while keeping `scratch/ rltiles-pack/` (64×64 isometric) un-packed?
4. **In-Game Attributions UI Placement:**
   - Put a **Credits & Licenses** panel/button inside the **Settings modal** (and/or a dedicated **Credits** button on the Title/Main Menu overlay) backed by `CREDITS.md` / `catalog.json` / `pack.json` `attribution` fields?
