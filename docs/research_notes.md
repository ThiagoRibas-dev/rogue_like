# Phase 47 Research Notes — Active-Chunk Cellular Physics, Terrain Sculpting & RimWorld/DF Agent Substrate

**Milestones Covered:** 180, 181, 182, 183 (`docs/MILESTONES.md` §Phase 47)  
**Baseline Commit:** `7244b92ba` (`main`, Phase 46 complete — 441 tests passing, 8/8 `verify.sh` green)

---

## 1. Reiteration of Governing Rules & Architectural Constraints

All Phase 47 designs strictly adhere to `AGENTS.md` and `docs/ARCHITECTURE.md`:

- **TypeScript Strictness (§3):** Zero `any`, zero magic gameplay values (all named constants or JSON config), explicit return types on every function, `exactOptionalPropertyTypes: true` compliance, exhaustive `switch` with `assertNever`, flat guard-clause control flow.
- **ECS & Serialization Purity (§4):** Pure data component interfaces with no methods; **zero `Map` or `Set`** inside ECS components or serializable `GameState` sub-objects (`Record<string, T>` and `ReadonlyArray<T>` only) so `save.ts` / `JSON.stringify` stays deterministic and lossless.
- **Three-Tier Placement Heuristic (Rule 16):**
  - **Tier 1 (Core Console Engine — `src/core/`, `src/map/`, `src/systems/`, `src/ai/`, `src/types/`):** Dirty-bitset cellular fluid & temperature simulation, analytical chunk sleep catch-up, voxel terrain sculpting & structural cave-in physics, universal Needs/Thoughts/Mood/Stress engine, spatial Designations, Stockpile zones, atomic Job Reservation Blackboard, Hauling/Labor AI behavior, and Workshop Crafting DAGs.
  - **Tier 2 (Ruleset Cartridge — `src/rulesets/dnd35e/`):** Declarative `terrain_sculpt` and `fluid_spawn` spell effect unit handlers in `spell_cast_units.ts` / `spell_cast_resolver.ts`, optional morale/mood hooks on `RulesetContract`.
  - **Tier 3 (System & Campaign Content — `public/data/`):** Spell JSONs (`stone_shape.json`, `passwall.json`, `transmute_rock_to_mud.json`, `create_water.json`), declarative tile/material/recipe/psychology properties, and `default` campaign showcase.
- **Baseline Rules + Declarative Modifiers (Rule 17):** Numeric effects (mood morale bonuses, temperature resistance, work-speed multipliers) use `StatModifier` resolved via the stacking engine; qualitative behavioral switches (mental break overrides, fluid immunities) use tags / `RuleOverride`.
- **Universal Actor Symmetry (Rule 18):** Adventure Mode NPCs (villagers, scouts, monsters) and Fortress Mode colonists share the exact same `NeedsComponent`, extended `MemoryComponent`, `LaborProfileComponent`, and `ActionIntent` execution pipeline — zero separate "Colonist" entity schema.
- **Zero Content-ID Branching (Rule 21 — "New Content Mod" Litmus Test):** Engine and cartridge `.ts` code must never branch on specific spell, tile, item, or thought IDs (`if (spellId === 'passwall')`, `if (tileId === 'stone_wall')`, `if (itemId === 'pickaxe')`). All capabilities are expressed declaratively via Zod schema fields (`terrain_sculpt` / `fluid_spawn` spell units, `TileDefinition` mineability/yield/load-bearing/thermal fields, item/furniture tags, and configurable need/thought/recipe definitions).
- **Default Campaign Feature Showcase (§5):** `public/data/campaigns/default/` must actively showcase all Phase 47 capabilities while keeping all 5 campaigns (`default`, `dnd35e-crypt`, `megacampaign`, `realms-of-shroudgarde`, `shroudgarde`) passing `run-validator.ts`.

---

## 2. Existing Codebase Inventory & Milestone Mapping

### 2.1 Milestone 180 — Dirty-Bitset Cellular Physics & Analytical Sleep Catch-Up

