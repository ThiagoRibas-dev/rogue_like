# Implementation Plan: Cleric Prepared Spellbook Slots, Character Sheet Performance & Naming, and Global Font Scaling

## 1. Architectural Compliance & Standards (`AGENTS.md`)
- **Strict TypeScript (`exactOptionalPropertyTypes: true`)**: Explicit return types on all functions, zero `any`, exhaustive switches.
- **No Magic Values**: All numeric thresholds (`SYNERGY_RANK_THRESHOLD = 5`, `SYNERGY_BONUS_VALUE = 2`, `FEAR_SKILL_PENALTY = -2`) defined as named constants.
- **Architectural Boundaries (`lint:arch`)**: `src/rendering/` imports cartridge helpers exclusively via `src/rulesets/registry.ts`.
- **300-Line File Limit**: All modified files remain well under the 300-line ceiling.
- **Deterministic RNG Integrity**: UI projections (`projectCharacterSheetData`, `renderSheetSkillsTab`) must be 100% pure and never invoke `rollD20()`.

---

## 2. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Modals / Tests / SSOT) |
| :--- | :--- | :--- | :--- |
| **Task 1: Hydrate & persist `preparedSlots` in `spellbook_slots.ts` & `dnd35e_spellbook_actions.ts`** | `+ Prep`, `Unprep`, `Clear Prepared`, `Cast`, and `8-Hour Rest` buttons in `dnd35e_spellbook_known.ui.ts` & `dnd35e_spellbook_panes.ui.ts` | `renderLeftPreparedPane` in `dnd35e_spellbook_panes.ui.ts`, `buildActorHotbarSlots` in `dnd35e_ui_hotbar.ts` (reads both `preparedSlots` and synced `preparedSpellIds`) | `markDirtyFromStateDiff` in `src/core/presentation_queue.ts` marks `PresentationDomain.Modals` dirty when components change while a modal is open |
| **Task 2: Single-pass DAG & O(1) passive skill rows in `dnd35e_ui_char_sheet.ts` & `dnd35e_sheet*.ui.ts`** | `renderDnD35eSheetModal` in `src/rendering/ui/dnd35e_sheet.ui.ts`, `DnD35UIAdapter.getCharacterSheetData` | `renderSheetOverviewTab`, `renderSheetFeatsAndFeaturesTab`, `renderSheetSkillsTab` | Eliminates 180+ `evaluateDnD35ActorStatDAG` and `rollD20()` calls on Character Sheet open; preserves deterministic RNG state |
| **Task 3: Deduplicate Character Sheet modal render & rename title** | `renderPresenterFrame` in `src/rendering/presenter.ts`, `renderInventoryPanel` in `src/rendering/ui/inventory.ui.ts`, `index.html` | `#crpg-sheet-modal-title` (`"Character Sheet"`), `#dnd35e-sheet-overlay` | Prevents double execution of `renderDnD35eSheetModal` when `UIMode.Inventory` is active |
| **Task 4: Paper Doll cleanup (`leg` slot mapping & remove `"Unarmed"` caption)** | `projectAnatomicalSlots` in `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts` | `renderReactivePaperDollWidget` in `src/rendering/ui/console_inventory.ui.ts` | Standard humanoids have 12 rail slots (6 left, 6 right) and 0 extra anatomy slots |
| **Task 5: Global & Modal Font Scaling (`console_prototype.css`, `modals.css`, `hud.css`)** | CSS variables and rules in `src/styles/console_prototype.css`, `src/styles/modals.css`, `src/styles/hud.css` | Character Sheet, Spellbook, Character Creation Wizard, HUD Sidebars, Chronicle Log, Command Dock | Preserves scroll containers and parchment contrast |

---

## 3. Step-by-Step Implementation Details & Code Diffs

### Task 1: Fix Cleric & Prepared Caster Slot Persistence in the Spellbook
**Files:**
- `src/rulesets/dnd35e/magic/spellbook_slots.ts`
- `src/rendering/ui/dnd35e_spellbook_actions.ts`
- `src/rendering/ui/dnd35e_spellbook_known.ui.ts`
- `src/rendering/ui/dnd35e_spellbook_panes.ui.ts`
- `src/core/presentation_queue.ts`

