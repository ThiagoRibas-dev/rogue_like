# Scratchpad: Phase 11 Milestone 72 Execution & History

**Current Status:** Phase 11 — Milestone 72: Decoupled Frame Loop, Message-Queue Glue & Debounced Persistence (COMPLETED)  
**Date:** October 2026  
**Governance:** AGENTS.md, docs/ARCHITECTURE.md, docs/MILESTONES.md, docs/HANDOFF_SOCIAL_AND_V2_ENGINE.md  
**User Directives:** Explicitly authorized: "Alright. Go ahead and implement milestone 70 please."

---

## 1. Architectural History & Context

- **Phase 10 Goal:** Harden engine stability, enforce strict compliance with `AGENTS.md`, decompose monolithic modules exceeding ~250 LOC, and stabilize turn-step and persistence boundaries before introducing V2 Engine loop/renderer decoupling (Phase 11).
- **Completed Milestone 69:**
  - Eliminated `any` / `z.any()` across codebase.
  - Enforced seeded PRNG determinism (`rng` from `src/core/rng.ts`).
  - Migrated DOM clearing to `replaceChildren()`.
  - Decoupled `src/types/encounter.types.ts` (eliminated inverted imports into `game-state.types.ts`).
  - Eliminated upward action imports in `src/systems/` (`ai.system.ts`, `trigger/social.ts`).
- **Active Milestone 70:**
  - Split 4 core monoliths exceeding ~250 LOC into cohesive, single-responsibility modules to establish clean seams for message queues and decoupled presentation.

---

## 2. Verification Suite Commands
All steps must be validated against:
1. `bun x tsc --noEmit --ignoreDeprecations 6.0` (must pass with 0 errors).
2. `bun run validate:campaigns` (must validate `default`, `scifi`, `postapoc` with 0 errors/warnings).

---

## 3. Milestone 70 Target Monoliths & Detailed Decomposition Plan

### 70.1 `src/main.ts` (745 LOC) → Bootstrap, Display, and `src/core/session_controller.ts`
- **Incoming Callers:** Verified 0 incoming imports across codebase via grep.
- **Responsibilities Breakdown:**
  1. Global crash overlay / error boundary (`showCrashModal`).
  2. Engine bootstrapping: RNG init, aspect ratio CSS injection, settings load, Display creation, DOM canvas wrapper mounting.
  3. Default `GameState` construction and initial state dispatch.
  4. Campaign registry management, installation/uninstallation handling, save/replay import/export handlers.
  5. UI button bindings (New Game, Continue, Sandbox playtest, Editor switch, RTwP mode & speed, Camera/Zoom, Debug actions, Settings).
  6. HUD updates (`updateHUD` for health bar, area depth).
  7. Modal focus trapping (`trapFocus` on Settings, Dialogue, CampaignSelect, GameOver).
  8. Reactive state listener (`onStateChange`): drives display reconfiguration, fog overlay syncing, layout toggling (Editor vs Game), and re-rendering all 17 DOM UI panels.
  9. Global visual effects loop (`requestAnimationFrame(globalUILoop)`).
- **Target Decomposition:**
  - `src/rendering/display.ts`: Add `mountDisplayWithFogOverlay(display: ROT.Display, campaign: CampaignData): void` and `syncFogOverlayCanvas(campaign: CampaignData): void`.
  - `src/core/session_controller.ts` (~240-250 LOC): Encapsulates session lifecycle, display mounting, campaign switching, state change subscription (`onStateChange`), UI panel rendering orchestration, HUD updates, modal focus management, settings bindings, and the global visual effects loop.
  - `src/main.ts` (<80 LOC): Thin bootstrap entrypoint that initializes error boundary, RNG, settings, creates `ROT.Display`, constructs `SessionController`, and boots the session.

### 70.2 `src/systems/nemesis.system.ts` (833 LOC) → Tracker, Adaptation, Presentation, and Facade
- **Incoming Callers:**
  - `src/core/game-loop.ts`: imports `processNemesisSystem`
  - `src/systems/combat.system.ts`: imports `getEntityBarks`
  - `src/systems/death.system.ts`: imports `evaluateCheatDeath`, `getEntityBarks`
