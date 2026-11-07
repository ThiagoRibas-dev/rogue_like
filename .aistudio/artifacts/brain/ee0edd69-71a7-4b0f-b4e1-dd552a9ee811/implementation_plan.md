# Implementation Plan — Post-M121 Playtest Fixes & D&D 3.5e Grimoire Overhaul

## 1. Architectural Rules & Constraints (`AGENTS.md` Compliance)
- **Three-Tier Placement Heuristic (Rule 16):**
  - **Tier 1 — Core Console Engine (`src/core/`, `src/rendering/display.ts`, `src/rendering/sprite_atlas.ts`, `src/rendering/ui/cartridge_ui_registry.ts`, `src/rendering/ui/console_inventory.ui.ts`):**
    - FOV initialization upon loading a saved game (`continueGame`).
    - `ROT.Display` buffer clearing (`display.clear()`) prior to switching between `'rect'` (ASCII) and `'tile'` (2D Sprite) layouts, plus ASCII fallback keys in `compositeAtlas`.
    - Resolving `UIMode.Inventory` in `renderActiveCartridgeModal` so pressing `I` renders the cartridge's inventory/sheet modal instead of immediately hiding it.
    - Clean Paper Doll arch rendering without raw `morphologyLabel` (`"humanoid_biped"`).
  - **Tier 2 — D&D 3.5e Ruleset Cartridge & UI (`src/rulesets/dnd35e/`, `src/rendering/ui/dnd35e_*.ts`):**
    - Deterministic `slotType` + per-type index mapping in `buildAnatomicalSlotsFromEquipment` (`src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts`) so the 12 standard humanoid slots populate the Left (6) and Right (6) Paper Doll rails, reserving `rail: 'extra'` strictly for genuine 3rd+ multi-limb appendages (`marilith_6arm`, etc.).
    - Consolidating the redundant top-left portrait box and the Paper Doll silhouette into a single class/form-aware avatar inside the Paper Doll arch (`dnd35e_sheet_overview_tab.ui.ts` & `console_inventory.ui.ts`).
    - Level `0..9` Vancian & Spontaneous Spellbook slot engine (`src/rulesets/dnd35e/magic/spellbook_slots.ts`) and Grimoire UI (`src/rendering/ui/dnd35e_spellbook.ui.ts`, `src/rendering/ui/dnd35e_spellbook_actions.ts`).
