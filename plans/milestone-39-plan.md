# Milestone 39 — Implementation Plan

Based on the research in [`milestone-39-research.md`](plans/milestone-39-research.md).

---

## Step 1: Extend `DirectorReceipt` with Candidate Tracking

**File:** [`src/map/encounter_director.ts`](src/map/encounter_director.ts)

**Rationale:** Tasks 4 and 6 depend on the Director reporting WHY candidates were chosen or rejected. Currently, only "no space" rejections are tracked. This step adds comprehensive candidate disposition tracking.

**Changes:**

1.1 Add a `CandidateDisposition` type and `CandidateRecord` interface:

```typescript
export type CandidateDisposition = 'spawned' | 'too_expensive' | 'token_exhausted' | 'no_space' | 'pool_filtered';

export interface CandidateRecord {
  readonly templateId: string;
  readonly cost: number;
  readonly disposition: CandidateDisposition;
  readonly reasonDetail?: string;
}
```

1.2 Extend the axis results in `DirectorReceipt` to include `candidates`:

```typescript
export interface DirectorReceipt {
  // ...existing fields remain...
  readonly axisResults: Record<
    BudgetAxis,
    {
      readonly budget: number;
      readonly spent: number;
      readonly spawned: string[];
      readonly rejected: string[];
      readonly candidates: ReadonlyArray<CandidateRecord>;  // NEW
    }
  >;
  // ...existing fields remain...
}
```

1.3 In `runForEncounterZone()`, populate `candidates` arrays:
- When building `candidatesByAxis` (lines 127-153), record all candidates that pass pool conditions as `CandidateRecord` with `disposition: 'pool_filtered'` for those that fail pool conditions (unused — we only track candidates that pass conditions in the candidates array)
- When a candidate is **too expensive** for remaining budget (filtered at line 164), record it with `disposition: 'too_expensive'`
- When a candidate is **token exhausted** (line 147-149), record it with `disposition: 'token_exhausted'`
- When a candidate is **spawned** (line 197-199), record it with `disposition: 'spawned'`
- When a candidate fails **no space** (line 184-186), record it with `disposition: 'no_space'`

1.4 Update `buildEmptyReceipt()` to include empty `candidates` arrays.

1.5 Update the caller in `runEncounterDirector()` to merge `candidates` arrays (similar to how `spawned`/`rejected` are merged at lines 346-351).

**AGENTS.md compliance:**
- No `any` types — use `CandidateDisposition` union
- No magic values — candidate disposition strings are typed
- Immutable data — `ReadonlyArray<CandidateRecord>`

---

## Step 2: Extend AI Arena with Telemetry & Map/Placement Support

**Files:** [`src/editor/simulation/ai_arena.ts`](src/editor/simulation/ai_arena.ts) (primary), [`src/rendering/ui/ai_arena.ui.ts`](src/rendering/ui/ai_arena.ui.ts) (secondary)

**Rationale:** Task 5 requires running arena simulations against Director-generated encounters with telemetry collection. The existing `runAIArena()` needs map/placement overrides and structured telemetry output.

**Changes:**

2.1 Add `ArenaTelemetry` interface and extend `ArenaResult`:

```typescript
export interface ArenaTelemetry {
  readonly winner: 'a' | 'b' | 'draw';
  readonly turnsElapsed: number;
  readonly damageDealtA: number;
  readonly damageDealtB: number;
  readonly finalHpA: number;
  readonly finalHpB: number;
}

export interface ArenaResult {
  readonly logs: string[];
  readonly telemetry: ArenaTelemetry;
}
```

2.2 Extend `runAIArena()` signature with optional parameters:

```typescript
export function runAIArena(
  combatantAId: string,
  combatantBId: string,
  campaign: CampaignData,
  maxTurns?: number,
  options?: {
    readonly mapWidth?: number;
    readonly mapHeight?: number;
    readonly mapTiles?: ReadonlyArray<{ readonly tileId: string; readonly x: number; readonly y: number }>;
    readonly placementA?: { readonly x: number; readonly y: number };
    readonly placementB?: { readonly x: number; readonly y: number };
    readonly spawnExtraEntities?: ReadonlyArray<{
      readonly templateId: string;
      readonly x: number;
      readonly y: number;
    }>;
  }
): ArenaResult
```

2.3 Inside `runAIArena()`, use provided map/placement if given, otherwise fall back to the existing 10×10 arena defaults. Track `damageDealt` and `damageReceived` by hooking into damage events in the simulation loop.

2.4 Add a new function `runEncounterArena()` for batch simulation:

