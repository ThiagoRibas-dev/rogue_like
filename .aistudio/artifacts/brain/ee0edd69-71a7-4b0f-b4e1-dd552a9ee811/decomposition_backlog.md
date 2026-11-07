# Codebase Modularity & Decomposition Backlog

*Target: AGENTS.md Rule 8 (Single concern per file, target $\le$ 300 lines, zero barrel files).*

This document provides a structured analysis of files in `src/` exceeding 300 lines, ordered strictly from longest to shortest. For each file, it documents its architectural domain, current responsibilities, and a proposed single-concern decomposition plan.

---

## High-Level Priority Clusters

| Cluster | Key Files | Rationale |
| :--- | :--- | :--- |
| **Cluster 1: D&D 3.5e Heavy Rules Engine** | `character_builder.ts`, `modifiers.ts`, `attack_resolver.ts`, `equipment_physics.ts`, `skill_verbs.ts`, `level_ledger.ts`, `skills.ts`, `dnd35e_ruleset.ts` | Complex mathematical and tactical logic; highest risk of regressions; benefits most from modular sub-resolvers. |
| **Cluster 2: UI & Tactical Views** | `dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts`, `dnd35e_level_up.ui.ts`, `zod_form_renderer.ts`, `knowledge_simulator.ui.ts`, `area_editor.ts` | Large DOM rendering functions; easily split into dedicated tab/component views. |
| **Cluster 3: Core Console Engine Primitives** | `ecs.ts`, `session_controller.ts`, `map.system.ts`, `loader.ts`, `bootstrap.ts`, `game-loop.ts`, `action.registry.ts` | Structural engine primitives; must preserve ECS serialization purity and zero-overhead performance. |
| **Cluster 4: Type Definitions & Schemas** | `dnd35e_system.types.ts`, `components.types.ts`, `dnd35e.types.ts`, `events.types.ts` | Schema files with large Zod / TypeScript interface definitions; cleanly split by domain. |

---

## Master File Inventory (Ordered from Longest to Shortest)

### 1. `src/rulesets/dnd35e/character_builder.ts` (1,538 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** Monolithic orchestrator of 1st-level character creation draft state, Point-Buy budget evaluation, Level-Up advancement commit, Favored Class / multiclass XP penalties, and negative level / permanent drain mutations.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/builder/char_builder_creation.ts` (~280 lines): Point-Buy cost calculator, Level 1 starting equipment physical materialization, baseline character creation draft commit.
  - `src/rulesets/dnd35e/builder/char_builder_level_up.ts` (~260 lines): Incremental level advancement, every-4th-HD ability score increases, spell slot advancement calculation.
  - `src/rulesets/dnd35e/builder/char_builder_penalties.ts` (~180 lines): Multiclass XP penalty calculations, negative level drain (`applyNegativeLevelsToActor`), permanent drain.
  - `src/rulesets/dnd35e/builder/char_builder_validation.ts` (~250 lines): Validation functions for character creation steps and level up steps.
  - `src/rulesets/dnd35e/character_builder.ts` (< 200 lines): Slim coordinator facade with direct re-exports for backward compatibility.

---

