# Research Notes — Full UI Componentization, Unified Theming & Keyboard-First Input Architecture Rewrite

*Prepared per `AGENTS.md` Phase 1 (Steps 1–3). Read-only codebase audit completed against trunk commit `b76cca8` (post-Milestone 156).*

---

## 0. Architectural Constraints Reiteration (`AGENTS.md` & `ARCHITECTURE.md`)

Any UI and input rewrite must strictly preserve the project's existing engineering invariants:
1. **Strict TypeScript (`tsconfig.json`):** Zero `any`, `exactOptionalPropertyTypes: true`, explicit return types on all functions, exhaustive `switch` (`assertNever`), zero magic gameplay/UI constants, no barrel files (`index.ts`).
2. **ECS & Headless Simulation Purity (`.dependency-cruiser.cjs`):** `src/systems/`, `src/rulesets/`, `src/map/`, `src/types/`, `src/constants/`, and `src/utils/` must NEVER import from `src/rendering/` or `src/editor/`. Transient UI state (focus, modal stack, hover tile, active tabs, filter chips) lives outside `GameState` so saves and replays stay deterministic.
3. **Pure Dumb Canvas Renderer & Dirty Domains:** Preserve `ViewportSnapshot` (`src/rendering/viewport_snapshot.ts`), zero-ECS `src/rendering/renderer.ts`, `#game-canvas-wrapper` mount contract (`tests/canvas_mount.test.ts`), and `PresentationDomain` dirty gating (`src/core/presentation_queue.ts`).
4. **Tier 1 Console vs. Tier 2 Cartridge Inversion of Control (Rules 16 & 21):** Console UI primitives and hosts must remain 100% ruleset-agnostic (zero content-ID or ruleset-ID branches). Ruleset cartridges (`classic`, `dnd35e`, future rulesets) plug in declaratively via `CartridgeUIAdapter` and `CartridgeUIDefinition`.
5. **DOM Safety & Environment Hygiene:** Zero `.innerHTML` for rich/interpolated HTML (`AGENTS.md` §7), zero native `window.alert()` / `window.confirm()` / `window.prompt()` (blocked/broken in iframe and itch.io embeds), and `<250 LOC` focused view modules.
6. **8-Stage Verification & 3-Way SSOT Parity:** Every milestone must pass `./verify.sh` (`tsc`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `build`, `run-validator.ts`) and keep `docs/ssot/ssot_{console,classic,dnd35e}.json` synchronized.

---

## 1. Executive Summary & Measured Codebase Footprint

The current UI and input layers evolved organically across 156 milestones without a unified component system, token contract, or scoped input architecture. While the underlying **simulation, ECS, `ViewportSnapshot`, and `CartridgeUIAdapter` boundaries are strong**, the view and input layers suffer from severe structural fragmentation:

| Area | Measured Metric | Architectural Symptom |
| :--- | :--- | :--- |
| **Rendering / UI TS Files** | `114` files in `src/rendering/` (`92` in `src/rendering/ui/`, `7` in `src/rendering/editor/`, `15` core canvas/audio/vfx) | Ad-hoc imperative DOM builders; zero shared UI primitives (`Button`, `Modal`, `Tabs`, `ListBox`, `Dialog`) |
| **Static HTML Shell** | `591` lines in `index.html` (`17` hardcoded overlays/modals, `35+` inline `style="..."` blocks) | Inline hex colors (`#c0392b`, `#f1c40f`, `#00ff00`), Classic ruleset borrowing `#dnd35e-sheet-overlay` |
| **Stylesheets** | `6` CSS files totaling `4,941` lines (`console_prototype.css`: 2,022; `modals.css`: 1,331; `hud.css`: 868; `editor.css`: 484; `layout.css`: 151; `core.css`: 85) | **4 disconnected color/token systems**; only 1 responds to theme switching |
| **Inline Styling** | `76 / 114` files in `src/rendering/` mutate `.style.*` directly | Top offenders: `trade.ui.ts` (78), `dossier_hierarchies.ui.ts` (65), `zod_form_containers.ts` (57), `modal.ui.ts` (54), `menus.ui.ts` |
| **Unsafe `.innerHTML` Usage** | `37 / 114` files in `src/rendering/` use `.innerHTML` | Violates `AGENTS.md` §7; includes Tier 1 `console_dossier.ui.ts` (lines 65, 95, 132, 135, 152, 203, 207, 260) |
| **Native Browser Dialogs** | `35` calls to `alert()` / `confirm()` / `prompt()` across `src/core/`, `src/editor/`, `src/rendering/` | Breaks itch.io / iframe constraints; completely unthemed |
| **Keydown Listeners** | `4` uncoordinated listeners (`session_controller.ts:238`, `editor_ui.ts:180`, `a11y.ts:32`, `modal.ui.ts:154`) | **Zero text-input focus guard** — typing in Character Creation, Shop Search, Settings, or Prompts triggers game/modal hotkeys |
| **Focus & Keyboard Coverage** | `trapFocus()` wired on only `6 / 16` modal modes; caches stale nodes once after `50ms` | Re-renders via `replaceChildren()` wipe DOM focus & scroll position; 10+ screens are partially or completely mouse-only |

---

## 2. Deep Audit A — UI Componentization, CSS & Theme Fragmentation

### 2.1 The Four Disconnected Theme / Token Systems

The reason switching between **Parchment Tabletop** and **Retro CRT** only restyles a fraction of the interface is that four separate styling systems coexist with zero shared contract:

1. **System 1 — `--crpg-*` Tokens (`src/styles/console_prototype.css`, 2,022 lines):**
   - The **only** stylesheet containing `[data-console-theme='parchment']` and `[data-console-theme='retro-crt']` selectors.
   - Consumed by only `31` files (Console Dossier, Hotbar, Inventory, Inspect Card, and D&D 3.5e Sheet, Builder, Level-Up, Spellbook, Quickcast, Inspector).
