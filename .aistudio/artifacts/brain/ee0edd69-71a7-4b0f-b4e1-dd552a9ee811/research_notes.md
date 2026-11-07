# Research Notes — Post-M121 Playtest Bug Analysis & Spellbook Architecture

## 0. Rules & Standards Reiteration
Per `AGENTS.md` and `docs/ARCHITECTURE.md`:
- **Three-Tier Placement Heuristic (Rule 16):**
  - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/rendering/ui/console_*.ui.ts`, `src/rendering/ui/cartridge_ui_registry.ts`):** Ruleset-agnostic modal routing, FOV initialization on load, ROT.js display backend switching (`rect` vs. `tile`), and generic Paper Doll widget rendering.
  - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`):** D&D 3.5e Vancian/Spontaneous/Domain/Specialist slot math, slot preparation/conversion state, and anatomical slot-to-Paper-Doll rail projection (`dnd35e_ui_projection.ts`).
  - **Tier 3 — System Content (`public/data/rulesets/dnd35e/*.json`):** Spell definitions (`levelByClass`, `levelByDomain`, `school`), class progression tables (`spellsPerDay`, `spellsKnown`, `domainSpellSlots`), and domain registries.
- **Strict Type Discipline:** Zero `any`, zero magic values, explicit return types on all functions, `exactOptionalPropertyTypes: true` compliance, and pure JSON-serializable ECS components (no `Map` or `Set` in components).

---

## 1. Root-Cause Analysis of the 6 Reported Issues

### Issue 1: Character Creation & Modal Theme Mismatch (Light Parchment Boxes with Invisible Light Text)
- **Symptom (Screenshots 1 & 2):**
  - In `2. CLASS & PATHS`, the class progression preview container has a light parchment background (`#ebe3d4`) while the text inside it is light cream (`#e2d9c8`), making `Lv 1: BAB +0...` unreadable unless highlighted.
  - In `5. FEATS`, the `<select>` dropdown next to `Ability Focus` has a light parchment background with invisible light text.
  - Even inside the Character Dossier (`Screenshot 3`), the outer `.modal-content` header/frame is dark (`#191c24`) while the inner `.crpg-prototype-shell` is parchment.
- **Root Cause:**
  - `src/styles/console_prototype.css:24-56` sets `:root` and `:root[data-console-theme='parchment']` variables such as `--crpg-bg-page: #d8ceb8`, `--crpg-bg-panel: rgba(244, 238, 225, 0.96)`, `--crpg-bg-card: rgba(235, 227, 212, 0.96)`, and `--crpg-text-main: #261d14` (dark ink).
  - Meanwhile, `#char-creation-overlay`, `#level-up-overlay`, `#dnd35e-sheet-overlay`, `#dnd35e-spellbook-overlay`, and `.dnd35-*` classes in `src/styles/modals.css` hardcode dark backgrounds (`#191c24`, `#12141a`, `rgba(0,0,0,0.28)`) and light text (`--text-main: #e2d9c8`).
  - When `src/rendering/ui/dnd35e_char_builder_class.ui.ts:100` (`background: var(--crpg-bg-card)`) and `src/rendering/ui/dnd35e_char_builder_feats.ui.ts:176` (`background: var(--crpg-bg-card); color: inherit`) use `--crpg-bg-card` inside the dark modal, they render a light parchment box with inherited light text (`#e2d9c8`).
- **Fix Architecture:**
  - Unify all D&D 3.5e modals (`#char-creation-overlay`, `#level-up-overlay`, `#dnd35e-sheet-overlay`, `#dnd35e-spellbook-overlay`) and `.dnd35-*` classes (`modals.css`, `console_prototype.css`, and inline styles in `dnd35e_char_builder*.ui.ts` / `dnd35e_spellbook.ui.ts`) to follow the `--crpg-*` parchment theme variables (`--crpg-bg-page`, `--crpg-bg-panel`, `--crpg-bg-card`, `--crpg-text-main`, `--crpg-text-muted`, `--crpg-text-header`, `--crpg-border-gold`, `--crpg-accent-crimson`) so that headers, frames, cards, inputs, and `<select>` dropdowns share a cohesive, high-contrast parchment aesthetic.

---

