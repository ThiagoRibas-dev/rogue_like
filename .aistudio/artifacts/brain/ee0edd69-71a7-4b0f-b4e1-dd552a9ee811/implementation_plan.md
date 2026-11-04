# Implementation Plan: Comprehensive Codebase Modularity & 50-File Decomposition

## Executive Summary
This master plan details the architecture and step-by-step execution for decomposing all 50 files in `src/` that currently exceed the 300-line modularity threshold (`AGENTS.md` Rule 8). 

To ensure strict downward dependency flow (`types → core → systems → rulesets → rendering/ui`), prevent circular dependencies, and maintain continuous 100% green verification (`./verify.sh`), the work is executed in 5 sequential phases:
- **Phase A: Foundational Types & Schemas** (`components.types.ts`, `events.types.ts`, `dnd35e_system.types.ts`, `dnd35e.types.ts`)
- **Phase B: Core Console Systems & Engine Primitives** (`ecs.ts`, `session_controller.ts`, `map.system.ts`, `loader.ts`, `bootstrap.ts`, etc.)
- **Phase C: D&D 3.5e Ruleset Engine Sub-Resolvers** (`modifiers.ts`, `attack_resolver.ts`, `equipment_physics.ts`, `character_builder.ts`, `skills.ts`, `skill_verbs.ts`, etc.)
- **Phase D: Editor, Simulation & Diagnostic Tools** (`zod_form_renderer.ts`, `campaign_editor.ts`, `area_editor.ts`, `ai_arena.ts`, etc.)
- **Phase E: Tactical UI, Character Sheet & Viewport** (`dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts`, `dnd35e_level_up.ui.ts`, etc.)

---

## 1. SSOT Ownership & Old-Brain Eviction Table

