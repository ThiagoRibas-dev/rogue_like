# Research Notes: Cleric Spell Preparation, Character Sheet Performance & Naming, and Font Scaling

## 0. Rules & Standards Reiteration (`AGENTS.md` & `docs/ARCHITECTURE.md`)
- **Zero `any` & Strict TypeScript (`exactOptionalPropertyTypes: true`)**: Explicit return types, exhaustive switches, zero `any`.
- **No Magic Values**: All numeric thresholds and constants named explicitly.
- **300-Line File Limit & Architectural Boundaries**: `src/rendering/` must import cartridge functions only via `src/rulesets/registry.ts` (never directly from `src/rulesets/dnd35e/*`).
- **ECS Purity**: `GameState` components remain plain JSON-serializable objects (`Record`, `ReadonlyArray`), never `Map`/`Set`, and UI projection must never mutate `rng` state.
- **Map Cascading Effects (Rule 15)**: Every change is mapped across **Upstream**, **Downstream**, and **Lateral** axes.

---

## 1. Issue-by-Issue Root Cause Analysis

### Issue 1: Cleric Prepared Spells Go to the Hotbar Instead of Prepared Slots in the Spellbook
**Symptom:** When preparing spells as a Cleric in the Spellbook (`B`), clicking `+ Prep` places the spell onto the bottom hotbar (and logs `"Prepared spell: ..."`) instead of filling the structured General / Domain slot inside the left pane of the Spellbook modal (which stays `— Empty Slot —`).

**Root Causes:**
1. **Unpersisted `reconcilePreparedSlots` on Initial Spellbook Open:**
   - When a character is created or loaded (`buildActorSpellbooksByClass` in `src/rulesets/dnd35e/level_ledger.ts`), `book.preparedSlots` is initially `undefined` in `dndData.spellbooksByClass[classId]`.
   - In `src/rendering/ui/dnd35e_spellbook.ui.ts` (lines 78–84), `renderDnD35eSpellbookModal` computes `const reconciled = reconcilePreparedSlots(activeBook, summaries)` and assigns it ONLY to a local variable (`activeBook = { ...activeBook, preparedSlots: reconciled }`) for display. It does **not** persist `reconciled` to `state`, and `prepareSpellIntoSlot` reads directly from `state`.
2. **`prepareSpellIntoSlot` Reads Empty `book.preparedSlots` from `state` and Falls Back to `preparedSpellIds`:**
   - When the user clicks `+ Prep` in `src/rendering/ui/dnd35e_spellbook_known.ui.ts`, `prepareSpellIntoSlot(state, playerId, classId, sp.id, 'general', sum.spellLevel)` (`src/rendering/ui/dnd35e_spellbook_actions.ts`, lines 70–105) looks up `const slots = book.preparedSlots ? [...book.preparedSlots] : []`.
   - Because `book.preparedSlots` in `state` is `undefined`, `slots` is `[]`, so `openSlot` is `undefined`.
   - Execution falls through to the legacy branch (lines 93–94):
     ```ts
     const prepared = [...book.preparedSpellIds, spellId];
     ```
     which appends the spell to `book.preparedSpellIds` (read by `buildActorHotbarSlots` for the bottom hotbar) while leaving `book.preparedSlots` `undefined`!
3. **`reconcilePreparedSlots` Ignores Existing `preparedSpellIds` When `preparedSlots` Is Undefined:**
   - In `src/rulesets/dnd35e/magic/spellbook_slots.ts` (lines 118–157), `reconcilePreparedSlots` checks `const existing = book.preparedSlots ?? []`. Because `preparedSlots` was never written to `book`, every re-render reconstructs all slots with `spellId: null` (`— Empty Slot —`), even though `book.preparedSpellIds` has the prepared spells!