2. **System 2 — `--bg-*` / `--border-*` / `--text-*` Tokens (`core.css`, `layout.css`, `hud.css`, `modals.css`, 2,435 lines):**
   - Hardcoded Dark Slate & Brass palette (`#191c24`, `#484f5e`, `#9e782f`, `#e4e6ed`) in `:root` with **zero `[data-console-theme]` overrides**.
   - Governs the static `index.html` HUD plates (Vitals, Command Dock, Tactical Scanner, Chronicle Log), Main Menu, Ruleset Select, Campaign Select, Settings, Rebinding, Game Over, Factions, Dialogue, Quests, Investigation Board, Nemesis Dossier, Historical Ledger, Verb Menu, and Debug Ledger — all of which stay frozen in Dark Slate & Brass regardless of the active theme.
3. **System 3 — Dead `--console-*` Runtime Tokens (`src/rendering/ui/console_theme.ts`, 150 lines):**
   - `setConsoleThemeMode()` writes 12 `--console-*` CSS variables onto `document.documentElement` (`--console-bg-canvas`, `--console-accent-primary`, etc.).
   - **Consumed by ZERO CSS files or TS components anywhere in `src/`.** (Only tested by `tests/console_ui_architecture.test.ts`!)
   - Worse: `src/rendering/ui/classic_ui_registration.ts:41` calls `setConsoleThemeMode('retro-crt')` unconditionally every time the Classic sheet opens, **silently overwriting the player's Settings override (`parchment`)**.
4. **System 4 — Editor & Ad-Hoc Inline Palettes (`editor.css`, `modal.ui.ts`, `trade.ui.ts`, `index.html`):**
   - `editor.css` (484 lines) defines its own dark IDE colors.
   - `src/rendering/ui/modal.ui.ts` (`showPromptModal`) hardcodes Catppuccin inline colors (`#1e1e2e`, `#cdd6f4`, `#89b4fa`, `#45475a`).
   - `src/rendering/ui/trade.ui.ts` dynamically appends `<div id="trade-overlay">` directly to `document.body` with `78` inline `.style.*` assignments.
   - `index.html` embeds hardcoded hex colors (`#c0392b`, `#16a085`, `#2980b9`, `#f1c40f`, `#e74c3c`, `#9b59b6`, `#00ff00`, `#f39c12`) directly on modal headers and buttons.

### 2.2 Documentation & Asset Drift (`docs/UI_UX_STANDARDS.md`)
- `docs/UI_UX_STANDARDS.md` specifies fonts (`Plus Jakarta Sans`, `IBM Plex Mono`, `Space Mono`, `Playfair Display`), but `index.html` only loads `Cinzel` and `JetBrains Mono`.
- `docs/UI_UX_STANDARDS.md` references filenames that do not exist in the codebase (`console_paperdoll.ui.ts`, `console_modal_host.ts`, `console_ui_adapter.ts`, `default_ui_adapter.ts`).

### 2.3 Structural DOM & State Anti-Patterns
- **Destructive Full-Subtree Rebuilds:** Nearly every view (`console_dossier.ui.ts`, `console_hotbar.ui.ts`, `console_inventory.ui.ts`, `hud_dock.ui.ts`, `hud.ui.ts`, `trade.ui.ts`, `dnd35e_quickcast.ui.ts`, `menus.ui.ts`) calls `container.replaceChildren()` on every dirty update. This destroys active DOM focus, resets scroll positions (forcing manual hacks like `trade.ui.ts:330–359`), and breaks `trapFocus()` references.
- **Static DOM ID Coupling Across Cartridges:** `classic_ui_registration.ts:26,43,117,124` renders the Classic/Sci-Fi Character Sheet into `#dnd35e-sheet-overlay` and `#dnd35e-sheet-body` because there is no generic Console Modal Host.
- **Split-Brain UI Module State:**
  - `hud_bottom_dock.ui.ts:29` tracks `let activeBank = 1` while `console_hotbar.ui.ts:52` separately tracks `let activeBankIndex = 1`.
  - `hud.ui.ts:237–251` (`updateHUD`) performs a duplicate raw `FighterComponent` HP bar write after `renderPlayerStats()` already projected ruleset vitals.
  - `editor_ui.ts:282–298` attaches `document.addEventListener('mousemove' | 'mouseup')` on every Editor mount without cleaning them up in `activeEditorCleanup` (listener leak).

### 2.4 Strong Architectural Seams Worth Preserving
A rewrite should **keep and strengthen** (NOT discard) four existing boundaries that work well:
1. **`ViewportSnapshot` + Pure Dumb `renderer.ts`** (`src/rendering/viewport_snapshot.ts`, `src/rendering/renderer.ts`, `src/rendering/tactical_snapshot.ts`).
2. **`PresentationDomain` Dirty Queue** (`src/core/presentation_queue.ts`) — prevents redundant UI work on off-screen NPC turns.
3. **Cartridge UI Inversion of Control** (`src/types/ui_adapter.types.ts`, `src/rulesets/*/ui/*_ui_adapter.ts`, `src/rendering/ui/cartridge_ui_registry.ts`).
4. **Transient Modal LIFO Stack + RTwP Pause Baseline** (`src/core/modal_manager.ts`).

---

## 3. Deep Audit B — Keyboard Mapping, Input Scoping & Accessibility Failures

### 3.1 Root Cause 1: Typing in Text Inputs Triggers Global/Modal Keybinds

