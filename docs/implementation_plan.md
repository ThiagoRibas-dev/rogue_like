# Phase 46 Implementation Plan: True Multi-Z Voxel Space, 3D Vision, HPA* Pathfinding & Z-Aware Cartridges

**Scope:** Milestones 176, 177, 178, and 179 (`docs/MILESTONES.md` lines 2435–2457)  
**Research Foundation:** Confirmed [docs/research_notes.md](./research_notes.md)  
**Governing Standards:** `AGENTS.md` Rules 10–21, `docs/ARCHITECTURE.md`, `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`

---

## 1. Confirmed Architectural Decisions

1. **Vertical Scale (`FEET_PER_Z_LEVEL`):** Default `5 ft` per Z-level (isotropic 5×5×5 ft voxels), configurable per campaign via `campaign.rules.map.feetPerZLevel` (default `5`).
2. **`spatialIndex` Key Format:** Uniform `"x,y,z"` everywhere via canonical `toSpatialKey(x, y, z = 0)` and `getEntitiesAtPosition(state, x, y, z = 0)` helpers, migrating all ~45 `src/` callers and the 6 test files reading `spatialIndex` directly.
3. **Conflict-Free Keybindings (`command_catalog.ts`):**
   - `move.up_z` (`<`) and `move.down_z` (`>`): Ascend/descend stairs, ladders, flight, climb, or up/down portals; inside Inspect (`x`) or Targeting (`f`) mode, shifts cursor Z up/down.
   - `action.interact` (`,` and `.`): Smart interact with tile, entity, or portal.
   - `camera.peek_z_up` (`PageUp`, `[`), `camera.peek_z_down` (`PageDown`, `]`), `camera.peek_z_reset` (`Home`): Ephemeral Z-slice camera peeking (`GameState.cameraZOffset`) without moving the player.
4. **Default Campaign Multi-Z Showcase & Vertical Alignment Validator:**
   - Add declarative tiles (`open_air`, `stone_ramp`, `wooden_stairs_up`, `wooden_stairs_down`, `climbable_wall`) in `public/data/campaigns/default/tiles.json`.
   - Add a 3-level static showcase area `watchtower_overlook` (`z = -1, 0, 1`) connected from `outer_crossroads`, enable multi-Z strata (`minZ: -2, maxZ: 2`) on `endless_frontier` in `public/data/campaigns/default/areas.json`, and add the Multi-Z Vertical Alignment Validator in `src/editor/validator/area.validator.ts`.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner (SSOT) | Tier | Evicted / Replaced Old Pattern |
