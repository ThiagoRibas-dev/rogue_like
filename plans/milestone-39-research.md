# Milestone 39 — Research Report: Encounter Director Sandbox & Validation UI

This document grounds every task of [Milestone 39](docs/MILESTONES.md) in concrete code references, existing architectural patterns, relevant coding standards from [`AGENTS.md`](AGENTS.md), and design philosophy from the reference docs.

---

## Milestone Context (from MILESTONES.md)

> **Goal:** Give designers a window into the Director before relying on it in real campaigns.

Seven tasks:

1. Add an Encounter Director preview panel to the editor's Simulation Lab.
2. Let designers select an area, seed, budget, and encounter profile, then reroll deterministic previews.
3. Render the generated map, placed actors, hazards, fields, portals, loot, and objectives.
4. Show the Director Receipt with "why chosen" / "why rejected" explanations.
5. Integrate AI Arena simulations against generated encounters; summarize survival, damage, and turn-count telemetry.
6. Add validator checks for overspent budgets, empty candidate pools, unreachable objectives, unavoidable lethal hazards, and impossible exits.
7. Block export on fatal Director configuration errors.

---

## Task 1 — Encounter Director Preview Panel

### Current State

The Simulation Lab already exists as a top-level editor category. The sidebar navigation at [`editor_ui.ts:124`](src/rendering/editor_ui.ts:124) includes:

```
<li><button class="sidebar-item-btn" data-target="simulation">Simulation Lab</button></li>
```

When `currentCategory === 'simulation'`, the dispatch at [`editor_ui.ts:557-558`](src/rendering/editor_ui.ts:557) routes to:

```typescript
if (currentCategory === 'simulation') {
  renderSimulationLab(controller, formContainer);
}
```

However, `renderSimulationLab()` in [`ai_arena.ui.ts`](src/rendering/ui/ai_arena.ui.ts) currently only renders the **AI Arena** (1v1 combat simulator). There is no tab structure — the function simply builds the full HTML for the arena UI.

### What Needs to Change

The Simulation Lab needs to become a **multi-tab panel** with at minimum two sections:

| Tab | Function | Status |
|-----|----------|--------|
| AI Arena | 1v1 combat simulation (existing) | Already implemented |
| Encounter Director | Budgeted encounter preview (new) | **This milestone** |

**Pattern to follow:** The existing pattern in [`editor_ui.ts`](src/rendering/editor_ui.ts) is that each specialized view (areas → `renderAreaEditor`, dialogues → `renderDialogueTreeEditor`, factions → `renderFactionMatrixEditor`) gets its own render function with a consistent signature: `(controller: EditorController, ...args) => void`. We should follow this pattern with a new `renderDirectorSandbox(controller: EditorController, container: HTMLElement)` function in a new file.

**File structure plan:**
- **New:** `src/rendering/ui/director_sandbox.ui.ts` — the Encounter Director preview panel
- **Modified:** `src/rendering/ui/ai_arena.ui.ts` — refactored to be a sub-section of a tabbed Simulation Lab (if tab unification is desired), OR the `renderSimulationLab` in [`editor_ui.ts:557`](src/rendering/editor_ui.ts:557) becomes a tab router

**Concrete approach (recommended):** Keep `ai_arena.ui.ts` as-is for the AI Arena tab, add a new `director_sandbox.ui.ts` for the Director tab, and modify only the `renderSimulationLab` call site to build a tabbed container that delegates to both sub-renderers.

### Relevant Coding Standards

- **AGENTS.md Rule 1:** One concern per file. Split if exceeding ~250 lines. `ai_arena.ui.ts` is 71 lines — fine. The new sandbox UI will be substantial.
- **AGENTS.md Rule 7:** UI View layer communicates only upward via event dispatching. The sandbox UI will read from `controller.getDocument()` and call `controller.generateSandboxArea()` but will NOT modify state directly.
- **ARCHITECTURE.md §3 (Module Dependency Graph):** The `rendering/ui/` layer imports only downward from `types`, `constants`, `utils`, `editor/simulation/`. The sandbox UI imports `runEncounterDirector` from `src/map/encounter_director.ts` (a `map/` module, which sits below `rendering/` in the graph — allowed).

### EditorController Interface

The [`EditorController`](src/rendering/editor_ui.ts:23) already exposes:

```typescript
generateSandboxArea(areaId: string): GeneratedArea;
```

