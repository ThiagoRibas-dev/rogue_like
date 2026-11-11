# Implementation Plan — Phase 29: SSOT Architectural Hygiene, Cartridge Boundary Purification & Declarative Monster/Template De-Hardcoding (Milestones 127 & 128)

## 1. Architectural Overview & SSOT Ownership / Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner (New / Purified) | Evicted Legacy / Duplicate Location ("Old Brain") |
| :--- | :--- | :--- |
| **Tier 1 Console Ruleset Contract Registry** | `src/rulesets/registry.ts` (`registerRuleset`, `getRuleset`, `getAllRulesets`, `getActiveRuleset` — 53 lines) | `src/rulesets/registry.ts` lines 55–166 (112 lines of smuggled D&D 3.5e & Classic re-exports) |
| **Narrative Fuzzer & Worker Telemetry Schemas** | `src/types/fuzzer.types.ts` (Tier 1 Types) | `src/editor/simulation/fuzzer.types.ts` (Deleted 100% byte-for-byte duplicate) |
| **Classic Sci-Fi `ICartridgeUIAdapter` & Registration** | `src/rulesets/classic/ui/classic_ui_adapter.ts` & `src/rendering/ui/classic_ui_registration.ts` | `src/rulesets/default/ui/default_ui_adapter.ts` (Deleted orphan `default/` folder) & `src/rendering/ui/classic_ui_adapter.ts` |
| **D&D 3.5e `CartridgeUIDefinition` DOM Registration** | `src/rendering/ui/dnd35e_ui_registration.ts` (distinct from `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts`) | `src/rendering/ui/dnd35e_ui_adapter.ts` (Renamed to eliminate duplicate basename in `SSOT_DND35E.md`) |
| **Tactical Grid & Flanking Constants** | `FEET_PER_GRID_SQUARE` (`grid_geometry.ts`) & `FLANKING_ATTACK_BONUS` (`cover_senses.ts`) | Duplicate local constants `STANDARD_STEP_DISTANCE_FT`, `BASE_FLANKING_BONUS`, `DEFAULT_FLANKING_BONUS` |
| **Construct / Creature Magic Immunity Exceptions** | Declarative `magicImmunityExceptions` in `races/{flesh,iron,clay,stone}_golem.json` + generic evaluator in `family_synthesizer.ts` | Hardcoded `if (golemArchetypeId === 'flesh_golem' \| 'iron_golem' \| ...)` branches in `family_synthesizer.ts` |
| **SRD Creature Templates (Celestial, Fiendish, Skeleton, Zombie, Lich)** | Tier 3 `public/data/rulesets/dnd35e/templates.json` queried via `getDnD35Template` (`srd_registry.ts`) | `src/rulesets/dnd35e/templates/srd_templates.ts` (Deleted 134-line hardcoded TypeScript duplicate) |
| **Character Creation & Level-Up Hydration Entry Points** | `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts` & `builder_hydrator_levelup.ts` | `src/rulesets/dnd35e/builder/builder_hydrator.ts` (Deleted 3-line pure re-export shim) |

---

## 2. Milestone 127: Cartridge Boundary Purification, Duplicate Eviction & SSOT Domain Rebalancing

### Task 127.1: Scope `.dependency-cruiser.cjs` & Evict 112-Line Cartridge Barrel from `src/rulesets/registry.ts`
1. **Update `.dependency-cruiser.cjs`**:
   - Refine `no-direct-cartridge-imports-outside-registry` so Tier 1 Console modules (`src/core/`, `src/systems/`, `src/actions/`, `src/map/`, and non-cartridge `src/rendering/`) are strictly forbidden from importing `src/rulesets/(classic|dnd35e)/`, while Tier 2 Cartridge UI modules (`src/rendering/ui/dnd35e_*.ts`, `src/rendering/ui/classic_ui_registration.ts`) are allowed to import their own cartridge modules directly.
   - Add `no-cross-cartridge-ui-imports` so `dnd35e_*.ts` UI files can never import from `src/rulesets/classic/` and `classic_ui_registration.ts` can never import from `src/rulesets/dnd35e/`.

```javascript
// .dependency-cruiser.cjs diff
    {
      name: 'no-direct-cartridge-imports-outside-registry',
      severity: 'error',
      comment: 'Core engine, systems, actions, and Console rendering must resolve rulesets via src/rulesets/registry.ts and never import concrete cartridge files directly.',
      from: {
        path: '^src/(core|systems|actions|rendering|map)/',
        pathNot: '^src/rendering/ui/(dnd35e_|classic_ui_)'
      },
      to: {
        path: '^src/rulesets/(classic|dnd35e)/'
      }
    },
    {
      name: 'no-cross-cartridge-ui-imports',
      severity: 'error',
      comment: 'Cartridge-specific UI views must only import from their own ruleset cartridge.',
      from: {
        path: '^src/rendering/ui/dnd35e_'
      },
      to: {
        path: '^src/rulesets/classic/'
      }
    },
```

