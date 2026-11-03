# Roguelike Engine & D&D 3.5e Tactical CRPG

A modern, highly-extensible, browser-based traditional roguelike and tactical CRPG engine featuring **Turn-Based** and **Real-Time with Pause (RTwP)** modes, a **Three-Tier Pluggable Ruleset Cartridge Architecture**, a full **D&D 3.5e SRD Cartridge**, **Systemic Narrative** simulation, and a **Data-Driven** JSON architecture. Built with **TypeScript (strict mode)**, **Vite**, and **ROT.js**.

---

## ✨ Current Features

### 🎮 Core Console Engine (Tier 1)
- **Dual-Mode Engine** — Play as a traditional **turn-based** roguelike or toggle into **Real-Time with Pause (RTwP)** mode with speed controls (1×, 2×, 4×) and command queuing.
- **Pluggable Ruleset Strategy (`RulesetStrategy`)** — Decouples the Core Console Engine from tabletop math. Supports both the lightweight `classic` roguelike ruleset and the deep `dnd35e` (D&D 3.5e SRD) ruleset cartridge.
- **Web Worker Concurrency** — Heavy procedural dungeon generation (`map.worker.ts`) and headless campaign fuzzing (`fuzzer.worker.ts`) run off the main UI thread.
- **Seeded Determinism** — Every run is 100% reproducible from its seed via an encapsulated RNG wrapper (`src/core/rng.ts`) and deterministic entity counters.
- **Save/Load & Cold Storage** — Auto-saves to `localStorage` with manual JSON save export/import; cross-floor Sleep/Wake component serialization preserves persistent entities across maps.
- **Full Input Rebinding & Accessibility** — Customize every keyboard control; UI/font scaling, high-contrast palettes, and animation reduction.

### 🐉 D&D 3.5e SRD Cartridge (`src/rulesets/dnd35e/` — Tier 2 & Tier 3)
- **4-Stage Stat Evaluation DAG (`evaluateDnD35eEntityDAG`)**:
  - **Stage 1 (Structural & Identity)** — Evaluates size category (`Fine` to `Colossal`), creature type/subtypes, polymorph/wild shape overlays, and structural equipment slots.
  - **Stage 2 (Ability Scores & Encumbrance)** — Computes 6 ability scores (`STR`, `DEX`, `CON`, `INT`, `WIS`, `CHA`), weight/load thresholds, and armor max-DEX / speed caps.
  - **Stage 3 (Combat & Defenses)** — Resolves 18-type bonus stacking (`enhancement`, `deflection`, `natural_armor`, `dodge`, `morale`, `sacred`, etc.) with transparent provenance breakdowns for Full/Touch/Flat-Footed AC, Fort/Ref/Will saves, BAB, Grapple, and Initiative.
  - **Stage 4 (Full-Attack & Wielding Routine)** — Automatically synthesizes the complete `attackRoutine` whenever size, strength, limbs, or grip stances change.
- **Universal Actor Symmetry & Composable Creature Synthesis**:
  - **14 Playable Races** — Human, Dwarf, Elf (High/Wood), Gnome, Half-Elf, Half-Orc, Halfling, Tiefling, Aasimar, Goblin, Kobold, Orc, Hobgoblin.
  - **15 Creature Type Racial HD Engines** — Aberration, Animal, Construct, Dragon, Elemental, Fey, Giant, Humanoid, Magical Beast, Monstrous Humanoid, Ooze, Outsider, Plant, Undead, Vermin.
  - **Composable Templates & Parametric Ladders** — Acquired and inherited templates (*Skeleton*, *Zombie*, *Celestial*, *Fiendish*, *Half-Dragon*, *Ghost*, *Lich*, *Vampire*, *Lycanthrope*), Dragon 12-Age-Category progressions, Elemental size ladders, and non-destructive `WildShapeOverlay` layers.
