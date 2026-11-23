# Console Engine & Ruleset Cartridge UI/UX Standards

This document serves as the canonical Source of Truth (SSOT) for UI and UX architecture, spatial design rules, visual themes, and component contracts across the **Core Console Engine** and all **Ruleset Cartridges**.

---

## 1. Architectural Tiering & Responsibilities

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           CORE CONSOLE ENGINE (Tier 1)                             │
│  src/styles/ (tokens.css, themes/{parchment,retro-crt,obsidian-brass}.css, a11y)  │
│  src/rendering/ui/                                                                │
│  ├── core/       (AppUiRoot.tsx, console_theme.ts, ui_store.ts)                   │
│  ├── primitives/ (ModalShell, SplitPane, Toolbar, ListBox, GridNav, Keycap, ...)  │
│  ├── hud/        (HudRoot, VitalsCard, ChronosStrip, BottomActionDock, ...)       │
│  ├── menus/      (MainMenu, RulesetSelectModal, CampaignSelectModal, HelpModal)   │
│  ├── modals/     (ConsoleModalHost, ConsoleDossierView, Trade, Dialogue, ...)     │
│  └── cartridge_ui_registry.ts (CartridgeUIDefinition & slot/command/help registry)│
└───────────────────────────────┬───────────────────────────────────────────────────┘
                                │ Implements & Binds
                                ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        RULESET CARTRIDGE ADAPTERS (Tier 2)                         │
│                                                                                   │
│ ┌─────────────────────────────────────────┐ ┌───────────────────────────────────┐ │
│ │        D&D 3.5e Cartridge Adapter       │ │    Classic Cartridge Adapter      │ │
│ │ src/rendering/ui/cartridges/dnd35e/     │ │ src/rendering/ui/cartridges/      │ │
│ │ └── dnd35e_ui_registration.ts(x), ...   │ │ classic/classic_ui_registration   │ │
│ └─────────────────────────────────────────┘ └───────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
```

*The ROT.js Canvas2D world renderer (`src/rendering/renderer.ts`, `viewport_snapshot.ts`, `tactical_overlay.ui.ts`, `vfx_overlay.ui.ts`) remains 100% pure Vanilla TS mounted inside `#game-canvas-wrapper`. Preact mounts into sibling `#ui-root`.*

---

## 2. Core UI/UX Design Constitution

### Spatial Math & Viewport Rules
- **Desktop Baseline (1440px)**: All primary modals (Character Sheet, Inventory, Character Creation) are designed for a desktop container baseline of `900px–1200px` width.
- **Density Scopes**: Gameplay defaults to balanced spatial comfort; Campaign Editor views opt into `[data-ui-density="compact"]` on a shared primitive layer without altering component contracts.
- **Padding Math**: Outer container padding MUST be strictly greater than or equal to inner child padding (`Padding_outer >= Gap_inner`). Minimum container padding is `16px` (`p-4`) in Gameplay and `8px` (`p-2`) in Compact Editor density.
- **Control Padding**: Buttons and hotbar slots use balanced horizontal-to-vertical ratios or 1:1 square aspect ratio for hotbar action slots.

### Typography & Numeric Precision
- **Tabular Numerals**: Every numeric stat display, attack bonus line, modifier, saving throw, weight calculation, and gold total MUST use `font-variant-numeric: tabular-nums` (`.ui-tabular`) for crisp vertical alignment across columns.
- **Explicit Signs**: All relative modifiers must include explicit positive or negative signs (`+5`, `-2`, `+0`).
- **Synchronized Font Pairings** (loaded in `index.html` and exposed via `--ui-font-display`, `--ui-font-body`, `--ui-font-mono`):
  - **`parchment` Skin**: Display face `'Cinzel', Georgia, serif`, body `'Plus Jakarta Sans', Georgia, serif`, data `'JetBrains Mono', monospace`.
  - **`retro-crt` Skin**: Display face `'JetBrains Mono', monospace`, body `'JetBrains Mono', monospace`, data `'JetBrains Mono', monospace`.
  - **`obsidian-brass` Skin**: Display face `'Cinzel', Georgia, serif`, body `'Plus Jakarta Sans', system-ui, sans-serif`, data `'JetBrains Mono', monospace`.

