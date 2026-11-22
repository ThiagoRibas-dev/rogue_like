# Implementation Plan — Unified Preact UI Architecture, Semantic Theming & Full Keyboard Mapping (Phases 43 & 44)

*Prepared per `AGENTS.md` Phase 1 (Steps 4–5) based on confirmed research in `docs/research_notes.md` (trunk `b76cca8`).*

> **STATUS: AWAITING USER APPROVAL (`AGENTS.md` Rule 5).** No production code files or `docs/MILESTONES.md` have been modified yet.

---

## 1. Architectural Vision & Core Invariants

This plan replaces the fragmented Vanilla DOM UI (`92` UI files + `7` editor files + `591`-line static `index.html` + `4` disconnected CSS token systems) and unscoped `window` keydown handlers with a single, clean, keyboard-first UI platform:

1. **View Runtime (Option B):** **Preact (`preact` + `preact/hooks`, ~4KB gzipped)** for all DOM UI chrome, fed by a thin reactive bridge (`src/rendering/ui/core/ui_store.ts`) driven by `presenter.ts` and `PresentationDomain` dirty flags. **The ROT.js Canvas renderer (`renderer.ts`, `viewport_snapshot.ts`, `tactical_overlay.ui.ts`, `vfx_overlay.ui.ts`) remains 100% pure Vanilla TS Canvas2D.**
2. **Unified 3-Theme Semantic CSS Architecture (`--ui-*`):** One canonical CSS token contract with three first-class themes — **Parchment Tabletop (`parchment`)**, **Retro CRT (`retro-crt`)**, and **Obsidian & Brass (`obsidian-brass`)** — plus `auto` (Cartridge Default), high-contrast, UI-scale, and reduced-motion modifiers. Zero inline color overrides; zero `.innerHTML`; zero native `alert()`/`confirm()`/`prompt()`.
3. **Full Keyboard Mapping & Scoped Input Architecture:** Priority-ordered `InputScopeManager` with automatic `TextInputGuard` (permanently preventing text-input hotkey hijacking), declarative `CommandRegistry` with multi-slot modifier `KeyChord` bindings, scope-aware conflict detection, cartridge-contributed commands, browser-safe `F*` keys (`F1` Contextual & Cartridge Help Panel, `F6` HUD Keyboard Focus), live `FocusTrap`, and `RovingFocus` across every screen.
4. **Two-Phase Execution Designed as One System:**
   - **Phase 43 (Milestones 157–165):** Foundation + Input/Keymap Engine + Shared Primitive Kit + Complete Gameplay UI Rewrite (including Contextual `F1` Help Panel, `F6` HUD Focus, Menus, Settings, HUD, Master Dossier/Inventory/Trade, World Modals, and D&D 3.5e / Classic Cartridge Modals).
   - **Phase 44 (Milestones 166–169):** Full Campaign Editor Rewrite on the **exact same** Phase 43 Primitive Kit (`SplitPane`, `Toolbar`, `Accordion`, `TreeList`, `FormField`, `ContextMenu`), `--ui-*` tokens, `InputScopeManager` (`EditorScope`), and `DialogService` — engineered from M157–M159 so Phase 44 requires zero foundational rework.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

Every overlapping or split-brain responsibility identified in `docs/research_notes.md` is assigned to a single canonical owner, with legacy implementations explicitly scheduled for eviction:

