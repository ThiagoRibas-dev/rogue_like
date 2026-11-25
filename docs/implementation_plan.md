# Phase 47 Implementation Plan — Active-Chunk Cellular Physics, Terrain Sculpting & RimWorld/DF Agent Substrate

**Milestones:** 180, 181, 182, 183 (`docs/MILESTONES.md` §Phase 47)  
**Confirmed Research Basis:** `docs/research_notes.md` (Option A confirmed across all 4 architectural decisions)  
**Baseline Commit:** `7244b92ba` (`main`, Phase 46 complete — 441 tests passing, 8/8 `verify.sh` green)

---

## 0. Architectural Decisions Locked In

1. **Unified Finite & Streaming Physics Backing (Option A):** Support cellular fluid depth (`1/7..7/7`), cell temperature (`Int16` °C), and material IDs across **both** `streaming_overworld` (`WorldChunk` SoA planes) and finite maps (`GameMap.tiles`/`zSlices`) via a lazy, sparse `FinitePhysicsOverlay` stored on `GameMap` (only instantiated when a finite map receives fluid/thermal writes, keeping untouched maps at 0 bytes and 0 CPU overhead).
2. **Psychology Component Ownership (Option A):** Add `NeedsComponent` (`ComponentType.Needs`, syncing `nourishment` with `HungerComponent`) and extend `MemoryComponent` + `Thought` in-place with mood tiers, decaying/stacking thoughts, inspirations, and mental breaks — preserving 100% compatibility with `personality.system.ts`, `gossip.system.ts`, `dialogue.actions.ts`, and `ai.system.ts`.
3. **Declarative Rules Registries (Option A):** Add optional `materials`, `blueprints`, `craftingRecipes`, and `psychology` sections inside `RulesConfigSchema` (`src/types/campaign/meta.ts`) with sensible engine defaults so all 5 sibling campaigns validate cleanly without mandatory new JSON files.
4. **Phase 47 vs. Phase 48 UI Scope (Option A):** Render cellular fluid depth (`1/7..7/7`), designation markers, and stockpile tints on the canvas (`viewport_snapshot.ts`), expose fluid/°C/mood/needs/job details in `inspect_tooltip.ts`, wire player `mine`/`chop`/`build`/`craft` verbs via `ApplyIntent`, and showcase M180–M183 in `default`. Reserve full Colony/Fortress interactive management HUD modals for **Phase 48**.

---

## 1. SSOT Ownership & New Module Registry Table

All new TypeScript modules will be registered in `docs/ssot/ssot_console.json` (Tier 1) or `docs/ssot/ssot_dnd35e.json` (Tier 2), followed by `bun scripts/map-codebase.ts` so `scripts/run-validator.ts` `[8/8]` achieves 100% SSOT parity.

| New / Extended Module | Tier | Canonical Ownership (Includes / Excludes) | Canonical Entry Points |
| :--- | :--- | :--- | :--- |
| `src/map/material_palette.ts` *(NEW)* | `tier1_console` | Deterministic flyweight `MaterialPaletteRegistry` (`Uint16Array` index <-> `materialId`). Excludes terrain mutation. | `buildMaterialPaletteRegistry`, `getMaterialIdFromPaletteIndex`, `getPaletteIndexForMaterialId` |
| `src/map/structural_support.ts` *(NEW)* | `tier1_console` | Bounded-span connected support BFS (`MAX_SUPPORT_SPAN_TILES`) and cave-in collapse resolution. Excludes crafting/mining verbs. | `evaluateStructuralSupport`, `resolveCaveInAroundVoxel` |
| `src/systems/physics/fluid_physics.ts` *(NEW)* | `tier1_console` | Bit-packed `fluid: Uint8Array` helpers (`depth 0..7`, `FluidKind`), dirty-chunk fluid cellular automaton (vertical spillover, horizontal equalization, obsidian/steam/ice/oil phase transitions). Excludes rendering. | `packFluidCell`, `unpackFluidCell`, `processDirtyFluidChunks`, `applyFluidToVoxel` |
| `src/systems/physics/temperature_physics.ts` *(NEW)* | `tier1_console` | Dirty-chunk 3D heat diffusion toward ambient °C, thermal coupling with `magma` and `FieldComponent` heat/cold sources, auto-sleep clearing. Excludes rendering. | `processDirtyTemperatureChunks`, `applyHeatDeltaToVoxel` |
| `src/systems/physics/chunk_catchup.ts` *(NEW)* | `tier1_console` | Closed-form $O(N)$ analytical sleep catch-up on chunk wake / area wake / bulk time skip (temperature relaxation, shallow evaporation, burnout, spoilage/growth). Excludes per-turn loops. | `applyAnalyticalChunkCatchUp`, `applyAnalyticalActiveGridCatchUp` |
| `src/systems/construction.system.ts` *(NEW)* | `tier1_console` | Runtime voxel sculpting (`sculptTerrainVoxel`), mining (`mineTerrainTile`), material-consuming construction (`constructTerrainTile`), and timed spell terrain reverts (`tickTimedTerrainReverts`). Excludes AI planning. | `sculptTerrainVoxel`, `mineTerrainTile`, `constructTerrainTile`, `scheduleTimedTerrainRevert`, `tickTimedTerrainReverts` |
| `src/systems/psychology/needs.system.ts` *(NEW)* | `tier1_console` | Universal actor need meters (`rest`, `nourishment`, `shelter`, `comfort`, `social`, `safety`), environmental satisfaction evaluation, `HungerComponent` sync, and threshold thought emission. Excludes combat math. | `createDefaultNeedsComponent`, `processActorNeedsTick`, `satisfyActorNeed` |
| `src/systems/psychology/thoughts.system.ts` *(NEW)* | `tier1_console` | Decaying/stacking thought management, facet-weighted mood aggregation, `MoodTier` classification, Inspiration & Mental Break triggering/expiration. Excludes dialogue trees. | `addTimedThought`, `recalculateActorMood`, `processActorPsychologyTick`, `resolveActorMoodModifiers` |
| `src/types/colony.types.ts` *(NEW)* | `tier1_console` | Pure JSON-serializable data shapes for `ColonySimulationState` (designations, stockpiles, reservations, workshops, timed terrain reverts, labor profiles). Excludes runtime logic. | `ColonySimulationState`, `TileDesignation`, `StockpileZone`, `JobReservationToken`, `WorkshopState`, `CraftingBill`, `LaborKind` |
| `src/systems/labor/job_blackboard.ts` *(NEW)* | `tier1_console` | Conflict-free atomic reservation tokens (`tile:*`, `entity:*`, `workshop:*`), worker release on death/eviction, TTL pruning. Excludes pathfinding. | `tryAcquireReservation`, `releaseReservation`, `releaseAllWorkerReservations`, `pruneExpiredReservations`, `isResourceReservedByOther` |
| `src/systems/labor/designation.system.ts` *(NEW)* | `tier1_console` | Spatial designation CRUD (`mine`, `chop`, `haul`, `build`, `harvest`, `channel`), legality checks, auto-cleanup on completion. Excludes AI scheduling. | `addTileDesignation`, `removeTileDesignation`, `addRectDesignation`, `completeDesignationAt`, `getActiveDesignationsForArea` |
| `src/systems/labor/stockpile.system.ts` *(NEW)* | `tier1_console` | Typed tag/item filter stockpiles, priority-ordered destination cell matching, unstocked haul item discovery. Excludes inventory mutation. | `createStockpileZone`, `doesItemMatchStockpile`, `findBestStockpileCellForItem`, `findUnstockedHaulItems` |
| `src/systems/labor/workshop.system.ts` *(NEW)* | `tier1_console` | Multi-step Crafting DAG bill queues (`do_x_times`, `maintain_stock`, `forever`), ingredient hauling sub-job generation, work progress, output spawning. Excludes UI modals. | `registerWorkshop`, `enqueueCraftingBill`, `resolveNextRunnableBill`, `advanceWorkshopBillWork` |
| `src/ai/labor.behavior.ts` *(NEW)* | `tier1_console` | Priority-based labor & hauling utility AI emitting standard `ActionIntent`s via `computeHierarchicalNextStep`. Registered as `'labor'` in `BEHAVIOR_REGISTRY`. Excludes direct map mutation. | `laborBehavior` |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **D&D 3.5e Earth/Stone/Water Spells** (*Passwall*, *Stone Shape*, *Transmute Rock to Mud*, *Create Water*) | `if (spell.id === 'passwall') ... else if (spell.id === 'create_water') ...` | New discriminated variants `terrain_sculpt` and `fluid_spawn` in `DnD35SpellEffectUnitSchema` (`spell_system.types.ts`) authored in `spells/*.json` | **Yes** — any new campaign spell JSON using `terrain_sculpt` or `fluid_spawn` works with zero `.ts` edits. |
| **Mineable Walls & Rock Drops** | `if (tileId === 'stone_wall') drop('stone_boulder')` | Optional `mineable`, `minedTileId`, `mineYieldItemId`, `mineYieldCount`, `mineWorkCost`, `requiredToolTag` on `TileDefinitionSchema` (`world.ts`) | **Yes** — new ore/crystal/ice wall tiles authored in `tiles.json` drop custom items automatically. |
| **Structural Load-Bearing & Cave-Ins** | `if (tileId.includes('wall') || tileId === 'pillar')` | Optional `isLoadBearing?: boolean` & `collapseDropItemId?: string` on `TileDefinitionSchema` (defaulting solid non-open-air walls to load-bearing) | **Yes** — new structural tile types declare support capability in JSON. |
| **Thermal Conductivity & Ignition** | `if (tileId === 'wooden_floor') burn()` | Optional `thermalConductivity`, `ignitionTempC`, `burnedTileId` on `TileDefinitionSchema` and `MaterialsConfig` | **Yes** — new flammable or insulating materials/tiles configure thermal properties in JSON. |
| **Mining / Chopping / Crafting Tools** | `if (itemId === 'pickaxe' || itemId === 'axe')` | Item `tags` (`tool:mining`, `tool:chopping`, `tool:masonry`) matched against `tileDef.requiredToolTag` / `recipe.requiredToolTag` | **Yes** — any modded dwarven drill or adamantine pick with tag `tool:mining` works immediately. |
| **Stockpile Item Filtering** | `if (item.category === 'boulder')` | `StockpileZone` `{ allowedTags, deniedTags, allowedItemIds }` matched against `ItemDefinition.tags` + `TagsComponent.tags` | **Yes** — custom item tags filter cleanly into stockpiles with zero `.ts` edits. |
| **Needs, Comfort Furniture & Thoughts** | `if (entity.templateId === 'bed') comfort += 20` | Declarative `psychology` config in `RulesConfigSchema` + entity/item tags (`furniture:bed`, `furniture:table`, `edible`, `workshop:masonry`) | **Yes** — custom furniture, rooms, needs, and thoughts are data-driven in JSON. |
| **Multi-Step Workshop Recipes** | Hardcoded `switch (recipeId)` crafting logic | Declarative `CraftingRecipeSchema` (`workshopTag`, `requiredInputs: [{ tag/itemId, count }]`, `workUnits`, `outputs: [{ itemId, count }]`) in `RulesConfigSchema.craftingRecipes` | **Yes** — campaign authors add arbitrary multi-step crafting chains in `rules.json`. |

