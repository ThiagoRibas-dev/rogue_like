# Research Notes — SSOT Integrity, Split-Brain Eviction, Tier Boundary & Rule 21 Audit

> **Status:** Phase 1, Step 3 — Research Complete (Awaiting User Confirmation before Step 4 Implementation Plan)
> **Governing Standards:** `AGENTS.md` (Rules 15, 16, 17, 19, 21; §3–§8), `docs/ARCHITECTURE.md`, `.dependency-cruiser.cjs`, `scripts/ssot_parity.ts`.

---

## 1. Executive Summary

A full cross-audit of `docs/ssot/ssot_console.json` (`316` files), `docs/ssot/ssot_dnd35e.json` (`165` files), and the `src/` tree (`481` total files) uncovered four concrete categories of architectural debt and `AGENTS.md` violations:

1. **Workstream A — Split-Brain & UI Layering Eviction:**
   - Legacy `inventory.ui.ts` + `equipment.ui.ts` ("old brain" paper doll) bypassed by every active cartridge in favor of `console_inventory.ui.ts` (`renderReactivePaperDollWidget`).
   - Pure D&D 3.5e gameplay simulation and ECS mutation (`dnd35e_rest_recovery.ts`, `dnd35e_rest_actions.ts`, `dnd35e_doctrine_actions.ts`, `dnd35e_spellbook_actions.ts`) residing inside `src/rendering/ui/` instead of `src/rulesets/dnd35e/`.
   - Parallel character sheet shells (`console_dossier.ui.ts` used only by `classic`, vs. 6-file `dnd35e_sheet*.ui.ts`) and naming collision with Nemesis [`dossier.ui.ts`](../src/rendering/ui/dossier.ui.ts).
2. **Workstream B — Tier 1 Console vs. Tier 2 Cartridge Boundary Hygiene (Rule 16):**
   - `src/rulesets/classic/{classic_combat,classic_ruleset,classic_stats,classic_validator}.ts` misclassified as `tier1_console` in `ssot_console.json` (while `classic_ui_adapter.ts` is `tier2_cartridge`).
   - All 9 `src/rulesets/dnd35e/types/*.ts` files tagged `tier1_types` inside `ssot_dnd35e.json` because `SsotFileTierSchema` lacks a `tier2_types` variant.
   - 32 `src/rendering/ui/dnd35e_*.ts` cartridge UI files living inside Tier 1's `src/rendering/ui/` directory alongside `src/rulesets/dnd35e/ui/`.
   - Tier 1 Console files (`world_clock.constants.ts`, `world_time_skip.ts`, `movement_footprint.ts`) citing "SRD" terminology in comments/SSOT responsibilities.
3. **Workstream C — Declarative Purity & Rule 21 Compliance (Zero Content-ID Branching in `.ts`):**
   - 1 Tier 1 violation (`viewport_snapshot.ts:80` checking `tile.tileId === 'stone_wall'`).
   - 6 Tier 2 D&D 3.5e violations (`spellbook_slots.ts`, `dnd35e_quickcast_model.ts`, `dnd35e_ui_hotbar.ts`, `dnd35e_spellbook_known.ui.ts`, `race_hydrator.ts`, `shapeshift.ts`) branching on `'wizard'`, `'cleric'`, `'druid'`, `'warlock'`, `'innate'`, `'warrior'`, `'shapeshift'` despite declarative schemas/JSON fields already existing for most of them.
4. **Workstream D — SSOT Registry & Parity Engine Hardening (`scripts/ssot_parity.ts`, `docs/ssot/*.json`):**
   - `182` duplicate `canonicalEntryPoints` across files caused by barrel/facade re-exports (`export *` and pass-through re-exports) being claimed as canonical in multiple entries (e.g. `createEntity` claimed by 4 files).
   - Fragmented near-duplicate domain names splitting cohesive subsystems across multiple markdown sections.
   - `460 / 481` generic boilerplate `ownershipBoundary` entries and `9` truncated/mid-sentence `responsibility` strings.

---

## 2. Detailed Code-Verified Findings by Workstream

### Workstream A — Split-Brain & UI Layering Eviction

