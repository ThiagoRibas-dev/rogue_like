# Project Milestones: Rogue-like Template

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

## 🟡 Milestone 2: Map Generation & Vision
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

## ⚪ Milestone 12: RTwP (Real-Time with Pause) Engine Toggle
Re-use the pure systems architecture to support an optional real-time mode alongside the existing turn-based mode.
- [x] **Phase 1: Architectural Foundation**: Refactor Intent results to explicitly return `{ state, success }` to eliminate 0-energy inference, and decouple hardcoded terrain/trigger logic (doors, traps) into data-driven definitions.
- [ ] Implement a **real-time game loop** using `requestAnimationFrame` that continuously advances entity turns based on elapsed time and speed.
- [ ] Add a **Pause state** that freezes the real-time loop while allowing UI interaction (inventory, menus).
- [ ] Implement **Command Queuing** so the player can issue orders while paused, which execute when unpaused.
- [ ] Add an **Engine Mode Toggle** (turn-based vs. RTwP) accessible from settings or the Main Menu.
- [ ] Add **UI controls** for RTwP: pause/unpause button, speed controls (1x, 2x, 4x), and visual indicators of the current mode.

## ⚪ Milestone 13: UI Polish & Isometric View
Overhaul the user interface to support more complex panels and a dynamic isometric perspective.
- [ ] Create a **3-column layout** instead of 2 to support more UI panels.
- [ ] Implement a **tabbed interface** to swap between elements that don't need to be seen concurrently.
- [ ] Expand the game to use the **browser's full viewport** instead of a constrained subset.
- [ ] Add a dedicated **Equipment panel** separate from the inventory.
- [ ] Implement an **Isometric View** toggle that rotates the canvas 45 degrees (potentially with a 3D-like perspective effect).