---

## 3. Cascading Effects Matrix (AGENTS.md Rule 15)

| Task / Change | Upstream (Callers / Emitters / Producers / Authors) | Downstream (Consumers / Renderers / Serializers / Validators) | Lateral (Mirrors / Sibling Campaigns / Registries / Docs) |
| :--- | :--- | :--- | :--- |
| **M180: Cellular Physics & Analytical Catch-Up** | `intent_cost_resolver.ts` (ticks dirty fluid/temp chunks when `energyCost > 0`), `chunk_streaming.ts` (chunk wake catch-up), `map_wake_respawn.ts` (finite area wake catch-up), `world_time_skip.ts` (bulk rest catch-up), `field.system.ts` (fire/cold heat coupling), `spell_cast_units.ts` (`fluid_spawn`) | `map_accessor.ts` (`getFluidAt`/`setFluidAt`/`getTemperatureAt`/`setTemperatureAt`), `viewport_snapshot.ts` & `inspect_tooltip.ts` (render depth `1/7..7/7` + °C readout), `movement_displacement.ts` & `breath.system.ts` (deep fluid wading/submersion), `needs.system.ts` (thermal comfort), `save.ts` (serializes `FinitePhysicsOverlay` & `WorldChunk` deltas) | `world_chunk.constants.ts`, `default/tiles.json`, `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md`, `docs/ARCHITECTURE.md` |
| **M181: Voxel Sculpting, Construction & D&D 3.5e Spells** | `verbs.constants.ts` & `apply.system.ts` (`mine`, `chop`, `build`, `craft`), `labor.behavior.ts`, `spell_cast_resolver.ts` (3D `targetPos.z` + `placementUnits` including `terrain_sculpt`/`fluid_spawn`), `world_time_skip.ts` & `intent_cost_resolver.ts` (`tickTimedTerrainReverts`) | `map_accessor.ts` (`setTileIdAt` sets `PERSIST|REGION|FLUID|TEMP`), `region_graph.ts` & `flow_field.ts` (HPA* invalidation), `fov_3d.ts` (`fovNeedsUpdate: true`), `gravity.system.ts` (cave-ins & floor cuts drop entities), `designation.system.ts` (auto-completes designations), `save.ts` (`timedTerrainReverts`) | `TileDefinitionSchema` (`world.ts`), `RulesConfigSchema` (`meta.ts`), `DnD35SpellEffectUnitSchema` (`spell_system.types.ts`), `system_content_spell_ids.ts`, `public/data/rulesets/dnd35e/spells/{stone_shape,passwall,transmute_rock_to_mud,create_water}.json`, `default/{tiles,items,rules}.json`, `ssot_console.json`, `ssot_dnd35e.json` |
| **M182: Universal Needs, Thoughts, Mood & Stress** | `simulation_cadence.ts` (`processTier2LocalCadence`), `world_time_skip.ts` (bulk advance needs & thought decay), `hunger.system.ts` (nourishment sync), `personality.system.ts` (`recordThought` preserved), `ecs_spawner.ts` (`NeedsComponent` hydration) | `actor_components.types.ts` & `components.types.ts` (`ComponentType.Needs`, extended `MemoryComponent`/`Thought`), `ai.system.ts` (mental break behavior override), `ruleset.types.ts` & `dnd35e_dag_adapter.ts` (optional morale `StatModifier`s from mood tier), `inspect_tooltip.ts` (mood/needs/thoughts lines), `save.ts` (serializes new component cleanly) | `EntityTemplateSchema` (`entity.ts`), `RulesConfigSchema` (`meta.ts`), `personality.constants.ts`, `default/entities.json`, `ssot_console.json` |
| **M183: Designations, Blackboard, Stockpiles, Hauling AI & Workshops** | `ai.system.ts` (`BEHAVIOR_REGISTRY['labor']`), `death.system.ts` & `chunk_streaming.ts` (worker reservation cleanup on death/eviction), `ecs_spawner.ts` (`LaborProfileComponent` hydration), `apply.system.ts` (`craft`/`build`/`mine`/`chop`) | `game-state.types.ts` & `save.ts` (`colonyState` serialization), `viewport_snapshot.ts` & `inspect_tooltip.ts` (designation & stockpile overlays), `pathfinding_hpa.ts` (3D labor routing), `inventory.system.ts` (pickup/drop intents) | `AIBehaviorEntrySchema` & `EntityTemplateSchema` (`entity.ts`), `RulesConfigSchema` (`meta.ts`), `default/{areas,entities,items,ai,rules}.json`, `ssot_console.json`, `docs/MILESTONES.md` |

---

## 4. Detailed Step-by-Step Implementation Plan & Code Integration Blueprint