**Exact Causal Chain:**
1. `src/core/session_controller.ts:238` attaches a single `window.addEventListener('keydown', ...)` invoking `handleKeyDown()` in `src/core/input_handler.ts`.
2. **Neither `session_controller.ts`, `input_handler.ts`, `modal_input.ts`, nor `shortcut_input.ts` checks whether `event.target` / `document.activeElement` is an editable control (`<input>`, `<textarea>`, `<select>`, `[contenteditable="true"]`).**
3. When any `UIMode.CartridgeModal` is active, `handleModalKey()` (`src/core/input/modal_input.ts:115–172`) executes on **every keystroke**:
   - Lines `139–152`: Checks every `cartridgeUI.dockCommands` (`c`, `i`, `z`, `b`, `t`, `u` in D&D 3.5e) — calls `event.preventDefault()` and fires the command! **Typing `'t'` in Character Creation Name or Title literally triggers `Rest (8h)`! Typing `'c'`, `'i'`, `'b'`, `'z'`, `'u'` swallows the letter and toggles/fires cartridge actions!**
   - Lines `154–166`: Checks `MODAL_BINDINGS` (`y`, `q`, `v`, `n`, `l`) — calls `event.preventDefault()` and opens Factions, Quests, Investigation, Nemesis Dossier, or Historical Ledger **directly on top of Character Creation!**
   - Lines `130–136`: When `handlesInventoryHotkeys: true` (Character Sheet / Inventory), intercepts all `a–z` keys unconditionally — even when focused on `<select class="crpg-sort-select">` (`console_inventory.ui.ts:209`).
4. In `UIMode.Settings`, `modal_input.ts:185–191` runs `MODAL_BINDINGS` without an editable-element guard, so typing letters near `<input type="number" id="autopause-threshold-input">` or `<select>` controls opens modals over Settings.
5. `showPromptModal()` (`src/rendering/ui/modal.ui.ts:154`) appends directly to `document.body` **without changing `UIMode` and without calling `e.stopPropagation()`** — so every keystroke typed in a prompt modal leaks directly to `window` `keydown`!
6. In `UIMode.Editor`, `src/rendering/editor_ui.ts:162–180` intercepts `Ctrl+Z` / `Ctrl+Y` on `window` even when typing inside text inputs/textareas, hijacking native text undo/redo.

**Confirmed Affected Editable Inputs in Gameplay UI:**
- `dnd35e_char_builder_summary.ui.ts`: `nameInput` (line 340), `titleInput` (line 362), `customColorInput` (line 414), `customTraitInput` (line 453)
- `dnd35e_char_builder_shop.ui.ts`: `searchInput` (line 227), `outfitSelect` (line 350), `slotSel` (line 386)
- `dnd35e_char_builder_sprite_picker.ui.ts`: `searchInput` (line 127)
- `dnd35e_char_builder_feat_row.ui.ts`: `targetSelect` (line 188)
- `console_inventory.ui.ts`: `sortSelect` (line 209)
- `settings.ui.ts` & `index.html`: `autopause-threshold-input`, `setting-ui-scale`, `setting-console-theme`, `setting-sprite-pack`
- `modal.ui.ts`: `showPromptModal` `<input>` (line 56)

### 3.2 Root Cause 2: Fragmented, Colliding & Broken Keybinding System

1. **Built-In Key Collisions (`src/core/settings.ts`):**
   - `'l'` is bound to BOTH `move_east` (`['arrowright', 'd', 'l', '6']`) AND `ledger` (`['l']`).
   - `'enter'` is bound to BOTH `target_confirm` AND `verb_menu`.
   - `public/data/campaigns/*/keybinds.json` (4 campaigns) only lists 14 legacy actions, missing all 9 modal/cartridge actions added later.
2. **Broken Cartridge Command Binding (Settings Rebinding Ignored):**
   - `settings.ts` defines `ActionType` keys `'character_sheet'`, `'inventory'`, `'spellbook'`, `'level_up'`.
   - `dnd35e_ui_registration.ts` registers dock command IDs `'dnd35e_sheet'`, `'dnd35e_inventory'`, `'dnd35e_quickcast'`, `'dnd35e_spellbook'`, `'dnd35e_rest_8h'`, `'dnd35e_level_up'`.
   - `classic_ui_registration.ts` registers `'classic_sheet'`, `'classic_inventory'`.
   - Because `modal_input.ts`, `shortcut_input.ts`, and `hud_dock.ui.ts:309` cast `cmd.id as ActionType`, `isAction()` **always returns `false`** and falls back to hardcoded `cmd.defaultKey`. **Rebinding Character Sheet, Spellbook, or Level Up in Settings currently does nothing!** And `quickcast` (`z`) / `rest_8h` (`t`) are completely absent from Settings.