### Issue 2: Pressing `I` Freezes the Game With No Window Popping Up
- **Symptom:**
  - Pressing `I` switches the game into `UIMode.Inventory` (blocking movement/world keys until `Esc` is pressed), but no modal appears on screen.
- **Root Cause (`src/rendering/presenter.ts:169-184` & `src/rendering/ui/cartridge_ui_registry.ts:157-179`):**
  1. Pressing `I` dispatches `IntentType.ToggleInventory`, which sets `state.uiMode = UIMode.Inventory`.
  2. In `presentGameState` (`src/rendering/presenter.ts:169`), `if (dirtyDomains.has(PresentationDomain.Inventory))` calls `renderInventoryPanel(state)` (`src/rendering/ui/inventory.ui.ts:19-25`), which sees `state.uiMode === UIMode.Inventory`, finds `#dnd35e-sheet-overlay`, removes `.hidden`, and renders the sheet.
  3. **Immediately afterward on line 183**, `if (dirtyDomains.has(PresentationDomain.Modals))` calls `renderActiveCartridgeModal(state)` (`src/rendering/ui/cartridge_ui_registry.ts:157-179`).
  4. Inside `renderActiveCartridgeModal(state)`:
     ```ts
     const activeId = state.uiMode === UIMode.CartridgeModal ? state.activeCartridgeModalId : undefined;
     ```
     Because `state.uiMode` is `UIMode.Inventory` (not `UIMode.CartridgeModal`), `activeId` is `undefined`. The loop over `uiDef.modals` (`character_sheet`, `spellbook`, `char_creation`, `level_up`) then executes `el.classList.add('hidden')` on `#dnd35e-sheet-overlay` in the exact same frame!
- **Fix Architecture:**
  - In `renderActiveCartridgeModal` (`src/rendering/ui/cartridge_ui_registry.ts`), resolve `activeId` when `state.uiMode === UIMode.Inventory` to `'inventory'` (if registered in `uiDef.modals`) or `'character_sheet'` (if the cartridge shares the unified Dossier for inventory/equipment management), so `renderActiveCartridgeModal` renders and keeps `#dnd35e-sheet-overlay` visible rather than hiding it.

---

### Issue 3: Character Dossier (`C`) Layout, Misclassified "Extra Anatomy & Multi-Limb Slots (12)", Snake Icon (`humanoid_biped`) & Wizard Portrait
- **Symptoms (Screenshot 3):**
  1. **All 12 standard humanoid slots dumped into `"EXTRA ANATOMY & MULTI-LIMB SLOTS (12)"` with `+Limb` badges**, leaving the left and right rails of the Paper Doll arch completely blank.
  2. **Green snake icon (`🐍`) with raw caption `humanoid_biped`** inside the Paper Doll arch.
  3. **Portrait always displays a Wizard emoji (`🧙‍♂️`)** even for a Cleric, Fighter, or Rogue.
  4. **Modal content is shorter than the outer `.modal-content` box**, leaving a large empty gap at the bottom.