```typescript
export function runEncounterArena(
  playerTemplateId: string,
  directorEntities: ReadonlyArray<{ readonly templateId: string; readonly x: number; readonly y: number }>,
  campaign: CampaignData,
  map: { readonly width: number; readonly height: number; readonly tiles: ReadonlyArray<{ readonly tileId: string; readonly x: number; readonly y: number }> },
  maxTurns?: number
): { readonly results: ReadonlyArray<ArenaResult>; readonly aggregate: { readonly playerWins: number; readonly enemyWins: number; readonly avgTurns: number; readonly avgPlayerHpRemaining: number } }
```

This places the player at a safe tile and runs 1v1 against each Director-spawned entity, collecting aggregate telemetry.

2.5 Update `ai_arena.ui.ts` to display telemetry in the existing Arena UI (add a summary line below the combat log showing winner, turns, damage).

**AGENTS.md compliance:**
- Explicit return types on all functions
- `ReadonlyArray` for all array parameters
- No `Map`/`Set` in interface types (JSON-compatible)

---

## Step 3: Create Encounter Director Sandbox UI

**File:** [`src/rendering/ui/director_sandbox.ui.ts`](src/rendering/ui/director_sandbox.ui.ts) (NEW)

**Rationale:** Tasks 1-4 require a dedicated UI panel. This is the primary new file. It follows the same `(controller: EditorController, container: HTMLElement) => void` signature pattern as [`area_editor.ts`](src/rendering/ui/area_editor.ts), [`dialogue_editor.ts`](src/rendering/ui/dialogue_editor.ts), etc.

**Sections:**

### 3.1 Configuration Bar (Top)
- **Area selector:** `<select>` dropdown populated from `Object.keys(controller.getDocument().areas)`, filtered to areas with `encounterProfileId` set
- **Seed input:** `<input type="number">` with a "Randomize" button that generates a seed via `Date.now()` (UI-only, not gameplay — allowed for editor tooling)
- **Budget override:** `<input type="number">` pre-filled with the area's `crBudget`, editable
- **Profile override:** `<select>` pre-selected to the area's `encounterProfileId`, with options from `Object.keys(controller.getDocument().encounterProfiles)`
- **[Generate] button**

### 3.2 Map Preview (Left/Center)
- **DOM grid** of small `<div>` elements (e.g., 6px × 6px each)
- Background color derived from `campaign.tiles[tile.tileId]?.bg` for each tile
- Entity glyphs overlaid using `textContent` and `campaign.entities[templateId]?.fg` for color
- Room boundaries shown as subtle borders or background tint
- Portal markers (e.g., `🌀`) at portal positions
- Start position marker (e.g., green `@`)
- Click on an entity tile → selects it in the Receipt panel below

**DOM grid implementation detail:** Use CSS Grid with `grid-template-columns: repeat(${width}, 6px)`. Each cell is a `<div>` with `width: 6px; height: 6px; font-size: 5px; line-height: 6px; text-align: center;`. For maps up to 80×50, this produces a 480×300 grid — well within browser rendering limits.

### 3.3 Director Receipt Panel (Right/Below)
- **Budget bar chart:** Four horizontal bars (protein/appetizer/side/dessert) showing allocated (gray background) vs spent (colored fill). Colors: protein=#e74c3c, appetizer=#2ecc71, side=#f39c12, dessert=#9b59b6.
- **Spawned entities list:** Each entity shows template name, glyph preview, cost, position (x,y), dynamic traits (if any). Click to highlight on map.
- **Rejected candidates list:** Grouped by reason (too expensive, token exhausted, no space, pool filtered). Each shows template name and cost.
- **Trait upgrades summary:** Shows which entity got which dynamic trait.
- **Budget summary line:** Total budget | Total spent | Remaining

### 3.4 Simulation Controls (Bottom)
- **[Auto-Simulate Encounter] button:** Calls `runEncounterArena()` with the generated entities. Shows a progress bar / spinner during simulation. Displays aggregate telemetry: player wins X/Y, avg turns, avg HP remaining.
- **[▶ Play Encounter] button:** Launches a mini-game mode where the designer controls the player entity in the generated map (see Step 4).

**RNG State Management:**
```typescript
function generateWithSeed(seed: number, ...): GeneratedArea {
  const savedState = ROT.RNG.getState();
  try {
    ROT.RNG.setSeed(seed);
    return generateArea(campaign, areaId, context);
  } finally {
    ROT.RNG.setState(savedState);
  }
}
```

---

## Step 4: Implement "Play Encounter" Mini-Game Mode

**Files:** [`src/main.ts`](src/main.ts) (MODIFY), [`src/rendering/editor_ui.ts`](src/rendering/editor_ui.ts) (MODIFY)

**Rationale:** The user chose "both" for AI Arena integration depth. The mini-game mode lets designers play-test encounters interactively.