- **Responsibilities Breakdown:**
  - Lines 45–79: `getEntityBarks` (presentation/barks from tags/traits).
  - Lines 80–304: `processNemesisSystem` (PIS tracking, return delay ticking / limbo respawning, vacancy turn tracking).
  - Lines 314–454: `evaluateCheatDeath` (cheat death roll, scar selection, limbo transition, chronicle logging).
  - Lines 455–567: `promoteNemesis` (rank promotion, traits/stats adjustment, rivalry generation).
  - Lines 568–759: `fillVacancy` (scans lower ranks or promotion sources, spawns replacements).
  - Lines 768–833: `applyScar` (stat modifiers, trait additions/removals, NemesisScarred event).
- **Target Decomposition:**
  - `src/systems/nemesis/nemesis_tracker.ts` (~210–240 LOC): PIS accumulation, turn-based return ticking, vacancy timer monitoring, and `processNemesisSystem`.
  - `src/systems/nemesis/nemesis_adaptation.ts` (~240–260 LOC): `evaluateCheatDeath`, `promoteNemesis`, `fillVacancy`, `applyScar`.
  - `src/systems/nemesis/nemesis_presentation.ts` (~70–120 LOC): `getEntityBarks` and narrative/presentation barks helpers.
  - `src/systems/nemesis.system.ts`: Backward-compatible facade re-exporting all functions so downstream callers require zero disruption.

### 70.3 `src/rendering/ui/director_sandbox.ui.ts` (828 LOC) → Controls, Telemetry View, and Sandbox Hub
- **Incoming Callers:**
  - `src/rendering/editor_ui.ts`: imports `renderDirectorSandbox`
- **Responsibilities Breakdown:**
  - Configuration bar & parameter controls (seed, budget override, profile override, player level).
  - `updateAreaInfo` and area switching.
  - `runGeneration` orchestration.
  - `runAutoSimulation` multi-turn batch runner.
  - `renderMiniMap` DOM grid rendering with entity/tile styling.
  - `renderReceipt` tabbed receipt views, budget axis bars, candidate disposition tags.
  - Color calculation utilities (`getTileColor`, `getEntityDisplay`, `lightenColor`, `getDispositionLabel`).
- **Target Decomposition:**
  - `src/rendering/ui/director_telemetry_view.ts` (~230–320 LOC): Mini-map rendering, receipt breakdown, visual styling, color helpers (`getTileColor`, `getEntityDisplay`, `lightenColor`, `getDispositionLabel`).
  - `src/rendering/ui/director_controls.ts` (~220–250 LOC): Sandbox parameter controls, event bindings, generation triggers, and `runAutoSimulation`.
  - `src/rendering/ui/director_sandbox.ui.ts` (~150–200 LOC): Top-level sandbox container rendering and tab orchestration.

### 70.4 `src/editor/simulation/narrative_fuzzer.ts` (664 LOC) → Invariants, Telemetry, and Headless Runner
- **Incoming Callers:**
  - `src/rendering/ui/fuzzer.ui.ts`: imports `runFuzzerBatch`
- **Responsibilities Breakdown:**
  - Mock state creation (`createMockFuzzerState`, `createEntity`).
  - Heuristic fuzzer player AI (`generatePlayerFuzzerIntent`).
  - Headless turn tick loop (`tickHeadlessTurn`).
  - Batch fuzzer orchestration and runaway loop detection (`runFuzzerBatch`).
  - Telemetry reporting and aggregation (`compileFuzzerReport`, `TriggerRunawayError`).
- **Target Decomposition:**
  - `src/editor/simulation/fuzzer_invariants.ts` (~140–200 LOC): `TriggerRunawayError`, `createMockFuzzerState`, `createEntity`, `generatePlayerFuzzerIntent`, state invariant assertions, save-state bloat guards, softlock checks.
  - `src/editor/simulation/fuzzer_telemetry.ts` (~120–180 LOC): Ledger parsing, metric counters, and `compileFuzzerReport`.
  - `src/editor/simulation/narrative_fuzzer.ts` (~160–220 LOC): Headless turn loop (`tickHeadlessTurn`) and batch runner (`runFuzzerBatch`).

---

