# Phase 48 Research Notes — Ring 2 Parallel Macro-World Simulation & Offline Legends Worldgen

**Milestones Covered:** 184, 185, 186 (`docs/MILESTONES.md` §Phase 48)  
**Baseline Commit:** `efe469d69` (`main`, Phase 47 complete — 457 tests passing across 67 files, 8/8 `./verify.sh` green)  
**Roadmap Status Note:** Phase 48 is the final phase of the Dwarf Fortress / RimWorld systemic substrate roadmap (Phases 45–48). Across the full `docs/MILESTONES.md`, **Phase 44 (Milestones 169–172 — Campaign Editor Rewrite on Shared Preact Primitives, Scoped Input & Unified Themes)** also remains marked `⚪ Planned` (deferred when pivoting from Phase 43 to Phase 45).

---

## 1. Reiteration of Governing Rules & Architectural Constraints

All Phase 48 designs strictly adhere to `AGENTS.md` and `docs/ARCHITECTURE.md`:

- **TypeScript Strictness (§3):** Zero `any`, zero magic gameplay values (all intervals, continental grid dimensions, weather bounds, and history simulation parameters must reside in named constants or Zod-validated JSON), explicit return types on every exported and internal function, `exactOptionalPropertyTypes: true` compliance, exhaustive `switch` statements guarded by `assertNever`, and flat guard-clause control flow.
- **ECS & Serialization Purity (§4):** Pure data interfaces with no methods; **zero `Map` or `Set`** inside ECS components, `MacroWorldState`, `LegendsArchive`, or `SerializedGameState` sub-objects (`Record<string, T>` and `ReadonlyArray<T>` only) so `src/core/save.ts` / `JSON.stringify` serialization stays deterministic and lossless.
- **Three-Tier Placement Heuristic (Rule 16):**
  - **Tier 1 (Core Console Engine):** `src/types/macro_world.types.ts`, `src/constants/macro_world.constants.ts`, `src/systems/macro/macro_world.system.ts`, `src/systems/macro/legends_simulator.ts`, `src/map/worldgen_continent.ts`, `src/systems/map/site_materializer.ts`, `src/worker/world_sim.worker.ts`, `src/worker/legends_worldgen.worker.ts`, `src/worker/worker_bridge.ts`, and `src/rendering/ui/modals/LegendsModal.tsx`. Zero ruleset-specific coupling.
  - **Tier 2 (Ruleset Cartridges):** Unchanged / 100% compatible via `RulesetContract` — caravan merchants, scarred survivors, historical figures, and tomb artifacts hydrate cleanly through standard `spawnEntity` / `spawnItem` pipelines so both `dnd35e` and `classic` cartridges inherit full statblock hydration automatically.
  - **Tier 3 (System & Campaign Content):** Optional declarative `macroWorld` config in `RulesConfigSchema` (`public/data/campaigns/*/rules.json`), with site, weather, and multi-century history showcased in `public/data/campaigns/default/` (`endless_frontier` + linked settlements/ruins) while preserving 0 errors / 0 warnings across all 5 campaigns (`default`, `dnd35e-crypt`, `megacampaign`, `realms-of-shroudgarde`, `shroudgarde`).
- **Universal Actor Symmetry & Narrative Reuse (Rule 18):** Historical figures, caravan masters, and scarred raid survivors use the exact same `IdentityComponent`, `ChronicleComponent`, `MemoryComponent`, `NemesisComponent`, `ShopComponent`, `NeedsComponent`, and `historicalLedger` event schemas — zero parallel lore or NPC schemas.
- **Zero Content-ID Branching (Rule 21 — "New Content Mod" Litmus Test):** Engine `.ts` files must never branch on specific faction IDs, site names, biome/tile IDs, item IDs, or entity template IDs (`if (factionId === 'bandits')`, `if (tileId === 'stone_wall')`, `if (itemId === 'longsword')`). Site archetypes, ruin/burn/caravan materialization stamps, faction role classification, and artifact templates must resolve declaratively from Zod schemas, `TileDefinition` properties (`burnedTileId`, `mineable`, `walkable`), and entity/item tags.
- **Dependency Cruiser & Headless Purity (`.dependency-cruiser.cjs`):** `src/systems/macro/`, `src/map/worldgen_continent.ts`, `src/systems/map/site_materializer.ts`, and `src/worker/*.worker.ts` must never import from `src/rendering/`, `src/editor/`, or concrete `src/rulesets/(classic|dnd35e)/`. Every Web Worker offload in `src/worker/worker_bridge.ts` must preserve automatic main-thread cooperative fallback when `isWorkerAvailable()` is false, guaranteeing identical deterministic behavior in headless `bun test`.

