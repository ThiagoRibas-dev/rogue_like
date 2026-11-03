# Research Notes — Milestone 112.8: Programmatic SSOT Responsibility Registries, Parity Validator, Markdown Generator & `docs/` Reorganization

---

## 1. Reiteration of Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)

- **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16):**
  - Shared/Console code (`src/core/`, `src/systems/`, `src/actions/`, `src/map/`, `src/rendering/` [non-D&D], `src/editor/`, `src/types/`, `src/constants/`, `src/utils/`, `src/rulesets/classic/`, `src/rulesets/registry.ts`, `src/main.ts`, `src/input_handler.ts`) is tracked in **`docs/ssot/ssot_console.json`** (`251` `.ts` files).
  - D&D 3.5e Cartridge & D&D 3.5e UI code (`src/rulesets/dnd35e/**` and `src/rendering/ui/dnd35e_*.ts`) is tracked in **`docs/ssot/ssot_dnd35e.json`** (`33` `.ts` files).
- **TypeScript Strictness (`AGENTS.md` Rules 10–14):**
  - Zero `any`, explicit return types on all functions, `exactOptionalPropertyTypes: true` compliance, and Zod validation for all JSON schemas.
- **No Unreferenced Files (`knip.json` & `tsconfig.scripts.json`):**
  - Any new script in `scripts/*.ts` is automatically covered by `knip.json` (`"entry": ["tests/**/*.test.ts", "scripts/**/*.ts"]`) and typechecked by `npm run lint:scripts` (`tsc -p tsconfig.scripts.json --noEmit`).

---

## 2. Current State & Codebase Inventory

### 2.1 `src/` Source File Partition (`284` Total `.ts` Files)
1. **Shared / Console Engine (`251` files -> `docs/ssot/ssot_console.json`)**:
   - `src/main.ts`, `src/input_handler.ts`, `src/vite-env.d.ts` (3 files)
   - `src/core/*.ts` (16 files)
   - `src/actions/**/*.ts` (22 files)
   - `src/systems/**/*.ts` (37 files)
   - `src/map/**/*.ts` (17 files)
   - `src/rendering/**/*.ts` excluding `dnd35e_*.ts` (66 files)
   - `src/editor/**/*.ts` (34 files)
   - `src/rulesets/registry.ts` & `src/rulesets/classic/*.ts` (2 files)
   - `src/types/**/*.ts` (36 files)
   - `src/constants/**/*.ts` (6 files)
   - `src/utils/**/*.ts` (12 files)
2. **D&D 3.5e Cartridge & UI (`33` files -> `docs/ssot/ssot_dnd35e.json`)**:
   - `src/rulesets/dnd35e/**/*.ts` (28 files)
   - `src/rendering/ui/dnd35e_*.ts` (5 files)

### 2.2 Existing `docs/` Directory Structure & Code References
Currently, `/docs` contains 13 root files and 2 subdirectories (`audits/`, `rules/`):
- **Living Root Docs (Keep at `/docs` root):**
  - `docs/ARCHITECTURE.md`
  - `docs/DECISIONS.md`
  - `docs/MILESTONES.md`
  - `docs/SSOT_CONSOLE.md` *(New — generated from `docs/ssot/ssot_console.json`)*
  - `docs/SSOT_DND35E.md` *(New — generated from `docs/ssot/ssot_dnd35e.json`)*
- **Guides (`docs/guides/`):**
  - `AI-CAMPAIGN-GENERATION.md` -> `docs/guides/AI-CAMPAIGN-GENERATION.md`
  - `CAMPAIGN-INTEGRATION-GUIDE.md` -> `docs/guides/CAMPAIGN-INTEGRATION-GUIDE.md`
  - `CREATOR_GUIDE.md` -> `docs/guides/CREATOR_GUIDE.md`
  - `MODDING.md` -> `docs/guides/MODDING.md`