**Existing Substrate Already in Place:**
- `src/types/world-chunk.types.ts` (`WorldChunk`): Already contains all 6 SoA TypedArray planes (`tileType: Uint16Array`, `materialId: Uint16Array`, `fluid: Uint8Array`, `temperature: Int16Array`, `flags: Uint8Array`, `regionId: Uint16Array`) plus `dirtyFlags: number` and `lastSimulatedTurn: number`.
- `src/constants/world_chunk.constants.ts`: Already defines `DEFAULT_AMBIENT_TEMP_C = 20`, `CHUNK_DIRTY_NONE`, `CHUNK_DIRTY_PERSIST`, `CHUNK_DIRTY_REGION`, `CHUNK_DIRTY_FLUID`, `CHUNK_DIRTY_TEMP`, `CHUNK_FLAG_OUTDOOR`, `CHUNK_FLAG_DIRTY_CELL`.
- `src/map/world_chunk.ts`: Binary `RLCK` v1 codec (`serializeWorldChunkToBuffer` / `deserializeWorldChunkFromBuffer`) already persists all 6 planes + `dirtyFlags` + `lastSimulatedTurn` — **zero binary format breaking change required**.
- `src/map/map_accessor.ts`: Canonical unified reader/writer across finite `GameMap.tiles`/`zSlices` and streaming `GameMap.chunkGrid`.
- `src/systems/map/chunk_streaming.ts` (`updateStreamingWorldWindow`): Canonical wake/evict hook for Ring 0 chunks.
- `src/core/loop/intent_cost_resolver.ts`: Canonical per-action world tick hook (runs `processFieldsTick` when `energyCost > 0`, then `updateStreamingWorldWindow` and `processTier2LocalCadence`).
- `src/systems/world_time_skip.ts` (`advanceWorldTimeBulk`, `advanceWorldTimeBulkAsync`): Canonical bulk time advancement hook for rest/wait skips.
- `src/systems/field.system.ts` & `src/systems/crossing.system.ts` & `src/systems/breath.system.ts`: Existing field chemistry (`fire`, `oil`, `steam_cloud`), ice crossings (`frozen_surface`), and submersion/drowning tracking.

**Target Design & Interactions:**
1. **Zero-Allocation `fluid: Uint8Array` Bit Layout:**
   - Bits `0..2` (`0x07`): Depth `0..7` (`0/7` dry through `7/7` full).
   - Bits `3..5` (`0x38`): Fluid kind enum (`0=none`, `1=water`, `2=magma`, `3=oil`, `4=mud`).
   - Bits `6..7` (`0xC0`): Active/pressurized flags.
2. **Unified Finite & Streaming Cell Access (`MapAccessor`):**
   - Streaming maps read/write `chunk.fluid` and `chunk.temperature` directly.
   - Finite static/digger maps (`watchtower_overlook`, `dungeon_1`, etc.) do not currently carry `chunkGrid`. A lazy, sparse `FinitePhysicsOverlay` (or lazy 16×16 `WorldChunk` backing instantiated on first fluid/temp write) allows `fluid_physics.ts` and `temperature_physics.ts` to run one canonical dirty-chunk loop across **both** finite and streaming maps at zero cost when dormant.
3. **Dirty-Bitset Cellular Physics (`src/systems/physics/fluid_physics.ts`, `src/systems/physics/temperature_physics.ts`):**
   - Iterate **strictly** over chunks with `(dirtyFlags & CHUNK_DIRTY_FLUID) !== 0` or `(dirtyFlags & CHUNK_DIRTY_TEMP) !== 0`.
   - **Fluid Pass:** Vertical gravity spillover (`(x,y,z) -> (x,y,z-1)`) first, then 4-way horizontal hydrostatic equalization (magma spreads slower via viscosity step). Handles phase transitions (`water` + `magma` -> obsidian/basalt tile + `steam_cloud` field; `oil` + ignition temp / `fire` field -> `fire` field; `water` <= 0°C -> `frozen_surface` crossing; `water` >= 100°C -> `steam_cloud`). Flags neighbor chunks on cross-boundary flow and auto-clears `CHUNK_DIRTY_FLUID` on settled chunks.
   - **Temperature Pass:** 3D discrete heat diffusion toward ambient baseline (`DEFAULT_AMBIENT_TEMP_C`) driven by thermal sources (`magma`, `fire` fields, cold fields) and tile `thermalConductivity`. Auto-clears `CHUNK_DIRTY_TEMP` once every cell in the chunk converges within `±1°C` of ambient with no active thermal emitter.
