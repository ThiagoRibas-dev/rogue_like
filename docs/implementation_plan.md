# Implementation Plan: Multi-Tile Creature Footprints, Dynamic Size Rendering, SRD Squeezing & Tactical Movement

## 1. Architectural Overview
This plan wires D&D 3.5e *Movement, Position, and Distance* and *Big and Little Creatures in Combat* end-to-end across Tier 1 (Console), Tier 2 (D&D 3.5e Cartridge), and Tier 3 (System Content JSON):
1. **Default + Declarative Custom Footprints (`FootprintDimensions`) & Orientation Rotation:**
   - Default footprint derived from Stage 1 `effectiveSize` in `SIZE_METRICS` (`Fine`–`Medium`: `1×1`, `Large`: `2×2`, `Huge`: `3×3`, `Gargantuan`: `4×4`, `Colossal`: `6×6`).
   - Declarative `footprint: { width, height }` and `footprintsBySize` on races, templates, entity data, and form overlays.
   - Automatic rotation along movement axis for elongated footprints (`width !== height`, e.g., `1×3` when moving North/South, `3×1` when moving East/West).
2. **Multi-Tile `PositionComponent` & Live `spatialIndex` Synchronization:**
   - `PositionComponent` carries `footprintWidth`, `footprintHeight`, `facing`, and `isSqueezing`.
   - `updateSpatialIndex` indexes all occupied `(x + dx, y + dy)` squares for every entity.
   - Dynamic size shifts (*Enlarge Person*, *Reduce Person*, *Righteous Might*, *Wild Shape*, *Shapeshift*) immediately sync the actor's `PositionComponent` footprint and `spatialIndex`.
3. **SRD Squeezing & Tactical Movement Rules:**
   - **Squeezing:** Large+ creatures (`normalWidth >= 2 || normalHeight >= 2`) moving into a narrow corridor at least half as wide as their normal space (`>= ceil(normalSpan / 2)`) compress their active footprint, set `isSqueezing: true`, pay `2×` movement cost per step, and take `-4` Attack / `-4` AC via the Stat DAG.
   - **Hard-Corner Diagonals:** Block diagonal movement across impassable wall corners (`isDiagonalStepBlockedByHardCorner`), while permitting diagonal steps past creatures or pits.
   - **Moving Through Squares & Size Sharing:**
     - Friendly creature pass-through / swap.
     - Helpless opponent (`unconscious`, `paralyzed`, `asleep`, or `hp < 0` dying/stable) square pass-through.
     - `Tiny`, `Diminutive`, and `Fine` creatures (`canShareTileWithMedium: true`) can enter and share occupied squares, have `0 ft` natural reach, do not threaten adjacent squares, and cannot flank.
     - Any creature can move through a square occupied by a creature $\ge 3$ size categories larger or smaller (`|rankA - rankB| >= 3`).
   - **Armor/Encumbrance Speed, Multi-Tile Terrain Cost, Double Move & Minimum 1-Square Full-Round Move:**
     - Apply SRD armor speed table (`30 ft -> 20 ft`, `20 ft -> 15 ft` unless the actor has `'trait:encumbered_speed_retention'`).
     - Multi-tile footprint uses the highest movement cost among entered squares (ignored if flying or incorporeal); squeezing + difficult terrain multiplies (`2 × 2 = 4×`).
     - Automatic Double Move (`standardRemaining` converted to a second Move action when `moveRemaining === 0 && standardRemaining >= 1`) and Minimum 1-Square (`5 ft`) Full-Round move.
4. **Viewport & Tactical Canvas Multi-Tile Rendering:**
   - Multi-tile creatures (`footprintW > 1 || footprintH > 1`) render a unified `W×H` footprint frame on `#tactical-overlay` (dashed amber when squeezing), a single scaled sprite spanning `W×H` tiles in Sprite Mode, structured footprint glyphs in ASCII Mode, and a single full-width health bar.
   - `Tiny`, `Diminutive`, and `Fine` creatures render with sub-cell scaling (`0.55×`–`0.75×`).

---

## 2. Step-by-Step Implementation Tasks & Code Snippets

### Step 1: Extend `PositionComponent` & Multi-Tile `updateSpatialIndex` (Tier 1 Console)
- **Files:**
  - [`src/types/components/world_components.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/types/components/world_components.types.ts)
  - [`src/core/ecs/ecs_core.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs/ecs_core.ts)
