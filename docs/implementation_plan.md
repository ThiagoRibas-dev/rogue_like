# Implementation Plan — Turn & Render Loop Performance Optimization

## 1. Overview of Planned Changes

Based on the live telemetry analysis in `./docs/research_notes.md`, we will implement five targeted, deterministic optimizations across Tier 1 (`src/core/`, `src/rendering/`) and Tier 2 (`src/rulesets/dnd35e/`):

1. **Cross-State & Budget-Resilient `evaluateDnD35eEntityDAG` Memoization (`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`)**:
   - Key the entity DAG cache by `CampaignData` (`WeakMap<object, Map<EntityId, CachedEntityDAGEntry>>`) instead of top-level `GameState` identity so that component mutations on one entity do not evict cached DAG evaluations for all other entities.
   - Fingerprint the entity's DAG-relevant inputs (actor/fighter/overlay/tags/doctrine/status/equipment component refs, equipped item component refs, structural `DnD35EntityData` fields excluding transient `actionBudget` and `flankingRelations`, area environment/phase, tile illumination reading, and active field aura refs) so `actionBudget` and `flankingRelations` updates do not force a full 4-stage DAG recomputation.
   - Return `{ ...cached.result, dndData }` on a cache hit so callers always receive the latest `dndData` (including up-to-date `actionBudget` and `flankingRelations`).

2. **Spatial Reach Pre-Filtering & Movement-Step Fast-Skip for `syncSpatialFlankingGraph` (`src/rulesets/dnd35e/spatial/flanking_graph.ts` & `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`)**:
   - In `syncSpatialFlankingGraph(state)`:
     - Collect lightweight combatant spatial entries (`id`, `pos`, `data`, `reachFt`) first **without** projecting semantic tags.
     - Only project `resolveEntitySituationalTagContext` + `projectDnD35ActorSemanticTags` lazily for combatants that are within melee reach of at least one hostile combatant.
   - In `onDnD35eActorMovementStep`:
     - Only invoke `syncSpatialFlankingGraph` if the moving actor had active `flankingRelations` prior to moving OR if another living combatant is within `MAX_FLANKING_REACH_CHECK_TILES` (`6` tiles = `30 ft`) of `_fromPos` or `toPos`.

3. **Eliminate Redundant Second `applyIntentWithCost(Wait)` After Intra-Turn AI Actions (`src/core/game-loop.ts`)**:
   - In `processTurn`, when an AI actor has already executed at least one intra-turn action (`intraTurnActionCount > 0`) and `processAITurn` returns `intent: null` (no further actions to take this round), settle the actor's remaining round energy via `concludeSkippedTurn(aiTurnState, entityId)` + `processHungerTick` instead of dispatching a second full `applyIntentWithCost(Wait)` pipeline.

4. **Viewport- & Player-Scoped Dirty-Domain Diffing (`src/core/presentation_queue.ts` & `src/rendering/presenter.ts`)**:
   - In `markDirtyFromStateDiff(prev, next)`:
     - When `prev.components !== next.components` or `prev.spatialIndex !== next.spatialIndex` (with `prev.entities === next.entities` and `prev.cachedFov === next.cachedFov`):
       - Only mark `PresentationDomain.HUD` and `PresentationDomain.Inventory` dirty if the player entity's component map, a player inventory/equipped item's component map, or a visible/companion entity's component map changed.
       - Only mark `PresentationDomain.Entities` dirty if `next.map.isFullyExplored` is true, `prev.spatialIndex !== next.spatialIndex` on any tile in `next.cachedFov`, or any entity currently visible in `next.cachedFov` (or previously visible in `prev.cachedFov`) changed its `ComponentMap` reference.
   - In `renderPresenterFrame` (`src/rendering/presenter.ts`):
     - Only invoke `renderMenus(state, hasSaveGame())` inside the `PresentationDomain.HUD` block when `state.uiMode !== UIMode.Game`.

5. **Remove Redundant Synchronous `saveCheckpoint` on Every 5-ft Player Step (`src/core/game-loop.ts`)**:
   - Remove the synchronous `saveCheckpoint(nextState)` call right after `updateState(nextState)` in `processTurn` (since `updateState` already triggers `scheduleDebouncedSave(nextState)` during `UIMode.Game` and `saveCheckpoint` on area transitions/game-over).

---