4. **Modal Domain Not Marked Dirty on Component Updates:**
   - In `src/core/presentation_queue.ts` (lines 109–117), when `prev.components !== next.components`, `markDirtyFromStateDiff` marks `Entities`, `HUD`, and `Inventory` dirty, but does **not** mark `PresentationDomain.Modals` dirty when `next.uiMode === UIMode.CartridgeModal` (or `UIMode.Inventory`).

**Proposed Fix:**
- In `reconcilePreparedSlots` (`src/rulesets/dnd35e/magic/spellbook_slots.ts`), if `book.preparedSlots` is `undefined` or empty while `book.preparedSpellIds` has entries, seed the initial general slots of matching spell levels from `book.preparedSpellIds` so pre-existing/default prepared spells appear in slots immediately.
- In `prepareSpellIntoSlot`, `unprepareSlotById`, and `clearAllPreparedSlotsForClass` (`src/rendering/ui/dnd35e_spellbook_actions.ts`), always hydrate `slots` via `reconcilePreparedSlots(book, summaries)` when `book.preparedSlots` is missing or out of sync before mutating slots, and write both `preparedSlots` and derived `preparedSpellIds` back into `RulesetDataComponent`.
- In `src/core/presentation_queue.ts`, when `prev.components !== next.components` while a modal is open (`next.uiMode === UIMode.CartridgeModal` or `next.uiMode === UIMode.Inventory`), also mark `PresentationDomain.Modals` dirty, and call `renderDnD35eSpellbookModal(next)` directly in `dnd35e_spellbook_known.ui.ts` / `dnd35e_spellbook_panes.ui.ts` on state mutation.

---

### Issue 2: Severe Performance Bottleneck & Wrong Title ("Character Dossier") When Opening Character Sheet
**Symptom:** Pressing `I` or `C` to open the Character Sheet causes a severe freeze/lag spike, and the modal header says `"CHARACTER DOSSIER"` instead of `"CHARACTER SHEET"`.

**Root Causes:**
1. **90+ Full 4-Stage Stat DAG + Semantic Tag + RNG Roll Evaluations per Render:**
   - Inside a single `renderDnD35eSheetModal(state)` call:
     - **Column 1 (`renderSheetOverviewTab`)** calls `evaluateDnD35eEntityDAG(liveState, playerId)` AND `dndAdapter.getInventoryData(...)`.
     - **Column 2 (`renderSheetFeatsAndFeaturesTab`)** calls `dndAdapter.getCharacterSheetData({ state: liveState, entityId: playerId })`. Inside `projectCharacterSheetData` (`src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts`, lines 82 & 127–142), it calls `evaluateDnD35eEntityDAG` a **second** time AND loops over all **45 skills** in `sys.skills`, calling `evaluateActorSkillCheck(state, entityId, skill.id, 10)` **45 times**—even though Column 2 only reads `sheetModel.attackGroups` and completely discards `sheetModel.skillRows`!
     - **Column 3 (`renderSheetSkillsTab`, line 98)** ALSO loops over all **45 skills** in `sys.skills` and calls `evaluateActorSkillCheck(liveState, playerId, skill.id, 10)` **another 45 times**, plus `dndAdapter.getInventoryData(...)` a second time!
   - Inside `evaluateActorSkillCheck` (`src/rulesets/dnd35e/skills/skill_verb_helpers.ts`, lines 154–244), **each individual call** runs:
     1. `projectDnD35ActorSemanticTags(...)` (iterating classes, skills, equipment, status conditions)
     2. `evaluateDnD35ActorStatDAG(...)` (running the entire 4-stage topological stat & 18-bonus-type stacking DAG from scratch!)
     3. `resolveSkillCheck(...)` (which calls `rollD20()`, advancing the global deterministic RNG 90 times just by opening the UI!).