3. **Hardcoded Keys Outside Settings & Unimplemented Advertised Hotkeys:**
   - `shortcut_input.ts` hardcodes `` ` `` (Debug), `Tab` (Fold HUD — breaking standard browser keyboard Tab focus traversal!), and `Digit1..0/-/=` (Hotbar slots 1–12) outside `PlayerSettings.keybinds`.
   - `console_hotbar.ui.ts:189,204` displays tooltips `'Previous Hotbar Bank (Shift+Up)'` / `'Next Hotbar Bank (Shift+Down)'` — **completely unimplemented**.
   - `hud_dock.ui.ts:135` displays badge `'ESC'` on the Settings button — **`Escape` in `UIMode.Game` does NOT open Settings** (`input_handler.ts` only cancels targeting/inspect).
   - `index.html:451` tells the player `"Press C or Esc to close."` on Factions — Factions is actually bound to **`Y`**.
4. **Structural Capability Gaps:**
   - No **modifier chords** (`Ctrl+S`, `Shift+Tab`, `Alt+1`, `Shift+ArrowUp`).
   - No **input contexts/scopes** (cannot distinguish World vs. Targeting vs. Modal vs. TextInput vs. Editor for binding or conflict detection).
   - **`rebindAction()` destroys multi-key bindings** (`settings.ts:242–252` replaces `['arrowup', 'w', 'k', '8']` with a single-key array `[newKey]`, wiping arrow/WASD fallbacks!).
   - No **physical `event.code` vs. layout `event.key`** normalization (Shift-modified symbols or non-QWERTY layouts behave inconsistently).
   - No **8-way diagonal movement** actions (`move_nw`, `move_ne`, `move_sw`, `move_se` / numpad `1,3,7,9`).

### 3.3 Root Cause 3: Mouse-Only UI Elements & Broken Focus Management

1. **Stale & Incomplete Focus Trapping (`src/utils/a11y.ts` & `src/core/session_controller.ts:119–152`):**
   - `trapFocus()` is only invoked for `6` of `16` modal modes (`Settings`, `Dialogue`, `RulesetSelect`, `CampaignSelect`, `CartridgeModal`, `GameOver`) — omitted for `Inventory`, `Trade`, `Services`, `Factions`, `Quests`, `Investigation`, `Dossier`, `Ledger`, `Debug`, `VerbMenu`, and `showPromptModal`.
   - `trapFocus()` queries focusables **once** after a `50ms` timeout and caches `firstFocusableEl` / `lastFocusableEl`. The instant any modal re-renders (`replaceChildren()`), those references become detached DOM nodes, silently breaking Tab wrapping and dropping focus to `document.body`.
   - `trapFocus()` selector omits `<input type="number|search|range|color">` and never restores focus to the trigger element on close.
2. **Screen-by-Screen Mouse-Only Inventory:**

| Screen / Region | Current Keyboard Support | Mouse-Only / Broken Interactions |
| :--- | :--- | :--- |
| **Main Menu / Ruleset / Campaign / Game Over** | None (`input_handler.ts:127–135` returns early) | No `Escape`-to-back, no Arrow list navigation, no `Enter` quick-advance |
| **HUD Left Plate (Vitals, RTwP, Camera)** | None (`Space` waits/pauses only) | Engine mode toggle, RTwP `1x/2x/4x`, `45°`, `3D`, `Zoom ±`, Settings `⚙`, Card fold/unfold |
| **HUD Right Stack (Command Dock, Scanner, Log)** | `Tab` folds all cards (stealing focus Tab) | Individual card fold, 2D/ASCII toggle, Log filter tabs (`All`/`Combat`/`Speech`/`System`), scrolling Log/Scanner |
| **HUD Bottom Dock (Stances, Hotbar)** | `1–0/-/=` triggers hotbar slots | Combat stance toggles, Power Attack / Combat Expertise `[-][+]` steppers, Bank `▲/▼` switching (`Shift+Up/Down` unimplemented), End Turn button |
| **Console Master Dossier / Inventory** | `a–z` / `Shift+a–z` for first 26 items, `Esc` | Paperdoll slots & Stash cells are `<div>` (not `<button>`): unfocusable, cannot unequip via keyboard, items `#27–30` unreachable, hover-only item inspect card, Weapon Sets `I–IV`, category filters, skills `Use` buttons |
| **D&D 3.5e Character Creation / Level Up** | `Esc` (blocked by text-input bug!) | Step navigation, race/class/alignment/domain/ACF/feat/skill/spell selection, point-buy `[-][+]`, custom shop, sprite picker — all mouse-only |
| **D&D 3.5e Character Sheet / Spellbook / Quickcast** | `Esc`, `c`/`b`/`z` toggle | Tab switching, spell memorization/unpreparation, metamagic & spontaneous modifier toggles, class accordions, spell tiles, companion/attack inspection |
| **Trade & Services (`trade.ui.ts`)** | `Esc` only | Switching Merchant/Player panes, selecting items, Buy/Sell, Social haggle buttons (Appraise/Diplomacy/Bluff/Intimidate) — 100% mouse-only |
| **Quests / Factions / Investigation / Dossier / Ledger / Debug** | `Esc` + cross-modal toggles | List scrolling/selection, filter chips, expandable hierarchies, Debug fast-forward schemes |
| **Verb Menu & Dialogue** | `1–9` + `Esc` | No `ArrowUp`/`ArrowDown` selection highlight + `Enter` confirm (`verb_menu.ui.ts` uses `<li>`, not `<button>`) |

---

## 4. Architectural Options & Honest Engineering Pushback (`AGENTS.md` Rules 6, 7, 9)

### 4.1 Decision 1 — UI View Layer Technology (Keep ROT.js Canvas Pure & Untouched)

The ROT.js map canvas (`renderer.ts`, `tactical_overlay.ui.ts`, `vfx_overlay.ui.ts`) MUST remain pure Canvas2D driven by `ViewportSnapshot`. The technology decision applies **strictly to the DOM UI chrome** (Menus, HUD, Modals, Dossier, Builder, Spellbook, Trade, Dialogs, Tooltips).

| Criterion | Option A: Zero-Framework Vanilla TS Component Kit | **Option B (Recommended): Preact (`preact` ~4KB gzip) + Semantic CSS Tokens** | Option C: React 19 + Tailwind CSS |
| :--- | :--- | :--- | :--- |
| **Runtime Bundle Size (itch.io)** | `0 KB` added | `~4 KB` gzipped (`preact` + `preact/hooks`) | `~45–50 KB` gzipped (`react` + `react-dom`) + Tailwind build pipeline |
| **Focus & Scroll Preservation** | Must hand-write keyed DOM reconciliation/patching for every list/tab/modal (high bug risk across ~60+ gameplay views) | **Automatic** via keyed VDOM diffing — focus, selection, caret position, and scroll offsets survive state updates cleanly | Automatic, but heavier reconciler & synthetic event overhead |
| **`.innerHTML` Elimination & XSS Safety** | Manual discipline (`createElement` boilerplate everywhere; verbose) | **Structural** — JSX renders safe text nodes by default; `.innerHTML` disappears completely | Structural |
| **Componentization & Reuse** | Verbose factory functions + manual cleanup/unsubscribe tracking | First-class typed components (`<ModalShell>`, `<Tabs>`, `<ListBox>`, `<Button>`, `<StatChip>`, `<Keycap>`, `<Tooltip>`) with deterministic unmount cleanup | First-class, but heavier ecosystem footprint |
| **Integration with `GameState` + `PresentationDomain`** | Direct imperative calls from `presenter.ts` | Single thin UI bridge store (`ui_store.ts`) fed by `presenter.ts` per dirty `PresentationDomain` — zero ECS coupling in primitives, 100% headless simulation purity preserved | Same bridge, heavier runtime |
| **Tooling / Config Impact** | Zero config changes | Minor: add `preact` dep, set `"jsx": "react-jsx"`, `"jsxImportSource": "preact"` in `tsconfig.json` & `vite.config.ts`, update `knip`/SSOT scripts for `.tsx` | Larger toolchain shift (Tailwind v4 plugin, PostCSS/Vite config, React types) |