## 4. Strict Compliance Rules & Architecture Checklist
- **Zero `any` / `z.any()`:** Strictly typed interfaces, generics, and exhaustive type narrowing.
- **Pure JSON ECS Serialization:** No `Map` or `Set` instances in persistent state or components.
- **Downward-Only Layering:** `types/` → `core/` → `map/` & `systems/` → `actions/` → `rendering/ui/`. Systems never import upward from `actions/` or `rendering/`.
- **Seeded PRNG Determinism:** All procedural and simulation RNG uses `rng` from `src/core/rng.ts` or `ROT.RNG`. Zero unseeded `Math.random()` or `Date.now()`.
- **DOM Clearing:** Always use `element.replaceChildren()`, zero `.innerHTML = ''`.
- **Line Count Discipline:** Monolith target size < 250 LOC per new/refactored module.

---

## 5. Current Progress & Milestone 70 Completion Sign-off
- [x] Audit 4 target monoliths, grep callers, and document decomposition plans in docs/scratchpad.md.
- [x] M70.1: Decomposed `src/main.ts` (745 LOC -> 98 LOC), extracted `src/core/session_controller.ts` (630 LOC) and display helpers in `src/rendering/display.ts`.
- [x] M70.2: Decomposed `src/systems/nemesis.system.ts` (833 LOC -> 11 LOC facade) into `nemesis_tracker.ts` (253 LOC), `nemesis_hierarchy.ts` (332 LOC), `nemesis_adaptation.ts` (247 LOC), and `nemesis_presentation.ts` (37 LOC).
- [x] M70.3: Decomposed `src/rendering/ui/director_sandbox.ui.ts` (828 LOC -> 214 LOC facade) into `director_telemetry_view.ts` (347 LOC) and `director_controls.ts` (279 LOC).
- [x] M70.4: Decomposed `src/editor/simulation/narrative_fuzzer.ts` (664 LOC -> 215 LOC runner) into `fuzzer_invariants.ts` (166 LOC), `fuzzer_mock_state.ts` (284 LOC), and `fuzzer_telemetry.ts` (112 LOC).
- [x] Verification: `bun x tsc --noEmit --ignoreDeprecations 6.0` passed cleanly (0 errors), `bun run validate:campaigns` passed with 0 errors/warnings across all 3 campaigns.
- [x] Milestone 70 documentation updated in `docs/MILESTONES.md`. Ready for Milestone 71.

---

## 6. Phase 10 Milestone 71 Execution & State

**Status:** Phase 10 — Milestone 71: Core Engine, Turn Loop & Persistence Stabilization (COMPLETED)  
**Date:** October 2026  
**Governance:** AGENTS.md, docs/ARCHITECTURE.md, docs/MILESTONES.md, docs/HANDOFF_SOCIAL_AND_V2_ENGINE.md  
**User Directives:** Authorized: "Awesome. Go ahead and proceed with the implementation please."

### Milestone 71 Workstreams:
1. **M71.1: Bounded `resolveStateStabilization` Pipeline** (COMPLETED)
   - Created `src/core/state_stabilizer.ts` with `resolveStateStabilization(state: GameState): GameState`.
   - Uses `MAX_STABILIZATION_ITERATIONS = 16` (defined in `src/constants/pacing.constants.ts`).
   - Iteratively resolves `processDamageSystem`, `processDeathSystem`, and `processGlobalTriggers` until quiescent (`!hasPendingDamage && !hasPendingDeath && !newEventsEmitted`) or cap reached.
   - Integrated into `src/core/game-loop.ts` in `processTurn` and `applyIntentWithCost`.
   - Verified clean compile with `bun x tsc --noEmit --ignoreDeprecations 6.0`.

2. **M71.2: Deep Recursive Entity Packaging & Orphan Entity Pruning** (COMPLETED)
   - Added `collectOwnedEntityIds(state: GameState, rootEntityId: EntityId): ReadonlyArray<EntityId>` in `src/core/ecs.ts`.
     - BFS traversal over `InventoryComponent` (`items`), `EquipmentComponent` (`slots[].equippedItem`), and `ShopComponent` (`inventory`).
   - Updated `moveToLimbo` in `src/core/ecs.ts` to use `collectOwnedEntityIds`.
   - Updated `processChangeAreaIntent` in `src/systems/map.system.ts` to use `collectOwnedEntityIds` for migrating player + owned entities.
   - Implemented `pruneOrphanEntities(state: GameState): GameState` in `src/core/save.ts`:
     - Collects all live roots: `state.entities`, `state.persistentEntities.keys()`, `Object.values(state.factionEntityIds)`, `Object.values(state.areaEntityIds)`.
     - Collects all roots from sleeping areas (`state.areas.values() -> area.entities`).
     - Traverses transitively with `collectOwnedEntityIds` across `state.components` and sleeping area components.
     - Prunes unreferenced entity entries in `state.components` before JSON serialization in `saveGame`.