- **Strict TypeScript & Code Hygiene (Rules 10–14):**
  - Zero `any`, zero magic numbers, explicit return types on all functions, `exactOptionalPropertyTypes: true` compliance, and modular files ($\le 300$ lines).

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner (SSOT) | Old / Broken Pattern Evicted |
| :--- | :--- | :--- |
| **Modal Theme Palette (`parchment`)** | `src/styles/console_prototype.css` & `src/styles/modals.css` | Evicts dark `#191c24` / light `#e2d9c8` text overrides in `#char-creation-overlay`, `#level-up-overlay`, `#dnd35e-sheet-overlay`, and `#dnd35e-spellbook-overlay` that clashed with `--crpg-bg-card`. |
| **`UIMode.Inventory` (`I`) Modal Dispatch** | `src/rendering/ui/cartridge_ui_registry.ts` (`renderActiveCartridgeModal`) | Evicts `activeId = undefined` when `state.uiMode === UIMode.Inventory`, which was immediately re-hiding `#dnd35e-sheet-overlay` after `renderInventoryPanel` showed it. |
| **Anatomical Slot → Paper Doll Rail Projection** | `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts` (`buildAnatomicalSlotsFromEquipment`) | Evicts unsuffixed `SLOT_VISUAL_MAP[slot.id]` lookup that failed on `'head_0'..'foot_11'` and dumped all 12 standard humanoid slots into `rail: 'extra'` with a snake icon (`🐍`). |
| **Single Character Avatar in Dossier** | `src/rendering/ui/dnd35e_sheet_overview_tab.ui.ts` & `src/rendering/ui/console_inventory.ui.ts` | Evicts the duplicate top-left wizard portrait box (`🧙‍♂️`) and raw `"humanoid_biped"` caption, keeping a single class/form silhouette inside the Paper Doll arch. |
| **Initial FOV on Save Load / Char Creation** | `src/core/bootstrap/world_entities_bootstrap.ts` (`continueGame`) & `src/rendering/ui/dnd35e_char_builder.ui.ts` | Evicts returning an uncalculated `cachedFov: Set(0)` on `continueGame` or stale viewport snapshot after character creation. |
| **D&D 3.5e Per-Level Spell Slot & Conversion Engine** | `src/rulesets/dnd35e/magic/spellbook_slots.ts` & `src/rendering/ui/dnd35e_spellbook_actions.ts` | Evicts the flat, un-leveled `preparedSpellIds.push(spellId)` prototype in favor of Level `0..9` slot matrices (`general`, `domain`, `specialist`), spontaneous daily cast counters, and Cleric/Druid spontaneous conversion. |
| **ROT.js Display Layout Switching (`rect` ↔ `tile`)** | `src/rendering/display.ts` (`configureDisplayForCampaign`) & `src/rendering/sprite_atlas.ts` (`compositeAtlas`) | Evicts calling `display.setOptions({ layout: 'tile' })` while stale ASCII glyphs (`"#"`) remain in `ROT.Display._data`. |

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Modals / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **Task 1: Parchment Theme Unification (`modals.css`, `console_prototype.css`, `dnd35e_char_builder*.ui.ts`)** | CSS variables defined on `:root` / `:root[data-console-theme='parchment']`. | Consumed by `#char-creation-overlay`, `#level-up-overlay`, `#dnd35e-sheet-overlay`, `#dnd35e-spellbook-overlay`, `.dnd35-*` controls, and `<select>` dropdowns. | Eliminates dark outer modal gap in Character Dossier via `flex: 1; min-height: 0` on `#dnd35e-sheet-body` and `.crpg-prototype-shell`. |
| **Task 2: Fix Inventory (`I`) Hotkey Modal (`cartridge_ui_registry.ts`)** | `IntentType.ToggleInventory` sets `state.uiMode = UIMode.Inventory`. | `renderActiveCartridgeModal` resolves `activeId` to `'inventory'` or `'character_sheet'` when `state.uiMode === UIMode.Inventory`. | Pressing `I` or `Esc` cleanly toggles the Dossier/Inventory modal without freezing gameplay. |
| **Task 3: Paper Doll Rail Mapping & Single Avatar (`dnd35e_ui_projection.ts`, `console_inventory.ui.ts`, `dnd35e_sheet_overview_tab.ui.ts`)** | Reads `EquipmentComponent.slots` (`head_0`, `finger_8`, `finger_9` from `ecs_spawner.ts` or `head_1`, `finger_1`, `finger_2` from `equipment_slots.ts`). | Populates 6 Left Rail and 6 Right Rail slots on the Paper Doll; `rail: 'extra'` only appears when an entity actually has $>12$ / multi-limb slots. | Removes duplicate top portrait box and `"humanoid_biped"` text; updates `UIAnatomicalSlotDescriptor` / `ConsoleInventoryData` with `avatarGlyph`. |
| **Task 4: Initial FOV on Game Load & Char Creation (`world_entities_bootstrap.ts`, `session_dom.ts`, `dnd35e_char_builder.ui.ts`)** | Invoked by `continueGame()` and Character Creation Finish / Quick Start handlers. | Populates `state.cachedFov` and `state.explored` via `updateExploredTiles(state)` and calls `invalidateViewportSnapshot()`. | Map is immediately visible on frame 0 when loading a game or starting a new character. |
| **Task 5: Level 0–9 Spellbook & Slot Engine (`actor_data.types.ts`, `spellbook_slots.ts`, `dnd35e_spellbook.ui.ts`, `dnd35e_spellbook_actions.ts`)** | Reads `DnD35EntityData` (`tracks`, `spellbooksByClass`, `domains`, `arcaneSchool`, `prohibitedSchools`, `acfSwaps`) and effective ability scores. | Renders Level `0..9` tabs, `general`/`domain`/`specialist` slots, multi-copy preparation, Cleric/Druid spontaneous conversion, and Sorcerer/Bard daily cast counters; syncs `preparedSpellIds`/`expendedSpellIds` for hotbar projection. | Register `src/rulesets/dnd35e/magic/spellbook_slots.ts` in `docs/ssot/ssot_dnd35e.json` and regenerate `docs/SSOT_DND35E.md`. |
| **Task 6: 2D Tile Mode Toggle Crash Fix (`display.ts`, `sprite_atlas.ts`, `hud_dock.ui.ts`)** | Invoked by `#hud-render-mode-btn` click in `hud_dock.ui.ts` and campaign load in `session_dom.ts`. | `display.clear()` clears `ROT.Display._data` before `display.setOptions`, and `compositeAtlas` maps fallback ASCII glyphs (`"#"`, `"."`, `"@"`, `"+"`, `"?"`, `" "`) to valid coordinates. | Switching to and from 2D Tile Mode works without throwing `Char "#" not found in tileMap`. |

