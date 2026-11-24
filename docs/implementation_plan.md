# Implementation Plan — Phase 45: High-Throughput ECS Hot-Path & Chunked `TypedArray` SoA Ground Plane (Milestones 173, 174 & 175)

**Date:** 2026-11-24  
**Status:** Drafted for User Approval (`AGENTS.md` §1 Steps 4 & 5 Complete — awaiting explicit authorization before writing `.ts`/`.json` files)  
**Confirmed Research:** [`docs/research_notes.md`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/research_notes.md)  
**Roadmap Reference:** [`docs/MILESTONES.md`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/MILESTONES.md) (Phase 45 — Milestones 173, 174, 175)  
**Target Architecture:** Tier 1 Core Console (`src/types/`, `src/constants/`, `src/utils/`, `src/core/`, `src/map/`, `src/systems/`, `src/rendering/`, `src/worker/`, `src/editor/`) + D&D 3.5e Spatial Adapter Callers (`src/rulesets/dnd35e/**`) + Showcase Data (`public/data/campaigns/default/`)

---

## 1. Confirmed Design Decisions & Architectural Constraints

1. **Combined Phase 45 Delivery Scope:**
   This unified plan covers **Milestone 173** (Incremental $O(1)$ `spatialIndex` & Batched ECS Transactions), **Milestone 174** (`WorldChunk` SoA `TypedArray`s, `TilePaletteRegistry`, signed `packWorldCoord`, `MapAccessor` & full 46-site `.map.tiles` + 10-site `cachedFov` migration), and **Milestone 175** (`streaming_overworld` generator, pooled batched chunk worker, Ring 0/1/2 windowing & entity sleep/wake, delta-only IndexedDB `WORLD_CHUNKS_STORE`, and `default` showcase frontier). Execution during Phase 2 proceeds cleanly M173 → M174 → M175 so each layer stabilizes on top of the previous one.
2. **Configurable Chunk Geometry (`DEFAULT_CHUNK_SIZE = 16`, Benchmarkable):**
   - `DEFAULT_CHUNK_SIZE = 16` (`MIN_CHUNK_SIZE = 8`, `MAX_CHUNK_SIZE = 64`), yielding `256` tiles (`~2.5 KB` SoA) per chunk at default while letting any campaign area override `streamingConfig.chunkSize` (e.g., `16`, `24`, `32`) for empirical benchmarking with zero `.ts` changes.
   - All chunk math (`worldToChunkCoord`, `worldToLocalCoord`, `worldToLocalIndex`, `WorldChunk.size`, `ChunkedWorldGrid.chunkSize`, `serializeWorldChunkToBuffer`) takes `chunkSize` explicitly rather than hardcoding a constant shift.
3. **Batched Worker Generation:**
   - Ring 1 prefetch dispatches an entire array of `(cx, cy, cz)` coordinates in a single `postMessage` (`generate_chunk_batch`) to a persistent pooled `map.worker.ts` and receives transferable `ArrayBuffer`s (`zero-copy`), completely neutralizing the 4× worker-message overhead of `16×16` chunks.
4. **`default` Campaign Streaming Showcase & Mirror Parity:**
   - Connect `outer_crossroads` bidirectionally to a new `endless_frontier` (`generatorType: "streaming_overworld"`, `chunkSize: 16`) in `public/data/campaigns/default/areas.json`.
   - Re-run `bun scripts/generate-ai-prompt-kit.ts` so `ai-prompt-kit/` remains in 100% parity (checked by `scripts/run-validator.ts`).
