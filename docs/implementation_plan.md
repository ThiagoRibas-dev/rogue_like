# Implementation Plan — Post-Phase 33 Audit Cleanup, Activated Class/Domain Abilities (Turn Undead), N-Domain Spell Slot Preparation & Uniform 5×Dynamic Scrollable Inventory Grid

## 1. Objectives & Architectural Scope

1. **Audit Cleanup (`max-lines` Compliance)**:
   - Extract per-actor turn-budget lifecycle helpers from `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (408 lines) and `src/rulesets/dnd35e/action_economy.ts` (313 lines) into `src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts` so all files sit comfortably under the 300-line ESLint ceiling with 0 warnings.
2. **Bug 1 Fix — Activated Resource Pool Abilities (`Turn Undead`, `Rage`, `Lay on Hands`, `Smite`, `Domain Powers`) on Hotbar Instead of Stance Bar**:
   - Remove `resourcePools` iteration from `buildActorStanceModes` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`) so the **Modes** strip only contains actual toggleable stances/dials (*Fighting Defensively*, *Total Defense*, *Power Attack*, *Combat Expertise*, and spell stance groups).
   - Project `ResourcePoolComponent` entries (`entry.max > 0`) into `buildActorHotbarSlots` as `kind: 'ability'` hotbar slots with remaining uses `(current/max)` and disabled state when `current <= 0`.
   - Implement `payload.kind === 'ability'` execution in `onExecuteHotbarSlot` (`src/rulesets/dnd35e/ui/dnd35e_ui_registration.ts`) backed by a dedicated `src/rulesets/dnd35e/combat/pool_ability_resolver.ts` that checks `actionBudget`, expends 1 charge via `consumeResourcePool`, consumes a Standard Action, and resolves the ability (including a 60-ft burst D&D 3.5e Turn/Rebuke Undead resolver against undead in line of effect, plus refreshing `rest_8h` pools in `executeSpellbookRest`).
3. **Bug 2 Fix — Canonical N-Domain Spell Lookup & Domain Slot Preparation (`1..N` Domains across Base/Multiclass/Prestige/Feats)**:
   - Create a canonical, class-agnostic helper `isActorDomainSpellAtLevel` / `getActorDomainSpellLevels` in `src/rulesets/dnd35e/magic/spellbook_slots.ts` that inspects **all** domains in `dndData.domains` (`0..N` domains from Cleric, multiclassing, prestige classes, or bonus domain feats) and checks **both** `sysContent.domains[domId]?.domainSpells[String(spellLevel)] === spellId` **and** `spellDef?.levelByDomain?.[domId] === spellLevel`.
   - Replace the incomplete `sp.levelByDomain?.[domId]` and hardcoded `classId === 'cleric'` checks in `src/rendering/ui/dnd35e_spellbook_known.ui.ts`, `src/rulesets/dnd35e/progression/ledger_features_spells.ts`, and `src/rulesets/dnd35e/builder/builder_spell_eligibility.ts` with the canonical helper so spells from **any** of an actor's domains can be memorized in domain slots.
4. **Bug 3 Fix — Uniform 5 × (Dynamic Max) Scrollable Inventory Grid with 1-to-1 Slot Alignment & Readable `[a–z]` Key Badges**:
   - Update `src/rendering/ui/console_inventory.ui.ts` and `src/styles/console_prototype.css` to use a **5-column uniform grid** (`grid-template-columns: repeat(5, minmax(0, 1fr))` with `min-width: 0; overflow: hidden; height: 58px;` on cells) inside a scrollable container (`max-height: 280px; overflow-y: auto`), dynamically sizing rows as `Math.max(4, Math.ceil((filtered.length + 5) / 5)) * 5` cells.
   - Default sorting to `'slot_asc'` (`"Slot [a–z]"`) and exclude equipped items from the unequipped Backpack grid in `DnD35UIAdapter.getInventoryData` (since equipped items are rendered in the Paper Doll slots) while preserving each item's exact `inventoryIndex` and `hotkeyLabel` (`[a]`–`[z]`).
   - Render a high-contrast `<span class="crpg-cell-hotkey">[a]</span>` badge in the top-left corner of every occupied backpack cell, and update `src/rendering/ui/inventory.ui.ts` + `src/styles/inventory.css` so Classic mode also uses a uniform 5 × dynamic scrollable grid where skipping equipped items never shrinks the total slot count or misaligns `[a–z]` labels.
   - Forward `[a–z]` / `[Shift+a–z]` keys in `src/core/input/modal_input.ts` when `state.uiMode === UIMode.CartridgeModal && state.activeCartridgeModalId === 'inventory'`.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Old-Brain / Split Location (Evicted) | Canonical SSOT Owner |
