# Milestone 77 — Tactical Floating HUD, Canvas Telemetry & RimWorld/DF/Ultima UX Overhaul

## 0. Architectural Philosophy & Standards Alignment (`AGENTS.md`, `ARCHITECTURE.md`, `MILESTONES.md` Phases 10–11, `scratchpad.md`)

Before touching any file, this plan locks in the project's non-negotiable architectural invariants established across `AGENTS.md` and Phases 10 & 11 (`M69–M76`):

1. **Pure Dumb Canvas Renderer (`M73` & `ARCHITECTURE.md` §8):**
   - `src/rendering/renderer.ts` has **zero imports** from `src/core/ecs.ts`, `src/types/components.types.ts`, or `src/types/game-state.types.ts`. It consumes only `(display, snapshot: ViewportSnapshot, prevSnapshot?: ViewportSnapshot)` and performs dirty-cell diffing via `cellEquals()`.
   - All ECS queries (`getComponent`, `getEffectiveStats`, `getFactionRelation`, `cachedFov`, `spatialIndex`, `computeInterceptedPath`) happen strictly in the **Presentational Viewport Projector** (`buildViewportSnapshot` and its decomposed helper `src/rendering/tactical_snapshot.ts`).
2. **Decoupled 60Hz Presentation Queue (`M72` & `ARCHITECTURE.md` §8):**
   - Input handlers and UI controllers **never** trigger synchronous full-DOM redraws (`renderUI`) or canvas draws. Instead, they enqueue intents via `queuePlayerIntent()` or update transient view state and mark specific `PresentationDomain` flags (`Map`, `Entities`, `HUD`, `Log`, `Inventory`, `Modals`, `VFX`) dirty via `markPresentationDirty()` for the 60Hz `renderPresenterFrame()` loop.
3. **Buffered `InputCommandQueue` & LIFO `modal_manager.ts` (`M70`, `M75`):**
   - Every gameplay action (left-click move/attack/smart-interact, quick-belt item use, paper-doll unequip) constructs a standard `Intent` and pushes it through `queuePlayerIntent()`.
   - Every modal toggle from the clickable side dock dispatches existing toggle intents (`createToggleInventoryAction`, `createToggleFactionsAction`, `createToggleQuestsAction`, `createToggleInvestigationAction`, `createToggleDossierAction`, `createToggleLedgerAction`, `createToggleSettingsAction`) through `queuePlayerIntent()` so `modal_manager.ts` preserves LIFO modal stacking and RTwP `baselinePaused` state.
4. **Strict Module Size Budget (~250 LOC max, ESLint `max-lines: 300`):**
   - Existing large modules flagged in `docs/scratchpad.md` (`session_controller.ts` at 637 LOC, `viewport_snapshot.ts` at 468 LOC, `input_handler.ts` at 259 LOC, `hud.ui.ts` at 189 LOC) **must not be bloated**.
   - All new features are decomposed into focused, single-concern modules under ~200 LOC each, following the downward dependency graph (`main → core → systems → map/rendering → types/constants/utils`) with zero circular imports and zero barrel files (`index.ts`).
5. **ECS Purity & Transient View State (`AGENTS.md` §4, `M75` Decision D7):**
   - `GameState` remains 100% pure JSON-serializable simulation state (no `Map`/`Set`, no DOM coordinates).
   - Purely presentational UI state (mouse hover tile `(x, y)`, floating verb-menu screen anchor `(clientX, clientY)`, folded card toggles, active log filter tab) lives in dedicated transient view-state modules or `localStorage`-backed settings (`src/core/settings.ts`), never polluting `GameState` or save files.
6. **TypeScript Strictness, Zero Magic Values & Safe DOM Construction (`AGENTS.md` §3, §5, §7, `M76` Decision D6):**
   - Zero `any` (`unknown` + type narrowing only), `exactOptionalPropertyTypes: true` compliance, explicit return types and `@param`/`@returns` JSDoc on every exported function/type/constant.
   - Zero `.innerHTML` across all new and modified UI views (`document.createElement()`, `textContent`, `replaceChildren()`).
   - Every threshold, label, color, and CSS class constant lives in `src/constants/`.