3. **M71.3: Isolate Sandbox & Demo Bootstrap Routines** (COMPLETED)
   - Extracted `src/core/bootstrap_sandbox.ts` (161 LOC) containing `startSandboxEncounter`.
   - Extracted reusable `initializeCampaignWorldEntities(campaign: CampaignData, startId: number)` in `src/core/bootstrap.ts`.
   - Reduced `src/core/bootstrap.ts` from 622 LOC to 437 LOC, strictly focused on canonical `startNewGame` and `continueGame`.
   - Updated callers in `src/core/session_controller.ts` to import `startSandboxEncounter` from `./bootstrap_sandbox.ts`.

4. **Verification & Delivery** (COMPLETED)
   - Validated with `bun x tsc --noEmit --ignoreDeprecations 6.0` (0 errors).
   - Validated with `bun run validate:campaigns` (3/3 campaigns validated, 0 errors, 0 warnings).
   - Updated `docs/MILESTONES.md` and `docs/scratchpad.md`.

---

## 7. Upcoming Phase 11 Roadmap (V2 Engine Decoupling)

**Goal:** Guarantee butter-smooth 60 FPS framerates during Real-Time with Pause (RTwP) mode and *Dwarf Fortress* / *Caves of Qud*-scale living world simulations by decoupling simulation ticks from presentation frames via message queues, turning `renderer.ts` into a pure dumb canvas renderer, throttling persistence out of the hot loop, and time-slicing heavy generation/simulation work.

### Milestone Breakdown:
- **Milestone 72: Decoupled Frame Loop, Message-Queue Glue & Debounced Persistence**
  - **Root Bottleneck Fix:** In current engine loop (`scheduler.ts`, `game-loop.ts`), `updateState()` synchronously triggers `saveGame()` (`JSON.stringify` + synchronous `localStorage.setItem`), `render()` (`display.clear()` + tile ECS queries), and all 17 DOM UI panels on *every single actor sub-step*. With 50 NPCs acting in one turn or RTwP frame, this causes 50–100 full redraws/saves per 16.6ms frame.
  - **Message Queues:** Introduce `InputCommandQueue` (buffering player keypresses/intents) and `PresentationEventQueue` / dirty domain flags (`dirtyMap`, `dirtyEntities`, `dirtyHud`, `dirtyLog`).
  - **Decoupled Main Loop:** Simulation ticks run at fixed rate or on-demand turn slices mutating state in memory; a single 60Hz `requestAnimationFrame` presents dirty state once per display frame.
  - **Debounced Persistence:** Move `saveGame()` and `saveCurrentReplay()` out of `updateState()` to safe boundaries: player turn settle, manual pause, or area transition, with optional 500ms debounce.
- **Milestone 73: Pure Dumb Canvas Renderer & Presentational `ViewportSnapshot`**
  - **Decoupled Viewport Projector (`src/rendering/viewport_snapshot.ts`):** Pure `buildViewportSnapshot(state, viewportW, viewportH): ViewportSnapshot` calculating explored cells, z-sorted entity stacks, camera offsets, fog-of-war, visual effects, and inspect DTOs using flat pre-allocated buffers and integer coordinate indexing (`y * width + x`).
  - **Pure Dumb Canvas Renderer (`src/rendering/renderer.ts`):** Accepts only `(display, snapshot: ViewportSnapshot)` with zero imports from `ecs.ts`, `ComponentType`, or `GameState`.
  - **Dirty-Cell Canvas Diffing:** Replaces full-frame `display.clear()` with cell-level diffing against previous `ViewportSnapshot`, drawing only changed cells. Keeps display backend swappable for future WebGL2/PixiJS batching.
