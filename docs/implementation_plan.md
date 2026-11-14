# Implementation Plan — Standardized Tabbed Character Sheet Overhaul

## 1. Architectural Guardrails & Console/Cartridge Tier Boundary Discipline

### 1.1 Strict Three-Tier Separation (No Cartridge Leaks into Console)
Per the User's explicit instruction (*"Let's just be careful not to leak Cartridge into the Console"*):
- **Tier 1 — Core Console (`src/core/`, `src/systems/`, `src/types/`, generic UI widgets in `src/rendering/ui/console_*.ts`)**:
  - Contains only ruleset-agnostic simulation, ECS data models, input dispatchers, and generic UI widgets (`console_inventory.ui.ts`, `console_inspect_card.ui.ts`, `console_theme.ts`).
  - **Zero Cartridge Imports**: Console modules MUST NEVER import from `src/rulesets/dnd35e/` or `src/rendering/ui/dnd35e_*.ui.ts`.
  - Generic UI components consume only unified view models from `src/types/ui_adapter.types.ts` (`UIInventoryModel`, `UICharacterSheetModel`, `UIInspectData`).
- **Tier 2 — Cartridge UI (`src/rendering/ui/dnd35e_sheet*.ui.ts`, `src/rulesets/dnd35e/ui/`)**:
  - The D&D 3.5e Character Sheet is a registered Cartridge Modal (`modalId: 'character_sheet'`) hosted inside `#dnd35e-sheet-overlay`.
  - Consumes Tier 1 Console widgets (`renderReactivePaperDollWidget`, `renderCompactStashWidget`, `showConsoleItemInspectCard`) by passing pure `UIInventoryModel` instances without altering Console contracts.
  - Queries Tier 2 D&D 3.5e ruleset systems (`evaluateDnD35eEntityDAG`, `getDnD35EntityData`, `summarizeConditionEffects`, `DnD35UIAdapter`) purely within `src/rendering/ui/dnd35e_*.ui.ts` and `src/rulesets/dnd35e/`.

---

## 2. SSOT Ownership & Module Architecture

| Module | Responsibility | Ownership | Line Budget |
| :--- | :--- | :--- | :--- |
| `src/rendering/ui/dnd35e_sheet.ui.ts` | Master Character Sheet Modal Orchestrator: manages active tab state (`'character' \| 'progression' \| 'companions'`), renders the 3-tab bar, and routes to tab views. | `tier2_ui` | < 120 lines |
| `src/rendering/ui/dnd35e_sheet_overview_tab.ui.ts` | **Tab 1 Column 1 (`crpg-sheet-col-identity-skills`)**: Adventurer identity, vitals meters, Defenses & Saves, Active Conditions strip (with tooltips), 6 Ability Scores, and scrollable Skills table with Trained filter. | `tier2_ui` | < 250 lines |
| `src/rendering/ui/dnd35e_sheet_attacks_tab.ui.ts` *(new)* | **Tab 1 Column 2 (`crpg-sheet-col-attacks-abilities`)**: Attacks & Weapons (routine ledger), Maneuvers table, Abilities & Pools with clickable `[Use]` buttons that close the sheet and trigger ability execution/targeting, and Tactical Stances. | `tier2_ui` | < 250 lines |
| `src/rendering/ui/dnd35e_sheet_equipment_tab.ui.ts` *(new)* | **Tab 1 Column 3 (`crpg-sheet-col-equipment-backpack`)**: Reactive Paper Doll (12 slots, 4 weapon sets) + uniform 5-column dynamic scrollable Backpack grid with `[a-z]` key badges, category filters, and sorting. | `tier2_ui` | < 200 lines |
| `src/rendering/ui/dnd35e_sheet_progression_tab.ui.ts` *(new)* | **Tab 2 (`Progression & Features`)**: 2 wide columns displaying Feats & Traits on the left, and the Horizon 1 Level-by-Level Matrix on the right. | `tier2_ui` | < 220 lines |
| `src/rendering/ui/dnd35e_sheet_companions_tab.ui.ts` *(new)* | **Tab 3 (`Companions & Summons`)**: Table of player-controlled companions via `getPlayerCompanions` with stance, HP, status, and clean empty state. | `tier2_ui` | < 160 lines |
| `src/styles/console_prototype.css` | Styling for the 3-tab bar, 3 equal columns (`repeat(3, 1fr)`), active condition chips, and typography hierarchy. | `styles` | — |