2. **Duplicate Render in the Same Frame (`PresentationDomain.Inventory` + `PresentationDomain.Modals`):**
   - When opening the Character Sheet (`UIMode.Inventory` or `UIMode.CartridgeModal`), `markDirtyFromStateDiff` marks both `PresentationDomain.Inventory` and `PresentationDomain.Modals` dirty.
   - In `src/rendering/presenter.ts`:
     - `PresentationDomain.Inventory` calls `renderInventoryPanel(state)` (`src/rendering/ui/inventory.ui.ts`, line 33), which looks up `sheetModal` and calls `sheetModal.render(state)` (`renderDnD35eSheetModal`).
     - Immediately after, `PresentationDomain.Modals` calls `renderActiveCartridgeModal(state)` (`src/rendering/ui/cartridge_ui_registry.ts`, line 179), which ALSO calls `sheetModal.render(state)` (`renderDnD35eSheetModal`)!
   - Combined with the 92 DAG evaluations per render, a single press of `I` or `C` executes **`evaluateDnD35ActorStatDAG` + `projectDnD35ActorSemanticTags` ~184 times synchronously on the main thread**!
   - Furthermore, whenever `prev.components !== next.components` during normal gameplay (`UIMode.Game`), `PresentationDomain.Inventory` is marked dirty and calls `renderInventoryPanel(state)`, which only hides the modal at the *end* of `renderDnD35eSheetModal` if `activeModalId !== 'character_sheet'`, meaning during `UIMode.Inventory` any component tick re-runs the full render twice.
3. **Wrong Header Title in `index.html`:**
   - Line 312 of `index.html` hardcodes `<span id="crpg-sheet-modal-title" class="modal-title">Character Dossier</span>`.

**Proposed Fix:**
1. **Fast, Pure Passive Skill Breakdown (`computePassiveSkillRows` / fast path):**
   - Extract or compute passive skill totals using the **already-evaluated** `evalResult` (`DnD35StatEvaluationResult`) and `dndData.skillRanks` in O(1) per skill (without re-running `evaluateDnD35ActorStatDAG`, `projectDnD35ActorSemanticTags`, or `rollD20()` 45 times!).
   - Evaluate `evalResult = evaluateDnD35eEntityDAG(liveState, playerId)`, `invData = dndAdapter.getInventoryData(...)`, and `sheetModel = dndAdapter.getCharacterSheetData(...)` **once** in `renderDnD35eSheetModal` and pass the shared precomputed context into `renderSheetOverviewTab`, `renderSheetFeatsAndFeaturesTab`, and `renderSheetSkillsTab`.
   - This reduces `evaluateDnD35ActorStatDAG` calls on Character Sheet open from **~184 down to 1**, and RNG `rollD20()` calls on UI render from **~180 down to 0**!
2. **Eliminate Double Modal Render:**
   - In `src/rendering/ui/inventory.ui.ts`, when `cartridgeUI` delegates to `character_sheet`, let `renderActiveCartridgeModal` be the single owner of rendering cartridge modals (or skip `sheetModal.render(state)` in `renderInventoryPanel` when `PresentationDomain.Modals` renders it), ensuring `renderDnD35eSheetModal` executes at most **once** per state change and **zero** times when the sheet is closed.
3. **Rename `"Character Dossier"` to `"Character Sheet"`:**
   - Update `index.html` line 312 (`#crpg-sheet-modal-title`) from `"Character Dossier"` to `"Character Sheet"`.

---

### Issue 3: Global & Modal Font Size Scaling + Paper Doll Cleanup
**Symptom:**
1. Text across the UI (Character Sheet, Spellbook, Character Creation, HUD panels, Chronicle log) is too small (`0.45rem`–`0.72rem`).
2. In the screenshot of the Character Sheet (`/public/assets/aistudio/image_19e7b22d.png`), two small Paper Doll issues remain:
   - Inside the Paper Doll arch under the class icon (`☀️`), there is still a `"Unarmed"` badge (`.crpg-avatar-caption` in `src/rendering/ui/console_inventory.ui.ts` lines 122–126), which also falsely says `"Unarmed"` even when a Longsword is equipped in `hand_6` (`hand_0`).
   - `EXTRA ANATOMY & MULTI-LIMB SLOTS (1)` appears for a standard human with `LEG 1` (`leg_10`) because `leg` / `leg_0` was not listed in `PRIMARY_SLOT_DEFS` in `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts`.