| :--- | :--- | :--- | :--- |
| 3D Integer Coord Packing (`20+20+12 = 52 bits`) & Spatial Key Formatting | `src/utils/grid.ts` (`packWorldCoord3D`, `unpackWorldCoord3D`, `toSpatialKey`, `getBresenhamLine3D`) | `tier1_console` | Ad-hoc `` `${x},${y}` `` string literals and 2D-only `packWorldCoord` on multi-Z chunk maps |
| 3D Spatial Occupancy Query & Incremental Patching | `src/core/ecs/ecs_core.ts` (`getEntitiesAtPosition`, `patchSpatialIndexForEntity`, `patchSpatialIndexInPlace`) | `tier1_console` | ~45 direct `state.spatialIndex.get(\`${x},${y}\`)` calls across `src/` |
| Unified 2D/3D Tile Read/Write (`GameMap.tiles`, `zSlices`, `chunkGrid`) | `src/map/map_accessor.ts` (`getTileAt`, `getTileIdAt`, `getTileDefAt`, `setTileIdAt`, `isInMapBounds`, `isMultiZMap`, `getMapZBounds`) | `tier1_console` | 2D-only `(x, y)` `MapAccessor` lookups assuming `cz === 0` |
| Floor Support Detection, Gravity Scan & Fall Resolution | `src/systems/gravity.system.ts` (`isEntitySupportedAt`, `resolveGravityForEntity`) | `tier1_console` | Ad-hoc pit-only fall handling disconnected from Z elevation |
| 3D Line-of-Sight & Multi-Z Shadowcasting | `src/map/fov_3d.ts` (`has3DLineOfSight`, `computeFOV3D`) invoked from `src/map/fov.ts` when `isMultiZMap(map)` | `tier1_console` | Single-plane 2D FOV blind to balconies, chasms, and skylights |
| Chunk Connectivity `RegionGrid` & HPA\* 3D Portal Graph | `src/map/region_graph.ts` & `src/ai/pathfinding_hpa.ts` | `tier1_console` | Unbounded per-step 2D `new ROT.Path.AStar` on large/multi-Z maps |
| Shared Multi-Agent 3D Dijkstra Flow Fields | `src/ai/flow_field.ts` (`getOrComputeFlowField3D`, `sampleFlowFieldStep3D`) | `tier1_console` | Independent redundant A\* runs for multiple actors pursuing the same target |
| Ruleset 3D Spatial & Elevation Mechanics (Distance, High Ground, Flight, Climb, Falling) | `src/rulesets/dnd35e/spatial/dnd35e_spatial_3d.ts` + `grid_geometry.ts` + `cover_senses.ts` + `aoe_rest.ts` | `tier2_cartridge` | Static `dndData.movementModes` ignoring DAG `can_fly` ruleOverride; 2D-only AoE & fall math |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| Sky / Chasm / Balcony Transparency & Gravity Drop | `if (tileId === 'open_air' \|\| tileId === 'chasm')` | `TileDefinitionSchema.isOpenAir?: boolean`, `hasFloorSupport?: boolean`, `blocksVerticalLoS?: boolean` | **Yes** — any mod tile with `isOpenAir: true` automatically transmits 3D FOV/light, renders depth dimming, and drops unsupported actors. |
| Ramp & Stair / Ladder Elevation Transitions | `if (tileId === 'stairs_up' \|\| tileId === 'stone_ramp')` | `TileDefinitionSchema.verticalLink?: 'ramp' \| 'stairs_up' \| 'stairs_down' \| 'stairs_both' \| 'ladder'` | **Yes** — any mod tile declaring `verticalLink` participates in movement, HPA\* vertical portals, flow fields, and the alignment validator. |
| Climbable Walls / Cliffs | `if (tileId === 'cliff_wall')` | `TileDefinitionSchema.isClimbable?: boolean` (plus fallback to adjacent `isSolidObstacle === true` when actor has climb capability) | **Yes** — mods control climbability per tile definition in JSON. |
| *Fly* Spell / Buff Altitude & Speed | `if (hasStatus(entity, 'fly'))` | Read DAG `ruleOverrides` (`ruleKey === 'can_fly'`) + `StatModifier` (`fly_speed`) + `flight:*` tags in `resolveDnD35eEntityMovementModes` | **Yes** — any custom flight spell, item, or racial trait emitting `ruleKey: 'can_fly'` works identically. |
| *Feather Fall* / Slow Fall Mitigation | `if (hasSpellEffect(entity, 'feather_fall') \|\| hasClass('monk'))` | Read DAG `ruleOverrides` (`ruleKey === 'immune_falling_damage'`, already in `feather_fall.json`) + `StatModifier` (`targetStat: 'fall_damage_reduction_ft'`) | **Yes** — any custom item/spell/class feature emitting `immune_falling_damage` or `fall_damage_reduction_ft` works automatically. |
| Vertical Feet Scale per Z-Level | Hardcoded `10` or `5` inside combat/spell resolvers | `campaign.rules.map.feetPerZLevel` (Zod optional default `DEFAULT_FEET_PER_Z_LEVEL = 5`) | **Yes** — campaigns can tune vertical scale (5 ft vs 10 ft) purely in `rules.json`. |

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers, Emitters, Authors, Tests) | Downstream (Consumers, Renderers, Validators, Saves) | Lateral (Siblings, Campaigns, Docs, Registries) |
| :--- | :--- | :--- | :--- |
| **M176.1:** `PositionComponent.z`, `toSpatialKey`, `getEntitiesAtPosition` | `ecs_core.ts`, `ecs_batch.ts`, `ecs_lifecycle.ts`, `ecs_spawner.ts`, ~45 `src/` callers, 6 existing tests (`floor_transition_entity_id_and_loader`, `input_scope_and_keymap`, `m156`, `dnd35e_size_footprint_movement`, `m173`, `m175`) | `viewport_snapshot.ts`, `tactical_snapshot.ts`, `inspect_tooltip.ts`, `fov.ts`, `fov_3d.ts`, `crossing.system.ts`, `field.system.ts`, `sound.system.ts`, `projectile.system.ts`, `zap.system.ts`, `save.ts` | `fuzzer_invariants.ts`, `DebugOverlay.tsx`, `SSOT_CONSOLE.md` |
| **M176.2:** `packWorldCoord3D`, Multi-Z `WorldChunk` slabs, `GameMap.zSlices`, `MapAccessor` 3D | `grid.ts`, `world_chunk.constants.ts`, `map_accessor.ts`, `static-parser.ts`, `chunk_generator.ts`, `chunk_streaming.ts`, `worker_bridge.ts`, `map.worker.ts` | `chunk_store.ts` (`unpackWorldCoord3D`), `save.ts` (`SerializedStreamingWorldState`), `fov_3d.ts`, `area.validator.ts` | `world.ts`, `meta.ts`, `ai-prompt-kit/`, `default/{tiles,areas}.json` |
| **M176.3:** `MoveIntent.dz`, Ramps/Stairs, `gravity.system.ts`, Vertical Alignment Validator | `movement.system.ts`, `movement_displacement.ts`, `movement_footprint.ts`, `crossing.system.ts`, `status-effect.system.ts`, `gameplay_input.ts` | `lifecycle.system.ts`, `intent_cost_resolver.ts`, `RulesetContract.onEntityFallLanded`, `canActorAdjustAltitude`, `area.validator.ts` | `dnd35e_turn_budget.ts`, `dnd35e_lifecycle_adapter.ts`, `follow.behavior.ts` |
| **M177:** `fov_3d.ts`, 3D `light_emitter.system.ts`, Depth-Dimmed Renderer, `cameraZOffset` Peeking | `map.system.ts`, `camera.ts`, `command_catalog.ts`, `gameplay_input.ts`, `shortcut_input.ts`, `action.registry.ts`, `presentation_queue.ts` | `viewport_snapshot.ts`, `viewport_snapshot.types.ts`, `renderer.ts`, `vfx_overlay.ui.ts`, `tactical_snapshot.ts`, `inspect_tooltip.ts`, `ChronosStrip.tsx` | `input_scope_and_keymap.test.ts`, `cover_senses.ts` (`resolveTileLightReading`) |
| **M178:** `region_graph.ts`, `pathfinding_hpa.ts`, `flow_field.ts` | `map_accessor.ts` (`CHUNK_DIRTY_REGION`), `chunk_streaming.ts`, `durability.system.ts` (door toggle) | `follow.behavior.ts`, `hunt.behavior.ts`, `flee.behavior.ts`, `companion_targeting.ts` | `SSOT_CONSOLE.md`, `ssot_console.json` |
| **M179:** Z-Aware `RulesetContract` & D&D 3.5e 3D Mechanics | `ruleset.types.ts`, `dnd35e_ruleset.ts`, `dnd35e_spatial_3d.ts`, `grid_geometry.ts`, `cover_senses.ts`, `aoe_rest.ts`, `target_category_filter.ts`, `spell_cast_resolver.ts`, `combat_exchange_phases.ts`, `terrain_traversal_resolver.ts` | `classic_ruleset.ts` (optional hooks), `dnd35e_combat_adapter.ts`, `flanking_graph.ts`, `charge_resolver.ts`, `spell.behavior.ts` | `SSOT_DND35E.md`, `ssot_dnd35e.json`, `ARCHITECTURE.md` (§9.33), `MILESTONES.md` |

---

## 5. Step-by-Step Implementation Plan (with Code Snippets & Diffs)

---

### Milestone 176: 3D Coordinates (`PositionComponent.z`), Multi-Z Chunks, Ramps/Stairs & Gravity/Falling

#### Step 176.1 — Constants, 3D Packing, Spatial Keys & 3D Line Traversal
- **Files:** `src/constants/world_chunk.constants.ts`, `src/utils/grid.ts`
- **Changes:**
  - Add 3D coordinate packing constants (`20-bit X + 20-bit Y + 12-bit Z = 52 bits`, strictly safe in IEEE-754 integers), vertical scale default (`DEFAULT_FEET_PER_Z_LEVEL = 5`), fall/gravity constants (`MAX_FALL_DISTANCE_Z = 32`, `DEFAULT_FALL_DAMAGE_PER_Z = 5`), multi-Z streaming defaults (`DEFAULT_ACTIVE_RADIUS_Z = 2`, `MIN_ACTIVE_RADIUS_Z = 0`, `MAX_ACTIVE_RADIUS_Z = 8`), and depth rendering layers (`MAX_RENDER_DEPTH_LAYERS = 3`).
  - Add `packWorldCoord3D(x, y, z = 0)`, `unpackWorldCoord3D(key)`, `toSpatialKey(x, y, z = 0)`, and `getBresenhamLine3D(x0, y0, z0, x1, y1, z1)` in `src/utils/grid.ts`.