> **Honest Pushback on Option C (React + Tailwind):** React adds ~10× the bundle weight of Preact for zero functional advantage in a client-only roguelike UI that already has an immutable `GameState` and explicit `PresentationDomain` dirty gates. Similarly, Tailwind utility classes tend to scatter raw styling decisions across TSX files unless wrapped in semantic classes anyway — whereas a **layered Semantic CSS Token architecture (`tokens.css` + `themes/*.css` + `primitives.css` + `views/*.css`)** guarantees 100% theme consistency across Parchment, Retro CRT, and Dark Slate/Brass with zero utility-class sprawl and tiny CSS output.
>
> **Honest Pushback on Option A (Pure Vanilla TS):** Writing a full keyed DOM reconciler + reactive subscription model from scratch for ~60+ rich CRPG views (Character Builder, Spellbook, Master Dossier, Trade, Investigation Board, Settings Keybind Matrix) is classic wheel-reinvention — you end up maintaining a buggy, bespoke mini-framework. Preact gives us real declarative componentization and rock-solid focus preservation for 4KB gzipped.

### 4.2 Decision 2 — Scope Pushback: Separate Gameplay UI Rewrite from Campaign Editor Rewrite

**Strong Recommendation (Pushback against a "Big-Bang Everything" Rewrite):**
- Of the `99` files in `src/rendering/ui/` + `src/rendering/editor/`, roughly **`~26` files** belong exclusively to the **Campaign Editor** (Zod recursive form generator, static tile painter, world graph canvas, dialogue tree editor, faction matrix, knowledge simulator, narrative fuzzer, balance lab, director sandbox).
- Rewriting all Gameplay UI **and** all Campaign Editor tooling in one monolithic pass would double the surface area and delay playable improvements by months.
- **Proposed Two-Track Strategy:**
  1. **Track 1 — Core Architecture + Complete Gameplay UI Rewrite (Milestones 157–164):**
     - Unified Design Token & Theme System (`--ui-*`)
     - Scoped Input & Full Keyboard Mapping Engine (`InputScopeManager` + `CommandRegistry`)
     - Shared UI Primitive Library + Live Focus/Keyboard Navigation Kit + In-App `DialogService` (zero `alert`/`confirm`/`prompt`)
     - Complete rewrite of `index.html` static shell + Gameplay HUD + Menus + All Core Modals + Console Master Dossier/Inventory/Hotbar + D&D 3.5e & Classic Cartridge Modals
  2. **Track 2 — Campaign Editor Alignment (Milestone 165):**
     - Wire Campaign Editor onto the shared `InputScopeManager` (`EditorScope` + `TextInputGuard` fixing `Ctrl+Z` hijacking and `editor_ui.ts` listener leaks), shared `DialogService` (replacing the 24 editor `alert`/`confirm`/`prompt` calls), and `--ui-*` semantic tokens — without needlessly rewriting working Canvas/Zod editor engines unless you explicitly want a Track 3 Editor rewrite afterward.

### 4.3 Decision 3 — Unified Single-Contract Theme Architecture

Eliminate all 4 disconnected palettes (`--crpg-*`, `--bg-*`, dead `--console-*`, inline hex/Catppuccin) in favor of **one semantic CSS token contract (`--ui-*`)**:

- **Token Layers (`src/styles/`):**
  1. `tokens.css`: Semantic contract (`--ui-bg-canvas`, `--ui-bg-panel`, `--ui-bg-elevated`, `--ui-bg-input`, `--ui-ink-primary`, `--ui-ink-muted`, `--ui-border-subtle`, `--ui-border-strong`, `--ui-accent-primary`, `--ui-accent-secondary`, `--ui-focus-ring`, `--ui-status-danger/warning/success/info`, `--ui-font-display/body/mono`, `--ui-radius-*`, `--ui-space-*`, `--ui-z-*`).
  2. `themes/parchment.css`, `themes/retro-crt.css`, `themes/obsidian-brass.css` (optional 3rd skin preserving the existing Dark Slate & Brass aesthetic!): pure `[data-ui-theme="<id>"]` overrides + `[data-high-contrast="true"]` + `[data-ui-scale="small|normal|large"]` + `[data-reduced-motion="true"]`.
  3. `primitives.css`: Styles for the shared component primitives (`ModalShell`, `Panel`, `Button`, `Tabs`, `ListBox`, `DataGrid`, `Badge`, `Chip`, `Stepper`, `Input`, `Select`, `Tooltip`, `Keycap`, `Dialog`, `Toast`).
  4. `views/*.css`: Minimal layout rules for HUD, Dossier, Builder, Spellbook, Trade, Menus.
- **Single Theme Authority:** `console_theme.ts` resolves `effectiveTheme = settings.consoleTheme === 'auto' ? cartridgeUI.defaultThemeMode : settings.consoleTheme` and sets `document.documentElement.dataset.uiTheme = effectiveTheme`. Individual views (`classic_ui_registration.ts`, etc.) are **forbidden** from overriding the theme directly.

### 4.4 Decision 4 — Full Keyboard Mapping, Input Scoping & Focus Architecture