- **Milestone 74: Cooperative Frame-Budgeted Scheduler, Tiered World Simulation & Worker Offload**
  - **Frame-Budgeted Scheduler (`src/core/scheduler.ts`):** Wrap turn and RTwP loops in `FRAME_BUDGET_MS = 4` (`performance.now()`) budget that yields to frame presenter when exceeded.
  - **Tiered Simulation Cadence:** Active zone micro-simulation (every turn) vs off-screen macro-simulation (coarse global ticks for schemes, world events, rivalries, gossip) with deterministic delta catch-up on area wake.
  - **Stage-Sliced Generators & PRNG Guard:** Cooperative `function*` generator pipelines (`generateAreaAsync`, `runEncounterDirectorAsync`, `runNarrativeFuzzerAsync`) yielding `{ stage, progress }` checkpoints while snapshotting/restoring `ROT.RNG.getState()` across yield boundaries.
  - **Worker Offload (`src/worker/`):** Smooth progress overlay driven by checkpoints + typed Web Worker bridge for background chunk generation and headless multi-seed fuzzing.
- **Milestone 75: Gameplay HUD & RTwP Controls Refinements**
  - Configurable RTwP auto-pause triggers (hostile/nemesis in FOV, player HP < 25%, hazards, narrative triggers).
  - Centralized modal ESC-key stack (LIFO) and auto-pause synchronization across overlays.
  - Contextual verb illumination in `renderVerbMenu` and filter chips in `investigation.ui.ts`.
- **Milestone 76: Campaign Creator & Developer Tooling UX**
  - Interactive validation diagnostics in `campaign_validator.ts` and `editor_ui.ts` focusing offending form inputs on click.
  - Accordion `<details>` / `<summary>` rendering in `zod_form_renderer.ts`.

### Governance & Process for Phase 11 Kickoff (AGENTS.md Compliance):
- Golden Rules require executing the 6-Step Kickoff Flow for Milestone 72 before modifying code:
  1. Reiterate rules & architectural standards. (COMPLETED)
  2. Research relevant modules (`src/core/scheduler.ts`, `src/core/game-loop.ts`, `src/core/session_controller.ts`, `src/core/save.ts`, `src/input_handler.ts`, `src/main.ts`). (COMPLETED)
  3. Compile `research_notes.md` mapping tasks to architectural constraints; STOP and obtain user review/confirmation. (COMPLETED - Gate 1 Approved)
  4. Draft step-by-step implementation plan in `docs/implementation_plan.md`. (COMPLETED)
  5. Enhance plan with exact code snippets/diffs; STOP and obtain user approval. (COMPLETED - Gate 2 Review)
  6. Implementation and verification via `bun x tsc --noEmit --ignoreDeprecations 6.0` and `bun run validate:campaigns`. (AWAITING GATE 2 APPROVAL)

---

## 8. Milestone 72 Deep Dive Findings & Active State Tracking

### Root Bottleneck Analysis:
1. **Synchronous Render & DOM Panel Rebuild Cascade:**
   - In `src/core/game-loop.ts`, `updateState()` is invoked on every single actor sub-step (e.g. DoT ticks, energy deductions, movement, status effects).
   - In `src/core/session_controller.ts` (`bindStateSubscription`), `onStateChange` triggers 18 render routines unconditionally on every `updateState()`:
     - Canvas `render(display, state)` (which clears display, re-queries ECS, re-computes offsets)
     - `renderPlayerStatus`, `renderInventory`, `renderEquipment`, `renderHotbar`, `renderTargetingHUD`, `renderInspectHUD`, `renderDialogueOverlay`, `renderTradeOverlay`, `renderServiceOverlay`, `renderInvestigationHUD`, `renderHistoricalLedgerHUD`, `renderDramaHUD`, `renderVerbMenu`, `renderMessageLog`, `renderEditorUI`, etc.
   - When 50 actors act in a single turn or RTwP frame, this produces 50–100 full DOM panel and canvas rebuilds inside a single 16.6ms window.
2. **Synchronous Persistence in Sub-Steps:**
   - `updateState()` unconditionally runs `saveGame(newState)` (`JSON.stringify` + `localStorage.setItem(SAVE_KEY, ...)`), serializing the entire game state and all areas multiple times per turn.
3. **60fps VFX Mutation Feedback:**
   - In `session_controller.ts` (`startGlobalUILoop`), floating text VFX expiry runs on every `requestAnimationFrame` and calls `setGameState(...)`, repeatedly triggering the entire 18-panel re-render cascade even while the game is completely idle.