| Area | Files Involved | Verified Findings | Architectural Rule Violated |
| :--- | :--- | :--- | :--- |
| **Paper Doll / Inventory** | `src/rendering/ui/inventory.ui.ts`<br>`src/rendering/ui/equipment.ui.ts`<br>`src/rendering/ui/console_inventory.ui.ts`<br>`src/rendering/ui/dnd35e_sheet_equipment_tab.ui.ts` | `inventory.ui.ts:16-26` checks `const sheetModal = cartridgeUI?.modals['character_sheet'] ?? cartridgeUI?.modals['inventory']; if (sheetModal) { overlay.classList.add('hidden'); return; }`. Both `classic` (`classic_ui_registration.ts`) and `dnd35e` (`dnd35e_ui_registration.ts`) register `character_sheet`, so `inventory.ui.ts` + `equipment.ui.ts` (`renderAnatomicalPaperDoll`) are never rendered for any built-in cartridge. Only `inventory.ui.ts` imports `equipment.ui.ts`. | SSOT Ownership / Old-Brain Eviction (`AGENTS.md` Step 4, Rule 16) |
| **Rest & Recovery Simulation in UI** | `src/rendering/ui/dnd35e_rest_recovery.ts`<br>`src/rendering/ui/dnd35e_rest_actions.ts`<br>`src/rulesets/dnd35e/magic/aoe_rest.ts`<br>`src/systems/world_time_skip.ts` | `dnd35e_rest_recovery.ts` (210 lines) has **zero DOM imports** — it imports only `ecs.ts`, `rulesets/dnd35e/*`, `systems/*`, and `types/*`, evaluating party rest safety and mutating ECS components (`addComponent`, `setDnD35EntityData`). `dnd35e_rest_actions.ts` mixes pure synchronous simulation (`executeEightHourRest`, `executeWaitUntilPhase`) with async loading-overlay UI helpers (`showLoadingOverlay`). | `.dependency-cruiser.cjs` (`headless-simulation-purity`), `AGENTS.md` Rule 16 (Tier 2 simulation must live in `src/rulesets/dnd35e/`) |
| **Doctrine & Spellbook Mutations in UI** | `src/rendering/ui/dnd35e_doctrine_actions.ts`<br>`src/rendering/ui/dnd35e_spellbook_actions.ts` | `updateActorTacticalDoctrine`, `prepareSpellIntoSpecificSlot`, and `unprepareSlot` are pure `GameState -> GameState` cartridge reducers living in `src/rendering/ui/` alongside thin `setGameState` + `markAllDomainsDirty` UI wrappers. | `AGENTS.md` Rule 16, ECS/Headless Simulation Purity |
| **Master Dossier vs. D&D Sheet** | `src/rendering/ui/console_dossier.ui.ts`<br>`src/rendering/ui/dnd35e_sheet.ui.ts`<br>`src/rendering/ui/dossier.ui.ts` | `console_dossier.ui.ts` is used by `classic_ui_registration.ts` and re-exported in `ui.ts`; `dnd35e_sheet.ui.ts` implements D&D 3.5e's 3-tab sheet (reusing `console_inventory.ui.ts` and `DnD35UIAdapter`); `dossier.ui.ts` is the Nemesis/Rival Dossier (distinct domain, confusing filename). **Verified non-split-brain:** `currency.system.ts` vs `dnd35e/currency.ts` is clean (Console owns engine math, D&D 3.5e exports only `DND35E_DEFAULT_CURRENCY_CONFIG`). | Naming clarity & explicit `ownershipBoundary` documentation in SSOT |

---

### Workstream B — Tier 1 vs. Tier 2 Boundary & Directory Hygiene (Rule 16)

1. **`SsotFileTierSchema` (`scripts/ssot_parity.ts:13-18`):**
   - Currently: `z.enum(['tier1_console', 'tier1_types', 'tier2_cartridge', 'tier2_ui'])`.
   - Missing `'tier2_types'`, causing all 9 `src/rulesets/dnd35e/types/*.ts` files to be mislabeled as `'tier1_types'`.
2. **Classic Cartridge entries in `docs/ssot/ssot_console.json`:**
   - `src/rulesets/classic/classic_combat.ts`, `classic_ruleset.ts`, `classic_stats.ts`, and `classic_validator.ts` are labeled `tier1_console` instead of `tier2_cartridge`.
   - `isDnd35eFile()` in `scripts/ssot_parity.ts:69-71` partitions `src/` strictly into `(dnd35e)` vs `(console + classic)`. Keeping `classic` in `ssot_console.json` is acceptable if its tier is strictly `tier2_cartridge` / `tier2_ui` and domain is `Ruleset Cartridge: Classic Sci-Fi`, OR a dedicated `ssot_classic.json` can be added (note: `ssot_registry_parity.test.ts` and `run-validator.ts` currently assert a 2-registry partition).