```
window keydown
  └─► InputScopeManager (priority-ordered active scope stack)
        1. RebindCaptureScope     — captures full KeyChord (incl. modifiers) during Settings rebind
        2. SystemDialogScope      — in-app Alert / Confirm / Prompt dialogs (Esc / Enter / Tab)
        3. TextInputGuard         — if activeElement is <input|textarea|select|[contenteditable]>:
                                    ONLY allows bindings marked `allowInTextInput: true` (e.g. Esc to blur/close,
                                    Ctrl+Enter to submit); ALL printable keys & single-key shortcuts pass natively!
        4. ActiveModalScope       — modal-local bindings + Roving Focus (Arrows/Home/End/Enter/Space)
                                    + Tab/Section cycling (`[`/`]` or `Ctrl+Tab`) + `Esc` pops modal stack
        5. HudFocusScope          — optional keyboard-focused HUD mode (e.g. `F6` cycles HUD zones:
                                    Bottom Hotbar/Stances → Vitals/Chronos → Command Dock → Scanner → Log; `Esc` returns to map)
        6. TargetingInspectScope  — cursor movement (4-way/8-way), `Tab`/`Shift+Tab` cycle visible targets,
                                    `Enter` confirm, `v`/context verb menu, `Esc` cancel
        7. WorldGameplayScope     — movement, wait, interact, pickup, hotbar `1-0/-/=`, bank `Shift+Up/Down`,
                                    cartridge & console modal toggles, `Esc` opens Settings/Pause Menu
        8. EditorScope            — `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` / `Ctrl+S` (guarded by TextInputGuard!)
```