---

## 4. Step-by-Step Implementation Tasks & Code Snippets

### Task 1: Unify D&D 3.5e Modals Under the Parchment Theme & Fix Modal Container Sizing
**Files:**
- `src/styles/modals.css`
- `src/styles/console_prototype.css`
- `src/rendering/ui/dnd35e_char_builder_class.ui.ts`
- `src/rendering/ui/dnd35e_char_builder_feats.ui.ts`

**Changes:**
1. In `src/styles/modals.css` and `src/styles/console_prototype.css`, style `#char-creation-overlay .modal-content`, `#level-up-overlay .modal-content`, `#dnd35e-sheet-overlay .modal-content`, `#dnd35e-spellbook-overlay .modal-content`, and `.dnd35-*` classes using the parchment theme variables (`--crpg-bg-page`, `--crpg-bg-panel`, `--crpg-bg-card`, `--crpg-text-main`, `--crpg-text-muted`, `--crpg-text-header`, `--crpg-border-gold`, `--crpg-accent-crimson`).
2. Style all `<select>`, `<option>`, and `<input>` elements inside `.dnd35-builder-modal`, `.dnd35-sheet-modal`, and `.dnd35-spellbook-modal` with `background: var(--crpg-bg-card); color: var(--crpg-text-main); border: 1px solid var(--crpg-border-inner);` so dropdowns like `Ability Focus` have crisp dark ink text on warm parchment.
3. Make `#dnd35e-sheet-body`, `.crpg-prototype-shell`, and `.crpg-three-col-grid` flex-fill the modal body cleanly (`display: flex; flex-direction: column; flex: 1; min-height: 0;`) so there is no dark gap at the bottom of the Character Dossier.

```css
/* In src/styles/console_prototype.css */
#dnd35e-sheet-overlay .modal-content.dnd35-sheet-modal,
#char-creation-overlay .modal-content.dnd35-builder-modal,
#level-up-overlay .modal-content.dnd35-builder-modal,
#dnd35e-spellbook-overlay .modal-content.dnd35-spellbook-modal {
  background: var(--crpg-bg-page);
  color: var(--crpg-text-main);
  border: 2px solid var(--crpg-border-gold);
  box-shadow: var(--crpg-shadow-modal);
}

#dnd35e-sheet-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--crpg-bg-page);
}

.crpg-prototype-shell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.crpg-three-col-grid {
  flex: 1;
  min-height: 0;
}
```

---

### Task 2: Fix Pressing `I` (Inventory) Freezing With No Visible Modal
**Files:**
- `src/rendering/ui/cartridge_ui_registry.ts`
- `src/rendering/ui/dnd35e_ui_adapter.ts`

**Changes:**
1. In `renderActiveCartridgeModal` (`src/rendering/ui/cartridge_ui_registry.ts`), resolve `activeId` when `state.uiMode === UIMode.Inventory` so it maps to `'inventory'` (if registered) or `'character_sheet'` (if the cartridge unifies pack/equipment in `'character_sheet'`).
2. In `closeCartridgeModal` (`src/rendering/ui/cartridge_ui_registry.ts`), also close when `state.uiMode === UIMode.Inventory` so clicking the `×` button in `#dnd35e-sheet-overlay` after pressing `I` returns cleanly to `UIMode.Normal`.