| Responsibility | Canonical New Owner (Tier) | Legacy "Old Brain" Evicted | Eviction Milestone |
| :--- | :--- | :--- | :--- |
| **Theme Resolution & `--ui-*` Root Attributes** | `src/rendering/ui/core/console_theme.ts` (`tier1_console`) | Dead `--console-*` JS CSS-var injection; `classic_ui_registration.ts:41` unconditional `setConsoleThemeMode('retro-crt')`; `--bg-*` vs `--crpg-*` split | M157 / M164 |
| **Global Keyboard Dispatch & Scope Priority** | `src/core/input/input_scope_manager.ts` (`tier1_console`) | Direct `window.addEventListener('keydown')` in `session_controller.ts:238`, `editor_ui.ts:180`, `modal.ui.ts:154`; unscoped `modal_input.ts` / `shortcut_input.ts` | M158 / M166 |
| **Editable Text-Input Bypass Guard** | `src/core/input/text_input_guard.ts` (`tier1_console`) | Non-existent (root cause of Character Creation / Shop / Settings / Prompt / Editor typing bugs) | M158 |
| **Canonical Command & Multi-Slot `KeyChord` Registry** | `src/core/input/command_registry.ts` + `src/core/settings.ts` (`tier1_console`) | Split `ActionType` vs hardcoded `shortcut_input.ts` keys vs mismatched `dnd35e_sheet`/`classic_sheet` dock command IDs | M158 |
| **Focus Trapping & Roving Keyboard Navigation** | `src/rendering/ui/primitives/focus_hooks.ts` (`tier1_console`) | Stale 50ms-snapshot `trapFocus()` in `src/utils/a11y.ts` & partial 6/16 wiring in `session_controller.ts` | M159 |
| **In-App System Dialogs (`alert` / `confirm` / `prompt`)** | `src/rendering/ui/primitives/dialog_service.ts` + `DialogHost.tsx` (`tier1_console`) | `src/rendering/ui/modal.ui.ts` (Catppuccin inline prompt) + 35 native `alert()`/`confirm()`/`prompt()` calls across `session_dom`, `session_settings`, `editor`, `rendering` | M159 (Gameplay) & M166 (Editor) |
| **Generic Console Modal Host & Overlay Mounting** | `src/rendering/ui/modals/ConsoleModalHost.tsx` (`tier1_console`) | 17 static `<div class="modal-overlay">` blocks in `index.html`; `trade.ui.ts` dynamic `document.body` overlay; Classic borrowing `#dnd35e-sheet-overlay` | M159–M164 |
| **Contextual & Cartridge `F1` Help Overlay** | `src/rendering/ui/modals/HelpModal.tsx` (`tier1_console`) | Scattered stale key hints (`index.html:451` `"Press C"`, `hud_dock.ui.ts:135` fake `"ESC"`, `console_hotbar.ui.ts:189` unimplemented `"Shift+Up"`) | M160 |
| **Hotbar Active Bank State** | `src/rendering/ui/core/ui_store.ts` (`tier1_console`) | Split-brain `activeBank` (`hud_bottom_dock.ui.ts:29`) vs `activeBankIndex` (`console_hotbar.ui.ts:52`) | M161 |
| **HUD Vitals Rendering** | `src/rendering/ui/hud/VitalsCard.tsx` (`tier1_console`) | Duplicate HP bar write in `hud.ui.ts:237–251` (`updateHUD` overwriting `renderPlayerStats`) | M161 |
| **Campaign Editor Workspace Shell & Input/Resize Lifecycle** | `src/rendering/ui/editor/EditorShell.tsx` (`tier1_console`) | `src/rendering/editor_ui.ts` (global `Ctrl+Z` hijack + leaked `document` mousemove/mouseup listeners) | M166 |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / Registry Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Cartridge Hotkeys & Dock Actions** | Hardcoding `if (cmd.id === 'dnd35e_quickcast')` or casting `cmd.id as ActionType` | Cartridges declare `commands: ReadonlyArray<CommandDefinition>` on `CartridgeUIDefinition`; `CommandRegistry` merges them dynamically into Settings, Keycaps, and `InputScopeManager` | **Yes** — any new cartridge (`pf2e`, `gurps`, `brp_d100`) gets full rebinding, conflict checking, and `<Keycap>` badges with zero Console edits |
| **Contextual `F1` Help Content** | Hardcoding D&D 3.5e rules text inside `HelpModal.tsx` | `HelpModal` dynamically reads active `InputScope` commands from `CommandRegistry` + renders declarative `helpSections: ReadonlyArray<UIHelpSection>` supplied by `CartridgeUIDefinition` and active screen descriptors | **Yes** — new cartridges and new modals supply structured `UIHelpSection` data without touching `HelpModal.tsx` |
| **Theme Application Across All Views** | Per-component `if (theme === 'parchment')` or inline `.style.color` | Semantic CSS variables (`--ui-*`) scoped strictly by `[data-ui-theme="<id>"]` stylesheets; single theme resolution in `console_theme.ts` | **Yes** — adding a 4th theme (e.g. `high-fantasy-dark`) requires only a new theme CSS file and registry entry |
| **Text Input Key Bypass** | Whitelisting specific input DOM IDs (`if (el.id === 'char-name')`) | Generic `isEditableEventTarget(event)` in `text_input_guard.ts` checking semantic DOM editability (`<input>` text/search/number/email/url, `<textarea>`, `<select>`, `[contenteditable]`, `[role="textbox|combobox|spinbutton"]`) + `allowInTextInput` command flag | **Yes** — every future form input in gameplay or editor is protected automatically |
| **Keyboard Navigation in Lists, Grids & Tabs** | Writing per-screen `if (key === 'ArrowDown')` boilerplate for every modal | Reusable `useRovingFocus` (`orientation: 'vertical' | 'horizontal' | 'grid'`, `columns`, `loop`) and `Tabs` / `ListBox` / `GridNav` primitives | **Yes** — any new list, grid, or tabbed modal inherits full keyboard navigation declaratively |
| **Modal Lifecycle & Overlay Hosting** | Adding hardcoded `<div id="new-modal">` blocks to `index.html` | `ConsoleModalHost.tsx` renders any registered core or cartridge modal descriptor dynamically via `CartridgeUIDefinition.modals` | **Yes** — cartridges never touch `index.html` or borrow another cartridge's overlay ID |

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers, Producers, Authors, Tests) | Downstream (Consumers, Renderers, Serializers, Schemas) | Lateral (Mirrors, Sibling Data, Docs, SSOT) |
| :--- | :--- | :--- | :--- |
| **1. Preact Runtime & `.tsx` Toolchain (M157)** | `package.json` (`preact`, dev `happy-dom`, `preact-render-to-string`), `tsconfig.json`, `vite.config.ts` | All new `.tsx` components under `src/rendering/ui/`; `presenter.ts` mounts `<AppUiRoot />` | `knip.json`, `scripts/ssot_parity.ts` (scan `.tsx` + cartridge subdir rules), `scripts/map-codebase.ts`, `scripts/check-file-length.ts`, `.dependency-cruiser.cjs`, `docs/ARCHITECTURE.md` |
| **2. Unified `--ui-*` Tokens & 3 Themes (M157)** | `src/core/settings.ts` (`ConsoleThemePreference = 'auto' \| 'parchment' \| 'retro-crt' \| 'obsidian-brass'`), `console_theme.ts`, `index.html` (synced fonts) | All `src/styles/themes/*.css`, `primitives.css`, `views/*.css`, `[data-ui-theme]` / `[data-high-contrast]` / `[data-ui-scale]` / `[data-reduced-motion]` | `tests/console_ui_architecture.test.ts` (preserve `getConsoleThemeMode` / `setConsoleThemeMode` / `subscribeConsoleThemeChange` contract), `docs/UI_UX_STANDARDS.md`, `localStorage` settings schema backward-compat |
| **3. `InputScopeManager`, `CommandRegistry` & `KeyChord` (M158)** | `session_controller.ts`, `input_handler.ts`, `modal_input.ts`, `shortcut_input.ts`, `inventory_input.ts`, `mouse_input.ts`, `settings.ts`, `classic_ui_registration`, `dnd35e_ui_registration` | Settings Keybind Matrix, `<Keycap>` badges across HUD/Modals/Help, `HelpModal` contextual commands, `localStorage` keybind v1→v2 migration | All 4 `public/data/campaigns/*/keybinds.json` (`default`, `shroudgarde`, `dnd35e-crypt`, `realms-of-shroudgarde`) remain backward-compatible via loader adapter; new `tests/input_scope_and_keymap.test.ts` |
| **4. Shared Primitives, Live Focus & `DialogService` (M159)** | `modal_manager.ts`, `ui_store.ts`, `session_dom.ts`, `session_settings.ts`, `cartridge_ui_registry.ts` | `ConsoleModalHost.tsx`, `DialogHost.tsx`, `TooltipHost.tsx`, `ToastHost.tsx`; eliminates `src/utils/a11y.ts` stale trap & `modal.ui.ts` | `tests/canvas_mount.test.ts` (**MUST keep `#game-canvas-wrapper` DOM mount contract untouched**), `tests/dirty_domains.test.ts`, new `tests/ui_primitives_focus.test.tsx` |
| **5. Contextual `F1` Help & Menus/Settings Rewrite (M160)** | `UIMode` (or transient `ui_store` Help overlay so `F1` works cleanly on top of ANY `UIMode`, including MainMenu, Modals, Targeting, and Editor!), `CartridgeUIDefinition.helpSections`, `session_settings.ts` | `HelpModal.tsx`, `MainMenu.tsx`, `RulesetSelectModal.tsx`, `CampaignSelectModal.tsx`, `GameOverModal.tsx`, `SettingsModal.tsx` | `docs/UI_UX_STANDARDS.md`, `docs/ssot/ssot_console.json`, removes static menu/settings overlays from `index.html` |
| **6. HUD, `F6` HUD Focus, VerbMenu & Core Modals (M161–M162)** | `presenter.ts`, `hud_dock`, `hud_bottom_dock`, `console_dossier`, `console_inventory`, `trade.ui`, `dialogue.ui`, `quest.ui`, `factions.ui`, `investigation.ui`, `dossier.ui`, `debug.ui`, `verb_menu.ui` | Replaces all imperative HUD/modal DOM builders; consolidates `activeBank` into `ui_store.ts`; removes duplicate HP write & `.innerHTML` | `tests/hud_rest_and_display_name.test.ts`, `tests/currency_trade_and_campaign.test.ts`, `docs/ssot/ssot_console.json` |
| **7. Cartridge Modals Rewrite & Legacy Eviction (M163–M164)** | `src/rulesets/{classic,dnd35e}/ui/*_ui_adapter.ts` & `dnd35e_quickcast_model.ts` (kept pure!) | Rewrites `Sheet`, `Spellbook`, `Quickcast`, `Inspector`, `CharBuilder`, `LevelUp`, `ClassicSheet`; strips legacy overlays from `index.html` and retires old `hud.css`/`modals.css`/`console_prototype.css` | `tests/dnd35e_phase26_ui_and_showcase.test.ts`, `tests/dnd35e_classes_builder.test.ts`, `docs/ssot/ssot_{console,classic,dnd35e}.json` |
| **8. Phase 44 Campaign Editor Rewrite (M166–M169)** | `src/editor/campaign_editor.ts`, `src/editor/reference_index.ts`, `src/editor/campaign_validator.ts` (pure controller logic preserved!) | Rewrites `EditorShell`, `EditorToolbar`, `EditorSidebar`, `ValidationDock`, `ZodForm`, `AreaPainter`, `WorldGraph`, `DialogueEditor`, `FactionMatrix`, `TriggerComposer`, `SimLab/Fuzzer/BalanceLab` onto Phase 43 Primitives + `EditorScope` + `DialogService` | Retires `src/rendering/editor_ui.ts`, `src/styles/editor.css`, 24 editor `alert`/`confirm`/`prompt` calls, and legacy `knip.json` ignore entries |