#### 1A. `src/rulesets/dnd35e/magic/spellbook_slots.ts`
Update `reconcilePreparedSlots` so that if `book.preparedSlots` is `undefined` or empty while `book.preparedSpellIds` contains spells (e.g., from initial character creation or legacy state), it seeds open general slots of matching spell levels from `book.preparedSpellIds`:
```ts
export function reconcilePreparedSlots(
  book: DnD35ClassSpellbookState,
  summaries: ReadonlyArray<SpellLevelSlotSummary>,
  spellsRegistry?: Readonly<Record<string, { readonly levelByClass: Readonly<Record<string, number>> }>>,
  classId?: string
): ReadonlyArray<DnD35PreparedSlotEntry> {
  const existingMap = new Map<string, DnD35PreparedSlotEntry>();
  for (const s of book.preparedSlots ?? []) {
    existingMap.set(s.slotId, s);
  }

  // If structured slots were never initialized, seed from legacy preparedSpellIds
  const legacyPool =
    (book.preparedSlots === undefined || book.preparedSlots.length === 0) && book.preparedSpellIds.length > 0
      ? [...book.preparedSpellIds]
      : [];

  const takeLegacySpellForLevel = (spellLevel: number): string | undefined => {
    if (legacyPool.length === 0) return undefined;
    if (!spellsRegistry || !classId) return spellLevel === 0 || spellLevel === 1 ? legacyPool.shift() : undefined;
    const idx = legacyPool.findIndex((spId) => {
      const def = spellsRegistry[spId];
      const lv = def?.levelByClass[classId] ?? def?.levelByClass['sorcerer_wizard'];
      return lv === spellLevel;
    });
    if (idx === -1) return undefined;
    const [picked] = legacyPool.splice(idx, 1);
    return picked;
  };
```

#### 1B. `src/rendering/ui/dnd35e_spellbook_actions.ts`
Ensure `ensureReconciledSlots(state, playerId, classId, book)` always hydrates structured slots via `computeClassLevelSlotSummaries` + `reconcilePreparedSlots` before `prepareSpellIntoSlot`, `prepareSpellIntoSpecificSlot`, `unprepareSpecificSlot`, `castPreparedSlot`, or `clearAllPreparedSlotsForClass` searches or modifies `currentSlots`:
```ts
function getHydratedClassSlots(
  state: GameState,
  playerId: EntityId,
  classId: string,
  book: DnD35ClassSpellbookState
): ReadonlyArray<DnD35PreparedSlotEntry> {
  if (book.preparedSlots && book.preparedSlots.length > 0) {
    return book.preparedSlots;
  }
  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  const evalResult = evaluateDnD35eEntityDAG(state, playerId);
  const summaries = computeClassLevelSlotSummaries(
    classId,
    dndData,
    evalResult?.dagResult.effectiveAbilities,
    sys
  );
  return reconcilePreparedSlots(book, summaries, sys?.spells, classId);
}
```
Then in `prepareSpellIntoSlot`:
- Hydrate `slots = [...getHydratedClassSlots(state, playerId, classId, book)]`.
- Find the first open slot matching `s.spellLevel === spellLevel && s.slotKind === slotKind && (!s.preparedSpellId || s.expended)`.
- Populate `preparedSpellId: spellId, expended: false` on that slot, sync `preparedSpellIds`, and persist `preparedSlots` into `RulesetDataComponent`!
- If all slots of `(spellLevel, slotKind)` are already full, log a clear message (`"No open Level X [general/domain] slots remaining."`) instead of pushing phantom unbounded spells onto the hotbar!

#### 1C. `src/core/presentation_queue.ts`, `dnd35e_spellbook_known.ui.ts`, and `dnd35e_spellbook_panes.ui.ts`
- In `markDirtyFromStateDiff` (`src/core/presentation_queue.ts`), when `prev.components !== next.components` and `next.uiMode === UIMode.CartridgeModal || next.uiMode === UIMode.Inventory`, also mark `PresentationDomain.Modals` dirty.
- In `dnd35e_spellbook_known.ui.ts` and `dnd35e_spellbook_panes.ui.ts`, call `renderDnD35eSpellbookModal(next)` immediately after `setGameState(next)` so the left Prepared Slots pane and right Known Spells pane update instantaneously on every click.