4. **Closed-Form Analytical Sleep Catch-Up (`src/systems/physics/chunk_catchup.ts`):**
   - Triggered on chunk wake (`chunk_streaming.ts`) and bulk time skips (`world_time_skip.ts`) when `deltaTurns = state.globalTurn - chunk.lastSimulatedTurn > 0`.
   - Closed-form $O(N_{\text{cells}})$ math (no per-turn loop):
     - Exponential temperature relaxation: $T(t) = T_{\text{amb}} + (T_0 - T_{\text{amb}})e^{-\lambda \Delta t}$.
     - Fluid evaporation of shallow puddles (`depth === 1`) and drain equilibrium.
     - Fire burnout, perishable item/corpse decay advancement, and crop/growth stage advancement.
     - Stamps `chunk.lastSimulatedTurn = state.globalTurn`.

---

### 2.2 Milestone 181 — Dynamic Terrain Sculpting, Construction & Structural Support

**Existing Substrate Already in Place:**
- `src/map/map_accessor.ts` (`setTileIdAt`): Already mutates finite slices or clones `WorldChunk` and marks `CHUNK_DIRTY_PERSIST | CHUNK_DIRTY_REGION`.
- `src/map/region_graph.ts` & `src/ai/flow_field.ts`: Automatically rebuild HPA* connectivity and invalidate flow fields when `CHUNK_DIRTY_REGION` is set.
- `src/systems/gravity.system.ts`: Already drops unsupported actors/entities across Z-levels.
- `src/constants/verbs.constants.ts` & `src/systems/apply.system.ts`: Unified `ApplyIntent` pipeline already supporting `TileTarget` with `{ type: 'tile', x, y, z? }` (currently missing `'mine'`, `'chop'`, `'build'`, `'craft'` verbs).
- `src/rulesets/dnd35e/types/system/spell_system.types.ts`, `spell_cast_resolver.ts`, `spell_cast_units.ts`, `system_content_spell_ids.ts`:
  - `stone_shape.json` exists (currently uses `spatial_field` only).
  - `passwall.json`, `transmute_rock_to_mud.json`, and `create_water.json` do not yet exist on disk.
  - **Multi-Z Gap Found:** `ApplySpellEffectsContext.targetPos` (`spell_cast_effects.ts:126`) and `applySpecialSpellUnit` (`spell_cast_units.ts:48`) currently type `targetPos` as `{ x, y }` without `z`, and `placementUnits` (`spell_cast_resolver.ts:297`) only filters `spatial_field | summon`. Both must be updated to carry `z` and include `terrain_sculpt | fluid_spawn`.

**Target Design & Interactions:**
1. **Declarative Tile & Material Metadata (`src/types/campaign/world.ts`, `TileDefinitionSchema`):**
   - Optional declarative fields: `mineable?: boolean`, `minedTileId?: string`, `mineYieldItemId?: string`, `mineYieldCount?: number`, `mineWorkCost?: number`, `isLoadBearing?: boolean`, `thermalConductivity?: number`, `ignitionTempC?: number`.
   - Deterministic `MaterialPaletteRegistry` (mirroring `src/map/tile_palette.ts`) encoding material IDs into `chunk.materialId: Uint16Array`.
2. **Terrain Sculpting & Construction (`src/systems/construction.system.ts`):**
   - `sculptTerrainVoxel`: Canonical voxel mutation updating `tileType` + `materialId`, dirtying `PERSIST | REGION | FLUID | TEMP` (including neighbor chunks when on boundary), setting `fovNeedsUpdate: true`, updating designations, and invoking structural support + gravity checks.
   - `mineTerrainTile`: Validates reach, `tileDef.mineable`, optional `tool:mining` tag, carves tile to `minedTileId`, drops boulder/ore items, supports channeling down (`z` -> `open_air` + ramp/floor below).
   - `constructTerrainTile`: Consumes material items from actor inventory or adjacent stockpile/floor, builds walls, floors, stairs, ramps, or bridges via declarative blueprints.
   - Temporary spell-sculpted terrain tracking (e.g., *Passwall* tunnel reverting after duration expires) stored cleanly as serializable timed voxel-revert entries in `GameState` (or ticked in `world_time_skip.ts` + `intent_cost_resolver.ts`).