3. **Physical Location of `src/rendering/ui/dnd35e_*.ts` (32 files):**
   - `.dependency-cruiser.cjs:35-54` currently whitelists `^src/rendering/ui/(dnd35e_|classic_ui_)` to import from `src/rulesets/$1/`.
   - Moving pure simulation files (`dnd35e_rest_recovery.ts` and pure reducers from `dnd35e_rest_actions.ts` / `dnd35e_doctrine_actions.ts` / `dnd35e_spellbook_actions.ts`) into `src/rulesets/dnd35e/` requires **zero** loosening of `.dependency-cruiser.cjs` and immediately makes them testable in headless mode under `headless-simulation-purity`.
   - Moving all 32 DOM `.ui.ts` files into `src/rulesets/dnd35e/ui/` would require updating `.dependency-cruiser.cjs` (`headless-simulation-purity` currently forbids ALL of `src/rulesets/**` from importing `src/rendering/**`!), which would weaken that rule unless scoped to `src/rulesets/*/ui/`. Keeping DOM renderers in `src/rendering/ui/dnd35e_*.ui.ts` while evacuating **all pure simulation/mutation logic** to `src/rulesets/dnd35e/` preserves `headless-simulation-purity` untouched!
4. **Tier 1 Console "SRD" Terminology:**
   - `src/constants/world_clock.constants.ts`, `src/systems/world_time_skip.ts`, and `src/systems/movement_footprint.ts` use generic console mechanics (hunger scaling, squeezing compression, bulk time skip) whose JSDoc/SSOT descriptions say "SRD hunger" / "SRD squeezing". Rephrasing to ruleset-agnostic Console terminology keeps Tier 1 conceptually pure.

---

### Workstream C — Rule 21 Declarative Purity (Verified Content-ID Branches in `.ts`)

| # | File & Line | Hardcoded Branch | Existing / Needed Declarative Mechanism |
| :--- | :--- | :--- | :--- |
| 1 | `src/rendering/viewport_snapshot.ts:80` | `if (tile.tileId === 'stone_wall')` | Check `!tileDef.walkable && tileDef.blocksSight` (or `tileDef.blocksSight`) to select `wallDimFg` vs `floorDimFg`. Works for every custom wall tile in any campaign. |
| 2 | `src/rulesets/dnd35e/magic/spellbook_slots.ts:105` & `src/rendering/ui/dnd35e_spellbook_known.ui.ts:138` | `book.classId === 'wizard'` / `classId === 'wizard'` | Add optional `supportsArcaneSchoolSpecialization?: boolean` to `DnD35ClassDefinitionSchema` (`creature_system.types.ts`) and set `true` in `public/data/rulesets/dnd35e/classes/wizard.json` (or inspect `classDef.featureDetails` for a declarative `grantsSpecialistSlotPerLevel: true` flag). |
| 3 | `src/rulesets/dnd35e/magic/spellbook_slots.ts:245-246` | `if (classId === 'cleric') return ['cure_or_inflict'];` / `if (classId === 'druid') return ['summon_nature_ally'];` | `cleric.json` and `druid.json` **already declare** `spontaneousConversionMode` in `featureDetails`! Remove the hardcoded fallback branches (ensure callers/tests pass `systemContent`). |
| 4 | `src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts:108-110` | `classId === 'cleric' && activeSet.has('spontaneous:cure')` / `classId === 'druid' && activeSet.has('spontaneous:sna')` | Call `resolveActiveSpontaneousConversionModes(classId, dndData, sys)` (already imported/available from `spellbook_slots.ts`) and check `modes.includes('cure_or_inflict')` / `modes.includes('summon_nature_ally')`. |
| 5 | `src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts:190,251` & `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts:258` | `classId === 'warlock' || classId === 'innate'` | Support `castingMode: 'innate'` (or `book.castingMode === 'innate'` / `classDef?.castingMode === 'innate'`) instead of matching literal `'warlock'` / `'innate'` class IDs. |
| 6 | `src/rulesets/dnd35e/archetype/race_hydrator.ts:95,107,110,123` | `cl.classId === 'warrior'` | `warrior.json` **already exists** on disk with `isNpcClass: true` and full `progression` rows! Remove the hardcoded `'warrior'` curve fallbacks (rely on `clsDef` data, and use a named constant `DEFAULT_FALLBACK_NPC_CLASS_ID` or data-driven `raceDef.defaultClassId` only for the default 1-level humanoid class when unspecified). |
| 7 | `src/rulesets/dnd35e/shapeshift.ts:164,172` | `if (featId === 'shapeshift') return true;` and `selectedAcfs.some((a) => a.includes('shapeshift'))` | Lines 165–170 **already check** `abilities.some((a) => a.toggleGroup === SHAPESHIFT_STANCE_GROUP_ID || a.formOverlay !== undefined)` declaratively! Verify `druid.json` / ACF definitions declare `toggleGroup`/`formOverlay` and remove the string-matching fallback. |

