# Research Notes — Phase 45: High-Throughput ECS Hot-Path & Chunked `TypedArray` SoA Ground Plane (Milestones 173–175)

**Date:** 2026-11-24  
**Scope:** Milestones 173, 174 & 175 — Performance & World-Scale Architecture Research  
**Target Tiers:** Tier 1 Core Console (`src/types/`, `src/utils/`, `src/core/`, `src/map/`, `src/systems/`, `src/rendering/`, `src/worker/`) + Campaign Adapters (`public/data/campaigns/`)  
**Reference Roadmap:** [MILESTONES.md](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/MILESTONES.md) (Phase 45–48)

---

## 1. Objective & Architectural Strategy

Phase 45 builds the Tier 1 Console spatial and ECS performance substrate required to evolve our roguelike engine toward **Dwarf Fortress (Adventure/World), RimWorld, and other deeply systemic simulations** with **D&D 3.5e** (and future cartridges like tissue/wound rules) layered cleanly on top via `RulesetContract`.

The core design insight verified by codebase inspection is a **Hybrid Split**:
- **Terrain, Materials, Fluids, Temperature, Regions, Flags (High-Volume Spatial Grids):** Stored in **Chunked `TypedArray` Structure-of-Arrays (SoA)** buffers (`~10 bytes/tile`, zero GC churn, zero-copy `ArrayBuffer` worker transfer & IndexedDB storage).
- **Actors, Items, Social/Chronicle State, D&D 3.5e Rulesets (Complex Low/Medium-Count Entities):** Kept in our rich serializable ECS `Record<string, Component>` store — **upgraded** with $O(1)$ incremental spatial indexing and batched per-tick transactions to eliminate map cloning and full-floor rebuild overhead.

Every upgrade preserves **100% backward compatibility** with all 5 existing finite 2D dungeon campaigns, `SerializedGameState`, D&D 3.5e's 4-stage Stat DAG, and all 404 regression tests.

---

## 2. Deep Codebase Inventory & Cross-Referenced Findings

### 2.1 Milestone 173: Incremental $O(1)$ `spatialIndex` & Batched Per-Tick ECS Transactions

