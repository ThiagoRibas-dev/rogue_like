# Research Notes — UX Polish, Language & Social Verbs, Map Bug Fixes, and 3-Tier Command/Keybind Overhaul

*Compiled per `AGENTS.md` Kickoff Flow Steps 1–3 before drafting `implementation_plan.md` or modifying code.*

---

## 1. Architectural Rules & Standards Reiteration
- **ECS & State Purity (`AGENTS.md` §4):** Plain JSON-serializable components (no `Map`/`Set` inside components), immutable `GameState` updates.
- **Three-Tier Placement (`AGENTS.md` Rule 16):**
  - Tier 1 Console: Modal pane scrolling, top-bar Z coordinate display, Digger door/edge-portal fixes, Console Language & Text Obfuscation engine, Look/Verb Menu `talk`/`attack`/`shove` verbs, Debug Mode toggle, and 3-tier Command/Keybind taxonomy.
  - Tier 2 Cartridge (`dnd35e`): Feat/Skill wizard filters & fuzzy search, conditional Level-Up Feats step, spell/creature-type language comprehension hooks (*Speak with Animals*, *Tongues*, *Comprehend Languages*, etc.), and D&D 3.5e Overrun/Bull Rush delegation for `shove`.
  - Tier 3 System Content / Campaign Data: Declarative feat/skill category metadata, communication spells, creature language/immovable flags, and Shroudgarde edge portal visuals.
- **Rule 21 (Zero Content-ID Branching):** All feat/skill categories, language comprehension effects, and creature shove/immovable flags must be modeled declaratively in Zod schemas & JSON, never hardcoded by content ID in `.ts`.
- **Rule 17 (Baseline Rules + Declarative Overrides):** D&D 3.5e communication overrides (e.g. `comprehend_all_languages`, `speak_all_languages`, `communicate_creature_type:<type>`) and Overrun/Shove modifiers flow through `StatModifier` / `RuleOverride` bundles.

---

## 2. Detailed Findings by Issue

### 2.1 Two-Pane Modal Independent Scrollbars
- **Affected Files:** `src/styles/primitives.css`, `src/styles/views/dnd35e.css`, `src/rendering/ui/primitives/ModalShell.tsx`, plus two-pane modals (`DnD35eCharBuilderModal.tsx`, `DnD35eLevelUpModal.tsx`, `DnD35eSpellbookModal.tsx`, `DnD35eSheetModal.tsx`, `QuestsModal.tsx`, `InvestigationModal.tsx`, `NemesisDossierModal.tsx`, `LegendsModal.tsx`, `TradeModal.tsx`).
- **Root Cause:**
  1. `.ui-modal` has `max-height: 90vh; overflow: hidden;` (`primitives.css:516-521`), while `.ui-modal__body` has `overflow: auto; flex: 1 1 auto;` (`primitives.css:563-567`) and is **not** a flex column (`display: flex; flex-direction: column; min-height: 0;`).
  2. Multi-pane modals do not pass `fullHeight` (or a locked-body layout mode) to `<ModalShell />`. Consequently, `.ui-dnd-sheet-body`, `.ui-dnd-wizard-stage`, and `.ui-split-pane` expand to their unconstrained content height, causing `.ui-modal__body` (the parent) to scroll as one block rather than letting the left and right panes scroll independently.
- **Fix Direction:** Add a declarative `scrollMode?: 'body' | 'panes'` prop (default `'body'`) on `<ModalShell />`. When `scrollMode="panes"`, apply a bounded modal height (`height: min(90vh, 880px)` / `fullHeight`) and `.ui-modal__body--panes { display: flex; flex-direction: column; overflow: hidden; min-height: 0; }`, while ensuring every child two-pane wrapper (`.ui-split-pane`, `.ui-dnd-wizard-stage`, `.ui-dnd-sheet-2col`, `.ui-dnd-sheet-3col`) has `flex: 1 1 auto; min-height: 0; overflow: hidden;` and each sub-pane (`.ui-dnd-wizard-pane`, `.ui-dnd-col`, `.ui-split-pane > *`) has `min-height: 0; overflow-y: auto;`.

