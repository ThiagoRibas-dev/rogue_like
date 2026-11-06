# Implementation Plan: Direct Live Integration of Consolidated 3-Column Character Sheet, Reactive Anatomy & Compact Stash

## 1. Summary of Changes

1. **Remove Standalone Prototype Button & Modal:**
   - Remove the `dnd35e_ui_prototype` (`[🎨 UI Prototype]`) dock command and `ui_prototype` modal entry from `src/rendering/ui/dnd35e_ui_adapter.ts`.
   - Remove `#ui-prototype-overlay` from `index.html`.
   - Delete `src/rendering/ui/console_prototype_modal.ui.ts` and remove its entry from `docs/ssot/ssot_console.json`.

2. **Expand `src/types/ui_adapter.types.ts` with Reactive Anatomy, Attack Routine & Progression Models:**
   ```ts
   export interface UIAnatomicalSlotDescriptor {
     readonly slotId: string;
     readonly slotType: string;
     readonly label: string;
     readonly emptyGlyph: string;
     readonly rail: 'left' | 'right' | 'extra';
     readonly status: 'normal' | 'occupied_2h' | 'melded' | 'extra_limb';
     readonly statusBadge?: string;
     readonly equippedItem: UIInventoryItem | null;
   }

   export interface UIAttackGroupModel {
     readonly id: string;
     readonly label: string;
     readonly limbSource: string;
     readonly category: 'manufactured_primary' | 'manufactured_offhand' | 'natural_primary' | 'natural_secondary';
     readonly iterativeBonuses: string;
     readonly damageFormula: string;
     readonly critProfile: string;
     readonly specialEffects: ReadonlyArray<string>;
     readonly iconGlyph: string;
   }

   export interface UISkillRowModel {
     readonly id: string;
     readonly name: string;
     readonly abilityKey: string;
     readonly totalModifier: number;
     readonly ranks: number;
     readonly abilityMod: number;
     readonly miscMod: number;
     readonly isClassSkill: boolean;
     readonly isUsableActive?: boolean;
   }

   export interface UIFeatureEntryModel {
     readonly id: string;
     readonly name: string;
     readonly category: 'feat' | 'class_feature' | 'domain' | 'trait' | 'condition';
     readonly detail: string;
   }

   export interface UILevelHistoryRowModel {
     readonly level: number;
     readonly classOrHdLabel: string;
     readonly hpRolled: number;
     readonly skillPointsSpent: number;
     readonly choicesSummary: string;
   }
   ```

3. **Upgrade Live Character Sheet (`[C] Sheet` — `src/rendering/ui/dnd35e_sheet.ui.ts`) to the Consolidated 3-Column Parchment Master Dossier:**
   - **Left Column (`310px` — Identity + Reactive Anatomy Paper Doll + Core Defenses, matching `image_de4cde50.png`):**
     - **Identity & Ability Scores:** Live character name, class/level summary, XP progress (`xp / nextThreshold`), framed Portrait with `♥ HP` overlay, Alignment, Race/Creature Type, and 6-row Ability Scores (`STR`–`CHA` score + DAG modifier).
     - **Live Reactive Anatomical Paper Doll (`renderReactivePaperDollWidget`):**
       - Reads the actor's live `EquipmentComponent.slots` (`EquipmentSlotInstance[]`).
       - Places the standard 12 humanoid slots on the Left/Right rails (`38×38px` compact sockets) around the central archway.
       - **Reactive Deviations:**
         - Missing body parts (e.g., Quadruped/Beast) are omitted automatically instead of showing fake humanoid slots.
         - Melded/suppressed slots (`suppressed: true`, e.g., Wild Shape) show a `🔒 Melded` badge.
         - Two-handed weapon off-hand occupation (`occupiedBySlotId`) shows a `🔗 2H Grip` link.
         - Extra/repeated body parts (e.g., 6-armed Marilith `main_hand_2..6`, multi-head, or tail slot) automatically populate an **Extra Anatomy / Multi-Limb Strip** beneath the archway!
       - Clicking an equipped slot dispatches `createUnequipItemAction`; hovering shows the floating **NWN2 Examine Card (`showConsoleItemInspectCard`)**.
     - **Bottom Defense Strip:** Live DAG-evaluated `AC`, `Flat-Footed AC`, `Touch AC`, `Fortitude`, `Reflex`, `Will`, `Initiative`, `BAB`, `Grapple`, and `Speed`.
   - **Center Column (`450px` — Multi-Weapon/Natural Attack Routine, Feats/Class Features & Level-by-Level Matrix):**
     - **Section 1 — Full-Attack & Natural Weapon Routine Table:** Synthesizes all strikes from `dag.attackRoutine.strikes` into grouped weapon/limb rows (`Primary Iterative +14/+9/+4`, `Off-Hand +12/+7`, `Extra Limbs`, `Primary Natural Bite`, `Secondary Natural Claws/Tail`), showing iterative bonuses, damage formula, critical threat/multiplier, grip mode, and special properties.
     - **Section 2 — Feats, Class Features, Domains & Conditions:** Categorized Pen-and-Paper table of all granted Feats, active Class Features & Scaling Pools (`collectActiveClassFeaturesAndPools`), Cleric Domains, and Active Status Conditions.
     - **Section 3 — Horizon 1 Level-by-Level Progression Matrix (`dndData.levelHistory`):** Scrollable tabletop ledger (`Lvl | Class / RHD | HP | Skill Pts | Feats & Features Gained`).
   - **Right Column (`1fr` — Pen-and-Paper Skills Table + Compact `36×36px` Live Backpack/Stash):**
     - **Top Half — Pen-and-Paper Skills Ledger:** Filterable (`[All Skills]` vs `[Trained Only]`) tabletop table (`Class? ■/□ | Skill | Key | Total | Ranks | Mod | Synergy`) with inline **`[Use]`** buttons for active skills (`queuePlayerIntent(createUseSkillAction(...))`).
     - **Bottom Half — Compact `36×36px` Backpack & Shared Stash Grid (`10 columns × 4 rows`):**
       - Reads the player's live `InventoryComponent.items`.
       - Inline Category Filter pills (`✦ All`, `⚔️ Weapons`, `🛡️ Armor`, `💍 Accessories`, `🧪 Potions/Scrolls`, `🗝️ Misc`) + Sort dropdown (`Price`, `Name`, `Weight`).
       - `36×36px` square sockets with hotkey badge (`a`–`z`), stack quantity, hover Examine popover, and click-to-equip/use (`createEquipItemAction` / `createUseItemAction`).