## 2. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters) | Downstream (Consumers / Derived State) | Lateral (Tests / Sibling Systems / Telemetry) |
| :--- | :--- | :--- | :--- |
| **1. Cross-state & budget-resilient `evaluateDnD35eEntityDAG` cache** | `computeDnD35eEffectiveStats`, `hydrateEntityRoundActionBudget`, `computeActorTacticalLandSpeedFt`, combat/maneuver/skill resolvers, UI projectors | `DnD35EntityDAGResult` consumers receive identical computed stats and fresh `dndData` (`{ ...cached.result, dndData }`) | `tests/determinism_replay.test.ts`, `tests/dnd35e_*.test.ts` — 100% deterministic parity |
| **2. Spatial reach pre-filtering in `syncSpatialFlankingGraph` & step check** | `onDnD35eActorTurnStart`, `onDnD35eActorMovementStep` in `dnd35e_lifecycle_adapter.ts` | `dndData.flankingRelations`, `'flanking'` and `'flanked'` status effects in `StatusEffectsComponent` | `tests/dnd35e_combat_maneuvers.test.ts` and flanking tests |
| **3. Settle post-action AI `null` intent via `concludeSkippedTurn`** | `processTurn` in `src/core/game-loop.ts` when `intraTurnActionCount > 0` and `intent === null` | `resolveActorActionEnergyCost(Wait)` clears `actionBudget` and returns `energyCost: 100` (scaled by speed); `processHungerTick` ticks once per round | Reduces `turnCount` in `perfTracker` by eliminating synthetic no-op `Wait` turns after AI `Move` |
| **4. Scoped dirty-domain diffing in `markDirtyFromStateDiff`** | `updateState` in `src/core/game-loop.ts` | `renderPresenterFrame` in `src/rendering/presenter.ts` skips redundant off-screen `Entities` / `HUD` / `Inventory` redraws | `scripts/diagnose_render.ts`, `tests/` — UI & canvas still redraw immediately whenever any visible entity or player/companion/item state changes |
| **5. Debounced save on intra-round player steps** | `processTurn` in `src/core/game-loop.ts` | `persistenceService.scheduleDebouncedSave` (already called in `updateState`) | `beforeunload` listener in `session_controller.ts` still flushes pending saves immediately |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / Engine Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **DAG Cache Validation** | Hardcoding specific feat/item IDs to decide whether to invalidate the cache | Structural reference equality on ECS component maps (`Fighter`, `Actor`, `PropertyOverlay`, `Tags`, `TacticalDoctrine`, `StatusEffects`, `Equipment`, equipped items, active `Field` components) + `DnD35EntityData` fields + tile light reading | **Yes** — any new JSON feat, item, race, condition, or spell field mutates the relevant component or `DnD35EntityData` field and invalidates the cache automatically |
| **Lazy Tag Projection in Flanking Graph** | Checking specific creature template IDs for reach or solo-flanking | Computing max natural/weapon reach from `SIZE_METRICS[data.sizeCategory]` + `MAX_FLANKING_REACH_CHECK_TILES` (`6` tiles = `30 ft`, covering Colossal reach + reach weapons) before projecting tags | **Yes** — works identically for all creature sizes and custom templates |
| **Dirty Domain Scoping** | Skipping dirty checks for hardcoded AI profile IDs | Checking `cachedFov` visibility and player/companion/inventory `EntityId` ownership generically via ECS components | **Yes** — completely ruleset- and content-agnostic |

---

## 4. Detailed Step-by-Step Code Changes

### Step 1: Cross-State & Budget-Resilient `evaluateDnD35eEntityDAG` Cache (`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`)

Instead of keying `defaultEntityDagCache` by `GameState` and `entityMapRef` (which misses whenever *any* other entity mutates or whenever `actionBudget` / `flankingRelations` changes on the actor), we key by `state.campaign` (`WeakMap<object, Map<EntityId, CachedEntityDAGEntry>>`) and validate a lightweight structural signature:

```ts
interface CachedEntityDAGEntry {
  readonly fighterRef: unknown;
  readonly actorRef: unknown;
  readonly overlayRef: unknown;
  readonly tagsRef: unknown;
  readonly doctrineRef: unknown;
  readonly statusRef: unknown;
  readonly equipmentRef: unknown;
  readonly equippedItemsKey: string;
  readonly dndDataStructuralKey: string;
  readonly envKey: string;
  readonly result: DnD35EntityDAGResult | undefined;
}

const campaignEntityDagCache = new WeakMap<object, Map<EntityId, CachedEntityDAGEntry>>();
```