3. **Connected Structural Support & Cave-Ins (`src/map/structural_support.ts`):**
   - Bounded BFS (`MAX_SUPPORT_SPAN_TILES = 6`) from altered cells verifying a connected support path to a load-bearing pillar/wall (`isLoadBearing === true` or solid ground at `z - 1`).
   - Unsupported overhangs collapse to `open_air`, drop rubble items, apply falling/crushing damage to entities underneath, and run `resolveGravityForEntity` for actors standing above.
4. **D&D 3.5e Sculpting & Fluid Spells (Rule 21 Compliant):**
   - Add two declarative `DnD35SpellEffectUnitSchema` variants:
     - `terrain_sculpt` (`sculptMode: 'carve' | 'shape' | 'transmute' | 'fill'`, `requiredSourceTags`, `targetTileId`, `radiusTiles`, `durationTurnsScaling?`, `revertTileId?`, `spawnFluidKind?`, `spawnFluidDepth?`).
     - `fluid_spawn` (`fluidKind`, `depth`, `radiusTiles`, `depthScaling?`).
   - Upgrade `stone_shape.json` and add `passwall.json`, `transmute_rock_to_mud.json`, and `create_water.json` (plus register IDs in `system_content_spell_ids.ts`).

---

### 2.3 Milestone 182 — Universal Needs, Thoughts, Mood & Stress Engine

**Existing Substrate Already in Place:**
- `src/types/components/actor_components.types.ts`:
  - `MemoryComponent` (lines 190–213) is the **sole existing owner** of `facets`, `values`, `stress` (`0..100`), `thoughts: ReadonlyArray<Thought>`, `annoyedDuration`, `gratefulDuration`. (Note: there is **no** separate `PersonalityComponent` in `ComponentType`.)
  - `HungerComponent` (lines 116–123) tracks `satiation` and `maxSatiation` via `src/systems/hunger.system.ts`.
- `src/systems/personality.system.ts`: Runs inside `processTier2LocalCadence` (`src/core/simulation_cadence.ts`) and `stepBulkMacroCadence` (`src/systems/world_time_skip.ts`) every `LOCAL_NARRATIVE_TICK_INTERVAL` turns.
- `src/constants/personality.constants.ts`: Defines `STRESS_CORE_MEMORY_THRESHOLD`, `MAX_TRANSIENT_THOUGHTS`, etc.

**Target Design & Interactions:**
1. **`NeedsComponent` (`ComponentType.Needs`):**
   - Plain serializable record `needs: Readonly<Record<string, NeedMeterState>>` covering the 6 canonical needs (`rest`, `nourishment`, `shelter`, `comfort`, `social`, `safety`) plus extensible campaign-defined need IDs.
   - `nourishment` synchronizes directly with `HungerComponent.satiation / maxSatiation` when present (single source of truth).
   - `src/systems/psychology/needs.system.ts` evaluates environmental satisfaction (indoor/roofed shelter via `CHUNK_FLAG_OUTDOOR`/ceiling check, thermal comfort from M180 temperature plane, nearby furniture tags like `furniture:bed`/`furniture:table`, social proximity to non-hostiles, safety vs threats/hazards) and ticks during both live cadence and bulk rest/time-skips.
