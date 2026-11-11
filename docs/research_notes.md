# Research Notes — Phase 29: SSOT Architectural Hygiene, Cartridge Boundary Purification & Declarative Monster/Template De-Hardcoding (Milestones 127 & 128)

## 1. Core Architectural Rules & Standards Reiteration (`AGENTS.md` & `ARCHITECTURE.md`)
- **Rule 11 (Zero `any`) & Rule 12 (No Magic Values):** Strict TypeScript (`exactOptionalPropertyTypes: true`), explicit return types, and named constants or JSON-driven registries for all gameplay values.
- **Rule 15 (Cascading Effects Matrix):** Enumerate all **Upstream** callers, **Downstream** consumers, and **Lateral** mirrors (including SSOT JSONs, `.dependency-cruiser.cjs`, and test suites).
- **Rule 16 (Three-Tier Placement Heuristic):**
  - **Tier 1 (`src/core/`, `src/systems/`, `src/types/`, `src/rulesets/registry.ts`):** Pure Console engine primitives and cartridge-agnostic contract registries. Must never re-export or hardcode ruleset-specific symbols.
  - **Tier 2 (`src/rulesets/<id>/`, Cartridge UI views):** Ruleset mathematical resolvers, adapters, and cartridge-owned UI modals/inspectors.
  - **Tier 3 (`public/data/rulesets/<id>/*.json`):** Declarative JSON data (races, archetypes, templates, spells, items) parameterizing Tier 2 resolvers.
- **Rule 17 & Rule 18 (No Hardcoded Content Spaghetti & Composable Templates):** Tier 2 resolvers (`family_synthesizer.ts`, `templates.ts`) must never hardcode `if (golemArchetypeId === 'flesh_golem')` branches or TypeScript copies of creature templates (`CELESTIAL_TEMPLATE`, `FIENDISH_TEMPLATE`, etc.) that duplicate Tier 3 JSON registries (`templates.json`, `races.json`).
- **No Barrel Files (`AGENTS.md §8` & `.dependency-cruiser.cjs`):** Pure re-export shims (`modifiers.ts`, `attack_resolver.ts`, `builder_hydrator.ts`) and cross-tier smuggling barrels (`src/rulesets/registry.ts` lines 55–166) must be evicted in favor of direct canonical imports.

---

## 2. Empirical Codebase Audit Findings

### Finding 1: Tier-Boundary Smuggling in `src/rulesets/registry.ts` (Milestone 127)
- **Current State:** `src/rulesets/registry.ts` is a Tier 1 Console module (`tier1_console` in `ssot_console.json`). Lines 1–53 implement the canonical `RulesetContract` registry (`registerRuleset`, `getRuleset`, `getAllRulesets`, `getActiveRuleset`). However, **lines 55–166 (`112 lines`) re-export 60+ D&D 3.5e-specific symbols** (`applyCharacterCreationToPlayer`, `WIZARD_BONUS_ITEM_CREATION_AND_MASTERY_FEATS`, `FAVORED_ENEMY_BONUS_STEP`, `evaluateDnD35eEntityDAG`, `DnD35UIAdapter`, etc.) plus `DefaultSciFiUIAdapter`.
- **Root Cause Discovery:**
  - `.dependency-cruiser.cjs` rule `no-direct-cartridge-imports-outside-registry` blocks `from: '^src/(core|systems|actions|rendering|map)/'` $\rightarrow$ `to: '^src/rulesets/(classic|dnd35e)/'`.
  - Because `21` Tier 2 Cartridge UI files (`src/rendering/ui/dnd35e_*.ts` and `src/rendering/ui/classic_ui_adapter.ts`) reside inside `src/rendering/ui/`, they were blocked from importing `src/rulesets/dnd35e/*` directly—so 60+ cartridge internals were smuggled through `src/rulesets/registry.ts`.
  - Every genuine Tier 1 Console caller (`hud.ui.ts`, `inspect_tooltip.ts`, `editor_*.ts`, `combat.system.ts`, `damage.system.ts`, `death.system.ts`, `apply.system.ts`, `social.system.ts`, `zap.system.ts`, `lifecycle.system.ts`, `system_content_loader.ts`, `session_dom.ts`, `campaign_validator.ts`, `stats.ts`) ONLY imports `getRuleset`, `getAllRulesets`, or `getActiveRuleset`!