*Note: Existing legacy files `dnd35e_sheet_feats_abilities_tab.ui.ts` and `dnd35e_sheet_skills_tab.ui.ts` will have their responsibilities cleanly migrated to the modular tab files above, ensuring every file stays strictly below the 300-line limit.*

---

## 3. Step-by-Step Implementation Details

### Step 1: Active Tab Orchestration & Tab Bar (`src/rendering/ui/dnd35e_sheet.ui.ts`)
1. Define the discriminated union of tabs:
   ```ts
   export type SheetTabId = 'character' | 'progression' | 'companions';
   let currentSheetTab: SheetTabId = 'character';
   ```
2. Render a sleek CRPG tab strip above the tab content:
   - `[ ⚔ Character ]`
   - `[ 📜 Progression & Features ]`
   - `[ 🐾 Companions (${companionCount}) ]`
3. Route rendering based on `currentSheetTab`:
   - `'character'`: Renders a 3-equal-width column grid (`.crpg-three-col-grid`), invoking:
     - `renderSheetOverviewTab(grid, liveState, playerId, evalResult, sheetModel)` (Col 1)
     - `renderSheetAttacksTab(grid, liveState, playerId, sheetModel)` (Col 2)
     - `renderSheetEquipmentTab(grid, liveState, playerId, invData)` (Col 3)
   - `'progression'`: Renders `renderSheetProgressionTab(shell, liveState, playerId, sheetModel, dndData)`.
   - `'companions'`: Renders `renderSheetCompanionsTab(shell, liveState, playerId)`.

### Step 2: Tab 1 Column 1 — Identity, Defenses, Active Conditions & Skills (`dnd35e_sheet_overview_tab.ui.ts`)
1. **Adventurer Identity & Vitals**: Name, Alignment, Race, Class/ECL summary, XP bar, and HP meter.
2. **Defenses & Saves**: AC (Full, Flat-footed, Touch), Saves (Fort, Ref, Will), BAB, Grapple, Speed, Initiative.
3. **Active Conditions Strip**:
   - Query `dndData.conditions` and `StatusEffectsComponent.activeEffects`.
   - If empty: render `<span class="crpg-condition-chip normal">[ Normal ]</span>`.
   - If non-empty: render interactive chips `<span class="crpg-condition-chip debuff">[ Shaken -2 ]</span>` with tooltip on hover displaying penalty breakdown from `summarizeConditionEffects`.
4. **Ability Scores**: STR, DEX, CON, INT, WIS, CHA with base score and signed modifier.
5. **Skills**:
   - Direct heading: `SKILLS`.
   - Filter toggle: `[ All Skills / Trained Only ]`.
   - Compact table in scrollable wrapper: `CS`, `Skill Name`, `Key`, `Total`, `Rnks`.

### Step 3: Tab 1 Column 2 — Attacks, Maneuvers, Abilities & Pools (`src/rendering/ui/dnd35e_sheet_attacks_tab.ui.ts`)
1. **Attacks & Weapons**:
   - Full-Attack routine chains from `sheetModel.attackGroups`.
   - Damage formula, critical threats, and damage types.
2. **Maneuvers**:
   - Trip (+mod, `[provokes]`), Disarm (+mod, `[vs ATK]`), Sunder (+mod), Bull Rush (+mod), Grapple (+mod).
3. **Abilities & Pools**:
   - Direct heading: `ABILITIES & POOLS`.
   - Daily charges from `ResourcePoolComponent` (`turn_undead`, `smite_evil`, `rage`, `wild_shape`, `domain_*`).
   - Clickable `[Use]` button:
     ```ts
     useBtn.addEventListener('click', () => {
       // 1. Close the modal
       setGameState(closeCartridgeModal(getGameState()));
       // 2. Dispatch the ability intent
       queuePlayerIntent({
         type: IntentType.UseAbility,
         entityId: playerId,
         effectId: `pool:${poolId}`,
         abilityName: entry.label ?? poolId
       });
       markAllDomainsDirty();
     });
     ```
