# Project Milestones: Rogue-like

This document outlines the high-level roadmap for the project, organizing our progression from a basic moving character to a fully modular, extensible roguelike with a robust engine.

## 🟢 Milestone 1: The Foundation

Establish the strict structural and architectural patterns that the rest of the game will rely on.

- [x] Initial Vite + ROT.js + TypeScript environment setup.
- [x] Basic ECS (Entity-Component-System) structure (`createEntity`, `addComponent`, queries).
- [x] Immutable GameState definition.
- [x] Data-Driven Tile Registry (decoupling rendering/logic from map arrays).
- [x] Player rendering and basic grid movement with collision against walls.
- [x] **Implement Seeded RNG wrapper (`src/core/rng.ts`).**
- [x] **Implement Keybinds configuration (`src/constants/keybinds.constants.ts`).**
- [x] **Implement a Message Log scaffold/stub (`src/systems/message.system.ts`).**

## 🟢 Milestone 2: Map Generation & Vision

Introduce procedural generation and line-of-sight to make the world feel like a true dungeon.

- [x] Integrate `ROT.Map.Digger` for procedural dungeon generation.
- [x] Implement Map wrappers to handle rooms and corridors.
- [x] Implement `ROT.FOV.PreciseShadowcasting` for Field of View.
- [x] Update Renderer to only draw explored/visible tiles.
- [x] Implement a **static centered** Camera/Viewport system.
- [x] Implement Stairs and multiple dungeon levels (Up, Down, Ground Floor).

## 🟢 Milestone 3: The Engine, Scheduling, & Extensible Actions

Transition from simple input-driven updates to a robust turn queue with a generalized, pluggable action system.

- [x] Implement `ROT.Scheduler.Speed` and the formal Game Loop.
- [x] **Formalize the Command (intent) -> Action (validation) -> Event (result) distinction.**
- [x] Design an Extensible Action System (actions are classes/functions that return intents).
- [x] Support Contextual 'Interact' Actions and Aimed/AoE actions.
- [x] **Implement an Entity Spatial Index (fast "what is at X,Y?" lookups).**
- [x] **Implement Debug/Cheat tools (reveal map, god mode, spawn entity).**

## 🟢 Milestone 4: Entities & Combat (MVP Baseline)

Bring the dungeon to life with interactive actors and the core combat loop.

- [x] Implement the Entity Registry (Data-driven spawning).
- [x] **Define basic Entity Stat schema (HP, attack, defense).**
- [x] **Implement Bump-to-Attack collision resolution.**
- [x] Implement the Combat System (Baseline Health only for MVP, attack stats, melee damage).
- [x] Implement a basic AI System (Wandering, Hunting).
- [x] Connect combat events to the Message Log UI.
- [x] Implement Monster Death.
- [x] **Implement Player Death state flag (halt game processing).**

## 🟢 Milestone 5: Items & Inventory (Complete)

- [x] Create a data-driven Item Registry (consumables, weapons, armor)
- [x] Add ItemComponent, InventoryComponent, EquipmentComponent
- [x] Add ground items and Pick Up / Drop mechanics
- [x] Add Consumable items with targeted effects (health potions, scrolls)
- [x] Implement "Bonus at Query Time" stat calculation for Equipment slots
- [x] Render inventory UI panel for interaction

## 🟢 Milestone 6: XP & Leveling (Complete)

Transform the mechanical systems into a cohesive game experience.

- [x] XP and Leveling System for the Player.
- [x] Fully wire the HTML HUD (Health bars, XP bars, stats) to the GameState.

## 🟢 Milestone 7: Persistence & Game Flow

Implement the full lifecycle of a play session.

- [x] Implement the Initial Page (Main Menu).
- [x] Implement starting a New Game / full Game Over screens.
- [x] Implement Saving/Loading (serializing the immutable `GameState` to `localStorage`).

---

# 🚀 Phase 2: Post-MVP Expansion

Features to be added once the core MVP loop is playable and balanced.

_(Note: Premium UI Polish is treated as a continuous concern and should be integrated into every milestone rather than being its own distinct phase.)_

## 🟢 Milestone 8: Status Effects & Abilities

Add temporary, duration-based modifiers to entities, and implement the `DamageArea` effect type already stubbed in `effects.system.ts`.

- [x] Define `StatusEffectComponent` and a declarative `StatusEffectDefinition` registry (effect ID, stat modifiers, duration, per-turn damage/heal, behavior flags like `stunned`/`confused`).
- [x] Add a `status-effect.system.ts` that ticks durations each turn, applies per-turn effects (e.g., poison damage), and removes expired effects.
- [x] Integrate status effects into `getEffectiveStats()` so active buffs/debuffs modify attack, defense, maxHp, and speed dynamically.
- [x] Implement concrete damage-over-time effects: **Poison** (HP loss per turn).
- [x] Implement concrete stat-modifier effects: **Haste** (speed buff), **Weakness** (attack debuff).
- [x] Implement concrete crowd-control effects: **Stun** (skip turn), **Confusion** (randomize movement direction).
- [x] Implement the `DamageArea` item effect type in `effects.system.ts` (currently stubbed), using the existing targeting/AoE infrastructure.
- [x] Create consumable items that apply status effects (e.g., Scroll of Confusion, Potion of Haste, Venom Dagger on-hit poison).
- [x] Render active status effects on the player in the HUD sidebar (icon/label + remaining duration).
- [x] Ensure status effects serialize/deserialize correctly with the M7 save system.

## 🟢 Milestone 9: Advanced AI & Factions

Refactor the monolithic `processAITurn` into composable behavior modules and introduce a faction system that governs who attacks whom.

- [x] Define a `FactionComponent` and a Faction Hostility Matrix (data-driven lookup: faction A vs. faction B → hostile / neutral / friendly).
- [x] Refactor bump-to-attack and AI targeting to consult the hostility matrix instead of assuming "all non-player entities are enemies."
- [x] Design a composable AI Behavior interface (e.g., `AIBehaviorFn: (state, entityId) => Intent | null`) and a priority-ordered behavior pipeline.
- [x] Extract the current hunt/wander logic from `ai.system.ts` into discrete behavior modules (`hunt.behavior.ts`, `wander.behavior.ts`).
- [x] Implement **Flee** behavior (disengage when HP falls below a configurable threshold).
- [x] Implement **Ranged Attack** behavior (maintain distance, prefer ranged items/abilities).
- [x] Implement **Spell-Casting** behavior (use status-effect abilities from M8 on targets).
- [x] Define data-driven AI Profiles that compose behaviors with parameters (aggro radius, flee threshold, preferred spell list) and assign them via the Entity Registry.
- [x] Add at least two new monster templates that showcase the new AI (e.g., a ranged archer, a mage that casts confusion).

## 🟢 Milestone 10: Deep Mechanics

Layer in identification mystery, resource pressure, and environmental hazards on top of the mature combat and AI systems.

- [x] Implement an **Identification System**: unidentified items display randomized placeholder names (e.g., "Murky Potion") until identified.
- [x] Randomize unidentified names per run using the seeded RNG so that the same item type gets a consistent placeholder within a single playthrough.
- [x] Add identification methods: **Scroll of Identify**, and **identify-on-use** (using a consumable reveals its true name for future pickups).
- [x] Implement a **Hunger/Satiation System**: `HungerComponent` with a satiation counter that decrements each turn.
- [x] Define hunger thresholds (Satiated → Normal → Hungry → Starving) with gameplay consequences (starving = HP loss per turn via status effect).
- [x] Add **Food items** to the Item Registry and Loot Tables.
- [x] Implement **Interactive Terrain: Doors** (closed doors block FOV/movement; Interact opens them; monsters can bash them).
- [x] Implement **Interactive Terrain: Traps** (hidden until stepped on or detected; trigger status effects like poison or teleportation).
- [x] Add **terrain movement cost modifiers** to the Tile Registry (e.g., shallow water = 2x movement cost via speed penalty).

## 🟢 Milestone 11: Modding & Extensibility (Data-Driven Engine)

Extract all hardcoded registries and tables into external data files, and build the loading/validation pipeline.

- [x] Design a **Campaign Manifest** JSON schema (campaign name, starting stats, floor generation parameters, which data files to load).
- [x] Extract the **Entity Registry** (monster/NPC prefabs) from TypeScript constants to loadable `.json` files.
- [x] Extract **Spawn Tables & Loot Tables** from TypeScript constants to `.json` files.
- [x] Extract **Item Registry & Effect Definitions** to `.json` files.
- [x] Extract **Status Effect Definitions** to `.json` files.
- [x] Extract **AI Profiles & Faction Hostility Matrix** to `.json` files.
- [x] Extract **Tile Registry & Terrain Properties** to `.json` files.
- [x] Implement a robust **Loader & Validation** pipeline that fetches, parses, and validates all data files at game start (with clear error messages for malformed data).
- [x] Add **Theme & Tileset** support: custom ASCII glyph mappings, color palettes, and message log templates selectable per campaign.
- [x] Implement a **Campaign Selection** screen on the Main Menu that lists available campaigns from loaded manifests.

## 🟢 Milestone 12: RTwP (Real-Time with Pause) Engine Toggle (Complete)

Re-use the pure systems architecture to support an optional real-time mode alongside the existing turn-based mode.

- [x] **Phase 1: Architectural Foundation**: Refactor Intent results to explicitly return `{ state, success }` to eliminate 0-energy inference, and decouple hardcoded terrain/trigger logic (doors, traps) into data-driven definitions.
- [x] Implement a **real-time game loop** using `requestAnimationFrame` that continuously advances entity turns based on elapsed time and speed.
- [x] Add a **Pause state** that freezes the real-time loop while allowing UI interaction (inventory, menus).
- [x] Implement **Command Queuing** so the player can issue orders while paused, which execute when unpaused.
- [x] Add an **Engine Mode Toggle** (turn-based vs. RTwP) accessible from settings or the Main Menu.
- [x] Add **UI controls** for RTwP: pause/unpause button, speed controls (1x, 2x, 4x), and visual indicators of the current mode.

## 🟢 Milestone 13: UI Architecture & UX Polish (Complete)

Overhaul the user interface to support robust UX models and dynamic layouts based on modern roguelike UI research.

- [x] Create a **3-column layout** instead of 2 to support more UI panels.
- [x] Expand the game to use the **browser's full viewport** instead of a constrained subset.
- [x] Migrate persistent inventory to a **Floating Semi-Modal Overlay** for better scalability.
- [x] Add a dedicated **Equipment panel** separate from the inventory.
- [x] Implement **View Controls** (Rotate 45° and 3D Tilt) to dynamically change the canvas perspective.
- [x] Implement **World-Space Feedback** (floating combat text, danger telegraphs, hit animations) to supplement the message log.
- [x] Build a **Tooltip / Inspect Architecture** (nested hover inspects for stats, status effects, and map entities) to explain rules in-context.
- [x] Implement **Accessibility as a Core System** (UI/Font scaling, contrast modes, disable animations).
- [x] Build an **Input Rebinding Menu** to customize keyboard controls.
- [x] Update the new game flow to include the campaign selection screen.

---

# 🚀 Phase 3: Deep Narrative & Advanced Systems

Transitioning from a flat simulation into a world with causal narrative depth, supported by highly scalable architecture.

## 🟢 Milestone 14: Stabilization & Polish

Ensure the foundation is rock-solid and balanced before introducing massive systemic complexity.

- [x] **Audit Combat Math**: Normalize HP, damage scaling, and status effect scaling to ensure mid-to-late game viability.
- [x] **RTwP Robustness**: Implement strict error boundaries and fallback states in the Real-Time loop to prevent silent soft-locks during complex interactions.
- [x] **UI Edge Cases**: Refine floating combat text, tooltips, and log grouping to gracefully handle dozens of simultaneous events (e.g., AoE explosions).

## 🟢 Milestone 15: Core Architecture (Commands & Tags)

Low-risk, high-reward refactoring to support combinatorial depth.

- [x] **The Command Pattern**: Define a formal `Action` interface (e.g., `execute(state, entityId): ActionResult`). Crucially, Actions must emit structured `Events` to form a unified event ledger.
- [x] **Migrate Intents**: Refactor `applyIntentWithCost` and the massive `switch` statement into discrete, self-contained Action objects (e.g., `WalkAction`, `AttackAction`).
- [x] **Tags Component**: Add a `TagsComponent` to entities and `AreaTags` to maps for semantic descriptors (e.g., `["undead", "fire_aligned"]`, `["forest", "surface"]`).
- [x] **Traits Component**: Add a `TraitsComponent` for mechanical modifiers (e.g., `Regeneration`, `Fragile`).
- [x] **System Integration**: Update `getEffectiveStats()` and AI behaviors to dynamically query Traits and Tags instead of hardcoded component checks.

## 🟢 Milestone 16: World Interconnectivity & Biomes (Complete)

Move away from a strict vertical dungeon descent into an interconnected "overworld" of distinct zones.

- [x] **Area Data Model**: Rename internal concepts of "Floor" and "Level" to "Area" or "Zone" within the `GameState`.
- [x] **Biome Generators**: Update Map Generation to select `ROT.Map` algorithms dynamically based on Area tags (e.g., `Cellular` for wild/forests, `BSP` for urban/villages).
- [x] **Contextual Spawns**: Modify `spawnWeights` to filter the global entity/item pools by the Area's semantic tags.
- [x] **Lateral Transitions**: Add `EdgeTransitionComponent` and `PortalComponent` to handle walking off the map or entering buildings.
- [x] **Entity Migration**: Extend the existing stair-transition `migratingEntities` logic to seamlessly move the player's party through these new lateral portals.
- [x] **Static Hubs**: Add support for parsing purely static map definitions (e.g., a hand-crafted starting tavern) that seamlessly connect to procedural zones.

## 🟢 Milestone 17: Persistent Entities & Relationships (Complete)

The missing prerequisite for procedural narrative: entities that exist and act outside the player's immediate vicinity.

- [x] **Global Persistence**: Extract unique/named NPCs into a global `PersistentEntities` map on `GameState` that survives regardless of the active floor.
- [x] **Sleep/Wake Pipeline**: Build logic that syncs persistent NPCs into the active ECS arrays when the player enters their Area, and packages them back out when the player leaves.
- [x] **Memory Component**: Allow NPCs to track a history of interactions, grudges, and faction alignments.
- [x] **Faction Standing UI**: Build a player-facing interface to track reputation and standing with various global factions.

## 🟢 Milestone 18: Component-Driven Combat Pipeline (Complete)

**Goal:** Transition combat resolution from a monolithic intent handler to a true ECS pipeline, setting the stage for AoE, DoTs, and environmental hazards.

- [x] **Damage Components:** Introduce `DamageComponent` to represent incoming damage events.
- [x] **Damage System:** Build `damage.system.ts` to process `DamageComponents`, reducing HP, applying on-hit effects, and emitting floating text.
- [x] **Death System:** Build `death.system.ts` to handle entities that reach 0 HP (XP distribution, drops, removal) independently of what killed them.
- [x] **Refactor Combat Logic:** Update `processMeleeAttackIntent` to simply calculate initial attack vs defense and attach a `DamageComponent`, delegating the rest to the pipeline.

## 🟢 Milestone 19: The Social Layer (Complete)

**Goal:** Introduce dialogue, quests, and rich interaction menus.

- [x] **Conversation UI**: Build an interactive, branching dialogue modal for speaking with friendly or neutral NPCs.
- [x] **Memory-Driven Dialogue**: Connect the dialogue system to the `MemoryComponent`, allowing NPCs to alter their responses based on past interactions, faction standing, or grudges.
- [x] **Declarative Quests**: Implement logic for friendly NPCs to assign missions (e.g., retrieve item, slay monster) directly to the player using JSON-defined quests.
- [x] **Quest Journal UI**: Build a dedicated interface panel for the player to track active, failed, and completed quests.
- [x] **In-Context Wiki / Encyclopedia**: Implement nested hover-to-explain tooltips for highlighted keywords (Entities, Items, Status Effects) directly within the dialogue and quest UIs.
- [x] **Procedural Quests**: Implement a dynamic quest generator that builds randomized missions at runtime from JSON templates (e.g., bounties), storing them in the GameState.
- [x] **Quest OR-Gates:** Extend `QuestSchema` with `logicalOperator: 'AND' | 'OR'` to allow quests to be completed by fulfilling any single objective in an array.
- [x] **Dialogue Data Router:** Extend the Zod schemas in `campaign.types.ts` to support `DialogueCondition` and `DialogueEffect` discriminated unions.
- [x] **Dynamic Intent Pipeline:** Update `intent.system.ts` to catch a new `InteractIntent`, read the target's `DialogueComponent`, evaluate conditions against the `GameState`, and trigger standard UI routing or effects.
- [x] **Dynamic Hostility (Attitudes):** Replace hardcoded hostility checks in `ai.system.ts` with an `AttitudeComponent` that can change dynamically based on actions, enabling foes to become neutral or friendly.

## 🟢 Milestone 20: The Adversarial Layer (Schemes & Investigation) (Complete)

Introduce systemic villains that act against the player, pairing the background simulation tightly with the investigation UI.

- [x] **Scheme & Mission Data**: Define the JSON schemas for Villain Schemes, intermediary Agreements, and Missions.
- [x] **Unique Token Pools**: Implement the "Bag/Deck" pattern to enforce global spawning limits so unique villains or key items cannot be duplicated.
- [x] **Scheme Simulator**: Build the background system that hooks directly into the `ROT.Scheduler.Speed` (decoupled from player input) to advance villain goals and dispatch missions across Areas.
- [x] **Clue Generation**: Mechanically drop physical evidence or generate witness memories whenever a mission executes (emitting structured `ClueEvents`).
- [x] **Investigation Board UI**: Build a "conspiracy board" UI engineered as a filtered view of the global _Event Ledger_, allowing the player to naturally review discovered clues and expose active schemes.

---

# 🚀 Phase 4: Campaign Creator & Modular Tooling (Refined)

Features to allow building, testing, and sharing campaigns using structured JSON data and custom map configurations.

## 🟢 Milestone 21: Editor Foundation & Database Forms (Complete)

**Goal:** Create the basic workspace shell, modular form templates, and simple string/number fields for JSON data editing, with direct local workspace interaction.

- [x] **Developer Workspace Toggle & Routing**
  - Add a "Dev Tools" action button on the Main Menu screen.
  - Setup screen switching between the main game state and the editor workspace state in [src/main.ts](src/main.ts) and [src/core/game-loop.ts](src/core/game-loop.ts).
  - Ensure entering the editor halts active schedulers, hides the main game canvas, and opens the editor layout.
- [x] **Top-Level Editor Workspace & Dependency Graph Guard**
  - Create a dedicated [src/editor/](src/editor/) directory at the top of the dependency graph (peer to `main.ts`).
  - Implement the controller logic in [src/editor/campaign_editor.ts](src/editor/campaign_editor.ts) and loading service in [src/editor/workspace_file_service.ts](src/editor/workspace_file_service.ts) using the browser's `showDirectoryPicker()` API.
  - Keep [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts) as a pure rendering/view module that only imports downward (from `types`, `constants`, `utils`) and communicates with the editor controller via upward event/command dispatching.
- [x] **Dual Import/Export Fallback**
  - Integrate a fallback drag-and-drop `.zip` reader/writer in [src/editor/workspace_file_service.ts](src/editor/workspace_file_service.ts) for browsers that do not support directory pickers.
  - Allow compiling all edited registries into a single ZIP archive for distribution.
- [x] **⭐ Undo/Redo + Change History (JSON Patch)**
  - Implement an editor command stack in [src/editor/campaign_editor.ts](src/editor/campaign_editor.ts) over the in-memory campaign document using **JSON Patch (RFC 6902) deltas** rather than full-state snapshots, so history is cheap and memory-stable.
  - Bind `Ctrl+Z` / `Ctrl+Shift+Z` to undo/redo changes in forms.
  - _RNG Note:_ This stack tracks editor changes only. We document that gameplay turn-rewinds require RNG checkpointing due to state-counter dependencies in [src/core/rng.ts](src/core/rng.ts).
- [x] **⭐ Fast Iteration & "Round-Trip" Goal**
  - Establish a fast-path re-injection of the in-memory doc to the campaign loader [src/core/loader.ts](src/core/loader.ts) to avoid full page reload on playtest.
  - Track iteration speeds in the developer toolbar.
- [x] **Scaffolding Selector (New Campaign Wizard)**
  - Create a startup editor wizard screen in [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts).
  - **Clone Template Option:** Clone the existing `default` campaign templates as a starting point.
  - **Blank Slate Option:** Initialize empty arrays and raw baseline files for an adventure built from scratch.
  - **Example Campaign:** Ship a small, annotated reference campaign to teach designers how templates connect.
- [x] **Modular DOM Database Editor Components**
  - Design a modular CSS layout in [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts): Left sidebar list and Right editing pane.
  - Build granular, reusable DOM field elements in Vanilla TS: `StringField`, `NumberField`, `ColorPickerField`, `ListField`, and `NestedRecordField`.
  - **⭐ Zod-Driven Form Generation:** Refactor the editor renderer to recursively parse Zod schema definitions (`ZodObject`, `ZodOptional`, `ZodArray`, etc.) so that all possible fields are presented to the user, even on newly created empty objects.
  - **⭐ `ReferenceField` / Autocomplete Pickers:** Fields referencing IDs (e.g. entities to factions, items to effects) render as searchable dropdowns rather than raw text to prevent link errors, reading live tables in [src/types/campaign.types.ts](src/types/campaign.types.ts).
- [x] **Zod Schema Compiler & Link Auditor**
  - Hook Zod's `safeParse` to validate fields on input change, showing validation errors inline based on Zod types in [src/types/campaign.types.ts](src/types/campaign.types.ts).
  - Implement a **Campaign Auditor** utility in [src/editor/campaign_editor.ts](src/editor/campaign_editor.ts) to audit cross-registry links.
  - Display error counts in the dev toolbar; block Playtest and Export when unresolved Zod errors exist.
- [x] **Live Playtest Mode**
  - Add a "Play Test" button that serializes the campaign, injects it into memory in [src/core/loader.ts](src/core/loader.ts), clears active save files in [src/core/save.ts](src/core/save.ts), and runs the game.
  - **⭐ "Return to Editor" Re-entry:** Preserve the editor document state across playtest detours in [src/main.ts](src/main.ts) so authors return to the exact object they were editing.

## 🟢 Milestone 22: The Trigger System (Events → Conditions → Consequences) ⭐ KEYSTONE

Promote scattered condition/action primitives into a single, unified, event-reactive trigger engine.

- [x] **Generalize the Event Surface**
  - Audit and expand the existing `GameEventType` enum and event ledger in [src/types/events.types.ts](src/types/events.types.ts); ensure all state changes publish uniformly in [src/core/game-loop.ts](src/core/game-loop.ts).
- [x] **Declarative Trigger Schema**
  - Define Zod `TriggerDefinition` `{ id, event, conditions[], consequences[] }` serializable to JSON in [src/types/trigger.types.ts](src/types/trigger.types.ts).
  - **Conditions:** Composable predicates (e.g., `entityHasTag`, `factionStandingBetween`, `hasMemoryFact`).
  - **Consequences:** Extensible effect types (e.g., `modify_standing`, `complete_quest`, `spawn_entity`, `emit_clue`).
- [x] **Trigger Routing via Buckets**
  - Refactor [src/systems/trigger.system.ts](src/systems/trigger.system.ts) to index triggers by event type (`event → triggers`) on campaign load for fast O(1) matching during game ticks, replacing old local checks.
- [x] **Authoring UI: The Trigger Card Builder**
  - Create the trigger-card composer interface in [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts) of `WHEN [event] IF [conditions...] THEN [consequences...]` using reference dropdowns.
- [x] **⭐ Power-User Scripting Hatch**
  - **Phase A:** Ship declarative core triggers first.
  - **Phase B:** Add a sandboxed `run_script` consequence in [src/systems/trigger.system.ts](src/systems/trigger.system.ts) that evaluates event/state context as a pure function and returns new declarative consequences (maintaining determinism and serialization).
- [x] **⭐ De-risked Trigger Migration Loop**
  - **Phase 1 Clue Migration:** Port clue drops inside [src/systems/investigation.system.ts](src/systems/investigation.system.ts) to triggers first to test the engine with low blast radius.
  - **Phase 2 Validator Helper:** Implement a basic headless state-diffing runner in `src/editor/campaign_validator.ts` early to assert the default campaign generates identical gameplay logs before and after refactoring.
  - **Phase 3 Narrative Migrations:** Port heavy NPC dialogues and quest events to triggers once diff-testing passes.

## 🟢 Milestone 23: Narrative Architect (Dialogue, Quests & Flow)

Construct narrative structures and test conditional triggers in-editor on top of the Trigger System.

- [x] **Conversation Editor (Tree-First, Scope-Protected)**
  - Build a folder-style nested branching list dialogue editor in [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts), modifying dialogue schemas in [src/types/dialogue.types.ts](src/types/dialogue.types.ts).
- [x] **Dialogue Triggers**
  - Refactor options in [src/rendering/ui/dialogue.ui.ts](src/rendering/ui/dialogue.ui.ts) to gate choices and trigger node consequences directly using the Milestone 22 condition/consequence pickers, removing legacy action structures.
- [x] **Quest Sequence Designer**
  - Drag-and-drop quest stages, configuring objective parameters and journal logs mapped to schemas in [src/types/quests.types.ts](src/types/quests.types.ts).
- [x] **Quest-Trigger Integration**
  - Update quest state tracking in [src/systems/quest.system.ts](src/systems/quest.system.ts) so quest stage changes publish events; triggers can easily hook into them (e.g. spawning a boss when quest stage reaches X).
- [x] **Emergent Dialogue Gating Simulator (State Injector)**
  - Integrate an editor sidebar panel in [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts) to mock player memory fact logs and standings from `MemoryComponent` in [src/types/components.types.ts](src/types/components.types.ts), highlighting visible dialogue branches.

## 🟢 Milestone 24: World & Area Builder (Complete)

Provide visual environment design and portal networking.

- [x] **Visual Grid Painter**
  - Setup a tile painter canvas in [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts) utilizing `ROT.Display` or custom Canvas elements, painting tiles mapped to [src/types/game-state.types.ts](src/types/game-state.types.ts) (`Tile` and `GameMap`) and properties in [src/types/campaign.types.ts](src/types/campaign.types.ts) (`TileDefinitionSchema`).
  - Integrate undo/redo command stack patches with paint brush actions.
- [x] **Dynamic Spawner & Portal Markers**
  - Paint procedural spawner nodes and configure portal connections in [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts), mapping them to `PortalComponent` in [src/types/components.types.ts](src/types/components.types.ts).
  - Modify [src/systems/map.system.ts](src/systems/map.system.ts) to parse dynamic spawners on level load/wakeup.
- [x] **Area Graph Editor**
  - A link node layout of `areas.json` in [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts) showing overworld topology and transition connectivity based on `areas` structures in [src/types/campaign.types.ts](src/types/campaign.types.ts).
- [x] **Live Generator Sandbox**
  - Real-time preview of cellular/digger parameters inside [src/rendering/editor_ui.ts](src/rendering/editor_ui.ts) by invoking [src/map/generator.ts](src/map/generator.ts) with seed rerolling and exit pathfinding reachability checks.

## 🟢 Milestone 25: Simulation Lab & Campaign Validator

Real-time simulation testing and campaign-wide sanity check validations.

- [x] **⭐ Campaign Smoke-Test / Validator**
  - Build out the final automated asynchronous checker in [src/editor/campaign_validator.ts](src/editor/campaign_validator.ts): starting area reachability, complete path graph solvability, quest parameter sanity, and trigger loop/recursion traps. Block exports on major validation failures and show a loading state in the UI.
- [x] **Observability Overlays**
  - Connect debug logs and trigger tracer panels in [src/rendering/ui/debug.ui.ts](src/rendering/ui/debug.ui.ts) to visualize events and system state. Required to effectively debug upcoming simulations.
- [x] **Emergent AI Arena**
  - Spawn selected actor templates in a headless sandbox environment. Extract and reuse existing engine logic by stepping through [src/systems/ai.system.ts](src/systems/ai.system.ts) and [src/systems/damage.system.ts](src/systems/damage.system.ts) to output clean text logs for debugging AI math and behaviors without duplicating game logic.
- [x] **Scheme Acceleration Simulator**
  - Run background mastermind villain schemes in [src/systems/scheme.system.ts](src/systems/scheme.system.ts) in a fast-forward loop, verifying clue compilation on the Investigation Board UI in [src/rendering/ui/investigation.ui.ts](src/rendering/ui/investigation.ui.ts).

## 🟢 Milestone 26: Visual Editor Enhancements (Drag-and-Drop & Previews)

Enhance the Developer Tools to feel like a modern visual game engine rather than just a smart forms editor.

- [x] **Targeted DOM Updates (Cursor Loss Fix):** Refactor the editor controller and renderer to use differential updates instead of full-tree re-renders on keystrokes, which is a strict prerequisite for drag-and-drop.
- [x] **Sidebar Search & Filtering:** Add a search bar to the middle pane to easily locate specific entities or items in massive campaigns.
- [x] **Unsaved Changes Protection:** Add a `beforeunload` event listener to warn users of unsaved changes before closing the tab.
- [x] **Dialogue Tree Editor:** Built a specialized nested-list editor for dialogue nodes and options instead of using the generic JSON form.
- [x] **World Area Graph:** Built a topology node-link graph view to visualize Area portal connections.
- [x] **Faction Matrix Data-Grid:** Replace the generic nested Zod object form for faction hostility with a 2D interactive grid UI.
- [x] **Visual Glyph & Color Previews:** Update the editor panel to render the literal ASCII glyph in its defined color when editing entities and tiles.
- [x] **Drag-and-Drop Form Elements:** Upgrade the Zod-driven arrays and lists in `src/rendering/ui/zod_form_renderer.ts` to support drag-and-drop reordering.
- [x] **Drag-and-Drop Linking:** Implement dragging an Item from the sidebar into a Monster's loot table.
- [x] **Live Map Previews:** Add an inset Canvas view when editing an Area or Map Template to instantly visualize what the procedural generation parameters or static map layout will look like.

## 🟢 Milestone 27: Engine Data Structures & Render Optimizations

Transition the ECS internal data structures from arrays to constant-time dictionaries and optimize the per-frame render loop.

- [x] **O(1) Component Access:** Refactor `GameState.components` from `ReadonlyArray<Component>` to an `O(1)` dictionary `Readonly<Record<string, Component>>` keyed by `ComponentType`.
- [x] **Array Loop Elimination:** Remove expensive `.filter` and `.find` operations across the codebase by adopting the new `getComponent`, `addComponent`, and `removeComponent` architecture.
- [x] **FOV Caching:** Decouple FOV `PreciseShadowcasting` math from the active render loop. Recompute FOV only when a new `fovNeedsUpdate` flag is tripped by a system (like moving or opening a door).
- [x] **O(1) Spatial Rendering:** Eliminate the global `queryEntities` rendering loop. Instead, iterate exactly over the camera viewport bounds, retrieving standing entities via `state.spatialIndex` to ensure the render layer scales perfectly regardless of the total number of entities in the dungeon.

## 🟢 Milestone 28: Campaign Packaging & Standalone Distribution

Implement packaging structure and install operations for modular campaigns.

- [x] **Campaign Manifest & Versioning**
  - Edit metadata block (name, version, author, description, tags) and enforce strict schema versioning checks in [src/core/loader.ts](src/core/loader.ts).
- [x] **IndexedDB Workspace Storage**
  - Migrate the Campaign Editor's active workspaces to use IndexedDB, entirely replacing the experimental File System Access API (`showDirectoryPicker`). This ensures the editor works seamlessly on all modern browsers. Maintain "Export/Import ZIP" for sharing campaigns.
- [x] **⭐ Standalone Baked Campaigns (No Load Order)**
  - Implement package cloning in [src/editor/campaign_editor.ts](src/editor/campaign_editor.ts) to duplicate all asset dependencies directly on campaign creation, making campaigns completely self-contained.
- [x] **One-Click Install / Import**
  - Add an "Install Campaign" (.zip) drag-and-drop or file picker to the main menu.
  - Use `JSZip` to extract the uploaded JSON files in-memory, validate them against our Zod schemas, and persist the extracted campaign object directly into a new IndexedDB `installed_campaigns` store.
- [x] **The Hybrid Campaign Loader**
  - Refactor `loadCampaignRegistry()` in [src/core/loader.ts](src/core/loader.ts) to query both the hardcoded `public/` directory AND the IndexedDB `installed_campaigns` store, merging them into a single list for the Campaign Select UI.
  - Refactor `loadCampaign(id)` to attempt loading the requested ID from IndexedDB first. If not found, gracefully fall back to the `public/` folder `fetch()`. This completely removes the need for manual file transfers or backend servers.

---

# 🚀 Phase 5: Interaction Combinatorics & Roguelike Depth