7. **Preserving Regression Tests (`tests/canvas_mount.test.ts`, `tests/renderer.test.ts`, `scripts/run-validator.ts`):**
   - `tests/canvas_mount.test.ts` asserts that `mountDisplayWithFogOverlay(display, campaign)` mounts only the ROT display canvas inside `#game-canvas-wrapper` for ASCII campaigns (`megacampaign`). Therefore, `#tactical-overlay` is mounted inside `#effects-overlay` (a sibling `<div>` inside `#game-canvas-wrapper`, excluded from `mountDisplayWithFogOverlay`), keeping `canvas_mount.test.ts` 100% green while rendering across both Tiles and ASCII modes.

---

## 1. Architectural Decisions (`D1–D6`)

### D1: Zero-Vertical-Obstruction Full-Viewport Layout (`100vw × 100vh`)
- **Decision:** Replace the rigid CSS grid with top/bottom bars (`56px 1fr 48px`) in `src/styles/layout.css` and `index.html` with a full-viewport map canvas stage (`100vw × 100vh`) overlaid by two pointer-transparent side columns (`#hud-left-stack` and `#hud-right-stack`, `pointer-events: none` on containers, `pointer-events: auto` on `.hud-card` children).
- **Rationale:** Matches RimWorld and Dwarf Fortress Steam Edition's spatial clarity while keeping 100% of the vertical center clear for the dungeon viewport. Every side card includes a header fold button (`▾`/`▸`) persisted in `PlayerSettings` (`src/core/settings.ts`), plus a `[Tab]` shortcut to collapse/expand all side panels at once.

### D2: Pure Presentational Tactical Overlay (`tactical_snapshot.ts` + `tactical_overlay.ui.ts`)
- **Decision:** Extend `ViewportSnapshot` (`src/rendering/viewport_snapshot.types.ts`) with a `readonly tactical: TacticalViewportData` payload computed by a dedicated pure projector `src/rendering/tactical_snapshot.ts` (<200 LOC) invoked from `buildViewportSnapshot()`. Render this payload in `src/rendering/ui/tactical_overlay.ui.ts` (<220 LOC) onto a `<canvas id="tactical-overlay">` inside `#effects-overlay`.
- **What `TacticalViewportData` contains (pure primitives, zero ECS references):**
  1. **Unit Tactical Badges (`ReadonlyArray<TacticalUnitBadge>`):** Screen-space `(gx, gy)`, `hpRatio` (`0..1`), `attitude` (`'hostile' | 'neutral' | 'friendly' | 'player'`, resolved via `getFactionRelation()`), and up to 3 active status icon/color pips.
  2. **Torchlight FOV & Atmospheric Vignette:** Player screen-space center `(playerGx, playerGy)` and effective FOV radius for a subtle warm radial torchlight gradient + edge vignette.
  3. **Animated Corner-Bracket Cursor & Path Preview:** Active target/hover cell `(gx, gy)`, attitude/validity tint, and `ReadonlyArray<Point>` path preview cells (computed via `computeInterceptedPath` when hovering/targeting within explored tiles).

### D3: Runtime 2D Pixel-Art Tile Mode vs. Classic ASCII Toggle (`procedural_sprites.ts`)
- **Decision:**
  - `public/data/campaigns/default/theme.json` already ships 32×32 PNG spritesheets (`tiles.png`, `monsters.png`, `rogues.png`, `items.png`), whereas `megacampaign` and `shroudgarde` are ASCII-by-design (`docs/scratchpad.md` §8.2).
  - Add `renderMode: 'auto' | 'sprites' | 'ascii'` to `PlayerSettings.visualFeedback` (`src/core/settings.ts`).
  - Create `src/rendering/procedural_sprites.ts` (<220 LOC) which generates a deterministic 32×32 pixel-art fallback sprite atlas `<canvas>` in memory for every `char` + `fg` + `bg` combination (textured stone bricks, mortar lines, doors, stairs, chests, items, and shadowed character silhouettes) whenever `renderMode === 'sprites'` is selected on an ASCII campaign or when a tile/entity lacks an explicit `spriteId`.
  - When `renderMode === 'ascii'` is toggled, `createGameDisplay()` forces ROT.js `layout: 'rect'` (crisp ASCII mode) even on campaigns that define a `tileSet`. Toggling the mode calls `sessionController.recreateDisplay()` (`main.ts` / `session_controller.ts`) and marks all presentation domains dirty.