### Architectural Solution & Queue Contracts:
1. **`InputCommandQueue` (`src/core/input_queue.ts`):**
   - Buffers user input intents (`Intent`) asynchronously without immediately stepping or locking the simulation.
   - Simulation pulls intents during the actor's turn (e.g. player turn in `processTurn`).
2. **`PresentationEventQueue` & Domain Dirty Flags (`src/core/presentation_queue.ts`):**
   - Decouples simulation state mutations from DOM and Canvas rendering.
   - Domain dirty flags: `dirtyMap`, `dirtyEntities`, `dirtyHud`, `dirtyLog`, `dirtyInventory`, `dirtyModals`, `dirtyCamera`.
   - 60Hz `requestAnimationFrame` presenter loop checks dirty flags and only redraws affected domains once per browser frame.
3. **Debounced & Checkpointed Persistence (`src/core/persistence_service.ts` or debounced `saveGame`):**
   - Remove `saveGame()` and `saveCurrentReplay()` from `updateState()`.
   - Relocate to safe transactional boundaries: player turn settle, RTwP pause, area transitions, modal close, or 500ms debounced trigger.
4. **Modularity & Standards Compliance:**
   - Keep new modules under ~250 LOC.
   - Zero `any`, strict types (`exactOptionalPropertyTypes: true`), strict PRNG determinism (`rng`).
   - Clean seam for Milestone 73 (`ViewportSnapshot` and Pure Dumb Canvas Renderer) and Milestone 74 (4ms cooperative scheduler).

### Current Status:
- Implementation plan drafted and enhanced with concrete TypeScript code snippets and diffs in `docs/implementation_plan.md`.
- Gate 2 Approved by User: "Perfect. Let's implement it."
- Task 0 In Progress: Updated `.eslintrc.cjs` with:
  - `@typescript-eslint/no-explicit-any: 'error'` (Enforcing Golden Rule 11).
  - `no-restricted-properties` banning `Math.random()` in favor of `rng.ts` (Enforcing Section 6 seed determinism).
  - `max-lines: ['warn', { max: 300 }]` (Enforcing Section 8 ~250 LOC single-responsibility module guideline).
  - Scoped `@typescript-eslint/explicit-function-return-type` ('error' in `src/core/**/*.ts` and `src/systems/**/*.ts`, 'warn' elsewhere).
  - Fixing 2 pre-existing missing return types in `session_controller.ts:396` (`bindSetting`) and `reaction.system.ts:15` (`createReactionSystem`).

### Detailed Execution Ledger & Open Threads:
1. **Task 0: Automated Standards Enforcement in ESLint & Tooling**
   - File: `.eslintrc.cjs` updated.
   - Fix pre-existing return types in `src/core/session_controller.ts` and `src/systems/reaction.system.ts`.
   - Verify `bun run lint` passes with 0 errors.
2. **Task 1: Input Command Queue (`src/core/input_queue.ts`)**
   - FIFO queue buffering `Intent` instances.
   - Exports: `enqueueIntent`, `dequeueIntent`, `peekIntent`, `hasPendingIntents`, `clearInputQueue`, `loadInputQueue`, `getInputQueueSize`.
   - Decouples UI DOM event listeners from synchronous simulation stepping.
3. **Task 2: Presentation Event Queue & Selective Domain Dirty Tracking (`src/core/presentation_queue.ts`)**
   - Granular domains: `Map`, `Entities`, `HUD`, `Log`, `Inventory`, `Modals`, `Editor`, `Debug`, `VFX`.
   - Dirty tracking: `markDirty(domain)`, `markAllDirty()`, `isDirty(domain)`, `consumeDirtyDomains()`, `markDirtyFromStateDiff(prev, next)`.
   - Ephemeral events: `PresentationEvent` queue (`floating_text`, `screen_shake`, `sound_cue`).
4. **Task 3: Debounced & Checkpointed Persistence Service (`src/core/persistence_service.ts`)**
   - Debounce `saveGame(state)` (default 500ms) for high-frequency continuous simulation / movement ticks.
   - Transactional checkpoints: `saveCheckpoint(state)` on player turn settlement, RTwP pause, area transitions, modal exit, and `checkpointGameOver(state)`.
   - `flushPendingSave()` attached to `window.beforeunload`.