### 2. `src/rulesets/dnd35e/modifiers.ts` (1,187 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Layer 2 — Modifiers & Stacking Math`)
- **Current Responsibilities:** Full 4-Stage Topological Sub-Stat DAG evaluator (`evaluateDnD35ActorStatDAG`), 18-bonus-type stacking engine, winner/shadowed/suppressed resolution, AC triplet calculation (Full, Touch, Flat-Footed).
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/modifiers/stacking_engine.ts` (~260 lines): Pure bonus type stacking rules (dodge/untyped stack; enhancement, morale, sacred, luck take highest; penalties stack).
  - `src/rulesets/dnd35e/modifiers/stat_dag_stages.ts` (~280 lines): Stage 1 (Base/Racial), Stage 2 (Abilities), Stage 3 (Armor/Shield), Stage 4 (Derived).
  - `src/rulesets/dnd35e/modifiers/ac_evaluator.ts` (~220 lines): Full AC, Touch AC, Flat-Footed AC triplet calculation with incorporeal/force tag handling.
  - `src/rulesets/dnd35e/modifiers.ts` (< 200 lines): DAG entry point facade (`evaluateDnD35ActorStatDAG`, `DND35E_BASE_AC`).

---

### 3. `src/rulesets/dnd35e/combat/attack_resolver.ts` (995 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Layer 5 — Combat, Maneuvers & Damage`)
- **Current Responsibilities:** Iterative BAB sequencing, TWF penalties, natural weapon demotion, per-strike Power Attack scaling, handedness STR scaling (1.5x/1x/0.5x), and d20 attack roll resolution.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/combat/attack_roll.ts` (~250 lines): d20 attack roll, critical threat range check, critical confirmation roll.
  - `src/rulesets/dnd35e/combat/attack_routine_builder.ts` (~280 lines): Stage 4 DAG iterative manufactured + natural weapon strike routine synthesis.
  - `src/rulesets/dnd35e/combat/doctrine_calculator.ts` (~220 lines): Power Attack scaling (1x/2x/0x) and Combat Expertise penalty/bonus allocation.
  - `src/rulesets/dnd35e/combat/attack_resolver.ts` (< 250 lines): Facade coordinating attack intents.

---

### 4. `src/rulesets/dnd35e/types/dnd35e_system.types.ts` (962 lines)
- **Domain:** Tier 1 Types (`D&D 3.5e: Ruleset Types & Schemas`)
- **Current Responsibilities:** Monolithic Zod schemas and TypeScript interfaces for system content JSONs (races, classes, feats, spells, creature types, templates, domains).
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/types/system/race_class.types.ts` (~250 lines): Race, class, progression track schemas.
  - `src/rulesets/dnd35e/types/system/feat_spell.types.ts` (~260 lines): Feat, spell, metamagic, domain schemas.
  - `src/rulesets/dnd35e/types/system/creature_template.types.ts` (~240 lines): Creature type engines, templates, dragons, elementals.
  - `src/rulesets/dnd35e/types/dnd35e_system.types.ts` (< 220 lines): Central system content container schema (`DnD35SystemContentSchema`).

---

### 5. `src/rulesets/dnd35e/equipment_physics.ts` (952 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Layer 5 — Combat, Maneuvers & Damage`)
- **Current Responsibilities:** Weapon effort ladder (light/1H/2H relative to wielder size), handedness/grip mode toggles, size mismatch penalties, special materials physics (Adamantine, Mithral, Cold Iron, Silver), and magic item activation.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/equipment/weapon_effort_ladder.ts` (~260 lines): 3-step effort ladder, wielder vs weapon size mismatch penalties.
  - `src/rulesets/dnd35e/equipment/special_materials.ts` (~240 lines): Special materials physics, hardness/HP deltas, and bypass tags.
  - `src/rulesets/dnd35e/equipment/magic_item_activation.ts` (~220 lines): Command word, spell completion, spell trigger resolution.
  - `src/rulesets/dnd35e/equipment_physics.ts` (< 240 lines): Equipped profile resolver facade (`resolveEquippedWeaponProfile`).

---

### 6. `src/rulesets/dnd35e/skill_verbs.ts` (938 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** Dispatcher for all active dungeon/combat skill verbs (`search`, `unlock`, `disarm`, `heal`, `feint`, `intimidate`, `persuade`), wand UMD validation, Monster Lore inspection lines.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/verbs/skill_verbs_dungeon.ts` (~280 lines): `search`, `unlock`, `disarm` (trapfinding, lock/trap difficulty).
  - `src/rulesets/dnd35e/verbs/skill_verbs_combat.ts` (~280 lines): `feint`, `intimidate`, `heal` (stabilize, demoralize, flat-footed).
  - `src/rulesets/dnd35e/verbs/skill_verbs_social.ts` (~180 lines): `persuade` (Diplomacy attitude shifts).
  - `src/rulesets/dnd35e/verbs/skill_verbs_lore.ts` (~180 lines): Monster Lore inspection lines, UMD wand activation.
  - `src/rulesets/dnd35e/skill_verbs.ts` (< 150 lines): Top-level verb dispatcher.

---