### Anti-Slop Discipline
- **Zero Pill Capsules for Static Metadata**: Static metadata (dates, tags, categories, alignments) MUST be rendered as unboxed text with subtle separators (`·`, `/`). Pills/chips are reserved exclusively for interactive toggles and segmented filters.
- **No Roleplay Button Jargon**: Action button labels must use clear, standard human verbs (`Save`, `Cancel`, `Equip`, `Unprepare`, `Rest`, `Inspect`).

---

## 3. Unified Semantic Token Engine (`--ui-*` & `console_theme.ts`)

Every UI component consumes semantic CSS variables (`--ui-bg-canvas`, `--ui-bg-surface`, `--ui-bg-elevated`, `--ui-bg-inset`, `--ui-text-primary`, `--ui-text-secondary`, `--ui-text-muted`, `--ui-border-subtle`, `--ui-border-strong`, `--ui-border-accent`, `--ui-accent-primary`, `--ui-accent-secondary`, `--ui-status-ok/warn/danger/info`, `--ui-focus-ring`, `--ui-z-*`). Settings resolve `'auto' | 'parchment' | 'retro-crt' | 'obsidian-brass'` via `resolveEffectiveConsoleTheme()` onto `document.documentElement.dataset.uiTheme`.

### Theme 1: `parchment` (Tabletop Fantasy)
- **Visual Style**: Warm vellum surfaces, bronze leather borders, gilded highlights, dark ink typography.
- **Colors**: Canvas `#1a1410`, Surface `#e8dfd1`, Structural Border `#5c4730`, Accent `#8c241c` / `#9a6c1e`, Ink `#261d14`.

### Theme 2: `retro-crt` (Sci-Fi Cyberpunk)
- **Visual Style**: Deep void obsidian terminal surfaces, crisp phosphor cyan framing, glowing tabular diagnostics.
- **Colors**: Canvas `#0a0f12`, Surface `#0a171f`, Structural Border `#26b899` / `#00f0ff`, Accent `#00d4e6` / `#2ecc71`, Ink `#93e8ff`.

### Theme 3: `obsidian-brass` (Dark Slate & Burnished Gold — Starting Page, Menu & Editor Default)
- **Visual Style**: Classic dark-fantasy cRPG slate stone, brushed steel borders, burnished gold trim & beveled bronze accents, crisp warm ivory text.
- **Colors**: Canvas `#050507`, Surface `#141720`, Structural Border `#484f5e` / `#9e782f`, Accent `#e6b84c` / `#45b35a`, Ink `#e4e6ed`.

---

## 4. Component Contracts & Standards (Preact Primitive Kit)

All gameplay UI views mount inside `#ui-root` (`<AppUiRoot />`) using shared semantic Preact primitives in `src/rendering/ui/primitives/` (`Button`, `IconButton`, `Keycap`, `ModalShell`, `Panel`, `SplitPane`, `Toolbar`, `Tabs`, `Accordion`, `ListBox`, `GridNav`, `TreeList`, `FormField`, `TextInput`, `NumberInput`, `Select`, `Checkbox`, `Stepper`, `Badge`, `Chip`, `StatBar`, `StatPair`, `EmptyState`, `DialogHost`, `ToastHost`, `TooltipHost`). Zero `.innerHTML`, zero native `alert()`/`confirm()`/`prompt()`, and zero hardcoded theme overrides are permitted in gameplay UI.

### A. 3-Column Master Dossier Modal Contract (`ConsoleDossierView.tsx`)
- **Container**: `ModalShell` (`size="xl"`) hosted inside `ConsoleModalHost.tsx`, consuming `--ui-*` tokens seamlessly across `parchment`, `retro-crt`, and `obsidian-brass`.
- **Left Column**: Hero Identity Badge (Portrait, Level, Class, HD, HP bar), Core Attributes Ledger with tabular modifiers, and Saving Throws strip.
- **Center Column**: Tabbed Viewports (`Tabs` primitive):
  - **Overview / Combat**: Combat attack routine, Armor Class triplet, maneuvers, active effects.
  - **Equipment & Stash**: Anatomical `PaperDollWidget.tsx` (12+ slots, multi-limb, Wild Shape suppressed slots, Weapon Sets `I–IV`) + `CompactStashWidget.tsx` (`GridNav` 2D keyboard arrow navigation, category filter chips, sort select, weight bar, gold ledger).
  - **Skills / Feats / Spells**: Keyboard-navigable ledgers with active `[Use]` triggers and live synergy breakdowns.
