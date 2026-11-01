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
         1. **Audit Existing Console Utilities**: Inspect `src/systems/`, `src/types/`, and `src/core/` (e.g., `TagsComponent`, `TraitsComponent`, `reaction.system.ts:getEntityMatcherData`, `evaluateTargetMatcher`, spatial index raycasters, trigger-consequence buses).
         2. **Evaluate Generic Extension vs. Cartridge Silo**:
            - _Console Extension (Preferred)_: Extending generic primitives (such as tag-based matching: `targetTagsAll`, `targetTagsAny`, `effectTagsAny` on modifiers) empowers *all* present and future rulesets (`classic`, `dnd35e`, `brp_d100`, `gurps`), eliminates redundant entity query code, and maintains data-driven moddability via tags (`AGENTS.md` §5).
            - _Cartridge Silo (Restricted)_: Confined strictly to pure mathematical rules unique to that specific tabletop ruleset (e.g., 18-type bonus stacking rules, Vancian prepared slot states, 1-2-1-2 diagonal distance).
         3. **Record Tradeoff Rationale**: Explicitly record why the generic or siloed path was chosen in research notes and implementation plans.
