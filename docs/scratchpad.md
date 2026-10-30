# Scratchpad: Phase 11 Engine Evolution & Milestone History

**Current Status:** Phase 11 — Milestone 75: Gameplay HUD & RTwP Controls Refinements (COMPLETED & VERIFIED) | Milestone 76: Campaign Creator & Developer Tooling UX (NEXT)  
**Date:** October 2026  
**Governance:** AGENTS.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/MILESTONES.md, docs/HANDOFF_SOCIAL_AND_V2_ENGINE.md  
**User Directives:** "Let's gooooo. Implement it please." (Milestone 74 authorized & executed) / Verification clean & documentation complete.

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
  - Milestone 73 (Pure Dumb Canvas Renderer & Presentational `ViewportSnapshot`) is FULLY COMPLETED.
  - Up Next: Milestone 74 (Cooperative Frame-Budgeted Scheduler, Tiered World Simulation & Worker Offload).

---

## 5. Milestone 73: Pure Dumb Canvas Renderer & Presentational `ViewportSnapshot`

### 5.1 Historical Context & Completed Decisions (Milestone 72 Recap)
- **Decoupled Architecture Established:**
  - Simulation and Input communicate via FIFO `InputCommandQueue` (`src/core/input_queue.ts`), bounding memory and supporting determinism.
  - Presentation dirty tracking decoupled via `PresentationDomain` bitmask / Set in `src/core/presentation_queue.ts`. Passive simulation ticks no longer trigger full UI redraws.
  - Persistence decoupled via `src/core/persistence_service.ts`: 500ms trailing debounce for continuous ticks, plus transactional checkpoints on turn settle, RTwP pause, area transitions, and game over.
  - Unified 60Hz `requestAnimationFrame` loop in `SessionController` dispatches to `renderPresenterFrame()` in `src/rendering/presenter.ts`.

### 5.2 Milestone 73 Research Audit & Architectural Analysis
1. **Current `src/rendering/renderer.ts` Monolith (573 LOC):**
   - **Coupling Inversion:** Directly imports and queries `GameState`, `ComponentType`, `getComponent`, `IdentityComponent`, `MemoryComponent`, `NemesisComponent`, `ChronicleComponent`.
   - **Heavy Business Logic in View:** Calculates `getEffectiveStats(state, entityId)`, scans `historicalLedger`, checks dominant personality traits (`FACET_DOMINANT_HIGH_THRESHOLD`), builds inspect stat strings, and traverses spatial maps (`state.spatialIndex.get(`${mapX},${mapY}`)`).
   - **Mixed View Concerns:** Combines ROT.js Canvas drawing (`display.draw`, `drawCell`), HTML DOM element manipulation (`#effects-overlay`, `#inspect-tooltip`, `#inspect-panel`), and secondary 2D canvas overlay drawing (`#fog-overlay`).
   - **Full-Frame Redraw Inefficiency:** Calls `display.clear()` every frame when `PresentationDomain.Map` or `Entities` are dirty, re-iterating `viewportW * viewportH` (typically 80x25 to 100x40 = 2,500 cells) and rebuilding cell draw commands even if only the player moved 1 tile.

2. **Target Architecture & Separation of Concerns (Inspired by `slashman/jsrl`):**
   - **`src/rendering/viewport_snapshot.types.ts`:**
     - Pure presentational DTOs:
       - `ViewportCellDTO`: `{ glyph: string; fg: string; bg: string; spriteId?: string; isExplored: boolean; isVisible: boolean }`.
       - `ViewportSnapshot`: Pre-computed 2D/flat array of cells (`cells: ReadonlyArray<ViewportCellDTO>` or flat typed buffers), camera offset, targeting/inspect crosshair positions, list of active visual effect DTOs, fog overlay metric DTOs, and pre-formatted inspect tooltip DTO.
   - **`src/rendering/viewport_snapshot.ts` (Projector):**
     - Pure function: `buildViewportSnapshot(state: GameState, viewportW: number, viewportH: number): ViewportSnapshot`.
     - Queries ECS, spatial indices, camera clamping, FOV sets, and personality/stats once per presentation frame.
     - Uses integer indexing (`y * width + x`) to eliminate per-cell string allocations.
   - **`src/rendering/renderer.ts` (Pure Dumb Canvas Renderer):**
     - Signature: `render(display: ROT.Display, snapshot: ViewportSnapshot, prevSnapshot?: ViewportSnapshot): void`.
     - **Zero imports** from `ecs.ts`, `ComponentType`, or `GameState`.
     - Cell-level diffing: Compares each `snapshot.cells[i]` with `prevSnapshot.cells[i]`. Only modified cells invoke `drawCell()`. If `prevSnapshot` is undefined (first render, camera jump, theme switch, display resize), performs full draw.
   - **DOM UI Separation (`src/rendering/ui/`):**
     - Extract `renderInspectTooltip` and `renderVisualEffects` from `renderer.ts` into dedicated UI views (e.g. `src/rendering/ui/inspect.ui.ts` and `src/rendering/ui/vfx.ui.ts`), consuming pre-projected DTOs from the snapshot.