### 2.2 D&D 3.5e Character Creation Feats: `[Fighter]` Suffix, Fuzzy Search & Expanded Category Filters
- **Affected Files:** `src/rendering/ui/cartridges/dnd35e/DnD35eSharedFeatsStep.tsx`, `src/rendering/ui/cartridges/dnd35e/DnD35eInspector.tsx`, `src/rulesets/dnd35e/types/dnd35e_system.types.ts`, `src/utils/fuzzy_match.ts` (new shared helper extracted from `VerbMenuPopover.tsx`).
- **Findings:**
  - `DnD35eSharedFeatsStep.tsx:285` explicitly appends `${cat.isFighterBonus ? ' [Fighter]' : ''}` to every Fighter bonus feat title even though the `Fighter Bonus` filter chip and right-pane Inspector badge already communicate it.
  - Currently only 5 filter chips exist (`All`, `Eligible`, `Fighter Bonus`, `Combat`, `Metamagic / Magic`) and there is no search input.
  - `classifyDnD35eFeatCategory` (`DnD35eInspector.tsx:35-72`) lumps Metamagic and general Magic together and relies on string heuristics (`descLower.includes(...)`). Separating **Metamagic** (`feat.metamagicDescriptor !== undefined`), **Combat**, **Fighter Bonus**, **Magic / Spellcasting**, **Skill & Utility**, **Proficiency**, and **Monster / Natural** (plus optional declarative `featCategories` in `DnD35FeatDefinitionSchema`) makes filtering crisp and Rule 21 compliant.

### 2.3 Origin of "Judicious Spell" Feat
- **Exact Source Found:**
  - File: `public/data/rulesets/dnd35e/feats/judicious_spell.json`
  - Engine wiring: `src/rulesets/dnd35e/magic/spell_cast_helpers.ts:85,129`, `src/rulesets/dnd35e/magic/spell_cast_resolver.ts:290,409`, `src/rulesets/dnd35e/magic/metamagic_dispel.ts:14`, `src/rulesets/dnd35e/system_content_feat_ids.ts:72`.
  - Historical origin (`docs/incursion/INCURSION_FEATURES_AND_MECHANICS.md:92`, `docs/MILESTONES.md:2092`): Ported from the roguelike **Incursion: Halls of the Goblin King** (`MM_JUDICIOUS` — +1 spell level metamagic that excludes allies inside offensive AoEs). Added in Milestone 136 alongside *Reach Spell* to showcase declarative `target_category_filter.ts`.

### 2.4 D&D 3.5e Skills Filters (Knowledge + Governing Attribute + Search)
- **Affected Files:** `src/rendering/ui/cartridges/dnd35e/DnD35eSharedSkillsStep.tsx`, `src/rulesets/dnd35e/types/dnd35e_system.types.ts`.
- **Findings:**
  - Currently only 4 chips exist: `All`, `Class`, `Trained-Only`, `Invested`.
  - Every `DnD35SkillDefinition` already exposes `keyAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'` (`dnd35e_system.types.ts:122`) and Knowledge skills expose `studiedCreatureTags` (10 Knowledge skills exist: Arcana, Architecture, Dungeoneering, Geography, History, Local, Nature, Nobility, Planes, Religion).
  - Adding a declarative `skillGroup?: 'knowledge' | 'craft' | 'perform' | 'profession' | 'general'` (or filtering Knowledge via `skillGroup` + governing attribute chip row `Any | STR | DEX | CON | INT | WIS | CHA` + fuzzy search) satisfies Rule 21 cleanly.

### 2.5 Look Menu Interactions (`talk`, `attack`, `shove`), Console Language System & Cartridge Communication Rules
- **Affected Files:**
  - `src/constants/verbs.constants.ts`, `src/systems/apply.system.ts`, `src/core/input/gameplay_input.ts`, `src/systems/movement.system.ts`, `src/systems/targeting.system.ts`.
  - New Tier 1 Language module: `src/systems/language.system.ts`, `src/types/language.types.ts` (or in `campaign.types.ts` / `components.types.ts`), wired into `src/systems/dialogue.system.ts`, `src/rendering/ui/modals/DialogueModal.tsx`, and speech barks.
  - Tier 2 Cartridge hooks on `IRuleset` (`src/types/ruleset.types.ts`) implemented in `src/rulesets/dnd35e/` (comprehension via spells/tags/creature types + `overrun` / `bull_rush` delegation for `shove`).
