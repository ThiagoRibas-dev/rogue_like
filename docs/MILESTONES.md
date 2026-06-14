# Project Milestones: Rogue-like

This document outlines the high-level roadmap for the project, organizing our progression from a basic moving character to a fully modular, extensible roguelike with a robust engine.

## 🟢 Milestone 1: The Foundation (Currently Active)
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

### 🟢 Milestone 5: Items & Inventory (Complete)
- [x] Create a data-driven Item Registry (consumables, weapons, armor)
- [x] Add ItemComponent, InventoryComponent, EquipmentComponent
- [x] Add ground items and Pick Up / Drop mechanics
- [x] Add Consumable items with targeted effects (health potions, scrolls)
- [x] Implement "Bonus at Query Time" stat calculation for Equipment slots
- [x] Render inventory UI panel for interaction

### 🟢 Milestone 6: XP & Leveling (Active)
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

*(Note: Premium UI Polish is treated as a continuous concern and should be integrated into every milestone rather than being its own distinct phase.)*

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

### 🟢 Milestone 18: Component-Driven Combat Pipeline (Complete)
**Goal:** Transition combat resolution from a monolithic intent handler to a true ECS pipeline, setting the stage for AoE, DoTs, and environmental hazards.
- [x] **Damage Components:** Introduce `DamageComponent` to represent incoming damage events.
- [x] **Damage System:** Build `damage.system.ts` to process `DamageComponents`, reducing HP, applying on-hit effects, and emitting floating text.
- [x] **Death System:** Build `death.system.ts` to handle entities that reach 0 HP (XP distribution, drops, removal) independently of what killed them.
- [x] **Refactor Combat Logic:** Update `processMeleeAttackIntent` to simply calculate initial attack vs defense and attach a `DamageComponent`, delegating the rest to the pipeline.

### 🟢 Milestone 19: The Social Layer (Complete)
**Goal:** Introduce dialogue, quests, and rich interaction menus.
- [x] **Conversation UI**: Build an interactive, branching dialogue modal for speaking with friendly or neutral NPCs.
- [x] **Memory-Driven Dialogue**: Connect the dialogue system to the `MemoryComponent`, allowing NPCs to alter their responses based on past interactions, faction standing, or grudges.
- [x] **Declarative Quests**: Implement logic for friendly NPCs to assign missions (e.g., retrieve item, slay monster) directly to the player using JSON-defined quests.
- [x] **Quest Journal UI**: Build a dedicated interface panel for the player to track active, failed, and completed quests.
- [x] **In-Context Wiki / Encyclopedia**: Implement nested hover-to-explain tooltips for highlighted keywords (Entities, Items, Status Effects) directly within the dialogue and quest UIs.
- [x] **Procedural Quests**: Implement a dynamic quest generator that builds randomized missions at runtime from JSON templates (e.g., bounties), storing them in the GameState.

## 🟢 Milestone 20: The Adversarial Layer (Schemes & Investigation) (Complete)
Introduce systemic villains that act against the player, pairing the background simulation tightly with the investigation UI.
- [x] **Scheme & Mission Data**: Define the JSON schemas for Villain Schemes, intermediary Agreements, and Missions.
- [x] **Unique Token Pools**: Implement the "Bag/Deck" pattern to enforce global spawning limits so unique villains or key items cannot be duplicated.
- [x] **Scheme Simulator**: Build the background system that hooks directly into the `ROT.Scheduler.Speed` (decoupled from player input) to advance villain goals and dispatch missions across Areas.
- [x] **Clue Generation**: Mechanically drop physical evidence or generate witness memories whenever a mission executes (emitting structured `ClueEvents`).
- [x] **Investigation Board UI**: Build a "conspiracy board" UI engineered as a filtered view of the global *Event Ledger*, allowing the player to naturally review discovered clues and expose active schemes.

---