---

## 5. Step-by-Step Architecture & Code-Level Specifications (`AGENTS.md` Step 5)

### 5.1 Toolchain, Preact JSX & SSOT Parity Updates (Milestone 157)

1. **`package.json`:**
   - Runtime dependency: `"preact": "^10.25.0"` (~4KB gzipped).
   - Dev dependencies (testing only): `"happy-dom": "^16.0.0"`, `"preact-render-to-string": "^6.5.0"`.
2. **`tsconfig.json`:**
   ```jsonc
   {
     "compilerOptions": {
       // ...existing strict flags preserved untouched...
       "jsx": "react-jsx",
       "jsxImportSource": "preact"
     }
   }
   ```
3. **`vite.config.ts`:**
   ```ts
   export default defineConfig({
     base,
     esbuild: {
       jsx: 'automatic',
       jsxImportSource: 'preact'
     },
     // ...existing resolve, build, server, preview preserved...
   });
   ```
4. **Directory Structure & Cartridge Isolation (`.dependency-cruiser.cjs` + `scripts/ssot_parity.ts`):**
   ```text
   src/rendering/ui/
     core/           # ui_store.ts, console_theme.ts, AppUiRoot.tsx, cartridge_ui_registry.ts
     primitives/     # Button.tsx, ModalShell.tsx, Panel.tsx, SplitPane.tsx, Toolbar.tsx,
                     # Accordion.tsx, TreeList.tsx, Tabs.tsx, ListBox.tsx, GridNav.tsx,
                     # Stepper.tsx, FormField.tsx, Input.tsx, Select.tsx, Chip.tsx, Badge.tsx,
                     # Keycap.tsx, TooltipHost.tsx, DialogHost.tsx, ToastHost.tsx, focus_hooks.ts
     menus/          # MainMenu.tsx, RulesetSelectModal.tsx, CampaignSelectModal.tsx,
                     # GameOverModal.tsx, SettingsModal.tsx, KeybindMatrix.tsx
     hud/            # HudRoot.tsx, VitalsCard.tsx, ChronosStrip.tsx, CommandDockCard.tsx,
                     # TacticalScannerCard.tsx, ChronicleLogCard.tsx, BottomActionDock.tsx,
                     # AlertsStack.tsx, VerbMenuPopover.tsx, HelpReminderChip.tsx
     modals/         # ConsoleModalHost.tsx, HelpModal.tsx, ConsoleDossierView.tsx,
                     # PaperDollWidget.tsx, CompactStashWidget.tsx, TradeModal.tsx,
                     # DialogueModal.tsx, QuestsModal.tsx, FactionsModal.tsx,
                     # InvestigationModal.tsx, NemesisDossierModal.tsx, LedgerModal.tsx, DebugOverlay.tsx
     cartridges/
       classic/      # classic_ui_registration.tsx (tier2_ui -> ssot_classic.json)
       dnd35e/       # dnd35e_ui_registration.tsx, DnD35eSheetModal.tsx, DnD35eSpellbookModal.tsx,
                     # DnD35eQuickcastOverlay.tsx, DnD35eCharBuilderModal.tsx, DnD35eLevelUpModal.tsx
                     # (tier2_ui -> ssot_dnd35e.json)
     editor/         # Phase 44: EditorShell.tsx, EditorToolbar.tsx, EditorSidebar.tsx,
                     # ValidationDock.tsx, ZodFormRenderer.tsx, AreaPainter.tsx, etc.
   ```
   - Update `scripts/ssot_parity.ts`:
     ```ts
     // Scan both .ts and .tsx (excluding .d.ts)
     } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts')) {
     // Partition both legacy prefix and new cartridge folder paths during incremental migration
     export function isDnd35eFile(filePath: string): boolean {
       return (
         filePath.startsWith('src/rulesets/dnd35e/') ||
         filePath.startsWith('src/rendering/ui/dnd35e_') ||
         filePath.startsWith('src/rendering/ui/cartridges/dnd35e/')
       );
     }
     export function isClassicFile(filePath: string): boolean {
       return (
         filePath.startsWith('src/rulesets/classic/') ||
         filePath.startsWith('src/rendering/ui/classic_ui_') ||
         filePath.startsWith('src/rendering/ui/cartridges/classic/')
       );
     }
     ```
   - Update `.dependency-cruiser.cjs` `no-direct-cartridge-imports-outside-registry` and `no-cross-cartridge-ui-imports` regexes identically to include `src/rendering/ui/cartridges/(dnd35e|classic)/`.
   - Update `knip.json` `"project"` to include `"src/**/*.{ts,tsx}"` and `"tests/**/*.{ts,tsx}"`, and `scripts/check-file-length.ts` / `scripts/map-codebase.ts` to include `.tsx`.

