# Research Notes — Standardized Tabbed Character Sheet & Tactical Dossier Overhaul

## 1. Executive Summary & Design Alignment

### 1.1 Objective
Standardize and overhaul the D&D 3.5e Character Sheet modal (`#dnd35e-sheet-overlay`) into a clean, 3-tab responsive CRPG dossier:
1. **Tab 1: Character (3 Equal-Width Columns — `1fr : 1fr : 1fr`)**:
   - **Column 1 (`crpg-sheet-col-identity-skills`)**: Adventurer Identity & Level, Vitals Meters (HP/XP/Init/Speed), Defenses & Saves (AC, Flat-footed, Touch, Fort, Ref, Will, BAB, Grapple), **Active Conditions Strip** (interactive condition badges with mechanical breakdown tooltips, collapsing to `[ Normal ]` when healthy), 6 Ability Scores (Score + Mod), and **Skills** (filter for All vs. Trained, class-skill markers, total bonuses, and ranks).
   - **Column 2 (`crpg-sheet-col-attacks-abilities`)**: Attacks & Weapons (Full-Attack and natural attack routines with damage/crit profiles), Maneuvers (Trip, Disarm, Sunder, Bull Rush, Grapple modifiers and provoke tags), Abilities & Pools (Turn Undead, Smite Evil, Rage, Domain powers with remaining charges and `[Use]` buttons that close the sheet and enter targeting/action mode), and Tactical Stances (Power Attack, Fighting Defensively).
   - **Column 3 (`crpg-sheet-col-equipment-backpack`)**: Equipment Paper Doll (12 anatomical slots, 4 quick weapon sets), Backpack (uniform 5-column dynamic scrollable grid with high-contrast `[a-z]` hotkey badges, load telemetry, gold display, category tabs, sorting dropdown, and full inspection cards).
2. **Tab 2: Progression & Features**:
   - **Column 1 (`crpg-sheet-col-feats-traits`)**: Feats list (with categories and badges) + Class, Domain & Racial Traits.
   - **Column 2 (`crpg-sheet-col-level-matrix`)**: Level Progression (Horizon 1 ledger table: Level, Class/Racial HD, HP gained, Skill points allocated, Feats and features chosen).
3. **Tab 3: Companions & Summons**:
   - Active companions, familiars, cohorts, and summons table queried via `getPlayerCompanions(state, playerId)`: Name, Creature Type/HD, HP Meter, Tactical Stance (`aggressive`, `defensive`, `passive`, `hold`), Spatial Status (Following, distance), and a clean empty state when no companions are summoned.
4. **Direct Terminology**:
   - Strip all verbose, academic, or "Pen and Paper" language: `"Pen & Paper Skills"` → **`SKILLS`**, `"Combat Maneuvers"` → **`MANEUVERS`**, `"Paperdoll & Equipment"` → **`EQUIPMENT`**, `"Full-Attack & Natural Weapon Routine"` → **`ATTACKS`**, `"Level-by-Level Advancement Matrix (Horizon 1)"` → **`LEVEL PROGRESSION`**.

---

## 2. Architectural Standards & Golden Rules Verification

- **ECS Purity (Rule 4, 16):** The Character Sheet UI remains a pure projection of the ECS state and ruleset DAG evaluation (`evaluateDnD35eEntityDAG`, `getDnD35EntityData`, `getPlayerCompanions`). It stores no duplicate gameplay state inside DOM elements.
- **Rule 11 (Zero `any`):** All new interfaces, helper return types, and tab descriptor unions (`SheetTabId = 'character' | 'progression' | 'companions'`) use strict typing with zero `any`.
- **Rule 12 (Zero Magic Numbers):** Stash dimensions (`STASH_GRID_COLS = 5`), tab definitions, and slot identifiers use named constants.
- **Rule 15 (Cascading Effects Across 3 Axes):** All upstream callers (modal opening keys `[C]` / `[I]`, bottom dock button), downstream consumers (tab renders, attack ledgers, inspect cards, tooltips), and lateral mirrors (CSS classes, SSOT registries) are audited in Section 5.
- **Rule 21 (Zero Content-ID Branching):** Condition badges, pool abilities, and feats are rendered generically through their data definitions (`dndData.conditions`, `ResourcePoolComponent`, `systemContent.feats`), with zero hardcoded `if (featId === '...')` or `if (condition === '...')` special-casing in presentation logic.

---

## 3. Component & Module Breakdown

### 3.1 Tab Bar & Shell Orchestration (`src/rendering/ui/dnd35e_sheet.ui.ts`)
- Maintain a local reactive state variable `let currentActiveTab: SheetTabId = 'character';`.
- When rendering `shell`, prepend a standardized CRPG tab header:
  - `[ ⚔ Character ]`
  - `[ 📜 Progression & Features ]`
  - `[ 🐾 Companions (N) ]` (dynamic count indicator)