- **Current Bottleneck in [`src/core/ecs/ecs_core.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs/ecs_core.ts#L32-L190):**
  - `updateSpatialIndex(state)` scans **every entity** in `state.entities` (`O(N * footprintArea)`) and constructs a brand-new `Map<string, EntityId[]>()` with string keys (`"${x},${y}"`).
  - Both `addComponent(Position)` (`line 99`), `removeComponent(Position)` (`line 125`), and `removeEntity(id)` (`line 181`) call `updateSpatialIndex(nextState)` unconditionally.
  - Across `src/`, there are **`355` calls to `addComponent(`**, plus `updateSpatialIndex` calls in [`ecs_lifecycle.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs/ecs_lifecycle.ts#L235) (`moveToLimbo`), [`save.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/save.ts#L104-L363) (`pruneOrphanEntities`, `deserializeGameState`), [`map.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map.system.ts#L124-L295), [`nemesis_adaptation.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/nemesis/nemesis_adaptation.ts#L244), and [`rivalry/query.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/rivalry/query.ts#L130).
  - Additionally, every single `addComponent` / `removeComponent` call allocates `new Map(state.components)` and `{ ...entityComponents, [type]: component }`, meaning a multi-component sequence (`spawnEntity` runs 10–18 `addComponent` calls, `applyResolvedSpellEffectsToTarget` runs multiple, `displaceEntityStep` + `step` updates move dozens of actors) clones the top-level `Map` dozens of times per turn.

- **Critical Reference-Equality & Immutability Invariants We MUST Preserve:**
  1. [`classifyPresentationComponentDiff`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/presentation_queue.ts#L72-L144): Checks `prev.components !== next.components` and iterates `for (const id of next.entities)` skipping any entity where `pMap === nMap`. **Invariant:** Batched ECS transactions must reuse untouched per-entity component objects (`prev.components.get(id) === next.components.get(id)`), mutating/copying **only** entity component maps actually written in the batch.
  2. `campaignEntityDagCache` (`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`): Relies on immutable `GameState` snapshots between turns/reads and component reference equality.
  3. [`deepFreezeGameState`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/tests/helpers.ts#L248) & RTwP state transitions: All committed states returned to `setGameState` / `applyIntentWithCost` / callers must remain immutable — any internal mutable working maps inside an opt-in `withEcsBatch(state, fn)` scope must never leak mutable references outside `withEcsBatch`.
  4. Multi-tile footprints (`PositionComponent.footprintWidth`, `footprintHeight` >= 1): Incremental removal must clear all old footprint tiles `[oldX .. oldX+fw-1, oldY .. oldY+fh-1]` and insert all new footprint tiles `[newX .. newX+fw-1, newY .. newY+fh-1]` without duplicate IDs in any bucket (`patchSpatialIndexForEntity`).
  5. Preserving public signatures of `addComponent`, `removeComponent`, `removeEntity` keeps all **355+** callers compiling unchanged while letting hot paths (`spawnEntity`, `generateAndPopulateAreaFloor`, multi-step AI/combat resolution) opt into `withEcsBatch`.

---

### 2.2 Milestone 174: Chunked `TypedArray` SoA World Grid (`WorldChunk`), Flyweight Palettes & `MapAccessor`

- **Exact Inventory of `.map.tiles` Coupling Across Codebase (`46` call sites in `33` files):**
  - Core/Loop/Input (`2`): `src/core/loop/intent_cost_resolver.ts` (`1`), `src/core/input/mouse_input.ts` (`1`)
  - Map/FOV (`1`): [`src/map/fov.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/map/fov.ts) (`1`)
  - Movement (`8`): [`src/systems/movement.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/movement.system.ts) (`4`), `src/systems/movement_footprint.ts` (`2`), `src/systems/movement_displacement.ts` (`2`)
  - Systems (`10`): `src/systems/rest.system.ts` (`2`), `src/systems/projectile.system.ts` (`2`), `src/systems/zap.system.ts` (`1`), `src/systems/sound.system.ts` (`1`), `src/systems/reaction.system.ts` (`1`), `src/systems/map.system.ts` (`1`), `src/systems/light_emitter.system.ts` (`1`), `src/systems/inspect.system.ts` (`1`), `src/systems/field.system.ts` (`1`), `src/systems/nemesis/{nemesis_tracker,nemesis_hierarchy}.ts` (`2`)
  - AI & Actions (`2`): `src/ai/follow.behavior.ts` (`1`), `src/actions/debug_handlers.actions.ts` (`1`)
  - Rulesets D&D 3.5e (`10`): `src/rulesets/dnd35e/spatial/terrain_traversal_resolver.ts` (`4`), `combat/immediate_reactions.ts` (`2`), `spatial/stealth_resolver.ts` (`1`), `magic/target_category_filter.ts` (`1`), `magic/counterspell_interrupt.ts` (`1`), `companions.ts` (`1`), `combat/pool_ability_resolver.ts` (`1`), `cartridge/dnd35e_turn_budget.ts` (`1`)
  - Rendering & Editor (`8`): [`src/rendering/viewport_snapshot.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/viewport_snapshot.ts) (`1`), `tactical_snapshot.ts` (`2`), `inspect_tooltip.ts` (`1`), `ui/area_editor.ts` (`2`), `ui/director/director_telemetry_view.ts` (`1`), `editor/simulation/fuzzer_invariants.ts` (`1`)

- **Critical Coordinate-Indexing Gotcha Discovered (`coordToIndex`):**
  - Today [`coordToIndex(x, y, map.width)`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/utils/grid.ts#L8-L10) computes `y * width + x`, and `GameState.cachedFov` (`ReadonlySet<number>`) + `presentation_queue.ts` + `fov.ts` + `sound.system.ts` + `gameplay_input.ts` all index visible tiles using that `number`.
  - **Problem on an unbounded / gigantic streaming plane:** `coordToIndex` breaks on negative coordinates (`x = -5, y = 2`) and collides whenever `x >= width` or chunks grow dynamically!
  - **Solution:** Add signed coordinate packing (`packWorldCoord(x, y)` / `unpackWorldCoord(key)`) storing signed 26-bit `(x, y)` pairs in a single safe JS integer (`±33,554,432` tiles per axis cleanly inside `Number.MAX_SAFE_INTEGER` `2^53 - 1`, zero GC string allocations). Finite legacy `GameMap` areas continue using `coordToIndex` (or `mapAccessor.toTileKey(x, y)`), while streaming chunked maps use `packWorldCoord(x, y)` seamlessly inside `cachedFov` and FOV checks.

- **SoA `WorldChunk` Memory Layout (Aligned with Phases 46 & 47):**
  - Chunk dimension: **`32 × 32 = 1,024` tiles per chunk** (clean balance: `5×5` Ring 0 window = `160×160` live tiles across `25` chunks; ~10 KB/chunk).
  - Contiguous `TypedArray` planes per `WorldChunk`:
    - `tileType: Uint16Array` (`1024` — flyweight index into `TilePaletteRegistry`, `0` = void/unloaded)
    - `materialId: Uint16Array` (`1024` — flyweight material index, `0` = default)
    - `fluid: Uint8Array` (`1024` — high nibble fluid kind, low 3 bits depth `0..7` for Phase 47)
    - `temperature: Int16Array` (`1024` — degrees Celsius/baseline `20` for Phase 47)
    - `flags: Uint8Array` (`1024` — bitmask: `EXPLORED = 1 << 0`, `NATURAL = 1 << 1`, `OUTDOOR = 1 << 2`, `SMOOTHED = 1 << 3`, `DIRTY_CELL = 1 << 4`)
    - `regionId: Uint16Array` (`1024` — HPA\* connected component ID for Phase 46)
  - Chunk metadata: `cx`, `cy`, `cz` (`0` in Phase 45), `dirtyFlags: number` (`CHUNK_DIRTY_PERSIST`, `CHUNK_DIRTY_REGION`, etc.), `lastSimulatedTurn: number`.
  - Note on `GameState.map` serialization: `worldChunks` runtime cache uses native `TypedArray`s cleanly decoupled from `JSON.stringify` (`localStorage` save), while `MapAccessor` (`src/map/map_accessor.ts`) reads/writes either legacy `GameMap.tiles` or `ChunkedWorldGrid` uniformly.

---

### 2.3 Milestone 175: Seamless Overworld Chunk Streaming, Async Worker Prefetch & Delta IndexedDB Persistence

- **Existing Infrastructure Ready to Leverage:**
  - [`src/core/campaign_store.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/campaign_store.ts#L15-L54) already manages an IndexedDB database (`CAMPAIGN_DB_NAME`, `CAMPAIGN_DB_VERSION`); we can add a dedicated [`src/core/chunk_store.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/chunk_store.ts) IndexedDB store (`WORLD_CHUNKS_STORE`) storing raw packed `ArrayBuffer` chunk deltas keyed by `${saveSlotOrCampaignId}:${areaId}:${cx}:${cy}:${cz}` (with an in-memory `Map<string, ArrayBuffer>` driver for headless Bun tests / environments without IndexedDB!).
  - [`src/worker/worker_bridge.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/worker/worker_bridge.ts#L48-L84) and [`src/worker/map.worker.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/worker/map.worker.ts) already execute Vite Web Worker jobs with cooperative main-thread fallbacks. Extending them to support a **pooled chunk worker** transferring generated chunk `ArrayBuffer`s (`postMessage(response, [transferables])`) avoids spawning/destroying a worker per chunk.
  - **Delta-Only Save Strategy (`src/core/save.ts`):**
    - `SerializedGameState` in `localStorage` remains compact JSON (`streamingState?: { areaId, worldSeed, activeOriginChunk, dirtyChunkKeys, evictedChunkEntities }`) — never dumping thousands of untouched terrain tiles into `localStorage`.
    - Clean chunks regenerate deterministically in `< 1 ms` from `hash(worldSeed, areaId, cx, cy, cz)`.
    - Only chunks modified by gameplay (`CHUNK_DIRTY_PERSIST` — explored fog, chopped trees, placed objects, blood/scorch decals, future digging) flush asynchronously to `WORLD_CHUNKS_STORE`.
  - **Declarative Schema Extension (`src/types/campaign/world.ts`):**
    - Add `'streaming_overworld'` to `AreaGeneratorTypeEnum` alongside optional `streamingConfig` (`chunkSize`, `activeRadiusChunks`, `prefetchRadiusChunks`, `worldSeed`, `biomePalette`: water/sand/grass/forest/rock/road tile IDs + encounter density) so any campaign opts in declaratively via JSON (`AGENTS.md` Rule 21).

---

## 3. Architectural Rules & SSOT Ownership Mapping

- **Ruleset-Agnostic Console Boundary (`AGENTS.md` Rule 16):** All Phase 45 primitives (`ecs_core`, `MapAccessor`, `WorldChunk`, `TilePaletteRegistry`, `chunk_streaming`, `chunk_store`, `map.worker`) live strictly in Tier 1 Console (`src/core/`, `src/map/`, `src/systems/`, `src/utils/`, `src/types/`, `src/worker/`) and remain completely agnostic of `dnd35e` / `classic`.
- **Zero Content-ID Branching (Rule 21):** `TilePaletteRegistry` builds dynamically from `campaign.tiles`; `streaming_overworld` reads biome tile IDs from `areaDef.streamingConfig` in campaign JSON (`Rule 12`: no magic biome tile strings in `.ts`).
- **Dependency Layer Discipline (`.dependency-cruiser.cjs`):**
  - `src/utils/` (`packWorldCoord`) stays pure (imports nothing above `constants/`).
  - `src/map/` (`WorldChunk`, `TilePaletteRegistry`, `MapAccessor`, `chunk_generator`, `fov.ts`) may import `types/`, `constants/`, `utils/`, `core/ecs.ts` — never `rendering/` or `editor/`.
  - Headless purity: Worker & IndexedDB modules provide synchronous/in-memory fallbacks when `Worker` or `indexedDB` is unavailable (`bun test` runs cleanly with zero browser mocks required).
- **SSOT Registry Updates Required Per Milestone:** Register any newly created files in [`docs/ssot/ssot_console.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/ssot/ssot_console.json) and regenerate `docs/SSOT_CONSOLE.md` via `bun scripts/map-codebase.ts`.

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream | Downstream | Lateral |
|---|---|---|---|
| **M173: Incremental `spatialIndex` & `withEcsBatch`** | All `355` `addComponent` / `removeComponent` / `removeEntity` callers (`spawnEntity`, `displaceEntityStep`, `moveToLimbo`, etc.) keep existing APIs unchanged | Preserves `PresentationEventQueue` diffing (`pMap === nMap`), `campaignEntityDagCache`, and post-commit `deepFreezeGameState` invariants | `map.system.ts`, `nemesis_adaptation.ts`, `rivalry/query.ts`, `save.ts` keep full `updateSpatialIndex` only for save/area rehydration |
| **M174: `WorldChunk` SoA, `TilePaletteRegistry`, `packWorldCoord` & `MapAccessor`** | Campaign loader / bootstrap initializes `TilePaletteRegistry` from `campaign.tiles` (`WorldChunk` created for chunked areas; finite `GameMap.tiles` wrapped seamlessly) | Migrates `46` `.map.tiles` sites (movement, FOV, viewport/tactical/inspect renderers, D&D 3.5e spatial resolvers, AI, input) onto `MapAccessor` | `AreaEditor` / `director_telemetry_view` / headless test builders construct/wrap finite `GameMap` without breaking static editing |
| **M175: `streaming_overworld`, `chunk_store.ts`, Worker Prefetch & Delta Save** | Declarative `AreaGeneratorTypeEnum` (`'streaming_overworld'`) & `streamingConfig` in campaign `areas.json`; Zod validator & campaign editor schemas | Decouples overworld chunks from `localStorage` JSON payload via `WORLD_CHUNKS_STORE` (`ArrayBuffer` deltas) + handles out-of-range chunk entity sleep/wake | `default` showcase campaign (`outer_crossroads` connection if opted in) & `run-validator.ts` area-connection checks |

---

## 5. Open Design Questions to Confirm Before Drafting `implementation_plan.md` (Step 4)

1. **Incremental Execution Cadence (`AGENTS.md` Rule 13 — Prefer SMALL changes):**
   Phase 45 spans 3 major milestones (M173 ECS Hot-Path → M174 `WorldChunk`/`MapAccessor` Migration → M175 Worker Streaming & IndexedDB Deltas). Should Step 4 draft a focused, code-exact **`implementation_plan.md` for Milestone 173 first** (implement & verify M173 cleanly before drafting M174, then M175), or draft one massive plan covering all 3 milestones upfront? *(Recommendation: plan & execute **M173 → M174 → M175 sequentially**, one `./verify.sh`-clean milestone at a time.)*
2. **Chunk Geometry (`32×32` vs `16×16`):**
   Do you prefer **`32×32` chunks** (`1024` tiles/chunk, `5×5` Ring 0 window = `160×160` tiles, fewer chunk boundary crossings) or **`16×16` chunks** (`256` tiles/chunk, lighter memory when Phase 46 introduces multi-Z vertical slices)? *(Both fit `packWorldCoord`; `32×32` is ideal for ground planes, `16×16` is great once 3D Z-stacks grow tall.)*
3. **Default Showcase Overworld (`AGENTS.md` §5):**
   In M175, should we add a live `streaming_overworld` wilderness zone to the `default` campaign (e.g., an outward exploration portal from `outer_crossroads` so players can walk seamlessly out onto an infinite seed-generated frontier) in addition to unit tests?