---

### Workstream D — SSOT Registry & Parity Engine Hardening (`scripts/ssot_parity.ts`, `docs/ssot/*.json`)

1. **Duplicate `canonicalEntryPoints` (`182` overlaps across files):**
   - Root cause: `extractExportedNames` in `scripts/ssot_parity.ts:114-129` follows `export * from` and `export { ... }`, and earlier registry generation copied re-exported names into both the defining leaf module *and* every barrel/facade that re-exports it (e.g., `createEntity` in 4 files, `promoteEntity` in 3 files, `resolveDiplomacyCheck` in 2 files).
   - Fix:
     - Keep `extractExportedNames` validating live exports, **plus** add a **unique canonical ownership check** in `validateSsotRegistries` (warning or error when the same symbol appears in `canonicalEntryPoints` of 2+ files, with an explicit allowlist only if needed — ideally 0 duplicates!).
     - Deduplicate `ssot_console.json` and `ssot_dnd35e.json` so **only the defining file** lists a symbol in `canonicalEntryPoints`; re-exporting facades list only their own symbols (or `[]` with `"Facade re-exporting ..."` in `responsibility` / `ownershipBoundary`).
2. **Domain Normalization:**
   - Merge fragmented domains into clean canonical domain names:
     - `Core Console: Map Generation & Spatial` (2) → `Core Console: Map Generation & Director`
     - `Core Console: ECS Systems & Game Loop` (2) → `Core Console: ECS Systems & Simulation`
     - `Core Console: Foundation & Data Types` (1) → `Core Console: Engine Types & Schemas`
     - `D&D 3.5e: Combat Simulation & Resolution` (2) & `D&D 3.5e: Layer 5 — Combat Maneuvers & Conditions` (1) → `D&D 3.5e: Layer 5 — Combat, Maneuvers & Damage`
     - `D&D 3.5e: Layer 1 — Math & Multipliers` (2) → `D&D 3.5e: Layer 1 — Math, Bonus Stacking & Stat DAG`
     - `D&D 3.5e: Core Cartridge & Ruleset Contract` (5) → `D&D 3.5e: Cartridge Adapters, Core & Validation`
3. **Fix 9 Truncated / Mid-Sentence `responsibility` Strings:**
   - Rewrite accurate, complete sentences for `core.actions.ts`, `interaction.actions.ts`, `inventory.actions.ts`, `mouse_input.ts`, `procedural_sprites.ts`, `tactical_snapshot.ts`, `tactical_overlay.ui.ts`, `nemesis.system.ts`, `zap.system.ts`.
4. **Upgrade Boilerplate `ownershipBoundary` (`460 / 481`):**
   - Replace generic `"Pure implementation and exports for <file>."` on high-churn / architectural boundary modules (all facades, UI modals, rest/spell/combat/equipment owners) with concrete `includes` / `excludes` boundaries, and add domain-level defaults where appropriate.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Producers / Fixtures) | Downstream (Consumers / Validators / UI / Tests) | Lateral (Sibling Files / Docs / Registries) |
