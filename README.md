# Roguelike Engine & D&D 3.5e Tactical CRPG

A modern, highly-extensible, browser-based traditional roguelike and tactical CRPG engine featuring **Turn-Based** and **Real-Time with Pause (RTwP)** modes, a **Three-Tier Pluggable Ruleset Cartridge Architecture (`RulesetContract`)**, a full **D&D 3.5e SRD Cartridge**, **Tactical Companion AI & Stances**, **Systemic Narrative** simulation, and a **Data-Driven** JSON architecture. Built with **TypeScript (strict mode)**, **Vite**, and **ROT.js**.

Latest live deployment playable in your browser at **[https://thiagoribas-dev.github.io/rogue_like/](https://thiagoribas-dev.github.io/rogue_like/)**.

---

## ✨ Current Features

### 🎮 Core Console Engine (Tier 1)
- **Dual-Mode Engine & Lifecycle Windows** — Play as a traditional **turn-based** roguelike or toggle into **Real-Time with Pause (RTwP)** mode with speed controls (1×, 2×, 4×), command queuing, cooperative 4ms frame-budgeted scheduling (`ROT.Scheduler.Action`), and unified `TurnStart` / `MovementStep` / action-energy lifecycle windows (`lifecycle.system.ts`).
- **Pluggable Ruleset & UI Host Contracts (`RulesetContract`, `ICartridgeUIAdapter`)** — Decouples the Core Console Engine and `UIMode.CartridgeModal` / HUD slot host API (`cartridge_ui_registry.ts`) from tabletop math. Supports both the lightweight `classic` roguelike ruleset and the deep `dnd35e` (D&D 3.5e SRD) cartridge.
- **Tactical Companion AI, Stances & Orders (`ControllerLinkComponent`, `companion_commands.system.ts`)** — Spawned allies, animal companions, familiars, and summons follow their master (`follow` behavior), respect tactical stances (`aggressive`, `defensive`, `passive`, `hold`), execute focus-target commands (`order_target` via right-click verbs, targeting mode, or synthetic `__companion_orders__` dialogue), and swap tiles seamlessly in corridors.
- **Preact Gameplay UI Architecture, Semantic Themes & Scoped Keybinds (`src/rendering/ui/`, `src/core/input/`)** — Gameplay modals, HUD panels (`VitalsCard`, `ChronosStrip`, `CommandDockCard`, `TacticalScannerCard`, `ChronicleLogCard`, `BottomActionDock`, `AlertsStack`), and `F1` contextual help mount via Preact inside `#ui-root` cleanly separated from the Vanilla TS ROT.js Canvas2D renderer (`#game-canvas-wrapper`). Supports runtime `--ui-*` semantic theme switching (`obsidian-brass`, `parchment`, `retro-crt`), `F6` keyboard HUD focus cycling, viewport-proportional zoom (`0.5×–3.0×`), optional 45°/3D perspective transforms, and full keybind remapping (`KeybindMatrix`).
- **Shared Sprite Packs, Per-`spriteId` Fallback & Live Tileset Selection (`sprite_pack.ts`, `sprite_pack_loader.ts`)** — Centralized `32×32` atlas bundles in [`public/data/sprite_packs/`](./public/data/sprite_packs/) powered by **Dungeon Crawl Stone Soup (`dcss`, CC0 1.0 — 6,185 sprites + canonical aliases)** as the primary pack with **32rogues (`32rogues` — 8 sheets incl. animals & animated tiles)** as fallback/alternate, data-driven `catalog.json` discovery, live Settings Tileset Pack switching, and an in-game Credits & Attributions panel (`settings_attributions.ts`).
- **Diurnal World Clock, Seasonal Calendar, Environment Lighting & Rest Simulation** — Configurable 6-second turn clock (`dawn`/`day`/`dusk`/`night`), seasonal calendar (`readSeasonalCalendar`), explicit area `environmentType` (`outdoors`/`indoors`/`underground`), sync/async bulk rest & configurable `waitTargets` (`world_time_skip.ts`) with SRD hunger drain, `"While you rested:"` world event digests, and lazy cross-area respawn CR escalation (`map_wake_respawn.ts`).
- **Multi-Tile Footprints & Pass-Through Physics (`movement_footprint.ts`)** — True $W \times H$ grid occupancy synchronized live across uniform 3D `spatialIndex` buckets (`"x,y,z"`), plus friendly, helpless, $\ge 3$ size-delta, and Tiny 0-ft reach pass-through rules.
- **High-Throughput ECS & Chunked `TypedArray` SoA Ground Plane (`WorldChunk`, `MapAccessor`)** — Incremental footprint-scoped $O(k)$ `spatialIndex` patching (`patchSpatialIndexForEntity`), opt-in `withEcsBatch` transactions preserving component reference equality, flyweight `TilePaletteRegistry` + `WorldChunk` SoA `TypedArray` planes (`tileType`, `materialId`, `fluid`, `temperature`, `flags`, `regionId`, `dirtyFlags`), signed 26-bit coordinate packing (`packWorldCoord` / `packWorldCoord3D`), unified `MapAccessor` across finite and streaming maps, and delta-only IndexedDB persistence (`WORLD_CHUNKS_STORE`).
- **Active-Chunk Cellular Physics, Terrain Sculpting & Colony Labor Substrate** — Dirty-bitset cellular fluid simulation (water/magma/oil depths `1/7..7/7`, hydrostatic flow, obsidian/steam phase transitions) and heat diffusion with closed-form $O(N)$ analytical sleep catch-up (`chunk_catchup.ts`), runtime mining/chopping/smoothing/building (`construction.system.ts`) with bounded structural cave-in checks (`structural_support.ts`), a universal 6-need psychology/thought/mood/mental-break engine (`NeedsComponent`, `MemoryComponent`), and spatial designations + tag-filtered stockpiles + atomic `JobReservationToken` blackboards + workshop crafting bills (`laborBehavior`).
- **Ring 2 Parallel Macro-World Simulation, Offline Legends Worldgen & Browser (`Shift+H`)** — Continental heightmap/climate/biome/river/road synthesis (`worldgen_continent.ts`), multi-century offline historical simulation (`legends_worldgen.worker.ts`) seeding dynasties, scarred/slain legends, ruins, and forged relics onto Turn 1, persistent Ring 2 background simulation (`world_sim.worker.ts` using isolated `createMacroRng`) advancing caravans, warbands, rumors, and traveling outdoor weather fronts, idempotent chunk/area site materialization (`site_materializer.ts`), and an accessible 5-tab Preact `<LegendsModal />`.
- **Performance Telemetry & Web Worker Concurrency** — Procedural dungeon & batched streaming chunk generation (`map.worker.ts`), Ring 2 macro-world ticks (`world_sim.worker.ts`), offline Legends worldgen (`legends_worldgen.worker.ts`), and headless campaign fuzzing (`fuzzer.worker.ts`) run off the main thread with automatic deterministic main-thread fallbacks; sub-domain turn/render telemetry (`perfTracker`) exports JSON diagnostics from Settings; viewport/player-scoped dirty-domain diffing (`presentation_queue.ts`) and menu gating (`presenter.ts`) prevent off-screen UI redraws.
- **Seeded Determinism & Cold Storage** — 100% reproducible tactical runs via encapsulated `ROT.RNG` (`src/core/rng.ts`) alongside isolated Mulberry32 `createMacroRng` for Ring 2 macro ticks, deterministic entity IDs, `localStorage` auto-saves paired with IndexedDB delta chunk storage, JSON save import/export, and cross-floor Sleep/Wake entity serialization.

### 🐉 D&D 3.5e SRD Cartridge (`src/rulesets/dnd35e/` — Tier 2 & Tier 3)
- **4-Stage Stat Evaluation DAG (`evaluateDnD35eEntityDAG`) & 3-Horizon Boundary**:
  - **Horizon 1 / Horizon 2 / Horizon 3** — Cleanly isolates immutable per-level ledger choices (`levelHistory`), deterministic progression rebuilds (`scalingPools`, `spellbooksByClass`), and live situational equipment/encumbrance/environment/tile-light tag projection (`projectDnD35ActorSemanticTags`).
  - **Stage 1–4 Sub-Stat DAG & Single-Pass Skill Snapshot** — Evaluates effective Size (`Fine` to `Colossal`) and overlays, Ability Scores, Compound Defenses (18-type bonus stacking across Full/Touch/Flat-Footed AC, Saves, BAB, Grapple, Initiative with `sourcePath` provenance), Stage 4 `attackRoutine` synthesis, and unified `resolveActorSkillsSnapshot` totals.
  - **WeakMap Schema & Cross-State DAG Memoization** — Validated rulebook registries (`getDnD35SystemContent`) are cached via `WeakMap` for $O(1)$ hot-path reads, while `campaignEntityDagCache` reuses structural 4-stage DAG results across immutable `GameState` steps while merging fresh transient `actionBudget` and `flankingRelations`.
- **Universal Actor Symmetry & Composable Creature Synthesis**:
  - **87 Unified Race/Bestiary Chassis (`races/`)** — 14 playable races/subraces plus monstrous species, True Dragon 12-age-category progressions, Elemental size ladders, 15 Creature Type Racial HD engines, 20 Subtypes, 13 Templates (*Skeleton*, *Zombie*, *Celestial*, *Fiendish*, *Half-Dragon*, *Ghost*, *Lich*, *Vampire*, etc.), and non-destructive `WildShapeOverlay` layers.
  - **Symmetrical Anatomical Equipment & Armaments** — All actors (PCs, NPCs, companions, monsters) auto-initialize anatomical `EquipmentComponent` slots from `anatomyBodyPlan` and equip declarative `defaultEquipment` loadouts.
- **Classes, Feature-Driven Multiclassing, Alternate Class Features (ACFs) & Unified Character Builder**:
  - **26 Modular Classes (`classes/`)** — 11 Core Classes (Levels 1–20), 5 NPC Classes (*Adept*, *Aristocrat*, *Commoner*, *Expert*, *Warrior*), and 10 Prestige Classes with recursive AST prerequisite validation, fully wired Alternate Class Features (`acfSwaps` across all 11 core classes including *Lion/Wolf Totem*, *Whirling Frenzy*, *Spontaneous Domain Casting*, *Druidic Avenger*, *Shapeshift*, *Dungeon Crasher*, *Decisive Strike*, *Invisible Fist*, *Charging Smite*, *Distracting Attack*, *Penetrating Strike*, *Bardic Knack*, *Healing Hymn*, *Metamagic Specialist*, and *Abrupt Jaunt*), declarative `scalingPoolContribution` stacking, and 22 Cleric Domains (`domains/`).
  - **50 SRD Skills & 125 Feats** — Class vs. cross-class rank caps (`isEverClassSkill` vs. active-level cost), 5-rank synergies, active dungeon/combat skill verbs (`search`, `unlock`, `disarm` with `DC + 5` trap ownership inversion, `heal`, `persuade`, `intimidate`, `feint`), *Climb* vertical scaling, Monster Lore Knowledge gating, *Knowledge Devotion*, spatial metamagic (*Judicious Spell*, *Reach Spell*), *Improved Counterspell*, and parameterized feats (`weapon_focus:<baseWeaponId>`, `ability_focus:<abilityId>`).
  - **31 Declarative Conditions & Light Exposure (`conditions/*.json`)** — Data-driven `conditionEffects` registry powering all canonical D&D 3.5e conditions (including `dazzled`) plus Drow *Light Blindness* (`light_exposure.ts`) and Kobold/Orc/Duergar *Light Sensitivity* reactive to ambient sunlight and spell illumination fields.
  - **Composable Item Inheritance & First-Class Enhancements** — **242 item definitions** (`items/`) + **16 enhancements** (`item_enhancements.json`) supporting `baseItemId` inheritance, runtime instance overrides, base weapon tag matching (`weapon:<baseWeaponId>`), and conditional `on_hit` / `on_crit` damage riders.
  - **Shared 2-Pane Builder & Level-Up Flow** — Mandatory step validation gating, point-buy / array / `4d6kh3` rolls, starting gear materialization, filterable Feat/Spell steps, isolated per-class `spellbooksByClass`, and reversible negative levels / permanent level drain.
- **5-Phase Combat Pipeline, Relational Flanking, Multi-Tile Squeezing, 3D Geometry & Vancian Magic**:
  - **Composable 5-Phase Combat Exchange (`combat_exchange_pipeline.ts`)** — Executes `PreAttack` (illumination/concealment/flanking) $\to$ `StrikeRoll` (fortification/crit immunity) $\to$ `OnHitRiders` $\to$ `PostStrikeReaction` (target-side retaliation shields) $\to$ `OnDropFollowup` (*Cleave*/*Great Cleave*).
  - **Action Economy, Relational Flanking, 3D Spatial Hooks & Immediate Reactions** — Symmetric per-entity 6-second round budgets (`Standard`, `Move`, `Swift/Immediate`, `5-Foot Step`, `AoO`), reach-filtered directional `flankingRelations` graph (`flanking_graph.ts`), SRD Squeezing (`-4` Atk / `-4` AC, `2x`/`4x` movement cost), 3D `1-2-1-2` distances + High Ground `+1` + 3D cover (`dnd35e_spatial_3d.ts`), *Fly*/*Feather Fall* fall-damage hooks, armor tactical speed scaling, off-turn reactive counterspelling (`counterspell_interrupt.ts`), configurable Immediate Action reaction policies, and opposed Combat Maneuvers (including spatial Bull Rush + *Dungeon Crasher* wall impacts).
  - **257 Modular Spells (Levels 0–9)** — Prepared/spontaneous per-class spellbooks, Divine prayerbook auto-access, 100% 22-domain spell list coverage, declarative spontaneous conversion (`cure_or_inflict`, `domain`, `summon_nature_ally`), Metamagic & spherical/3D target-category AoE filtering (`computeAoEAffectedSquares3D`, `target_category_filter.ts`), voxel earth/water spells (*Stone Shape*, *Passwall*, *Transmute Rock to Mud*, *Create Water*), Concentration/Counterspelling, summoning chains, iterative spell strikes, and mobile spell aura emanations with illumination precedence and per-cast first-entry save/SR memory.

### 🗺️ Exploration, World & Map
- **Procedural, Static Multi-Z & Streaming Overworld Generation** — `ROT.Map.Digger` dungeons, cellular automata caves, Diffusion-Limited Aggregation (DLA) caverns with Voronoi sub-biomes, stacked static multi-Z maps (`staticMap.zLevels`), and unbounded Ring 0/1 procedural `streaming_overworld` sectors with delta-only chunk persistence (`endless_frontier`).
- **True Multi-Z Voxel Space, 3D Vision & HPA\* Routing** — Vertical movement across ramps, stairs, ladders, and climbables (`<`/`>`), unsupported falling & gravity (`gravity.system.ts`), 3D shadowcasting (`computeFOV3D`) + vertical light attenuation across `open_air` balconies/chasms, depth-dimmed Z-peeking (`PageUp`/`[` / `PageDown`/`]` / `Home`), per-chunk `RegionGrid` HPA\* pathfinding, and LRU-cached shared 3D Dijkstra flow fields (`flow_field.ts`).
- **Multi-Mode Terrain Traversal** — Land, Climb, Swim, Fly (with maneuverability grades), and Burrow movement speeds allow flying/swimming actors to cross chasms, pits, and deep water.
- **Field of View, Vision Modes & Stealth** — 3D/2D shadowcasting FOV, Low-Light Vision, Darkvision, Blindsense/Blindsight, Tremorsense, Concealment miss chances, and opposed Hide/Move Silently vs. Spot/Listen detection.
- **Encounter Director & Macro-World Showcase** — Spends Challenge Rating (CR) budgets across tactical objectives, hazards, and monster groups with Hot Path Dijkstra routing; `default` showcases 3D multi-Z towers (`watchtower_overlook`), streaming terrain (`endless_frontier`), colony workshops, and live Ring 2 `macroWorld` Legends & site materialization.
- **5 Built-in Campaigns**:
  - **Descent (`default`)** — Classic systemic roguelike showcase campaign.
  - **The Sunless Reliquary (`dnd35e-crypt`)** — Multi-zone D&D 3.5e SRD tactical dungeon crawl.
  - **The Realms of Shroudgarde (`realms-of-shroudgarde`)** — Full D&D 3.5e open-realm & dungeon campaign showcasing towns, companions, doors, chests, and systemic narrative.
  - **The Shroudgarde Borderlands (`shroudgarde`)** — Open-ended classic borderlands investigation and faction campaign (ASCII default).
  - **The Megadungeon (`megacampaign`)** — Multi-branch classic deep dungeon crawl (ASCII default).

### 💬 Systemic Narrative, Rivalry & Villains
- **Rivalry & Nemesis Ecosystem (`N`)** — Enemies that defeat or escape the player promote into persistent Rivals with procedural titles, scars, grudges, traits, and ambush behaviors, tracked on a hierarchical Nemesis Pyramid.
- **Villain Masterminds & Investigation Board (`V`)** — Background schemes tick independently on tiered simulation cadences; defeating agents drops clues linked on an interactive conspiracy board.
- **End-to-End Quest & Knowledge Lifecycle** — Authored and procedural quests (`gather`, `explore`, `interact`, `kill`), retroactive objective evaluation, chained `nextQuestId` progressions, failure states, rumor propagation, `gossip`, and `ask_about`.
- **Combinatorial Reactions & Interaction Verbs** — 30+ canonical verbs (including dungeon skills, social acts, physical world interactions, and companion tactical commands) resolved via tag-driven JSON reaction matrices and anchored environmental fields.

### 🛠️ Built-in Campaign Editor & Simulation Suite
- **Visual Authoring Workspace** — World area graph, 2D faction hostility matrix, dialogue tree editor, tile grid painter, validation dock with jump-to-error navigation, reverse-reference "Where Used" inspector, and Zod-driven schema forms with RFC 6902 JSON Patch undo/redo *(pure orchestration in `src/editor/`; legacy DOM workspace views in `src/rendering/editor_ui.ts` scheduled for Preact/primitive rewrite in Phase 44, Milestones 169–172)*.
- **Simulation Tools** — **AI Arena** (headless combat simulator with telemetry), **Encounter Director Sandbox**, **Scheme Accelerator**, and **Knowledge Propagation Simulator**.
- **Playtest Round-Trip & ZIP Export** — Ruleset-aware creation modal, bundled campaign browser, static-tile "Playtest from Here", IndexedDB storage, and `.zip` mod export/import.

---

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh/) (v1.1+ recommended)

### Installation & Development
1. Clone the repository and install dependencies:
   ```bash
   bun install
   ```
2. Start the development server:
   ```bash
   bun run dev
   ```
3. Open `http://localhost:3000` (or the port printed by Vite) in your browser.

### Building for Production
- **Standard Web Build**:
  ```bash
  bun run build
  ```
- **itch.io Embedded Browser Build** (relative `./` base path):
  ```bash
  bun run build:itch
  ```

---

## 🏗️ Architectural Governance & Single Source of Truth (SSOT)

This codebase enforces strict architectural guardrails verified automatically on every build:

- **Three-Tier Placement Heuristic**:
  - **Tier 1 — Core Console Engine (`src/core/`, `src/ai/`, `src/systems/`, `src/types/`)**: Reusable RPG simulation primitives (ECS state, anatomical `EquipmentSlotInstance[]` body graphs, layered stat overlays, tag-conditional modifiers, spatial fields, companion AI & stance/focus-target commands, stance groups, lifecycle windows, and UI host slots).
  - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`, `src/rulesets/classic/`)**: Pure mathematical laws of the tabletop system (3-horizon stat pipeline, 4-stage stat DAG, 18-type bonus stacking, 5-phase combat exchange, full-attack & maneuver resolvers, Vancian spellcasting).
  - **Tier 3 — System Content (`public/data/rulesets/dnd35e/`)**: **888** modular JSON files across 11 subfolders (plus `effects.json`, `status.json`, and `item_enhancements.json` = **891** total JSON files) parameterizing classes (26), races/bestiary (87), spells (257), conditions (31), templates (13), feats (125), items (242 + 16 enhancements), domains (22), skills (50), creature types (15), and subtypes (20).
- **Unified Effect Providers & Hierarchical Provenance (`sourcePath`)**: Every mechanical emitter (size, creature type, subtype, race, template, class, feat, skill threshold, item enhancement, condition, armor/load, tactical stance, spatial field) projects semantic tags and emits `StatModifier`s / `RuleOverride`s carrying a slash-delimited `sourcePath` for atomic revocation.
- **Programmatic SSOT Registries & Continuous Parity**:
  - Every `.ts`/`.tsx` file under `src/` is registered in `docs/ssot/ssot_console.json` (**394**), `docs/ssot/ssot_dnd35e.json` (**173**), or `docs/ssot/ssot_classic.json` (**6**) (**573 source files** total) with primary responsibility, canonical exported entry points, ownership boundaries, and forbidden anti-patterns.
  - Human-readable maps (`docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`, and `docs/SSOT_CLASSIC.md`) are generated programmatically via `bun run map:ssot` and verified for 100% disk and export parity by `scripts/run-validator.ts` and `tests/ssot_registry_parity.test.ts`.

---

## 📁 Repository Structure

```text
├── AGENTS.md                                 # Coding standards, Golden Rules, and 6-Step Workflow
├── CREDITS.md                                # Third-party library, tileset (DCSS CC0, 32rogues, RLTiles), and contributor attributions
├── verify.sh / verify.bat                    # Verification pipeline (TS, Format, Lint, Arch, Knip, Test, Build, Validator)
├── docs/
│   ├── ARCHITECTURE.md                       # Comprehensive subsystem architecture reference
│   ├── DECISIONS.md                          # Architectural Decision Records (ADRs)
│   ├── MILESTONES.md                         # Project roadmap and completed milestones
│   ├── QUEST_AND_NARRATIVE_ARCHITECTURE.md   # Deep-dive quest, dialogue, and narrative dataflow spec
│   ├── UI_UX_STANDARDS.md                    # Dark-fantasy UI/UX constitution & Cartridge UI Adapter standards
│   ├── SSOT_CONSOLE.md                       # Auto-generated Core Console SSOT responsibility map
│   ├── SSOT_DND35E.md                        # Auto-generated D&D 3.5e Cartridge SSOT responsibility map
│   ├── SSOT_CLASSIC.md                       # Auto-generated Classic Cartridge SSOT responsibility map
│   ├── ssot/                                 # Authoritative JSON SSOT registries (ssot_console.json, ssot_dnd35e.json, ssot_classic.json)
│   ├── dnd35e/                               # D&D 3.5e SRD domain reference specs
│   ├── guides/                               # Campaign authoring and ruleset developer guides
│   └── archive/                              # Historical audits, milestone design plans, and archived 64x64 isometric rltiles-pack
├── public/data/
│   ├── campaigns/                            # Built-in campaigns (default, dnd35e-crypt, megacampaign, realms-of-shroudgarde, shroudgarde)
│   ├── sprite_packs/                         # Shared 32x32 sprite bundles (catalog.json, dcss/ CC0 primary, 32rogues/ fallback)
│   └── rulesets/dnd35e/                      # Modular D&D 3.5e SRD JSON registries (classes, races, spells, feats, items, conditions)
├── scripts/                                  # Campaign validator, sprite packers, SSOT parity engine, and codebase mapper
├── tests/                                    # Bun regression test suites (473 tests across 71 files)
└── src/
    ├── actions/                              # Action handlers and verb dispatch registry
    ├── ai/                                   # Composable AI behaviors (hunt, ranged, spell, follow, flee, wander, labor) & HPA* / flow fields
    ├── constants/                            # Engine constants, keybinds, display zoom, world chunks, macro-world, and palettes
    ├── core/                                 # ECS state/batches, session controller, loader, chunk store, RNG, scheduler, input, telemetry
    ├── editor/                               # Built-in Campaign Editor, AI Arena, and workspace services
    ├── map/                                  # Map generators, WorldChunk SoA/MapAccessor, 3D FOV, HPA* regions, support, continent worldgen
    ├── rendering/                            # ROT.js Canvas2D renderer, viewport snapshots, Preact UI views/primitives, and Cartridge UI slots
    ├── rulesets/                             # RulesetContract registry, classic/ cartridge, and dnd35e/ cartridge
    ├── systems/                              # Pure ECS systems (lifecycle, combat, physics/, psychology/, labor/, macro/, map/, quests)
    ├── types/                                # Branded IDs, ECS component schemas, WorldChunk/colony/macro-world & Zod campaign types
    ├── utils/                                # Grid/3D math, equipment slot helpers, sprite pack merger, faction, text, and stat helpers
    ├── worker/                               # Off-thread Web Workers (map chunks, macro-world sim, legends worldgen, and fuzzer)
    └── main.ts                               # Application bootstrap entry point
```

---

## 📖 Documentation

- **[`CREDITS.md`](./CREDITS.md)** — Licenses, contributor credits, and attribution notices (`DCSS` CC0 1.0, `32rogues`, `RLTiles`, `ROT.js`).
- **[`AGENTS.md`](./AGENTS.md)** — Golden Rules, TypeScript strictness standards, and development workflow.
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — Deep-dive system design and data flow across all engine subsystems.
- **[`docs/DECISIONS.md`](./docs/DECISIONS.md)** — Architectural tradeoffs and rationale (Decisions 1–21 plus M112.9–M186 ADRs).
- **[`docs/MILESTONES.md`](./docs/MILESTONES.md)** — Complete milestone history and roadmap (Milestones 1–186; Phases 1–43 & 45–48 complete, Phase 44 planned).
- **[`docs/QUEST_AND_NARRATIVE_ARCHITECTURE.md`](./docs/QUEST_AND_NARRATIVE_ARCHITECTURE.md)** — End-to-end quest, dialogue, and procedural narrative lifecycle architecture.
- **[`docs/UI_UX_STANDARDS.md`](./docs/UI_UX_STANDARDS.md)** — Theme skins, Preact UI component contracts, and `ICartridgeUIAdapter` standards.
- **[`docs/SSOT_CONSOLE.md`](./docs/SSOT_CONSOLE.md)**, **[`docs/SSOT_DND35E.md`](./docs/SSOT_DND35E.md)** & **[`docs/SSOT_CLASSIC.md`](./docs/SSOT_CLASSIC.md)** — Canonical file ownership and entry-point maps.
- **[`docs/guides/CREATOR_GUIDE.md`](./docs/guides/CREATOR_GUIDE.md)** & **[`docs/guides/MODDING.md`](./docs/guides/MODDING.md)** — Guides to authoring, validating, and modding custom campaigns.

---

## 🛠️ Verification & Utility Scripts

| Command | Description |
| :--- | :--- |
| `./verify.sh` / `.\verify.bat` | Runs the complete verification pipeline (Typecheck, Format, ESLint, Dependency Cruiser, File-Length Check, Knip Dead-Code, Bun Tests, Production Build, and Campaign/SSOT Validator). |
| `bun run dev` | Starts the Vite development server. |
| `bun run build` | Type-checks and builds the production bundle into `dist/`. |
| `bun test` | Runs all unit and integration regression test suites (`tests/`). |
| `bun run validate:campaigns` | Validates all campaigns, modular ruleset files, and SSOT registry parity (`scripts/run-validator.ts`). |
| `bun run map:ssot` | Regenerates `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` from `docs/ssot/*.json` (`scripts/map-codebase.ts`). |
| `bun run lint` | Runs ESLint across `src/`. |
| `bun run lint:arch` | Verifies downward dependency layering via `dependency-cruiser`. |
| `bun run lint:filelength` | Audits source file length limits across `src/` (`scripts/check-file-length.ts`). |
| `bun run lint:deadcode` | Scans for unused files, exports, and dependencies via `knip`. |
| `bun run format` / `bun run format:check` | Formats or checks formatting for source files with Prettier. |