- **Findings:**
  1. **Why Look/VerbMenu has no `talk`**: `'talk'` is absent from `VERBS` (`verbs.constants.ts`) and `collectRawValidVerbsForTarget` (`apply.system.ts:591`). Bumping an NPC with `DialogueComponent` triggers `processInteractIntent` directly (`movement.system.ts:421`). Adding `'talk'` as a Console verb (valid on entities with `DialogueComponent` or `Speech`/actor identity) exposes it seamlessly in Look (`X` -> `Enter`) and right-click Context Verb Menus.
  2. **Console Language System (Tier 1)**: No language obfuscation system currently exists (`speak_language.json` exists only as a D&D 3.5e skill stub). A clean Console design stores `languages?: string[]` (spoken/understood) and `primaryLanguage?: string` on actors/templates, optional `languageId` on dialogue trees/nodes/barks, and a deterministic phonetic/syllable obfuscator (`obfuscateTextForLanguage(text, languageId, proficiency)`).
  3. **Cartridge Comprehension (Tier 2)**: Console invokes `ruleset.evaluateLanguageComprehension?.(state, listenerId, speakerId, languageId)` which checks D&D 3.5e `Speak Language` ranks, racial/bonus languages, and declarative Layer B effect overrides/tags (`comprehend_all_languages`, `speak_all_languages`, `communicate_creature_type:animal|plant|undead|vermin`, `telepathy_range`). Communication spells (*Speak with Animals*, *Speak with Plants*, *Speak with Dead*, *Comprehend Languages*, *Tongues*) are not yet in `public/data/rulesets/dnd35e/spells/` and can be authored cleanly in JSON.
  4. **Attack Friendly (Look vs Aim)**:
     - Currently bump-movement refuses to attack non-hostiles (`movement.system.ts:336`), `VerbMenu` has no `'attack'` verb, and Aim (`targeting.system.ts`) cycles only hostiles (`gameplay_input.ts:116`) and has no generic ranged/melee attack resolution for neutral/friendly targets outside spell/throw contexts.
     - Exposing `'attack'` in Look/VerbMenu (for adjacent melee or armed ranged attack, marking target hostile / logging assault) AND allowing Aim (`combat.target_toggle`) to target non-hostile actors directly cleanly supports both melee and ranged friendly fire without accidental bump attacks.
  5. **Shove (Console) -> Overrun / Bull Rush (D&D 3.5e)**:
     - `'shove'` added to `VERBS` (Console level). On willing/friendly actors it displaces/swaps them; on enemies it delegates to `ruleset.resolveShove?.(...)` (D&D 3.5e Overrun/Bull Rush using `maneuvers_conditions.ts` / `bull_rush_resolver.ts` with `Improved Overrun` / `Improved Bull Rush` declarative modifiers).
     - **Open Question (cut-off user sentence):** The user wrote *"with a flag we can enable on creature to make it "* — needs clarification on the exact creature flag behavior (e.g., `unshovable` / `immovable` / `anchored`, or `allowBumpShove`, or `hostileOnShove`).

### 2.6 D&D 3.5e Level-Up: Hide Feats Tab When `totalFeatSlots === 0`
- **Affected Files:** `src/rendering/ui/cartridges/dnd35e/DnD35eLevelUpModal.tsx` (lines 130–145).
- **Root Cause:** `tabsMeta` unconditionally inserts `{ id: 'feats', label: ... }` even when `totalFeatSlots === 0` (levels 2, 4, 5, 7, 8, etc. without class bonus feat slots).
- **Fix:** Conditionally include `'feats'` in `tabsMeta` only when `totalFeatSlots > 0`, dynamically numbering subsequent tabs (`1., 2., 3., ...`) and resetting `activeTab` safely if switching classes removes the feat slot.

### 2.7 Top Bar Coordinates Always Display `Z`
- **Affected Files:** `src/rendering/ui/hud/ChronosStrip.tsx` (lines 61–69).
- **Root Cause:** Line 63 gates `Z:${playerZ}` behind `multiZ ? ... : 'X:${pos.x} Y:${pos.y}'`, hiding `Z:0` on single-Z areas.
- **Fix:** Always render `X:${pos.x} Y:${pos.y} Z:${playerZ}` (appending ` (View:${viewZ})` whenever `zOffset !== 0`).