---

## 2. Existing Codebase Inventory & Milestone Mapping

### 2.1 Milestone 184 — Dedicated Ring 2 Macro-World Simulation Worker

**Target Files:** `src/worker/world_sim.worker.ts`, `src/systems/macro/macro_world.system.ts`, `src/types/macro_world.types.ts`, `src/constants/macro_world.constants.ts`

**Existing Substrate Already in Place:**
- `src/worker/worker_bridge.ts` & `src/worker/worker.types.ts`: Already implement the persistent pooled worker pattern (`pooledChunkWorker`), `isWorkerAvailable()` runtime detection, `WorkerRequest` / `WorkerResponse<T>` / `WorkerProgressPayload` contracts, and headless cooperative fallback.
- `src/core/simulation_cadence.ts` (`processTier3GlobalCadence`) & `src/systems/lifecycle.system.ts` (`runActorTurnStart` lines 66–75): Canonical Player turn-start world-clock and Tier 3 macro cadence boundary (ticks once per world turn across Turn-Based and RTwP).
- `src/systems/world_time_skip.ts` (`stepBulkMacroCadence`, `advanceWorldTimeBulk`, `advanceWorldTimeBulkAsync`): Canonical bulk rest/wait macro-simulation step loop.
- `src/systems/world_clock.system.ts`: Diurnal `readWorldClock` (`day`, `hour`, `minute`, `phaseId`), cleanly extendable with deterministic seasonal calendar helpers (`season`, `dayOfSeason`, `year`).
- `src/systems/world_events.system.ts`, `src/systems/scheme.system.ts`, `src/systems/rivalry.system.ts`, `src/systems/gossip.system.ts`, `src/systems/knowledge.system.ts`: Existing Tier 3 narrative, rumor, rivalry, and mastermind progression engines.
- `src/systems/physics/temperature_physics.ts`: Ambient temperature baseline (`DEFAULT_AMBIENT_TEMP_C`) that seasonal weather fronts can modulate for outdoor cells.

**Target Design & Determinism Protocol:**
1. **Isolated Seeded Pure Kernel (`advanceMacroWorldTicks`):**
   - Pure function taking `(macroWorld: MacroWorldState, targetTick: number)` using its own isolated seeded PRNG derived deterministically from `(worldSeed, macroTick)` — **never touching the main-thread `ROT.RNG` singleton**. This guarantees bit-for-bit identical simulation whether run inside `world_sim.worker.ts` or via main-thread fallback in `bun test`.
2. **Simulated Ring 2 Domains:**
   - **Settlement Economies:** Sites track population, prosperity, food/goods stock, garrison strength, controlling faction ID, and status (`intact | besieged | raided | burned | ruined | abandoned`).
   - **Caravan Routes:** Inter-site trade caravans advance along continental links carrying declarative `cargoTags` / `itemPoolTags`, escort strength, and local market arrival boosts (and can be ambushed along dangerous routes).
   - **Faction Troop Movements:** Faction warbands/armies patrol or march between sites, resolving border skirmishes, sieges, and raids that emit ordered `MacroSiteDelta` records.
   - **Off-Screen Scheme & Rumor Bridge:** Translates major Ring 2 outcomes into `historicalLedger` entries, `pendingRumors` propagations, and `DirectorBudget` / `TagsComponent` `areaMutation` adjustments when a Ring 2 event targets a registered campaign area.
   - **Seasonal Weather Fronts:** Moving weather fronts (`clear | rain | storm | blizzard | drought | heatwave | fog`) sweep across continental grid cells and modulate ambient outdoor temperature (`weatherAmbientTempDeltaC`) and sky illumination hints.