```ts
// src/constants/world_chunk.constants.ts (additions)
/** Bias applied to signed X/Y coordinates for 20-bit 3D packing (+/- 524,287). */
export const COORD3D_XY_BIAS = 524_288 as const;
/** Radix span for 20-bit signed X/Y coordinates (2^20). */
export const COORD3D_XY_SPAN = 1_048_576 as const;
/** Bias applied to signed Z coordinates for 12-bit 3D packing (+/- 2,047 Z-levels). */
export const COORD3D_Z_BIAS = 2_048 as const;
/** Radix span for 12-bit signed Z coordinates (2^12). */
export const COORD3D_Z_SPAN = 4_096 as const;
/** Multiplier shifting Y above 20-bit X (2^20). */
export const COORD3D_Y_MULT = 1_048_576 as const;
/** Multiplier shifting Z above 40-bit (X, Y) (2^40). */
export const COORD3D_Z_MULT = 1_099_511_627_776 as const;

/** Default vertical elevation height per Z-level in feet (isotropic 5-ft voxel). */
export const DEFAULT_FEET_PER_Z_LEVEL = 5 as const;
/** Safety cap for vertical fall scans when resolving gravity over unbounded open air. */
export const MAX_FALL_DISTANCE_Z = 32 as const;
/** Fallback Console fall damage per Z-level fallen beyond a 1-Z safe hop when no ruleset hook handles falls. */
export const DEFAULT_FALL_DAMAGE_PER_Z = 5 as const;
/** Default vertical chunk streaming radius around originChunkZ when multi-Z streaming is active. */
export const DEFAULT_ACTIVE_RADIUS_Z = 2 as const;
/** Maximum lower Z-slices inspected beneath `open_air` during multi-Z viewport rendering. */
export const MAX_RENDER_DEPTH_LAYERS = 3 as const;
```

```ts
// src/utils/grid.ts (additions)
/**
 * Packs signed 3D coordinates (20-bit X, 20-bit Y, 12-bit Z = 52 bits) into a safe JS integer.
 */
export function packWorldCoord3D(x: number, y: number, z = 0): number {
  return (
    (z + COORD3D_Z_BIAS) * COORD3D_Z_MULT +
    (y + COORD3D_XY_BIAS) * COORD3D_Y_MULT +
    (x + COORD3D_XY_BIAS)
  );
}

/**
 * Unpacks a 52-bit key produced by {@link packWorldCoord3D} back into signed `(x, y, z)`.
 */
export function unpackWorldCoord3D(key: number): { readonly x: number; readonly y: number; readonly z: number } {
  const adjustedX = key % COORD3D_Y_MULT;
  const withoutX = Math.floor(key / COORD3D_Y_MULT);
  const adjustedY = withoutX % COORD3D_XY_SPAN;
  const adjustedZ = Math.floor(withoutX / COORD3D_XY_SPAN);
  return {
    x: adjustedX - COORD3D_XY_BIAS,
    y: adjustedY - COORD3D_XY_BIAS,
    z: adjustedZ - COORD3D_Z_BIAS
  };
}

/**
 * Formats the canonical uniform 3D spatialIndex lookup key `"x,y,z"`.
 */
export function toSpatialKey(x: number, y: number, z = 0): string {
  return `${x},${y},${z}`;
}

/**
 * Returns all integer voxel coordinates along a 3D Bresenham line from `(x0, y0, z0)` to `(x1, y1, z1)`.
 */
export function getBresenhamLine3D(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number
): ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }> {
  const points: Array<{ readonly x: number; readonly y: number; readonly z: number }> = [];
  let x = x0;
  let y = y0;
  let z = z0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const dz = Math.abs(z1 - z0);
  const xs = x1 > x0 ? 1 : x1 < x0 ? -1 : 0;
  const ys = y1 > y0 ? 1 : y1 < y0 ? -1 : 0;
  const zs = z1 > z0 ? 1 : z1 < z0 ? -1 : 0;
  points.push({ x, y, z });

  if (dx >= dy && dx >= dz) {
    let p1 = 2 * dy - dx;
    let p2 = 2 * dz - dx;
    while (x !== x1) {
      x += xs;
      if (p1 >= 0) { y += ys; p1 -= 2 * dx; }
      if (p2 >= 0) { z += zs; p2 -= 2 * dx; }
      p1 += 2 * dy;
      p2 += 2 * dz;
      points.push({ x, y, z });
    }
  } else if (dy >= dx && dy >= dz) {
    let p1 = 2 * dx - dy;
    let p2 = 2 * dz - dy;
    while (y !== y1) {
      y += ys;
      if (p1 >= 0) { x += xs; p1 -= 2 * dy; }
      if (p2 >= 0) { z += zs; p2 -= 2 * dy; }
      p1 += 2 * dx;
      p2 += 2 * dz;
      points.push({ x, y, z });
    }
  } else {
    let p1 = 2 * dy - dz;
    let p2 = 2 * dx - dz;
    while (z !== z1) {
      z += zs;
      if (p1 >= 0) { y += ys; p1 -= 2 * dz; }
      if (p2 >= 0) { x += xs; p2 -= 2 * dz; }
      p1 += 2 * dy;
      p2 += 2 * dx;
      points.push({ x, y, z });
    }
  }
  return points;
}
```

#### Step 176.2 — Schemas, ECS `PositionComponent.z`, `GameMap.zSlices` & `WorldChunk` 3D Metadata
- **Files:**
  - `src/types/components/world_components.types.ts`: Add `readonly z?: number | undefined;` and `readonly footprintDepth?: number | undefined;` to `PositionComponent`; add `readonly targetZ?: number | undefined;` to `PortalComponent`.
  - `src/types/campaign/world.ts`:
    - Extend `TileDefinitionSchema` with `isOpenAir`, `blocksVerticalLoS`, `hasFloorSupport`, `verticalLink: z.enum(['ramp', 'stairs_up', 'stairs_down', 'stairs_both', 'ladder']).optional()`, `isClimbable`.
    - Extend `StreamingBiomePaletteSchema` with optional `openAir`, `underground`, `ramp`.
    - Extend `StreamingAreaConfigSchema` with optional `minZ` (default `0`), `maxZ` (default `0`), `activeRadiusZ` (default `DEFAULT_ACTIVE_RADIUS_Z`).
    - Extend `StaticMapLayoutSchema` with `zLevels: z.record(z.string(), z.array(z.string())).optional()` (keyed by signed integer string e.g. `"-1"`, `"1"`).
    - Extend `AreaConnectionSchema` with `targetZ?: number`, `placementZ?: number`, `preserveCoords?: boolean`.
    - Extend `AreaDefinitionSchema.placedEntities` items with `z?: number`.
  - `src/types/campaign/meta.ts`: Add `feetPerZLevel: z.number().int().positive().optional()` to `RulesConfigSchema.map`.
  - `src/types/game-state.types.ts`:
    - Add `readonly zSlices?: Readonly<Record<number, ReadonlyArray<Tile>>> | undefined;`, `readonly minZ?: number | undefined;`, `readonly maxZ?: number | undefined;` to `GameMap`.
    - Add `readonly cameraZOffset?: number | undefined;` to `GameState`, and optional `readonly z?: number | undefined;` to `targetingMode` and `inspectMode`.
  - `src/types/world-chunk.types.ts`:
    - Add `originChunkZ`, `activeRadiusZ`, `minZ`, `maxZ` (all `readonly number`) to `ChunkedWorldGrid` and optional counterparts to `SerializedStreamingWorldState` (backwards compatible with existing saves!).
    - Add `readonly z?: number | undefined;` to `TileSnapshot`.