| Legacy File | Line Count | Decomposed Single-Concern Modules | New Canonical Responsibilities |
| :--- | :--- | :--- | :--- |
| **`types/components.types.ts`** | 764 | `types/components/actor_components.types.ts`<br>`types/components/world_components.types.ts`<br>`types/components/item_components.types.ts`<br>`types/components.types.ts` (facade) | Split 35+ components into Actor, World, and Item interfaces; root file retains `ComponentType` enum and re-exports. |
| **`types/events.types.ts`** | 397 | `types/events/combat_events.types.ts`<br>`types/events/interaction_events.types.ts`<br>`types/events.types.ts` (facade) | Split combat vs interaction events; root file retains `GameEventType` and discriminated union. |
| **`dnd35e_system.types.ts`** | 962 | `types/system/race_class.types.ts`<br>`types/system/feat_spell.types.ts`<br>`types/system/creature_template.types.ts`<br>`types/dnd35e_system.types.ts` (facade) | Split system content Zod schemas into race/class, feat/spell, creature/template; root retains container schema. |
| **`dnd35e.types.ts`** | 472 | `types/stats.types.ts`<br>`types/dnd35e.types.ts` (facade) | Extract ability scores, stat modifiers, and condition interfaces from core entity data. |
| **`core/ecs.ts`** | 825 | `core/ecs/entity_manager.ts`<br>`core/ecs/component_store.ts`<br>`core/ecs/query.ts`<br>`core/ecs/serialization.ts`<br>`core/ecs.ts` (facade) | Separate entity lifecycle, component store, querying, and serialization/packing into dedicated primitives. |
| **`core/session_controller.ts`** | 687 | `core/session/session_clock.ts`<br>`core/session/session_pause.ts`<br>`core/session_controller.ts` (facade) | Extract turn queue tick scheduling and auto-pause condition checks. |
| **`systems/map.system.ts`** | 589 | `systems/map/map_traversal.ts`<br>`systems/map/map_fov.ts`<br>`systems/map.system.ts` (facade) | Extract stairs/portals traversal logic and FOV invalidation from core system dispatch. |
| **`systems/trigger/systemic.ts`** | 621 | `systems/trigger/environmental_hazard.ts`<br>`systems/trigger/mechanical_pressure.ts`<br>`systems/trigger/systemic.ts` (facade) | Separate fire/water environmental propagation from mechanical floor triggers. |
| **`systems/trigger/social.ts`** | 520 | `systems/trigger/social_dialogue.ts`<br>`systems/trigger/social.ts` (facade) | Separate dialogue condition parsing from narrative event listeners. |
| **`modifiers.ts`** | 1,187 | `modifiers/stacking_engine.ts`<br>`modifiers/stat_dag_stages.ts`<br>`modifiers/ac_evaluator.ts`<br>`modifiers.ts` (facade) | Split 18-type bonus stacking rules, 4-stage DAG logic, and AC triplet resolution. |
| **`attack_resolver.ts`** | 995 | `combat/attack_roll.ts`<br>`combat/attack_routine_builder.ts`<br>`combat/doctrine_calculator.ts`<br>`attack_resolver.ts` (facade) | Separate d20 attack rolls, iterative strike sequence synthesis, and Power Attack math. |
| **`equipment_physics.ts`** | 952 | `equipment/weapon_effort_ladder.ts`<br>`equipment/special_materials.ts`<br>`equipment/magic_item_activation.ts`<br>`equipment_physics.ts` (facade) | Separate 3-step effort ladder, special materials physics, and magic activation. |
| **`character_builder.ts`** | 1,538 | `builder/char_builder_creation.ts`<br>`builder/char_builder_level_up.ts`<br>`builder/char_builder_penalties.ts`<br>`builder/char_builder_validation.ts`<br>`character_builder.ts` (facade) | Split Point-Buy character creation, Level-Up advancement, XP penalties/drains, and step validation. |
| **`skill_verbs.ts`** | 938 | `verbs/skill_verbs_dungeon.ts`<br>`verbs/skill_verbs_combat.ts`<br>`verbs/skill_verbs_social.ts`<br>`verbs/skill_verbs_lore.ts`<br>`skill_verbs.ts` (facade) | Split dungeon verbs (search, unlock, disarm), combat verbs (feint, demoralize), social verbs, and Monster Lore. |
| **`skills.ts`** | 690 | `skills/skill_resolvers_social.ts`<br>`skills/skill_resolvers_thievery.ts`<br>`skills.ts` (facade) | Extract pure mathematical resolvers for social and thievery skills. |
| **`level_ledger.ts`** | 720 | `ledger/level_ledger_rebuild.ts`<br>`ledger/level_ledger_drain.ts`<br>`level_ledger.ts` (facade) | Separate chronological state reconstitution from negative levels/energy drain. |
| **`dnd35e_ruleset.ts`** | 688 | `combat/dnd35e_combat_dispatch.ts`<br>`dnd35e_ruleset.ts` (facade) | Extract melee attack execution loop over attackRoutine strikes. |
| **`family_synthesizer.ts`** | 644 | `synthesizers/dragon_synthesizer.ts`<br>`synthesizers/elemental_synthesizer.ts`<br>`family_synthesizer.ts` (facade) | Split 12-age dragon synthesis and 6-step elemental ladder synthesis. |
| **`zod_form_renderer.ts`** | 581 | `zod_forms/form_primitives.ts`<br>`zod_forms/form_composites.ts`<br>`zod_form_renderer.ts` (facade) | Separate primitive field inputs from nested object/array recursion. |
| **`dnd35e_char_builder.ui.ts`** | 887 | `char_builder/char_builder_nav.ui.ts`<br>`char_builder/char_builder_summary.ui.ts`<br>`dnd35e_char_builder.ui.ts` (facade) | Separate navigation tab bar and review summary from master layout shell. |
| **`dnd35e_char_builder_steps.ui.ts`** | 846 | `char_builder_steps/skills_step.ui.ts`<br>`char_builder_steps/feats_step.ui.ts`<br>`char_builder_steps/spells_step.ui.ts`<br>`char_builder_steps/equipment_step.ui.ts`<br>`dnd35e_char_builder_steps.ui.ts` (facade) | Split parameterized step renderers into dedicated files. |
| **`dnd35e_level_up.ui.ts`** | 591 | `level_up/level_up_tabs.ui.ts`<br>`dnd35e_level_up.ui.ts` (facade) | Extract dynamic per-class step tabs and class picker. |

---

## 2. Cascading Effects Matrix (Rule 15)