4. **Upgrade Live Inventory Modal (`[I] Pack` — `src/rendering/ui/inventory.ui.ts`):**
   - Uses the same `renderReactivePaperDollWidget` and compact `36×36px` `renderCompactStashWidget` from `src/rendering/ui/console_inventory.ui.ts`, automatically adapting its skin token (`parchment` for `dnd35e`, `retro-crt` for `classic` / sci-fi campaigns).

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner | Evicted / Updated Legacy Files |
| :--- | :--- | :--- |
| Reactive Anatomical Paper Doll & Compact `36×36px` Stash Grid | `src/rendering/ui/console_inventory.ui.ts` | Evicts `src/rendering/ui/console_prototype_modal.ui.ts` |
| Consolidated 3-Column D&D 3.5e Character Sheet (`[C] Sheet`) | `src/rendering/ui/dnd35e_sheet.ui.ts` + helper `dnd35e_sheet_overview_tab.ui.ts`, `dnd35e_sheet_skills_tab.ui.ts`, `dnd35e_sheet_feats_abilities_tab.ui.ts` | Replaces old 3-tab dark layout with unified 3-column Parchment Master Dossier |
| Cartridge UI Adapter Models (Anatomy, Attack Groups, Skills, Level Matrix) | `src/types/ui_adapter.types.ts`, `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts`, `src/rulesets/default/ui/default_ui_adapter.ts` | Updated with reactive `anatomicalSlots` and `attackGroups` |

---

## 3. Cascading Effects Matrix

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| Remove `ui_prototype` modal & delete `console_prototype_modal.ui.ts` | `src/rendering/ui/dnd35e_ui_adapter.ts`, `index.html` | `cartridge_ui_registry.ts` | `tests/dnd35e_phase26_ui_and_showcase.test.ts`, `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md` |
| Expand `UICharacterSheetModel` & `UIInventoryModel` in `src/types/ui_adapter.types.ts` | `DnD35UIAdapter`, `DefaultSciFiUIAdapter` | `console_inventory.ui.ts`, `dnd35e_sheet.ui.ts`, `inventory.ui.ts` | `tests/console_ui_architecture.test.ts`, `docs/UI_UX_STANDARDS.md` |
| Replace 3-tab `dnd35e_sheet.ui.ts` with Consolidated 3-Column Master Dossier | `renderDnD35eSheetModal` (`[C] Sheet`) | `#dnd35e-sheet-body`, `dnd35e_sheet_*.ui.ts`, `src/styles/console_prototype.css` | `tests/dnd35e_phase26_ui_and_showcase.test.ts` |