**Goal:** Close the classic roguelike interaction-depth gap by adding more verbs, more target surfaces, and persistent world-state modifications — without hardcoding item-specific special cases. This phase should produce the “70% NetHack/Qud feel” through tag-based combinatorics, strong observability, and designer-authorable reactions.

## 🟢 Milestone 29: Unified Apply Intent & Verb Vocabulary ⭐ KEYSTONE

Unify bespoke item-use, terrain interaction, and aimed interaction plumbing behind one canonical verb/tool/target pipeline.

- [x] Define `ApplyIntent` in `src/types/intents/interaction.intents.ts` with `actorId`, `verb`, optional `toolEntityId`, and a target union covering self, entity, item, and tile targets.
- [x] Add `IntentType.Apply` to `src/types/intents/intent.enum.ts` and route it through `src/actions/action.registry.ts` without adding a new monolithic switch/router to the core game loop.
- [x] Keep existing `UseItemIntent`, `InteractIntent`, and targeting flows as temporary compatibility wrappers/adapters in `src/core/game-loop.ts` until migration is complete.
- [x] Define an initial deterministic verb set in a new constants file (e.g., `src/constants/verbs.constants.ts`): `apply`, `throw`, `kick`, `open`, `close`, `lock`, `unlock`, `dip`, `zap`, `ignite`, `read`, and `eat`.
- [x] Emit structured `ApplyResolvedEvent` and `ApplyFailedEvent` in `src/types/events.types.ts` so interactions are visible to the event ledger, triggers, debugging, and editor tests.
- [x] Ensure all Apply outcomes return explicit `{ state, success }` and deterministic energy costs to `src/core/game-loop.ts`, preserving RTwP compatibility.

## 🟢 Milestone 30: Reaction System 2.0 — Verb + Source/Target Matchers

Upgrade the existing tag-based reaction system into the primary combinatorial interaction engine.

- [x] Extend `ReactionDefinitionSchema` in `src/types/campaign.types.ts` with `verb`, `sourceMatcher`, `targetMatcher`, optional `contextMatcher`, `priority`, and declarative `consequences`.
- [x] Update `src/systems/reaction.system.ts` to allow matchers to check tags, traits (`src/types/components.types.ts`), item categories, tile tags, field types, and faction/memory context.
- [x] Validate all tag references in `ReactionDefinitionSchema` against the campaign `tagRegistry` at load time in `src/core/loader.ts`.
- [x] Implement deterministic tie-breaking in `processReactions()`: higher priority first, then stable ID ordering.
- [x] Add explicit ambiguity handling for conflicting reactions, including editor warnings in `src/editor/campaign_validator.ts` for same-priority overlaps.
- [x] Emit `ReactionResolvedEvent { reactionId, verb, sourceId, target, whyMatched }` from `src/systems/reaction.system.ts` for observability.
- [x] Add a Reaction Trace panel to `src/rendering/ui/debug.ui.ts` and the Simulation Lab so designers can see exactly why a reaction did or did not fire.
- [x] Migrate existing legacy reactions in `public/campaigns/default/data/` to the new schema.
- [x] **Migrate legacy `UseItemIntent` and `InteractIntent` entirely over to the `ApplyIntent` pipeline, removing the old wrappers from `action.registry.ts`.**
- [x] **Environmental Tile-Based Reactions:** Extend `ReactionTargetMatcherSchema` to accept `targetType: 'tile'` and update `reaction.system.ts` to fetch and react against tile definition tags from `tiles.json`.

## 🟢 Milestone 31: Throwing, Projectiles & On-Impact Consequences

Implement the highest-ROI roguelike verb: throwing items and resolving their impact through the targeting/reaction pipeline.

- [x] Implement `throw` as an Apply verb reusing the existing targeting crosshair and line-trace infrastructure from `src/actions/targeting.actions.ts`.
- [x] Add deterministic projectile resolution in a new `src/systems/projectile.system.ts` or within the targeting system: range, blocked tiles, hit entities, miss scatter, item weight, and stack quantity handling.
- [x] Support on-impact consequences through `src/systems/reaction.system.ts`: shatter, explode, spill field, apply status, create noise, break item, or land on the floor.
- [x] Add core throwable content to the JSON registries: rocks, throwing knives, throwable potions, bombs/flasks, and nets.
- [x] Allow selected AI profiles (`src/ai/`) to throw items when they have line of sight and appropriate inventory/tools.
- [x] Render projectile travel and impact with floating text / transient visual effects in `src/rendering/renderer.ts`.
- [x] Add validator tests in `src/editor/campaign_validator.ts` ensuring thrown unique/key items cannot be silently destroyed unless explicitly allowed.

## 🟢 Milestone 32: Containers, Locks & Forceful Access Problems (Complete)

Turn doors, chests, and storage objects into procedural tactical/loot/access challenges.

- [x] Add `ContainerComponent` or extend `InventoryComponent` semantics in `src/types/components.types.ts` so chest entities can hold item entity IDs safely.
- [x] Add `LockComponent { difficulty, keyTag?, locked, jammed?, breakable? }` to `src/types/components.types.ts` for doors, chests, cages, and special containers.
- [x] Implement `open`, `close`, `lock`, `unlock`, and `kick` as Apply verbs resolved by reactions and the existing `InteractableComponent`.
- [x] Add lockpick/key workflows using tag matching (`src/systems/reaction.system.ts`) rather than specific item IDs.
- [x] Support force-open attempts with noise emission, break chance, tool damage, and possible faction/reputation consequences.
- [x] Support trap-on-open behavior via the existing Trigger System (`src/systems/trigger.system.ts`) instead of bespoke chest logic.
- [x] Build a container UI panel in `src/rendering/ui/container.ui.ts` for viewing/taking items from opened containers.
- [x] Add editor support in `src/rendering/editor_ui.ts` for container inventory, lock difficulty, key tags, and trap-trigger references.
- [x] Extend the Campaign Validator (`src/editor/campaign_validator.ts`) to flag critical quest items placed behind inaccessible locks.
- [x] **Static Chest Inventories:** Update `map.system.ts` to allow the `placedEntities` array in `areas.json` to define an optional `inventory` array, overriding random loot generation for specific quest/boss chests.

## 🟢 Milestone 33: Fields & Lightweight Substance Simulation (Complete)

Represent persistent environmental effects as entities rather than building a full fluid simulation.

- [x] Define `FieldComponent { fieldType, intensity, duration, spreadRuleId }` in `src/types/components.types.ts` and a data-driven `FieldDefinitionSchema` in `src/types/campaign.types.ts`.
- [x] Build `src/systems/field.system.ts` to tick duration, decay intensity, process deterministic spread, and apply effects to occupants.
- [x] Ship an initial field set in the default campaign data: `fire`, `smoke`, and `poison_gas`.
- [x] Integrate fields with FOV (`src/map/fov.ts`), movement (`src/systems/movement.system.ts`), damage (`src/systems/damage.system.ts`), status effects, and `src/rendering/renderer.ts`.
- [x] Allow reactions between fields, items, and terrain via `src/systems/reaction.system.ts`: fire ignites flammable tags, smoke blocks sight, poison gas applies poison, water extinguishes fire.
- [x] Ensure fields serialize correctly across saves, area sleep/wake (`src/core/save.ts`), and inactive area storage.
- [x] Add debug overlay rendering in `src/rendering/ui/debug.ui.ts` for field type, intensity, duration, and spread decisions.

## 🟢 Milestone 34: Dip/Coat, Wands/Zaps, Fountains & Altars

Add the first compact content pack that proves the unified Apply + Reaction architecture creates combinatorial depth.

- [x] Implement `dip` reactions in `src/systems/reaction.system.ts` for item-to-item and item-to-terrain interactions.
- [x] Support temporary item coatings such as poisoned blades or coated arrows with finite on-hit charges, updating `getEffectiveStats` or weapon hit resolution.
- [x] Implement `zap` delivery modes for wands in targeting logic: beam, bolt, cone, and simple bounce/reflection where tractable.
- [x] Add terrain-as-content entities: fountains, altars, shrines, and sacrificial surfaces utilizing `InteractableComponent` + semantic tags.
- [x] Create reaction examples in `public/campaigns/default/data/reactions.json`: dip weapon in poison, dip item in fountain, ignite oil/fire tags, sacrifice corpse at altar, zap wand at entity/tile.
- [x] Add campaign data examples and editor presets in `src/rendering/editor_ui.ts` so designers can clone working interaction templates.
- [x] Surface all hidden consequences through messages (`src/systems/message.system.ts`), clues, tooltips, or Reaction Trace entries.

## 🟢 Milestone 35: Action Discovery, Verb Menu & Interaction UX

Make the expanded interaction vocabulary discoverable instead of requiring players to memorize every verb.

- [x] Add a “smart apply” default action in input handling that chooses the highest-confidence valid verb while still allowing manual override.
- [x] Use a dry-run validation path in `src/actions/action.registry.ts` to show why an action is valid or invalid without mutating the `GameState`.
- [x] Add tooltip explanations in `src/rendering/ui/tooltip.ui.ts` for tool tags, target tags, reaction previews, lock difficulty, and field hazards.
- [x] Extend key rebinding in `src/constants/keybinds.constants.ts` for new verbs and preserve accessibility settings.
- [x] Add a tutorial/example campaign segment demonstrating throw, unlock, kick, dip, zap, and field reactions.
- [x] Add tracking of the player's overall investigation progress directly to `InvestigationKnowledge`.
- [x] Create an `InvestigationStalledEvent` that emits when the player hasn't uncovered any scheme clue for `500` turns.
- [x] Ensure the existing Trigger System can intercept this event and author a fallback consequence (like spawning a frightened witness).

## 🟢 Milestone 35.5: Sprite Rendering Engine (Complete)

Introduce graphical tile support as a drop-in alternative to the traditional ASCII rendering.

- [x] **Tile-based Layout Backend**: Refactor the display factory (`src/rendering/display.ts`) to initialize `ROT.Display` with a `layout: 'tile'` backend when a campaign theme includes `spriteSheets`.
- [x] **Dynamic Atlas Composition**: Build an async sprite loader that combines multiple spritesheets into a single `<canvas>` atlas at runtime, calculating offset coordinates for seamless multi-spritesheet support.
- [x] **Multi-Tile Stacking**: Implement `drawCell` logic to layer multiple sprites per tile (e.g., drawing a monster over an item over a floor tile) to preserve ECS spatial integrity visually.
- [x] **Fog-of-War Visuals**: Add a dedicated overlay `<canvas>` for rendering transparent shadows over out-of-sight tiles in sprite mode, ensuring lighting works cleanly on graphical tiles.
- [x] **Editor Integration**: Update the Campaign Editor's static Map Painter and dynamic Generator Sandbox to seamlessly preview sprite layouts when the campaign is configured for it.
- [x] **Strict Typings & Fallbacks**: Provide full fallback to ASCII mode if sprites fail to load, and ensure strict `undefined` object/array checking across rendering methods.

---

# 🚀 Phase 6: Encounter Director & Tactical Procedural Generation

**Goal:** Replace flat spawn-table population with an algorithmic “Game Master” that spends area budgets across tactical axes: objective, advantages, hazards, and chaos. This phase turns procedural rooms into authored-feeling combat puzzles.

## 🟢 Milestone 36: Area Budgets, Spawn Roles & Director Schemas (Complete) ⭐ KEYSTONE

Add the data model the Encounter Director needs to reason about difficulty and encounter composition.

- [x] Extend `AreaDefinitionSchema` with `crBudget`, `encounterProfileId`, optional `directorTags`, and budget scaling by depth/difficulty.
- [x] Extend entity templates with `crCost`, role tags, encounter tags, and optional director hints.
- [x] Define spawn pools that filter by area tags, biome tags, faction tags, role tags, and global token-pool availability.
- [x] Define data for encounter ingredients: objectives/proteins, optimizers/appetizers, hazards/sides, chaos/desserts.
- [x] Add dynamic trait/template costs, such as `elite`, `volatile`, `fiendish`, `armored`, or `cowardly`.
- [x] Validate all costs and role tags in the Campaign Validator.
- [x] Add editor fields and tooltips for budgets, role tags, spawn pools, and dynamic templates.

## 🟢 Milestone 37: Encounter Director Core — Protein/Appetizer/Sides/Dessert

Implement the budget-spending algorithm inside area/room population.

- [x] Hook the Encounter Director into `src/map/generator.ts` after terrain generation and before final entity placement.
- [x] Split encounter budget across tactical axes: main objective, player advantages, environmental hazards, and chaotic disruptors.
- [x] Generate an explicit Director Receipt recording budget inputs, selected ingredients, rejected candidates, and final cost.
- [x] Support both room-local encounters and area-wide encounter plans.
- [x] Allow static areas to opt out or to use hand-authored director markers.
- [x] Preserve strict seed determinism for all selection and placement decisions.

## 🟢 Milestone 38: Dynamic Templates, Sub-Biomes & Token Pools

Make procedural generation adaptive without losing designer control.

- [x] Implement dynamic trait/template application as budget padding for under-cost encounters.
- [x] Add sub-biome generation: rooms can acquire tags such as `spider_nest`, `corrupted`, `flooded`, `burned`, or `shrine_vault`.
- [x] Filter enemy, item, field, and hazard candidates by combined area + sub-biome tags.
- [x] Integrate existing token-pool/bag rules so uniques, elites, and extinctable populations obey global limits.
- [x] Support contextual loot generation based on encounter tags and defeated actors (death system drops + appetizer axis).
- [x] Add optional "bones-like" persistent remains/content hooks for future dead-adventurer or previous-run artifacts.
- [x] Add regression tests proving unique actors/items cannot be duplicated by the Director.
- [x] Procedural Portal & Glyph Auto-Placement (Flat-Level Transitions)
  - Allow `"direction": "portal"` inside procedural connections.
  - Add optional `portalTemplateId` and `placementSide` (`"top"`, `"bottom"`, `"left"`, `"right"`, `"any"`) to `AreaConnectionSchema`.
  - During map generation, dynamically select a wall tile matching `placementSide`, spawn `portalTemplateId`, and attach a `PortalComponent`.

## 🟢 Milestone 39: Encounter Director Sandbox & Validation UI (Complete)

Give designers a window into the Director before relying on it in real campaigns.

- [x] Add an Encounter Director preview panel to the editor's Simulation Lab.
- [x] Let designers select an area, seed, budget, and encounter profile, then reroll deterministic previews.
- [x] Render the generated map, placed actors, hazards, fields, portals, loot, and objectives.
- [x] Show the Director Receipt with "why chosen" and "why rejected" explanations.
- [x] Integrate AI Arena simulations against generated encounters and summarize survival, damage, and turn-count telemetry.
- [x] Add validator checks for overspent budgets, empty candidate pools, unreachable objectives, unavoidable lethal hazards, and impossible exits.
- [x] Block export on fatal Director configuration errors.

## 🟢 Milestone 40: Macro/Micro Integration — Schemes Mutate Encounters (Complete)

Let the existing Scheme Simulator influence future area generation and encounter composition.

- [x] Allow schemes to mutate area tags, sub-biome probabilities, encounter profiles, or budget modifiers.
- [x] Let villain agreements reserve encounter slots/tokens for minions, lieutenants, clues, or ritual objectives.
- [x] Surface scheme-driven area changes through investigation clues, rumors, map annotations, or faction dialogue.
- [x] Ensure inactive/generated areas reconcile scheme mutations safely during sleep/wake and reload.
- [x] Extend the Scheme Acceleration Simulator to display how schemes change encounter generation over time.
- [x] Add fail-graceful behavior when a scheme references an exhausted token pool or an unavailable area.

## 🟢 Milestone 41: Tactical Content Pass — First Directed Biomes

Prove the Director with a compact but high-quality content set.

- [x] Build at least four directed encounter families: orc camp, corrupted forest, spider nest, and shrine vault.
- [x] Ensure each family uses at least three Phase 5 interaction ingredients: locks, fields, throwing, altars/fountains, or dip/zap reactions.
- [x] Add designer-authored examples showing static, parameterized, and fully dynamic encounter variants.
- [x] Balance initial CR budgets, rewards, hazard severity, and escape routes through Simulation Lab telemetry.
- [x] Update the default campaign so generated rooms start feeling like tactical puzzles rather than random monster piles.
- [x] Add "Play Encounter" interactive sandbox mode to test generated encounters firsthand.

## 🟢 Milestone 42: "Hot Path" Dijkstra Mapping & Spawning (Complete)

Use Dijkstra shortest-path calculations to identify critical player-to-portal routes and focus major encounters along them.

- [x] **Dijkstra Hot Path Mapping:** Use `ROT.Path.Dijkstra` to map the critical route from the player's spawn point to area portals/exits in `src/map/generator.ts`.
- [x] **Radius Expansion (Approach 3):** Expand the Dijkstra path by a radius thickness (defaults to `1` for digger maps and scales dynamically with cellular map sizes) to define the hot path coordinates.
- [x] **Spawning Preference:** Weight the Encounter Director so major monsters (`protein`) and hazards/traps (`side`) prefer spawning on or near the hot path.
- [x] **Modding Schema Overrides:** Add optional `hotPathRadius` override support to `AreaDefinitionSchema` for custom campaign design.

## 🟢 Milestone 43: Advanced Biome Algorithms (DLA/Voronoi)

Expand the world generator with algorithms that produce more organic, sprawling terrain.

- [x] **DLA Generator:** Implement a Diffusion Limited Aggregation (DLA) walker in `src/map/generator.ts` to carve out highly organic, sprawling cave networks (creating a distinct feel from ROT.js Cellular).
- [x] **Voronoi Sub-Biomes:** Implement a Voronoi partitioning utility. Use it after primary map generation to overlay localized thematic zones (e.g., drawing a distinct "fungal patch" or "bandit camp" inside a larger map).
- [x] **Zod Schema Updates:** Add `dla` to the allowed map generator types in `CampaignData`. Add `subBiomeRules` arrays allowing designers to configure Voronoi overlays in the editor.
- [x] **Encounter Integration:** Make the Encounter Director aware of Voronoi boundaries so it can spawn themed clusters (e.g., restricting spider spawns strictly to the "spider nest" Voronoi cell).

---

# 🚀 Phase 7: Chronicle, Personality & Nemesis

**Goal:** Give important entities identity, memory, growth, autonomy, and surfacing. This phase turns repeated interactions into personal stories while reusing the existing Memory, AI, Faction, Trigger, Scheme, and Investigation infrastructure.

## 🟢 Milestone 44: Chronicle & Identity Layer ⭐ KEYSTONE

Create a generalized memory/identity wrapper for entities the player may care about.

- [x] Add a `ChronicleComponent` or expand `MemoryComponent` with identity hooks, player interaction score, scars, relationships, and important event references.
- [x] Generate salient names, titles, mannerisms, and visual identity cues from data-driven tables.
- [x] Support promotion of eligible generic entities into persistent named entities when they become narratively important.
- [x] Store chronicle-bearing entities safely in `persistentEntities` across area transitions.
- [x] Record compact event excerpts rather than unbounded raw logs to avoid save bloat.
- [x] Add debug/dossier UI showing identity, PIS, recent memories, scars, and current location.

## 🟢 Milestone 45: Personality Facets, Values, Stress & Core Memories (Complete)

Add Dwarf-Fortress-inspired internal causality without making a separate AI stack.

- [x] Define data schemas for personality facets, values, needs/goals, stress, thoughts, and core memories.
- [x] Generate facet/value distributions deterministically, with extreme traits rare and therefore memorable.
- [x] Implement event-to-memory filters: defeat, mercy, humiliation, betrayal, gift, rescue, faction harm, and repeated combat style.
- [x] Accumulate stress from negative memories and promote extreme/repeated memories into core memories.
- [x] Let core memories mutate facets and values permanently.
- [x] Add editor tools for inspecting and manually seeding personalities, values, and core memories.
- [x] Surface internal changes through logs, barks, dialogue options, or dossier updates so the system is not invisible.

## 🟢 Milestone 46: Personality-Weighted AI & Social Gating (Complete)

Make personality mechanically visible through behavior and dialogue.

- [x] Refactor AI behavior evaluation to support numeric weights where needed, allowing personality facets to multiply existing hunt/flee/ranged/spell/wander preferences.
- [x] Connect values/core memories to faction standing changes and hostility shifts where appropriate.
- [x] Add Trigger/Dialogue condition predicates for facets, values, stress thresholds, memories, grudges, and PIS.
- [x] Gate dialogue options based on personality: cruel NPCs reject comfort, honorable NPCs respond to mercy, fearful NPCs are more intimidatable, etc.
- [x] Add behavior surfacing barks: cowardly retreat lines, vengeful charge lines, grateful ally lines, suspicious merchant lines.
- [x] Add tests proving personality modifies decisions without breaking deterministic AI resolution.

## 🟢 Milestone 47: Social Memory & Interaction Tracking ⭐ KEYSTONE (Complete)

Build the data layer for NPCs as persistent social agents. Extend `MemoryComponent` so NPCs remember what they know, count how often they've interacted with the player, and accumulate temporary social states that influence future dialogue and trade.

- [x] Extend `MemoryComponent` with a `knowledge` record: structured facts the NPC knows about schemes, areas, hazards, other NPC locations, and hidden loot. Knowledge items are typed (`rumor`, `location`, `weakness`, `secret`) and tagged for query filtering.
- [x] Add interaction counters to `MemoryComponent`: `timesTalked`, `timesTraded`, `timesIntimidated`, `timesHelped`, `timesBetrayed`. Each increments deterministically when the player engages in the corresponding social action.
- [x] Add a `patienceThreshold` to NPCs derived from personality facets (M45): determines how many times they'll repeat information before refusing or demanding payment.
- [x] Implement `annoyed` and `grateful` as temporary NPC states stored on `MemoryComponent`. These modify dialogue options, trade prices, and rumor sharing for a configurable duration after specific player actions (e.g., intimidating an NPC sets `annoyed` for 50 turns).
- [x] Extend `ConditionPredicateSchema` (M22) with dialogue conditions: `has_knowledge`, `interaction_count`, `patience_below`, `is_annoyed`, `is_grateful` — all queryable from dialogue trees and triggers.
- [x] Extend `ConsequenceActionSchema` (M22) with social consequence types: `record_interaction`, `set_patience`, `modify_knowledge` — so dialogues and reactions can write back to NPC memory.
- [x] Surface interaction history and social state in the `/debug` inspect tooltip: "Talked to 3 times" / "Currently: annoyed" / "Patience: 2/5" / "Knows: spider_nest location".

**Testable in game:** Use `/debug` to inspect an NPC before and after talking to them. Interaction counters increment. Use a trigger to set `annoyed` state — verify the debug tooltip shows the change. Set `patienceThreshold` to 1, ask the same question twice, verify the NPC refuses the second time.

## 🟢 Milestone 48: Knowledge Brokering — NPCs as Information Sources (Complete)

Make NPCs into walking repositories of world knowledge. The player can ask about topics they've heard of, NPCs respond based on what they actually know, and knowledge flows organically from world events into the NPC social graph.

