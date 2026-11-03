# Milestone 112.8 Implementation Plan: Programmatic SSOT Responsibility Registries, Parity Validator, Markdown Generator & `docs/` Reorganization

---

## 1. Reiteration of Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)

- **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16):**
  - **Tier 1 (Core Console Engine & Shared Systems):** Tracked in `docs/ssot/ssot_console.json` (`251` files covering `src/core/`, `src/actions/`, `src/systems/`, `src/map/`, `src/rendering/` [non-D&D], `src/editor/`, `src/rulesets/registry.ts`, `src/rulesets/classic/`, `src/types/`, `src/constants/`, `src/utils/`, `src/main.ts`, `src/input_handler.ts`, `src/vite-env.d.ts`).
  - **Tier 2 (Ruleset Cartridge & Ruleset UI):** Tracked in `docs/ssot/ssot_dnd35e.json` (`33` files covering `src/rulesets/dnd35e/**/*.ts` and `src/rendering/ui/dnd35e_*.ts`).
- **Data-Driven & JSON Rules (`AGENTS.md` Rule 5):**
  - All SSOT registry files conform to a strict Zod schema (`SsotFileEntrySchema` / `SsotRegistrySchema`).
- **No Unreferenced Code & TypeScript Strictness (`AGENTS.md` Rules 10–14):**
  - Strictest TS config, explicit return types on every function, zero `any`.
  - Scripts covered by `tsconfig.scripts.json` and `knip.json`.
- **Workflow & Process Rules (`AGENTS.md` Workflow):**
  - Reorganize `docs/` cleanly into `docs/ssot/`, `docs/dnd35e/`, `docs/guides/`, and `docs/archive/` while keeping only the 5 living core docs at the root of `docs/`.
  - Update `AGENTS.md` Step 4 of *Before Writing Code* and Step 11 of *After Writing Code* to mandate consulting and maintaining the SSOT registries.

---

## 2. Canonical Single Source of Truth (SSOT) Dispatch Table

| Capability / Domain | Canonical Single Point of Entry | Call Sites & Consumers | Disallowed Anti-Patterns |
| :--- | :--- | :--- | :--- |
| **SSOT Registries** | `docs/ssot/ssot_console.json` & `docs/ssot/ssot_dnd35e.json` | `scripts/map-codebase.ts`, `scripts/run-validator.ts`, `tests/ssot_registry_parity.test.ts` | Never leave a `src/**/*.ts` file unmapped or register a file in both JSONs. |
| **SSOT Validation Logic** | `validateSsotRegistries` in `scripts/ssot_parity.ts` (or `scripts/map-codebase.ts`) | `scripts/run-validator.ts`, `tests/ssot_registry_parity.test.ts` | Never duplicate disk scanning or export validation logic across multiple scripts. |
| **SSOT Markdown Documentation** | `docs/SSOT_CONSOLE.md` & `docs/SSOT_DND35E.md` | Developers, AI agents during Kickoff Step 4 planning | Never edit `SSOT_CONSOLE.md` or `SSOT_DND35E.md` manually; regenerate via `bun scripts/map-codebase.ts`. |

---

## 3. Step-by-Step Implementation Tasks & Code Snippets

### Step 1: `docs/` Folder Reorganization & JSDoc Reference Updates
**Goal**: Reorganize `/docs` into clean subfolders, keeping only living core documents at `/docs` root.

1. Create target directories:
   - `docs/ssot/`
   - `docs/dnd35e/`
   - `docs/guides/`
   - `docs/archive/`
2. Move files via `move`:
   - `docs/AI-CAMPAIGN-GENERATION.md` -> `docs/guides/AI-CAMPAIGN-GENERATION.md`
   - `docs/CAMPAIGN-INTEGRATION-GUIDE.md` -> `docs/guides/CAMPAIGN-INTEGRATION-GUIDE.md`
   - `docs/CREATOR_GUIDE.md` -> `docs/guides/CREATOR_GUIDE.md`
   - `docs/MODDING.md` -> `docs/guides/MODDING.md`
   - `docs/DND_35E_PYRAMID_ARCHITECTURE.md` -> `docs/dnd35e/DND_35E_PYRAMID_ARCHITECTURE.md`
   - `docs/rules/` -> `docs/dnd35e/rules/`
   - `docs/audits/` -> `docs/archive/audits/`
   - `docs/HANDOFF_SOCIAL_AND_V2_ENGINE.md` -> `docs/archive/HANDOFF_SOCIAL_AND_V2_ENGINE.md`
   - `docs/comparison_spd_vs_our_roguelike.md` -> `docs/archive/comparison_spd_vs_our_roguelike.md`
   - `docs/implementation_plan.md` -> `docs/archive/implementation_plan.md`
   - `docs/research_notes.md` -> `docs/archive/research_notes.md`
   - `docs/scratchpad.md` -> `docs/archive/scratchpad.md`
