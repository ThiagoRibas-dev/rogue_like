# Research Notes — Dwarf Fortress Steam / Dark Fantasy CRPG UI Overhaul

## 1. Architectural Rules & Invariants Reiteration (`AGENTS.md` & `docs/ARCHITECTURE.md`)
- **Zero Simulation or GameState Mutation**: This overhaul is strictly in the **View / Presentation & Input Controller layer** (`index.html`, `src/styles/*.css`, `src/rendering/ui/*`). `GameState`, `ViewportSnapshot`, and `renderer.ts` remain 100% pure and untouched.
- **Preserve All Existing DOM Element IDs**: `session_controller.ts`, `hud.ui.ts`, `hud_paperdoll.ui.ts`, `hud_dock.ui.ts`, `hud_alerts.ui.ts`, `inspect_view.ui.ts`, and `mouse_input.ts` bind to specific DOM IDs (`#dungeon-depth`, `#player-level-text`, `#health-bar-fill`, `#health-bar-text`, `#xp-bar-fill`, `#xp-bar-text`, `#atk-text`, `#def-text`, `#hunger-text`, `#hud-paperdoll-grid`, `#hud-quickbelt-grid`, `#btn-engine-mode`, `#rtwp-controls`, `#btn-pause`, `#btn-speed-1..4`, `#btn-toggle-rotate`, `#btn-toggle-3d`, `#btn-zoom-out`, `#btn-zoom-in`, `#btn-open-settings`, `#status-effects-container`, `#hud-command-dock`, `#inspect-panel`, `#inspect-content`, `#message-log-tabs`, `#message-log`, `#btn-toggle-hud-fold`). Every one of these IDs must be preserved so zero controller wiring breaks.
- **No `any`, No `.innerHTML` Clearing, Explicit Return Types**: Any TypeScript adjustments in `src/rendering/ui/` must use `replaceChildren()`, `createElement()`, and strict typing.

---

## 2. Current "Web App" Visual Artifacts vs. Target CRPG / *Dwarf Fortress Steam* Materiality

### A. Typography & Color Tokens (`index.html`, `src/styles/core.css`)
- **Current State**:
  - Loads Google Font `'Outfit'` (`--font-sans`), a geometric tech-startup sans-serif.
  - Uses neon cyan (`--color-accent: #00ffff`), pastel red (`#ff4757`), pastel mint (`#2ed573`), and translucent glass (`rgba(12, 15, 22, 0.88)` + `backdrop-filter: blur(8px)`).
- **Target State (Option A — *Dwarf Fortress Steam* / Dark Fantasy CRPG)**:
  - Load Google Font **`'Cinzel'`** (weights 600–800) alongside **`'JetBrains Mono'`** in `index.html`.
  - Set `--font-display: 'Cinzel', Georgia, serif` for modal titles, area banners, and drawer headers; use `--font-mono: 'JetBrains Mono', monospace` for all HUD gauges, tabular numbers, buttons, and logs.
  - Replace neon cyan/glass tokens in `src/styles/core.css` with forged dark-fantasy materials:
    - `--bg-main: #050507` (deep dungeon void)
    - `--bg-console: #121317` (opaque dark iron/slate plate)
    - `--bg-card: #15171c` (solid hammered slate surface — zero `backdrop-filter` blur)
    - `--bg-socket: #0b0c0f` (recessed stone/iron item socket)
    - `--border-outer: #000000` (1px pitch-black pixel keyline)
    - `--border-brass: #b88a2d` / `--border-brass-bright: #e0b44c` (burnished gold/brass trim)
    - `--border-stone: #3a3f4b` / `--border-stone-light: #525968` (chiseled stone bevel)
    - `--text-main: #e2d9c8` (warm parchment)
    - `--text-dim: #8c8577` (weathered ash)
    - `--text-highlight: #e6b84c` (gilded gold)
    - `--color-health: #b8252a` (deep blood crimson with `#d9383e` top bevel highlight)
    - `--color-xp: #388e48` (emerald moss with `#52b765` highlight)
    - `--color-accent: #d4a024` (burnished amber/gold active state instead of `#00ffff` neon cyan)

### B. Consolidating the Left HUD from "Stacked Web Cards" into a Native Game HUD (`index.html`, `src/styles/hud.css`, `src/styles/layout.css`)
- **Current State**:
  - Left side (`#hud-left-stack`) renders 4 separate titled accordion boxes (`Chronos & Camera`, `Adventurer Vitals`, `Gear & Quick Belt`, `Conditions`).