### D4: Decomposed Mouse Controller (`mouse_input.ts` + `hover_state.ts`)
- **Decision:** Keep `src/core/input_handler.ts` and `src/core/session_controller.ts` slim by extracting all canvas pointer handling into `src/core/input/mouse_input.ts` (<220 LOC) and transient hover coordinates into `src/core/hover_state.ts` (<80 LOC).
- **Interactions:**
  - **Mouse Move (Hover):** Converts `(clientX, clientY)` via `display.eventToPosition(e)` + `snapshot.cameraOrigin` into world `(mapX, mapY)`. Updates `hover_state.ts` and marks `PresentationDomain.Map` and `PresentationDomain.HUD` dirty (only when tile coordinates actually change) so the Inspect Card and canvas corner-bracket cursor + path preview update at 60Hz without mutating `GameState`.
  - **Left-Click (Smart Action):**
    - Click on player `(px, py)` → `queuePlayerIntent(createWaitAction(playerId))`.
    - Click on an adjacent 8-way tile `(dx, dy)` → if closed door or chest/container with default interaction, dispatches smart `ApplyIntent` or `createMoveAction(playerId, dx, dy)` (which natively handles bump-attack, NPC bump-talk, and movement).
    - Click on a non-adjacent explored tile → steps one tile along `computeInterceptedPath()` toward the clicked tile via `createMoveAction`.
  - **Right-Click (`contextmenu` — RimWorld Context Verb Menu):**
    - Prevents browser context menu, records screen anchor `(clientX, clientY)` in `hover_state.ts`, and transitions to `UIMode.VerbMenu` at `(mapX, mapY)` with `verbMenuOptions: getVerbOptionsForTarget(state, mapX, mapY)` (reusing M75's `getVerbOptionsForTarget` where all verbs are illuminated and selectable by click or `[1]–[9]`).
    - `src/rendering/ui/verb_menu.ui.ts` positions `#verb-menu-modal` as a compact floating popover anchored near `(clientX, clientY)` (clamped to viewport bounds) when opened via right-click, or centered when opened via keyboard `[v]`.

### D5: Decomposed Floating Side HUD Cards (`hud_paperdoll.ui.ts`, `hud_alerts.ui.ts`, `hud_dock.ui.ts`)
- **Decision:** Rather than expanding `src/rendering/ui/hud.ui.ts` (currently 189 LOC), split the new side-mounted widgets into three dedicated view modules under `src/rendering/ui/`, each under ~180 LOC and using 100% `document.createElement()` (zero `.innerHTML`):
  1. `src/rendering/ui/hud_paperdoll.ui.ts`: Ultima/DF-style compact 6-slot equipment grid (`Weapon`, `Armor`, `Helm`, `Ring`, `Amulet`, `Offhand/Tool`) + 5-slot Quick-Use Consumable/Wand Belt (`[1]–[5]`). Clicking an equipped slot dispatches `createUnequipAction`; clicking a belt slot dispatches `createApplyAction` / `createConsumeAction`.
  2. `src/rendering/ui/hud_alerts.ui.ts`: RimWorld-style top-right color-coded alert ribbons (`Hostiles in Sight` via `getVisibleHostileEntityIds()`, `Critical Wounds`, `Starving/Hungry`, active detrimental status effects, and tracked quest objectives). Clicking a hostile alert centers/targets that hostile entity.
  3. `src/rendering/ui/hud_dock.ui.ts`: Compact vertical/grid command buttons on the right side for `Inventory [i]`, `Look [x]`, `Interact [v]`, `Factions [f]`, `Quests [q]`, `Investigate [n]`, `Dossier [o]`, `Ledger [l]`, `Tiles/ASCII [g]`, `Settings [Esc]`, and `Wait [.]`, reading live keybind labels from `getSettings().keybinds`.
  4. **Categorized Log Filter Tabs (`hud.ui.ts`):** Adds `All | Combat | Speech | World` filter tabs to the floating Message Log card using module-scope transient tab state (matching M75 Decision D7 in `investigation_filters.ui.ts`).

---

## 2. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Producers / Data) | Downstream (Consumers / Renderers / Validators / Tests) | Lateral (Sibling Modules / Styles / Docs) |
| :--- | :--- | :--- | :--- |
| **`TacticalViewportData` added to `ViewportSnapshot`** (`viewport_snapshot.types.ts`, `tactical_snapshot.ts`) | `buildViewportSnapshot()` in `src/rendering/viewport_snapshot.ts` calls `buildTacticalViewportData(state, cameraOrigin, cols, rows, cachedFov)` | `renderPresenterFrame()` in `src/rendering/presenter.ts` passes `snapshot.tactical` to `renderTacticalOverlay()`. `renderer.ts` is untouched (stays pure dumb). `tests/renderer.test.ts` mock `makeSnapshot()` updated with empty `tactical` fixture | `src/rendering/ui/vfx_overlay.ui.ts` (shares `#effects-overlay` container) |
| **Transient Hover & Anchor State** (`src/core/hover_state.ts`) | `src/core/input/mouse_input.ts` updates hovered world tile `(x, y)` on `mousemove` and screen anchor `(clientX, clientY)` on `contextmenu` | `buildTacticalViewportData()` reads hovered tile for bracket cursor & path preview; `inspect_view.ui.ts` falls back to hovered tile when not in `UIMode.Look`; `verb_menu.ui.ts` reads screen anchor for popover placement | `src/core/presentation_queue.ts` (`PresentationDomain.Map` and `PresentationDomain.HUD` marked dirty on tile hover change) |
| **Runtime Render Mode (`'auto' \| 'sprites' \| 'ascii'`) & Procedural Sprite Atlas** (`settings.ts`, `procedural_sprites.ts`, `display.ts`) | `getSettings().visualFeedback.renderMode` toggled via `hud_dock.ui.ts`, `[g]` shortcut, or `settings.ui.ts` | `createGameDisplay()` in `src/rendering/display.ts` selects `'tile'` vs `'rect'` layout and attaches synthesized tileSet when `'sprites'` is forced on ASCII campaigns; `sessionController.recreateDisplay()` remounts cleanly | `tests/canvas_mount.test.ts` remains 100% green because default `renderMode` is `'auto'` (preserving `megacampaign` ASCII behavior unless toggled by user) |
| **Side-Mounted Floating HUD & Decomposed Views** (`hud.ui.ts`, `hud_paperdoll.ui.ts`, `hud_alerts.ui.ts`, `hud_dock.ui.ts`) | `renderPresenterFrame()` (`presenter.ts`) invokes `renderHUD()`, `renderHudPaperdoll()`, `renderHudAlerts()`, and `renderHudDock()` when `PresentationDomain.HUD` / `Inventory` / `Log` are dirty | DOM containers in `index.html` (`#hud-left-stack`, `#hud-right-stack`, `#hud-alerts-container`); click handlers enqueue intents via `queuePlayerIntent()` | `src/styles/layout.css`, `src/styles/hud.css`, `src/constants/ui.constants.ts` |
| **Message Log Filter Tabs (`All \| Combat \| Speech \| World`)** (`hud.ui.ts`, `ui.constants.ts`) | `state.messages` (`ReadonlyArray<LogMessage>`) produced by `addMessage()` in `src/systems/message.system.ts` | `renderMessageLog()` in `src/rendering/ui/hud.ui.ts` filters displayed log entries by `MessageType` category; tab click marks `PresentationDomain.Log` dirty | Mirrors M75 `investigation_filters.ui.ts` transient module-state pattern (`GameState` unchanged) |

---

## 3. Step-by-Step Implementation Plan & Code Snippets

### Step 1: Constants & Transient Hover State (`src/constants/ui.constants.ts`, `src/core/hover_state.ts`)
- Extend `src/constants/ui.constants.ts` with named constants for tactical overlay colors, health bar geometry, torchlight alpha stops, log filter categories, and quick-belt slot counts (zero magic numbers).
- Create `src/core/hover_state.ts` (<80 LOC) to hold transient pointer state outside `GameState`:

```typescript
// src/core/hover_state.ts
import { Point } from '../types/common.types';

export interface TransientHoverState {
  readonly hoveredTile: Point | null;
  readonly contextMenuAnchor: Point | null;
}

let currentHover: TransientHoverState = {
  hoveredTile: null,
  contextMenuAnchor: null,
};

/** Returns the current transient pointer hover state. */
export function getHoverState(): TransientHoverState {
  return currentHover;
}

/** Updates the hovered world tile; returns true if the tile coordinate changed. */
export function setHoveredTile(tile: Point | null): boolean {
  const prev = currentHover.hoveredTile;
  const same = (prev === null && tile === null) || (prev !== null && tile !== null && prev.x === tile.x && prev.y === tile.y);
  if (same) return false;
  currentHover = { ...currentHover, hoveredTile: tile };
  return true;
}
```

### Step 2: Tactical Viewport Snapshot Extension (`src/rendering/viewport_snapshot.types.ts`, `src/rendering/tactical_snapshot.ts`, `src/rendering/viewport_snapshot.ts`)
- Define pure DTO interfaces in `src/rendering/viewport_snapshot.types.ts`:

```typescript
export type TacticalAttitude = 'player' | 'hostile' | 'neutral' | 'friendly';

export interface TacticalUnitBadge {
  readonly gx: number;
  readonly gy: number;
  readonly hpRatio: number;
  readonly attitude: TacticalAttitude;
  readonly statusColors: ReadonlyArray<string>;
}

export interface TacticalCursorData {
  readonly gx: number;
  readonly gy: number;
  readonly attitude: TacticalAttitude | 'terrain';
  readonly pathCells: ReadonlyArray<{ readonly gx: number; readonly gy: number }>;
}

export interface TacticalViewportData {
  readonly playerScreenPos: { readonly gx: number; readonly gy: number } | null;
  readonly fovRadius: number;
  readonly unitBadges: ReadonlyArray<TacticalUnitBadge>;
  readonly cursor: TacticalCursorData | null;
}
```
- Implement `buildTacticalViewportData()` in `src/rendering/tactical_snapshot.ts` (<200 LOC) and call it at the end of `buildViewportSnapshot()` in `src/rendering/viewport_snapshot.ts` (adding only ~6 lines to `viewport_snapshot.ts`).
- Update `makeSnapshot()` in `tests/renderer.test.ts` with a default empty `tactical` object so all existing unit tests compile and pass.

### Step 3: Tactical Canvas Overlay View (`src/rendering/ui/tactical_overlay.ui.ts`)
- Create `src/rendering/ui/tactical_overlay.ui.ts` (<220 LOC) rendering onto `<canvas id="tactical-overlay">` (placed inside `#effects-overlay` in `index.html`):
  1. **Warm Torchlight & Vignette Pass:** Radial gradient centered on `tactical.playerScreenPos` using `FOV_TORCHLIGHT_INNER_RGBA` to `FOV_VIGNETTE_OUTER_RGBA`.
  2. **Unit Micro-Bars & Attitude Pips:** For each `TacticalUnitBadge` where `hpRatio < 1` or `attitude === 'hostile'`, draw a crisp 1px-bordered micro health bar at the bottom of cell `(gx, gy)` and a 3×3 attitude diamond/status pip at top-left.
  3. **Animated Corner-Bracket Cursor & Path Dots:** Draw 4 corner brackets (`┌ ┐ └ ┘`) with subtle pulse around `tactical.cursor` and breadcrumb dots along `tactical.cursor.pathCells`.

### Step 4: Procedural 2D Pixel-Art Sprite Synthesizer & Render Mode Toggle (`src/rendering/procedural_sprites.ts`, `src/rendering/display.ts`, `src/core/settings.ts`)
- Add `renderMode: 'auto' | 'sprites' | 'ascii'` to `PlayerSettings['visualFeedback']` in `src/core/settings.ts` (default `'auto'`).
- Create `src/rendering/procedural_sprites.ts` (<220 LOC) that builds an in-memory 32×32 pixel-art `<canvas>` spritesheet and `tileMap` for every glyph in the snapshot when `renderMode === 'sprites'` is active on a campaign without native PNG sheets (or for unmapped glyphs), drawing beveled stone walls, speckled cavern floors, wooden doors, stairs, item silhouettes, and shadowed unit sprites.
- Update `createGameDisplay()` in `src/rendering/display.ts` to respect `getSettings().visualFeedback.renderMode` and expose `recreateDisplay()` on `SessionController` so toggling `[g]` or clicking the HUD `Tiles/ASCII` button hot-swaps the display cleanly.

### Step 5: Full-Viewport Side-Stack HTML/CSS & Decomposed HUD Views (`index.html`, `src/styles/layout.css`, `src/styles/hud.css`, `src/rendering/ui/hud_*.ui.ts`)
- Update `index.html`, `src/styles/layout.css`, and `src/styles/hud.css` so `#game-canvas-wrapper` occupies `100vw × 100vh` (`position: fixed; inset: 0`), with floating left (`#hud-left-stack`) and right (`#hud-right-stack`) column overlays and top-right `#hud-alerts-container`.
- Create:
  - `src/rendering/ui/hud_paperdoll.ui.ts` (<180 LOC): 6-slot paper-doll + 5-slot `[1]–[5]` quick-use belt with click-to-use / click-to-unequip via `queuePlayerIntent()`.
  - `src/rendering/ui/hud_alerts.ui.ts` (<160 LOC): RimWorld-style right-edge alert ribbons for hostiles in FOV, low HP, hunger, active debuffs, and active quests.
  - `src/rendering/ui/hud_dock.ui.ts` (<180 LOC): Clickable command dock with dynamic hotkey badges from `getSettings().keybinds`, render-mode toggle (`2D Tiles / ASCII`), and fold-all toggle (`[Tab]`).
- Update `src/rendering/ui/hud.ui.ts` to add `All | Combat | Speech | World` filter tabs to the message log card and support folding individual cards.
- Update `src/rendering/ui/inspect_view.ui.ts` to inspect `getHoverState().hoveredTile` when in `UIMode.Map` and `state.cursor` when in `UIMode.Look`/`UIMode.Targeting`.

### Step 6: Mouse Controller & Floating Context Verb Menu (`src/core/input/mouse_input.ts`, `src/rendering/ui/verb_menu.ui.ts`)
- Create `src/core/input/mouse_input.ts` (<220 LOC) and wire it in `src/core/input_handler.ts`:
  - `mousemove` → updates `setHoveredTile()`, marks `PresentationDomain.Map | PresentationDomain.HUD` dirty on tile change.
  - `click` (left-click) → dispatches `createWaitAction`, adjacent `createMoveAction` / smart `ApplyIntent`, or first step along `computeInterceptedPath()` via `queuePlayerIntent()`.
  - `contextmenu` (right-click) → sets `contextMenuAnchor`, populates `getVerbOptionsForTarget(state, mapX, mapY)`, transitions to `UIMode.VerbMenu`, and marks `PresentationDomain.Modals | PresentationDomain.Map` dirty.
  - `[1]–[5]` shortcut keys in `src/core/input/shortcut_input.ts` → trigger quick-belt slot 1–5 consumable/wand when in `UIMode.Map`.
- Update `src/rendering/ui/verb_menu.ui.ts` so `#verb-menu-modal` positions itself at `getHoverState().contextMenuAnchor` (clamped to viewport) when opened by right-click.

---

## 4. Verification & Post-Implementation Audit (`AGENTS.md` Steps 6–11)
1. **Typecheck & Build:** `compile_applet` (`tsc && vite build`) — 0 errors.
2. **Linter & Architecture Guardrails:** `lint_applet` (`eslint`) — 0 errors, 0 `max-lines` violations, 0 `no-explicit-any`, 0 `explicit-function-return-type` violations.
3. **Campaign Validator & Unit Tests:** Run `scripts/run-validator.ts` and Vitest suite (`tests/canvas_mount.test.ts`, `tests/renderer.test.ts`, etc.) — all pass.
4. **Documentation Sync (`AGENTS.md` Step 11):** Update `docs/ARCHITECTURE.md`, `docs/MILESTONES.md` (Milestone 77), `docs/DECISIONS.md`, and `docs/scratchpad.md`.