- **Root Causes:**
  1. **Slot ID Suffix Mismatch (`src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts:96-148`):**
     - When `spawnEntity` (`src/core/ecs/ecs_spawner.ts:137-141`) spawns the player from `entities.json`, it constructs slot IDs as `${slotType}_${index}`: `'head_0'`, `'neck_1'`, `'torso_2'`, `'back_3'`, `'arm_4'`, `'arm_5'`, `'hand_6'`, `'hand_7'`, `'finger_8'`, `'finger_9'`, `'leg_10'`, `'foot_11'`.
     - Similarly, `buildAnatomyEquipmentSlots('humanoid_biped')` (`src/systems/inventory/equipment_slots.ts:147-167`) creates suffixed IDs (`'head_1'`, `'neck_1'`, `'finger_1'`, `'finger_2'`, etc.).
     - However, `SLOT_VISUAL_MAP` in `dnd35e_ui_projection.ts:96-119` only keyed by unsuffixed names (`'head'`, `'cloak'`, `'ring_1'`, `'main_hand'`, etc.), and `buildAnatomicalSlotsFromEquipment` only checked `SLOT_VISUAL_MAP[slot.id]`.
     - Because `SLOT_VISUAL_MAP['head_0']` was `undefined` for all 12 slots, every single slot fell into the fallback:
       ```ts
       rail: visual ? visual.rail : 'extra',
       isExtraLimb: !visual,
       ```
     - Consequently, `renderReactivePaperDollWidget` (`src/rendering/ui/console_inventory.ui.ts:116-118`) saw `leftSlots.length === 0`, `rightSlots.length === 0`, and `extraLimbs.length === 12` (`>= 3`), which triggered `extraLimbs.length >= 3 ? '🐍' : ...` (the Marilith snake silhouette!) and placed all 12 standard slots into the `"Extra Anatomy & Multi-Limb Slots (12)"` drawer!
  2. **Hardcoded Wizard Portrait (`src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts:276`):**
     - `portraitIcon: '🧙‍♂️'` is hardcoded on line 276 regardless of the character's class (`cleric`, `fighter`, `barbarian`, `rogue`, `monk`, `druid`, `paladin`, `ranger`, `bard`, `sorcerer`, `wizard`).
  3. **Raw `humanoid_biped` Caption (`src/rendering/ui/console_inventory.ui.ts:127`):**
     - `renderReactivePaperDollWidget` renders `${escapeHtml(doll.morphologyLabel)}` directly (`humanoid_biped`) instead of a human-readable anatomy title (e.g. `Humanoid (Biped)`).
  4. **Modal Height Gap (`src/styles/console_prototype.css:7-38`):**
     - `#dnd35e-sheet-overlay .modal-content.dnd35-sheet-modal` sets `height: 92vh` (from `modals.css`) while `#dnd35e-sheet-body`, `.crpg-prototype-shell`, and `.crpg-three-col-grid` do not stretch via `flex: 1; min-height: 0;` to fill the modal body.
- **Fix Architecture:**
  - Replace naive `SLOT_VISUAL_MAP[slot.id]` lookup in `buildAnatomicalSlotsFromEquipment` (`src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts`) with a deterministic **slot-type + per-type occurrence index resolver**:
    - Left Rail (6 standard slots): `head` (1st) → `Head`, `eyes` (1st) → `Eyes`, `back`/`shoulders`/`cloak` (1st) → `Cloak / Back`, `arm`/`bracers`/`wrists` (1st) → `Bracers / Arms`, `finger`/`ring` (1st) → `Ring L`, `main_hand`/`hand` (1st) → `Main Hand`.
    - Right Rail (6 standard slots): `neck`/`amulet` (1st) → `Neck`, `torso`/`chest`/`armor` (1st) → `Armor / Torso`, `body`/`robe` (1st) or `arm` (2nd) → `Robe / Wrists`, `waist`/`belt` (1st) or `leg` (1st) → `Waist / Greaves`, `finger`/`ring` (2nd) → `Ring R`, `off_hand`/`hand` (2nd) → `Off Hand`, `foot`/`boots` (1st) → `Boots`.
    - Only genuine overflow/extra limbs (e.g. 3rd+ `arm`, 3rd+ `hand`, 3rd+ `finger`, `tail`, `wing`, `tentacle` on multi-limbed creatures like a 6-armed Marilith) are routed to `rail: 'extra'` with `isExtraLimb: true`.
  - Derive `portraitIcon` and Paper Doll silhouette icon dynamically from primary class / morphology (`fighter`/`paladin`/`barbarian` → `'⚔️'`/`'🛡️'`, `cleric` → `'✝️'`/`'☀️'`, `druid`/`ranger` → `'🌿'`/`'🏹'`, `rogue`/`bard` → `'🗡️'`/`'🎵'`, `monk` → `'🥋'`, `wizard`/`sorcerer` → `'🧙‍♂️'`), and format `morphologyLabel` into readable title case (`Humanoid Biped`).
  - Make `#dnd35e-sheet-body`, `.crpg-prototype-shell`, and `.crpg-three-col-grid` flex-fill the modal container cleanly with zero dead space at the bottom.

---

### Issue 4: Blank / Unrendered Map on Game Load Until Moving Character
- **Symptom:**
  - When loading a saved game (`Continue`), the viewport canvas is completely dark/blank until the player moves a step.