**Core Guarantees of the New Keymap System:**
- **Canonical `CommandRegistry`:** Every core action AND every cartridge-contributed command (`CartridgeUIDefinition.commands`) registers with `{ id, label, category, scope, defaultBindings: KeyChord[], allowInTextInput?, repeatable? }`.
- **Multi-Slot `KeyChord` Bindings:** Each command holds an array of `KeyChord`s (e.g., Primary + Secondary + Numpad) with `{ code?, key?, ctrl?, shift?, alt?, meta? }`. Settings lets the user **add, edit, or clear individual slots** without wiping arrow/WASD fallbacks.
- **Scope-Aware Conflict Detection:** Settings flags collisions only when two commands share a chord in **overlapping scopes** (e.g., `l` for `move_east` vs `ledger` in `WorldGameplayScope` is caught and resolved immediately; `Enter` in `ActiveModalScope` vs `TargetingInspectScope` is cleanly allowed).
- **100% Honest Live Keycap Badges:** Every `<Keycap commandId="..." />` component reads live from `CommandRegistry` + user overrides — eliminating stale/fake tooltips (`Shift+Up`, `Press C`, `ESC` lies become structurally impossible).
- **Live Focus Management & Keyboard Navigation Primitives:**
  - `useFocusTrap(containerRef)` re-queries live focusable nodes on every `Tab`/`Shift+Tab` (never stale after re-render!) and restores focus to `previousActiveElement` on close.
  - `useRovingFocus` (`ArrowUp/Down/Left/Right`, `Home/End`, `Enter/Space`) wired into Menus, Ruleset/Campaign Lists, Paperdoll & Stash Grids, Trade Panes, Character Builder steps/lists, Spellbook, Quickcast, Verb Menu, Dialogue, Quests, Factions, Investigation, and Dossier.
  - Keyboard-triggered Inspect Card (`?` or `Alt+I` or focus-inspect mode) so players can inspect inventory/equipment/spell items without a mouse hover.
  - Reclaim `Tab`: Move "Fold/Unfold All HUD Panels" off bare `Tab` (e.g. to `Shift+Tab` or `F1` or `\`, or keep `Tab` only in `WorldGameplayScope` when focus is on the canvas, never inside modals or `HudFocusScope`).

---

## 5. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers, Producers, Authors, Tests) | Downstream (Consumers, Renderers, Serializers, Schemas) | Lateral (Mirrors, Sibling Data, Docs, SSOT) |
| :--- | :--- | :--- | :--- |
| **1. Add Preact (`preact`) + JSX/TSX build config** *(if Option B approved)* | `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.*`, `knip.json` | All new `.tsx` view components under `src/rendering/ui/`; `presenter.ts` mount/render bridge | `.dependency-cruiser.cjs` (verify `.tsx` & zero cartridge leaks), `scripts/map-codebase.ts` & `scripts/ssot_parity.ts` (scan `.tsx` alongside `.ts`), `docs/ARCHITECTURE.md` |
| **2. Unified Semantic CSS Tokens (`--ui-*`) & Theme Authority** | `src/core/settings.ts` (`consoleTheme`), `src/rendering/ui/console_theme.ts`, `index.html` (fonts & root `<div id="app">`) | All HUD, Menu, Modal, Cartridge UI, and (Track 2) Editor styles; `[data-ui-theme]` / `[data-high-contrast]` / `[data-ui-scale]` | `tests/console_ui_architecture.test.ts` (update/preserve `console_theme.ts` API expectations), `docs/UI_UX_STANDARDS.md` (sync fonts, theme list, filenames), delete dead `--console-*` & `--crpg-*` / `--bg-*` split |
| **3. Scoped `InputScopeManager` + `CommandRegistry` + `KeyChord` Settings** | `src/core/session_controller.ts`, `src/core/input_handler.ts`, `src/core/input/{modal,shortcut,inventory,mouse}_input.ts`, `src/core/settings.ts`, `src/rendering/ui/{classic,dnd35e}_ui_registration.ts`, `src/rendering/editor_ui.ts` | Settings Keybind UI (`settings.ui`), HUD `<Keycap>` badges (`hud_dock.ui`, `console_hotbar.ui`), Rebind modal, `localStorage` settings migration | `public/data/campaigns/*/keybinds.json` (all 4 campaigns: `default`, `shroudgarde`, `dnd35e-crypt`, `realms-of-shroudgarde`), `src/types/campaign/` keybinds schema if any, `tests/` input/keybind unit tests |
| **4. Generic Console Modal Host + Primitive Kit + `DialogService`** | `src/core/modal_manager.ts`, `src/rendering/presenter.ts`, `src/rendering/ui/cartridge_ui_registry.ts`, `src/core/session/{session_dom,session_settings}.ts` | Eliminates static overlays from `index.html`; removes `#dnd35e-sheet-overlay` coupling in `classic_ui_registration.ts`; replaces 35 `alert`/`confirm`/`prompt` calls | `tests/canvas_mount.test.ts` (MUST preserve `#game-canvas-wrapper` DOM contract!), `tests/dirty_domains.test.ts`, `docs/SSOT_CONSOLE.md` |
| **5. Gameplay Views & Cartridge Modals Rewrite (Menus, HUD, Dossier, Trade, D&D 3.5e)** | `src/rendering/presenter.ts`, `src/rulesets/{classic,dnd35e}/ui/*_ui_adapter.ts`, `src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts` (models stay pure!) | Every gameplay screen (`MainMenu`, `HUD`, `Dossier`, `Hotbar`, `Trade`, `Dialogue`, `Quests`, `Factions`, `Investigation`, `Nemesis`, `Ledger`, `Debug`, `VerbMenu`, `CharBuilder`, `LevelUp`, `Sheet`, `Spellbook`, `Quickcast`) | `tests/hud_rest_and_display_name.test.ts`, `tests/dnd35e_phase26_ui_and_showcase.test.ts`, `docs/ssot/ssot_{console,classic,dnd35e}.json` |
| **6. Track 2 Campaign Editor Alignment** | `src/rendering/editor_ui.ts`, `src/rendering/editor/*.ts`, `src/editor/campaign_editor.ts` | Editor undo/redo input guard, listener leak cleanup, `DialogService` migration, `--ui-*` token adoption | `src/styles/editor.css`, `docs/SSOT_CONSOLE.md` |

---

## 6. Preliminary Milestone Breakdown Sketch (Phase 43: Milestones 157–165)

*(Draft for discussion — will be refined into `./docs/implementation_plan.md` and `docs/MILESTONES.md` only after you confirm the research and architectural choices.)*

- **Milestone 157 — UI Architecture Foundation, Semantic Token Engine & Theme Unification:**
  - Set up chosen view runtime (Preact TSX or Vanilla Primitive Kit) + SSOT/linter/depcruise support.
  - Build `--ui-*` semantic token layer + unified themes (`parchment`, `retro-crt`, and optional `obsidian-brass`) + fix `console_theme.ts` single authority & `docs/UI_UX_STANDARDS.md` font/doc sync.
- **Milestone 158 — Scoped Input Engine, Declarative `CommandRegistry` & Full Keymap Architecture:**
  - Implement `InputScopeManager`, `TextInputGuard` (permanently fixing text-input hotkey hijacking), `CommandRegistry`, `KeyChord` multi-slot bindings, scoped conflict detection, cartridge command registration, `localStorage` + `keybinds.json` migration, 8-way diagonal bindings, hotbar bank keys, and `Escape` pause/menu flow.
  - Add headless unit tests for every input scope, text-input guard, conflict check, and cartridge command override.
- **Milestone 159 — Shared UI Primitive Kit, Live Focus Management, `ModalHost` & `DialogService`:**
  - Build reusable keyboard-first primitives (`ModalShell`, `Panel`, `Button`, `Tabs`, `ListBox`, `GridNav`, `Stepper`, `Input`, `Select`, `Chip`, `Badge`, `Tooltip`, `Keycap`, `Toast`), live `FocusTrap` + `RovingFocus`, generic `ConsoleModalHost`, and in-app `DialogService` (replacing all gameplay `alert`/`confirm`/`prompt` + `modal.ui.ts`).
- **Milestone 160 — Menus, Settings Keybind Matrix & Selection Flows Rewrite:**
  - Rewrite `MainMenu`, `RulesetSelect`, `CampaignSelect`, `GameOver`, `LoadingOverlay`, and `Settings` (with searchable multi-slot chord rebinding, conflict warnings, scope tags, and live theme/scale/tileset previews) with 100% keyboard navigation and full theme compliance.
- **Milestone 161 — Tactical HUD, Keyboard HUD-Focus Mode & Context Verb Popover Rewrite:**
  - Rewrite Left Vitals/Chronos/Camera Plate, Right Command Dock / Tactical Scanner / Chronicle Log, Alerts, Bottom Stances/Hotbar Dock (fixing split-brain `activeBank`), and `VerbMenu` (Arrow + `1-9` + `Enter`) onto shared primitives with `HudFocusScope` (`F6`) and zero mouse-only controls.
- **Milestone 162 — Console Master Dossier, Inventory/Paperdoll, Trade & World Modals Rewrite:**
  - Rewrite Tier 1 `ConsoleMasterDossier`, `ReactivePaperDoll`, `CompactStash` (real `<button>` slots + 2D grid arrow nav + keyboard inspect card + >26-item accessibility), `Trade` (dual-pane keyboard nav + social haggle shortcuts), `Dialogue`, `Quests`, `Factions`, `Investigation`, `Nemesis Dossier`, `Ledger`, and `Debug` with zero `.innerHTML` and zero inline color overrides.
- **Milestone 163 — D&D 3.5e & Classic Cartridge Modals Rewrite (Sheet, Spellbook, Quickcast):**
  - Rewrite `dnd35e_sheet`, `dnd35e_spellbook`, `dnd35e_quickcast`, `dnd35e_inspector`, and `classic_ui_registration` using the generic `ConsoleModalHost` (eliminating `#dnd35e-sheet-overlay` coupling) with full keyboard navigation, tab hotkeys, and 100% theme adherence.
- **Milestone 164 — D&D 3.5e Character Creation Wizard & Level-Up Advancement Rewrite:**
  - Rewrite `dnd35e_char_builder` (all steps including Equipment Shop, Review & Identity, and Sprite Picker) and `dnd35e_level_up` using shared primitives, clean text inputs (zero hotkey hijacking), keyboard-navigable lists/steppers/pickers, and strip all obsolete static overlays from `index.html` and legacy CSS files.
- **Milestone 165 — Campaign Editor Input Guard, `DialogService` & Theme Alignment (Track 2):**
  - Integrate Campaign Editor with `InputScopeManager` (`EditorScope` + `TextInputGuard` fixing `Ctrl+Z` hijacking and `editor_ui.ts` listener leaks), replace the 24 remaining editor `alert`/`confirm`/`prompt` calls with `DialogService`, and map `editor.css` onto `--ui-*` semantic tokens.

---

## 7. Open Questions & Assumptions to Confirm Before Step 4 (`implementation_plan.md`)

Per `AGENTS.md` Rules 6 & 7, please confirm or adjust the following decisions before we draft `./docs/implementation_plan.md` and update `docs/MILESTONES.md`:

1. **View Layer Framework Choice:**
   - **Recommendation:** **Option B — Preact (`preact` ~4KB gzipped) + Layered Semantic CSS Tokens (`--ui-*`)** for DOM UI, keeping the ROT.js Canvas renderer 100% pure Vanilla TS.
   - *Alternative:* Option A (Zero-dependency Vanilla TS primitive kit) or Option C (React + Tailwind). Which do you prefer?
2. **Campaign Editor Scope:**
   - **Recommendation:** **Two-Track Phasing** — full component rewrite for all Gameplay UI first (M157–M164), followed by Editor alignment (M165: `InputScopeManager`, `DialogService`, `--ui-*` tokens) without rewriting the working Zod/Canvas editor internals yet.
   - Do you want to keep Editor as an alignment milestone (M165), or include a full Editor UI rewrite as well?
3. **Theme Lineup:**
   - Currently Settings offers `Auto (Cartridge Default)`, `Parchment Tabletop`, and `Retro CRT` — while the unthemed HUD/Menus have a Dark Slate & Brass aesthetic.
   - Should we ship **3 unified themes** (`Parchment Tabletop`, `Retro CRT`, and `Obsidian & Brass` — preserving the dark slate-brass look as a first-class theme), or **strictly 2 themes** (`Parchment Tabletop` and `Retro CRT`) applied uniformly everywhere?
4. **Keybinding Policy Decisions:**
   - **Reclaiming `Tab`:** Currently `Tab` folds all HUD cards during gameplay, which conflicts with standard keyboard focus navigation. Recommendation: use `Tab` for standard focus traversal inside modals/`HudFocusScope` and target cycling in Targeting Mode, and move "Fold/Unfold HUD" to `\` (or `Shift+Tab` / `F1`) — rebindable in Settings. Sound good?
   - **Collision Fixes:** Resolve `l` (`move_east` vs `ledger`) by moving `ledger` default to `Shift+L` (or `J` / `F9`), and bind `Escape` in `UIMode.Game` to open Settings/Pause Menu (matching the existing `ESC` badge). Acceptable?
   - **8-Way Diagonal Movement & Vi-Keys:** Should we add explicit `move_nw`/`move_ne`/`move_sw`/`move_se` actions bound to Numpad `7/9/1/3` by default (leaving `y/u/b/n` free for Factions/LevelUp/Spellbook/Dossier, or offering a selectable "Classic Vi-Keys" preset in Settings)?
   - **Keyboard HUD Access:** Does a dedicated HUD focus toggle (e.g. `F6` to focus & navigate HUD panels/stances/steppers/log with Arrows/`Tab`, `Esc` to return immediately to map control) fit how you want keyboard-only play to feel?

---

## 8. Confirmed Decisions & Browser `F*`-Key Engineering Notes

All four open questions were reviewed and confirmed by the User:

1. **View Runtime:** **Option B — Preact (`preact` ~4KB gzipped) + Layered Semantic CSS Tokens (`--ui-*`)** for all DOM UI, keeping the ROT.js Canvas renderer pure Vanilla TS. Enables lightweight, deterministic component testing in `bun test` (`preact-render-to-string` / `happy-dom`).
2. **Two-Phase Roadmap (Built Together from Day 1):**
   - **Phase 43 (Gameplay UI, Unified Theming & Full Keyboard Mapping):** Rewrites all Gameplay UI, HUD, Menus, Core Modals, and Cartridge Modals.
   - **Phase 44 (Campaign Editor Rewrite):** Rewrites the Campaign Editor onto the exact same Phase 43 Primitive Kit, Semantic Token layer, `InputScopeManager`, and `DialogService`.
   - **Forward-Compatibility Rule:** Phase 43's design tokens and primitives MUST include IDE/workspace patterns (`SplitPane`, `Toolbar`, `Accordion`, `TreeList`, `FormField`, `ContextMenu`, `EditorScope`) from Day 1 so Phase 44 requires zero rework.
3. **3 Unified Themes:** `Parchment Tabletop` (`parchment`), `Retro CRT` (`retro-crt`), and `Obsidian & Brass` (`obsidian-brass`), plus `auto` (Cartridge Default), uniformly styling every Gameplay screen and Campaign Editor surface.
4. **Browser `F*`-Key Policy & Contextual `F1` Help Panel:**
   - **Safe to Intercept via `event.preventDefault()` on `window` `keydown`:** `F1` (Help), `F2`, `F3`, `F4`, `F6` (HUD Focus), `F7`, `F8`, `F9`, `F10` — reliably interceptable in Chrome, Edge, Firefox, and Safari when handled in the `keydown` capture/bubble phase.
   - **Browser-Reserved / Avoid as Primary Defaults:** `F5` (Page Reload), `F11` (Browser Fullscreen), `F12` (DevTools), `Ctrl+W`, `Ctrl+T`, `Ctrl+N`, `Ctrl+Tab`, `Alt+F4` — left untouched so browser ergonomics remain predictable.
   - **Canonical `F1` Help Panel:** Opens a global, contextual Help & Live Keybind Reference overlay across Gameplay, Targeting, Modals, and Editor — displaying context-relevant shortcuts for the active scope/screen, searchable full live keymap, and declarative Cartridge-specific rules guides (`CartridgeUIDefinition.helpSections`). A subtle persistent `F1 Help` badge is shown in the HUD and modal footers.
   - **Confirmed Default Keymap Adjustments:** `\` = Fold/Unfold HUD (reclaiming `Tab` for focus traversal & target cycling); `F6` = Toggle/Cycle HUD Keyboard Focus; `Shift+L` = Historical Ledger; `Escape` in Gameplay = Settings/Pause Menu; `Shift+Up`/`Shift+Down` = Hotbar Bank Prev/Next; Numpad `7/9/1/3` = 8-way diagonals (with selectable Vi-Keys preset in Settings).