3. Update JSDoc `@see` comment paths in:
   - `src/rulesets/dnd35e/magic/aoe_rest.ts`: `/docs/rules/` -> `/docs/dnd35e/rules/`
   - `src/rulesets/dnd35e/math/multipliers.ts`: `/docs/rules/` -> `/docs/dnd35e/rules/`
   - `src/rulesets/dnd35e/action_economy.ts`: `/docs/rules/` -> `/docs/dnd35e/rules/`
   - `src/editor/validation_path.ts`: `docs/research_notes.md` -> `docs/archive/research_notes.md`
   - `src/editor/validation_navigator.ts`: `docs/research_notes.md` -> `docs/archive/research_notes.md`
   - `src/editor/reference_index.ts`: `docs/research_notes.md` -> `docs/archive/research_notes.md`
   - `src/rendering/ui/where_used.ui.ts`: `docs/research_notes.md` -> `docs/archive/research_notes.md`
   - `src/rendering/ui/area_playtest_menu.ui.ts`: `docs/research_notes.md` -> `docs/archive/research_notes.md`
   - `src/rendering/ui/validation_panel.ui.ts`: `docs/research_notes.md` -> `docs/archive/research_notes.md`

---

### Step 2: SSOT Zod Schema & Core Parity Engine (`scripts/ssot_parity.ts`)
**Goal**: Build a typed module that parses `docs/ssot/ssot_console.json` and `docs/ssot/ssot_dnd35e.json`, scans `src/**/*.ts`, validates 5-point parity, and renders deterministic Markdown.

```ts
import { z } from 'zod';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SsotFileEntrySchema = z.object({
  domain: z.string().min(1),
  tier: z.enum(['tier1_console', 'tier1_types', 'tier2_cartridge', 'tier2_ui']),
  responsibility: z.string().min(1),
  canonicalEntryPoints: z.array(z.string()),
  ownershipBoundary: z.object({
    includes: z.string().min(1),
    excludes: z.string().min(1)
  }),
  antiPatterns: z.array(z.string())
});
export type SsotFileEntry = z.infer<typeof SsotFileEntrySchema>;

export const SsotRegistrySchema = z.record(z.string(), SsotFileEntrySchema);
export type SsotRegistry = z.infer<typeof SsotRegistrySchema>;

export interface SsotParityReport {
  readonly checkedFiles: number;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export function validateSsotRegistries(projectRoot: string): SsotParityReport {
  // 1. Check all src/**/*.ts files against console + dnd35e registries
  // 2. Enforce strict disjoint partition (src/rulesets/dnd35e/** & src/rendering/ui/dnd35e_*.ts must be in dnd35e)
  // 3. Ensure no ghost files in JSON
  // 4. Ensure canonicalEntryPoints are exported on disk
  // 5. Ensure docs/SSOT_CONSOLE.md & docs/SSOT_DND35E.md are in sync with JSON
}

export function generateSsotMarkdown(registry: SsotRegistry, title: string, description: string): string {
  // Groups by domain, renders Table of Contents, Domain Responsibility Table, Entry Points, and Boundaries
}
```

---

### Step 3: Populate Full JSON Registries (`docs/ssot/ssot_console.json` & `docs/ssot/ssot_dnd35e.json`)
**Goal**: Comprehensively catalog all 284 source files across `docs/ssot/ssot_console.json` (251 files) and `docs/ssot/ssot_dnd35e.json` (33 files) with precise domain, tier, responsibility, canonical entry points, ownership boundaries, and anti-patterns.