### 7. `src/rendering/ui/dnd35e_char_builder.ui.ts` (887 lines)
- **Domain:** Tier 2 UI (`D&D 3.5e: Tactical UI & Character Sheet`)
- **Current Responsibilities:** Full-screen 2-pane layout, scroll preservation across rerenders, step-tab navigation, draft state commitment.
- **Proposed Decomposition Strategy:**
  - `src/rendering/ui/char_builder/char_builder_nav.ui.ts` (~250 lines): Tab navigation bar, validation prompts, Next/Back controls.
  - `src/rendering/ui/char_builder/char_builder_summary.ui.ts` (~280 lines): Final review pane, point-buy summary, draft commit button.
  - `src/rendering/ui/dnd35e_char_builder.ui.ts` (< 300 lines): Shell frame and modal lifecycle.

---

### 8. `src/rendering/ui/dnd35e_char_builder_steps.ui.ts` (846 lines)
- **Domain:** Tier 2 UI (`D&D 3.5e: Tactical UI & Character Sheet`)
- **Current Responsibilities:** Reusable, parameterized master/detail step renderers for Skills, Feats, per-class Spells, and Starting Equipment.
- **Proposed Decomposition Strategy:**
  - `src/rendering/ui/char_builder_steps/skills_step.ui.ts` (~250 lines): Skills step rendering and rank allocation controls.
  - `src/rendering/ui/char_builder_steps/feats_step.ui.ts` (~250 lines): Feats step rendering and filter chips.
  - `src/rendering/ui/char_builder_steps/spells_step.ui.ts` (~220 lines): Class spells step rendering and spellbook cards.
  - `src/rendering/ui/char_builder_steps/equipment_step.ui.ts` (~180 lines): Equipment packages and starting gear picker.
  - `src/rendering/ui/dnd35e_char_builder_steps.ui.ts` (< 100 lines): Facade re-exporting steps.

---

### 9. `src/core/ecs.ts` (825 lines)
- **Domain:** Tier 1 Console (`Core Console: Entity Component System`)
- **Current Responsibilities:** Primitives for entity creation, deletion, component registration, querying, component packing, serialization, and orphan pruning.
- **Proposed Decomposition Strategy:**
  - `src/core/ecs/entity_manager.ts` (~240 lines): Entity ID counter, creation, deletion lifecycle.
  - `src/core/ecs/component_store.ts` (~280 lines): Component adding, removing, retrieval, indexing.
  - `src/core/ecs/query.ts` (~200 lines): Entity querying with component filtering.
  - `src/core/ecs/serialization.ts` (~200 lines): Cold storage packing, orphan pruning, JSON serialization.
  - `src/core/ecs.ts` (< 150 lines): Backward-compatible API facade.

---

### 10. `src/types/components.types.ts` (764 lines)
- **Domain:** Tier 1 Types (`Core Console: Types`)
- **Current Responsibilities:** Type definitions for all 35+ ECS component interfaces in the engine.
- **Proposed Decomposition Strategy:**
  - `src/types/components/actor_components.types.ts` (~250 lines): Fighter, Player, Identity, Faction, Memory, Attitude.
  - `src/types/components/world_components.types.ts` (~250 lines): Position, Area, Door, Lock, Trap, Hazard, SpatialField.
  - `src/types/components/item_components.types.ts` (~200 lines): Item, Inventory, Equipment, PropertyOverlay.
  - `src/types/components.types.ts` (< 150 lines): ComponentType enum and re-exports.

---

### 11. `src/rulesets/dnd35e/level_ledger.ts` (720 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** Level history ledger (Horizon 1), rebuilding state across 20 levels (Horizon 2), negative levels and permanent drain.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/ledger/level_ledger_rebuild.ts` (~280 lines): Chronological level-by-level state reconstitution.
  - `src/rulesets/dnd35e/ledger/level_ledger_drain.ts` (~220 lines): Energy drain, negative levels, restoration.
  - `src/rulesets/dnd35e/level_ledger.ts` (< 250 lines): Ledger facade.

---