#### Step 176.3 — Uniform `"x,y,z"` `spatialIndex` & Canonical `getEntitiesAtPosition` Migration
- **Files:** `src/core/ecs/ecs_core.ts`, `src/core/ecs.ts`, `src/core/ecs/ecs_spawner.ts`, and all ~45 `src/` direct `spatialIndex.get` call sites + 6 test files.
- **Snippet (`src/core/ecs/ecs_core.ts`):**

```ts
function getPositionFootprintKeys(pos: PositionComponent | undefined): ReadonlyArray<string> {
  if (pos === undefined) return [];
  const z = pos.z ?? 0;
  const footprintWidth = Math.max(1, pos.footprintWidth ?? 1);
  const footprintHeight = Math.max(1, pos.footprintHeight ?? 1);
  const footprintDepth = Math.max(1, pos.footprintDepth ?? 1);
  if (footprintWidth === 1 && footprintHeight === 1 && footprintDepth === 1) {
    return [toSpatialKey(pos.x, pos.y, z)];
  }
  const keys: string[] = [];
  for (let dz = 0; dz < footprintDepth; dz++) {
    for (let dy = 0; dy < footprintHeight; dy++) {
      for (let dx = 0; dx < footprintWidth; dx++) {
        keys.push(toSpatialKey(pos.x + dx, pos.y + dy, z + dz));
      }
    }
  }
  return keys;
}

/**
 * Canonical O(1) lookup of entities occupying voxel `(x, y, z)` in `state.spatialIndex`.
 */
export function getEntitiesAtPosition(
  state: Readonly<GameState>,
  x: number,
  y: number,
  z = 0
): ReadonlyArray<EntityId> {
  return state.spatialIndex.get(toSpatialKey(x, y, z)) ?? [];
}
```
- Update `sameSpatialFootprint` to compare `(a.z ?? 0) === (b.z ?? 0)` and `footprintDepth`, update `updateSpatialIndex` to use `getPositionFootprintKeys(pos)`, and export `getEntitiesAtPosition` from `src/core/ecs.ts`.
- Update `spawnEntity(state, templateId, x, y, ..., z = 0)` so placed entities at non-zero `z` receive `...(z !== 0 ? { z } : {})`.
- Migrate all ~45 `state.spatialIndex.get(...)` call sites in `src/` and the 6 test files (`floor_transition_entity_id_and_loader.test.ts`, `input_scope_and_keymap.test.ts`, `m156_durability_spellbooks_ecology.test.ts`, `dnd35e_size_footprint_movement.test.ts`, `m173_ecs_spatial_batch.test.ts`, `m175_chunk_streaming.test.ts`) to `getEntitiesAtPosition` / `toSpatialKey`.