2. **Decaying/Stacking Thoughts, Mood Tiers, Inspirations & Mental Breaks (`src/systems/psychology/thoughts.system.ts`):**
   - Extend `Thought` on `MemoryComponent` with optional backward-compatible fields: `thoughtId?: string`, `moodDelta?: number`, `expiresAtTurn?: number`, `stackCount?: number`, `maxStacks?: number`.
   - Extend `MemoryComponent` with optional `mood?: number` (`0..100`), `moodTier?: MoodTier` (`'ecstatic' | 'happy' | 'content' | 'stressed' | 'breaking' | 'catatonic'`), `activeInspiration?: ActiveInspirationState`, `activeMentalBreak?: ActiveMentalBreakState`.
   - Weighted mood aggregation (incorporating `facets`/`values`) triggers deterministic Inspirations (`work_frenzy`, `inspired_craft`, `inspired_valor`) at high mood and Mental Breaks (`daze_wander`, `hide_in_room`, `tantrum`, `berserk`) at critical low mood/high stress.
   - `src/systems/ai.system.ts` checks `activeMentalBreak` before normal behavior scoring so breaking NPCs and colonists exhibit consistent emergent break behaviors.
   - Optional `RulesetContract.evaluateMoodModifiers` / DAG projection emits Layer B morale `StatModifier`s in D&D 3.5e.

---

### 2.4 Milestone 183 — Designation Layer, Job-Reservation Blackboard, Stockpiles, Hauling AI & Workshop Crafting DAGs

**Existing Substrate Already in Place:**
- `src/systems/ai.system.ts` (`BEHAVIOR_REGISTRY`) & `src/types/campaign/entity.ts` (`AIBehaviorEntrySchema`): Pluggable behavior architecture ready for a `'labor'` behavior entry.
- `src/ai/pathfinding_hpa.ts` (`computeHierarchicalNextStep`): 3D HPA* + shared Dijkstra flow fields (SSOT_CONSOLE mandates routing all multi-Z AI navigation here, never raw `ROT.Path.AStar`).
- `src/systems/inventory.system.ts`, `src/systems/apply.system.ts`, `src/actions/action.registry.ts`: Shared `ActionIntent` execution pipeline working identically in Turn-Based and RTwP modes.

**Target Design & Interactions:**
1. **Serializable `ColonySimulationState` on `GameState` & `SerializedGameState`:**
   - Stored as optional `colonyState?: ColonySimulationState` (zero overhead when unused; serialized directly in `save.ts`):
     - `designations: Readonly<Record<string, TileDesignation>>` (`mine | chop | haul | build | harvest | channel`, keyed by `"areaId:x,y,z"` or `"x,y,z"` per area).
     - `stockpiles: Readonly<Record<string, StockpileZone>>` (cells, `allowedTags`, `deniedTags`, `allowedItemIds`, `priority`, `maxItemsPerCell`).
     - `reservations: Readonly<Record<string, JobReservationToken>>` (atomic locks on `"tile:x,y,z"`, `"entity:<id>"`, `"workshop:<id>"` with `workerEntityId` + `expiresAtTurn`).
     - `workshops: Readonly<Record<string, WorkshopState>>` (bill queues with `do_x_times | maintain_stock | forever`, progress, inputs).
     - `timedTerrainReverts?: ReadonlyArray<TimedTerrainRevert>` (for temporary sculpting like *Passwall*).
2. **Actor Labor Profile (`ComponentType.LaborProfile`):**
   - Plain serializable `{ priorities: Readonly<Record<LaborKind, number>> }` (`0 = disabled`, `1 = highest` .. `4 = lowest`) + `activeJob?: ActiveLaborJobState`.
3. **New Tier 1 Labor Subsystems:**
   - `src/systems/labor/job_blackboard.ts`: Atomic `tryAcquireReservation`, `releaseReservation`, `releaseAllWorkerReservations`, `pruneExpiredReservations`. Hooked into `death.system.ts` and `chunk_streaming.ts` entity eviction so dead/sleeping workers never leave orphaned locks.
   - `src/systems/labor/designation.system.ts`: Spatial designation CRUD, validation against tile/entity capabilities, auto-completion cleanup.
   - `src/systems/labor/stockpile.system.ts`: Tag/item filter matching, priority-ranked destination cell lookup, unstocked haul candidate discovery.
   - `src/systems/labor/workshop.system.ts`: Multi-step Crafting DAG resolver (`CraftingRecipe` with `requiredInputs`, `requiredToolTag?`, `workUnits`, `outputs`, `workshopTag`). Automatically generates input-hauling sub-jobs when ingredients are not yet at the workshop, ticks work progress, spawns outputs, and manages bill repeat counts.
   - `src/ai/labor.behavior.ts`: Utility-scored labor selector registered as `'labor'` in `BEHAVIOR_REGISTRY`. Respects `LaborProfileComponent` priorities, urgent need overrides (eat/rest when critical), blackboard reservations, 3D `computeHierarchicalNextStep` routing, and emits standard `MoveIntent` / `PickUpIntent` / `DropIntent` / `ApplyIntent` actions.