| :--- | :--- | :--- |
| Per-actor D&D 3.5e round budget lifecycle (`onActorTurnStart`, `resolveActionCost`, `onPostActionBudget`, `canContinueTurn`, `onActorTurnEnd`) | Inlined inside `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (causing >300 line warning) | `src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts` (re-exported by `dnd35e_lifecycle_adapter.ts`) |
| `ResourcePoolComponent` UI projection & activation (`turn_undead`, `rage`, `lay_on_hands`, `smite_evil`, `domain_*`) | Projected into `buildActorStanceModes` as fake `'pool:<id>'` stances (`dnd35e_ui_hotbar.ts`) | Projected into `buildActorHotbarSlots` (`kind: 'ability'`) and resolved via `src/rulesets/dnd35e/combat/pool_ability_resolver.ts` |
| Checking whether a spell belongs to any of an actor's `1..N` domains at spell level `L` | Ad-hoc `sp.levelByDomain?.[domId] === sum.spellLevel` and `classId === 'cleric'` checks in `dnd35e_spellbook_known.ui.ts`, `ledger_features_spells.ts`, and `builder_spell_eligibility.ts` | `isActorDomainSpellAtLevel` & `getActorDomainSpellLevels` in `src/rulesets/dnd35e/magic/spellbook_slots.ts` |
| Backpack grid layout, slot alignment, and `[a–z]` keybind badges | 10-column `repeat(10, 1fr)` fixed 40-cell grid without key labels, defaulting to `price_desc` sort | 5-column `repeat(5, minmax(0, 1fr))` × dynamic-row scrollable grid (`console_inventory.ui.ts` & `inventory.ui.ts`) defaulting to `slot_asc` with `[a–z]` badges |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| Domain spell eligibility across `1..N` domains | Checking `if (classId === 'cleric')` or `domains.slice(0, 2)` or only reading `spell.levelByDomain[domId]` | Iterate over all `dndData.domains` (`0..N`) for any class with `domainSpellSlots` (or domain access), checking both `sys.domains[domId]?.domainSpells[String(lvl)] === spell.id` and `spell.levelByDomain[domId] === lvl` | **Yes** — adding a new domain JSON, a prestige class granting a 3rd/4th domain, or a Bonus Domain feat works automatically with zero `.ts` edits. |
| Activated class/domain resource pool abilities vs. combat stances | Hardcoding `if (poolId !== 'turn_undead')` in `buildActorStanceModes` | Remove `resourcePools` from `buildActorStanceModes` entirely; project all `ResourcePoolComponent` entries (`entry.max > 0`) as `kind: 'ability'` hotbar slots | **Yes** — any class or domain JSON declaring a `resourcePool` block automatically projects as a hotbar ability with charge tracking and 8h rest refresh. |

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Producers) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Modals / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Extract `dnd35e_turn_budget.ts` & trim `action_economy.ts`** | `dnd35e_ruleset.ts`, `dnd35e_lifecycle_adapter.ts` | `lint_applet` / `bun run lint` (0 warnings), `docs/ssot/ssot_dnd35e.json` | `docs/SSOT_DND35E.md`, `tests/dnd35e_npc_action_budget.test.ts` |
| **2. Move `ResourcePoolComponent` from `stanceModes` to `hotbar.slots` (`kind: 'ability'`) + `pool_ability_resolver.ts`** | `DnD35UIAdapter.getHotbarData`, `buildActorStanceModes`, `buildActorHotbarSlots` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`) | `onExecuteHotbarSlot` (`dnd35e_ui_registration.ts`), `executeSpellbookRest` (`dnd35e_spellbook_actions.ts`), `consumeResourcePool` / `refreshResourcePools` (`ecs_lifecycle.ts`) | `tests/console_ui_architecture.test.ts` (update test to assert `turn_undead` is projected into `hotbar.slots` with `kind: 'ability'` rather than `stanceModes`) |
| **3. Canonical N-Domain Spell Resolution (`isActorDomainSpellAtLevel`)** | `public/data/rulesets/dnd35e/domains/*.json`, `public/data/rulesets/dnd35e/spells/*.json`, `buildActorSpellbooksByClass` (`ledger_features_spells.ts`) | `renderKnownSpellsPane` (`dnd35e_spellbook_known.ui.ts`), `getSpellLevelForClass` (`builder_spell_eligibility.ts`), `spellbook_slots.ts` | `tests/dnd35e_spellbook_slots.test.ts` (add test verifying multi-domain Cleric / 3+ domain actor can prepare spells from **all** owned domains into the `'domain'` slot) |
| **4. Uniform 5 × Dynamic Scrollable Inventory Grid & `[a–z]` Keybind Alignment** | `DnD35UIAdapter.getInventoryData` (`dnd35e_ui_adapter.ts`), `handleModalKey` (`modal_input.ts`) | `renderCompactStashWidget` (`console_inventory.ui.ts`), `renderInventoryPanel` (`inventory.ui.ts`), `console_prototype.css`, `inventory.css` | `dnd35e_sheet_skills_tab.ui.ts`, `console_dossier.ui.ts` |

