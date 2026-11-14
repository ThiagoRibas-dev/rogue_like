# Research Notes — Phase 33 Post-Implementation Audit & 3 Gameplay/UI Bug Investigations

## 1. Executive Summary & Audit of Phase 33 / Milestone 133

### 1.1 Phase 33 / Milestone 133 Implementation Audit
We audited all files touched in Phase 33 (**Entity-Agnostic Console Turn Model, Cartridge Action Economy & Per-Entity Action Budgets**):
- **Tier 1 Console Agnosticism (`src/types/ruleset.types.ts`, `src/systems/lifecycle.system.ts`, `src/actions/action.registry.ts`, `src/core/loop/intent_cost_resolver.ts`, `src/core/game-loop.ts`, `src/core/scheduler.ts`)**:
  - Zero `if (isPlayer)` action-economy or turn-continuation branches remain in Console turn orchestration.
  - All entities (Player, hostile monsters, companions, and summons) pass through the identical 5-hook cartridge lifecycle (`onActorTurnStart` → `resolveActionCost` → `onPostActionBudget` → `canContinueTurn` → `onActorTurnEnd`).
  - `verify.sh` passes all 8 stages (`237/237` tests in `bun test`, `0` TypeScript errors, `0` architectural lint errors, `0` deadcode errors, `0` validator/SSOT parity errors).
- **Audit Finding — 2 Advisory ESLint `max-lines` Warnings**:
  - `lint_applet` reported 0 errors and 2 advisory `max-lines` warnings (>300 lines of code):
    1. `src/rulesets/dnd35e/action_economy.ts` (313 lines vs. 300 max)
    2. `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (408 lines vs. 300 max)
  - **Remediation Plan**: Extract the per-entity turn-budget lifecycle helpers from `dnd35e_lifecycle_adapter.ts` and `action_economy.ts` into a dedicated helper module (`src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts`) so every file sits well below 300 lines with 0 ESLint warnings.

---

## 2. Bug 1 Investigation: "Turn Undead is a stance."

### 2.1 Root Cause Analysis
1. **Unconditional Projection of `ResourcePoolComponent` into `stanceModes` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts` lines 92–101)**:
   In `buildActorStanceModes`:
   ```ts
   if (resourcePools) {
     for (const [id, entry] of Object.entries(resourcePools.pools)) {
       if (entry.max <= 0) continue;
       modes.push({
         id: `pool:${id}`,
         label: `${entry.label ?? id.replace(/_/g, ' ')} (${entry.current}/${entry.max})`,
         isActive: entry.current > 0
       });
     }
   }
   ```
   Every entry in an actor's `ResourcePoolComponent` (`turn_undead`, `rage`, `smite_evil`, `lay_on_hands`, `domain_greater_turning`, `domain_destruction_smite`, `domain_turn_air`, `domain_protective_ward`, etc.) is unconditionally pushed into `stanceModes` (the **Stances & Combat Modes** strip above the hotbar) with `isActive: entry.current > 0`.
2. **Broken Click Handler (`src/rulesets/dnd35e/ui/dnd35e_ui_registration.ts` line 200)**:
   When the player clicks `◉ Turn or Rebuke Undead (5/5)` in the Stances bar, `onToggleStance` sees `stanceId.includes(':')` (`'pool:turn_undead'`) and calls `toggleConsoleStanceGroup(docComp, 'pool', 'turn_undead', false)` — treating `pool` as a radio-button stance group in `TacticalDoctrineComponent.activeStances` without expending a charge from `ResourcePoolComponent`, without spending a Standard Action, and without resolving Turn Undead.