---

### Task 2: Eliminate the 180x Stat DAG Performance Bottleneck in Character Sheet
**Files:**
- `src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts`
- `src/rendering/ui/dnd35e_sheet.ui.ts`
- `src/rendering/ui/dnd35e_sheet_overview_tab.ui.ts`
- `src/rendering/ui/dnd35e_sheet_feats_abilities_tab.ui.ts`
- `src/rendering/ui/dnd35e_sheet_skills_tab.ui.ts`

#### 2A. Pure O(1) Passive Skill Total Calculation in `src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts`
Replace the 45 calls to `evaluateActorSkillCheck(state, entityId, skill.id, NOMINAL_SKILL_PREVIEW_DC)` inside `projectCharacterSheetData` with a fast, deterministic helper `computePassiveSkillRow` that uses the already-computed `evalResult` (`DnD35EntityEvaluationResult`):
```ts
const SYNERGY_RANK_THRESHOLD = 5;
const SYNERGY_BONUS_PER_SKILL = 2;
const FEAR_SKILL_PENALTY = -2;

function computePassiveSkillModifier(
  skill: {
    readonly id: string;
    readonly keyAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
    readonly synergyFromSkills?: ReadonlyArray<{ readonly sourceSkillId: string; readonly situational?: string }>;
  },
  ranks: number,
  allSkillRanks: Readonly<Record<string, number>>,
  abilityMod: number,
  statTotals: Readonly<Record<string, number>> | undefined,
  conditions: ReadonlyArray<string>
): { readonly totalModifier: number; readonly miscModifier: number } {
  let synergyBonus = 0;
  for (const syn of skill.synergyFromSkills ?? []) {
    if (!syn.situational && (allSkillRanks[syn.sourceSkillId] ?? 0) >= SYNERGY_RANK_THRESHOLD) {
      synergyBonus += SYNERGY_BONUS_PER_SKILL;
    }
  }
  const statSkillBonus = (statTotals?.[`skill:${skill.id}`] ?? 0) + (statTotals?.['skills'] ?? 0);
  const fearPenalty =
    conditions.includes('shaken') || conditions.includes('frightened') || conditions.includes('panicked')
      ? FEAR_SKILL_PENALTY
      : 0;
  const miscModifier = synergyBonus + statSkillBonus + fearPenalty;
  return {
    totalModifier: ranks + abilityMod + miscModifier,
    miscModifier
  };
}
```
Also allow `extractActorContext` in `dnd35e_ui_char_sheet.ts` to accept an optional pre-computed `evalResult` so `evaluateDnD35eEntityDAG` is never run twice.

#### 2B. Share Pre-Evaluated Snapshot Across All 3 Columns in `src/rendering/ui/dnd35e_sheet.ui.ts`
In `renderDnD35eSheetModal(state)`:
1. Compute `evalResult = evaluateDnD35eEntityDAG(liveState, playerId)`, `sheetModel = dndAdapter.getCharacterSheetData({ state: liveState, entityId: playerId, evalResult })`, and `invData = dndAdapter.getInventoryData({ state: liveState, entityId: playerId })` **once**.
2. Pass them into `renderSheetOverviewTab`, `renderSheetFeatsAndFeaturesTab`, and `renderSheetSkillsTab`.
3. In `renderSheetSkillsTab`, render rows directly from `sheetModel.skillRows` (0 extra DAG calls, 0 `rollD20()` calls!).

---

### Task 3: Deduplicate Character Sheet Render & Rename Header to `"Character Sheet"`
**Files:**
- `index.html`
- `src/rendering/ui/inventory.ui.ts`

1. In `index.html` line 312:
```diff
- <span id="crpg-sheet-modal-title" class="modal-title">Character Dossier</span>
+ <span id="crpg-sheet-modal-title" class="modal-title">Character Sheet</span>
```
2. In `src/rendering/ui/inventory.ui.ts`:
When `sheetModal` is registered on `cartridgeUI`, `renderActiveCartridgeModal(state)` (called under `PresentationDomain.Modals`) already manages showing/hiding and rendering `sheetModal` for both `UIMode.Inventory` and `UIMode.CartridgeModal`. Remove the duplicate `sheetModal.render(state)` call from `renderInventoryPanel` and instead simply ensure the legacy `#inventory-overlay` remains hidden whenever `sheetModal` is present.