### 2.8 Shroudgarde Southern Gate: Adjacent & Floating Doors Bug
- **Affected Files:** `src/map/generator_stages.ts` (lines 254–264).
- **Root Cause:**
  - `shroudgarde_gate` uses `"generatorType": "digger"`.
  - In `generator_stages.ts:256-263`, `diggerRooms.map((r) => r.getDoors((dx, dy) => ...))` places a `wooden_door` entity at every coordinate emitted by `ROT.Map.Digger` room perimeters with **zero validation**:
    1. Does not verify the cell has a valid opposing wall frame (`(W solid && E solid && N walkable && S walkable)` OR `(N solid && S solid && W walkable && E walkable)`). When corridors widen or rooms kiss along an edge, `ROT.Map.Digger` emits door cells protruding into open space (`d` directly above `wwwdwww`).
    2. Does not deduplicate `(dx, dy)` across adjacent rooms or prevent orthogonally adjacent doors (`(dx±1, dy)` / `(dx, dy±1)`).
    3. Does not skip tiles already occupied by portals.
- **Fix:** Collect all `r.getDoors()` candidates into a deduplicated set after rooms & portals are carved, filter strictly to cells with a valid opposing wall frame (two opposite solid walls + two opposite walkable floors), exclude portal tiles, and enforce minimum orthogonal separation (no two doors adjacent).

### 2.9 Shroudgarde Southern Gate <-> Town Square Transition Shown as `stairs_down`
- **Affected Files:** `src/systems/map/map_generation_spawner.ts` (lines 191–210), `src/core/bootstrap.ts` (lines 217–255), `public/data/campaigns/realms-of-shroudgarde/areas.json` & `entities.json` & `tiles.json`.
- **Root Cause:**
  1. In `realms-of-shroudgarde/areas.json`, `shroudgarde_courtyard` <-> `shroudgarde_gate` uses `"direction": "edge"` (`placementSide: "bottom"` / `"top"`) with **no** `portalTemplateId`. It is a flat street/gate exit, NOT stairs.
  2. `map_generation_spawner.ts:192` computes `const stairTileKey = portal.connection.direction === 'up' ? 'stairs_up' : 'stairs_down';` for all portals without `portalTemplateId`, assigning `spriteId: tile_staircase_down` to EVERY `'edge'` and `'portal'` connection on both sides!
  3. `bootstrap.ts:221-238` (used on the starting area) has an even older duplicate of that loop that ignores `portalTemplateId` completely and hardcodes `stairs_up` / `stairs_down` glyphs AND `tile_staircase_down` sprites!
- **Fix:** Unify portal entity spawning between `bootstrap.ts` and `map_generation_spawner.ts` into a single helper, properly distinguish `'up'` (stairs up), `'down'` (stairs down), `'edge'` (gate/archway/road transition sprite & glyph), and `'portal'` (portal sprite & glyph), and ensure Shroudgarde's edge connections render as horizontal passages/gates rather than downward stairs.

### 2.10 Command Dock `Aim (R)` Bug, Debug Mode Gate, and 3-Tier Command/Keybind Overhaul
- **Affected Files:** `src/rendering/ui/hud_dock.ui.ts`, `src/core/input/command_catalog.ts`, `src/core/input/shortcut_input.ts`, `src/core/input/keybind_migration.ts`, `src/core/settings.ts`, `src/rendering/ui/menus/SettingsModal.tsx`, `src/rendering/ui/hud/CommandDockCard.tsx`, `src/rendering/ui/cartridges/dnd35e/dnd35e_ui_registration.tsx`, `src/rendering/ui/cartridges/classic/classic_ui_registration.tsx`, `src/rendering/ui/modals/HelpModal.tsx`.
- **Root Cause of `Aim (R)` vs Reveal All (`R`):**
  - `hud_dock.ui.ts:65-66` references stale `commandId: 'action.target_toggle'` instead of `'combat.target_toggle'` (`F`), causing `<Keycap />` to display `fallbackBadge: 'R'`, which collided visually with `debug.reveal_map` (`R`).
  - Stale IDs also exist on `dock-btn-wait` (`move.wait` vs `action.wait`) and `dock-btn-settings` (`system.open_settings` vs `system.escape_or_pause`), plus outdated `classic_ui_registration.tsx` help text (`press R to aim`, `Press V for context interactions`) and `TacticalScannerCard.tsx` (`Right-click or [V] for verbs`).
