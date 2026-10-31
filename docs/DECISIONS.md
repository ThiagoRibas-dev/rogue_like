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

---

### Milestone 73: Pure Dumb Canvas Renderer, ViewportSnapshot & Dirty-Cell Invariants

- **Decision: Pure Dumb Canvas Renderer (`src/rendering/renderer.ts`) and Snapshot Projector (`src/rendering/viewport_snapshot.ts`)**:
  - Completely decoupled the ROT.js canvas renderer from ECS entities and `GameState`.
  - `src/rendering/renderer.ts` now imports **zero** simulation or ECS types (`ecs.ts`, `components.types.ts`, `game-state.types.ts`). It accepts only `(display: ROT.Display, snapshot: ViewportSnapshot, prevSnapshot?: ViewportSnapshot)`.
  - All projection logic (reading spatial indexes, resolving z-indices, entity stacking, camera clamping, FOV cache lookups, inspect formatting, and visual effects coordinates) is isolated in `buildViewportSnapshot(state, viewportW, viewportH): ViewportSnapshot`.
- **Decision: Cell-Level Dirty Diffing over Full-Frame Clears**:
  - Instead of executing `display.clear()` and re-drawing every cell (up to 2,500+ cells) on every map-dirty frame, `render()` performs a flat 1D diff (`cellEquals(snapshot.cells[i], prevSnapshot.cells[i])`) and draws only changed cells via `drawCell()`.
  - **Ghosting Prevention & ROT.js Backend Invariant**: Verified in `rot-js` display backend (`Rect` and `Tile`) that `draw(data, clearBefore)` executes with `clearBefore: true`, clearing the cell bounding box with background color or `clearRect` prior to rendering glyphs or composite sprites. Differential dirty-cell updates therefore do not accumulate visual artifacts or ghosting.
  - Full redraw sweeps via `invalidateViewportSnapshot()` are explicitly triggered only upon area transitions, campaign switches, and zoom level changes.
- **Decision: View Layer Decomposition (<250 LOC rule)**:
  - Decomposed DOM manipulation out of `renderer.ts`:
    - `src/rendering/ui/inspect_view.ui.ts`: Manages `#inspect-tooltip`, `#inspect-panel`, and `#inspect-content` DOM elements.
    - `src/rendering/ui/vfx_overlay.ui.ts`: Manages `#effects-overlay` floating combat text and `#fog-overlay` 2D canvas.
  - `src/rendering/presenter.ts` coordinates dispatching the computed `ViewportSnapshot` to `render()`, `renderInspectView()`, and `renderVFXAndFogOverlay()`.

---

### Milestone 74: Cooperative Frame-Budgeted Scheduler, Tiered Simulation & Worker Offload

- **Decision: Cooperative Frame-Budgeted Turn Loop (`FRAME_BUDGET_MS = 4`) & Bounded RTwP Drain**:
  - Slices `runTurnBasedLoop()` execution when elapsed execution exceeds 4ms (`FRAME_BUDGET_MS`), scheduling resumption via `setTimeout(..., 0)` while holding `isTurnProcessing = true` and `engine.lock()`.
  - *Rationale*: During turn storms (50+ active entities acting, chained triggers, or complex AI pathfinding), a synchronous turn loop monopolizes the JavaScript thread for 50–100ms, causing noticeable UI stutter and dropped input events. Yielding at 4ms leaves 12ms of the 16.6ms frame budget for browser rendering, styles, and garbage collection, preserving responsive 60Hz presentation.
  - Holding `isTurnProcessing = true` prevents re-entrant turn scheduling or race conditions in the input queue during intermediate asynchronous yields.
  - For RTwP mode, clamped accumulated time (`MAX_ACCUMULATED_RTWP_TIME = 1000ms`) and capped iterations (`MAX_RTWP_DRAIN_ITERATIONS = 10`) prevent the "spiral of death" where lag induces more catch-up steps, creating an unrecoverable browser freeze.

- **Decision: Tiered Simulation Cadence (Micro / Local Narrative / Macro)**:
  - Decoupled world simulation systems into three tiers (`src/core/simulation_cadence.ts`):
    - **Tier 1 (Micro)**: Runs every turn for immediate combat, FOV, movement, and reactions in the active area.
    - **Tier 2 (Local Narrative)**: Runs every 10 turns (`LOCAL_NARRATIVE_TICK_INTERVAL`) for NPC dialogue delays, rumor decay, and thought bubble updates.
    - **Tier 3 (Macro)**: Runs on coarse intervals for rivalries (25 turns), schemes (50 turns), and world events (100 turns).
  - *Rationale*: Running macro social simulations and deep rumor propagation on every sub-turn actor step was an unnecessary `O(N)` cost. Coarse ticking reduces idle turn calculation overhead by >80% with zero perceptible change in gameplay responsiveness.