2. **Purify `src/rulesets/registry.ts` (Lines 1–53 only)**:
   - Remove lines 55–166 (`export { ... } from './dnd35e/...'` and `export { DefaultSciFiUIAdapter } ...`).
   - Update the 20 `src/rendering/ui/dnd35e_*.ts` files, `src/rendering/ui/classic_ui_registration.ts`, `tests/dnd35e_phase26_ui_and_showcase.test.ts`, and `tests/ruleset_validators.test.ts` to import directly from their canonical D&D 3.5e / Classic modules (`character_builder.ts`, `level_ledger.ts`, `equipment_physics.ts`, `srd_registry.ts`, `dnd35e_dag_adapter.ts`, `dnd35e_ui_adapter.ts`, `classic_ui_adapter.ts`, etc.).

```typescript
// src/rulesets/registry.ts (Purified complete file)
import type { GameState } from '../types/game-state.types.ts';
import type { RulesetContract, RulesetId } from '../types/ruleset.types.ts';
import { classicRulesetContract } from './classic/classic_ruleset.ts';
import { dnd35eRulesetContract } from './dnd35e/dnd35e_ruleset.ts';

/** Internal map of registered Ruleset Cartridges keyed by RulesetId. */
const rulesetRegistry: Record<RulesetId, RulesetContract> = {
  classic: classicRulesetContract,
  dnd35e: dnd35eRulesetContract
};

export function registerRuleset(contract: RulesetContract): void {
  rulesetRegistry[contract.id] = contract;
}

export function getRuleset(rulesetId: RulesetId | undefined): RulesetContract {
  if (!rulesetId) {
    return rulesetRegistry.classic;
  }
  return rulesetRegistry[rulesetId] ?? rulesetRegistry.classic;
}

export function getAllRulesets(): ReadonlyArray<RulesetContract> {
  return Object.values(rulesetRegistry);
}

export function getActiveRuleset(state: GameState): RulesetContract {
  const rulesetId = state.campaign?.manifest?.rulesetId;
  return getRuleset(rulesetId);
}
```

### Task 127.2: Evict Duplicate `src/editor/simulation/fuzzer.types.ts` & Consolidate UI Adapter Paths
1. **Delete `src/editor/simulation/fuzzer.types.ts`** and update its 7 importers (`narrative_fuzzer.ts`, `narrative_fuzzer_async.ts`, `fuzzer_invariants.ts`, `fuzzer_telemetry.ts`, `worker.types.ts`, `worker_bridge.ts`, `fuzzer.worker.ts`) to import from `src/types/fuzzer.types.ts`.
2. **Relocate `src/rulesets/default/ui/default_ui_adapter.ts` $\rightarrow$ `src/rulesets/classic/ui/classic_ui_adapter.ts`**:
   - Delete the empty `src/rulesets/default/` directory tree.
   - Rename `src/rendering/ui/classic_ui_adapter.ts` $\rightarrow$ `src/rendering/ui/classic_ui_registration.ts` and `src/rendering/ui/dnd35e_ui_adapter.ts` $\rightarrow$ `src/rendering/ui/dnd35e_ui_registration.ts` (updating `src/main.ts` and test imports) so no two files share the `dnd35e_ui_adapter.ts` basename.