- **Debug Mode Switch:**
  - Add `debugModeEnabled: boolean` (default `false`) to `PlayerSettings` (and a toggle in Settings -> Gameplay/Developer).
  - Gate `debug.reveal_map`, `debug.god_mode`, `debug.spawn_entity` (and optionally `panel.debug` & Automap God-Mode reveal) behind `debugModeEnabled`, moving them to `Alt+` chords (`Alt+R`, `Alt+G`, `Alt+E`, `Alt+\``).
- **Complete Command Inventory (Console + Cartridges) for 3-Tier Reclassification:**
  - **Console (32 commands):** Movement (8 directions + `<`/`>` Z-climb), Wait (`Space`), Smart Interact (`.`/`,`/`E`), Pick Up (`G`), Look (`X`), Verb Menu (`Enter`/`V`), Aim (`F`), Target Confirm (`Enter`), Target Next/Prev (`Tab`/`Shift+Tab`), Shove (new), Hotbar (`1–0`, `Shift+Up`/`Shift+Down`), Camera Z-Peek (`[`/`]`/`PgUp`/`PgDn`/`Home`), Fold HUD (`\`), HUD Focus (`F6`), Help (`F1`), Escape/Pause (`Esc`), Panels (Inventory, Quests, Factions, Investigation, Dossier, Ledger, Legends, 3D Automap), Debug (`panel.debug`, `debug.reveal_map`, `debug.god_mode`, `debug.spawn_entity`).
  - **D&D 3.5e Cartridge (5 commands):** Character Sheet (`C`), Quickcast (`Z`), Spellbook (`B`), Rest 8h (`T` -> can become `R` once Reveal All moves to `Alt+R`!), Level Up (`U`).
  - **Classic Cartridge (2 commands):** Profile (`C`), Pack (`I`).

---

## 3. Preliminary Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| **Two-pane `ModalShell` `scrollMode="panes"`** | All two-pane Preact modals | `primitives.css`, `dnd35e.css`, viewport resize behavior | Mobile/narrow `@media` stacked fallback |
| **Feat & Skill Filters + Fuzzy Search** | `DnD35FeatDefinitionSchema` / `DnD35SkillDefinitionSchema`, `src/utils/fuzzy_match.ts` | `DnD35eSharedFeatsStep`, `DnD35eSharedSkillsStep`, `DnD35eInspector`, `VerbMenuPopover` | Character Creation & Level-Up tests |
| **Console Language & Cartridge Comprehension** | `CampaignData` / `EntityTemplate` / `DialogueTree`, D&D 3.5e spells/tags | `dialogue.system.ts`, `DialogueModal`, speech barks, `IRuleset` | Campaign JSONs, `save.ts`, Editor Zod forms |
| **`talk`, `attack`, `shove` Verbs & Friendly Aim** | `VERBS`, `apply.system.ts`, `targeting.system.ts`, `gameplay_input.ts` | `VerbMenuPopover`, `movement.system.ts`, `dnd35e` Overrun/Bull Rush | `input_scope_and_keymap.test.ts`, verb tests |
| **Conditional Level-Up Feats Tab & Top-Bar Z** | `DnD35eLevelUpModal`, `ChronosStrip` | Level-Up tab index/validation, HUD layout | Phase 43/44 HUD & Level-Up tests |
| **Digger Door Framing & Edge Portal Spawner** | `generator_stages.ts`, `bootstrap.ts`, `map_generation_spawner.ts` | All procedural digger areas & edge transitions | Shroudgarde JSONs, `visualize-campaign.ts` |
| **Debug Mode Gate & 3-Tier Keybinds** | `PlayerSettings`, `command_catalog.ts`, `dnd35e_ui_registration.tsx`, `classic_ui_registration.tsx` | `shortcut_input.ts`, `hud_dock.ui.ts`, `CommandDockCard`, `HelpModal`, `SettingsModal`, `keybind_migration.ts` | `classic_vi` preset, `public/data/campaigns/*/keybinds.json`, `tests/input_scope_and_keymap.test.ts` |
