# Research Notes — Telemetry Performance Audit & Turn/Render Loop Optimization

## 1. Objective & Telemetry Evidence

We analyzed two live diagnostic telemetry exports captured in `dnd35e-crypt` (`outer_crossroads`, Turn-Based mode, `28` active actors, `190` live entities, `0` active fields):
1. `roguelike_telemetry_dnd35e-crypt_turn4906_27bedab5.json` (`globalTurn: 4906`)
2. `roguelike_telemetry_dnd35e-crypt_turn4912_2d8aef38.json` (`globalTurn: 4912`, captured `21.8s` later)

Across just **6 global player rounds** (`4906 -> 4912`), the telemetry counters recorded:
- **`turnCount` delta**: `+339` resolved `applyIntentWithCost` executions (`4340 -> 4679`, or **`56.5` turns per round** for `28` actors).
- **`aiCallCount` delta**: `+264` `processAITurn` invocations (`3434 -> 3698`, or **`44` AI calls per round**).
- **`schedulerSliceYields` delta**: `+157` cooperative 4ms slice yields (`2362 -> 2519`, or **`26` yields per round**).
- **`domainDirtyMarkCounts` delta**:
  - `Map`: `+52` (`589 -> 641`)
  - `HUD`: **`+547`** (`6841 -> 7388`)
  - `Inventory`: **`+533`** (`6618 -> 7151`)
  - `Entities`: **`+531`** (`6581 -> 7112`)
- **`renderFrameCount` delta**: `+147` rendered presenter frames (`2223 -> 2370`), the vast majority of which had `dirtyDomains: ["Entities", "HUD", "Inventory"]`, `drawCalls: 0`, and cost **`5.0–23.3 ms`** per frame (`snapshotBuildMs: 2.5–15.1 ms`, `overlaysMs: 1.0–6.9 ms`, `hudDomainMs: 1.5–12.6 ms`).
- **Per-Turn Spikes (`recentTurnSamples`)**:
  - Idle off-screen NPC `Wait` intents took `0.1–0.5 ms`.
  - However, every `Move` intent (`dispatchActionMs`) took **`5.0–33.6 ms`** (e.g. Player `#12`: `32.8 ms`, `16.9 ms`, `14.7 ms`; NPC `#149`: `17.8 ms`; NPC `#34`: `12.7 ms`; NPC `#46`: `11.5 ms`).
  - Furthermore, NPCs that moved 1 tile (`#34, #40, #44, #46, #75, #81, #102, #107, #113, #118, #125, #131, #139, #149`) immediately executed a second `Wait` turn costing up to **`4.8 ms`** (`dispatchActionMs: 4.7 ms` on a no-op `Wait`).

---

## 2. Root-Cause Analysis by Subsystem

### Bottleneck 1: `evaluateDnD35eEntityDAG` Cache Thrashing Across Entities & Intra-Turn Budget Mutations
- **Location**: `src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts:70-108`
- **Mechanism**:
  - `defaultEntityDagCache` is currently `new WeakMap<GameState, Map<EntityId, CachedEntityDAGEntry>>()`.
  - Because `GameState` is immutable, **every** `addComponent` call on **any** entity creates a new top-level `GameState` reference (`{ ...state, components }`). Consequently, when NPC `#34` moves or ticks hunger, the `WeakMap<GameState, ...>` loses the cached DAG entries for the Player (`#12`) and all other `27` actors, even though their `state.components.get(entityId)` (`entityMapRef`) references are 100% identical!
  - Even worse, for the acting entity itself, `onDnD35eActorTurnStart`, `finalizeBudgetAfterAction` (on every 5-ft step), `clearBudgetAndEndRound` (on `Wait`), and `syncSpatialFlankingGraph` call `setDnD35EntityData(state, entityId, { ...dndData, actionBudget })`, which creates a new `RulesetDataComponent` and a new `entityMapRef` for that actor.
  - Because `entityMapRef` changed, `evaluateDnD35eEntityDAG` suffers a cache miss on every 5-ft step and on the subsequent `Wait` (`intent_cost_resolver.ts:62` calls `getEffectiveStats` -> `evaluateDnD35eEntityDAG` just to read `stats.speed`!), even though **`evaluateDnD35eEntityDAGInternal` never reads `dndData.actionBudget` or `dndData.flankingRelations`**.

