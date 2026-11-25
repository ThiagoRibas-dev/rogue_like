# Phase 46 Research Notes: True Multi-Z Voxel Space, 3D Vision, HPA* Pathfinding & Z-Aware Cartridges

**Scope:** Milestones 176, 177, 178, and 179 (`docs/MILESTONES.md` lines 2435–2457)  
**Prerequisites Completed:** Phase 45 (Milestones 173–175: Incremental `spatialIndex`, `EcsBatch`, `WorldChunk` SoA buffers, `MapAccessor`, `streaming_overworld`, pooled chunk workers, and delta-only IndexedDB persistence).

---

## 1. Reiterated Architectural Rules & Standards

All Phase 46 design and implementation work is governed strictly by `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SSOT_CONSOLE.md`, and `docs/SSOT_DND35E.md`:

1. **Strict TypeScript & ECS Purity (Rules 10–14, §3–§4):** Zero `any`, zero magic gameplay literals, explicit return types, exhaustive `switch` (`assertNever`), `exactOptionalPropertyTypes: true` compliance, flat control flow, and 100% JSON-serializable ECS components (zero `Map`/`Set` inside components; runtime caches like HPA* portal graphs and Dijkstra flow fields live outside ECS components).
2. **Three-Tier Placement Heuristic (Rule 16):**
   - **Tier 1 — Core Console Engine (`src/core/`, `src/map/`, `src/systems/`, `src/ai/`, `src/rendering/`, `src/types/`):** 3D `PositionComponent.z`, 3D `spatialIndex`, multi-Z `WorldChunk` slabs & finite `zSlices`, `MapAccessor` 3D queries, declarative vertical links (`ramp`/`stairs`/`ladder`/`open_air`), `gravity.system.ts`, 3D FOV (`fov_3d.ts`), 3D light attenuation, multi-Z depth-dimmed rendering & Z-slice peeking, `RegionGrid` / HPA* (`region_graph.ts`, `pathfinding_hpa.ts`), and shared Dijkstra Flow Fields (`flow_field.ts`).
   - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`):** 3D `1-2-1-2` distance (`grid_geometry.ts`), 3D spherical/cylindrical AoE (`aoe_rest.ts`, `target_category_filter.ts`), 3D cover & LoE (`cover_senses.ts`), High-Ground `+1` melee bonus (`combat_exchange_phases.ts`), *Fly*/*Climb* altitude hooks, and *Feather Fall* / Slow Fall / Tumble / `1d6` per 10 ft fall resolution.
   - **Tier 3 — System & Campaign Content (`public/data/campaigns/default/*`, `public/data/rulesets/dnd35e/*`):** Multi-Z showcase tiles (`open_air`, `stone_ramp`, `chasm_void`, etc.) and a multi-Z showcase structure/overworld elevation profile in `default` campaign so the default campaign exercises every engine feature (§5).
3. **Zero Content-ID Branching & Declarative Overrides (Rules 17, 19, 21):**
   - Never check `tileId === 'open_air'`, `spellId === 'fly'`, or `spellId === 'feather_fall'` in `.ts` code.
   - Drive vertical geometry from declarative `TileDefinitionSchema` fields (`isOpenAir`, `blocksVerticalLoS`, `hasFloorSupport`, `verticalLink`).
   - Drive *Fly* and *Feather Fall* directly from their already-authored Tier 3 JSON `ruleOverrides` (`can_fly`, `immune_falling_damage`), `StatModifier`s (`fall_damage_reduction_ft`), and semantic tags (`flight:*`).
4. **100% 2D Backwards Compatibility:** All existing 2D finite campaigns (`default`, `dungeons`, etc.) and 423 existing unit tests must continue to run at full 2D speed (`z = 0` default, 2D FOV fast-path when no multi-Z slices exist).

---

## 2. Codebase Audit & Task-to-Architecture Mapping

### Milestone 176: 3D Coordinates (`PositionComponent.z`), Multi-Z Chunks, Ramps/Stairs & Gravity/Falling

#### 2.1 `PositionComponent` & Spatial Indexing
- **Current State:**
  - `src/types/components/world_components.types.ts`: `PositionComponent` has `{ x, y, footprintWidth?, footprintHeight?, facing?, isSqueezing?, sizeRankIndex?, canShareTile?, subTileScale? }` — no `z` field yet.
  - `src/core/ecs/ecs_core.ts`: `getPositionFootprintKeys`, `sameSpatialFootprint`, `patchSpatialIndexInPlace`, `patchSpatialIndexForEntity`, and `updateSpatialIndex` format keys as `` `${x},${y}` ``.
  - **Call-Site Audit:** A full grep across `src/` found **~45 direct `state.spatialIndex.get(...)` call sites** across `actions/`, `ai/`, `core/`, `map/`, `rendering/`, `rulesets/dnd35e/`, and `systems/`, plus **6 test files** that read `state.spatialIndex.get('x,y')` directly (`floor_transition_entity_id_and_loader.test.ts`, `input_scope_and_keymap.test.ts`, `m156_durability_spellbooks_ecology.test.ts`, `dnd35e_size_footprint_movement.test.ts`, `m173_ecs_spatial_batch.test.ts`, `m175_chunk_streaming.test.ts`).
- **Architectural Finding:**
  - Add optional `readonly z?: number | undefined` (defaulting to `0` everywhere omitted) to `PositionComponent` and optional `readonly footprintDepth?: number | undefined` (default `1`) if tall multi-Z creatures are needed later.
  - Introduce canonical SSOT spatial helpers in `src/utils/grid.ts` and `src/core/ecs/ecs_core.ts`:
    - `toSpatialKey(x: number, y: number, z = 0): string`
    - `getEntitiesAtPosition(state: Readonly<GameState>, x: number, y: number, z = 0): ReadonlyArray<EntityId>`
  - Migrate all ~45 `src/` direct `spatialIndex.get(...)` call sites to `getEntitiesAtPosition` / `toSpatialKey` so Z-filtering is enforced consistently across collision, FOV, rendering, spells, crossings, fields, sound, and tooltips.

#### 2.2 3D Integer Coordinate Packing & Multi-Z Storage (`WorldChunk` & Finite `GameMap`)
- **Critical Bit-Budget Finding (`src/utils/grid.ts`, `src/constants/world_chunk.constants.ts`):**
  - Phase 45's `packWorldCoord(x, y)` packs 26 bits for X + 26 bits for Y = **52 bits** (just under `Number.MAX_SAFE_INTEGER` = $2^{53} - 1$). We **cannot** append Z bits on top of 26+26 without losing IEEE-754 integer precision!
  - **3D Packing Solution:** Introduce `packWorldCoord3D(x, y, z = 0)` and `unpackWorldCoord3D(key)` using **20 bits X** ($\pm 524,287$) + **20 bits Y** ($\pm 524,287$) + **12 bits Z** ($\pm 2,047$, i.e. 4,096 vertical stories) = **52 bits exact** ($2^{52} - 1 < 2^{53} - 1$, 100% `Number.isSafeInteger` safe with zero floating-point drift).
  - Keep existing `packWorldCoord(x, y)` / `unpackWorldCoord(key)` for 2D callers or tests that assert 26-bit range, while `ChunkedWorldGrid.chunks`, `dirtyChunkKeys`, and multi-Z `cachedFov` use `packWorldCoord3D` / `unpackWorldCoord3D`.
- **Multi-Z Chunk Architecture (`src/map/world_chunk.ts`, `src/types/world-chunk.types.ts`, `src/core/chunk_store.ts`):**
  - Phase 45 **already** future-proofed `WorldChunk` with `cz: number`, `regionId: Uint16Array`, `CHUNK_DIRTY_REGION`, and the 32-byte binary `RLCK` v1 header (`WORLD_CHUNK_HDR_OFFSET_CZ = 16`, `Int32`), AND `chunk_store.ts` already keys IndexedDB entries as `${scopeKey}:${areaId}:${cx}:${cy}:${cz}`!
  - **1-Z-Slice Slab Model (`cz === z`):** Each `WorldChunk` represents a horizontal `chunkSize × chunkSize` slab at elevation `cz = z`. This preserves the `RLCK` v1 binary format with zero breaking changes, keeps copy-on-write edits to ~2.5 KB per edited slice, and keeps horizontal FOV/rendering/region flood-fill cache-contiguous.
  - `ChunkedWorldGrid` & `SerializedStreamingWorldState` gain `originChunkZ: number` (default `0`), `activeRadiusZ: number` (default e.g. `2`), `minZ: number`, `maxZ: number` (configurable via `StreamingAreaConfigSchema`).
  - `chunk_store.ts` (`overlayPersistedDeltasOnGrid`) updates from `unpackWorldCoord(packed)` with hardcoded `cz = 0` to `unpackWorldCoord3D(packed)` so persisted multi-Z chunk edits hydrate cleanly on cold reload!
  - `chunk_generator.ts` extends `generateWorldChunkFromParams(params, cx, cy, cz)` to synthesize true 3D elevation terrain across `cz` (underground rock/caverns for `cz < surfaceZ`, surface terrain + slope ramps at `cz === surfaceZ`, and `open_air` sky for `cz > surfaceZ`) when multi-Z is enabled on the area's `streamingConfig` (while keeping `minZ === 0 && maxZ === 0` 100% identical to Phase 45 for 2D streaming areas!).
- **Multi-Z Finite Static Maps (`src/types/game-state.types.ts`, `src/types/campaign/world.ts`, `src/map/map_accessor.ts`):**
  - Add optional `zSlices?: Readonly<Record<number, ReadonlyArray<Tile>>>` (and `minZ?: number`, `maxZ?: number`) to `GameMap`, plus optional `zLevels?: Record<string, string[]>` to `StaticMapLayoutSchema` and optional `z?: number` to `placedEntities` / `AreaConnectionSchema`.
  - `MapAccessor` (`isInMapBounds`, `getTileAt`, `getTileIdAt`, `getTileDefAt`, `isTileExploredAt`, `setTileIdAt`, `toMapTileKey`, `isTileKeyInFov`, `markTilesExplored`) gains optional `z = 0` parameter and a `isMultiZMap(map)` helper. At `z = 0` on a finite 2D map, it hits `map.tiles` directly with zero overhead!

#### 2.3 Declarative Vertical Traversal, Ramps/Stairs & Gravity/Falling
- **Declarative Tile Traits (`src/types/campaign/world.ts` — `TileDefinitionSchema`):**
  - `isOpenAir?: boolean` — unsupported sky/chasm/balcony cell.
  - `blocksVerticalLoS?: boolean` — defaults to `!transparent` (allows grates/hatches/open_air to transmit sight & light vertically).
  - `hasFloorSupport?: boolean` — defaults to `walkable && !isOpenAir`.
  - `verticalLink?: 'ramp' | 'stairs_up' | 'stairs_down' | 'stairs_both' | 'ladder'` — declarative vertical movement connector.
  - `isClimbable?: boolean` — walls/cliffs/ladders that support climbing when adjacent.
- **Vertical Movement (`src/types/intents/movement.intents.ts`, `src/systems/movement.system.ts`, `src/systems/movement_displacement.ts`):**
  - Extend `MoveIntent` with optional `readonly dz?: number | undefined` (`-1 | 0 | 1`, default `0`).
  - **Seamless Ramp Transitions:**
    - Ascending: Moving horizontally `(dx, dy)` from a `verticalLink === 'ramp'` tile at `z` into a blocked/solid cell at `(nx, ny, z)` automatically checks whether `(nx, ny, z + 1)` is traversable and supported -> smoothly transitions the actor to `(nx, ny, z + 1)`!
    - Descending: Moving horizontally `(dx, dy)` from `z` into an `isOpenAir` cell at `(nx, ny, z)` whose cell below `(nx, ny, z - 1)` has `verticalLink === 'ramp'` automatically steps down safely onto `(nx, ny, z - 1)` without falling!
  - **Stairs / Ladders / Flight / Climb (`dz !== 0`):**
    - Ascending (`dz = +1`) or descending (`dz = -1`) in-place checks: (a) stair/ladder link on current/destination tile, (b) `movementModes.fly > 0`, or (c) `RulesetContract.canActorAdjustAltitude` (e.g., D&D 3.5e *Climb* wall scaling!).
    - Preserves legacy `PortalComponent` area transitions (`ChangeAreaIntent`) whenever an entity interacts with an area portal.
- **Gravity & Falling System (`src/systems/gravity.system.ts` — New Tier 1 Module):**
  - `isEntitySupportedAt(state, entityId, x, y, z)`: true if tile at `(x, y, z)` has floor support, a live `CrossingComponent` spans `(x, y, z)`, the tile directly below `(x, y, z - 1)` is a load-bearing solid block, OR the actor has active flight (`movementModes.fly > 0`) / active climb hold.
  - `resolveGravityForEntity(state, entityId, options?)`: scans downward `z - 1 .. minZ` (capped by `MAX_FALL_DISTANCE_Z`) until finding a supported landing tile `(x, y, landingZ)`, commits the vertical displacement atomically (preserving multi-tile 3D footprints), emits a `TileEntered` / fall log event, and invokes `RulesetContract.onEntityFallLanded` (or falls back to Console default fall damage for Classic ruleset).
  - Triggered cleanly after `displaceEntityStep` (on voluntary walk, forced push/pull, teleport), after crossing collapse (`destroyCrossingEntity` / `processCrossingsTick`), and on status/flight expiration (`onStatusEffectExpired`).

---

### Milestone 177: Multi-Z Viewport Peeking, 3D Line-of-Sight & Vertical Lighting Propagation

#### 2.4 3D Shadowcasting & Vertical Lighting
- **Current State:**
  - `src/map/fov.ts`: `computeFOV(state, px, py, radius?)` runs 2D `ROT.FOV.PreciseShadowcasting`, checking `getTileDefAt(state, x, y)` and `state.spatialIndex.get(\`${x},${y}\`)`.
  - `src/systems/light_emitter.system.ts`: `ResolvedActiveLightEmitter` has `{ x, y, radiusFt, shadowyRadiusFt, coneAngleDeg?, facing? }`, `evaluateDynamicLightAtTile` uses 2D `Math.hypot(x - ex, y - ey)` and 2D Bresenham LoS (`hasClearLightLineOfSight`).
- **Architectural Design:**
  - Create `src/map/fov_3d.ts` (Tier 1 Console):
    - `has3DLineOfSight(state, x0, y0, z0, x1, y1, z1)`: 3D Bresenham/DDA voxel traversal checking tile `transparent` / `blocksVerticalLoS`, opaque entities (`tags.includes('opaque')`), and `blocksSight` fields.
    - `computeFOV3D(state, px, py, pz, radius)`: runs 2D `PreciseShadowcasting` on slice `pz` for $O(r^2)$ speed, then propagates visibility vertically through every visible vertically-transparent cell (`isOpenAir || blocksVerticalLoS === false`) across `pz - MAX_Z_PEEK_DEPTH .. pz + MAX_Z_PEEK_UP` validated by `has3DLineOfSight`.
    - `computeFOV` in `src/map/fov.ts` delegates to `computeFOV3D` ONLY when `isMultiZMap(state.map)` is true, keeping 2D dungeons on the exact existing $O(r^2)$ path!
  - Update `src/systems/light_emitter.system.ts`:
    - Include `z: pos.z ?? 0` on `ResolvedActiveLightEmitter`.
    - `evaluateDynamicLightAtTile(state, x, y, z = 0)` uses 3D Euclidean distance (`feetPerZLevel` scaling) and `has3DLineOfSight` when `z !== emitter.z`.

#### 2.5 Multi-Z Canvas Rendering, Depth Dimming & Camera Z-Peeking
- **Current State:**
  - `src/rendering/viewport_snapshot.ts` reads `(mapX, mapY)` at single plane, builds `ViewportCellDTO` and `FogOverlayCellDTO`, and queries `state.spatialIndex.get(\`${mapX},${mapY}\`)`.
  - `src/rendering/renderer.ts` diffs `ViewportCellDTO` via `cellEquals`.
  - `src/rendering/tactical_snapshot.ts` renders unit badges for all `state.entities` whose `(x, y)` is in `visibleIndices` (would leak units from other Z-levels if not filtered by `viewZ` / visible depth!).
  - **CRITICAL KEYBINDING CONFLICT DISCOVERED (`src/core/input/command_catalog.ts` line 161):**
    - `action.interact` currently binds `[{ key: '<' }, { key: '>' }, { key: ',' }, { key: '.' }]` in `world_gameplay` and `targeting_inspect`!
    - Registering `<` / `>` for Z-peeking without updating `action.interact` will fail `commandRegistry.detectConflicts()` and existing keybind tests!
- **Architectural Design:**
  - Add ephemeral `readonly cameraZOffset?: number | undefined` (default `0`, not required in saves, resets on area change) to `GameState`, plus `SetCameraZOffsetIntent` / `AdjustCameraZIntent` (`isImmediate: true`) in `src/types/intents/camera.intents.ts` and `src/actions/action.registry.ts`.
  - Effective viewed elevation: `viewZ = (playerPos?.z ?? 0) + (state.cameraZOffset ?? 0)` (clamped to `[minZ, maxZ]`).
  - **Depth-Dimmed Lower Z-Level Rendering (`viewport_snapshot.ts`, `renderer.ts`):**
    - For each viewport cell `(mapX, mapY)` at `viewZ`: if the cell at `viewZ` is `isOpenAir === true`, scan downward `dz = 1..MAX_RENDER_DEPTH_LAYERS` (`3`) until finding a solid/floor tile or entity.
    - Apply deterministic atmospheric depth tinting/dimming (`depthDelta: 0 | 1 | 2 | 3`) to ASCII `fg`/`bg` colors AND emit translucent depth-tint overlay alpha in sprite mode (`fogOverlay` / `depthDelta` on `ViewportCellDTO`), updating `cellEquals` in `renderer.ts` to compare `depthDelta`.
    - Filter `tactical_snapshot.ts` unit badges and `inspect_tooltip.ts` strictly to entities at `viewZ` (or visible through `open_air` at `viewZ - depthDelta`), plus update `targetingMode` and `inspectMode` to carry optional `z?: number`.

---

### Milestone 178: Hierarchical 3D Region Pathfinding (`RegionGrid` / HPA\*) & Shared Dijkstra Flow Fields

#### 2.6 Chunk Connectivity `RegionGrid` & HPA\* Portal Graph
- **Current State:**
  - `src/ai/follow.behavior.ts` (`computeNextStepToward`) creates a fresh `new ROT.Path.AStar` per actor per step on a flat 2D grid — unbounded on huge streaming worlds when a target is unreachable, and blind to Z-levels/ramps/stairs.
  - `WorldChunk` already stores `regionId: Uint16Array` and `CHUNK_DIRTY_REGION = 1 << 1` (`world_chunk.constants.ts`).
- **Architectural Design (New Tier 1 Modules: `src/map/region_graph.ts`, `src/ai/pathfinding_hpa.ts`):**
  - **Per-Chunk Flood-Fill (`rebuildChunkRegions`):** Partitions contiguous walkable cells inside a chunk `(cx, cy, cz)` into local region IDs `1..K` written to `chunk.regionId`, clearing `CHUNK_DIRTY_REGION`.
  - **Portal Graph (`RegionPortalGraph`, cached outside ECS by map/chunk-version):**
    - Extracts horizontal border portal spans between adjacent chunks `(cx, cy, cz)` and `(cx±1, cy±1, cz)`.
    - Extracts vertical ramp/stair/ladder portal edges between `(cx, cy, cz)` and `(cx, cy, cz±1)`.
    - Maintains a Disjoint-Set Union (`componentId`) over all region nodes for **$O(1)$ disconnected-target rejection**!
  - **Finite Map Parity:** Supports finite maps (single-Z or multi-Z `zSlices`) via lightweight virtual `16×16` sector tiling using the exact same `RegionPortalGraph` interface.
  - **3D Hierarchical Pathfinding (`findHierarchicalPath3D`):**
    1. Rejects disconnected `(start, goal)` in $O(1)$ via `componentId` (unless the mover can fly/burrow over barriers).
    2. Runs abstract A\* over the portal graph to find the next waypoint portal.
    3. Refines the immediate local segment with bounded 3D A\* (handling 8-way horizontal + ramp/stair vertical steps, hard-corner diagonals, and multi-tile footprints).

#### 2.7 Shared Multi-Agent Dijkstra Flow Fields (`src/ai/flow_field.ts`)
- **Architectural Design:**
  - `computeFlowField3D(state, goalX, goalY, goalZ, maxRadius)`: computes a bounded 3D Dijkstra distance grid (`Map<number, number>` keyed by `packWorldCoord3D`) outward from `(goalX, goalY, goalZ)` respecting walkability, movement costs, ramps, and stairs.
  - Cached in an ephemeral LRU cache keyed by `(areaId, goalPacked3D, regionVersion)` — zero ECS/save bloat, automatically invalidated whenever any tile edit or chunk mutation sets `CHUNK_DIRTY_REGION` or increments the map topology version.
  - `sampleFlowFieldStep(state, field, entityId, fromX, fromY, fromZ)`: selects the lowest-cost passable neighbor `(dx, dy, dz)` in **$O(1)$** per agent!
  - `computeNextStepToward` in `src/ai/follow.behavior.ts` (and `huntBehavior` / `followBehavior` / `fleeBehavior`) upgrades to accept 3D coordinates `(fromX, fromY, fromZ, goalX, goalY, goalZ)`, leveraging shared Flow Fields for common actor targets (e.g. player/controller) and HPA\* 3D pathfinding for arbitrary 3D goals.

---

### Milestone 179: Z-Aware `RulesetContract` Hooks & D&D 3.5e 3D Mechanics

#### 2.8 Tier 1 `RulesetContract` Extensions (`src/types/ruleset.types.ts`)
All new hooks are **optional** so `classic` and any third-party cartridge remain 100% compatible without breaking changes:
- `measureDistance3DFt?(from: Coord3D, to: Coord3D, feetPerZLevel?: number): number`
- `evaluateElevationCombatModifiers?(state: Readonly<GameState>, attackerId: EntityId, defenderId: EntityId, attackKind: 'melee' | 'ranged'): ElevationCombatModifiers`
- `onEntityFallLanded?(state: GameState, entityId: EntityId, fallContext: EntityFallContext): GameState`
- `canActorAdjustAltitude?(state: Readonly<GameState>, entityId: EntityId, dz: number): AltitudeAdjustmentCheck`
- Add optional `z?: number` to `onActorMovementStep` (`fromPos`/`toPos`), `resolveAimedAction` (`targetPos`), `DisplacementResult.finalPos`, `onCrossingCollapsedForOccupant`, and `onEntityDied`.

#### 2.9 Tier 2 D&D 3.5e 3D Mechanics (`src/rulesets/dnd35e/**`)
- **Critical Existing Gap Discovered (`dnd35e_ruleset.ts:262`):**
  - `getEntityMovementModes` currently returns only static `getDnD35EntityData(state, entityId).movementModes`, ignoring active DAG `ruleOverrides` (`can_fly` from `fly.json`!).
  - **Fix:** Resolve dynamic `MovementModes` from static `dndData.movementModes` merged with active DAG `ruleOverrides` (`can_fly` -> derive fly speed `60 ft`, or `40 ft` in medium/heavy armor/load per SRD *Fly*, plus any `fly_speed`/`climb_speed` modifiers) with **zero spell-ID hardcoding**.
- **3D `1-2-1-2` Distance (`src/rulesets/dnd35e/spatial/grid_geometry.ts`):**
  - `measureDnD35Distance3DFt(x1, y1, z1, x2, y2, z2, feetPerZLevel)`: converts `dz` to 5-ft vertical units and extends the `1-2-1-2` alternating diagonal rule symmetrically across 3 axes (reducing identically to `measureDnD35DistanceFt` when `z1 === z2`).
- **3D Spell Spheres & Cover (`aoe_rest.ts`, `cover_senses.ts`, `target_category_filter.ts`, `spell_cast_resolver.ts`):**
  - Add `evaluateCover3D` (3D Bresenham/DDA ray checking solid walls, ceilings, floors, and parapet/cliff-edge grazing cover).
  - Add `computeAoEAffectedSquares3D` (for `burst` spheres, `spread` 3D flood-fill around ledges/openings, `cone`, `line`, and `cylinder`), updating `enumerateSpellTargets` so *Fireball* hits elevated/flying/pit targets within its 20-ft 3D sphere while respecting floor/ceiling Total Cover!
- **High-Ground `+1` Melee Attack Bonus (`combat_exchange_phases.ts`):**
  - In `resolveStrikePreAttackContext`, when `attackerZ > defenderZ` (and within 3D melee reach), add `HIGH_GROUND_MELEE_ATTACK_BONUS = 1` with label `[High Ground +1]`.
- ***Feather Fall*, Slow Fall, Tumble & `1d6`/10 ft Falling (`terrain_traversal_resolver.ts` + `dnd35e_ruleset.ts`):**
  - `onDnD35eEntityFallLanded` inspects DAG `ruleOverrides` (`immune_falling_damage`, already authored in `public/data/rulesets/dnd35e/spells/feather_fall.json`!), `fall_damage_reduction_ft` StatModifiers (Monk Slow Fall), intentional jump / Tumble DC 15 (`-10 ft`), and water landings, then rolls `Math.min(20, Math.floor(effectiveFt / 10))` × `1d6` bludgeoning falling damage + `'prone'`.
- ***Climb* Wall Scaling (`canActorAdjustAltitude`):**
  - Allows actors adjacent to a climbable wall (`isClimbable` or solid wall) to move vertically (`dz = ±1`) via a D&D 3.5e `Climb` check (or automatically with natural `climb > 0`, `+2` circumstance bonus with `climbing_kit` tag), without hardcoding item or feat IDs.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers, Emitters, Authors, Tests) | Downstream (Consumers, Renderers, Validators, Saves) | Lateral (Siblings, Campaigns, Docs, Registries) |
| :--- | :--- | :--- | :--- |
| **`PositionComponent.z` & `spatialIndex` 3D keys (`toSpatialKey` / `getEntitiesAtPosition`)** | `ecs_core.ts`, `ecs_batch.ts`, `ecs_lifecycle.ts`, `ecs_spawner.ts`, `movement_displacement.ts`, `movement.system.ts`, ~45 `spatialIndex.get` call sites, 6 test files reading `spatialIndex` directly | `viewport_snapshot.ts`, `tactical_snapshot.ts`, `inspect_tooltip.ts`, `fov.ts`, `fov_3d.ts`, `crossing.system.ts`, `field.system.ts`, `sound.system.ts`, `projectile.system.ts`, `zap.system.ts`, `save.ts` (`updateSpatialIndex` on deserialize) | `fuzzer_invariants.ts`, `DebugOverlay.tsx`, `SSOT_CONSOLE.md` |
| **3D Packed Keys (`packWorldCoord3D`, `unpackWorldCoord3D`) & Multi-Z `WorldChunk` / `GameMap.zSlices`** | `grid.ts`, `world_chunk.constants.ts`, `map_accessor.ts`, `chunk_generator.ts`, `chunk_streaming.ts`, `worker_bridge.ts`, `map.worker.ts` | `chunk_store.ts` (`overlayPersistedDeltasOnGrid`), `save.ts` (`SerializedStreamingWorldState`), `fov_3d.ts`, `viewport_snapshot.ts`, `area.validator.ts` | `world.ts` (`StaticMapLayoutSchema`, `StreamingAreaConfigSchema`, `TileDefinitionSchema`), `ai-prompt-kit/` schema contract, `default/areas.json` & `default/tiles.json` |
| **Vertical Traversal (`MoveIntent.dz`, Ramps/Stairs) & `gravity.system.ts`** | `movement.system.ts`, `movement_displacement.ts`, `movement_footprint.ts`, `crossing.system.ts` (collapse), `status-effect.system.ts` (flight expiry), `gameplay_input.ts` | `lifecycle.system.ts` (`runActorMovementStep`), `intent_cost_resolver.ts` (energy cost + window sliding on Z), `RulesetContract.onEntityFallLanded`, `canActorAdjustAltitude` | `dnd35e_turn_budget.ts` (vertical movement feet accounting), `dnd35e_lifecycle_adapter.ts`, `companion_targeting.ts` / `follow.behavior.ts` (companions following across Z) |
| **3D FOV (`fov_3d.ts`), Vertical Light & Multi-Z Depth Renderer / Z-Peeking** | `map.system.ts` (`updateExploredTiles`), `light_emitter.system.ts`, `camera.ts`, `command_catalog.ts`, `gameplay_input.ts`, `action.registry.ts` | `viewport_snapshot.ts`, `viewport_snapshot.types.ts`, `renderer.ts` (`cellEquals`), `tactical_snapshot.ts`, `vfx_overlay.ui.ts`, `inspect_tooltip.ts`, HUD Z-indicator component | `presentation_queue.ts` (detect `cameraZOffset` dirtying `PresentationDomain.Map`), `input_scope_and_keymap.test.ts` (conflict check), `cover_senses.ts` (`resolveTileLightReading`) |
| **HPA\* `RegionGrid` (`region_graph.ts`, `pathfinding_hpa.ts`) & Shared Dijkstra Flow Fields (`flow_field.ts`)** | `map_accessor.ts` (`setTileIdAt` sets `CHUNK_DIRTY_REGION`), `chunk_streaming.ts` (eviction/load invalidates graph), `durability.system.ts` (door open/close invalidates region) | `ai/follow.behavior.ts` (`computeNextStepToward`), `ai/hunt.behavior.ts`, `ai/flee.behavior.ts`, `ai/ranged.behavior.ts` | `SSOT_CONSOLE.md`, `ssot_console.json`, Phase 47 hauling/labor AI readiness |
| **Z-Aware `RulesetContract` & D&D 3.5e 3D Mechanics** | `ruleset.types.ts`, `dnd35e_ruleset.ts`, `grid_geometry.ts`, `cover_senses.ts`, `aoe_rest.ts`, `target_category_filter.ts`, `spell_cast_resolver.ts`, `combat_exchange_phases.ts`, `terrain_traversal_resolver.ts` | `classic_ruleset.ts` (unaffected due to optional hooks), `dnd35e_combat_adapter.ts`, `flanking_graph.ts`, `charge_resolver.ts`, `spell.behavior.ts` | `public/data/rulesets/dnd35e/spells/{fly,feather_fall,fireball}.json` (already declarative!), `SSOT_DND35E.md`, `ARCHITECTURE.md` |

---

## 4. Open Architectural Decisions (Confirm Before Drafting Implementation Plan)

Per `AGENTS.md` Rules 6 & 7, please review and confirm the following **4 key design decisions** before we proceed to Step 4 (`docs/implementation_plan.md`):

1. **Vertical Scale (`FEET_PER_Z_LEVEL`): `5 ft` (Isotropic Voxel) vs. `10 ft` (Story Scale)?**
   - **Option A (Recommended): `5 ft` per Z-level default** (configurable via `campaign.rules.map.feetPerZLevel`, default `5`).
     - *Why:* Matches D&D 3.5e's 5-ft cubic grid isotropically — a 20-ft *Fireball* sphere has an exact 4-voxel radius in X, Y, and Z; a Medium creature on a 5-ft elevated ledge/ramp (`z + 1`) can still make a 5-ft melee attack with the `+1` High Ground bonus against a target at `z = 0`; falling `2` Z-levels = `10 ft` = `1d6` damage (`1` Z-level = safe hop down!).
   - **Option B: `10 ft` per Z-level** (1 Z-level = 1 architectural story; falling `1` Z-level = `10 ft` = `1d6` damage, though melee attackers at `z + 1` require 10-ft reach to hit `z = 0`).

2. **`spatialIndex` Key Format: Uniform `"x,y,z"` vs. Hybrid `"x,y"` at `z = 0`?**
   - **Option A (Recommended): Uniform `"x,y,z"` via `toSpatialKey(x, y, z = 0)` and `getEntitiesAtPosition(state, x, y, z = 0)`.**
     - *Why:* Matches `docs/MILESTONES.md` (`"x,y,z"`), eliminates conditional branching on `z === 0`, and migrates all ~45 `src/` callers plus the 6 unit tests cleanly onto the SSOT helper.
   - **Option B: Hybrid (`"x,y"` when `z === 0`, `"x,y,z"` when `z !== 0`).**
     - Preserves raw string lookups like `spatialIndex.get('5,5')` in legacy tests untouched, at the cost of a branch inside `toSpatialKey`.

3. **Keybinding Split for `<`/`>` vs. Z-Slice Peeking (`command_catalog.ts` Conflict):**
   - Currently, `action.interact` binds `['<', '>', ',', '.']`.
   - **Recommended Conflict-Free Layout:**
     - **Vertical Movement (`move.up_z` / `move.down_z`):** `<` (ascend stairs/ladder/fly/climb, or trigger up-portal) and `>` (descend stairs/ladder/fly/climb, or trigger down-portal).
     - **Smart Interact (`action.interact`):** `,` and `.` (still works on portals, containers, NPCs, items).
     - **Z-Slice Camera Peeking (`camera.peek_z_up` / `camera.peek_z_down` / `camera.peek_z_reset`):** `PageUp` / `PageDown` (plus `[` / `]` as secondary bindings, and `Home` to snap back to player's Z). Inside Look/Inspect (`x`) or Aim/Target (`f`) mode, `<` / `>` also shift the cursor's Z-slice up/down!
   - Would you like this layout, or prefer `<`/`>` exclusively for Z-slice peeking?

4. **Default Campaign Multi-Z Showcase:**
   - Per `AGENTS.md` §5 (*"The `default` campaign must represent ALL of the game's engine features"*), we propose adding:
     - New declarative tiles in `public/data/campaigns/default/tiles.json`: `open_air` (`isOpenAir: true`, `transparent: true`, `blocksVerticalLoS: false`), `stone_ramp` (`verticalLink: 'ramp'`), `wooden_stairs_up` / `wooden_stairs_down` (`verticalLink: 'stairs_up' | 'stairs_down'`), and `climbable_wall` (`isClimbable: true`).
     - A multi-story showcase area (e.g., a 3-level **Watchtower / Overlook** connected from `outer_crossroads` with `z = 0` courtyard, `z = 1` ramp-accessible battlement overlooking `open_air`, and `z = -1` cellar/pit) AND enabling multi-Z strata (`minZ: -2, maxZ: 2`) on `endless_frontier`!
   - Confirm if this showcase layout sounds good!