---

## 5. Step-by-Step Implementation Plan & Code Diffs

### Step 1: Extract `src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts` & Trim `src/rulesets/dnd35e/action_economy.ts`
- Move `onDnD35eActorTurnStart`, `resolveDnD35eActionCost`, `onDnD35ePostActionBudget`, `canDnD35eActorContinueTurn`, `isDnD35eActorMidMovementPool`, and `onDnD35eActorTurnEnd` from `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` into a dedicated `src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts` and re-export them from `dnd35e_lifecycle_adapter.ts`.
- Condense verbose multi-line comments in `src/rulesets/dnd35e/action_economy.ts` so both files sit comfortably below 300 lines with 0 ESLint `max-lines` warnings.

---

### Step 2: Fix Bug 1 — Project `ResourcePoolComponent` as Activated Hotbar Abilities (`kind: 'ability'`) & Resolve Turn Undead / Daily Pools
1. **Create `src/rulesets/dnd35e/combat/pool_ability_resolver.ts`**:
   - Implements `executeDnD35eResourcePoolAbility(state: GameState, actorId: EntityId, poolId: string): GameState`:
     - Checks `actionBudget` for an available Standard Action (`budget.standardRemaining > 0`).
     - Calls `consumeResourcePool(state, actorId, poolId, 1)`.
     - Consumes 1 Standard Action via `consumeActionFromBudget(budget, 'standard')` and updates the actor's `actionBudget` (calling `onDnD35eActorTurnEnd` if `!isBudgetRemaining(nextBudget)`).
     - Resolves the activated ability:
       - **`turn_undead` / `domain_turn_*` / `domain_greater_turning`**: Performs a D&D 3.5e 60-ft burst Turn/Rebuke Undead check (`1d20 + chaMod` Turning Check for max HD affected, `2d6 + effectiveTurningLevel + chaMod` Turning Damage for total HD affected) against hostile Undead within 60 ft in line of effect—destroying undead with `HD <= effectiveTurningLevel / 2` (or all turned undead if `poolId === 'domain_greater_turning'`) and applying `'fleeing'` / `'cowering'` status to turned undead.
       - **`lay_on_hands` / `wholeness_of_body`**: Restores HP to the actor up to `maxHp`.
       - **`rage` / `defensive_stance` / `smite_evil` / `smite_good` / `domain_*`**: Applies a temporary combat buff status effect (`'raging'`, `'blessed'`, `'warded'`) and logs the activation.