- **Clean Architecture Solution:**
  - Scope `.dependency-cruiser.cjs` `no-direct-cartridge-imports-outside-registry` so Tier 1 Console modules (`src/(core|systems|actions|map)/` and non-cartridge `src/rendering/`) remain strictly forbidden from importing `src/rulesets/(classic|dnd35e)/`, while Tier 2 Cartridge UI modules (`src/rendering/ui/dnd35e_*.ts` and `src/rendering/ui/classic_ui_adapter.ts`) are permitted to import their own cartridge modules directly (with `no-cross-ruleset-imports` extended to prevent `dnd35e_*.ts` from importing `classic` and vice versa).
  - Evict all 112 lines of cartridge-specific re-exports from `src/rulesets/registry.ts`, restoring `registry.ts` to a pure 53-line Tier 1 `RulesetContract` registry.

### Finding 2: Exact File Duplication & Split UI Adapter Naming (Milestone 127)
1. **Byte-for-Byte Duplicate `fuzzer.types.ts`:**
   - `src/types/fuzzer.types.ts` (`40 lines`, `1,183 bytes`) and `src/editor/simulation/fuzzer.types.ts` (`40 lines`, `1,183 bytes`) are 100% identical.
   - Currently, `7` files (`narrative_fuzzer.ts`, `narrative_fuzzer_async.ts`, `fuzzer_invariants.ts`, `fuzzer_telemetry.ts`, `worker.types.ts`, `worker_bridge.ts`, `fuzzer.worker.ts`) import `src/editor/simulation/fuzzer.types.ts`, while `0` files import `src/types/fuzzer.types.ts`.
   - Furthermore, `src/worker/*.ts` importing upward from `src/editor/simulation/fuzzer.types.ts` couples the worker layer to the editor directory.
   - **Solution:** Delete `src/editor/simulation/fuzzer.types.ts` and point all 7 importers to the canonical `src/types/fuzzer.types.ts`.
2. **Orphan `src/rulesets/default/` Folder & Duplicate `dnd35e_ui_adapter.ts` Basename:**
   - `src/rulesets/default/ui/default_ui_adapter.ts` lives in a folder named `default` even though the ruleset ID and directory for the classic ruleset is `src/rulesets/classic/`. Moving it to `src/rulesets/classic/ui/classic_ui_adapter.ts` (and renaming `src/rendering/ui/classic_ui_adapter.ts` $\rightarrow$ `src/rendering/ui/classic_ui_registration.ts`, and `src/rendering/ui/dnd35e_ui_adapter.ts` $\rightarrow$ `src/rendering/ui/dnd35e_ui_registration.ts`) eliminates the phantom `src/rulesets/default/` directory and resolves the duplicate `dnd35e_ui_adapter.ts` basename in `SSOT_DND35E.md`.
3. **Duplicate Tactical Constants:**
   - `FLANKING_ATTACK_BONUS = 2` in `src/rulesets/dnd35e/spatial/cover_senses.ts` is duplicated as `BASE_FLANKING_BONUS = 2` in `combat_exchange_phases.ts` and `DEFAULT_FLANKING_BONUS = 2` in `modifiers/dag_resolver.ts`.
   - `FEET_PER_GRID_SQUARE = 5` in `src/rulesets/dnd35e/spatial/grid_geometry.ts` is duplicated as `STANDARD_STEP_DISTANCE_FT = 5` in `dnd35e_lifecycle_adapter.ts`.

### Finding 3: SSOT Taxonomy & Domain Fragmentation (Milestone 127)
- **`docs/ssot/ssot_console.json`:**
  - `src/ai/*.behavior.ts` (5 AI behavior modules) are misclassified under `"Core Console: App Entry & Wiring"` alongside `main.ts` and `vite-env.d.ts` instead of `"Core Console: ECS Systems & Simulation"`.
  - Orphan 1–2 file domains (`"Core Console: ECS Systems & Game Loop"` [2 files], `"Core Console: Map Generation & Spatial"` [2 files], `"Core Console: Foundation & Data Types"` [1 file]) split single logical domains across multiple headers.