- **Root Cause (`src/core/bootstrap/world_entities_bootstrap.ts:176-203` & `src/core/save.ts:224-225`):**
  1. `deserializeGameState` (`src/core/save.ts:224-225`) sets `fovNeedsUpdate: true` and `cachedFov: new Set<number>()`.
  2. `continueGame` (`src/core/bootstrap/world_entities_bootstrap.ts:176-203`) deserializes the save and calls `setGlobalState(state)` **without calling `updateExploredTiles(state)`**!
  3. Because `state.cachedFov` is an empty `Set`, `buildViewportSnapshot` (`src/rendering/viewport_snapshot.ts`) treats every tile on the map as out-of-FOV (`visibleIndices.has(idx) === false`), leaving the viewport unlit until the first turn action triggers `updateExploredTiles`!
  4. Similarly, when completing Character Creation (`src/rendering/ui/dnd35e_char_builder.ui.ts:280-284, 322-326`), `updateExploredTiles` and `invalidateViewportSnapshot()` were not invoked when transitioning from `UIMode.CartridgeModal` back to `UIMode.Normal`.
- **Fix Architecture:**
  - Call `state = updateExploredTiles(state)` inside `continueGame` (`src/core/bootstrap/world_entities_bootstrap.ts`) before `setGlobalState(state)`.
  - In `session_dom.ts` (`continueGame` button handler) and `dnd35e_char_builder.ui.ts` (Quick Start & Finish Character Creation), call `invalidateViewportSnapshot()` and `markAllDomainsDirty()` so the viewport immediately renders the player's FOV on frame 0.

---

### Issue 5: D&D 3.5e Spellbook / Grimoire Architecture (Level 0–9 Breakdown, Multi-Slot Prep, Specialist & Domain Bonus Slots, Spontaneous Casters, and Spontaneous Cure/Inflict/SNA Conversion)
- **Symptom:**
  - Currently, `src/rendering/ui/dnd35e_spellbook.ui.ts` renders two flat ungrouped lists (`Prepared / Active Slots` and `Known Spells / Prayerbook`) with no spell levels (`0..9`), no slot counts, no way to see how many slots exist per level, no domain bonus slots or specialist school slots, no differentiation between prepared casters (Wizard, Cleric, Druid, Paladin, Ranger) and spontaneous casters (Sorcerer, Bard), and no spontaneous conversion of prepared slots into *Cure/Inflict Wounds* (Cleric) or *Summon Nature's Ally* (Druid).
- **Root Cause:**
  - While `src/rulesets/dnd35e/magic/spellcasting.ts` already implements `computeBonusSpellSlots`, `canCastSpellOfLevel`, and `convertPreparedSlotSpontaneously`, `DnD35ClassSpellbookState` (`src/rulesets/dnd35e/types/data/actor_data.types.ts:62-75`) and `src/rendering/ui/dnd35e_spellbook.ui.ts` were left as an early flat-array prototype (`preparedSpellIds: readonly string[]`, `expendedSpellIds: readonly string[]`).