### 5.3 Decisions & Open Threads
- **Decision 1 (Snapshot Caching):** `presenter.ts` will retain `lastViewportSnapshot: ViewportSnapshot | undefined` across frames to drive the cell-level dirty diff in `renderer.ts`.
- **Decision 2 (Invalidation Triggers):** Area change, display resize, camera snap, and campaign/theme switch will explicitly clear `lastViewportSnapshot`, forcing a complete canvas refresh.
- **Decision 3 (DOM Hygiene):** Inspect tooltip and visual effects DOM synchronization will be separated from canvas rendering into `src/rendering/ui/inspect_view.ui.ts` and `src/rendering/ui/vfx_overlay.ui.ts`, adhering to the 1-responsibility-per-file guideline (<250 LOC).
- **Decision 4 (Resolved Open Thread 1 - ROT.js Dirty-Cell Redraws & Ghosting Prevention):**
  - Confirmed via `node_modules/rot-js/lib/display/display.js`, `rect.js`, and `tile.js`:
  - In `Display._tick()`, dirty cells pass `clearBefore = true` to `this._backend.draw(data, clearBefore)`.
  - In `Rect.draw(data, clearBefore)`: `clearBefore` fills the cell rectangle with `bg` before redrawing characters.
  - In `Tile.draw(data, clearBefore)`: `clearBefore` clears the tile rectangle (`ctx.clearRect` or `ctx.fillRect`) before composite sprite drawing.
  - Therefore, differential `drawCell()` on modified cells does NOT cause ghosting or stacking leaks.
  - Full display sweep (`display.clear()`) is reserved strictly for initialization, area changes, zoom changes, and display resizing.
- **Decision 5 (Resolved Open Thread 2 - 1D Flat Array Layout):**
  - `ViewportSnapshot.cells` uses a 1D flat array `ReadonlyArray<ViewportCellDTO>` of length `viewportW * viewportH`.
  - Indexing: `index = vy * viewportW + vx`.
  - Advantages: Contiguous memory layout, zero inner array allocation, fast linear traversal for dirty diffing (`for (let i = 0; i < totalCells; i++)`), and deterministic cell equivalence checking.

### 5.4 DTO Specifications & Target Module Layout
1. **`src/rendering/viewport_snapshot.types.ts`:**
   - `EntityRenderDTO`: `{ glyph: string; fg: string; bg: string; spriteId?: string }`
   - `ViewportCellDTO`: `{ vx: number; vy: number; glyph: string; fg: string; bg: string; spriteId?: string; entities: ReadonlyArray<EntityRenderDTO>; isExplored: boolean; isVisible: boolean }`
   - `ViewportCrosshairDTO`: `{ vx: number; vy: number; glyph: string; fg: string; bg: string }`
   - `VisualEffectDTO`: `{ id: string; content: string; color: string; vx: number; vy: number; inViewport: boolean }`
   - `InspectSectionDTO`: `{ type: 'header' | 'stat' | 'desc'; label?: string; value: string; color?: string; isHtml?: boolean }`
   - `InspectTooltipDTO`: `{ active: boolean; vx: number; vy: number; sections: ReadonlyArray<InspectSectionDTO> }`
   - `ViewportSnapshot`: `{ viewportW: number; viewportH: number; cameraX: number; cameraY: number; isSpriteMode: boolean; is3D: boolean; cells: ReadonlyArray<ViewportCellDTO>; crosshair?: ViewportCrosshairDTO; visualEffects: ReadonlyArray<VisualEffectDTO>; inspectTooltip: InspectTooltipDTO }`