- **`docs/ssot/ssot_dnd35e.json`:**
  - `"D&D 3.5e: Core Cartridge & Progression"` is a 55-file monolith mixing Character Builder, Horizon 2 Level Ledger, Skills/Verbs, Archetype/Race/Template hydration, and Cartridge Adapters, while `"D&D 3.5e: Core Cartridge & Ruleset Contract"` (1 file), `"D&D 3.5e: Combat Simulation & Resolution"` (2 files), and `"D&D 3.5e: Layer 1 — Math & Multipliers"` (2 files) are tiny orphan headers.
  - Consolidating orphan headers and partitioning the 55-file mega-bucket into clean architectural domains (`Core Cartridge & Adapters`, `Layer 2 — Progression, Classes & Level Ledger`, `Layer 2 — Character Builder & Level-Up`, `Layer 2 — Archetypes, Races, Templates & Families`, `Layer 4 — Skills & Skill Verbs`) makes `SSOT_DND35E.md` immediately scannable and authoritative.

### Finding 4: Hardcoded Golem Magic Immunity & Duplicate SRD Templates in TypeScript (Milestone 128)
1. **Hardcoded `evaluateGolemMagicInteraction` in `src/rulesets/dnd35e/family_synthesizer.ts`:**
   - Currently hardcodes `if (golemArchetypeId === 'flesh_golem')`, `if (golemArchetypeId === 'iron_golem')`, `if (golemArchetypeId === 'clay_golem')`, `if (golemArchetypeId === 'stone_golem')` with magic literals (`Math.floor(spellDamageAmount / 3)`, `slowsRounds: 3`).
   - Per Rules 16–19, Golem spell-immunity exceptions belong in Tier 3 JSON (`magicImmunityExceptions` on `DnD35RaceDefinition` / `DnD35Archetype` in `public/data/rulesets/dnd35e/races/*.json`), evaluated by a generic, data-driven resolver that reads the creature's declarative exception rules.
2. **Duplicate Hardcoded Templates in `src/rulesets/dnd35e/templates/srd_templates.ts`:**
   - `srd_templates.ts` (`134 lines`) hardcodes TypeScript constant copies (`CELESTIAL_TEMPLATE`, `FIENDISH_TEMPLATE`, `SKELETON_TEMPLATE`, `ZOMBIE_TEMPLATE`, `LICH_TEMPLATE`) that duplicate `public/data/rulesets/dnd35e/templates.json`.
   - Zero runtime files in `src/` use `srd_templates.ts`; only `tests/dnd35e_phase21_primitives.test.ts` imports `FIENDISH_TEMPLATE`, `SKELETON_TEMPLATE`, and `ZOMBIE_TEMPLATE`.
   - **Solution:** Update `tests/dnd35e_phase21_primitives.test.ts` to read templates from the loaded campaign's `systemContent.templates` (`getDnD35Template`), and delete the redundant `src/rulesets/dnd35e/templates/srd_templates.ts` file!
3. **Pure Re-Export Barrel Shims (`builder_hydrator.ts`, `attack_resolver.ts`, `modifiers.ts`):**
   - `src/rulesets/dnd35e/builder/builder_hydrator.ts` (`3 lines`), `src/rulesets/dnd35e/combat/attack_resolver.ts` (`6 lines`), and `src/rulesets/dnd35e/modifiers.ts` (`6 lines`) contain zero logic of their own—they are pure re-export barrels left over from earlier file splits.
   - Evicting `builder_hydrator.ts` (and optionally folding or directly importing the sub-modules of `attack_resolver.ts` / `modifiers.ts`) removes unnecessary indirection hops.

---

## 3. Proposed Phase 29 Milestone Breakdown