### 12. `src/rulesets/dnd35e/skills.ts` (690 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** 50-skill mathematical resolvers (Diplomacy, Monster Lore, Heal, Search, Disable Device, Open Lock, Demoralize, Feint, Take 10/20).
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/skills/skill_resolvers_social.ts` (~240 lines): Diplomacy, Demoralize, Feint math.
  - `src/rulesets/dnd35e/skills/skill_resolvers_thievery.ts` (~240 lines): Open Lock, Disable Device, Search math.
  - `src/rulesets/dnd35e/skills.ts` (< 250 lines): Skill check framework and synergies.

---

### 13. `src/rulesets/dnd35e/dnd35e_ruleset.ts` (688 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** RulesetContract implementation, 4-stage DAG coordination, melee attack execution loop over attackRoutine.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/combat/dnd35e_combat_dispatch.ts` (~260 lines): Melee attack intent execution loop over attackRoutine strikes.
  - `src/rulesets/dnd35e/dnd35e_ruleset.ts` (< 300 lines): RulesetContract implementation and HUD projection.

---

### 14. `src/core/session_controller.ts` (687 lines)
- **Domain:** Tier 1 Console (`Core Console: Session & State`)
- **Current Responsibilities:** Orchestrates game loop ticks, RTwP mode, paused state, auto-pause triggers, speed modifiers.
- **Proposed Decomposition Strategy:**
  - `src/core/session/session_clock.ts` (~250 lines): Turn queue scheduling, delta-time accumulation, RTwP tick pacing.
  - `src/core/session/session_pause.ts` (~200 lines): Auto-pause condition evaluation (enemy spotted, low HP, trap discovered).
  - `src/core/session_controller.ts` (< 280 lines): Session controller facade.

---

### 15. `src/rulesets/dnd35e/family_synthesizer.ts` (644 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** Synthesizes true dragon 12-age-category archetypes and elemental 6-step ladders; Golem magic interactions.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/synthesizers/dragon_synthesizer.ts` (~280 lines): 10 dragon varieties across 12 age categories.
  - `src/rulesets/dnd35e/synthesizers/elemental_synthesizer.ts` (~220 lines): 4 elemental types across 6 size steps.
  - `src/rulesets/dnd35e/family_synthesizer.ts` (< 180 lines): Golem magic interactions and facade.

---

### 16. `src/systems/trigger/systemic.ts` (621 lines)
- **Domain:** Tier 1 Console (`Core Console: Narrative & Triggers`)
- **Current Responsibilities:** Systemic environmental and physics triggers (fire spread, water conduct, pressure plates).
- **Proposed Decomposition Strategy:**
  - `src/systems/trigger/environmental.ts` (~280 lines): Fire, water, freezing, hazard interactions.
  - `src/systems/trigger/mechanical.ts` (~250 lines): Pressure plates, tripwires, traps.
  - `src/systems/trigger/systemic.ts` (< 150 lines): Event listener dispatcher.

---

### 17. `src/rendering/ui/dnd35e_level_up.ui.ts` (591 lines)
- **Domain:** Tier 2 UI (`D&D 3.5e: Tactical UI & Character Sheet`)
- **Current Responsibilities:** Interactive level-up modal shell, step-tab bar navigation, multiclass level allocation.
- **Proposed Decomposition Strategy:**
  - `src/rendering/ui/level_up/level_up_tabs.ui.ts` (~260 lines): Dynamic per-class step tabs and class picker.
  - `src/rendering/ui/dnd35e_level_up.ui.ts` (< 300 lines): Shell modal and commit logic.

---

### 18. `src/systems/map.system.ts` (589 lines)
- **Domain:** Tier 1 Console (`Core Console: Map & Exploration`)
- **Current Responsibilities:** Map updates, FOV recalculation, tile exploration memory, stairs/level traversal.
- **Proposed Decomposition Strategy:**
  - `src/systems/map/map_traversal.ts` (~260 lines): Stairs, portals, cross-level transitions.
  - `src/systems/map/map_fov.ts` (~200 lines): FOV invalidation, shadowcasting delegation, exploration state.
  - `src/systems/map.system.ts` (< 200 lines): System dispatcher.

---

### 19. `src/rendering/ui/zod_form_renderer.ts` (581 lines)
- **Domain:** Tier 1 Console (`Core Console: Editor & Form Renderer`)
- **Current Responsibilities:** Dynamically generates DOM form controls from arbitrary Zod schemas with nested object/array recursion.
- **Proposed Decomposition Strategy:**
  - `src/rendering/ui/zod_forms/form_primitives.ts` (~260 lines): Number, string, boolean, enum controls.
  - `src/rendering/ui/zod_forms/form_composites.ts` (~250 lines): Object, array, discriminated union fieldsets.
  - `src/rendering/ui/zod_form_renderer.ts` (< 150 lines): Top-level form generator.

