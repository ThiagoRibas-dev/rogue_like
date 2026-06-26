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

## 🟢 Milestone 27: Engine Data Structures & Render Optimizations
Transition the ECS internal data structures from arrays to constant-time dictionaries and optimize the per-frame render loop.
- [x] **O(1) Component Access:** Refactor `GameState.components` from `ReadonlyArray<Component>` to an `O(1)` dictionary `Readonly<Record<string, Component>>` keyed by `ComponentType`.
- [x] **Array Loop Elimination:** Remove expensive `.filter` and `.find` operations across the codebase by adopting the new `getComponent`, `addComponent`, and `removeComponent` architecture.
- [x] **FOV Caching:** Decouple FOV `PreciseShadowcasting` math from the active render loop. Recompute FOV only when a new `fovNeedsUpdate` flag is tripped by a system (like moving or opening a door).
- [x] **O(1) Spatial Rendering:** Eliminate the global `queryEntities` rendering loop. Instead, iterate exactly over the camera viewport bounds, retrieving standing entities via `state.spatialIndex` to ensure the render layer scales perfectly regardless of the total number of entities in the dungeon.

## 🟢 Milestone 28: Campaign Packaging & Standalone Distribution
Implement packaging structure and install operations for modular campaigns.
- [x] **Campaign Manifest & Versioning**
  - Edit metadata block (name, version, author, description, tags) and enforce strict schema versioning checks in [src/core/loader.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/loader.ts).
- [x] **IndexedDB Workspace Storage**
  - Migrate the Campaign Editor's active workspaces to use IndexedDB, entirely replacing the experimental File System Access API (`showDirectoryPicker`). This ensures the editor works seamlessly on all modern browsers. Maintain "Export/Import ZIP" for sharing campaigns.
- [x] **⭐ Standalone Baked Campaigns (No Load Order)**
  - Implement package cloning in [src/editor/campaign_editor.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/editor/campaign_editor.ts) to duplicate all asset dependencies directly on campaign creation, making campaigns completely self-contained.
- [x] **One-Click Install / Import**
  - Add an "Install Campaign" (.zip) drag-and-drop or file picker to the main menu.
  - Use `JSZip` to extract the uploaded JSON files in-memory, validate them against our Zod schemas, and persist the extracted campaign object directly into a new IndexedDB `installed_campaigns` store.