This delegates to [`CampaignEditor.generateSandboxArea()`](src/editor/campaign_editor.ts:70) which calls `generateArea(this.doc, areaId)`. This is the entry point the preview panel will use.

---

## Task 2 — Deterministic Previews (Area, Seed, Budget, Profile)

### Current State

[`generateArea()`](src/map/generator.ts:34) signature:

```typescript
export function generateArea(
  campaign: CampaignData,
  areaId: string,
  context?: DirectorContext
): GeneratedArea
```

[`DirectorContext`](src/map/encounter_director.ts:47) is:

```typescript
export interface DirectorContext {
  readonly playerLevel: number;
  readonly tokenPool: ReadonlySet<string>;
}
```

The function reads `areaDef.crBudget`, `areaDef.encounterProfileId`, and `areaDef.budgetScaling` from the campaign data. There is **no way to override these for sandbox experimentation**.

### RNG Determinism

The global RNG is exported from [`rng.ts`](src/core/rng.ts):

```typescript
export const rng = ROT.RNG;
export function initRNG(seed?: number): number { ... }
```

ROT.js's `ROT.RNG` provides:
- `getSeed(): number` — returns the current seed
- `setSeed(seed: number): void` — reseeds
- `getState(): number[]` — returns internal state array
- `setState(state: number[]): void` — restores internal state

**Deterministic preview strategy:** Before calling `generateArea()`:
1. Save current RNG state via `ROT.RNG.getState()`
2. Set a new seed from the user's chosen seed input
3. Run generation
4. Capture the result
5. Restore original RNG state via `ROT.RNG.setState()`

This guarantees the editor's global RNG stream is not polluted by sandbox previews, and re-rolling with the same seed produces identical results.

**Note from ARCHITECTURE.md §5 (Decision Log):** The project explicitly forbids `Math.random()` and `Date.now()` for gameplay randomness. All randomness goes through the shared `rng` instance. The same principle applies to sandbox previews — they must use the seeded RNG.

### What Needs to Change

1. **Extend `generateArea()` (or create a wrapper)** to accept overrides:
   - `overrideBudget?: number` — replaces `areaDef.crBudget`
   - `overrideProfileId?: string` — replaces `areaDef.encounterProfileId`
   - `overrideSeed?: number` — saves/restores RNG state

   Alternatively, the sandbox UI can build a **temporary mutated copy** of the `AreaDefinition` with the overrides baked in, then call the existing `generateArea()`. This is cleaner — it doesn't require changing `generateArea()`'s signature.

2. **Expose `runEncounterDirector` directly** (or a headless wrapper) so the sandbox can call it without going through the full `generateArea()` pipeline (useful for re-running Director logic on the same map layout).

   The test script at [`scripts/test_director_uniqueness.ts`](scripts/test_director_uniqueness.ts) already demonstrates headless usage of `runEncounterDirector()` — this is the pattern to replicate.

### Concrete Approach

The sandbox UI will:
1. Let the user pick an `areaId` from a dropdown (populated from `controller.getDocument().areas`)
2. Show the area's current `crBudget`, `encounterProfileId`, `budgetScaling`, `tags`, and `subBiomes`
3. Allow overriding any of these fields
4. Let the user enter a seed (or use a random one, displayed after generation)
5. On "Generate", save RNG state → set seed → call `generateArea()` or `runEncounterDirector()` → restore RNG state → render results

---

## Task 3 — Rendered Map Preview

### Current State

The [`GeneratedArea`](src/map/generator.ts:8) interface provides all data needed for visualization:

```typescript
export interface GeneratedArea {
  readonly map: GameMap;                    // width, height, tiles[]
  readonly startPos: { x, y };
  readonly portals: ReadonlyArray<{ x, y, connection: AreaConnection }>;
  readonly rooms: ReadonlyArray<{ left, right, top, bottom, centerX, centerY }>;
  readonly placedEntities?: ReadonlyArray<{
    readonly templateId: string;
    readonly x: number;
    readonly y: number;
    readonly dynamicTraits?: ReadonlyArray<string>;
  }>;
  readonly directorReceipt?: DirectorReceipt;
}
```

[`Tile`](src/types/game-state.types.ts:577) is:

```typescript
interface Tile {
  readonly tileId: string;
  readonly x: number;
  readonly y: number;
  readonly explored: boolean;
}
```

### What Needs to Change