Where:
- `dndDataStructuralKey` compares the DAG-relevant references on `dndData` (`abilityScores`, `tracks`, `feats`, `skillRanks`, `conditions`, `statModifiers`, `suppressedBundleIds`, `sizeCategory`, `armorBonus`, `shieldBonus`, `naturalArmorBonus`, `subtypes`, `equipmentSlots`, `naturalWeapons`, `lightExposure`), explicitly ignoring `actionBudget` and `flankingRelations`.
- `equippedItemsKey` concatenates `slot.equippedItem` IDs and verifies their `state.components.get(itemId)` references.
- `envKey` combines `state.currentAreaId`, the diurnal phase (`resolveAreaEnvironmentProfile(state).clock.phaseId`), the actor's tile light reading (`resolveTileLightReading(state, pos.x, pos.y)`), and any active `FieldComponent` entity references in `state.entities`.
- On a cache hit, `evaluateDnD35eEntityDAG` returns `{ ...cached.result, dndData }` so `result.dndData` always reflects the exact current `DnD35EntityData` instance.

---

### Step 2: Spatial Reach Pre-Filter in `syncSpatialFlankingGraph` (`src/rulesets/dnd35e/spatial/flanking_graph.ts` & `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`)

1. In `src/rulesets/dnd35e/spatial/flanking_graph.ts`:
   - Define `MAX_TACTICAL_REACH_MULTIPLIER = 2` (accounting for reach weapons / lunging on top of `SIZE_METRICS` natural reach).
   - First gather lightweight combatant records (`id`, `pos`, `data`, `maxReachFt`) without calling `resolveEntitySituationalTagContext` or `projectDnD35ActorSemanticTags`.
   - Create a lazy `getCombatantTags(c)` helper memoized in a local `Map<EntityId, ReadonlyArray<string>>` so semantic tags are **only** projected for combatants that are actually within `maxReachFt` of a hostile combatant!

```ts
  const rawCombatants: Array<{
    readonly id: EntityId;
    readonly pos: PositionComponent;
    readonly data: DnD35EntityData;
    readonly maxReachFt: number;
  }> = [];

  for (const id of state.entities) {
    const fighter = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
    const pos = getComponent(state, id, ComponentType.Position) as PositionComponent | undefined;
    if (!fighter || fighter.hp <= 0 || !pos) continue;
    const data = getDnD35EntityData(state, id);
    const baseReachFt = SIZE_METRICS[data.sizeCategory ?? 'medium']?.naturalReachTallFt ?? FEET_PER_GRID_SQUARE;
    rawCombatants.push({ id, pos, data, maxReachFt: Math.max(FEET_PER_GRID_SQUARE * 2, baseReachFt * 2) });
  }

  const tagsCache = new Map<EntityId, ReadonlyArray<string>>();
  const getTags = (c: (typeof rawCombatants)[number]): ReadonlyArray<string> => {
    const cached = tagsCache.get(c.id);
    if (cached !== undefined) return cached;
    const sit = resolveEntitySituationalTagContext(state, c.id, c.data);
    const rawTags = (getComponent(state, c.id, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
    const statusTags = getActiveStatusIds(state, c.id).map((s) => `status:${s}`);
    const projected = projectDnD35ActorSemanticTags(
      c.data,
      [...rawTags, ...statusTags],
      sit,
      sysContent?.classes,
      sysContent?.skills,
      sysContent?.domains,
      sysContent?.feats,
      sysContent?.conditionEffects
    );
    tagsCache.set(c.id, projected);
    return projected;
  };
```

   - In the pair loop (`for (const atk of rawCombatants) for (const def of rawCombatants)`), check `measureFootprintToFootprintDistanceFt(...) <= atk.maxReachFt` **before** calling `getTags(atk)` / `getTags(def)` and `evaluateEntityFlankingTarget`!

2. In `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`:
   - In `onDnD35eActorMovementStep`:
     - Only call `syncSpatialFlankingGraph(nextState)` if the mover had non-empty `flankingRelations` or if any other living `Fighter` is within `MAX_FLANKING_STEP_CHECK_RADIUS_TILES = 12` (`60 ft`, covering Colossal footprints + 30 ft reach) of `_fromPos` or `toPos`.

---

### Step 3: Settle Post-Action AI `null` Intent Without a Second `applyIntentWithCost(Wait)` (`src/core/game-loop.ts`)