```ts
// In src/rendering/ui/cartridge_ui_registry.ts
export function closeCartridgeModal(state: GameState): GameState {
  if (state.uiMode !== UIMode.CartridgeModal && state.uiMode !== UIMode.Inventory) return state;
  return closeModal(state);
}

export function renderActiveCartridgeModal(state: GameState): void {
  const uiDef = getActiveCartridgeUI(state.campaign.rulesetId);
  if (!uiDef?.modals) return;

  const activeId =
    state.uiMode === UIMode.CartridgeModal
      ? state.activeCartridgeModalId
      : state.uiMode === UIMode.Inventory
        ? (uiDef.modals['inventory'] ? 'inventory' : 'character_sheet')
        : undefined;

  for (const [modalId, descriptor] of Object.entries(uiDef.modals)) {
    const el = document.getElementById(descriptor.overlayElementId);
    if (!el) continue;

    if (modalId === activeId) {
      el.classList.remove('hidden');
      descriptor.render(state);
    } else {
      el.classList.add('hidden');
    }
  }
}
```

---

### Task 3: Fix Paper Doll Slot Rail Mapping, Remove `"humanoid_biped"`, and Keep Single Silhouette Avatar
**Files:**
- `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts`
- `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts`
- `src/rendering/ui/console_inventory.ui.ts`
- `src/rendering/ui/dnd35e_sheet_overview_tab.ui.ts`
- `src/types/ui_adapter.types.ts`

**Changes:**
1. In `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts`, replace the unsuffixed `SLOT_VISUAL_MAP[slot.id]` lookup with a deterministic `resolveSlotVisualSpec(slot, typeOccurrenceIndex)` function keyed by `(slot.slotType, occurrenceIndex)`:
   - **Left Rail (6 standard slots):**
     - `head` (`#0`) → `{ label: 'Head', emptyGlyph: '🪖', rail: 'left' }`
     - `back` / `shoulders` (`#0`) → `{ label: 'Cloak / Back', emptyGlyph: '🧥', rail: 'left' }`
     - `arm` (`#0`) / `eyes` (`#0`) → `{ label: 'Bracers L', emptyGlyph: '🧤', rail: 'left' }`
     - `arm` (`#1`) / `hands` (`#0`) → `{ label: 'Bracers R', emptyGlyph: '🧤', rail: 'left' }`
     - `finger` (`#0`) → `{ label: 'Ring L', emptyGlyph: '💍', rail: 'left' }`
     - `main_hand` (`#0`) or `hand` (`#0`) → `{ label: 'Main Hand', emptyGlyph: '⚔️', rail: 'left' }`
   - **Right Rail (6 standard slots):**
     - `neck` (`#0`) → `{ label: 'Neck', emptyGlyph: '📿', rail: 'right' }`
     - `torso` (`#0`) → `{ label: 'Armor / Torso', emptyGlyph: '🛡️', rail: 'right' }`
     - `leg` (`#0`) / `waist` (`#0`) → `{ label: 'Waist / Greaves', emptyGlyph: '🎗️', rail: 'right' }`
     - `foot` (`#0`) → `{ label: 'Boots', emptyGlyph: '🥾', rail: 'right' }`
     - `finger` (`#1`) → `{ label: 'Ring R', emptyGlyph: '💍', rail: 'right' }`
     - `off_hand` (`#0`) or `hand` (`#1`) → `{ label: 'Off Hand', emptyGlyph: '🗡️', rail: 'right' }`
   - **Extra Rail (`rail: 'extra'`, `isExtraLimb: true`):** Only triggered for 3rd+ `arm` (`occurrenceIndex >= 2`), 3rd+ `hand` (`occurrenceIndex >= 2`), 3rd+ `finger` (`occurrenceIndex >= 2`), 2nd+ `head`/`leg`/`foot`, or non-biped appendages (`tail`, `wing`, `tentacle`).
