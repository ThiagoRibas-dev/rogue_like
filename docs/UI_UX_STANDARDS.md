# Console Engine & Ruleset Cartridge UI/UX Standards

This document serves as the canonical Source of Truth (SSOT) for UI and UX architecture, spatial design rules, visual themes, and component contracts across the **Core Console Engine** and all **Ruleset Cartridges**.

---

## 1. Architectural Tiering & Responsibilities

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           CORE CONSOLE ENGINE (Tier 1)                             │
│  src/rendering/ui/                                                                │
│  ├── console_theme.ts        (Global Skin Token Engine: 'parchment' | 'retro-crt')│
│  ├── console_ui_adapter.ts   (ICartridgeUIAdapter Interface Definition)          │
│  ├── console_hotbar.ui.ts    (Generic 12-Slot Action Hotbar & Stance Dock Bar)   │
│  ├── console_paperdoll.ui.ts (Anatomical Equipment Slot Grid & Paper Doll)       │
│  ├── console_inventory.ui.ts (Categorized Stash/Bag Grid with Sorting & Weight)   │
│  ├── console_inspect.ui.ts   (Item Examine Parchment / CRT Popover Card)          │
│  └── console_modal_host.ts   (Tabbed Dual/Triple-Column Modal Overlay Host)       │
└───────────────────────────────┬───────────────────────────────────────────────────┘
                                │ Implements & Binds
                                ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        RULESET CARTRIDGE ADAPTERS (Tier 2)                         │
│                                                                                   │
│ ┌─────────────────────────────────────────┐ ┌───────────────────────────────────┐ │
│ │        D&D 3.5e Cartridge Adapter       │ │    Default Sci-Fi Cartridge       │ │
│ │ src/rulesets/dnd35e/ui/                 │ │ src/rulesets/default/ui/          │ │
│ │ ├── dnd35e_ui_adapter.ts                │ │ └── default_ui_adapter.ts         │ │
│ │ ├── dnd35e_ui_projection.ts             │ │                                   │ │
│ │ └── dnd35e_ui_hotbar.ts                 │ │                                   │ │
│ └─────────────────────────────────────────┘ └───────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core UI/UX Design Constitution

### Spatial Math & Viewport Rules
- **Desktop Baseline (1440px)**: All primary modals (Character Sheet, Inventory, Character Creation) are designed for a desktop container baseline of $900\text{px}\text{--}1200\text{px}$ width.
- **Padding Math**: Outer container padding MUST be strictly greater than or equal to inner child padding ($\text{Padding}_{\text{outer}} \ge \text{Gap}_{\text{inner}}$). Minimum container padding is `16px` (`p-4`).
- **Control Padding**: Buttons and hotbar slots use balanced horizontal-to-vertical ratios (`py-2 px-4` or 1:1 square aspect ratio for hotbar action slots).

### Typography & Numeric Precision
- **Tabular Numerals**: Every numeric stat display, attack bonus line, modifier, saving throw, weight calculation, and gold total MUST use `font-mono tabular-nums` or `font-variant-numeric: tabular-nums` for crisp vertical alignment across columns.
- **Explicit Signs**: All relative modifiers must include explicit positive or negative signs (`+5`, `-2`, `+0`).
- **Font Pairings**:
  - **`parchment` Skin**: Display face `Cinzel` / `Playfair Display`, body `Plus Jakarta Sans`, data `IBM Plex Mono`.
  - **`retro-crt` Skin**: Display face `Space Mono` / `JetBrains Mono`, body `IBM Plex Mono`, data `IBM Plex Mono`.

### Anti-Slop Discipline
- **Zero Pill Capsules for Static Metadata**: Static metadata (dates, tags, categories, alignments) MUST be rendered as unboxed text with subtle separators (`·`, `/`). Pills are reserved exclusively for interactive toggles and segmented filters.
- **No Roleplay Button Jargon**: Action button labels must use clear, standard human verbs (`Save`, `Cancel`, `Equip`, `Unprepare`, `Rest`, `Inspect`).

---

## 3. Theme Skins (`ConsoleThemeProvider`)

Every Cartridge selects a primary theme skin, which can be toggled in settings:

### Theme 1: `parchment` (Tabletop Fantasy)
- **Visual Style**: Inspired by *Neverwinter Nights 2* and *Pathfinder: Wrath of the Righteous*. Leather borders, gold filigree accents, warm parchment backgrounds, dark ink typography.
- **Colors**:
  - Primary Canvas: `#e8dfd1` (Parchment Light) / `#1a1410` (Dark Leather Frame)
  - Structural Borders: `#4a3a2a` (Bronze Leather) / `#c8963e` (Gold Highlight)
  - Text Primary: `#2c221a` (Dark Ink) / `#e8dfd1` (Light Parchment Ink)
  - Accent Actions: `#8c241c` (Crimson Seal) / `#2a5c36` (Forest Green Accent)

### Theme 2: `retro-crt` (Sci-Fi Cyberpunk)
- **Visual Style**: Inspired by classic sci-fi terminals and retro computer character creation profile screens. Deep obsidian canvas, glowing cyan scanlines, pixelated box borders.
- **Colors**:
  - Primary Canvas: `#0a0f12` (Void Black) / `#0d181c` (Terminal CRT Surface)
  - Structural Borders: `#1a3a42` (Deep Cyan Hairline) / `#00f0ff` (Glowing Cyan Border)
  - Text Primary: `#00f0ff` (Terminal Cyan) / `#a0e0e6` (Muted Cyan)
  - Accent Actions: `#00ff66` (Terminal Emerald) / `#ffaa00` (Amber Alert)

---

## 4. Component Contracts & Standards

### A. 3-Column Master Dossier Modal Contract (`ConsoleMasterDossierUI`)
- **Container**: Full-screen modal (`.dossier-full-modal`) with parchment leather frame or CRT scanline frame.
- **Left Column (`.crpg-sheet-left`)**: Hero Identity Badge (Portrait, Level, Class, HD, HP bar), Core Attributes Ledger with modifier boxes, and Saving Throws strip (Fort, Ref, Will).
- **Center Column (`.crpg-sheet-center`)**: Responsive Tabbed Viewports:
  - **Overview Tab**: Combat Attack routine breakdown (Melee/Ranged/Unarmed attacks, iterative BAB, damage, critical threat range), Armor Class breakdown (Touch, Flat-Footed), Maneuver modifiers (Grapple, Trip).
  - **Inventory & Stash Tab**: Anatomical Equipment Paper Doll (12 slots, multi-limb Marilith, Wild Shape suppressed limbs) + 10x4 Item Stash Grid + Weight Slider + Gold counter.
  - **Skills Tab**: Formatted Pen-and-Paper Skills Ledger with Active [Use] buttons and synergy indicators.
  - **Feats & Abilities Tab**: Categorized Feats list (General, Racial, Class Bonus, Metamagic) and Active Special Abilities.
- **Right Column (`.crpg-sheet-right`)**: Active Item/Feat/Skill Inspector Card displaying detailed metrics, synergy trees, and flavor lore.

### B. Persistent HUD Bottom Dock Contract (`HudBottomDockUI` & `ConsoleHotbarUI`)
- **Mount Point**: Persistent bottom-center screen overlay (`#hud-bottom-dock`) displayed across gameplay turns.
- **Left Stance Modes Strip**: Tactical combat doctrine toggles with numeric steppers (Power Attack `[-][+]`, Combat Expertise `[-][+]`, Fighting Defensively, Total Defense, Grip Mode 1H/2H).
- **Action Economy Pips**: Compact visual indicators for combat turn resource budgets:
  - `STD` (Standard Action)
  - `MOV` (Move Action)
  - `SWF` (Swift / Quickened Action)
  - `AoO` (Attack of Opportunity)
- **12-Slot Action Hotbar**: Keybindings `1` through `6` (and `7` through `=`), quick-use consumable trigger integration, and bank pagination (`Bank 1..10`).