#### Step 176.4 — 3D `MapAccessor`, Multi-Z `static-parser.ts`, 3D `chunk_generator.ts`, `chunk_streaming.ts`, `chunk_store.ts` & `save.ts`
- **Files:** `src/map/map_accessor.ts`, `src/map/static-parser.ts`, `src/map/chunk_generator.ts`, `src/systems/map/chunk_streaming.ts`, `src/core/chunk_store.ts`, `src/core/save.ts`, `src/systems/map/map_generation_spawner.ts`, `src/systems/map.system.ts`
- **Key Integration Details:**
  - `isMultiZMap(map: Readonly<GameMap>): boolean`: returns `true` when `(map.chunkGrid !== undefined && (map.chunkGrid.minZ !== 0 || map.chunkGrid.maxZ !== 0))` OR `(map.zSlices !== undefined && Object.keys(map.zSlices).length > 0)`.
  - `getMapZBounds(map: Readonly<GameMap>): { readonly minZ: number; readonly maxZ: number }`: reads `chunkGrid.minZ/maxZ` or `map.minZ/maxZ` (default `{ minZ: 0, maxZ: 0 }`).
  - `toMapTileKey(map, x, y, z = 0)`:
    - Returns `packWorldCoord3D(x, y, z)` when `map.chunkGrid !== undefined || isMultiZMap(map)`.
    - Returns `coordToIndex(x, y, map.width)` on pure 2D finite maps (100% unchanged!).
  - `getTileAt(map, x, y, z = 0)`, `getTileIdAt(map, x, y, z = 0)`, `getTileDefAt(state, x, y, z = 0)`, `isTileExploredAt(map, x, y, z = 0)`, `setTileIdAt(map, x, y, tileId, z = 0)`, `isInMapBounds(map, x, y, z = 0)`:
    - On `chunkGrid`: indexes `grid.chunks.get(packWorldCoord3D(cx, cy, z))`.
    - On `setTileIdAt`: sets `CHUNK_DIRTY_PERSIST | CHUNK_DIRTY_REGION` on mutated `WorldChunk` so HPA\* regions & Flow Fields auto-invalidate!
    - On finite maps: reads `z === 0 ? map.tiles : map.zSlices?.[z]`.
  - `parseStaticMap` parses `staticMap.layout` into `z = 0` (`map.tiles`) and every entry in `staticMap.zLevels` (`parseInt(zKey, 10)`) into `zSlices[z]`, computing `minZ` / `maxZ` and extracting `parsedEntities` with `{ templateId, x, y, z }`.
  - `chunk_generator.ts`:
    - When `params.minZ < 0 || params.maxZ > 0`: computes a deterministic integer `surfaceZ(wx, wy)` clamped to `[minZ, maxZ]` (with `0` inside the spawn clearing).
      - `cz < surfaceZ`: fills with `biomeIndices.underground` (`stone_wall`) + `CHUNK_FLAG_NATURAL`.
      - `cz === surfaceZ`: if any orthogonal neighbor has `neighborSurfaceZ === surfaceZ + 1`, emits `biomeIndices.ramp` (so hills/terraces are naturally climbable via aligned ramps!); otherwise emits standard biome (`water`, `shore`, `plains`, `forest`, `road`).
      - `cz > surfaceZ`: fills with `biomeIndices.openAir` + `CHUNK_FLAG_OUTDOOR`.
    - When `minZ === 0 && maxZ === 0`: preserves exact Phase 45 2D synthesis!
  - `chunk_streaming.ts`:
    - `updateStreamingWorldWindow(state, anchorX, anchorY, options?)` reads `anchorZ` (from `options?.anchorZ` or player's `pos.z ?? 0`), iterates `cz` across `[Math.max(grid.minZ, anchorZ - grid.activeRadiusZ), Math.min(grid.maxZ, anchorZ + grid.activeRadiusZ)]`, keys chunks via `packWorldCoord3D(cx, cy, cz)`, and packs/wakes dormant entities using `formatChunkKey(cx, cy, pos.z ?? 0)`.
  - `chunk_store.ts`:
    - `overlayPersistedDeltasOnGrid` uses `unpackWorldCoord3D(packed)` so `loadWorldChunkDelta(scopeKey, grid.areaId, coords.x, coords.y, coords.z)` hydrates every persisted Z-slice on cold reload!

#### Step 176.5 — Vertical Movement (`MoveIntent.dz`, Ramps/Stairs) & `src/systems/gravity.system.ts`
- **Files:** `src/types/intents/movement.intents.ts`, `src/actions/core.actions.ts`, `src/systems/gravity.system.ts` *(New)*, `src/systems/movement.system.ts`, `src/systems/movement_displacement.ts`, `src/systems/movement_footprint.ts`, `src/systems/crossing.system.ts`, `src/systems/status-effect.system.ts`
- **Core Gravity API (`src/systems/gravity.system.ts`):**

```ts
export interface EntityFallContext {
  readonly fromZ: number;
  readonly toZ: number;
  readonly fallenLevels: number;
  readonly fallenFeet: number;
  readonly landingTileId: string | undefined;
  readonly isIntentionalJump?: boolean | undefined;
}

/**
 * Checks whether an entity's footprint at `(x, y, z)` has physical or locomotion support
 * (floor support, live crossing, solid load-bearing tile at `z - 1`, active flight, or climbable wall hold).
 */
export function isEntitySupportedAt(
  state: Readonly<GameState>,
  entityId: EntityId,
  x: number,
  y: number,
  z: number
): boolean {
  if (!isMultiZMap(state.map)) return true;
  const modes = getEntityMovementModes(state as GameState, entityId);
  if (modes?.fly !== undefined && modes.fly > 0) return true;

  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  const fw = Math.max(1, pos?.footprintWidth ?? 1);
  const fh = Math.max(1, pos?.footprintHeight ?? 1);

  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      const tileDef = getTileDefAt(state, tx, ty, z);
      const hasFloor = tileDef !== undefined && (tileDef.hasFloorSupport ?? (tileDef.walkable && tileDef.isOpenAir !== true));
      if (hasFloor) return true;
      if (queryCrossingAtPosition(state, tx, ty, z) !== undefined) return true;
      const belowDef = getTileDefAt(state, tx, ty, z - 1);
      if (belowDef !== undefined && (belowDef.isSolidObstacle === true || (!belowDef.walkable && belowDef.isOpenAir !== true))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolves vertical falling when an entity stands over unsupported open air,
 * displacing atomically to the first supported Z-level below and delegating fall impact to RulesetContract.
 */
export function resolveGravityForEntity(
  state: GameState,
  entityId: EntityId,
  options?: { readonly isIntentionalJump?: boolean | undefined }
): GameState {
  if (!isMultiZMap(state.map)) return state;
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return state;
  const startZ = pos.z ?? 0;
  if (isEntitySupportedAt(state, entityId, pos.x, pos.y, startZ)) return state;

  const { minZ } = getMapZBounds(state.map);
  const floorLimit = Math.max(minZ, startZ - MAX_FALL_DISTANCE_Z);
  let landingZ = startZ;
  for (let cz = startZ - 1; cz >= floorLimit; cz--) {
    if (!isInMapBounds(state.map, pos.x, pos.y, cz)) break;
    landingZ = cz;
    if (isEntitySupportedAt(state, entityId, pos.x, pos.y, cz)) break;
  }
  if (landingZ === startZ) return state;

  const nextPos: PositionComponent = { ...pos, z: landingZ };
  let nextState = addComponent(state, entityId, nextPos);
  if (getComponent(nextState, entityId, ComponentType.Player) !== undefined) {
    nextState = { ...nextState, fovNeedsUpdate: true };
  }

  const fallenLevels = startZ - landingZ;
  const feetPerZ = nextState.campaign.rules.map.feetPerZLevel ?? DEFAULT_FEET_PER_Z_LEVEL;
  const fallenFeet = fallenLevels * feetPerZ;
  const landingTileId = getTileIdAt(nextState.map, pos.x, pos.y, landingZ);
  const activeRuleset = getActiveRuleset(nextState);
  const fallContext: EntityFallContext = {
    fromZ: startZ,
    toZ: landingZ,
    fallenLevels,
    fallenFeet,
    landingTileId,
    ...(options?.isIntentionalJump !== undefined ? { isIntentionalJump: options.isIntentionalJump } : {})
  };

  if (activeRuleset.onEntityFallLanded) {
    return activeRuleset.onEntityFallLanded(nextState, entityId, fallContext);
  }
  return applyDefaultConsoleFallDamage(nextState, entityId, fallContext);
}
```
- **Ramp & Stair Traversal in `movement.system.ts` & `movement_displacement.ts`:**
  - Horizontal `(dx, dy)` step from `(x, y, z)`:
    1. If origin tile `(x, y, z)` has `verticalLink === 'ramp'` and destination `(nx, ny, z)` is blocked/solid while `(nx, ny, z + 1)` is traversable & supported -> resolve step to `(nx, ny, z + 1)`!
    2. If destination `(nx, ny, z)` has `isOpenAir === true` and `(nx, ny, z - 1)` has `verticalLink === 'ramp'` (and is traversable) -> resolve step smoothly down to `(nx, ny, z - 1)` without falling!
    3. Otherwise resolve normally at `z`, then invoke `resolveGravityForEntity` after displacement completes.
  - Vertical `(dx = 0, dy = 0, dz = ±1)` step from `(x, y, z)`:
    1. Check for a `PortalComponent` at `(x, y, z)` if no intra-area vertical link/flight/climb applies -> preserve seamless `<`/`>` portal usage!
    2. Check declarative `verticalLink` (`dz > 0`: origin is `stairs_up`/`stairs_both`/`ladder` or target is `stairs_down`/`stairs_both`/`ladder`; `dz < 0`: origin is `stairs_down`/`stairs_both`/`ladder` or target is `stairs_up`/`stairs_both`/`ladder`).
    3. Check flight (`movementModes.fly > 0`) when destination `(x, y, z + dz)` is `isOpenAir` or walkable.
    4. Delegate to `RulesetContract.canActorAdjustAltitude(state, entityId, dz)` (enabling D&D 3.5e *Climb* wall scaling).
    5. Commit displacement to `(x, y, z + dz)` cleanly via `displaceEntityStep` (with `targetZ`).

#### Step 176.6 — Multi-Z Vertical Alignment Validator
- **File:** `src/editor/validator/area.validator.ts`
- Validate `staticMap.zLevels` row lengths, legends, and `placedEntities` with `z`.
- For every cell `(x, y, z)` across `layout` + `zLevels` whose `TileDefinition.verticalLink` is defined:
  - `stairs_up` / `stairs_both` / `ladder`: verify `(x, y, z + 1)` exists and is traversable (`walkable || isOpenAir`); emit a warning if `(x, y, z + 1)` lacks a return link (`stairs_down`/`stairs_both`/`ladder`/`isOpenAir`).
  - `stairs_down`: verify `(x, y, z - 1)` exists and is traversable.
  - `ramp`: verify `(x, y, z + 1)` has `isOpenAir === true` (headroom) and at least one 8-way neighbor at `z + 1` is walkable/supported.

---

### Milestone 177: Multi-Z Viewport Peeking, 3D Line-of-Sight & Vertical Lighting Propagation

#### Step 177.1 — 3D Shadowcasting (`src/map/fov_3d.ts`) & Vertical Lighting (`src/systems/light_emitter.system.ts`)
- **New File:** `src/map/fov_3d.ts`
- **Modified Files:** `src/map/fov.ts`, `src/systems/map.system.ts`, `src/systems/light_emitter.system.ts`

```ts
// src/map/fov_3d.ts
export function isTileVerticallyTransparent(state: Readonly<GameState>, x: number, y: number, z: number): boolean {
  const tileDef = getTileDefAt(state, x, y, z);
  if (!tileDef) return false;
  if (tileDef.blocksVerticalLoS !== undefined) return !tileDef.blocksVerticalLoS;
  return tileDef.isOpenAir === true || tileDef.transparent;
}

export function has3DLineOfSight(
  state: Readonly<GameState>,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number
): boolean {
  const line = getBresenhamLine3D(x0, y0, z0, x1, y1, z1);
  for (let i = 1; i < line.length - 1; i++) {
    const pt = line[i]!;
    const prev = line[i - 1]!;
    const tileDef = getTileDefAt(state, pt.x, pt.y, pt.z);
    if (!tileDef) return false;
    const verticalStep = pt.z !== prev.z;
    if (verticalStep) {
      if (!isTileVerticallyTransparent(state, pt.x, pt.y, pt.z)) return false;
    } else if (!tileDef.transparent) {
      return false;
    }
    for (const eId of getEntitiesAtPosition(state, pt.x, pt.y, pt.z)) {
      const tags = getComponent(state, eId, ComponentType.Tags) as TagsComponent | undefined;
      if (tags?.tags.includes('opaque')) return false;
      const field = getComponent(state, eId, ComponentType.Field) as FieldComponent | undefined;
      if (field && (field.blocksLoS === true || state.campaign.fields[field.fieldType]?.blocksSight === true)) {
        return false;
      }
    }
  }
  return true;
}

export function computeFOV3D(
  state: GameState,
  px: number,
  py: number,
  pz: number,
  radius: number
): Set<number> {
  // 1. Compute fast O(r^2) 2D shadowcasting on observer's active Z-slice `pz`
  // 2. For every visible cell (x, y, pz) that is vertically transparent (or observer's column),
  //    cast vertical sight columns down (`pz - 1 .. minZ`) and up (`pz + 1 .. maxZ`),
  //    validating oblique rays via `has3DLineOfSight` and emitting `toMapTileKey(state.map, tx, ty, tz)`.
}
```
- `computeFOV(state, px, py, radius?, pz = 0)` in `src/map/fov.ts`: if `isMultiZMap(state.map)` returns `computeFOV3D(state, px, py, pz, fovRadius)`; otherwise runs the exact existing 2D `ROT.FOV.PreciseShadowcasting`!
- `light_emitter.system.ts`: add `readonly z: number` to `ResolvedActiveLightEmitter`; `evaluateDynamicLightAtTile(state, x, y, z = 0)` computes 3D Euclidean distance using `feetPerZLevel` and validates LoS via `has3DLineOfSight` when `z !== emitter.z`.

#### Step 177.2 — Multi-Z Depth-Dimmed Rendering, `cameraZOffset` Peeking & Conflict-Free Keybinds
- **Files:**
  - `src/types/intents/intent.enum.ts`, `src/types/intents/camera.intents.ts`, `src/actions/core.actions.ts`, `src/actions/action.registry.ts`: Add `IntentType.AdjustCameraZ` (`dz: number`, `reset?: boolean`, `isImmediate: true`). Clamps `cameraZOffset` cleanly within `[minZ - playerZ, maxZ - playerZ]`.
  - `src/core/input/command_catalog.ts`, `src/core/input/gameplay_input.ts`, `src/core/input/shortcut_input.ts`:
    - Update `action.interact` defaultBindings to `[{ key: ',' }, { key: '.' }]`.
    - Register `move.up_z` (`[{ key: '<' }]`), `move.down_z` (`[{ key: '>' }]`), `camera.peek_z_up` (`[{ code: 'PageUp' }, { key: '[' }]`), `camera.peek_z_down` (`[{ code: 'PageDown' }, { key: ']' }]`), `camera.peek_z_reset` (`[{ code: 'Home' }]`).
    - In `gameplay_input.ts`: when `isTargeting` or `isInspecting`, `move.up_z` / `move.down_z` shifts cursor Z (`MoveTargetIntent.dz` / `MoveInspectIntent.dz`); in normal gameplay, queues `createMoveAction(playerEntityId, 0, 0, +1 | -1)`.
  - `src/core/presentation_queue.ts`: mark `PresentationDomain.Map`, `PresentationDomain.Entities`, and `PresentationDomain.HUD` dirty when `prev.cameraZOffset !== next.cameraZOffset`.
  - `src/rendering/viewport_snapshot.types.ts`, `src/rendering/viewport_snapshot.ts`, `src/rendering/renderer.ts`, `src/rendering/ui/vfx_overlay.ui.ts`, `src/rendering/tactical_snapshot.ts`, `src/rendering/inspect_tooltip.ts`, `src/rendering/ui/hud/ChronosStrip.tsx`:
    - Add `readonly depthDelta?: number | undefined;` to `ViewportCellDTO` and `readonly tint?: string | undefined;` to `FogOverlayCellDTO` (plus `readonly viewZ: number;` on `ViewportSnapshot`).
    - In `buildViewportSnapshot`: compute `viewZ = (playerPos?.z ?? 0) + (state.cameraZOffset ?? 0)`. When tile at `(mapX, mapY, viewZ)` has `isOpenAir === true`, scan `dz = 1..MAX_RENDER_DEPTH_LAYERS` to pick the first non-open-air floor/solid tile (and entities at that depth!), applying deterministic atmospheric depth dimming (`dimHexColorByDepth(hex, depthDelta)`) for ASCII and emitting cool blue-slate `tint` (`rgba(15, 28, 52, 0.25 * depthDelta)`) in `fogOverlay` for sprites.
    - Update `renderFogOverlayCanvas` in `src/rendering/ui/vfx_overlay.ui.ts` to paint `cell.tint ?? \`rgba(0, 0, 0, ${cell.alpha})\`` so custom depth tints render faithfully!
    - Update `cellEquals` in `src/rendering/renderer.ts` to compare `a.depthDelta !== b.depthDelta`.
    - Filter `tactical_snapshot.ts` unit badges and `inspect_tooltip.ts` by `viewZ` (or visible depth beneath `open_air`), and display compact `Z: <viewZ>` + `▲/▼` peek buttons in `ChronosStrip.tsx` whenever `isMultiZMap(state.map)` is true.

---

### Milestone 178: Hierarchical 3D Region Pathfinding (`RegionGrid` / HPA\*) & Shared Dijkstra Flow Fields

#### Step 178.1 — Chunk Connectivity `RegionGrid` & HPA\* Portal Graph
- **New Files:** `src/map/region_graph.ts`, `src/ai/pathfinding_hpa.ts`
- **Design Details:**
  - `rebuildChunkRegions(chunk, palette, tilesRegistry)`: 8-way BFS flood-fill over walkable cells in `chunk`, assigning contiguous pocket IDs `1..K` into `chunk.regionId` (`Uint16Array`, `0` = blocked) and clearing `CHUNK_DIRTY_REGION`.
  - `RegionPortalGraph`:
    - Nodes: `regionKey = "${cx},${cy},${cz}:${localRegionId}"` mapped to `componentId` (Disjoint-Set Union for **$O(1)$ reachability rejection**).
    - Edges:
      - **Horizontal Border Portals:** contiguous walkable spans along shared edges of `(cx, cy, cz)` and `(cx±1, cy±1, cz)` (midpoint waypoint).
      - **Vertical Portals:** `verticalLink` tiles (`ramp`, `stairs_up`, `stairs_down`, `stairs_both`, `ladder`) connecting `(cx, cy, cz, regionA)` and `(cx, cy, cz±1, regionB)`.
    - **Finite Map Parity:** Finite maps partition cleanly into virtual `16×16` sectors per Z-slice using the exact same `RegionPortalGraph` structure, cached in a WeakMap/LRU keyed by `(mapRef, areaId)` — zero ECS state bloat!
  - `findHierarchicalPath3D(state, entityId, start, goal, options?)`:
    1. Queries `areCoordinatesConnected3D(graph, start, goal)` -> returns `null` immediately in $O(1)$ if disconnected (unless mover has flight/burrow!).
    2. Runs abstract A\* over `RegionPortalGraph` to locate the next portal exit if `start` and `goal` live in different chunks/regions.
    3. Refines the local segment using bounded 3D A\* (supporting horizontal 8-way + ramp ascent/descent + stair `dz = ±1`, hard-corner checks, and multi-tile footprint clearance).

#### Step 178.2 — Shared Multi-Agent Dijkstra Flow Fields (`src/ai/flow_field.ts`)
- **New File:** `src/ai/flow_field.ts`
- **Modified Files:** `src/ai/follow.behavior.ts`, `src/ai/hunt.behavior.ts`, `src/ai/companion_targeting.ts`, `src/ai/flee.behavior.ts`

```ts
// src/ai/flow_field.ts
export interface FlowField3D {
  readonly areaId: string;
  readonly goalX: number;
  readonly goalY: number;
  readonly goalZ: number;
  readonly maxRadius: number;
  readonly distances: ReadonlyMap<number, number>; // packWorldCoord3D -> cost
}

/**
 * Computes or retrieves a cached bounded 3D Dijkstra Flow Field radiating outward from `(goalX, goalY, goalZ)`.
 * Cache invalidates automatically when `state.map` reference changes or any covered chunk carries `CHUNK_DIRTY_REGION`.
 */
export function getOrComputeFlowField3D(
  state: Readonly<GameState>,
  goalX: number,
  goalY: number,
  goalZ: number,
  maxRadius?: number
): FlowField3D;

/**
 * Samples the optimal O(1) descending step `{ dx, dy, dz }` from `(fromX, fromY, fromZ)` using `field`,
 * verifying dynamic actor occupancy and multi-tile footprint clearance.
 */
export function sampleFlowFieldStep3D(
  state: GameState,
  field: FlowField3D,
  entityId: EntityId,
  fromX: number,
  fromY: number,
  fromZ: number
): { readonly dx: number; readonly dy: number; readonly dz: number } | null;
```
- Update `computeNextStepToward(state, entityId, fromX, fromY, goalX, goalY, fromZ = 0, goalZ = 0)` in `src/ai/follow.behavior.ts`:
  - Returns `{ dx, dy, dz }` (with `dz = 0` on 2D steps).
  - For normal walkers, samples `getOrComputeFlowField3D` in $O(1)$ when within flow radius (so 50 chasing monsters share 1 single Dijkstra expansion!); falls back to `findHierarchicalPath3D` across distant chunks/Z-levels or for flyers/burrowers/custom movement modes!
  - Updates `huntBehavior`, `followBehavior`, and `companion_targeting.ts` to compute 3D distance and emit `MoveIntent` with `dz` when traversing stairs/ramps/flight!

---

### Milestone 179: Z-Aware `RulesetContract` Hooks & D&D 3.5e 3D Mechanics

#### Step 179.1 — Extend `RulesetContract` (`src/types/ruleset.types.ts`)
Add 4 optional 3D hooks (preserving 100% backwards compatibility with `classic` and any third-party cartridge):
```ts
export interface Coord3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ElevationCombatModifiers {
  readonly attackBonus: number;
  readonly coverAcBonus: number;
  readonly label?: string | undefined;
}

export interface AltitudeAdjustmentCheck {
  readonly allowed: boolean;
  readonly mode: 'fly' | 'climb' | 'stairs' | 'none';
  readonly skillCheck?: { readonly skillId: string; readonly dc: number } | undefined;
  readonly reason?: string | undefined;
}

// Optional hooks added to RulesetContract:
measureDistance3DFt?(from: Coord3D, to: Coord3D, feetPerZLevel?: number): number;
evaluateElevationCombatModifiers?(
  state: Readonly<GameState>,
  attackerId: EntityId,
  defenderId: EntityId,
  attackKind: 'melee' | 'ranged'
): ElevationCombatModifiers;
onEntityFallLanded?(state: GameState, entityId: EntityId, fallContext: EntityFallContext): GameState;
canActorAdjustAltitude?(state: Readonly<GameState>, entityId: EntityId, dz: number): AltitudeAdjustmentCheck;
```

#### Step 179.2 — D&D 3.5e 3D Geometry, Cover, Spherical AoE, High Ground, *Fly*, *Climb* & *Feather Fall*
- **Files:**
  - `src/rulesets/dnd35e/spatial/grid_geometry.ts`:
    - Add `measureDnD35Distance3DFt(x1, y1, z1, x2, y2, z2, feetPerZLevel = 5)`: converts `dz` to 5-ft square units (`dzSq = Math.round((Math.abs(z2 - z1) * feetPerZLevel) / FEET_PER_GRID_SQUARE)`), sorts `[dx, dy, dzSq]` as `a >= b >= c`, and applies the exact SRD `1-2-1-2` diagonal rule (`(a + floor(0.5 * (b + c))) * 5`, collapsing identically to `measureDnD35DistanceFt` when `z1 === z2`!).
  - `src/rulesets/dnd35e/spatial/cover_senses.ts`:
    - Add `evaluateCover3D(attackerPos, targetPos, isSolidAt3D, hasInterveningCreatureAt3D, isRangedAttack)` tracing `getBresenhamLine3D` across `(x, y, z)`, detecting floor/ceiling Total Cover (`blocksLineOfEffect: true`) and parapet/cliff-lip grazing Standard Cover (`+4` AC, `+2` Reflex).
    - Update `resolveTileLightReading` / `resolveEffectiveTileIllumination` to accept optional `z = 0` and forward `z` to `evaluateDynamicLightAtTile` & `queryActiveFieldsAtPosition`.
  - `src/rulesets/dnd35e/magic/aoe_rest.ts`, `target_category_filter.ts`, `spell_cast_resolver.ts`:
    - Add `computeAoEAffectedSquares3D(shape, origin3D, target3D, radiusFt, isBlockedAt3D, feetPerZLevel = 5)` supporting true 3D spherical `burst` / `spread` (*Fireball* 20-ft radius sphere!), 3D `cone`, 3D `line`, and vertical `cylinder` while respecting `evaluateCover3D`.
    - Update `enumerateSpellTargets` to collect targets across affected `(x, y, z)` voxels whenever `isMultiZMap(state.map)` is true (preserving fast 2D path when single-Z).
  - `src/rulesets/dnd35e/spatial/dnd35e_spatial_3d.ts` *(New Tier 2 Module)*:
    - `resolveDnD35eEntityMovementModes(state, entityId)`: merges static `dndData.movementModes` with dynamic DAG `ruleOverrides` (`can_fly` -> `60 ft`, or `40 ft` in medium/heavy armor/load) and `fly_speed` / `climb_speed` StatModifiers — zero spell-ID checks!
    - `evaluateDnD35eElevationCombatModifiers(state, attackerId, defenderId, attackKind)`: grants SRD `+1` High Ground melee attack bonus (`HIGH_GROUND_MELEE_ATTACK_BONUS = 1`, `[High Ground +1]`) when `attackerZ > defenderZ` within 3D melee reach.
    - `onDnD35eEntityFallLanded(state, entityId, fallContext)`:
      1. Inspects DAG `ruleOverrides` for `immune_falling_damage === true` (*Feather Fall*!) -> `0` damage, safe upright landing!
      2. Subtracts `fall_damage_reduction_ft` StatModifiers (Monk Slow Fall) and `10 ft` on intentional jump or passing `Tumble DC 15` (and halves/mitigates deep water landings).
      3. Rolls `Math.min(20, Math.floor(effectiveFallFt / 10))` × `1d6` bludgeoning damage + applies `'prone'` condition when damage > 0!
    - `canDnD35eActorAdjustAltitude(state, entityId, dz)`: allows `fly` anywhere open, or `climb` when adjacent to `isClimbable` / solid obstacle (auto-succeeding with natural `climb > 0`, otherwise requiring a D&D 3.5e `Climb` check with `+2` for `climbing_kit` tag).
  - `src/rulesets/dnd35e/combat/combat_exchange_phases.ts` & `src/rulesets/dnd35e/dnd35e_ruleset.ts`:
    - Wire `evaluateDnD35eElevationCombatModifiers` into `resolveStrikePreAttackContext`.
    - Wire all 4 new hooks + `resolveDnD35eEntityMovementModes` on `dnd35eRulesetContract`.

---

### Default Campaign Multi-Z Showcase, Verification Suite & SSOT Synchronization

#### Step 46.Final — Content Showcase, Tests, Docs & 8-Stage Verification
1. **Default Campaign Showcase (`public/data/campaigns/default/tiles.json`, `areas.json`):**
   - Add `open_air`, `stone_ramp`, `wooden_stairs_up`, `wooden_stairs_down`, `climbable_wall` tiles.
   - Add 3-level static area `watchtower_overlook` (`z = -1` cellar/pit, `z = 0` courtyard + ramp + stairs, `z = 1` battlement overlooking `open_air` courtyard) connected from `outer_crossroads`.
   - Enable `minZ: -2, maxZ: 2` + `openAir: "open_air"`, `underground: "stone_wall"`, `ramp: "stone_ramp"` on `endless_frontier`.
2. **Comprehensive Unit & Regression Tests:**
   - `tests/m176_voxel_z_gravity.test.ts`: 3D `packWorldCoord3D` round-trips, `spatialIndex` uniform `"x,y,z"` parity, multi-Z static `zSlices` + streaming `cz` delta reload, ramp ascent/descent, stairs/ladder traversal, gravity falling & crossing collapse, Vertical Alignment Validator error/warning cases.
   - `tests/m177_fov3d_light_peeking.test.ts`: 3D shadowcasting down through `open_air` & blocking across solid ceilings, 3D dynamic light attenuation across Z, depth-dimmed `ViewportSnapshot` (`depthDelta` + `fogOverlay.tint`), `cameraZOffset` peeking & zero keybind conflicts.
   - `tests/m178_hpa_region_flow_field.test.ts`: `rebuildChunkRegions`, $O(1)$ disconnected-target rejection, HPA\* 3D routing across chunk borders/ramps/stairs, shared 3D Dijkstra Flow Field multi-agent reuse & `CHUNK_DIRTY_REGION` invalidation.
   - `tests/m179_dnd35e_3d_mechanics.test.ts`: 3D `1-2-1-2` distance, *Fireball* 20-ft 3D sphere hitting elevated/flying foes while blocked by solid ceiling, High-Ground `+1` melee bonus, dynamic *Fly* altitude control, *Feather Fall* (`immune_falling_damage`) & `1d6`/10 ft falling damage, *Climb* wall scaling.
3. **Documentation, Prompt Kit & SSOT Parity:**
   - Update `docs/ssot/ssot_console.json` & `docs/ssot/ssot_dnd35e.json` for all new `.ts` files (`gravity.system.ts`, `fov_3d.ts`, `region_graph.ts`, `pathfinding_hpa.ts`, `flow_field.ts`, `dnd35e_spatial_3d.ts`).
   - Run `bun scripts/map-codebase.ts` and `bun scripts/generate-ai-prompt-kit.ts`.
   - Update `docs/ARCHITECTURE.md` (§9.33) and `docs/MILESTONES.md` (marking Phase 46 / Milestones 176–179 `[x]`).
   - Run `./verify.sh` and confirm all 8 stages pass with 0 errors!
