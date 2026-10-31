# Implementation Plan — Dwarf Fortress Steam / Dark Fantasy CRPG UI Overhaul

## 1. Objective
Replace the remaining SaaS/web-dashboard visual traits (frosted glass `backdrop-filter: blur`, soft rounded `6px–8px` corners, neon `#00ffff` cyan accents, `'Outfit'` startup font, and stacked titled `<section>` accordion cards) with a tactile **Dwarf Fortress Steam / Dark Fantasy CRPG** game interface:
1. **Material Palette & Beveled Frames**: Opaque dark forged-iron & slate plates (`#121317` / `#16181e`), sharp `0px–2px` corners, double-beveled burnished brass (`#b88a2d` / `#e6b84c`) and chiseled stone (`#3a3f4b` / `#525968`) borders with `1px` pitch-black outer/inner keylines and hard pixel shadows (`3px 3px 0 #000`).
2. **Game Typography**: **`Cinzel`** (carved serif display font) for headers, area titles, and modals paired with **`JetBrains Mono`** for all HUD gauges, tabular numbers, sockets, and logs.
3. **Headerless Top-Left Vitals & Chronos Gauge Plate**: Consolidate the left-side `Chronos & Camera`, `Adventurer Vitals`, and `Conditions` cards into a single compact, headerless **Adventurer & Chronos HUD Plate** (open by default so the player immediately sees their chiseled HP/XP bars, area banner, stats, and time/camera buttons, while still foldable to a `44×44px` edge emblem via `«` or `[Tab]`).
4. **Sunken Inventory & Quick-Belt Sockets**: Restyle the 5-slot Mini Paper-Doll and 5-slot `[1]–[5]` Quick Belt into square `44×44px` recessed stone/iron sockets (`inset 2px 2px 0 #000, inset -1px -1px 0 #2e323b`) with brass borders on equipped/filled items.
5. **Chiseled Modals, Popovers & Alert Banners**: Apply the same forged stone-and-brass framing to the right-side edge tabs (`⊞ CMD`, `⌖ SCAN`, `📜 LOG`), popout drawers, right-click context verb popover, tooltips, and full-screen modals.

---

## 2. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters) | Downstream (Consumers / Renderers) | Lateral (Mirrors / Sibling Files) |
| :--- | :--- | :--- | :--- |
| **1. Typography & Material CSS Variables** (`index.html`, `src/styles/core.css`) | Google Fonts `<link>` in `index.html` | `layout.css`, `hud.css`, `modals.css`, `inventory.css` | `src/rendering/ui/hud.ui.ts` (hunger state color styling) |
| **2. Consolidate Left HUD Plates** (`index.html`) | `mouse_input.ts` (`.hud-card`, `.hud-edge-tab`, `.hud-fold-btn`), `session_controller.ts` (time/camera button listeners) | `hud.ui.ts` (`#dungeon-depth`, `#player-level-text`, `#health-bar-fill`, `#xp-bar-fill`, `#atk-text`, `#def-text`, `#hunger-text`, `#status-effects-container`) | `hud_paperdoll.ui.ts` (`#hud-paperdoll-grid`, `#hud-quickbelt-grid`) |
| **3. Sunken 5-Column Paper-Doll & Quick-Belt Sockets** (`src/rendering/ui/hud_paperdoll.ui.ts`, `src/styles/hud.css`) | `session_controller.ts` (`PresentationDomain.HUD` / `Inventory`) | `#hud-paperdoll-grid`, `#hud-quickbelt-grid`, `#edge-badge-gear` | `src/styles/inventory.css` (`.inv-grid-slot`) |
| **4. Chiseled Stone/Brass Framing on Drawers, Modals & Verb Menu** (`src/styles/hud.css`, `src/styles/modals.css`, `src/styles/inventory.css`) | `verb_menu.ui.ts`, `inspect_view.ui.ts`, `hud_alerts.ui.ts`, `hud_dock.ui.ts` | `.hud-card`, `.hud-edge-tab`, `.verb-menu-popover`, `.modal-content`, `.inspect-tooltip` | `src/styles/layout.css` (`.canvas-wrapper` border) |

---

## 3. Step-by-Step Implementation Details & Code Snippets

### Step 1: Update `index.html` — Load `Cinzel` Font & Consolidate Left HUD into Headerless Game Plates
- Replace `'Outfit'` with `'Cinzel:wght@600..800'` + `'JetBrains Mono'` in `<head>`.
- In `#hud-left-stack`, merge `Chronos & Camera`, `Adventurer Vitals`, and `Conditions` into a single **headerless** `.hud-card.vitals-plate` (expanded by default so the game immediately looks like a classic CRPG/roguelike HUD, while still supporting `.folded` into its `44×44px` `♥` edge tab).
- Keep `.hud-card.paperdoll-card` directly below it as a compact **5×2 Sunken Socket Belt** (5 equipment sockets on the top row, 5 `[1]–[5]` quick-belt sockets on the bottom row), also expanded by default and foldable to its `44×44px` `⚔` edge tab.
- Keep `#edge-badge-time`, `#edge-badge-vitals`, `#edge-badge-gear`, `#edge-badge-status` and all 26 interactive IDs present in the DOM.