- **Decision: Area Wake Delta Catch-Up vs Continuous Off-Screen Ticking**:
  - Stored `lastVisitedTurn` on `AreaData`. When re-entering a dormant area, `deltaTurns = Math.max(0, currentTurn - lastVisitedTurn)` is computed.
  - *Rationale*: Simulating unvisited or dormant areas turn-by-turn requires loading their ECS graphs and running pathfinding and FOV for hundreds of off-screen entities. Instead, dormant areas sleep in cold storage. Upon waking, timers (like respawn thresholds) and entity states are advanced by `deltaTurns` in a single constant-time step.

- **Decision: PRNG Determinism Isolation Across Generator Yields**:
  - In async generator pipelines (`generator_async.ts`), the procedural generation yields `GenerationProgress` payloads between major stages (`resolvePalette`, `carveBaseGeometry`, `carveRoomsAndPortals`, `applyBiomesAndCull`, `computeHotPathDijkstra`).
  - *Rationale*: To allow the UI to paint loading bars between generation stages without compromising seed reproducibility, `ROT.RNG.getState()` is captured before each `yield` and restored with `ROT.RNG.setState()` upon resumption. This prevents asynchronous browser events (such as UI clicks or event timers) from polluting or advancing the global PRNG state. Yielding inside synchronous ROT.js digger/cellular callbacks is strictly forbidden to preserve library internal state integrity.

- **Decision: Pure Serializable Web Worker DTO Boundary with Fallback**:
  - Offloaded long-running workloads (narrative fuzzing in `fuzzer.worker.ts` and area generation in `map.worker.ts`) to dedicated Web Workers via `src/worker/worker_bridge.ts`.
  - *Rationale*: Web Workers operate in an isolated thread with no DOM or shared memory. All request/response contracts (`src/types/worker.types.ts`) are pure serializable JSON DTOs (e.g., converting `Set` collections in `DirectorContext` into plain arrays). If `Worker` is unavailable or throws during initialization, `worker_bridge.ts` transparently falls back to main-thread async generators, guaranteeing compatibility across all test environments and browser sandboxes.

### Milestone 75: RTwP Auto-Pause, Modal Stack, Verb Illumination & Filter Chips

- **Transient modal stack over persisted nesting.** Modal LIFO state and the auto-pause sighting set live in module memory, never in `GameState`. Persisting them would force a `SerializedGameState` change and save migration for state that is meaningless across sessions; `uiMode` already round-trips and is normalized on load, so the stack is rebuilt (cleared) rather than restored.
- **`detrimental` as a schema flag, not a damage heuristic.** Detrimentality cannot be inferred from `perTurnDamage`: `weakness` (attack penalty), `stun` (skipped turns), and `confusion` (randomized movement) are all hostile and deal no damage. An explicit `z.boolean().default(false)` on `StatusEffectDefinitionSchema` is data-driven per Rule 12, is backward compatible for existing JSON, and surfaces an editor checkbox automatically because `zod_form_renderer.ts` unwraps `ZodDefault`.
- **`EntitySpotted` emitted from `core`, not `systems`.** The only place FOV is refreshed is `updateExploredTiles()` in `src/systems/map.system.ts`, but the systems layer must stay event-free and the dedupe set cannot live in `GameState` under the transient policy. `map.system.ts` therefore exposes the pure query `getVisibleHostileEntityIds()`, and `src/core/auto_pause_signals.ts` owns event construction plus the transient sighting set.
- **FOV refresh moved ahead of the event drain.** `applyIntentWithCost()` now calls `updateExploredTiles()` before draining `state.events`. Previously the update happened in `processTurn()` *after* the drain, which would have surfaced `EntitySpotted` a turn late and polluted the next tick's ledger. The other three call sites (area transition, new game, sandbox) stay put because they run outside the turn event lifecycle.
- **Pause baseline instead of a recomputed pause flag.** The previous toggle intents derived `paused` as `nextUiMode !== UIMode.Game`, which force-resumed a manually paused RTwP game whenever a modal closed. Capturing the pause state at the moment the outermost modal opens fixes that class of bug and makes nesting coherent.
- **Verb illumination lists all verbs.** The menu already received only *valid* verbs, so highlighting "valid" would have been a no-op. Listing every verb with applicable ones illuminated is the only formulation that removes trial-and-error, and it keeps keyboard selection aligned by numbering only the illuminated entries.

### Milestone 76: Campaign Creator & Developer Tooling UX