- **Snippet (`world_components.types.ts` & `ecs_core.ts`):**
```ts
export interface PositionComponent {
  readonly type: ComponentType.Position;
  readonly x: number;
  readonly y: number;
  readonly footprintWidth?: number | undefined;
  readonly footprintHeight?: number | undefined;
  readonly facing?: 'north' | 'south' | 'east' | 'west' | undefined;
  readonly isSqueezing?: boolean | undefined;
}
```
```ts
export function updateSpatialIndex(state: GameState): GameState {
  const newIndex = new Map<string, EntityId[]>();
  for (const entityId of state.entities) {
    const pos = getComponent(state, entityId, ComponentType.Position);
    if (pos !== undefined) {
      const w = Math.max(1, pos.footprintWidth ?? 1);
      const h = Math.max(1, pos.footprintHeight ?? 1);
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const key = `${pos.x + dx},${pos.y + dy}`;
          let arr = newIndex.get(key);
          if (!arr) {
            arr = [];
            newIndex.set(key, arr);
          }
          if (!arr.includes(entityId)) {
            arr.push(entityId);
          }
        }
      }
    }
  }
  return { ...state, spatialIndex: newIndex };
}
```

### Step 2: Declarative Footprint Schemas, Orientation Rotation & Squeezing Geometry (Tier 2 & Tier 3)
- **Files:**
  - [`src/rulesets/dnd35e/types/system/base_system.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/types/system/base_system.types.ts)
  - [`src/rulesets/dnd35e/types/system/creature_system.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/types/system/creature_system.types.ts)
  - [`src/rulesets/dnd35e/types/system/effect_system.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/types/system/effect_system.types.ts)
  - [`src/rulesets/dnd35e/types/dnd35e.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/types/dnd35e.types.ts)
  - [`src/rulesets/dnd35e/spatial/grid_geometry.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/spatial/grid_geometry.ts)
- **Snippet (`grid_geometry.ts`):**
```ts
export interface FootprintDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * Resolves an entity's unsqueezed (width, height) footprint in 5-ft grid squares
 * from its effective size category, optional custom footprint overrides, and movement facing.
 */
export function resolveEntityBaseFootprintDimensions(
  effectiveSize: CreatureSizeCategory,
  customFootprint?: FootprintDimensions,
  footprintsBySize?: Partial<Record<CreatureSizeCategory, FootprintDimensions>>,
  facing?: 'north' | 'south' | 'east' | 'west'
): FootprintDimensions {
  const bySize = footprintsBySize?.[effectiveSize];
  const baseSpan = SIZE_METRICS[effectiveSize].footprintTiles;
  const raw = bySize ?? customFootprint ?? { width: baseSpan, height: baseSpan };
  if (raw.width === raw.height || !facing) {
    return raw;
  }
  const shortSpan = Math.min(raw.width, raw.height);
  const longSpan = Math.max(raw.width, raw.height);
  return facing === 'east' || facing === 'west'
    ? { width: longSpan, height: shortSpan }
    : { width: shortSpan, height: longSpan };
}
```

### Step 3: Squeezing Penalties (`-4 Atk / -4 AC`), Armor Tactical Speed, Double Move & Min 1-Sq Move
- **Files:**
  - [`src/rulesets/dnd35e/semantic_tags_context.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/semantic_tags_context.ts)
  - [`src/rulesets/dnd35e/modifiers/dag_resolver.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/modifiers/dag_resolver.ts)
  - [`src/rulesets/dnd35e/action_economy.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/action_economy.ts)
  - [`src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts)
- **Details:**
  - When `pos?.isSqueezing === true`, inject `'condition:squeezing'` and apply `-4` penalty to Attack and `-4` penalty to AC (`SQUEEZING_ATTACK_AND_AC_PENALTY = -4`).
  - In `consumeMovementStepFt`:
    - Support `stepMultiplier` (`1` normal, `2` difficult terrain OR squeezing, `4` difficult terrain + squeezing).
    - If `movementRemainingFt < stepCostFt` and `moveRemaining === 0` and `standardRemaining >= 1`, automatically convert `standardRemaining` into a second Move action (`Double Move`, adding `moveSpeedFt` to `movementRemainingFt`).
    - Enforce the **Minimum 1-Square Full-Round Move** rule: if the actor has not moved yet this round (`distanceMovedThisRoundFt === 0`) and `stepCostFt > moveSpeedFt`, allow the 5-ft step by consuming both Move and Standard actions (`Full-Round Action`).

### Step 4: Multi-Tile Collision, Squeezing Fit, Hard-Corner Diagonals & Size Sharing in `movement.system.ts`
- **Files:**
  - [`src/systems/movement.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/movement.system.ts)
  - [`src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts)
- **Details:**
  - Block diagonal moves across hard wall corners (`isDiagonalStepBlockedByHardCorner`).
  - Resolve target footprint placement:
    1. Try full `W × H` footprint at `(targetX, targetY)` (with rotation applied if `width !== height`).
    2. If blocked by walls and `max(W, H) >= 2`, try SRD Squeezing dimensions (`minWidth = Math.ceil(W / 2)`, `minHeight = Math.ceil(H / 2)`), setting `isSqueezing: true`.
  - Filter `entitiesAtTarget` across all footprint squares with `id !== entityId`:
    - Hostile creature in footprint:
      - If helpless (`unconscious`, `paralyzed`, `asleep`, or `hp < 0`), or `|moverSizeRank - targetSizeRank| >= 3`: allow moving through if not ending movement on a non-shareable blocker; if direct bump, trigger melee attack (or allow Tiny creature to enter opponent's square and attack).
    - Friendly creature: allow pass-through / swap.

### Step 5: Multi-Tile & Sub-Tile Rendering in Viewport & Tactical Overlay
- **Files:**
  - [`src/rendering/viewport_snapshot.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/viewport_snapshot.types.ts)
  - [`src/rendering/viewport_snapshot.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/viewport_snapshot.ts)
  - [`src/rendering/tactical_snapshot.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/tactical_snapshot.ts)
  - [`src/rendering/ui/tactical_overlay.ui.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/tactical_overlay.ui.ts)
- **Snippet (`viewport_snapshot.types.ts` & `tactical_overlay.ui.ts`):**
```ts
export interface TacticalUnitBadgeDTO {
  readonly vx: number;
  readonly vy: number;
  readonly footprintW?: number | undefined;
  readonly footprintH?: number | undefined;
  readonly isSqueezing?: boolean | undefined;
  readonly subTileScale?: number | undefined;
  readonly spriteId?: string | undefined;
  readonly hpRatio: number;
  readonly attitude: TacticalAttitude;
  readonly statusColors: ReadonlyArray<string>;
}
```
- In `renderTacticalOverlay`:
  - When `footprintW > 1 || footprintH > 1`, draw a footprint baseplate rectangle across `(vx * tileWidthPx, vy * tileHeightPx, footprintW * tileWidthPx, footprintH * tileHeightPx)` (dashed amber border when `isSqueezing === true`), draw the scaled sprite from the `ROT.Display` tileSet across the full `footprintW × footprintH` box in Sprite Mode, and span the health bar across `footprintW * tileWidthPx`.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Systems / Tests / Saves) |
| :--- | :--- | :--- | :--- |
| **`PositionComponent` footprint & squeezing state** | `ecs_spawner.ts`, `movement.system.ts`, `spell_cast_effects.ts`, `wild_shape.ts`, `shapeshift.ts` | `updateSpatialIndex` (`ecs_core.ts`), `viewport_snapshot.ts`, `tactical_snapshot.ts`, `tactical_overlay.ui.ts` | `save_roundtrip.test.ts`, `state_immutability.test.ts` |
| **Multi-tile `spatialIndex` & AoE deduplication** | `updateSpatialIndex` (`ecs_core.ts`) | `movement.system.ts`, `target_category_filter.ts` (`enumerateSpellTargets`), `systemic.ts` (`processTraps`) | `mouse_input.ts`, `inspect.system.ts` |
| **SRD Squeezing (`-4 Atk / -4 AC`, `2x move cost`)** | `movement.system.ts` | `semantic_tags_context.ts`, `dag_resolver.ts`, `dnd35e_turn_budget.ts` | `tactical_overlay.ui.ts` |
| **Hard-Corner Diagonals, Size Sharing ($\ge 3$ sizes / Tiny), Double Move & Min 1-Sq Move** | `movement.system.ts`, `action_economy.ts` | `dnd35e_turn_budget.ts`, `flanking_graph.ts` | `dnd35e_combat_traversal_wiring.test.ts`, `companion_ai_commands.test.ts` |

---

## 4. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Custom Non-Square Creature Footprints (e.g., Long Worm `1×3`)** | Hardcoding `if (raceId === 'purple_worm') return { width: 1, height: 3 }` in TypeScript | Declarative `footprint: { width, height }` and `footprintsBySize` fields in `DnD35RaceDefinitionSchema` and `DnD35FormOverlayDescriptorSchema` | **Yes** — any modder can author a new elongated or custom-shaped creature in JSON without touching `.ts` files. |
| **Dwarf / Encumbered Armor Speed Retention** | Hardcoding `if (raceId === 'dwarf')` in speed resolver | Semantic tag `'trait:encumbered_speed_retention'` emitted declaratively by `dwarf.json` racial trait bundle | **Yes** — any new race, class feature, or magic item granting armor/load speed retention simply emits `'trait:encumbered_speed_retention'`. |
| **Tiny/Diminutive/Fine Tile Sharing & `0 ft` Reach** | Hardcoding `if (raceId === 'rat' || raceId === 'toad')` | Derived strictly from `SIZE_METRICS[effectiveSize].canShareTileWithMedium` and `naturalReachTallFt === 0` | **Yes** — any creature or character reduced to Tiny+ automatically inherits tile-sharing and 0-ft reach rules. |