- **Classes, Chronological Multiclassing & Character Builder**:
  - **11 Core Classes (Levels 1–20)** — Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Wizard.
  - **5 NPC Classes & Prestige Classes** — Adept, Aristocrat, Commoner, Expert, Warrior, plus Prestige Classes (*Arcane Trickster*, *Archmage*, *Assassin*, *Blackguard*, *Dragon Disciple*, *Duelist*, *Dwarven Defender*, *Eldritch Knight*, *Loremaster*, *Mystic Theurge*, *Shadowdancer*) with recursive AST prerequisite validation.
  - **Alternate Class Features (ACFs) & Cleric Domains** — Declarative level feature swaps and domain granted powers + bonus spell lists.
  - **Chronological Level Ledger (`levelHistory`)** — Tracks per-level class choice, HP roll, skill ranks (class vs. cross-class, 42 SRD skills + 5-rank synergies), feats, and supports reversible negative levels / level drain.
  - **Interactive 8-Step Character Builder & 7-Tab Character Sheet** — Point-buy (25/28/32-pt) or 4d6-drop-lowest ability generation, starting equipment package materialization, interactive level-up wizard (`L`), 7-tab Character Sheet (`C`), and Knowledge-gated Monster Dossier (`I`).
- **Tactical Grid, Action Economy & Combat Maneuvers**:
  - **6-Second Combat Rounds** — Standard, Move, Full-Round, Swift/Immediate, and Free actions + 5-foot step tracking (`distanceMovedThisRoundFt`).
  - **Inappropriately Sized Weapons & Grip Modes** — 3-step effort ladder (`light` $\leftrightarrow$ `one_handed` $\leftrightarrow$ `two_handed`) with $-2$ penalty per size step difference; toggleable `1H` / `2H` ($1.5\times \text{STR}$, $1:2$ Power Attack, Rapier & Bastard Sword rules) and `Double Weapon TWF` modes.
  - **Multi-Limb & Natural Weapon Sequencing** — Supports $N$-armed actors (*Marilith*), limb occupation tracking, armed natural weapon demotion to secondary (`-5` or `-2` with *Multiattack*), and per-strike Power Attack multipliers.
  - **Attacks of Opportunity & 9 Combat Maneuvers** — Movement/casting/ranged AoO triggers (*Combat Reflexes*, *Mobility*, *Tumble*), plus Grapple, Trip, Bull Rush, Disarm, Sunder, Feint, Overrun, Aid Another, and Mounted Combat.
- **Vancian Magic & Spell Engine**:
  - **Prepared & Spontaneous Casting** — Per-class spell slots, bonus slots from high ability scores, Cleric Spontaneous Cure/Inflict conversion, and Arcane Spell Failure.
  - **Spellbook & Preparation Modal (`B`)** — Prepare daily spells, apply Metamagic feats (*Empower*, *Maximize*, *Quicken*, *Silent*, *Still*, *Extend*, *Widen*), and Rest (`R`) for 8-hour recovery.
  - **Spell Resolution** — Saving throws (*Evasion* / *Mettle*), Spell Resistance checks, Concentration checks (defensive casting, damage/grapple interruption), Counterspelling, and persistent spatial spell zones (*Grease*, *Web*, *Silence*, *Cloudkill*).

### 🗺️ Exploration, World & Map
- **Procedural & Static Map Generation** — `ROT.Map.Digger` dungeons, cellular automata caves, BSP urban/village generators, and hand-crafted static hubs.
- **Multi-Mode Terrain Traversal** — Land, Climb, Swim, Fly (with maneuverability grades), and Burrow movement speeds allow flying/swimming actors to cross chasms, pits, and deep water.
- **Field of View, Vision Modes & Stealth** — Shadowcasting FOV, Low-Light Vision, Darkvision, Blindsense/Blindsight, Tremorsense, Concealment miss chances, and opposed Hide/Move Silently vs. Spot/Listen detection.
- **Encounter Director** — Spends Challenge Rating (CR) budgets across tactical objectives, hazards, and monster groups.
- **4 Built-in Campaigns**:
  - **Descent (`default`)** — Classic systemic roguelike showcase campaign.
  - **The Sunless Reliquary (`dnd35e-crypt`)** — Full D&D 3.5e SRD tactical dungeon crawl.
  - **The Shroudgarde Borderlands (`shroudgarde`)** — Open-ended borderlands investigation and faction campaign.
  - **The Megadungeon (`megacampaign`)** — Multi-branch deep dungeon crawl.