---

## 3. Cascading Effects Matrix (AGENTS.md Rule 15)

| Change | Upstream (Callers / Emitters / Producers / Authors) | Downstream (Consumers / Renderers / Serializers / Validators) | Lateral (Mirrors / Sibling Campaigns / Registries / Docs) |
| :--- | :--- | :--- | :--- |
| **M180: Dirty-Bitset Cellular Fluids & Temperature (`fluid_physics.ts`, `temperature_physics.ts`, `chunk_catchup.ts`)** | `intent_cost_resolver.ts` (per-action tick), `chunk_streaming.ts` (wake catch-up), `world_time_skip.ts` (bulk skip catch-up), `field.system.ts` (fire/cold coupling), `spell_cast_units.ts` (`fluid_spawn`) | `map_accessor.ts` (fluid/temp getters & setters), `viewport_snapshot.ts` & `inspect_tooltip.ts` (fluid `1/7..7/7` rendering + °C inspect), `movement.system.ts` & `breath.system.ts` (wading/submersion), `needs.system.ts` (thermal comfort), `chunk_store.ts` & `world_chunk.ts` (delta persistence), `save.ts` (finite physics overlay serialization) | `world_chunk.constants.ts` (fluid bitmasks, thermal constants), `default/tiles.json` (thermal fields), `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md`, `docs/ARCHITECTURE.md` |
| **M181: Voxel Sculpting, Construction & Cave-Ins (`construction.system.ts`, `structural_support.ts`)** | `verbs.constants.ts` & `apply.system.ts` (`mine`, `chop`, `build`, `craft`), `labor.behavior.ts`, `spell_cast_resolver.ts` (3D `targetPos.z` + `placementUnits`) | `map_accessor.ts` (`setTileIdAt` dirty flags), `region_graph.ts` & `flow_field.ts` (HPA* cache invalidation), `fov_3d.ts` (`fovNeedsUpdate`), `gravity.system.ts` (cave-in & floor removal drops), `designation.system.ts` (clears completed designations), `save.ts` (timed terrain reverts) | `TileDefinitionSchema` (`src/types/campaign/world.ts`), `DnD35SpellEffectUnitSchema` (`spell_system.types.ts`), `system_content_spell_ids.ts`, `public/data/rulesets/dnd35e/spells/{stone_shape,passwall,transmute_rock_to_mud,create_water}.json`, `default/tiles.json`, `default/items.json`, `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json` |
| **M182: Universal Needs, Thoughts, Mood & Stress (`needs.system.ts`, `thoughts.system.ts`)** | `simulation_cadence.ts` (`processTier2LocalCadence`), `world_time_skip.ts` (bulk time skip), `hunger.system.ts` (nourishment sync), `personality.system.ts` (`recordThought` compatibility), combat/social/labor events | `actor_components.types.ts` & `components.types.ts` (`NeedsComponent`, extended `Thought` / `MemoryComponent`), `ai.system.ts` (mental break overrides), `ruleset.types.ts` & D&D 3.5e DAG (morale modifiers), `inspect_tooltip.ts` & HUD (mood/needs readout), `save.ts` (component serialization) | `EntityTemplateSchema` (`entity.ts`), `RulesConfigSchema` (`meta.ts`), `personality.constants.ts`, `default/entities.json`, `editor/blank_slate_campaign.ts`, `docs/ssot/ssot_console.json` |
| **M183: Designations, Blackboard, Stockpiles, Hauling AI & Workshops (`systems/labor/*`, `labor.behavior.ts`)** | `ai.system.ts` (`BEHAVIOR_REGISTRY['labor']`), `intent.enum.ts` / `action.registry.ts` (designation/stockpile/bill intents), `death.system.ts` & `chunk_streaming.ts` (worker reservation cleanup), `ecs_spawner.ts` (`LaborProfileComponent` hydration) | `game-state.types.ts` & `save.ts` (`colonyState` serialization), `viewport_snapshot.ts` & `tactical_snapshot.ts` (designation/stockpile visual overlays), `apply.system.ts`, `inventory.system.ts`, `construction.system.ts`, `pathfinding_hpa.ts` (3D routing) | `AIBehaviorEntrySchema` & `EntityTemplateSchema` (`entity.ts`), `CampaignDataSchema` / `RulesConfigSchema` (`campaign.types.ts` / `meta.ts`), `loader.ts`, `scripts/run-validator.ts`, `editor/blank_slate_campaign.ts`, `default/{areas,entities,items,rules}.json`, `docs/ssot/ssot_console.json` |