| Phase & Scope | Upstream Producers & Call Sites | Downstream Consumers & Outputs | Lateral Mirrors & Registries |
| :--- | :--- | :--- | :--- |
| **Phase A: Types** | All files importing types; `package.json` build. Re-export hubs ensure zero call-site breakage. | Typecheck (`tsc --noEmit`), Zod validation, serializable ECS components. | `docs/ssot/ssot_dnd35e.json`, `docs/ssot/ssot_console.json`. |
| **Phase B: Core Engine** | Intent producers, game loop RAF, input handlers, dev server. | Map traversal, cold storage serializations, trigger listeners. | `verify.sh` arch/deadcode linters. |
| **Phase C: Ruleset Engine** | Actions, combat intent processors, skill verbs, Character Creation modal. | 4-Stage Stat DAG, iterative attack sequencing, combat log, test suite. | `system_content_files.ts`, bestiary tests. |
| **Phase D: Editors** | Toolbar buttons, workspace tabs, authoring canvas. | Campaign JSON files, disk IO, JSZip exporter. | Editor UI forms, Zod schemas. |
| **Phase E: Tactical UI** | Keybinds, mouse clicks, modal triggers, Level-Up notifications. | DOM canvas, inspector cards, character sheets. | CSS stylesheets, layout splitters. |

---

## 3. Step-by-Step Implementation Flow

### Phase A: Foundational Types & Schemas
- **Step A.1 (`components.types.ts`):**
  - Create `src/types/components/actor_components.types.ts`, `world_components.types.ts`, `item_components.types.ts`.
  - Re-export all interfaces from `src/types/components.types.ts`.
  - Verify `bun x tsc --noEmit` and line count $\le$ 300.
- **Step A.2 (`events.types.ts`):**
  - Create `src/types/events/combat_events.types.ts` and `interaction_events.types.ts`.
  - Re-export from `src/types/events.types.ts`.
- **Step A.3 (`dnd35e_system.types.ts`):**
  - Create `src/rulesets/dnd35e/types/system/race_class.types.ts`, `feat_spell.types.ts`, `creature_template.types.ts`.
  - Re-export from `dnd35e_system.types.ts`.
- **Step A.4 (`dnd35e.types.ts`):**
  - Create `src/rulesets/dnd35e/types/stats.types.ts`. Re-export from `dnd35e.types.ts`.
- **Phase A Checkpoint:** Run `./verify.sh`. Ensure all 8 stages pass.

### Phase B: Core Console Systems & Engine Primitives
- **Step B.1 (`ecs.ts`):**
  - Create `src/core/ecs/entity_manager.ts`, `component_store.ts`, `query.ts`, `serialization.ts`.
  - Keep `src/core/ecs.ts` as pure facade re-exporting all canonical functions.
- **Step B.2 (`session_controller.ts`):**
  - Extract `src/core/session/session_clock.ts` and `session_pause.ts`.
- **Step B.3 (`map.system.ts`):**
  - Extract `src/systems/map/map_traversal.ts` and `map_fov.ts`.
- **Step B.4 (`triggers`):**
  - Extract `environmental_hazard.ts` and `mechanical_pressure.ts` from `systemic.ts`.
  - Extract `social_dialogue.ts` from `social.ts`.
- **Step B.5 (`loader.ts`, `bootstrap.ts`, `game-loop.ts`, `action.registry.ts`, `inventory.system.ts`, etc.):**
  - Extract single-concern sub-modules for each remaining Console file.
- **Phase B Checkpoint:** Run `./verify.sh`. Ensure all 8 stages pass.

### Phase C: D&D 3.5e Ruleset Engine Sub-Resolvers
- **Step C.1 (`modifiers.ts`):**
  - Create `modifiers/stacking_engine.ts`, `modifiers/stat_dag_stages.ts`, `modifiers/ac_evaluator.ts`.
  - Slim down `modifiers.ts` to DAG coordinator.
- **Step C.2 (`attack_resolver.ts`):**
  - Create `combat/attack_roll.ts`, `combat/attack_routine_builder.ts`, `combat/doctrine_calculator.ts`.
- **Step C.3 (`equipment_physics.ts`):**
  - Create `equipment/weapon_effort_ladder.ts`, `equipment/special_materials.ts`, `equipment/magic_item_activation.ts`.
- **Step C.4 (`character_builder.ts`):**
  - Create `builder/char_builder_creation.ts`, `builder/char_builder_level_up.ts`, `builder/char_builder_penalties.ts`, `builder/char_builder_validation.ts`.
- **Step C.5 (`skill_verbs.ts` & `skills.ts`):**
  - Create `verbs/skill_verbs_dungeon.ts`, `verbs/skill_verbs_combat.ts`, `verbs/skill_verbs_lore.ts`.
  - Create `skills/skill_resolvers_social.ts`, `skills/skill_resolvers_thievery.ts`.