### Task 127.3: Deduplicate Tactical Constants & Rebalance SSOT Domains
1. **Deduplicate Constants**:
   - Import `FLANKING_ATTACK_BONUS` from `../spatial/cover_senses.ts` in `src/rulesets/dnd35e/combat/combat_exchange_phases.ts` and `src/rulesets/dnd35e/modifiers/dag_resolver.ts` (removing local `BASE_FLANKING_BONUS` and `DEFAULT_FLANKING_BONUS`).
   - Import `FEET_PER_GRID_SQUARE` from `../spatial/grid_geometry.ts` in `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (removing local `STANDARD_STEP_DISTANCE_FT`).
2. **Rebalance `docs/ssot/ssot_console.json` & `docs/ssot/ssot_dnd35e.json`**:
   - In `ssot_console.json`:
     - Move `src/ai/*.behavior.ts` (5 files) from `"Core Console: App Entry & Wiring"` to `"Core Console: ECS Systems & Simulation"`.
     - Merge `"Core Console: ECS Systems & Game Loop"` (2 files) into `"Core Console: ECS Systems & Simulation"`.
     - Merge `"Core Console: Map Generation & Spatial"` (2 files) into `"Core Console: Map Generation & Director"`.
     - Merge `"Core Console: Foundation & Data Types"` (1 file) into `"Core Console: Engine Types & Schemas"`.
   - In `ssot_dnd35e.json`:
     - Merge `"D&D 3.5e: Combat Simulation & Resolution"` (2 files) into `"D&D 3.5e: Layer 5 — Combat, Maneuvers & Damage"`.
     - Merge `"D&D 3.5e: Layer 1 — Math & Multipliers"` (2 files) into `"D&D 3.5e: Layer 1 — Math, Bonus Stacking & Stat DAG"`.
     - Split the 55-file `"D&D 3.5e: Core Cartridge & Progression"` mega-bucket + `"D&D 3.5e: Core Cartridge & Ruleset Contract"` into 5 cohesive domains:
       1. `"D&D 3.5e: Core Cartridge, Adapters & Validation"` (`dnd35e_ruleset.ts`, `dnd35e_validator.ts`, `validation/*`, `cartridge/*`, `srd_registry.ts`, `effect_bundle.ts`, `semantic_tags*.ts`, `system_content_*.ts`)
       2. `"D&D 3.5e: Layer 2 — Progression, Classes & Level Ledger"` (`abilities.ts`, `action_economy.ts`, `progression.ts`, `progression/*`, `level_ledger.ts`, `prerequisites.ts`, `companions.ts`)
       3. `"D&D 3.5e: Layer 2 — Character Builder & Level-Up"` (`character_builder.ts`, `builder/*`)
       4. `"D&D 3.5e: Layer 2 — Archetypes, Races, Templates & Families"` (`archetype_resolver.ts`, `archetype/*`, `races.ts`, `templates.ts`, `creature_advancement.ts`, `family_synthesizer.ts`, `families/*`, `wild_shape.ts`)
       5. `"D&D 3.5e: Layer 4 — Skills & Skill Verbs"` (`skills.ts`, `skill_verbs.ts`, `skills/*`)

---

## 3. Milestone 128: Declarative Magic-Immunity Exceptions, Template JSON Unification & Barrel Shim Eviction

### Task 128.1: Declarative `magicImmunityExceptions` for Golems (`creature_system.types.ts`, `family_synthesizer.ts`, `races/*_golem.json`)
1. **Define `DnD35MagicImmunityExceptionSchema` in `src/rulesets/dnd35e/types/system/creature_system.types.ts`**:
```typescript
/** Declarative rule for a spell/tag interaction exception against a creature's magic immunity (e.g. Golems). */
export const DnD35MagicImmunityExceptionSchema = z.object({
  triggerTagsAny: z.array(z.string()).min(1),
  bypassesImmunity: z.boolean().default(false),
  healsHpPerDamageDivisor: z.number().int().positive().optional(),
  slowsRounds: z.number().int().positive().optional(),
  breaksSlow: z.boolean().optional(),
  breaksHaste: z.boolean().optional(),
  specialEffectDescription: z.string()
});
export type DnD35MagicImmunityException = z.infer<typeof DnD35MagicImmunityExceptionSchema>;
```
Add `magicImmunityExceptions: z.array(DnD35MagicImmunityExceptionSchema).optional()` to `DnD35RaceDefinitionSchema` and `DnD35ArchetypeSchema`.
2. **Populate `magicImmunityExceptions` in Tier 3 JSONs**:
   - `public/data/rulesets/dnd35e/races/flesh_golem.json` (`electricity` heals 1/3 & breaks slow; `fire`/`cold` slows 3 rounds)
   - `public/data/rulesets/dnd35e/races/iron_golem.json` (`fire` heals 1/3; `electricity` slows 3 rounds; `rust` bypasses immunity)
   - `public/data/rulesets/dnd35e/races/clay_golem.json` (`acid` heals 1/3; `disintegrate`/`earthquake` bypasses immunity)
   - `public/data/rulesets/dnd35e/races/stone_golem.json` (`stone_to_flesh`/`transmute` bypasses immunity)
3. **Refactor `evaluateGolemMagicInteraction` in `src/rulesets/dnd35e/family_synthesizer.ts`**:
   - Accept either a declarative `ReadonlyArray<DnD35MagicImmunityException>` or look up the race definition from `systemContent` / default declarative table without hardcoded `if (golemArchetypeId === 'flesh_golem')` branches!

### Task 128.2: Evict Hardcoded `src/rulesets/dnd35e/templates/srd_templates.ts`
1. Delete `src/rulesets/dnd35e/templates/srd_templates.ts` (`134 lines`) and remove `export * from './templates/srd_templates.ts';` from `src/rulesets/dnd35e/templates.ts`.
2. Update `tests/dnd35e_phase21_primitives.test.ts` to retrieve `fiendish`, `skeleton`, and `zombie` templates directly from the loaded campaign's `systemContent` via `getDnD35Template(campaign.systemContent, 'fiendish')!`.

### Task 128.3: Evict Pure Re-Export Shims (`builder_hydrator.ts` & Multi-Hop Re-Exports)
1. Delete `src/rulesets/dnd35e/builder/builder_hydrator.ts` (`3 lines`) and import `applyCharacterCreationToPlayer` (`./builder/builder_hydrator_creation.ts`) and `applyLevelUpToActor` (`./builder/builder_hydrator_levelup.ts`) directly in `character_builder.ts` and UI callers.
2. Remove redundant multi-hop re-exports of `level_ledger.ts` and `progression.ts` functions from `character_builder.ts` where callers now import directly from `level_ledger.ts` or `progression.ts`.

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Importers) | Downstream (Consumers / Validators) | Lateral (Sibling Configs / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. Evict cartridge barrel from `src/rulesets/registry.ts` & scope `.dependency-cruiser.cjs`** | `20` `src/rendering/ui/dnd35e_*.ts` files, `classic_ui_registration.ts`, `tests/dnd35e_phase26_ui_and_showcase.test.ts`, `tests/ruleset_validators.test.ts` | `.dependency-cruiser.cjs` (`bun run lint:arch`), `knip` (`bun run lint:deadcode`) | `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md` |
| **2. Delete `src/editor/simulation/fuzzer.types.ts`** | `narrative_fuzzer.ts`, `narrative_fuzzer_async.ts`, `fuzzer_invariants.ts`, `fuzzer_telemetry.ts`, `worker.types.ts`, `worker_bridge.ts`, `fuzzer.worker.ts` | `tsc --noEmit`, `knip`, `run-validator.ts` | `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md` |
| **3. Move `default_ui_adapter.ts` $\rightarrow$ `src/rulesets/classic/ui/classic_ui_adapter.ts` & rename `*_ui_registration.ts`** | `src/main.ts`, `src/rendering/ui/classic_ui_registration.ts`, `src/rendering/ui/dnd35e_ui_registration.ts`, `tests/console_ui_architecture.test.ts`, `tests/dnd35e_phase26_ui_and_showcase.test.ts` | `cartridge_ui_registry.ts`, `run-validator.ts` SSOT parity | `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json` |
| **4. Deduplicate `FLANKING_ATTACK_BONUS` & `FEET_PER_GRID_SQUARE`** | `combat_exchange_phases.ts`, `dag_resolver.ts`, `dnd35e_lifecycle_adapter.ts` | `cover_senses.ts`, `grid_geometry.ts` | `tests/dnd35e_m126_lifecycle_pipeline.test.ts` |
| **5. Declarative `magicImmunityExceptions` & delete `srd_templates.ts` / `builder_hydrator.ts`** | `family_synthesizer.ts`, `templates.ts`, `character_builder.ts`, `tests/dnd35e_phase21_primitives.test.ts`, `tests/dnd35e_phase22_bestiary.test.ts` | `creature_system.types.ts`, `run-validator.ts` | `public/data/rulesets/dnd35e/races/{flesh,iron,clay,stone}_golem.json`, `docs/ssot/ssot_dnd35e.json`, `docs/MILESTONES.md` |

---

## 5. Verification Plan (`verify.sh` 8-Stage Pipeline)
1. `[1/8]` `bun x tsc --noEmit` (0 errors)
2. `[2/8]` `bun run format` (Prettier clean)
3. `[3/8]` `bun run lint --fix` (0 errors, 0 warnings, all files `< 300` code lines)
4. `[4/8]` `bun run lint:arch` (0 architectural violations in `.dependency-cruiser.cjs`)
5. `[5/8]` `bun run lint:deadcode` (0 unused files or exports in `knip`)
6. `[6/8]` `bun test` (All 198+ tests passing across all 31 test suites)
7. `[7/8]` `bun run build` (Production Vite bundle clean)
8. `[8/8]` `bun run scripts/run-validator.ts` (0 campaign, ruleset JSON, or SSOT registry parity errors)