4. **Stances**:
   - Direct heading: `STANCES`.
   - Toggles for Power Attack, Fighting Defensively.

### Step 4: Tab 1 Column 3 — Equipment & Uniform 5-Col Backpack (`src/rendering/ui/dnd35e_sheet_equipment_tab.ui.ts`)
1. **Reactive Paper Doll**:
   - Render 12 anatomical slots (`head`, `neck`, `torso`, `armor`, `cloak`, `arms`, `hands`, `waist`, `legs`, `feet`, `ring_1`, `ring_2`).
   - 4 quick weapon set switcher buttons (`[Set I]`–`[Set IV]`).
2. **Backpack**:
   - Direct heading: `BACKPACK`.
   - Load telemetry (`Light / Medium / Heavy`) and total gold display.
   - Category filter tabs (`[All]`, `[Wpn]`, `[Arm]`, `[Pot]`, `[Scr]`, `[Key]`).
   - Sort dropdown (`Slot [a-z]`, `Name`, `Weight`, `Value`).
   - Dynamic 5-column grid with vertical scrollbar:
     - High-contrast `[a-z]` hotkey badge in top-left of occupied cells.
     - Hover inspection linked to `showConsoleItemInspectCard`.

### Step 5: Tab 2 — Progression & Features (`src/rendering/ui/dnd35e_sheet_progression_tab.ui.ts`)
1. **Column 1 — Feats & Traits**:
   - Acquired feats with category tags (`[Combat]`, `[Metamagic]`, `[General]`).
   - Class, Domain, and Racial traits (Auras, Turn Undead progression, proficiencies).
2. **Column 2 — Level Progression Matrix**:
   - Direct heading: `LEVEL PROGRESSION`.
   - Horizon 1 ledger table: `Level`, `Class / HD`, `HP Gained`, `Skill Points`, `Feats & Features Acquired`.

### Step 6: Tab 3 — Companions & Summons (`src/rendering/ui/dnd35e_sheet_companions_tab.ui.ts`)
1. Query companions via `getPlayerCompanions(state, playerId)`.
2. Render table:
   - Companion Name & Title
   - Creature Type / HD
   - HP Bar
   - Stance Badge (`Aggressive`, `Defensive`, `Passive`, `Hold`)
   - Status / Distance (`Following (Adjacent)`, `Following (3 tiles)`)
3. Atmospheric empty state if `companions.length === 0`:
   - *"No active animal companions, familiars, cohorts, or summons."*

### Step 7: CSS & Typographic Standards (`src/styles/console_prototype.css`)
1. Enforce strict 3 equal columns:
   ```css
   .crpg-three-col-grid {
     display: grid;
     grid-template-columns: 1fr 1fr 1fr;
     gap: 12px;
     height: 100%;
     min-height: 0;
   }
   ```
2. Tab bar styling:
   ```css
   .crpg-sheet-tab-bar {
     display: flex;
     gap: 8px;
     margin-bottom: 12px;
     border-bottom: 1px solid var(--border-color, #45475a);
     padding-bottom: 6px;
   }
   .crpg-sheet-tab-btn {
     font-family: 'Cinzel', serif;
     font-weight: 600;
     padding: 6px 14px;
     border-radius: 4px;
     background: transparent;
     color: #a6adc8;
     cursor: pointer;
   }
   .crpg-sheet-tab-btn.active {
     background: #313244;
     color: #cdd6f4;
     border-bottom: 2px solid #89b4fa;
   }
   ```