# 🚀 Phase 4: Campaign Creator & Modular Tooling (Refined)
Features to allow building, testing, and sharing campaigns using structured JSON data and custom map configurations.

### Milestone 21: Editor Foundation & Database Forms
**Goal:** Create the basic workspace shell, modular form templates, and simple string/number fields for JSON data editing, with direct local workspace interaction.
- [x] **Developer Workspace Toggle & Routing**
  - Add a "Dev Tools" action button on the Main Menu screen.
  - Setup screen switching between the main game state and the editor workspace state in [src/main.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/main.ts) and [src/core/game-loop.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/game-loop.ts).
  - Ensure entering the editor halts active schedulers, hides the main game canvas, and opens the editor layout.
- [x] **Top-Level Editor Workspace & Dependency Graph Guard**
  - Create a dedicated [src/editor/](file:///d:/Projects/Game%20Dev/rogue-like/src/editor/) directory at the top of the dependency graph (peer to `main.ts`).
  - Implement the controller logic in [src/editor/campaign_editor.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/editor/campaign_editor.ts) and loading service in [src/editor/workspace_file_service.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/editor/workspace_file_service.ts) using the browser's `showDirectoryPicker()` API.
  - Keep [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts) as a pure rendering/view module that only imports downward (from `types`, `constants`, `utils`) and communicates with the editor controller via upward event/command dispatching.
- [x] **Dual Import/Export Fallback**
  - Integrate a fallback drag-and-drop `.zip` reader/writer in [src/editor/workspace_file_service.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/editor/workspace_file_service.ts) for browsers that do not support directory pickers.
  - Allow compiling all edited registries into a single ZIP archive for distribution.
- [x] **⭐ Undo/Redo + Change History (JSON Patch)**
  - Implement an editor command stack in [src/editor/campaign_editor.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/editor/campaign_editor.ts) over the in-memory campaign document using **JSON Patch (RFC 6902) deltas** rather than full-state snapshots, so history is cheap and memory-stable.
  - Bind `Ctrl+Z` / `Ctrl+Shift+Z` to undo/redo changes in forms.
  - *RNG Note:* This stack tracks editor changes only. We document that gameplay turn-rewinds require RNG checkpointing due to state-counter dependencies in [src/core/rng.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/rng.ts).
- [x] **⭐ Fast Iteration & "Round-Trip" Goal**
  - Establish a fast-path re-injection of the in-memory doc to the campaign loader [src/core/loader.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/loader.ts) to avoid full page reload on playtest.
  - Track iteration speeds in the developer toolbar.
- [x] **Scaffolding Selector (New Campaign Wizard)**
  - Create a startup editor wizard screen in [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts).
  - **Clone Template Option:** Clone the existing `default` campaign templates as a starting point.
  - **Blank Slate Option:** Initialize empty arrays and raw baseline files for an adventure built from scratch.
  - **Example Campaign:** Ship a small, annotated reference campaign to teach designers how templates connect.
- [x] **Modular DOM Database Editor Components**
  - Design a modular CSS layout in [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts): Left sidebar list and Right editing pane.
  - Build granular, reusable DOM field elements in Vanilla TS: `StringField`, `NumberField`, `ColorPickerField`, `ListField`, and `NestedRecordField`.
  - **⭐ Zod-Driven Form Generation:** Refactor the editor renderer to recursively parse Zod schema definitions (`ZodObject`, `ZodOptional`, `ZodArray`, etc.) so that all possible fields are presented to the user, even on newly created empty objects.
  - **⭐ `ReferenceField` / Autocomplete Pickers:** Fields referencing IDs (e.g. entities to factions, items to effects) render as searchable dropdowns rather than raw text to prevent link errors, reading live tables in [src/types/campaign.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/campaign.types.ts).
- [x] **Zod Schema Compiler & Link Auditor**
  - Hook Zod's `safeParse` to validate fields on input change, showing validation errors inline based on Zod types in [src/types/campaign.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/campaign.types.ts).
  - Implement a **Campaign Auditor** utility in [src/editor/campaign_editor.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/editor/campaign_editor.ts) to audit cross-registry links.
  - Display error counts in the dev toolbar; block Playtest and Export when unresolved Zod errors exist.
- [x] **Live Playtest Mode**
  - Add a "Play Test" button that serializes the campaign, injects it into memory in [src/core/loader.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/loader.ts), clears active save files in [src/core/save.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/save.ts), and runs the game.
  - **⭐ "Return to Editor" Re-entry:** Preserve the editor document state across playtest detours in [src/main.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/main.ts) so authors return to the exact object they were editing.

## 🟢 Milestone 22: The Trigger System (Events → Conditions → Consequences) ⭐ KEYSTONE
Promote scattered condition/action primitives into a single, unified, event-reactive trigger engine.
- [x] **Generalize the Event Surface**
  - Audit and expand the existing `GameEventType` enum and event ledger in [src/types/events.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/events.types.ts); ensure all state changes publish uniformly in [src/core/game-loop.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/game-loop.ts).
- [x] **Declarative Trigger Schema**
  - Define Zod `TriggerDefinition` `{ id, event, conditions[], consequences[] }` serializable to JSON in [src/types/trigger.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/trigger.types.ts).
  - **Conditions:** Composable predicates (e.g., `entityHasTag`, `factionStandingBetween`, `hasMemoryFact`).
  - **Consequences:** Extensible effect types (e.g., `modify_standing`, `complete_quest`, `spawn_entity`, `emit_clue`).
- [x] **Trigger Routing via Buckets**
  - Refactor [src/systems/trigger.system.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/systems/trigger.system.ts) to index triggers by event type (`event → triggers`) on campaign load for fast O(1) matching during game ticks, replacing old local checks.
- [x] **Authoring UI: The Trigger Card Builder**
  - Create the trigger-card composer interface in [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts) of `WHEN [event] IF [conditions...] THEN [consequences...]` using reference dropdowns.
- [x] **⭐ Power-User Scripting Hatch**
  - **Phase A:** Ship declarative core triggers first.
  - **Phase B:** Add a sandboxed `run_script` consequence in [src/systems/trigger.system.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/systems/trigger.system.ts) that evaluates event/state context as a pure function and returns new declarative consequences (maintaining determinism and serialization).
- [x] **⭐ De-risked Trigger Migration Loop**
  - **Phase 1 Clue Migration:** Port clue drops inside [src/systems/investigation.system.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/systems/investigation.system.ts) to triggers first to test the engine with low blast radius.
  - **Phase 2 Validator Helper:** Implement a basic headless state-diffing runner in `src/editor/campaign_validator.ts` early to assert the default campaign generates identical gameplay logs before and after refactoring.
  - **Phase 3 Narrative Migrations:** Port heavy NPC dialogues and quest events to triggers once diff-testing passes.

## 🟢 Milestone 23: Narrative Architect (Dialogue, Quests & Flow)
Construct narrative structures and test conditional triggers in-editor on top of the Trigger System.
- [x] **Conversation Editor (Tree-First, Scope-Protected)**
  - Build a folder-style nested branching list dialogue editor in [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts), modifying dialogue schemas in [src/types/dialogue.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/dialogue.types.ts).
- [x] **Dialogue Triggers**
  - Refactor options in [src/rendering/ui/dialogue.ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dialogue.ui.ts) to gate choices and trigger node consequences directly using the Milestone 22 condition/consequence pickers, removing legacy action structures.
- [x] **Quest Sequence Designer**
  - Drag-and-drop quest stages, configuring objective parameters and journal logs mapped to schemas in [src/types/quests.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/quests.types.ts).
- [x] **Quest-Trigger Integration**
  - Update quest state tracking in [src/systems/quest.system.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/systems/quest.system.ts) so quest stage changes publish events; triggers can easily hook into them (e.g. spawning a boss when quest stage reaches X).
- [x] **Emergent Dialogue Gating Simulator (State Injector)**
  - Integrate an editor sidebar panel in [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts) to mock player memory fact logs and standings from `MemoryComponent` in [src/types/components.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/components.types.ts), highlighting visible dialogue branches.

## 🟢 Milestone 24: World & Area Builder (Complete)
Provide visual environment design and portal networking.
- [x] **Visual Grid Painter**
  - Setup a tile painter canvas in [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts) utilizing `ROT.Display` or custom Canvas elements, painting tiles mapped to [src/types/game-state.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/game-state.types.ts) (`Tile` and `GameMap`) and properties in [src/types/campaign.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/campaign.types.ts) (`TileDefinitionSchema`).
  - Integrate undo/redo command stack patches with paint brush actions.
- [x] **Dynamic Spawner & Portal Markers**
  - Paint procedural spawner nodes and configure portal connections in [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts), mapping them to `PortalComponent` in [src/types/components.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/components.types.ts).
  - Modify [src/systems/map.system.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/systems/map.system.ts) to parse dynamic spawners on level load/wakeup.
- [x] **Area Graph Editor**
  - A link node layout of `areas.json` in [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts) showing overworld topology and transition connectivity based on `areas` structures in [src/types/campaign.types.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/types/campaign.types.ts).
- [x] **Live Generator Sandbox**
  - Real-time preview of cellular/digger parameters inside [src/rendering/editor_ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/editor_ui.ts) by invoking [src/map/generator.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/map/generator.ts) with seed rerolling and exit pathfinding reachability checks.

## 🟢 Milestone 25: Simulation Lab & Campaign Validator
Real-time simulation testing and campaign-wide sanity check validations.
- [x] **⭐ Campaign Smoke-Test / Validator**
  - Build out the final automated asynchronous checker in [src/editor/campaign_validator.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/editor/campaign_validator.ts): starting area reachability, complete path graph solvability, quest parameter sanity, and trigger loop/recursion traps. Block exports on major validation failures and show a loading state in the UI.
- [x] **Observability Overlays**
  - Connect debug logs and trigger tracer panels in [src/rendering/ui/debug.ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/debug.ui.ts) to visualize events and system state. Required to effectively debug upcoming simulations.
- [x] **Emergent AI Arena**
  - Spawn selected actor templates in a headless sandbox environment. Extract and reuse existing engine logic by stepping through [src/systems/ai.system.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/systems/ai.system.ts) and [src/systems/damage.system.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/systems/damage.system.ts) to output clean text logs for debugging AI math and behaviors without duplicating game logic.
- [x] **Scheme Acceleration Simulator**
  - Run background mastermind villain schemes in [src/systems/scheme.system.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/systems/scheme.system.ts) in a fast-forward loop, verifying clue compilation on the Investigation Board UI in [src/rendering/ui/investigation.ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/investigation.ui.ts).

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

## 🟢 Milestone 27: Campaign Packaging & Standalone Distribution
Implement packaging structure and install operations for modular campaigns.
- [ ] **Campaign Manifest & Versioning**
  - Edit metadata block (name, version, author, description, tags) and enforce strict schema versioning checks in [src/core/loader.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/loader.ts).
- [ ] **⭐ Standalone Baked Campaigns (No Load Order)**
  - Implement package cloning in [src/editor/campaign_editor.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/editor/campaign_editor.ts) to duplicate all asset dependencies directly on campaign creation, making campaigns completely self-contained.
- [ ] **One-Click Install / Import**
  - Modify the campaign select screen UI in [src/rendering/ui.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui.ts) to allow uploading ZIP campaign files, parsing and validating schemas in [src/core/loader.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/loader.ts) before importing.
  - Add "Install Campaign" drag-and-drop or file picker option to the main game menu screen.