```html
<!-- Consolidated Top-Left Adventurer Vitals & Chronos Gauge Plate -->
<div class="hud-card vitals-plate">
  <button type="button" class="hud-edge-tab" title="Expand Adventurer Vitals &amp; Chronos">
    <span class="hud-edge-icon">⚜</span>
    <span class="hud-edge-badge" id="edge-badge-vitals">100%</span>
    <span class="hidden" id="edge-badge-time">TB</span>
    <span class="hidden" id="edge-badge-status">OK</span>
  </button>
  <div class="hud-card-body vitals-plate-body">
    <!-- Top Banner: Area Name, Level, and Fold Button -->
    <div class="vitals-banner-row">
      <div class="vitals-area-title">
        <span class="vitals-crest">⚜</span>
        <span id="dungeon-depth" class="area-banner-name">The Dark Caverns</span>
      </div>
      <div class="vitals-banner-right">
        <span class="level-crest">LV <strong id="player-level-text">1</strong></span>
        <button type="button" class="hud-fold-btn" aria-expanded="true" title="Collapse to edge icon">«</button>
      </div>
    </div>

    <!-- Chiseled Segmented HP & XP Meters -->
    <div class="vitals-meters">
      <div class="stat-row meter-row">
        <span class="meter-tag hp-tag">HP</span>
        <div class="bar-container">
          <div id="health-bar-fill" class="bar-fill health-bar" style="width: 100%;"></div>
          <div class="bar-ticks"></div>
          <span id="health-bar-text" class="bar-text">30 / 30</span>
        </div>
      </div>
      <div class="stat-row meter-row">
        <span class="meter-tag xp-tag">XP</span>
        <div class="bar-container">
          <div id="xp-bar-fill" class="bar-fill xp-bar" style="width: 0%;"></div>
          <div class="bar-ticks"></div>
          <span id="xp-bar-text" class="bar-text">0 / 100</span>
        </div>
      </div>
    </div>

    <!-- Sunken Combat & Survival Readout Sockets + Active Conditions -->
    <div class="stat-grid-3">
      <div class="stat-row stat-pill">
        <span class="stat-label-inline">ATK</span>
        <span id="atk-text" class="stat-value">0</span>
      </div>
      <div class="stat-row stat-pill">
        <span class="stat-label-inline">DEF</span>
        <span id="def-text" class="stat-value">0</span>
      </div>
      <div class="stat-row stat-pill">
        <span class="stat-label-inline">SAT</span>
        <span id="hunger-text" class="stat-value">Normal</span>
      </div>
    </div>

    <div id="status-effects-container" class="status-content"></div>

    <!-- Tactile Beveled Chronos & Camera Strip -->
    <div class="chronos-strip">
      <div class="time-controls">
        <button id="btn-engine-mode" class="time-btn mode-btn">Turn-Based</button>
        <div class="rtwp-controls" id="rtwp-controls" style="display: none;">
          <button id="btn-pause" class="time-btn pause-btn">⏸</button>
          <div class="speed-btns">
            <button id="btn-speed-1" class="time-btn speed-btn active">1x</button>
            <button id="btn-speed-2" class="time-btn speed-btn">2x</button>
            <button id="btn-speed-4" class="time-btn speed-btn">4x</button>
          </div>
        </div>
      </div>
      <div class="view-controls">
        <button id="btn-toggle-rotate" class="time-btn" title="Rotate 45°">45°</button>
        <button id="btn-toggle-3d" class="time-btn" title="3D Tilt">3D</button>
        <button id="btn-zoom-out" class="time-btn" title="Zoom Out">−</button>
        <button id="btn-zoom-in" class="time-btn" title="Zoom In">+</button>
        <button id="btn-open-settings" class="time-btn" title="Settings">⚙</button>
      </div>
    </div>
  </div>
</div>
```

### Step 2: Update `src/styles/core.css` & `src/styles/layout.css` — Forged Iron, Stone & Burnished Brass Tokens
- Replace `--color-accent: #00ffff` and `--font-sans: 'Outfit'` with `--font-display: 'Cinzel', Georgia, serif`, `--font-mono: 'JetBrains Mono', monospace`, `--color-accent: #d4a024` (burnished gold), `--border-brass: #9e782f`, `--border-stone: #3a3f4b`, `--bg-console: #121419`, and `--bg-socket: #090a0d`.
- Remove neon cyan border from `.canvas-wrapper` in `src/styles/layout.css`.

### Step 3: Update `src/styles/hud.css` & `src/rendering/ui/hud_paperdoll.ui.ts` — Beveled Plates, Segmented Troughs & Sunken `44×44px` Item Sockets
- Replace all `backdrop-filter: blur(...)` and rounded corners with crisp `0px–2px` beveled stone/brass borders:
  ```css
  .hud-card {
    background: linear-gradient(180deg, #181b22 0%, #101217 100%);
    border: 2px solid #464c59;
    outline: 1px solid #000;
    box-shadow:
      inset 1px 1px 0 rgba(255, 255, 255, 0.08),
      inset -1px -1px 0 rgba(0, 0, 0, 0.85),
      3px 3px 0 rgba(0, 0, 0, 0.9);
    border-radius: 1px;
  }
  ```
- Render `.mini-paperdoll-grid` as a **5-column row of sunken square sockets** (`HEAD`, `MAIN`, `OFF`, `BODY`, `ACC`) directly above the **5-column row of `[1]–[5]` Quick-Belt sockets**, so both rows align as a crisp `5 × 2` grid of carved inventory sockets.
- Add `.bar-ticks` (`repeating-linear-gradient(90deg, transparent, transparent calc(10% - 1px), rgba(0,0,0,0.55) calc(10% - 1px), rgba(0,0,0,0.55) 10%)`) over the HP and XP bars for authentic CRPG segmented health/experience gauges.

### Step 4: Update `src/styles/modals.css` & `src/styles/inventory.css` — Chiseled Modals, Tooltips & Inventory Grid
- Style `.modal-content`, `.inspect-tooltip`, `.verb-menu-popover`, `.paperdoll-slot`, and `.inv-grid-slot` with the same carved stone/brass borders, `Cinzel` serif titles, and sunken item sockets, removing inline purple/green web button backgrounds on `#btn-dev-tools` and `#btn-install-campaign` in `index.html`.
