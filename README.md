# Roguelike Engine & D&D 3.5e Tactical CRPG

A modern, highly-extensible, browser-based traditional roguelike and tactical CRPG engine featuring **Turn-Based** and **Real-Time with Pause (RTwP)** modes, a **Three-Tier Pluggable Ruleset Cartridge Architecture (`RulesetContract`)**, a full **D&D 3.5e SRD Cartridge**, **Tactical Companion AI & Stances**, **Systemic Narrative** simulation, and a **Data-Driven** JSON architecture. Built with **TypeScript (strict mode)**, **Vite**, and **ROT.js**.

---

## ✨ Current Features

### 🎮 Core Console Engine (Tier 1)
- **Dual-Mode Engine & Lifecycle Windows** — Play as a traditional **turn-based** roguelike or toggle into **Real-Time with Pause (RTwP)** mode with speed controls (1×, 2×, 4×), command queuing, cooperative 4ms frame-budgeted scheduling (`ROT.Scheduler.Action`), and unified `TurnStart` / `MovementStep` / action-energy lifecycle windows (`lifecycle.system.ts`).
- **Pluggable Ruleset & UI Host Contracts (`RulesetContract`, `ICartridgeUIAdapter`)** — Decouples the Core Console Engine and `UIMode.CartridgeModal` / HUD slot host API (`cartridge_ui_registry.ts`) from tabletop math. Supports both the lightweight `classic` roguelike ruleset and the deep `dnd35e` (D&D 3.5e SRD) cartridge.
- **Tactical Companion AI, Stances & Orders (`ControllerLinkComponent`, `companion_commands.system.ts`)** — Spawned allies, animal companions, familiars, and summons follow their master (`follow` behavior), respect tactical stances (`aggressive`, `defensive`, `passive`, `hold`), execute focus-target commands (`order_target` via right-click verbs, targeting mode, or synthetic `__companion_orders__` dialogue), and swap tiles seamlessly in corridors.
- **Console Stance Groups, Dock & Master Dossier** — Data-driven stance groups (`stance.system.ts`), bottom command dock (`hud_bottom_dock.ui.ts`), hotbar (`console_hotbar.ui.ts`), symmetrical Paper Doll (`console_inventory.ui.ts`), and Master Character Dossier (`console_dossier.ui.ts`).
- **Viewport-Proportional Zoom & Theme System** — Dynamic resolution-independent tile sizing (`DEFAULT_VIEWPORT_TILE_HEIGHT_PERCENT`, 0.5×–3.0× zoom), optional 45°/3D perspective transforms, and switchable skins/font scaling (`console_theme.ts`).
- **Performance Telemetry & Web Worker Concurrency** — Heavy procedural dungeon generation (`map.worker.ts`) and headless campaign fuzzing (`fuzzer.worker.ts`) run off the main thread; sub-domain turn/render telemetry (`perfTracker`) exports JSON diagnostics from Settings.
- **Seeded Determinism & Cold Storage** — 100% reproducible runs via encapsulated `ROT.RNG` (`src/core/rng.ts`) and deterministic entity IDs, with `localStorage` auto-saves, JSON save import/export, and cross-floor Sleep/Wake entity serialization.

### 🐉 D&D 3.5e SRD Cartridge (`src/rulesets/dnd35e/` — Tier 2 & Tier 3)
- **4-Stage Stat Evaluation DAG (`evaluateDnD35eEntityDAG`) & 3-Horizon Boundary**:
  - **Horizon 1 / Horizon 2 / Horizon 3** — Cleanly isolates immutable per-level ledger choices (`levelHistory`), deterministic progression rebuilds (`scalingPools`, `spellbooksByClass`), and live situational equipment/encumbrance self-tag projection (`projectDnD35ActorSemanticTags`).
  - **Stage 1–4 Sub-Stat DAG** — Evaluates effective Size (`Fine` to `Colossal`) and overlays, Ability Scores, Compound Defenses (18-type bonus stacking across Full/Touch/Flat-Footed AC, Saves, BAB, Grapple, Initiative with `sourcePath` provenance), and Stage 4 complete `attackRoutine` synthesis.
  - **WeakMap Schema Memoization** — Validated rulebook registries (`getDnD35SystemContent`) are cached via `WeakMap` for $O(1)$ hot-path reads while derived entity DAGs remain 100% stateless.