- **Milestone 127: Cartridge Boundary Purification, Duplicate Eviction & SSOT Domain Rebalancing**
  1. Evict all 112 lines of D&D 3.5e / Classic re-exports from `src/rulesets/registry.ts` and refine `.dependency-cruiser.cjs` so Tier 2 UI files (`dnd35e_*.ts`, `classic_ui_registration.ts`) import directly from their own cartridge modules while Tier 1 Console modules remain strictly isolated.
  2. Delete duplicate `src/editor/simulation/fuzzer.types.ts` and point all 7 simulation/worker importers to `src/types/fuzzer.types.ts`.
  3. Move `src/rulesets/default/ui/default_ui_adapter.ts` $\rightarrow$ `src/rulesets/classic/ui/classic_ui_adapter.ts` (removing the orphan `src/rulesets/default/` directory) and rename `src/rendering/ui/{dnd35e,classic}_ui_adapter.ts` $\rightarrow$ `src/rendering/ui/{dnd35e,classic}_ui_registration.ts` to eliminate duplicate filenames.
  4. Deduplicate `FLANKING_ATTACK_BONUS` and `FEET_PER_GRID_SQUARE` across D&D 3.5e modules and rebalance `ssot_console.json` & `ssot_dnd35e.json` domains.

- **Milestone 128: Declarative Magic-Immunity Exceptions, Template JSON Unification & Barrel Shim Eviction**
  1. Replace hardcoded `if (golemArchetypeId === ...)` branches in `evaluateGolemMagicInteraction` (`family_synthesizer.ts`) with declarative `magicImmunityExceptions` schemas on `DnD35RaceDefinition` / `DnD35Archetype` and data entries in `flesh_golem.json`, `iron_golem.json`, `clay_golem.json`, and `stone_golem.json`.
  2. Delete the redundant hardcoded `src/rulesets/dnd35e/templates/srd_templates.ts` (`134 lines`) and migrate `tests/dnd35e_phase21_primitives.test.ts` to use the canonical Tier 3 `templates.json` registry (`getDnD35Template`).
  3. Evict pure 3-line/6-line pass-through barrel shims (`src/rulesets/dnd35e/builder/builder_hydrator.ts` and multi-hop re-exports in `character_builder.ts`) and verify 100% SSOT and architectural lint parity.

---

## 4. Preliminary Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Importers) | Downstream (Consumers / Validators) | Lateral (Sibling Configs / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. Evict cartridge barrel from `src/rulesets/registry.ts`** | `20` `src/rendering/ui/dnd35e_*.ts` files, `classic_ui_registration.ts`, `tests/dnd35e_phase26_ui_and_showcase.test.ts`, `tests/ruleset_validators.test.ts` | `.dependency-cruiser.cjs` (`no-direct-cartridge-imports-outside-registry`, `no-cross-ruleset-imports`), `knip` deadcode check | `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md` |
| **2. Delete `src/editor/simulation/fuzzer.types.ts`** | `narrative_fuzzer.ts`, `narrative_fuzzer_async.ts`, `fuzzer_invariants.ts`, `fuzzer_telemetry.ts`, `worker.types.ts`, `worker_bridge.ts`, `fuzzer.worker.ts` | `tsc --noEmit`, `knip`, `run-validator.ts` SSOT parity | `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md` |
| **3. Relocate `default_ui_adapter.ts` $\rightarrow$ `src/rulesets/classic/ui/classic_ui_adapter.ts` & rename `*_ui_registration.ts`** | `src/main.ts`, `src/rendering/ui/classic_ui_registration.ts`, `tests/console_ui_architecture.test.ts` | `cartridge_ui_registry.ts`, `run-validator.ts` SSOT parity | `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json` |
| **4. Declarative `magicImmunityExceptions` & delete `srd_templates.ts`** | `family_synthesizer.ts`, `templates.ts`, `tests/dnd35e_phase21_primitives.test.ts`, `tests/dnd35e_phase22_bestiary.test.ts` | `creature_system.types.ts`, `dnd35e_validator.ts`, `run-validator.ts` | `public/data/rulesets/dnd35e/races/{flesh,iron,clay,stone}_golem.json`, `docs/ssot/ssot_dnd35e.json` |