- **Target State**:
  1. **Compact Headerless Top-Left Adventurer & Chronos Plate (`.hud-vitals-plate`)**:
     - Always visible in the top-left corner (or collapsible via `[Tab]` into the `44×44px` `♥` edge emblem).
     - **No `"ADVENTURER VITALS"` or `"CHRONOS & CAMERA"` web card titles.**
     - Row 1 (Location & Chronos Strip): Area name (`#dungeon-depth`), Level badge (`Lv.1`), Turn-Based / RTwP mode button (`#btn-engine-mode`), compact RTwP speed controls (`#rtwp-controls`), and micro square bevelled camera buttons (`45°`, `3D`, `−`, `+`, `⚙`).
     - Row 2 (Chiseled Meters): Recessed **HP** and **XP** troughs with 10% vertical tick marks (`repeating-linear-gradient`), specular top highlight, and crisp monospace `30 / 30` overlay.
     - Row 3 (Compact Combat & Survival Strip): Inline sunken stat sockets (`⚔ ATK`, `🛡 DEF`, `🍖 Food`) + inline status condition pills (`#status-effects-container`) right inside the plate when active.
  2. **Compact Sunken Equipment & Quick-Belt Bar (`.hud-belt-plate`)**:
     - Sits directly beneath the Vitals plate (or folds to its `44×44px` `⚔` edge socket).
     - Displays the 5 equipment sockets (`HEAD`, `MAIN`, `OFF`, `BODY`, `ACC`) and 5 `[1]–[5]` Quick-Belt sockets as **square `40×40px` sunken iron/stone sockets** (`box-shadow: inset 2px 2px 0 #000, inset -1px -1px 0 #2e323b`) with brass borders on equipped/filled items—just like *Ultima* / *Diablo* / *Dwarf Fortress* item slots.
  3. **Right-Edge Square Beveled Icon Dock & Popout Drawers (`#hud-right-stack`)**:
     - Right edge holds tactile `44×44px` brass-and-iron square icon buttons (`⊞ CMD`, `⌖ SCAN`, `📜 LOG`) + RimWorld-style medieval parchment/crimson alert banners (`#hud-alerts-container`).
     - When a right-edge icon is clicked, its drawer opens as a **chiseled stone-and-brass scroll plate** (`border: 2px solid var(--border-brass)`, `outline: 1px solid #000`, `box-shadow: 4px 4px 0 rgba(0,0,0,0.85)`, `border-radius: 0`).

### C. Modals, Inventory & Context Verb Menu (`src/styles/modals.css`, `src/styles/inventory.css`, `src/styles/hud.css`)
- Replace soft rounded corners (`border-radius: 8px`) and cyan glow (`box-shadow: 0 0 30px rgba(0,255,255,0.2)`) across `.modal-content`, `.inspect-tooltip`, `.verb-menu-popover`, and `.inventory-modal` with sharp `0px–2px` double-beveled stone/brass frames, `Cinzel` headers, and recessed `44×44px` inventory grid sockets.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters) | Downstream (Consumers / Renderers) | Lateral (Mirrors / Sibling Files) |
| :--- | :--- | :--- | :--- |
| Replace `--font-sans` / `--color-accent` in `index.html` & `src/styles/core.css` | `index.html` Google Fonts `<link>` | All CSS stylesheets (`hud.css`, `modals.css`, `inventory.css`, `editor.css`) | `src/rendering/ui/hud.ui.ts` hunger color literals |
| Consolidate Left HUD into Vitals+Chronos Plate & Sunken Slot Belt in `index.html` | `mouse_input.ts` (`.hud-card`, `.hud-edge-tab`, `.hud-fold-btn`), `session_controller.ts` | `hud.ui.ts` (`renderPlayerStats`, `updateHUD`), `hud_paperdoll.ui.ts` (`renderHudPaperdoll`) | `src/styles/layout.css`, `src/styles/hud.css` |
| Restyle Right-Side Drawers, Alert Ribbons & Verb Popover in `src/styles/hud.css` | `hud_alerts.ui.ts`, `hud_dock.ui.ts`, `verb_menu.ui.ts`, `inspect_view.ui.ts` | DOM classes `.hud-alert-ribbon`, `.dock-cmd-btn`, `.verb-menu-popover`, `.log-tab-btn` | `src/styles/modals.css`, `src/styles/inventory.css` |