---

### 20. `src/rendering/ui/knowledge_simulator.ui.ts` (574 lines)
- **Domain:** Tier 1 Console (`Core Console: Editor & Simulation UI`)
- **Current Responsibilities:** Simulates NPC knowledge spread, rumors, and faction gossip graphs.
- **Proposed Decomposition Strategy:**
  - `src/rendering/ui/knowledge_sim/knowledge_sim_graph.ui.ts` (~280 lines): Graph rendering and visual node layouts.
  - `src/rendering/ui/knowledge_simulator.ui.ts` (< 300 lines): Inspector and control toolbar.

---

### 21. `src/editor/campaign_editor.ts` (550 lines)
- **Domain:** Tier 1 Console (`Core Console: Editor & Authoring`)
- **Current Responsibilities:** Campaign creation, editing, area switching, disk loading, saving.
- **Proposed Decomposition Strategy:**
  - `src/editor/campaign/editor_persistence.ts` (~250 lines): Loading, saving, validation.
  - `src/editor/campaign_editor.ts` (< 300 lines): UI framing and area workspace routing.

---

### 22. `src/rulesets/dnd35e/progression.ts` (539 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** BAB curves, Save curves, XP thresholds, class progression tables, NPC CR contribution.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/progression/progression_curves.ts` (~220 lines): BAB, Fort, Ref, Will curve evaluations.
  - `src/rulesets/dnd35e/progression/progression_tables.ts` (~240 lines): Level advancement, class progression lookup tables.
  - `src/rulesets/dnd35e/progression.ts` (< 200 lines): Aggregated chassis calculation.

---

### 23. `src/rendering/ui/area_editor.ts` (534 lines)
- **Domain:** Tier 1 Console (`Core Console: Editor & Authoring`)
- **Current Responsibilities:** Interactive tile paint canvas, entity placement, connection editor.
- **Proposed Decomposition Strategy:**
  - `src/rendering/ui/area_editor/area_editor_tools.ts` (~250 lines): Tile painter, select, erase tools.
  - `src/rendering/ui/area_editor.ts` (< 280 lines): Workspace canvas and properties inspector.

---

### 24. `src/systems/trigger/social.ts` (520 lines)
- **Domain:** Tier 1 Console (`Core Console: Narrative & Triggers`)
- **Current Responsibilities:** Social interaction triggers (insult, praise, bribe, faction enmity).
- **Proposed Decomposition Strategy:**
  - `src/systems/trigger/social_dialogue_triggers.ts` (~260 lines): Dialogue option condition triggers.
  - `src/systems/trigger/social.ts` (< 260 lines): Social event listener dispatcher.

---

### 25. `src/systems/rivalry.system.ts` (514 lines)
- **Domain:** Tier 1 Console (`Core Console: Nemesis & Faction`)
- **Current Responsibilities:** Nemesis generation, rivalry escalation, cheat-death resurrection, rank promotion.
- **Proposed Decomposition Strategy:**
  - `src/systems/rivalry/rivalry_nemesis_generator.ts` (~240 lines): Dynamic nemesis generation, scars, personality quirks.
  - `src/systems/rivalry.system.ts` (< 280 lines): Nemesis encounter listener and hierarchy escalation.

---

### 26. `src/map/encounter_director.ts` (512 lines)
- **Domain:** Tier 1 Console (`Core Console: Map & Exploration`)
- **Current Responsibilities:** Dynamic encounter budgeting, threat pacing, spawn pool selection.
- **Proposed Decomposition Strategy:**
  - `src/map/director/encounter_budget.ts` (~220 lines): Threat budget and pacing curves.
  - `src/map/encounter_director.ts` (< 290 lines): Director spawn placement and lifecycle.

---