- Clicking a tab updates `currentActiveTab` and re-renders the active tab content within the shell without rebuilding the entire modal overlay.

### 3.2 Tab 1 — Column 1: Identity, Defenses, Active Conditions, Abilities & Skills (`dnd35e_sheet_overview_tab.ui.ts`)
- **Adventurer Banner:** Name, Title, Alignment, Race, Class/ECL summary, XP bar, HP bar.
- **Defenses & Saves:** AC (Full, Touch, Flat-Footed), Saves (Fort, Ref, Will), BAB, Grapple, Speed, Initiative.
- **Active Conditions Strip:**
  - Evaluates `dndData.conditions` and `StatusEffectsComponent.activeEffects`.
  - When empty: displays `[ Normal ]` or `[ None ]` in muted green.
  - When active: displays crisp condition chips (e.g., `[ Shaken -2 ]`, `[ Fatigued ]`, `[ Entangled ]`, `[ Bless ]`) with tooltips summarizing their exact penalty breakdown (`summarizeConditionEffects`).
- **Ability Scores:** 6 scores (STR, DEX, CON, INT, WIS, CHA) with base score and signed modifier (`+X`).
- **Skills Table:**
  - Filter button (`All Skills` / `Trained Only`).
  - Columns: `CS` (Class Skill indicator), `Skill Name`, `Key` (governing ability), `Total` (signed bonus), `Rnks` (purchased ranks).
  - Scrollable container so it fits cleanly in the bottom half of Column 1 without pushing the column out of view.

### 3.3 Tab 1 — Column 2: Attacks, Maneuvers, Abilities & Pools, Stances (`dnd35e_sheet_attacks_tab.ui.ts`)
- **Attacks & Weapons:**
  - Full-Attack routine chains (Iterative BAB attacks, manufactured + natural off-hands).
  - Damage dice, critical threat/multiplier, damage type.
- **Maneuvers:**
  - Trip (+mod, `[provokes AoO]`), Disarm (+mod, `[vs ATK]`), Sunder (+mod), Bull Rush (+mod), Grapple (+mod).
- **Abilities & Pools (`kind: 'ability'`):**
  - Displays daily resources from `ResourcePoolComponent` (`turn_undead`, `smite_evil`, `rage`, `wild_shape`, `domain_*`).
  - Remaining charges (`current / max`).
  - Clickable `[Use]` button:
    1. Closes the Character Sheet modal via `setGameState(closeCartridgeModal(getGameState()))`.
    2. Queues `IntentType.UseAbility` with `effectId: 'pool:<id>'`.
    3. Triggers presentation updates / targeting reticle if applicable.
- **Stances:**
  - Toggle buttons for active combat stances (Power Attack, Fighting Defensively).

### 3.4 Tab 1 — Column 3: Equipment & Backpack (`dnd35e_sheet_equipment_tab.ui.ts`)
- **Reactive Paper Doll:**
  - 12 anatomical equipment slots (`head`, `neck`, `torso`, `armor`, `cloak`, `arms`, `hands`, `waist`, `legs`, `feet`, `ring_1`, `ring_2`).
  - 4 quick weapon set switcher buttons (`[Set I]`, `[Set II]`, `[Set III]`, `[Set IV]`).
  - Hover tooltips linked to `showConsoleItemInspectCard`.
- **Backpack Grid:**
  - 5 equal columns (`repeat(5, minmax(0, 1fr))`) with dynamic row expansion and vertical scrollbar (`max-height: 280px`).
  - Large, readable slots with `[a-z]` hotkey labels, item icons, and stack counts.
  - Category filters: `[All]`, `[Weapons]`, `[Armor]`, `[Potions]`, `[Scrolls]`, `[Misc]`.
  - Sorting dropdown (`Slot [a-z]`, `Name`, `Weight`, `Value`).
  - Load status (`Light / Medium / Heavy`) and total gold display.

### 3.5 Tab 2: Progression & Features (`dnd35e_sheet_progression_tab.ui.ts`)
- **Column 1 — Feats & Traits:**
  - Complete list of acquired feats with category tags (`[Combat]`, `[Metamagic]`, `[General]`).
  - Class, Domain, and Racial traits (Auras, Turn Undead mastery, Proficiencies, bonus feats).
- **Column 2 — Level Progression Matrix:**
  - Table of historical level gains: `Level`, `Class / HD`, `HP Gained`, `Skill Points Spent`, `Feats & Choices Acquired`.

### 3.6 Tab 3: Companions & Summons (`dnd35e_sheet_companions_tab.ui.ts`)
- Queries active player companions via `getPlayerCompanions(state, playerId)`.
- Renders a clean companion roster table:
  - Companion Name & Title
  - Creature Type & HD / Level
  - Current / Max HP bar
  - Tactical Stance dropdown or badge (`Aggressive`, `Defensive`, `Passive`, `Hold`)
  - Spatial status (Following, tile distance from master)