- **Right / Popover Inspector**: `ItemInspectPopover.tsx` triggered by hover, click, or keyboard `?` / `Alt+I` with Base Metrics and color-coded special properties.

### B. Persistent HUD & Bottom Action Dock (`HudRoot.tsx` & `BottomActionDock.tsx`)
- **Floating HUD Regions (6 `F6` Keyboard Landmarks)**:
  1. `ChronosStrip.tsx` (TB/RTwP toggle, `1x/2x/4x`, `45°`, `3D`, zoom, Settings)
  2. `VitalsCard.tsx` (strictly driven by `getActiveRuleset(state).projectHudVitals()`, no duplicate raw HP writes)
  3. `CommandDockCard.tsx` (live `<Keycap>` badges bound to `commandRegistry`, 2D/ASCII toggle, cartridge dock commands)
  4. `TacticalScannerCard.tsx` (live hovered/inspected tile DTO from `uiStore.inspectTooltip`)
  5. `ChronicleLogCard.tsx` (keyboard filter tabs `All | Combat | Speech | World`)
  6. `BottomActionDock.tsx` (single `uiStore.activeBank` source of truth `1..10`, `Shift+Up/Down` bank cycling, stance toggles & numeric steppers, action economy pips `STD/MOV/SWF/AoO`, End Turn)
- **Right-Edge Alerts**: `AlertsStack.tsx` projecting turn readiness, critical/low wounds, hostiles in FOV, hunger, conditions, active quests, and cartridge alerts (e.g. Level-Up Ready).

---

## 5. Scoped Keyboard Mapping, `F1` Contextual Help & `F6` HUD Focus

- **Single Global Dispatcher (`InputScopeManager`)**: One `window` `keydown` listener dispatches strictly by active scope priority:
  1. `rebind_capture` (exclusive chord capture in Settings `KeybindMatrix`)
  2. `dialog_overlay` (`DialogHost` alert/confirm/prompt)
  3. `help_overlay` (`F1` `HelpModal`)
  4. `text_input` (`TextInputGuard` protects `<input>`, `<textarea>`, `<select>`, `[contenteditable]`, letting only `Escape` and explicit `allowInTextInput` chords like `F1` pass)
  5. `active_modal` (modal shortcuts, `Tab` focus trap, `Escape` LIFO close)
  6. `hud_focus` (`F6` / `Shift+F6` cycles the 6 HUD landmarks; `Escape` returns focus immediately to map)
  7. `world_gameplay` (movement, combat, targeting, verb menu, hotbar slots, bank cycling, panel toggles)
- **Declarative Command Registry (`CommandRegistry`)**: All gameplay and cartridge bindings are registered as structured `KeyChord`s (`key`, `code`, `ctrl`, `alt`, `shift`, `meta`) with `preventDefault` handling for browser-reserved function keys (`F1`, `F6`, etc.) and conflict detection in Settings.
- **`F1` Contextual Help & Reminder Chip**: `HelpModal.tsx` renders searchable, live-bound keybindings grouped by Console + active Cartridge `helpSections`. `HelpReminderChip.tsx` provides an unobtrusive `F1 Help` indicator in the bottom-right corner.

---

## 6. Cartridge UI Adapter Contract (`CartridgeUIDefinition` & `ICartridgeUIAdapter`)

Ruleset cartridges register via `registerCartridgeUI` (`src/rendering/ui/cartridge_ui_registry.ts`), contributing:
- `defaultThemeMode`: `'parchment' | 'retro-crt' | 'obsidian-brass'`
- `commands`: Declarative `CommandDefinition[]` synced into `commandRegistry`
- `helpSections`: Contextual `UIHelpSection[]` displayed in `F1` Help
- `modals`: Record of `CartridgeModalDescriptor` using `renderPreact: (state) => ComponentChildren` rendered inside `ConsoleModalHost.tsx`
- `dockCommands`, `projectHudAlerts`, `getHotbarData`, `onToggleStance`, `onStepStance`, `onExecuteHotbarSlot`

---
*Maintained by the Core Console Engine Team.*