- **D&D 3.5e Architecture & Rules (`docs/dnd35e/`):**
  - `DND_35E_PYRAMID_ARCHITECTURE.md` -> `docs/dnd35e/DND_35E_PYRAMID_ARCHITECTURE.md`
  - `rules/**` -> `docs/dnd35e/rules/**`
- **Historical Archive & Audits (`docs/archive/`):**
  - `audits/**` -> `docs/archive/audits/**`
  - `HANDOFF_SOCIAL_AND_V2_ENGINE.md` -> `docs/archive/HANDOFF_SOCIAL_AND_V2_ENGINE.md`
  - `comparison_spd_vs_our_roguelike.md` -> `docs/archive/comparison_spd_vs_our_roguelike.md`
  - `implementation_plan.md` -> `docs/archive/implementation_plan.md`
  - `research_notes.md` -> `docs/archive/research_notes.md`
  - `scratchpad.md` -> `docs/archive/scratchpad.md`

**Cross-Reference Check (`grep -rn "docs/" src/ scripts/ tests/ verify.sh`):**
- Zero runtime or script `readFileSync` calls depend on the moved `docs/` paths.
- Only JSDoc `@see` comments in 9 source files (`src/rulesets/dnd35e/magic/aoe_rest.ts`, `src/rulesets/dnd35e/math/multipliers.ts`, `src/rulesets/dnd35e/action_economy.ts`, `src/editor/validation_path.ts`, `src/editor/validation_navigator.ts`, `src/editor/reference_index.ts`, `src/rendering/ui/where_used.ui.ts`, `src/rendering/ui/area_playtest_menu.ui.ts`, `src/rendering/ui/validation_panel.ui.ts`) reference `docs/rules/...` or `docs/research_notes.md`; we will update those JSDoc comments to match the new paths (`docs/dnd35e/rules/...` and `docs/archive/research_notes.md`).

---

## 3. Architecture of the Programmatic SSOT Pipeline

### 3.1 JSON Schema (`SsotFileEntrySchema`)
Each file entry in `docs/ssot/ssot_console.json` and `docs/ssot/ssot_dnd35e.json` is keyed by its workspace-relative path (`"src/..."`) and validated against a Zod schema:
- `domain` (`string`): Logical subsystem or Pyramid Layer grouping (used to organize sections in the generated `.md` files).
- `tier` (`'tier1_console' | 'tier1_types' | 'tier2_cartridge' | 'tier2_ui'`).
- `responsibility` (`string`): Authoritative description of what this module is the Single Source of Truth for.
- `canonicalEntryPoints` (`readonly string[]`): Primary exported functions, constants, interfaces, or types that external callers must use (empty array `[]` allowed for `.d.ts` ambient files).
- `ownershipBoundary`:
  - `includes` (`string`): What this file computes, owns, or guarantees.
  - `excludes` (`string`): What this file deliberately does *not* compute and delegates to another SSOT owner.
- `antiPatterns` (`readonly string[]`): Explicit "two-brain" anti-patterns forbidden across the codebase.

### 3.2 4-Way Parity Validator (`scripts/run-validator.ts` & `tests/ssot_registry_parity.test.ts`)
We will create a shared validator/generator utility in `scripts/ssot_map.ts` (and invoke it in both `scripts/run-validator.ts` and a dedicated unit test `tests/ssot_registry_parity.test.ts`) that enforces:
1. **100% Disk-to-JSON Coverage:** Every `.ts` file under `src/**` must be registered in either `ssot_console.json` or `ssot_dnd35e.json`. Any unmapped file fails validation with an actionable error message.
2. **Strict Partition & Disjointness:**
   - Files matching `src/rulesets/dnd35e/**` or `src/rendering/ui/dnd35e_*.ts` MUST reside in `ssot_dnd35e.json`.
   - All other `src/**/*.ts` files MUST reside in `ssot_console.json`.
   - Zero duplicate keys between the two registries.