### Milestone 180 — Dirty-Bitset Cellular Physics & Analytical Sleep Catch-Up

#### Step 180.1: Constants, Fluid Bit-Packing & Finite Map Physics Overlay Types
- **Files:**
  - `src/constants/world_chunk.constants.ts`
  - `src/types/world-chunk.types.ts`
  - `src/types/game-state.types.ts`
- **Exact Additions (`src/constants/world_chunk.constants.ts`):**
  ```ts
  /** Bitmask for fluid depth (`0..7`, representing `0/7` through `7/7`) in `WorldChunk.fluid`. */
  export const FLUID_DEPTH_MASK = 0x07;
  /** Bit shift for `FluidKind` (`0..7`) stored in bits `3..5` of `WorldChunk.fluid`. */
  export const FLUID_KIND_SHIFT = 3;
  /** Bitmask for `FluidKind` in `WorldChunk.fluid`. */
  export const FLUID_KIND_MASK = 0x38;
  /** Maximum fluid depth level (`7/7`, fully submerged). */
  export const MAX_FLUID_DEPTH = 7;
  /** Depth threshold (`6/7`) at which non-aquatic actors become submerged and lose breath. */
  export const FLUID_SUBMERSION_DEPTH = 6;
  /** Depth threshold (`3/7`) at which wading incurs difficult-terrain movement penalty. */
  export const FLUID_WADING_DEPTH = 3;

  /** Numeric fluid kind codes packed into `WorldChunk.fluid` bits `3..5`. */
  export const enum FluidKindCode {
    None = 0,
    Water = 1,
    Magma = 2,
    Oil = 3,
    Mud = 4
  }

  /** Named string fluid kinds used in declarative schemas and spell units. */
  export type FluidKind = 'none' | 'water' | 'magma' | 'oil' | 'mud';

  /** Temperature constants (°C) for cellular heat diffusion and phase transitions. */
  export const WATER_FREEZE_TEMP_C = 0;
  export const WATER_BOIL_TEMP_C = 100;
  export const OIL_IGNITION_TEMP_C = 220;
  export const MAGMA_SOURCE_TEMP_C = 1000;
  export const FIRE_FIELD_SOURCE_TEMP_C = 420;
  export const COLD_FIELD_SOURCE_TEMP_C = -25;
  export const TEMP_CONVERGENCE_EPSILON_C = 1;
  export const TEMP_DIFFUSION_RATE = 0.2;
  export const TEMP_AMBIENT_RELAXATION_LAMBDA = 0.08;
  export const SHALLOW_EVAPORATION_TURNS = 25;
  export const MIN_CELL_TEMP_C = -100;
  export const MAX_CELL_TEMP_C = 2000;
  ```
- **Exact Addition (`src/types/game-state.types.ts` on `GameMap`):**
  ```ts
  /** Lazy, JSON-serializable sparse physics planes for finite (non-chunked) maps. */
  export interface FinitePhysicsSlice {
    /** Packed fluid byte per cell (`0..width*height-1`), matching `WorldChunk.fluid`. */
    readonly fluid: ReadonlyArray<number>;
    /** Cell temperature in °C per cell, matching `WorldChunk.temperature`. */
    readonly temperature: ReadonlyArray<number>;
    /** Material palette index per cell, matching `WorldChunk.materialId`. */
    readonly materialId: ReadonlyArray<number>;
    /** Bitmask of active dirty flags (`CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP`). */
    readonly dirtyFlags: number;
    /** Last `globalTurn` at which this slice was simulated or caught up. */
    readonly lastSimulatedTurn: number;
  }

  export interface FinitePhysicsOverlay {
    readonly slices: Readonly<Record<number, FinitePhysicsSlice>>;
  }
  ```
  Add `readonly physicsOverlay?: FinitePhysicsOverlay | undefined;` to `GameMap` (automatically JSON-serializable in `save.ts` because it uses plain arrays + records!).

#### Step 180.2: Material Palette & Unified Fluid/Temp Accessors
- **New File:** `src/map/material_palette.ts` — mirrors `src/map/tile_palette.ts` (`buildMaterialPaletteRegistry`, `getMaterialIdFromPaletteIndex`, `getPaletteIndexForMaterialId`).
- **Edited File:** `src/map/map_accessor.ts`:
  - Add pure unified helpers working identically on `map.chunkGrid` AND `map.physicsOverlay`:
    - `getFluidByteAt(map, x, y, z = 0): number`
    - `setFluidByteAt(map, x, y, fluidByte, z = 0, currentTurn = 0): GameMap` (automatically clones chunk / lazy-initializes finite slice, sets `CHUNK_DIRTY_FLUID | CHUNK_DIRTY_PERSIST`, and flags neighbor chunks if `(x, y)` sits on a chunk border!)
    - `getTemperatureAt(map, x, y, z = 0): number` (defaults to `DEFAULT_AMBIENT_TEMP_C`)
    - `setTemperatureAt(map, x, y, tempC, z = 0, currentTurn = 0): GameMap` (clamped `[MIN_CELL_TEMP_C, MAX_CELL_TEMP_C]`, sets `CHUNK_DIRTY_TEMP | CHUNK_DIRTY_PERSIST`)
    - `getMaterialIndexAt(map, x, y, z = 0): number`
    - `setMaterialIndexAt(map, x, y, materialIdx, z = 0): GameMap`
  - Update `setTileIdAt` to also flag `CHUNK_DIRTY_FLUID | CHUNK_DIRTY_TEMP` on touched chunks/slices (and orthogonal neighbor chunks if on a boundary) whenever a tile transitions between solid and open, so adjacent fluids immediately spill into newly carved tunnels!

#### Step 180.3: Dirty-Bitset Cellular Fluid Physics (`src/systems/physics/fluid_physics.ts`)
- **Pure bit helpers:**
  ```ts
  export interface FluidCellInfo {
    readonly kind: FluidKind;
    readonly depth: number;
  }
  export function packFluidCell(kind: FluidKind, depth: number): number;
  export function unpackFluidCell(byte: number): FluidCellInfo;
  export function applyFluidToVoxel(
    state: GameState,
    x: number,
    y: number,
    z: number,
    kind: FluidKind,
    depthDelta: number
  ): GameState;
  ```
- **Dirty-Chunk Tick (`processDirtyFluidChunks(state: GameState): GameState`):**
  1. Fast-path $O(1)$ exit if zero chunks (and zero finite slices) hold `(dirtyFlags & CHUNK_DIRTY_FLUID) !== 0`.
  2. For each dirty chunk (or dirty finite slice), run one deterministic pass:
     - **Pass A — Vertical Gravity Spillover:** If a cell `(x, y, z)` has `depth > 0` and `(x, y, z - 1)` is in bounds, non-solid (`tileDef.isSolidObstacle !== true && (tileDef.walkable || tileDef.isOpenAir || tileDef.verticalLink !== undefined)`), and the current cell has `hasFloorSupport === false || tileDef.isOpenAir === true || tileDef.verticalLink !== undefined`, transfer up to `min(depth, MAX_FLUID_DEPTH - belowDepth)` downward.
     - **Pass B — Horizontal Hydrostatic Equalization:** For each cell with `depth >= 2` (or `depth >= 1` spilling onto lower-depth open neighbor), compare 4 orthogonal neighbors `(±1, 0), (0, ±1)` that are non-solid. Magma spreads only on even turns (`globalTurn % 2 === 0`) for higher viscosity. Transfer `1` depth unit toward the lowest-depth neighbor with `neighborDepth <= depth - 2` (or `neighborDepth === 0 && depth >= 2`).
     - **Pass C — Phase Transitions & Chemistry:**
       - `water` adjacent/contacting `magma`: convert contact cell into declarative obsidian/basalt tile (from `rules.materials?.obsidianTileId ?? 'stone_wall'`), clear fluid at that cell, spawn `steam_cloud` field via `spawnField` (`field.system.ts`), and raise temperature (`+150°C`).
       - `oil` at cell with `temp >= OIL_IGNITION_TEMP_C` or overlapping `fire` field: consume oil depth, spawn `fire` field, raise temperature.
       - `water` at cell with `temp <= WATER_FREEZE_TEMP_C`: spawn `frozen_surface` crossing (`crossing.system.ts`).
       - `water` at cell with `temp >= WATER_BOIL_TEMP_C`: decrement depth by 1 and spawn `steam_cloud` field.
     - **Auto-Sleep:** If zero cells changed in the chunk and no unstable gradient remains, clear `CHUNK_DIRTY_FLUID` on that chunk (preserving `CHUNK_DIRTY_PERSIST` if modified). Stamp `lastSimulatedTurn = state.globalTurn`.
  3. **Actor Submersion Sync:** For entities standing on modified fluid cells, if `depth >= FLUID_SUBMERSION_DEPTH`, call `setActorSubmersionState(state, entityId, true)` (`breath.system.ts`); if `kind === 'magma' && depth >= 1`, queue fire/magma damage on non-flying occupants.

