# Research Notes: Multi-Tile Creature Footprints, Dynamic Size Rendering, Squeezing & SRD Tactical Movement

## 1. Objective & Scope
Implement full D&D 3.5e SRD *Movement, Position, and Distance* and *Big and Little Creatures in Combat* rules across the Console Engine (Tier 1), D&D 3.5e Ruleset Cartridge (Tier 2), and System Content (Tier 3):
1. **Default Size-Based Square Footprints & Declarative Custom Footprints:**
   - Default footprint derived from DAG-resolved `effectiveSize` (`Fine`–`Medium`: `1×1`, `Large`: `2×2`, `Huge`: `3×3`, `Gargantuan`: `4×4`, `Colossal`: `6×6`).
   - Support declarative custom footprints (`footprint: { width, height }` and `footprintsBySize`) on races, templates, and form overlays (e.g., long worm `1×3`).
   - Automatic footprint rotation along the axis of movement (`1×3` vertical when moving N/S, `3×1` horizontal when moving E/W).
   - Dynamic recomputation when an entity's size changes at runtime (e.g., *Enlarge Person*, *Reduce Person*, *Righteous Might*, *Wild Shape*, *Shapeshift*).
2. **Multi-Tile & Sub-Tile Viewport Rendering (`viewport_snapshot.ts`, `tactical_snapshot.ts`, `tactical_overlay.ui.ts`):**
   - Multi-tile creatures (`W×H > 1`) render as a unified multi-tile entity: a single scaled sprite spanning `W×H` tiles in Sprite Mode, structured footprint glyphs in ASCII Mode, a tactical baseplate frame (solid normally, dashed amber when squeezing), and a single health bar spanning the width of the footprint.
   - Very small creatures (`Tiny`, `Diminutive`, `Fine`) render with sub-cell scaling and support co-occupying squares.
3. **Live Multi-Tile `spatialIndex` & AoE Deduplication (`ecs_core.ts`, `target_category_filter.ts`):**
   - Register every occupied `(x + dx, y + dy)` square of an entity's footprint in `state.spatialIndex` so clicking, inspecting, bump-attacking, and AoE templates interact with any square of the creature while deduplicating AoE hits per entity.
4. **SRD Squeezing & Tactical Movement Rules (`movement.system.ts`, `grid_geometry.ts`, `action_economy.ts`, `dag_resolver.ts`):**
   - **Squeezing:** Large+ creatures can squeeze into spaces at least half as wide as their normal space (e.g., `2×2` Large squeezing into `1×2` or `1×1`), paying `2×` movement cost per step and taking `-4` penalty on attack rolls and `-4` penalty to AC.
   - **Hard-Corner Diagonals:** Diagonal steps blocked if either orthogonal neighbor is an impassable wall (`isDiagonalStepBlockedByHardCorner`), while allowing diagonal steps past creatures or pits.
   - **Moving Through Squares & Size Sharing:**
     - Move through friendly squares (or swap/pass through allies).
     - Move through or into squares of helpless (`unconscious`, `paralyzed`, `asleep`, or dying `hp < 0`) opponents.
     - `Tiny`, `Diminutive`, and `Fine` creatures can enter and share occupied squares (`0 ft` natural reach, no flanking, no adjacent threatened squares).
     - Any creature can move through a square occupied by a creature $\ge 3$ size categories larger or smaller (`|rankA - rankB| >= 3`).
   - **Terrain, Armor Speed, Double Move & Minimum 1-Square Full-Round Move:**
     - Multi-tile creatures use the most difficult terrain among occupied squares; flying and incorporeal creatures ignore difficult terrain.
     - Double movement cost multiplier stacking ($2 \times 2 = 4\times$ when squeezing through difficult terrain).
     - Automatic Double Move conversion (spending Standard action for a second Move action when `moveRemaining === 0 && standardRemaining >= 1`).
     - Minimum 1-square (`5 ft`) full-round movement even when hampered movement cost exceeds single-move speed.

---

## 2. Existing Codebase Analysis & Architectural Mapping

### Tier 1 — Core Console Engine
- **[`src/types/components/world_components.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/types/components/world_components.types.ts):**
  - `PositionComponent` currently has `{ type: ComponentType.Position, x: number, y: number }`.
  - Adding optional `footprintWidth?: number`, `footprintHeight?: number`, `footprintOffsets?: ReadonlyArray<{ readonly dx: number; readonly dy: number }>`, `facing?: 'north' | 'south' | 'east' | 'west'`, and `isSqueezing?: boolean` keeps `PositionComponent` 100% pure JSON-serializable data (Rule 4).
- **[`src/core/ecs/ecs_core.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs/ecs_core.ts):**
  - `updateSpatialIndex(state)` currently indexes only `${pos.x},${pos.y}`.
  - Updating `updateSpatialIndex` to iterate over `getPositionFootprintSquares(pos)` registers `entityId` in every square of its footprint automatically whenever `PositionComponent` is added or updated.