2. **Update `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`**:
   - Remove `resourcePools` parameter/loop from `buildActorStanceModes`.
   - Pass `resourcePools` into `buildActorHotbarSlots(dndData, state, entityId, resourcePools)` and project each `ResourcePoolComponent` entry (`entry.max > 0`) as a `UIHotbarSlot` with:
     ```ts
     actionPayload: {
       kind: 'ability',
       id: poolId,
       remainingCount: entry.current
     }
     ```
     and label `${entry.label ?? poolId} (${entry.current}/${entry.max})`, `isDisabled: entry.current <= 0`.
3. **Update `src/rulesets/dnd35e/ui/dnd35e_ui_registration.ts` & `src/rendering/ui/dnd35e_spellbook_actions.ts`**:
   - In `onExecuteHotbarSlot`, handle `payload.kind === 'ability'` by calling `executeDnD35eResourcePoolAbility(state, playerId, payload.id)`.
   - In `executeSpellbookRest` (`dnd35e_spellbook_actions.ts`), call `refreshResourcePools(nextState, playerId, 'rest_8h')` so daily pools (`turn_undead`, `rage`, `lay_on_hands`, etc.) recharge on an 8-hour rest.

---

### Step 3: Fix Bug 2 — Canonical N-Domain Spell Resolution (`isActorDomainSpellAtLevel`)
1. **Add Canonical Domain Helpers in `src/rulesets/dnd35e/magic/spellbook_slots.ts`**:
   ```ts
   /**
    * Returns true if `spellId` is granted at `spellLevel` by ANY domain in `actorDomains`
    * (whether declared in `domains[domId].domainSpells[String(spellLevel)]` or `spellDef.levelByDomain[domId]`).
    * Supports actors with any number of domains (1..N from Cleric, multiclassing, prestige classes, or feats).
    */
   export function isActorDomainSpellAtLevel(
     spellId: string,
     spellDef: { readonly levelByDomain?: Readonly<Record<string, number>> } | undefined,
     spellLevel: number,
     actorDomains: ReadonlyArray<string> | undefined,
     domainRegistry: Readonly<Record<string, { readonly domainSpells?: Readonly<Record<string, string>> }>> | undefined
   ): boolean {
     if (!actorDomains || actorDomains.length === 0) return false;
     const lvlKey = String(spellLevel);
     for (const domId of actorDomains) {
       if (spellDef?.levelByDomain?.[domId] === spellLevel) return true;
       if (domainRegistry?.[domId]?.domainSpells?.[lvlKey] === spellId) return true;
     }
     return false;
   }
   ```
2. **Update `src/rendering/ui/dnd35e_spellbook_known.ui.ts`**:
   - Remove hardcoded `classId === 'cleric'` checks; instead check `(dndData.domains?.length ?? 0) > 0` whenever the class spellbook has domain slots (`classBook?.domainSpellSlots !== undefined || summaries.some((s) => s.domainSlots > 0)`).
   - Use `isActorDomainSpellAtLevel(sp.id, sp, sum.spellLevel, dndData.domains, sys?.domains)` both when filtering `spellsAtLevel` (lines 48–62) and when computing `isDomainSpell` (line 118) so spells from **all** of an actor's domains (`1..N`) show `[+ Dom]` and can be memorized into the `+1 Domain` slot.
3. **Update `src/rulesets/dnd35e/progression/ledger_features_spells.ts` & `src/rulesets/dnd35e/builder/builder_spell_eligibility.ts`**:
   - In `buildActorSpellbooksByClass` (`ledger_features_spells.ts`), iterate over `domains` (`0..N`) for any class with `domainSpellSlots` (or domain spell access), adding both `sysContent.domains[domId]?.domainSpells` and `spell.levelByDomain[domId]` up to `maxCastableSpellLevel` to `knownSet`.
   - In `getSpellLevelForClass` (`builder_spell_eligibility.ts`), accept optional `domainRegistry` and check `domainRegistry?.[domId]?.domainSpells` alongside `spell.levelByDomain[domId]`.

---