| :--- | :--- | :--- | :--- |
| **A1: Retire legacy `equipment.ui.ts` / slim `inventory.ui.ts`** | `src/rendering/ui.ts`, `src/rendering/presenter.ts`, `index.html` (`#inventory-overlay`) | `tests/` (check any unit tests importing `inventory.ui.ts` or `equipment.ui.ts`), Knip dead-code check | `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md`, `docs/ARCHITECTURE.md` |
| **A2: Move `dnd35e_rest_recovery.ts` & pure rest/doctrine/spellbook reducers to `src/rulesets/dnd35e/`** | `dnd35e_rest_actions.ts`, `dnd35e_spellbook_actions.ts`, `dnd35e_doctrine_actions.ts`, `dnd35e_sheet_attacks_tab.ui.ts`, `dnd35e_ui_registration.ts` | `.dependency-cruiser.cjs` (`headless-simulation-purity` now validates moved files!), `tests/` (any tests importing `dnd35e_rest_actions.ts` or `dnd35e_spellbook_actions.ts`) | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md`, `docs/ARCHITECTURE.md` |
| **B1: Add `tier2_types` to `SsotFileTierSchema` & fix `classic` tiers** | `scripts/ssot_parity.ts` | `tests/ssot_registry_parity.test.ts`, `scripts/run-validator.ts` (`[8/8]`) | `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md` |
| **C1: Replace `tile.tileId === 'stone_wall'` in `viewport_snapshot.ts`** | Campaign `tiles.json` (`blocksSight` / `walkable` flags across all 5 campaigns) | Fog-of-war dim tint rendering in `viewport_snapshot.ts` and any viewport snapshot tests | All 5 campaigns' `tiles.json` (verify walls have `blocksSight: true`) |
| **C2–C7: Remove hardcoded D&D class/feat ID branches** | `public/data/rulesets/dnd35e/classes/{wizard,cleric,druid,warrior}.json`, `DnD35ClassDefinitionSchema`, `DnD35ClassSpellbookState` | `spellbook_slots.ts`, `dnd35e_quickcast_model.ts`, `dnd35e_ui_hotbar.ts`, `dnd35e_spellbook_known.ui.ts`, `race_hydrator.ts`, `shapeshift.ts`, plus D&D unit tests (verify mock fixtures pass `systemContent` or declarative flags!) | `public/data/campaigns/default/ai-prompt-kit/` (if schema docs change), `docs/DECISIONS.md` |
| **D1–D4: Deduplicate 182 `canonicalEntryPoints`, normalize domains, enforce uniqueness in `ssot_parity.ts`** | `scripts/ssot_parity.ts`, `scripts/map-codebase.ts` | `tests/ssot_registry_parity.test.ts`, `scripts/run-validator.ts` | `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md` |

---

## 4. Open Questions for User Confirmation (Before Step 4 Plan)

1. **Physical move of the 32 `src/rendering/ui/dnd35e_*.ui.ts` DOM files:**
   - **Recommendation:** Keep pure DOM `.ui.ts` view files in `src/rendering/ui/dnd35e_*.ui.ts` (so `.dependency-cruiser.cjs`'s `headless-simulation-purity` rule stays 100% strict over all of `src/rulesets/**`), while evacuating **all pure simulation/reducer logic** (`dnd35e_rest_recovery.ts` + pure reducers from `dnd35e_rest_actions.ts`, `dnd35e_doctrine_actions.ts`, `dnd35e_spellbook_actions.ts`) into `src/rulesets/dnd35e/`. Confirm?
2. **Legacy `equipment.ui.ts` & `inventory.ui.ts`:**
   - Should we remove `equipment.ui.ts` and refactor `inventory.ui.ts` to delegate directly to `console_inventory.ui.ts` (or delete `inventory.ui.ts` if no cartridge-less fallback is needed), or keep a minimal `console_inventory.ui.ts`-backed fallback?
3. **Classic Cartridge in `ssot_console.json`:**
   - Should `src/rulesets/classic/*` remain in `docs/ssot/ssot_console.json` with corrected tiers (`tier2_cartridge` / `tier2_ui`), or be split into a third `docs/ssot/ssot_classic.json`? *(Keeping in `ssot_console.json` with corrected `tier2_cartridge` tags avoids changing the 2-file SSOT contract while fixing the tier lie.)*
4. **Duplicate `canonicalEntryPoints` enforcement in `scripts/ssot_parity.ts`:**
   - Should `validateSsotRegistries` treat duplicate `canonicalEntryPoints` across files as a hard **error** (blocking `./verify.sh` if anyone re-introduces split ownership)? *(Recommended: Yes — hard error.)*
