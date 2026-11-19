# Implementation Plan — SSOT Integrity, Console Primitive Extraction, Old-Brain Eviction & Rule 21 Purity

> **Status:** Phase 1, Steps 4–5 — Enhanced Implementation Plan (Awaiting User Approval before Code Execution)
> **Confirmed Decisions from Research Review:**
> 1. Keep pure DOM `.ui.ts` views in `src/rendering/ui/dnd35e_*.ui.ts`, extract **ruleset-agnostic primitives** to Tier 1 Console (`src/systems/`), and move **D&D 3.5e-specific simulation/reducers** to Tier 2 (`src/rulesets/dnd35e/`).
> 2. Delete the unused legacy `inventory.ui.ts` + `equipment.ui.ts` + `#inventory-overlay` completely.
> 3. Create a dedicated third SSOT registry: `docs/ssot/ssot_classic.json` + `docs/SSOT_CLASSIC.md` (3-way disjoint partition).
> 4. Enforce duplicate `canonicalEntryPoints` across files as a hard **error** in `scripts/ssot_parity.ts`.

---

## 1. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Old / Split-Brain Location | Canonical Owner (After Refactor) | Tier | Action |
| :--- | :--- | :--- | :--- | :--- |
| Anatomical Paper Doll & Backpack UI | `src/rendering/ui/equipment.ui.ts`, `src/rendering/ui/inventory.ui.ts`, `#inventory-overlay` (`index.html`) | `src/rendering/ui/console_inventory.ui.ts` (consumed by `console_dossier.ui.ts` & `dnd35e_sheet_equipment_tab.ui.ts`) | `tier1_console` | **Delete** `equipment.ui.ts`, `inventory.ui.ts`, `#inventory-overlay`; remove `renderInventoryPanel` wiring in `ui.ts` & `presenter.ts`. |
| Party Rest Safety Evaluation, Bulk Time Digest & Wait-Until-Phase | `src/rendering/ui/dnd35e_rest_recovery.ts`, `src/rendering/ui/dnd35e_rest_actions.ts` | **`src/systems/rest.system.ts`** *(new Console primitive)*: `evaluateActorRestSafety`, `finalizeBulkTimeEventsAndRespawn`, `executeWaitUntilPhase` | `tier1_console` | **Extract** generic party-safety, respawn-digest, and wait-until-phase simulation to Tier 1 Console so any future ruleset can build rest/camp mechanics on top. |
| D&D 3.5e 8-Hour Rest Recovery (HD healing, ability damage, Vancian retention, fatigue) | `src/rendering/ui/dnd35e_rest_recovery.ts`, `src/rendering/ui/dnd35e_rest_actions.ts` | **`src/rulesets/dnd35e/magic/rest_recovery.ts`** *(new)*: `applyEightHourRestToActor`, `executeEightHourRest` | `tier2_cartridge` | **Move** pure D&D 3.5e recovery to Cartridge; `src/rendering/ui/dnd35e_rest_actions.ts` becomes a thin async loading-overlay UI wrapper only; **delete** `src/rendering/ui/dnd35e_rest_recovery.ts`. |
| Tactical Doctrine Component Pure Updater | `src/rendering/ui/dnd35e_doctrine_actions.ts` (`updateActorTacticalDoctrine`) | **`src/systems/stance.system.ts`** *(Console primitive)* | `tier1_console` | **Move** `updateActorTacticalDoctrine` (mutates Tier 1 `TacticalDoctrineComponent`) into `stance.system.ts`; `dnd35e_doctrine_actions.ts` stays a thin UI dispatch wrapper. |
| Vancian Spellbook Slot Preparation / Clearing Reducers | `src/rendering/ui/dnd35e_spellbook_actions.ts` (`prepareSpellIntoSpecificSlot`, `prepareSpellIntoSlot`, `unprepareSpecificSlot`) | **`src/rulesets/dnd35e/magic/spellbook_actions.ts`** *(new)* | `tier2_cartridge` | **Move** pure `GameState -> GameState` spellbook reducers to Cartridge; `src/rendering/ui/dnd35e_spellbook_actions.ts` stays a thin UI wrapper (`setGameState` + `markAllDomainsDirty`). |
| Classic Cartridge SSOT Partition | `docs/ssot/ssot_console.json` (mixed with `tier1_console` mislabels) | **`docs/ssot/ssot_classic.json`** + **`docs/SSOT_CLASSIC.md`** *(new)* | `tier2_cartridge` / `tier2_ui` | **Partition** `src/rulesets/classic/**` and `src/rendering/ui/classic_ui_*` into `ssot_classic.json` with proper Tier 2 tags. |
| D&D 3.5e Type Schemas Tier Tag | `docs/ssot/ssot_dnd35e.json` (`tier1_types`) | `docs/ssot/ssot_dnd35e.json` (`tier2_types`) | `tier2_types` | Add `'tier2_types'` to `SsotFileTierSchema` and retag all 9 `src/rulesets/dnd35e/types/*.ts` files. |
| Canonical Export Ownership | 182 symbols duplicated across 2–4 SSOT entries | Strictly 1 defining file per symbol across all 3 registries | All | Deduplicate `canonicalEntryPoints` and add hard-error uniqueness check in `scripts/ssot_parity.ts`. |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| Fog-of-war wall vs. floor dim color (`viewport_snapshot.ts:80`) | `if (tile.tileId === 'stone_wall')` | `if (tileDef.blocksSight || !tileDef.walkable)` (or `tileDef.blocksSight`) using existing `TileDefinition` physics properties | **Yes** — any custom brick, obsidian, or tree wall dims with `wallDimFg` automatically. |
| Arcane school specialist bonus slot (`spellbook_slots.ts:105`, `dnd35e_spellbook_known.ui.ts:138`) | `book.classId === 'wizard'` / `classId === 'wizard'` | Add optional `supportsArcaneSchoolSpecialization?: boolean` to `DnD35ClassDefinitionSchema` (`dnd35e_system.types.ts`) and set `true` in `classes/wizard.json` | **Yes** — any custom specialist caster class can opt in via JSON. |
| Spontaneous spell conversion (`spellbook_slots.ts:245-246`, `dnd35e_quickcast_model.ts:108-110`) | `if (classId === 'cleric')` / `if (classId === 'druid')` | Read `classDef.featureDetails[featId].spontaneousConversionMode` exclusively via `resolveActiveSpontaneousConversionModes` (already authored in `cleric.json` & `druid.json`!) | **Yes** — any custom class feature can declare `spontaneousConversionMode` in JSON. |
| At-will / innate spellcasting (`dnd35e_quickcast_model.ts:190,251`, `dnd35e_ui_hotbar.ts:258`) | `classId === 'warlock' || classId === 'innate'` | Add `'innate'` to `DnD35ClassSpellbookState['castingMode']` and `DnD35ClassDefinitionSchema.castingMode`; check `book.castingMode === 'innate'` | **Yes** — any custom invocation/innate caster declares `"castingMode": "innate"` in JSON. |
| Default NPC warrior curves (`race_hydrator.ts:107,110,123`) | `cl.classId === 'warrior'` fallbacks for BAB/Fort/NPC | Read `clsDef.progression` & `clsDef.isNpcClass` from `classes/warrior.json` (already on disk with `isNpcClass: true`); fallback to generic `'three_quarters'` / `'poor'` / `'pc'` only when `clsDef` is absent | **Yes** — any custom NPC class drives curves purely from its JSON `progression` & `isNpcClass`. |
| Shapeshift trait gating (`shapeshift.ts:164,172`) | `if (featId === 'shapeshift')` / `a.includes('shapeshift')` | Inspect `featureDetails[featId].activatedAbilities` for `toggleGroup === SHAPESHIFT_STANCE_GROUP_ID \|\| formOverlay !== undefined` (already authored in `druid.json`!) | **Yes** — any custom shapeshift class/ACF works via `formOverlay` in JSON. |