- **Step C.6 (Remaining Ruleset Files):**
  - Decompose `level_ledger.ts`, `family_synthesizer.ts`, `spellcasting.ts`, `progression.ts`, `templates.ts`, `dnd35e_validator.ts`, `dnd35e_ruleset.ts`.
- **Phase C Checkpoint:** Run `./verify.sh`. Ensure all 122 regression tests pass.

### Phase D: Editor, Simulation & Diagnostic Tools
- **Step D.1 (`zod_form_renderer.ts`):**
  - Extract `form_primitives.ts` and `form_composites.ts`.
- **Step D.2 (`campaign_editor.ts` & `area_editor.ts`):**
  - Extract `editor_persistence.ts` and `area_editor_tools.ts`.
- **Step D.3 (`editor_toolbar.ts`, `workspace_file_service.ts`, `dialogue_editor.ts`, `ai_arena.ts`, `editor_workspace.ts`, `render_debug.ts`):**
  - Extract dedicated view/tool modules.
- **Phase D Checkpoint:** Run `./verify.sh`. Ensure all 8 stages pass.

### Phase E: Tactical UI, Character Sheet & Viewport
- **Step E.1 (`dnd35e_char_builder.ui.ts` & `dnd35e_char_builder_steps.ui.ts`):**
  - Extract `char_builder_nav.ui.ts`, `char_builder_summary.ui.ts`, and individual step views (`skills_step.ui.ts`, `feats_step.ui.ts`, `spells_step.ui.ts`, `equipment_step.ui.ts`).
- **Step E.2 (`dnd35e_level_up.ui.ts`, `dnd35e_inspector.ui.ts`, `viewport_snapshot.ts`, `world_graph.ts`, `display.ts`):**
  - Extract tabs, inspector cards, and viewport entity rendering.
- **Phase E Checkpoint:** Run `./verify.sh`. All 50 files decomposed, 0 files > 300 lines!

---

## 4. Code Diffs & Integration Previews

### Preview: `src/core/ecs/entity_manager.ts`
```typescript
import type { EntityId, GameState } from '../../types/game-state.types.ts';

/**
 * Creates a new unique EntityId in the game state.
 *
 * @param state The current GameState.
 * @returns A tuple of the updated GameState and the new EntityId.
 */
export function createEntity(state: GameState): readonly [GameState, EntityId] {
  const entityId = state.nextEntityId;
  const nextState: GameState = {
    ...state,
    nextEntityId: (entityId + 1) as EntityId,
    entities: [...state.entities, entityId]
  };
  return [nextState, entityId];
}

/**
 * Removes an entity and purges all of its associated components.
 *
 * @param state The current GameState.
 * @param entityId The EntityId to destroy.
 * @returns The updated GameState without the entity.
 */
export function destroyEntity(state: GameState, entityId: EntityId): GameState {
  const nextEntities = state.entities.filter((id) => id !== entityId);
  const nextComponents: Record<string, unknown[]> = {};
  for (const [typeKey, compArray] of Object.entries(state.components)) {
    if (Array.isArray(compArray)) {
      nextComponents[typeKey] = compArray.filter((_, idx) => idx !== (entityId as number));
    }
  }
  return {
    ...state,
    entities: nextEntities,
    components: nextComponents as GameState['components']
  };
}
```

### Preview: `src/core/ecs.ts` (Refactored Facade)
```typescript
// Re-export single-concern ECS primitives (Rule 8 & Rule 15)
export { createEntity, destroyEntity } from './ecs/entity_manager.ts';
export { addComponent, removeComponent, getComponent, hasComponent } from './ecs/component_store.ts';
export { queryEntities } from './ecs/query.ts';
export {
  packComponentsForColdStorage,
  unpackComponentsFromColdStorage,
  pruneOrphanEntities
} from './ecs/serialization.ts';
```

---

## 5. Verification & Rollout Strategy

1. **Incremental Validation:** Run `./verify.sh` at the end of each Phase (A, B, C, D, E) to ensure zero compilation or regression failures.
2. **File Length Tracking:** Monitor `bun run lint:filelength` as files drop off the warning list sequentially until **0 files exceed 300 lines**.
3. **SSOT Parity:** After each phase, update `docs/ssot/ssot_console.json` and `docs/ssot/ssot_dnd35e.json`, run `bun scripts/map-codebase.ts`, and run `bun run scripts/run-validator.ts` to ensure 100% SSOT architectural coverage.
