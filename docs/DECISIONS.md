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
     - _What We Learned_: Demonstrates clean **Display Adapter Decoupling**—the simulation/turn loop knows nothing about `unicodetiles.js` or `PixiJS`; it projects a flat viewport state to a minimal display driver.
     - _How We Apply It_: We split `src/rendering/viewport_snapshot.ts` (`buildViewportSnapshot(state): ViewportSnapshot`) from `src/rendering/renderer.ts`. `renderer.ts` imports zero ECS or `GameState` types and only draws incoming `ViewportSnapshot` frames using dirty-cell diffing instead of `display.clear()`.
  2. **[FlameNeon/pixi.js](https://github.com/FlameNeon/pixi.js/) (PixiJS WebGL 2D Batch Renderer)**:
     - _What We Learned_: Packs thousands of sprite quads from a texture atlas into GPU vertex buffers for 1–2 draw call rendering. However, for an 80×45 grid (3,600 cells), Canvas2D (`ROT.Display`) takes < 1ms when drawn once per `requestAnimationFrame` with dirty-cell tracking.
     - _How We Apply It_: By making `renderer.ts` consume a pure `ViewportSnapshot`, we eliminate the 50× per-frame redraw bottleneck immediately while guaranteeing that a WebGL2/PixiJS batch backend can be swapped in later for zoomed-out 250×150+ mega-views without touching simulation code.
  3. **[ajschlosser/Tile](https://github.com/ajschlosser/Tile) (OOP HTML5 Canvas Tile Engine)**:
     - _What We Learned_: Represents each tile as a stateful JS object instance with attached methods (`obj.x()`, `actions: ['move']`) evaluated during the render/game loop.
     - _How We Apply It_: Treated as an explicit **anti-pattern** for large worlds—per-tile object instances and method closures create severe GC pressure and violate ECS data purity. We preserve flat typed/struct arrays (`state.map.tiles` and integer coordinate indexing `y * width + x`) everywhere.
  4. **_Caves of Qud_ & _Dwarf Fortress_ Living-World Scaling**:
     - _What We Learned_: Large living worlds scale along two axes: (a) **60Hz Presentation Decoupling** (simulation mutates state and queues events; rendering runs at most once per `requestAnimationFrame`), and (b) **Tiered World Simulation** (full tile-level FOV/A*/ECS runs only in the active zone, while frozen zones use deterministic delta catch-up on wake and global schemes/factions/rumors tick on a coarse macro-clock).
     - _How We Apply It_: Combine a 4ms frame-budgeted cooperative scheduler (`scheduler.ts`), stage-sliced `function*` procedural generation with `ROT.RNG.getState()` guards across yields, tiered simulation cadences, and optional Worker offload over the clean `ViewportSnapshot` / message-queue seam.

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
  - _Rationale_: During turn storms (50+ active entities acting, chained triggers, or complex AI pathfinding), a synchronous turn loop monopolizes the JavaScript thread for 50–100ms, causing noticeable UI stutter and dropped input events. Yielding at 4ms leaves 12ms of the 16.6ms frame budget for browser rendering, styles, and garbage collection, preserving responsive 60Hz presentation.
  - Holding `isTurnProcessing = true` prevents re-entrant turn scheduling or race conditions in the input queue during intermediate asynchronous yields.
  - For RTwP mode, clamped accumulated time (`MAX_ACCUMULATED_RTWP_TIME = 1000ms`) and capped iterations (`MAX_RTWP_DRAIN_ITERATIONS = 10`) prevent the "spiral of death" where lag induces more catch-up steps, creating an unrecoverable browser freeze.

- **Decision: Tiered Simulation Cadence (Micro / Local Narrative / Macro)**:
  - Decoupled world simulation systems into three tiers (`src/core/simulation_cadence.ts`):
    - **Tier 1 (Micro)**: Runs every turn for immediate combat, FOV, movement, and reactions in the active area.
    - **Tier 2 (Local Narrative)**: Runs every 10 turns (`LOCAL_NARRATIVE_TICK_INTERVAL`) for NPC dialogue delays, rumor decay, and thought bubble updates.
    - **Tier 3 (Macro)**: Runs on coarse intervals for rivalries (25 turns), schemes (50 turns), and world events (100 turns).
  - _Rationale_: Running macro social simulations and deep rumor propagation on every sub-turn actor step was an unnecessary `O(N)` cost. Coarse ticking reduces idle turn calculation overhead by >80% with zero perceptible change in gameplay responsiveness.

- **Decision: Area Wake Delta Catch-Up vs Continuous Off-Screen Ticking**:
  - Stored `lastVisitedTurn` on `AreaData`. When re-entering a dormant area, `deltaTurns = Math.max(0, currentTurn - lastVisitedTurn)` is computed.
  - _Rationale_: Simulating unvisited or dormant areas turn-by-turn requires loading their ECS graphs and running pathfinding and FOV for hundreds of off-screen entities. Instead, dormant areas sleep in cold storage. Upon waking, timers (like respawn thresholds) and entity states are advanced by `deltaTurns` in a single constant-time step.

- **Decision: PRNG Determinism Isolation Across Generator Yields**:
  - In async generator pipelines (`generator_async.ts`), the procedural generation yields `GenerationProgress` payloads between major stages (`resolvePalette`, `carveBaseGeometry`, `carveRoomsAndPortals`, `applyBiomesAndCull`, `computeHotPathDijkstra`).
  - _Rationale_: To allow the UI to paint loading bars between generation stages without compromising seed reproducibility, `ROT.RNG.getState()` is captured before each `yield` and restored with `ROT.RNG.setState()` upon resumption. This prevents asynchronous browser events (such as UI clicks or event timers) from polluting or advancing the global PRNG state. Yielding inside synchronous ROT.js digger/cellular callbacks is strictly forbidden to preserve library internal state integrity.

- **Decision: Pure Serializable Web Worker DTO Boundary with Fallback**:
  - Offloaded long-running workloads (narrative fuzzing in `fuzzer.worker.ts` and area generation in `map.worker.ts`) to dedicated Web Workers via `src/worker/worker_bridge.ts`.
  - _Rationale_: Web Workers operate in an isolated thread with no DOM or shared memory. All request/response contracts (`src/types/worker.types.ts`) are pure serializable JSON DTOs (e.g., converting `Set` collections in `DirectorContext` into plain arrays). If `Worker` is unavailable or throws during initialization, `worker_bridge.ts` transparently falls back to main-thread async generators, guaranteeing compatibility across all test environments and browser sandboxes.

### Milestone 75: RTwP Auto-Pause, Modal Stack, Verb Illumination & Filter Chips

- **Transient modal stack over persisted nesting.** Modal LIFO state and the auto-pause sighting set live in module memory, never in `GameState`. Persisting them would force a `SerializedGameState` change and save migration for state that is meaningless across sessions; `uiMode` already round-trips and is normalized on load, so the stack is rebuilt (cleared) rather than restored.
- **`detrimental` as a schema flag, not a damage heuristic.** Detrimentality cannot be inferred from `perTurnDamage`: `weakness` (attack penalty), `stun` (skipped turns), and `confusion` (randomized movement) are all hostile and deal no damage. An explicit `z.boolean().default(false)` on `StatusEffectDefinitionSchema` is data-driven per Rule 12, is backward compatible for existing JSON, and surfaces an editor checkbox automatically because `zod_form_renderer.ts` unwraps `ZodDefault`.
- **`EntitySpotted` emitted from `core`, not `systems`.** The only place FOV is refreshed is `updateExploredTiles()` in `src/systems/map.system.ts`, but the systems layer must stay event-free and the dedupe set cannot live in `GameState` under the transient policy. `map.system.ts` therefore exposes the pure query `getVisibleHostileEntityIds()`, and `src/core/auto_pause_signals.ts` owns event construction plus the transient sighting set.
- **FOV refresh moved ahead of the event drain.** `applyIntentWithCost()` now calls `updateExploredTiles()` before draining `state.events`. Previously the update happened in `processTurn()` _after_ the drain, which would have surfaced `EntitySpotted` a turn late and polluted the next tick's ledger. The other three call sites (area transition, new game, sandbox) stay put because they run outside the turn event lifecycle.
- **Pause baseline instead of a recomputed pause flag.** The previous toggle intents derived `paused` as `nextUiMode !== UIMode.Game`, which force-resumed a manually paused RTwP game whenever a modal closed. Capturing the pause state at the moment the outermost modal opens fixes that class of bug and makes nesting coherent.
- **Verb illumination lists all verbs.** The menu already received only _valid_ verbs, so highlighting "valid" would have been a no-op. Listing every verb with applicable ones illuminated is the only formulation that removes trial-and-error, and it keeps keyboard selection aligned by numbering only the illuminated entries.

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

---

### Phase 13 & Beyond: Pluggable Ruleset Cartridge Architecture (`RulesetContract`), `classic` Extraction & Branching Strategy

- **Context**: Using the tactical roguelike engine built across Milestones 1–81 as a foundation for multiple distinct tabletop RPG rulesets—starting with **D&D 3.5e (`dnd35e`)** alongside the original lightweight roguelike ruleset (**`classic`**), and eventually other systems (`PF2e`, `BRP/d100`, `GURPS`, `OSR`, etc.).
- **Rejected Approach 1 — The Monolithic "Uber-Component" Super-Game**:
  - Attempting to merge all RPG rulesets into a single shared `CombatStatsComponent` / `ActorComponent` and a universal JSON meta-language causes two fatal problems:
    1. **ECS & Schema Pollution**: Under `exactOptionalPropertyTypes: true` and strict Zod schemas, combining D&D 3.5e (`bab`, `fort/ref/will`, `spellResistance`, Vancian slots) with d100 or dice-pool systems forces dozens of optional fields onto shared components or litters every system with `if (state.ruleset === 'dnd35e')` branches.
    2. **The Inner-Platform Effect**: Trying to invent a generic JSON scripting language capable of expressing Vancian preparation, 5-tier action economies, 3-action traits, and dice-pool drain without TypeScript code results in an untyped, slow, unmaintainable meta-language inside JSON.
- **Rejected Approach 2 — Permanent Diverging Git Forks per Ruleset**:
  - Treating `master` as a one-time template and maintaining permanent diverged forks (`DND35`, `GURPS`, etc.) makes cross-porting Core Engine improvements (FOV, `SpatialIndex` multi-tile footprints, Bresenham cover raycasting, RTwP scheduler, WebGL/Canvas rendering, dialogue/schemes, Campaign Editor tooling) prohibitively expensive as `GameState` diverges in each fork.
- **Selected Architecture — Shared Console Engine + Pluggable Ruleset Cartridges (`src/rulesets/`)**:
  1. **Domain-Driven `RulesetContract` Dependency Injection**:
     - Roughly 75–80% of the codebase (`src/core/`, `src/map/`, `src/systems/` world simulation, `src/rendering/`) is ruleset-agnostic ("The Console").
     - Roughly 20–25% (character stats, dice/check resolution, action economy, combat/damage mitigation, progression, ability/spell activation, character sheet UI, and ruleset-specific Campaign Editor forms) is ruleset-bound ("The Cartridge").
     - The Core Engine interacts with the active ruleset exclusively through a runtime-injected `RulesetContract` interface (`src/rulesets/ruleset.types.ts`, `src/rulesets/registry.ts`), avoiding ruleset `switch` trees in core loops.
  2. **Per-Ruleset Schemas, Components & Namespaces (No "Inner-Platform" Tax)**:
     - Each ruleset cartridge (`src/rulesets/classic/`, `src/rulesets/dnd35e/`) owns its own internal Zod schemas, ECS component slices, combat/magic resolvers, and UI views (`CharacterSheet`, HUD gauges, Editor tabs).
     - We follow the **Rule of Three**: rather than over-engineering speculative universal abstractions up front, we extract the minimal `RulesetContract` boundary needed for `classic` and `dnd35e`, refining the contract only when concrete patterns repeat across cartridges.
  3. **Rule of thumb for `dnd35e` vs. `d20` Naming**:
     - The D&D 3.5e cartridge is explicitly namespaced as `dnd35e` (`src/rulesets/dnd35e/`) rather than `d20`, because `d20` is an umbrella family encompassing mechanically incompatible systems (D&D 3.5e, D&D 4e, D&D 5e, Pathfinder 1e/2e, Shadow of the Demon Lord).
  4. **Shared Core Spatial Upgrades vs. Cartridge Mechanics**:
     - Spatial capabilities needed by tactical rulesets—such as $N\times N$ multi-tile footprints (`Large` $2\times 2$ through `Colossal` $6\times 6$), multi-entity tile occupancy (`Tiny` and smaller), threatened reach rings, and corner-to-corner Bresenham cover raycasting—are implemented in the shared Core Engine (`src/map/`, `src/core/`) with backward-compatible defaults (`1x1` footprint for `classic`), enriching the engine for all rulesets.
  5. **End-User & Campaign Hierarchy (`New Game -> Ruleset Selection -> Campaign Selection`)**:
     - Every campaign manifest (`campaign.json`) declares a required `rulesetId` (defaulting to `"classic"` for legacy campaigns).
     - The Title Screen flow transitions from `New Game -> Campaign Selection` to **`New Game -> Ruleset Selection -> Campaign Selection`**, and the Campaign Editor scopes its entity/item/ability forms and validators to the campaign's bound `rulesetId`.
  6. **Git Branching & Merge Workflow**:
     - **Phase 13 (`Milestones 82–84`: Pluggable Ruleset Cartridge Architecture & `classic` Extraction)** is executed directly on the **`master` branch** so the cartridge contract, `src/rulesets/classic/` extraction, and `Ruleset -> Campaign` selection flow become the canonical trunk architecture with zero regressions.
     - **Individual Ruleset Cartridges (starting with Phases 14–20 / `Milestones 85–99` for `dnd35e`)** are developed on dedicated ruleset branches (e.g., `DND35`) inside their isolated cartridge namespace (`src/rulesets/dnd35e/` and `public/campaigns/dnd35e_*/`), and **merged back into `master`** once the ruleset cartridge is complete and verified.

  7. **Three-Tier Separation: Rules Engine vs. System Content (`public/data/rulesets/<rulesetId>/`) vs. Campaign Content (`public/data/campaigns/<campaignId>/`) (Milestone 100)**:
     - _Problem_: If classes, feats, skills, spells, and SRD monster statblocks are hardcoded in TypeScript inside `src/rulesets/<rulesetId>/`, they violate the Data-Driven JSON mandate (`AGENTS.md` §5); conversely, if they are only stored inside a single campaign folder (`public/data/campaigns/dnd35e-crypt/`), every new D&D 3.5e campaign would have to copy-paste the entire Player's Handbook and Monster Manual.
     - _Decision_: Split ruleset architecture into three explicit tiers:
       1. **Rules Engine (`src/rulesets/<rulesetId>/` in TypeScript)**: Pure mechanical formulas and state machines (BAB/Save curves, 18-type bonus stacking, d20 vs AC, Vancian slot rules, AoO LIFO stack) with zero hardcoded classes, monsters, feats, or items.
       2. **System Content (`public/data/rulesets/<rulesetId>/` in JSON)**: Ruleset-wide "Core Rulebooks" (`archetypes.json`, `classes.json`, `skills.json`, `feats.json`, `spells.json`, plus optional base `items.json` / `entities.json`) built declaratively from Engine building blocks.
       3. **Campaign Content (`public/data/campaigns/<campaignId>/` in JSON)**: Adventure-specific maps, spawns, loot tables, quests, factions, schemes, dialogues, and campaign-specific overrides merged on top of System Content (`{ ...systemContent, ...campaignContent }`) at load time.

  8. **Cartridge Ownership of System Content Schemas vs. Shared Campaign Schemas (Milestone 100 Refinement)**:
     - _Problem_: Placing D&D 3.5e-specific schemas (`SystemClassDefinitionSchema`, `SystemSkillDefinitionSchema`, `SystemFeatDefinitionSchema`, `SystemSpellDefinitionSchema`) in `src/types/campaign/system_content.ts` and embedding them directly into `CampaignDataSchema` leaked D&D-specific assumptions (e.g. BAB curves, save curves, spell resistance, feat trees) into the global shared campaign model. Other rulesets (like `classic`, `brp_d100`, or `gurps`) have completely different system concepts; forcing them to conform to D&D schemas or populate dummy `{}` files for feats/spells violates the cartridge abstraction boundary established in Phase 13.
     - _Decision_:
       1. Keep shared `CampaignDataSchema.systemContent` as an opaque/generic ruleset dictionary (`z.record(z.string(), z.unknown()).optional()`), exactly like `RulesetDataComponent.payload`.
       2. Move all D&D 3.5e-specific system schemas into `src/rulesets/dnd35e/types/dnd35e_system.types.ts`.
       3. Extend `RulesetContract` with `getSystemContentFiles()` and `parseSystemContent()`, enabling each cartridge to declare its own system files and validate them against its own internal schemas.
       4. Remove dummy `feats.json` and `spells.json` from `public/data/rulesets/classic/`, keeping each cartridge's system content directory faithful to what that ruleset actually defines.

  9. **Campaign Editor Ruleset Parity & Tooling Integration (Milestone 101)**:
     - _Context_: In Phase 13 & 20, the runtime game client transitioned from a flat campaign selection to a 2-tier `Ruleset -> Campaign` hierarchy (`New Game -> Ruleset Selection -> Campaign Selection`). However, the top-tier Campaign Creator (`src/editor/` and `src/rendering/editor/`) was still anchored to the original single-ruleset assumption: clicking "New" presented a binary prompt between a clone of `default` or a blank slate (both hardcoding `rulesetId: 'classic'`), the workspace welcome screen only listed local IndexedDB workspaces with no mechanism to open disk campaigns, ViewGroups were resolved against a static array ignoring ruleset-specific view tabs, and entity forms required manually typing `archetypeId` without auto-complete or validation against the ruleset's `archetypes.json`.
     - _Decision_:
       1. **Ruleset-Aware Creation Modal**: Replace the binary prompt with an interactive modal querying `getAllRulesets()`, presenting ruleset choices (`🐉 D&D 3.5e` or `⚔️ Classic`) and contextual starting templates (`Blank Slate` seeded with appropriate archetypes, or cloning bundled campaigns like `dnd35e-crypt` or `default`).
       2. **Dual-Source Splash Screen**: Upgrade the workspace empty state to display both saved browser IndexedDB workspaces and disk-bundled campaigns grouped by ruleset via `loadCampaignRegistry()`, providing 1-click loading into the editor.
       3. **Dynamic ViewGroup Resolution**: Standardize sidebar and workspace panel lookups to call `getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS)` in sync with the Activity Bar.
       4. **System Archetype Reference Resolution**: Enhance `getReferenceOptions()` in `ui_utils.ts` to inspect `doc.systemContent.archetypes`, rendering `archetypeId` as a dropdown tagged with `[ARCHETYPE]`.
       5. **Automated Tier 2 System Content Re-Hydration**: Export `loadRulesetSystemContent(rulesetId)` from `src/core/loader.ts` and invoke it automatically when creating blank campaigns, importing ZIP packages, or mutating `manifest.rulesetId` in the Manifest form, ensuring the editor's live document is always validated against its bound ruleset.

   10. **Generic Console Systems over Cartridge Silos (Console Reuse First)**:
       - _Context_: When introducing complex ruleset mechanics (e.g., conditional combat bonuses like dwarf +1 vs. orcs, +4 dodge AC vs. giants, bane weapons, favored enemies, alignment smiting, or elemental save modifiers), developers face a choice: either write siloed, D&D-specific lookup switches inside the cartridge (`src/rulesets/dnd35e/`), or generalize/leverage existing Core Engine ("Console") infrastructure.
       - _Decision_: **Always evaluate Console reuse first.** Before writing ruleset-specific pipelines:
         1. **Audit & Evolve Existing Console Utilities**: Inspect `src/systems/`, `src/types/`, and `src/core/` (e.g., `TagsComponent`, `TraitsComponent`, `EquipmentSlotInstance`, `reaction.system.ts:getEntityMatcherData`, `evaluateTargetMatcher`, spatial index raycasters, trigger-consequence buses). If a Console primitive already satisfies the requirement, reuse it as-is; if it needs enhancement (such as adding limb-group IDs or melding/suppression flags to `EquipmentSlotInstance`), evolve it at the Console level or extend it at the Cartridge level rather than treating existing Console structs as frozen or duplicating them.
         2. **Evaluate Generic Extension vs. Cartridge Silo vs. Cartridge Facade**:
            - _Console Extension (Preferred)_: Extending generic primitives (such as tag-based matching: `targetTagsAll`, `targetTagsAny`, `effectTagsAny` on modifiers, layered property overlays, or anatomical slot arrays) empowers *all* present and future rulesets (`classic`, `dnd35e`, `brp_d100`, `gurps`), eliminates redundant entity query code, and maintains data-driven moddability via tags (`AGENTS.md` §5).
            - _Cartridge Silo (Restricted)_: Confined strictly to pure mathematical rules unique to that specific tabletop ruleset (e.g., 18-type bonus stacking rules, Vancian prepared slot states, 1-2-1-2 diagonal distance).
            - _Thin Cartridge Components & Service/Repository Facades (Allowed)_: It is completely valid to define Cartridge-level domain components (e.g., `WildShapeOverlayComponent`) or stateless service/repository adapters that provide clean domain interfaces over shared Console and Cartridge functions—provided components remain plain serializable ECS data interfaces (`AGENTS.md` §4) with minimal siloed logic of their own.
         3. **Record Tradeoff Rationale**: Explicitly record why the generic, evolved, or facade path was chosen in research notes and implementation plans.

   11. **Baseline Mechanics + Declarative Overrides & Modifiers (Eliminating Feat/Ability Spaghetti)**:
       - _Context_: In complex RPGs like D&D 3.5e, hundreds of feats, class features, and monster abilities alter baseline rules (e.g., *Multiattack* reducing secondary natural weapon penalties from `-5` to `-2`, *Two-Weapon Fighting / Improved / Greater* altering off-hand penalties and attack counts, *Improved Trip* suppressing the AoO and granting a free follow-up melee attack, *Weapon Finesse* substituting DEX for STR on attack rolls). Hardcoding `hasFeat(...)` booleans into `attack_resolver.ts` or `maneuvers_conditions.ts` creates brittle code soup and violates the 3-tier boundary (`src/rulesets/` vs. `public/data/rulesets/`).
       - _Decision_:
         1. **Cartridge Implements Pure Baselines**: The Cartridge defines the baseline rule parameterized by resolved actor properties (e.g., baseline secondary natural attack penalty = `-5`; baseline manufactured + natural full-attack treats all natural weapons as secondary; baseline Trip provokes an AoO and performs an opposed check).
         2. **System Content Supplies Modifiers & Rule Overrides**: Feats, traits, and items in `public/data/rulesets/<id>/*.json` modify those baseline parameters through two composable mechanisms:
            - **Value Modifiers**: Additive/replacement modifiers targeting baseline parameters (e.g., `Multiattack` adds `+3` or overrides `secondary_natural_penalty` to `-2`; `Two-Weapon Fighting` modifies `twf_primary_penalty` and `twf_offhand_penalty`).
            - **Behavioral Rule Overrides**: Declarative flags/hooks keyed by maneuver or action ID (e.g., `maneuver:trip` override `{ provokesAoO: false, checkBonus: 4, grantFollowupMeleeOnSuccess: true }` for *Improved Trip*, or `{ statSubstitution: { attackStat: 'dex' } }` for *Weapon Finesse*).

   12. **Universal Actor Symmetry, Layered Property Overlays, Anatomical Slot Topologies & Parametric Creature Families**:
       - _Context_: D&D 3.5e is fundamentally symmetrical: there is no mechanical distinction between a "monster", an "NPC", and a "player character". Spells and maneuvers never target "monsters only"—they key off Creature Type, Size, Hit Dice, Ability Scores, Anatomy, and Attitude (which Diplomacy interacts with). Furthermore, actors can have wildly different anatomies (a humanoid with 2 arms/2 legs, a dog with 4 legs and 0 hands, a Marilith with 6 arms/hands and a serpentine tail with 0 feet), undergo non-destructive transformations (*Fiendish* template, *Zombie* acquired template, *Wild Shape*, *Polymorph*, *Enlarge Person*), and advance along structured racial/family progression tracks (the 15 SRD Creature Type Racial HD engines, Monster Size/HD advancement tables, True Dragon 12-Age-Category matrices, Elemental size ladders).
       - _Decision_:
         1. **Single Symmetrical Actor Model**: Every actor is built from the exact same ECS components and ruleset building blocks: Base Race / Racial Hit Dice (`HitDieTrack[]`), Class levels (`HitDieTrack[]`), Skills, Feats, Natural & Manufactured Weapons, `TagsComponent`, `FactionComponent`, and `AttitudeComponent`.
         2. **Console-Level Layered Property/Stat Overlays with Thin Cartridge Facades**: Transformations (*Templates*, *Polymorph / Wild Shape*, *Size shifts*, *Temporary Effects*) are modeled as an ordered stack of **Overlay Layers** evaluated at the Console/Cartridge projection boundary (`Base Chassis -> Inherited/Acquired Templates -> Form/Polymorph Overlay -> Equipment & Active Status Modifiers`). Thin domain components like `WildShapeOverlayComponent` can wrap and configure these Console and Cartridge overlay functions without mutating or destroying underlying actor state.
         3. **Evolving Anatomical Equipment Slot Topologies (`EquipmentSlotInstance[]`)**: Rather than a hardcoded struct of human body keys, `EquipmentComponent.slots` models an actor's actual anatomy as an array of slot instances (`{ id: 'arm_1'..'arm_6', slotType: 'arm', equippedItem }`), extended at the Console/Cartridge level as needed (e.g., `limbGroupId` linking a weapon hand to a limb's natural claw attack, or `suppressed`/`melded` flags during Wild Shape or two-handed occupation). Multi-limbed creatures (e.g., a 6-armed Marilith wielding 6 swords or wearing 3 pairs of bracers) and non-humanoid actors (e.g., quadrupeds with no hand slots) are represented natively by their anatomical slot array, and foreign-key traversal (`save_manager.ts`, floor transitions) simply iterates `equipment.slots.map(s => s.equippedItem)`.
         4. **Decomposing Creature Families into Parametric Progression Tracks**: Rather than authoring monolithic, copy-pasted statblocks for every age category or size variant, SRD creature families are reverse-engineered into composable progression tracks: (a) the 15 Creature Type Racial HD engines (`d4..d12`, BAB rate, good saves, skill multipliers, automatic type traits), (b) Monster Advancement by HD and Size step delta tables, and (c) parametric family matrices (True Dragon 12-Age-Category progression across 10 Chromatic/Metallic varieties, Elemental 6-tier size progressions, Golem/Outsider chassis).

   13. **Unified Effect Providers, Self-Tag Conditions & Hierarchical Provenance (`sourcePath`) (Phase 22 Refinement)**:
       - _Context_: Many tabletop mechanics depend on the intersection of an actor's own structural building blocks (e.g., Construct Bonus HP depends on both `type:construct` and `size:<category>`; Incorporeal Deflection AC depends on `subtype:incorporeal`; Dwarf heavy armor speed retention depends on `trait:unencumbered_speed`). Hardcoding `if (dndData.creatureType === 'construct')` inside `computeDnD35eEffectiveStats` scatters domain rules into the stat calculator, while spawning separate ECS entities for every size/type/trait complicates foreign-key ownership. Furthermore, because an "Effect Bundle" (such as a *Ghost* template, a *Shapechange* spell, or a magic item) can grant nested sub-bundles (such as `subtype:incorporeal` or `type:construct`), a flat `sourceId` string loses the causal chain needed when the root effect expires, is dispelled, or is inspected in the UI.
       - _Decision_:
         1. **Everything That Emits Effects Is a Declarative Effect Provider**: Every structural building block (`Size`, `CreatureType`, `Subtype`, `Race`, `Template`, `Class`, `Feat`, `Condition`, `Load/Armor`, `TacticalStance`) projects semantic self-tags (`size:large`, `type:construct`, `subtype:incorporeal`) and emits declarative `StatModifier`s conditioned on `selfTagsAll` / `selfTagsAny` / `selfTagsNone` alongside `targetTags*` and `effectTags*` in `matchesEntityTagCondition` (`src/systems/reaction.system.ts`).
         2. **Slash-Delimited Hierarchical `sourcePath`**: Every `StatModifier` carries a `sourcePath?: string` recording its full causal lineage from root to leaf (e.g., `"archetype:iron_golem/type:construct/trait:construct_bonus_hp"`, `"template:ghost/subtype:incorporeal/deflection_ac"`, `"race:dwarf/trait:dodge_vs_giants"`), constructed via `appendSourcePath(parentPath, segment)`.
         3. **Subtree Revocation & $O(1)$ Provenance Indexing**: `revokeModifiersByPathPrefix(modifiers, pathPrefix)` cleanly strips any root or intermediate provider and all of its transitive descendants in a single filter pass, while `buildEffectProvenanceIndex(modifiers)` constructs `{ byPathPrefix, byNode, byTargetStat }` maps for instant runtime queries and UI stat breakdown breadcrumbs.



    14. **4-Stage Topological Sub-Stat DAG, Orthogonal OriginLayer Classification & Winner/Shadowed Provenance Breakdown**:
        - _Context_: In complex D&D 3.5e stat resolution, certain modifiers feed into intermediate sub-stats before contributing to terminal combat numbers (e.g. Size affects AC, Attack, Grapple, Hide, and Construct Bonus HP; Ability Score buffs/damage affect HP, AC, saves, Incorporeal CHA Deflection, and damage; and compound defenses like Natural Armor or Worn Armor resolve base + form override + untyped deltas + enhancement bonuses as a single unit). Flattening everything into a single-pass `resolveTypedModifiers` call leads to compounding bugs (e.g. Padded Armor `+1` + `+2` enhancement vs *Mage Armor* `+4` computing `max(1, 4) + 2 = 6` instead of `max(1 + 2, 4) = 4`, or stripping *Mage Armor* on incorporeal touch attacks).
        - _Decision_:
          1. **4-Stage Topological Sub-Stat DAG (`evaluateDnD35ActorStatDAG`)**:
             - Single-pass $O(N)$ bucket partitioning groups `StatModifier`s by `targetStat` upfront.
             - **Stage 1 (`'size'`)**: Resolves Effective Size from base size + `form_override` (emitted by `resolveEffectiveEntityDataWithOverlays` in `wild_shape.ts`) + non-stacking `size_step` deltas (`[-4..+4]`), dynamically updates `'size:<category>'` in `stageContext.selfTags` (so downstream Construct Bonus HP and size-conditional traits react to Stage 1 size shifts), and emits Size Effect Provider `StatModifier`s with hierarchical `sourcePath`s.
             - **Stage 2 (`'str'..'cha'`)**: Evaluates typed ability modifiers per ability score, feeding `typedBonusNet` into `computeEffectiveAbilityScore` and updating `effectiveAbilities` before downstream consumption.
             - **Stage 3 (Compound Defenses)**: Evaluates `'natural_armor'`, `'worn_armor_bonus'`, and `'worn_shield_bonus'` sub-stats (`base/form_override + untyped + max(enhancement)`), propagating surviving `effectTags` into Stage 4 and refining `acResolution.byOriginLayer` across constituent Stage 3 modifiers (`refineStage4AcBreakdownOriginLayers`) so multi-layer compound defenses preserve their exact `'racial'`, `'progression'`, `'form'`, `'equipment'`, and `'temporary'` attribution.
             - **Stage 4 (Combat Stats & Target-Conditional Queries)**: Synchronizes dynamic CHA Incorporeal Deflection (`Math.max(1, chaMod)` on `subtype:incorporeal:deflection_ac`), resolves AC triplet (`fullAC`, `touchAC`, `flatFootedAC`) with `maxDexBonus` capping and single-pass breakdown deduplication, and computes attack, damage, saves, and max HP. Combat resolvers (`resolveDnD35eMeleeAttack`) evaluate both attacker and defender via `evaluateDnD35eEntityDAG` with mutual `targetTags` so target-conditional modifiers across all 4 stages resolve uniformly.
          2. **Orthogonal `OriginLayer` Classification**:
             - Classifies modifiers into `'base' | 'racial' | 'progression' | 'form' | 'equipment' | 'temporary' | 'environment'` derived from `sourcePath` root segment.
             - Does NOT alter D&D 3.5e `BonusType` stacking rules; enables bulk layer suppression (e.g., suppressing `'equipment'` when gear melds in Wild Shape) and detailed UI breakdown columns.
          3. **Diagnostic Winner, Shadowed & Suppressed Provenance Breakdown**:
             - `resolveTypedModifiersWithBreakdown` returns `{ total, activeModifiers, shadowedModifiers, suppressedModifiers, byOriginLayer }`, tracking exact loser-to-winner `shadowedBySourcePath` pairings, exclusion reasons (`'antimagic' | 'touch_attack' | 'flat_footed' | 'tag_condition' | 'origin_suppressed'`), and exempting `[Force]` armor effects against incorporeal touch attacks.

    15. **Modular Multi-File System Content Registries (`classes/`, `races/`, `spells/`, `templates/`, `archetypes/`, `feats/`)**:
        - _Context_: Complete D&D 3.5e definitions (classes with levels 1–20 progression tables, 51 bestiary archetypes, 17 races, 13 templates, 11 feats, 5 spells, and 22 domains) require thousands of lines of JSON. Storing all definitions inside single monolithic `.json` files violates `AGENTS.md` §8 (~250 lines per file), impedes git diff review, and makes modding/extending individual entries cumbersome.
        - _Decision_:
          1. **Modular Subdirectories & Per-Entry Files**: Each major system content category lives in a dedicated subdirectory under `public/data/rulesets/dnd35e/`:
             - `classes/`: 21 files (`barbarian.json` through `shadowdancer.json`)
             - `races/`: 17 files (`human.json`, `dwarf.json`, `goblin.json`, etc.)
             - `spells/`: 5 files (`magic_missile.json`, `fireball.json`, etc.)
             - `templates/`: 13 files (`celestial.json`, `lich.json`, `vampire.json`, etc.)
             - `archetypes/`: 51 files (`player.json`, `skeleton.json`, `beholder.json`, etc.)
             - `feats/`: 11 files (`power_attack.json`, `cleave.json`, etc.)
             - Accompanied by root entry-point files (`classes.json`, `races.json`, `spells.json`, `templates.json`, `archetypes.json`, `feats.json`) initialized to `{}` for backward compatibility.
          2. **Multi-Descriptor Shallow Merging in Loaders**: `DND35E_SYSTEM_CONTENT_FILES` (`src/rulesets/dnd35e/system_content_files.ts`) declares each individual file under its shared `key` (`'classes'`, `'races'`, `'spells'`, `'templates'`, `'archetypes'`, `'feats'`). At load time, `src/core/loader.ts`, `tests/helpers.ts`, and `scripts/run-validator.ts` shallow-merge all descriptors with matching keys into `rawSystemContent[desc.key]`.
          3. **Unified In-Memory Schema & Zero Cross-Ruleset Leakage**: Downstream consumers (`DnD35SystemContentSchema`, `srd_registry.ts`, Character Builder UI, Campaign Validator) continue to read unified dictionaries (`systemContent.races`, `systemContent.archetypes`, etc.), while rulesets that return `[]` from `getSystemContentFiles()` (such as `classic`) remain 100% isolated and unaffected.
          4. **Character Builder Facade via `src/rulesets/registry.ts` & Modular Step Views**: To enforce `.dependency-cruiser.cjs` (`no-direct-cartridge-imports-outside-registry`) and ESLint's 300-line file limit (`AGENTS.md` §8), the pure Character Creation & Level-Up engine (`src/rulesets/dnd35e/character_builder.ts`) is re-exported through `src/rulesets/registry.ts`, and the 7-Step Character Creation Wizard UI is decomposed into `src/rendering/ui/dnd35e_char_builder.ui.ts` (Steps 1–3 + modal shell) and `src/rendering/ui/dnd35e_char_builder_steps.ui.ts` (Steps 4–7), alongside `src/rendering/ui/dnd35e_level_up.ui.ts`.

    16. **Rulebook-Faithful Class Header + Level-by-Level Progression Table (`progression: ReadonlyArray<DnD35ClassLevelRow>`) & Chronological Actor Level Ledger (`levelHistory`)**:
        - _Context_: In tabletop D&D 3.5e, character classes and prestige classes are authored as a level-invariant **Class Header** (`hitDieSides`, `skillPointsPerLevel`, `classSkills`, `castingMode`, `castingTradition`, `proficiencies`, `featureDetails`, `acfSwaps`) followed by an explicit **Class Progression Table** (*Table: The Cleric*, *Table: The Ordained Champion*) detailing levels 1–20 (or 1–10) with exact Base Attack Bonus, Base Saving Throws, Features (*Special* column), Bonus Feats, and Spells per Day. Attempting to model classes with disparate level-keyed dictionaries (`featuresByLevel`, `spellsPerDayTable`, `spellsKnownTable`, `bonusFeatLevels`, `advancesExistingSpellcasting`) and continuous curves (`babCurve`, `fortCurve`, `refCurve`, `willCurve`) made inspecting "what does level 3 of this class look like" cumbersome, obscured Cleric domain bonus slots (`1+1`), and complicated multiclass tracking. Furthermore, characters often interleave classes across their career (`Fighter 1..4 -> Rogue 1..2 -> Fighter 5`) and may suffer Permanent Level Drain (e.g., from undead or energy drain attacks) where the most recent levels must be rolled back deterministically.
        - _Decision_:
          1. **Rulebook-Faithful Class Header + Level Table**: Every class in `public/data/rulesets/dnd35e/classes/<classId>.json` and `classes.json` defines level-invariant metadata in its header and an explicit `progression: ReadonlyArray<DnD35ClassLevelRow>` array (`level: 1..maxLevel`). Each `DnD35ClassLevelRow` is a self-contained snapshot specifying `{ level, bab, fortSave, refSave, willSave, features, bonusFeatSlot?, spellsPerDay?, domainSpellSlots?, spellsKnown?, advancesSpellcasting?, scalingValues? }`.
          2. **Dual-Chassis Aggregation (Monster Curves vs. Class Tables)**: Monster Racial Hit Dice (`creature_types.json`, `archetypes.json`) scale across arbitrary HD ranges (`1..60+`) and retain formulaic progression curves (`babCurve`, `fortCurve`, `refCurve`, `willCurve`) on `HitDieTrack`. Character class tracks, by contrast, carry `explicitBab`, `explicitFort`, `explicitRef`, and `explicitWill` populated directly from `classDef.progression[classLevel - 1]` via `buildHitDieTrackFromClass(classDef, level)`. `aggregateProgressionChassis` uses the explicit table values when present and evaluates the curve otherwise, ensuring zero divergence from printed rulebooks.
          3. **Direct Snapshot & Delta Helpers**: `getClassLevelRow(classDef, level)` provides an instant $O(1)$ query for what any class level looks like, `collectClassFeaturesUpToLevel` resolves cumulative features and ACF swaps up to that level, and `computeEffectiveClassCastingLevel` aggregates caster levels across base and prestige classes using the exact rows where `advancesSpellcasting` matches the casting tradition.
          4. **Chronological Actor Level Ledger (`levelHistory`)**: Every character creation and level-up records an entry in `DnD35EntityData.levelHistory: ReadonlyArray<DnD35CharacterLevelRecord>`, capturing `{ characterLevel, classId, classLevel, hpRolled, abilityScoreIncrease?, addedSkillRanks, selectedFeats, selectedAcfs, learnedSpells }`.
          5. **Permanent Level Drain & Negative Levels Engine**:
             - **Permanent Level Drain (`applyPermanentLevelDrainToActor(state, entityId, levelsDrained)`)**: Pops the last $N$ records from `levelHistory` in strict LIFO order and calls `rebuildActorStateFromLevelHistory` to deterministically recompute `tracks`, `maxHp` (including retroactive Constitution changes), `abilityScores`, `skillRanks`, `feats`, `selectedAcfs`, `knownSpells`, and Unified Effect Provider `statModifiers`.
             - **Temporary Negative Levels (`applyNegativeLevelsToActor(state, entityId, count)`)**: Injects Unified Effect Provider `StatModifier`s (`-1` attack, `-1` saves, `-5` HP per negative level) with `sourcePath: "condition:negative_level"`.
          6. **Permanent Architectural Standard**: This level-by-level progression table structure and chronological ledger are established as canonical standards for all class progressions in the engine and must not be reverted to curve-only class representations.

    17. **Pluggable Ruleset Cartridge Validators (`RulesetContract.validateCampaignRuleset`) & Disk Parity Enforcement**:
        - _Context_: In a multi-ruleset engine, different RPG tabletop systems require fundamentally different schemas and structural invariants (e.g. Classic has linear XP tables and direct ATK/DEF bounds; D&D 3.5e has multi-file classes with levels 1..20 progression tables, ACFs, 22 Cleric Domains, Prerequisite ASTs, and 15 Creature Type engines; future systems like *Shadow of the Demon Lord* will have Paths, Boons/Banes, and Insanity). Hardcoding ruleset-specific checks in the core engine validator violates Tier 1/Tier 2 separation and couples unrelated tabletop systems. Furthermore, decomposing system content into modular per-entry files (`archetypes/`, `classes/`, `feats/`, `races/`, `spells/`, `templates/`) introduces the risk of orphan files or mismatched identifiers.
        - _Decision_:
          1. **Tier 1 Base Console Validator (`src/editor/campaign_validator.ts`)**: Stays 100% agnostic to any specific RPG tabletop system, validating shared campaign structures (maps, quests, triggers, dialogues, entities, reachability, and fuzzer smoke tests) and delegating to `ruleset.validateCampaignRuleset?.(campaign)`.
          2. **Tier 2 Cartridge Validators**: Each ruleset implements its own dedicated validator via the `RulesetContract` hook:
             - **`checkClassicRuleset` (`src/rulesets/classic/classic_validator.ts`)**: Enforces empty `systemContent` (zero foreign ruleset leakage), strictly increasing XP `requiredXp` across advancement levels, and positive baseline fighter HP.
             - **`checkDnD35eRuleset` (`src/rulesets/dnd35e/dnd35e_validator.ts`)**: Enforces full `DnD35SystemContentSchema` validation, outer-key vs. inner-ID parity across all 9 registries, class progression table continuity (`1..maxLevel`) and monotonicity, ACF swap validity, race favored-class/creature-type references, template conversion targets, Prerequisite AST `race_in` references, and campaign `archetypeId` resolution.
          3. **Tier 3 Disk-to-Descriptor Parity (`scripts/run-validator.ts`)**: Automated CLI check running during every `verify.sh` build, asserting a strict 1:1 match between files on disk in `public/data/rulesets/<id>/<category>/` and descriptors in `getSystemContentFiles()` (failing if orphan files exist on disk), and asserting `filename stem === outer key === inner ID`.

    18. **Universal `DnD35EffectBundleSchema`, Unified Race + RHD Progression (`races/<id>.json`), and First-Class SRD NPC Classes**:
        - _Context_:
          1. Previously, playable races (`races/`) and monster statblocks (`archetypes/` + `dragon_families.json`) lived in separate registries with different schemas, even though D&D 3.5e treats every creature symmetrically as a Race Chassis + Racial Hit Dice (`rhdProgression`) + optional Class Levels. Furthermore, size-gated natural weapons on True Dragons (`wings`, `tail_slap`, `crush`, `tail_sweep`) are a property of the Dragon's age-category progression tiers rather than a global rule on all wing or tail attacks.
          2. Cleric Domains, Creature Types, Subtypes, and Skills were stored in monolithic root JSON files, and Domain granted powers were represented as loose modifier arrays rather than named, atomic bundles—making it impossible for class features or prestige classes (like *Ordained Champion*) to trade or suppress a domain's granted power as a single unit.
          3. Feats, class features, racial traits, and domain powers span passive bonuses, conditional bonuses, virtual feat grants that bypass prerequisites (Ranger Combat Style), variable combat dials (Power Attack), and activated/spell-like abilities.
        - _Decision_:
          1. **Universal `DnD35EffectBundleSchema`**: Defined a single composable mechanical bundle schema shared across Feats, Class Features, ACFs, Domain Granted Powers, Racial Traits, Creature Types, Subtypes, and Templates. Each bundle has a stable `bundleId`, `category` (`'ex' | 'su' | 'sp' | 'trait'`), `usageMode` (`'passive' | 'activated' | 'toggle' | 'variable_dial' | 'spell_like' | 'triggered'`), optional `activationCondition` self-tag predicates, `modifiers`, `ruleOverrides`, `grantedFeats` / `virtualFeatGrants` (`ignorePrerequisites: boolean`), `classSkillsAdded`, `senses`, `immunities`, `vulnerabilities`, and `activatedAbilities`. Suppressing a `bundleId` in `DnD35EntityData.suppressedBundleIds` atomically disables all modifiers and feat grants from that bundle.
          2. **Unified `races/<id>.json` with `rhdProgression` Separation**: Consolidated all 75 playable races, monster races, 10 True Dragon varieties, and 4 Elementals into `public/data/rulesets/dnd35e/races/<id>.json`. Intrinsic racial traits live on the Race Chassis, while Racial Hit Dice (`baseHdCount`, `saveCurveOverrides`, `advancementRanges`, and multi-step `tiers` with creature-specific `unlockedNaturalWeapons`) live in `rhdProgression`.
          3. **5 SRD NPC Classes (`warrior`, `expert`, `adept`, `aristocrat`, `commoner`)**: Modeled as full 20-level classes (`isNpcClass: true`, `trackCategory: 'npc'`) selectable by both NPCs/monsters and PCs, supporting fractional NPC CR scaling (`computeNpcClassCrContribution`), the Nonelite Ability Array (`[13, 12, 11, 10, 9, 8]`), 1-HD humanoid replacement (`baseHdCount: 0`), and `stripClassLevels: true` on *Skeleton* and *Zombie* templates.

    19. **Canonical Attack Sequence & Equipped Weapon Resolution, Declarative Tactical Doctrines, Decoupled Level-Up & Multi-Mode Floor Traversal (Milestone 112.6)**:
        - _Context_:
          1. Melee attack resolution previously relied on flat weapon stats on `DnD35EntityData` rather than actual items in `EquipmentComponent.slots`. Furthermore, full-round attack sequences were not integrated into the live melee dispatch loop, risking divergence between single strikes and full attacks.
          2. In D&D 3.5e, a character can make a Full Attack if they haven't moved or took only a 5-foot step (`distanceMovedThisRoundFt <= 5`), whereas moving $> 5$ ft permits only a single Standard Attack.
          3. Character creation selected starting equipment packages, but never materialized physical item entities into `InventoryComponent` or equipped them into `EquipmentComponent.slots`.
          4. Leveling up: `grantDnD35eXp` previously automatically bumped `tracks` and HP upon crossing an XP threshold, bypassing the player's interactive level-up choices in the UI and risking divergence from `levelHistory`.
          5. Tactical stances/doctrines (Power Attack, Combat Expertise) used hardcoded feat string checks in Cartridge code instead of declarative schemas.
          6. Moving onto chasms or liquids blocked all actors, preventing flying or swimming creatures from traversing non-solid hazards.
        - _Decision_:
          1. **SSOT Weapon Resolution & Attack Sequencing**: `resolveEquippedWeaponProfile` inspects `EquipmentComponent.slots`, resolves item entities, calculates size scaling, material properties, and returns structured profiles. If unarmed, SRD Unarmed Strike stats scale by creature size (`1d3` Medium, `1d2` Small, `1d4` Large, bludgeoning, 20/x2). `resolveDnD35eMeleeAttack` queries `distanceMovedThisRoundFt <= 5` to trigger `buildFullAttackSequence` (iteratives + off-hand + natural attacks) or a single standard attack.
          2. **Starting Equipment Physical Materialization**: `applyCharacterCreationToPlayer` generates item entities with proper components and equips weapons/shields/armor into `EquipmentComponent.slots`.
          3. **Decoupled Interactive Level-Up Progression**: `grantDnD35eXp` strictly updates XP points and alerts the player. Only `applyLevelUpToActor` mutates level, tracks, and appends to `levelHistory`.
          4. **Declarative Tactical Dial Descriptors**: `evaluateTacticalDoctrineModifiers` evaluates declarative `TacticalDialDescriptor`s on active bundles.
          5. **Multi-Mode Floor Traversal**: `canTraverseTile(tileDef, movementModes)` checks `traversableBy` / hazard tags against `movementModes`, allowing flying and swimming actors to traverse chasms and water.

    20. **Stage 4 Topological Stat DAG Attack Routine & Two-Stage Effort/Grip Handedness Pipeline (Milestone 112.7)**:
        - _Context_:
          1. In D&D 3.5e, weapon "handedness" is not a static property on an item—it is a two-stage function of (a) the weapon's inherent effort designation (`light`, `one_handed`, `two_handed`), the weapon's size (`weaponSize`), and the wielder's current size (`effectiveSize`), followed by (b) the wielder's chosen grip (`one_handed` vs. `two_handed` when a free hand is available, or `double_weapon_twf` on a double weapon) and weapon-specific rules (Rapier `cannot_two_hand_str`, Light weapons gaining no two-handed bonus, Bastard Sword / Dwarven Waraxe 1H-exotic vs. 2H-martial).
          2. Furthermore, when an actor mixes manufactured weapons, multiple limbs ($2..6+$ arms), and natural weapons, any natural weapon on an occupied limb is suppressed while all remaining natural weapons (even normally primary ones like `Bite` or `Gore`) are demoted to secondary (`-5`, or `-2` with *Multiattack*, and $0.5\times \text{STR}$), and Power Attack damage scales per strike ($2\times$ two-handed, $1\times$ one-handed/natural/unarmed, $0\times$ light/off-hand manufactured).
          3. Computing this only at attack time inside `resolveDnD35eMeleeAttack` would leave the Character Sheet, HUD, Paper Doll, and AoO threat checks out of sync and could miss dynamic Stage 1 (`effectiveSize` from *Enlarge Person* / *Polymorph*) or Stage 2 (`effectiveAbilityModifiers.str`) changes.
        - _Decision_:
          1. **Persistent Flags vs. Stage 4 DAG Computation**: Persistent stance choices (`gripMode: 'one_handed' | 'two_handed' | 'double_weapon_twf'`) live on `TacticalDoctrineComponent` alongside `EquipmentComponent.slots` (`limbGroupId`). The complete `attackRoutine: DnD35ResolvedAttackRoutine` is computed in **Stage 4 of `evaluateDnD35eEntityDAG`**, consuming Stage 1's `effectiveSize` and Stage 2's `effectiveAbilityModifiers`.
          2. **Exact 3-Step Effort Ladder (`evaluateWeaponWieldingProfile`)**: $\text{Index}_{\text{eff}} = \text{Index}_{\text{base}} + (\text{Rank}(\text{WeaponSize}) - \text{Rank}(\text{WielderSize})) \in [0, 2]$, rejecting out-of-bounds shifts ($<0$ or $>2$) and applying $-2 \times |\Delta\text{Size}|$ attack penalties.
          3. **Per-Strike Pre-Computed `DnD35ResolvedStrikeProfile`**: Every strike in `attackRoutine.strikes` carries its pre-computed `attackBonus`, `weaponDice`, `strDamageBonus`, `doctrineDamageBonus` (per-strike Power Attack scaling), and `flatDamageBonus`, making `resolveDnD35eMeleeAttack` and UI views thin, unified consumers of the DAG.

    21. **Programmatic Single Source of Truth (SSOT) Responsibility Registries, Parity Validator & Continuous Documentation Sync (Milestone 112.8)**:
        - _Context_: In a large codebase (284+ TypeScript files across Core Console and D&D 3.5e Cartridge), features risk split-brain scenarios where responsibilities are duplicated, conflicting implementations arise, or legacy code paths remain active alongside new systems. Furthermore, markdown documentation easily drifts out of sync with code additions, renames, and deletions.
        - _Decision_:
          1. **Machine-Readable SSOT Registries**: All source code responsibilities are maintained in structured JSON registries (`docs/ssot/ssot_console.json` for Tier 1 Console/Engine files and `docs/ssot/ssot_dnd35e.json` for Tier 2 D&D 3.5e Cartridge files). Each entry defines its architectural tier, domain, responsibility, canonical entry points, ownership boundaries (includes/excludes), and forbidden anti-patterns.
          2. **Automated Markdown Projection**: `scripts/map-codebase.ts` programmatically renders `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` from the JSON registries, eliminating manual documentation drift.
          3. **Continuous Parity Verification**: `validateSsotRegistries` in `scripts/ssot_parity.ts` enforces 100% file coverage, disjoint partitioning, live TypeScript export validation (verifying every canonical entry point actually exists in the file's exports), and markdown synchronization. This is permanently wired into `scripts/run-validator.ts` and verified via `tests/ssot_registry_parity.test.ts`.
          4. **Process Integration in AGENTS.md**: Step 4 of the Kickoff Flow mandates checking `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` and providing an SSOT Ownership & Old-Brain Eviction Table when replacing legacy logic. Step 11 of After Writing Code mandates updating the SSOT registries, regenerating markdown maps, and ensuring 0 parity errors.

---

### Milestone 112.9: Declarative Multiclassing, 3-Horizon Stat Pipeline & Per-Class Spellbooks

- **Decision: 3-Horizon Stat Computation Boundary**:
  - Structured the character stat and feature evaluation pipeline into three explicit computation horizons (`src/rulesets/dnd35e/level_ledger.ts` & `src/rulesets/dnd35e/progression.ts`):
    - **Horizon 1 (Level History Ledger)**: Calculates permanent, immutable choices made at each Hit Die step (`levelHistory`: HD gain, class chosen, ability score increases, permanent skill point investments based on INT modifier at time of gain).
    - **Horizon 2 (Aggregated Progression Layers)**: Rebuilds structural progression aggregates from level history (`tracks`, `feats`, `skillRanks`, `scalingPools`, `spellbooksByClass`, and base save/BAB tracks). Crucially, conditional stat modifiers (e.g. `condition: 'self:armor:heavy'`) are preserved in component state rather than dropped during aggregation.
    - **Horizon 3 (Live Equipment & Tag Projection)**: Projects situational semantic tags (`armor:heavy`, `load:heavy`, `trait:literate`, `trait:unencumbered_speed`) dynamically from active inventory and encumbrance without invalidating or re-evaluating `levelHistory`.
  - *Rationale*: Rebuilding the entire character DAG from scratch on every equipment change or buff update causes unnecessary re-calculation of permanent skill point budgets and breaks temporary effect tracking. Separating permanent history (Horizon 1), aggregated structure (Horizon 2), and live situational tags (Horizon 3) enforces strict data isolation and performance efficiency.

- **Decision: Zero Hardcoded Class Behavior (Declarative JSON Schema Driven)**:
  - Extended `ClassDefinition` schema (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`) with declarative parameters: `grantsLiteracy`, `spellAcquisitionMode` (`known_and_prepared`, `prayerbook_prepared`, `spontaneous_known`), `upgradeOnDuplicateFeatureId`, `scalingPoolContribution`, and `grantedTags`.
  - Class-specific exceptions (e.g. Barbarian illiteracy, Cleric/Paladin Turn Undead stacking pools, Rogue/Barbarian Uncanny Dodge duplicate feature promotions to Improved Uncanny Dodge) are declared entirely in class JSONs (`public/data/rulesets/dnd35e/classes/*.json`) without hardcoded `if (classId === 'barbarian')` or `if (hasFeat('multiattack'))` branches in baseline engine loops.
  - *Rationale*: Preserves Rule 16 & Rule 17 of `AGENTS.md` (Leverage Generic Console Systems and Baseline Rules + Declarative Overrides). Any custom homebrew or modded class can define literacy rules, spellbook styles, or scaling pool contributions using standard JSON attributes without modifying TypeScript engine code.

- **Decision: Per-Class Spellbook State Isolation**:
  - Isolated spellcasting state by class using `spellbooksByClass: Record<string, SpellbookState>` and `learnedSpellsByClass: Record<string, string[]>` on `Dnd35eProgressionComponent`.
  - Step validation (`validateCharacterCreationStep` & `validateLevelUpStep`) automatically bypasses manual spell steps for `prayerbook_prepared` casters (Clerics, Paladins, Druids) while spawning dynamic per-class spell tabs for Arcane casters (Wizards, Bards, Sorcerers).
  - *Rationale*: Multiclass spellcasters in D&D 3.5e keep distinct spell lists, caster levels, and preparation slots per class. Mixing learned spells into a single unified array creates ambiguous spell DC calculations and breaks preparation UI gating.

---

### Milestone 117: Mid- & High-Level Spells (4th–9th Level) & 100% 22-Domain Grimoire Coverage

- **Decision: Modular High-Level Spell Effect Units (`energy_drain`, `save_or_die`, `summon`, `form_overlay`)**:
  - Expanded `DnD35SpellEffectUnitSchema` with 4 discriminated union variants:
    - `energy_drain`: Models negative levels with scaling duration or permanence.
    - `save_or_die`: Models thresholded/conditioned kill, banish, stun, and petrify effects with target HP/HD brackets (`minTargetCurrentHp`, `maxTargetCurrentHp`, `minTargetHitDice`, `maxTargetHitDice`) and on-save partial damage fallbacks.
    - `summon`: References canonical races (`sys.races`) and optional templates (`sys.templates`) in `summonPool` arrays with count dice and CL scaling.
    - `form_overlay`: Parameterizes polymorph, baleful polymorph, and shapechange transformations with allowed creature types and ability grants.
  - *Rationale*: Adheres to ECS data purity and Rule 18 (Universal Actor Symmetry). Avoids custom hardcoded spell mechanics by expressing complex 4th–9th level spell behaviors as data-driven effect units evaluated uniformly by `evaluateSpellEffectUnitsForTarget`.

- **Decision: Declarative Augment Summoning & Effective Caster Level Modifiers (Zero Feat Spaghetti)**:
  - Eliminated any potential `if (hasFeat('augment_summoning'))` branching in spell resolvers. Instead:
    - `augment_summoning.json` emits `modifiers` targeting `"summoned_creature:str"` and `"summoned_creature:con"` gated by `condition: { effectTagsAny: ["subschool:summoning", "summoning"] }`.
    - `materializeSummonedCreatureModifiers` in `spell_modifiers.ts` generically scans active caster `StatModifier[]` targeting `"summoned_creature:<stat>"`, validates against the spell's projected `effectTags`, strips the prefix, and stamps hierarchical `sourcePath` provenance (`"spell:<id>:<castId>/unit:<unitId>/<casterMod.sourcePath>"`).
    - `resolveSpellEffectiveCasterLevel` evaluates any active caster `StatModifier[]` targeting `"caster_level"` against spell effect tags (e.g. Good/Healing domain +1 CL).
  - *Rationale*: Preserves Rule 17 & Rule 19 of `AGENTS.md`. New feats, items, or domains that enhance summoned creatures or boost caster level for specific descriptors/schools require zero code changes.

- **Decision: 100% Referential Coverage Across All 22 Cleric Domains**:
  - Expanded the modular spell catalog from 98 to 289 spell definitions, ensuring every domain spell slot (`domainSpells["1".."9"]`) across all 22 Cleric Domains references a valid, canonical spell file in `public/data/rulesets/dnd35e/spells/<id>.json`.
  - Enforced disk and registry parity via `system_content_spell_ids.ts` and automated validation in `class_race_validator.ts` and `tests/dnd35e_m117_spells.test.ts`.
  - *Rationale*: Eliminates broken domain lookups or missing prayerbook spells in character creation, level-up, and domain preparation loops.

---

### Phase 26 (Milestones 118 & 119): Console UI Slot & Modal Host API vs. Hardcoded Cartridge `UIMode`s

- **Decision: Generic Console UI Slot & Modal Host API (`src/rendering/ui/cartridge_ui_registry.ts`, `UIMode.CartridgeModal`, `IntentType.ToggleCartridgeModal`)**:
  - Evicted ruleset-specific `UIMode` enum members (`UIMode.CharCreation`, `UIMode.LevelUp`) and eliminated direct D&D 3.5e UI imports from Tier 1 Console files (`game-state.types.ts`, `presenter.ts`, `session_dom.ts`, `session_controller.ts`, `input_handler.ts`, `hud_alerts.ui.ts`).
  - Introduced `UIMode.CartridgeModal = 'cartridge_modal'` paired with `activeCartridgeModalId?: string | undefined` on `GameState` and `ModalFrame`, backed by a declarative `CartridgeUIAdapter` registry (`cartridge_ui_registry.ts`).
  - Wired all D&D 3.5e UI surfaces (`'char_creation'`, `'level_up'`, `'character_sheet'`, `'spellbook'`, the HUD Tactical Doctrine Bar, and the `'Level Up Available!'` alert ribbon) through `src/rendering/ui/dnd35e_ui_adapter.ts`.
  - *Rationale*: Hardcoding `UIMode.Spellbook`, `UIMode.CharacterSheet`, `UIMode.CharCreation`, or `UIMode.LevelUp` in Tier 1 Console enums and `presenter.ts` violates `AGENTS.md` Rule 16 (Three-Tier Placement Heuristic). A Console-level UI Host API lets any Cartridge register arbitrary modals, hotkeys, dock commands, HUD slots, and alert ribbons while keeping the Console 100% ruleset-agnostic and centrally managing LIFO ESC stack behavior, RTwP auto-pause restoration, and `PresentationDomain` dirty-flag gating.

---

### Milestone 121: Feature-Driven Class Progression, ACF Reactivity & Tagged Companion Stat DAG

- **Decision: 100% Feature-Driven Class Choice Gating over Class-ID & Level Constants**:
  - Evicted all hardcoded class-ID checks (`classId === 'cleric' | 'wizard' | 'druid' | 'ranger' | 'rogue'`) and magic progression constants (`RANGER_COMBAT_STYLE_LEVEL`, `RANGER_IMPROVED_COMBAT_STYLE_LEVEL`, `RANGER_COMBAT_STYLE_MASTERY_LEVEL`, `RANGER_ANIMAL_COMPANION_MIN_LEVEL`, `RANGER_FAVORED_ENEMY_UPGRADE_LEVELS`, `ROGUE_SPECIAL_ABILITY_LEVELS`, `CLERIC_REQUIRED_DOMAIN_COUNT`) across `character_builder.ts`, `builder_validation.ts`, `builder_levelup_validation.ts`, `ledger_choices.ts`, and the Character Builder / Level-Up UI views.
  - All class option UI panels, validation requirements, and virtual feat grants now inspect active class features (`collectClassFeaturesUpToLevel(classDef, level, selectedAcfs)`) and `scalingPoolContribution` transitions (`animal_companion_effective_level`, `familiar_master_effective_level`).
  - *Rationale*: Hardcoding `classId === 'wizard'` or `level === 2` prevented Sorcerers from selecting a Familiar at creation, failed to suppress the Familiar requirement when a Wizard selected the *Abrupt Jaunt* ACF (`wizard_abrupt_jaunt_1` replacing `summon_familiar`), and prevented modded or prestige classes from reusing Domains, Combat Styles, Favored Enemies, or Special Ability pools.

- **Decision: Tag-Driven `companions` Array & 4-Stage Topological Stat DAG Evaluation for Servants**:
  - Unified servant definitions under `companions: ReadonlyArray<DnD35CompanionEntry>` where each entry carries `tags: ReadonlyArray<string>` (`['animal_companion']`, `['familiar']`, or merged `['animal_companion', 'familiar']`).
  - Refactored `syncActorCompanionsAndFamiliars` in `src/rulesets/dnd35e/companions.ts` to stack advancement bonuses per tag onto the servant's `DnD35EntityData` and evaluate its combat stats (`maxHp`, `attackBonus`, `acBreakdown.fullAC`, `saves`, `effectiveAbilityModifiers`) through `evaluateDnD35ActorStatDAG`.
  - *Rationale*: Separate `animalCompanionId` and `familiarId` spawners duplicated entity creation logic, bypassed size/DEX/CON DAG calculation, and could not represent prestige class dual-role servants (such as an Arcane Hierophant's *Companion Familiar*) where a single creature receives both Druid Animal Companion and Wizard Arcane Familiar progression simultaneously.