**Approach:**
- When the designer clicks "Play Encounter" in the sandbox:
  1. The sandbox serializes the generated `GeneratedArea` + current campaign data into `sessionStorage`
  2. Sets a flag `sessionStorage.setItem('sandbox_playtest', 'true')`
  3. Reloads the page (same pattern as the existing Play Test flow at [`editor_ui.ts:304-343`](src/rendering/editor_ui.ts:304))
  4. On next bootstrap, [`main.ts`](src/main.ts) detects the flag, loads the sandbox area instead of a normal game, and enters a "sandbox play" mode
  5. The designer controls the player, fights the generated encounter, and can press Escape to return to the editor
  6. On return, the editor restores state from `sessionStorage` (same pattern as playtest re-entry)

**New types:**
```typescript
// In game-state.types.ts or a dedicated sandbox.types.ts
export interface SandboxPlaytestState {
  readonly campaignJson: string;       // serialized CampaignData
  readonly generatedAreaJson: string;  // serialized GeneratedArea
  readonly playerTemplateId: string;   // which entity template is the player
}
```

---

## Step 5: Add Encounter Director Validator Checks

**File:** [`src/editor/validator/encounter.validator.ts`](src/editor/validator/encounter.validator.ts)

**Rationale:** Task 6. Extend the existing validator with Director-specific sanity checks.

**New checks:**

### 5.1 Overspent Budget Check
For each area with `encounterProfileId` and `crBudget > 0`:
- Iterate spawn pools matching the area's tags
- Check if ANY entity in ANY matching pool has `crCost <= budget`
- If no affordable candidate exists → `error`

```typescript
if (!hasAnyCandidate) {
  errors.push({
    path: `areas.${areaId}`,
    message: `Area '${area.name}' has crBudget=${budget} but no spawn pool candidate is affordable. Minimum entity cost in matching pools is ${minCost}.`,
    severity: 'error'
  });
}
```

### 5.2 Dead Spawn Pool Check
For each spawn pool:
- Check if at least one area's tags satisfy the pool's `areaTags` condition
- If no area matches → `warning` (dead code)

### 5.3 Profile-less Area with Budget Check
For each area:
- If `crBudget > 0` but no `encounterProfileId` → `warning` (budget wasted)

### 5.4 Static Map Exit Validity Check
For each area with `generatorType === 'static'` and `staticMap`:
- For each connection with explicit `placementX`/`placementY`, verify the tile at that position is walkable (not a wall)
- If placement falls on a wall → `error`

### 5.5 Budget Scaling Sanity Check
For each area with `budgetScaling`:
- If `scalingFactor <= 0` → `warning` (scaling goes the wrong direction)
- If `baseBudget < 0` → `error`

**AGENTS.md compliance:**
- All checks return explicit `ReadonlyArray<ValidationError>`
- Severity correctly distinguishes `error` (blocks export) from `warning` (advisory)
- No magic values — error messages reference actual data values

---

## Step 6: Tab-ify the Simulation Lab

**Files:** [`src/rendering/editor_ui.ts`](src/rendering/editor_ui.ts), [`src/rendering/ui/ai_arena.ui.ts`](src/rendering/ui/ai_arena.ui.ts)

**Rationale:** Decision #1 — the Simulation Lab becomes a tabbed panel.

**Changes:**

6.1 Create a new `renderSimulationLabTabs()` function (in `editor_ui.ts` or a small helper) that renders:

```html
<div class="sim-tabs">
  <button class="sim-tab active" data-tab="arena">AI Arena</button>
  <button class="sim-tab" data-tab="director">Encounter Director</button>
</div>
<div class="sim-content" id="sim-tab-content"></div>
```

6.2 Tab switching: clicking a tab hides the other content, shows the selected one. Both `renderSimulationLab()` and `renderDirectorSandbox()` render into `#sim-tab-content`.

6.3 Update the dispatch in `refreshActiveViews()` (line 557-558) to call the tabbed renderer.

6.4 Update `ai_arena.ui.ts` to accept a `container` parameter rather than hardcoding the full layout (so it can render into the tab content area).

**No new file needed** — the tab wrapper is small enough to live in `editor_ui.ts` or as a helper in `ai_arena.ui.ts`.

---

## Step 7: Wire Sandbox into EditorController

**Files:** [`src/editor/campaign_editor.ts`](src/editor/campaign_editor.ts), [`src/rendering/editor_ui.ts`](src/rendering/editor_ui.ts)

**Rationale:** The sandbox needs to call `generateArea()` with RNG state management. This is better centralized in the controller.

**Changes:**

7.1 Add method to `CampaignEditor`:

```typescript
public generateSandboxAreaWithSeed(
  areaId: string,
  seed: number,
  overrides?: { crBudget?: number; encounterProfileId?: string }
): GeneratedArea {
  const savedState = ROT.RNG.getState();
  try {
    ROT.RNG.setSeed(seed);
    // Build a temporary mutated area def if overrides provided
    if (overrides) {
      const originalArea = this.doc.areas[areaId];
      // ...temporarily mutate a copy...
    }
    return generateArea(this.doc, areaId);
  } finally {
    ROT.RNG.setState(savedState);
  }
}
```

7.2 Add `generateSandboxAreaWithSeed` to the `EditorController` interface in [`editor_ui.ts`](src/rendering/editor_ui.ts:23-39).

7.3 In `exportZipWorkspace()`, add a call to `validateCampaign()` for deep validation before allowing export (currently only shallow validation is done in the method itself; deep validation is done in the UI button handler).

---

## Step 8: Block Export on Director Errors (Verification)

**File:** [`src/editor/campaign_editor.ts`](src/editor/campaign_editor.ts) (verify only)

**Rationale:** Task 7. Confirm the export pipeline correctly blocks on new Director errors.

The export flow is:
1. UI button handler ([`editor_ui.ts:267-298`](src/rendering/editor_ui.ts:267)) calls `validateCampaign(doc)` which calls `validateEncounters(campaign)`
2. `exportZipWorkspace()` ([`campaign_editor.ts:135-160`](src/editor/campaign_editor.ts:135)) calls `this.validate()` (shallow Zod check) and shows a confirm dialog if errors exist

**Action:** After Step 7.3, the deep validation in `exportZipWorkspace()` ensures Director errors block export. No additional changes needed for this task beyond what's already in Step 7.

---

## Step 9: Test & Manual Verification

**Files:** None (manual testing)

**Scenarios to verify:**

1. **Empty preview:** Select an area with no matching spawn pools → Director returns zero entities, sandbox shows "No entities generated" message, receipt shows empty axes
2. **Normal generation:** Select `dungeon_1` with default settings → entities spawn, map renders, receipt shows budget math
3. **Seed determinism:** Generate with seed 12345 twice → identical results both times
4. **Budget override:** Set budget to 100 → more/chunkier entities spawn
5. **Profile override:** Switch profile → different axis allocation visible in receipt
6. **Token pool respect:** Use a seed that generates a troll; verify troll appears at most once
7. **Validator blocking:** Set `crBudget: 1` on `dungeon_1` (no entity costs ≤1) → validator flags error → export blocked
8. **Static map check:** Point a connection placement at a wall tile in `safe_hub` → validator flags error
9. **Auto-simulate:** Click auto-simulate on a generated encounter → telemetry summary appears
10. **Play encounter:** Click play → sandbox game loads → player can move and fight → Escape returns to editor

---

## Dependency Order

```
Step 1 (DirectorReceipt extension)
  ↓
Step 2 (AI Arena telemetry)
  ↓
Step 3 (Sandbox UI) ← depends on Step 1 (receipt) and Step 2 (arena telemetry)
  ↓
Step 4 (Play Encounter mode)
  ↓
Step 5 (Validator checks)
  ↓
Step 6 (Tab-ify Simulation Lab) ← can be done in parallel with Steps 1-5
  ↓
Step 7 (Controller wiring)
  ↓
Step 8 (Export blocking verification)
  ↓
Step 9 (Manual testing)
```

Steps 1-2 can be done in any order (they touch different files). Steps 3-4 depend on 1-2. Steps 5-8 are independent of the UI work.

---

## Files Modified/Created Summary

| File | Action | Step |
|------|--------|------|
| [`src/map/encounter_director.ts`](src/map/encounter_director.ts) | MODIFY | 1 |
| [`src/editor/simulation/ai_arena.ts`](src/editor/simulation/ai_arena.ts) | MODIFY | 2 |
| [`src/rendering/ui/ai_arena.ui.ts`](src/rendering/ui/ai_arena.ui.ts) | MODIFY | 2, 6 |
| [`src/rendering/ui/director_sandbox.ui.ts`](src/rendering/ui/director_sandbox.ui.ts) | **CREATE** | 3 |
| [`src/main.ts`](src/main.ts) | MODIFY | 4 |
| [`src/editor/validator/encounter.validator.ts`](src/editor/validator/encounter.validator.ts) | MODIFY | 5 |
| [`src/rendering/editor_ui.ts`](src/rendering/editor_ui.ts) | MODIFY | 4, 6, 7 |
| [`src/editor/campaign_editor.ts`](src/editor/campaign_editor.ts) | MODIFY | 7 |
| [`src/types/game-state.types.ts`](src/types/game-state.types.ts) | MODIFY | 4 (SandboxPlaytestState) |