---

### 5.2 Unified Semantic CSS Token & 3-Theme Contract (Milestone 157)

Replace the 4 disconnected styling systems with one layered CSS pipeline imported from `src/index.css`:
```css
@import './styles/tokens.css';
@import './styles/themes/parchment.css';
@import './styles/themes/retro-crt.css';
@import './styles/themes/obsidian-brass.css';
@import './styles/a11y.css';
@import './styles/layout.css';
@import './styles/primitives.css';
@import './styles/views/hud.css';
@import './styles/views/menus.css';
@import './styles/views/dossier.css';
@import './styles/views/modals.css';
@import './styles/views/dnd35e.css';
@import './styles/views/editor.css';
```

**Canonical Token Categories (`src/styles/tokens.css`):**
- **Surfaces:** `--ui-bg-canvas`, `--ui-bg-backdrop`, `--ui-bg-panel`, `--ui-bg-panel-alt`, `--ui-bg-elevated`, `--ui-bg-input`, `--ui-bg-hover`, `--ui-bg-selected`, `--ui-bg-toolbar` (Editor-ready!)
- **Ink / Text:** `--ui-ink-primary`, `--ui-ink-secondary`, `--ui-ink-muted`, `--ui-ink-inverse`, `--ui-ink-heading`
- **Borders & Focus:** `--ui-border-subtle`, `--ui-border-strong`, `--ui-border-accent`, `--ui-focus-ring`, `--ui-focus-ring-offset`
- **Accents & Semantic Status:** `--ui-accent-primary`, `--ui-accent-secondary`, `--ui-status-hp`, `--ui-status-xp`, `--ui-status-success`, `--ui-status-warning`, `--ui-status-danger`, `--ui-status-info`
- **Typography, Spacing, Elevation & Density:** `--ui-font-display`, `--ui-font-body`, `--ui-font-mono`, `--ui-radius-sm|md|lg`, `--ui-space-1..6`, `--ui-shadow-panel|popover|modal`, `--ui-z-hud|popover|modal|help|dialog|tooltip`, plus `[data-ui-density="compact"]` for dense Campaign Editor tables/forms.

**Single Theme Authority (`src/rendering/ui/core/console_theme.ts`):**
```ts
export type ConsoleThemeMode = 'parchment' | 'retro-crt' | 'obsidian-brass';
export type ConsoleThemePreference = 'auto' | ConsoleThemeMode;

export function resolveEffectiveConsoleTheme(
  preference: ConsoleThemePreference,
  cartridgeDefault: ConsoleThemeMode
): ConsoleThemeMode {
  return preference === 'auto' ? cartridgeDefault : preference;
}
```
- Sets `document.documentElement.dataset.uiTheme = mode` (and mirrors `dataset.consoleTheme = mode` during migration until old CSS is retired in M164).
- Removes dead `--console-*` inline property injection (keeping `getConsoleThemeTokens()` returning a typed metadata summary so `tests/console_ui_architecture.test.ts` remains cleanly supported or updated explicitly).

---

### 5.3 Scoped Input Engine, `CommandRegistry` & Browser-Safe `F*` Key Policy (Milestone 158)