**New mini-map renderer** inside the sandbox UI. This is distinct from the main game renderer ([`renderer.ts`](src/rendering/renderer.ts)) — the sandbox renderer draws at a tiny scale (e.g., each tile = 4-6px) and overlays entity glyphs, portal markers, and room boundary rectangles.

**Existing patterns to follow:**
- The **Area Grid Painter** in [`area_editor.ts`](src/rendering/ui/area_editor.ts) renders static maps on a canvas for editing — this is the closest precedent
- The **World Graph** in [`world_graph.ts`](src/rendering/ui/world_graph.ts) renders a node-link visualization on a `<canvas>` — shows the pattern of using canvas for custom visualizations

**Approach:** Use an HTML5 `<canvas>` element. For each tile:
- Draw a colored rectangle based on `tileId` (wall = dark gray, floor = light gray, water = blue, empty_space = black)
- Overlay entity glyphs at their (x, y) positions using `ctx.fillText()` with the entity's `fg` color from the template
- Draw room boundaries as semi-transparent colored rectangles
- Draw portals as special markers (e.g., a circle or star)
- Draw the start position as a special marker (e.g., a green "@")

**Tile color mapping:** The [`TileDefinition`](src/types/campaign.types.ts:455) has `fg` and `bg` fields. The sandbox can read `campaign.tiles[tileId]` to get the actual colors.

**Entities rendering:** For each placed entity, look up `campaign.entities[templateId]` to get `glyph`, `fg`, `bg`. Entities with `dynamicTraits` should show a visual indicator (e.g., a colored border or a `+` suffix).

**Scaling:** The map can be 80×50 (default from [`rules.json`](public/data/campaigns/default/rules.json)). At 6px per tile, that's 480×300 — fits comfortably in a panel. Consider a zoom control or auto-fit.

---

## Task 4 — Director Receipt with "Why Chosen / Why Rejected"

### Current State

[`DirectorReceipt`](src/map/encounter_director.ts:8) currently tracks:

```typescript
export interface DirectorReceipt {
  readonly areaId: string;
  readonly effectiveBudget: number;
  readonly preAllocated: number;
  readonly axisResults: Record<BudgetAxis, {
    budget: number;    // allocated budget for this axis
    spent: number;      // actually spent
    spawned: string[];  // template IDs spawned
    rejected: string[]; // template IDs rejected (currently only "no space")
  }>;
  readonly traitUpgrades: string[];   // e.g., ["troll +elite"]
  readonly pathingFailures: number;   // always 0 (AStar skipped per architectural decision)
}
```

The `spawned` and `rejected` arrays only contain **template IDs** — no context about *why* something was chosen or rejected.

### Gap Analysis

The current rejection tracking is minimal. In [`runForEncounterZone()`](src/map/encounter_director.ts:162-186), the only rejection recorded is:

```typescript
axisRejected[axis].push(`${selectedId} (no space)`);
```

But there are **multiple other rejection points** that are not tracked:

| Rejection Point | Location | Currently Tracked? |
|----------------|----------|-------------------|
| Pool filtered out by areaTags | Line 137-138 | No |
| Pool filtered out by biomeTags | Line 139 | No |
| Template not found in campaign | Line 144 | No (silently skipped) |
| Template has no crCost | Line 144 | No (silently skipped) |
| Template excluded by localTokenPool (persistent) | Line 147-149 | No |
| Template too expensive for remaining budget | Line 164 | No (filtered out) |
| No floor tile found in room | Line 181-186 | Yes — "no space" |

### What Needs to Change

**Extend `DirectorReceipt`** to include a `candidatesConsidered` array for each axis:

```typescript
interface CandidateRecord {
  readonly templateId: string;
  readonly cost: number;
  readonly disposition: 'spawned' | 'too_expensive' | 'token_exhausted' | 'no_space' | 'pool_filtered';
  readonly reasonDetail?: string;
}
```

And add to the axis results:

```typescript
axisResults: Record<BudgetAxis, {
  budget: number;
  spent: number;
  spawned: string[];
  rejected: string[];
  candidates: CandidateRecord[];  // NEW — all candidates that passed pool conditions
}>
```

**Architectural note:** Per [AGENTS.md §4](AGENTS.md) — "Components are pure data interfaces with no methods" and the `GameState` must be "fully serializable to JSON." The `DirectorReceipt` is NOT an ECS component (it lives in `GeneratedArea`, which is a transient generation artifact), so it doesn't need to follow ECS purity rules. However, it IS serialized as part of the campaign export metadata, so it must be JSON-compatible.