2. Add `resolveActorAvatarGlyph(dndData)` in `dnd35e_ui_projection.ts` (mapping class/form to an appropriate icon: `cleric` → `'☀️'`, `fighter`/`paladin` → `'⚔️'`, `barbarian` → `'🪓'`, `druid` → `'🌿'`, `ranger` → `'🏹'`, `rogue` → `'🗡️'`, `bard` → `'🎵'`, `monk` → `'🥋'`, `wizard`/`sorcerer` → `'🧙‍♂️'`, `marilith_6arm` → `'🐍'`, `quadruped` → `'🐺'`).
3. In `dnd35e_sheet_overview_tab.ui.ts`, remove the duplicate top-left `portraitFrame` box so the top identity block cleanly shows the Alignment/Race/HP header and the 6-Ability Score table, while the Paper Doll arch below displays the single character silhouette (and HP pill) without any `"humanoid_biped"` caption.

---

### Task 4: Fix Blank Map on Game Load & After Character Creation
**Files:**
- `src/core/bootstrap/world_entities_bootstrap.ts`
- `src/core/session_dom.ts`
- `src/rendering/ui/dnd35e_char_builder.ui.ts`

**Changes:**
1. In `continueGame` (`src/core/bootstrap/world_entities_bootstrap.ts`), call `state = updateExploredTiles(state)` before `setGlobalState(state)` so `state.cachedFov` is immediately populated from the loaded player position.
2. In `session_dom.ts` (`continueBtn` click handler) and `dnd35e_char_builder.ui.ts` (`Quick Start` and `Finish Character` handlers), call `updateExploredTiles`, `invalidateViewportSnapshot()`, and `markAllDomainsDirty()` so the viewport renders immediately without waiting for the player to move.

```ts
// In src/core/bootstrap/world_entities_bootstrap.ts (inside continueGame)
const campaign = await loadCampaign(state.campaignId);
state = { ...state, campaign };
state = updateExploredTiles(state);
setGlobalState(state);
return state;
```

---

### Task 5: D&D 3.5e Spellbook / Grimoire Overhaul (Levels 0–9, Multi-Slot Prep, Specialist & Domain Bonus Slots, Spontaneous Casters, and Spontaneous Conversion)
**Files:**
- `src/rulesets/dnd35e/types/data/actor_data.types.ts`
- `src/rulesets/dnd35e/magic/spellbook_slots.ts` (New focused helper module $\le 260$ lines)
- `src/rulesets/dnd35e/progression/ledger_features_spells.ts`
- `src/rendering/ui/dnd35e_spellbook_actions.ts`
- `src/rendering/ui/dnd35e_spellbook.ui.ts`
- `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`

**Changes:**
1. **Extend `DnD35ClassSpellbookState` (`src/rulesets/dnd35e/types/data/actor_data.types.ts`):**
   ```ts
   export type DnD35SpellSlotKind = 'general' | 'domain' | 'specialist';

   export interface DnD35PreparedSlotEntry {
     readonly slotId: string;
     readonly spellLevel: number;
     readonly slotKind: DnD35SpellSlotKind;
     readonly preparedSpellId?: string;
     readonly expended: boolean;
   }

   export interface DnD35ClassSpellbookState {
     readonly classId: string;
     readonly castingMode: 'prepared' | 'spontaneous';
     readonly acquisitionMode: 'spellbook' | 'prayerbook' | 'fixed_known';
     readonly knownSpellIds: readonly string[];
     readonly preparedSpellIds: readonly string[];
     readonly expendedSpellIds: readonly string[];
     readonly preparedSlots?: readonly DnD35PreparedSlotEntry[];
     readonly spontaneousSlotsUsedByLevel?: Readonly<Record<string, number>>;
   }
   ```