---

## 3. Step-by-Step Implementation Plan (with Exact Diffs / Snippets)

### Phase A — Delete Unused Legacy Inventory & Paper Doll ("Old Brain" Eviction)

1. **Delete** `src/rendering/ui/equipment.ui.ts` and `src/rendering/ui/inventory.ui.ts`.
2. **`src/rendering/ui.ts`:** Remove `export { renderInventoryPanel } from './ui/inventory.ui.ts';`.
3. **`src/rendering/presenter.ts`:** Remove `import { renderInventoryPanel } from './ui/inventory.ui.ts';` and `renderInventoryPanel(state);`.
4. **`index.html`:** Remove the unused `#inventory-overlay` modal block (lines ~209–225).

### Phase B — Extract Ruleset-Agnostic Console Primitives & Evacuate D&D Simulation from `src/rendering/ui/`

5. **Create Tier 1 Console `src/systems/rest.system.ts`:**
   ```ts
   /**
    * @file Ruleset-agnostic party rest safety evaluation, bulk time-skip world-event digesting,
    * and wait-until-diurnal-phase simulation primitives for any RPG ruleset cartridge.
    */
   export interface RestSafetyEvaluation {
     readonly safe: boolean;
     readonly reason?: string | undefined;
   }

   export function evaluateActorRestSafety(state: GameState, playerId: EntityId): RestSafetyEvaluation { ... }
   export function finalizeBulkTimeEventsAndRespawn(
     state: GameState,
     summaryEvents: ReadonlyArray<string>,
     verb: 'rested' | 'waited'
   ): GameState { ... }
   export function executeWaitUntilPhase(state: GameState, playerId: EntityId, targetPhaseId: string): GameState { ... }
   ```