- **Fix Architecture (Tier 2 Ruleset + UI Projection):**
  1. **Structured Slot & Spontaneous Cast State (`DnD35ClassSpellbookState` in `actor_data.types.ts` & `ledger_features_spells.ts`):**
     - Preserve backward-compatible `preparedSpellIds` / `expendedSpellIds` while adding structured per-level slot & cast tracking on `DnD35ClassSpellbookState`:
       - `preparedSlots?: ReadonlyArray<DnD35PreparedSlotEntry>` where each `DnD35PreparedSlotEntry` has:
         - `slotId: string` (e.g. `'lv1_base_0'`, `'lv1_domain_0'`, `'lv1_specialist_0'`)
         - `spellLevel: number` (`0..9`)
         - `slotKind: 'general' | 'domain' | 'specialist'`
         - `preparedSpellId?: string` (the spell currently memorized in this slot, if any)
         - `expended: boolean` (whether this slot has been cast/expended today)
       - `spontaneousSlotsUsedByLevel?: Readonly<Record<string, number>>` (tracks how many daily casts have been spent at each spell level `'0'..'9'` for spontaneous casters like Sorcerer and Bard).
  2. **Deterministic Slot Capacity Computation (`src/rulesets/dnd35e/magic/spellbook_slots.ts`):**
     - For any spellcasting class track on the actor (`classId`, `classLevel`) and the actor's effective key ability score (`INT` for Wizard, `WIS` for Cleric/Druid/Paladin/Ranger, `CHA` for Sorcerer/Bard):
       - **Minimum Ability Score Gate (`canCastSpellOfLevel`):** A caster can only cast/prepare spells of level $L$ if $\text{AbilityScore} \ge 10 + L$.
       - **Base Slots (`spellsPerDay[L]`):** Read from `classDef.progression[classLevel - 1].spellsPerDay[String(L)]`. (Note: if `baseSlots === 0`, e.g., Level 4 Paladin/Ranger or Level 1 Bard at Lv 1, they only gain slots at that level if their ability bonus grants $>0$ bonus slots; if `spellsPerDay[String(L)] === undefined`, the class cannot cast level $L$ yet).
       - **Ability Bonus Slots (`computeBonusSpellSlots(abilityScore, L)`):** Added to `general` slots for $L \ge 1$ whenever the class has access to spell level $L$.
       - **Wizard Specialist School Slot (`+1` `slotKind: 'specialist'` per castable level $L \ge 1$):** Granted when `classId === 'wizard'` and `dndData.arcaneSchool` is set and $\ne \text{'universal'}$. Restricted to spells whose `spell.school === dndData.arcaneSchool` (and forbidden schools `dndData.prohibitedSchools` are blocked from preparation/learning).
       - **Cleric Domain Slot (`+1` `slotKind: 'domain'` per castable level $L \ge 1$):** Granted when `progRow.domainSpellSlots?.[String(L)] > 0` and the Cleric has chosen domains (`dndData.domains`). Restricted to spells granted by the Cleric's selected domains at level $L$ (`spell.levelByDomain?.[domainId] === L`). Domain spells are automatically included in the Cleric's available spells at that level!
  3. **Spontaneous Conversion Rules (Cleric & Druid):**
     - **Cleric (`spontaneous_casting` feature):** Any unexpended prepared `'general'` slot of level $L \ge 1$ (or $L = 0$ for `cure_minor_wounds` / `inflict_minor_wounds`) can be spontaneously converted at cast time:
       - Good / Neutral Clerics convert into the level-$L$ *Cure* spell (`1: cure_light_wounds`, `2: cure_moderate_wounds`, `3: cure_serious_wounds`, `4: cure_critical_wounds`, `5: cure_light_wounds_mass`, `6: cure_moderate_wounds_mass`, `7: cure_serious_wounds_mass`, `8: cure_critical_wounds_mass`).
       - Evil Clerics (`alignment` ending in `'E'`) convert into the level-$L$ *Inflict* spell (`1: inflict_light_wounds`, `2: inflict_moderate_wounds`, `3: inflict_serious_wounds`, `4: inflict_critical_wounds`, etc.).
       - If the Cleric selected the **Domain Spontaneity ACF (`cleric_domain_spontaneity_1`)**, prepared `'general'` slots convert into their chosen Domain spells of level $L$ instead!
     - **Druid (`spontaneous_summoning` feature):** Any unexpended prepared `'general'` slot of level $L \in [1..9]$ can be spontaneously converted at cast time into `summon_natures_ally_i` .. `summon_natures_ally_ix` of level $L$.
  4. **Prepared vs. Spontaneous UI Workflow (`src/rendering/ui/dnd35e_spellbook.ui.ts` & `dnd35e_spellbook_actions.ts`):**
     - **Spell Level Tabs (`All Levels`, `Lv 0 (Orisons/Cantrips)`, `Lv 1`, `Lv 2`, ... up to max castable level)** at the top of the Grimoire, alongside class tabs (for multiclass casters) and key ability score / Save DC (`10 + Spell Level + Key Ability Mod`) summary.
     - **For Prepared Casters (Wizard, Cleric, Druid, Paladin, Ranger):**
       - **Left Pane — Memorized Spell Slots by Level:** Grouped by Spell Level (`Lv 0`, `Lv 1`, ...). Shows every individual slot box (`[General Slot #1]`, `[General Slot #2]`, `[Domain Slot (War/Healing)]`, `[Specialist Slot (Evocation)]`).
         - Filled slots show the prepared spell name, school/save badge, `[Cast]`, `[Unprepare ×]`, and—for Clerics/Druids on general slots—a `[Convert → Cure/Inflict/SNA]` action button!
         - Empty slots show `— Empty General/Domain/Specialist Slot —`.
       - **Right Pane — Known Spells / Prayerbook & Domain Spells by Level:** Grouped by Spell Level. Each spell row shows its school, components, range/save/SR metadata, and:
         - `[+ Prep General (N open)]` (can be clicked multiple times to prepare multiple copies of the same spell into open general slots of that level!)
         - `[+ Prep Domain]` (if the spell matches one of the Cleric's domains at that level and the domain slot is open)
         - `[+ Prep Specialist]` (if the spell matches the Wizard's specialist school and the specialist slot is open).
     - **For Spontaneous Casters (Sorcerer, Bard):**
       - **Left Pane — Daily Spell Casts Remaining by Level:** Shows visual slot pips / counters per spell level (`Level 0: 5 / 5 Remaining`, `Level 1: 4 / 4 Remaining`, etc., including CHA bonus slots).
       - **Right Pane — Known Spells by Level:** Grouped by Spell Level, with a direct `[Cast Spell (Uses Lv X Slot)]` button on every known spell that decrements the remaining casts for that level and logs/executes the cast!
     - **8-Hour Rest (`[8-Hour Rest & Recharge]`):**
       - For Prepared Casters: Recharges all `expended: true` slots back to `expended: false` while **keeping their memorized `preparedSpellId` intact** (so a Wizard or Cleric doesn't lose their memorized loadout on rest, while still allowing them to swap any slot freely).
       - For Spontaneous Casters: Resets `spontaneousSlotsUsedByLevel` to `{}` (all daily casts restored).

---

### Issue 6: Crash When Toggling To and From 2D Tile Mode (`Error: Char "#" not found in tileMap`)
- **Symptom:**
  - Clicking the `2D Tiles` / `ASCII` toggle button on the HUD dock throws:
    `Error: Char "#" not found in tileMap at Tile.draw (rot-js.js:497:15) at Display._draw (rot-js.js:1915:19) at Display._tick (rot-js.js:1897:14)`.
- **Root Cause (`src/rendering/display.ts:44-86` & `src/rendering/ui/hud_dock.ui.ts:157-184`):**
  1. Inside `rot-js`, `ROT.Display` caches every drawn cell's character array in `this._data["x,y"] = [x, y, ch, fg, bg]` and schedules `this._tick()` via `requestAnimationFrame` whenever `this._dirty` is truthy.
  2. When the game is in ASCII (`layout: 'rect'`) mode, `this._data` is populated with ASCII characters like `"#"` (walls), `"."` (floors), and `"@"`.
  3. When the user clicks the render mode toggle, `configureDisplayForCampaign` (`src/rendering/display.ts:53, 84`) calls:
     ```ts
     display.setOptions({
       layout: 'tile',
       tileWidth: ...,
       tileHeight: ...,
       tileSet: atlas,
       tileMap: mergedTileMap,
     });
     ```
  4. Inside `rot-js`, `Display.prototype.setOptions` immediately sets `this._dirty = true` (which schedules or runs `Display._tick()` on the next animation frame using the **existing `this._data` cells**!).
  5. When `Display._tick()` iterates over the old `this._data` cells before `renderGame` overwrites them—or if any cell still contains `"#"` while `mergedTileMap` in `dnd35e-crypt` only maps sprite keys (`"wall_brick"`, `"floor_crypt"`, etc.)—`ROT.Display.Tile.draw` executes:
     ```js
     let tile = this._options.tileMap[ch];
     if (!tile) { throw new Error('Char "' + ch + '" not found in tileMap'); }
     ```
     which crashes immediately with `Error: Char "#" not found in tileMap`!
  6. Furthermore, in `toggleRenderMode` (`src/rendering/ui/hud_dock.ui.ts:163`), `updateSettings({ renderMode: nextMode })` was called **before** `await configureDisplayForCampaign(...)` completed. Because `configureDisplayForCampaign` awaits `compositeAtlas(campaign)` asynchronously, any render tick occurring during that `await` saw `isEffectiveSpriteMode() === true` while `display` was still in `'rect'` mode (or vice versa), and `toggleRenderMode` did not call `invalidateViewportSnapshot()` after the switch!
- **Fix Architecture:**
  1. In `configureDisplayForCampaign` (`src/rendering/display.ts`), always call `display.clear()` **immediately before** calling `display.setOptions(...)` so `ROT.Display._data` is completely empty when switching between `'rect'` and `'tile'` backends.
  2. In `compositeAtlas` (`src/rendering/sprite_atlas.ts`), ensure common ASCII fallback glyphs (`"#"`, `"."`, `"+"`, `"@"`, `"?"`, `" "`) are mapped to the fallback/procedural coordinates in `tileMap` if not already present, preventing `Tile.draw` from ever throwing on an unmapped character.
  3. In `toggleRenderMode` (`src/rendering/ui/hud_dock.ui.ts`), await `configureDisplayForCampaign` and call `invalidateViewportSnapshot()` + `markAllDomainsDirty()` atomically so the viewport redraws every cell with the matching backend immediately.

---

## 2. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Modals / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Parchment Theme Unification (`modals.css`, `console_prototype.css`, `dnd35e_char_builder*.ui.ts`)** | Triggered whenever `#char-creation-overlay`, `#level-up-overlay`, `#dnd35e-sheet-overlay`, or `#dnd35e-spellbook-overlay` is shown. | Consumed by browser CSS layout across all 6 Character Creation tabs, Level-Up wizard, Character Dossier, and Grimoire. | Keeps `:root[data-console-theme='parchment']` variables as the single source of truth across all D&D 3.5e modals. |
| **2. Inventory (`I`) Modal Resolution (`cartridge_ui_registry.ts`)** | `IntentType.ToggleInventory` sets `state.uiMode = UIMode.Inventory`. | `presentGameState` calls `renderInventoryPanel` and `renderActiveCartridgeModal`. Mapping `UIMode.Inventory` in `renderActiveCartridgeModal` prevents it from re-hiding `#dnd35e-sheet-overlay`. | Preserves `Esc` closing behavior (`input_Modal.ts` handles `UIMode.Inventory` → `IntentType.ToggleInventory`). |
| **3. Paper Doll Slot Rail Projection & Portrait Icons (`dnd35e_ui_projection.ts`, `console_inventory.ui.ts`)** | Reads `EquipmentComponent.slots` spawned by `ecs_spawner.ts` (`head_0`, `finger_8`, `finger_9`) or `equipment_slots.ts` (`head_1`, `finger_1`, `finger_2`). | `renderReactivePaperDollWidget` renders 6 left-rail and 6 right-rail slots for standard bipeds, reserving `rail: 'extra'` strictly for 3rd+ multi-limb slots. | Existing unit tests in `tests/dnd35e_phase4_5_smoke.test.ts` and `tests/equipment_slots.test.ts` remain green. |
| **4. Initial FOV Update on Game Load (`world_entities_bootstrap.ts`, `session_dom.ts`, `dnd35e_char_builder.ui.ts`)** | `continueGame` in `world_entities_bootstrap.ts` and character creation completion in `dnd35e_char_builder.ui.ts`. | Populates `state.cachedFov` and `state.explored` via `updateExploredTiles(state)` and invalidates viewport snapshot before first render. | Ensures both `New Game` (after Char Creation) and `Continue Game` render full FOV on frame 0 without requiring player movement. |
| **5. Level 0–9 Spellbook & Slot Engine (`actor_data.types.ts`, `spellbook_slots.ts`, `dnd35e_spellbook.ui.ts`, `dnd35e_spellbook_actions.ts`)** | Reads `ClassProgressionComponent`, `CharacterProgressionLedgerComponent`, `AbilityScoresComponent`, and `DnD35RulesetAdapter.getFullData()`. | Synchronizes `DnD35ClassSpellbookState.preparedSlots` & `spontaneousSlotsUsedByLevel` with `preparedSpellIds`/`expendedSpellIds` for backward compatibility with HUD hotbar (`dnd35e_ui_projection.ts`). | Updates `docs/SSOT_DND35E.md` (`ssot_dnd35e.json`) if a helper module is added; covered by unit tests for Wizard specialist slots, Cleric domain & spontaneous conversion, Druid SNA conversion, and Sorcerer/Bard spontaneous casts. |
| **6. 2D Tile Mode Toggle Crash Fix (`display.ts`, `hud_dock.ui.ts`, `sprite_atlas.ts`)** | Triggered by `#hud-render-mode-btn` click in `hud_dock.ui.ts` or campaign bootstrap in `session_dom.ts`. | `display.clear()` wipes stale `_data` before `display.setOptions` switches between `'rect'` and `'tile'`, and `invalidateViewportSnapshot()` forces a clean full redraw. | Works identically for procedural sprite campaigns and atlas-backed campaigns (`dnd35e-crypt`). |