- **Global reverse-reference indexer over area-only panel.** References between templates, dialogues, items, and areas form a unified campaign graph. Confining "Where Used" queries to a third pane in `area_editor.ts` would isolate item and dialogue authors from reverse lookup. Creating `src/editor/reference_index.ts` as a shared inverted index cached via `WeakMap<CampaignData, ReferenceIndex>` provides instant O(1) usage lookups across all tabs while respecting Golden Rule 5 ("Never Duplicate Reference-Resolution Logic").
- **Persistent collapsible validation dock over hover popup.** Replacing the hover popup in `editor_toolbar.ts` with a bottom dock (`src/rendering/ui/validation_panel.ui.ts`) solves the fundamental UX issue where moving the mouse into the popup closes it. A persistent dock allows developers to view errors while editing inputs, eliminates legacy `innerHTML` usage per Golden Rule 7, and enables single-click jump-to-error navigation.
- **Read-time validator path normalization over validator rewrites.** Sub-validators historically emit paths in three conflicting notations (slash-leading, dotted, and bracketed array index), while form engines expect slash-leading paths. Normalizing paths at ingestion via `src/editor/validation_path.ts` (`toFormPath`) immediately fixes the silent inline-error rendering bug in `zod_form_renderer.ts` without breaking existing validator unit tests.
- **Module-level expanded paths set for accordion persistence.** Because form changes re-render the workspace by replacing container children, storing accordion open/close state directly on native DOM `<details>` elements causes annoying snap-backs on every keystroke. Storing open states in an in-memory `Set<string>` keyed by form `basePath` preserves user UI state across re-renders and allows programmatic ancestor expansion during jump-to-error navigation.
- **Static-map-only contextual tile spawning with walkability verification.** "Playtest from Here" right-click spawning is strictly scoped to static map canvases where coordinates map to fixed tile layouts. Spawning verifies `walkable` status from tile definitions to prevent trapping the player inside geometry. The spawn coordinates and area ID pass via `sessionStorage['editor_playtest_spawn']` to `startNewGame()` without polluting persistent save files.
- **Strict touch scope for DOM security cleanup (Golden Rule 7).** Only components created or modified in Milestone 76 (the new validation dock, accordion headers, where-used drawer, and tile context menu) are converted to strict `document.createElement` / `textContent` patterns. Untouched legacy area canvas controls remain intact to minimize regression blast radius in accordance with Golden Rule 13.

### Milestone 77: Tactical Floating HUD, Canvas Telemetry & RimWorld/DF/Ultima UX Overhaul

- **Zero-Vertical-Obstruction Full-Viewport Canvas with Side Stacks.** Replaced top and bottom full-width bars with a `100vw × 100vh` map stage and two pointer-transparent side columns (`#hud-left-stack`, `#hud-right-stack`) whose child `.hud-card` elements capture pointer events and fold individually or globally via `[Tab]`. This maximizes vertical map visibility while keeping tactical telemetry and commands immediately accessible.
- **Pure Tactical DTO Projection (`tactical_snapshot.ts`) & `#effects-overlay` Mounting.** To preserve `renderer.ts` as a pure dumb renderer with zero ECS imports (Milestone 73) and preserve `tests/canvas_mount.test.ts` (which asserts `#game-canvas-wrapper`'s direct `<canvas>` children in `mountDisplayWithFogOverlay`), all unit health ratios, faction attitudes (`getFactionRelation`), status pips, torchlight FOV center, and Bresenham path previews are projected into `ViewportSnapshot.tactical` by `src/rendering/tactical_snapshot.ts` and drawn onto `<canvas id="tactical-overlay">` inside `#effects-overlay` by `src/rendering/ui/tactical_overlay.ui.ts`.
- **Transient Pointer Hover & Context Menu Anchor (`src/core/hover_state.ts`).** Mouse hover coordinates `(x, y)` and right-click screen anchors `(clientX, clientY)` live in a dedicated transient view-state module outside `GameState`, marking `PresentationDomain.Map` and `PresentationDomain.HUD` dirty only when the hovered tile coordinate changes. This prevents mouse movement from triggering save serialization or polluting deterministic replays.
- **Runtime 2D Pixel-Art Sprite Synthesis (`src/rendering/procedural_sprites.ts`).** Added `renderMode: 'auto' | 'sprites' | 'ascii'` to `VisualFeedbackSettings`. Keeping default `'auto'` preserves native sprite sheets on `default` and ASCII mode on `megacampaign`/`shroudgarde`, while `buildProceduralSpriteAtlas()` synthesizes deterministic 32×32 pixel-art tiles and entity silhouettes in memory when the user toggles 2D Tiles mode on an ASCII campaign.