**Proposed Fix:**
1. **Typography Scaling (`src/styles/console_prototype.css`, `src/styles/modals.css`, `src/styles/hud.css`):**
   - Increase font sizes across the Character Sheet, Spellbook, Character Creation wizard, HUD sidebars, and buttons by ~20–25% (raising micro-labels from `0.5rem–0.65rem` to `0.72rem–0.82rem`, table/body rows from `0.68rem–0.74rem` to `0.84rem–0.92rem`, and section headers/titles proportionally) while keeping layout containers well-proportioned.
2. **Paper Doll Cleanup (`src/rendering/ui/console_inventory.ui.ts` & `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts`):**
   - Remove `.crpg-avatar-caption` (`"Unarmed"`) from `renderReactivePaperDollWidget` in `src/rendering/ui/console_inventory.ui.ts`.
   - Add `leg` and `leg_0` (`{ rail: 'left', label: 'Greaves / Legs', emptyGlyph: '🦵' }`) to `PRIMARY_SLOT_DEFS` in `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts` so all 12 standard humanoid anatomical slots map cleanly to the left/right rails (6 left, 6 right) and `Extra Anatomy & Multi-Limb Slots` stays hidden (`0` extra slots) for normal humanoids.

---

## 2. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Modals / Tests / SSOT) |
| :--- | :--- | :--- | :--- |
| **Hydrate & persist `preparedSlots` in `dnd35e_spellbook_actions.ts` & `spellbook_slots.ts`** | `+ Prep`, `Unprep`, `Clear Prepared` buttons in `dnd35e_spellbook_known.ui.ts` & `dnd35e_spellbook_panes.ui.ts` | `renderLeftPreparedPane` in `dnd35e_spellbook_panes.ui.ts`, `buildActorHotbarSlots` in `dnd35e_ui_hotbar.ts` (reads synced `preparedSpellIds` + `preparedSlots`) | Spontaneous conversion toggle & `Cast` buttons in `dnd35e_spellbook_panes.ui.ts`; `presentation_queue.ts` modal dirty flag |
| **Single-pass `evalResult` & passive skill calculation in `projectCharacterSheetData` & `renderDnD35eSheetModal`** | `presenter.ts` (`renderActiveCartridgeModal`), `dnd35e_ui_adapter.ts` (`getCharacterSheetData`) | `renderSheetOverviewTab`, `renderSheetFeatsAndFeaturesTab`, `renderSheetSkillsTab` | Preserves deterministic `rng` state (no `rollD20()` side effects during UI rendering); tests in `tests/` |
| **Deduplicate Character Sheet render in `inventory.ui.ts` / `presenter.ts`** | `renderPresenterFrame` in `src/rendering/presenter.ts` | `#crpg-sheet-modal` DOM container | Legacy fallback inventory modal when no cartridge UI is registered |
| **Map `leg` / `leg_0` in `PRIMARY_SLOT_DEFS` & remove `.crpg-avatar-caption`** | `projectAnatomicalSlots` in `dnd35e_ui_projection.ts` | `renderReactivePaperDollWidget` in `console_inventory.ui.ts` | `Extra Anatomy & Multi-Limb Slots` drawer only renders for true multi-limb creatures (`extraLimbs.length > 0`) |
| **Global & Modal CSS font scaling + `"Character Sheet"` title** | `index.html`, `src/styles/console_prototype.css`, `src/styles/modals.css`, `src/styles/hud.css` | All modal views, Character Sheet, Spellbook, Character Creation, and HUD | Maintains responsive scroll containers and parchment contrast |