### 💬 Systemic Narrative, Rivalry & Villains
- **Rivalry & Nemesis Ecosystem (`N`)** — Enemies that defeat or escape the player are promoted into persistent Rivals with procedural titles, scars, grudges, traits, and ambush behaviors, tracked on a hierarchical Nemesis Pyramid.
- **Villain Masterminds & Investigation Board (`V`)** — Background schemes tick independently on the scheduler; defeating agents drops clues linked on an interactive conspiracy board.
- **Knowledge & Rumor Propagation** — World events physically propagate as rumors between NPCs; players broker secrets via branching dialogues, `gossip`, and `ask_about`.
- **Combinatorial Reactions & 12 Interaction Verbs** — `apply`, `throw`, `kick`, `open`, `close`, `lock`, `unlock`, `dip`, `zap`, `ignite`, `read`, `eat` resolved via tag-driven JSON reaction matrices and spreadable environmental fields (fire, smoke, poison gas).

### 🛠️ Built-in Campaign Editor & Simulation Suite
- **Visual Authoring Workspace** — World area graph, 2D faction hostility matrix, dialogue tree editor, tile grid painter, and Zod-driven schema forms with RFC 6902 JSON Patch undo/redo.
- **Simulation Tools** — **AI Arena** (headless combat simulator with telemetry), **Encounter Director Sandbox**, **Scheme Accelerator**, and **Knowledge Propagation Simulator**.
- **Playtest Round-Trip & ZIP Export** — One-click playtest preserves editor state; IndexedDB storage and `.zip` mod export/import.

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
  - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/types/`)**: Reusable RPG simulation primitives (ECS state, anatomical `EquipmentSlotInstance[]` body graphs, layered stat overlays, tag-conditional modifiers, spatial fields, AI, and UI views).
  - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`)**: Pure mathematical laws of the tabletop system (4-stage stat DAG, 18-type bonus stacking, full-attack & maneuver resolvers, Vancian spellcasting).
  - **Tier 3 — System Content (`public/data/rulesets/dnd35e/`)**: 248 modular JSON files parameterizing races, classes, racial HD tracks, templates, feats, skills, spells, equipment, and monsters.
- **Unified Effect Providers & Hierarchical Provenance (`sourcePath`)**: Every mechanical emitter (size, creature type, subtype, race, template, class, feat, condition, armor/load, tactical stance, spatial field) projects semantic tags and emits `StatModifier`s / `RuleOverride`s carrying a slash-delimited `sourcePath` for atomic revocation.
- **Programmatic SSOT Registries & Continuous Parity**:
  - Every `.ts` file under `src/` is registered in either `docs/ssot/ssot_console.json` (251 files) or `docs/ssot/ssot_dnd35e.json` (33 files) with its primary responsibility, canonical exported entry points, ownership boundaries, and forbidden anti-patterns.
  - Human-readable maps (`docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md`) are generated programmatically via `bun run map:ssot` and verified for 100% disk and export parity by `scripts/run-validator.ts` and `tests/ssot_registry_parity.test.ts`.

---

## 📁 Repository Structure