3. **Turn-Boundary Sync & Persistence:**
   - Persistent `world_sim.worker.ts` receives monotonic `tickBatchId` dispatches at `MACRO_WORLD_TICK_INTERVAL` boundaries via `worker_bridge.ts`. Returned `MacroTickDeltaBatch`es buffer in an ordered worker queue and apply strictly at deterministic turn boundaries (`lifecycle.system.ts` / `simulation_cadence.ts`), while `world_time_skip.ts` and headless tests run synchronous catch-up cleanly via `advanceMacroWorldTicks`.
   - `GameState.macroWorld?: MacroWorldState` (plain JSON records/arrays only) serializes cleanly inside `src/core/save.ts`.

---

### 2.2 Milestone 185 — Offline Multi-Century Legends Worldgen Worker

**Target Files:** `src/worker/legends_worldgen.worker.ts`, `src/map/worldgen_continent.ts`, `src/systems/macro/legends_simulator.ts`

**Existing Substrate Already in Place:**
- `src/map/chunk_generator.ts`: Already provides deterministic FNV/Murmur coordinate hashing and 3-octave value noise (`sampleFractalNoise`).
- `src/core/bootstrap.ts` (`startNewGame`) & `src/core/bootstrap/world_entities_bootstrap.ts` (`initializeCampaignWorldEntities`): Canonical startup initialization of `factionEntityIds`, `areaEntityIds`, `persistentEntities`, and `ChronicleComponent`s.
- `src/systems/chronicle.system.ts`, `src/systems/nemesis/`, `src/systems/rivalry.system.ts`, `src/systems/scheme.system.ts`, and `public/data/campaigns/default/identity_generation.json`: Shared identity, epithet, scar, hierarchy, and chronicle primitives ready for reuse.
- `src/rendering/ui/menus/LoadingOverlay.tsx`: Streaming async progress overlay already bound to `WorkerProgressPayload`.

**Target Design & Historical Simulation Loop:**
1. **Continental Generator (`src/map/worldgen_continent.ts`):**
   - Generates a coarse deterministic continental grid (configurable `worldWidth × worldHeight`, e.g., `32×32` regions mapped directly onto `streaming_overworld` chunk coordinates `(cx, cy)`) with elevation, rainfall, latitude temperature gradient, river networks, regional biomes, initial civilizations derived from campaign `factions.json` + declarative config, trade roads, settlements, and ancient dungeon/shrine sites.
2. **Cooperative Pre-Play Historical Simulator (`src/systems/macro/legends_simulator.ts` & `src/worker/legends_worldgen.worker.ts`):**
   - Generator-driven simulator stepping `N` years/centuries before Turn 1 while yielding `WorkerProgressPayload` updates per era/decade:
     - **Civilizations & Dynasties:** Succession lines (`dynastyId`, lineages), wars, truces, and territorial expansion across regional sites.
     - **Historical Figures (`HistoricalFigureRecord`):** Named actors forged with shared `identity_generation` pools who gain kills, scars, rivalries, scheme plots, and `ChronicleComponent` event IDs across their lifespans.
     - **Forged Artifacts (`HistoricalArtifactRecord`):** Unique relics recording creator figure ID, year forged, provenance owner history, and current resting site/tomb ID.
     - **Site Lifecycle:** Settlements founded -> prosper -> besieged -> raided/burned/razed into ancient ruins or rebuilt.
     - **Indexed `LegendsEventRecord[]`:** Chronological multi-century event archive grouped into named **Eras** (e.g., *Age of Founding*, *Age of Ash*) for fast UI filtering.