In `src/core/game-loop.ts` (lines 259–303):
- When `intent === null` and `intraTurnActionCount > 0` (the AI actor already executed at least one intra-turn action such as a 5-ft `Move` and now wants to end its turn):
  - Instead of calling `applyIntentWithCost(aiTurnState, { type: IntentType.Wait, entityId })` (which runs `resolveStateStabilization`, `processInvestigationEvents`, `processTier2LocalCadence`, `updateExploredTiles`, `evaluateAutoPause`, and `recordTurnSample` a second time), call `resolveActorActionEnergyCost` directly (via a helper `settleRemainingActorTurn(aiTurnState, entityId)`) to clear `actionBudget`, scale `energyCost` by actor speed, and run `processHungerTick`:

```ts
function settleRemainingActorTurn(
  state: GameState,
  entityId: EntityId
): { readonly state: GameState; readonly energyCost: number } {
  const waitCost = resolveActorActionEnergyCost(
    state,
    { type: IntentType.Wait, entityId },
    DEFAULT_ACTOR_TURN_DURATION
  );
  let energyCost = waitCost.energyCost > 0 ? waitCost.energyCost : DEFAULT_ACTOR_TURN_DURATION;
  const actor = getComponent(waitCost.state, entityId, ComponentType.Actor);
  if (actor) {
    const stats = getEffectiveStats(waitCost.state, entityId);
    const speed = Math.max(1, stats.speed);
    energyCost = Math.max(1, Math.round((energyCost * 100) / speed));
  }
  return { state: waitCost.state, energyCost };
}
```

- Furthermore, when `intent !== null`, if `result.success && result.energyCost === 0`, only record `recordAISample` when `intent !== null` or when `intraTurnActionCount === 0`, so idle continuation checks do not pollute `recentAISamples` with `"none"` entries after every single move.

---

### Step 4: Scoped Dirty-Domain Diffing (`src/core/presentation_queue.ts` & `src/rendering/presenter.ts`)

1. In `src/core/presentation_queue.ts`:
   - Add helper functions to check whether `prev.components !== next.components` affected:
     - **Viewport-visible entities (`hasVisibleEntityMutation`)**:
       - Returns `true` if `prev.entities !== next.entities`, `prev.cachedFov !== next.cachedFov`, `next.map.isFullyExplored`, or if any entity whose current (`next`) or prior (`prev`) position falls within `next.cachedFov` had its `state.components.get(id)` reference change.
     - **HUD / Player-relevant entities (`hasHudOrInventoryMutation`)**:
       - Returns `true` if `prev.entities !== next.entities`, or if the player entity's `ComponentMap` changed, any item in the player's `Inventory` / `Equipment` changed, any active `Field` changed, or any visible entity in `next.cachedFov` changed.
   - Use these two helpers inside `markDirtyFromStateDiff`:
     ```ts
     if (
       prev.components !== next.components ||
       prev.entities !== next.entities ||
       prev.spatialIndex !== next.spatialIndex
     ) {
       if (hasVisibleEntityMutation(prev, next)) {
         this.markDirty(PresentationDomain.Entities);
       }
       if (hasHudOrInventoryMutation(prev, next)) {
         this.markDirty(PresentationDomain.HUD);
         this.markDirty(PresentationDomain.Inventory);
       }
       if (next.uiMode === UIMode.CartridgeModal || next.uiMode === UIMode.Inventory) {
         this.markDirty(PresentationDomain.Modals);
       }
     }
     ```

2. In `src/rendering/presenter.ts`:
   - Inside `if (dirtyDomains.has(PresentationDomain.HUD))`:
     ```ts
     if (state.uiMode !== UIMode.Game) {
       renderMenus(state, hasSaveGame());
     }
     ```

---

### Step 5: Remove Redundant Synchronous `saveCheckpoint` on Intra-Round Player Steps (`src/core/game-loop.ts`)

In `src/core/game-loop.ts:208-211`:
```ts
if (nextState !== state) {
  updateState(nextState);
}
```
(`updateState` already invokes `scheduleDebouncedSave(newState)` when `newState.uiMode === UIMode.Game` and `saveCheckpoint(newState)` when `prevState.currentAreaId !== newState.currentAreaId`.)

---

## 5. Verification Plan

1. Execute `./verify.sh` across all 8 verification stages (`tsc --noEmit`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `build`, `run-validator.ts`).
2. Verify determinism replay parity (`bun test tests/determinism_replay.test.ts`) and all D&D 3.5e combat/flanking/day-night tests.
3. Play-test in `dnd35e-crypt` (`outer_crossroads`) and inspect the live `~` debug overlay and exported telemetry JSON to confirm:
   - Player and NPC `Move` turn times drop from `10–33ms` down to `< 2ms`.
   - Off-screen NPC turns no longer trigger redundant `HUD` / `Inventory` / `Entities` dirty redraws or double `Move + Wait` turn samples.