### UI Rendering

The receipt panel should:
1. Show a **budget bar chart** per axis (protein/appetizer/side/dessert) — allocated vs spent
2. Show each spawned entity with its template ID, cost, position, and any dynamic traits applied
3. Show each rejected candidate with the reason (too expensive, token exhausted, no space, pool filtered)
4. Show the trait upgrade summary
5. Highlight **overspent budgets** (if spent > budget) in red

---

## Task 5 — AI Arena Integration with Generated Encounters

### Current State

[`runAIArena()`](src/editor/simulation/ai_arena.ts:15) creates a headless `GameState`, spawns two combatants at fixed positions (2,5 and 7,5), injects mutual grudges, and simulates turns.

```typescript
export function runAIArena(
  combatantAId: string,
  combatantBId: string,
  campaign: CampaignData,
  maxTurns?: number
): ArenaResult
```

The return type is:

```typescript
export interface ArenaResult {
  logs: string[];
}
```

### Gap Analysis

For Milestone 39, we need to:

1. **Simulate the player + generated encounter**: Run the arena with the player entity vs. ALL entities spawned by the Director
2. **Collect telemetry**: Beyond text logs, we need structured data:
   - Which side won (survival)
   - Damage dealt by each side
   - Damage received by each side
   - Turn count
   - Final HP of survivor
3. **Support multiple simulation runs**: Run the same encounter N times (with different seeds or AI randomness) to get statistical averages

### What Needs to Change

**Extend `ArenaResult`** to include telemetry:

```typescript
export interface ArenaResult {
  readonly logs: string[];
  readonly telemetry: ArenaTelemetry;
}

export interface ArenaTelemetry {
  readonly winner: 'a' | 'b' | 'draw';
  readonly turnsElapsed: number;
  readonly damageDealt: { readonly a: number; readonly b: number };
  readonly damageReceived: { readonly a: number; readonly b: number };
  readonly finalHp: { readonly a: number; readonly b: number };
  readonly deaths: ReadonlyArray<{ readonly entityId: string; readonly turn: number; readonly killerId: string }>;
}
```

**New function:** `runEncounterArena()` that:
1. Takes the `DirectorResult` (list of spawned entities) + the player template ID
2. Creates a headless `GameState` with the generated map tiles
3. Places all entities at their generated positions
4. Runs turns simulating the player acting as an AI (using the existing AI behaviors)
5. Collects telemetry

**Alternative (simpler):** Extend `runAIArena()` to accept an optional map and pre-placed entities. This avoids duplicating the arena loop logic.

**Concrete approach:** Add an overload or new parameters to `runAIArena()` that accept:
- `map?: GameMap` — if provided, use this map instead of the 10×10 arena
- `placementA?: { x: number; y: number }` — custom position for combatant A
- `placementB?: { x: number; y: number }` — custom position for combatant B

Then the sandbox can iterate over all placed entities from the Director result, running `runAIArena(playerTemplateId, enemyTemplateId, campaign, maxTurns, map, playerPos, enemyPos)` for each enemy, and aggregate results.

### EditorController Extension

[`CampaignEditor`](src/editor/campaign_editor.ts) currently has `generateSandboxArea()` but no method to run arena simulations. The sandbox UI can directly import and call `runAIArena` from `src/editor/simulation/ai_arena.ts`, which is allowed per the dependency graph (rendering → editor/simulation is downward).

---

## Task 6 — Validator Checks

### Current State

[`validateEncounters()`](src/editor/validator/encounter.validator.ts) validates:
1. SpawnPools contain valid entities with crCosts
2. EncounterProfile budgets sum exactly to 1.0
3. Area encounterProfileId references valid profiles
4. Sub-biome tags reference valid tag_registry entries
5. Trait references in entity templates are valid

It is called from [`validateCampaign()`](src/editor/campaign_validator.ts:51) as part of the full validation pipeline.

### New Checks Required