#### Step 180.4: Dirty-Bitset 3D Heat Diffusion (`src/systems/physics/temperature_physics.ts`)
- **`processDirtyTemperatureChunks(state: GameState): GameState`:**
  1. First inject thermal emitter deltas from active `FieldComponent`s (`fire` -> `FIRE_FIELD_SOURCE_TEMP_C`, `cold`/`ice` -> `COLD_FIELD_SOURCE_TEMP_C`) and `magma` fluid cells (`MAGMA_SOURCE_TEMP_C`), marking enclosing chunks `CHUNK_DIRTY_TEMP`.
  2. Fast-path $O(1)$ exit if zero chunks/slices have `(dirtyFlags & CHUNK_DIRTY_TEMP) !== 0`.
  3. For each dirty chunk/slice, compute discrete 6-neighbor (4 horizontal + optional ±Z when multi-Z) diffusion:
     ```ts
     const conductivity = tileDef?.thermalConductivity ?? DEFAULT_THERMAL_CONDUCTIVITY;
     const nextTemp = Math.round(
       curTemp +
         conductivity * TEMP_DIFFUSION_RATE * (neighborAvg - curTemp) +
         TEMP_AMBIENT_RELAXATION_LAMBDA * (ambientTemp - curTemp)
     );
     ```
     Flag neighbor chunk `CHUNK_DIRTY_TEMP` whenever boundary flux `>= 2°C`.
  4. **Auto-Sleep:** If every cell in the chunk is within `TEMP_CONVERGENCE_EPSILON_C` of ambient and no cell changed temperature, snap residual `±1°C` cells to `ambientTemp` and clear `CHUNK_DIRTY_TEMP`. Stamp `lastSimulatedTurn = state.globalTurn`.

#### Step 180.5: Closed-Form Analytical Sleep Catch-Up (`src/systems/physics/chunk_catchup.ts`)
- **`applyAnalyticalChunkCatchUp(chunk: WorldChunk, currentTurn: number, ambientTempC?: number): WorldChunk`:**
  - Computes `deltaTurns = currentTurn - chunk.lastSimulatedTurn`. If `deltaTurns <= 0`, returns `chunk` unchanged.
  - Closed-form pass over `0..chunk.size * chunk.size - 1` (zero loop over `deltaTurns`!):
    - **Temperature relaxation:** `factor = Math.exp(-TEMP_AMBIENT_RELAXATION_LAMBDA * deltaTurns)`; `nextT = Math.round(ambient + (t - ambient) * factor)`; snap to `ambient` if `Math.abs(nextT - ambient) <= TEMP_CONVERGENCE_EPSILON_C`.
    - **Fluid evaporation & equilibrium:** For `water`/`oil` with `depth === 1` and `deltaTurns >= SHALLOW_EVAPORATION_TURNS`, evaporate to `0`.
    - Clear `CHUNK_DIRTY_TEMP` if all cells settled at ambient; clear `CHUNK_DIRTY_FLUID` if all fluid cells are uniform/settled; set `lastSimulatedTurn = currentTurn`.
- **`applyAnalyticalActiveGridCatchUp(state: GameState, deltaTurns: number): GameState`:**
  - Runs analytical catch-up across loaded chunks / finite physics slices during bulk rest/time-skips (`world_time_skip.ts`) and area wakes (`map_wake_respawn.ts`), also advancing timed terrain reverts and corpse/perishable spoilage analytically.

#### Step 180.6: Wiring Into Loop, Streaming, Movement, Save & Rendering
- `src/core/loop/intent_cost_resolver.ts`: After `processFieldsTick`, when `energyCost > 0`, invoke `processDirtyFluidChunks` -> `processDirtyTemperatureChunks` -> `tickTimedTerrainReverts`.
- `src/systems/map/chunk_streaming.ts`: When loading a cached/delta chunk inside `updateStreamingWorldWindow`, call `applyAnalyticalChunkCatchUp(deltaChunk, state.globalTurn)` before inserting into `nextChunks`.
- `src/systems/map/map_wake_respawn.ts`: When waking a saved finite area with `deltaTurns = state.globalTurn - savedArea.lastVisitedTurn > 0`, run `applyAnalyticalActiveGridCatchUp`.
- `src/systems/world_time_skip.ts`: In `advanceLocalElapsedTimeByTurns`, call `applyAnalyticalActiveGridCatchUp(nextState, turnsElapsed)` and `tickTimedTerrainReverts(nextState)`.
- `src/systems/movement_displacement.ts`: Add wading movement cost penalty when `fluid.depth >= FLUID_WADING_DEPTH` and non-flying/non-swimming.
- `src/rendering/viewport_snapshot.ts` & `src/rendering/inspect_tooltip.ts`:
  - Render cellular fluids (`depth 1..7`) over explored/visible floor tiles with depth-digit or `≈`/`~` glyph & fluid-kind color tint (blue water, orange-red magma, amber oil, brown mud), plus fluid depth (`4/7 Water`) and temperature (`42°C`) lines in `inspect_tooltip.ts`.

---

### Milestone 181 — Dynamic Terrain Sculpting, Construction, Structural Support & D&D 3.5e Spells

#### Step 181.1: Declarative Schemas & New Verbs
- **`src/types/campaign/world.ts` (`TileDefinitionSchema`):**
  ```ts
  mineable: z.boolean().optional(),
  minedTileId: z.string().optional(),
  mineYieldItemId: z.string().optional(),
  mineYieldCount: z.number().int().positive().optional(),
  mineWorkCost: z.number().int().positive().optional(),
  requiredToolTag: z.string().optional(),
  isLoadBearing: z.boolean().optional(),
  collapseDropItemId: z.string().optional(),
  thermalConductivity: z.number().min(0).max(1).optional(),
  ignitionTempC: z.number().int().optional(),
  burnedTileId: z.string().optional()
  ```
- **`src/types/campaign/meta.ts` (`RulesConfigSchema`):**
  Add optional declarative blocks:
  - `materials?: Record<string, MaterialDefinition>` (`id`, `name`, `hardness`, `thermalConductivity`, `meltTempC?`, `flammable?`, `boulderItemId?`)
  - `blueprints?: Record<string, ConstructionBlueprint>` (`id`, `name`, `targetTileId`, `materialId?`, `requiredInputs: Array<{ itemId?: string; tag?: string; count: number }>`, `workUnits`, `requiredToolTag?`, `allowOverOpenAir?`)
  - `craftingRecipes?: Record<string, CraftingRecipe>` (`id`, `name`, `workshopTag`, `requiredInputs`, `requiredToolTag?`, `workUnits`, `outputs: Array<{ itemId: string; count: number }>`, `skillId?`)
  - `psychology?: PsychologyRulesConfig` (optional need decay rates, mood thresholds, thought overrides)
- **`src/constants/verbs.constants.ts`:** Add `'mine'`, `'chop'`, `'build'`, `'craft'` to `Verb` union and `VERBS` array (and add them to `TOUCH_INTERACTION_VERBS` in `src/systems/apply.system.ts`).