5. **Compiler, Dependency-Cruiser, File-Length & SSOT Guardrails:**
   - `exactOptionalPropertyTypes: true`: omit optional properties rather than assigning `undefined`.
   - Zero `any`, zero magic gameplay literals, explicit return types on all exported functions, exhaustive `switch` checks with `assertNever`, JSDoc on every exported symbol.
   - Pure types live in `src/types/world-chunk.types.ts` (keeping `src/types/game-state.types.ts` downward-only per `.dependency-cruiser.cjs`).
   - All new `.ts` files stay strictly `<= 300` lines (`verify.sh` stage `[4b/8]`).
   - Register every new `.ts` file in [`docs/ssot/ssot_console.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/ssot/ssot_console.json) and run `bun scripts/map-codebase.ts` so `scripts/run-validator.ts` reports 0 SSOT parity errors.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner (After Phase 45) | Evicted Old Brain / Legacy Pattern | Compatibility Bridge |
|---|---|---|---|
| **Incremental `spatialIndex` Patching** (`patchSpatialIndexForEntity`, `patchSpatialIndexInPlace`) | [`src/core/ecs/ecs_core.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs/ecs_core.ts) (re-exported via [`src/core/ecs.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs.ts)) | Unconditional full-floor $O(N)$ `updateSpatialIndex(nextState)` inside `addComponent(Position)`, `removeComponent(Position)`, `removeEntity`, `moveToLimbo` | `updateSpatialIndex` retained strictly for full save/load & floor transition rehydration |
| **Batched ECS Transactions** (`withEcsBatch`, `withEcsBatchState`) | `src/core/ecs/ecs_batch.ts` (re-exported via `src/core/ecs.ts`) | Repeated `new Map(state.components)` & `{ ...entityComps }` per call in `spawnEntity`, portal assembly, friendly swaps | Existing `addComponent`/`removeComponent`/`removeEntity` keep identical signatures for all 355+ callers |
| **Signed Coordinate Packing & Chunk Math** (`packWorldCoord`, `unpackWorldCoord`, `worldToChunkCoord`, `worldToLocalIndex`) | [`src/utils/grid.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/utils/grid.ts) | Unbounded `y * width + x` (`coordToIndex`) failing on negative or streaming coordinates | `coordToIndex` & `isInBounds` preserved for explicit finite grids / sub-grid buffers |
| **Chunk SoA Types & Binary Constants** | `src/types/world-chunk.types.ts`, `src/constants/world_chunk.constants.ts` | Ad-hoc `Tile[]` object-per-tile arrays for infinite worlds | `GameMap.tiles` preserved for static & finite procedural maps (`chunkGrid === undefined`) |
| **Flyweight Tile Palette** (`buildTilePaletteRegistry`, `getTileIdFromPaletteIndex`, `getPaletteIndexForTileId`) | `src/map/tile_palette.ts` | Repeating raw `tileId: string` per tile in streaming areas | Built dynamically once per campaign from `Object.keys(campaign.tiles).sort()` |
| **`WorldChunk` Lifecycle & Binary Codec** (`createEmptyWorldChunk`, `cloneWorldChunk`, `serializeWorldChunkToBuffer`, `deserializeWorldChunkFromBuffer`) | `src/map/world_chunk.ts` | Heavy JSON tile objects inside `localStorage` | Raw `ArrayBuffer` (magic + header + 6 contiguous `TypedArray` planes) |
| **Unified Tile & FOV Access (`MapAccessor`)** (`isInMapBounds`, `toMapTileKey`, `isTileKeyInFov`, `getTileAt`, `getTileIdAt`, `getTileDefAt`, `isTileExploredAt`, `setTileIdAt`, `markTilesExplored`) | `src/map/map_accessor.ts` | 46 direct `state.map.tiles[coordToIndex(...)]` reads/writes + 10 direct `state.cachedFov.has(coordToIndex(...))` lookups | Bridges finite `GameMap.tiles` AND `GameMap.chunkGrid` seamlessly behind identical helpers |
| **Deterministic Overworld Synthesizer** (`generateWorldChunk`, `createInitialStreamingGrid`) | `src/map/chunk_generator.ts` | Monolithic single-allocation `generateArea` for unbounded wilderness | Integrated into `generateArea` & `generateAreaAsync` when `generatorType === 'streaming_overworld'` |
| **Ring 0/1/2 Streaming & Entity Sleep/Wake** (`updateStreamingWorldWindow`, `rehydrateStreamingWorldAsync`) | `src/systems/map/chunk_streaming.ts` | Keeping entire areas loaded in memory regardless of player distance | Works alongside `areas` cold-storage for finite floors |
| **Delta Chunk Binary Store (`WORLD_CHUNKS_STORE`)** | `src/core/chunk_store.ts` | Serializing massive terrain arrays into `localStorage` (`src/core/save.ts`) | Separate `roguelike_world_chunks` IndexedDB database + in-memory headless fallback for `bun test` |
| **Pooled Batched Chunk Worker** (`generateChunkBatchOffload`, `terminateChunkWorkerPool`) | `src/worker/map.worker.ts`, `src/worker/worker_bridge.ts`, `src/worker/worker.types.ts` | Spawning & terminating a fresh Web Worker per request | Existing `generateMapOffload` preserved cleanly alongside `generateChunkBatchOffload` |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
|---|---|---|---|
| **Streaming overworld opt-in** | Checking `if (areaId === 'endless_frontier')` or checking `campaignId` in TS | `generatorType: 'streaming_overworld'` in `AreaGeneratorTypeEnum` + `AreaDefinitionSchema.streamingConfig` in campaign `areas.json` | **Yes** — any campaign author adds a streaming wilderness purely in `areas.json`. |
| **Chunk size & Ring radii tuning** | Hardcoding `const CHUNK_SIZE = 16` or fixed bitshifts (`>> 4`) in callers | `streamingConfig.chunkSize`, `activeRadiusChunks`, `prefetchRadiusChunks`, `evictRadiusChunks` schema fields backed by `DEFAULT_*` constants | **Yes** — benchmarking `16×16` vs `32×32` is a 1-line JSON field edit. |
| **Overworld biome terrain tiles** | Hardcoding `'grass'`, `'forest_floor'`, `'deep_water'` strings inside `chunk_generator.ts` | `streamingConfig.biomePalette: { water, shore, plains, forest, ridge, road }` referencing campaign `tiles.json` keys (validated in `area.validator.ts`) | **Yes** — works with any campaign's custom tile set (`default`, `dnd35e`, mods). |
| **Flyweight `Uint16Array` tile encoding** | Static TS `enum TileNumericId` mapping known tiles | `buildTilePaletteRegistry(campaign.tiles)` sorts campaign tile keys deterministically (`0 = void`, `1..N = tiles`) | **Yes** — campaign authors add unlimited custom tiles with zero TS edits. |
| **Dirty persistence tracking** | Checking specific tile IDs like `tileId === 'chopped_stump'` to decide what saves | Structural `CHUNK_DIRTY_PERSIST` & `CHUNK_FLAG_EXPLORED` bitmasks flipped automatically by `setTileIdAt` / `markTilesExplored` | **Yes** — any exploration or terrain edit marks the chunk dirty automatically. |

---

## 4. Milestone 173 — Incremental $O(1)$ `spatialIndex` & Batched ECS Transactions

### Step 173.1: Footprint-Scoped Incremental Spatial Patching (`src/core/ecs/ecs_core.ts`)

Add `patchSpatialIndexInPlace` (for `withEcsBatch` / `moveToLimbo` working buffers with copy-on-write on each touched cell bucket so previously frozen snapshot arrays are never mutated) and `patchSpatialIndexForEntity` (for single immutable `addComponent`/`removeComponent`/`removeEntity` calls). Keep `isEntityIdInUse` exported so `ecs_batch.ts` reuses it cleanly.

```ts
// src/core/ecs/ecs_core.ts

function getPositionCoords(pos: PositionComponent | undefined): ReadonlyArray<string> {
  if (pos === undefined) return [];
  const fw = Math.max(1, pos.footprintWidth ?? 1);
  const fh = Math.max(1, pos.footprintHeight ?? 1);
  const keys: string[] = [];
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      keys.push(`${pos.x + dx},${pos.y + dy}`);
    }
  }
  return keys;
}

function sameFootprint(a: PositionComponent | undefined, b: PositionComponent | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.x === b.x &&
    a.y === b.y &&
    Math.max(1, a.footprintWidth ?? 1) === Math.max(1, b.footprintWidth ?? 1) &&
    Math.max(1, a.footprintHeight ?? 1) === Math.max(1, b.footprintHeight ?? 1)
  );
}

/**
 * Incrementally patches a mutable working spatialIndex Map using copy-on-write on touched bucket arrays,
 * ensuring prior immutable/frozen snapshot buckets are never mutated in place.
 *
 * @param workingIndex Mutable working spatial index Map.
 * @param copiedKeys Set tracking bucket keys already cloned during the current batch.
 * @param entityId Entity whose footprint changed.
 * @param prevPos Previous PositionComponent (or undefined if newly placed).
 * @param nextPos Next PositionComponent (or undefined if removed).
 */
export function patchSpatialIndexInPlace(
  workingIndex: Map<string, ReadonlyArray<EntityId>>,
  copiedKeys: Set<string>,
  entityId: EntityId,
  prevPos: PositionComponent | undefined,
  nextPos: PositionComponent | undefined
): void {
  if (sameFootprint(prevPos, nextPos)) return;

  const ensureMutableBucket = (key: string): EntityId[] => {
    const existing = workingIndex.get(key);
    if (!existing) {
      const created: EntityId[] = [];
      workingIndex.set(key, created);
      copiedKeys.add(key);
      return created;
    }
    if (copiedKeys.has(key)) {
      return existing as EntityId[];
    }
    const cloned = [...existing];
    workingIndex.set(key, cloned);
    copiedKeys.add(key);
    return cloned;
  };

  for (const oldKey of getPositionCoords(prevPos)) {
    const existing = workingIndex.get(oldKey);
    if (!existing) continue;
    const filtered = existing.filter((id) => id !== entityId);
    if (filtered.length === 0) {
      workingIndex.delete(oldKey);
      copiedKeys.delete(oldKey);
    } else if (filtered.length !== existing.length) {
      workingIndex.set(oldKey, filtered);
      copiedKeys.add(oldKey);
    }
  }

  for (const newKey of getPositionCoords(nextPos)) {
    const bucket = ensureMutableBucket(newKey);
    if (!bucket.includes(entityId)) {
      bucket.push(entityId);
    }
  }
}

/**
 * Returns a new spatialIndex Map with only the entity's previous and next footprints updated in O(k).
 *
 * @param spatialIndex Existing spatial index map.
 * @param entityId Target EntityId.
 * @param prevPos Previous PositionComponent or undefined.
 * @param nextPos Next PositionComponent or undefined.
 * @returns Updated spatialIndex Map (or original reference if footprint unchanged).
 */
export function patchSpatialIndexForEntity(
  spatialIndex: ReadonlyMap<string, ReadonlyArray<EntityId>>,
  entityId: EntityId,
  prevPos: PositionComponent | undefined,
  nextPos: PositionComponent | undefined
): ReadonlyMap<string, ReadonlyArray<EntityId>> {
  if (sameFootprint(prevPos, nextPos)) {
    return spatialIndex;
  }
  const nextIndex = new Map<string, ReadonlyArray<EntityId>>(spatialIndex);
  const copiedKeys = new Set<string>();
  patchSpatialIndexInPlace(nextIndex, copiedKeys, entityId, prevPos, nextPos);
  return nextIndex;
}
```

Update `addComponent`, `removeComponent`, and `removeEntity` in `src/core/ecs/ecs_core.ts`:
- `addComponent`: capture `prevPos = entityComponents[ComponentType.Position] as PositionComponent | undefined`. If `component.type === ComponentType.Position`, set `spatialIndex: patchSpatialIndexForEntity(state.spatialIndex, entityId, prevPos, component)`.
- `removeComponent`: capture `prevPos = entityComponents[ComponentType.Position] as PositionComponent | undefined`. If `type === (ComponentType.Position as ComponentType)` and `prevPos !== undefined`, set `spatialIndex: patchSpatialIndexForEntity(state.spatialIndex, entityId, prevPos, undefined)`.
- `removeEntity`: capture `prevPos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined`. Delete `entityId` from `nextComponents`, filter `nextEntities`, and return `{ ...state, entities: nextEntities, components: nextComponents, spatialIndex: prevPos ? patchSpatialIndexForEntity(state.spatialIndex, entityId, prevPos, undefined) : state.spatialIndex }`.

### Step 173.2: Opt-In Batched ECS Transactions (`src/core/ecs/ecs_batch.ts`)

Create `src/core/ecs/ecs_batch.ts` (`~140` lines):
- Maintains `entities` (copied lazily on `createEntity`/`removeEntity`), `components` (`Map` cloned lazily on first write), `clonedEntityRecords: Set<EntityId>` (clones per-entity component object only on first write so untouched entities keep exact reference equality for `classifyPresentationComponentDiff` & `campaignEntityDagCache`), and `spatialIndex` (`Map` cloned lazily with `copiedSpatialKeys` COW).
- When `batch.snapshot()` is called mid-batch (needed when calling sub-helpers like `equipActorDefaultArmaments` or `ruleset.onEntitySpawned`), it commits an immutable `GameState` snapshot and clears `entitiesCopied`/`componentsCopied`/`clonedEntityRecords`/`copiedSpatialKeys` if further writes happen after `snapshot()`, guaranteeing zero post-snapshot mutation!

```ts
// src/core/ecs/ecs_batch.ts

export interface EcsBatch {
  createEntity(): EntityId;
  addComponent<C extends Component>(entityId: EntityId, component: C): void;
  removeComponent(entityId: EntityId, type: ComponentType): void;
  removeEntity(entityId: EntityId): void;
  getComponent<T extends ComponentType>(entityId: EntityId, type: T): Extract<Component, { readonly type: T }> | undefined;
  snapshot(): GameState;
}

export function withEcsBatch<TResult>(
  state: GameState,
  fn: (batch: EcsBatch) => TResult
): { readonly state: GameState; readonly result: TResult } {
  let baseState = state;
  let workingEntities: EntityId[] | null = null;
  let workingComponents: Map<EntityId, Record<string, Component>> | null = null;
  let workingSpatial: Map<string, ReadonlyArray<EntityId>> | null = null;
  let workingNextEntityId = state.nextEntityId;
  let clonedEntityRecords = new Set<EntityId>();
  let copiedSpatialKeys = new Set<string>();
  let entityIdSet: Set<EntityId> | null = null;

  const ensureComponents = (): Map<EntityId, Record<string, Component>> => {
    if (!workingComponents) {
      workingComponents = new Map(baseState.components as ReadonlyMap<EntityId, Record<string, Component>>);
    }
    return workingComponents;
  };

  const ensureWritableEntityRecord = (entityId: EntityId): Record<string, Component> => {
    const comps = ensureComponents();
    const existing = comps.get(entityId);
    if (!existing) {
      const fresh: Record<string, Component> = {};
      comps.set(entityId, fresh);
      clonedEntityRecords.add(entityId);
      return fresh;
    }
    if (clonedEntityRecords.has(entityId)) {
      return existing;
    }
    const copy: Record<string, Component> = { ...existing };
    comps.set(entityId, copy);
    clonedEntityRecords.add(entityId);
    return copy;
  };

  const ensureSpatial = (): Map<string, ReadonlyArray<EntityId>> => {
    if (!workingSpatial) {
      workingSpatial = new Map(baseState.spatialIndex);
    }
    return workingSpatial;
  };

  const commitWorkingState = (): GameState => {
    if (
      workingEntities === null &&
      workingComponents === null &&
      workingSpatial === null &&
      workingNextEntityId === baseState.nextEntityId
    ) {
      return baseState;
    }
    baseState = {
      ...baseState,
      ...(workingEntities !== null ? { entities: workingEntities } : {}),
      ...(workingComponents !== null ? { components: workingComponents } : {}),
      ...(workingSpatial !== null ? { spatialIndex: workingSpatial } : {}),
      ...(workingNextEntityId !== baseState.nextEntityId ? { nextEntityId: workingNextEntityId } : {})
    };
    workingEntities = null;
    workingComponents = null;
    workingSpatial = null;
    clonedEntityRecords = new Set<EntityId>();
    copiedSpatialKeys = new Set<string>();
    entityIdSet = null;
    return baseState;
  };

  const batch: EcsBatch = {
    createEntity(): EntityId {
      let candidateId = workingNextEntityId;
      let newId = toEntityId(candidateId);
      const currentSnapshot = commitIfNeededForIdCheck(baseState, workingComponents);
      while (isEntityIdInUse(currentSnapshot, newId)) {
        candidateId++;
        newId = toEntityId(candidateId);
      }
      workingNextEntityId = candidateId + 1;
      if (!workingEntities) workingEntities = [...baseState.entities];
      workingEntities.push(newId);
      if (entityIdSet) entityIdSet.add(newId);
      const comps = ensureComponents();
      comps.set(newId, {});
      clonedEntityRecords.add(newId);
      return newId;
    },
    addComponent<C extends Component>(entityId: EntityId, component: C): void {
      const record = ensureWritableEntityRecord(entityId);
      const prevPos =
        component.type === ComponentType.Position
          ? (record[ComponentType.Position] as PositionComponent | undefined)
          : undefined;
      record[component.type] = component;
      if (component.type === ComponentType.Position) {
        patchSpatialIndexInPlace(ensureSpatial(), copiedSpatialKeys, entityId, prevPos, component);
      }
    },
    removeComponent(entityId: EntityId, type: ComponentType): void {
      const comps = workingComponents ?? baseState.components;
      const existing = comps.get(entityId);
      if (!existing || existing[type] === undefined) return;
      const record = ensureWritableEntityRecord(entityId);
      const prevPos =
        type === (ComponentType.Position as ComponentType)
          ? (record[ComponentType.Position] as PositionComponent | undefined)
          : undefined;
      delete record[type];
      if (prevPos !== undefined) {
        patchSpatialIndexInPlace(ensureSpatial(), copiedSpatialKeys, entityId, prevPos, undefined);
      }
    },
    removeEntity(entityId: EntityId): void {
      const currentComps = workingComponents ?? baseState.components;
      const existing = currentComps.get(entityId);
      const prevPos = existing?.[ComponentType.Position] as PositionComponent | undefined;
      if (!workingEntities) workingEntities = [...baseState.entities];
      workingEntities = workingEntities.filter((id) => id !== entityId);
      if (entityIdSet) entityIdSet.delete(entityId);
      ensureComponents().delete(entityId);
      clonedEntityRecords.delete(entityId);
      if (prevPos !== undefined) {
        patchSpatialIndexInPlace(ensureSpatial(), copiedSpatialKeys, entityId, prevPos, undefined);
      }
    },
    getComponent<T extends ComponentType>(entityId: EntityId, type: T) {
      const map = workingComponents ?? baseState.components;
      return map.get(entityId)?.[type] as Extract<Component, { readonly type: T }> | undefined;
    },
    snapshot(): GameState {
      return commitWorkingState();
    }
  };

  const result = fn(batch);
  return { state: commitWorkingState(), result };
}
```

### Step 173.3: Hot-Path Call-Site Integration & M173 Tests

1. **`src/core/ecs.ts`**: Export `patchSpatialIndexForEntity`, `patchSpatialIndexInPlace`, `withEcsBatch`, `withEcsBatchState`, `type EcsBatch`.
2. **`src/core/ecs/ecs_spawner.ts`**: Inside `spawnEntity`, assemble core components (`Position`, `Template`, `Renderable`, `Trap`, `Actor`, `Fighter`, `AI`, `Faction`, `Tags`, `Traits`, `Persistent`, `Memory`, `Dialogue`, `Attitude`, `Lock`, `Interactable`, `Structural`, `Player`, `Hunger`, `QuestLog`) inside a single `withEcsBatch` transaction (commit `snapshot()` right before sub-spawners like `initializeActorEquipmentAndInventory` / `shop.inventory` / `staticInventory` / `equipActorDefaultArmaments`, or pass state through cleanly).
3. **`src/core/ecs/ecs_lifecycle.ts`**: Update `moveToLimbo` so instead of calling `updateSpatialIndex`, it clones `state.spatialIndex` once and calls `patchSpatialIndexInPlace(nextSpatial, copiedKeys, id, prevPos, undefined)` only for the moved entities carrying `Position`.
4. **`src/systems/map/map_generation_spawner.ts`**: Wrap generic stair/portal creation in `withEcsBatchState`.
5. **`src/systems/movement.system.ts`**: Wrap friendly swap's double `Position` write inside `withEcsBatchState`.
6. **Tests (`tests/m173_ecs_spatial_batch.test.ts`)**:
   - Test `patchSpatialIndexForEntity` parity against `updateSpatialIndex` for `1×1`, `2×2`, resize, overlap with stationary actors, and `removeEntity`.
   - Test `moveToLimbo` incremental spatial removal matches full `updateSpatialIndex`.
   - Test `withEcsBatch` reference-equality (`prev.components.get(untouchedId) === next.components.get(untouchedId)`) and `deepFreezeGameState` safety (`addComponent` / `snapshot` never mutates frozen prior snapshots).
   - Test 2,000-entity spawn/move micro-benchmark executes in `< 100 ms`.

---

## 5. Milestone 174 — Chunked `TypedArray` SoA World Grid, Flyweight Palettes & `MapAccessor`

### Step 174.1: Chunk Constants & Pure Types

1. **`src/constants/world_chunk.constants.ts`** (New file):
   ```ts
   export const DEFAULT_CHUNK_SIZE = 16 as const;
   export const MIN_CHUNK_SIZE = 8 as const;
   export const MAX_CHUNK_SIZE = 64 as const;

   export const DEFAULT_ACTIVE_RADIUS_CHUNKS = 4 as const;
   export const DEFAULT_PREFETCH_RADIUS_CHUNKS = 6 as const;
   export const DEFAULT_EVICT_RADIUS_CHUNKS = 7 as const;
   export const MAX_PREFETCH_CACHE_CHUNKS = 256 as const;

   export const DEFAULT_AMBIENT_TEMP_C = 20 as const;
   export const VOID_TILE_PALETTE_INDEX = 0 as const;

   export const CHUNK_FLAG_EXPLORED = 1 << 0;
   export const CHUNK_FLAG_NATURAL = 1 << 1;
   export const CHUNK_FLAG_OUTDOOR = 1 << 2;
   export const CHUNK_FLAG_SMOOTHED = 1 << 3;
   export const CHUNK_FLAG_DIRTY_CELL = 1 << 4;

   export const CHUNK_DIRTY_NONE = 0;
   export const CHUNK_DIRTY_PERSIST = 1 << 0;
   export const CHUNK_DIRTY_REGION = 1 << 1;
   export const CHUNK_DIRTY_FLUID = 1 << 2;
   export const CHUNK_DIRTY_TEMP = 1 << 3;

   /** Signed 26-bit coordinate packing constants (supports +/- 33,554,431 tiles per axis safely within 53-bit JS numbers). */
   export const COORD_PACK_BIAS = 33_554_432 as const; // 2^25
   export const COORD_PACK_MULTIPLIER = 67_108_864 as const; // 2^26

   /** IndexedDB database and object store identifiers for streaming chunk delta storage. */
   export const WORLD_CHUNKS_DB_NAME = 'roguelike_world_chunks' as const;
   export const WORLD_CHUNKS_DB_VERSION = 1 as const;
   export const WORLD_CHUNKS_STORE = 'world_chunks' as const;
   export const WORLD_CHUNK_BINARY_MAGIC = 0x524c434b as const; // 'RLCK'
   export const WORLD_CHUNK_BINARY_VERSION = 1 as const;
   export const WORLD_CHUNK_HEADER_BYTES = 32 as const;
   ```
2. **`src/types/world-chunk.types.ts`** (New file):
   ```ts
   import type { Component } from './components.types.ts';
   import type { EntityId } from './game-state.types.ts';

   export interface TilePaletteRegistry {
     readonly indexToTileId: ReadonlyArray<string>;
     readonly tileIdToIndex: Readonly<Record<string, number>>;
   }

   export interface WorldChunk {
     readonly cx: number;
     readonly cy: number;
     readonly cz: number;
     readonly size: number;
     readonly tileType: Uint16Array;
     readonly materialId: Uint16Array;
     readonly fluid: Uint8Array;
     readonly temperature: Int16Array;
     readonly flags: Uint8Array;
     readonly regionId: Uint16Array;
     readonly dirtyFlags: number;
     readonly lastSimulatedTurn: number;
   }

   export interface OwnedDormantEntityRecord {
     readonly entityId: EntityId;
     readonly components: Readonly<Record<string, Component>>;
   }

   export interface DormantChunkEntityRecord {
     readonly entityId: EntityId;
     readonly components: Readonly<Record<string, Component>>;
     readonly ownedEntities: ReadonlyArray<OwnedDormantEntityRecord>;
   }

   export interface StreamingBiomePalette {
     readonly water: string;
     readonly shore: string;
     readonly plains: string;
     readonly forest: string;
     readonly ridge: string;
     readonly road: string;
   }

   export interface ChunkedWorldGrid {
     readonly areaId: string;
     readonly worldSeed: number;
     readonly chunkSize: number;
     readonly activeRadiusChunks: number;
     readonly prefetchRadiusChunks: number;
     readonly evictRadiusChunks: number;
     readonly originChunkX: number;
     readonly originChunkY: number;
     readonly palette: TilePaletteRegistry;
     readonly chunks: ReadonlyMap<number, WorldChunk>;
     readonly dirtyChunkKeys: ReadonlySet<number>;
     readonly evictedChunkEntities: Readonly<Record<string, ReadonlyArray<DormantChunkEntityRecord>>>;
   }

   export interface SerializedStreamingWorldState {
     readonly areaId: string;
     readonly worldSeed: number;
     readonly chunkSize: number;
     readonly activeRadiusChunks: number;
     readonly prefetchRadiusChunks: number;
     readonly evictRadiusChunks: number;
     readonly originChunkX: number;
     readonly originChunkY: number;
     readonly dirtyChunkKeys: ReadonlyArray<number>;
     readonly evictedChunkEntities: Readonly<Record<string, ReadonlyArray<DormantChunkEntityRecord>>>;
   }

   export interface TileSnapshot {
     readonly tileId: string;
     readonly x: number;
     readonly y: number;
     readonly explored: boolean;
   }
   ```
3. **`src/types/game-state.types.ts`**:
   - Import `ChunkedWorldGrid` & `SerializedStreamingWorldState` from `./world-chunk.types.ts`.
   - Add `readonly chunkGrid?: ChunkedWorldGrid | undefined;` to `GameMap`.
   - Add `readonly streamingState?: SerializedStreamingWorldState | undefined;` to `SerializedAreaData` and `SerializedGameState`.

### Step 174.2: Signed World Coordinate Packing (`src/utils/grid.ts`)

Add zero-allocation numeric packing (fits cleanly inside `Number.MAX_SAFE_INTEGER` `2^53 - 1`, never overflows negative coordinates, and pairs identically as the chunk-coordinate key for `(cx, cy)`):
```ts
// src/utils/grid.ts
import { COORD_PACK_BIAS, COORD_PACK_MULTIPLIER } from '../constants/world_chunk.constants.ts';

export function packWorldCoord(x: number, y: number): number {
  return (y + COORD_PACK_BIAS) * COORD_PACK_MULTIPLIER + (x + COORD_PACK_BIAS);
}

export function unpackWorldCoord(key: number): { readonly x: number; readonly y: number } {
  const adjustedX = key % COORD_PACK_MULTIPLIER;
  const x = adjustedX - COORD_PACK_BIAS;
  const y = Math.floor(key / COORD_PACK_MULTIPLIER) - COORD_PACK_BIAS;
  return { x, y };
}

export function worldToChunkCoord(coord: number, chunkSize: number): number {
  return Math.floor(coord / chunkSize);
}

export function worldToLocalCoord(coord: number, chunkSize: number): number {
  return ((coord % chunkSize) + chunkSize) % chunkSize;
}

export function worldToLocalIndex(x: number, y: number, chunkSize: number): number {
  const lx = worldToLocalCoord(x, chunkSize);
  const ly = worldToLocalCoord(y, chunkSize);
  return ly * chunkSize + lx;
}

export function formatChunkKey(cx: number, cy: number, cz = 0): string {
  return `${cx},${cy},${cz}`;
}
```

### Step 174.3: Flyweight Palette & SoA Binary `WorldChunk` (`src/map/tile_palette.ts`, `src/map/world_chunk.ts`)

1. **`src/map/tile_palette.ts`** (`~55` lines):
   - `buildTilePaletteRegistry(tiles)`: iterates `Object.keys(tiles).sort()`, reserves index `0 = ''`, populates `indexToTileId` and `tileIdToIndex`.
   - `getTileIdFromPaletteIndex(palette, index)`: returns `string | undefined` (`index > 0 ? palette.indexToTileId[index] : undefined`).
   - `getPaletteIndexForTileId(palette, tileId)`: returns `palette.tileIdToIndex[tileId] ?? VOID_TILE_PALETTE_INDEX`.
2. **`src/map/world_chunk.ts`** (`~145` lines):
   - `createEmptyWorldChunk(cx, cy, cz, size)`: allocates the 6 `TypedArray`s (`cellCount = size * size`), fills `temperature` with `DEFAULT_AMBIENT_TEMP_C`.
   - `cloneWorldChunk(chunk)`: clones the 6 `TypedArray`s cleanly (`new Uint16Array(chunk.tileType)` etc.) for immutable copy-on-write edits.
   - `serializeWorldChunkToBuffer(chunk): ArrayBuffer`: writes 32-byte `DataView` header (`magic`, `version`, `size`, `cx`, `cy`, `cz`, `dirtyFlags`, `lastSimulatedTurn`) + sequential aligned byte copies of `tileType`, `materialId`, `fluid`, `temperature`, `flags`, `regionId` (`16×16`: `32 + 256 * 10 = 2,592 bytes`).
   - `deserializeWorldChunkFromBuffer(buffer): WorldChunk`: validates magic/version/`size`, constructs new `TypedArray` copies from the buffer.

### Step 174.4: Unified `MapAccessor` Facade (`src/map/map_accessor.ts`)

Create `src/map/map_accessor.ts` (`~195` lines) as the single Tier 1 source of truth bridging finite `GameMap.tiles` and `GameMap.chunkGrid`:

```ts
// src/map/map_accessor.ts

export function isChunkedMap(map: Readonly<GameMap>): boolean {
  return map.chunkGrid !== undefined;
}

export function isInMapBounds(map: Readonly<GameMap>, x: number, y: number): boolean {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    return grid.chunks.has(packWorldCoord(cx, cy));
  }
  return isInBounds(x, y, map.width, map.height);
}

export function toMapTileKey(map: Readonly<GameMap>, x: number, y: number): number {
  return map.chunkGrid !== undefined ? packWorldCoord(x, y) : coordToIndex(x, y, map.width);
}

export function isTileKeyInFov(state: Readonly<GameState>, x: number, y: number): boolean {
  if (state.map.isFullyExplored) return true;
  return state.cachedFov.has(toMapTileKey(state.map, x, y));
}

export function getTileAt(map: Readonly<GameMap>, x: number, y: number): TileSnapshot | undefined {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord(cx, cy));
    if (!chunk) return undefined;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    const paletteIdx = chunk.tileType[localIdx] ?? 0;
    const tileId = getTileIdFromPaletteIndex(grid.palette, paletteIdx);
    if (!tileId) return undefined;
    const explored = ((chunk.flags[localIdx] ?? 0) & CHUNK_FLAG_EXPLORED) !== 0;
    return { tileId, x, y, explored };
  }
  if (!isInBounds(x, y, map.width, map.height)) return undefined;
  return map.tiles[coordToIndex(x, y, map.width)];
}

export function getTileIdAt(map: Readonly<GameMap>, x: number, y: number): string | undefined {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunk = grid.chunks.get(packWorldCoord(cx, cy));
    if (!chunk) return undefined;
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    return getTileIdFromPaletteIndex(grid.palette, chunk.tileType[localIdx] ?? 0);
  }
  if (!isInBounds(x, y, map.width, map.height)) return undefined;
  return map.tiles[coordToIndex(x, y, map.width)]?.tileId;
}

export function getTileDefAt(state: Readonly<GameState>, x: number, y: number): TileDefinition | undefined {
  const tileId = getTileIdAt(state.map, x, y);
  return tileId ? state.campaign.tiles[tileId] : undefined;
}

export function setTileIdAt(map: Readonly<GameMap>, x: number, y: number, tileId: string): GameMap {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    const cx = worldToChunkCoord(x, grid.chunkSize);
    const cy = worldToChunkCoord(y, grid.chunkSize);
    const chunkKey = packWorldCoord(cx, cy);
    const existingChunk = grid.chunks.get(chunkKey);
    if (!existingChunk) return map;
    const nextIdx = getPaletteIndexForTileId(grid.palette, tileId);
    const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
    if (existingChunk.tileType[localIdx] === nextIdx) return map;
    const nextChunk = cloneWorldChunk(existingChunk);
    nextChunk.tileType[localIdx] = nextIdx;
    (nextChunk as { dirtyFlags: number }).dirtyFlags = existingChunk.dirtyFlags | CHUNK_DIRTY_PERSIST;
    const nextChunks = new Map(grid.chunks);
    nextChunks.set(chunkKey, nextChunk);
    const nextDirtyKeys = new Set(grid.dirtyChunkKeys);
    nextDirtyKeys.add(chunkKey);
    return {
      ...map,
      chunkGrid: { ...grid, chunks: nextChunks, dirtyChunkKeys: nextDirtyKeys }
    };
  }
  if (!isInBounds(x, y, map.width, map.height)) return map;
  const idx = coordToIndex(x, y, map.width);
  const existingTile = map.tiles[idx];
  if (!existingTile || existingTile.tileId === tileId) return map;
  const nextTiles = [...map.tiles];
  nextTiles[idx] = { ...existingTile, tileId };
  return { ...map, tiles: nextTiles };
}

export function markTilesExplored(map: Readonly<GameMap>, visibleKeys: ReadonlySet<number>): GameMap {
  const grid = map.chunkGrid;
  if (grid !== undefined) {
    let nextChunks: Map<number, WorldChunk> | null = null;
    let nextDirtyKeys: Set<number> | null = null;
    const clonedChunkKeys = new Set<number>();

    for (const packed of visibleKeys) {
      const { x, y } = unpackWorldCoord(packed);
      const cx = worldToChunkCoord(x, grid.chunkSize);
      const cy = worldToChunkCoord(y, grid.chunkSize);
      const chunkKey = packWorldCoord(cx, cy);
      const curChunk = (nextChunks ?? grid.chunks).get(chunkKey);
      if (!curChunk) continue;
      const localIdx = worldToLocalIndex(x, y, grid.chunkSize);
      const curFlag = curChunk.flags[localIdx] ?? 0;
      if ((curFlag & CHUNK_FLAG_EXPLORED) !== 0) continue;

      let writable = curChunk;
      if (!clonedChunkKeys.has(chunkKey)) {
        writable = cloneWorldChunk(curChunk);
        (writable as { dirtyFlags: number }).dirtyFlags = curChunk.dirtyFlags | CHUNK_DIRTY_PERSIST;
        if (!nextChunks) nextChunks = new Map(grid.chunks);
        nextChunks.set(chunkKey, writable);
        clonedChunkKeys.add(chunkKey);
        if (!nextDirtyKeys) nextDirtyKeys = new Set(grid.dirtyChunkKeys);
        nextDirtyKeys.add(chunkKey);
      }
      writable.flags[localIdx] = curFlag | CHUNK_FLAG_EXPLORED;
    }

    if (!nextChunks) return map;
    return {
      ...map,
      chunkGrid: { ...grid, chunks: nextChunks, dirtyChunkKeys: nextDirtyKeys ?? grid.dirtyChunkKeys }
    };
  }

  let modified = false;
  const nextTiles = map.tiles.map((tile, idx) => {
    if (visibleKeys.has(idx) && !tile.explored) {
      modified = true;
      return { ...tile, explored: true };
    }
    return tile;
  });
  return modified ? { ...map, tiles: nextTiles } : map;
}
```

### Step 174.5: Exhaustive Migration of All `46` `.map.tiles` & `10` `cachedFov` Sites (`33` Files)

Every site replaces raw `state.map.tiles[coordToIndex(...)]` + `isInBounds(x, y, state.map.width, state.map.height)` + `state.cachedFov.has(coordToIndex(...))` with `MapAccessor`:

1. **FOV, Map System & Presentation (`4` files):**
   - [`src/map/fov.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/map/fov.ts): check `getTileDefAt(state, x, y)?.transparent === true`, emit keys with `toMapTileKey(state.map, x, y)`.
   - [`src/systems/map.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map.system.ts): `updateExploredTiles` calls `markTilesExplored(state.map, visibleIndices)`; `getVisibleHostileEntityIds` calls `isTileKeyInFov(state, position.x, position.y)`; companion placement calls `isInMapBounds` + `getTileDefAt`.
   - [`src/core/presentation_queue.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/presentation_queue.ts): `isFootprintInFov(pos, map, fov)` calls `toMapTileKey(map, pos.x + dx, pos.y + dy)`.
2. **Core Loop & Input (`3` files):**
   - [`src/core/loop/intent_cost_resolver.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/loop/intent_cost_resolver.ts): use `getTileDefAt(state, posAfter.x, posAfter.y)?.movementCost ?? 100`.
   - [`src/core/input/mouse_input.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/input/mouse_input.ts): fallback viewport span uses `state.map.width > 0 ? state.map.width : (opts.width ?? DEFAULT_FALLBACK_VIEWPORT_COLS)`, checks `isInMapBounds(state.map, mapX, mapY)`, and uses `getTileDefAt`.
   - [`src/core/input/gameplay_input.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/input/gameplay_input.ts): checks `isTileKeyInFov(state, pos.x, pos.y)`.
3. **Movement & Spatial Placement (`3` files):**
   - [`src/systems/movement.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/movement.system.ts): uses `isInMapBounds`, `getTileAt`, `getTileDefAt`, and replaces `[...state.map.tiles]` + direct bump write with `setTileIdAt(state.map, bumpX, bumpY, bumpTileDef.bumpTransition)`.
   - [`src/systems/movement_footprint.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/movement_footprint.ts): uses `isInMapBounds` and `getTileDefAt` in `isHardCornerWallTile` and `checkRectTilesTraversable`.
   - [`src/systems/movement_displacement.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/movement_displacement.ts): uses `isInMapBounds` and `getTileDefAt`.
4. **Rendering & Tooltips (`5` files):**
   - [`src/rendering/viewport_snapshot.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/viewport_snapshot.ts): replaces finite `[0..width)` check with `const tile = getTileAt(state.map, mapX, mapY);`, `isExplored = tile !== undefined && (state.map.isFullyExplored || tile.explored);`, `isVisible = isTileKeyInFov(state, mapX, mapY);`.
   - [`src/rendering/tactical_snapshot.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/tactical_snapshot.ts): uses `isInMapBounds`, `getTileDefAt`, and `isTileKeyInFov` (replacing direct `visibleIndices.has(tileIdx)` so tactical overlay/FOV fog works seamlessly on negative & chunked coords!).
   - [`src/rendering/inspect_tooltip.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/inspect_tooltip.ts): uses `getTileAt`.
   - [`src/rendering/ui/hud_alerts.ui.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud_alerts.ui.ts): uses `isTileKeyInFov`.
   - [`src/rendering/ui/area_editor.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/area_editor.ts) & [`src/rendering/ui/director/director_telemetry_view.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/director/director_telemetry_view.ts): read via `getTileAt(generated.map, x, y)` (previewing a centered window when `chunkGrid !== undefined`!).
5. **Other Console Systems, AI, Targeting, Actions & Editor (`13` files):**
   - `src/systems/rest.system.ts`, `src/systems/projectile.system.ts`, `src/systems/zap.system.ts`, `src/systems/sound.system.ts`, `src/systems/reaction.system.ts`, `src/systems/light_emitter.system.ts`, `src/systems/inspect.system.ts`, `src/systems/targeting.system.ts` (bounds guard when chunked), `src/systems/field.system.ts`, `src/systems/world_clock.system.ts` (uses `isTileKeyInFov`), `src/ai/follow.behavior.ts`, `src/ai/companion_targeting.ts`, `src/actions/debug_handlers.actions.ts`, `src/editor/simulation/fuzzer_invariants.ts`, `src/systems/map/map_generation_spawner.ts`, `src/systems/map/map_wake_respawn.ts`.
   - `src/systems/nemesis/nemesis_hierarchy.ts` & `src/systems/nemesis/nemesis_tracker.ts`: add `findRandomWalkableCoord(state)` in `map_accessor.ts` (samples `[0..width)`/`[0..height)` on finite maps OR active Ring 0 loaded chunk tiles on streaming maps!).
6. **D&D 3.5e Spatial & Lifecycle Consumers (`9` files):**
   - `src/rulesets/dnd35e/spatial/terrain_traversal_resolver.ts` (`4` sites)
   - `src/rulesets/dnd35e/spatial/stealth_resolver.ts` (`1` site)
   - `src/rulesets/dnd35e/combat/immediate_reactions.ts` (`2` sites)
   - `src/rulesets/dnd35e/combat/pool_ability_resolver.ts` (`1` site)
   - `src/rulesets/dnd35e/magic/target_category_filter.ts` (`1` site)
   - `src/rulesets/dnd35e/magic/counterspell_interrupt.ts` (`1` site)
   - `src/rulesets/dnd35e/companions.ts` (`1` site)
   - `src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts` (`1` site)
   - `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (`isTileKeyInFov`)

### Step 174.6: M174 Tests (`tests/m174_world_chunk_accessor.test.ts`)

- Verify `packWorldCoord`/`unpackWorldCoord` exact round-trip across `(0,0)`, `(-1,-1)`, `(-50000, 123456)`, `(-33554431, 33554431)`.
- Verify `buildTilePaletteRegistry` key-order determinism and round-trip with `getTileIdFromPaletteIndex` / `getPaletteIndexForTileId`.
- Verify `serializeWorldChunkToBuffer` + `deserializeWorldChunkFromBuffer` preserves all 6 `TypedArray` planes, flags, and metadata across both `chunkSize: 16` and `chunkSize: 32`.
- Verify `MapAccessor` (`getTileAt`, `setTileIdAt`, `markTilesExplored`, `isTileKeyInFov`) parity on finite `GameMap` AND `ChunkedWorldGrid`, plus zero regression across negative world coordinates and chunk borders (`x = -1 <-> 0`).

---

## 6. Milestone 175 — `streaming_overworld`, Pooled Batched Worker & Delta Persistence

### Step 175.1: Declarative Overworld Schema (`src/types/campaign/world.ts`)

```ts
// src/types/campaign/world.ts

export const AreaGeneratorTypeEnum = z.enum(['digger', 'cellular', 'static', 'dla', 'streaming_overworld']);

export const StreamingBiomePaletteSchema = z.object({
  water: z.string().describe('Water/lake Tile ID'),
  shore: z.string().optional().describe('Shoreline/sand Tile ID (falls back to plains)'),
  plains: z.string().describe('Primary open ground Tile ID'),
  forest: z.string().optional().describe('Forest/overgrown ground Tile ID (falls back to plains)'),
  ridge: z.string().describe('Impassable mountain/cliff ridge Tile ID'),
  road: z.string().optional().describe('Road/path Tile ID (falls back to plains)')
});
export type StreamingBiomePalette = z.infer<typeof StreamingBiomePaletteSchema>;

export const StreamingAreaConfigSchema = z.object({
  chunkSize: z.number().int().min(8).max(64).default(16),
  activeRadiusChunks: z.number().int().min(1).max(12).default(4),
  prefetchRadiusChunks: z.number().int().min(1).max(16).default(6),
  evictRadiusChunks: z.number().int().min(2).max(20).optional(),
  worldSeed: z.number().int().default(1337),
  spawnClearingRadius: z.number().int().min(1).max(16).default(4),
  biomePalette: StreamingBiomePaletteSchema
});
export type StreamingAreaConfig = z.infer<typeof StreamingAreaConfigSchema>;
```
Add `streamingConfig: StreamingAreaConfigSchema.optional()` to `AreaDefinitionSchema`.

### Step 175.2: Deterministic Chunk Generator (`src/map/chunk_generator.ts`)

Create `src/map/chunk_generator.ts` (`~195` lines), completely pure and runnable both on the main thread and inside `map.worker.ts`:
- Hash helper `hashWorldCoord(seed, areaHash, x, y): number` (32-bit FNV/Murmur mix, pure integer math, zero `ROT.RNG` global mutation!).
- Continuous multi-octave bilinear value noise (`sampleFractalNoise(seed, areaHash, wx, wy, scale, octaves)`) producing deterministic `[0, 1]` elevation & moisture fields seamlessly across arbitrary positive and negative `(cx, cy)` boundaries with zero visible chunk seams!
- Biome classification using `palette`:
  - Clearing within `distanceSq(wx, wy, 0, 0) <= spawnClearingRadius^2` forces walkable `road`/`plains` so initial spawn & return portals are unconditionally passable.
  - Road spline passing near `(0, 0)` adds subtle traversable corridors.
  - Elevation/moisture bands choose `water`, `shore`, `plains`, `forest`, or `ridge`.
  - Sets `CHUNK_FLAG_NATURAL | (environmentType === 'outdoors' ? CHUNK_FLAG_OUTDOOR : 0)` in `flags[i]`.
- `createInitialStreamingGrid(campaign, areaDef, originCx = 0, originCy = 0): ChunkedWorldGrid`: builds `TilePaletteRegistry` once, generates initial `(originCx ± activeRadiusChunks, originCy ± activeRadiusChunks)` chunks, and returns `ChunkedWorldGrid`.
- Update `src/map/generator.ts` and `src/map/generator_async.ts` to handle `areaDef.generatorType === 'streaming_overworld'`, placing portals cleanly in the central clearing (`x = 0, y = 0` / adjacent `(idx + 1, 0)` offsets).

### Step 175.3: Delta Binary IndexedDB Persistence (`src/core/chunk_store.ts`)

Create `src/core/chunk_store.ts` (`~160` lines) with dedicated `roguelike_world_chunks` IndexedDB database + seamless in-memory `Map<string, ArrayBuffer>` fallback for headless `bun test` (mirroring `localStorage === undefined` guards in `save.ts`):

```ts
// src/core/chunk_store.ts
export function buildChunkStorageKey(scopeKey: string, areaId: string, cx: number, cy: number, cz = 0): string {
  return `${scopeKey}:${areaId}:${cx}:${cy}:${cz}`;
}

export async function saveWorldChunkDelta(
  scopeKey: string,
  areaId: string,
  chunk: WorldChunk
): Promise<void> { ... }

export async function loadWorldChunkDelta(
  scopeKey: string,
  areaId: string,
  cx: number,
  cy: number,
  cz = 0
): Promise<WorldChunk | undefined> { ... }

export async function flushDirtyChunksToStore(state: Readonly<GameState>, scopeKey?: string): Promise<number> { ... }

export async function clearChunkStoreScope(scopeKey: string): Promise<void> { ... }
export function resetInMemoryChunkStore(): void { ... }
```
Default `scopeKey` derives deterministically from `state.campaignId` (`default_slot:${state.campaignId}`), clearing on `deleteSave()` / new game start so fresh runs never inherit stale terrain edits from prior saves!

### Step 175.4: Pooled Batched Chunk Worker (`src/worker/worker.types.ts`, `map.worker.ts`, `worker_bridge.ts`)

1. **`src/worker/worker.types.ts`**:
   Add `ChunkGenerationParams` (`worldSeed`, `areaId`, `chunkSize`, `spawnClearingRadius`, `isOutdoor`, `palette`, `biomeIndices`: pre-resolved `{ water, shore, plains, forest, ridge, road }`), `StreamingChunkCoord` (`cx`, `cy`, `cz`), `ChunkBatchWorkerRequest` (`id`, `type: 'generate_chunk_batch'`, `params`, `coords`), and `GeneratedChunkTransferPayload` (`coords`, `buffers: ReadonlyArray<ArrayBuffer>`).
2. **`src/worker/map.worker.ts`**:
   Handle `data.type === 'generate_chunk_batch'` alongside `'generate_map'`: loop over `data.coords`, call `generateWorldChunkFromParams`, serialize each via `serializeWorldChunkToBuffer`, collect `[payload.buffers...]` as `Transferable[]`, and call `self.postMessage(successMsg, transferables)` (zero-copy!).
3. **`src/worker/worker_bridge.ts`**:
   Keep a module-level persistent pooled chunk worker (`let chunkWorker: Worker | null = null`, `pendingChunkRequests = new Map<string, ...>()`) so Ring 1 prefetch never pays per-call worker spawn cost, plus `generateChunkBatchOffload(...)` returning deserialized `WorldChunk[]` cleanly (using synchronous/microtask main-thread fallback when `typeof Worker === 'undefined'`), and export `terminateChunkWorkerPool()` for cleanup.

### Step 175.5: Ring 0/1/2 Streaming Lifecycle & Entity Sleep/Wake (`src/systems/map/chunk_streaming.ts`)

Create `src/systems/map/chunk_streaming.ts` (`~250` lines):
- Bounded module-level prefetch buffer (`prefetchCache = new Map<string, WorldChunk>()`, evicted LRU-style above `MAX_PREFETCH_CACHE_CHUNKS`).
- `updateStreamingWorldWindow(state: GameState, anchorX: number, anchorY: number, options?: { readonly scopeKey?: string; readonly enablePrefetch?: boolean }): GameState`:
  1. Early-returns `state` immediately if `!state.map.chunkGrid` or `(originChunkX === targetCx && originChunkY === targetCy)` and all Ring 0 chunks are loaded.
  2. **Ring 0 Synchronous Load + Entity Wake:** For every `(cx, cy)` within `[targetCx - activeRadiusChunks .. targetCx + activeRadiusChunks]` × `[targetCy - activeRadiusChunks .. targetCy + activeRadiusChunks]`:
     - If not in `grid.chunks`: consume from `prefetchCache` (or synchronous `generateWorldChunk`), insert into `nextChunks`.
     - If `evictedChunkEntities[chunkKeyStr]` has dormant entities: wake them + their `ownedEntities` via `withEcsBatch` (`entities`, `components`, `spatialIndex`) and delete `evictedChunkEntities[chunkKeyStr]`.
  3. **Eviction Beyond `evictRadiusChunks` + Entity Sleep:** For every `(key, chunk)` in `nextChunks` outside `evictRadiusChunks`:
     - If `(chunk.dirtyFlags & CHUNK_DIRTY_PERSIST) !== 0`: enqueue `saveWorldChunkDelta(scopeKey, grid.areaId, chunk)` asynchronously (still preserving `dirtyChunkKeys` metadata or keeping dirty state cleanly retrievable via in-memory/IDB cache!). Wait — **important correctness invariant:** if an evicted dirty chunk is saved asynchronously via `saveWorldChunkDelta` (which writes synchronously into the in-memory `Map` fallback and asynchronously to IDB AND we can keep a small synchronous dirty-write-behind mirror in `chunk_store`!), when the player walks back before IDB finishes resolving, synchronous `updateStreamingWorldWindow` reads the write-behind cache immediately so **mutated tiles and explored flags are never lost in transit!** Let's include that synchronous pending-delta cache in `chunk_store.ts`!
     - Collect non-player, non-persistent root entities whose `Position` falls inside that evicted chunk's world bounds (`cx * chunkSize <= pos.x < (cx+1) * chunkSize` etc.) + all `collectOwnedEntityIds(state, rootId)`. Pack them into `DormantChunkEntityRecord[]` on `nextEvictedEntities[chunkKeyStr]` and remove them from active ECS via `withEcsBatch`.
  4. **Ring 1 Non-Blocking Batch Prefetch:** Collect missing chunks in `(activeRadiusChunks .. prefetchRadiusChunks]` not in `nextChunks` or `prefetchCache`, and call `generateChunkBatchOffload` asynchronously to populate `prefetchCache`.
- `rehydrateStreamingWorldAsync(state: GameState, scopeKey?: string): Promise<GameState>`: overlays persisted dirty chunks from `chunk_store` onto `state.map.chunkGrid` (and any dormant `areas` containing a `chunkGrid`) on `loadGame()`.

### Step 175.6: Save, Loop, Transition, Validator & Showcase Wiring

1. **[`src/core/save.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/save.ts)**:
   - Update `pruneOrphanEntities`, `computeSafeNextEntityId`, and `computeSafeNextItemInstanceId` to traverse `state.map.chunkGrid?.evictedChunkEntities` and all `area.map.chunkGrid?.evictedChunkEntities` (ensuring dormant chunk entities & their items are never treated as orphans and never suffer ID collisions!).
   - Update `serializeGameState`: when `map.chunkGrid` is defined, emit `map: { width: 0, height: 0, tiles: [], ...(map.isFullyExplored !== undefined ? { isFullyExplored: map.isFullyExplored } : {}) }` (stripping `chunkGrid`!) alongside `streamingState: serializeStreamingWorldState(map.chunkGrid)` (for both top-level state and dormant `areas`).
   - Update `saveGame`: also invoke `void flushDirtyChunksToStore(state)`.
   - Update `deserializeGameState`: if `sState.streamingState` (or `sAreaData.streamingState`) exists, rebuild `ChunkedWorldGrid` deterministically from `campaign` + `sStreaming` synchronously (checking `chunk_store`'s synchronous pending/in-memory deltas automatically!) and run `updateSpatialIndex`.
   - Update async `loadGame`: await `rehydrateStreamingWorldAsync(state)` before returning so IndexedDB-persisted dirty chunks override base procedural terrain seamlessly!
   - Update `deleteSave`: also clear active default chunk-store scope.
2. **[`src/core/bootstrap.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/bootstrap.ts)**: await/trigger `clearChunkStoreScope(...)` alongside `deleteSave()` on `startNewGame`.
3. **[`src/core/loop/intent_cost_resolver.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/loop/intent_cost_resolver.ts)**: after `didDisplaceTile && isPlayerMoveOrPlayerAction && nextState.map.chunkGrid !== undefined && posAfter`, call `nextState = updateStreamingWorldWindow(nextState, posAfter.x, posAfter.y)` before `updateExploredTiles(nextState)`.
4. **[`src/systems/map.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map.system.ts)**: when packing current area on exit, flush dirty chunks if `state.map.chunkGrid !== undefined`; when entering a saved streaming area, call `updateStreamingWorldWindow` around `spawnX, spawnY`.
5. **[`src/editor/validator/area.validator.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/editor/validator/area.validator.ts)**: validate `area.generatorType === 'streaming_overworld'` requires `area.streamingConfig`, all non-undefined `biomePalette` tile IDs exist in `campaign.tiles`, and `prefetchRadiusChunks >= activeRadiusChunks`. Check `reachability.validator.ts` & `area_editor.ts` (`case`/`if` handling of `streaming_overworld`).
6. **`public/data/campaigns/default/areas.json` + `ai-prompt-kit/` Parity**:
   - Add `{ "targetAreaId": "endless_frontier", "direction": "edge" }` to `outer_crossroads.connections`.
   - Add `"endless_frontier"` to `areas.json`:
     ```json
     "endless_frontier": {
       "id": "endless_frontier",
       "name": "The Endless Frontier",
       "generatorType": "streaming_overworld",
       "dangerRating": 2,
       "environmentType": "outdoors",
       "tags": ["wilderness", "overworld", "streaming"],
       "connections": [
         {
           "targetAreaId": "outer_crossroads",
           "direction": "edge",
           "placementX": 0,
           "placementY": 0
         }
       ],
       "streamingConfig": {
         "chunkSize": 16,
         "activeRadiusChunks": 4,
         "prefetchRadiusChunks": 6,
         "worldSeed": 45175,
         "spawnClearingRadius": 4,
         "biomePalette": {
           "water": "shallow_water",
           "shore": "stone_floor",
           "plains": "stone_floor",
           "forest": "stone_floor",
           "ridge": "stone_wall",
           "road": "stone_floor"
         }
       }
     }
     ```
   - Run `bun scripts/generate-ai-prompt-kit.ts` to keep `ai-prompt-kit/default-campaign/` mirrored cleanly.

### Step 175.7: M175 Tests (`tests/m175_chunk_streaming.test.ts`)

- Verify `generateWorldChunk` determinism and edge continuity (neighbor chunks at `cx = -1` and `cx = 0` sample continuous world coordinates `(wx, wy)`).
- Verify walking > 40 tiles across `-X`/`-Y` and `+X`/`+Y` in `endless_frontier` (`chunkSize: 16`) streams new chunks, evicts distant chunks beyond `evictRadiusChunks`, sleeps distant NPCs & owned items into `evictedChunkEntities`, and restores them cleanly upon return.
- Verify **delta-only persistence**: untouched chunks emit 0 records to `chunk_store`; explored/mutated chunks (`setTileIdAt` & `markTilesExplored`) persist to `chunk_store` (`WORLD_CHUNKS_STORE` in-memory driver), `serializeGameState` produces compact JSON with **zero** tile arrays, and `deserializeGameState` + `rehydrateStreamingWorldAsync` restores all edits and dormant chunk entities without ID collisions or orphan pruning bugs.
- Verify configurable `chunkSize: 32` streams, collides, computes FOV, and saves/loads identically to `chunkSize: 16`.

---

## 7. Complete Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Inputs) | Downstream (Consumers / Persisters) | Lateral (Mirrors / Siblings / Docs) |
|---|---|---|---|
| **M173: Incremental `spatialIndex` & `withEcsBatch`** | All `355` `addComponent` callers + `removeComponent`, `removeEntity`, `spawnEntity`, `moveToLimbo`, `generateAndPopulateAreaFloor`, friendly swaps | Preserves `PresentationEventQueue` diffing (`pMap === nMap`), `campaignEntityDagCache`, and `deepFreezeGameState` invariants; `spatialIndex` parity checked against `updateSpatialIndex` | `save.ts`, `map.system.ts`, `nemesis_adaptation.ts`, `rivalry/query.ts` retain full `updateSpatialIndex` strictly for load/rehydration |
| **M174: `WorldChunk`, `TilePaletteRegistry`, `packWorldCoord`, `MapAccessor`** | Campaign loader/bootstrap & `GameMap.chunkGrid` construction; `src/types/game-state.types.ts` & `src/utils/grid.ts` | Migrates all `46` `.map.tiles` sites + `10` `cachedFov` sites across `fov.ts`, `movement*`, `viewport_snapshot`, `tactical_snapshot`, `inspect_tooltip`, `hud_alerts`, `dnd35e` spatial/spell resolvers, AI, input, and core loop | `area_editor.ts` & `director_telemetry_view.ts` read finite or streaming previews safely via `getTileAt`; finite 5 existing campaigns stay 100% unchanged |
| **M175: `streaming_overworld`, Pooled Worker, `chunk_store`, Delta Save** | `AreaGeneratorTypeEnum` & `streamingConfig` in `src/types/campaign/world.ts`, `generator.ts`, `generator_async.ts`, `intent_cost_resolver.ts` | `save.ts` strips `chunkGrid` from `localStorage` JSON, emits slim `streamingState`, traverses `evictedChunkEntities` in orphan/ID guards, syncs with `chunk_store` | `area.validator.ts`, `reachability.validator.ts`, `public/data/campaigns/default/areas.json` + **`ai-prompt-kit/` mirror parity** (`generate-ai-prompt-kit.ts`), `docs/ssot/ssot_console.json` (`map-codebase.ts`), `docs/ARCHITECTURE.md` & `docs/MILESTONES.md` |

---

## 8. Post-Implementation Verification & Rollout Checklist

1. Register all new `.ts` files (`src/constants/world_chunk.constants.ts`, `src/types/world-chunk.types.ts`, `src/core/ecs/ecs_batch.ts`, `src/map/tile_palette.ts`, `src/map/world_chunk.ts`, `src/map/map_accessor.ts`, `src/map/chunk_generator.ts`, `src/core/chunk_store.ts`, `src/systems/map/chunk_streaming.ts`) in [`docs/ssot/ssot_console.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/ssot/ssot_console.json) and run `bun scripts/map-codebase.ts`.
2. Regenerate `ai-prompt-kit` via `bun scripts/generate-ai-prompt-kit.ts` after updating `public/data/campaigns/default/areas.json`.
3. Execute full `./verify.sh` across all **8 stages** (`tsc --noEmit`, `format`, `lint`, `lint:arch`, `lint:filelength`, `lint:deadcode`, `bun test`, `build`, `scripts/run-validator.ts`) and verify 0 errors.
4. Update [`docs/ARCHITECTURE.md`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/ARCHITECTURE.md) and [`docs/MILESTONES.md`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/MILESTONES.md) (mark Milestones 173, 174, 175 complete) and run final verification.
5. **Manual Play-Test Scenario:** Launch `default` campaign → head north to `outer_crossroads` → cross the frontier edge into `The Endless Frontier` (`endless_frontier`) → walk > 50 tiles west/north across negative coordinates and multiple `16×16` chunk borders, save/reload, and confirm explored fog, terrain continuity, and zero `localStorage` bloat.