| Check | Description | Severity |
|-------|-------------|----------|
| **Overspent budgets** | Area has `crBudget` set but every spawn pool candidate costs more than the budget → the area will generate empty encounters | `error` |
| **Empty candidate pools** | A spawn pool's conditions (areaTags, biomeTags) match zero areas in the campaign → pool is dead code | `warning` |
| **Empty candidate pools (fatal)** | An area has `encounterProfileId` set but no spawn pool matches its tags → area will have zero enemies | `error` |
| **Unreachable objectives** | A room's only exit is blocked by a placed entity (static maps only; procedural maps skip AStar per architectural decision) | `warning` (static areas only) |
| **Impossible exits** | An area has `connections` but `generatorType` is `'static'` and the connection's `placementX`/`placementY` falls on a wall tile | `error` |
| **Budget scaling sanity** | `budgetScaling.scalingFactor` is negative or zero | `warning` |
| **Profile-less areas with budget** | Area has `crBudget > 0` but no `encounterProfileId` → budget is wasted | `warning` |

### Implementation Notes

**Architectural decision to respect:** [ARCHITECTURE.md §5](docs/ARCHITECTURE.md:288-290) explicitly states:

> During procedural generation, the Encounter Director deliberately skips running `ROT.Path.AStar` to verify if randomly placed entities (like hazards) block paths or doors. We rely on the statistical improbability of random placement creating perfect soft-locks, rather than enforcing strict graph connectivity per-entity.

This means the validator should **NOT** run AStar for procedural areas. For static areas, it's reasonable to validate that doors/portals aren't placed on walls.

**How to check "empty candidate pools":** Iterate over all areas with `encounterProfileId`, compute the effective budget, then iterate over all spawn pools to see if any pool's conditions match the area's tags AND has at least one affordable entity. This is a **simulation-light check** — no actual generation needed, just condition matching.

```typescript
// Pseudocode for "area has no matching candidates" check
for (const [areaId, area] of Object.entries(data.areas)) {
  if (!area.encounterProfileId) continue;
  const budget = area.crBudget ?? 0;
  if (budget <= 0) continue;
  
  let hasAnyCandidate = false;
  for (const pool of Object.values(data.spawnPools)) {
    if (pool.conditions?.areaTags && !pool.conditions.areaTags.every(t => (area.tags ?? []).includes(t)))
      continue;
    for (const [templateId] of Object.entries(pool.entities)) {
      const template = data.entities[templateId];
      if (template?.crCost !== undefined && template.crCost <= budget) {
        hasAnyCandidate = true;
        break;
      }
    }
    if (hasAnyCandidate) break;
  }
  
  if (!hasAnyCandidate) {
    errors.push({
      path: `areas.${areaId}`,
      message: `Area '${area.name}' has crBudget=${budget} but no spawn pool candidates are affordable or match its tags.`,
      severity: 'error'
    });
  }
}
```

---

## Task 7 — Block Export on Fatal Director Errors

### Current State

The export flow at [`editor_ui.ts:267-298`](src/rendering/editor_ui.ts:267) already:

1. Runs shallow validation (`controller.validate()`)
2. Runs deep validation (`validateCampaign(doc)`)
3. Blocks export if `deepReport.errors.length > 0`

[`validateEncounters()`](src/editor/validator/encounter.validator.ts) is called inside `validateCampaign()` at [`campaign_validator.ts:51`](src/editor/campaign_validator.ts:51). Any errors with `severity: 'error'` from the encounter validator already block export.

### What Needs to Change

**Minimal changes needed.** The new validator checks added in Task 6 just need to be assigned the correct severity:

- `'error'` for: overspent budgets, empty candidate pools (fatal), impossible exits in static maps
- `'warning'` for: dead spawn pools (no area matches), budget scaling sanity, profile-less budget

Once these are in `validateEncounters()`, the existing export-blocking logic handles the rest automatically.

**One additional check for the export path:** [`CampaignEditor.exportZipWorkspace()`](src/editor/campaign_editor.ts:135-160) stamps `CURRENT_SCHEMA_VERSION` and then calls `this.validate()`. If we want to ensure Director-specific validation is run at export time, we should call the deep `validateCampaign()` in this method too. Currently, `exportZipWorkspace()` only calls `this.validate()` (shallow), while the UI button handler does the deep validation separately. For consistency, `exportZipWorkspace()` should also run deep validation.

---

## Cross-Cutting Patterns & Rules

### Observability Principle

From [ARCHITECTURE.md §2](docs/ARCHITECTURE.md:14-16):

> Never build an invisible system without a window into it. Complex simulation logic (like scheme advancement) must always be paired with explicit UI surfaces (investigation boards, dialogue logs) or dedicated `/debug` cheat commands so its state can be verified.