3. Condition chips styling:
   ```css
   .crpg-conditions-strip {
     display: flex;
     flex-wrap: wrap;
     gap: 4px;
     margin: 6px 0;
   }
   .crpg-condition-chip {
     font-family: 'JetBrains Mono', monospace;
     font-size: 0.65rem;
     padding: 2px 6px;
     border-radius: 3px;
     font-weight: 600;
   }
   .crpg-condition-chip.normal {
     background: rgba(166, 227, 161, 0.15);
     color: #a6e3a1;
     border: 1px solid rgba(166, 227, 161, 0.3);
   }
   .crpg-condition-chip.debuff {
     background: rgba(243, 139, 168, 0.15);
     color: #f38ba8;
     border: 1px solid rgba(243, 139, 168, 0.3);
     cursor: help;
   }
   ```

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Producers) | Downstream (Consumers / Renderers) | Lateral (Sibling Systems / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **Tabbed Modal Shell (`dnd35e_sheet.ui.ts`)** | `dnd35e_ui_registration.ts`, `modal_manager.ts`, `modal_input.ts` (`[C]` / `[I]`) | `renderSheetOverviewTab`, `renderSheetAttacksTab`, `renderSheetEquipmentTab`, `renderSheetProgressionTab`, `renderSheetCompanionsTab` | Update `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |
| **Tab 1 Column 1: Identity, Conditions & Skills** | `dndData.conditions`, `StatusEffectsComponent`, `dnd35e_ui_char_sheet.ts` | `dnd35e_sheet_overview_tab.ui.ts` | `console_inspect_card.ui.ts` |
| **Tab 1 Column 2: Attacks, Maneuvers & Pool Abilities** | `sheetModel.attackGroups`, `ResourcePoolComponent`, `TacticalDoctrineComponent` | `dnd35e_sheet_attacks_tab.ui.ts`, `queuePlayerIntent` | `pool_ability_resolver.ts`, `dnd35e_ruleset.ts` |
| **Tab 1 Column 3: Paper Doll & 5-Col Backpack** | `UIInventoryModel`, `EquipmentComponent`, `InventoryComponent` | `dnd35e_sheet_equipment_tab.ui.ts`, `console_inventory.ui.ts` | `src/styles/console_prototype.css` |
| **Tab 2: Progression & Features** | `dndData.feats`, `dndData.levelHistory`, `systemContent.feats` | `dnd35e_sheet_progression_tab.ui.ts` | `dnd35e_feat_spell_inspector.ui.ts` |
| **Tab 3: Companions Roster** | `getPlayerCompanions`, `ControllerLinkComponent`, `FighterComponent` | `dnd35e_sheet_companions_tab.ui.ts` | `companion_commands.system.ts` |

---

## 5. Anti-Hardcoding & Declarative Purity Audit (`AGENTS.md` Rule 21)

| Feature / Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Active Conditions** | Hardcoding `if (cond === 'shaken')` labels in TS | Querying `summarizeConditionEffects(dndData.conditions)` + `state.campaign.status` definitions | **YES** — New conditions added in JSON/ruleset automatically project correct badges and penalties |
| **Abilities & Pools** | Hardcoding `if (classId === 'cleric') renderTurnUndead()` | Querying actor's `ResourcePoolComponent.pools` generically | **YES** — Any class, race, or feat adding a pool automatically renders in Column 2 |
| **Combat Maneuvers** | Hardcoded switch on character class | Computing baseline maneuver modifiers via BAB + STR/DEX + Size modifier formula | **YES** — Any actor with BAB/stats computes maneuvers symmetrically |
| **Companions List** | Hardcoding player minion entity IDs | Querying `getPlayerCompanions(state, playerId)` via `ControllerLinkComponent` | **YES** — Any creature linked via `ControllerLinkComponent` appears in the roster |

---

## 6. Verification Pipeline

We will execute the complete 8-stage verification pipeline upon completion:
1. `bun x tsc --noEmit`
2. `bun run format`
3. `bun run lint --fix`
4. `bun run lint:arch`
5. `bun run lint:deadcode`
6. `bun test` (all 237+ tests passing)
7. `bun run build`
8. `bun run scripts/run-validator.ts`
All files will be verified to sit strictly below 300 lines with zero `any` and zero magic values.