#### Step 181.2: Connected Structural Support & Cave-In Physics (`src/map/structural_support.ts`)
- **Named Constants:** `MAX_SUPPORT_SPAN_TILES = 6`, `CAVE_IN_CRUSH_DAMAGE = 12`.
- **`evaluateStructuralSupport(state: Readonly<GameState>, x: number, y: number, z: number): boolean`:**
  - Returns `true` immediately if tile at `(x, y, z)` is `open_air`, or `isLoadBearing` (explicit `tileDef.isLoadBearing === true` or natural solid wall), or tile directly below `(x, y, z - 1)` is solid/load-bearing, or `z === minZ` (bedrock).
  - Otherwise runs bounded 4-neighbor BFS up to `MAX_SUPPORT_SPAN_TILES` across solid/floor tiles at Z-level `z`; returns `true` iff any reachable cell is load-bearing or supported directly from `z - 1`.
- **`resolveCaveInAroundVoxel(state: GameState, x: number, y: number, z: number): GameState`:**
  - Only runs on multi-Z maps (`isMultiZMap(state.map)`).
  - Inspects `(x, y, z + 1)` and its 4 orthogonal neighbors whenever support is removed at `(x, y, z)`.
  - For any cell where `evaluateStructuralSupport` returns `false`:
    1. Converts that cell to `'open_air'` via `setTileIdAt`.
    2. Spawns rubble drop (`tileDef.collapseDropItemId ?? tileDef.mineYieldItemId`) at the first solid floor below `(x, y, zLand)`.
    3. Queues `CAVE_IN_CRUSH_DAMAGE` on any `Fighter` entity at `(x, y, zLand)` and logs a cave-in message.
    4. Runs `resolveGravityForEntity` for all entities standing at the collapsed `(x, y, z + 1)` cell.