- [x] Implement knowledge propagation: when the Event Ledger (M15) records a major event (EntityDied, QuestCompleted, SchemeAdvanced, boss spawned), eligible NPCs in connected or faction-aligned areas add corresponding `knowledge` entries deterministically, with a configurable propagation delay.
- [x] Add `ask_about` as a dialogue verb: the player selects a topic from their own knowledge pool (things they've learned from other NPCs, clues, or direct experience) and the NPC responds based on what they know. Gating: faction standing (M9) + personality facets (M45) + `annoyed`/`grateful` state (M47).
- [x] Add a `transfer_knowledge` dialogue consequence type that writes structured knowledge from the NPC's `MemoryComponent.knowledge` into the player's investigation/knowledge records.
- [x] Support knowledge-as-currency: NPCs can trade information for gold, favors, items, or reciprocal information, resolved through the Trigger System (M22) by gating knowledge access behind a `grant_quest` or `change_standing` consequence.
- [x] NPCs refuse to answer if they don't know the topic, with personality-appropriate deflection lines ("Never heard of it." / "Ask someone who cares." / "That information will cost you.").

**Testable in game:** Kill a boss in `dungeon_1`. Return to the `safe_hub` barkeep. Use `ask_about` → select the boss's name. The barkeep says "Word is someone killed the troll in the upper dungeons." This works because the `EntityDied` event propagated knowledge. Now talk to the scout NPC — they don't know about the boss (not in their knowledge pool), so they deflect.

## 🟢 Milestone 49: Trade & Barter Economy (Complete)

Give NPCs the ability to buy, sell, and barter items with the player. Prices respond to faction standing, personality, and social history — the same item costs different amounts from different merchants.

- [x] Add a `ShopComponent { inventory: EntityId[], markupMultiplier: number, buyTags: string[], sellTags: string[] }` to NPC entities in the ECS, making any NPC capable of being a merchant.
- [x] Build a `trade.ui.ts` panel with buy/sell grid, per-item pricing, haggling feedback, and gold display. Reuses the existing container UI architecture from M32 (Containers).
- [x] Implement `getEffectivePrice(baseValue, shop, buyerEntity, sellerEntity)` utility that dynamically queries: base item value × NPC markup × faction standing modifier (M9, M17) × personality facet modifier (M45: greedy overcharges, generous undercharges) × social state (M47: `annoyed` markup, `grateful` discount).
- [x] Implement `barter` reaction verb: the player offers items from inventory to offset gold costs, resolved through the Reaction System (M30) matching item `tags` against the shop's `buyTags`. "I'll give you this goblin sword plus 10 gold for the health potion."
- [x] Add `intimidate` and `persuade` as social Apply verbs using personality-weighted contest resolution (player's faction standing + traits vs. NPC's courage/valor facets from M45) to temporarily modify `markupMultiplier` for the current trade session.
- [x] Allow NPC shops to issue procedural fetch-quests when specific inventory tags are depleted: "I'm low on iron ore — bring me 3 ingots and I'll pay double." Uses the procedural quest template system (M19).
- [x] Shop inventories persist across area transitions via the Sleep/Wake + PersistentEntity pipeline (M17). A merchant's stock doesn't reset when you leave and return.
- [x] **Dialogue Integration (Barter UI & Services)**: Instead of the initially planned hotkeys or hardcoded interactions, implement `open_barter` and `trigger_service` as `DialogueEffect`s. The Barter UI will be summoned seamlessly if the player selects a dialogue option to trade with an entity holding a `ShopComponent`.
- [x] **Service Spells Component**: Introduce `ServicesComponentSchema` to allow NPCs to cast spells on the player for a fee, driven by the Dialogue Router.

**Testable in game:** Walk up to the `safe_hub` merchant, talk to them to open branching dialogue, select the trade option to open the trade panel, see items with prices. Buy a health potion. Gold decreases, potion appears in inventory. Talk to a different merchant — notice prices differ. Intimidate the merchant — prices drop 20% for this session. Barter a goblin sword to cover part of the cost.

## 🟢 Milestone 50: Gossip & Rumors — Social Information Propagation (Complete)

Turn the Event Ledger into a social rumor mill. Major world events generate gossip that spreads organically through the NPC social graph. Players can ask for gossip and hear different things from different people.

- [x] Add a `rumorPool` to `MemoryComponent`: a capped array of structured rumor fragments (text + source event reference + freshness timestamp). Each NPC has their own pool representing what they've heard.
- [x] Implement rumor propagation algorithm: when the Event Ledger records a `major` event, the system selects eligible NPCs (in connected areas, same faction, or gossip-tagged) and adds contextual rumors after a configurable delay. Rumors spread to adjacent areas on subsequent propagation ticks.
- [x] Add `gossip` as a dialogue verb: the player asks "What's the word around here?" and the NPC shares a rumor from their `rumorPool`, highest freshness first. Sharing consumes the rumor (NPC won't repeat it) unless it's marked as `persistent`.
- [x] NPCs share rumors unprompted as flavor barks before the dialogue option list: "You hear the barkeep muttering about strange lights in the old caves..."
- [x] Implement rumor freshness decay: rumors older than a configurable threshold become "stale" and are replaced by newer ones. Rumors that are confirmed true (the player witnesses the event) are removed from NPC pools.
- [x] NPCs who hear a rumor they already know react appropriately: "You already told me that." (annoyed increment) or "Yes, I heard about the troll too — terrible business." (social bonding).
- [x] Connect rumors to the Investigation Board (M20): scheme-related clues can propagate as rumors, giving players an organic way to discover villain activities without finding physical clues.

**Testable in game:** Advance a scheme via `/debug fast-forward-schemes`. Talk to the `safe_hub` barkeep → use `gossip` → hear "Strange figures have been seen near the goblin camp." Talk to another NPC — they haven't heard yet (propagation delay). Wait N turns → now they know too. Return to the first NPC — they won't repeat the same rumor (consumed).

## 🟢 Milestone 51: Social Commerce Authoring & Campaign Content Pass (Complete)

Wire the M47–M50 systems into the Campaign Editor and ship a default campaign content pass that proves every system works together in a coherent player experience.

- [x] Extend the Dialogue Tree editor in `src/rendering/ui/dialogue_editor.ts` (M23) with knowledge-gating nodes (condition: `has_knowledge`), trade-node types (opens `trade.ui.ts` directly), rumor-injection slots (injects a rumor into the dialogue flow), and social state preview (shows which branches are gated by `annoyed`/`grateful`/`patience_below`).
- [x] Add a Trade Inventory editor panel for NPC entities: configure `ShopComponent` fields (markup, buy/sell tags, initial stock) with the existing Zod-driven form renderer, using item autocomplete for inventory slots.
- [x] Add a Knowledge Simulator to the editor's Simulation Lab: given a campaign state snapshot (or a seed + event timeline), renders a node graph showing which NPCs hold which knowledge, what rumors are circulating in each area, and how information propagates across area connections. Designers can step forward in time to see rumor spread.
- [x] Add a Social Graph overlay to the Area Graph Editor (M24): colored edges showing trade routes (NPCs to shop-eligible NPCs), rumor propagation paths, and knowledge dependencies between NPCs across areas.
- [x] **Default campaign content:**
  - Add a merchant NPC to `safe_hub` with a curated shop inventory (health potion, rations, bronze key), buy/sell tags, and personality facets that influence pricing.
  - Author three knowledge-bearing NPCs: a barkeep (rumors about schemes), a scout (area hazard info — "watch out for the spider nest"), a scholar (scheme clues — "the villain's sigil was seen near the old altar").
  - Create a rumor propagation chain: Scheme Simulator villain activities (M20) generate rumors that cascade from `dungeon_2` through to `safe_hub` via gossip-eligible NPCs, giving players organic breadcrumbs.
  - Add a trade tutorial moment: in `safe_hub`, an NPC offers a free item in exchange for information about the first dungeon, demonstrating both `ask_about` and `barter` in a single interaction.
- [x] Validate all new schemas (`ShopComponent`, knowledge/rumor shapes, social consequence types) through the Campaign Validator (M25), blocking export on broken knowledge chains or unreachable merchant stock.

**Testable in game:** Open the editor. Design a merchant with inventory using the new Trade panel. Open the Knowledge Simulator — see which NPCs would know about the troll boss after it spawns. Playtest the campaign: talk to the barkeep (gossip), ask the scout (ask_about spider_nest), trade with the merchant (buy health potion), notice the scholar has a clue about the villain. All four M47–M50 systems work together in one coherent hub area.

## 🟢 Milestone 52: Nemesis Hierarchy, Promotion & Cheating Death (Complete)

Build the core Shadow-of-Mordor-style loop of rise, survival, revenge, and replacement.

- [x] Define hierarchy data: grunts, champions/captains, lieutenants, chiefs/bosses, faction-specific titles, and vacancies.
- [x] Promote entities based on PIS, victories, surviving defeat, killing allies, humiliating the player, or completing off-screen goals.
- [x] Implement controlled “cheat death” events with scars, changed stats/traits, changed dialogue, and strict pacing cooldowns.
- [x] Fill hierarchy vacancies deterministically via candidates from the faction/area pool.
- [x] Display known hierarchy information in a Nemesis/Dossier UI, with unknown slots and clue-gated reveals.
- [x] Emit promotion, vacancy, scar, and return events to the event ledger and investigation surfaces.

## 🟢 Milestone 53: Background Rivalries & Power Struggles (Complete)

Let important NPCs act autonomously even when the player is elsewhere. This milestone connects to M48 (Knowledge: NPCs learn about rivalries) and M50 (Gossip: rumors about power struggles spread through the social graph).

- [x] Build a `nemesis.system.ts` or extend the scheme scheduler to tick power struggles, duels, betrayals, recruitment, territory shifts, and training.
- [x] Resolve off-screen conflicts using deterministic combat/contest summaries rather than full map simulation.
- [x] Allow the player to intercept, sabotage, or support scheduled rivalry events through quests, rumors, or map objectives — surfaced via M48's `ask_about` and M50's `gossip` verbs so players learn about rivalry opportunities through NPC dialogue.
- [x] Rivalry outcomes propagate as structured knowledge (M48): defeated champions, demoted captains, and new hierarchy vacancies are added to eligible NPCs' `MemoryComponent.knowledge` in connected areas.
- [x] Major rivalry events (betrayals, assassinations, promotions) generate gossip fragments (M50) that spread through the NPC social graph, giving players organic awareness of off-screen power shifts.
- [x] Handle dead/missing/intercepted participants defensively by cancelling, replacing, or transforming events into visible failures.
- [x] Add fast-forward simulation and debug receipts for rivalry outcomes.
- [x] Integrate rivalry outcomes with factions, schemes, area tags, encounter budgets, and NPC shop inventories (M49 — a merchant whose supplier was killed in a rivalry may have depleted stock).

## 🟢 Milestone 54: Adversarial Resilience & Escalation (Complete)

Give the conspiracy teeth, memory, and adaptability. Builds on M45 (Personality) and M47 (Social Memory) to make schemes react to player interference.

- [x] **MICE Recruitment:** Cross-reference villain leverage preferences with target NPC personality facets to select the most effective leverage and record it in the `AgreementComponent`.
- [x] **Compromise Tracking:** Add `compromiseScore` to `MemoryComponent` that increments as NPCs commit crimes, powering blackmail, confessions, and repair decisions.
- [x] **Local Repair Logic:** When a scheme node dies, have remaining nodes evaluate their compromise and personality to independently abandon, continue, reroute, or confess.
- [x] **Scheme Momentum:** Allow schemes to enter a `leaderless` state when the mastermind dies, where existing minions continue executing their phase mutations independently.
- [x] **Retaliation Escalation:** Track `conspiracyAwareness` on schemes that increases when players disrupt nodes, triggering escalating countermeasures (scouts, ambushes, assassins) via `areaMutations`.

## 🟢 Milestone 55: Player Manipulation & Relationship Levers (Complete)

Give players ways to intentionally shape the emerging cast. This milestone builds on the M47–M50 social commerce foundation: social memory (M47) tracks what the player has done, knowledge brokering (M48) determines what NPCs know about the player's reputation, trade (M49) uses relationship axes as pricing modifiers, and gossip (M50) spreads stories about the player's actions.

- [x] Add relationship axes to `MemoryComponent` (M47): `loyalty`, `fear`, `resentment`, `respect`, `debt`, `ideologicalAlignment` — numeric values (-100 to +100) that NPCs track for the player and other entities.
- [x] Relationship axes dynamically modify trade pricing in `getEffectivePrice()` (M49): high `loyalty` discounts, high `fear` discounts temporarily, high `resentment` surcharges, high `debt` reduces markup.
- [x] Relationship axes gate knowledge sharing (M48): NPCs with low `loyalty` or high `fear` are more likely to share sensitive information under pressure; NPCs with high `resentment` refuse to share anything positive about the player.
- [x] Relationship axes feed into `intimidate`/`persuade` contest resolution (M49): high `fear` makes intimidation easier; high `respect` makes persuasion easier.
- [x] Add interaction/dialogue consequences for spare, humiliate, recruit, brand/convert, ransom, gift, intimidate, apologize, or argue values — all of which set M47's `annoyed`/`grateful` states and modify relationship axes.
- [x] Let companions/allies become nemeses if betrayed, abandoned, or ideologically opposed (relationship axes drop below threshold → faction change).
- [x] Support value mutation through arguments/dialogue and facet mutation through experiences (M44, M45).
- [x] Add Trigger consequences for relationship mutation and hierarchy manipulation.
- [x] Surface manipulation risks clearly so players understand why an ally defected or enemy became obsessed — surfaced through M47's interaction history tooltip and M51's Knowledge Simulator.

## 🟢 Milestone 56: Nemesis Surfacing & Narrative UX

Make the system legible, dramatic, and emotionally sticky.

- [x] Add encounter introductions, revenge callouts, death/escape lines, victory taunts, and memory-specific dialogue fragments.
- [x] Show scars, titles, changed glyph/color/traits, and notable history in inspect tooltips and dossier screens.
- [x] Connect rumors, witnesses, clues, and investigation board entries to nemesis changes.
- [x] Add a chronicle timeline for the player, factions, and notable NPCs.
- [x] Add accessibility options to shorten/collapse repeated dramatic presentations.
- [x] Ensure every major off-screen narrative event has at least one player-facing surface: message, rumor, clue, board entry, quest, or map change.

---

# 🚀 Phase 8: Drama Director & Dynamic Composition

**Goal:** Use the Event Ledger + Trigger System as a pacing-aware Drama Director that dynamically composes narrative triggers for characters, factions, areas, dungeons, and artifacts.

## 🟢 Milestone 57: Event Ledger 2.0 & Player Interest Scoring (Complete) ⭐ KEYSTONE

Turn the event ledger into a durable, queryable narrative substrate without storing infinite noise.

- [x] Add event importance tiers and long-lived compact summaries for narratively meaningful events.
- [x] Implement Player Interaction Score for entities, factions, areas, artifacts, and possibly dungeons.
- [x] Add deterministic decay/boost rules so recent and repeated interactions matter more.
- [x] Store references from chronicle entries to ledger summaries rather than duplicating full event payloads.
- [x] Add query helpers for “most interesting enemy,” “recently harmed faction,” “area with escalating danger,” etc.
- [x] **Unified Knowledge Migration:** Refactor the Investigation Board UI to read dynamically from the player's `MemoryComponent.knowledge` (filtered by tags) instead of storing a parallel array of string `discoveredClues`, fully unifying the game's knowledge architecture.
- [x] Add debug timeline visualization and exportable simulation logs.

## 🟢 Milestone 58: Drama Trigger Composer — Runtime Trigger Generation (Complete)

Generate specific narrative triggers from reusable primitives instead of hand-authoring every permutation.

- [x] Define composer primitives: condition snippets, consequence snippets, dialogue/bark snippets, spawn/location constraints, and cooldown rules.
- [x] Implement deterministic binding variables such as `$NEMESIS_ID`, `$ALLY_ID`, `$AREA_ID`, `$FACTION_ID`, and `$ARTIFACT_ID`.
- [x] Compose full `TriggerDefinition` objects at runtime and inject them into active campaign data.
- [x] Rebuild trigger buckets safely after dynamic trigger injection/removal.
- [x] Validate generated triggers using the same Zod and Campaign Validator paths as authored triggers.
- [x] Add editor UI for previewing generated triggers and optionally baking them into static campaign data.

## 🟢 Milestone 59: Pacing Governor & Surprise Budget (Complete)

Prevent emergent drama from becoming spammy, unfair, or tonally incoherent.

- [x] Add a global and per-domain drama budget that limits extreme events such as ambushes, betrayals, returns from death, and rescues.
- [x] Add safe-context checks: no unfair ambushes during onboarding, unavoidable death spirals, critical UI states, or just after another major event.
- [x] Add cooldowns per character, faction, area, and event type.
- [x] Support foreshadowing requirements for high-impact events: rumor, clue, omen, visible preparation, or investigation board entry.
- [x] Add fallback events for invalidated setups, such as participant death or inaccessible area.
- [x] Surface Drama Director decisions in debug receipts.

## 🟢 Milestone 60: Scheme Compiler & Contextual Investigation (Complete)

Move from fully hand-authored schemes to dynamically assembled conspiracies driven by world events.

- [x] **Phase Blocks & Recipes:** Split monolithic `SchemeTemplate`s into reusable `PhaseBlock`s (ingredients) and `SchemeRecipe`s (constraints).
- [x] **Scheme Compiler:** Build a pure function that assembles a runtime `SchemeComponent` from a recipe + world state, ensuring identical execution to hand-authored schemes.
- [x] **History-Derived Triggers:** Use `ChronicleComponent` events (e.g., exile, territory loss, humiliation) to trigger the Scheme Compiler, generating schemes out of emergent gameplay.
- [x] **Contextual Clues:** Add `narrativeVerb` and `evidenceTags` to Phase Blocks, allowing the Investigation system to generate context-aware clues (e.g., "alchemical residue" for disruption phases).

## 🟢 Milestone 61: Generalized Chronicles for Regions, Dungeons & Artifacts (Complete)

Apply the Nemesis pattern beyond NPCs wherever identity/memory/growth/autonomy/surfacing makes sense.

- [x] **Architectural Refactor:** Convert Areas and Factions into standard ECS Global Entities, attaching `TagsComponent` and `MemoryComponent` to replace hardcoded `GameState` arrays (`factionPis`, `areaMutations`, etc.), establishing the foundation for robust narrative tracking.
- [x] Add chronicle support for artifacts: owner genealogy, kills, curses/blessings, grudges, awakened traits, and inscriptions.
- [x] Add chronicle support for factions: internal schisms, vendettas, debts, leadership changes, and goals.
- [x] Let the Encounter Director and Scheme Simulator read chronicle state when generating future content.
- [x] Surface region/artifact/faction history in map UI, item inspect, investigation board, and dialogue.
- [x] Keep all chronicle data compact and serializable.

## 🟢 Milestone 62: Authoring Continuum Tools — Static, Blueprint, Dynamic (Complete)

Make the three authoring levels explicit in the Campaign Editor.

- [x] Label editor objects as Static, Parameterized Blueprint, or Dynamic Primitive where appropriate.
- [x] Provide “generated object inspectors” showing the exact JSON produced by Encounter Director or Drama Composer algorithms.
- [x] Allow designers to bake a generated result into static data for hand-polishing.
- [x] Add primitive libraries for encounters, reactions, personality memories, drama triggers, and scheme consequences.
- [x] Teach validators to evaluate both authored source data and representative generated outputs.
- [x] Update campaign export so all dynamic rules and primitives remain self-contained and installable.

## 🟢 Milestone 63: Narrative Simulation Lab & Fuzzer (Complete)

Stress-test emergent narrative systems across many seeds before they reach players.

- [x] Extend the Simulation Lab to run hundreds of deterministic narrative simulations headlessly.
- [x] Output timelines of promotions, betrayals, area mutations, clue discovery, quest failures, and major drama events.
- [x] Detect softlocks, unobservable scheme progress, orphaned triggers, impossible participants, runaway event loops, and save-size explosions.
- [x] Add deterministic replay support for a failing simulation seed and input/event sequence.
- [x] Add aggregate metrics: average drama events per hour, repeated event frequency, clue-to-event ratio, and unresolved scheme count.
- [x] Block export on fatal narrative simulation failures when campaigns opt into advanced systems.
- [x] Group and reorganize the Campaign Editor sidebar menus into collapsible categories to reduce viewport overflow.

---

# 🚀 Phase 9: Default Campaign Vertical Slice, Balance & Release Hardening

**Goal:** Convert the systemic engine into a coherent playable campaign and robust creator platform. This phase is less about new architecture and more about proving the full stack through content, balance, polish, and documentation.

## 🟢 Milestone 64: Default Campaign Vertical Slice (Complete)

Ship a compact campaign that exercises every major system in a coherent arc.

- [x] Build a 60–90 minute default campaign with a starting hub, multiple directed biomes, at least one scheme, and at least one nemesis-capable faction.
- [x] Include interaction tutorials for throwing, locks, fields, dip/zap, altars/fountains, investigation, and nemesis surfacing.
- [x] Add a clear campaign objective and finale that can be won, failed, or transformed by systemic outcomes.
- [x] Ensure all mainline quests have fail-graceful states if NPCs die, areas mutate, or key items are lost.
- [x] Add content-review passes for message tone, tooltip clarity, encounter readability, and UI pacing.

## 🟢 Milestone 65: Balance, Telemetry & Deterministic Replay QA

Create repeatable ways to tune and debug the game as a game, not just an engine.

- [x] Add automated balance simulations for combat, hunger, loot economy, encounter budgets, and scheme pressure.
- [x] Add seed-based replay capture for bug reports and deterministic regression tests.
- [x] Track difficulty metrics: player deaths, damage taken, resources consumed, flee frequency, average encounter duration, and quest completion rate.
- [x] Use AI Arena and Encounter Director simulations to tune CR costs and dynamic templates.
- [x] Add performance benchmarks for large maps, many entities, many fields, and many triggers.
- [x] Establish target performance budgets for browser play and editor simulations.

## 🟢 Milestone 66: Campaign Editor UX Refactor & Consolidation (Complete)

Transform the editor workspace into a scalable, multi-pane application.

- [x] Implement a professional IDE-style layout (Slim Icons -> Category List -> Workspace) to maximize horizontal real estate for forms and node editors.
- [x] Consolidate related data into single views using workspace tabs (e.g., an "Adversary Director" view that tabs between Villains, Schemes, Agreements, and Hierarchies).
- [x] Add searchable and resizable panels, allowing users to collapse or focus on specific parts of the workspace.

## 🟢 Milestone 67: Release Robustness & Distribution Polish

Prepare for public builds and long-term iteration.

- [x] Harden IndexedDB import/export/uninstall flows, including orphaned saves and version mismatch UX.
- [x] Audit accessibility: keyboard-only play, scaling, contrast, animation reduction, tooltip readability, and modal focus trapping.
- [x] Test browser compatibility across Chromium, Firefox, Safari, and mobile/tablet where feasible.
- [x] Add graceful error boundaries for campaign loading, runtime simulation errors, editor validation crashes, and corrupt saves.
- [x] Optimize production bundle size and loading time.
- [x] Prepare deployment packaging for itch.io/GitHub Pages and update README screenshots/instructions.

## 🟢 Milestone 68: Modding Documentation, Examples & Creator Onboarding

Make the system understandable to campaign authors.

- [x] Write schema reference docs (seeded from `generate-ai-prompt-kit.ts` output) with annotated walkthroughs using the default campaign as the worked example.
- [x] Add in-editor help text, warning explanations, and "fix-it" suggestions for common validation errors.
- [x] Provide a creator checklist (`docs/CREATOR_GUIDE.md`) for packaging, installing, validating, and playtesting campaigns, including AI-assisted authoring via the prompt kit.
- [x] Add a designer-facing glossary for engine concepts: tags vs traits, intents vs events, reactions vs triggers, static vs dynamic data.

---

# 🚀 Phase 10: Architectural Refactoring & Core Engine Stabilization

**Goal:** Harden engine stability, enforce strict compliance with `AGENTS.md`, decompose monolithic modules (especially `src/main.ts` into a dedicated `session_controller.ts`), and stabilize turn-step and persistence boundaries before introducing V2 Engine loop/renderer decoupling.

## 🟢 Milestone 69: Rule Compliance & Determinism Hardening (Completed)

Eliminate rule deviations, upward dependency leaks, and non-deterministic logic that would corrupt time-sliced or worker-backed execution.

- [x] Eliminate `any` casts in `src/rendering/ui/ui_utils.ts` by introducing generic element type parameters `<T extends HTMLElement>`.
- [x] Enforce seeded PRNG determinism by replacing `Math.random()` with `rng` from `src/core/rng.ts` in visualizer and telemetry tools (`narrative_fuzzer.ts`, `director_sandbox.ui.ts`, `knowledge_simulator.ui.ts`, `world_graph.ts`).
- [x] Migrate 35 DOM clearing operations (`innerHTML = ''`) to `replaceChildren()` (109 total `.innerHTML` uses in pre-Phase-10 tree; 0 clearing sites remain today, 41 `replaceChildren()` call sites in current `src/`).
- [x] Extract `RoomBounds` from `src/map/encounter_director.ts` to `src/types/encounter.types.ts` to eliminate inverted imports into `src/types/game-state.types.ts`.
- [x] Remove upward action imports in `src/systems/ai.system.ts` and `src/systems/trigger/social.ts`.

## 🟢 Milestone 70: Architectural Monolith Decomposition & Session Orchestration (Completed)

Split overgrown modules exceeding the ~250-line guideline into cohesive, single-responsibility files to establish clean seams for message queues and decoupled presentation.

- [x] Extract session lifecycle, loop wiring, and presentation orchestration from `src/main.ts` (745 LOC -> 98 LOC bootstrap) into `src/core/session_controller.ts` (630 LOC) and fog overlay helpers in `src/rendering/display.ts`.
- [x] Decompose `src/systems/nemesis.system.ts` (833 LOC -> 11 LOC facade) into `nemesis_tracker.ts`, `nemesis_hierarchy.ts`, `nemesis_adaptation.ts`, and `nemesis_presentation.ts` (`src/systems/nemesis/`).
- [x] Split `src/rendering/ui/director_sandbox.ui.ts` (828 LOC -> 214 LOC facade) into `director_telemetry_view.ts` and `director_controls.ts` (`src/rendering/ui/director/`).
- [x] Decompose `src/editor/simulation/narrative_fuzzer.ts` (664 LOC -> 215 LOC runner) into `fuzzer_invariants.ts` (166 LOC), `fuzzer_mock_state.ts` (284 LOC), and `fuzzer_telemetry.ts` (112 LOC).

## 🟢 Milestone 71: Core Engine, Turn Loop & Persistence Stabilization (Completed)

Formalize state transitions, turn step invariants, and entity cold storage boundaries so every simulation step produces a compact, leak-free state snapshot.

- [x] Implement bounded `resolveStateStabilization(state: GameState): GameState` pipeline with a 16-iteration guard (`MAX_STABILIZATION_ITERATIONS = 16`) to safely process cascading damage, hazards, and reactive triggers (`src/core/state_stabilizer.ts`).
- [x] Implement deep recursive entity packaging and orphan entity pruning sweeps in `src/core/ecs.ts` and `src/core/save.ts` (`pruneOrphanEntities`, `collectOwnedEntityIds`) for area sleep/wake transitions.
- [x] Isolate sandbox and demo bootstrap routines from `src/core/bootstrap.ts` into dedicated setup modules (`src/core/bootstrap_sandbox.ts`, `initializeCampaignWorldEntities`).

---

# 🚀 Phase 11: V2 Engine — Decoupled Frame Loop, Message-Queue Glue & Pure Dumb Renderer

**Goal:** Guarantee butter-smooth 60 FPS framerates during Real-Time with Pause (RTwP) mode and _Dwarf Fortress_ / _Caves of Qud_-scale world simulations by decoupling simulation ticks from presentation frames via message queues, turning `renderer.ts` into a pure dumb canvas renderer, throttling persistence out of the hot loop, and time-slicing heavy generation/simulation work.

## 🟢 Milestone 72: Decoupled Frame Loop, Message-Queue Glue & Debounced Persistence (Completed)

Eliminate synchronous `render()`, 17-panel DOM rebuilds, and `localStorage` serialization inside individual actor sub-steps (`processTurn` / `updateState`).

- [x] **Layer Decoupling via Message / Event Queues**: Introduce explicit typed queues (`InputCommandQueue` from UI/Input to Simulation, and `PresentationEventQueue` / dirty flags from Simulation to Renderer, DOM UI, and Persistence) in `src/core/session_controller.ts` and `src/core/game-loop.ts` so simulation, presentation, and storage never block or synchronously re-enter each other.
- [x] **60Hz Frame-Synced Presenter Pass**: Decouple `updateState()` from direct rendering; mutate/advance `currentState` in memory during actor turns (`scheduler.ts`) and run a single `requestAnimationFrame` presenter pass at most once per display frame when state is marked dirty.
- [x] **Debounced & Checkpointed Persistence**: Remove synchronous `saveGame()` (`JSON.stringify` + `localStorage.setItem`) and `saveCurrentReplay()` calls from `updateState()`. Trigger persistence asynchronously/debounced on safe checkpoints (player turn settle, RTwP pause, area transitions, modal close, or periodic cooldown).
- [x] **Selective UI Dirty-Domain Tracking**: Track dirty UI domains (`hud`, `log`, `inventory`, `modal`, `camera`) in the presentation queue so passive NPC ticks do not rebuild unchanged DOM panels.

## 🟢 Milestone 73: Pure Dumb Canvas Renderer & Presentational `ViewportSnapshot` (Completed)

Enforce strict model-view separation (inspired by `slashman/jsrl`) by splitting ECS view projection from canvas drawing.

- [x] **Presentational Viewport Projector (`src/rendering/viewport_snapshot.ts`)**: Build a pure `buildViewportSnapshot(state, viewportW, viewportH): ViewportSnapshot` projector that pre-computes visible/explored cells, z-sorted entity stacks, camera offsets, fog-of-war state, active visual effects, and inspect tooltip DTOs using flat pre-allocated buffers and integer coordinate indexing (`y * width + x` instead of per-tile `${x},${y}` string allocations).
- [x] **Pure Dumb Canvas Renderer (`src/rendering/renderer.ts`)**: Refactor `renderer.ts` to accept only `(display, snapshot: ViewportSnapshot)` with zero imports from `ecs.ts`, `ComponentType`, or `GameState`.
- [x] **Dirty-Cell Canvas Diffing**: Replace full-frame `display.clear()` redraws in `renderer.ts` with cell-level diffing against the previous `ViewportSnapshot` so only changed viewport cells are redrawn each frame, keeping the display adapter swappable for future WebGL/PixiJS batch backends (`FlameNeon/pixi.js`).

## 🟢 Milestone 74: Cooperative Frame-Budgeted Scheduler, Tiered World Simulation & Worker Offload (Completed)

Prevent browser lock-ups during turn storms, large-scale world ticks, and multi-stage procedural generation.

- [x] **Frame-Budgeted Cooperative Scheduler (`src/core/scheduler.ts`)**: Wrap `runTurnBasedLoop`, `rtwpLoop`, and fast-forward batching in a `FRAME_BUDGET_MS = 4` (`performance.now()`) time budget that yields back to the frame presenter when exceeded while keeping conflicting player inputs locked until the turn slice settles.
- [x] **Tiered World Simulation Cadence**: Separate active-zone micro-simulation (every turn: FOV, A*, combat, reactions) from off-screen macro-simulation (coarse global turn cadence for `scheme.system.ts`, `world_events.system.ts`, `rivalry.system.ts`, and `gossip.system.ts`) and delta catch-up on area wake (`src/core/simulation_cadence.ts`, `src/systems/map.system.ts`).
- [x] **Stage-Sliced Generators & RNG Determinism Guard**: Add cooperative `function*` generator pipelines (`generateAreaAsync`, `runNarrativeFuzzerAsync`) that yield `{ stage, progress }` checkpoints between heavy stages (`Base Carve → DLA/Voronoi → Dijkstra Hot-Path → Room Spawning → Fuzzer Turn Batches`) while snapshotting/restoring `ROT.RNG.getState()` across every yield boundary (`src/map/generator_stages.ts`, `src/map/generator_async.ts`, `src/editor/simulation/narrative_fuzzer_async.ts`).
- [x] **Smooth Non-Blocking Loading & Background Worker Offload**: Drive a continuous UI progress overlay (`src/rendering/ui/loading_overlay.ui.ts`, `#loading-overlay`) from yielded generation checkpoints during area transitions and Fuzzer runs, and provide a typed Web Worker bridge (`src/worker/worker_bridge.ts`, `src/worker/fuzzer.worker.ts`, `src/worker/map.worker.ts`) over serializable message boundaries for background chunk generation and headless multi-seed fuzzing with automatic main-thread fallback.

## 🟢 Milestone 75: Gameplay HUD & RTwP Controls Refinements (Completed)

Enhance tactile responsiveness, situational awareness, and menu management atop the decoupled RTwP event loop.

- [x] Add configurable RTwP auto-pause triggers in `src/core/auto_pause.ts`, evaluated in `src/core/game-loop.ts` from the simulation event queue (hostile/nemesis newly spotted in FOV, player HP below threshold, detrimental statuses applied, narrative triggers). FOV perception is surfaced via a new `GameEventType.EntitySpotted` emitted by the auto-pause evaluator from the pure query `getVisibleHostileEntityIds()` in `src/systems/map.system.ts`, keeping the systems layer event-free and the transient sighting dedupe in `core`.
- [x] Centralize modal ESC-key stack management (LIFO) and auto-pause synchronization across all overlays (`src/core/modal_manager.ts`).
- [x] Add dynamic contextual verb illumination in `renderVerbMenu` indicating valid interactions on adjacent targets (`getVerbOptionsForTarget` + all-verb rendering).
- [x] Add filter chips (Scheme, Faction, Nemesis, Area) to `src/rendering/ui/investigation.ui.ts` (`src/constants/investigation_filter.constants.ts`).

## 🟢 Milestone 76: Campaign Creator & Developer Tooling UX (Completed)

Streamline authoring workflows, navigation, and validation diagnostics.

- [x] Implement interactive validation diagnostics (canonical path normalizer `src/editor/validation_path.ts`, navigator `src/editor/validation_navigator.ts`, persistent bottom dock `src/rendering/ui/validation_panel.ui.ts`, `editor_toolbar.ts` cleanup).
- [x] Introduce `<details>` / `<summary>` accordion rendering in `src/rendering/ui/zod_form_renderer.ts` (`expandedPaths` persistence, `data-field-path`, descendant error badges).
- [x] Build a reverse-reference ("Where Used") inspector (`src/editor/reference_index.ts` cached `WeakMap`, `src/rendering/ui/where_used.ui.ts` drawer, `dialogue_editor.ts` node references).
- [x] Implement "Playtest from Here" contextual tile spawning (`src/rendering/ui/area_playtest_menu.ui.ts`, `area_editor.ts` `contextmenu`, `session_controller.ts` / `bootstrap.ts` `spawnOverride`).

---

# 🚀 Phase 12: Tactical Presentation, Edge-Folded HUD & RimWorld/DF/Ultima UX Overhaul

**Goal:** Maximize map viewport presence, visual atmosphere, and mouse-first tactical ergonomics (inspired by _Dwarf Fortress Steam_, _RimWorld_, and classic _Ultima_) while preserving all Phase 10/11 V2 Engine invariants (pure `renderer.ts`, `ViewportSnapshot` projection, 60Hz `PresentationDomain` dirty tracking, and `InputCommandQueue` routing).

## 🟢 Milestone 77: Full-Viewport Canvas Stage & Dwarf Fortress-Style Edge-Folded Icon HUD (Completed)

Eliminate permanent horizontal/vertical UI bars and header clutter in favor of a full-bleed map stage flanked by collapsible edge-pinned icon tabs.

- [x] **Zero-Vertical-Obstruction Full-Viewport Layout (`index.html`, `src/styles/layout.css`, `src/styles/hud.css`)**: Replaced the rigid 3-column grid and top/bottom horizontal bars with a `100vw × 100vh` map canvas stage (`#game-canvas-wrapper`) flanked by pointer-transparent left and right floating stacks (`#hud-left-stack`, `#hud-right-stack`).
- [x] **Edge-Pinned `44×44px` Icon Folding (`.hud-edge-tab`, `.hud-card.folded`)**: Instead of collapsing into wide `288px` headers that consume horizontal viewport space, folded HUD panels collapse flush against the left/right screen edges into compact `44×44px` icon tabs (`⏱` Chronos & Camera, `♥` Adventurer Vitals, `⚔` Gear & Quick Belt, `✦` Conditions, `⊞` Command Dock, `⌖` Tactical Scanner, `📜` Chronicle Log) with zero `min-height` bloat on `.log-card.folded`.
- [x] **Live Edge-Tab Telemetry Badges (`src/rendering/ui/hud.ui.ts`)**: Folded icon tabs display live micro-badges (`#edge-badge-time` turn/RTwP state, `#edge-badge-vitals` HP%, `#edge-badge-gear` equipped slot count, `#edge-badge-status` active condition count with hidden-when-zero behavior, `#edge-badge-scanner` inspected target indicator, and `#edge-badge-log` event counter) so players retain critical telemetry while the viewport is 95%+ unobstructed.
- [x] **Global `[Tab]` HUD Collapse/Expand & Auto-Unfold Ergonomics (`src/core/input/mouse_input.ts`, `src/rendering/ui/inspect_view.ui.ts`)**: Added `toggleAllHudPanelsFolded()` (`[Tab]` key and `#btn-toggle-hud-fold`) to collapse or expand all 7 side panels at once, while automatically unfolding `#inspect-panel` when keyboard examine mode (`[X]`) is invoked.

## 🟢 Milestone 78: Tactical Canvas Telemetry, FOV-Clipped Torchlight & Fog-of-War Alignment (Completed)

Project rich in-world tactical overlays and atmospheric lighting directly over the map canvas without violating `renderer.ts` purity.

- [x] **Pure Tactical Viewport Snapshot (`src/rendering/tactical_snapshot.ts`, `src/rendering/viewport_snapshot.types.ts`)**: Projected unit health ratios, faction hostility attitudes (`getFactionRelation` -> `player`, `hostile`, `neutral`, `friendly`), status effect pips, currently visible FOV cell coordinates (`visibleCells`), and Bresenham path preview steps (`getBresenhamLine`) into `TacticalViewportDTO` on `ViewportSnapshot`, keeping `renderer.ts` 100% ECS-free.
- [x] **FOV-Clipped Warm Torchlight & 2D Telemetry Overlay (`src/rendering/ui/tactical_overlay.ui.ts`)**: Built a 60Hz 2D canvas presenter (`#tactical-overlay`) that renders warm radial torchlight strictly clipped (`ctx.clip()`) to `tactical.visibleCells` so unexplored void stays pitch-black (`#000000`), alongside in-world micro health bars, hostility pips, animated corner-bracket cursor, and path preview dots.
- [x] **Letterboxed Fog-of-War & VFX Canvas Alignment (`src/rendering/ui/vfx_overlay.ui.ts`)**: Synchronized `#fog-overlay` CSS bounds (`left`, `top`, `width`, `height`) and internal bitmap dimensions directly with the letterboxed ROT.js `<canvas>` element and eliminated double-offsetting so explored fog-of-war dimming aligns pixel-for-pixel across all aspect ratios.

## 🟢 Milestone 79: Runtime 2D Pixel-Art Sprite Mode vs. Classic ASCII Toggle (Completed)

Allow seamless live switching between classic roguelike ASCII glyphs and 2D pixel-art tiles across every campaign.

- [x] **Procedural 32×32 Pixel-Art Tile & Sprite Atlas (`src/rendering/procedural_sprites.ts`)**: Built `buildProceduralSpriteAtlas()` to deterministically synthesize textured 32×32 pixel-art terrain tiles (stone walls, masonry, floors, doors, stairs, foliage, water, hazards) and shaded character/item silhouettes for campaigns without external PNG sprite sheets.
- [x] **Live 2D Tiles / ASCII Mode Toggle (`src/rendering/display.ts`, `src/core/settings.ts`)**: Added `renderMode: 'auto' | 'sprites' | 'ascii'` to `VisualFeedbackSettings` and implemented `toggleRenderMode()` / `isSpriteModeActive()` so clicking the `2D Tiles` / `ASCII` camera button re-initializes the ROT.js display adapter and redraws the current `ViewportSnapshot` on the fly.

## 🟢 Milestone 80: Mouse-First Tactical Controls, Context Verb Menu & Side HUD Widgets (Completed)

Unify keyboard precision with full mouse-driven inspection, movement, contextual actions, and quick-access HUD widgets.

- [x] **Non-Mutating Mouse Hover Inspection & Left-Click Smart Action (`src/core/hover_state.ts`, `src/core/input/mouse_input.ts`)**: Added hover tile/entity inspection (`setHoveredViewportCell` marking `PresentationDomain.Hud` and `Camera` dirty without mutating `GameState`) and left-click adjacent movement, bump-attack, dialogue initiation, or examine fallback.
- [x] **Floating Right-Click Context Verb Menu (`src/rendering/ui/verb_menu.ui.ts`, `UIMode.VerbMenu`)**: Transformed the verb menu into a cursor-anchored floating popover with clamped viewport coordinates, valid target illumination, and direct mouse click routing through `InputCommandQueue`.
- [x] **Ultima Mini Paper-Doll, Quick Belt & RimWorld Alert Ribbons (`src/rendering/ui/hud_paperdoll.ui.ts`, `src/rendering/ui/hud_alerts.ui.ts`, `src/rendering/ui/hud_dock.ui.ts`, `src/rendering/ui/hud.ui.ts`)**: Added an interactive 5-slot equipment paper-doll (`Head`, `MainHand`, `OffHand`, `Body`, `Accessory`), a `[1]–[5]` quick-use consumable belt, top-right clickable status/hazard/hostile alert ribbons, a 2-column command dock with live hotkey badges, and `All | Combat | Speech | World` Chronicle Log filter tabs.

## 🟢 Milestone 81: Dwarf Fortress Steam / Dark Fantasy CRPG Material & HUD Consolidation Overhaul (Completed)

Replace generic web-dashboard styling (frosted glass, soft rounded cards, neon cyan accents, and stacked accordion headers) with forged dark-fantasy CRPG plates and headerless game gauges.

- [x] **Forged Iron, Stone & Burnished Brass Material Palette (`src/styles/core.css`, `src/styles/hud.css`, `src/styles/modals.css`, `src/styles/inventory.css`)**: Replaced translucent glass (`backdrop-filter: blur`) and `#00ffff` neon cyan with opaque dark iron/slate surfaces (`#121419` / `#16181f`), `0px–1px` sharp corners, double-beveled burnished brass (`#9e782f` / `#dfb15b`) and chiseled stone (`#3d4350`) borders with `1px` pitch-black pixel keylines, raised 3D bevel buttons, and hard pixel drop shadows (`3px 3px 0 #000`).
- [x] **CRPG Typography Pairing (`index.html`, `src/styles/core.css`)**: Replaced `'Outfit'` with **`Cinzel`** (carved serif display for area banners, drawer headers, and modal titles) paired with **`JetBrains Mono`** for all HUD gauges, tabular numbers, sockets, and logs.
- [x] **Consolidated Headerless Vitals & Chronos Gauge Plate (`index.html`, `src/styles/hud.css`, `src/rendering/ui/hud.ui.ts`)**: Merged the left-side `Chronos & Camera`, `Adventurer Vitals`, and `Conditions` accordion cards into a single compact, headerless **Adventurer & Chronos Gauge Plate** featuring an engraved area banner (`⚜`), segmented **HP** and **XP** recessed troughs with 10% tick notches (`.bar-ticks`), sunken `ATK / DEF / SAT` sockets, inline auto-collapsing condition pills, and a tactile beveled time/camera strip.
- [x] **Sunken `5×2` Equipment & Quick-Belt Socket Strip (`src/rendering/ui/hud_paperdoll.ui.ts`, `src/styles/hud.css`)**: Aligned the 5 equipment slots (`HEAD`, `MAIN`, `OFF`, `BODY`, `ACC`) and 5 `[1]–[5]` quick-belt slots into a `5×2` grid of `44×44px` recessed iron/stone sockets (`inset 2px 2px 0 #000`) with gilded brass framing on equipped/filled items.

---

# 🚀 Phase 13: Pluggable Ruleset Cartridge Architecture & `classic` Extraction _(Branch: `master`)_

**Goal:** Transform the engine into a multi-ruleset "Console + Cartridge" architecture following the **Rule of Three**. Extract the existing Milestones 1–81 mechanics into the `"classic"` ruleset cartridge (`src/rulesets/classic/`), establish the Domain-Driven `RulesetContract` dependency-injection boundary, and upgrade the game/editor UX to `New Game -> Ruleset Selection -> Campaign Selection` on `master` before branching individual ruleset cartridges.

## 🟢 Milestone 82: Domain-Driven `RulesetContract`, Component Namespacing & DI Registry (Completed)

Define the explicit runtime contract between the ruleset-agnostic Console Engine (`src/core/`, `src/map/`, `src/systems/`, `src/rendering/`) and pluggable Ruleset Cartridges (`src/rulesets/<rulesetId>/`).

- [x] **Ruleset Contract & Port Interfaces (`src/types/ruleset.types.ts`, `src/rulesets/ruleset.types.ts`)**: Define `RulesetId` (`'classic' | 'dnd35e'`), `RulesetMetadata` (name, description, tactical features, supported campaign schema version), and the `RulesetContract` interface covering:
  - _Entity Hydration & Validation Ports_: `validateCampaignRuleset()`, and ruleset-scoped view group descriptors (`getEditorViewGroups()`) for the Campaign Editor.
  - _Combat, Check & Damage Resolution Ports_: `resolveMeleeAttack()`, `processDamage()`, `grantActorXp()`, and `getEffectiveActorStats()`.
  - _UI & Presentation Ports_: `projectHudVitals()` and `getEditorViewGroups()`.
- [x] **Runtime Cartridge Registry & DI Lookup (`src/rulesets/registry.ts`)**: Implement `registerRuleset(contract)`, `getRuleset(rulesetId): RulesetContract`, `getAllRulesets()`, and `getActiveRuleset(state: GameState): RulesetContract` (resolved from `state.campaign.manifest.rulesetId`), eliminating raw ruleset `switch` statements in core engine loops.
- [x] **ECS Component Slice Isolation (`src/types/components.types.ts`)**: Added `ComponentType.RulesetData = 'RulesetData'` and `RulesetDataComponent` (`rulesetId: RulesetId`, `data: Readonly<Record<string, unknown>>`) so `classic` and `dnd35e` never pollute a single monolithic `CombatStatsComponent` with dozens of optional fields under `exactOptionalPropertyTypes: true`.

## 🟢 Milestone 83: `classic` Ruleset Cartridge Extraction (`src/rulesets/classic/`) (Completed)

Encapsulate the existing Milestones 1–81 combat, progression, status, and character-sheet implementation into the canonical `"classic"` cartridge with zero behavioral regressions.

- [x] **`classic` Combat, Stats & Progression Adapter (`src/rulesets/classic/classic_combat.ts`, `classic_stats.ts`, `classic_ruleset.ts`)**: Moved the existing flat `ATK - DEF` combat formula, level/XP progression, damage pipeline, and equipment stat aggregation behind the `classic` `RulesetContract` implementation (`classicRulesetContract`).
- [x] **`classic` UI & Editor Descriptors (`src/rulesets/classic/classic_stats.ts`, `classic_ruleset.ts`)**: Bound HUD `ATK / DEF` socket projection (`projectClassicHudVitals`) and Campaign Editor view groups to `"classic"`.
- [x] **Core Loop Delegation & Zero-Regression Audit (`src/utils/stats.ts`, `src/systems/combat.system.ts`, `src/systems/damage.system.ts`, `src/systems/death.system.ts`, `src/rendering/ui/hud.ui.ts`)**: Routed `getEffectiveStats()`, `processMeleeAttackIntent()`, `processDamageSystem()`, `grantXp()`, and `renderPlayerStats()` through `getActiveRuleset(state)` and verified that all existing unit/integration tests and campaigns (`default`, `megacampaign`, `shroudgarde`) pass `./verify.sh` with 0 errors.

## 🟢 Milestone 84: `New Game -> Ruleset Selection -> Campaign Selection`, Editor Scoping & `dnd35e` Skeleton (Completed)

Surface ruleset selection to players and campaign authors and register the `dnd35e` cartridge entry point before branching `DND35`.

- [x] **Campaign Manifest `rulesetId` Binding (`src/types/campaign/meta.ts`, `public/data/campaigns.json`, `public/data/campaigns/*/manifest.json`)**: Added `rulesetId: RulesetIdSchema.default('classic')` to `CampaignManifestSchema` and `CampaignRegistryEntrySchema` and tagged `default`, `megacampaign`, and `shroudgarde` as `"classic"`.
- [x] **Two-Stage Title Screen Flow (`index.html`, `src/rendering/ui/menus.ui.ts`, `src/core/session_controller.ts`)**: Upgraded the New Game flow to **New Game $\rightarrow$ Ruleset Selection (`Classic Roguelike` vs. `Dungeons & Dragons 3.5e (SRD)`) $\rightarrow$ Campaign Selection** (filtering available campaigns by the chosen `rulesetId` via `UIMode.RulesetSelect`).
- [x] **Ruleset-Scoped Campaign Editor & `dnd35e` Cartridge Skeleton (`src/rendering/editor/editor_toolbar.ts`, `src/rendering/editor_ui.ts`, `src/editor/campaign_validator.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`)**: Added the `#editor-ruleset-badge` indicator in the Campaign Editor toolbar, scoped editor view groups and deep campaign validation to the active ruleset, and registered the `dnd35e` cartridge skeleton (`dnd35eRulesetContract` projecting `BAB` and `AC` HUD sockets) ready for feature development on the `DND35` branch.

---

# 🚀 Phase 14: D&D 3.5e Cartridge Layer 1 — Core Math, Dice, Ability & Typed Modifier Engine _(Branch: `DND35`)_

**Goal:** Implement the foundational D&D 3.5e mathematical primitives inside `src/rulesets/dnd35e/`: seeded `d20` / `NdX+C` expressions, abstract multiplier rules, the 6-Ability Score / Nonability / Damage / Drain model, and the 18-type Bonus Stacking Resolver.

## 🟢 Milestone 85: Seeded Dice Expression Evaluator, `d20` Bounds & D&D Multiplier Math (Completed)

Establish deterministic dice and rounding primitives in `src/rulesets/dnd35e/math/`.

- [x] **Seeded `NdX+C` & Roll-Keep Expression Evaluator (`src/rulesets/dnd35e/math/dice.ts`)**: Parse and roll arbitrary dice expressions (`1d8+3`, `2d6`, `4d6kh3`) through `src/core/rng.ts`, returning `DiceRollResult` (`total`, `rolls: ReadonlyArray<number>`, `keptRolls`, `flatModifier`, `expression`) for combat log and inspect breakdowns.
- [x] **Configurable `d20` Roll Primitive (`rollD20` in `src/rulesets/dnd35e/math/dice.ts`)**: Implement `D20RollMode` (`'attack' | 'save' | 'skill_check' | 'ability_check' | 'caster_level_check' | 'initiative'`), enforcing natural `1` automatic failure and natural `20` automatic success _only_ for `'attack'` and `'save'` modes (`/docs/rules/core_mechanics.md`).
- [x] **D&D Floor Rounding & Abstract Multiplier Combinator (`src/rulesets/dnd35e/math/multipliers.ts`)**: Implement universal floor rounding (`Math.floor`) and `combineAbstractMultipliers(multipliers: ReadonlyArray<number>): number` enforcing $M_{\text{total}} = 1 + \sum (M_i - 1)$ (so two $\times 2$ modifiers combine into $\times 3$, and $\times 2 + \times 1.5 \rightarrow \times 2.5$) vs. `combineRealWorldMultipliers()` (sequential multiplication for weight, distance, and light radius per `/docs/rules/combat/multiplying.md`).

## 🟢 Milestone 86: Six-Ability Score Model, Nonabilities (`null`) & Ability Damage/Drain State (Completed)

Implement the D&D 3.5e ability score model in `src/rulesets/dnd35e/abilities.ts` and `src/rulesets/dnd35e/types/dnd35e.types.ts`.

- [x] **Ability Score Component & Modifier Formula (`AbilityScoresRecord`)**: Store `Record<AbilityId, AbilityScoreState>` (`str`, `dex`, `con`, `int`, `wis`, `cha`) with `{ base: number | null, inherentBonus: number, damage: number, drain: number, tempPenalty: number }` and compute $\text{Mod} = \lfloor (\text{EffectiveScore} - 10) / 2 \rfloor$.
- [x] **Nonability (`null`) vs. Score `0` Collapse Semantics**:
  - When `base === null` (Nonability `—`): return modifier `+0`, block Ability Damage/Drain/Penalties to that ability, grant Fortitude save immunity (unless `affectsObjects: true`) and route `Concentration` checks to `CHA` when `CON === null` (Undead/Constructs), and grant mind-affecting immunity when `INT === null`.
  - When an active score drops to `0` from Damage/Drain: apply `Dead` if `CON <= 0`, `Paralyzed`/`Helpless` if `STR <= 0` or `DEX <= 0`, and `Unconscious` if `INT <= 0`, `WIS <= 0`, or `CHA <= 0` (`/docs/rules/special-abilities/ability-score-loss.md`).
- [x] **Temporary Penalty Floor vs. Damage/Drain Tracking**: Enforce that temporary Ability Penalties (`Ray of Enfeeblement`, `Fatigued`, `Entangled`) cannot reduce an effective ability score below `1`, whereas `damage` ($\lfloor \text{damage}/2 \rfloor$ penalty, heals `1 pt/day` on 8-hour rest) and `drain` (permanent reduction) can reduce effective scores to `0`.

## 🟢 Milestone 87: Typed Bonus Stacking Resolver & Contextual Stat Queries (Completed)

Build the query-time 18-type modifier stacking engine in `src/rulesets/dnd35e/modifiers.ts`.

- [x] **Typed Modifier Collector & Stacking Matrix (`resolveTypedModifiers`)**: Group active `StatModifier` entries by `BonusType` (`alchemical`, `armor`, `circumstance`, `competence`, `deflection`, `dodge`, `enhancement`, `inherent`, `insight`, `luck`, `morale`, `natural_armor`, `profane`, `racial`, `resistance`, `sacred`, `shield`, `size`, `untyped`).
  - Apply `Math.max` per non-stacking positive bonus type; sum `dodge` (unless `loseDexToAC`), differently-sourced `circumstance`, `untyped`, and all penalties (`value < 0`).
  - Fold compound `armor_enhancement`, `shield_enhancement`, and `natural_armor_enhancement` into their parent `armor`/`shield`/`natural_armor` bonus before comparing sources; treat Masterwork weapon `+1` attack as an `enhancement` bonus so it never stacks with magical weapon enhancement (`/docs/rules/combat/armor-class.md`).
  - Support dynamic suppression (`Antimagic Field` suppresses `magical`, `spell`, `su`, and `sp` source tags at query time without mutating stored components).
- [x] **Contextual Stat & AC Triplet Query Engine (`computeEffectiveAC`)**: Compute `fullAC`, `touchAC` (stripping `armor`, `shield`, `natural_armor` and their enhancements), and `flatFootedAC` (stripping positive `DEX` and `dodge` bonuses unless the entity has `Uncanny Dodge`), plus itemized `ACBreakdownDTO` tooltips for the HUD and inspect panel.

---

# 🚀 Phase 15: D&D 3.5e Cartridge Layer 2 — Progression Curves, Entity Chassis & Check Resolution _(Branch: `DND35`)_

**Goal:** Build the mathematical curve evaluators for Base Attack Bonus, Base Saving Throws, Hit Dice/Level aggregation, generic Skill/Ability/Opposed check resolution, and prerequisite AST validation inside `src/rulesets/dnd35e/`.

## 🟢 Milestone 88: Progression Curve Evaluators & Multi-Source Hit Dice / Level Chassis (Completed)

Provide pure mathematical progression curves in `src/rulesets/dnd35e/progression.ts` that any class or creature type definition in JSON can reference.

- [x] **Base Attack Bonus (`BAB`) & Iterative Step-Down Evaluators**: Implement `full` ($L$), `three_quarters` ($\lfloor 0.75L \rfloor$), and `half` ($\lfloor 0.5L \rfloor$) BAB curve formulas and `getIterativeBabSequence(totalBab): ReadonlyArray<number>` returning `[B, B-5, B-10, B-15]` (capped at 4 iterative attacks while $B - 5k \ge 1$; temporary attack bonuses never grant extra iterative attacks).
- [x] **Base Saving Throw Curve Evaluators**: Implement `good` ($2 + \lfloor L/2 \rfloor$) and `poor` ($\lfloor L/3 \rfloor$) progression formulas for `Fortitude`, `Reflex`, and `Will`.
- [x] **Multi-Source Hit Dice (`HD`) & Effective Character Level (`ECL`) Aggregator**: Sum `racialHitDice` and `classLevels` into unified `totalHD`, `totalBab`, base saves, XP thresholds ($\frac{\text{ECL}(\text{ECL}-1)}{2} \times 1000$), general feat entitlement ($\lfloor \text{HD} / 3 \rfloor + 1$), ability increase entitlement ($\lfloor \text{HD} / 4 \rfloor$), and Hit Point pools ($d4, d6, d8, d10, d12$ + `CON` mod per HD, minimum `1` HP/HD, maximized at 1st HD).

## 🟢 Milestone 89: Generic Skill Check, Ability Check, Opposed Roll & Prerequisite Engine (Completed)

Unify non-combat and tactical check resolution in `src/rulesets/dnd35e/skills.ts` and `src/rulesets/dnd35e/prerequisites.ts`.

- [x] **Skill & Ability Check Resolver (`resolveSkillCheck`)**:
  - Support half-rank storage (`0.5` per skill point on cross-class skills) while using whole ranks ($\lfloor \text{Ranks} \rfloor$) for check rolls: $d20 + \lfloor \text{Ranks} \rfloor + \text{KeyAbilityMod} + \text{Synergy} + \text{TypedBonuses} + (\text{ACP} \times \text{acpMultiplier})$ against static DCs.
  - Enforce `trainedOnly` gates ($\lfloor \text{Ranks} \rfloor < 1 \rightarrow$ blocked), rank caps ($\text{HD} + 3$ class vs. $(\text{HD} + 3)/2$ cross-class), declarative 5-rank Synergy bonuses (`+2` untyped when $\lfloor \text{Ranks} \rfloor \ge 5$), and `acpMultiplier: 0 | 1 | 2` (handling Swim's `2 × ACP` per `/docs/rules/skills/skill-basics.md`).
- [x] **Opposed Check & `Take 10 / Take 20` Mechanics (`resolveOpposedCheck`)**: Resolve symmetric opposed rolls (ties broken by higher total modifier, then seeded `rng` coin flip) and threat-gated `Take 10` (blocked when threatened/distracted or on `Use Magic Device`) and `Take 20` (blocked when failure carries a penalty/trap trigger; consumes $20\times$ action duration).
- [x] **Generic Prerequisite AST Evaluator (`evaluatePrerequisiteAST`)**: Validate recursive requirement trees (`and`, `or`, `not`, `min_ability`, `min_bab`, `min_skill_ranks`, `has_feat`, `has_tag`, `min_caster_level`, `size_in`) for feat selection, item usage, and Campaign Editor validation.

---

# 🚀 Phase 16: D&D 3.5e Cartridge Layer 3 — Spatial Grid, Footprint/Reach, Cover & Multi-Spectrum Senses _(Branch: `DND35`)_

**Goal:** Implement D&D 3.5e 5-ft tactical geometry, reach rings, cover/flanking raycasting, and multi-spectrum senses in `src/rulesets/dnd35e/spatial/`.

## 🟢 Milestone 90: 5-Foot Grid Metric, `1-2-1-2` Diagonals, Multi-Tile Footprints & Reach Rings (Completed)

Enforce tabletop spatial geometry in `src/rulesets/dnd35e/spatial/grid_geometry.ts`.

- [x] **`1-2-1-2` Diagonal Distance Metric & Hard-Corner Blocking (`measureDnD35DistanceFt`, `isDiagonalStepBlockedByHardCorner`)**: Alternate diagonal step costs (`5 ft`, `10 ft`, `5 ft`, `10 ft` via $\text{orth} + \lfloor 1.5 \times \text{diag} \rfloor$) and block diagonal movement/melee across any tile corner adjacent to an impassable wall.
- [x] **9-Tier Creature Size Matrix & $N\times N$ Footprints (`SIZE_METRICS`, `computeFootprintSquares`)**:
  - Support `Large` ($2\times 2$), `Huge` ($3\times 3$), `Gargantuan` ($4\times 4$), and `Colossal` ($6\times 6$) footprints alongside `Tiny`, `Diminutive`, and `Fine` (`0 ft` natural reach: they do not threaten adjacent squares and must enter a target's tile to make a melee attack).
- [x] **Threatened Reach Rings & Dead Zones (`computeThreatenedSquares`)**: Compute threatened squares from `[minReachFt, maxReachFt]` (distinguishing `Large (tall)` `[5, 10]` from `Large (long)` `[5, 5]`, and reach weapons `[10, 10]` with adjacent dead zones unless `hasFlexibleReach: true`).

## 🟢 Milestone 91: Cover, Soft Cover, Flanking & Line-of-Effect Raycasting (Completed)

Derive tactical positioning modifiers directly from grid geometry in `src/rulesets/dnd35e/spatial/cover_senses.ts`.

- [x] **Corner-to-Corner Cover & Soft Cover Raycaster (`evaluateCover`)**:
  - Grant `Cover` (`+4` AC, `+2` Reflex saves, and **prevent executing Attacks of Opportunity** against the covered target), `Improved Cover` (`+8` AC, `+4` Reflex), and `Total Cover` (blocks Line of Effect).
  - Grant creature-interposed `Soft Cover` (`+4` AC vs. ranged attacks, no Reflex bonus, does not block AoOs).
- [x] **Flanking Geometry Resolver (`isFlankingTarget`)**: Grant `+2` melee attack bonus when an attacker and an allied combatant who **actively threatens** the defender occupy opposite sides or opposite corners across the defender's center.

## 🟢 Milestone 92: Illumination States, Multi-Spectrum Senses & Concealment Miss-Chance (Completed)

Decouple ambient lighting from observer sensory capabilities in `src/rulesets/dnd35e/spatial/cover_senses.ts`.

- [x] **Per-Tile Illumination & Multi-Spectrum Sensory Resolver (`evaluateConcealmentAndSenses`)**: Evaluate `Bright`, `Shadowy` (`20%` Concealment), and `Darkness` (`50%` Total Concealment) across `lowLightVision`, `darkvisionRangeFt`, `blindsenseRangeFt`, `blindsightRangeFt`, `tremorsenseRangeFt`, and `scentRangeFt`.
- [x] **Concealment (`20%`) & Total Concealment (`50%`) Combat & AoO Gating**: Compute net Concealment miss-chance % for any attacker-defender pair, enforce `Blind-Fight` miss-chance re-roll hooks, and **prohibit executing Attacks of Opportunity against any target with Total Concealment (`50%`)**.

---

# 🚀 Phase 17: D&D 3.5e Cartridge Layer 4 — Round Lifecycle, 5-Tier Action Economy & Interrupt (`AoO`) Engine _(Branch: `DND35`)_

**Goal:** Reconcile D&D 3.5e's 6-second tactical round, 5-tier action economy (`Full-Round`, `Standard`, `Move`, `Swift`, `Immediate`), and LIFO Pre-Action Attack of Opportunity (`AoO`) interrupts with responsive grid-roguelike movement.

## 🟢 Milestone 93: 6-Second Combat Round Lifecycle, Initiative, 5-Tier Action Budget & Swift/Immediate Debt (Completed)

Manage round transitions and granular action/movement budgets in `src/rulesets/dnd35e/action_economy.ts`.

- [x] **5-Tier Action Budget, Swift vs. Immediate Cross-Turn Debt & Action Substitutions (`DnD35ActionBudget`)**:
  - Track `standardRemaining`, `moveRemaining`, `movementRemainingFt`, `swiftRemaining`, `immediateUsedOffTurn`, `fiveFootStepAvailable`, and `distanceMovedThisRoundFt`.
  - Enforce `Immediate` off-turn debt consuming the actor's `Swift` action on their next turn, `Standard -> Move` downgrades, and `5-Foot Step` gating (`distanceMovedThisRoundFt === 0` and non-difficult terrain).

## 🟢 Milestone 94: LIFO Pre-Action Interrupt Stack & Attack of Opportunity (`AoO`) Pipeline (Completed)

Allow threatening entities to interrupt provoking actions before primary execution in `src/rulesets/dnd35e/action_economy.ts`.

- [x] **LIFO Reaction Stack & Per-Opportunity / Movement Deduplication (`filterAndOrderAoOReactors`)**:
  - Order reactions in **Last-In, First-Out (LIFO)** order bounded by `MAX_AOO_CHAIN_DEPTH = 4`.
  - Enforce `Combat Reflexes` (`max(1, 1 + dexMod)` AoOs and flat-footed AoO permission), Cover/Total Concealment suppression, **One AoO Per Opportunity**, and **Movement Provocation Deduplication** per round.

---

# 🚀 Phase 18: D&D 3.5e Cartridge Layer 5 — Physical Combat, Maneuvers, Typed Damage/DR & Vitality _(Branch: `DND35`)_

**Goal:** Implement full D&D 3.5e attack sequences, two-weapon/natural weapon matrices, multi-step special combat maneuvers, typed damage mitigation (`DR`, Energy Resistance, Object Hardness), `-1..-9 / -10` vitality, saving throws, and canonical conditions in `src/rulesets/dnd35e/combat/`.

## 🟢 Milestone 95: Attack Roll, Critical Confirmation, Iterative/TWF/Natural Weapons & Encumbrance Solver (Completed)

Implement physical attack sequences and equipment constraints in `src/rulesets/dnd35e/combat/attack_resolver.ts`.

- [x] **AC Triplet Targeting & Critical Confirmation Pipeline (`resolveAttackRoll`)**: Resolve Concealment miss-chance % (with `Blind-Fight` re-roll), roll $d20 + \text{AtkBonus} \ge \text{TargetAC}$, check `critThreatMin`, roll Critical Confirmation, and multiply base weapon dice + flat bonuses using `combineAbstractMultipliers` while leaving extra/precision dice unmultiplied (and stripping precision dice against concealment or crit-immune targets).
- [x] **Full Attack Iteratives, Two-Weapon Fighting & Natural Weapons (`buildFullAttackSequence`)**: Apply TWF penalties (`-6/-10`, `-4/-4` light, `-2/-2` TWF + light), handedness `STR` multipliers (`1.5x` two-handed, `0.5x` off-hand, `1.0x` negative `STR`), and secondary natural weapon penalties (`-5` or `-2` with `Multiattack`).
- [x] **Carrying Capacity & Encumbrance Solver (`computeEncumbranceState`)**: Compute Light/Medium/Heavy load thresholds from `STR` and size category, enforcing Max DEX, ACP, and encumbered speed (`30 ft -> 20 ft`).

## 🟢 Milestone 96: Special Combat Maneuvers, Typed Damage Mitigation (`DR`, Resistance, Hardness), Vitality & Saves (Completed)

Implement maneuvers, damage mitigation, and condition state machines in `src/rulesets/dnd35e/combat/damage_vitality.ts` and `maneuvers_conditions.ts`.

- [x] **Multi-Step Special Combat Maneuvers (`resolveCombatManeuver`)**: Implement the 4-step maneuver pipeline (Provocation check, Preliminary Touch Attack, Opposed Roll with `4 × sizeRank` special size modifiers, and `-20` single-limb `Improved Grab`) for `Trip`, `Bull Rush`, `Disarm`, `Sunder`, `Overrun`, `Grapple`, and `Feint`.
- [x] **Typed Damage Mitigation (`mitigateIncomingDamage`)**: Evaluate Immunity (`0x`), Vulnerability (`+50%`), boolean `DamageReductionRule` (automatically suppressing secondary injury riders when `DR` reduces physical damage to `0`), Energy Resistance, and Object Hardness.
- [x] **Lethal vs. Nonlethal HP, Dying (`-1..-9`) & Condition Escalation (`evaluateVitalityStatus`, `rollDyingStabilization`, `resolveSavingThrow`, `applyConditionWithEscalation`)**: Track `Disabled` (`0 HP`), `Dying` (`-1..-9 HP` with `10%` stabilization), `Dead` (`-10 HP`, or `0 HP` for `CON: null` Undead/Constructs), `Evasion`/`Improved Evasion` saves, and condition escalation (`Shaken -> Frightened -> Panicked`, `Fatigued -> Exhausted`).

---

# 🚀 Phase 19: D&D 3.5e Cartridge Layer 6 — Vancian/Spontaneous Spellcasting, AoE Geometry & 8-Hour Rest _(Branch: `DND35`)_

**Goal:** Build the apex `dnd35e` systems for `Ex`/`Sp`/`Su` capabilities, Vancian prepared vs. spontaneous spellcasting, Line-of-Effect AoE geometry, and roguelike 8-hour rest & open-slot preparation in `src/rulesets/dnd35e/magic/`.

## 🟢 Milestone 97: Capability Classification (`Ex`/`Sp`/`Su`), Vancian/Spontaneous Engine & 7-Step Cast Pipeline (Completed)

Unify spells, supernatural/spell-like abilities, and AoE templates in `src/rulesets/dnd35e/magic/spellcasting.ts` and `aoe_rest.ts`.

- [x] **Capability Classification Matrix & Bonus/Spontaneous Slots (`CAPABILITY_RULES`, `computeBonusSpellSlots`, `convertPreparedSlotSpontaneously`)**: Enforce `Spell / Ex / Sp / Su` rules, minimum casting ability gate ($\text{Score} \ge 10 + L$), bonus daily spell slots ($\lfloor (\text{Mod} - L + 4)/4 \rfloor$ for $L \ge 1$, `0` for cantrips), and spontaneous cure/inflict conversion.
- [x] **7-Step Cast Resolution & Line-of-Effect AoE Geometry (`resolveCastPipeline`, `computeAoEAffectedSquares`)**: Execute Antimagic/Silence check, Deafened 20% verbal / Arcane Spell Failure %, Cast Defensively ($\text{DC } 15 + L$) or AoO + damage Concentration ($\text{DC } 10 + \text{Dmg} + L$), `Burst` / `Spread` / `Cone` / `Line` AoE geometry, Spell Resistance ($d20 + \text{CL} \ge \text{SR}$), and Saving Throw DC ($10 + L + \text{KeyMod}$).

## 🟢 Milestone 98: Roguelike 8-Hour Rest, Recent-Cast Retention & 15-Minute Open Slot Preparation (Completed)

Connect tabletop recovery mechanics to roguelike dungeon pacing in `src/rulesets/dnd35e/magic/aoe_rest.ts`.

- [x] **8-Hour Recent Cast Retention & Open Slot Preparation (`resolveEightHourRest`, `prepareOpenSpellSlot`)**: Enforce the **Recent Casting Limit** (`restCompletionTurn - castTimestampTurn < 4800` rounds cannot be refreshed), 15-minute (`150` rounds) open-slot preparation, natural HP healing ($\text{1 HP} \times \text{Level}$), and `1 pt` Ability Damage recovery.

---

# 🚀 Phase 20: D&D 3.5e Content Showcase Campaign & Cartridge Integration _(Branch: `DND35` -> Merge to `master`)_

**Goal:** Wire the 6-Layer D&D 3.5e engine into `dnd35eRulesetContract`, provide SRD 3.5e archetypes and the `dnd35e-crypt` showcase campaign, and verify 100% green checks across the 8-step verification pipeline.

## 🟢 Milestone 99: SRD Archetype Registry, `dnd35eRulesetContract` Integration & `dnd35e-crypt` Showcase Campaign (Completed)

Deliver the playable D&D 3.5e showcase campaign and cartridge integration in `src/rulesets/dnd35e/` and `public/data/campaigns/dnd35e-crypt/`.

- [x] **SRD 3.5e Archetype Registry & `dnd35eRulesetContract` Integration (`src/rulesets/dnd35e/srd_archetypes.ts`, `srd_registry.ts`, `dnd35e_ruleset.ts`)**: Wired `computeDnD35eEffectiveStats`, `resolveDnD35eMeleeAttack` ($d20 + \text{Atk} \ge \text{AC}$, crit confirmation, weapon dice + STR), `processDnD35eDamage` (`DR 5/bludgeoning`, Energy Resistance, `-1..-9 / -10` vitality, `CON: null` Undead 0 HP destruction), `grantDnD35eXp` (triangular XP table), and `projectDnD35eHudVitals` (`ECL`, `BAB`, `Full AC`).
- [x] **Playable `dnd35e-crypt` Showcase Campaign & 6-Layer Test Suite (`public/data/campaigns/dnd35e-crypt/`, `tests/dnd35e_cartridge.test.ts`)**: Registered _"The Sunless Reliquary (SRD 3.5e)"_ under `"rulesetId": "dnd35e"` and verified all 6 layers (`Milestones 85–99`) in `tests/dnd35e_cartridge.test.ts` and `./verify.sh`.

## 🟢 Milestone 100: Three-Tier Separation & Per-Cartridge System Content Schemas (Completed)

Formalize the strict 3-tier boundary between the TypeScript Rules Engine (mechanical building blocks), declarative System Content ("Core Rulebooks" shared across all campaigns of a ruleset), and declarative Campaign Content ("Adventure Modules").

- [x] **Per-Cartridge System Content Schemas (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`, `src/types/campaign/system_content.ts`, `src/types/campaign.types.ts`)**: Isolated ruleset-specific schemas (`DnD35ArchetypeSchema`, `DnD35ClassSchema`, `DnD35SkillSchema`, `DnD35FeatSchema`, `DnD35SpellSchema`) inside `src/rulesets/dnd35e/types/`, keeping the shared `CampaignDataSchema.systemContent` as an opaque/generic ruleset dictionary (`Record<string, unknown>`) to preserve clean cartridge boundaries without schema contamination.
- [x] **Contract-Driven System File Manifests & Parsing (`src/types/ruleset.types.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`, `src/rulesets/classic/classic_ruleset.ts`)**: Extended `RulesetContract` with `getSystemContentFiles()` and `parseSystemContent()`, enabling each cartridge to authoritatively declare its own system files and validate them against internal schemas. Removed dummy `feats.json` and `spells.json` from `classic/`.
- [x] **Declarative System Content Registries (`public/data/rulesets/dnd35e/`, `public/data/rulesets/classic/`)**: Extracted all SRD 3.5e archetypes (`player`, `skeleton`, `wolf`, `ogre`, `troll`, `default_creature`), core classes (`fighter`, `rogue`, `cleric`, `wizard`), skills, feats, and spells into pure declarative JSON under `public/data/rulesets/dnd35e/` and deleted the hardcoded `src/rulesets/dnd35e/srd_archetypes.ts` module.
- [x] **Two-Layer Data Inheritance Pipeline (`src/core/loader.ts`, `tests/helpers.ts`, `scripts/run-validator.ts`, `scripts/bootstrap-campaign.ts`, `src/rulesets/dnd35e/srd_registry.ts`)**: Updated the runtime loader, headless test fixture loader, and CLI campaign validator to load and validate `public/data/rulesets/<rulesetId>/` system content dynamically via `ruleset.getSystemContentFiles()` beneath `public/data/campaigns/<campaignId>/` campaign content (`{ ...systemCategory, ...campaignCategory }`), allowing campaigns to inherit or override system-level archetypes, items, entities, and statuses seamlessly.

## 🟢 Milestone 101: Campaign Editor Ruleset Cartridge Parity & Developer Tooling Integration (Completed)

Bring the top-tier Campaign Creator (`src/editor/`, `src/rendering/editor/`, and `src/rendering/ui/`) to 100% parity with the 2-tier (`Ruleset -> Campaign`) and 3-tier (`Rules Engine -> System Content -> Campaign Content`) architecture.

- [x] **Ruleset-Aware Campaign Creation Modal (`src/rendering/editor/editor_toolbar.ts`, `src/editor/workspace_file_service.ts`)**: Replaced the legacy binary confirmation prompt with a 2-step modal dialog allowing authors to select their target Ruleset (`🐉 D&D 3.5e` or `⚔️ Classic`) and starting template (`Blank Slate` seeded with ruleset archetypes, or clone an existing campaign like `dnd35e-crypt` or `default`).
- [x] **Bundled Disk Campaign Browser on Workspace Splash (`src/rendering/editor/editor_workspace.ts`)**: Upgraded the welcome/empty screen to present both saved browser IndexedDB workspaces and disk campaigns fetched via `loadCampaignRegistry()`, organized neatly by ruleset with 1-click loading into the editor.
- [x] **Dynamic ViewGroup Resolution (`src/rendering/editor/editor_sidebar.ts`, `src/rendering/editor/editor_workspace.ts`)**: Replaced static array lookups with `getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS)` across sidebar and workspace tabs so ruleset-specific views and tabs render without desync.
- [x] **System Archetype Reference Resolution (`src/rendering/ui/ui_utils.ts`)**: Added `archetypeId` option resolution in `getReferenceOptions()` pulling keys from `doc.systemContent.archetypes` with the `[ARCHETYPE]` badge, giving entity forms guided auto-complete dropdowns instead of raw text inputs.
- [x] **Automated Tier 2 System Content Re-Hydration (`src/core/loader.ts`, `src/editor/workspace_file_service.ts`, `src/rendering/ui/zod_form_renderer.ts`)**: Exported `loadRulesetSystemContent(rulesetId)` from `loader.ts` and wired automated re-hydration during blank campaign creation, ZIP package extraction, and runtime ruleset switches in the Manifest form.

---

# 🚀 Phase 21: Pre-Content Engine & Cartridge Primitives (Console Reuse + Cartridge Mechanics) _(Branch: `DND35`)_

**Goal:** Implement the 18 missing primitives (`PRIM-1.1` through `PRIM-5.1`) isolated during the Pass 2 System Content Audit and Wave 3 _Incursion_ Comparative Analysis (`docs/audits/dnd35e_rules_audit.md`) before authoring large-scale SRD content. In strict accordance with **AGENTS.md Rule 16** and **DECISIONS.md #10** (_Generic Console Systems over Cartridge Silos_), generalizable primitives are elevated to the shared Core Console (`src/types/`, `src/systems/`), while tabletop-specific math and schema rules reside in the D&D 3.5e Cartridge (`src/rulesets/dnd35e/`).

### Architectural Boundary Matrix (Console vs. Cartridge vs. System Content)

| Capability / Primitive | Target Tier | Architectural Location | Rationale (AGENTS.md Rules 16–18 & DECISIONS.md #7/#10–#12) |
| :--- | :---: | :--- | :--- |
| **Tag-Based Conditional Modifiers (`PRIM-1.7`)** | **Console + Cartridge** | `src/systems/reaction.system.ts` (`getEntityMatcherData`) + `src/rulesets/dnd35e/modifiers.ts` | Entity/effect tag matching (`targetTagsAll`, `targetTagsAny`, `effectTagsAny`) is ruleset-agnostic; 18-type bonus stacking remains in `dnd35e`. |
| **Layered Property & Stat Overlays (`PRIM-1.5`, `PRIM-2.3`)** | **Console + Cartridge** | `OverlayStackComponent` / property projection in `src/types/` + `src/rulesets/dnd35e/` | Composable, non-destructive override/modifier layers (Templates, *Wild Shape*, *Polymorph*, *Enlarge Person*) apply to any symmetrical Actor without mutating base state. |
| **Anatomical Equipment Slot Topologies (`M105`)** | **Console + Content** | `EquipmentSlotInstance[]` in `src/types/components.types.ts` + `EquipmentSlotEnum` in `src/types/campaign/item.ts` | Supports arbitrary actor anatomies natively (2-armed humanoid, 0-handed dog/quadruped, 6-armed/0-footed Marilith) via relational slot arrays rather than hardcoded human slot keys. |
| **Standing Tactical Doctrines & Immediate Reactions (`PRIM-3.1`, `PRIM-3.2`)** | **Console + Content** | `TacticalDoctrineComponent` in `src/types/components.types.ts` + declarative JSON `doctrineDescriptor` / `reactionDescriptor` | Eliminates modal `yn()` popups mid-combat across all rulesets and preserves RTwP flow; HUD dynamically renders sliders/toggles from active feats/abilities. |
| **Rechargeable Resource Pools (`PRIM-2.2`)** | **Console** | `ResourcePoolComponent` in `src/types/components.types.ts` | Named charge pools (`rage`, `turn_undead`, `smite`, `ki`, `stamina`, `luck`) with configurable refresh cycles (`round`, `encounter`, `rest_8h`) apply to any RPG ruleset. |
| **Persistent & Entity-Attached Spatial Fields (`PRIM-4.2`)** | **Console** | `FieldComponent` in `src/types/components.types.ts` + `src/systems/field.system.ts` | Extends existing Console fields with `attachedEntityId` mobile emanations, duration ticking, and tag-filtered entry/turn-start effects (*Silence*, *Consecrate*, *Cloudkill*). |
| **Multi-Mode Movement (`PRIM-1.2`)** | **Console + Cartridge** | `MovementModes` in `src/types/` & `movement.system.ts` + flight maneuverability in `dnd35e/spatial/` | `land`, `fly`, `swim`, `burrow`, `climb` terrain traversal is shared Console logic; 5-tier D&D flight maneuverability (`perfect`..`clumsy`) stays in the cartridge. |
| **Minion / Companion Lifecycle & Attitude/Faction Routing** | **Console** | `MinionComponent` / `AttitudeComponent` in `src/types/components.types.ts` + `src/systems/ai.system.ts` | Every entity is a symmetrical Actor whose allegiance/behavior is governed by Faction, Attitude (which *Diplomacy* modifies), and optional summon/companion lifecycle rules. |
| **Baseline Combat, Manufactured+Natural/Multi-Limbed Attacks, Maneuvers & Vancian Math (`PRIM-1.3..1.4`, `1.6`, `2.1`, `3.3..3.4`, `4.1`, `4.3..4.4`, `5.1`)** | **Cartridge** | `src/rulesets/dnd35e/` | Pure baseline mathematical laws parameterized by declarative **Modifiers** and **Rule Overrides** (zero hardcoded `hasFeat` branches in baseline resolvers). |
| **Races, Racial HD, Templates, 11 Classes, PrCs, Feats, Skills, Spells, Equipment** | **System Content** | `public/data/rulesets/dnd35e/*.json` | 100% declarative JSON rulebooks that supply modifiers, rule overrides, and composable actor building blocks (`DECISIONS.md` #7, #11, #12). |

## 🟢 Milestone 102: Shared Console Primitives — Tag Matchers, Layered Overlays, Doctrines, Resource Pools, Attached Fields & Minion Lifecycles (Completed)

Elevate reusable building blocks into the ruleset-agnostic Core Engine ("The Console") so both `dnd35e` and future rulesets benefit without code duplication.

- [x] **Console Entity/Effect Tag Matcher Utility (`PRIM-1.7` Core — `src/systems/reaction.system.ts`, `src/types/`)**: Extract and export a pure, zero-allocation helper `matchesTagCondition(state, targetEntityId, effectTags, condition)` leveraging `getEntityMatcherData()` (`targetTagsAll`, `targetTagsAny`, `sourceTagsAny`, `effectTagsAny`) for use by combat resolvers, saving throws, and stat calculators across any cartridge.
- [x] **Console Layered Property/Stat Overlay Engine (`PRIM-1.5` & `PRIM-2.3` Core — `src/types/components.types.ts`)**: Introduce a generic, serializable **Overlay Layer Stack** (`PropertyOverlayLayer`) allowing templates, form changes (*Wild Shape*, *Polymorph*), and temporary effects to non-destructively override or modify specific actor properties (`sizeCategory`, `abilityScores`, `naturalWeapons`, `movementModes`, `suppressedSlotTypes`, `tagsAdd`/`tagsRemove`) in priority order without mutating underlying base components.
- [x] **`TacticalDoctrineComponent` & Declarative Doctrine Schema (`PRIM-3.1` & `PRIM-3.2` Core — `src/types/components.types.ts`)**: Add `ComponentType.TacticalDoctrine = 'TacticalDoctrine'` storing `settings: Readonly<Record<string, boolean | number | string>>` (e.g., `{ power_attack: 4, combat_expertise: 2, cast_defensively: true, auto_aoo: true, auto_deflect_arrows: true }`) and define the declarative `DoctrineDescriptorSchema` (slider bounds, `maxFormula`, stat trade-offs, and immediate reaction toggles) so zero feats or spells are hardcoded into UI or engine loops.
- [x] **`ResourcePoolComponent` & Refresh Lifecycle (`PRIM-2.2` Core — `src/types/components.types.ts`)**: Add `ComponentType.ResourcePool = 'ResourcePool'` storing named pool records `{ poolId, label, current, max, maxFormula, refreshCycle: 'round' | 'encounter' | 'short_rest' | 'rest_8h' }` to track daily/encounter abilities (Rage, Turn/Rebuke Undead, Smite Evil, Bardic Music, Wild Shape, Ki, Stunning Fist, racial spell-like uses).
- [x] **Mobile & Persistent Spatial Field Extensions (`PRIM-4.2` Core — `src/types/components.types.ts`, `src/systems/field.system.ts`)**: Extend `FieldComponent` and `FieldDefinitionSchema` to support `attachedEntityId?: EntityId` (mobile emanations that move with their bearer, such as *Silence* or *Magic Circle Against Evil*), `affectedTagFilter`, `suppressedTags` (e.g., `verbal_casting`, `magical`), and `onEnter` / `onTurnStart` / `onExit` effect hooks.
- [x] **Multi-Mode Movement & Symmetrical Actor/Minion Lifecycle (`PRIM-1.2` Core — `src/types/`, `src/systems/movement.system.ts`, `src/systems/ai.system.ts`)**: Support structured movement speeds `{ land: number, fly?: number, swim?: number, burrow?: number, climb?: number }`, Attitude/Faction-driven AI target selection (where any Actor can be hostile, neutral, or friendly/allied via `AttitudeComponent`), and summon/companion lifespan & floor-transition rules.

## 🟢 Milestone 103: Cartridge Symmetrical Actor Primitives — Subtypes, Declarative Overrides, Manufactured+Natural Attacks, Riders & Templates (Completed)

Complete the symmetrical D&D 3.5e Actor, Combat, Maneuver, and Template mechanical baselines in `src/rulesets/dnd35e/` using declarative modifiers and rule overrides (`DECISIONS.md` #11 & #12).

- [x] **Symmetrical Actor Subtypes & Automatic Tag Projection (`PRIM-1.1` — `src/rulesets/dnd35e/types/dnd35e_system.types.ts`, `srd_registry.ts`)**: Ensure all Actors (PCs, NPCs, creatures) share the exact same chassis schema (`creatureType`, `subtypes`, `tracks` for Racial HD and Class levels, `anatomySlots`, `naturalWeapons`, `movementModes` with `flyManeuverability`), automatically projecting semantic tags (`type:humanoid`, `subtype:goblinoid`, `subtype:orc`, `type:giant`, `type:outsider`) onto `TagsComponent`.
- [x] **Tag-Based Conditional Stat Modifiers & Rule Override Hooks (`PRIM-1.7` Cartridge — `src/rulesets/dnd35e/modifiers.ts`, `combat/`)**:
  - Extend `StatModifier` with `condition?: StatModifierCondition` evaluated via the Console tag matcher to power Dwarf `+1` attack vs. `subtype:orc`/`subtype:goblinoid`, Dwarf/Gnome `+4` dodge AC vs. `type:giant`, Elf `+2` save vs. `school:enchantment`, Ranger Favored Enemy, Smite, and `Bane` weapons.
  - Replace hardcoded `hasFeat(...)` flags in combat and maneuver resolvers with **Declarative Rule Overrides & Parameter Modifiers** (`maneuver:trip:provokes_aoo = false`, `maneuver:trip:followup_attack = true`, `secondary_natural_penalty` modified from `-5` to `-2` by *Multiattack*, `twf_primary_penalty` / `twf_offhand_penalty` modified by the *Two-Weapon / Multiweapon Fighting* feat data).
- [x] **Manufactured + Natural Weapon & Multi-Limbed Full-Attack Baseline (`PRIM-1.3` — `src/rulesets/dnd35e/combat/attack_resolver.ts`)**:
  - Implement the complete SRD **Manufactured and Natural Weapon Fighting** and **Multi-Limbed** baseline:
    1. Pure natural routine: primary natural weapon(s) at full BAB (`1.0x STR` or `1.5x STR` if sole natural weapon) + secondary natural weapons at `BAB + secondary_natural_penalty` (`-5` baseline, `-2` via *Multiattack* modifier, `0.5x STR`).
    2. Combined Manufactured + Natural routine: manufactured weapon in primary hand executes full iterative BAB sequence (plus any off-hand weapon attacks across $N$ extra weapon-bearing limbs, e.g., a 6-armed Marilith), while all natural weapons not occupying those weapon hands are automatically demoted to **secondary natural attacks** (`-5` baseline, `-2` with *Multiattack*, `0.5x STR`) without imposing TWF penalties on the primary manufactured weapon!
- [x] **Post-Hit Special Attack Trigger Hooks & Pounce (`PRIM-1.4` — `src/rulesets/dnd35e/combat/attack_resolver.ts`, `maneuvers_conditions.ts`)**: Wire declarative `onHitTrigger` hooks into existing maneuver/save resolvers (`improved_grab` invoking `resolveGrapple` with override `{ provokesAoO: false }`, wolf `trip` invoking `resolveTrip` with `{ provokesAoO: false, canBeCounterTripped: false }`, `poison` Fortitude save vs. initial/secondary ability damage, `energy_drain` negative levels) and `chargeModifier: 'pounce'` (full attack at the end of a Charge).
- [x] **Symmetrical Inherited & Acquired Actor Templates (`PRIM-1.5` & `PRIM-1.6` — `src/rulesets/dnd35e/progression.ts`, `srd_registry.ts`)**:
  - Implement `applyInheritedTemplate(actorChassis, template)` (`PRIM-1.5`) as a composable diff/overlay applicable to any Actor (e.g., *Fiendish* applied to a baseline Dog or Minotaur, *Half-Dragon* applied to a Human Fighter).
  - Implement `applyAcquiredTemplate(actorChassis, template)` (`PRIM-1.6`) that algorithmically transforms an Actor's Racial/Class `HitDieTrack[]` (e.g., *Skeleton* or *Zombie* converting racial HD to `d12` Undead, stripping class HD where specified, setting `CON: null`, recalculating BAB/saves/HP) both at spawn time and mid-combat when *Animate Dead* is cast on a slain actor.

## 🟢 Milestone 104: Cartridge Class, Form Overlay, Stance & Magic Primitives — ACFs, Wild Shape/Polymorph, Doctrines, Metamagic & Concentration (Completed)

Complete the class feature, layered form transformation, feat doctrine, and spellcasting engine primitives in `src/rulesets/dnd35e/`.

- [x] **Alternate Class Feature (`ACF`) Swap Pipeline & Class Progression Table Schema (`PRIM-2.1` — `src/rulesets/dnd35e/types/dnd35e_system.types.ts`, `progression.ts`)**: Expand `DnD35ClassDefinitionSchema` with level-by-level `featureGrants`, spell slot tables (`spellsPerDay`, `spellsKnown`), and `acfSwaps` (1-for-1 feature replacements at specified class levels, such as *Whirling Frenzy* replacing *Rage* or *Pounce* replacing *Fast Movement*).
- [x] **Polymorph / Wild Shape Layered Actor Overlay & Cartridge Facade (`PRIM-2.3` — `src/rulesets/dnd35e/progression.ts`, `modifiers.ts`)**: Provide a thin Cartridge-level component/service facade (e.g., `WildShapeOverlayComponent` / `projectWildShapeOverlay`) wrapping the Console's **Layered Property/Stat Overlay** engine. Apply *Wild Shape*, *Polymorph*, *Alter Self*, and *Enlarge/Reduce Person* as non-destructive overlay layers that override physical ability scores (`STR`, `DEX`, `CON`), size category, anatomical slots, movement modes, natural armor, and natural weapons from the target Actor archetype while preserving mental scores (`INT`, `WIS`, `CHA`), HP, base saves, and BAB, and marking incompatible equipment slots as `melded/suppressed` (unless tagged `wild_melds_active`).
- [x] **Doctrine Trade-Off Sliders, Reaction Defense Hooks & Full-Attack Modifiers (`PRIM-3.1`, `PRIM-3.2`, `PRIM-3.3` — `src/rulesets/dnd35e/combat/attack_resolver.ts`, `action_economy.ts`)**:
  - Evaluate `TacticalDoctrineComponent` trade-offs in `resolveAttackRoll` and `computeEffectiveAC` (*Power Attack* $1:1$ one-handed / $1:2$ two-handed / $0$ light weapon damage scaling; *Combat Expertise* attack-to-Dodge AC trade-off; *Fighting Defensively* $-4$ atk / $+2$ Dodge AC or $+3$ with 5 ranks in Tumble).
  - Process immediate/once-per-round reaction hooks (`PRIM-3.2`: *Deflect Arrows*, *Snatch Arrows*, Rogue *Defensive Roll*, *Feather Fall*) and full-attack sequence modifiers (`PRIM-3.3`: *Whirlwind Attack* striking every foe in reach, *Rapid Shot* $+1$ ranged attack at $-2$, *Manyshot*, Monk *Flurry of Blows*).
- [x] **Metamagic Runtime Wrapper & Cast Sub-Choices (`PRIM-3.4` — `src/rulesets/dnd35e/magic/spellcasting.ts`)**: Implement `MetamagicPreparedSlot` and extend `CastSpellIntent` with optional `subChoiceId` (for *Resist Energy*, *Protection from [Alignment]*, *Summon Monster* creature choice) and `metamagicFeatIds`, supporting slot level adjustments ($+1$ to $+4$), *Empower Spell* ($\times 1.5$ variable dice), *Maximize Spell* (max variable dice), *Extend Spell* ($\times 2$ duration), *Quicken Spell* (`swift` action, no AoO), *Silent Spell* (strips `verbal`), *Still Spell* (strips `somatic`), and *Heighten Spell* (raises effective spell level and Save DC).
- [x] **Concentration Maintainer, Dispel Magic & Counterspell Hooks (`PRIM-4.1`, `PRIM-4.3`, `PRIM-4.4` — `src/rulesets/dnd35e/magic/spellcasting.ts`, `aoe_rest.ts`)**:
  - Wire existing `resolveConcentrationCheck` into active `Concentration` spells (`PRIM-4.1`), defensive casting, and damage interrupts (`DC 10 + damageTaken + spellLevel`).
  - Implement `resolveDispelCheck(dispellerCL, targetEffectCL, cap)` (`PRIM-4.3`: $1\text{d}20 + \min(\text{CL}, \text{cap}) \ge 11 + \text{targetCL}$) for targeted and area *Dispel Magic* / *Greater Dispel Magic*.
  - Implement readied *Counterspell* interrupt resolution (`PRIM-4.4`: `Spellcraft DC 15 + spellLevel` to identify, expending matching spell or *Dispel Magic* to negate).

## 🟢 Milestone 105: Anatomical Equipment Slot Topologies, Special Materials & Equipment Physics (Completed)

Evolve the Console's `EquipmentSlotInstance` structure and Cartridge extensions to support arbitrary actor anatomies, limb-linked natural/manufactured weapon interactions, and D&D 3.5e material/sizing physics.

- [x] **Evolving Console `EquipmentSlotInstance` & Anatomical Slot Topologies (`src/types/campaign/item.ts`, `src/types/components.types.ts`, `src/rulesets/dnd35e/`)**:
  - Reuse the Console's `EquipmentComponent.slots: EquipmentSlotInstance[]` foundation while extending `EquipmentSlotInstance` at the Console/Cartridge level as needed (e.g., optional `limbGroupId?: string` to link a `held` weapon slot with that limb's `claw`/`slam` natural weapon so the combat resolver knows which limb's natural attack is occupied, `occupiedBySlotId?: string` for two-handed weapon occupation across a pair of hands, and `suppressed?: boolean` when melded by *Wild Shape* / *Polymorph*).
  - Expand `EquipmentSlotEnum` (`head`, `eyes`, `neck`, `shoulders`, `torso`, `body`, `waist`, `arm`, `hand`, `finger`, `leg`, `foot`, `held`) so any Actor's `EquipmentComponent.slots` models its true anatomy:
    - **Humanoid**: 1 `head`, 1 `eyes`, 1 `neck`, 1 `shoulders`, 1 `torso`, 1 `body`, 1 `waist`, 2 `arm` (bracers), 2 `hand` (gloves/gauntlets), 2 `finger` (rings), 2 `foot` (boots), and 2 `held` (weapon/shield hands).
    - **Quadruped / Canine (e.g., Dog, Wolf)**: 1 `head`, 1 `eyes`, 1 `neck`, 1 `body` (barding), 4 `leg`/`foot`, 0 `hand` / `held` slots.
    - **Multi-Limbed / Serpentine (e.g., 6-Armed Marilith)**: 1 `head`, 1 `eyes`, 1 `neck`, 1 `torso`, 6 `arm` (bracer slots), 6 `hand` (glove/gauntlet slots), 6 `held` (wielding 6 swords or shields simultaneously via *Multiweapon Fighting*), and 0 `leg`/`foot` slots.
  - Ensure all foreign-key traversals (`save_manager.ts`, floor transitions, `inventory.system.ts`) iterate `equipment.slots` relationally without hardcoded human slot keys, and enforce D&D 3.5e's 4 activation modes (`continuous`, `command_word`, `spell_trigger`, `spell_completion`).
- [x] **Special Material Physics Transformer (`PRIM-5.1` — `src/rulesets/dnd35e/modifiers.ts`, `combat/attack_resolver.ts`)**: Implement `applyMaterialPhysics(item, material)` to automatically compute *Mithral* transformations (armor category reduced 1 step `Heavy -> Medium -> Light`, Max Dex $+2$, ACP reduced by $3$ to min $0$, ASF reduced by $10\%$, weight $\times 0.5$), *Adamantine* armor innate `DR` (`1/-` Light, `2/-` Medium, `3/-` Heavy) and hardness $<20$ bypass, *Alchemical Silver* (`silver` bypass tag, $-1$ damage on piercing/slashing), *Cold Iron* (`cold_iron` bypass tag), and *Darkwood* (weight $\times 0.5$, shield ACP $-2$).
- [x] **Weapon Sizing Steps & Handedness Mismatch Penalties (`src/rulesets/dnd35e/combat/attack_resolver.ts`)**: Implement canonical weapon damage die step scaling (`1d2 <-> 1d3 <-> 1d4 <-> 1d6 <-> 1d8 <-> 2d6 <-> 3d6 <-> 4d6 <-> 6d6 <-> 8d6`) for `Enlarge Person`, `Reduce Person`, and non-Medium wielders, plus inappropriate weapon size penalties ($-2$ per size category difference and shifted handedness: Light $\leftrightarrow$ One-Handed $\leftrightarrow$ Two-Handed).

---

# 🚀 Phase 22: D&D 3.5e System Content Pillar 1 — Playable Races, Creature Family Progression Engines, Templates & Bestiary _(Branch: `DND35`)_

**Goal:** Populate `public/data/rulesets/dnd35e/` with comprehensive, 100% data-driven SRD Races, Inherited/Acquired Creature Templates, decomposed Creature Type / Parametric Family Progression Tracks, and a rich Monster Manual Bestiary built atop Phase 21's primitives.

## 🟢 Milestone 106: Playable SRD Races & Monstrous Races Registry (`public/data/rulesets/dnd35e/races/<id>.json`)

Author declarative race definitions with ability adjustments, size/movement modes, senses, favored classes, weapon familiarity, automatic languages, and conditional tag-based modifiers (`PRIM-1.7`).

- [x] **Core 7 Player's Handbook Races (`races/<id>.json`)**:
  - **Human**: Medium, 30 ft, +1 bonus general feat at 1st level, +4 skill points at 1st level (+1/level), Favored Class: `any`.
  - **Dwarf**: Medium, 20 ft (unencumbered by heavy armor/load), `+2 CON / -2 CHA`, Darkvision 60 ft, Stonecunning (`+2` Search/Spot on stonework), Stability (`+4` vs. Bull Rush/Trip), `+2` racial save vs. `descriptor:poison` and spells/spell-like effects, `+1` racial attack vs. `subtype:orc` and `subtype:goblinoid`, `+4` dodge AC vs. `type:giant`, Dwarven Weapon Familiarity, Favored Class: `fighter`.
  - **Elf**: Medium, 30 ft, `+2 DEX / -2 CON`, Low-Light Vision, immunity to magic `sleep`, `+2` racial save vs. `school:enchantment`, Martial Weapon Proficiencies (longsword, rapier, longbow, shortbow), `+2` Listen/Search/Spot, passive 5-ft secret door detection, Favored Class: `wizard`.
  - **Gnome**: Small (`+1` size AC/attack, `+4` Hide, `-4` Grapple), 20 ft, `+2 CON / -2 STR`, Low-Light Vision, `+2` racial save vs. `school:illusion`, `+1` DC to cast `school:illusion`, `+1` racial attack vs. `subtype:kobold` and `subtype:goblinoid`, `+4` dodge AC vs. `type:giant`, `+2` Listen/Craft (Alchemy), Gnome Hooked Hammer familiarity, 1/day SLAs (*dancing lights*, *ghost sound*, *prestidigitation*, *speak with animals*), Favored Class: `bard`.
  - **Half-Elf**: Medium, 30 ft, Low-Light Vision, `sleep` immunity, `+2` save vs. `school:enchantment`, `+1` Listen/Search/Spot, `+2` Diplomacy/Gather Information, `subtype:elf` blood tag, Favored Class: `any`.
  - **Half-Orc**: Medium, 30 ft, `+2 STR / -2 INT / -2 CHA` (min 3 INT), Darkvision 60 ft, `subtype:orc` blood tag, Favored Class: `barbarian`.
  - **Halfling**: Small, 20 ft, `+2 DEX / -2 STR`, `+1` racial bonus on all saving throws, `+2` morale save vs. `descriptor:fear`, `+1` racial attack with thrown weapons and slings, `+2` Climb/Jump/Listen/Move Silently, Favored Class: `rogue`.
- [x] **SRD Subraces, Planetouched & Monstrous Playable Races (`races/<id>.json`)**: Author **Drow** (`+2 DEX, +2 INT, +2 CHA, -2 CON`, SR $11 + \text{HD}$, Darkvision 120 ft, Light Blindness, 1/day *darkness*/*faerie fire*/*dancing lights*, `LA +2`), **Duergar** (`LA +1`), **Svirfneblin / Deep Gnome** (`LA +3`), **Tiefling** (`Outsider [Native]`, Darkvision 60 ft, Cold/Electricity/Fire Resistance 5, *darkness* 1/day, `LA +1`), **Aasimar** (`Outsider [Native]`, Acid/Cold/Electricity Resistance 5, *daylight* 1/day, `LA +1`), **Goblin** (`LA +0`), **Kobold** (`LA +0`), **Orc** (`+4 STR, -2 INT/WIS/CHA`, Light Sensitivity, `LA +0`), **Hobgoblin** (`LA +1`), and **Bugbear** (3 Racial HD + `LA +1`).

## 🟢 Milestone 107: Inherited & Acquired Creature Templates Registry (`public/data/rulesets/dnd35e/templates/<id>.json`)

Author declarative SRD templates that can be applied to any base archetype at spawn time, in the Campaign Editor, or via runtime spells (*Animate Dead*).

- [x] **Inherited Templates (`templates/<id>.json` via `PRIM-1.5`)**:
  - **Celestial Creature**: Converts Animal/Vermin to `Magical Beast`, adds `extraplanar` & `good` subtypes, Darkvision 60 ft, HD-tiered Acid/Cold/Electricity Resistance (`5` or `10`), HD-tiered `DR` (`5/magic` at 4–7 HD, `10/magic` at 8+ HD), `SR = min(25, HD + 5)`, and `Smite Evil` 1/day (`+HD` damage).
  - **Fiendish Creature**: Converts Animal/Vermin to `Magical Beast`, adds `extraplanar` & `evil` subtypes, Darkvision 60 ft, HD-tiered Cold/Fire Resistance (`5` or `10`), HD-tiered `DR` (`5/magic` or `10/magic`), `SR = min(25, HD + 5)`, and `Smite Good` 1/day (`+HD` damage).
  - **Half-Dragon**: Converts type to `Dragon`, `+8 STR, +2 CON, +2 INT, +2 CHA`, `+4` Natural Armor, Claw/Bite natural weapons, Wings (if Large+), Breath Weapon (`6d8` cone/line 1/day by dragon variety), and elemental immunity + `LA +3`.
  - **Half-Fiend / Half-Celestial**: Outsider type conversion, scaled SLA progression by HD, flight speed, natural armor, ability boosts, and `LA +4`.
- [x] **Acquired Templates (`templates/<id>.json` via `PRIM-1.6`)**:
  - **Skeleton Template**: Rebuilds type to `Undead`, `CON: null`, `INT: null`, `WIS: 10`, `CHA: 1`, `+2 DEX`, converts all racial HD to `d12` (drops class HD), `BAB = 0.5 × HD`, good Will save, size-tiered natural armor, claw attack, `DR 5/bludgeoning`, Cold immunity, and *Improved Initiative* bonus feat.
  - **Zombie Template**: Rebuilds type to `Undead`, `CON: null`, `INT: null`, `+2 STR, -2 DEX`, doubles base HD (in `d12`s), `Single Actions Only` trait (restricted to a single Move or Standard action per round), slam attack, `DR 5/slashing`, and *Toughness* bonus feat.
  - **Lich, Vampire & Ghost Templates**: High-tier Undead acquired templates (`d12` HD conversion, `CON: null`, Lich paralyzing touch + `DR 15/bludgeoning and magic` + Fear Aura; Vampire blood drain + energy drain 2 negative levels + `DR 10/silver and magic` + fast healing 5; Ghost `incorporeal` subtype + manifestation + rejuvenation).

## 🟢 Milestone 108: Reverse-Engineering Creature Families into Composable Progression Tracks (`src/rulesets/dnd35e/progression.ts` & `public/data/rulesets/dnd35e/`)

Reverse-engineer and decompose SRD Creature Types, Monster Advancement rules, and multi-stage creature families (True Dragons, Elementals, Constructs/Golems) into parametric progression tracks so actors are synthesized from composable building blocks rather than copy-pasted statblocks (`DECISIONS.md` #12.4).

- [x] **15 SRD Creature Type & 20 Subtype Modular Registries (`creature_types/<id>.json`, `subtypes/<id>.json`, `progression.ts`)**:
  - Formalize the 15 SRD Creature Types (`Aberration`, `Animal`, `Construct`, `Dragon`, `Elemental`, `Fey`, `Giant`, `Humanoid`, `Magical Beast`, `Monstrous Humanoid`, `Ooze`, `Outsider`, `Plant`, `Undead`, `Vermin`) and 20 SRD Subtypes (`Air`, `Aquatic`, `Archon`, `Chaotic`, `Cold`, `Earth`, `Elf`, `Evil`, `Extraplanar`, `Fire`, `Giant`, `Goblinoid`, `Good`, `Incorporeal`, `Lawful`, `Native`, `Orc`, `Reptilian`, `Shapechanger`, `Water`) as individual modular JSON definitions with reusable `DnD35EffectBundle` trait grants (`traitBundles` / `effectBundle`), defining Hit Die size (`d6`, `d8`, `d10`, `d12`), BAB progression (`Full 1.0`, `Medium 0.75`, `Poor 0.5`), Good/Poor Saving Throws, Skill Point multiplier (`2 + INT` to `8 + INT`, `0` if mindless `INT: null`), Construct bonus HP by size (`+10` Small to `+80` Colossal), and automatic type/subtype immunities and traits.
- [x] **Monster Advancement by Hit Dice & Size Step Delta Engine (`progression.ts`)**:
  - Implement the SRD **Improving Monsters** pipeline allowing any Actor race to advance along its `advancementRanges` (e.g., `4–6 HD (Medium); 7–12 HD (Large)`), automatically applying the canonical SRD Size Change Table deltas (`Fine <-> Colossal` adjustments to `STR`, `DEX`, `CON`, Natural Armor, Size AC/Attack modifier, Grapple/Hide modifier, Reach/Space, and natural weapon die step scaling) plus earned Racial HD feats (every 3 HD) and ability score increases (every 4 HD).
- [x] **Unified Race Chassis (`races/<id>.json`) & Multi-Tier `rhdProgression` for True Dragons & Elementals (`family_synthesizer.ts`)**:
  - Unify all playable races, monstrous humanoids, monster species, 10 True Dragon varieties (**Chromatic**: `Black`, `Blue`, `Green`, `Red`, `White`; **Metallic**: `Brass`, `Bronze`, `Copper`, `Gold`, `Silver`), and 4 Elementals (`Air`, `Earth`, `Fire`, `Water`) into 75 modular `public/data/rulesets/dnd35e/races/<id>.json` files (eliminating the legacy `archetypes/` and `dragon_families.json` split).
  - Separate intrinsic racial traits from `rhdProgression: { creatureTypeId, saveCurveOverrides?, tiers: ReadonlyArray<DnD35RaceRhdTier> }`, driving 12-Age-Category True Dragon scaling (with creature-specific `unlockedNaturalWeapons` on age tiers) and 6-Size-Tier Elemental scaling (with subtype-specific `saveCurveOverrides`).

## 🟢 Milestone 109: Expanded SRD Monster Manual Bestiary & Dungeon Ecology (`public/data/rulesets/dnd35e/races/<id>.json` & `entities.json`)

Populate the concrete D&D 3.5e creature registry across all 15 SRD Creature Types from CR 1/4 to CR 15+ using Milestone 108's unified `races/<id>.json` + `rhdProgression` tracks and Phase 21's primitives.

- [x] **Low-CR Dungeon Ecology (CR 1/4 – CR 3)**: Dire Rat (Filth Fever disease rider), Kobold, Goblin, Orc, Hobgoblin, Gnoll, Bugbear, Giant Fire Beetle, Wolf / Dire Wolf (`trip` on bite), Black Bear (`improved_grab`), Giant Spider (Web + `STR` poison), Giant Centipede (`DEX` poison), Stirge (attach + blood drain), Ghoul / Ghast (paralysis touch, elves immune to ghoul paralysis), Wight (energy drain), Shadow (`incorporeal`, `1d6 STR` damage), Gelatinous Cube (`ooze`, paralysis + acid engulf, transparent), Rust Monster (metal equipment corrosion), Gargoyle (`DR 10/magic`).
- [x] **Mid-CR Tactical Monsters (CR 4 – CR 8)**: Owlbear (`improved_grab`), Minotaur (`Natural Cunning` immunity to maze/flanking, `Powerful Charge 4d6+6`), Displacer Beast (`50%` displacement miss chance, 10-ft tentacle reach), Basilisk / Medusa (Petrifying Gaze Fort save), Manticore (tail spikes volley + flight), Troll (Regeneration 5 bypassed by `fire`/`acid`, Rend `2d6+9`), Wraith (`incorporeal`, `1d6 CON` drain), Mummy (Despair paralysis aura + Mummy Rot curse/disease, `DR 5/-`, fire vulnerability), Mind Flayer / Illithid (`SR 25`, Mind Blast 60-ft cone stun, 4 tentacles `improved_grab` + brain extraction), Beholder / Eye Tyrant (All-Around Vision, Antimagic Central Eye Cone + Eye Rays), Hill/Stone/Frost/Fire Giants (Rock Throwing + Greatclub reach).
- [x] **High-CR Apex Threats & Multi-Limbed/Parametric Instantiations (CR 9 – CR 15+)**: 6-Armed **Marilith** (`Outsider [Chaotic, Evil, Extraplanar]`, 6 `held`/`arm`/`hand` anatomical slots + *Multiweapon Fighting* + tail slam `improved_grab`/`constrict`), Iron/Stone/Flesh Golems, instantiated Air/Earth/Fire/Water Elementals (`Small` through `Elder`), Chromatic & Metallic Dragons across age categories (`Wyrmling` through `Great Wyrm`), Balor & Pit Fiend (`DR 15/cold_iron and good` or `silver and good`, regeneration, at-will SLAs).
- [x] **Unified Effect Providers, Universal `DnD35EffectBundle`, Hierarchical Provenance (`sourcePath`) & 4-Stage Topological Sub-Stat DAG (`src/rulesets/dnd35e/modifiers.ts`, `srd_registry.ts`, `level_ledger.ts`, `dnd35e_ruleset.ts`)**:
  - Formalize all structural building blocks (`Size`, `CreatureType`, `Subtype`, `Race`, `Template`, `Class`, `Domain`, `Feat`, `Skill`, `Condition`, `Load/Armor`, `TacticalStance`) as declarative Effect Providers backed by the recursive `DnD35EffectBundle` primitive (`passive` / `activated` / `toggle` / `triggered` usage modes, `virtualFeatGrants` with `ignorePrerequisites`, `activatedAbilityGrants`, `activationCondition`, and `suppressedBundleIds` trade-away support), emitting hierarchical `sourcePath` modifiers evaluated via `selfTags*`, `targetTags*`, and `effectTags*` conditions, indexed by `buildEffectProvenanceIndex` and revocable via `revokeModifiersByPathPrefix`.
  - Implement `evaluateDnD35ActorStatDAG` with single-pass $O(N)$ bucket partitioning across **Stage 1 (`'size'`)** (dynamic `size:<effectiveSize>` projection and `buildSizeEffectProviderModifiers`), **Stage 2 (`'str'..'cha'`)** (cascading ability score resolution), **Stage 3 (Compound Defenses)** (`natural_armor`, `worn_armor_bonus`, `worn_shield_bonus` with constituent `OriginLayer` attribution and `effectTags` propagation), and **Stage 4 (Terminal Combat Stats)** (dynamic CHA Incorporeal Deflection synchronization, `maxDexBonus` capping, `[Force]` touch AC preservation, `resolveTypedModifiersWithBreakdown` winner/shadowed/suppressed diagnostics, and mutual `targetTags` combat evaluation via `evaluateDnD35eEntityDAG`).

---

# 🚀 Phase 23: D&D 3.5e System Content Pillar 2 — Core 11 Classes, 5 NPC Classes, Prestige Classes, ACFs & Character Builder _(Branch: `DND35` — In Progress)_

**Goal:** Author all 11 SRD Base Classes, 5 SRD NPC Classes (`Warrior`, `Expert`, `Adept`, `Aristocrat`, `Commoner`), 22 Cleric Domains, 10 Prestige Classes, and Alternate Class Features across modular `public/data/rulesets/dnd35e/classes/<classId>.json` and `public/data/rulesets/dnd35e/domains/<domainId>.json` files using a **Rulebook-Faithful Class Header + Level-by-Level Progression Table (`progression: ReadonlyArray<DnD35ClassLevelRow>`)** and reusable `DnD35EffectBundle` grants, and build the full interactive D&D 3.5e Character Creation & Level-Up Advancement UI with a **Chronological Actor Level Ledger (`levelHistory`)** supporting interleaved multiclassing and permanent level drain rollback.

## ✅ Milestone 110: Complete 11 SRD Base Classes, 5 SRD NPC Classes, Cleric Domains & Alternate Class Features (`public/data/rulesets/dnd35e/classes/<classId>.json` & `domains/<domainId>.json`) _(Completed)_

Expand the class and domain registries to modular per-file definitions in `public/data/rulesets/dnd35e/classes/<classId>.json` (11 PHB Base Classes + 5 DMG NPC Classes + 10 Prestige Classes) and `public/data/rulesets/dnd35e/domains/<domainId>.json` (22 Cleric Domains with named `grantedPowerBundle: DnD35EffectBundle`), modeled as level-invariant **Class Headers** paired with explicit level-by-level **Progression Tables** (`progression: ReadonlyArray<DnD35ClassLevelRow>`):

- [x] **Martial & Hybrid Base Classes (`Barbarian`, `Fighter`, `Monk`, `Paladin`, `Ranger`, `Rogue`)**:
  - **Barbarian**: `d12`, Full BAB, Fast Movement (`+10 ft`), Illiteracy, Rage / Greater Rage / Mighty Rage (`ResourcePoolComponent`), Tireless Rage, Uncanny Dodge, Improved Uncanny Dodge, Trap Sense (`+1..+6`), Indomitable Will, `DR 1/-..5/-`.
  - **Fighter**: `d10`, Full BAB, Fighter Bonus Feat progression at 1st and every even level (`2, 4, 6..20`) flagged via `bonusFeatSlot: true` on level rows.
  - **Monk**: `d8`, 3/4 BAB, all Good saves, Unarmored AC Bonus (`WIS mod + floor(level/5)`), Unarmed Strike scaling (`1d6 -> 2d10`), Flurry of Blows (`-2/-2 -> -1/-1 -> +0/+0` + Greater Flurry), Fast Movement (`+10..+60 ft`), Evasion / Improved Evasion, Still Mind, Ki Strike (`magic`, `lawful`, `adamantine`), Purity of Body, Wholeness of Body, Diamond Body, Abundant Step, Diamond Soul (`SR 10 + level`), Quivering Palm, Perfect Self.
  - **Paladin**: `d10`, Full BAB, `LG` alignment, Aura of Good, *Detect Evil* at will, Smite Evil (`1..5/day`, `+CHA` atk, `+level` dmg vs. `alignment:evil`), Divine Grace (`+CHA` to all saves), Lay on Hands (`level × CHA mod` HP pool), Aura of Courage (10-ft fear immunity/bonus field), Divine Health, Turn Undead (`level - 3`), 1st–4th level prepared Divine casting from 4th level.
  - **Ranger**: `d8`, Full BAB, Good Fort/Ref, 6 skill pts, Favored Enemy progression (1st, 5th, 10th, 15th, 20th using `PRIM-1.7` tag modifiers), Track, Combat Style track (`Archery`: *Rapid Shot* $\to$ *Manyshot* $\to$ *Improved Precise Shot* OR `Two-Weapon`: *TWF* $\to$ *Improved TWF* $\to$ *Greater TWF* in light/no armor across `effectBundle.virtualFeatGrants` with `ignorePrerequisites: true` and `activationCondition: { selfTagsForbidden: ['load:medium_armor', 'load:heavy_armor'] }`), Endurance, Woodland Stride, Evasion, Camouflage, Hide in Plain Sight, 1st–4th level prepared Divine casting.
  - **Rogue**: `d6`, 3/4 BAB, Good Ref, 8 skill pts, Sneak Attack (`+1d6` to `+10d6`), Trapfinding, Evasion, Trap Sense, Uncanny Dodge / Improved Uncanny Dodge, and 10th+ level Rogue Special Abilities (*Crippling Strike* `2 STR` dmg, *Defensive Roll*, *Improved Evasion*, *Opportunist* AoO, *Slippery Mind*, *Skill Mastery*).
- [x] **Arcane & Divine Full/Spontaneous Casters (`Bard`, `Cleric`, `Druid`, `Sorcerer`, `Wizard`)**:
  - **Bard**: `d6`, 3/4 BAB, Good Ref/Will, 6 skill pts, 0th–6th spontaneous Arcane casting (no ASF in light armor), Bardic Knowledge (`level + INT`), and Bardic Music (`ResourcePoolComponent`: *Inspire Courage* `+1..+4` morale save vs. fear and competence atk/dmg, *Countersong*, *Fascinate*, *Inspire Competence* `+2` skill, *Suggestion*, *Inspire Greatness*, *Song of Freedom*, *Inspire Heroics*).
  - **Cleric & SRD Deity Domains**: `d8`, 3/4 BAB, Good Fort/Will, 0th–9th prepared Divine casting + `domainSpellSlots: { "1": 1, ... }` per spell level (1–9 matching *Table: The Cleric*), Spontaneous *Cure* (Good) or *Inflict* (Evil) conversion, Turn/Rebuke Undead (`3 + CHA mod/day`, $1\text{d}20 + \text{CHA}$ check for max HD turned and $2\text{d}6 + \text{level} + \text{CHA}$ total HD affected, destroying undead with $\text{HD} \le \text{level}/2$), and all 22 SRD Domains (`Air`, `Animal`, `Chaos`, `Death`, `Destruction`, `Earth`, `Evil`, `Fire`, `Good`, `Healing`, `Knowledge`, `Law`, `Luck`, `Magic`, `Plant`, `Protection`, `Strength`, `Sun`, `Travel`, `Trickery`, `War`, `Water`) authored in `domains/<domainId>.json` with named `grantedPowerBundle` (`domain_power_<domainId>`).
  - **Druid**: `d8`, 3/4 BAB, Good Fort/Will, 0th–9th prepared Divine casting + spontaneous *Summon Nature's Ally*, Nature Sense, Woodland Stride, Trackless Step, Resist Nature's Lure (`+4` save vs. `type:fey`), Venom Immunity, Wild Shape (`PRIM-2.3`: Small/Medium Animal at 5th $\to$ Large at 8th $\to$ Tiny at 11th $\to$ Plant at 12th $\to$ Huge at 15th $\to$ Elemental at 16th–20th), and Animal Companion progression.
  - **Sorcerer**: `d4`, 1/2 BAB, Good Will, 0th–9th high-volume spontaneous Arcane casting (`spellsPerDay` & `spellsKnown` on level rows), Summon Familiar.
  - **Wizard & School Specializations**: `d4`, 1/2 BAB, Good Will, 0th–9th prepared Spellbook Arcane casting, Scribe Scroll, Wizard Bonus Feats (`5, 10, 15, 20`), and Specialist Wizard options (Abjurer, Conjurer, Diviner, Enchanter, Evoker, Illusionist, Necromancer, Transmuter: `+1` school slot/level, `+2` Spellcraft on specialty, 2 prohibited schools).
- [x] **5 SRD NPC Classes (`Warrior`, `Expert`, `Adept`, `Aristocrat`, `Commoner`)**:
  - Authored in `classes/{warrior,expert,adept,aristocrat,commoner}.json` (`isNpcClass: true`, levels 1–20) with `computeNpcClassCrContribution` (`level - 1` CR for creatures without racial HD; `floor(level / 2)` CR for creatures with racial HD), `NONELITE_ABILITY_ARRAY` (`[13, 12, 11, 10, 9, 8]`), and template `stripClassLevels` parity.
- [x] **Alternate Class Features (`acfSwaps` via `PRIM-2.1`)**: Author *Whirling Frenzy* (Barbarian), *Lion Spirit Totem Pounce* (Barbarian), *Wolf Totem Improved Trip* (Barbarian), *Dungeon Crasher* (Fighter), *Decisive Strike* (Monk), *Invisible Fist* (Monk), *Charging Smite* (Paladin), *Distracting Attack* (Ranger), *Penetrating Strike* (Rogue: half sneak attack dice vs. crit-immune targets when flanking), *Domain Spontaneity* (Cleric), and *Immediate Magic / Abrupt Jaunt* (Specialist Wizard).

## ✅ Milestone 111: SRD Prestige Classes & Multiclassing Rules (`public/data/rulesets/dnd35e/classes/<classId>.json`) _(Completed)_

Author iconic SRD Prestige Classes in modular per-class JSON files (`public/data/rulesets/dnd35e/classes/<classId>.json`, merged into `systemContent.classes`) with explicit `progression` tables, per-row `advancesSpellcasting: 'arcane' | 'divine' | 'both' | 'any'`, and prerequisite AST validation (`evaluatePrerequisiteAST()` in `src/rulesets/dnd35e/prerequisites.ts`).

- [x] **SRD Prestige Class Registry (`classes/<classId>.json`)**:
  - **Arcane Archer** (`BAB +6`, Elf/Half-Elf, *Point Blank Shot*, *Precise Shot*, *Weapon Focus (bow)*, 1st-level arcane casting $\to$ Enhance Arrow `+1..+5`, Imbue Arrow AoE, Seeker Arrow, Phase Arrow, Hail of Arrows, Arrow of Death).
  - **Assassin** (`Evil` alignment, `Hide 8`, `Move Silently 8`, `Disguise 4` $\to$ Sneak Attack `+1d6..+5d6`, Death Attack 3-round study Fort save, Poison Use, `+1..+5` save vs. poison, Uncanny Dodge, Hide in Plain Sight, Assassin spell list).
  - **Blackguard** (`BAB +6`, `Evil`, `Hide 5`, *Cleave*, *Power Attack*, *Improved Sunder* $\to$ Aura of Evil, *Detect Good*, Poison Use, Dark Blessing `+CHA` to saves, Smite Good, Aura of Despair `-2` save aura within 10 ft, Command Undead, Sneak Attack, Blackguard spell list).
  - **Dragon Disciple**, **Duelist** (Canny Defense `+INT` Dodge AC, Precise Strike `+1d6..+2d6`), **Dwarven Defender** (`Defensive Stance`: `+2 STR, +4 CON, +2 resistance saves, +4 dodge AC` while stationary), **Eldritch Knight** (`Full BAB` + rows 2–10 `advancesSpellcasting: 'arcane'`), **Loremaster**, **Mystic Theurge** (rows 1–10 `advancesSpellcasting: 'both'`), and **Shadowdancer** (*Hide in Plain Sight*, *Shadow Jump* dimension door pool, *Summon Shadow*).
- [x] **Multiclass XP Penalty & Prestige Class Exemption (`src/rulesets/dnd35e/progression.ts`)**: Enforce that base classes remain within 1 level of each other (ignoring the race's `favoredClass` and all Prestige Classes) or incur a `-20%` XP penalty per uneven base class, with a campaign rule toggle to enable/disable multiclass XP penalties.

## ✅ Milestone 112: Interactive D&D 3.5e Character Creation Wizard, Chronological Level Ledger & Level-Up Advancement UI _(Completed)_

Build a dedicated CRPG character creation and level-up workflow (`src/rendering/ui/dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts`, `dnd35e_level_up.ui.ts`, and `src/rulesets/dnd35e/character_builder.ts`) backed by a **Chronological Actor Level Ledger (`levelHistory`)** in `src/rulesets/dnd35e/level_ledger.ts`.

- [x] **7-Step Character Creation Wizard**:
  1. **Race Selection**: Browse playable races (`races/<id>.json`) with live previews of ability modifiers, size/speed, vision modes, racial traits, and favored class.
  2. **Class & ACF Selection**: Choose starting base class (`classes/<classId>.json`), inspect a live **Class Table Preview** (Levels 1–5), optional Specialist Wizard school or Cleric Domains (2 domains), Ranger Favored Enemy, and optional Alternate Class Feature swaps (`PRIM-2.1`).
  3. **Ability Score Allocation**: Toggle between **Standard 25/28/32-Point Buy**, **Standard Elite Array (`15, 14, 13, 12, 10, 8`)**, and **Seeded `4d6kh3` Roll** with live modifier, carrying capacity, and bonus spell slot previews.
  4. **Skill Point Allocation**: Spend `(classPoints + INT mod) × 4` (+4 for Human) across `skills/<id>.json` with `1 pt = 1 rank` for class skills (max `HD + 3`) and `1 pt = 0.5 rank` for cross-class skills (max `(HD + 3)/2`), highlighting 5-rank synergies.
  5. **Feat Selection**: Pick general feats (+1 Human bonus feat, +1 Fighter bonus feat) with live AST prerequisite filtering (`evaluatePrerequisiteAST` showing green/red requirement badges).
  6. **Starting Spells / Domains**: Select starting Wizard spellbook / Sorcerer or Bard known spells / Cleric Domains.
  7. **Starting Equipment Package**: Select a curated class equipment kit or spend starting gold (`gp`) in a pre-game outfitter.
- [x] **Interactive Level-Up Modal & Chronological Level Ledger (`levelHistory`)**: When `grantDnD35eXp` crosses the next `ECL` triangular XP threshold, trigger a level-up notification banner allowing the player to choose their next class level (Base Class or eligible Prestige Class previewing exact table row stats), roll/take-average Hit Die + `CON` mod (min 1), allocate skill points, select every-4th-HD ability score increases, pick earned General/Class Bonus Feats, and learn new spells. All level choices are appended to `levelHistory: ReadonlyArray<DnD35CharacterLevelRecord>`, enabling exact interleaved multiclassing, temporary negative levels (`applyNegativeLevelsToActor`), and deterministic permanent level drain rollback (`applyPermanentLevelDrainToActor`).

## ✅ Milestone 112.5: Full-Screen 2-Pane Character Creation & Level-Up UX Overhaul, Playable Race Filtering & Class Spell-List Tagging _(Completed)_

Refine the Character Creation Wizard (`dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts`, `dnd35e_inspector.ui.ts`), Level-Up Modal (`dnd35e_level_up.ui.ts`), and supporting schemas (`character_builder.ts`, `skills.ts`, `dnd35e_system.types.ts`) based on playtesting feedback.

- [x] **Full-Screen 2-Pane Master/Detail Modal Layout & Scroll Preservation (`dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts`, `dnd35e_inspector.ui.ts`, `dnd35e_level_up.ui.ts`)**:
  - Expand the Character Creation Wizard and Level-Up Modal to a near-full-screen (`95vw`, `90vh`) two-column layout: a scrollable **Master List** on the left and a dedicated **Detail / Inspector & Sub-Selection Pane** (`src/rendering/ui/dnd35e_inspector.ui.ts`) on the right.
  - Preserve `scrollTop` (`captureScrollPositions` / `restoreScrollPositions` keyed by `[data-scroll-pane]`) across state updates and re-renders on both panes so clicking an option, incrementing a skill rank, or toggling a feat never resets scroll position to the top.
- [x] **Playable Race Filtering vs. Monstrous Species Toggle (`races/<id>.json`, `dnd35e_system.types.ts`)**:
  - Add `isPlayableRace: z.boolean().default(false)` to `DnD35RaceDefinitionSchema` (setting `true` on the 7 PHB Core Races and 7 standard playable subraces/humanoids) so Step 1 defaults to a clean 14-race Playable Race roster, with a **"Show Monstrous / Savage Species (RHD / LA)"** toggle for players who wish to play monstrous actors from the unified `races/<id>.json` registry.
  - Display full racial ability modifiers, size/reach, movement modes, senses, automatic/bonus languages, favored class, and racial `traitBundles` in the right-hand inspector pane.
- [x] **Class 1–20 Progression Inspector, Specialist Prohibited Schools & Draft Reset Hygiene (`character_builder.ts`, `dnd35e_char_builder.ui.ts`)**:
  - In Step 2's right-hand detail pane, render the selected class's full **Level 1–20 Progression Table** (`BAB`, `Fort/Ref/Will`, `Special Features`, `Spells per Day`) alongside sub-selection controls: Cleric 2-Domain picker (previewing each domain's `grantedPowerBundle` and 1st–9th domain spells), Specialist Wizard School + Prohibited School picker (`1` for Diviner, `2` for other schools, `divination` cannot be prohibited), Ranger Favored Enemy / Combat Style, and Alternate Class Feature (`acfSwaps`) toggles.
  - Automatically sanitize/reset downstream `skillRanks`, `selectedFeats`, `knownSpells`, `selectedDomains`, and `specialistSchool` via `sanitizeDraftOnRaceOrClassChange` when switching `classId` or `raceId` so stale cross-class skill investments or invalid spells never carry over.
- [x] **Ability Score Allocator State Machine (`point_buy` vs. `elite_array` vs. `rolled_4d6kh3`)**:
  - Fix the header status display to branch explicitly on `draft.abilityMethod`: show `Point-Buy Cost: X / 28 pts` only in `point_buy` mode, show `Standard Elite Array (15, 14, 13, 12, 10, 8)` in `elite_array` mode, and show `Rolled (4d6 drop lowest)` with a `[Re-Roll]` button in `rolled_4d6kh3` mode.
  - In `elite_array` and `rolled_4d6kh3` modes, provide ability-score swap/assignment controls so players can freely assign their rolled or array values across `STR`, `DEX`, `CON`, `INT`, `WIS`, and `CHA`, while displaying `Base Score + Racial Adj = Final Score (Modifier)` across all three modes.
- [x] **Skill Rank Counter Controls (`[−]` / `[+]`), Full 42-Skill SRD Registry & Bonus Breakdown (`dnd35e_char_builder_steps.ui.ts`, `skills/<id>.json`)**:
  - Expand `public/data/rulesets/dnd35e/skills/<id>.json` to all 42 SRD skills (including sub-skills for `Craft` and `Knowledge`) with complete 5-rank `synergyFromSkills`, `synergyNotes`, `actions`, `rankThresholdModifiers`, and `retryAllowed` / `take10Allowed` / `take20Allowed` flags enforced in `resolveSkillCheck`.
  - Replace the single `+1 Rank / Reset` toggle button with explicit `[−]` and `[+]` stepper buttons (`+1.0` rank per skill point for Class Skills up to `HD + 3`; `+0.5` rank per skill point for Cross-Class Skills up to `(HD + 3) / 2`), strictly clamping rank investment to available skill points and preventing negative or over-budget allocations.
  - Separate **Invested Ranks** from **Bonuses** in a multi-column breakdown (`Skill Name (Key Ability)` | `Class / Cross-Class` (including Cleric Domain `classSkillsAdded` and `grantedClassSkills`) | `Ranks [−] X [+]` | `Ability Mod` | `Synergy / Racial Bonus` | `Total Modifier`), with right-pane detail inspection of skill DCs, action cost, Retry/Take 10/Take 20 rules, Armor Check Penalty multiplier, and bidirectional 5-rank synergies (`getSkillsGrantedSynergyBy`).
- [x] **Feat Slot Budget Enforcement & Class/Domain Spell Tagging (`levelByClass`, `levelByDomain`)**:
  - Enforce exact feat slot budgets in Step 5 (`computeFirstLevelFeatSlotBudget`: `1 General Feat` + `1 Human Bonus Feat` if Human + `1 Fighter Bonus Feat` restricted to `[Fighter Bonus Feat]` tagged feats if Fighter 1), with a right-hand Feat Inspector displaying the full prerequisite AST check (`evaluatePrerequisiteAST`) and `effectBundle` description.
  - Add `levelByClass: z.record(z.string(), z.number().int().min(0).max(9))` and `levelByDomain: z.record(z.string(), z.number().int().min(1).max(9))` to `DnD35SpellDefinitionSchema` across 23 starter 0th/1st-level spells in `public/data/rulesets/dnd35e/spells/<id>.json`, and filter Step 6 (`renderSpellsStep`) and Level-Up spell selection strictly via `isSpellSelectableForDraft` (checking `spell.levelByClass[classId]` and prohibited school exclusions) so divine casters and arcane casters only see spells belonging to their class spell list.

## 🟢 Milestone 112.6: Combat Sequence & Inventory Wiring, Declarative Doctrine Descriptors, Level-Up Decoupling & Multi-Mode Floor Traversal

Bridge foundational integration gaps between Phase 21/22/23 primitives and live gameplay loops prior to Phase 24 content expansion.

- [x] **Full-Round Attack Routine & Equipped Weapon Resolution (`dnd35e_ruleset.ts`, `attack_resolver.ts`)**:
  - Wire `buildFullAttackSequence` into `resolveDnD35eMeleeAttack` for full-round attack actions, sequencing iterative attacks, off-hand weapons, and secondary natural attacks.
  - Dynamically derive attack parameters (weapon dice, threat range, crit multiplier, damage type, and material properties) from the actual item entities equipped in the actor's `held` hand slots instead of falling back to flat baseline properties on `DnD35EntityData`.
- [x] **Character Creation Starting Equipment Physical Materialization (`character_builder.ts`)**:
  - Update `commitCharacterCreation` so selected starting equipment packages instantiate actual item entities in the player's `InventoryComponent` and equip starting armaments into `EquipmentComponent.slots`.
- [x] **Decoupled Interactive Level-Up Progression (`dnd35e_ruleset.ts`, `dnd35e_level_up.ui.ts`)**:
  - Refactor `grantDnD35eXp` so crossing an XP threshold does not automatically mutate `tracks` and HP in the background; preserve the XP threshold trigger strictly for the interactive Level-Up HUD alert and `applyLevelUpToActor()`, maintaining 100% fidelity with `levelHistory`.
- [x] **Declarative Doctrine Descriptors (`doctrineDescriptor` in `attack_resolver.ts` & `feats/*.json`)**:
  - Refactor `evaluateTacticalDoctrineModifiers` to consume declarative `doctrineDescriptor` trade-off configurations from active `DnD35EffectBundle`s (scaling attack penalties into damage or dodge AC based on handedness and dial values) instead of hardcoding feat-specific keys in Cartridge code.
- [x] **Lightweight Multi-Mode Traversal (`movement.system.ts`, `grid.ts`)**:
  - Extend `processMoveIntent` to check `movementModes` against non-solid impassable terrain (chasms, liquid, pits) allowing actors with `fly > 0` or `swim > 0` to pass without requiring a full 3D Z-axis console overhaul.

## 🟢 Milestone 112.7: Inappropriately Sized Weapon Effort Ladder, Two-Handed Grip & Double-Weapon Toggles, Multi-Limb / Natural Demotion & Per-Strike Power Attack Handedness (Complete)

Complete the SRD 3.5e weapon-wielding physics, grip mode state machine, multi-limb attack sequencing, and per-strike handedness resolution across manufactured, double, and natural weapons.

- [x] **Inappropriately Sized Weapon Effort Ladder & Attack Penalties (`equipment_physics.ts`)**:
  - Fix `evaluateWeaponWieldingProfile` to compute effective effort via the exact 3-step ladder $\text{Index}_{\text{eff}} = \text{Index}_{\text{base}} + (\text{Rank}(\text{WeaponSize}) - \text{Rank}(\text{WielderSize})) \in [0, 2]$ (`0: light`, `1: one_handed`, `2: two_handed`), properly rejecting out-of-bounds shifts (such as a Medium creature attempting to wield a Small Light weapon where $\text{Index}_{\text{eff}} = -1$) while permitting valid $\pm 2$-step shifts (such as a Large creature wielding a Small Two-Handed weapon as `'light'` at `-4` attack penalty).
  - Resolve `weaponSize` from item tags (`weaponSize:<size>`, defaulting to `'medium'`) so damage dice scale strictly from `weaponSize` while `wielderSize` determines effort shift and the $-2 \times |\Delta\text{Size}|$ attack roll penalty.
- [x] **Two-Handed Grip Toggle, Double-Weapon Mode & Weapon Exceptions (`components.types.ts`, `equipment_physics.ts`, `dnd35e_ruleset.ts`)**:
  - Add `gripMode?: 'one_handed' | 'two_handed' | 'double_weapon_twf'` (or `wieldTwoHanded?: boolean`) to `TacticalDoctrineComponent`.
  - When an actor wields an effective `'one_handed'` weapon and has a free hand (an unoccupied `held` / `hand` slot with no shield or off-hand weapon), allow toggling into `'two_handed'` grip ($1.5\times \text{STR}$ damage, $1:2$ Power Attack, and occupying the free hand's `limbGroupId` for the round), while enforcing the SRD **Rapier exception** (`cannot_two_hand_str`: cannot be wielded two-handed for $1.5\times \text{STR}$ or $2\times$ Power Attack) and **Light weapon rule** (two-handing an effective `'light'` weapon grants no $1.5\times \text{STR}$ or $2\times$ Power Attack benefit).
  - Support **Bastard Sword / Dwarven Waraxe** handedness-dependent proficiency (`1H Exotic` vs. `2H Martial`, with Dwarves treating Dwarven Waraxes as Martial in 1H) and **Double Weapons** (e.g., *Quarterstaff*, *Orc Double Axe*, *Dire Flail*, *Two-Bladed Sword*: toggleable between single-end `'two_handed'` mode with $1.5\times \text{STR}$ / $0$ TWF penalty and `'double_weapon_twf'` mode treated as `one_handed` primary + `light` off-hand).
- [x] **Limb Occupation Filtering, Primary-to-Secondary Natural Demotion & Multi-Armed (`3+` Hands) Sequencing (`dnd35e_ruleset.ts`, `attack_resolver.ts`)**:
  - Populate `naturalWeaponLimbs` and `occupiedLimbGroupIds` from the actor's equipped/two-handed `EquipmentComponent.slots` when calling `buildFullAttackSequence` in `resolveDnD35eMeleeAttack`, so natural weapons on occupied limbs (e.g., a `Claw` on a hand holding a sword, shield, or two-handed grip) are suppressed and all remaining unblocked natural weapons (even normally primary ones like `Bite` or `Gore`) are automatically demoted to `natural_secondary` (`-5` penalty, or `-2` with *Multiattack*, and $0.5\times \text{STR}$ damage) without imposing TWF penalties on the manufactured weapon.
  - Extend `resolveEquippedWeaponProfile` and `buildFullAttackSequence` to support multi-armed creatures ($3+$ `held` hand slots, e.g., 6-armed Marilith) with `1` primary hand and $N-1$ off-hand weapons.
- [x] **Per-Strike Power Attack Handedness Resolution (`attack_resolver.ts`, `dnd35e_ruleset.ts`)**:
  - Decouple Power Attack's damage bonus from the actor-wide flat `dagResult.damageBonus` during full-attack execution so each individual strike in a mixed routine computes its own Power Attack damage multiplier from that strike's effective handedness (`2x` for `'two_handed'`, `1x` for `'one_handed'`, `'primary_natural_sole'`, or natural weapons, and `0x` for `'light'` weapons—preventing main-hand Power Attack damage from bleeding onto a light off-hand weapon).

## 🟢 Milestone 112.8: Programmatic SSOT Responsibility Registries, Parity Validator, Markdown Generator & Docs Reorganization

Reorganize `/docs`, establish canonical Single Source of Truth (SSOT) responsibility maps for the Console Engine and D&D 3.5e Cartridge, and enforce 100% architectural coverage and export parity programmatically via continuous validation.

- [x] **Documentation Reorganization (`docs/`)**:
  - Restructure `/docs` into clean subfolders (`ssot/`, `dnd35e/`, `guides/`, `archive/`), preserving only living core references at the root (`ARCHITECTURE.md`, `DECISIONS.md`, `MILESTONES.md`, `SSOT_CONSOLE.md`, `SSOT_DND35E.md`).
  - Update all `@see /docs/...` JSDoc links in source code to reference new clean paths.
- [x] **SSOT Responsibility Registries (`docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json`)**:
  - Author comprehensive JSON registries covering 100% of TypeScript source files (251 Console Engine files and 33 D&D 3.5e files).
  - Explicitly define domain, architectural tier, responsibility, canonical entry points, ownership boundaries (includes/excludes), and forbidden anti-patterns for every module.
- [x] **SSOT Parity Engine & Markdown Generator (`scripts/ssot_parity.ts`, `scripts/map-codebase.ts`)**:
  - Implement `validateSsotRegistries` enforcing complete partition, zero orphan files, live AST export validation, and synchronized markdown maps.
  - Upgrade `scripts/map-codebase.ts` to generate `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` and support `--check` mode (`bun run map:ssot`).
- [x] **Continuous Verification & Process Integration (`scripts/run-validator.ts`, `tests/`, `AGENTS.md`)**:
  - Wire SSOT parity verification directly into `scripts/run-validator.ts` and author unit test suite `tests/ssot_registry_parity.test.ts`.
  - Update `AGENTS.md` Kickoff Step 4 (SSOT verification and old-brain eviction) and After Writing Code Step 11 (SSOT registry maintenance).

## 🟢 Milestone 112.9: Unified Character Creation & Level-Up Step Components, Declarative Multiclass Composition, 3-Horizon Stat Pipeline, Per-Class Spellbooks, Mandatory Step Gating, Filter Chips & Divine Prayerbook Rules (Complete)

Unify the duplicated step UI between Character Creation (`src/rendering/ui/dnd35e_char_builder.ui.ts`, `src/rendering/ui/dnd35e_char_builder_steps.ui.ts`) and Level-Up (`src/rendering/ui/dnd35e_level_up.ui.ts`), model SRD 3.5e Multiclass Characters restrictions and cross-class feature stacking declaratively in JSON (`classes/<id>.json`, `dnd35e_system.types.ts`), enforce the 3-Horizon Computation boundary across `level_ledger.ts`, `srd_registry.ts`, and `modifiers.ts`, refactor spellbooks to be keyed per base casting class, and enforce mandatory choice validation, filterable Feat/Spell catalogs, and Divine vs. Arcane spell acquisition rules.

- [x] **Unified Reusable Step Component Architecture (`dnd35e_char_builder_steps.ui.ts`, `dnd35e_char_builder.ui.ts`, `dnd35e_level_up.ui.ts`)**:
  - Eliminate the duplicate inline Skills, Feats, and Class rendering in `dnd35e_level_up.ui.ts` by refactoring `dnd35e_char_builder_steps.ui.ts` into parameterized, reusable step components (`renderSharedClassStep`, `renderSharedSkillsStep`, `renderSharedFeatsStep`, `renderSharedClassSpellStep`) consumed by both Level 1 Character Creation and Level 2–20 Level-Up advancement.
- [x] **Declarative Class Restrictions, Cross-Class Feature Upgrade & Scaling Pool Schema (`dnd35e_system.types.ts`, `classes/<id>.json`, `level_ledger.ts`)**:
  - **Zero Hardcoded Class IDs**: Model class restrictions and cross-class stacking rules declaratively on `DnD35ClassDefinitionSchema` and `DnD35ClassFeatureDetailSchema` / `DnD35EffectBundleSchema`:
    - **Declarative Literacy & Conditional Restrictions (`grantsLiteracy`, `activationCondition`, `grantedTags`)**: Add `grantsLiteracy: z.boolean().default(true)` to `DnD35ClassDefinitionSchema` (`false` in `barbarian.json`) and `grantedTags` to `DnD35ClassFeatureDetailSchema`. Any class with `grantsLiteracy: true` projects `trait:literate` onto the actor (as does spending 2 skill points on literacy); `barbarian.json`'s `illiteracy` feature declares `activationCondition: { selfTagsNone: ['trait:literate'] }` and `grantedTags: ['trait:illiterate']` so a 1st-level Barbarian is illiterate until they gain a literate class level or spend 2 skill points, and any literate character who later multiclasses into Barbarian never becomes illiterate—with zero `if (classId === 'barbarian')` branches in code.
    - **Declarative Duplicate Feature Upgrade (`upgradeOnDuplicateFeatureId`)**: Add `upgradeOnDuplicateFeatureId?: string` to `DnD35ClassFeatureDetailSchema`. In `barbarian.json` and `rogue.json` (and future Uncanny Dodge classes), `uncanny_dodge` declares `"upgradeOnDuplicateFeatureId": "improved_uncanny_dodge"`. When `rebuildActorStateFromLevelHistory` aggregates features across class tracks and encounters a second grant of `uncanny_dodge`, it generically upgrades the grant to `improved_uncanny_dodge`.
    - **Declarative Cross-Class Scaling Pools (`scalingPoolContribution` $\to$ `dndData.scalingPools`)**: Add `scalingPoolContribution?: { poolId: string; multiplier?: number; offset?: number; minClassLevel?: number }` to `DnD35ClassFeatureDetailSchema`:
      - `uncanny_dodge` in `barbarian.json` & `rogue.json`: `{ "poolId": "uncanny_dodge_effective_level", "multiplier": 1, "offset": 0 }` (determining the `sum + 4` Rogue level needed to flank).
      - `turn_undead` in `cleric.json` (`{ "poolId": "turn_undead_effective_level", "multiplier": 1, "offset": 0 }`) and `paladin.json` (`{ "poolId": "turn_undead_effective_level", "multiplier": 1, "offset": -3, "minClassLevel": 4 }`).
      - `summon_familiar` in `wizard.json` & `sorcerer.json`: `{ "poolId": "familiar_master_effective_level", "multiplier": 1, "offset": 0 }`.
      - Aggregate all active pool contributions into `dndData.scalingPools: Readonly<Record<string, number>>` during `rebuildActorStateFromLevelHistory`.
- [x] **3-Horizon Computation Boundary & Live Situational Self-Tag Projection (`level_ledger.ts`, `srd_registry.ts`, `modifiers.ts`, `dnd35e_char_builder_steps.ui.ts`)**:
  - **Horizon 1 — Commit-Time Ledger (`levelHistory` in Character Creation & Level-Up)**:
    - Compute per-level skill point budgets strictly from **permanent base Intelligence** (`base + racial + level-up 4th-HD increases + inherentBonus`, excluding temporary buffs or equipped enhancement items per SRD).
    - Separate **Character-Wide Skill Max Rank Cap** (`isEverClassSkill`: max rank is $\text{CharacterLevel} + 3$ if the skill belongs to **any** owned class track in `levelHistory` or selected Cleric domains; otherwise $(\text{CharacterLevel} + 3) / 2$) from **Per-Level Skill Point Purchase Cost** (`isActiveLevelClassSkill`: `1 pt = 1.0 rank` if a class skill of the specific class being leveled right now; `1 pt = 0.5 rank` if cross-class for the class being leveled right now, even when the max cap remains $\text{CharacterLevel} + 3$). Fix the bug in `dnd35e_level_up.ui.ts` where taking a second class wrongly halved the max rank cap of prior class skills.
  - **Horizon 2 — Deterministic Progression Rebuild (`rebuildActorStateFromLevelHistory`)**:
    - Rebuild `tracks`, aggregated `skillRanks`, permanent `feats`, `scalingPools`, and `spellbooksByClass` from `levelHistory`.
    - Emit class feature, domain, racial, and feat `StatModifier`s **with their `condition: { selfTagsAll, selfTagsAny, selfTagsNone }` preserved** (rather than pre-filtering them out at rebuild time) so situational equipment/load/stance changes can toggle them dynamically at Horizon 3 without mutating `levelHistory` or re-running level-up.
  - **Horizon 3 — Live Situational Evaluation (`projectDnD35ActorSemanticTags` & `evaluateDnD35ActorStatDAG`)**:
    - Expand `projectDnD35ActorSemanticTags` to project live situational tags from currently equipped armor/shields (`armor:none`, `armor:light`, `armor:medium`, `armor:heavy`, `shield:none`, `shield:any`, `armor_material:metal`), encumbrance (`load:light`, `load:medium`, `load:heavy`), active conditions/stances, and permanent literacy/feature tags (`trait:literate`, `trait:illiterate`) so DAG Stage 1–4 evaluation and `resolveTypedModifiersWithBreakdown` dynamically activate or suppress conditional features (such as Barbarian *Fast Movement*, Ranger *Combat Style*, or Monk *AC Bonus*) with full `'tag_condition'` provenance.
- [x] **Per-Class Spellbook State, Prestige `advancesSpellcasting` Target Selection & Dynamic Per-Class Spell Steps (`dnd35e.types.ts`, `level_ledger.ts`, `progression.ts`, `character_builder.ts`, `spellcasting.ts`)**:
  - Partition spell repertoires and level-history spell acquisitions by base casting class ID: add `advancedSpellcastingClassIds?: ReadonlyArray<string>` and `learnedSpellsByClass?: Readonly<Record<string, ReadonlyArray<string>>>` to `DnD35CharacterLevelRecord`, and `spellbooksByClass?: Readonly<Record<string, DnD35ClassSpellbookState>>` to `DnD35EntityData` so multiclass casters (e.g. *Wizard / Sorcerer* or *Wizard / Cleric / Mystic Theurge*) maintain strictly isolated spell lists, Caster Levels, governing ability scores (`INT` vs. `WIS` vs. `CHA`), Save DCs, and Arcane Spell Failure rules, and track which class's spell list each cast spell originates from.
  - Update `computeEffectiveClassCastingLevel` and `renderSharedClassStep` so that when leveling in a Prestige Class with `advancesSpellcasting: 'arcane' | 'divine' | 'both' | 'any'`, the player explicitly chooses which eligible base casting class(es) to advance (auto-selected when only one eligible base class exists for that tradition).
  - Instead of mixing multiple spellbooks in one panel, dynamically append **one dedicated `renderSharedClassSpellStep` tab per advanced class that requires manual spell selection** during Level-Up (e.g. `4. Wizard Spellbook (+2 Spells)` and `5. Sorcerer Spells Known` for a dual-arcane *Mystic Theurge*).
- [x] **Divine Prayerbook Automatic Spell List Access & Arcane Selection Budgets (`character_builder.ts`, `dnd35e_char_builder_steps.ui.ts`)**:
  - Exempt Divine `prepared_prayerbook` classes (**Cleric**, **Druid**, **Paladin**, **Ranger**) from manual spell selection in Character Creation and Level-Up, since SRD divine prayerbook casters automatically know all spells on their class list (plus Domain spells for Clerics) when preparing daily slots. Do not spawn a manual spell-picker step for Divine or non-casting classes (allowing direct progression from Feats to Equipment/Confirm, or showing an automatic Divine Prayerbook + Domain summary).
  - Enforce authentic SRD spell selection budgets per advanced Arcane class: **Wizard** (`prepared_spellbook`) automatically receives all 0th-level cantrips (excluding prohibited schools) at Level 1 plus $3 + \max(0, \text{INT mod})$ 1st-level spells, and gains $+2$ free spells of any castable level per subsequent effective Wizard level; **Sorcerer** and **Bard** (`spontaneous`) select their exact incremental `spellsKnown` deltas per spell level.
- [x] **Mandatory Choice Validation & Step/Tab Navigation Gating (`character_builder.ts`, `dnd35e_char_builder.ui.ts`, `dnd35e_level_up.ui.ts`)**:
  - Implement pure step-validation functions (`validateCharacterCreationStep`, `validateLevelUpStep`) checking that all mandatory choices for each step are complete:
    - **Race**: Valid race selected.
    - **Class & Paths**: Valid class and allowed alignment selected; Clerics must select exactly `2` Domains; Specialist Wizards must select valid Prohibited Schools (`validateSpecialistSchoolSelection`); Rangers must select a Favored Enemy; Level-Up every-4th-HD ability score increase and Prestige `advancesSpellcasting` target(s) selected.
    - **Ability Scores (Lv 1)**: Point-Buy cost must equal `draft.pointBuyBudget` in `point_buy` mode.
    - **Skills**: Skill points allocated within budget and rank caps.
    - **Feats**: Selected feats equal `budget.totalSlots`, respecting General vs. Class Bonus slot constraints.
    - **Per-Class Spells**: Required Arcane spellbook / known spells selected for that specific class tab.
    - **Equipment (Lv 1)**: Valid starting equipment package selected.
  - Disable both the **`Next Step →`** / **`Confirm`** buttons and forward **Top Step Tab buttons** (`idx > highestUnlockedStep`) until all mandatory choices on the current and prior steps are satisfied, displaying a clear inline validation prompt indicating which mandatory choice is still required.
- [x] **Feat & Spell Step Filter Buttons (`dnd35e_char_builder_steps.ui.ts`)**:
  - Add category & eligibility filter buttons (`All`, `Eligible`, `General`, `Fighter Bonus`, `Combat / Maneuver`, `Metamagic`, `Spellcasting`) to `renderSharedFeatsStep`.
  - Add spell-level filter buttons (`All`, `0lvl`, `1lvl`, `2lvl`, etc., derived dynamically from castable spell levels for that class) to `renderSharedClassSpellStep`.

---

# 🚀 Phase 24: D&D 3.5e System Content Pillars 3 & 5 — Complete SRD Skills, Feats, Weapons, Armor & Magic Items _(Branch: `DND35`)_

**Goal:** Expand the modular per-record registries in `public/data/rulesets/dnd35e/skills/<id>.json`, `feats/<id>.json`, and `items/<id>.json` (registered in `src/rulesets/dnd35e/system_content_files.ts`) to cover the complete SRD tactical skill matrix, feat prerequisite trees, mundane/exotic armaments, special materials, and magic item compendium—with every passive bonus, rule override, tactical stance, and active capability expressed as a `DnD35EffectBundle` emitting hierarchical `sourcePath` provenance into the **4-Stage Topological Sub-Stat DAG (`evaluateDnD35ActorStatDAG`)**.

## 🟢 Milestone 113: Complete SRD Skill Matrix & Active Dungeon/Combat Skill Verbs (Complete)

Expand `public/data/rulesets/dnd35e/skills/<id>.json` to the full 50-skill SRD modular registry with `effectBundle?: DnD35EffectBundle` rank-threshold grants and active dungeon/combat skill action descriptors, and wire skill checks into the verb and action pipelines.

- [x] **Full 50-Skill SRD Modular Registry (`skills/<id>.json` & `system_content_files.ts`)**: Author all SRD skills as individual modular JSON definitions with `keyAbility`, `trainedOnly`, `acpMultiplier` (`0`, `1`, or `2` for `Swim`), 5-rank `synergyFromSkills` links, and `effectBundle` rank-threshold/action grants (`sourcePath: "skill:<id>/..."`):
  - `Appraise`, `Balance` (5 ranks projects `trait:balance_uncanny_flat_footed` keeping Dex to AC while balancing; synergies from `Tumble`), `Bluff` (*Feint in Combat* standard action, or move action with *Improved Feint* rule override; synergies to `Diplomacy`, `Disguise`, `Intimidate`, `Sleight of Hand`), `Climb`, `Concentration` (defensive casting & spell maintenance), `Craft (alchemy, armorsmithing, bowmaking, trapmaking, weaponsmithing)`, `Decipher Script`, `Diplomacy` (shifts NPC `AttitudeComponent` across `Hostile -> Unfriendly -> Indifferent -> Friendly -> Helpful`; synergies from `Bluff`, `Knowledge (nobility)`, `Sense Motive`), `Disable Device`, `Disguise`, `Escape Artist` (synergy to/from `Use Rope` / grapple checks), `Forgery`, `Gather Information`, `Handle Animal`, `Heal` (`DC 15` First Aid stabilizes dying, Long-Term Care doubles natural healing, Treat Poison/Disease), `Hide`, `Intimidate` (*Demoralize Opponent*: Standard action vs. `10 + target HD + WIS mod` + fear bonuses to apply `Shaken` for 1 round), `Jump` (synergy to/from `Tumble`), `Knowledge (arcana, architecture, dungeoneering, geography, history, local, nature, nobility, religion, the planes)` (Monster Lore check `DC 10 + CR` reveals creature immunities/DR/vulnerabilities in the inspect tooltip), `Listen`, `Move Silently`, `Open Lock` (`DC 20..40` on `LockComponent`), `Perform`, `Profession`, `Ride`, `Search` (active/passive trap and secret door detection, respecting Rogue `trait:trapfinding` for `DC > 20`), `Sense Motive` (resists `Feint` and `Bluff`), `Sleight of Hand`, `Speak Language`, `Spellcraft` (`DC 15 + spellLevel` identifies spell being cast for Counterspell; `DC 20 + spellLevel` identifies scroll/potion; synergies to `Use Magic Device` on scrolls), `Spot`, `Survival` (*Track* feat surface DCs; 5 ranks grants `+2` synergy to `Knowledge (nature)`), `Swim`, `Tumble` (`DC 15` move at half speed through threatened squares without AoO; `DC 25` move through enemy square; 5+ ranks emits `ruleOverride` enhancing *Fighting Defensively* to `+3` Dodge AC and *Total Defense* to `+6` Dodge AC), `Use Magic Device` (`DC 20` activate wand, `DC 20 + CL` decipher/cast scroll, `DC 25` emulate ability score or race, `DC 30` emulate alignment), and `Use Rope`.
- [x] **Remediation — Stance Tag Projection & Declarative Skill Rank Threshold Tags (`dnd35e_ruleset.ts`, `srd_registry.ts`)**:
  - Project `stance:fighting_defensively` and `stance:total_defense` from `TacticalDoctrineComponent` into `mergedSelfTags` inside `evaluateDnD35eEntityDAG` so `tumble.json`'s 5-rank threshold Dodge AC bonuses (`+1` Fighting Defensively / `+2` Total Defense) activate properly when `effectiveTumbleRanks` is zeroed to prevent double-counting.
  - Update `projectDnD35ActorSemanticTags` to evaluate `grantedTags` declaratively from `skillRegistry[skillId].rankThresholdModifiers` rather than relying solely on hardcoded rank checks.
- [x] **Remediation — Tier 1 / Tier 2 Boundary Enforcement & Full Stat-DAG Skill Verb Dispatcher (`ruleset.types.ts`, `skill_verbs.ts`, `apply.system.ts`, `social.system.ts`, `zap.system.ts`, `viewport_snapshot.ts`)**:
  - Remove inline `rulesetId === 'dnd35e'` branches, untyped `Record<string, unknown>` casts, and raw `.base` ability math from Tier 1 Console modules (`apply.system.ts`, `social.system.ts`, `zap.system.ts`, `viewport_snapshot.ts`), routing cleanly through `RulesetContract` hooks (`resolveSkillVerb`, `getValidRulesetVerbsForTarget`, `validateWandActivation`, `projectInspectLoreLines`).
  - Implement Tier 2 `src/rulesets/dnd35e/skill_verbs.ts` (`evaluateActorSkillCheck`, `resolveDnD35eSkillVerb`) evaluating skill checks through the full 4-Stage Topological Stat DAG (incorporating effective ability scores, 5-rank synergies, Armor Check Penalty, typed `StatModifier`s, and fear condition penalties).
- [x] **Remediation — Stateful Dungeon & Combat Skill Verb Mutations (`skill_verbs.ts`)**:
  - Wire `unlock` (`resolveOpenLockCheck`) to read `LockComponent.difficulty` and mutate `LockComponent.locked = false` on success; wire `disarm` (`resolveDisableTrapCheck`) to check `trapfinding`, remove `TrapComponent` on success, or spring `TrapComponent.triggered = true` on a `-5` mishap; wire `search` (`resolveTrapSearchCheck`) to scan nearby tiles for hidden `TrapComponent`s; wire `heal` (`resolveHealSkillCheck`) to stabilize targets (`isStable: true`).
  - Allow `intimidate` and `feint` to target any creature (including combat monsters without `MemoryComponent`), applying `'shaken'` on a successful `resolveDemoralizeCheck` and `'flat_footed'` on a successful `resolveFeintCheck` (with non-humanoid `-4` and animal-intelligence `-8` penalties), and wire `persuade` (`resolveDiplomacyCheck`) to update `AttitudeComponent`.
  - Gate Monster Lore inspect tooltip lines (`Type`, `DR`, `SR`) in `Normal` UI mode behind the player's passive (Take 10) Knowledge check matching the creature's type (`CREATURE_TYPE_TO_KNOWLEDGE_SKILL`, `DC = 10 + HD` via `resolveMonsterLoreCheck`).
- [x] **Remediation — Named Constants & `min_skill_ranks` Prerequisite Validator (`skills.ts`, `aoe_rest.ts`, `dnd35e_validator.ts`)**:
  - Extract all gameplay literals across `skills.ts`, `skill_verbs.ts`, and `aoe_rest.ts` into exported, JSDoc-documented named constants (`AGENTS.md` Rule 12).
  - Extend `validatePrerequisiteNodeReferences` in `dnd35e_validator.ts` to verify that every `min_skill_ranks` prerequisite AST node references a valid skill ID in `sys.skills`.

## 🟢 Milestone 114: Complete SRD Feat Registry, Combat Chains & Metamagic Trees (`public/data/rulesets/dnd35e/feats/<id>.json`) (Complete)

Author the full SRD feat catalog as modular `public/data/rulesets/dnd35e/feats/<id>.json` files using recursive `prerequisites` AST nodes and unified `effectBundle: DnD35EffectBundle` definitions (`usageMode: 'passive' | 'activated' | 'toggle' | 'variable_dial' | 'triggered'`, `modifiers`, `ruleOverrides`, `activatedAbilities`, and `metamagicDescriptor` rules) with `sourcePath: "feat:<id>/..."` provenance feeding `evaluateDnD35ActorStatDAG`.

- [x] **Melee, Tactical Stance & Maneuver Feat Chains (`feats/<id>.json`)**:
  - *Power Attack* (`variable_dial` `0..BAB`) $\to$ *Cleave* (`triggered` extra attack on drop) $\to$ *Great Cleave*; *Improved Bull Rush* (`maneuver:bull_rush:bonus +4`, `maneuver:bull_rush:provokes_aoo = false`); *Improved Overrun*; *Improved Sunder* (`maneuver:sunder:bonus +4`, `maneuver:sunder:provokes_aoo = false`).
  - *Combat Expertise* (`variable_dial` `0..min(5, BAB)`) $\to$ *Improved Disarm*, *Improved Feint* (feint as Move action), *Improved Trip* (`maneuver:trip:bonus +4`, `maneuver:trip:provokes_aoo = false`, `maneuver:trip:followup_attack = true`), *Whirlwind Attack* (`PRIM-3.3` full-attack against all adjacent enemies).
  - *Dodge* (`+1` Dodge AC) $\to$ *Mobility* (`+4` Dodge AC vs. movement AoOs) $\to$ *Spring Attack* (move before and after melee attack without provoking AoO from target).
  - *Weapon Finesse* (`ruleOverride: use_dex_for_light_finesse_melee_attack`), *Weapon Focus* (`+1` atk) $\to$ *Weapon Specialization* (`+2` dmg, Fighter 4th) $\to$ *Greater Weapon Focus* (`+1` atk, Fighter 8th) $\to$ *Greater Weapon Specialization* (`+2` dmg, Fighter 12th), *Improved Critical* (doubles weapon threat range; does not stack with *Keen*).
  - *Two-Weapon Fighting* (`twf_primary_penalty` / `twf_offhand_penalty` reduced to `-4/-4`, or `-2/-2` with light off-hand) $\to$ *Two-Weapon Defense* (`+1` shield AC, `+2` when fighting defensively) $\to$ *Improved Two-Weapon Fighting* (`BAB +6`, 2nd off-hand attack at `-5`) $\to$ *Greater Two-Weapon Fighting* (`BAB +11`, 3rd off-hand attack at `-10`).
  - *Improved Unarmed Strike* $\to$ *Improved Grapple* (`+4` grapple, `maneuver:grapple:provokes_aoo = false`) / *Deflect Arrows* (`triggered` reaction) $\to$ *Snatch Arrows* / *Stunning Fist* (`activated` via `ResourcePoolComponent`: `Fort DC 10 + 1/2 HD + WIS mod` stuns for 1 round).
- [x] **Ranged, Defensive, Save, Skill & Monster Feats (`feats/<id>.json`)**:
  - *Point Blank Shot* (`+1` atk/dmg within 30 ft) $\to$ *Precise Shot* (negates `-4` penalty for firing into melee) $\to$ *Improved Precise Shot* (`BAB +11, DEX 19`, ignores anything less than total cover/concealment); *Far Shot* ($\times 1.5$ projectile range, $\times 2$ thrown range); *Rapid Shot* (`toggle` full-attack modifier); *Manyshot* (`activated` standard action volley); *Shot on the Run*; *Rapid Reload* (light crossbow reload is free action, heavy is move action); *Quick Draw* (draw weapon as free action).
  - *Combat Reflexes* (`max_aoo_per_round = 1 + DEX mod`, allows AoOs while flat-footed), *Blind-Fight* (reroll miss chance from concealment, invisible melee attackers gain no `+2` bonus), *Improved Initiative* (`+4` initiative), *Toughness* (`+3` HP), *Endurance* $\to$ *Diehard* (automatically stabilize at `-1..-9 HP` and act as `Disabled` instead of unconscious), *Iron Will*, *Lightning Reflexes*, *Great Fortitude*, *Skill Focus*, *Alertness*, *Stealthy*, *Nimble Fingers*, *Acrobatic*, *Agile*, *Athletic*, *Deceitful*, *Deft Hands*, *Diligent*, *Investigator*, *Magical Aptitude*, *Negotiator*, *Persuasive*, *Self-Sufficient*.
  - Monster Feats: *Multiattack* (shifts `secondary_natural_penalty` from `-5` to `-2`), *Multiweapon Fighting* $\to$ *Improved / Greater Multiweapon Fighting* (for 3+ armed actors like Mariliths), *Ability Focus* (`+2` DC to a special attack), *Awesome Blow*, *Empower Spell-Like Ability*, *Quicken Spell-Like Ability*, *Flyby Attack*, *Hover*, *Improved Natural Armor* (`+1` natural armor), *Improved Natural Attack* (increases natural weapon damage by 1 size step), *Snatch*, *Wingover*.
- [x] **Spellcasting & Metamagic Feats (`feats/<id>.json`)**:
  - *Combat Casting* (`+4` Concentration when casting defensively or grappling), *Spell Focus* (`+1` DC to chosen school) $\to$ *Greater Spell Focus* (`+1` additional DC), *Spell Penetration* (`+2` CL check vs. SR) $\to$ *Greater Spell Penetration* (`+2` additional vs. SR), *Augment Summoning* (`+4` enhancement `STR` and `CON` to summoned creatures), *Natural Spell* (`ruleOverride: allow_spellcasting_in_wild_shape`), *Eschew Materials*.
  - Metamagic (`PRIM-3.4`): *Empower Spell* (`+2` slot), *Enlarge Spell* (`+1` slot, doubles range), *Extend Spell* (`+1` slot, $\times 2$ duration), *Heighten Spell* (variable slot), *Maximize Spell* (`+3` slot), *Quicken Spell* (`+4` slot, swift action), *Silent Spell* (`+1` slot), *Still Spell* (`+1` slot), *Widen Spell* (`+3` slot, $+100\%$ burst/emanation/spread area).

## 🟢 Milestone 115: Complete SRD Weapons, Armors, Special Materials & Magic Item Compendium (`public/data/rulesets/dnd35e/items/<id>.json`) (Complete)

Define a modular `public/data/rulesets/dnd35e/items/<id>.json` registry (`DnD35ItemDefinitionSchema` registered in `system_content_files.ts`) where mundane armaments, special materials, and magic items carry `effectBundle?: DnD35EffectBundle` modifiers emitted with `sourcePath: "item:<itemId>/..."` that feed directly into `evaluateDnD35ActorStatDAG` (Stages 1–4) when equipped in `EquipmentComponent.slots`.

- [x] **Simple, Martial & Exotic Weapons (`items/<id>.json`)**:
  - **Simple**: Gauntlet, Unarmed Strike, Dagger (`1d4`, `19–20/×2`, 10 ft thrown), Punching Dagger (`×3`), Spiked Gauntlet, Light Mace, Sickle, Club, Heavy Mace, Morningstar (`bludgeoning and piercing`), Shortspear, Longspear (`reach 10 ft`, brace vs. charge), Quarterstaff (double weapon `1d6/1d6`), Spear, Heavy/Light Crossbow, Dart, Javelin, Sling.
  - **Martial**: Throwing Axe, Light Hammer, Handaxe (`×3`), Kukri (`18–20/×2`), Light Pick (`×4`), Sap (nonlethal), Short Sword, Battleaxe (`1d8/×3`), Flail (`+2` disarm, trip), Longsword (`1d8`, `19–20/×2`), Heavy Pick (`×4`), Rapier (`18–20/×2`, finesse), Scimitar (`18–20/×2`), Trident, Warhammer (`1d8/×3`), Falchion (`2d4`, `18–20/×2`), Glaive (`1d10`, `×3`, reach), Greataxe (`1d12/×3`), Greatclub (`1d10`), Greatsword (`2d6`, `19–20/×2`), Guisarme (`2d4/×3`, reach, trip), Halberd (`1d10/×3`, trip), Lance (reach), Ranseur (`2d4/×3`, reach, `+2` disarm), Scythe (`2d4/×4`, trip), Shortbow / Composite Shortbow, Longbow / Composite Longbow (`STR` rating bonus to damage).
  - **Exotic**: Kama, Nunchaku, Sai, Siangham, Bastard Sword (`1d10`, 1H exotic / 2H martial), Dwarven Waraxe (`1d10/×3`, 1H exotic / 2H martial), Whip (15 ft reach, nonlethal, trip/disarm), Orc Double Axe, Spiked Chain (`2d4`, 5 ft & 10 ft reach, finesse, trip, `+2` disarm), Dwarven Urgrosh, Gnome Hooked Hammer, Two-Bladed Sword, Hand Crossbow, Repeating Crossbow, Shuriken, Bolas, Net.
- [x] **Light, Medium & Heavy Armors, Shields & Special Material Variants (`items/<id>.json` via `PRIM-5.1`)**:
  - **Light**: Padded (`+1 AC, Max Dex +8, ACP 0, ASF 5%`), Leather (`+2 AC, Max Dex +6, ACP 0, ASF 10%`), Studded Leather (`+3 AC, Max Dex +5, ACP -1, ASF 15%`), Chain Shirt (`+4 AC, Max Dex +4, ACP -2, ASF 20%`), **Mithral Chain Shirt** (`+4 AC, Max Dex +6, ACP 0, ASF 10%`).
  - **Medium**: Hide (`+3 AC`), Scale Mail (`+4 AC`), Chainmail (`+5 AC`), Breastplate (`+5 AC, Max Dex +3, ACP -4, ASF 25%`), **Mithral Full Plate** (treated as Medium armor: `+8 AC, Max Dex +3, ACP -3, ASF 25%`).
  - **Heavy**: Splint Mail (`+6 AC`), Banded Mail (`+6 AC`), Half-Plate (`+7 AC`), Full Plate (`+8 AC, Max Dex +1, ACP -6, ASF 35%`), **Adamantine Full Plate** (`DR 3/-`).
  - **Shields**: Buckler (`+1 AC`, allows bow use without penalty, `-1` atk if attacking with buckler arm), Light Wooden/Steel Shield (`+1 AC`), Heavy Wooden/Steel Shield (`+2 AC`), **Darkwood Heavy Shield** (`ACP 0`), Tower Shield (`+4 AC`, `-2` attack rolls, `Max Dex +2`, can grant Total Cover as a Standard action).
- [x] **Weapon/Armor Magical Properties, Wondrous Items (Anatomical Slots), Rings, Rods, Staves, Wands, Scrolls & Potions (`items/<id>.json`)**:
  - **Weapon & Armor Properties**: `+1` to `+5` Enhancement (emitting `enhancement` bonus to `worn_armor_bonus` / `worn_shield_bonus` in DAG Stage 3 or weapon attack/damage), *Flaming*, *Frost*, *Shock*, *Corrosive*, *Screaming*, *Flaming/Frost/Shock Burst*, *Keen*, *Ghost Touch* (emits `effectTags: ['ghost_touch']` so DAG Stage 4 preserves armor/shield AC against incorporeal touch attacks), *Holy*, *Unholy*, *Axiomatic*, *Anarchic*, *Bane* (`undead`, `giant`, `orc`, `goblinoid`, `dragon`, `evil_outsider` via `targetTagsAny`), *Disruption* (Undead Will DC 14 or destroyed on bludgeoning hit), *Wounding*, *Speed*, *Vorpal*, *Brilliant Energy*, *Animated* Shield, *Fortification* (Light `25%` / Moderate `75%` / Heavy `100%`), *Spell Resistance* (`13/15/17/19`), *Shadow*, *Silent Moves*, *Slick*.
  - **Wondrous Items & Rings (`effectBundle` with `sourcePath: "item:<id>/..."`)**: *Headband of Intellect* (`+2/+4/+6` enhancement `INT`), *Periapt of Wisdom* (`+2/+4/+6` enhancement `WIS`), *Cloak of Charisma* (`+2/+4/+6` enhancement `CHA`), *Belt of Giant Strength* (`+4/+6` enhancement `STR`), *Gloves of Dexterity* (`+2/+4/+6` enhancement `DEX`), *Amulet of Health* (`+2/+4/+6` enhancement `CON`), *Amulet of Natural Armor* (`+1..+5` enhancement to `natural_armor` in DAG Stage 3), *Amulet of Mighty Fists* (`+1..+5` enhancement to natural/unarmed attacks), *Ring of Protection* (`+1..+5` `deflection` AC), *Cloak of Resistance* (`+1..+5` `resistance` to all saves), *Bracers of Armor* (`+1..+8` `armor` AC with `effectTags: ['force']`), *Boots of Speed* (free-action *Haste* 10 rounds/day via `ResourcePoolComponent`), *Boots of Striding and Springing* (`+10 ft` enhancement speed, `+5` competence `Jump`), *Cloak of Elvenkind* (`+5` competence `Hide`), *Boots of Elvenkind* (`+5` competence `Move Silently`), *Goggles of Night* (Darkvision 60 ft), *Ring of Evasion*, *Ring of Freedom of Movement*, *Ring of Invisibility*, *Ring of Regeneration*, *Bag of Holding* (`I–IV` weight reduction), *Handy Haversack* (retrieving item is a Move action that does not provoke AoO).
  - **Consumables & Charged Items**: Potions/Oils (*Cure Light/Moderate/Serious Wounds*, *Barkskin*, *Shield of Faith*, *Bull's Strength*, *Invisibility*, *Heroism*, *Neutralize Poison*, *Remove Paralysis*), Arcane/Divine Scrolls (`spell_completion`), Wands (`50` charges, `spell_trigger`), Staves (*Staff of Fire*, *Staff of Frost*, *Staff of Healing*, *Staff of Power*), and Metamagic Rods (*Lesser/Normal/Greater Empower, Extend, Maximize, Quicken, Silent*).

## 🟢 Milestone 115.1: Declarative Rule-Override Routing, Codified Crit Threat Expansion, Per-Strike Weapon-Scoped Modifiers & Data-Driven Cleanup (Complete)

Eliminate the remaining hardcoded feat/skill/class/weapon checks across `src/rulesets/dnd35e/` and `src/rendering/ui/dnd35e_char_builder_feats.ui.ts`, routing all combat rule overrides, critical threat range expansions, weapon-specific feat bonuses, tactical doctrine dials, Tumble defensive fighting synergy, monster class curve hydration, and feat category filters through declarative JSON definitions and the 4-Stage Topological Stat DAG (`AGENTS.md` Rules 12, 16, 17, 19, and 20).

- [x] **Codified Non-Stacking Critical Threat Expansion (`stats.types.ts`, `stacking_engine.ts`, `weapon_profile_parser.ts`, `attack_routine.ts`, `dnd35e_equipped_item_dag.ts`, `feats/improved_critical*.json`)**:
  - Add `'threat_expansion'` to `BonusType` (`src/rulesets/dnd35e/types/stats.types.ts` and `DnD35BonusTypeSchema`) as a non-stacking bonus type in `resolveTypedModifiersWithBreakdown`.
  - Have `magicalProperties.keen` (in `collectEquippedItemDAGContributions`) and `improved_critical.json` (plus weapon-specific `improved_critical_<weaponId>`) emit `{ targetStat: 'crit_threat_doubling', value: 1, bonusType: 'threat_expansion', condition: { effectTagsAny: ['weapon:<weaponId>'] } }` with full `sourcePath` provenance (`item:<id>/keen` vs. `feat:improved_critical/threat_expansion`).
  - Resolve per-strike critical threat expansion via `resolveTypedModifiersWithBreakdown` in `resolveActorAttackRoutine` (`attack_routine.ts`) and remove the hardcoded `hasImprovedCrit` / `isKeen || hasImprovedCrit` feat-ID check from `weapon_profile_parser.ts`, so *Keen*, *Improved Critical*, and *Keen Edge* automatically compete in the `'threat_expansion'` bucket (recording shadowed losers in `shadowedModifiers`) while allowing any `'untyped'` threat modifier to stack.
- [x] **Pure Declarative `featRuleOverrides` Routing in Combat, DAG & Proficiency Resolvers (`dnd35e_dag_adapter.ts`, `dnd35e_combat_adapter.ts`, `weapon_profile_parser.ts`)**:
  - Remove direct `dndData.feats?.includes('weapon_finesse' | 'two_weapon_fighting' | 'multiweapon_fighting' | 'multiattack')` checks from `evaluateDnD35eEntityDAG` (`dnd35e_dag_adapter.ts`) and derive `hasWeaponFinesse` and `CombatRuleOverrides` (`twfPrimaryPenalty`, `twfOffHandPenalty`, `secondaryNaturalPenalty`, `extraOffHandAttacks`) strictly from active `ruleOverrides` (`use_dex_for_light_finesse_melee_attack`, `twf_primary_penalty`, `twf_offhand_penalty`, `secondary_natural_penalty`, `extra_offhand_attacks`).
  - Remove direct `attackerData.feats?.includes('cleave' | 'great_cleave')` checks from `resolveDnD35eMeleeAttack` (`dnd35e_combat_adapter.ts`) and evaluate Cleave / Great Cleave eligibility from active `ruleOverrides` (`cleave_followup_on_drop`, `great_cleave_unlimited_on_drop`).
  - Replace hardcoded `exotic_weapon_proficiency` and `weaponItemId.includes('dwarven')` checks in `evaluateNonproficiencyPenalty` (`weapon_profile_parser.ts`) with declarative `familiaritySubtypes` and active `ruleOverrides` / self-tags (`proficiency:exotic`, `proficiency:weapon:<id>`).
- [x] **Per-Strike Weapon-Scoped Feat & Item Modifiers (`attack_routine.ts`, `dnd35e_dag_adapter.ts`, `feats/weapon_focus*.json`, `feats/weapon_specialization.json`, `feats/greater_weapon_*.json`)**:
  - Pass candidate `statModifiers` and actor `selfTags` into `resolveActorAttackRoutine` (`attack_routine.ts`) and evaluate per-strike weapon-scoped modifiers using `effectTags: ['weapon:<id>', 'weapon_category:<simple|martial|exotic>', 'weapon_effort:<light|one_handed|two_handed>', 'attack_source:<manufactured|natural>']`.
  - Scope `weapon_focus_*.json`, `weapon_specialization.json`, `greater_weapon_focus.json`, and `greater_weapon_specialization.json` modifiers with `condition: { effectTagsAny: ['weapon:<id>'] }` so weapon-specific attack/damage bonuses apply strictly to strikes made with the matching weapon rather than bleeding across all weapons in a mixed full-attack routine.
- [x] **Data-Driven Tactical Doctrine Dials & Pure Tumble Rank-Threshold Synergy (`tactical_doctrine.ts`, `dnd35e_dag_adapter.ts`)**:
  - Extract active `TacticalDialDescriptor[]` dynamically from the actor's owned feats/features (`featDef.effectBundle.activatedAbilities[].variableDial` in `power_attack.json` and `combat_expertise.json`), keeping `CANONICAL_TACTICAL_DIALS` only as a fallback when no system content registry is loaded.
  - Remove the duplicate `hasTumbleSynergy = dndFloor(tumbleRanks) >= 5` branch from `evaluateTacticalDoctrineModifiers` (`tactical_doctrine.ts`) and the `effectiveTumbleRanks` workaround from `dnd35e_dag_adapter.ts`, so `tactical_doctrine.ts` emits only baseline stance modifiers (`+2` Fighting Defensively, `+4` Total Defense) while `tumble.json`'s 5-rank `rankThresholdModifiers` (conditioned on `stance:fighting_defensively` / `stance:total_defense`) supply the additional `+1` / `+2` Dodge AC declaratively.
- [x] **Data-Driven Class Curves, Literacy, Domain Spell Slots, Skill Take-10/20 Flags & UI Feat Category Filters (`race_hydrator.ts`, `semantic_tags.ts`, `dnd35e_combat_adapter.ts`, `builder_spells.ts`, `skills.ts`, `dnd35e_char_builder_feats.ui.ts`)**:
  - Update `hydrateRaceAsArchetype` (`race_hydrator.ts`) to read `babCurve`, `fortCurve`, `refCurve`, and `willCurve` directly from `clsDef` (`sysContent.classes[cl.classId]`) instead of checking `cl.classId === 'warrior' || cl.classId === 'fighter'`.
  - Pass `sysContent?.classes` and `sysContent?.skills` into `projectDnD35ActorSemanticTags` inside `dnd35e_combat_adapter.ts` and remove the legacy `'barbarian'` string check from `semantic_tags.ts`.
  - Update `getSpellLevelForClass` (`builder_spells.ts`) to check `domainIds.length > 0` (or class `domainSpellSlots` presence) rather than `classId === 'cleric'`, and update `resolveSkillCheck` (`skills.ts`) to rely strictly on `params.definition.take10Allowed === false` / `take20Allowed === false` without checking `skillId === 'use_magic_device'`.
  - Replace the hardcoded `COMBAT_FEAT_IDS` array and substring heuristics in `classifyFeatCategory` (`src/rendering/ui/dnd35e_char_builder_feats.ui.ts`) with declarative classification derived from `feat.isFighterBonusFeat`, `feat.metamagicDescriptor`, and `feat.effectBundle`.

---

# 🚀 Phase 25: D&D 3.5e System Content Pillar 4 — Comprehensive SRD Grimoire (0th–9th Level Arcane & Divine Spells) _(Branch: `DND35`)_

**Goal:** Expand the modular spell registry in `public/data/rulesets/dnd35e/spells/<id>.json` into a comprehensive SRD 3.5e Grimoire (levels 0–9 across Wizard/Sorcerer, Cleric, Druid, Bard, Paladin, Ranger, Assassin, Blackguard, and 22 Cleric Domains) with explicit `levelByClass`, `levelByDomain`, `subschool`, `descriptors` (`['mind_affecting', 'fear', 'fire', 'force', ...]`), and `effectBundle?: DnD35EffectBundle` grants emitting `sourcePath: "spell:<spellId>:<castId>/..."` provenance into the 4-Stage Topological Stat DAG, paired with `FieldComponent` spatial zones (`PRIM-4.2`), Concentration Maintainers (`PRIM-4.1`), Dispel resolvers (`PRIM-4.3` via `revokeModifiersByPathPrefix`), and Polymorph overlays (`PRIM-2.3`).

## ✅ Milestone 116: Low-Level Tactical Spells (0th–3rd Level Arcane & Divine) (`public/data/rulesets/dnd35e/spells/<id>.json`)

Upgrade `DnD35SpellDefinitionSchema` with `levelByClass`, `levelByDomain`, `levelByAccessTag`, `subschool`, `descriptors`, `effectUnits`, and `effectBundle`, and author the foundational dungeon-crawling spell repertoire (Levels 0–3 + complex multi-role tethered showcase *Battletide*) in `public/data/rulesets/dnd35e/spells/<id>.json`.

- [x] **0th–1st Level Spells (`spells/<id>.json`)**:
  - **Arcane**: *Acid Splash* (`1d3` ranged touch, no SR), *Ray of Frost*, *Daze* (`Will negates`, `descriptors: ['mind_affecting']`, Humanoid $\le 4$ HD), *Resistance*, *Detect Magic* (`Concentration`), *Light*, *Mage Armor* (`+4` `armor` AC with `effectTags: ['force']` so DAG Stage 4 applies it vs. incorporeal touch attacks), *Shield* (`+4` `shield` AC with `effectTags: ['force']`, `ruleOverride: immune_magic_missile`), *Grease* (10-ft square field: `Ref save` or fall `prone`, `Balance DC 10` to move), *Sleep* (`4 HD` pool in 10-ft burst, lowest HD first, `descriptors: ['mind_affecting', 'sleep']`), *Color Spray* (15-ft cone: unconscious/blinded/stunned by HD), *Charm Person*, *Magic Missile* ($1\text{ to }5$ missiles at CL $1,3,5,7,9$, `descriptors: ['force']`), *Burning Hands* (15-ft cone), *Shocking Grasp* (`+3` attack if target wears metal), *True Strike* (`+20` `insight` on next attack, ignores concealment), *Ray of Enfeeblement* (`1d6 + min(5, floor(CL/2))` `STR` penalty, min 1 `STR`), *Enlarge Person* / *Reduce Person* (emits Stage 1 `'size'` modifier `+1` or `-1` step in the Stat DAG, automatically cascading size deltas and weapon dice scaling), *Expeditious Retreat* (`+30 ft` enhancement speed), *Feather Fall* (`Immediate` action).
  - **Divine**: *Guidance*, *Cure Minor Wounds*, *Virtue* (`1` temp HP), *Bless* (50-ft burst `+1` `morale` attack and save vs. `descriptor:fear`), *Bane*, *Command*, *Divine Favor* (`+1..+3` `luck` atk/dmg), *Shield of Faith* (`+2..+5` `deflection` AC), *Sanctuary* (`Will save` required to attack target), *Protection from Evil/Chaos/Good/Law* (`+2` `deflection` AC and `+2` `resistance` save conditional on `sourceTagsAny: ['alignment:evil']`, blocks mental control and summoned natural attacks), *Entangle* (40-ft radius difficult terrain + `Entangled` condition), *Faerie Fire* (negates concealment/blur/invisibility), *Shillelagh*, *Produce Flame*, *Cure Light Wounds* / *Inflict Light Wounds* (`1d8 + min(5, CL)`).
- [x] **2nd–3rd Level Spells (`spells/<id>.json`)**:
  - **Offense & Rays**: *Scorching Ray* ($1\text{ to }3$ `4d6` fire ranged touch rays at CL $3, 7, 11$), *Melf's Acid Arrow* (`2d4` acid per round for $1 + \lfloor\text{CL}/3\rfloor$ rounds, no SR), *Shatter*, *Sound Burst* (`1d8` sonic + `Fort save` stun), *Spiritual Weapon* (force weapon attacking at `BAB + WIS mod`), *Fireball* (`min(10, CL)d6` 20-ft spread), *Lightning Bolt* (`min(10, CL)d6` 120-ft line), *Searing Light* (`5d8` vs. general, `10d6` vs. `type:undead`, `10d8` vs. light-vulnerable undead), *Vampiric Touch* (`min(10, floor(CL/2))d6` melee touch damage granted as temporary HP).
  - **Control, Zones & Debuffs (`PRIM-4.2`)**: *Web* (20-ft spread field: `Ref save` or grappled/entangled, flammable), *Glitterdust* (10-ft spread: `Will save` or `Blinded`, outlines invisible creatures for `-40` Hide), *Darkness* / *Daylight* (20-ft illumination shift field), *Silence* (20-ft mobile/stationary emanation suppressing `verbal_casting` and `descriptor:sonic` damage), *Consecrate* / *Desecrate* (20-ft Undead turning/stat modifier zone), *Invisibility Purge* (5 ft/CL mobile aura stripping invisibility), *Hold Person* (`Will negates` paralysis with each-round retry), *Blindness/Deafness* (`Fort negates`), *Ghoul Touch*, *Slow* (`Will negates`: staggered to single standard/move action, `-1` atk/AC/Ref, half speed), *Stinking Cloud* (20-ft cloud: `Fort save` or `Nauseated`), *Sleet Storm*.
  - **Buffs & Utility (`effectBundle` with `sourcePath: "spell:<id>/..."`)**: *Bull's Strength*, *Cat's Grace*, *Bear's Endurance*, *Fox's Cunning*, *Owl's Wisdom*, *Eagle's Splendor* (`+4` `enhancement` to ability in DAG Stage 2), *Barkskin* (`+2..+5` `enhancement` to `natural_armor` in DAG Stage 3), *Mirror Image* (`1d4 + floor(CL/3)` figment decoys), *Blur* (`20%` concealment), *Displacement* (`50%` concealment), *Blink*, *Invisibility*, *See Invisibility*, *Resist Energy* (`10/20/30` energy resistance at CL $1, 7, 11$), *Protection from Energy* (absorbs `12 × CL` max 120 energy damage), *Haste* (1 extra full-attack strike, `+1` untyped atk, `+1` `dodge` AC/Ref, `+30 ft` `enhancement` speed), *Fly* (`60 ft` good flight), *Keen Edge*, *Greater Magic Weapon* (`+1..+5` weapon enhancement), *Magic Vestment* (`+1..+5` `enhancement` to `worn_armor_bonus` / `worn_shield_bonus` in DAG Stage 3), *Prayer* (`+1` `luck` to allies, `-1` to foes), *Dispel Magic* (`PRIM-4.3` stripping spell effects via `revokeModifiersByPathPrefix`), *Remove Curse*, *Remove Disease*, *Remove Blindness/Deafness*, *Cure Moderate/Serious Wounds*, *Battletide*.

## 🟢 Milestone 117: Mid- & High-Level Spells (4th–9th Level Arcane & Divine) (`public/data/rulesets/dnd35e/spells/<id>.json`) (Complete)

Complete the high-level SRD spell progression (Levels 4–9) across modular `public/data/rulesets/dnd35e/spells/<id>.json` files for advanced dungeon levels, boss encounters, and high-ECL play.

- [x] **4th–6th Level Spells (`spells/<id>.json`)**:
  - **4th Level**: *Dimension Door* (instant tactical teleport, ends actor's turn), *Stoneskin* (`DR 10/adamantine` absorbing up to `10 × CL` max 150 damage), *Greater Invisibility* (does not break on attack), *Evard's Black Tentacles* (20-ft grapple field: `CL + 4 + 4` grapple bonus dealing `1d6+4` bludgeoning/round), *Solid Fog* (20-ft fog reducing speed to 5 ft and `-2` melee atk/dmg, no save), *Ice Storm* (`3d6` bludgeoning + `2d6` cold in 20-ft cylinder, no save), *Wall of Fire* / *Wall of Ice* (linear/ring barrier fields), *Phantasmal Killer* (`Will disbelief` then `Fort partial 3d6` or instant death, `descriptors: ['mind_affecting', 'fear', 'death']`), *Fear* (30-ft cone `Panicked` or `Shaken`), *Enervation* (`1d4` negative levels ranged touch via `applyNegativeLevelsToActor`, no save), *Divine Power* (BAB becomes equal to Character Level, `+6` `enhancement` `STR`, `+1` temp HP/CL), *Freedom of Movement* (automatic success on grapple/escape artist, immune to paralysis/solid fog/web/slow), *Death Ward* (immunity to `descriptor:death` spells, energy drain, and negative energy), *Restoration* (cures ability drain and negative levels), *Flame Strike* (10-ft cylinder `min(15, CL)d6`: half fire, half divine power), *Cure Critical Wounds*, *Neutralize Poison*.
  - **5th Level**: *Cone of Cold* (60-ft cone `min(15, CL)d6` cold), *Cloudkill* (20-ft mobile poison gas killing $\le 3$ HD, `Fort` save vs. death for 4–6 HD, `1d4 CON` damage/round for 6+ HD), *Hold Monster*, *Feeblemind* (`INT` and `CHA` drop to 1, `-4` save for arcane casters), *Baleful Polymorph* (`PRIM-2.3`), *Telekinesis* (`Concentration` or instantaneous combat maneuver / violent thrust), *Wall of Force* (immutable invisible barrier blocking LoE), *Wall of Stone*, *Righteous Might* (Stage 1 `'size'` `+1` step, `+4` `size` `STR`, `+2` `size` `CON`, `+2` `enhancement` to `natural_armor`, `DR 3/5/9 evil` or `good`), *Slay Living* (melee touch `Fort DC` or die, `3d6 + CL` on save, `descriptors: ['death']`), *Spell Resistance* (`SR = 12 + CL`), *True Seeing* (120 ft sees through darkness, invisibility, blur, displacement, illusions, and polymorph), *Breath of Life* / *Raise Dead*.
  - **6th Level**: *Disintegrate* (`2 × CL d6` max `40d6` ranged touch ray, `Fort partial 5d6`), *Chain Lightning* (`min(20, CL)d6` primary + half to `CL` secondary targets), *Flesh to Stone* / *Stone to Flesh*, *Antimagic Field* (10-ft mobile emanation suppressing all `magical`, `spell`, `sp`, and `su` effects), *Globe of Invulnerability* (suppresses 0th–4th level spells in 10-ft emanation), *Greater Dispel Magic* (`PRIM-4.3` up to `+20` CL check), *Heal* (restores `10 × CL` max 150 HP and cures blinded, confused, dazed, dazzled, deafened, diseased, exhausted, fatigued, feebleminded, insanity, nauseated, poisoned, sickened, stunned, and ability damage) / *Harm*, *Blade Barrier* (`min(15, CL)d6` force wall), *Heroes' Feast*.
- [x] **7th–9th Level Apex Spells & Summoning Chains (`spells/<id>.json`)**:
  - **Summoning Progression**: *Summon Monster I–IX* and *Summon Nature's Ally I–IX* (1-round casting time, spawning celestial/fiendish/elemental/animal allies synthesized from unified `races/<id>.json` + `templates/<id>.json` for `1 round/CL` with *Augment Summoning* `+4` enhancement `STR`/`CON` support).
  - **7th–9th Level**: *Finger of Death* (`Fort partial 3d6 + CL` or die), *Delayed Blast Fireball* (`min(20, CL)d6`), *Prismatic Spray* (7-color random ray table), *Power Word Blind / Stun / Kill* (HP-threshold no-save compulsion: $\le 100$ / $\le 150$ / $\le 200$ HP), *Forcecage*, *Spell Turning* (`1d4 + 6` spell levels reflected), *Holy Word / Blasphemy / Dictum / Word of Chaos* (CL-differential `deafened` / `blinded` / `paralyzed` / `killed` + extraplanar banishment), *Fire Storm*, *Regenerate*, *Horrid Wilting* (`min(20, CL)d6` desiccation, `d8` vs. water/plant), *Polar Ray* (`min(25, CL)d6` cold ray), *Mind Blank* (total immunity to `descriptor:mind_affecting` and `school:divination`), *Iron Body* (`DR 15/adamantine`, `+6` enhancement `STR`, `-6` penalty `DEX`, poison/crit immunity), *Shapechange* (`PRIM-2.3` free-action form shifting across `races/<id>.json`), *Meteor Swarm* (4 × `2d6` bludgeoning ranged touch + `6d6` fire 40-ft spreads), *Energy Drain* (`2d4` negative levels), *Wail of the Banshee* (`Fort` save or die in 40-ft spread), *Implosion*, *Mass Heal*, *Miracle* / *Wish*, and *Time Stop* (`1d4 + 1` rounds of apparent time to buff/reposition/summon).

---

# 🚀 Phase 26: D&D 3.5e Tactical HUD, Character Sheet, Spellbook UI, Active Combat/Skill Loops & Showcase Campaign Polish _(Branch: `DND35` -> Merge to `master`)_

**Goal:** Surface every D&D 3.5e system and content pillar through tactile dark-fantasy CRPG UI panels (Doctrine & Maneuver Bar, 6-Tab Character Sheet with DAG Provenance Tooltips, Vancian Spellbook & Domain Preparation, Active Class Feature & Skill Action Bar, Interactive Level-Up Trigger) wired directly into `dnd35eRulesetContract` and the main game loop, and upgrade `dnd35e-crypt` (*The Sunless Reliquary*) into a deep showcase adventure before merging `DND35` into `master`.

## 🟢 Milestone 118: D&D 3.5e Character Sheet, Visual Anatomical Paper Doll, Tactical Doctrine & Maneuver Bar, Vancian Spellbook, In-Game UI Overhaul & Resizable Layout Panels (Complete)

Build and polish the ruleset-specific UI views (`src/rendering/ui/dnd35e_sheet.ui.ts`, `dnd35e_spellbook.ui.ts`, `dnd35e_doctrine_bar.ui.ts`, `equipment.ui.ts`), Console UI Slot & Modal Host API (`src/rendering/ui/cartridge_ui_registry.ts`, `src/rendering/ui/dnd35e_ui_adapter.ts`), and core layout splitters (`src/styles/layout.css`, `src/rendering/ui/resizable_panels.ui.ts`), wiring all D&D 3.5e combat maneuvers, full-attack routines, class ability activations, skill verbs, and interactive level-ups into a cohesive dark-fantasy CRPG interface.

- [x] **Console UI Slot & Modal Host API & Cartridge UI Adapter (`src/rendering/ui/cartridge_ui_registry.ts`, `src/rendering/ui/dnd35e_ui_adapter.ts`, `src/core/modal_manager.ts`)**:
  - Evict all D&D 3.5e-specific `UIMode` members (`UIMode.CharCreation`, `UIMode.LevelUp`) and direct cartridge imports from Tier 1 Console files (`game-state.types.ts`, `presenter.ts`, `session_dom.ts`, `session_controller.ts`, `input_handler.ts`, `hud_alerts.ui.ts`).
  - Provide a generic Console UI Slot & Modal Host API (`UIMode.CartridgeModal`, `activeCartridgeModalId`, `IntentType.ToggleCartridgeModal`) so any ruleset cartridge can register custom modals (`'char_creation'`, `'level_up'`, `'character_sheet'`, `'spellbook'`), command dock items, HUD alert ribbons, and side-stack HUD panels without modifying Tier 1 Console files.
- [x] **HUD Tactical Doctrine Dials, Combat Maneuvers, Active Class Abilities & Level-Up Banner (`src/rendering/ui/dnd35e_doctrine_bar.ui.ts`, `dnd35e_doctrine_actions.ts`)**:
  - Dynamically render compact HUD sliders and toggle switches from the player's active `DnD35EffectBundle` (`variable_dial`, `toggle`, `triggered`) and `TacticalDoctrineComponent` entries (*Power Attack* `0..BAB` slider, *Combat Expertise* `0..min(5, BAB)` slider, *1H / 2H / Double-Weapon Grip* toggle, *Fighting Defensively / Total Defense* toggle) so tactical stances adjust in 1 click without mid-turn modal popups.
  - Display live `5-Tier Action Budget` pips (`Standard`, `Move`, `Swift / Immediate Debt`, `AoO`) and surface a glowing HUD **`[Level Up Available!]`** alert ribbon and hotkey (`L`) opening `dnd35e_level_up.ui.ts` whenever XP crosses the next `ECL` threshold.
- [x] **Visual D&D 3.5e Anatomical Paper Doll & In-Game HUD Overhaul (`src/rendering/ui/equipment.ui.ts`, `src/rendering/ui/inventory.ui.ts`, `src/styles/modals.css`)**:
  - Replace the flat text-list equipment sidebar with a visual **Anatomical Paper Doll** layout positioning interactive slot cards (`Head`, `Eyes`, `Neck`, `Shoulders`, `Torso`, `Body/Armor`, `Waist`, `Arms/Wrists`, `Hands`, `Ring L`, `Ring R`, `Feet`, `Main Hand`, `Off Hand` + dynamic extra limb / Wild Shape melded slot states), showing equipped item icons/glyphs, 4-char slot tags, and click-to-unequip actions.
- [x] **7-Tab D&D 3.5e Character Sheet (`src/rendering/ui/dnd35e_sheet.ui.ts`, `dnd35e_sheet_overview_tab.ui.ts`, `dnd35e_sheet_skills_tab.ui.ts`, `dnd35e_sheet_feats_abilities_tab.ui.ts`)**:
  - **Overview & Combat DAG Breakdown Tab**: 6 Ability Scores with effective modifiers, `Full / Touch / Flat-Footed AC` breakdown (`evaluateDnD35ActorStatDAG` active/shadowed diagnostics), `Fort / Ref / Will` save breakdowns, and Full-Attack Routine strike preview (`attackRoutine.strikes`).
  - **Classes, Racial HD & Level History Tab**: Chronological breakdown of `levelHistory` (`1..20`) and Hit Die tracks (`tracks`).
  - **Dynamic Anatomical Equipment Paper Doll Tab**: Full-size interactive paper doll shared with the Inventory modal.
  - **Skills, Feats & Special Abilities Tabs**: Full SRD skill table (`Total = Ranks + KeyMod + Synergy + Typed - ACP`) with direct `[Use]` buttons for active dungeon/combat skills (*Search*, *Open Lock*, *Disable Device*, *Intimidate*, *Diplomacy*, *Heal*), plus categorized Feats, Special Abilities & Cleric Domains, and Active Conditions.
- [x] **Class-Tabbed Vancian Spellbook, Spontaneous Casting & 8h Rest UI (`src/rendering/ui/dnd35e_spellbook.ui.ts`, `dnd35e_spellbook_actions.ts`)**:
  - Render dedicated top-level **Class Spellbook Tabs** from `dndData.spellbooksByClass` so multiclass and *Mystic Theurge* casters manage each class's spellbook/prayerbook, slot matrix, and Caster Level independently.
  - Allow Prepared Casters to assign known/prayerbook spells into daily Level 0–9 slots, unprepare open slots, and trigger an 8-hour Rest (`executeEightHourRest`) to refresh daily spell slots and heal natural HP.
- [x] **General Resizable Panels & Drag Splitters (`src/rendering/ui/resizable_panels.ui.ts`, `src/styles/layout.css`, `src/core/settings.ts`)**:
  - Add interactive drag-splitter handles between the main game panels (`#splitter-left-hud`, `#splitter-right-hud`) with clamped viewport bounds, `localStorage` persistence (`updatePanelLayout`), and automatic ROT.js canvas viewport reflow (`syncDisplayLayout`).

## 🟢 Milestone 119: _"The Sunless Reliquary"_ Full SRD Content Showcase & Campaign Editor Verification (Complete)

Upgrade `public/data/campaigns/dnd35e-crypt/` and the verification suite to exercise every Phase 21–26 primitive and content registry.

- [x] **Multi-Zone Showcase Campaign (`public/data/campaigns/dnd35e-crypt/areas.json`)**:
  - Expand *The Sunless Reliquary* into a multi-area adventure featuring the **Outfitter Sanctuary Hub**, **Goblinoid & Orcish Outer Warrens**, **The Desecrated Ossuary**, and **The Reliquary Sanctum**.
- [x] **Comprehensive Verification & `DND35 -> master` Merge Readiness (`tests/dnd35e_phase26_ui_and_showcase.test.ts`)**:
  - Added unit and headless integration tests covering the Console UI Slot & Modal Host API, D&D 3.5e UI Adapter, LIFO `CartridgeModal` stack, Level-Up alert ribbon & dock gating, Tactical Doctrine sliders/stances/grip modes feeding the 4-Stage Stat DAG, Vancian Spellbook preparation/rest loops, and *The Sunless Reliquary* showcase zones.
  - Verified 100% green execution across `./verify.sh` (TypeScript strict check, Prettier, ESLint, dependency-cruiser DAG, Knip dead-code check, `bun test` across 157 test suites, Vite production build, and `run-validator.ts` across all 4 campaigns, 788 ruleset files, and 394 SSOT source files).


