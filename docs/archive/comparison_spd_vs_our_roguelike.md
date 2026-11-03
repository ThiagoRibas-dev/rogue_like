# Architectural Comparison: Shattered Pixel Dungeon vs. Our Engine

Based on the analysis of Shattered Pixel Dungeon (SPD) and our `ARCHITECTURE.md` and `MILESTONES.md`, here is a deep-dive comparison of how the two engines approach traditional roguelike problems at an implementation level.

## 1. Core Architectural Paradigm

| Feature | Shattered Pixel Dungeon | Our Rogue-like |
| :--- | :--- | :--- |
| **Paradigm** | Rich Object-Oriented Programming (OOP) | Entity-Component-System (ECS-lite) |
| **Entity Representation** | Java class instances (e.g., `Mob`, `Item`, `Blob`) | Numeric IDs (`EntityId`) |
| **Logic Location** | Encapsulated in methods (`item.doPickUp()`) | Extracted to pure Systems (`damage.system.ts`) |
| **State Storage** | Object properties scattered across memory | Centralized, immutable `GameState` dictionary |

**Algorithmic Impact:**
In SPD, if a monster attacks, it invokes `target.damage()`. The logic for how damage is processed is hardcoded into the class hierarchy. 
In our engine, an attack simply appends a `DamageComponent` to the target entity. A totally decoupled `damage.system.ts` sweeps through the ECS, applying the math, checking resistances (via `getEffectiveStats()`), and eventually attaching a `DeathComponent` if HP reaches zero. This allows us to cleanly introduce AoE fields or damage-over-time (DoTs) without refactoring the base `Mob` class.

## 2. The Game Loop & Scheduling

| Feature | Shattered Pixel Dungeon | Our Rogue-like |
| :--- | :--- | :--- |
| **Threading** | Multithreaded (UI Thread + Actor Thread) | Single-threaded Event Loop |
| **Scheduler** | Custom priority queue based on `time` | `ROT.Scheduler.Speed` |
| **Input Blocking** | Actor thread `wait()`s on UI thread / animations | `engine.lock()` awaits command queue |
| **Execution Mode** | Strictly Turn-Based | Dual Mode (Turn-Based or Real-Time with Pause) |

**Algorithmic Impact:**
SPD's engine is tightly temporally coupled. The Actor Thread literally sleeps (via Java's `wait()`) while the UI thread plays a sprite animation, ensuring visuals sync with logic. 
Our engine uses an **Intent → Action → Event** pipeline. Player input (or AI) pushes an `ApplyIntent` into a queue. When the scheduler ticks an entity, it pops the queue. Because our engine never blocks on rendering, it trivially supports **Real-Time with Pause (RTwP)** (Milestone 12) by simply advancing the scheduler based on delta-time instead of waiting for discrete keypresses.

## 3. Interaction Mechanics & TDTTOE

NetHack and SPD achieve their "The DevTeam Thinks Of Everything" (TDTTOE) depth through highly specific edge-case code. We achieve it through combinatorics.

| Feature | Shattered Pixel Dungeon | Our Rogue-like |
| :--- | :--- | :--- |
| **Interactions** | Bespoke methods (`shatter()` creates a `Fire` blob) | Unified `ApplyIntent` + `verb` pipeline |
| **Synergies** | Hand-authored `if/else` checks | Tag-based `ReactionSystem` |
| **Narrative/Events** | Hardcoded checks in subclasses | Unified `TriggerSystem` (Event → Condition → Consequence) |

**Algorithmic Impact:**
If you throw a Potion of Liquid Flame in SPD, the `PotionOfLiquidFlame.shatter()` method explicitly contains the logic to spawn a `Fire` blob class.
In our engine (Milestone 29 & 30), throwing *any* item emits an `ApplyIntent` with the verb `throw`. The `reaction.system.ts` checks our data-driven `reactions.json`. It matches the source (`liquid_flame` tag) and the target (`grass` tag), and automatically evaluates the defined consequence (spawning a `field` of type `fire`). This means designers can add hundreds of interactions (like dipping arrows in poison) purely via JSON without writing a single line of TypeScript.

## 4. World State & Spatial Representation

| Feature | Shattered Pixel Dungeon | Our Rogue-like |
| :--- | :--- | :--- |
| **Grid Storage** | Flat 1D Array (`int[] map`) | Flat 1D Array (`Tile[]`) with `TILE_REGISTRY` |
| **Entity Lookup** | Iterate over `Actor` lists matching `pos` | O(1) `spatialIndex` Dictionary |
| **FOV Algorithm** | Custom recursive shadowcasting / raycasting | `ROT.FOV.PreciseShadowcasting` |
| **State Persistence** | Custom recursive `Bundle` mapping | Trivial `JSON.stringify` of `GameState` |

**Algorithmic Impact:**
Both games wisely use a flat 1D array (`y * width + x`) for the map to maximize cache locality and performance. 
However, for rendering and collisions, SPD iterates over its active character list to find who is at a given cell. We use a dedicated `spatialIndex` (Milestone 27) that maps coordinates directly to `EntityId`s. This guarantees O(1) lookups, allowing our renderer to only iterate over the camera's visible viewport bounds rather than the entire entity list, making our engine infinitely scalable regardless of how many entities are on the map.

## 5. Visuals & Rendering

| Feature | Shattered Pixel Dungeon | Our Rogue-like |
| :--- | :--- | :--- |
| **Graphics** | 2D Pixel Art Sprites | ASCII Characters with Colors (ROT.js) |
| **Renderer Engine** | OpenGL / LibGDX (via custom Noosa wrapper) | HTML5 Canvas (`ROT.Display`) + DOM Overlays |
| **UI Structure** | Scene-Graph (`Gizmo` -> `Visual` -> `Image`) | Modern HTML/CSS Overlays (3-column layout) |
| **Animation/Movement** | Smooth tweening; logic waits for animations | Instant discrete snaps (with CSS 3D tilt effects) |

**Algorithmic Impact:**
Shattered Pixel Dungeon is fully sprite-based and runs on an OpenGL pipeline. When an entity moves, it interpolates smoothly from cell A to cell B. Because of the temporal coupling, the Actor thread actually pauses game logic until this visual tween completes.
Our engine is a pure **ASCII roguelike** at its core, relying on `ROT.Display` to draw colored characters on a strict grid. Movement is instant and discrete. However, we modernize the presentation by rendering the HUD, inventory, and menus natively with HTML/CSS. This allows us to use modern CSS features—like 3D Canvas tilting and programmatic aspect-ratio scaling—providing a premium 2.5D aesthetic without the overhead of a full 3D or sprite engine.

## 6. Extensibility & Modding

**Shattered Pixel Dungeon** is a monolithic application. Adding a new monster requires writing a Java class extending `Mob`, adding a Sprite class, and recompiling the application.
**Our Engine** is completely Data-Driven (Milestone 11 & Phase 4). Because of the ECS, the engine only cares about component shapes. A new monster, quest, dialogue tree, or elemental reaction is authored entirely in Zod-validated JSON files. We even ship a native web-based Campaign Editor (Milestone 21) that uses JSON Patch deltas to allow live playtesting without recompilation.