3. **Turn-1 World Seeding (`seedGameStateFromLegends`):**
   - Injects generated `MacroWorldState` (including `legends: LegendsArchive`) onto initial `GameState` during `startNewGame` (only when `macroWorld.enabled` is active).
   - Seeds surviving living historical figures into `persistentEntities` / `nemesisSlots` carrying authentic `ChronicleComponent` scars, core memories, and historical faction/personal grudges.
   - Seeds high-importance historical events into `historicalLedger` and faction/area `ChronicleComponent.eventExcerpts`.

---

### 2.3 Milestone 186 — Site Materialization on Chunk Wake, Legends Browser UI & Systemic Verification Sweep

**Target Files:** `src/systems/map/site_materializer.ts`, `src/rendering/ui/modals/LegendsModal.tsx`

**Existing Substrate Already in Place:**
- `src/systems/map/chunk_streaming.ts` (`updateStreamingWorldWindow`, lines 360–400): Exact Ring 0 chunk-wake hook (`wokenChunkKeys`) where newly hydrated chunks enter the active window before entities resume.
- `src/systems/map/map_wake_respawn.ts` (`wakeSavedAreaFloor`): Area wake hook for finite areas optionally mapped to a `macroSiteId`.
- `src/systems/construction.system.ts` & `src/map/map_accessor.ts`: Existing terrain mutation, fluid/temperature cell setters, and `CHUNK_DIRTY_PERSIST | CHUNK_DIRTY_REGION` cache invalidation.
- `src/rendering/ui/primitives/` (`ModalShell`, `Tabs`, `SplitPane`, `ListBox`, `TextInput`, `Badge`, `Button`) & `src/rendering/ui/core/AppUiRoot.tsx`: Accessible Preact UI substrate.
- **Complete `UIMode` Modal Wiring Map (verified against `UIMode.Ledger` across `src/`):**
  - `src/types/game-state.types.ts` (`UIMode.Legends`)
  - `src/types/intents/{intent.enum,ui.intents,intent.union}.ts` (`IntentType.ToggleLegends`, `ToggleLegendsIntent`)
  - `src/actions/core.actions.ts` (`createToggleLegendsAction`) & `src/actions/action.registry.ts` (`toggleModal(state, UIMode.Legends)`)
  - `src/core/input/{command_catalog,shortcut_input,modal_input,keybind_migration}.ts` (`panel.legends`, default chord `Shift+H` — verified free since only lowercase `h` is bound to Vi-key `move.west`)
  - `src/rendering/ui/hud/HudRoot.tsx`, `src/rendering/ui/hud_dock.ui.ts` (`DOCK_COMMANDS`), and `src/rendering/ui/core/AppUiRoot.tsx` (`<LegendsModal />`)

**Target Design:**
1. **Idempotent Macro-Delta Site Materializer (`src/systems/map/site_materializer.ts`):**
   - Maintains `materializedDeltaIds` and chunk site-stamp receipts in `MacroWorldState` so re-entering a chunk or reloading a saved chunk never duplicates terrain stamps, items, or actors.
   - Materializes declarative site archetypes and Ring 2 mutation deltas upon chunk wake (`chunk_streaming.ts`) or area wake (`map_wake_respawn.ts`):
     - **Intact / Prosperous Settlements:** Structural shelter footprints, campfires/hearths, friendly guards, and stocked containers.
     - **Raided / Burnt Sites:** Mutates tiles declaratively via `burnedTileId` / rubble, leaves elevated residual heat (`temperature_physics`) and `smoke` fields (`field.system.ts`), and spawns scarred survivors carrying trauma `Thought` memories (M182).
     - **Ancient Ruins & Tombs:** Cracked walls, subterranean/overgrown rubble, guardians, and materialized `HistoricalArtifactRecord` relics stamped with authentic artifact identity and chronicle provenance.
     - **Passing Merchant Caravans:** Spawns neutral caravan merchant + guards with `ShopComponent` inventory stocked from regional `cargoTags` and Ring 2 rumors injected into `MemoryComponent.knowledge`.