### Step 4: Fix Bug 3 — Uniform 5 × (Dynamic Max) Scrollable Inventory Grid with 1-to-1 Slot Alignment & `[a–z]` Keybind Badges
1. **Update `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts` (`getInventoryData`)**:
   - Exclude already-equipped items (`!isEquipped`) from `stashItems` (since equipped items are rendered in the Paper Doll slots in Column 2, while still counting their weight toward `currentWeightLbs`), and preserve each unequipped item's exact `inventoryIndex` and `hotkeyLabel` (`[a]`–`[z]`).
2. **Update `src/rendering/ui/console_inventory.ui.ts` (`renderCompactStashWidget`)**:
   - Change `COMPACT_STASH_COLS` from `10` to `5` (`const STASH_GRID_COLS = 5; const STASH_MIN_ROWS = 4; // 20 minimum cells`).
   - Add `'slot_asc'` (`"Slot [a–z]"`) as the **default** sort option (`let activeSort: SortOption = 'slot_asc'`) so visible cells align 1-to-1 with `inventoryIndex` (`[a]`, `[b]`, `[c]`...).
   - Compute dynamic cell count as a multiple of 5 rows with an extra empty row at the bottom for growth:
     ```ts
     const totalRows = Math.max(STASH_MIN_ROWS, Math.ceil((filtered.length + STASH_GRID_COLS) / STASH_GRID_COLS));
     const cellTotal = totalRows * STASH_GRID_COLS;
     ```
   - Inside each occupied `.crpg-stash-cell`, render:
     - Top-left key badge: `<span class="crpg-cell-hotkey">[${item.hotkeyLabel}]</span>`
     - Top-right action tag: `<span class="crpg-cell-action">${item.category === 'consumable' ? 'USE' : 'EQP'}</span>`
     - Center icon: `<span class="crpg-cell-icon">${item.iconUrl ?? '📦'}</span>`
     - Bottom name: `<span class="crpg-cell-name">${item.name}</span>`
3. **Update `src/styles/console_prototype.css`**:
   - Change `.crpg-stash-matrix-compact` to:
     ```css
     .crpg-stash-matrix-compact {
       display: grid;
       grid-template-columns: repeat(5, minmax(0, 1fr));
       gap: 4px;
       background: var(--crpg-border-inner);
       border: 2px solid var(--crpg-border-outer);
       padding: 4px;
       max-height: 268px;
       overflow-y: auto;
       overflow-x: hidden;
     }
     ```
   - Update `.crpg-stash-cell` to `height: 58px; min-width: 0; overflow: hidden;` so columns are strictly uniform and never deform when items have long names, and style `.crpg-cell-hotkey` and `.crpg-cell-action` for crisp legibility.
4. **Update `src/rendering/ui/inventory.ui.ts` & `src/styles/inventory.css` (Classic Inventory Modal)**:
   - Collect unequipped items with their original `index` (`[a–z]`), compute `totalSlots = Math.max(20, Math.ceil((unequippedItems.length + 5) / 5) * 5)`, and render all `totalSlots` cells in a uniform `repeat(5, minmax(0, 1fr))` scrollable grid so equipping items never shrinks the grid or misaligns slots.
5. **Update `src/core/input/modal_input.ts`**:
   - In `handleModalKey`, when `state.uiMode === UIMode.CartridgeModal && state.activeCartridgeModalId === 'inventory'`, forward `[a–z]` / `[Shift+a–z]` keys (that aren't dock modal toggle keys) to `handleInventoryKey(event, state, playerEntityId)`.

---

### Step 5: Unit & Regression Tests + Full 8-Stage Verification
- Update `tests/console_ui_architecture.test.ts` to verify `turn_undead` is projected into `hotbar.slots` (`kind: 'ability'`) and NOT `stanceModes`.
- Add unit tests in `tests/dnd35e_spellbook_slots.test.ts` verifying that an actor with 2 or 3+ domains (e.g. `healing`, `protection`, `travel`) can prepare domain spells from **every** domain into the `'domain'` slot even when `spell.levelByDomain` is `{}` in the spell JSON.
- Update `docs/ssot/ssot_dnd35e.json`, regenerate `docs/SSOT_DND35E.md`, and run `./verify.sh`, `compile_applet`, and `lint_applet`.