2. **Create `src/rulesets/dnd35e/magic/spellbook_slots.ts`:**
   - `computeClassLevelSlotSummary(dndData, classId, effectiveAbilities, fullData)`:
     - Computes per-level (`0..9`) slot breakdown for a class track:
       - `baseSlots` from `progRow.spellsPerDay[String(level)]`
       - `bonusSlots` from `computeBonusSpellSlots(keyAbilityScore, level)` (when `level >= 1` and `baseSlots !== undefined`)
       - `totalGeneralSlots = canCastSpellOfLevel(keyAbilityScore, level) ? baseSlots + bonusSlots : 0`
       - `domainSlots = (progRow.domainSpellSlots?.[String(level)] ?? 0) > 0 && (dndData.domains?.length ?? 0) > 0 ? 1 : 0`
       - `specialistSlots = classId === 'wizard' && level >= 1 && totalGeneralSlots > 0 && dndData.arcaneSchool && dndData.arcaneSchool !== 'universal' ? 1 : 0`
       - `saveDc = 10 + level + computeAbilityModifier(keyAbilityScore)`
   - `reconcilePreparedSlotsForClass(book, dndData, effectiveAbilities, fullData)`:
     - Ensures `book.preparedSlots` has exact `DnD35PreparedSlotEntry` instances matching the current `totalGeneralSlots`, `domainSlots`, and `specialistSlots` across all castable levels `0..9`, preserving any existing `preparedSpellId` and `expended` state on matching `slotId`s.
   - `getAvailableSpellsForClassAndLevel(book, dndData, spellLevel, fullData)`:
     - Returns all spells in `book.knownSpellIds` whose `levelByClass[classId] === spellLevel` PLUS (for Clerics) all spells from `dndData.domains` whose `levelByDomain[domainId] === spellLevel` (tagged as domain spells so they are automatically available!).
   - `getSpontaneousConversionTargets(dndData, classId, spellLevel, fullData)`:
     - **Cleric:**
       - If `cleric_domain_spontaneity_1` ACF is active: returns the Cleric's domain spells at `spellLevel`.
       - Otherwise (`spontaneous_casting`): returns the level-matched *Cure* spell (for Good/Neutral Clerics: `0: cure_minor_wounds`, `1: cure_light_wounds`, `2: cure_moderate_wounds`, `3: cure_serious_wounds`, `4: cure_critical_wounds`, `5: cure_light_wounds_mass`, `6: cure_moderate_wounds_mass`, `7: cure_serious_wounds_mass`, `8: cure_critical_wounds_mass`) or *Inflict* spell (for Evil Clerics: `0: inflict_minor_wounds`, `1: inflict_light_wounds`, ..., `8: inflict_critical_wounds_mass`).
     - **Druid (`spontaneous_summoning`):**
       - For `spellLevel` `1..9`, returns `summon_natures_ally_i` .. `summon_natures_ally_ix`.
3. **Update `src/rendering/ui/dnd35e_spellbook_actions.ts`:**
   - `prepareSpellIntoSpecificSlot(state, entityId, classId, slotId, spellId)`: Prepares `spellId` into a specific open `general`, `domain`, or `specialist` slot (supporting multiple copies of the same spell across multiple open general slots!).
   - `unprepareSpecificSlot(state, entityId, classId, slotId)`: Clears `preparedSpellId` from that slot.
   - `castPreparedSlot(state, entityId, classId, slotId, convertedSpellId?)`: Marks a prepared slot as `expended: true` (or spontaneously converts a general slot into *Cure/Inflict/SNA* and expends it) and logs the cast message.
   - `castSpontaneousSpell(state, entityId, classId, spellId, spellLevel)`: Increments `spontaneousSlotsUsedByLevel[String(spellLevel)]` for Sorcerer/Bard and logs the cast.
   - `executeEightHourRest(state, entityId)`: Recharges all `expended: true` slots back to `expended: false` **while keeping `preparedSpellId` intact**, and resets `spontaneousSlotsUsedByLevel` to `{}`.