```text
├── AGENTS.md                   # Coding standards, Golden Rules, and 6-Step Workflow
├── verify.sh / verify.bat      # 8-stage verification pipeline (TS, Format, Lint, Arch, Knip, Test, Build, Validator)
├── docs/
│   ├── ARCHITECTURE.md         # Comprehensive subsystem architecture reference
│   ├── DECISIONS.md            # Architectural Decision Records (ADRs)
│   ├── MILESTONES.md           # Project roadmap and completed milestones
│   ├── SSOT_CONSOLE.md         # Auto-generated Core Console SSOT responsibility map
│   ├── SSOT_DND35E.md          # Auto-generated D&D 3.5e Cartridge SSOT responsibility map
│   ├── ssot/                   # Authoritative JSON SSOT registries (ssot_console.json, ssot_dnd35e.json)
│   ├── dnd35e/                 # D&D 3.5e SRD domain reference specs
│   ├── guides/                 # Campaign authoring and ruleset developer guides
│   └── archive/                # Historical audits and design scratchpads
├── public/data/
│   ├── campaigns/              # Built-in campaigns (default, dnd35e-crypt, megacampaign, shroudgarde)
│   └── rulesets/dnd35e/        # 248 modular D&D 3.5e SRD JSON data files
├── scripts/                    # Campaign validator, SSOT parity engine, and codebase mapper
├── tests/                      # Bun regression test suites (111 tests across 18 suites)
└── src/
    ├── actions/                # Action handlers and verb dispatch registry
    ├── constants/              # Engine constants, keybinds, and palettes
    ├── core/                   # ECS state, session controller, loader, RNG, scheduler, input
    ├── editor/                 # Built-in Campaign Editor, AI Arena, and workspace services
    ├── map/                    # Procedural map generators, FOV wrapper, and Encounter Director
    ├── rendering/              # ROT.js display manager, viewport snapshots, and DOM UI views
    ├── rulesets/               # Ruleset registry, classic strategy, and dnd35e/ cartridge
    ├── systems/                # Pure ECS systems (combat, movement, effects, AI, rivalry, quests)
    ├── types/                  # Branded IDs, ECS component schemas, and Zod campaign types
    ├── utils/                  # Grid math, pathfinding, text parsing, and stat helpers
    ├── worker/                 # Off-thread Web Workers (map generation and fuzzer)
    └── main.ts                 # Application bootstrap entry point
```

---

## 📖 Documentation

- **[`AGENTS.md`](./AGENTS.md)** — Golden Rules, TypeScript strictness standards, and development workflow.
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — Deep-dive system design and data flow across all engine subsystems.
- **[`docs/DECISIONS.md`](./docs/DECISIONS.md)** — Architectural tradeoffs and rationale (Decisions 1–21).
- **[`docs/MILESTONES.md`](./docs/MILESTONES.md)** — Complete milestone history and upcoming phases.
- **[`docs/SSOT_CONSOLE.md`](./docs/SSOT_CONSOLE.md)** & **[`docs/SSOT_DND35E.md`](./docs/SSOT_DND35E.md)** — Canonical file ownership and entry-point maps.
- **[`docs/guides/CAMPAIGN_AUTHORING.md`](./docs/guides/CAMPAIGN_AUTHORING.md)** — Guide to creating custom campaigns and JSON mods.

---

## 🛠️ Verification & Utility Scripts

| Command | Description |
| :--- | :--- |
| `./verify.sh` / `.\verify.bat` | Runs the complete 8-stage verification pipeline (Typecheck, Format, ESLint, Dependency Cruiser, Knip Dead-Code, Bun Tests, Production Build, and Campaign/SSOT Validator). |
| `bun run dev` | Starts the Vite development server. |
| `bun run build` | Type-checks and builds the production bundle into `dist/`. |
| `bun test` | Runs all unit and integration regression test suites (`tests/`). |
| `bun run validate:campaigns` | Validates all campaigns, modular ruleset files, and SSOT registry parity (`scripts/run-validator.ts`). |
| `bun run map:ssot` | Regenerates `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` from `docs/ssot/*.json` (`scripts/map-codebase.ts`). |
| `bun run lint` | Runs ESLint across `src/`. |
| `bun run lint:arch` | Verifies downward dependency layering via `dependency-cruiser`. |
| `bun run lint:deadcode` | Scans for unused files, exports, and dependencies via `knip`. |
| `bun run format` | Formats source files with Prettier. |