3. **Zero Ghost Files:** Every file path key in both JSONs must exist on disk.
4. **Live Export Verification:** Every symbol in `canonicalEntryPoints` must be an actual exported identifier in that `.ts` file on disk.
5. **Markdown Freshness Check:** Verifies that `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` on disk match the deterministic Markdown output rendered from `ssot_console.json` and `ssot_dnd35e.json` (instructing the developer to run `bun scripts/map-codebase.ts` if stale).

### 3.3 Markdown Generator (`scripts/map-codebase.ts`)
We will upgrade `scripts/map-codebase.ts` (and add `"map:ssot": "bun scripts/map-codebase.ts"` to `package.json`) so that running `bun scripts/map-codebase.ts`:
1. Reads `docs/ssot/ssot_console.json` and `docs/ssot/ssot_dnd35e.json` + scans `src/**/*.ts` exports and JSDoc summaries.
2. Generates **`docs/SSOT_CONSOLE.md`** and **`docs/SSOT_DND35E.md`** with:
   - A Table of Contents by Domain.
   - A Summary Responsibility & Boundary Table per Domain (`File | Responsibility | Canonical Entry Points | Ownership Boundary (Includes / Excludes) | Forbidden Anti-Patterns`).
   - Detailed per-file export signatures & JSDoc summaries.

### 3.4 `AGENTS.md` Workflow Updates
Per your instruction:
1. **Before Writing Code — Step 4 (`Implementation Plan Draft`):**
   - Explicitly require consulting `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` ( in addition to `utils/`, `constants/`, and `types/`) to verify canonical entry points, ownership boundaries, and old-brain eviction before proposing any new function or modifying an existing pipeline.
2. **After Writing Code — Step 11 (`Update Documentation`, the 4th step of the After Writing Code flow):**
   - Explicitly require creating or updating the relevant entries in `docs/ssot/ssot_console.json` and/or `docs/ssot/ssot_dnd35e.json`, running `bun scripts/map-codebase.ts` to regenerate `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md`, and verifying parity via `bun run scripts/run-validator.ts` whenever files, responsibilities, or canonical entry points are added or modified.

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling Campaigns / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. `docs/ssot/ssot_console.json` & `docs/ssot/ssot_dnd35e.json`** | Authored/updated whenever `src/**/*.ts` files or responsibilities change. | Consumed by `scripts/map-codebase.ts`, `scripts/run-validator.ts`, and `tests/ssot_registry_parity.test.ts`. | Renders `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md`. |
| **2. `scripts/map-codebase.ts` Upgrade** | Reads `docs/ssot/*.json` and `src/**/*.ts` AST/regex exports + JSDocs. | Writes `docs/SSOT_CONSOLE.md` & `docs/SSOT_DND35E.md`; exports `validateSsotRegistries()` for `run-validator.ts` and tests. | Referenced in `AGENTS.md` §1 & §8 and `package.json`. |
| **3. `scripts/run-validator.ts` & `tests/ssot_registry_parity.test.ts`** | Invoked by `verify.sh`, `verify.bat`, `bun test`, and `bun run validate:campaigns`. | Enforces 100% file parity, disjoint partition, export existence, and `.md` sync. | Prevents unmapped `.ts` files or stale SSOT docs from passing verification. |
| **4. `docs/` Reorganization (`ssot/`, `dnd35e/`, `guides/`, `archive/`)** | Moves non-root docs into categorized subdirectories. | Keeps root `docs/` clean with only the 5 living docs (`ARCHITECTURE.md`, `DECISIONS.md`, `MILESTONES.md`, `SSOT_CONSOLE.md`, `SSOT_DND35E.md`). | JSDoc `@see` paths updated in 9 `src/` files and `AGENTS.md`. |
| **5. `AGENTS.md` Workflow Updates** | Step 4 of *Before Writing Code* and Step 11 (4th step of *After Writing Code*). | Guides all future planning and post-implementation documentation steps. | Aligns with `docs/MILESTONES.md` (Milestone 112.8). |