- **Universal Actor Symmetry & Composable Creature Synthesis**:
  - **75 Unified Race/Bestiary Chassis (`races/`)** — 14 playable races/subraces plus monstrous species, True Dragon 12-age-category progressions, Elemental size ladders, 15 Creature Type Racial HD engines, 20 Subtypes, 13 Templates (*Skeleton*, *Zombie*, *Celestial*, *Fiendish*, *Half-Dragon*, *Ghost*, *Lich*, *Vampire*, etc.), and non-destructive `WildShapeOverlay` layers.
  - **Symmetrical Anatomical Equipment & Armaments** — All actors (PCs, NPCs, companions, monsters) auto-initialize anatomical `EquipmentComponent` slots from `anatomyBodyPlan` and equip declarative `defaultEquipment` loadouts.
- **Classes, Feature-Driven Multiclassing & Unified Character Builder**:
  - **26 Modular Classes (`classes/`)** — 11 Core Classes (Levels 1–20), 5 NPC Classes (*Adept*, *Aristocrat*, *Commoner*, *Expert*, *Warrior*), and 10 Prestige Classes with recursive AST prerequisite validation, Alternate Class Features (`acfSwaps`), declarative `scalingPoolContribution` stacking, and 22 Cleric Domains (`domains/`).
  - **50 SRD Skills & 121 Feats** — Class vs. cross-class rank caps (`isEverClassSkill` vs. active-level cost), 5-rank synergies, active dungeon/combat skill verbs (`search`, `unlock`, `disarm`, `heal`, `persuade`, `intimidate`, `feint`), Monster Lore Knowledge gating, and parameterized feats (`weapon_focus:<baseWeaponId>`, `ability_focus:<abilityId>`).
  - **Composable Item Inheritance & First-Class Enhancements** — **149 items** (`items/`) + **16 enhancements** (`item_enhancements.json`) supporting `baseItemId` inheritance, runtime instance overrides, base weapon tag matching (`weapon:<baseWeaponId>`), and conditional `on_hit` / `on_crit` damage riders.
  - **Shared 2-Pane Builder & Level-Up Flow** — Mandatory step validation gating, point-buy / array / `4d6kh3` rolls, starting gear materialization, filterable Feat/Spell steps, isolated per-class `spellbooksByClass`, and reversible negative levels / permanent level drain.