### C. Anatomical Paper Doll Contract (`ConsolePaperDollUI`)
- **Supported Slots**:
  - `head` (Helmet / Hood)
  - `neck` (Amulet / Necklace)
  - `torso` (Armor / Robes)
  - `waist` (Belt)
  - `hands` (Gloves / Gauntlets)
  - `feet` (Boots)
  - `ring_1` & `ring_2` (Left/Right Rings)
  - `cloak` (Cape / Cloak)
  - `main_hand` & `off_hand` (Primary / Offhand Weapon or Shield)
  - `ammo` (Quiver / Ammunition)
- **Weapon Sets**: Quick-toggle buttons for 4 weapon sets (I, II, III, IV).

### C. Stash & Inventory Grid Contract (`ConsoleInventoryGridUI`)
- **Grid Layout**: 8-column or 10-column grid with stack quantity badges in bottom-right corner.
- **Category Filter Bar**: Segmented filter buttons (`All`, `Weapons`, `Armor`, `Consumables`, `Accessories`, `Quest`).
- **Sort Options**: Dropdown selector (`Price (High-to-Low)`, `Name (A-Z)`, `Weight (Low-to-High)`).
- **Capacity Indicator**: Encumbrance weight progress bar (`Current / Max lbs`) and Gold ledger indicator.

### D. Item Inspect Popover Card (`ConsoleInspectCardUI`)
- Triggered on item hover or right-click.
- Layout: Icon header badge + Item Title + Lore Flavor Quote + Base Metrics Grid (Damage, Crit Range, Type, Weight) + Color-coded Special Properties list (+3 Enhancement, Elemental Damage).

---

## 5. Future Cartridge UI Adapter Interface (`ICartridgeUIAdapter`)

All new Ruleset Cartridges must expose a clean UI adapter implementing `ICartridgeUIAdapter`:

```typescript
export interface UICharacterSheetModel {
  readonly name: string;
  readonly portraitUrl?: string;
  readonly levelSummary: string;
  readonly raceName: string;
  readonly alignmentName?: string;
  readonly attributes: ReadonlyArray<{ id: string; name: string; score: number; modifier: number }>;
  readonly savingThrows: ReadonlyArray<{ id: string; name: string; total: number }>;
  readonly hpCurrent: number;
  readonly hpMax: number;
  readonly acTotal: number;
  readonly babTotal: number;
  readonly combatSummary: ReadonlyArray<{ title: string; attackBonus: string; damage: string; critRange: string; specialEffects?: ReadonlyArray<string> }>;
  readonly skills: ReadonlyArray<{ id: string; name: string; totalModifier: number; isClassSkill: boolean }>;
  readonly feats: ReadonlyArray<{ id: string; name: string; description: string }>;
}

export interface UIInventoryModel {
  readonly equippedSlots: Readonly<Record<string, UIInventoryItem | null>>;
  readonly activeWeaponSetIndex: number;
  readonly stashItems: ReadonlyArray<UIInventoryItem>;
  readonly currentWeightLbs: number;
  readonly maxWeightLbs: number;
  readonly goldCurrency: number;
}

export interface UIInventoryItem {
  readonly id: string;
  readonly name: string;
  readonly iconUrl?: string;
  readonly category: 'weapon' | 'armor' | 'consumable' | 'accessory' | 'quest' | 'misc';
  readonly quantity: number;
  readonly priceGp: number;
  readonly weightLbs: number;
  readonly inspectData: UIInspectData;
}

export interface UIInspectData {
  readonly title: string;
  readonly iconUrl?: string;
  readonly loreText?: string;
  readonly baseMetrics: ReadonlyArray<{ label: string; value: string }>;
  readonly specialProperties: ReadonlyArray<{ text: string; colorHint?: 'green' | 'blue' | 'purple' | 'orange' }>;
}

export interface ICartridgeUIAdapter {
  readonly rulesetId: string;
  readonly defaultThemeMode: 'parchment' | 'retro-crt';

  getCharacterSheetData(actor: unknown): UICharacterSheetModel;
  getInventoryData(actor: unknown): UIInventoryModel;
  getHotbarBinding(actor: unknown, slotIndex: number): UIInventoryItem | null;
  getStanceActions(actor: unknown): ReadonlyArray<{ id: string; label: string; active: boolean }>;
  getItemInspectData(item: unknown): UIInspectData;
}
```

---
*Maintained by the Core Console Engine Team.*