### Bottleneck 2: Unpruned `O(N²)` All-Pairs Flanking Graph & Eager Tag Projection on Every 5-ft Step
- **Location**: `src/rulesets/dnd35e/spatial/flanking_graph.ts:279-372` and `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts:158, 207`
- **Mechanism**:
  - `syncSpatialFlankingGraph(state)` is invoked at every actor's `turn_start` AND on every single 5-ft movement step (`onDnD35eActorMovementStep`).
  - At the top of `syncSpatialFlankingGraph` (lines 288–307), it iterates over all `28` living combatants and unconditionally executes `resolveEntitySituationalTagContext(state, id, data)` + `projectDnD35ActorSemanticTags(...)` for all `28` combatants before checking whether any two hostile combatants are even near each other.
  - It then runs an `O(N²)` nested loop (`28 × 28 = 784` pairs), and inside `evaluateEntityFlankingTarget` scans all `190` entities (`O(N³)`) for threatening allies.
  - In `outer_crossroads`, where 12 wandering NPCs take 1 step and the player takes 6 steps per round, `syncSpatialFlankingGraph` runs ~46 times per round (~1,288 full equipment/light/feat/skill tag projections per round) even when no hostile actors are within melee reach of the mover.

### Bottleneck 3: Double `applyIntentWithCost` (`Move` + `Wait`) for Wandering AI Actors
- **Location**: `src/core/game-loop.ts:255-303` and `src/ai/wander.behavior.ts:23-41`
- **Mechanism**:
  - When an idle NPC runs `wanderBehavior`, it emits a 1-step `MoveIntent`.
  - In `dnd35e` Turn-Based mode, a single 5-ft step consumes `5 ft` of `movementRemainingFt` (`30 ft -> 25 ft`), leaving `standardRemaining: 1`. Thus `resolveDnD35eActionEnergyCost` returns `energyCost: 0`.
  - `processTurn` (`game-loop.ts:270-276`) sees `result.success && result.energyCost === 0`, calls `updateState(result.state)` (marking `Entities`, `HUD`, `Inventory` dirty), and calls `setTurnDuration(0)` to re-schedule the same NPC immediately.
  - On the immediate continuation call, `wanderBehavior` checks `if (hasActorActedThisTurn(state, entityId)) return null;`, so `processAITurn` returns `intent: null`.
  - `processTurn` (`line 294`) then calls `applyIntentWithCost(aiTurnState, { type: IntentType.Wait, entityId })`, which executes a **second full turn pipeline** (`dispatchAction`, `resolveActorActionEnergyCost`, `getEffectiveStats`, `resolveStateStabilization`, `processInvestigationEvents`, `processTier2LocalCadence`, `updateExploredTiles`, `evaluateAutoPause`, `recordTurnSample`, and `updateState`) for a no-op end-of-turn!
  - When `intraTurnActionCount > 0` and `processAITurn` returns `intent: null`, the actor has already completed its intra-turn actions; settling the remaining round budget only requires `concludeSkippedTurn(aiTurnState, entityId)` + `processHungerTick`, not a second `applyIntentWithCost(Wait)`.