- **5-Phase Combat Pipeline, Maneuvers & Vancian Magic**:
  - **Composable 5-Phase Combat Exchange (`combat_exchange_pipeline.ts`)** — Executes `PreAttack` (illumination/concealment/flanking) $\to$ `StrikeRoll` (fortification/crit immunity) $\to$ `OnHitRiders` $\to$ `PostStrikeReaction` (target-side retaliation shields) $\to$ `OnDropFollowup` (*Cleave*/*Great Cleave*).
  - **Action Economy, Weapon Physics & Maneuvers** — Discrete 5-ft step round tracking (`distanceMovedThisRoundFt`), 3-step effort ladder, `1H` / `2H` / `Double Weapon TWF` grip modes, multi-limb natural attack demotion, LIFO Attacks of Opportunity, and opposed Combat Maneuvers.
  - **254 Modular Spells (Levels 0–9)** — Prepared/spontaneous per-class spellbooks, Divine prayerbook auto-access, 100% 22-domain spell list coverage, Metamagic feats, Concentration/Counterspelling, summoning chains, iterative spell strikes, and mobile spell aura emanations with illumination precedence and per-cast first-entry save/SR memory.

### 🗺️ Exploration, World & Map
- **Procedural & Static Map Generation** — `ROT.Map.Digger` dungeons, cellular automata caves, Diffusion-Limited Aggregation (DLA) caverns with Voronoi sub-biomes, and hand-crafted static hubs.
- **Multi-Mode Terrain Traversal** — Land, Climb, Swim, Fly (with maneuverability grades), and Burrow movement speeds allow flying/swimming actors to cross chasms, pits, and deep water.
- **Field of View, Vision Modes & Stealth** — Shadowcasting FOV, Low-Light Vision, Darkvision, Blindsense/Blindsight, Tremorsense, Concealment miss chances, and opposed Hide/Move Silently vs. Spot/Listen detection.
- **Encounter Director** — Spends Challenge Rating (CR) budgets across tactical objectives, hazards, and monster groups with Hot Path Dijkstra routing.
- **4 Built-in Campaigns**:
  - **Descent (`default`)** — Classic systemic roguelike showcase campaign.
  - **The Sunless Reliquary (`dnd35e-crypt`)** — Multi-zone D&D 3.5e SRD tactical dungeon crawl.
  - **The Shroudgarde Borderlands (`shroudgarde`)** — Open-ended borderlands investigation and faction campaign.
  - **The Megadungeon (`megacampaign`)** — Multi-branch deep dungeon crawl.

### 💬 Systemic Narrative, Rivalry & Villains
- **Rivalry & Nemesis Ecosystem (`N`)** — Enemies that defeat or escape the player promote into persistent Rivals with procedural titles, scars, grudges, traits, and ambush behaviors, tracked on a hierarchical Nemesis Pyramid.
- **Villain Masterminds & Investigation Board (`V`)** — Background schemes tick independently on tiered simulation cadences; defeating agents drops clues linked on an interactive conspiracy board.
- **End-to-End Quest & Knowledge Lifecycle** — Authored and procedural quests (`gather`, `explore`, `interact`, `kill`), retroactive objective evaluation, chained `nextQuestId` progressions, failure states, rumor propagation, `gossip`, and `ask_about`.
- **Combinatorial Reactions & Interaction Verbs** — 30+ canonical verbs (including dungeon skills, social acts, physical world interactions, and companion tactical commands) resolved via tag-driven JSON reaction matrices and anchored environmental fields.

### 🛠️ Built-in Campaign Editor & Simulation Suite
- **Visual Authoring Workspace** — World area graph, 2D faction hostility matrix, dialogue tree editor, tile grid painter, validation dock with jump-to-error navigation, reverse-reference "Where Used" inspector, and Zod-driven schema forms with RFC 6902 JSON Patch undo/redo.
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
  - **Tier 3 — System Content (`public/data/rulesets/dnd35e/`)**: **745** modular JSON files (+ `item_enhancements.json` and root barrel files) parameterizing classes (26), races/bestiary (75), spells (254), templates (13), feats (121), items (149 + 16 enhancements), domains (22), skills (50), creature types (15), and subtypes (20).
- **Unified Effect Providers & Hierarchical Provenance (`sourcePath`)**: Every mechanical emitter (size, creature type, subtype, race, template, class, feat, skill threshold, item enhancement, condition, armor/load, tactical stance, spatial field) projects semantic tags and emits `StatModifier`s / `RuleOverride`s carrying a slash-delimited `sourcePath` for atomic revocation.
- **Programmatic SSOT Registries & Continuous Parity**:
  - Every `.ts` file under `src/` is registered in either `docs/ssot/ssot_console.json` (**307 files**) or `docs/ssot/ssot_dnd35e.json` (**125 files**) — **432 source files** total with primary responsibility, canonical exported entry points, ownership boundaries, and forbidden anti-patterns.
  - Human-readable maps (`docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md`) are generated programmatically via `bun run map:ssot` and verified for 100% disk and export parity by `scripts/run-validator.ts` and `tests/ssot_registry_parity.test.ts`.

---

## 📁 Repository Structure

```text
├── AGENTS.md                                 # Coding standards, Golden Rules, and 6-Step Workflow
├── verify.sh / verify.bat                    # Verification pipeline (TS, Format, Lint, Arch, File Length, Knip, Test, Build, Validator)
├── docs/
│   ├── ARCHITECTURE.md                       # Comprehensive subsystem architecture reference
│   ├── DECISIONS.md                          # Architectural Decision Records (ADRs)
│   ├── MILESTONES.md                         # Project roadmap and completed milestones
│   ├── QUEST_AND_NARRATIVE_ARCHITECTURE.md   # Deep-dive quest, dialogue, and narrative dataflow spec
│   ├── UI_UX_STANDARDS.md                    # Dark-fantasy UI/UX constitution & Cartridge UI Adapter standards
│   ├── SSOT_CONSOLE.md                       # Auto-generated Core Console SSOT responsibility map (307 files)
│   ├── SSOT_DND35E.md                        # Auto-generated D&D 3.5e Cartridge SSOT responsibility map (125 files)
│   ├── ssot/                                 # Authoritative JSON SSOT registries (ssot_console.json, ssot_dnd35e.json)
│   ├── dnd35e/                               # D&D 3.5e SRD domain reference specs
│   ├── guides/                               # Campaign authoring and ruleset developer guides
│   └── archive/                              # Historical audits and design scratchpads
├── public/data/
│   ├── campaigns/                            # Built-in campaigns (default, dnd35e-crypt, megacampaign, shroudgarde)
│   └── rulesets/dnd35e/                      # 745 modular D&D 3.5e SRD JSON data files (+ root enhancements)
├── scripts/                                  # Campaign validator, SSOT parity engine, file-length checker, and codebase mapper
├── tests/                                    # Bun regression test suites (216 tests across 33 suites)
└── src/
    ├── actions/                              # Action handlers and verb dispatch registry
    ├── ai/                                   # Composable AI behaviors (hunt, ranged, spell, follow, flee, wander) & companion targeting
    ├── constants/                            # Engine constants, keybinds, display zoom, and palettes
    ├── core/                                 # ECS state, session controller, loader, RNG, scheduler, input, performance telemetry
    ├── editor/                               # Built-in Campaign Editor, AI Arena, and workspace services
    ├── map/                                  # Procedural map generators, FOV wrapper, and Encounter Director
    ├── rendering/                            # ROT.js display manager, viewport snapshots, Cartridge UI registry, and DOM UI views
    ├── rulesets/                             # RulesetContract registry, classic/ cartridge, and dnd35e/ cartridge
    ├── systems/                              # Pure ECS systems (lifecycle, combat, movement, stances, companion orders, fields, quests)
    ├── types/                                # Branded IDs, ECS component schemas, and Zod campaign types
    ├── utils/                                # Grid math, pathfinding, faction hostility, text parsing, and stat helpers
    ├── worker/                               # Off-thread Web Workers (map generation and fuzzer)
    └── main.ts                               # Application bootstrap entry point
```

---

## 📖 Documentation

- **[`AGENTS.md`](./AGENTS.md)** — Golden Rules, TypeScript strictness standards, and development workflow.
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — Deep-dive system design and data flow across all engine subsystems.
- **[`docs/DECISIONS.md`](./docs/DECISIONS.md)** — Architectural tradeoffs and rationale (Decisions 1–21 plus M112.9–M123+ ADRs).
- **[`docs/MILESTONES.md`](./docs/MILESTONES.md)** — Complete milestone history and upcoming phases (Milestones 1–131).
- **[`docs/QUEST_AND_NARRATIVE_ARCHITECTURE.md`](./docs/QUEST_AND_NARRATIVE_ARCHITECTURE.md)** — End-to-end quest, dialogue, and procedural narrative lifecycle architecture.
- **[`docs/UI_UX_STANDARDS.md`](./docs/UI_UX_STANDARDS.md)** — Theme skins, UI component contracts, and `ICartridgeUIAdapter` standards.
- **[`docs/SSOT_CONSOLE.md`](./docs/SSOT_CONSOLE.md)** & **[`docs/SSOT_DND35E.md`](./docs/SSOT_DND35E.md)** — Canonical file ownership and entry-point maps.
- **[`docs/guides/CAMPAIGN_AUTHORING.md`](./docs/guides/CAMPAIGN_AUTHORING.md)** — Guide to creating custom campaigns and JSON mods.

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