### 27. `src/rendering/editor/editor_toolbar.ts` (504 lines)
- **Domain:** Tier 1 Console (`Core Console: Editor UI`)
- **Current Responsibilities:** Top toolbar, tool buttons, mode switches, modal dialog triggers.
- **Proposed Decomposition Strategy:**
  - `src/rendering/editor/toolbar_buttons.ts` (~220 lines): Button definitions and action bindings.
  - `src/rendering/editor/editor_toolbar.ts` (< 280 lines): Toolbar DOM container and layout.

---

### 28. `src/rulesets/dnd35e/magic/spellcasting.ts` (501 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Layer 4 — Vancian Magic & Spells`)
- **Current Responsibilities:** Caster level calculation, bonus spell slots by ability score, spontaneous conversion, casting pipeline.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/magic/spell_slot_math.ts` (~220 lines): Bonus slots by ability score, castable spell levels.
  - `src/rulesets/dnd35e/magic/spellcasting.ts` (< 280 lines): Cast resolution pipeline and spontaneous conversion.

---

### 29. `src/rendering/viewport_snapshot.ts` (488 lines)
- **Domain:** Tier 1 Console (`Core Console: Rendering & Viewport`)
- **Current Responsibilities:** Extracts visible entities, tiles, overlays, floating text, and HUD data for display.
- **Proposed Decomposition Strategy:**
  - `src/rendering/viewport/snapshot_entities.ts` (~220 lines): Entity extraction and sprite/glyph resolution.
  - `src/rendering/viewport_snapshot.ts` (< 270 lines): Camera projection and viewport frame assembly.

---

### 30. `src/rulesets/dnd35e/types/dnd35e.types.ts` (472 lines)
- **Domain:** Tier 1 Types (`D&D 3.5e: Ruleset Types & Schemas`)
- **Current Responsibilities:** Type definitions for ability scores, conditions, damage types, resolved stats, modifiers.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/types/stats.types.ts` (~200 lines): AbilityScoresRecord, StatModifier, StatModifierCondition.
  - `src/rulesets/dnd35e/types/dnd35e.types.ts` (< 270 lines): Core entity data and conditions.

---

### 31. `src/core/loader.ts` (466 lines)
- **Domain:** Tier 1 Console (`Core Console: Data Loading`)
- **Current Responsibilities:** Async fetching and loading of campaign JSON files, system content, validation dispatch.
- **Proposed Decomposition Strategy:**
  - `src/core/loader/loader_system_content.ts` (~220 lines): System content and ruleset loading.
  - `src/core/loader.ts` (< 250 lines): Campaign asset loading and zip archive unpacking.

---

### 32. `src/systems/effects.system.ts` (460 lines)
- **Domain:** Tier 1 Console (`Core Console: Effects & Animation`)
- **Current Responsibilities:** Particle emitters, floating combat text, visual overlays, screen shakes.
- **Proposed Decomposition Strategy:**
  - `src/systems/effects/floating_text.ts` (~180 lines): Floating text animation and lifetime.
  - `src/systems/effects.system.ts` (< 280 lines): Particle and tile animation dispatcher.

---

### 33. `src/rendering/ui/world_graph.ts` (453 lines)
- **Domain:** Tier 1 Console (`Core Console: UI & World Navigation`)
- **Current Responsibilities:** Overworld area connection graph, pathfinding visualization, fast-travel map.
- **Proposed Decomposition Strategy:**
  - `src/rendering/ui/world_graph/world_graph_renderer.ts` (~220 lines): Node and edge canvas drawing.
  - `src/rendering/ui/world_graph.ts` (< 240 lines): World graph modal and interaction controller.

---

### 34. `src/rulesets/dnd35e/archetype_resolver.ts` (451 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** Race-to-archetype derivation, dragon/elemental delegation, entity data hydration.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/archetype/race_hydrator.ts` (~220 lines): Race definition to archetype conversion.
  - `src/rulesets/dnd35e/archetype_resolver.ts` (< 250 lines): Archetype lookup, default presets, entity data hydration.

---

### 35. `src/core/bootstrap.ts` (446 lines)
- **Domain:** Tier 1 Console (`Core Console: Bootstrap & Initialization`)
- **Current Responsibilities:** Application startup, DOM container mounting, canvas setup, keyboard listener binding, theme initialization.
- **Proposed Decomposition Strategy:**
  - `src/core/bootstrap/dom_mount.ts` (~200 lines): DOM container hierarchy and canvas mounting.
  - `src/core/bootstrap.ts` (< 250 lines): Game bootstrap orchestration.