#### A. `KeyChord` & `CommandDefinition` (`src/types/input.types.ts`)
```ts
export type InputScopeId =
  | 'rebind_capture'
  | 'system_dialog'
  | 'help_overlay'
  | 'active_modal'
  | 'hud_focus'
  | 'targeting_inspect'
  | 'world_gameplay'
  | 'editor';

export type CommandCategory =
  | 'movement'
  | 'combat_actions'
  | 'hotbar'
  | 'panels'
  | 'cartridge'
  | 'hud_camera'
  | 'navigation'
  | 'system'
  | 'editor';

export interface KeyChord {
  /** Physical KeyboardEvent.code (preferred for digits/F-keys/arrows/Space/Escape). */
  readonly code?: string;
  /** Layout-aware lowercase KeyboardEvent.key (used for letter mnemonics like 'i', 'c', '?', '/'). */
  readonly key?: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
}

export interface CommandDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly category: CommandCategory;
  readonly scopes: ReadonlyArray<InputScopeId>;
  readonly defaultBindings: ReadonlyArray<KeyChord>;
  /** When true, fires even if focus is inside an editable input (strictly limited to Escape, F1, Ctrl+Enter, Ctrl+S). */
  readonly allowInTextInput?: boolean;
  /** When true, calls event.preventDefault() proactively (crucial for F1, F6, Tab, Arrows, Space). */
  readonly preventDefault?: boolean;
  readonly source: 'console' | 'editor' | `cartridge:${string}`;
}
```

#### B. Automatic `TextInputGuard` (`src/core/input/text_input_guard.ts`)
```ts
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image']);

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const inputType = (target as HTMLInputElement).type.toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox' || role === 'spinbutton';
}
```
- **Invariant:** Whenever `isEditableEventTarget(event.target)` (or `document.activeElement`) is `true`:
  - `InputScopeManager` skips **every** binding where `allowInTextInput !== true`.
  - Typing `c`, `i`, `t`, `b`, `z`, `q`, `y`, `v`, `n`, `l`, `a–z`, digits, or `Space` in Character Creation Name/Title/Trait, Shop Search, Sprite Search, Settings Number inputs, Prompt Dialogs, or Editor forms **100% reaches the text input and NEVER triggers gameplay or modal shortcuts**.
  - Pressing `Escape` blurs the text input first (or closes dialog on second press); `F1` still opens Contextual Help; `Ctrl+S` still saves in Editor; native `Ctrl+Z` inside an editor text input performs native text undo (while `Ctrl+Z` outside a text input performs campaign JSON-Patch undo!).