---

## 4. Open Architectural Decisions for User Confirmation

Before drafting `./docs/implementation_plan.md` (Step 4), please confirm your preferred direction on these 4 design points:

1. **Finite Map Cellular Physics Backing (M180/M181):**
   - **Option A (Recommended):** Support cellular fluid depth (`1/7..7/7`), temperature (`Int16` °C), and material IDs uniformly on **both** `streaming_overworld` (`chunkGrid`) and finite maps (`watchtower_overlook`, `dungeon_1`, etc.) via a lazy sparse per-Z `FinitePhysicsOverlay` (or lazy 16×16 `WorldChunk` backing instantiated on first fluid/temp write), keeping zero memory/CPU overhead on untouched finite maps.
   - **Option B:** Restrict cellular fluid/temperature simulation strictly to `streaming_overworld` (`chunkGrid`) maps.

2. **Psychology Component Ownership (M182):**
   - **Option A (Recommended):** Add a dedicated `NeedsComponent` (`ComponentType.Needs`) for the 6 configurable need meters (syncing `nourishment` with `HungerComponent`), while keeping `MemoryComponent` as the single canonical owner of `facets`, `values`, `stress`, `thoughts` (extended with optional decay/stack/mood fields), and mood/inspiration/break state. Avoids breaking existing `personality.system.ts`, `gossip.system.ts`, `dialogue.actions.ts`, and `ai.system.ts` consumers.
   - **Option B:** Create a separate `PersonalityComponent` and migrate `facets`/`values`/`stress`/`thoughts` off `MemoryComponent`.

3. **Crafting Recipes & Materials Registry Placement (M181/M183):**
   - **Option A (Recommended):** Place optional `craftingRecipes`, `materials`, `blueprints`, and `psychology` config inside `RulesConfigSchema` (with sensible engine defaults and optional overrides in `rules.json`), avoiding mandatory new JSON files across all 5 sibling campaigns (`default`, `dnd35e-crypt`, `megacampaign`, `realms-of-shroudgarde`, `shroudgarde`) while remaining 100% Zod-validated and editor-compatible.
   - **Option B:** Add new top-level optional JSON files (`materials.json`, `recipes.json`) wired into `CampaignDataSchema`, `loader.ts`, `CampaignCategorySchemas`, `blank_slate_campaign.ts`, and `scripts/run-validator.ts`.

4. **Phase 47 vs. Phase 48 UI & `default` Campaign Showcase Scope:**
   - **Option A (Recommended):** In Phase 47, render cellular fluid depth (`1/7..7/7`), designation markers, and stockpile zone tints on the viewport canvas + expose fluid depth, °C temperature, mood/needs, and active job in `inspect_tooltip.ts`, wire player `mine`/`build` verbs via `ApplyIntent`, and showcase all 4 milestones in `default` (`watchtower_overlook` / `safe_hub` / `endless_frontier` with mineable stone, water/magma test basin, workshop + stockpile + autonomous laborer NPC, and D&D 3.5e sculpting spells). Reserve full Colony/Fortress Management HUD modals (work-priority matrix UI, interactive stockpile filter editor, bill manager panel) for **Phase 48 (M184–M186)**.
   - **Option B:** Also build interactive Preact HUD panels for designations, stockpiles, work priorities, and workshop bills inside Phase 47.