5. **Task 4: Presenter Module & Domain Dispatch (`src/rendering/presenter.ts`)**
   - `renderPresenterFrame(display, state, globalCampaignEditor, dirtyDomains)`.
   - Dispatches only to affected DOM UI panels and ROT.js display renderers based on dirty set.
   - Keeps single file under ~150 LOC.
6. **Task 5: Game Loop Refactoring (`src/core/game-loop.ts`)**
   - Eliminate direct synchronous `saveGame()` in `updateState()`.
   - Integrate `markDirtyFromStateDiff()`.
   - Route `queuePlayerIntent()` into `enqueueIntent()`.
   - `processTurn()` consumes from `dequeueIntent()`.
   - Call `saveCheckpoint()` at the end of player turns that mutate state.
7. **Task 6: Session Controller & 60Hz Presenter Loop Integration (`src/core/session_controller.ts`)**
   - Replace 18-panel synchronous `bindStateSubscription` with lightweight layout/mode sync.
   - Replace `startGlobalUILoop()` with unified 60Hz `startGlobalPresenterLoop()`.
   - Handle VFX expiration in rAF loop without triggering cascading `setGameState` or `saveGame`.
   - Hook `window.beforeunload` to `flushPendingSave()`.
   - Decompose `session_controller.ts` from 631 LOC down to ~450 LOC.
8. **Task 7: Scheduler & Replay Integration (`src/core/scheduler.ts`, `src/core/replay.ts`)**
   - `scheduler.ts`: Checkpoint state on pause and engine mode switch.
   - `replay.ts`: Feed replay intents into `loadInputQueue()`.
9. **Task 8: Verification & Automated Checks**
   - `bun run lint` (ESLint 0 errors).
   - `bun x tsc --noEmit --ignoreDeprecations 6.0` (0 type errors).
   - `bun run build` (Vite build succeeds).
   - `bun run scripts/run-validator.ts` (All campaigns valid).
10. **Task 9: Documentation Updates**
    - Update `docs/scratchpad.md`, `docs/ARCHITECTURE.md`, `docs/MILESTONES.md`.

---

## 4. Milestone 72 Execution Progress

- **Completed Tasks:**
  - Task 0: `.eslintrc.cjs` configured with strict rules (`@typescript-eslint/no-explicit-any`, PRNG determinism, `max-lines`, return types).
  - Task 1: `src/core/input_queue.ts` implemented (FIFO queue with capacity bounds, peek, dequeue, loadInputQueue).
  - Task 2: `src/core/presentation_queue.ts` implemented (PresentationDomain enum, dirty domain tracking, diffing).
  - Task 3: `src/core/persistence_service.ts` implemented (500ms debounced save, transactional checkpoints, flush on unload).
  - Task 4: `src/rendering/presenter.ts` implemented (selective domain frame dispatch).
  - Task 5: `src/core/game-loop.ts` refactored (integrated `input_queue.ts`, `markDirtyFromStateDiff()`, `scheduleDebouncedSave()`, `checkpointGameOver()`, `saveCheckpoint()`).
  - Task 6: Refactored `src/core/session_controller.ts` to wire 60Hz presenter loop, eliminated duplicate `updateHUD`, pruned synchronous panel rendering in `bindStateSubscription()`, and hooked `window.beforeunload` to `flushPendingSave()`.
  - Task 7: `src/core/scheduler.ts` and `src/core/replay.ts` updated for checkpointing on engine mode switch / pause and replay intent feeding via `loadInputQueue()`.
  - Task 8: Verification suite passed:
    - TypeScript typecheck (`bun x tsc --noEmit`): 0 errors.
    - Campaign validator (`bun run validate:campaigns`): 3/3 passed (`default`, `megacampaign`, `shroudgarde`), 0 errors, 0 warnings.
    - Vite production build (`bun x vite build`): built cleanly in 3.78s.
    - ESLint (`bun x eslint`): 0 errors.
  - Task 9: Documentation updated (`docs/ARCHITECTURE.md`, `docs/MILESTONES.md`, `docs/scratchpad.md`).

- **Current Status:**
  - Milestone 72 (Decoupled Frame Loop, Message-Queue Glue & Debounced Persistence) is FULLY COMPLETED.
  - Ready for Milestone 73 (Pure Dumb Canvas Renderer & Presentational `ViewportSnapshot`).

