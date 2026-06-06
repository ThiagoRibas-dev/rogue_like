# Project Milestones: Rogue-like Template

This document outlines the high-level roadmap for the project, organizing our progression from a basic moving character to a fully modular, extensible roguelike with a robust engine.

## 🟢 Milestone 1: The Foundation (Currently Active)
Establish the strict structural and architectural patterns that the rest of the game will rely on.
- [x] Initial Vite + ROT.js + TypeScript environment setup.
- [x] Basic ECS (Entity-Component-System) structure (`createEntity`, `addComponent`, queries).
- [x] Immutable GameState definition.
- [x] Data-Driven Tile Registry (decoupling rendering/logic from map arrays).
- [x] Player rendering and basic grid movement with collision against walls.
- [ ] **Implement Seeded RNG wrapper (`src/core/rng.ts`).**
- [ ] **Implement Keybinds configuration (`config/keybinds.ts`).**
- [ ] **Implement a Message Log scaffold/stub (`addMessage`).**

## 🟡 Milestone 2: Map Generation & Vision
Introduce procedural generation and line-of-sight to make the world feel like a true dungeon.
- [ ] Integrate `ROT.Map.Digger` for procedural dungeon generation.
- [ ] Implement Map wrappers to handle rooms and corridors.
- [ ] Implement `ROT.FOV.PreciseShadowcasting` for Field of View.
- [ ] Update Renderer to only draw explored/visible tiles.
- [ ] Implement a **static centered** Camera/Viewport system.
- [ ] Implement Stairs and multiple dungeon levels (Up, Down, Ground Floor).

## 🟡 Milestone 3: The Engine, Scheduling, & Extensible Actions
Transition from simple input-driven updates to a robust turn queue with a generalized, pluggable action system.
- [ ] Implement `ROT.Scheduler.Speed` and the formal Game Loop.
- [ ] **Formalize the Command (intent) -> Action (validation) -> Event (result) distinction.**
- [ ] Design an Extensible Action System (actions are classes/functions that return intents).
- [ ] Support Contextual 'Interact' Actions and Aimed/AoE actions.
- [ ] **Implement an Entity Spatial Index (fast "what is at X,Y?" lookups).**
- [ ] **Implement Debug/Cheat tools (reveal map, god mode, spawn entity).**

## 🟡 Milestone 4: Entities & Combat (MVP Baseline)
Bring the dungeon to life with interactive actors and the core combat loop.
- [ ] Implement the Entity Registry (Data-driven spawning).
- [ ] **Define basic Entity Stat schema (HP, attack, defense).**
- [ ] **Implement Bump-to-Attack collision resolution.**
- [ ] Implement the Combat System (Baseline Health only for MVP, attack stats, melee damage).
- [ ] Implement a basic AI System (Wandering, Hunting).
- [ ] Connect combat events to the Message Log UI.
- [ ] Implement Monster Death.
- [ ] **Implement Player Death state flag (halt game processing).**

## 🟡 Milestone 5: Items & Inventory
Add tactical depth through loot.
- [ ] **Implement the Data-driven Item Registry.**
- [ ] Spawning items on the map.
- [ ] Inventory System (Pick up, Drop actions).
- [ ] Usable items (Consumables).
- [ ] Equipment slots (Weapons, Armor).

## 🟡 Milestone 6: Progression & Polish
Transform the mechanical systems into a cohesive game experience.
- [ ] XP and Leveling System for the Player.
- [ ] Fully wire the HTML HUD (Health bars, XP bars, stats) to the GameState.

## 🟡 Milestone 7: Persistence & Game Flow
Implement the full lifecycle of a play session.
- [ ] Implement the Initial Page (Main Menu).
- [ ] Implement starting a New Game / full Game Over screens.
- [ ] Implement Saving/Loading (serializing the immutable `GameState` to `localStorage`).

---

# 🚀 Phase 2: Post-MVP Expansion
Features to be added once the core MVP loop is playable and balanced.

## ⚪ Milestone 8: Advanced Mechanics & Systems
- **Premium UI Polish:** CSS animations, transitions, and enhanced visual feedback.
- **Identification System:** Unidentified items that require experimentation or scrolls to reveal.
- **Composable AI Packages:** Modular AI behaviors (hostile, ranged, spells-first) that can be mixed and matched.
- **Deep Resource Management:** Hunger, stamina, or ammo systems.
- **Interactive Terrain:** Expanding the base 'Interact' action with complex terrain types.

## ⚪ Milestone 9: Modding & Extensibility (Data-Driven Goal)
- Extract all Tile, Entity, and Item definitions into raw `.json` or `.yaml` files.
- Write loaders to fetch and parse these files on game start, allowing end-users to add content without touching TypeScript.

## ⚪ Milestone 10: RTwP (Real-Time with Pause) Engine Toggle
- Implement the real-time continuous loop utilizing `requestAnimationFrame` on top of our pure systems.
- Add pause state, command queuing, and UI controls.