#### Step 181.3: Voxel Sculpting, Mining, Construction & Timed Reverts (`src/systems/construction.system.ts`)
- **`sculptTerrainVoxel(state, x, y, z, targetTileId, options?): GameState`:**
  - Validates bounds & tile registry.
  - Updates tile via `setTileIdAt(state.map, x, y, targetTileId, z)` and optional `materialId` via `setMaterialIndexAt`.
  - Sets `fovNeedsUpdate: true`.
  - Clears matching spatial designation (`completeDesignationAt`).
  - If `options?.dropYield !== false` and previous tile had `mineYieldItemId`, spawns yield item(s) at `(x, y, z)` (or at actor's position if `targetTileId` is `open_air`).
  - Runs `resolveCaveInAroundVoxel(nextState, x, y, z)` and checks gravity for entities standing on `(x, y, z)` if `targetTileId` became `open_air`.
- **`mineTerrainTile(state, actorId, x, y, z, toolEntityId?): { state: GameState; success: boolean }`:**
  - Checks tile `mineable === true` (or `tags?.includes('mineable')`), optional `requiredToolTag` in actor inventory/equipment/tool, calls `sculptTerrainVoxel(..., tileDef.minedTileId ?? 'stone_floor', { dropYield: true })`, emits sound & message.
- **`constructTerrainTile(state, actorId, x, y, z, blueprintId): { state: GameState; success: boolean }`:**
  - Looks up blueprint from `state.campaign.rules.blueprints?.[blueprintId] ?? DEFAULT_CONSTRUCTION_BLUEPRINTS[blueprintId]`.
  - Finds & consumes `requiredInputs` from actor inventory or ground at `(x, y, z)` / adjacent tiles; calls `sculptTerrainVoxel(..., blueprint.targetTileId, { dropYield: false })`.
- **`scheduleTimedTerrainRevert` & `tickTimedTerrainReverts`:**
  - Stores `{ areaId, x, y, z, revertTileId, revertTurn, sourceId }` in `state.colonyState.timedTerrainReverts`. When `state.globalTurn >= revertTurn` (and area matches), reverts tile cleanly via `sculptTerrainVoxel` (ejecting any occupant to nearest open neighbor if reverting to solid wall!).
- **Wire into `src/systems/apply.system.ts`:** Dispatch `'mine'`, `'chop'`, `'build'`, and `'craft'` verbs cleanly on `TileTarget` / `EntityTarget`.

#### Step 181.4: D&D 3.5e Earth/Stone/Water Sculpting Spells (Rule 21 Compliant)
- **Schema (`src/rulesets/dnd35e/types/system/spell_system.types.ts`):**
  Add two variants to `DnD35SpellEffectUnitSchema`:
  ```ts
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('terrain_sculpt'),
    sculptMode: z.enum(['carve', 'shape', 'transmute', 'fill']),
    requiredSourceTags: z.array(z.string()).default([]),
    targetTileId: z.string(),
    radiusTiles: z.number().int().nonnegative().default(0),
    durationTurnsScaling: DnD35SpellScalingRuleSchema.optional(),
    revertTileId: z.string().optional(),
    spawnFluidKind: z.enum(['none', 'water', 'magma', 'oil', 'mud']).optional(),
    spawnFluidDepth: z.number().int().min(1).max(7).optional()
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('fluid_spawn'),
    fluidKind: z.enum(['water', 'magma', 'oil', 'mud']).default('water'),
    depth: z.number().int().min(1).max(7).default(4),
    radiusTiles: z.number().int().nonnegative().default(1),
    depthScaling: DnD35SpellScalingRuleSchema.optional()
  })
  ```
- **Multi-Z Propagation (`spell_cast_resolver.ts`, `spell_cast_effects.ts`, `spell_cast_units.ts`):**
  - Update `targetPos` type in `ApplySpellEffectsContext` and `applySpecialSpellUnit` to `{ readonly x: number; readonly y: number; readonly z?: number | undefined }`.
  - Include `u.type === 'terrain_sculpt' || u.type === 'fluid_spawn'` in `placementUnits` (`spell_cast_resolver.ts:297`) and exclude them from per-creature target loop (`spell_cast_resolver.ts:387`).
  - Handle `case 'terrain_sculpt'` and `case 'fluid_spawn'` in `applySpecialSpellUnit` (`spell_cast_units.ts`): iterate disk of `radiusTiles` around `(targetPos.x, targetPos.y, targetPos.z ?? casterZ)`, filter by `requiredSourceTags`, invoke Tier 1 `sculptTerrainVoxel`, `scheduleTimedTerrainRevert` (when `durationTurnsScaling` is present), and `applyFluidToVoxel`!
- **Tier 3 Spell JSONs + Registry (`src/rulesets/dnd35e/system_content_spell_ids.ts`):**
  - Update `public/data/rulesets/dnd35e/spells/stone_shape.json` to emit a `terrain_sculpt` unit (`sculptMode: 'carve'`, `requiredSourceTags: ['solid']`, `targetTileId: 'stone_floor'`, `radiusTiles: 0`).
  - Create `public/data/rulesets/dnd35e/spells/passwall.json` (`terrain_sculpt`, `sculptMode: 'carve'`, `requiredSourceTags: ['solid']`, `targetTileId: 'stone_floor'`, `durationTurnsScaling: { baseValue: 0, perCL: 600 }` [1 hr/CL = 600 rounds/CL], reverts to original wall tile on expiration).
  - Create `public/data/rulesets/dnd35e/spells/transmute_rock_to_mud.json` (`terrain_sculpt`, `sculptMode: 'transmute'`, `requiredSourceTags: ['solid']`, `targetTileId: 'stone_floor'`, `radiusTiles: 1`, `spawnFluidKind: 'mud'`, `spawnFluidDepth: 5`).
  - Create `public/data/rulesets/dnd35e/spells/create_water.json` (`fluid_spawn`, `fluidKind: 'water'`, `depth: 3`, `radiusTiles: 1`, `depthScaling: { baseValue: 2, perCL: 1, maxCap: 7 }`).
  - Add `'create_water'`, `'passwall'`, and `'transmute_rock_to_mud'` in alphabetical order to `SPELL_IDS` in `src/rulesets/dnd35e/system_content_spell_ids.ts`.

---

### Milestone 182 — Universal Needs, Thoughts, Mood & Stress Engine

#### Step 182.1: Component Shapes, Constants & Spawner Hydration
- **`src/constants/personality.constants.ts`:**
  Add named constants: `DEFAULT_NEED_VALUE = 80`, `MAX_NEED_VALUE = 100`, `MIN_NEED_VALUE = 0`, `NEED_CRITICAL_THRESHOLD = 20`, `NEED_LOW_THRESHOLD = 40`, `NEED_HIGH_THRESHOLD = 80`, `BASELINE_MOOD = 50`, `MOOD_ECSTATIC_THRESHOLD = 85`, `MOOD_HAPPY_THRESHOLD = 65`, `MOOD_STRESSED_THRESHOLD = 35`, `MOOD_BREAKING_THRESHOLD = 20`, `MOOD_CATATONIC_THRESHOLD = 8`, `DEFAULT_INSPIRATION_DURATION_TURNS = 100`, `DEFAULT_MENTAL_BREAK_DURATION_TURNS = 30`.
- **`src/types/components/actor_components.types.ts` & `src/types/components.types.ts`:**
  - Add `ComponentType.Needs = 'Needs'` to `ComponentType` enum and `NeedsComponent` to `Component` union:
    ```ts
    export type CanonicalNeedId = 'rest' | 'nourishment' | 'shelter' | 'comfort' | 'social' | 'safety';
    export type MoodTier = 'ecstatic' | 'happy' | 'content' | 'stressed' | 'breaking' | 'catatonic';
    export type InspirationKind = 'work_frenzy' | 'inspired_craft' | 'inspired_valor';
    export type MentalBreakKind = 'daze_wander' | 'hide_in_room' | 'tantrum' | 'berserk';

    export interface NeedMeterState {
      readonly current: number;
      readonly max: number;
      readonly decayPerInterval: number;
    }

    export interface NeedsComponent {
      readonly type: ComponentType.Needs;
      readonly needs: Readonly<Record<string, NeedMeterState>>;
    }
    ```
  - Extend `Thought` (100% backward compatible — all new fields optional):
    ```ts
    export interface Thought {
      readonly turn: number;
      readonly eventSummary: string;
      readonly stressDelta: number;
      readonly relatedEntityId?: EntityId | undefined;
      readonly thoughtId?: string | undefined;
      readonly moodDelta?: number | undefined;
      readonly expiresAtTurn?: number | undefined;
      readonly stackCount?: number | undefined;
      readonly maxStacks?: number | undefined;
    }
    ```
  - Extend `MemoryComponent` with optional `mood?: number`, `moodTier?: MoodTier`, `activeInspiration?: { readonly kind: InspirationKind; readonly expiresAtTurn: number }`, `activeMentalBreak?: { readonly kind: MentalBreakKind; readonly expiresAtTurn: number }`.
- **`src/types/campaign/entity.ts` & `src/core/ecs/ecs_spawner.ts`:**
  - Add optional `needs?: Record<string, number>` and `enablePsychology?: boolean` to `EntityTemplateSchema`, hydrating `NeedsComponent` in `spawnEntity`.

#### Step 182.2: Needs Evaluation & Hunger Sync (`src/systems/psychology/needs.system.ts`)
- `createDefaultNeedsComponent(initialOverrides?, config?)`: Initializes all 6 canonical needs (`rest`, `nourishment`, `shelter`, `comfort`, `social`, `safety`).
- `processActorNeedsTick(state, entityId, elapsedIntervals = 1)`:
  - **Nourishment:** If `HungerComponent` exists, computes `Math.round((hunger.satiation / hunger.maxSatiation) * 100)` directly (zero split-brain!); otherwise decays by `decayPerInterval * elapsedIntervals`.
  - **Rest:** Decays while awake; recovers if entity is adjacent to/on a `furniture:bed` entity or during rest skips (`satisfyActorNeed(state, entityId, 'rest', delta)`).
  - **Shelter:** Checks `area.environmentType !== 'outdoors'` OR solid roof at `z + 1` OR `(chunkFlag & CHUNK_FLAG_OUTDOOR) === 0`; recovers indoors, decays outdoors.
  - **Comfort:** Evaluates cell temperature from M180 (`getTemperatureAt(state.map, pos.x, pos.y, pos.z ?? 0)`): `12°C..28°C` boosts comfort, `< 0°C` or `> 40°C` drains comfort and adds a temperature thought; nearby `furniture:*` tagged entities also boost comfort.
  - **Social:** Recovers if non-hostile actor is within 4 tiles; gently decays if isolated.
  - **Safety:** Drains if hostile actor is within 6 tiles or HP < 50% or standing in hazard/extreme temp; recovers in `'safe'` tagged areas or unthreatened rooms.
  - Emits stacking/refreshing thoughts via `addTimedThought` when any need crosses `NEED_CRITICAL_THRESHOLD`, `NEED_LOW_THRESHOLD`, or `NEED_HIGH_THRESHOLD`.

#### Step 182.3: Thoughts, Mood Tiers, Inspirations & Mental Breaks (`src/systems/psychology/thoughts.system.ts`)
- `addTimedThought(state, entityId, input)`:
  - If an active thought with matching `thoughtId` exists, increments `stackCount` up to `maxStacks ?? 1` and refreshes `expiresAtTurn` (preventing duplicate spam).
  - Otherwise appends new `Thought`, keeping array capped at `MAX_TRANSIENT_THOUGHTS`.
- `recalculateActorMood(memory, currentTurn)`:
  - Filters out expired thoughts (`expiresAtTurn !== undefined && currentTurn >= expiresAtTurn`).
  - Sums `moodDelta * (stackCount ?? 1)` (falling back to `-stressDelta` for legacy thoughts), weighted by `facets['resilience']` / `facets['neuroticism']` if present.
  - Clamps `mood` to `[0, 100]`, derives `moodTier`, checks Inspiration trigger (`mood >= MOOD_ECSTATIC_THRESHOLD` and no active inspiration/break) and Mental Break trigger (`mood <= MOOD_BREAKING_THRESHOLD` and no active break, choosing `berserk`/`tantrum`/`hide_in_room`/`daze_wander` deterministically from `facets['aggression']` / `facets['bravery']`).
- `processActorPsychologyTick(state, elapsedIntervals = 1)`:
  - Iterates actors with `NeedsComponent` or `MemoryComponent`, runs `processActorNeedsTick` + `recalculateActorMood`, and keeps `processPersonalitySystem` core-memory promotion working seamlessly.

#### Step 182.4: Cadence, AI Break Override, D&D 3.5e Morale DAG & Tooltip
- `src/core/simulation_cadence.ts` & `src/systems/world_time_skip.ts`: Call `processActorPsychologyTick(stepped, 1)` on `LOCAL_NARRATIVE_TICK_INTERVAL` right alongside `processPersonalitySystem`.
- `src/systems/ai.system.ts`: Before scoring normal AI behaviors, check `memory?.activeMentalBreak`:
  - `'daze_wander'` -> returns `wanderBehavior(state, entityId, ...)`
  - `'hide_in_room'` -> returns `fleeBehavior` / wait
  - `'berserk'` -> returns `huntBehavior` targeting nearest actor
  - `'tantrum'` -> returns `wanderBehavior` / emote bark
- `src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`: Project Layer B `morale` `StatModifier`s from `memory.moodTier` (`'ecstatic'` -> `+1 morale` on attack/saves/skills; `'breaking'` / `'catatonic'` -> `-2 morale` penalty), adhering strictly to Rule 17 (`StatModifier`, never boolean flags!).
- `src/rendering/inspect_tooltip.ts`: Display `Mood: Happy (74)` (and active Inspiration/Break badge + lowest critical Need if `< NEED_LOW_THRESHOLD`).

---

### Milestone 183 — Designation Layer, Job-Reservation Blackboard, Stockpiles, Hauling AI & Workshop Crafting DAGs

#### Step 183.1: `ColonySimulationState`, `LaborProfileComponent` & Persistence
- **New File (`src/types/colony.types.ts`):**
  ```ts
  export type DesignationKind = 'mine' | 'chop' | 'haul' | 'build' | 'harvest' | 'channel';
  export type LaborKind = 'mining' | 'chopping' | 'hauling' | 'building' | 'harvesting' | 'crafting';
  export type BillRepeatMode = 'do_x_times' | 'maintain_stock' | 'forever';

  export interface VoxelCoord {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }

  export interface TileDesignation {
    readonly id: string;
    readonly kind: DesignationKind;
    readonly areaId: string;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly priority: number;
    readonly blueprintId?: string | undefined;
    readonly targetEntityId?: EntityId | undefined;
    readonly createdTurn: number;
  }

  export interface StockpileZone {
    readonly id: string;
    readonly name: string;
    readonly areaId: string;
    readonly cells: ReadonlyArray<VoxelCoord>;
    readonly allowedTags: ReadonlyArray<string>;
    readonly deniedTags: ReadonlyArray<string>;
    readonly allowedItemIds?: ReadonlyArray<string> | undefined;
    readonly priority: number;
    readonly maxItemsPerCell: number;
  }

  export interface JobReservationToken {
    readonly tokenId: string;
    readonly resourceKey: string;
    readonly jobId: string;
    readonly workerEntityId: EntityId;
    readonly acquiredTurn: number;
    readonly expiresAtTurn: number;
  }

  export interface CraftingBill {
    readonly billId: string;
    readonly recipeId: string;
    readonly repeatMode: BillRepeatMode;
    readonly targetCount: number;
    readonly completedCount: number;
    readonly workProgress: number;
    readonly paused: boolean;
  }

  export interface WorkshopState {
    readonly workshopEntityId: EntityId;
    readonly areaId: string;
    readonly workshopTag: string;
    readonly bills: ReadonlyArray<CraftingBill>;
  }

  export interface TimedTerrainRevert {
    readonly areaId: string;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly revertTileId: string;
    readonly revertTurn: number;
    readonly sourceId: string;
  }

  export interface ColonySimulationState {
    readonly designations: Readonly<Record<string, TileDesignation>>;
    readonly stockpiles: Readonly<Record<string, StockpileZone>>;
    readonly reservations: Readonly<Record<string, JobReservationToken>>;
    readonly workshops: Readonly<Record<string, WorkshopState>>;
    readonly timedTerrainReverts: ReadonlyArray<TimedTerrainRevert>;
  }
  ```
- **Component (`src/types/components/actor_components.types.ts` & `src/types/components.types.ts`):**
  Add `ComponentType.LaborProfile = 'LaborProfile'` and `LaborProfileComponent`:
  ```ts
  export interface ActiveLaborJobState {
    readonly jobId: string;
    readonly kind: LaborKind;
    readonly phase: 'fetch_item' | 'move_to_target' | 'execute' | 'deliver_item';
    readonly targetCoord: VoxelCoord;
    readonly targetEntityId?: EntityId | undefined;
    readonly carriedItemEntityId?: EntityId | undefined;
    readonly destinationCoord?: VoxelCoord | undefined;
    readonly workshopEntityId?: EntityId | undefined;
    readonly billId?: string | undefined;
    readonly blueprintId?: string | undefined;
    readonly reservedResourceKeys: ReadonlyArray<string>;
  }

  export interface LaborProfileComponent {
    readonly type: ComponentType.LaborProfile;
    readonly priorities: Readonly<Record<LaborKind, number>>;
    readonly activeJob?: ActiveLaborJobState | undefined;
  }
  ```
- **Wire into `GameState`, `SerializedGameState`, `save.ts`, `EntityTemplateSchema`, `ecs_spawner.ts`:**
  - Add optional `readonly colonyState?: ColonySimulationState | undefined;` to `GameState` and `SerializedGameState`, persisted directly in `serializeGameState` / `deserializeGameState`.
  - Add optional `laborPriorities` to `EntityTemplateSchema` and hydrate `LaborProfileComponent` in `spawnEntity`.

#### Step 183.2: Conflict-Free Atomic Job-Reservation Blackboard (`src/systems/labor/job_blackboard.ts`)
- Resource key helpers: `tileResourceKey(areaId, x, y, z)`, `entityResourceKey(entityId)`, `workshopResourceKey(workshopEntityId)`.
- `tryAcquireReservation(state, resourceKeys, jobId, workerEntityId, ttlTurns = 40)`:
  - Atomically checks that **every** requested `resourceKey` is either unreserved, expired (`globalTurn >= expiresAtTurn`), or already held by `workerEntityId`.
  - If any key conflicts with another worker, returns `{ state, acquired: false }` with zero partial locks!
  - Otherwise records all tokens in `state.colonyState.reservations` and returns `{ state: nextState, acquired: true }`.
- `releaseReservation`, `releaseAllWorkerReservations(state, workerEntityId)`, `pruneExpiredReservations(state)`.
- **Lifecycle Hygiene:** Invoke `releaseAllWorkerReservations` in `src/systems/death.system.ts` when an actor dies and in `src/systems/map/chunk_streaming.ts` when an entity is evicted to dormant storage.

#### Step 183.3: Spatial Designation Layer (`src/systems/labor/designation.system.ts`)
- `addTileDesignation(state, { kind, x, y, z, priority?, blueprintId?, targetEntityId? })`:
  - Validates legality (`mine`/`channel` requires `tileDef.mineable === true`; `build` requires valid blueprint & non-solid target cell; `harvest` requires harvestable target).
  - Writes to `colonyState.designations["areaId:x,y,z"]`.
- `addRectDesignation`, `removeTileDesignation`, `completeDesignationAt(state, areaId, x, y, z)`, `getActiveDesignationsForArea(state, areaId)`.

#### Step 183.4: Typed Item-Filter Stockpile Zones (`src/systems/labor/stockpile.system.ts`)
- `createStockpileZone(state, zoneInput)` & `updateStockpileFilter(state, stockpileId, filter)`.
- `doesItemMatchStockpile(state, itemEntityId, zone)`:
  - Collects tags from `ItemDefinition.tags` + `TagsComponent.tags`.
  - Rejects if any tag matches `zone.deniedTags`.
  - Accepts if `zone.allowedItemIds` includes `item.itemId`, OR (`zone.allowedTags.length === 0` || any item tag matches `zone.allowedTags`).
- `findBestStockpileCellForItem(state, itemEntityId, workerEntityId, originCoord)`:
  - Evaluates all `stockpiles` in `state.currentAreaId` sorted by descending `priority`, then nearest 3D Manhattan distance.
  - Skips cells that are non-walkable, at `maxItemsPerCell` capacity, or reserved by another worker in `job_blackboard.ts`.
- `findUnstockedHaulItems(state, areaId, workerEntityId)`:
  - Finds positioned `ItemComponent` entities in `areaId` not already resting in a matching highest-priority stockpile cell and not reserved by another worker.

#### Step 183.5: Multi-Step Workshop Crafting DAGs (`src/systems/labor/workshop.system.ts`)
- `registerWorkshop(state, workshopEntityId, workshopTag)` & `enqueueCraftingBill(state, workshopEntityId, billInput)`.
- `resolveNextRunnableBill(state, workshopEntityId, workerEntityId)`:
  - Iterates non-paused bills in queue order; checks repeat condition (`completedCount < targetCount` for `do_x_times`, existing stocked output count `< targetCount` for `maintain_stock`, always true for `forever`).
  - Checks `recipe.requiredInputs` on the workshop tile (or within 1 tile):
    - If all inputs are present -> returns `{ mode: 'craft', bill, recipe }`.
    - If an input is missing locally -> searches area ground/stockpiles for an unreserved matching item -> returns `{ mode: 'haul_input', bill, recipe, sourceItemEntityId, workshopCoord }`!
    - If an input is missing globally -> checks if another bill/recipe produces that input (enabling true multi-step DAG chains like *Boulder -> Cut Stone Blocks -> Masonry Door/Wall*!).
- `advanceWorkshopBillWork(state, actorId, workshopEntityId, billId)`:
  - Increments `bill.workProgress` by work step (scaled by actor Inspiration `work_frenzy` / `inspired_craft` or skill if present).
  - When `workProgress >= recipe.workUnits`: consumes `requiredInputs` entities at the workshop, spawns `recipe.outputs` items at the workshop position, increments `completedCount`, resets `workProgress = 0`, and emits a positive crafting thought via `addTimedThought`!

#### Step 183.6: Priority-Based Labor & Hauling AI (`src/ai/labor.behavior.ts`)
- Registered in `src/systems/ai.system.ts` (`BEHAVIOR_REGISTRY['labor'] = laborBehavior`) and added to `AIBehaviorEntrySchema` (`src/types/campaign/entity.ts`: `z.object({ behaviorId: z.literal('labor'), searchRadius: z.number().int().positive().optional(), weightModifiers: z.record(z.string(), z.number()).optional() })`).
- **Decision Pipeline (Deterministic, Pure Intent Emission):**
  1. **Need Urgency Guard:** If actor has `NeedsComponent` with `nourishment <= NEED_CRITICAL_THRESHOLD` and carries an `edible` item, emit `ApplyIntent('eat', item)`.
  2. **Continue or Select Job:**
     - Inspects `LaborProfileComponent.priorities` (levels `1..4`, skipping `0`).
     - Scores candidate jobs across active area designations (`mine`, `chop`, `build`, `harvest`), runnable workshop bills (`craft` + `haul_input`), and unstocked haul items (`haul`), weighted by `(5 - priorityLevel) * 100 - distance3D`.
     - Ignores resources reserved by other workers (`isResourceReservedByOther`).
  3. **Execute Step via Shared `ActionIntent` Pipeline:**
     - **Haul / Fetch Phase:** If not standing on `sourceItem`, route via `computeHierarchicalNextStep(state, entityId, srcX, srcY, srcZ)` -> emit `MoveIntent`. When standing on `sourceItem`, emit `PickUpIntent`. Once carrying item, route to `destinationCoord` (stockpile cell or workshop tile) -> emit `DropIntent`.
     - **Mine / Chop / Build / Craft / Harvest Phase:** If distance > 1 tile (or different Z), route via `computeHierarchicalNextStep` -> emit `MoveIntent`. When adjacent (or on workshop), emit `ApplyIntent` with verb `'mine' | 'chop' | 'build' | 'craft' | 'harvest'` targeting the tile or workshop entity!
  - Works identically in **Turn-Based** and **RTwP** modes because it only emits standard `Intent`s!

#### Step 183.7: Viewport Overlay Rendering & Inspect Readouts
- `src/rendering/viewport_snapshot.ts`:
  - Render subtle stockpile zone background tint on explored cells belonging to a `StockpileZone`.
  - Render tile designation indicator glyphs/highlights (e.g., amber `%` / highlight border on designated `mine`/`build` tiles).
- `src/rendering/inspect_tooltip.ts`:
  - Show active tile designation kind, stockpile zone name, workshop active bill progress, and actor active labor job.

---

## 5. Default Campaign Feature Showcase, Regression Tests & SSOT Sync

1. **`public/data/campaigns/default/` Showcase (Rule 5):**
   - `tiles.json`: Add declarative `mineable: true`, `minedTileId: "stone_floor"`, `mineYieldItemId: "stone_boulder"`, `mineYieldCount: 1`, `isLoadBearing: true` to `stone_wall`, plus add `obsidian_wall` (`isLoadBearing: true`, `mineable: true`) and `constructed_stone_wall`.
   - `items.json`: Add `stone_boulder` (`tags: ["material:stone", "haulable"]`), `cut_stone_block` (`tags: ["material:stone_block", "haulable"]`), `iron_pickaxe` (`tags: ["tool:mining", "weapon"]`).
   - `rules.json`: Add showcase `materials`, `blueprints` (`stone_wall_blueprint`, `stone_floor_blueprint`), and multi-step `craftingRecipes` (`cut_stone_blocks`: `stone_boulder` -> `cut_stone_block`; `carve_stone_figurine`: `cut_stone_block` -> `stone_figurine`).
   - `ai.json` & `entities.json`: Add `colony_laborer` AI profile (`[{ behaviorId: "labor", searchRadius: 24 }, { behaviorId: "wander" }]`), `masonry_workshop` interactable entity (`tags: ["workshop:masonry"]`), `camp_bed` (`tags: ["furniture:bed"]`), and `quarry_mason` NPC template (`needs`, `laborPriorities`, `ai: "colony_laborer"`).
   - `areas.json`: Place `quarry_mason`, `masonry_workshop`, `camp_bed`, `iron_pickaxe`, and loose `stone_boulder` in `watchtower_overlook` (alongside its multi-Z basement `z = -1` mineable walls) so players can immediately observe live needs/mood, hauling, workshop crafting, mining, and fluids!
2. **Automated Regression Test Suites (`tests/`):**
   - `tests/cellular_physics.test.ts` (M180)
   - `tests/terrain_sculpting.test.ts` (M181 — including D&D 3.5e *Passwall*, *Stone Shape*, *Transmute Rock to Mud*, *Create Water*)
   - `tests/psychology_engine.test.ts` (M182)
   - `tests/colony_labor.test.ts` (M183 — including save/load round-trip and RTwP/Turn-Based determinism)
3. **Documentation & SSOT Sync:**
   - Register all new files in `docs/ssot/ssot_console.json` and `docs/ssot/ssot_dnd35e.json`.
   - Run `bun scripts/map-codebase.ts` to regenerate `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md`.
   - Update `docs/ARCHITECTURE.md` (§9.34) and `docs/MILESTONES.md` (mark M180–M183 complete).
4. **Full 8-Stage Verification (`./verify.sh`):**
   - `[1/8]` `bun x tsc --noEmit`
   - `[2/8]` `bun run format`
   - `[3/8]` `bun run lint --fix`
   - `[4/8]` `bun run lint:arch`
   - `[5/8]` `bun run lint:deadcode`
   - `[6/8]` `bun test`
   - `[7/8]` `bun run build`
   - `[8/8]` `bun run scripts/run-validator.ts`

---

## 6. Key Pitfalls & Risk Mitigations

1. **`exactOptionalPropertyTypes: true`:** Never assign `prop: undefined` on optional properties in object literals; always use conditional spread `...(val !== undefined ? { prop: val } : {})`.
2. **Dead-Code Check (`[5/8] lint:deadcode`):** Every exported function/type in new modules must be imported and exercised by runtime integration or tests, or kept module-private if helper-only.
3. **Architectural Dependency Boundaries (`[4/8] lint:arch`):** Tier 1 Console modules (`src/systems/`, `src/map/`, `src/ai/`) must **never** import from `src/rulesets/dnd35e/`. All cartridge interactions flow exclusively from Tier 2 -> Tier 1 or through `RulesetContract`.
4. **Infinite Fluid/Temp Oscillation:** Ensure fluid equalization transfers only when `sourceDepth - targetDepth >= 2` (preventing 1-unit ping-pong oscillation that would keep chunks permanently dirty) and temperature snaps residual `±1°C` deltas to ambient so chunks reliably auto-sleep!
5. **Reservation Lock Leaks:** Always prune expired reservations and release all locks held by an entity on death (`death.system.ts`) or streaming chunk eviction (`chunk_streaming.ts`).
6. **Disk Spell Parity (`[8/8] run-validator.ts`):** Every new `.json` file added under `public/data/rulesets/dnd35e/spells/` MUST have its exact stem listed in `SPELL_IDS` inside `src/rulesets/dnd35e/system_content_spell_ids.ts`.
7. **Sprite Validator Parity (`[8/8] run-validator.ts`):** Any new tiles, items, or entities added to `public/data/campaigns/default/` MUST reference existing valid `spriteId` keys from the campaign's loaded sprite sheets so `collectMissingSpriteMappings` reports 0 missing sprites.