2. **`src/rendering/viewport_snapshot.ts`:**
   - `buildViewportSnapshot(state: GameState, viewportW: number, viewportH: number): ViewportSnapshot`
   - Concentrates all ECS reading, spatial index queries, camera calculation, FOV lookup, and inspect projection in one place.

3. **`src/rendering/renderer.ts` (Pure Dumb Canvas Renderer):**
   - `render(display: ROT.Display, snapshot: ViewportSnapshot, prevSnapshot?: ViewportSnapshot): void`
   - Zero imports from `ecs.ts`, `ComponentType`, or `GameState`.
   - Linear dirty diff: Only draws cells where `prevSnapshot` differs from `snapshot`.

4. **`src/rendering/ui/inspect_view.ui.ts` & `src/rendering/ui/vfx_overlay.ui.ts`:**
   - Dedicated DOM views consuming DTOs directly from `ViewportSnapshot`.

5. **`src/rendering/presenter.ts`:**
   - Holds `lastViewportSnapshot`, invalidates on reset triggers, coordinates projection and dispatch.

---

## 6. Phase 11 — Milestone 74: Cooperative Frame-Budgeted Scheduler, Tiered Simulation & Worker Offload (COMPLETED)

### 6.1 Summary of Deliverables & Files Created/Modified
- **`src/constants/scheduler.constants.ts`**: Centralized engine scheduling constants (`FRAME_BUDGET_MS = 4`, `MAX_RTWP_DRAIN_ITERATIONS = 10`, `MAX_ACCUMULATED_RTWP_TIME = 1000`, `LOCAL_NARRATIVE_TICK_INTERVAL = 10`, `RIVALRY_TICK_INTERVAL = 25`, `SCHEME_TICK_INTERVAL = 50`, `WORLD_EVENT_TICK_INTERVAL = 100`, `FUZZER_YIELD_TURN_INTERVAL = 100`).
- **`src/core/scheduler.ts`**:
  - `runTurnBasedLoop()`: Slices execution when elapsed time exceeds `FRAME_BUDGET_MS = 4ms` measured via `performance.now()`. Yields to browser event loop via `setTimeout(..., 0)` while locking engine (`isTurnProcessing = true`, `engine.lock()`) to guarantee zero re-entrant input interleaving.
  - `rtwpLoop()`: Clamped by `MAX_RTWP_DRAIN_ITERATIONS = 10`, `FRAME_BUDGET_MS = 4`, and `MAX_ACCUMULATED_RTWP_TIME = 1000ms` to eliminate "spiral-of-death" frame stalls when backgrounded or lagging.
- **`src/core/simulation_cadence.ts`**: Decoupled world simulation systems into 3 tiers:
  - **Tier 1 (Micro / Immediate)**: FOV, actor movement, combat, projectile, and reaction resolution every turn.
  - **Tier 2 (Local Narrative)**: Dialogue delays, NPC thought bubbles, rumor decay on `LOCAL_NARRATIVE_TICK_INTERVAL = 10`.
  - **Tier 3 (Macro / Global)**: Nemesis power struggles (25 turns), villain schemes (50 turns), and world events / schisms (100 turns).