#### C. Priority `InputScopeManager` Dispatch (`src/core/input/input_scope_manager.ts`)
- Single `window.addEventListener('keydown', handleGlobalKeyDown)` owned by `InputScopeManager` (replaces all 4 scattered listeners!).
- Active scope stack is computed deterministically from `(uiStoreState, gameState.uiMode, targeting/inspect flags)`:
  1. `rebind_capture` — captures next non-modifier keydown as a `KeyChord` (`Escape` cancels, `Backspace`/`Delete` clears slot).
  2. `system_dialog` — in-app `Alert` / `Confirm` / `Prompt` (`Escape` cancels, `Enter` confirms when valid).
  3. `help_overlay` — `F1` or `Escape` closes Help; `/` focuses search input; `Arrow`/`Tab` navigates sections.
  4. `active_modal` — modal-local handlers + `Escape` pops `modal_manager` LIFO stack + `F1` opens contextual help.
  5. `hud_focus` — `F6` cycles HUD landmarks (`BottomDock → Vitals/Chronos → CommandDock → Scanner → ChronicleLog`), `Arrows`/`Tab`/`Enter`/`Space` operate every stance, stepper, button, and tab; `Escape` exits HUD focus immediately back to map.
  6. `targeting_inspect` — 4-way/8-way cursor movement, `Tab`/`Shift+Tab` cycles visible targets, `Enter` confirms, `v` opens verb menu on cursor tile, `Escape` cancels.
  7. `world_gameplay` — 8-way movement, wait, interact, pickup, hotbar `1–0/-/=`, hotbar bank `Shift+Up`/`Shift+Down`, `\` fold/unfold HUD, `F6` HUD focus, `F1` Help, `Escape` Settings/Pause, plus all Console & Cartridge modal toggles.
  8. `editor` — `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y` (when not in text input), `Ctrl+S` save, `F1` Editor Help, `F2` Playtest, `Escape` clear selection/tool.

#### D. Browser `F*`-Key & Default Collision Resolution Policy
| Key / Chord | Command ID | Scope(s) | Browser Safety Note |
| :--- | :--- | :--- | :--- |
| `F1` | `system.toggle_help` | Global (`allowInTextInput: true`) | Intercepted via `event.preventDefault()` on `keydown`; suppresses browser help tab |
| `F6` | `hud.cycle_focus` | `world_gameplay`, `hud_focus` | Intercepted via `event.preventDefault()`; suppresses browser address-bar focus jump |
| `\` (`Backslash`) | `hud.toggle_fold_all` | `world_gameplay` | Replaces `Tab` so `Tab` stays standard for focus traversal & target cycling |
| `Escape` | `system.escape_or_pause` | Global (context-dependent) | Closes Help/Dialog/Modal/HUD-Focus/Targeting, or opens Settings/Pause in `world_gameplay` |
| `Shift+L` | `panel.ledger` | `world_gameplay`, `active_modal` | Resolves `l` collision with `move_east` |
| `Shift+ArrowUp` / `Shift+ArrowDown` | `hotbar.bank_prev` / `hotbar.bank_next` | `world_gameplay` | Implements previously unimplemented hotbar bank switching |
| `Numpad7/9/1/3` | `move.nw/ne/sw/se` | `world_gameplay`, `targeting_inspect` | 8-way diagonals (with optional "Classic Vi-Keys" preset in Settings) |
| `Ctrl+S` / `F2` | `editor.save` / `editor.playtest` | `editor` (`Ctrl+S` `allowInTextInput: true`) | Prevents browser Save Page dialog; Editor-ready from Day 1 |
| `F5`, `F11`, `F12`, `Ctrl+W/T/N/Tab` | *Explicitly Unbound* | Never default-bound | Preserves browser reload, fullscreen, DevTools, and tab management |

- **Backwards Compatibility:** Existing `localStorage` `PlayerSettings.keybinds` (v1 flat `Record<ActionType, string[]>`) and `public/data/campaigns/*/keybinds.json` are automatically normalized into v2 `Record<CommandId, KeyChord[]>` on load so zero user settings or campaign JSONs break.

---

### 5.4 Preact UI Bridge (`ui_store.ts`), Editor-Ready Primitives & Contextual `F1` Help (Milestones 159–160)

#### A. Thin Bridge Store (`src/rendering/ui/core/ui_store.ts`)
- Holds immutable UI slice refs (`gameState`, `hasSave`, `activeBank`, `helpOpen`, `hudFocusZone`, `activeDialog`, `activeTooltip`, `toasts`, `settingsVersion`) + subscriber set (`useUiSelector` hook).
- `presenter.ts` pushes updates to `ui_store` **only for dirty `PresentationDomain`s** — preserving all M141 dirty-domain performance gains so off-screen NPC turns trigger zero Preact re-renders!
- Mounts `<AppUiRoot />` into `#ui-root` as a sibling of `#game-canvas-wrapper` inside `index.html`, keeping `tests/canvas_mount.test.ts` 100% intact.

#### B. Shared Primitive Kit (`src/rendering/ui/primitives/` — Gameplay + Phase 44 Editor-Ready)
- **Layout & Chrome:** `ModalShell` (backdrop, header, close `[Esc]`, footer with `F1 Help` chip, live `useFocusTrap`), `Panel`, `SplitPane` *(resizable split for Character Builder, Trade, AND Phase 44 Editor Sidebar/Workspace)*, `Toolbar` *(Chronos strip, Shop bar, AND Editor Toolbar)*, `Accordion` *(Quickcast classes, Investigation, AND Editor Zod nested objects)*.
- **Navigation & Data:** `Tabs` (Arrow Left/Right + `[`/`]` modal shortcut support), `ListBox` (`useRovingFocus` vertical list for Menus, Ruleset/Campaign, Trade, Quests, Factions, AND Editor Sidebar), `GridNav` (2D arrow nav for Paperdoll, 5-col Stash, Sprite Picker, Quickcast tiles, AND Editor Tile Palette), `TreeList` *(Nemesis hierarchies AND Editor Dialogue Tree)*.
- **Controls & Forms:** `Button`, `IconButton`, `Stepper` (`[-][val][+]` with `ArrowLeft/Right` & `+/-` support for Power Attack, Point Buy, AND Editor numbers), `FormField`, `TextInput`, `NumberInput`, `Select`, `Checkbox`, `Chip`, `Badge`, `StatChip`, `Keycap` *(live `<kbd>` bound directly to `CommandRegistry`!)*.
- **Global Services:** `DialogHost` + `dialogService.alert/confirm/prompt` (async Promise API replacing all 35 native calls), `TooltipHost` (supports both pointer hover AND keyboard-triggered inspect via `?` / `Alt+I`), `ToastHost` (non-blocking notifications for saves, exports, errors).

#### C. Contextual & Cartridge-Aware `F1` Help Panel (`HelpModal.tsx`)
```ts
export interface UIHelpEntry {
  readonly title: string;
  readonly summary: string;
  readonly commandIds?: ReadonlyArray<string>;
}

export interface UIHelpSection {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  /** Optional scopes where this section is promoted to the "Current Context" tab. */
  readonly contextScopes?: ReadonlyArray<InputScopeId>;
  readonly entries: ReadonlyArray<UIHelpEntry>;
}
```
- **3 Clean Tabs inside `HelpModal` (`F1`):**
  1. **This Screen (Contextual):** Automatically lists controls & tips for the exact active `InputScope` + `UIMode` (e.g. World Exploration, Targeting, Inventory/Paperdoll, Trade, Character Builder, or Campaign Editor).
  2. **All Keybinds (Live Searchable):** Displays every registered Console + active Cartridge command grouped by category with live user-rebound `<Keycap>`s and a "Customize in Settings" button.
  3. **Ruleset Guide (Cartridge-Driven):** Renders declarative `helpSections` from `CartridgeUIDefinition` (e.g. D&D 3.5e Action Economy, Stances, Vancian vs Spontaneous Casting, Charge/Grapple/Stealth; Classic Ruleset basics) — zero hardcoded ruleset text in Console!
- **Persistent `F1 Help` Reminder:** Subtle clickable `<HelpReminderChip />` (`[F1] Help`) anchored in the bottom-right HUD corner during gameplay and in `ModalShell` footers.

---

## 6. Proposed Milestone Breakdown for `docs/MILESTONES.md` (Phases 43 & 44)

### 🚀 Phase 43: Unified Preact UI Architecture, Semantic Theming, Full Keyboard Mapping & Gameplay UI Rewrite

*Rebuilds the entire Gameplay UI and Input layer onto Preact (~4KB), a unified 3-theme Semantic CSS Token contract (`parchment`, `retro-crt`, `obsidian-brass`), a scoped `InputScopeManager` + `CommandRegistry` with automatic text-input protection, a contextual `F1` Help Panel, and Editor-ready shared primitives.*

- **Milestone 157: UI Runtime Foundation, `.tsx` SSOT Parity & 3-Theme Semantic Token Engine**
  - Add `preact` (and test devDeps `happy-dom`, `preact-render-to-string`), enable automatic JSX in `tsconfig.json` and `vite.config.ts`, mount `<AppUiRoot />` cleanly beside `#game-canvas-wrapper`, and upgrade `scripts/ssot_parity.ts`, `scripts/map-codebase.ts`, `scripts/check-file-length.ts`, `knip.json`, and `.dependency-cruiser.cjs` for `.tsx` and `src/rendering/ui/cartridges/{classic,dnd35e}/`.
  - Author `src/styles/tokens.css` (`--ui-*` semantic + Editor-density tokens), `themes/{parchment,retro-crt,obsidian-brass}.css`, and `a11y.css` (UI scale, high contrast, reduced motion).
  - Unify `console_theme.ts` as single theme authority (`auto | parchment | retro-crt | obsidian-brass`), sync `index.html` fonts and `docs/UI_UX_STANDARDS.md`, and remove unconditional theme overwrites.