- [x] **The Hybrid Campaign Loader**
  - Refactor `loadCampaignRegistry()` in [src/core/loader.ts](file:///d:/Projects/Game%20Dev/rogue-like/src/core/loader.ts) to query both the hardcoded `public/` directory AND the IndexedDB `installed_campaigns` store, merging them into a single list for the Campaign Select UI.
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

## 🟢 Milestone 32: Containers, Locks & Forceful Access Problems (Active)
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

## 🟡 Milestone 57: Event Ledger 2.0 & Player Interest Scoring ⭐ KEYSTONE
Turn the event ledger into a durable, queryable narrative substrate without storing infinite noise.
- [ ] Add event importance tiers and long-lived compact summaries for narratively meaningful events.
- [ ] Implement Player Interaction Score for entities, factions, areas, artifacts, and possibly dungeons.
- [ ] Add deterministic decay/boost rules so recent and repeated interactions matter more.
- [ ] Store references from chronicle entries to ledger summaries rather than duplicating full event payloads.
- [ ] Add query helpers for “most interesting enemy,” “recently harmed faction,” “area with escalating danger,” etc.
- [ ] **Unified Knowledge Migration:** Refactor the Investigation Board UI to read dynamically from the player's `MemoryComponent.knowledge` (filtered by tags) instead of storing a parallel array of string `discoveredClues`, fully unifying the game's knowledge architecture.
- [ ] Add debug timeline visualization and exportable simulation logs.

## 🟡 Milestone 58: Drama Trigger Composer — Runtime Trigger Generation
Generate specific narrative triggers from reusable primitives instead of hand-authoring every permutation.
- [ ] Define composer primitives: condition snippets, consequence snippets, dialogue/bark snippets, spawn/location constraints, and cooldown rules.
- [ ] Implement deterministic binding variables such as `$NEMESIS_ID`, `$ALLY_ID`, `$AREA_ID`, `$FACTION_ID`, and `$ARTIFACT_ID`.
- [ ] Compose full `TriggerDefinition` objects at runtime and inject them into active campaign data.
- [ ] Rebuild trigger buckets safely after dynamic trigger injection/removal.
- [ ] Validate generated triggers using the same Zod and Campaign Validator paths as authored triggers.
- [ ] Add editor UI for previewing generated triggers and optionally baking them into static campaign data.

## 🟡 Milestone 59: Pacing Governor & Surprise Budget
Prevent emergent drama from becoming spammy, unfair, or tonally incoherent.
- [ ] Add a global and per-domain drama budget that limits extreme events such as ambushes, betrayals, returns from death, and rescues.
- [ ] Add safe-context checks: no unfair ambushes during onboarding, unavoidable death spirals, critical UI states, or just after another major event.
- [ ] Add cooldowns per character, faction, area, and event type.
- [ ] Support foreshadowing requirements for high-impact events: rumor, clue, omen, visible preparation, or investigation board entry.
- [ ] Add fallback events for invalidated setups, such as participant death or inaccessible area.
- [ ] Surface Drama Director decisions in debug receipts.

## 🟡 Milestone 60: Scheme Compiler & Contextual Investigation
Move from fully hand-authored schemes to dynamically assembled conspiracies driven by world events.
- [ ] **Phase Blocks & Recipes:** Split monolithic `SchemeTemplate`s into reusable `PhaseBlock`s (ingredients) and `SchemeRecipe`s (constraints).
- [ ] **Scheme Compiler:** Build a pure function that assembles a runtime `SchemeComponent` from a recipe + world state, ensuring identical execution to hand-authored schemes.
- [ ] **History-Derived Triggers:** Use `ChronicleComponent` events (e.g., exile, territory loss, humiliation) to trigger the Scheme Compiler, generating schemes out of emergent gameplay.
- [ ] **Contextual Clues:** Add `narrativeVerb` and `evidenceTags` to Phase Blocks, allowing the Investigation system to generate context-aware clues (e.g., "alchemical residue" for disruption phases).

## 🟡 Milestone 61: Narrative Simulation Lab & Fuzzer
Stress-test emergent narrative systems across many seeds before they reach players.
- [ ] Extend the Simulation Lab to run hundreds of deterministic narrative simulations headlessly.
- [ ] Output timelines of promotions, betrayals, area mutations, clue discovery, quest failures, and major drama events.
- [ ] Detect softlocks, unobservable scheme progress, orphaned triggers, impossible participants, runaway event loops, and save-size explosions.
- [ ] Add deterministic replay support for a failing simulation seed and input/event sequence.
- [ ] Add aggregate metrics: average drama events per hour, repeated event frequency, clue-to-event ratio, and unresolved scheme count.
- [ ] Block export on fatal narrative simulation failures when campaigns opt into advanced systems.

## 🟡 Milestone 62: Generalized Chronicles for Regions, Dungeons & Artifacts
Apply the Nemesis pattern beyond NPCs wherever identity/memory/growth/autonomy/surfacing makes sense.
- [ ] Add chronicle support for regions/areas: stability, corruption, prosperity, scars, faction control, and remembered player actions.
- [ ] Add chronicle support for artifacts: owner genealogy, kills, curses/blessings, grudges, awakened traits, and inscriptions.
- [ ] Add chronicle support for factions: internal schisms, vendettas, debts, leadership changes, and goals.
- [ ] Let the Encounter Director and Scheme Simulator read chronicle state when generating future content.
- [ ] Surface region/artifact/faction history in map UI, item inspect, investigation board, and dialogue.
- [ ] Keep all chronicle data compact and serializable.

## 🟡 Milestone 63: Authoring Continuum Tools — Static, Blueprint, Dynamic
Make the three authoring levels explicit in the Campaign Editor.
- [ ] Label editor objects as Static, Parameterized Blueprint, or Dynamic Primitive where appropriate.
- [ ] Provide “generated object inspectors” showing the exact JSON produced by Encounter Director or Drama Composer algorithms.
- [ ] Allow designers to bake a generated result into static data for hand-polishing.
- [ ] Add primitive libraries for encounters, reactions, personality memories, drama triggers, and scheme consequences.
- [ ] Teach validators to evaluate both authored source data and representative generated outputs.
- [ ] Update campaign export so all dynamic rules and primitives remain self-contained and installable.

---

# 🚀 Phase 9: Default Campaign Vertical Slice, Balance & Release Hardening
**Goal:** Convert the systemic engine into a coherent playable campaign and robust creator platform. This phase is less about new architecture and more about proving the full stack through content, balance, polish, and documentation.

## 🟡 Milestone 64: Default Campaign Vertical Slice
Ship a compact campaign that exercises every major system in a coherent arc.
- [ ] Build a 60–90 minute default campaign with a starting hub, multiple directed biomes, at least one scheme, and at least one nemesis-capable faction.
- [ ] Include interaction tutorials for throwing, locks, fields, dip/zap, altars/fountains, investigation, and nemesis surfacing.
- [ ] Add a clear campaign objective and finale that can be won, failed, or transformed by systemic outcomes.
- [ ] Ensure all mainline quests have fail-graceful states if NPCs die, areas mutate, or key items are lost.
- [ ] Add content-review passes for message tone, tooltip clarity, encounter readability, and UI pacing.

## 🟡 Milestone 65: Balance, Telemetry & Deterministic Replay QA
Create repeatable ways to tune and debug the game as a game, not just an engine.
- [ ] Add automated balance simulations for combat, hunger, loot economy, encounter budgets, and scheme pressure.
- [ ] Add seed-based replay capture for bug reports and deterministic regression tests.
- [ ] Track difficulty metrics: player deaths, damage taken, resources consumed, flee frequency, average encounter duration, and quest completion rate.
- [ ] Use AI Arena and Encounter Director simulations to tune CR costs and dynamic templates.
- [ ] Add performance benchmarks for large maps, many entities, many fields, and many triggers.
- [ ] Establish target performance budgets for browser play and editor simulations.

## 🟡 Milestone 66: Modding Documentation, Examples & Creator Onboarding
Make the system understandable to campaign authors.
- [ ] Write schema reference docs for entities, items, reactions, fields, encounters, personalities, triggers, schemes, and chronicles.
- [ ] Ship small annotated example campaigns: combat basics, interaction lab, encounter director lab, narrative trigger lab, and nemesis lab.
- [ ] Add in-editor help text, warning explanations, and “fix-it” suggestions for common validation errors.
- [ ] Provide a creator checklist for packaging, installing, validating, and playtesting campaigns.
- [ ] Add a designer-facing glossary for engine concepts: tags vs traits, intents vs events, reactions vs triggers, static vs dynamic data.

## 🟡 Milestone 67: Release Robustness & Distribution Polish
Prepare for public builds and long-term iteration.
- [ ] Harden IndexedDB import/export/uninstall flows, including orphaned saves and version mismatch UX.
- [ ] Audit accessibility: keyboard-only play, scaling, contrast, animation reduction, tooltip readability, and modal focus trapping.
- [ ] Test browser compatibility across Chromium, Firefox, Safari, and mobile/tablet where feasible.
- [ ] Add graceful error boundaries for campaign loading, runtime simulation errors, editor validation crashes, and corrupt saves.
- [ ] Optimize production bundle size and loading time.
- [ ] Prepare deployment packaging for itch.io/GitHub Pages and update README screenshots/instructions.

---

# 🚀 Phase 10: Multi-Threading & Asynchronous Architecture
**Goal:** Guarantee butter-smooth framerates during Real-Time with Pause (RTwP) mode and complex background simulations by removing heavy computations from the main browser thread. This acts as a "V2 Engine" optimization pass following the Phase 9 vertical slice.

## 🟡 Milestone 68: Asynchronous Cooperative Scheduler (Time-Slicing)
Prevent browser lock-ups during computationally expensive operations.
- [ ] **Generator Refactoring**: Convert heavy procedural operations (like `ROT.Map` generation, Encounter Director spawning, and AI Arena telemetry) into generator functions (`function*`).
- [ ] **Budgeted Execution**: Implement an asynchronous scheduler wrapper that monitors execution time (`performance.now()`) and `yield`s control back to the event loop if a task exceeds a frame budget (e.g., 4ms).
- [ ] **Background Simulation Fluidity**: Update `scheme.system.ts` to utilize time-slicing, allowing the mastermind villain schemes to simulate in the background without dropping frames in the active game.
- [ ] **Smooth UI Loading**: Implement continuous UI loading animations during level transitions, as the main thread will no longer be frozen by procedural generation.

## 🟡 Milestone 69: Absolute Presentational Decoupling (Web Worker)
Enforce a strict model-view separation by moving the core engine off the main thread entirely.
- [ ] **Worker Scaffold**: Create a dedicated Web Worker script to host the `GameState`, `ROT.Engine`, and all `src/systems/`.
- [ ] **Input Message Passing**: Refactor `src/core/input_handler.ts` on the main thread to capture keystrokes and DOM events, serializing and transmitting them as raw messages to the Web Worker.
- [ ] **Presentational Snapshots**: Build a serializer in the Web Worker that, at the end of a tick/frame, packages a minimal renderable snapshot (e.g., a flat array of `{char, fg, bg, x, y}` for the current viewport and active HUD state) and `postMessage`s it to the main thread.
- [ ] **Dumb Renderer Upgrade**: Refactor `src/rendering/renderer.ts` and the DOM controllers to purely consume these incoming snapshots, stripping them of any remaining direct `GameState` inspection logic.
- [ ] **Serialization Audit**: Ensure all UI cross-thread communication strictly adheres to cloneable data payloads to avoid Structured Clone Algorithm errors.