---

### Task 4: Paper Doll Cleanup (`leg` Slot Mapping & Remove `"Unarmed"` Caption)
**Files:**
- `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts`
- `src/rendering/ui/console_inventory.ui.ts`

1. In `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts`, add `leg` and `leg_0` to `PRIMARY_SLOT_DEFS` on the left rail (`{ rail: 'left', label: 'Greaves / Legs', emptyGlyph: '🦵' }`) so a standard 12-slot humanoid body plan (`head`, `neck`, `torso`, `back`, `arm_0`, `arm_1`, `hand_0`, `hand_1`, `finger_0`, `finger_1`, `leg`, `foot`) maps all 12 slots cleanly to the left/right rails (6 left, 6 right) with `0` extra anatomy slots.
2. In `src/rendering/ui/console_inventory.ui.ts`, remove lines 122–126 (`.crpg-avatar-caption` displaying `"Unarmed"`) so only the clean class/anatomy emblem appears inside the Paper Doll arch.

---

### Task 5: Increase Font Sizes Across the UI
**Files:**
- `src/styles/console_prototype.css`
- `src/styles/modals.css`
- `src/styles/hud.css`

Increase typography sizes across all panels by ~20–25%:
- **`src/styles/console_prototype.css`**:
  - `.crpg-section-heading`: `0.74rem` → `0.92rem`
  - `.crpg-xp-row`: `0.64rem` → `0.8rem`
  - `.crpg-identity-pill`: `0.62rem` → `0.78rem`
  - `.crpg-attr-row`: `0.72rem` → `0.88rem`
  - `.crpg-pd-slot-label`, `.crpg-pd-slot-item-name`: `0.45rem–0.48rem` → `0.62rem–0.65rem`
  - `.crpg-wset-btn`: `0.56rem` → `0.72rem`
  - `.crpg-encumbrance-ticks`: `0.58rem` → `0.74rem`
  - `.crpg-def-cell-lbl`: `0.52rem` → `0.68rem`, `.crpg-def-cell-val`: `0.88rem` → `1.04rem`
  - `.crpg-combat-Substrip`: `0.64rem` → `0.8rem`
  - `.crpg-attack-group-title`: `0.74rem` → `0.9rem`, `.crpg-attack-group-sub`: `0.6rem` → `0.76rem`, `.crpg-attack-bonus-chain`, `.crpg-attack-dmg-crit`: `0.72rem` → `0.88rem`
  - `.crpg-badge-chip`: `0.62rem` → `0.78rem`, `.crpg-badge-cat`: `0.5rem` → `0.66rem`
  - `.crpg-level-matrix-table th/td`: `0.56rem / 0.65rem` → `0.74rem / 0.82rem`
  - `.crpg-pnp-skills-table th/td`: `0.56rem / 0.68rem` → `0.74rem / 0.84rem`, `.crpg-skill-use-btn`: `0.55rem` → `0.72rem`
  - Spellbook classes (`.crpg-spellbook-*`, `.crpg-spell-*`, `.crpg-slot-*`, `.crpg-prep-*`): bump from `0.58rem–0.74rem` to `0.76rem–0.92rem`
- **`src/styles/modals.css` & `src/styles/hud.css`**:
  - Increase Character Creation wizard, HUD vitals, Command Dock buttons, Tactical Scanner, and Chronicle Log font sizes proportionally (`~0.75rem–0.95rem`).

---

## 4. Verification Plan
1. Run `./verify.sh` across all 8 stages (`tsc --noEmit`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `bun run build`, `run-validator.ts`).
2. Add/update unit test coverage verifying that `prepareSpellIntoSlot` hydrates `preparedSlots` on an uninitialized spellbook and populates `lv0_gen_0` / `lv1_gen_0` directly, and that `projectCharacterSheetData` does not advance `rng` state.
