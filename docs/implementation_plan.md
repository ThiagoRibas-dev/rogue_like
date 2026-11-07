# Implementation Plan — Console & Cartridge UI Architecture Unification (Milestone 118.1)

## 1. Objective & Architectural Scope

Following the Milestone 118 UI prototype, this plan upgrades the **Core Console Engine (Tier 1)** and **Ruleset Cartridges (Tier 2)** so that:
1. **Prototype Testing Controls Are Removed from Live Gameplay**:
   - Remove the inline **Morphology Switcher** (`[🧍 Live Anatomy]`, `[🐍 6-Armed Marilith]`, `[🐺 Wild Shape Wolf]`) and inline **Theme Switcher** (`[📜 Parchment Tabletop]`, `[📟 Retro CRT]`) from the Master Dossier header.
   - Remove the embedded **Bottom Action Hotbar & Tactical Modes Dock** from the bottom of the Master Dossier modal.
   - **Fix the Showcase Fallback Injection Bug**: Stop injecting fake showcase items (*Luskan Battlemage's Rapier*, *Kizu's Short Sword*, *Elven Chainmail*, *Ring of Protection +2*, *Potion of Cure Serious Wounds*, *Thieves' Tools*) into the live player's paper doll and backpack when their slots/stash are empty during actual gameplay.
2. **Tier 1 Console 3-Column Master Dossier (`src/rendering/ui/console_dossier.ui.ts`)**:
   - Promote the **3-Column Master Dossier** out of `dnd35e_sheet*.ui.ts` into a reusable **Tier 1 Console component** (`renderConsoleMasterDossier` in [`src/rendering/ui/console_dossier.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_dossier.ui.ts)) driven by [`ICartridgeUIAdapter`](file:///d:/Projects/Game%20Dev/rogue-like/src/types/ui_adapter.types.ts) (`UICharacterSheetModel` + `UIInventoryModel` + interactive callbacks).
   - Unify **both `I` (Inventory)** and **`C` (Character Sheet)** across all cartridges (`dnd35e` and `classic`) to open the unified 3-Column Master Dossier, retiring the legacy 2-pane [`inventory.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/inventory.ui.ts) and [`equipment.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/equipment.ui.ts) modals.
3. **Full Cartridge Parity (`dnd35e` + `classic` Registered in `cartridge_ui_registry.ts`)**:
   - Register both `dnd35e` (`defaultThemeMode: 'parchment'`) and `classic` (`defaultThemeMode: 'retro-crt'`, backed by [`DefaultSciFiUIAdapter`](file:///d:/Projects/Game%20Dev/rogue-like/src/rulesets/default/ui/default_ui_adapter.ts)) in [`src/rendering/ui/cartridge_ui_registry.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/cartridge_ui_registry.ts).
   - Upgrade `CartridgeModalDescriptor` and [`src/rendering/ui/modal.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/modal.ui.ts) with a **Dynamic Console Modal Host** so Cartridge modals do not require hardcoded ruleset styling in [`index.html`](file:///d:/Projects/Game%20Dev/rogue-like/index.html).
4. **Persistent Bottom-Center HUD Dock (`#hud-bottom-dock`) & Sidebar De-duplication**:
   - Mount the **NWN2 Tactical Modes & 12-Slot Action Hotbar** persistently in the bottom-center HUD (`#hud-bottom-dock`).
   - Extend [`UIStanceModeEntry`](file:///d:/Projects/Game%20Dev/rogue-like/src/types/ui_adapter.types.ts) and [`renderConsoleHotbar`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_hotbar.ui.ts) to render **numeric steppers** (Power Attack & Combat Expertise `-`/`+` dials) and **Round Action Economy Pips** (`STD`, `MOV`, `SWF`, `AoO`) directly inside the persistent Modes strip.
   - Retire the redundant Left Sidebar **Mini-Paperdoll** (`hud_paperdoll.ui.ts`) and separate Left Sidebar **Tactical Doctrine Card** (`dnd35e_doctrine_bar.ui.ts`).
5. **Global Console Theme Promotion (`:root[data-console-theme]`) & Complete Sub-View Restyling**:
   - Promote `--crpg-*` CSS custom properties (including new semantic tokens `--crpg-success`, `--crpg-warning`, `--crpg-info`) from `.crpg-prototype-shell` to `:root[data-console-theme='parchment' | 'retro-crt']` in [`src/styles/console_prototype.css`](file:///d:/Projects/Game%20Dev/rogue-like/src/styles/console_prototype.css) and [`src/index.css`](file:///d:/Projects/Game%20Dev/rogue-like/src/index.css).
   - Auto-select the active Cartridge's `defaultThemeMode` on campaign load, with a persistent user override (`auto` / `parchment` / `retro-crt`) in [`src/core/settings.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/core/settings.ts) and [`src/rendering/ui/settings.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/settings.ui.ts).
   - Restyle **all 12 Character Creation, Level-Up, Vancian Spellbook, and Inspector UI files** by replacing hardcoded dark-mode inline hex colors (`#f1c40f`, `#9da7b3`, `#c9d1d9`, `#303644`, `#333947`, `#282e3b`, `rgba(0,0,0,0.35)`) with `--crpg-*` theme variables so every screen is crisp and legible in both **Parchment Tabletop** and **Retro CRT** themes.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Old / Split-Brain Location (Evicted) | New Canonical SSOT Owner |
| :--- | :--- | :--- |
| **Theme Token Scope & Lifecycle** | Scoped only to `.crpg-prototype-shell`; toggled via prototype button inside `dnd35e_sheet.ui.ts` | Global `:root[data-console-theme]` managed by [`src/rendering/ui/console_theme.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_theme.ts), auto-synced from `CartridgeUIDefinition.defaultThemeMode` + [`src/core/settings.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/core/settings.ts) |
| **3-Column Master Dossier Rendering** | Coupled to D&D 3.5e inside `dnd35e_sheet.ui.ts` & `dnd35e_sheet_*_tab.ui.ts` | Generic Tier 1 Console renderer [`src/rendering/ui/console_dossier.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_dossier.ui.ts) consuming `UICharacterSheetModel` + `UIInventoryModel` |
| **Live D&D 3.5e Sheet & Inventory Projection** | Split between `DnD35UIAdapter` (hardcoded showcase items) and `dnd35e_sheet_*_tab.ui.ts` (live DAG + buggy showcase item fallback injection) | Live projection helpers in [`src/rendering/ui/dnd35e_sheet_overview_tab.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_sheet_overview_tab.ui.ts), [`src/rendering/ui/dnd35e_sheet_feats_abilities_tab.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_sheet_feats_abilities_tab.ui.ts), and [`src/rendering/ui/dnd35e_sheet_skills_tab.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_sheet_skills_tab.ui.ts) (projecting 100% real player state; synthetic fallback used *only* for headless `{}` unit tests in `DnD35UIAdapter`) |
| **Inventory (`I`) & Character (`C`) Modals** | `I` opened legacy `#inventory-overlay`; `E` opened `#equipment-overlay`; `C` opened `#dnd35e-sheet-overlay` | Both `I` and `C` open the unified Console Master Dossier (`#dnd35e-sheet-overlay`) via [`src/rendering/ui/console_dossier.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_dossier.ui.ts) |
| **Action Hotbar & Tactical Modes Bar** | Embedded inside the `dnd35e_sheet.ui.ts` modal footer AND duplicated as a sidebar card in `dnd35e_doctrine_bar.ui.ts` | Persistent bottom HUD dock (`#hud-bottom-dock`) rendered by [`src/rendering/ui/hud_dock.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud_dock.ui.ts) + [`src/rendering/ui/console_hotbar.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_hotbar.ui.ts) |
| **Left Sidebar Equipment Preview** | Redundant 9-slot mini-paperdoll in [`src/rendering/ui/hud_paperdoll.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud_paperdoll.ui.ts) | Evicted from Left Sidebar; Anatomical Paper Doll lives canonically in Column 1 of the Master Dossier (`I` / `C`) |
| **Character Creation, Level-Up, Spellbook & Inspector Styling** | Hardcoded dark hex colors (`#f1c40f`, `#9da7b3`, `#c9d1d9`, `#303644`, `rgba(0,0,0,0.35)`) across 12 `dnd35e_*.ui.ts` files | Styled via `--crpg-*` theme tokens in [`src/styles/console_prototype.css`](file:///d:/Projects/Game%20Dev/rogue-like/src/styles/console_prototype.css) and semantic classes |

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Producers / Input) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Cartridges / Configs / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Extend `UIStanceModeEntry`, `UIHotbarModel`, & `CartridgeUIDefinition` in `ui_adapter.types.ts` & `cartridge_ui_registry.ts`** | `DnD35UIAdapter`, `DefaultSciFiUIAdapter`, `dnd35e_ui_adapter.ts`, `cartridge_ui_registry.ts` | `console_hotbar.ui.ts`, `hud_dock.ui.ts`, `modal.ui.ts` | `tests/console_ui_architecture.test.ts` |
| **2. Extract Tier 1 Console Master Dossier (`console_dossier.ui.ts`) & Remove Fake Showcase Fallback Injection** | `dnd35e_sheet.ui.ts`, `inventory.ui.ts`, `equipment.ui.ts`, `cartridge_ui_registry.ts` | `console_inventory.ui.ts`, `console_inspect_card.ui.ts` | `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json`, `tests/dnd35e_phase26_ui_and_showcase.test.ts` |
| **3. Unify `I` & `C` Shortcuts to Master Dossier & Retire `#equipment-overlay`** | `shortcut_input.ts`, `modal_input.ts`, `inventory_input.ts`, `session_controller.ts` | `modal.ui.ts`, `ui.ts`, `index.html` | `public/data/campaigns/default/keybinds.json`, `src/core/settings.ts` |
| **4. Mount Persistent Bottom Dock (`#hud-bottom-dock`) & Evict Sidebar Paperdoll / Doctrine Card** | `presenter.ts`, `hud.ui.ts`, `hud_dock.ui.ts`, `shortcut_input.ts` (`1`–`0`, `-`, `=`) | `console_hotbar.ui.ts`, `index.html`, `src/index.css` | `hud_paperdoll.ui.ts`, `dnd35e_doctrine_bar.ui.ts`, `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json` |
| **5. Promote `--crpg-*` Theme Tokens to `:root[data-console-theme]` & Restyle All 12 Builder/Level-Up/Spellbook/Inspector Files** | `console_theme.ts`, `settings.ts`, `settings.ui.ts`, `session_controller.ts` | `src/styles/console_prototype.css`, `src/index.css`, `dnd35e_char_builder*.ui.ts` (7 files), `dnd35e_level_up*.ui.ts` (2 files), `dnd35e_spellbook.ui.ts`, `dnd35e_inspector.ui.ts`, `dnd35e_feat_spell_inspector.ui.ts` | `docs/UI_UX_STANDARDS.md`, `docs/ARCHITECTURE.md`, `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md` |

---

## 4. Step-by-Step Implementation Details & Code Diffs

### Step 1: Extend `src/types/ui_adapter.types.ts` for Tactical Steppers, Action Economy Pips, & Theme Mode

In [`src/types/ui_adapter.types.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/types/ui_adapter.types.ts), add optional numeric stepper fields to `UIStanceModeEntry`, optional `actionPips` to `UIHotbarModel`, and `defaultThemeMode` to `ICartridgeUIAdapter`:

```typescript
/**
 * Represents a toggleable tactical mode or numeric stance dial (e.g., Power Attack, Combat Expertise, Stealth).
 */
export interface UIStanceModeEntry {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly isActive: boolean;
  readonly description: string;
  /** Optional numeric dial value (e.g. Power Attack / Combat Expertise trade-off points). */
  readonly numericValue?: number;
  /** Minimum value for numeric dial. */
  readonly minNumericValue?: number;
  /** Maximum value for numeric dial (e.g. current BAB cap). */
  readonly maxNumericValue?: number;
}

/**
 * Represents a round action-economy pip in the tactical dock (`STD`, `MOV`, `SWF`, `AoO`).
 */
export interface UIActionEconomyPip {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  readonly detailText?: string;
}

/**
 * Represents the bottom NWN2-style Action Hotbar & Stance Modes dock.
 */
export interface UIHotbarModel {
  readonly activeBank: number;
  readonly totalBanks: number;
  readonly stanceModes: ReadonlyArray<UIStanceModeEntry>;
  readonly slots: ReadonlyArray<UIHotbarSlot>;
  readonly actionPips?: ReadonlyArray<UIActionEconomyPip>;
}

export interface ICartridgeUIAdapter {
  readonly rulesetId: string;
  readonly defaultThemeMode: ConsoleThemeMode;
  getCharacterSheetData(actorState: Record<string, unknown>): UICharacterSheetModel;
  getInventoryData(actorState: Record<string, unknown>): UIInventoryModel;
  getHotbarData(actorState: Record<string, unknown>, activeBank?: number): UIHotbarModel;
}
```

Update [`src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts) (`defaultThemeMode: 'parchment'`) and [`src/rulesets/default/ui/default_ui_adapter.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rulesets/default/ui/default_ui_adapter.ts) (`defaultThemeMode: 'retro-crt'`) to satisfy `ICartridgeUIAdapter`.

---

### Step 2: Global Theme Engine (`console_theme.ts`) & Settings Override (`settings.ts` / `settings.ui.ts`)

1. **Update [`src/rendering/ui/console_theme.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_theme.ts)**:
   - Apply `document.documentElement.dataset['consoleTheme'] = mode` on `:root` (`<html>`) as the primary global theme selector (and preserve `applyConsoleTheme(container, mode)` for unit test compatibility).
   - Export `syncGlobalConsoleTheme(cartridgeDefaultMode: ConsoleThemeMode, userPreference?: 'auto' | ConsoleThemeMode): ConsoleThemeMode`.
2. **Update [`src/core/settings.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/core/settings.ts) & [`src/rendering/ui/settings.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/settings.ui.ts)**:
   - Add `consoleThemePreference: 'auto' | 'parchment' | 'retro-crt'` (default `'auto'`) to `GameSettings`.
   - Remove the redundant `openEquipment` keybind from `DEFAULT_KEYBINDS` (`Keybinds` in `settings.ts` and `public/data/campaigns/default/keybinds.json`), keeping `openInventory: 'KeyI'` (`Inventory & Equipment`) and `openCharacterSheet: 'KeyC'` (`Character Dossier`).
   - Add a **UI Theme** selector (`Auto (Cartridge Default)`, `Parchment Tabletop`, `Retro CRT`) in `settings.ui.ts`.

---

### Step 3: Extract Tier 1 Console 3-Column Master Dossier (`src/rendering/ui/console_dossier.ui.ts`)

Create [`src/rendering/ui/console_dossier.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_dossier.ui.ts) ($\le 240$ lines) as the canonical **Tier 1 Console** renderer for the 3-Column Master Dossier:
- Accepts:
  - `container: HTMLElement`
  - `sheetModel: UICharacterSheetModel`
  - `inventoryModel: UIInventoryModel`
  - `callbacks: ConsoleDossierCallbacks` (`onWeaponSetChange`, `onEquipSlotClick`, `onStashItemClick`, `onUseSkill`, `onClose`, `extraHeaderActions`)
- Renders the clean production header (Identity, ECL, XP bar, optional Cartridge action buttons like `[📖 Spellbook]`, and `[✕ Close]`—with **zero** prototype Morphology/Theme buttons) and the 3-Column grid:
  - **Column 1**: Portrait + HP pill + 6 Ability Scores table + [`renderAnatomicalPaperDoll`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_inventory.ui.ts) + 6-box AC & Saving Throws strip + Speed/BAB/Grapple/Init footer.
  - **Column 2**: Full-Attack & Natural Weapon Routine Ledger + Feats/Traits/Domains/Conditions badge grid + Horizon 1 Level-by-Level Matrix.
  - **Column 3**: Pen-and-Paper Skills Table (with `[Trained Only]` filter and `[Use]` action triggers) + [`renderStashGrid`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_inventory.ui.ts) (`10×4` compact socket matrix with category filter pills, sort dropdown, and hover Examine card).
- Does **not** append any bottom hotbar dock inside the modal.

---

### Step 4: Clean Up `dnd35e_sheet*.ui.ts` & Eliminate Fake Showcase Item Injection

1. **Fix [`src/rendering/ui/dnd35e_sheet_overview_tab.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_sheet_overview_tab.ui.ts)**:
   - Remove the `fallbackData.anatomicalSlots` fallback loop that injected fake equipped items (*Luskan Battlemage's Rapier*, *Kizu's Short Sword*) into empty live player slots! When a live player's slot is empty, `item: undefined` is passed so the socket accurately renders as an empty slot.
   - Refactor into a pure model builder (`buildLiveDnD35SheetOverviewModel(state, playerId, activeWeaponSet)`) and DOM helper for Column 1.
2. **Fix [`src/rendering/ui/dnd35e_sheet_skills_tab.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_sheet_skills_tab.ui.ts)**:
   - Remove lines 102–106 (`if (stashItems.length === 0) { stashItems.push(...fallbackData.stashItems); }`) so an empty player backpack renders 40 empty sockets rather than spawning fake showcase loot!
3. **Update [`src/rendering/ui/dnd35e_sheet.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_sheet.ui.ts)**:
   - Remove `activeMorphologyPreset`, Morphology switcher buttons, inline Theme switcher buttons, and the modal-bottom `renderConsoleHotbar` call.
   - Delegate rendering to `renderConsoleMasterDossier` (or the 3 clean column builders).
4. **Unify `I` and `C` in [`src/rendering/ui/inventory.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/inventory.ui.ts), [`src/rendering/ui/modal.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/modal.ui.ts), and [`src/rendering/ui/cartridge_ui_registry.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/cartridge_ui_registry.ts)**:
   - Register both `dnd35e` and `classic` in `cartridge_ui_registry.ts` so pressing `I` or `C` in *either* ruleset opens the 3-Column Master Dossier (`#dnd35e-sheet-overlay`) themed in `parchment` (for `dnd35e`) or `retro-crt` (for `classic`).
   - Make `renderInventoryModal` in `inventory.ui.ts` delegate to the active Cartridge's Master Dossier modal.

---

### Step 5: Persistent Bottom HUD Hotbar & Tactical Modes Dock (`#hud-bottom-dock`)

1. **Add `#hud-bottom-dock` to [`index.html`](file:///d:/Projects/Game%20Dev/rogue-like/index.html) and style it in [`src/index.css`](file:///d:/Projects/Game%20Dev/rogue-like/src/index.css)**:
   - Place `<div id="hud-bottom-dock" class="hud-bottom-dock"></div>` inside `#canvas-container` anchored at `bottom: 10px; left: 50%; transform: translateX(-50%); z-index: 18;`.
   - Remove the dead `#equipment-overlay` block and strip hardcoded inline hex colors (`style="color: #f1c40f"`, etc.) from `#dnd35e-sheet-overlay`, `#dnd35e-spellbook-overlay`, `#char-creation-overlay`, and `#level-up-overlay` in `index.html`.
2. **Enhance [`src/rendering/ui/console_hotbar.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/console_hotbar.ui.ts)**:
   - Support optional `onStanceStep?: (modeId: string, delta: number) => void` in `ConsoleHotbarCallbacks`.
   - When a `UIStanceModeEntry` defines `numericValue !== undefined`, render compact `-` / `+` buttons around the value inside the `.crpg-mode-pill`.
   - When `model.actionPips` is present, render the compact `STD` / `MOV` / `SWF` / `AoO` status badges on the right end of the `.crpg-modes-strip`.
3. **Wire Live D&D 3.5e & Classic Hotbars in [`src/rendering/ui/dnd35e_ui_adapter.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_ui_adapter.ts) & [`src/rendering/ui/hud_dock.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud_dock.ui.ts)**:
   - Build live `UIHotbarModel` from the player's combat stances (`Power Attack` stepper, `Combat Expertise` stepper, `Fighting Defensively`, `Total Defense`, `2H Grip`, `Stealth`, `Search`), round action budget (`STD`, `MOV`, `SWF`, `AoO`), prepared/spontaneous spells, and quick-use inventory items.
   - Clicking a stance toggle or `-`/`+` stepper dispatches `IntentType.SET_COMBAT_STANCE` via `onIntent`.
   - Clicking a hotbar slot or pressing digits `1`–`0`, `-`, `=` in [`src/core/input/shortcut_input.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/core/input/shortcut_input.ts) triggers the corresponding spell, item, or combat action.
4. **Retire Redundant Sidebar Views**:
   - Remove `renderHudPaperdoll` and `renderDnD35eDoctrineBar` from [`src/rendering/ui/hud.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud.ui.ts) and [`src/rendering/ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui.ts).
   - Delete the now-superseded [`src/rendering/ui/hud_paperdoll.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud_paperdoll.ui.ts), [`src/rendering/ui/dnd35e_doctrine_bar.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_doctrine_bar.ui.ts), and [`src/rendering/ui/equipment.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/equipment.ui.ts), and update `docs/ssot/ssot_console.json` & `docs/ssot/ssot_dnd35e.json` accordingly so Stage 5 (`lint:deadcode`) and Stage 8 (`run-validator.ts`) pass with 0 warnings.

---

### Step 6: Promote `--crpg-*` CSS Tokens & Restyle All 12 Cartridge Modal / Inspector Files

1. **Globalize Theme Tokens in [`src/styles/console_prototype.css`](file:///d:/Projects/Game%20Dev/rogue-like/src/styles/console_prototype.css)**:
   - Bind `--crpg-*` variables to `:root, :root[data-console-theme='parchment'], [data-console-theme='parchment']` and `:root[data-console-theme='retro-crt'], [data-console-theme='retro-crt']`.
   - Add theme-aware semantic accent variables so positive/warning/info badges are high-contrast on both cream parchment and dark CRT:
     - **Parchment**:
       - `--crpg-success: #1e5631;` (deep forest green)
       - `--crpg-warning: #8b4513;` (warm bronze/ochre)
       - `--crpg-info: #1d4e89;` (royal ink blue)
       - `--crpg-danger: #8b1e1e;` (crimson ink)
     - **Retro CRT**:
       - `--crpg-success: #2ecc71;` (phosphor green)
       - `--crpg-warning: #ffb000;` (amber)
       - `--crpg-info: #00e5ff;` (cyan)
       - `--crpg-danger: #ff4d4d;` (alert red)
   - Style `.modal-content`, `.modal-header`, `.modal-footer`, `.modal-btn`, `.dnd35-wizard-shell`, `.dnd35-step-pill`, `.dnd35-pane-left`, `.dnd35-pane-right`, `.dnd35-list-item`, `.dnd35-filter-bar`, `.dnd35-badge`, and `.dnd35-counter-btn` in [`src/index.css`](file:///d:/Projects/Game%20Dev/rogue-like/src/index.css) using `var(--crpg-*)`.
2. **Replace Hardcoded Inline Hex Colors Across All 12 Cartridge UI Files**:
   - [`src/rendering/ui/dnd35e_char_builder.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_char_builder.ui.ts)
   - [`src/rendering/ui/dnd35e_char_builder_race_abilities.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_char_builder_race_abilities.ui.ts)
   - [`src/rendering/ui/dnd35e_char_builder_class.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_char_builder_class.ui.ts)
   - [`src/rendering/ui/dnd35e_char_builder_skills.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_char_builder_skills.ui.ts)
   - [`src/rendering/ui/dnd35e_char_builder_feats.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_char_builder_feats.ui.ts)
   - [`src/rendering/ui/dnd35e_char_builder_spells.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_char_builder_spells.ui.ts)
   - [`src/rendering/ui/dnd35e_char_builder_steps.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_char_builder_steps.ui.ts)
   - [`src/rendering/ui/dnd35e_level_up.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_level_up.ui.ts)
   - [`src/rendering/ui/dnd35e_level_up_class.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_level_up_class.ui.ts)
   - [`src/rendering/ui/dnd35e_spellbook.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_spellbook.ui.ts)
   - [`src/rendering/ui/dnd35e_inspector.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_inspector.ui.ts)
   - [`src/rendering/ui/dnd35e_feat_spell_inspector.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_feat_spell_inspector.ui.ts)
   Every `#f1c40f` becomes `var(--crpg-gold)`, `#9da7b3` / `#8b949e` becomes `var(--crpg-text-dim)`, `#c9d1d9` becomes `var(--crpg-ink)`, `#2ecc71` becomes `var(--crpg-success)`, `#e74c3c` becomes `var(--crpg-danger)`, `#58a6ff` becomes `var(--crpg-info)`, `#e67e22` / `#f39c12` becomes `var(--crpg-warning)`, and `#303644` / `#333947` / `rgba(0,0,0,0.35)` becomes `var(--crpg-border-inner)` / `var(--crpg-bg-card)`.

---

## 5. Verification & Test Plan

1. **Unit & Integration Tests**:
   - Update [`tests/console_ui_architecture.test.ts`](file:///d:/Projects/Game%20Dev/rogue-like/tests/console_ui_architecture.test.ts) and [`tests/dnd35e_phase26_ui_and_showcase.test.ts`](file:///d:/Projects/Game%20Dev/rogue-like/tests/dnd35e_phase26_ui_and_showcase.test.ts) to verify:
     - `renderConsoleMasterDossier` renders the 3-column Master Dossier for both `DnD35UIAdapter` and `DefaultSciFiUIAdapter` with zero prototype Morphology/Theme switcher buttons and zero embedded modal-bottom hotbars.
     - Live player sheet & inventory projection in `dnd35e_sheet.ui.ts` never injects fake showcase items into an empty player inventory.
     - `renderConsoleHotbar` renders the persistent bottom dock with stance toggles, numeric `-`/`+` steppers (`Power Attack`, `Combat Expertise`), action economy pips (`STD`, `MOV`, `SWF`, `AoO`), and 12 action slots (`1`–`0`, `-`, `=`).
     - Global theme synchronization (`syncGlobalConsoleTheme`) sets `document.documentElement.dataset['consoleTheme']` to `'parchment'` for `dnd35e` and `'retro-crt'` for `classic`, and respects user overrides in `Settings`.
2. **8-Stage Verification Pipeline (`.\verify.bat`)**:
   - Run all 8 stages (`tsc --noEmit`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `build`, `run-validator.ts`) and ensure 0 errors and all files $\le 300$ lines.