- **[`src/systems/movement.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/movement.system.ts):**
  - `processMoveIntent` handles tile traversal and entity collision.
  - Needs multi-square footprint fit & squeezing resolution, hard-corner wall check for diagonal moves, size-difference ($\ge 3$ categories) & Tiny/helpless pass-through, and multi-tile self-exclusion (`id !== entityId` when checking `spatialIndex` since the moving entity already occupies some of the destination squares!).
- **[`src/rendering/viewport_snapshot.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/viewport_snapshot.ts), [`src/rendering/tactical_snapshot.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/tactical_snapshot.ts), & [`src/rendering/ui/tactical_overlay.ui.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/tactical_overlay.ui.ts):**
  - `TacticalUnitBadgeDTO` can carry `footprintW`, `footprintH`, `isSqueezing`, `subTileScale`, and `spriteId` so `renderTacticalOverlay` draws multi-tile sprites across the full `W×H` bounding box, draws the footprint frame, and spans the health bar across the creature's width.

### Tier 2 — D&D 3.5e Ruleset Cartridge
- **[`src/rulesets/dnd35e/spatial/grid_geometry.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/spatial/grid_geometry.ts):**
  - Already defines `SIZE_METRICS`, `measureDnD35DistanceFt`, `isDiagonalStepBlockedByHardCorner`, `computeFootprintSquares`, `measureDistanceFromFootprintFt`, and `computeThreatenedSquares`.
  - Can be extended to support rectangular (`width × height`) and offset-list footprints, rotation by `facing`, squeezing footprint fitting, and footprint-to-footprint distance measurement (`measureFootprintToFootprintDistanceFt`).
- **[`src/rulesets/dnd35e/modifiers/dag_resolver.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/modifiers/dag_resolver.ts) & [`src/rulesets/dnd35e/semantic_tags_context.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/semantic_tags_context.ts):**
  - When `pos.isSqueezing === true`, `resolveEntitySituationalTagContext` projects `'condition:squeezing'` / `'squeezing'`, and the Stat DAG / condition modifiers apply `-4` to Attack and `-4` to AC.
  - Armor tactical speed adjustment (`30 ft -> 20 ft`, `20 ft -> 15 ft` unless the actor has `'trait:encumbered_speed_retention'` like Dwarves) is computed cleanly in the DAG.
- **[`src/rulesets/dnd35e/action_economy.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/action_economy.ts) & [`src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts):**
  - `consumeMovementStepFt` already supports converting a `Move` action into `movementRemainingFt`, and can automatically convert `standardRemaining >= 1` into a second Move action (Double Move) when `moveRemaining === 0`, plus allow the SRD Minimum 1-Square Full-Round Move when hampered movement cost (`10 ft` or `20 ft`) exceeds a single move action's speed.

### Tier 3 — System Content (`public/data/rulesets/dnd35e/`)
- **[`src/rulesets/dnd35e/types/system/base_system.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/types/system/base_system.types.ts) & [`creature_system.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/types/system/creature_system.types.ts):**
  - Add `DnD35FootprintShapeSchema` (`{ width: z.number().int().positive(), height: z.number().int().positive() }`) and optional `footprint` and `footprintsBySize` to `DnD35RaceDefinitionSchema` and `DnD35FormOverlayDescriptorSchema`.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Systems / Tests / Saves) |
| :--- | :--- | :--- | :--- |
| **`PositionComponent` footprint fields (`footprintWidth`, `footprintHeight`, `isSqueezing`, `facing`)** | `ecs_spawner.ts`, `movement.system.ts`, `spell_cast_effects.ts` (Enlarge/Reduce), `wild_shape.ts`, `shapeshift.ts` | `updateSpatialIndex` (`ecs_core.ts`), `viewport_snapshot.ts`, `tactical_snapshot.ts`, `tactical_overlay.ui.ts` | `save_roundtrip.test.ts` (JSON serializable plain primitives), `state_immutability.test.ts` |
| **Multi-tile `spatialIndex` registration** | `updateSpatialIndex` in `src/core/ecs/ecs_core.ts` | `movement.system.ts` (must ignore self `id !== entityId` when checking destination tiles), `target_category_filter.ts` (deduplicate AoE targets), `systemic.ts` (trap triggers) | `hunt.behavior.ts`, `mouse_input.ts` (clicking any square of a Large creature targets/attacks it) |
| **SRD Squeezing (`isSqueezing`, `-4 Atk / -4 AC`, `2x move cost`)** | `processMoveIntent` (`movement.system.ts`), `onDnD35eActorMovementStep` | `semantic_tags_context.ts`, `dag_resolver.ts`, `dnd35e_turn_budget.ts` | `tactical_overlay.ui.ts` (dashed amber squeezing border) |
| **Hard-Corner Diagonals, Size-Sharing ($\ge 3$ sizes / Tiny), Double Move & Min 1-Sq Move** | `processMoveIntent`, `consumeMovementStepFt` (`action_economy.ts`) | `dnd35e_turn_budget.ts`, `flanking_graph.ts` (0-reach Tiny creatures cannot flank or threaten) | `companion_ai_commands.test.ts`, `dnd35e_combat_traversal_wiring.test.ts` |
