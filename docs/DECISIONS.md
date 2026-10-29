# Decision Log — Roguelike Project

This document records architectural decisions whose rationale is **non-obvious or counter-intuitive** — things a developer might get wrong without the explanation. Routine design rationale is documented inline in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

### Event Routing Buckets

- **Decision**: Rather than global event listeners or `O(N)` queries every frame, we use cached inverted indexes (buckets) stored on related components (e.g., `QuestLogComponent.activeTriggers`).
- **Rationale**: Turns `O(Quests × Objectives)` operations into `O(1)` lookups during high-frequency combat events, isolating cost to the moment a quest is granted or completed.

### Global Overrides vs O(N) Iteration

- **Decision**: For state alterations affecting an entire collection identically (e.g., revealing the full map, global buffs), we add a boolean flag to the parent object (e.g., `GameMap.isFullyExplored`) rather than iterating and mutating every child.
- **Rationale**: Rebuilding large immutable arrays (4,000+ tiles) is cheap but causes massive memory allocation spikes triggering GC pauses. Global flags avoid allocation entirely and scale to massive maps.

### Limbo Packaging for Hierarchical Data

- **Decision**: When moving an entity off-map (to `persistentEntities` / Limbo), we use a recursive `moveToLimbo` utility instead of just moving the parent actor.
- **Rationale**: ECS strictly enforces flat data structures; an actor's `InventoryComponent` stores foreign keys (`EntityId`s) rather than nested item objects. If we moved the actor to Limbo but left the item entities in the active state, those items would be garbage collected when the area resets, creating orphaned keys and crashing the game when the actor returns. Recursive packaging forces the engine to respect logical ownership despite the flat ECS architecture.

### Player Knowledge vs Physical Properties (ECS Domain Modeling)

- **Decision**: Player memory (e.g., whether an item type is "Identified") is stored as a global set on `GameState`, not as an `identified: boolean` on individual `ItemComponent` instances.
- **Rationale**: An ECS component should represent a localized physical property. Using a "Scroll of Identify" with instance flags would require mutating every item across all active and inactive areas — an `O(N)` operation breaking inactive floor encapsulation. A global set enables instant `O(1)` checks without entity mutation.

### Data-Driven Polymorphism over Routing Logic

- **Decision**: Avoid centralized routing logic (massive `switch`/`if-else` trees) that determines behavior by type. Instead, encode meta-properties directly into data shapes (e.g., `isImmediate: true` on an Intent interface).
- **Rationale**: Respects the Open-Closed Principle — new data types can be added without modifying core engine loops.

### Token Pools over O(N) Verification (The "Bag" Pattern)

- **Decision**: When enforcing global limits (e.g., "max 1 Unique Boss", "only 3 Elite Guards per level"), initialize a stateful pool of tokens representing allowed spawns. Spawning pops a token from the pool.
- **Rationale**: Pre-structuring data avoids expensive runtime loops. If a token isn't in the bag, it physically cannot be drawn — providing 100% reliable limit enforcement. Handles both Uniques (N=1) and Extinction mechanics (N=50) with identical logic.

### Encounter Director Reachability & Pathing Overheads

- **Decision**: During procedural generation, the Encounter Director skips `ROT.Path.AStar` verification for randomly placed entities blocking paths.
- **Rationale**: Running AStar on every candidate spawn creates immense computational overhead and latency spikes during area transitions. We rely on statistical improbability of random placement creating perfect soft-locks. Will revisit if this becomes a persistent gameplay issue.

### Campaign Editor Modularity via Reactive State

- **Decision**: The Campaign Editor UI (`src/rendering/editor_ui.ts`) was split into domain-specific view controllers (`editor_sidebar`, `editor_toolbar`, `editor_workspace`), all coordinated by a reactive, UI-only singleton `editorState`.
- **Rationale**: Passing `GameState` down through deeply nested UI components while tracking transient UI state (like active tabs or sidebar width) created massive prop-drilling and circular dependencies. A reactive singleton handles the UI state cleanly while allowing independent view modules to subscribe and re-render without complex messaging.

---

### V2 Engine Decoupling: Message Queues, Pure Dumb Canvas Renderer & Reference Project Takeaways