---

### 36. `src/rulesets/dnd35e/templates.ts` (443 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** Applies creature templates (Celestial, Fiendish, Skeleton, Zombie, Lich) to entity chassis.
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/templates/undead_templates.ts` (~220 lines): Skeleton, Zombie, Lich undead transformations.
  - `src/rulesets/dnd35e/templates.ts` (< 240 lines): Celestial, Fiendish, and general template applicator.

---

### 37. `src/map/generator_stages.ts` (426 lines)
- **Domain:** Tier 1 Console (`Core Console: Map & Generation`)
- **Current Responsibilities:** Multi-stage procedural generation pipeline (rooms, corridors, doors, water, stairs, props).
- **Proposed Decomposition Strategy:**
  - `src/map/generator/generator_room_features.ts` (~200 lines): Water, chasm, props, decoration placement.
  - `src/map/generator_stages.ts` (< 230 lines): Room layout and corridor excavation pipeline.

---

### 38. `src/editor/workspace_file_service.ts` (424 lines)
- **Domain:** Tier 1 Console (`Core Console: Editor & IO`)
- **Current Responsibilities:** File system access API, zip export/import, disk JSON reading/writing.
- **Proposed Decomposition Strategy:**
  - `src/editor/workspace/workspace_zip.ts` (~200 lines): Zip archive packaging and extraction via JSZip.
  - `src/editor/workspace_file_service.ts` (< 230 lines): File system read/write operations.

---

### 39. `src/systems/inventory.system.ts` (423 lines)
- **Domain:** Tier 1 Console (`Core Console: Items & Equipment`)
- **Current Responsibilities:** Item pickup, drop, equip, unequip, inventory slot capacity.
- **Proposed Decomposition Strategy:**
  - `src/systems/inventory/equipment_slots.ts` (~200 lines): Slot validation, limb occupancy, equip/unequip mutators.
  - `src/systems/inventory.system.ts` (< 230 lines): Pickup, drop, use item intent processing.

---

### 40. `src/rulesets/dnd35e/dnd35e_validator.ts` (412 lines)
- **Domain:** Tier 2 Ruleset Cartridge (`D&D 3.5e: Core Cartridge & Progression`)
- **Current Responsibilities:** Cross-reference integrity validator for system content JSONs (skills, feats, races, classes, prerequisites AST).
- **Proposed Decomposition Strategy:**
  - `src/rulesets/dnd35e/validator/prerequisite_validator.ts` (~180 lines): Prerequisite AST node recursive validation.
  - `src/rulesets/dnd35e/dnd35e_validator.ts` (< 240 lines): Content integrity checker.

---

### 41. `src/rendering/ui/dialogue_editor.ts` (410 lines)
- **Domain:** Tier 1 Console (`Core Console: Editor UI`)
- **Current Responsibilities:** Interactive node graph and form editor for branching dialogue trees.
- **Proposed Decomposition Strategy:**
  - `src/rendering/ui/dialogue/dialogue_node_editor.ts` (~200 lines): Single dialogue node inspector and branch editor.
  - `src/rendering/ui/dialogue_editor.ts` (< 220 lines): Dialogue tree graph and conversation manager.

---

### 42. `src/rendering/render_debug.ts` (410 lines)
- **Domain:** Tier 1 Console (`Core Console: Rendering & Diagnostics`)
- **Current Responsibilities:** Debug overlay rendering (threatened squares, pathfinding heatmaps, FOV rays, entity collision boxes).
- **Proposed Decomposition Strategy:**
  - `src/rendering/debug/render_debug_spatial.ts` (~200 lines): Threatened squares, LoS rays, reach bounds.
  - `src/rendering/render_debug.ts` (< 220 lines): Performance metrics and debug HUD.

---

### 43. `src/editor/simulation/ai_arena.ts` (406 lines)
- **Domain:** Tier 1 Console (`Core Console: Editor & Simulation`)
- **Current Responsibilities:** Headless combat simulation arena for balance testing and automated monster vs party skirmishes.
- **Proposed Decomposition Strategy:**
  - `src/editor/simulation/arena_runner.ts` (~200 lines): Headless battle loop execution and telemetry capture.
  - `src/editor/simulation/ai_arena.ts` (< 220 lines): Arena UI setup and match statistics display.

---

### 44. `src/systems/scheme.system.ts` (401 lines)
- **Domain:** Tier 1 Console (`Core Console: Factions & Masterminds`)
- **Current Responsibilities:** Mastermind villain scheming, plots, clues, deadlines, stage progression.
- **Proposed Decomposition Strategy:**
  - `src/systems/scheme/scheme_progression.ts` (~190 lines): Turn advancing, deadline evaluation, phase mutation.
  - `src/systems/scheme.system.ts` (< 220 lines): Scheme event listener and investigation board updates.

---

### 45. `src/rendering/editor/editor_workspace.ts` (398 lines)
- **Domain:** Tier 1 Console (`Core Console: Editor UI`)
- **Current Responsibilities:** Tabbed editor layout hosting area canvas, dialogue editor, entity forms, and world graph.
- **Proposed Decomposition Strategy:**
  - `src/rendering/editor/editor_tabs.ts` (~180 lines): Workspace tab bar and view routing.
  - `src/rendering/editor/editor_workspace.ts` (< 220 lines): Workspace container and layout splitters.

---

### 46. `src/types/events.types.ts` (397 lines)
- **Domain:** Tier 1 Types (`Core Console: Types`)
- **Current Responsibilities:** Discriminated union of all 40+ GameEvent interfaces in the engine.
- **Proposed Decomposition Strategy:**
  - `src/types/events/combat_events.types.ts` (~180 lines): Attack, Damage, Death, Maneuver events.
  - `src/types/events/interaction_events.types.ts` (~180 lines): Dialogue, Trade, Item, Social events.
  - `src/types/events.types.ts` (< 150 lines): GameEventType enum and GameEvent union.

---

### 47. `src/rendering/ui/dnd35e_inspector.ui.ts` (381 lines)
- **Domain:** Tier 2 UI (`D&D 3.5e: Tactical UI & Character Sheet`)
- **Current Responsibilities:** Detail inspector cards for Races, Skills, Feats, Spells with synergy trees and prerequisite trees.
- **Proposed Decomposition Strategy:**
  - `src/rendering/ui/inspector/inspector_skill_feat.ui.ts` (~200 lines): Skill synergies and Feat AST prerequisite cards.
  - `src/rendering/ui/dnd35e_inspector.ui.ts` (< 200 lines): Race and Spell detail cards.

---

### 48. `src/core/game-loop.ts` (381 lines)
- **Domain:** Tier 1 Console (`Core Console: Engine Loop`)
- **Current Responsibilities:** Animation frame RAF loop, turn scheduling, input draining, render dispatch.
- **Proposed Decomposition Strategy:**
  - `src/core/loop/scheduler_bridge.ts` (~180 lines): ROT.Scheduler integration and turn stepping.
  - `src/core/game-loop.ts` (< 210 lines): RAF rendering and loop execution.

---

### 49. `src/rendering/display.ts` (379 lines)
- **Domain:** Tier 1 Console (`Core Console: Rendering`)
- **Current Responsibilities:** Canvas resize, aspect ratio enforcement, font scaling, ROT.Display wrapper.
- **Proposed Decomposition Strategy:**
  - `src/rendering/display/display_resize.ts` (~180 lines): Viewport resize debouncing and canvas scaling.
  - `src/rendering/display.ts` (< 200 lines): ROT.Display initialization and cell rendering facade.

---

### 50. `src/actions/action.registry.ts` (371 lines)
- **Domain:** Tier 1 Console (`Core Console: Action Pipeline & Commands`)
- **Current Responsibilities:** Intent dispatch router mapping all 30+ IntentTypes to their handler systems.
- **Proposed Decomposition Strategy:**
  - `src/actions/action_handlers_core.ts` (~180 lines): Move, wait, look, inspect handlers.
  - `src/actions/action_handlers_systems.ts` (~180 lines): Combat, inventory, dialogue, debug handlers.
  - `src/actions/action.registry.ts` (< 150 lines): Central action dispatcher.