- If `companions.length === 0`, displays an atmospheric empty state: *"No active animal companions, familiars, cohorts, or summons."*

---

## 4. Anti-Hardcoding & Declarative Purity Audit (Rule 21)

| Feature / Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Active Conditions** | Hardcoding `if (cond === 'shaken') label = '-2 ATK'` in TS | Querying `summarizeConditionEffects(dndData.conditions)` + `state.campaign.status[eff.effectId]` definitions | **YES** — New conditions added in JSON/ruleset automatically project correct badges and penalties |
| **Abilities & Pools** | Hardcoding `if (classId === 'cleric') renderTurnUndead()` | Querying actor's `ResourcePoolComponent.pools` generically | **YES** — Any class, race, or feat adding a pool automatically renders in Column 2 |
| **Combat Maneuvers** | Hardcoded switch on character class | Computing baseline maneuver modifiers via BAB + STR/DEX + Size modifier formula | **YES** — Any actor with BAB/stats computes maneuvers symmetrically |
| **Companions List** | Hardcoding player minion entity IDs | Querying `getPlayerCompanions(state, playerId)` via `ControllerLinkComponent` | **YES** — Any creature linked via `ControllerLinkComponent` appears in the roster |

---

## 5. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Producers) | Downstream (Consumers / Renderers) | Lateral (Sibling Systems / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **Tabbed Modal Shell (`dnd35e_sheet.ui.ts`)** | `dnd35e_ui_registration.ts` (`renderDnD35eSheetModal`), modal manager | Sub-tab renderers (`renderSheetCharacterTab`, `renderSheetProgressionTab`, `renderSheetCompanionsTab`) | Update `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |
| **Active Conditions in Tab 1 Col 1** | `dndData.conditions`, `StatusEffectsComponent` | `dnd35e_sheet_overview_tab.ui.ts`, CSS badge classes | Tooltip inspect card (`console_inspect_card.ui.ts`) |
| **Skills in Tab 1 Col 1** | `UICharacterSheetModel.skillRows` (`dnd35e_ui_char_sheet.ts`) | `dnd35e_sheet_overview_tab.ui.ts` | Relocated out of old `dnd35e_sheet_skills_tab.ui.ts` |
| **Attacks, Maneuvers, Pools in Tab 1 Col 2** | `UICharacterSheetModel.attackGroups`, `ResourcePoolComponent` | `dnd35e_sheet_attacks_tab.ui.ts`, `queuePlayerIntent` | `onExecuteHotbarSlot` parity in `dnd35e_ui_registration.ts` |
| **Equipment & 5-Col Backpack in Tab 1 Col 3** | `UIInventoryModel`, `EquipmentComponent`, `InventoryComponent` | `dnd35e_sheet_equipment_tab.ui.ts`, `renderReactivePaperDollWidget`, `renderCompactStashWidget` | `src/styles/console_prototype.css` (`.crpg-three-col-grid`, `.crpg-stash-matrix-compact`) |
| **Tab 2: Progression & Features** | `dndData.feats`, `dndData.levelHistory`, `systemContent.feats` | `dnd35e_sheet_progression_tab.ui.ts` | Feat inspection tooltips |
| **Tab 3: Companions Roster** | `getPlayerCompanions`, `ControllerLinkComponent`, `FighterComponent` | `dnd35e_sheet_companions_tab.ui.ts` | `companion_commands.system.ts` |

---

## 6. Verification Plan

1. **Strict TypeScript & Build Checks:**
   - `bun x tsc --noEmit`
   - `compile_applet`
   - `lint_applet` (verifying 0 errors and all files under 300 lines)
2. **Automated Regression Suite:**
   - Run `bun test` to ensure all 237+ tests pass.
3. **Manual Test Scenarios:**
   - Open Character Sheet via `[C]` or `[I]`: Verify Tab 1 renders with 3 equal-width columns.
   - Tab 1 Column 1: Check Adventurer stats, Defenses & Saves, Active Conditions (`[ Normal ]`), Ability Scores, and scrollable Skills table with Trained filter.
   - Tab 1 Column 2: Check Attacks & Weapons, Maneuvers table, Abilities & Pools (e.g. Turn Undead 9/9 with `[Use]` button), and Stances.
   - Click `[Use]` on an ability: Verify the Character Sheet closes and the game enters ability execution/targeting mode.
   - Tab 1 Column 3: Check Paper Doll (12 slots, 4 weapon sets) and 5-column Backpack with high-contrast `[a-z]` hotkey labels and sorting.
   - Tab 2: Switch to "Progression & Features", verify Feats/Traits on left and Level Progression ledger table on right.
   - Tab 3: Switch to "Companions", verify active companions or the clean empty state when none are present.