- **Milestone 158: Scoped `InputScopeManager`, `TextInputGuard`, Declarative `CommandRegistry` & Full Keymap Engine**
  - Implement `InputScopeManager` (8-tier priority stack), `TextInputGuard` (`isEditableEventTarget`), `CommandRegistry` (Console + Cartridge + Editor commands, multi-slot `KeyChord`s with modifiers, scoped conflict detection, `event.code`/`event.key` normalization, browser-safe `F*`-key `preventDefault()` policy).
  - Fix all default collisions (`Shift+L` Ledger, `\` Fold HUD reclaiming `Tab`, `Escape` Pause/Settings, `Shift+Up/Down` Hotbar Banks, `F1` Help, `F6` HUD Focus, Numpad `7/9/1/3` 8-way diagonals, selectable `Default Modern` / `Classic Vi-Keys` presets) and migrate v1 `localStorage` & `keybinds.json` losslessly.
  - Add comprehensive headless test suite (`tests/input_scope_and_keymap.test.ts`) verifying zero text-input hijacking, modifier chords, scope precedence, conflict detection, and cartridge rebinding.
- **Milestone 159: Editor-Ready Shared Primitive Kit, Live Focus Hooks, `ConsoleModalHost` & `DialogService`**
  - Build `src/rendering/ui/core/ui_store.ts` (`PresentationDomain`-gated Preact bridge) and full shared primitive kit (`ModalShell`, `Panel`, `SplitPane`, `Toolbar`, `Accordion`, `Tabs`, `ListBox`, `GridNav`, `TreeList`, `Button`, `IconButton`, `Stepper`, `FormField`, `TextInput`, `NumberInput`, `Select`, `Checkbox`, `Chip`, `Badge`, `StatChip`, `Keycap`, `TooltipHost`, `ToastHost`).
  - Build live `useFocusTrap` (dynamic DOM query + focus restoration) and `useRovingFocus` hooks, replacing stale `src/utils/a11y.ts`.
  - Build `ConsoleModalHost.tsx` and async in-app `DialogService` + `DialogHost.tsx`, replacing `modal.ui.ts` and all gameplay `alert()`/`confirm()`/`prompt()` calls (`session_dom.ts`, `session_settings.ts`).
  - Add Preact + `happy-dom` component tests (`tests/ui_primitives_focus.test.tsx`).
- **Milestone 160: Contextual `F1` Help Panel, Menus, Selection Flows & Full Keybind Matrix Settings Rewrite**
  - Build `HelpModal.tsx` (`F1` global contextual help, live searchable keymap, declarative `CartridgeUIDefinition.helpSections`) and persistent clickable `HelpReminderChip` (`[F1] Help`).
  - Rewrite `MainMenu`, `RulesetSelectModal`, `CampaignSelectModal`, `GameOverModal`, `LoadingOverlay`, and `SettingsModal` (including multi-slot `KeyChord` capture modal, conflict badges, scope filters, keybind presets, live 3-theme / UI scale / tileset / auto-pause controls, and Credits & Attributions) with 100% keyboard navigation.
- **Milestone 161: Tactical Floating HUD, `F6` Keyboard HUD Focus Mode & Context Verb Popover Rewrite**
  - Rewrite `HudRoot`, `VitalsCard` (eliminating duplicate HP bar write), `ChronosStrip` (TB/RTwP, speed, camera rotate/3D/zoom), `CommandDockCard` (live `<Keycap>`s, 2D/ASCII toggle), `TacticalScannerCard`, `ChronicleLogCard` (keyboard-accessible filter tabs & scroll), `AlertsStack`, `BottomActionDock` (single `ui_store` `activeBank`, keyboard-operable stances & steppers, `Shift+Up/Down` bank switching, action pips, End Turn), and `VerbMenuPopover` (Arrow + `1–9` + `Enter` + `Esc`).
  - Wire `HudFocusScope` (`F6` region cycling, `Esc` instant map return) so every HUD control is 100% keyboard-operable.
- **Milestone 162: Console Master Dossier, Paperdoll/Stash, Trade & World Modals Rewrite**
  - Rewrite `ConsoleDossierView`, `PaperDollWidget`, and `CompactStashWidget` with semantic `<button>` slots, 2D `GridNav` arrow navigation, keyboard-triggered Item Inspect Card (`?`/`Alt+I`), Weapon Set switching, category/sort controls, and full keyboard access to items `#27+` (zero `.innerHTML`).
  - Rewrite `TradeModal` (dual-pane keyboard navigation, Buy/Sell via `Enter`, social haggle shortcuts, full theme compliance), `DialogueModal` (Arrow + `1–9` + `Enter`), `QuestsModal`, `FactionsModal`, `InvestigationModal` (keyboard filter chips + suspect/clue lists), `NemesisDossierModal`, `LedgerModal`, and `DebugOverlay`.
- **Milestone 163: D&D 3.5e & Classic Cartridge Modals Rewrite (Sheet, Spellbook, Quickcast, Inspector)**
  - Rewrite `src/rendering/ui/cartridges/classic/classic_ui_registration.tsx` (removing `#dnd35e-sheet-overlay` coupling & forced theme override, adding Classic `helpSections`).
  - Rewrite `src/rendering/ui/cartridges/dnd35e/` views (`DnD35eSheetModal`, `DnD35eSpellbookModal`, `DnD35eQuickcastOverlay`, `DnD35eInspector`, `dnd35e_ui_registration.tsx`) onto `ConsoleModalHost` and shared primitives, registering canonical Cartridge commands (`dnd35e:sheet`, `dnd35e:inventory`, `dnd35e:quickcast`, `dnd35e:spellbook`, `dnd35e:rest_8h`, `dnd35e:level_up`) and declarative D&D 3.5e `helpSections` with 100% keyboard operation.
- **Milestone 164: D&D 3.5e Character Creation Wizard & Level-Up Advancement Rewrite**
  - Rewrite `DnD35eCharBuilderModal` (all steps: Race/Abilities point-buy steppers, Class/Domains/ACFs, Skills, Feats, Spells, Equipment Preset & Custom Gear Shop with search, Review & Identity with Name/Title/Traits/Glyph Color/Sprite Picker) and `DnD35eLevelUpModal` using shared primitives, `TextInputGuard`-protected inputs, and full keyboard navigation.
- **Milestone 165: Legacy Gameplay DOM/CSS Eviction, `index.html` Slimdown & Phase 43 Verification Sweep**
  - Strip all retired static overlays from `index.html` (reducing `index.html` to clean `#app` + `#game-canvas-wrapper` + `#ui-root` + `#editor-layout`), delete superseded legacy UI `.ts` files and legacy stylesheets (`core.css`, `hud.css`, `modals.css`, `console_prototype.css`), audit zero remaining gameplay `.innerHTML` / inline color hacks / native dialogs, sync `docs/UI_UX_STANDARDS.md`, `docs/ARCHITECTURE.md`, and 3-way SSOT registries, and pass full 8-stage `./verify.sh`.

---

### 🚀 Phase 44: Campaign Editor Rewrite on Shared Preact Primitives, Scoped Input & Unified Themes

*Migrates the entire Campaign Creator (`~26` editor UI modules) onto Phase 43's Preact Primitive Kit, `--ui-*` semantic theme tokens (`compact` density), `InputScopeManager` (`EditorScope`), and `DialogService` while preserving the pure `src/editor/` controller, JSON-Patch undo/redo stack, reference index, and validator.*

- **Milestone 166: Campaign Editor Shell, `EditorScope` Input, `DialogService` Migration & Validation Dock**
  - Rewrite `EditorShell`, `EditorToolbar`, `EditorActivityBar`, `EditorSidebar` (searchable `ListBox` + drag-and-drop), `EditorSplash`, `NewCampaignModal`, and `ValidationDock` onto Phase 43's `SplitPane`, `Toolbar`, `ModalShell`, and `--ui-*` tokens.
  - Wire `EditorScope` (`Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y` guarded by `TextInputGuard`, `Ctrl+S` save, `F2` playtest, `F1` Editor Help), eliminate `editor_ui.ts`'s leaked `document` mouse listeners, and replace all remaining 24 editor `alert()`/`confirm()`/`prompt()` calls with `DialogService` + `ToastHost`.
- **Milestone 167: Declarative Preact Zod Form Engine, Reference Pickers & Where-Used Inspector**
  - Rewrite `ZodFormRenderer`, `ZodFormContainers`, `ZodFormPrimitives`, `EditorForms`, `EditorObjectRenderer`, and `WhereUsedDrawer` onto Preact primitives (`Accordion`, `FormField`, `TextInput`, `NumberInput`, `Select`, `Checkbox`, drag-and-drop array items) with automatic focus/accordion preservation (no manual re-render cursor hacks) and inline validation paths.
- **Milestone 168: Visual & Graph Editor Workspaces (Area Painter, World Graph, Dialogue Tree, Faction Matrix, Trigger Composer)**
  - Rewrite `AreaEditor` & `AreaStaticPainter` (wrapping the Canvas2D painter cleanly inside Preact `SplitPane`/`Toolbar`/`GridNav` palette), `WorldGraph`, `DialogueEditor` + `DialogueSimulatorPanel` (`TreeList`), `FactionMatrixEditor`, and `TriggerComposer` onto shared primitives and `--ui-*` theme tokens.
- **Milestone 169: Simulation Tooling Rewrite (AI Arena, Director Sandbox, Knowledge Sim, Narrative Fuzzer, Balance Lab) & Legacy Editor Eviction**
  - Rewrite `AiArena`, `DirectorSandbox`, `KnowledgeSimulator`, `NarrativeFuzzer`, and `BalanceLab` onto Preact primitives, retire `src/rendering/editor_ui.ts`, `src/styles/editor.css`, and legacy `knip.json` ignores, sync `docs/SSOT_CONSOLE.md` and `docs/ARCHITECTURE.md`, and pass full 8-stage `./verify.sh`.

---

## 7. Verification & Testing Strategy

Every milestone in Phases 43 & 44 must pass:
1. **New Automated Test Suites (`bun test`):**
   - `tests/input_scope_and_keymap.test.ts`: Scope stack precedence, `TextInputGuard` (proving typing in `<input>`/`<textarea>`/`<select>` never triggers shortcuts), modifier `KeyChord` matching, browser `F1`/`F6` `preventDefault()`, scoped conflict detection, cartridge command registration & rebinding, v1→v2 settings/campaign `keybinds.json` migration.
   - `tests/ui_primitives_focus.test.tsx`: `happy-dom` + Preact tests verifying live `useFocusTrap` survives re-renders & restores focus, `useRovingFocus` vertical/horizontal/2D grid navigation, `DialogService` async resolve/cancel, `<Keycap>` live binding updates, and `HelpModal` contextual filtering + Cartridge `helpSections`.
   - Regression preservation: All existing 371+ tests (`canvas_mount.test.ts`, `console_ui_architecture.test.ts`, `dirty_domains.test.ts`, `dnd35e_phase26_ui_and_showcase.test.ts`, `hud_rest_and_display_name.test.ts`, `ssot_registry_parity.test.ts`, etc.).
2. **Full 8-Stage `./verify.sh` Pipeline:** `tsc --noEmit`, `format`, `lint`, `depcruise` (`lint:arch`), `lint:filelength`, `knip` (`lint:deadcode`), `bun test`, `vite build`, and `scripts/run-validator.ts` (campaigns, rulesets, sprite packs, 3-way SSOT parity).
