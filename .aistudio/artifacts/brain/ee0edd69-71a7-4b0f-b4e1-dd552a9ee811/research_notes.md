# Research Notes: Direct Live Integration of Consolidated CRPG + Pen-and-Paper Sheet, Reactive Anatomy & Multi-Attack Routine

## 1. User Directive & Scope Shift
- **Directive:** Remove the standalone `[🎨 UI Prototype]` button and `#ui-prototype-overlay` modal, and apply the consolidated high-density Parchment / Retro-CRT layout directly to the **live game layout** (`#dnd35e-sheet-overlay` `[C] Sheet` and `#inventory-overlay` `[I] Pack`).
- **Core Goals:**
  1. Shrink oversized inventory cells to compact `36×36px` sockets (`10 columns × 4 rows`) with inline category filter pills and sort controls.
  2. Consolidate **Character Identity + 6 Ability Scores + Reactive Anatomical Paper Doll + AC/Saves Defense Strip** into the Left Column (`310px`), matching the user's mockup (`image_de4cde50.png`).
  3. Fill the Center (`460px`) and Right (`1fr`) columns with rich, live Pen-and-Paper + CRPG data:
     - **Full-Attack & Natural Weapon Routine Ledger** (all iterative strikes, off-hand weapons, extra limbs, and primary/secondary natural weapons from `dag.attackRoutine.strikes`).
     - **Feats, Class Features, Domains & Active Conditions** (from `dndData.feats`, `collectActiveClassFeaturesAndPools`, `dndData.domains`, and `StatusEffects`).
     - **Horizon 1 Level-by-Level Progression Matrix** (from `dndData.levelHistory`).
     - **Pen-and-Paper Skills Table** (`Class? | Skill | Key | Total | Ranks | Mod | Synergy` + active `[Use]` button) stacked above the **Compact Backpack/Stash Grid** (with live Equip/Unequip/Use/Drop intents).
  4. Make the **Equipment / Paper Doll section** dynamically reactive to `EquipmentComponent.slots` (`EquipmentSlotInstance[]`):
     - Default 12-slot humanoid arrangement around the central archway.
     - Reactively handles missing body parts (Quadruped/Beast), melded/suppressed slots (`suppressed: true` -> `🔒 Melded`), 2H weapon grip occupation (`occupiedBySlotId` -> `🔗 2H Grip`), and repeated extra body parts (e.g., 6-armed Marilith or multi-limb mutations rendered in an **Extra Anatomy / Multi-Limb Drawer**).

---

## 2. Existing Live Files & SSOT Ownership Audit

| File | Current Role | Planned Live Integration Action |
| :--- | :--- | :--- |
| `index.html` | Contains `#dnd35e-sheet-overlay`, `#inventory-overlay`, and temporary `#ui-prototype-overlay` | Remove `#ui-prototype-overlay`. Expand `#dnd35e-sheet-overlay` to host the 3-column Parchment/CRT Master Dossier. |
| `src/rendering/ui/dnd35e_ui_adapter.ts` | Registers `dnd35eUIDefinition` (`character_sheet`, `spellbook`, `level_up`, `ui_prototype`) | Remove `dnd35e_ui_prototype` dock command and `ui_prototype` modal entry. |
| `src/rendering/ui/console_prototype_modal.ui.ts` | Standalone prototype showcase modal | **Evict / Delete** (no longer needed once live sheet & inventory use the unified components). Update `docs/ssot/ssot_console.json`. |
| `src/rendering/ui/dnd35e_sheet.ui.ts` | Old 3-tab dark modal (`1. Combat & Attributes`, `2. Skills`, `3. Feats & Features`) | Replace with the **Consolidated 3-Column Master Dossier** (Left: Identity + Reactive Paper Doll + Defenses; Center: Full Attack Routine + Feats/Class Features + Level History Matrix; Right: Pen & Paper Skills Table + Compact `36×36px` Live Backpack/Stash). |
| `src/rendering/ui/console_inventory.ui.ts` | Renders Paper Doll & Stash Grid | Refactor into two composable Console primitives: `renderReactivePaperDollWidget` (driven by `UIAnatomicalSlotDescriptor[]` derived from live `EquipmentSlotInstance[]`) and `renderCompactStashWidget` (`10×4` `36×36px` sockets wired to live Equip/Use intents and Examine hover cards). |
| `src/rendering/ui/inventory.ui.ts` | Standalone `[I] Pack` modal | Wire `renderReactivePaperDollWidget` and `renderCompactStashWidget` so `[I] Pack` also benefits from the reactive anatomy paper doll and compact `36×36px` stash grid. |

---

## 3. Cascading Effects Matrix

| Change | Upstream (Callers / Producers) | Downstream (Consumers / Renderers) | Lateral (Siblings / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| Remove `ui_prototype` modal & `console_prototype_modal.ui.ts` | `src/rendering/ui/dnd35e_ui_adapter.ts`, `index.html` | `cartridge_ui_registry.ts` | `tests/dnd35e_phase26_ui_and_showcase.test.ts`, `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md` |
| Expand `UICharacterSheetModel` & `UIInventoryModel` in `src/types/ui_adapter.types.ts` (`anatomicalSlots`, `attackGroups`, `levelHistory`, `skillRows`, `featureBadges`) | `DnD35UIAdapter`, `DefaultSciFiUIAdapter`, live `GameState` hydrator in `dnd35e_sheet.ui.ts` | `dnd35e_sheet.ui.ts`, `console_inventory.ui.ts`, `inventory.ui.ts` | `tests/console_ui_architecture.test.ts`, `docs/UI_UX_STANDARDS.md` |
| Upgrade `dnd35e_sheet.ui.ts` to Consolidated 3-Column Parchment Master Dossier | `renderDnD35eSheetModal` in `src/rendering/ui/dnd35e_ui_adapter.ts` | `#dnd35e-sheet-body`, `queuePlayerIntent` (Equip, Unequip, UseItem, UseSkill) | `dnd35e_sheet_overview_tab.ui.ts`, `dnd35e_sheet_skills_tab.ui.ts`, `dnd35e_sheet_feats_abilities_tab.ui.ts` |