The Encounter Director Sandbox is **the observability window** for the Director. Every decision the Director makes (why this enemy? why not that one? why was budget left over?) must be visible in the sandbox. This aligns with the Reaction Trace pattern already established in [debug.ui.ts](src/rendering/ui/debug.ui.ts) (lines 60-82).

### Defensive Simulation (Fail Gracefully)

From [ARCHITECTURE.md §2](docs/ARCHITECTURE.md:15-16):

> If an intermediary NPC vital to a quest dies or is trapped, the simulation must not crash or soft-lock the campaign.

The Director should never crash the editor or generator. If a spawn pool is empty, the Director should return an empty result (which it already does — see the early returns in [`encounter_director.ts:276-279`](src/map/encounter_director.ts:276)). The sandbox UI must handle `DirectorResult` with zero entities gracefully, showing a clear message rather than a blank panel.

### Data-Driven / No Magic Values

Per [AGENTS.md §5](AGENTS.md): "Every literal value affecting gameplay must be in a JSON registry."

The sandbox UI will need default values for:
- Default max simulation turns
- Default seed display format
- Tile pixel size for the mini-map
- Budget axis colors

These should be constants in the sandbox module or derived from campaign data, not inline magic numbers.

### Derive Dropdowns from Canonical Sources

Per [AGENTS.md §5](AGENTS.md): "Never hardcode dropdown options. Derive them from Enums, Zod, or CampaignData keys programmatically."

The area selector dropdown must be populated from `controller.getDocument().areas`. The profile selector from `controller.getDocument().encounterProfiles`. The entity list for spawn pool display from `controller.getDocument().entities`.

### Seed Determinism

Per [ARCHITECTURE.md §5](docs/ARCHITECTURE.md:204-206):

> The game relies entirely on a shared `ROT.RNG` instance and strict global counters. No system is permitted to use `Math.random()` or `Date.now()`.

The sandbox preview MUST use the seeded RNG and save/restore its state. This means:
- Save state before generation
- Set seed from user input
- Run generation
- Restore state after generation
- Display the seed used so the user can reproduce results

### ECS & Serialization Rules

From [AGENTS.md §4](AGENTS.md):

> No Maps/Sets in ECS Components: We must avoid using `Map` or `Set` objects inside ECS Components because the `GameState` must be fully serializable to JSON.

The `DirectorReceipt` and `GeneratedArea` are NOT ECS components — they're transient generation artifacts. However, they are serialized as part of campaign export metadata, so they must remain JSON-compatible. `ReadonlyArray<string>` is fine; `Set<string>` is not.

---

## Files to Create / Modify Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/rendering/ui/director_sandbox.ui.ts` | **CREATE** | New Encounter Director sandbox panel UI |
| `src/rendering/ui/ai_arena.ui.ts` | MODIFY | Extend `ArenaResult` with telemetry; add optional map/placement params to `runAIArena()` |
| `src/editor/simulation/ai_arena.ts` | MODIFY | Extend `runAIArena()` signature for map/placement overrides; add telemetry collection |
| `src/map/encounter_director.ts` | MODIFY | Extend `DirectorReceipt` with `candidates` tracking per axis; add `disposition` and `reasonDetail` to rejected entries |
| `src/editor/validator/encounter.validator.ts` | MODIFY | Add Task 6 validator checks |
| `src/rendering/editor_ui.ts` | MODIFY | Refactor Simulation Lab dispatch to support tabbed layout; import `renderDirectorSandbox` |
| `src/editor/campaign_editor.ts` | MODIFY | Optionally: add `runDeepValidation()` to `exportZipWorkspace()` for consistency |

---

## Resolved Design Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Tab layout vs. separate sidebar entry | **Tabbed panel** — both AI Arena and Encounter Director live under a single "Simulation Lab" sidebar entry with tabs |
| 2 | RNG checkpointing depth | **Full state save/restore** — use `ROT.RNG.getState()`/`setState()` before/after generation to avoid polluting the global RNG stream |
| 3 | Mini-map rendering approach | **DOM-based grid** — use a CSS grid of small `<div>` elements for inspectability, with entity glyphs rendered via `textContent` |
| 4 | AI Arena integration depth | **Both modes** — provide an "Auto-Simulate" button (fully automated) AND a "Play Encounter" button that launches the encounter in a mini-game sandbox |
| 5 | Token pool in sandbox | **Respect token pools** — the sandbox shows real behavior including unique/exhausted tokens |