4. **Overhaul `src/rendering/ui/dnd35e_spellbook.ui.ts`:**
   - Render **Class Tabs** (with Caster Level, Key Ability Score, and Preparation vs. Spontaneous badge) + **Spell Level Filter Bar (`All`, `Lv 0`, `Lv 1`, ...)** + **`[8-Hour Rest & Recharge]`** button.
   - **Left Pane:**
     - **Prepared Casters:** Level-by-level slot matrix (`Level 0 — 3/3 Prepared`, `Level 1 — 2/2 General + 1/1 Domain`, etc.). Each slot card displays its slot badge (`General`, `Domain (War/Healing)`, `Specialist (Evocation)`), prepared spell (or `— Empty Slot —`), `[Cast]`, `[Convert → Cure/Inflict/SNA]` (for Cleric/Druid general slots), and `[Clear ×]`.
     - **Spontaneous Casters (Sorcerer/Bard):** Level-by-level Daily Casts Matrix (`Level 0: 5 / 5 Remaining (DC 13)`, `Level 1: 4 / 4 Remaining (DC 14)`) with visual slot pips.
   - **Right Pane:**
     - Spells broken down by **Spell Level (`Level 0`, `Level 1`, ...)** with full spell metadata (School, Components, Range, Target/Area, Duration, Save DC, SR).
     - **Prepared Casters:** Buttons on each spell to `[+ Prep General (N open)]`, plus `[+ Prep Domain]` (when the spell is a domain spell for one of the Cleric's domains and the level's domain slot is open) or `[+ Prep School Slot]` (when the spell matches the Wizard's specialist school and the level's specialist slot is open).
     - **Spontaneous Casters:** Direct `[✨ Cast Spell (Lv X — N left)]` button on each known spell.

---

### Task 6: Fix 2D Tile Mode Toggle Crash (`Error: Char "#" not found in tileMap`)
**Files:**
- `src/rendering/display.ts`
- `src/rendering/sprite_atlas.ts`
- `src/rendering/ui/hud_dock.ui.ts`

**Changes:**
1. In `configureDisplayForCampaign` (`src/rendering/display.ts`), call `display.clear()` **before** every `display.setOptions(...)` call so `ROT.Display._data` is emptied before switching between `'rect'` and `'tile'`.
2. In `compositeAtlas` (`src/rendering/sprite_atlas.ts`), map common ASCII fallback glyphs (`'#'`, `'.'`, `'+'`, `'@'`, `'?'`, `' '`, `'<'`, `'>'`) to the fallback tile coordinate `[0, yOffset]` if not already defined in `mergedTileMap`, ensuring `ROT.Display.Tile.draw` never throws an uncaught exception even if an ASCII glyph is ever passed to `Tile.draw`.
3. In `toggleRenderMode` (`src/rendering/ui/hud_dock.ui.ts`), call `display.clear()`, update settings, await `configureDisplayForCampaign(display, state.campaign)`, call `invalidateViewportSnapshot()`, and call `markAllDomainsDirty()`.

```ts
// In src/rendering/display.ts
export async function configureDisplayForCampaign(display: ROT.Display, campaign: CampaignData): Promise<void> {
  display.clear();
  if (!isEffectiveSpriteMode(campaign)) {
    display.setOptions({
      layout: 'rect',
      tileWidth: ASCII_TILE_WIDTH,
      tileHeight: ASCII_TILE_HEIGHT,
      fontSize: ASCII_FONT_SIZE,
      fontFamily: 'monospace'
    });
    return;
  }
  // ... after awaiting compositeAtlas or buildProceduralAtlas:
  display.clear();
  display.setOptions({
    layout: 'tile',
    tileWidth: ...,
    tileHeight: ...,
    tileSet: atlas,
    tileMap: mergedTileMap
  });
}
```

---

## 5. Verification Plan
1. Run `./verify.sh` across all 8 stages (`tsc --noEmit`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `bun run build`, `run-validator.ts`).
2. Add unit tests in `tests/dnd35e_spellbook_slots.test.ts` covering:
   - Level `0..9` slot computation (base + ability bonus + Wizard specialist slot + Cleric domain slot).
   - Multi-copy preparation of the same spell into multiple general slots.
   - Cleric automatic domain spell availability and domain-slot restriction.
   - Cleric spontaneous conversion (*Cure* / *Inflict* / *Domain Spontaneity*) and Druid spontaneous conversion (*Summon Nature's Ally*).
   - Sorcerer / Bard spontaneous daily cast tracking and 8-hour rest recovery.
   - Paper Doll `slotType` + index projection (`head_0`..`foot_11` → 6 Left Rail + 6 Right Rail, `0` extra limbs for `humanoid_biped`).