- D&D 3.5e registry covers:
  - Math & Dice (`math/dice.ts`, `math/multipliers.ts`)
  - Abilities & Stacking (`abilities.ts`, `modifiers.ts`, `wild_shape.ts`)
  - Progression & Classes (`progression.ts`, `character_builder.ts`, `level_ledger.ts`, `family_synthesizer.ts`, `templates.ts`, `srd_registry.ts`)
  - Spatial & Geometry (`spatial/grid_geometry.ts`, `spatial/reach_deadzones.ts`, `spatial/cover_flanking.ts`, `spatial/senses_lighting.ts`)
  - Action Economy & AoO (`action_economy.ts`, `attacks_of_opportunity.ts`)
  - Combat & Physics (`combat/attack_resolver.ts`, `combat/damage_vitality.ts`, `combat/maneuvers_conditions.ts`, `equipment_physics.ts`)
  - Magic & Spells (`magic/spellcasting.ts`, `magic/aoe_rest.ts`)
  - Pipeline & Contracts (`dnd35e_ruleset.ts`, `dnd35e_validator.ts`, `system_content_files.ts`, types)
  - UI Views (`rendering/ui/dnd35e_*.ts`)
- Console registry covers all core engine systems, actions, ECS, map generation, rendering, UI views, campaign editor, and shared types.

---

### Step 4: Upgrade `scripts/map-codebase.ts` & Add NPM Script
**Goal**: Integrate the generator into `scripts/map-codebase.ts` and add `"map:ssot": "bun scripts/map-codebase.ts"` to `package.json`.
- Running `bun scripts/map-codebase.ts` regenerates `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md`.
- Running with `--check` validates parity without writing.

---

### Step 5: Wire Parity Check into `scripts/run-validator.ts` and `tests/ssot_registry_parity.test.ts`
**Goal**: Ensure `run-validator.ts` and `bun test` verify SSOT registry parity automatically.
- In `scripts/run-validator.ts`, add a `─── SSOT Registry Parity ───` check stage.
- In `tests/ssot_registry_parity.test.ts`, assert `report.errors.length === 0`.

---

### Step 6: Update `AGENTS.md` and `docs/MILESTONES.md`
**Goal**: Wire the new SSOT requirements into the agent lifecycle rules and document Milestone 112.8 completion.
- In `AGENTS.md` §1 (Workflow):
  - **Before Writing Code — Step 4 (`Implementation Plan Draft`)**: Add requirement to consult `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` to identify canonical entry points, verify ownership boundaries, and check for old-brain eviction.
  - **After Writing Code — Step 11 (`Update Documentation`)**: Add requirement to create or update relevant entries in `docs/ssot/ssot_console.json` and/or `docs/ssot/ssot_dnd35e.json`, run `bun scripts/map-codebase.ts` to regenerate the markdown maps, and verify parity via `bun run scripts/run-validator.ts`.
- In `docs/MILESTONES.md`: Add and check off Milestone 112.8.

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling Campaigns / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. `docs/ssot/*.json` Registries** | Authored whenever files or responsibilities change. | Read by `scripts/map-codebase.ts`, `scripts/run-validator.ts`, `tests/ssot_parity.test.ts`. | Generates `docs/SSOT_CONSOLE.md` & `docs/SSOT_DND35E.md`. |
| **2. `scripts/ssot_parity.ts` & `scripts/map-codebase.ts`** | Called by CLI (`bun run map:ssot`) and validator runners. | Writes Markdown files; feeds error counts to `run-validator.ts` and test runner. | Registered in `package.json` scripts and `tsconfig.scripts.json`. |
| **3. `docs/` Reorganization** | Moved files into `docs/ssot/`, `docs/dnd35e/`, `docs/guides/`, `docs/archive/`. | Keeps root `docs/` clean with only living core docs (`ARCHITECTURE.md`, `DECISIONS.md`, `MILESTONES.md`, `SSOT_CONSOLE.md`, `SSOT_DND35E.md`). | JSDoc `@see` comments updated across 9 source files. |
| **4. `AGENTS.md` Workflow Updates** | Step 4 (*Before Writing Code*) & Step 11 (*After Writing Code*). | Governs all future agent planning, code writing, and documentation maintenance turns. | Aligns with `docs/MILESTONES.md` (Milestone 112.8). |