3. **Missing Hotbar Projection & Execution for Activated Class/Domain Abilities**:
   `buildActorHotbarSlots` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts` lines 139–260) currently populates hotbar slots from:
   1. Equipped Weapons (`kind: 'weapon'`)
   2. Prepared / Spontaneous Spells (`kind: 'spell'`)
   3. Active Skills (`kind: 'skill'`)
   4. Consumables (`kind: 'item'`)
   Even though `UIHotbarSlot['actionPayload']` (`src/types/ui_adapter.types.ts` line 199) already defines `kind: 'ability'`, `buildActorHotbarSlots` never projects `ResourcePoolComponent` abilities into hotbar slots, and `onExecuteHotbarSlot` (`dnd35e_ui_registration.ts` line 229) has no branch for `payload.kind === 'ability'`.

### 2.2 Architectural Classification (`AGENTS.md` Rule 19 & Rule 21)
- **Layer C (`ResourcePoolComponent`) + Layer D (Domain Resolver)**:
  - Turn/Rebuke Undead (`poolId: 'turn_undead'`) and other daily-use class/domain pools (`lay_on_hands`, `smite_evil`, `rage`, `domain_*`) are **activated abilities** with daily charges (`current / max`), **not** persistent modal stances like *Power Attack*, *Combat Expertise*, *Fighting Defensively*, or *Total Defense*.
  - `buildActorStanceModes` must only project true toggleable combat stances/modes.
  - `buildActorHotbarSlots` should project `ResourcePoolComponent` entries as `kind: 'ability'` hotbar slots showing remaining charges (`entry.current / entry.max`), and `onExecuteHotbarSlot` should execute them (expending 1 charge via `consumeResourcePool`, consuming the appropriate action cost from `actionBudget`, and resolving the ability—including a D&D 3.5e 60-ft burst Turn/Rebuke Undead resolver against undead actors in line of effect).
  - Additionally, `executeSpellbookRest` (`src/rendering/ui/dnd35e_spellbook_actions.ts`) should invoke `refreshResourcePools(state, playerId, 'rest_8h')` so daily pools (`turn_undead`, `rage`, `lay_on_hands`, etc.) recharge on an 8-hour rest.

---

## 3. Bug 2 Investigation: "Can only memorize spells from one of two domains in the domain spell slot."

### 3.1 Root Cause Analysis
1. **Asymmetric Representation of Domain Spells in System JSON (`domains/*.json` vs. `spells/*.json`)**:
   - Every domain definition in `public/data/rulesets/dnd35e/domains/<domainId>.json` defines its complete 1st–9th level spell list in `domainSpells: Record<string, string>` (e.g., `protection.json` has `"1": "sanctuary"`, `"2": "shield_other"`, `"3": "protection_from_energy"`).
   - However, in `public/data/rulesets/dnd35e/spells/<spellId>.json`, almost all spell files have an **empty** `"levelByDomain": {}` object! Only ~10 spells across the entire registry (such as `cure_light_wounds`, `cure_serious_wounds`, `burning_hands`, `spiritual_weapon`, `produce_flame`, `enlarge_person`, `inflict_moderate_wounds`, `desecrate`) populate `levelByDomain`.
2. **Split-Brain Domain Lookup in UI & Progression vs. Slot Validator**:
   - `src/rulesets/dnd35e/magic/spellbook_slots.ts` (`resolveSpellLevelForClass`, lines 242–255) checks **both** `spDef.levelByDomain?.[domId]` **and** `sys?.domains?.[domId]?.domainSpells?.[String(spellLevel)] === spellId`.
   - **By contrast, three upstream modules only check `spell.levelByDomain[domId]` and ignore `sys.domains[domId].domainSpells`**:
     1. **`src/rendering/ui/dnd35e_spellbook_known.ui.ts` (lines 54–60 & line 118)**:
        - Line 54: When collecting `spellsAtLevel` for `sum.spellLevel`, if a domain spell is not on the Cleric class list at `sum.spellLevel` (or is an arcane spell granted by a domain like *Magic Aura*, *Identify*, *Fly*, *Fireball*, *Stoneskin*), it checks `if (sp.levelByDomain[domId] === sum.spellLevel)`. Because `sp.levelByDomain` is `{}` for most spells, non-Cleric domain spells don't even appear in the right pane!
        - Line 52: Furthermore, if a spell IS on the Cleric spell list at a *different* level than its domain level, `if (clsLvl === sum.spellLevel)` is an `if / else if` that short-circuits before checking whether the spell is also a domain spell at `sum.spellLevel`.
        - **Line 118 (The Direct Cause of the Bug)**:
          ```ts
          const isDomainSpell = dndData.domains?.some((domId: string) => sp.levelByDomain?.[domId] === sum.spellLevel);
          ```
          Because `sp.levelByDomain` is `{}` for almost all spells outside the `healing` / `fire` domains, `isDomainSpell` evaluates to `false` for the Cleric's other domain! When `isDomainSpell` is `false`:
          - The `[+ Dom]` button is never rendered (line 137: `if (hasOpenDomain && isDomainSpell)`).
          - Clicking the spell row when only the `+1 Domain` slot is open refuses to prepare the spell into the `'domain'` slot (`const targetKind = hasOpenStandard ? 'standard' : hasOpenDomain && isDomainSpell ? 'domain' : null;`).
     2. **`src/rulesets/dnd35e/progression/ledger_features_spells.ts` (lines 154–160)**:
        `buildActorSpellbooksByClass` only checks `spell.levelByDomain[domId]` when adding domain spells to a Cleric's `knownSpellIds`.
     3. **`src/rulesets/dnd35e/builder/builder_spell_eligibility.ts` (lines 60–65)**:
        `resolveSpellLevelForClass` only checks `spell.levelByDomain[domId]` without checking `sysContent.domains[domId]?.domainSpells`.

### 3.2 Canonical Fix
- Extract a single canonical helper in `src/rulesets/dnd35e/magic/spellbook_slots.ts` (or `builder_spell_eligibility.ts`):
  - `isActorDomainSpellAtLevel(spellId: string, spellDef: DnD35SpellDefinition | undefined, spellLevel: number, actorDomains: ReadonlyArray<string>, domainRegistry: Readonly<Record<string, DnD35DomainDefinition>> | undefined): boolean`
  - Returns `true` if for any `domId` in `actorDomains`, either `spellDef?.levelByDomain?.[domId] === spellLevel` OR `domainRegistry?.[domId]?.domainSpells?.[String(spellLevel)] === spellId`.
- Replace all ad-hoc `sp.levelByDomain?.[domId]` checks in `dnd35e_spellbook_known.ui.ts`, `ledger_features_spells.ts`, and `builder_spell_eligibility.ts` with this canonical helper so both selected Cleric domains can always be prepared into the `+1 Domain` slot.

---

## 4. Bug 3 Investigation: Inventory UI Alignment, Fixed Slot Limit, Unreadable Hotkeys & Deforming Columns

### 4.1 Root Cause Analysis Across All 4 Reported Symptoms
1. **Symptom A: "The visible slots don't seem to align with the actual inventory slots."**
   - **In `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts` (`getInventoryData`, lines 86–94) & `src/rendering/ui/console_inventory.ui.ts` (`renderCompactStashWidget`, lines 245–260)**:
     - `getInventoryData` pushes **all** `inventory.items` (including **equipped** items that are already displayed in the Paper Doll slots) into `stashItems`.
     - `renderCompactStashWidget` defaults `activeSort` to `'price_desc'` (sorting items by gold value descending: `b.priceGp - a.priceGp`) instead of inventory slot index (`inventoryIndex`). Thus, cell 0 in the grid is the most expensive item, NOT `inventory.items[0]` (`[a]`).
   - **In `src/rendering/ui/inventory.ui.ts` (`renderInventoryPanel`, line 84)**:
     - Inside `for (let index = 0; index < maxSlots; index++)`, line 84 executes `if (isEquipped) continue;` **before** creating the `.inv-grid-slot` element. Every equipped item causes the loop to skip rendering a grid cell altogether, shrinking the total number of rendered squares and shifting the visible cells so the top-left square starts at `c` or `d` instead of `a`!
   - **In `src/core/input/modal_input.ts` (line 103)**:
     - Pressing `[I]` opens `UIMode.Inventory` (which calls `handleInventoryKey`), whereas clicking `"Pack (I)"` in the Command Dock or pressing `[C]` opens `UIMode.CartridgeModal` (`activeCartridgeModalId = 'inventory'` or `'character_sheet'`), which does **not** forward `a–z` / `Shift+a–z` keys to `handleInventoryKey`.
2. **Symptom B: "The number of slots seems limited to a fixed number."**
   - `console_inventory.ui.ts` hardcodes `COMPACT_STASH_COLS = 10` and `COMPACT_STASH_MIN_CELLS = 40` (4 rows of 10 tiny cells) with no scroll container.
   - `inventory.ui.ts` hardcodes `const maxSlots = Math.max(20, inventory.capacity);` and loses 1 visible slot per equipped item due to `if (isEquipped) continue;`.
3. **Symptom C: "I can't see the keys one presses to use the buttons since the inventory squares are so small."**
   - In `console_inventory.ui.ts`, cramming 10 columns (`COMPACT_STASH_COLS = 10`) into Column 3 of the Character Sheet makes each cell ~28–34px wide (`min-height: 34px; max-height: 40px`, `.crpg-cell-name { font-size: 0.45rem }`).
   - Furthermore, even though `mapEntityItemToUI` (`src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts` line 84) computes `hotkeyLabel` (`'a'`, `'b'`, `'c'`...), `renderCompactStashWidget` (`console_inventory.ui.ts` lines 279–291) **never renders `item.hotkeyLabel` inside `.crpg-stash-cell`**!
4. **Symptom D: "The columns deform depending on the items instead of being uniform. We can have a 5 x (dynamic max) grid with a scroll bar if necessary."**
   - In `src/styles/console_prototype.css` line 925:
     ```css
     .crpg-stash-matrix-compact {
       display: grid;
       grid-template-columns: repeat(10, 1fr);
     ```
     In CSS Grid, `1fr` is equivalent to `minmax(auto, 1fr)`. Because `.crpg-stash-cell` lacks `min-width: 0; overflow: hidden;` and contains `<span class="crpg-cell-name">`, any column with an item expands its `auto` minimum width to the text's intrinsic width while empty columns collapse—causing columns to deform unevenly!

### 4.2 Proposed Architecture: Uniform 5 × Dynamic Scrollable Backpack Grid
1. **5 × (Dynamic Max) Grid with Vertical Scrollbar**:
   - Change `COMPACT_STASH_COLS` from `10` to `5` (`const STASH_GRID_COLS = 5; const STASH_MIN_ROWS = 4; // 20 minimum visible slots`).
   - Compute dynamic cell count as a clean multiple of 5 rows that always includes at least 1 extra empty row below the last item:
     `const totalRows = Math.max(STASH_MIN_ROWS, Math.ceil((displayedItems.length + 1) / STASH_GRID_COLS));`
     `const cellTotal = totalRows * STASH_GRID_COLS;`
   - In `src/styles/console_prototype.css` (and `src/styles/inventory.css`):
     - Set `grid-template-columns: repeat(5, minmax(0, 1fr));` on `.crpg-stash-matrix-compact` and `.inventory-grid`.
     - Add `max-height: 290px; overflow-y: auto; overflow-x: hidden;` on the grid container so it scrolls vertically as rows grow dynamically.
     - Set `min-width: 0; overflow: hidden; height: 56px;` on `.crpg-stash-cell` so all 5 columns are strictly uniform (`minmax(0, 1fr)`) and never deform regardless of item names.
2. **1-to-1 Inventory Slot Alignment & Default Slot Order**:
   - Add `'slot_asc'` (`"Slot [a–z]"`) as the **default** sort option (`activeSort = 'slot_asc'`) in `console_inventory.ui.ts` so visible slots align directly with `inventoryIndex` (`[a]`, `[b]`, `[c]`...).
   - Filter equipped items out of the unequipped Backpack grid in `getInventoryData` (or separate equipped items into the Paper Doll while keeping backpack slots strictly aligned with `inventory.items` indices), and in `inventory.ui.ts` fix the loop so unequipped items pack into sequential visible cells without reducing `maxSlots` below a full `5 × N` grid.
3. **Clear, Readable Keybind Badges (`[a]`–`[z]`) & Action Hints**:
   - With 5 columns instead of 10, each cell is twice as wide (~62–70px × 56px).
   - Render a high-contrast key badge `<span class="crpg-cell-hotkey">[a]</span>` in the top-left corner of every occupied slot (using `item.hotkeyLabel`), a large centered icon (`1.25rem`), a readable item name (`0.64rem`), and a subtle action hint bar / footer note (`Click or [a-z]: Use/Equip • [Shift+a-z]: Drop`).
   - In `modal_input.ts`, allow `handleInventoryKey` to process `[a-z]` / `[Shift+a-z]` when the D&D 3.5e `inventory` modal is open (`state.uiMode === UIMode.CartridgeModal && state.activeCartridgeModalId === 'inventory'`).

---

## 5. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Producers) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Modals / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Move `ResourcePoolComponent` entries from `stanceModes` to `hotbar.slots` (`kind: 'ability'`) + Execute Turn Undead / Pool Abilities** | `DnD35UIAdapter.getHotbarData`, `buildActorStanceModes`, `buildActorHotbarSlots` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`) | `onExecuteHotbarSlot` (`dnd35e_ui_registration.ts`), `consumeResourcePool` / `refreshResourcePools` (`ecs_lifecycle.ts`), `executeSpellbookRest` (`dnd35e_spellbook_actions.ts`) | `tests/console_ui_architecture.test.ts` (update test expecting `pool:turn_undead` in `stanceModes` to assert it is in `hotbar.slots` with `kind: 'ability'`) |
| **2. Canonical Domain Spell Resolution (`domains[domId].domainSpells` + `spell.levelByDomain[domId]`)** | `public/data/rulesets/dnd35e/domains/*.json`, `public/data/rulesets/dnd35e/spells/*.json`, `buildActorSpellbooksByClass` (`ledger_features_spells.ts`) | `renderKnownSpellsPane` (`dnd35e_spellbook_known.ui.ts`), `resolveSpellLevelForClass` (`spellbook_slots.ts`, `builder_spell_eligibility.ts`) | `tests/dnd35e_spellbook_slots.test.ts` (add test verifying a Cleric with 2 domains can prepare spells from **both** domains into the `'domain'` slot) |
| **3. Uniform 5 × Dynamic Scrollable Inventory Grid with Readable `[a-z]` Key Badges & Slot Alignment** | `DnD35UIAdapter.getInventoryData` (`dnd35e_ui_adapter.ts`), `mapEntityItemToUI` (`dnd35e_ui_projection.ts`), `handleModalKey` (`modal_input.ts`) | `renderCompactStashWidget` (`console_inventory.ui.ts`), `renderInventoryPanel` (`inventory.ui.ts`), `.crpg-stash-matrix-compact` (`console_prototype.css`), `.inventory-grid` (`inventory.css`) | `console_dossier.ui.ts` (also renders `renderCompactStashWidget`), `dnd35e_sheet_skills_tab.ui.ts` |
| **4. Split `dnd35e_lifecycle_adapter.ts` & `action_economy.ts` (<300 lines)** | `dnd35e_ruleset.ts`, `dnd35e_combat_adapter.ts` | `lint_applet` / `bun run lint`, `docs/ssot/ssot_dnd35e.json` | `docs/SSOT_DND35E.md` |