- **Decision**: Decouple simulation ticks from presentation frames and persistence using explicit message/event queues (`InputCommandQueue` and `PresentationEventQueue`), extract a pure `ViewportSnapshot` projector so `src/rendering/renderer.ts` becomes a zero-ECS "Pure Dumb Canvas Renderer" with dirty-cell diffing, debounce `localStorage` persistence out of `updateState()`, and sequence structural refactoring (Phase 10: M69–M71) before V2 Engine decoupling (Phase 11: M72–M76).
- **Rationale (Root Bottleneck Analysis)**:
  - Auditing `scheduler.ts`, `game-loop.ts`, and `renderer.ts` revealed that acting and rendering were synchronously coupled on every individual actor sub-step: inside `scheduler.ts`'s `while` loop, every NPC turn called `updateState()`, which immediately executed `saveGame()` (`JSON.stringify` + synchronous `localStorage.setItem`), `render()` (full `display.clear()` + per-tile ECS queries and string allocations), and all 17 DOM UI panels. With 50 NPCs acting in one turn or RTwP frame, the engine performed 50–100 full Canvas redraws, DOM rebuilds, and JSON serializations inside a single 16.6ms browser frame.
  - Jumping straight to a full-engine Web Worker before decoupling the tick/render loop or extracting a `ViewportSnapshot` would break the 17 DOM UI panels in `src/rendering/ui/` and `input_handler.ts` (which synchronously query `GameState`) and crash on `window.localStorage` calls inside `game-loop.ts`.
- **Lessons & Architecture Takeaways from Evaluated Reference Projects**:
  1. **[slashman/jsrl](https://github.com/slashman/jsrl) (Santiago Zapata's TypeScript Roguelike Starter)**:
     - *What We Learned*: Demonstrates clean **Display Adapter Decoupling**—the simulation/turn loop knows nothing about `unicodetiles.js` or `PixiJS`; it projects a flat viewport state to a minimal display driver.
     - *How We Apply It*: We split `src/rendering/viewport_snapshot.ts` (`buildViewportSnapshot(state): ViewportSnapshot`) from `src/rendering/renderer.ts`. `renderer.ts` imports zero ECS or `GameState` types and only draws incoming `ViewportSnapshot` frames using dirty-cell diffing instead of `display.clear()`.
  2. **[FlameNeon/pixi.js](https://github.com/FlameNeon/pixi.js/) (PixiJS WebGL 2D Batch Renderer)**:
     - *What We Learned*: Packs thousands of sprite quads from a texture atlas into GPU vertex buffers for 1–2 draw call rendering. However, for an 80×45 grid (3,600 cells), Canvas2D (`ROT.Display`) takes < 1ms when drawn once per `requestAnimationFrame` with dirty-cell tracking.
     - *How We Apply It*: By making `renderer.ts` consume a pure `ViewportSnapshot`, we eliminate the 50× per-frame redraw bottleneck immediately while guaranteeing that a WebGL2/PixiJS batch backend can be swapped in later for zoomed-out 250×150+ mega-views without touching simulation code.
  3. **[ajschlosser/Tile](https://github.com/ajschlosser/Tile) (OOP HTML5 Canvas Tile Engine)**:
     - *What We Learned*: Represents each tile as a stateful JS object instance with attached methods (`obj.x()`, `actions: ['move']`) evaluated during the render/game loop.
     - *How We Apply It*: Treated as an explicit **anti-pattern** for large worlds—per-tile object instances and method closures create severe GC pressure and violate ECS data purity. We preserve flat typed/struct arrays (`state.map.tiles` and integer coordinate indexing `y * width + x`) everywhere.
  4. ***Caves of Qud* & *Dwarf Fortress* Living-World Scaling**:
     - *What We Learned*: Large living worlds scale along two axes: (a) **60Hz Presentation Decoupling** (simulation mutates state and queues events; rendering runs at most once per `requestAnimationFrame`), and (b) **Tiered World Simulation** (full tile-level FOV/A*/ECS runs only in the active zone, while frozen zones use deterministic delta catch-up on wake and global schemes/factions/rumors tick on a coarse macro-clock).
     - *How We Apply It*: Combine a 4ms frame-budgeted cooperative scheduler (`scheduler.ts`), stage-sliced `function*` procedural generation with `ROT.RNG.getState()` guards across yields, tiered simulation cadences, and optional Worker offload over the clean `ViewportSnapshot` / message-queue seam.