2. **Preact `LegendsModal.tsx`:**
   - Built strictly on Phase 43 accessible shared primitives and `--ui-*` semantic theme tokens (`parchment`, `retro-crt`, `obsidian-brass`) across 5 searchable, cross-linked tabs:
     1. **World Map & Eras:** Interactive ASCII/Unicode continental map showing biomes, site status markers, moving caravans, army markers, and active seasonal weather fronts.
     2. **Historical Figures & Dynasties:** Searchable roster of living and slain historical legends, dynastic lineages, scars, rivalries, and linked chronicles.
     3. **Sites & Civilizations:** Regional histories, current prosperity/garrison/status, control changes, and known rumors.
     4. **Artifacts & Relics:** Forged artifact lineages, maker/year/holder history, and last rumored location.
     5. **World Chronicle:** Filterable/searchable unified multi-century + live Ring 2 timeline feed grouped by Era.

---

## 3. Cascading Effects Matrix (AGENTS.md Rule 15)

| Change | Upstream (Callers / Emitters / Producers / Authors) | Downstream (Consumers / Renderers / Serializers / Validators) | Lateral (Mirrors / Sibling Campaigns / Registries / Docs) |
| :--- | :--- | :--- | :--- |
| **M184: Ring 2 Macro-World Worker & Simulation (`world_sim.worker.ts`, `macro_world.system.ts`, `macro_world.types.ts`)** | `simulation_cadence.ts` & `lifecycle.system.ts` (periodic async dispatch + turn-boundary sync), `world_time_skip.ts` (`stepBulkMacroCadence` sync catch-up), `worker_bridge.ts` (`dispatchMacroWorldTickOffload` + fallback) | `game-state.types.ts` & `save.ts` (`MacroWorldState` serialization), `world_clock.system.ts` (seasonal date helpers), `temperature_physics.ts` (outdoor weather ambient delta), `scheme.system.ts` / `rivalry.system.ts` / `gossip.system.ts` (Ring 2 event & rumor feed) | `macro_world.constants.ts`, `RulesConfigSchema` (`src/types/campaign/meta.ts`), `worker.types.ts`, `default/rules.json`, `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md`, `docs/ARCHITECTURE.md` |
| **M185: Offline Multi-Century Legends Worldgen (`legends_worldgen.worker.ts`, `worldgen_continent.ts`, `legends_simulator.ts`)** | `bootstrap.ts` (`startNewGame` async offload + `LoadingOverlay` progress when enabled), `world_entities_bootstrap.ts` (faction & area `ChronicleComponent` initialization), `worker_bridge.ts` (`runLegendsWorldgenOffload` + fallback) | `game-state.types.ts` & `save.ts` (`LegendsArchive` inside `macroWorld`), `persistentEntities` & `nemesisSlots` (living legends seeded at Turn 1), `historicalLedger` (pre-play era events), `factions` standings | `identity_generation.json` & `nemesis_hierarchies.json` (shared name/scar pools), `RulesConfigSchema` (`macroWorld` config), `default/rules.json`, `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md` |
| **M186a: Chunk/Area Wake Site Materializer (`site_materializer.ts`)** | `chunk_streaming.ts` (`updateStreamingWorldWindow` on `wokenChunkKeys`), `map_wake_respawn.ts` (`wakeSavedAreaFloor` when area binds `macroSiteId`), `macro_world.system.ts` (`pendingSiteDeltas` queue) | `map_accessor.ts` (`setTileIdAt`, fluid/temperature writes), `construction.system.ts`, `field.system.ts` (smoke/fire fields), `ecs_spawner.ts` (`spawnEntity`/`spawnItem` via `RulesetContract`), `needs.system.ts` / `thoughts.system.ts` (survivor trauma), `save.ts` (`materializedDeltaIds`) | `TileDefinitionSchema` (`burnedTileId`, tags), `AreaDefinitionSchema` (optional `macroSiteId`), `default/{areas,entities,items,tiles,tag_registry}.json`, sibling campaigns' optional compatibility, `docs/ssot/ssot_console.json` |
| **M186b: Preact Legends Browser UI & Modal Wiring (`LegendsModal.tsx`, `UIMode.Legends`, `panel.legends`)** | `actions/core.actions.ts` & `action.registry.ts` (`ToggleLegendsIntent`), `command_catalog.ts` / `shortcut_input.ts` / `modal_input.ts` / `keybind_migration.ts` (`Shift+H`), `hud_dock.ui.ts` (`DOCK_COMMANDS`), `LedgerModal.tsx` / `NemesisDossierModal.tsx` | `AppUiRoot.tsx`, `HudRoot.tsx`, Phase 43 shared primitives (`ModalShell`, `Tabs`, `SplitPane`, `ListBox`, `TextInput`, `Badge`, `Button`), `ui_store.ts`, `presentation_queue.ts`, `Rendering/Styles` 3-theme tokens | `tests/input_scope_and_keymap.test.ts` (command catalog assertions), `HelpModal.tsx` (`panel.legends` command auto-documented), `docs/ssot/ssot_console.json`, `docs/MILESTONES.md`, `docs/ARCHITECTURE.md` |