- **`src/types/game-state.types.ts` & `src/core/save.ts`**: Added `lastVisitedTurn` to `AreaData` and persisted it across saves.
- **`src/systems/map.system.ts`**: Implemented area wake delta catch-up: `deltaTurns = Math.max(0, currentTurn - lastVisitedTurn)`. Advances dormant spawn timers and minion agreements in $O(1)$ constant time upon waking without simulating dormant areas turn-by-turn.
- **`src/map/generator_stages.ts`**: Modular map generation pipeline partitioned into 5 testable stages: `resolvePalette`, `carveBaseGeometry`, `carveRoomsAndPortals`, `applyBiomesAndCull`, and `computeHotPathDijkstra`. Resolved ROT.js type ergonomics without unexported namespaces (`ReturnType<InstanceType<typeof ROT.Map.Digger>['getRooms']>[number]`).
- **`src/map/generator_async.ts` & `src/editor/simulation/narrative_fuzzer_async.ts`**: Asynchronous generators yielding stage/turn progress. Protected PRNG seed determinism by snapshotting `ROT.RNG.getState()` and restoring with `ROT.RNG.setState(rngState)` across every yield boundary. Zero yields inside synchronous ROT.js callbacks.
- **`src/types/worker.types.ts`**: Pure serializable JSON DTO request/response schemas for worker communications (`WorkerProgressPayload`, `WorkerResponse`, `SerializableDirectorContext` converting `Set` to plain arrays).
- **`src/worker/fuzzer.worker.ts` & `src/worker/map.worker.ts`**: Dedicated Web Worker scripts executing off-thread simulations and map generation.
- **`src/worker/worker_bridge.ts`**: Offload lifecycle orchestrator with feature detection (`isWorkerAvailable()`) and automatic, transparent fallback to cooperative main-thread generator execution.
- **`src/rendering/ui/loading_overlay.ui.ts` & `src/styles/modals.css`**: DOM controller and CSS styling for `#loading-overlay` progress bar.
- **`docs/ARCHITECTURE.md` & `docs/DECISIONS.md`**: Fully updated with Section 4.7 (Web Worker Offload), Section 5.1 (Modular Generator Stages), Section 5.2 (Area Wake Delta Catch-Up), and Milestone 74 architectural decision records.
- **`docs/MILESTONES.md`**: Milestone 74 marked completed with all 4 checklist items checked.