6. **Move `updateActorTacticalDoctrine` into Tier 1 Console `src/systems/stance.system.ts`:**
   - Pure `GameState -> GameState` helper operating on Tier 1 `TacticalDoctrineComponent`.
   - `src/rendering/ui/dnd35e_doctrine_actions.ts` imports `updateActorTacticalDoctrine` from `../../systems/stance.system.ts` and focuses strictly on `applyDoctrineUpdate` & `toggleDnD35eActorStance` UI dispatching.
7. **Create Tier 2 Cartridge `src/rulesets/dnd35e/magic/rest_recovery.ts`:**
   - Moves `applyEightHourRestToActor` and `executeEightHourRest` (calling Console's `evaluateActorRestSafety`, `advanceWorldTimeBulk`, and `finalizeBulkTimeEventsAndRespawn`).
   - Delete `src/rendering/ui/dnd35e_rest_recovery.ts`.
   - Slim `src/rendering/ui/dnd35e_rest_actions.ts` to only the DOM loading-overlay async wrappers (`applyRestActionAsync`, `applyWaitUntilPhaseAsync`).
8. **Create Tier 2 Cartridge `src/rulesets/dnd35e/magic/spellbook_actions.ts`:**
   - Moves pure `prepareSpellIntoSpecificSlot`, `prepareSpellIntoSlot`, and `unprepareSpecificSlot` reducers (calling Console's `evaluateActorRestSafety` and `advanceWorldTimeBulk`).
   - Slim `src/rendering/ui/dnd35e_spellbook_actions.ts` to thin UI dispatch wrappers (`applyPrepareSpellIntoSlot`, `applyUnprepareSpecificSlot`, or keep DOM-invoked wrappers calling `setGameState` + `markAllDomainsDirty`).
   - Update test imports in `tests/dnd35e_day_night_environment.test.ts`, `tests/dnd35e_phase26_ui_and_showcase.test.ts`, `tests/dnd35e_spell_casting.test.ts`, `tests/dnd35e_spellbook_slots.test.ts`, and `tests/hud_rest_and_display_name.test.ts` to point directly to the canonical Tier 1 (`src/systems/rest.system.ts`, `src/systems/stance.system.ts`) and Tier 2 (`src/rulesets/dnd35e/magic/rest_recovery.ts`, `src/rulesets/dnd35e/magic/spellbook_actions.ts`) modules!
9. **Remove SRD-specific phrasing from Tier 1 Console docs/comments:**
   - Update JSDoc & SSOT descriptions in `src/constants/world_clock.constants.ts`, `src/systems/world_time_skip.ts`, and `src/systems/movement_footprint.ts` to use ruleset-agnostic Console phrasing.

### Phase C — Rule 21 Declarative Purity Fixes (Zero Content-ID Branching)

10. **`src/rendering/viewport_snapshot.ts:80`:**
    ```diff
    - if (tile.tileId === 'stone_wall') {
    + if (tileDef.blocksSight) {
        fgColor = state.campaign.theme.colors.wallDimFg ?? fgColor;
      } else {
        fgColor = state.campaign.theme.colors.floorDimFg ?? fgColor;
      }
    ```
11. **Schema & Tier 3 JSON (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`, `dnd35e.types.ts`, `public/data/rulesets/dnd35e/classes/wizard.json`):**
    - Add `supportsArcaneSchoolSpecialization: z.boolean().optional()` to `DnD35ClassDefinitionSchema` and `"supportsArcaneSchoolSpecialization": true` to `wizard.json`.
    - Extend `castingMode` union in `DnD35ClassSpellbookState` (`dnd35e.types.ts`) and `DnD35ClassDefinitionSchema` (`dnd35e_system.types.ts`) to include `'innate'`.
12. **`src/rulesets/dnd35e/magic/spellbook_slots.ts` & `src/rendering/ui/dnd35e_spellbook_known.ui.ts`:**
    - Replace `book.classId === 'wizard'` / `classId === 'wizard'` with `Boolean(classDef?.supportsArcaneSchoolSpecialization)`.
    - Remove lines 245–246 (`if (classId === 'cleric') ...`, `if (classId === 'druid') ...`) in `resolveActiveSpontaneousConversionModes`; ensure all call sites/tests pass `systemContent` (and update any unit test fixture that passed `undefined` for `systemContent`).
13. **`src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts` & `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`:**
    - Replace `classId === 'cleric'` / `classId === 'druid'` with `const convModes = resolveActiveSpontaneousConversionModes(classId, dndData, sys);` checking `convModes.includes('cure_or_inflict')` / `convModes.includes('summon_nature_ally')`.
    - Replace `classId === 'warlock' || classId === 'innate'` with `book.castingMode === 'innate' || classDef?.castingMode === 'innate'`.
14. **`src/rulesets/dnd35e/archetype/race_hydrator.ts`:**
    - Remove `cl.classId === 'warrior'` branches on lines 107, 110, 123 (rely solely on `clsDef?.progression` and `clsDef?.isNpcClass`).
15. **`src/rulesets/dnd35e/shapeshift.ts`:**
    - Remove `if (featId === 'shapeshift') return true;` and `(dndData.selectedAcfs ?? []).some((a) => a.includes('shapeshift'))` — rely solely on declarative `activatedAbilities` (`toggleGroup === SHAPESHIFT_STANCE_GROUP_ID || formOverlay !== undefined`) in `featureDetails`, verifying all shapeshift tests pass `systemContent`.

### Phase D — 3-Registry SSOT Parity Engine, Deduplication & Cleanup

16. **Upgrade `scripts/ssot_parity.ts`:**
    - Add `'tier2_types'` to `SsotFileTierSchema`.
    - Add `isClassicFile(filePath)` matching `src/rulesets/classic/` and `src/rendering/ui/classic_ui_`.
    - Validate 3-way disjoint partition across `docs/ssot/ssot_console.json`, `docs/ssot/ssot_classic.json`, and `docs/ssot/ssot_dnd35e.json` + generate `docs/SSOT_CONSOLE.md`, `docs/SSOT_CLASSIC.md`, and `docs/SSOT_DND35E.md`.
    - Add **Hard-Error Unique Canonical Entry Point Check**:
      ```ts
      const canonicalOwners = new Map<string, string[]>();
      for (const [file, entry] of allRegistryEntries) {
        for (const ep of entry.canonicalEntryPoints) {
          const list = canonicalOwners.get(ep) ?? [];
          list.push(file);
          canonicalOwners.set(ep, list);
        }
      }
      for (const [ep, owners] of canonicalOwners.entries()) {
        if (owners.length > 1) {
          errors.push(`Duplicate canonicalEntryPoint "${ep}" claimed by multiple files: ${owners.join(', ')}`);
        }
      }
      ```
    - Enforce tier-to-registry hygiene (e.g., `ssot_console.json` only allows `tier1_console` / `tier1_types`; `ssot_classic.json` & `ssot_dnd35e.json` only allow `tier2_cartridge` / `tier2_types` / `tier2_ui`).
17. **Create `docs/ssot/ssot_classic.json` and clean `ssot_console.json` & `ssot_dnd35e.json`:**
    - Move the 6 `classic` files into `ssot_classic.json` with `tier2_cartridge` / `tier2_ui`.
    - Retag the 9 `src/rulesets/dnd35e/types/*.ts` files to `tier2_types`.
    - Register new files (`src/systems/rest.system.ts`, `src/rulesets/dnd35e/magic/rest_recovery.ts`, `src/rulesets/dnd35e/magic/spellbook_actions.ts`) and remove deleted files (`equipment.ui.ts`, `inventory.ui.ts`, `dnd35e_rest_recovery.ts`).
    - Deduplicate all 182 overlapping `canonicalEntryPoints` so only the **defining** file owns each symbol (re-exporting facades list only their own symbols and document re-exports in `responsibility`/`ownershipBoundary`).
    - Normalize the 6 fragmented domain names and fix the 9 truncated `responsibility` strings.
18. **Update `scripts/map-codebase.ts`, `tests/ssot_registry_parity.test.ts`, and `docs/ARCHITECTURE.md` / `docs/DECISIONS.md`:**
    - Update `tests/ssot_registry_parity.test.ts` to assert the 3-way partition (`ssot_console.json`, `ssot_classic.json`, `ssot_dnd35e.json`), `SSOT_CLASSIC.md`, and zero duplicate `canonicalEntryPoints`.
    - Run `bun scripts/map-codebase.ts` and `./verify.sh` across all 8 stages.

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| Delete `equipment.ui.ts` & `inventory.ui.ts` | `presenter.ts`, `ui.ts`, `index.html` | Knip dead-code check, `ssot_console.json` | `docs/SSOT_CONSOLE.md`, `docs/ARCHITECTURE.md` |
| Extract `src/systems/rest.system.ts` & `stance.system.ts` (`updateActorTacticalDoctrine`) | `dnd35e_rest_recovery.ts` (moved), `dnd35e_rest_actions.ts`, `dnd35e_doctrine_actions.ts`, `spellbook_actions.ts` | 5 D&D test files importing rest/doctrine/spellbook actions; `.dependency-cruiser.cjs` `headless-simulation-purity` | `ssot_console.json`, `ssot_dnd35e.json`, `SSOT_*.md` |
| Rule 21 fixes (`viewport_snapshot.ts`, `spellbook_slots.ts`, `quickcast`, `hotbar`, `race_hydrator`, `shapeshift`) | `wizard.json`, `dnd35e_system.types.ts`, `dnd35e.types.ts`, campaign `tiles.json` | Unit tests for spellbook slots, quickcast, hotbar, shapeshift, race hydrator, viewport snapshots | `docs/DECISIONS.md`, `public/data/rulesets/dnd35e/classes/wizard.json` |
| 3-way SSOT partition (`ssot_classic.json`) + hard-error unique `canonicalEntryPoints` | `scripts/ssot_parity.ts`, `scripts/map-codebase.ts` | `tests/ssot_registry_parity.test.ts`, `scripts/run-validator.ts` (`[8/8]`) | `docs/SSOT_CONSOLE.md`, `docs/SSOT_CLASSIC.md`, `docs/SSOT_DND35E.md`, `AGENTS.md` (if needed) |