---

## 4. Open Architectural Decisions for User Confirmation

Before drafting `./docs/implementation_plan.md` (Step 4), please confirm your preferred direction on these 4 design points:

1. **Phase 48 UI Scope (Legends Browser vs. Phase 47 Deferred Colony Management HUD):**
   - **Option A (Recommended):** Keep Phase 48 tightly scoped to `docs/MILESTONES.md` M184–M186 (Ring 2 Macro-World Worker, Offline Legends Worldgen Worker, Site Materializer, and Preact `LegendsModal`), leaving interactive Colony/Fortress management HUD modals (work-priority matrix UI, stockpile filter editor, workshop bill manager) for a dedicated follow-up milestone or alongside Phase 44 UI work.
   - **Option B:** Build an interactive Colony/Fortress Management Preact modal inside Phase 48 alongside `LegendsModal`.

2. **Offline Legends Worldgen Trigger & Campaign Opt-In (`rules.json`):**
   - **Option A (Recommended):** Add optional declarative `macroWorld` config inside `RulesConfigSchema` (`rules.json`: `enabled`, `worldWidth`, `worldHeight`, `historyYears`, `siteCount`, `macroTickIntervalTurns`, `enableWeatherFronts`, `siteMappings`). Enable it in `public/data/campaigns/default/rules.json` (showcasing `endless_frontier` + linked settlements/ruins) while keeping sibling campaigns (`dnd35e-crypt`, `megacampaign`, `realms-of-shroudgarde`, `shroudgarde`) opt-in with zero unintended startup latency or breaking changes, streaming progress via `LoadingOverlay` during `startNewGame`.
   - **Option B:** Run multi-century Legends Worldgen globally on every campaign automatically at startup regardless of `rules.json`.

3. **Ring 2 Macro-World Worker Determinism & Turn-Boundary Sync Model:**
   - **Option A (Recommended):** Run persistent `world_sim.worker.ts` using the exact same pure seeded kernel (`advanceMacroWorldTicks` with isolated per-tick PRNG, never mutating main-thread `ROT.RNG`) as the headless main-thread fallback; dispatch asynchronously at `MACRO_WORLD_TICK_INTERVAL` boundaries and apply returned deltas strictly at deterministic player turn boundaries (with synchronous catch-up during bulk rest/time-skip and headless `bun test`).
   - **Option B:** Execute Ring 2 simulation purely synchronously inside `processTier3GlobalCadence` without a background Web Worker.

4. **Legends Browser Navigation & Keybind (`UIMode.Legends`):**
   - **Option A (Recommended):** Add dedicated `UIMode.Legends` with `panel.legends` bound to `Shift+H` (verified collision-free; lowercase `h` remains Vi-key `move.west`), a Command Dock button (`🗺️ Legends`), and cross-links from `LedgerModal` / `NemesisDossierModal`.
   - **Option B:** Fold Legends tabs inside the existing `LedgerModal` (`Shift+L`) rather than adding `UIMode.Legends`.