### 6.2 Telemetry & Profiling Architecture Status
- Engine includes a built-in telemetry store in `src/core/performance.ts` (`perfTracker: { lastTurnTimeMs, lastRenderTimeMs, lastAITimeMs }`).
- Sliced and tracked via `performance.now()` in `game-loop.ts`, `scheduler.ts`, and `session_controller.ts`.
- Toggled on-screen via backtick (<kbd>`</kbd>) in `src/rendering/ui/debug.ui.ts` alongside active field count and the 100-event trigger trace ledger.
- Zero external profiling dependencies; runs 100% browser-agnostically with no `SharedArrayBuffer` / COOP / COEP requirements.

### 6.3 Verification Suite Status
- `bun x tsc --noEmit`: 0 errors.
- `bun run validate:campaigns`: 0 errors, 0 warnings across `default`, `megacampaign`, and `shroudgarde`.
- `bun x vite build`: 12.58s clean build, bundling dedicated worker chunks (`dist/assets/map.worker-*.js`, `dist/assets/fuzzer.worker-*.js`).

---

## 7. Phase 11 — Milestone 75: Gameplay HUD & RTwP Controls Refinements (READY FOR KICKOFF)

### 7.1 Primary Objectives
Enhance tactile responsiveness, situational awareness, and menu management atop the decoupled RTwP event loop.

### 7.2 Checklist Items
1. **Configurable RTwP Auto-Pause Triggers** (`src/core/game-loop.ts`):
   - Driven by simulation event queue inspection.
   - Auto-pause when:
     - Hostile or nemesis entity enters FOV (`GameEventType.EntitySpotted`).
     - Player HP drops below critical threshold (`< 25%`).
     - Detrimental hazards/status effects applied (poison, burn, bleed).
     - Narrative/drama triggers fire.
2. **Centralized Modal ESC-Key Stack Management (LIFO)** (`src/core/input_handler.ts`):
   - Replace scattered ad-hoc `if (event.key === 'Escape')` checks with a unified LIFO modal stack.
   - Automatically track and restore previous pause/unpause state across nested modals (e.g. opening Dossier or Investigation from within Inventory or Settings).
3. **Dynamic Contextual Verb Illumination** (`renderVerbMenu`):
   - Visually illuminate/highlight valid interaction verbs (Talk, Examine, Attack, Disarm, Open/Close) based on adjacent targets and entity tags, removing trial-and-error guesswork.
4. **Investigation UI Filter Chips** (`src/rendering/ui/investigation.ui.ts`):
   - Add filter chips (**Scheme**, **Faction**, **Nemesis**, **Area**) to filter rumors, clues, and leads dynamically without layout reflows.

### 7.3 Open Threads & Architectural Decisions for Milestone 75
- **Open Thread 1 (Auto-Pause Configuration & Persistence):**
  - *Question:* Should auto-pause trigger preferences (e.g., pause on enemy spotted, pause on low HP) live in `GameState` (per-save) or in `UserSettings` (global `localStorage`)?
  - *Recommendation:* Place in `UserSettings` with a typed configuration interface (`AutoPauseSettings { pauseOnEnemySpotted: boolean; pauseOnLowHealth: boolean; lowHealthThresholdPercent: number; pauseOnHazard: boolean; pauseOnNarrative: boolean }`). Sensible defaults should be defined in a constant file.
- **Open Thread 2 (Modal Stack Architecture):**
  - *Question:* Where should the modal stack state live? Inside `input_handler.ts` or in a dedicated `src/core/modal_manager.ts`?
  - *Recommendation:* Extract modal stack management into `src/core/modal_manager.ts` (keeping `input_handler.ts` within the ~250 LOC rule) with explicit `pushModal(mode)`, `popModal()`, `getCurrentModal()`, and `hasModalsOpen()` API.
- **Open Thread 3 (Contextual Verb Evaluation Performance):**
  - *Question:* Should verb availability be pre-calculated in `buildViewportSnapshot()` or evaluated dynamically during `renderVerbMenu()`?
  - *Recommendation:* Keep `renderer.ts` pure dumb. The presentation layer or UI view can inspect adjacent tiles from the snapshot or pass an `AvailableInteractionsDTO` in `ViewportSnapshot`.
- **Open Thread 4 (Kickoff Protocol):**
  - *Rule:* Per `AGENTS.md` 6-step Kickoff Flow, must complete Step 1 (Rules re-affirmation), Step 2 (Source research), and Step 3 (Compile `research_notes.md` artifact) before drafting or implementing code.

### 7.4 Milestone 75 Kickoff Progress & Locked Decisions

**Kickoff status:** Steps 1-5 COMPLETE. Step 6 (implementation) awaiting Gate 2 approval.

- [x] **Step 1 — Rules reaffirmed:** `AGENTS.md` + `docs/ARCHITECTURE.md` reviewed.
- [x] **Step 2 — Research:** Audited `game-loop.ts`, `input_handler.ts` (491 LOC), `verb_menu.ui.ts`, `investigation.ui.ts`, `apply.system.ts`, `settings.ts`, `scheduler.ts`, `presenter.ts`, `events.types.ts`, `map.system.ts`, `action.registry.ts`, `save.ts`, `zod_form_renderer.ts`, and all three campaigns' `status.json`.
- [x] **Step 3 — Research compiled:** `docs/research_notes.md` §9 (incl. §9.8 decisions, §9.9 governance amendment). Gate 1 questions all resolved by the User.
- [x] **Step 4/5 — Plan drafted & enhanced:** `docs/implementation_plan.md` (15 tasks, DTO/schema contracts, integration diffs, Rule 15 Cascading Effects Matrix). **Awaiting Gate 2.**
- [x] **Plan archival:** M74's approved plan moved to `docs/plans/implementation_plan_m74.md` with its stale Gate 2 header corrected to COMPLETED.

**Decisions D1-D7 (User-locked):**

| # | Decision |
| --- | --- |
| D1 | Archive M74 plan, reuse `docs/implementation_plan.md` for M75. |
| D2 | Add a **real** `GameEventType.EntitySpotted` event (Option B). |
| D3 | Add `detrimental: z.boolean().default(false)` to `StatusEffectDefinitionSchema` — **not** a damage heuristic, because detrimental effects need not deal damage (`weakness`, `stun`, `confusion`). |
| D4 | Verb illumination = Interpretation 1 (show all verbs, illuminate valid). |
| D5 | Expose auto-pause toggles in the Settings modal this milestone. |
| D6 | Full LIFO modal nesting + pause-baseline restore. |
| D7 | Investigation chip filter state = module-level transient. |

**Governance change (this milestone):** `AGENTS.md` gained **Golden Rule 15** — map cascading effects in all three directions (upstream / downstream / lateral), triggering on any change to behaviour, ordering, or data shape. Wired into Kickoff Steps 2 and 4 and the After-Code Step 8, plus the workflow mermaid map. This closed a real gap: the prior downstream-only, post-implementation, interface/enum-gated clause would not have caught the `updateExploredTiles` call-site ordering issue.

**Key research findings:**
- `GameEventType.EntitySpotted` and a "negative status applied" event **never existed** — both had to be designed.
- None of the five `switch (event.type)` sites use `assertNever`, so a new event member causes **no** cascading narrowing failures.
- `updateExploredTiles` is called *after* the event drain in `applyIntentWithCost`, so it must be relocated before the drain or spottings surface a turn late.
- `settings.ts` hard-codes its three merged sub-objects in **both** `initSettings` and `updateSettings`; a new `autoPause` object is silently dropped unless both are updated.
- `zod_form_renderer.ts` unwraps `ZodDefault`, so `detrimental` gets an editor checkbox for free.
- All three campaigns share the same 5 statuses; shroudgarde adds `regeneration` (16 definitions total).
- Existing bug found: closing any modal force-unpauses a manually-paused RTwP game (`nextUiMode !== UIMode.Game` formula). Fixed by D6's pause baseline.

### 7.5 Milestone 75 Delivery Record (COMPLETED)

**Gate history:** Gate 1 (research) confirmed via locked decisions D1-D7. Gate 2 approved: *"Regardless, go ahead and implement the milestone please."* Milestone text was corrected first to describe the actual `EntitySpotted` architecture (User directive: *"We should update the milestone text then."*).

**Verification (all clean):**

| Check | Result |
| --- | --- |
| `bun x tsc --noEmit` | 0 errors |
| `bun run validate:campaigns` | 3/3 campaigns, 0 errors, 0 warnings |
| `bun x vite build` | clean, 12.45s (worker chunks intact) |
| `bun run lint` | 0 errors, 69 warnings (all pre-existing `max-lines`/`a11y`) — **no new warnings** from M75 modules |

**Delivered:**

| Area | Files |
| --- | --- |
| Auto-pause constants | `src/constants/autopause.constants.ts` (new, 67 LOC) |
| Auto-pause evaluator | `src/core/auto_pause.ts` (new, 49) + `src/core/auto_pause_signals.ts` (new, 246) |
| Event | `EntitySpotted` in `src/types/events.types.ts` (enum + interface + union) |
| FOV query | `getVisibleHostileEntityIds()` in `src/systems/map.system.ts` |
| Loop wiring | `src/core/game-loop.ts` (FOV refresh moved before drain; `evaluateAutoPause` call) |
| Settings | `autoPause` in `src/core/settings.ts` (interface, defaults, **both** merge paths, `updateAutoPause` with clamping) |
| Modal stack | `src/core/modal_manager.ts` (new, 125) |
| Input decomposition | `src/core/input/modal_input.ts` (132), `inventory_input.ts` (94), `shortcut_input.ts` (68); `input_handler.ts` **491 → 258 LOC** |
| Registry | `src/actions/action.registry.ts` — 8 toggle intents via `toggleModal`/`openModal`/`closeTopModal` (414 → 370) |
| Verb illumination | `VerbOption` in `src/types/intents/interaction.intents.ts`, `getVerbOptionsForTarget`, `verbMenu.verbOptions`, `verb_menu.ui.ts` |
| Status flag | `detrimental` on `StatusEffectDefinitionSchema` + 16 campaign definitions + 5 `ai-prompt-kit` mirrors |
| Investigation chips | `src/constants/investigation_filter.constants.ts` (new, 104), `investigation.ui.ts` (283 → 257), `investigation_filters.ui.ts` (new, 37) |
| Settings UI | auto-pause toggles + threshold in `settings.ui.ts`, `#autopause-container` in `index.html` |
| Styling | `src/styles/modals.css` (+`.chip`, `.chip-toolbar`, `.verb-menu-item.valid/.invalid`, auto-pause rows) |

**Deviations from the approved plan (all documented, none weakening the design):**

1. **`AutoPauseReason` + labels live in constants, not `auto_pause.ts`.** The label map is keyed by the reason union, so keeping the type in `constants/` avoids a `constants → core` upward import.
2. **`NARRATIVE_AUTOPAUSE_EVENTS` moved from constants to `auto_pause_signals.ts`.** Keeps `src/constants/` free of runtime type imports, matching all 14 pre-existing constant files.
3. **`VerbOption` placed in `src/types/intents/interaction.intents.ts`, not `apply.system.ts`.** The plan's location would have forced `types/game-state.types.ts` to import from `systems/` — an upward dependency violation. Caught during implementation by Rule 15 (lateral axis).
4. **Two extra module splits for the ~250 LOC rule:** `auto_pause.ts` → `auto_pause_signals.ts`; `investigation.ui.ts` → `investigation_filters.ui.ts`.
5. **Third input module added:** `shortcut_input.ts` (table-driven game-mode shortcuts) was needed to bring `input_handler.ts` within budget after the modal extraction.
6. **Modal reset hooks live in `src/core/bootstrap.ts`** rather than `session_controller.ts`/`save.ts` — `startNewGame` and `continueGame` are the single choke points and cover all three call sites.
7. **CSS written to `src/styles/modals.css`** — the plan referenced `src/styles.css`, which does not exist (styles are modularised in `src/styles/` and aggregated by `index.css`).
8. **`toggleModal()` helper added** to `modal_manager.ts` so post-load `uiMode`/stack desync closes rather than re-opens.

**Known scope boundary:** sighting evaluation is gated on `EngineMode.RTwP`, so `EntitySpotted` is not emitted in turn-based mode. This matches the milestone's RTwP framing; a future chronicle consumer wanting turn-based sightings would need that guard revisited.

**Manual play-test scenarios:** see `docs/implementation_plan.md` §5 (8 scenarios, including the `detrimental`-vs-damage test with `weakness`/`stun`/`confusion`, the manual-pause-restoration regression, and the doorway/nemesis same-turn ordering check).

---

### 7.6 Milestone 76 Kickoff Progress & Locked Decisions

**Current Status:** Phase 11 — Milestone 76: Campaign Creator & Developer Tooling UX (IMPLEMENTED & VERIFIED)
**Date:** October 30, 2026
**Governance:** AGENTS.md (Golden Rule 15), docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/MILESTONES.md

**Kickoff Flow Status:**
- [x] **Step 1 — Rules reaffirmed:** AGENTS.md Golden Rules reviewed; ~250 LOC threshold, DOM security (Rule 7), downward layering, strict typing.
- [x] **Step 2 — Research:** Audited `zod_form_renderer.ts`, `editor_toolbar.ts`, `editor_workspace.ts`, `area_editor.ts`, `dialogue_editor.ts`, `reference_index.ts`, and bootstrap pathways (`bootstrap.ts`, `session_controller.ts`, `loader.ts`). Identified path dialect discrepancy (dot/bracket/slash), missing `data-field-path` DOM tagging, and hover-only validation popup (`editor_toolbar.ts`).
- [x] **Step 3 — Compile Research Document:** Recorded findings in `docs/research_notes.md` section 10. Gate 1 reviewed and confirmed by User.
- [x] **Step 4 & 5 — Implementation Plan & Code Snippets:** Drafted in `docs/implementation_plan.md` with complete Cascading Effects Matrix across all 4 milestone checklist items.
- [x] **Plan archival:** M75 plan archived to `docs/plans/implementation_plan_m75.md`.

**Locked Decisions (D1-D6):**
- **D1 (Where-Used Surface):** Option B — Global collapsible inspector drawer/dock (`src/rendering/ui/where_used.ui.ts`) driven by cached `ReferenceIndex` (`src/editor/reference_index.ts`, `WeakMap<CampaignData, ReferenceIndex>`).
- **D2 (Diagnostics Affordance):** Option A — Persistent collapsible bottom dock (`src/rendering/ui/validation_panel.ui.ts`) replacing hover popup in `editor_toolbar.ts`; eliminates `.innerHTML` (Rule 7).
- **D3 (Accordion State):** Option B — First level open, nested levels collapsed + module-level `expandedPaths: Set<string>` (`src/rendering/ui/zod_form_renderer.ts`) for DOM replacement survival.
- **D4 (Path Normalization):** Option B — Read-time canonical normalizer (`src/editor/validation_path.ts`: `toFormPath()`) unifying slash/dot/bracket dialects without changing validator assertions.
- **D5 (Playtest Spawning):** Option A — Static maps only with tile walkability check (`area_playtest_menu.ui.ts` + `sessionStorage['editor_playtest_spawn']` in `bootstrap.ts` / `session_controller.ts`).
- **D6 (Rule 7 Scope):** Option A — Strict touch scope on all M76 files/components; zero `.innerHTML` in new/touched code (`where_used.ui.ts`, `validation_panel.ui.ts`, `area_playtest_menu.ui.ts`, accordion sections); untouched legacy canvas UI left intact.

---

### 7.6 Milestone 76 Implementation Record (COMPLETED — Oct 30, 2026)

**Verification suite (all clean):**

| Check | Result |
| --- | --- |
| `bun x tsc --noEmit` | 0 errors |
| `bun x vite build` | Clean (14.24s) |
| `bun run lint` | 0 errors, 69 pre-existing warnings |
| `bun run validate:campaigns` | 3/3 campaigns, 0 errors, 0 warnings |
| `.innerHTML` audit (new/touched M76 files) | Zero matches |

**Delivered modules (all ≤ ~250 LOC):**

| File | LOC (approx) | Purpose /
| `src/editor/validation_path.ts` | ~75 | Canonical path normalizer (`toFormPath`, `isPathPrefix`, `splitPath`, `ancestorPaths`) |
| `src/editor/validation_navigator.ts` | ~90 | Module-level `expandedPaths`, `revealField()`, `expandAncestors()`, `togglePath()`, `collapsePath()` |
| `src/editor/reference_index.ts` | ~150 | Cached `WeakMap` indexer (`buildReferenceIndex`, `queryUsages`, `hasUsage`) |
| `src/rendering/ui/validation_panel.ui.ts` | ~80 | Persistent bottom diagnostics dock (zero `.innerHTML`) |
| `src/rendering/ui/where_used.ui.ts` | ~90 | Global reverse-reference drawer (`createElement` + `textContent` only) |
| `src/rendering/ui/area_playtest_menu.ui.ts` | ~70 | Static-map context menu with walkability check |

**Modified files (strict touch scope — zero `.innerHTML` added, `.innerHTML` removed where touched):**

- `src/rendering/ui/zod_form_renderer.ts` — Accordion sections (`<details>`/`<summary>`), `expandedPaths` sync, `data-field-path` on all field wrappers, descendant error badges in summary; no `.innerHTML`.
- `src/rendering/editor/editor_toolbar.ts` — `renderToolbar()` rebuilt with `createElement` (no `.innerHTML`); hover popup removed; `updateToolbarState()` now feeds errors into `validation_panel.ui.ts` bottom dock.
- `src/rendering/editor/editor_workspace.ts` — Forwards errors to standard form renderers; passes errors to `dialogue_editor` and `area_editor` custom views.
- `src/rendering/ui/dialogue_editor.ts` — `data-field-path` on node containers; minimal validation error display block added; no `.innerHTML` added (legacy usage left untouched per D6).
- `src/rendering/ui/area_editor.ts` — `contextmenu` listener for static maps with `renderPlaytestMenu()`; `sessionStorage` handoff; `editorState` import added; no `.innerHTML` added.
- `src/core/session_controller.ts` — Reads `sessionStorage['editor_playtest_spawn']`, passes optional `spawnOverride` to `startNewGame()`.
- `src/core/bootstrap.ts` — `startNewGame()` extended with `spawnOverride?: { areaId; x; y }`; spawn coordinates and area ID overridden when present; `SpawnOverride` interface exported.

**Cross-cutting integrations:**

- `docs/research_notes.md` §10.8 — D1-D6 locked (verified).
- `docs/DECISIONS.md` §10.8 — M76 architectural rationale (lines 125-132, verified).
- `docs/implementation_plan.md` — Complete M76 plan with Cascading Effects Matrix (§2), 13 step tasks (§3), module budget (§5), verification scenarios (§6), post-implementation checklist (§7); M75 plan archived to `docs/plans/implementation_plan_m75.md`.
- `docs/MILESTONES.md` — M76 checklist updated (4/4 checked).
- `docs/ARCHITECTURE.md` — M76 design notes already present (§10.8 of research notes); no architecture violation (downward dependency graph preserved).

**Deviations from approved plan:**
None. All 6 decisions (D1-D6) implemented exactly as approved. Module sizes within budget. Zero `.innerHTML` in all new and directly modified components. Untouched legacy UI (`dialogue_editor.ts` existing `.innerHTML` blocks, `area_editor.ts` existing `.innerHTML` painter setup) left intact per strict touch scope (D6).