### Bottleneck 4: Coarse Dirty-Domain Diffing on Off-Screen NPC Mutations (`Entities`, `HUD`, `Inventory`)
- **Location**: `src/core/presentation_queue.ts:111-122` and `src/rendering/presenter.ts:164-184`
- **Mechanism**:
  - `markDirtyFromStateDiff` checks:
    ```ts
    if (prev.components !== next.components || prev.entities !== next.entities || prev.spatialIndex !== next.spatialIndex) {
      this.markDirty(PresentationDomain.Entities);
      this.markDirty(PresentationDomain.HUD);
      this.markDirty(PresentationDomain.Inventory);
    }
    ```
  - Because `processHungerTick` and `actionBudget` updates mutate `state.components` for **every** off-screen NPC, and `scheduler.ts` yields to the browser every `4ms` (`FRAME_BUDGET_MS`), the 60Hz presenter wakes up between AI slices and sees `Entities`, `HUD`, and `Inventory` marked dirty:
    - `Entities` dirty triggers `buildViewportSnapshot` (`~2.8ms`) + `renderTacticalOverlay` (`~1.4ms`) even when `prev.cachedFov === next.cachedFov` and **zero** entities inside `cachedFov` changed (`drawCalls: 0`).
    - `HUD` & `Inventory` dirty triggers `renderPlayerStats`, `updateHUD`, `renderHudBottomDock`, `renderCartridgeHudPanel`, `renderInventoryPanel`, and `renderMenus(state, hasSaveGame())` (`~2–4ms`) even when the **player's** components, equipped items, companions, `globalTurn`, and `uiMode` did not change at all!
    - Additionally, `renderMenus(state, hasSaveGame())` inside `PresentationDomain.HUD` (`presenter.ts:182`) reads `localStorage.getItem('roguelike_save_v1')` on every HUD redraw even while `state.uiMode === UIMode.Game`.

### Bottleneck 5: Synchronous `saveCheckpoint` on Every Intra-Round Player Step
- **Location**: `src/core/game-loop.ts:208-211`
- **Mechanism**:
  - In `processTurn`:
    ```ts
    if (nextState !== state) {
      updateState(nextState);
      saveCheckpoint(nextState);
    }
    ```
  - `updateState(nextState)` (`line 87`) already calls `scheduleDebouncedSave(newState)` (500ms debounce).
  - Immediately calling `saveCheckpoint(nextState)` on line 210 cancels the debounced save and executes a synchronous `JSON.stringify(serializeGameState(nextState))` + `localStorage.setItem` on **every single 5-ft step** the player takes (`6` times per round).

---

## 3. Architectural Compliance & Governing Rules

- **Rule 11 & 12 (No `any`, No Magic Values)**: All cache structures, spatial reach constants, and dirty-diff helpers must use strict types and named constants.
- **Rule 15 (Three-Axis Cascading Effects)**:
  - **Upstream**: `processTurn`, `applyIntentWithCost`, `onDnD35eActorTurnStart`, `onDnD35eActorMovementStep`, `markDirtyFromStateDiff`.
  - **Downstream**: `evaluateDnD35eEntityDAG` consumers (`computeDnD35eEffectiveStats`, combat resolvers, UI projectors), `renderPresenterFrame`, `StatusEffectsComponent` (`flanking` / `flanked` statuses), `persistenceService`.
  - **Lateral**: Determinism replay tests (`tests/determinism_replay.test.ts`), flanking tests, turn budget tests, and performance telemetry metrics (`perfTracker`).
- **Rule 16 (Three-Tier Placement Heuristic)**:
  - Tier 1 (`src/core/`): `game-loop.ts`, `presentation_queue.ts`, `presenter.ts`.
  - Tier 2 (`src/rulesets/dnd35e/`): `dnd35e_dag_adapter.ts`, `flanking_graph.ts`, `dnd35e_lifecycle_adapter.ts`.
- **Rule 20 (Three-Horizon Computation Boundaries)**:
  - Memoizing `evaluateDnD35eEntityDAG` across `GameState` transitions must respect Horizon 2 (structural `dndData` fields) and Horizon 3 (live equipment slot item references, `PropertyOverlay`, `StatusEffects`, `TacticalDoctrine`, active `Field` auras, area environment/diurnal phase, and tile illumination reading) while ignoring transient round-tracking fields (`actionBudget`, `flankingRelations`) that have zero effect on the DAG output.
- **Rule 21 (Zero Content-ID Branching)**: All optimizations are purely structural/algorithmic and introduce zero content-ID branches.
