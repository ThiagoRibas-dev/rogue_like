# Research Notes — Milestones 166 & 167: Gameplay UI, Parchment Contrast, Adaptive Layouts, Reach-Gated Fuzzy Verb Menu & D&D 3.5e Mechanics/Content Audit

**Date:** 2026-11-23  
**Scope:** Milestone 166 (Post-Phase-43 Gameplay UI, Parchment Contrast, Adaptive Layouts & Reach-Gated Fuzzy Verb Menu Polish) & Milestone 167 (D&D 3.5e Mechanics, Modifier Targets, Spell Effect Units & SRD Content Parity)  
**Workflow Stage:** `AGENTS.md` Phase 1 Kickoff Flow — Step 3 (`./docs/research_notes.md` Compilation & Research Review Gate)

---

## 0. Core Architectural Rules & Standards Reiteration (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16)**:
   - **Tier 1 (Core Console Engine — `src/core/`, `src/systems/`, `src/types/`, `src/rendering/ui/`)**: Generic UI primitives (`ModalShell`, `SplitPane`, `Keycap`), theme token definitions (`tokens.css`, `parchment.css`, `primitives.css`), `InputScopeManager`, `VerbMenuPopover`, `TacticalScannerCard` (renamed `"Inspect"`), and baseline physical/touch interaction reach verification (`resolveActorInteractionReachTiles`).
   - **Tier 2 (Ruleset Cartridge — `src/rulesets/dnd35e/`, `src/rendering/ui/cartridges/dnd35e/`)**: `RulesetContract.projectInspectStats` (projecting D&D 3.5e `HP`, `AC (Touch / Flat-Footed)`, `BAB`, and `Saves`), `RulesetContract.resolveInteractionReachTiles` (evaluating `naturalReachTiles` + `interaction_reach_tiles` StatModifiers from spells/effects like *Mage Hand*), D&D 3.5e Character Creation / Level-Up UI steps, and D&D 3.5e DAG / spellcasting / turning resolvers.
   - **Tier 3 (System Content — `public/data/rulesets/dnd35e/*.json`)**: Declarative `featureDetails` labels in `classes/*.json`, canonical `StatModifier` target IDs in `feats/*.json` and `races/*.json`, magic item `effectId`s in `items/*.json`, and mechanical `effectUnits` / `effectBundle` entries in `spells/*.json`.
2. **Baseline Rules + Declarative Overrides & Modifiers (`AGENTS.md` Rule 17 & Rule 19)**:
   - Touch/interaction reach extensions (such as a 10-ft pole or *Mage Hand* / telekinetic reach) must be evaluated via declarative item tags (`REACH_PROBE_ITEM_TAG`) or `StatModifier`s (`target: 'interaction_reach_tiles'`) rather than hardcoded spell/feat branches.
3. **Zero Content-ID or Bespoke-Property Branching (`AGENTS.md` Rule 21 — The "New Content Mod" Litmus Test)**:
   - Class progression feature names (`aura`, `cleric_domains`, `deity_domains`, `spontaneous_casting`, `turn_or_rebuke_undead`) must be resolved from `classDef.featureDetails[featureId]?.name ?? systemContent.feats[featureId]?.name` rather than hardcoded display dictionaries in `.tsx`.
   - Every feature ID referenced in `classDef.progression[].features` must be validated by `src/rulesets/dnd35e/validation/class_race_validator.ts` to guarantee zero raw snake_case leaks if a campaign author adds a new class or feature.
4. **TypeScript Strictness & ECS Purity (`AGENTS.md` Sections 3 & 4)**:
   - Zero `any`, zero magic numbers, `exactOptionalPropertyTypes: true`, explicit return types on all functions, and exhaustive switches.

---

## 1. Detailed Research & Root-Cause Analysis: Milestone 166 (UI, HUD, Theme & Interaction Polish)

### 1.1 Parchment Theme Naming, Dark Leather Keycap Contrast & D&D 3.5e Hover/Table Surfaces
- **Theme Label (`src/rendering/ui/menus/SettingsModal.tsx:39`)**:
  - Currently defines `{ value: 'parchment', label: 'Warm Tactical Parchment' }`.
  - **User Decision**: Rename to simply **`'Parchment'`**.
- **Keycap (`<kbd class="ui-kbd">`) Contrast in Parchment (`src/styles/tokens.css`, `src/styles/themes/parchment.css`, `src/styles/primitives.css`)**:
  - In `src/styles/primitives.css:116-131`, `.ui-kbd` sets:
    ```css
    background: var(--ui-bg-socket);
    border: 1px solid var(--ui-border-default);
    color: var(--ui-ink-heading);
    ```
  - In `src/styles/themes/parchment.css:6-17`:
    - `--ui-bg-socket` is `#2a241e` (dark leather, deliberately dark so the map canvas socket remains dark).
    - `--ui-ink-heading` is `#3b2615` (dark espresso brown ink for parchment headings).
  - Putting `#3b2615` text on a `#2a241e` background produces a **1.2:1 contrast ratio** (nearly invisible dark brown text on dark brown background), affecting the `[F1] Help` chip (`HelpReminderChip.tsx`) and every `<Keycap>` in the Command Dock.
  - **User Decision**: Use **Dark Leather with Cream Text** for `.ui-kbd` in Parchment.
  - **Clean Semantic Solution**: Introduce `--ui-kbd-bg`, `--ui-kbd-ink`, and `--ui-kbd-border` in `src/styles/tokens.css` (defaulting to `var(--ui-bg-socket)`, `var(--ui-ink-heading)`, `var(--ui-border-default)` for dark themes) and override `--ui-kbd-ink: var(--ui-ink-inverse)` (`#f5ebd9`) and `--ui-kbd-border: var(--ui-border-strong)` (`#9e845c`) in `src/styles/themes/parchment.css`.
- **D&D 3.5e Hover & Table Container Dark Canvas Leaks (`src/styles/views/dnd35e.css`)**:
  - Line 553: `.ui-dnd-list-row:hover:not(:disabled) { background: var(--ui-bg-canvas); }` — In Parchment, `--ui-bg-canvas` is `#1c1814` (dark map void) while `.ui-dnd-list-row` text is `var(--ui-ink-primary)` (`#2b1e12`), turning hovered list rows black-on-black. Replacing `--ui-bg-canvas` with `var(--ui-bg-hover)` (`#dfd1b4` in Parchment) restores crisp hover contrast across all 3 themes.
  - Line 182: `.ui-dnd-table-scroll { background: var(--ui-bg-canvas); }` — Replacing with `var(--ui-bg-panel-alt)` avoids dark holes inside Parchment tables.
  - Line 435: `.ui-dnd-quickcast-count { background: var(--ui-bg-canvas); }` — Replacing with `var(--ui-bg-panel-alt)` keeps quickcast count badges legible in Parchment.

### 1.2 Full-Height Selection Modals & Content-Adaptive Left Columns
- **Modal Height (`src/rendering/ui/primitives/ModalShell.tsx`, `src/styles/primitives.css`, `RulesetSelectModal.tsx`, `CampaignSelectModal.tsx`)**:
  - `ModalShell` (`src/styles/primitives.css:195-217`) currently styles `.ui-modal` with `max-height: 90vh;` (shrink-wrapping short content) and `.ui-modal--lg { max-width: 960px; }`, `.ui-modal--xl { max-width: 1240px; }`.
  - **User Decision**: Both `RulesetSelectModal` and `CampaignSelectModal` should be **full height (`90vh`)** and wide (`size="xl"`).
  - Adding an opt-in `fullHeight?: boolean | undefined` prop to `ModalShellProps` (rendering `.ui-modal--full-height { height: 90vh; }`) lets `RulesetSelectModal` and `CampaignSelectModal` expand to full `90vh` height without stretching small confirmation dialogs or `GameOverModal`.
- **Adaptive Left Column in `SplitPane` (`RulesetSelectModal.tsx`, `CampaignSelectModal.tsx`) & `.ui-dnd-wizard-stage` (`src/styles/views/dnd35e.css`)**:
  - In `RulesetSelectModal.tsx:58`, `<SplitPane leftWidth="280px" ...>` squeezes `"Dungeons & Dragons 3.5e (SRD)"` + `"D&D 3.5E"` badge onto two wrapped lines.
  - In `src/styles/views/dnd35e.css:483-489`, `.ui-dnd-wizard-stage` uses:
    ```css
    grid-template-columns: minmax(320px, 1.15fr) minmax(260px, 0.85fr);
    ```
    giving **57.5%** of the modal width to the left column (e.g., the 12-class list in `CharBuilderClassStep`) and only **42.5%** to the right detail column (which holds the class description, HD/BAB/Saves/Skill points, 20-level progression table, Cleric Deity & Domain selectors, and ACFs).
  - **Cross-Step Audit of `.ui-dnd-wizard-stage`**:
    1. `CharBuilderRaceAbilitiesStep.tsx`: Left = Race list (`max-content` ~300px); Right = Point-Buy ability table & racial traits (`1fr`).
    2. `CharBuilderClassStep.tsx`: Left = Class list (`max-content` ~300px); Right = Class overview, 20-level progression table, Domains, ACFs (`1fr`).
    3. `DnD35eSharedSkillsStep.tsx`: Left = Skill allocation list with filter buttons + stepper controls (~400–440px comfortable width); Right = Selected skill detail & synergies (`1fr`).
    4. `DnD35eSharedFeatsStep.tsx`: Left = Feat browser with search input + category chips + feat rows (~380–420px comfortable width); Right = Selected feat prerequisites & benefit (`1fr`).
    5. `CharBuilderSummaryStep.tsx`: Left = Identity form + Portrait sprite picker grid; Right = Final build summary (`1fr`).
  - **User Decision**: Make the left column adapt to its content + margin/padding (`minmax(280px, max-content)` / bounded so long text inside left panes wraps gracefully) while the right column takes the remaining space (`minmax(0, 1fr)`).
  - Specifically:
    - In `RulesetSelectModal.tsx` and `CampaignSelectModal.tsx`, pass `leftWidth="minmax(320px, max-content)"` to `<SplitPane>` and prevent accidental title wrapping on `.ui-list-row__label` (`white-space: nowrap` where appropriate or sufficient padding).
    - In `.ui-dnd-wizard-stage` (`src/styles/views/dnd35e.css:485`), change `grid-template-columns` from `minmax(320px, 1.15fr) minmax(260px, 0.85fr)` to `minmax(280px, max-content) minmax(0, 1fr)` and constrain `.ui-dnd-wizard-pane:first-child` with `max-width: 440px` so pure selection lists (`Race`, `Class`) hug their content tightly (~300–320px, giving ~880px+ to the right detail column!) while wider interactive tables (`Skills`, `Feats`, `Summary` sprite grid) expand smoothly up to 440px without blowing out the right pane.

### 1.3 Untranslated Class Feature Keys in Character Creation & Level-Up (`CharBuilderClassStep.tsx`, `DnD35eLevelUpClassStep.tsx`, `class_race_validator.ts`)
- **Root Cause**:
  - `public/data/rulesets/dnd35e/classes/divine.json` (and `martial.json`, `arcane.json`, `skill.json`) already stores human-readable names and descriptions for every class feature inside `classDef.featureDetails[featureId]`:
    - `"aura"`: `{ "name": "Aura", ... }`
    - `"cleric_domains"`: `{ "name": "Cleric Domains", ... }`
    - `"deity_domains"`: `{ "name": "Deity's Favored Weapon & Domains", ... }`
    - `"spontaneous_casting"`: `{ "name": "Spontaneous Casting", ... }`
    - `"turn_or_rebuke_undead"`: `{ "name": "Turn or Rebuke Undead", ... }`
  - However, `src/rendering/ui/cartridges/dnd35e/CharBuilderClassStep.tsx:103` renders `row.features.join(', ')` directly (raw IDs!), line 170 renders `Replaces ${acf.replacesFeature} -> Grants ${acf.grantedFeature}` with raw IDs, and `src/rendering/ui/cartridges/dnd35e/DnD35eLevelUpClassStep.tsx:192` renders `rowDef.features.join(', ')` with raw IDs.
- **Fix & Validator Guard**:
  - Extract a shared pure helper `formatDnD35eClassFeatureName(featureId: string, classDef: DnD35ClassDefinition, sys: DnD35SystemContent): string` returning `classDef.featureDetails[featureId]?.name ?? sys.feats[featureId]?.name ?? featureId`.
  - Use this helper in `CharBuilderClassStep.tsx` (lines 103 and 170) and `DnD35eLevelUpClassStep.tsx` (line 192).
  - Add a validation check in `src/rulesets/dnd35e/validation/class_race_validator.ts` verifying that every feature ID in `classDef.progression[].features` and `classDef.alternateClassFeatures[].replacesFeature` resolves to an entry in `classDef.featureDetails` or `systemContent.feats`.

### 1.4 HUD Polish: Single-Row `End Turn`, Chronicle Log Tab Fit & Unified `Pack [I]` Dock Command
- **Single-Row `End Turn` Button (`src/rendering/ui/hud/BottomActionDock.tsx`, `src/styles/views/hud.css`)**:
  - In `src/styles/views/hud.css:293, 333-345`:
    - `.ui-bottom-dock` has `max-width: min(860px, 95vw);`
    - `.ui-hotbar-row` has `display: flex; align-items: center; gap: var(--ui-space-2); flex-wrap: wrap;`
    - `.ui-hotbar-grid` has `grid-template-columns: repeat(12, minmax(48px, 1fr));` (`12 * 48 + 11 * 4 = 620px`, plus bank switcher `~95px` + `End Turn` button `~95px` + padding = `~850px`), causing `End Turn` to wrap onto a second row at standard viewport widths.
  - **Fix**: Increase `.ui-bottom-dock` `max-width: min(940px, 96vw)`, set `.ui-hotbar-row { flex-wrap: nowrap; }`, set `.ui-hotbar-grid { grid-template-columns: repeat(12, minmax(44px, 1fr)); min-width: 0; }`, and add `flex-shrink: 0; white-space: nowrap;` on the `End Turn` button.
- **Chronicle Log Filter Tabs Overflow (`src/rendering/ui/hud/ChronicleLogCard.tsx`, `src/styles/views/hud.css`)**:
  - `.ui-hud-col--right` is `width: 280px`. Inside `ChronicleLogCard`, `.ui-tabs__list` renders `All | Combat | Speech | World` with `.ui-tabs__tab { padding: var(--ui-space-2) var(--ui-space-3); font-size: var(--ui-font-sm); }`, exceeding `256px` and creating a horizontal scrollbar.
  - **Fix**: Scope compact tab rules for `.ui-hud-card .ui-tabs__list` and `.ui-hud-card .ui-tabs__tab` in `src/styles/views/hud.css` (`padding: 4px 6px; font-size: var(--ui-font-xs); flex: 1 1 0; text-align: center; justify-content: center; overflow-x: hidden;`).
- **Unified `Pack [I]` Dock Command in D&D 3.5e (`src/rendering/ui/hud/CommandDockCard.tsx`, `src/rendering/ui/cartridges/dnd35e/dnd35e_ui_registration.tsx`)**:
  - Currently, `CommandDockCard.tsx:16-31` hardcodes `DOCK_COMMANDS` including `{ id: 'dock-btn-inventory', label: 'Pack', icon: '🎒', commandId: 'panel.inventory', uiMode: UIMode.Inventory }`.
  - Meanwhile, `dnd35e_ui_registration.tsx:86-99` registers both `dnd35e_sheet` (`Sheet`, commandId `'dnd35e:sheet'`, key `'c'`) and `dnd35e_inventory` (`Pack`, commandId `'dnd35e:inventory'`, key `'i'`) — and both open the exact same modal (`openCartridgeModal(state, 'character_sheet')`). Because `dnd35e:inventory` claims key `'i'`, Console's `panel.inventory` loses its `'i'` binding, leaving two `Pack` buttons and a redundant `Sheet` button in the Command Dock.
  - **User Decision**: Keep just `Pack (i)` as both inventory and sheet for D&D 3.5e (no separate `Sheet (c)` and `Pack (i)` dock buttons).
  - **Fix**:
    1. In `dnd35e_ui_registration.tsx`, remove `dnd35e_sheet` from `dockCommands` so D&D 3.5e only contributes `Pack` (`dnd35e_inventory`, key `'i'`, opening `character_sheet`), plus `Quickcast [Z]`, `Spells [B]`, `Rest (8h) [R]` (and `Level Up [L]` when `canLevelUp`). (We can still keep `'c'` as a secondary key chord on `dnd35e:inventory` or `dnd35e:sheet` in `commands` so pressing `C` or `I` on the keyboard still opens the sheet/inventory without cluttering the Command Dock with duplicate buttons!)
    2. In `CommandDockCard.tsx`, filter `DOCK_COMMANDS` so if the active cartridge provides a dock command that replaces `panel.inventory` (e.g., `cmd.id === 'dnd35e_inventory'` or `cmd.label === 'Pack'`), the Console `dock-btn-inventory` button is omitted in favor of the cartridge's `Pack [I]` button.

### 1.5 Rename `"Tactical Scanner"` to `"Inspect"` & Add Cartridge-Projected Inspect Stats
- **Card Title (`src/rendering/ui/hud/TacticalScannerCard.tsx:31, 46`)**:
  - Change `"Tactical Scanner"` to **`"Inspect"`** in both collapsed and expanded headers (and `aria-label="Inspect"`).
- **Ruleset-Projected Inspect Stats (`src/types/ruleset.types.ts`, `src/rendering/inspect_tooltip.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`)**:
  - Currently, `src/rendering/inspect_tooltip.ts:43-50` calls `getEffectiveStats(state, entityAtTile)` and unconditionally emits:
    - `HP: cur/max`
    - `ATK: stats.attack` (which is `0` on D&D 3.5e entities!)
    - `DEF: stats.defense` (which `getEffectiveStats` synthesizes as `fullAC - 10` in D&D 3.5e!)
  - **User Decision**: Rename to `"Inspect"`, add a hook so the Cartridge can project its own stats, and keep `Patience`.
  - **Fix**:
    1. Add an optional method to `RulesetContract` in `src/types/ruleset.types.ts`:
       ```ts
       readonly projectInspectStats?: (
         state: GameState,
         entityId: EntityId
       ) => ReadonlyArray<{
         readonly label: string;
         readonly value: string;
         readonly color?: string;
       }>;
       ```
    2. In `src/rendering/inspect_tooltip.ts:43-50`, check `const activeRuleset = getActiveRuleset(state);`. If `activeRuleset.projectInspectStats` is defined, push its sections; otherwise fall back to Classic `HP`, `ATK`, `DEF`. Keep `Patience` (lines 117–120) unchanged.
    3. Implement `projectInspectStats` on `dnd35eRulesetContract` (`src/rulesets/dnd35e/dnd35e_ruleset.ts`) using `evaluateDnD35eEntityDAG(state, entityId)` to project:
       - `HP`: `${health.current}/${health.max}`
       - `AC`: `${acBreakdown.fullAC} (Touch ${acBreakdown.touchAC}, Flat ${acBreakdown.flatFootedAC})`
       - `BAB / Saves`: `BAB ${formatSigned(dag.bab)} | Fort ${formatSigned(dag.saves.fortitude)} Ref ${formatSigned(dag.saves.reflex)} Will ${formatSigned(dag.saves.will)}`

### 1.6 `Look` (`[X]`) + `Enter` Reticle Targeting & Extensible Interaction Reach
- **Bug 1: `Enter` (`action.verb_menu`) Ignores Active `Look` (`inspectMode`) Reticle (`src/core/input/gameplay_input.ts:245-251`)**:
  - In `src/core/input/gameplay_input.ts`:
    - `case 'action.interact':` (lines 234–243) checks `if (currentState.inspectMode?.active === true)` and calls `interactWithTile(currentState, playerEntityId, currentState.inspectMode.x, currentState.inspectMode.y)`.
    - `case 'action.verb_menu':` (lines 245–251, bound to `Enter` and `m`) ignores `currentState.inspectMode` and always calls `openTileVerbMenu(currentState, playerPos.x, playerPos.y)`.
    - Furthermore, inside `InputScopeManager`, when `state.inspectMode?.active === true`, `TargetingInspectScope` is active (`src/core/input/input_scope_manager.ts:75`). In `src/core/input/command_registry.ts`, `action.verb_menu` has `scope: 'world_gameplay'`, whereas `TargetingInspectScope` only matches commands with `scope: 'targeting_inspect'` unless `TargetingInspectScope` also routes `action.interact` / `action.verb_menu` (or `handleTargetingInspectKey` in `gameplay_input.ts` handles `Enter` / `action.verb_menu` while in `inspectMode`!).
  - Let's verify how `inspectMode` handles keys right now:
    - When `inspectMode.active === true`, `InputScopeManager.getActiveScopes` pushes `TargetingInspectScope` (priority 30) above `WorldGameplayScope` (priority 20).
    - Wait: in `command_registry.ts`, `target.confirm` is bound to `Enter` in `scope: 'targeting_inspect'`!
    - When the player is in `inspectMode` (`Look` `[X]`, where `state.targetingMode` is NOT active, only `state.inspectMode.active === true`), pressing `Enter` matches `target.confirm` in `targeting_inspect` scope!
    - And what does `case 'target.confirm':` do in `src/core/input/gameplay_input.ts`? Let's check! When `state.inspectMode?.active === true` and `state.targetingMode` is null, `target.confirm` either does nothing or exits inspect mode without opening the verb menu at `(inspectMode.x, inspectMode.y)`!
  - Let's verify this in `gameplay_input.ts`! That explains why pressing `Enter` during `Look` didn't interact with the reticle tile!
  - Specifically:
    - When `state.inspectMode?.active === true`, pressing `Enter` (`target.confirm` or `action.verb_menu`) or `e` (`action.interact`) should interact with / open the verb menu for `(state.inspectMode.x, state.inspectMode.y)` (and close `inspectMode` or transition cleanly to `UIMode.VerbMenu` targeting `(inspectMode.x, inspectMode.y)`).
- **Bug 2 & Feature: Physical/Touch Interaction Reach with Extensible Hooks (`src/systems/apply.system.ts`, `src/systems/reaction.system.ts`, `src/types/ruleset.types.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`)**:
  - Currently, `processApplyIntent` (`src/systems/apply.system.ts`) allows executing physical/touch verbs (`open`, `close`, `lock`, `unlock`, `kick`, `search`, `disarm`, `harvest`, `pray`, `apply`, `dip`, `ignite`) at **any** `(tx, ty)` on the map if triggered via right-click or reticle `VerbMenu`, without checking whether `(tx, ty)` is within the actor's reach!
  - **User Decision**: Enforce interaction reach for `Look` + `VerbMenu` / `ApplyIntent`, with hooks for abilities that increase interaction reach (such as `pole_10ft` or a *Mage Hand* spell).
  - **Architecture (`Tier 1 Console` + `Tier 2 RulesetContract`)**:
    1. Define `TOUCH_INTERACTION_VERBS: ReadonlySet<InteractionVerb>` in `src/systems/apply.system.ts` containing physical world-tile verbs: `'open'`, `'close'`, `'lock'`, `'unlock'`, `'kick'`, `'search'`, `'disarm'`, `'harvest'`, `'pray'`, `'apply'`, `'dip'`, `'ignite'`, `'eat'`, `'drink'`. (Verbs that are inherently ranged or non-physical, like `'look'`, `'talk'`, `'shoot'`, `'throw'`, `'zap'`, `'Signal: ...'`, remain exempt from touch reach.)
    2. Compute actor-to-target tile distance using the existing Tier 1 footprint helper `computeRectDistanceTiles(actorPos.x, actorPos.y, actorProfile.footprintWidth, actorProfile.footprintHeight, tx, ty, targetWidth, targetHeight)` from `src/systems/movement_footprint.ts` (`0` = same tile, `1` = adjacent tile).
    3. Compute effective interaction reach via `resolveActorInteractionReachTiles(state, actorId, verb, toolEntityId)`:
       - Base reach = `getEntitySpatialProfile(state, actorId).naturalReachTiles` (default `1` tile for Small/Medium creatures, `2`+ for Large/reach creatures).
       - Tool reach override: If `toolEntityId` (or an inventory tool used by `'search'`/`'disarm'`, e.g. `hasReachProbeTool` with `REACH_PROBE_ITEM_TAG` `'pole_10ft'`) extends reach for `'search'` / `'disarm'`, base reach is at least `2` tiles (`10 ft`).
       - Cartridge hook: Optional `RulesetContract.resolveInteractionReachTiles?(state, actorId, verb, baseReachTiles, toolEntityId): number` on `RulesetContract`.
       - In `dnd35eRulesetContract.resolveInteractionReachTiles`, query the actor's active `StatModifier`s (from `DnD35eEffectsComponent` / status effects / active spells) for `target: 'interaction_reach_tiles'` (using `resolveTypedModifiersWithBreakdown`), returning `baseReachTiles + bonusReachTiles`. Thus, any spell, feat, or item granting a `StatModifier` with `target: 'interaction_reach_tiles'` (such as *Mage Hand* or *Telekinesis*) automatically extends interaction reach without any spell-ID branching!
    4. Enforce `distanceTiles <= effectiveReachTiles` in:
       - `getValidVerbsForTile` (`src/systems/reaction.system.ts`) / `openTileVerbMenu` (`src/core/input/mouse_input.ts`): only include touch verbs in `availableVerbs` when `(tx, ty)` is within the actor's effective interaction reach for that verb (and if no actionable verbs are within reach on a distant tile, show a clear message or only ranged/inspect verbs).
       - `processApplyIntent` (`src/systems/apply.system.ts`): guard physical tile verbs so out-of-reach targets return `{ state: addMessage(state, 'That is out of reach.', 'info'), success: false }`.

### 1.7 `VerbMenuPopover` Valid-Only Filtering, Auto-Focused Fuzzy Search & Keyboard Navigation
- **Root Cause (`src/rendering/ui/hud/VerbMenuPopover.tsx`, `src/core/input/modal_input.ts`, `src/core/input/input_scope_manager.ts`, `src/styles/views/hud.css`)**:
  - `openTileVerbMenu` (`src/core/input/mouse_input.ts:96-99`) constructs `options` by iterating over **all 42 verbs** in `ALL_VERBS` (`src/constants/verbs.constants.ts`) and marking 38+ of them `isValid: false`.
  - `VerbMenuPopover.tsx:66` renders every option in `menu.options` (all 42 buttons!) inside `.ui-verb-popover__list` (`src/styles/views/hud.css:418`), which has no `max-height` or `overflow-y: auto`, overflowing the viewport.
- **User Decision**:
  - Filter to valid verbs only.
  - Auto-focus a fuzzy finder input at the top of `VerbMenuPopover` with the filtered list of options already open below it, allowing the player to type to fuzzy-filter and use `ArrowUp` / `ArrowDown` (or mouse) to navigate and `Enter` to execute.
- **Design & Input Scope Interaction**:
  1. **Filter to Valid Verbs at Menu Construction (`src/core/input/mouse_input.ts:96-99`)**:
     - Build `options` strictly from `availableVerbs` (where `isValid: true`), so a closed door shows its ~3–4 valid verbs (`open`, `kick`, `lock`, `search`) instead of 42 verbs.
  2. **Fuzzy Matcher & Search State in `VerbMenuPopover.tsx`**:
     - Add a pure fuzzy-match scorer `scoreFuzzyVerbMatch(query: string, label: string): number | null` (matching contiguous substrings with highest weight and ordered subsequence characters as fallback, case-insensitive).
     - Maintain local Preact state `searchQuery` (initialized to `""`, reset when `menu` target changes) and derive `filteredOptions` from `menu.options.filter(opt => opt.isValid)`.
     - Auto-focus the search `<input type="text" class="ui-input ui-verb-popover__search" placeholder="Filter actions..." />` on mount via `useEffect` + `inputRef.current?.focus()`.
     - Keep the list of matching options open below the search input inside `.ui-verb-popover__list` (`max-height: 240px; overflow-y: auto;`).
  3. **Keyboard Navigation Inside the Auto-Focused Search Input**:
     - Because the search `<input>` is focused, `InputScopeManager.dispatchKeyEvent` (`src/core/input/input_scope_manager.ts:183-197`) sees `editableTarget === true` (`TextInputGuard`).
     - In `VerbMenuPopover.tsx`, attach `onKeyDown` directly to the search `<input>`:
       - `ArrowDown`: `e.preventDefault(); e.stopPropagation();` -> advance highlighted index within `filteredOptions` (wrapping around) and sync `selectedIndex` to `GameState.verbMenuState`.
       - `ArrowUp`: `e.preventDefault(); e.stopPropagation();` -> decrement highlighted index within `filteredOptions` (wrapping around) and sync `selectedIndex`.
       - `Enter`: `e.preventDefault(); e.stopPropagation();` -> execute the currently highlighted option in `filteredOptions` via `executeVerbMenuOption(state, actualOptionIndex)`.
       - `Escape`: `e.preventDefault(); e.stopPropagation();` -> close `VerbMenu` (`uiMode: UIMode.None, verbMenuState: undefined`).
     - Also in `InputScopeManager.dispatchKeyEvent` (`src/core/input/input_scope_manager.ts:185-191`), when `editableTarget && event.key === 'Escape'`, if `state.uiMode === UIMode.VerbMenu`, allow `Escape` to close the verb menu immediately rather than requiring two presses of `Escape` (one to blur the input, one to close the popover).
     - Meanwhile, keep `handleVerbMenuModalKey` in `src/core/input/modal_input.ts` working for headless unit tests (`tests/companion_ai_commands.test.ts:384`) and non-focused `ArrowUp`/`ArrowDown`/`1-9`/`Enter`/`Escape` events.

---

## 2. Detailed Research & Root-Cause Analysis: Milestone 167 (D&D 3.5e Mechanics & Content Data Audit)

### 2.1 Unconnected / Mismatched `StatModifier` Target Strings
Cross-referencing all `"target": "..."` strings in `public/data/rulesets/dnd35e/**/*.json` against `src/rulesets/dnd35e/AttributeDAG.ts`, `dag_helpers.ts`, `ac_breakdown.ts`, `skill_synergies.ts`, `spell_cast_helpers.ts`, and `turning_resolver.ts` revealed 9 targets emitted by JSON content that are not wired in the TypeScript resolvers:
1. **`saves_all`** (used in `races.json` Halfling racial bonus & `spells/divine.json` *Resistance*, *Prayer*, *Holy Aura*):
   - `dag_helpers.ts` only checks `target === saveId` (`'fortitude'`, `'reflex'`, `'will'`).
   - **Fix**: In `dag_helpers.ts` (`resolveSavingThrows`), include modifiers where `mod.target === saveId || mod.target === 'saves_all'`, and support conditional `save_fear` modifiers when evaluating fear saves.
2. **`save_reflex`** (used in `classes/arcane.json` Wizard `familiar_weasel`):
   - **Fix**: Normalize `"save_reflex"` to `"reflex"` in `classes/arcane.json` (and accept `'save_fortitude' | 'save_reflex' | 'save_will'` aliases in `dag_helpers.ts`).
3. **`ac_deflection`** & **`ac_insight`** (used in `spells/divine.json` *Protection from Evil*, *Shield of Faith*, *Holy Aura* and `feats/psionic.json` *Speed of Thought*):
   - `ac_breakdown.ts` filters for `mod.target === 'ac'` and reads `mod.type` (`'deflection'`, `'insight'`, etc.).
   - **Fix**: Normalize `"target": "ac_deflection"` -> `"target": "ac", "type": "deflection"` and `"target": "ac_insight"` -> `"target": "ac", "type": "insight"` in JSON, and accept `ac_deflection` / `ac_insight` in `ac_breakdown.ts`.
4. **`skill_hide`** & **`skill_swim`** (used in `races.json` Halfling `+4` Hide and Aquatic Elf `+8` Swim):
   - `skill_synergies.ts` queries `mod.target === 'skill:${skillId}'` (`skill:hide`, `skill:swim`).
   - **Fix**: Normalize `"skill_hide"` -> `"skill:hide"` and `"skill_swim"` -> `"skill:swim"` in `races.json` / `races/*.json`.
5. **`caster_level_check_vs_sr`** (used in `feats/metamagic_item_magic.json` *Spell Penetration* `+2` & *Greater Spell Penetration* `+4`):
   - `spell_cast_helpers.ts:278` (`resolveSpellResistanceCheck`) rolls `1d20 + casterLevel` without querying `caster_level_check_vs_sr` modifiers.
   - **Fix**: Query `resolveTypedModifiersWithBreakdown` for `target === 'caster_level_check_vs_sr'` on the caster and add the resolved total to the SR penetration check.
6. **`effective_turning_level`** (used in `classes/divine.json` Sun Domain `sun_greater_turning` and `items/magic_gear.json` *Phylactery of Undead Turning* `+4`):
   - `turning_resolver.ts` calculates `clericLevel` from `scalingPools['turn_undead_level']` without adding `effective_turning_level` modifiers.
   - **Fix**: Query `resolveTypedModifiersWithBreakdown` for `target === 'effective_turning_level'` in `turning_resolver.ts` and add it to the effective turning level.

### 2.2 Spontaneous Spell Slot `maxDaily === 0` Bypass (`src/rulesets/dnd35e/magic/spell_cast_helpers.ts:253`)
- In `hasAvailableDnD35eSpellCapacity`, line 253 checks:
  ```ts
  if (maxDaily > 0 && used >= maxDaily) {
    return { ok: false, reason: `No level ${spellLevel} spell slots remaining today.` };
  }
  ```
- When `maxDaily === 0` (e.g. a Level 1 Ranger/Paladin or a caster without sufficient ability score for bonus slots at that level), `maxDaily > 0` is `false`, allowing infinite spontaneous casts at that spell level!
- **Fix**: Change the condition to `if (maxDaily <= 0 || used >= maxDaily)`.

### 2.3 Dummy Condition IDs on Cure Spells (`src/rulesets/dnd35e/magic/spell_cast_effects.ts:249-256`)
- In `spell_cast_effects.ts:249-256`, `case 'condition':` strips `unit.cureConditionIds` first, then unconditionally pushes `unit.conditionId` onto `StatusEffectsComponent` whenever `unit.conditionId.length > 0`.
- However, restorative spells in `public/data/rulesets/dnd35e/spells/divine.json` (*Lesser Restoration*, *Remove Fear*, *Remove Paralysis*, *Remove Blindness/Deafness*, *Remove Curse*, *Remove Disease*, *Neutralize Poison*, *Heal*) set `"conditionId": "none"` or `"conditionId": "heal_restoration"` alongside `cureConditionIds`. Casting them infects the target with a literal `"none"` or `"heal_restoration"` status effect!
- **Fix**: Guard `case 'condition':` so `unit.conditionId` is only applied when `unit.conditionId !== 'none'` and `sysContent?.conditions[unit.conditionId] !== undefined` (and author missing condition definitions in `public/data/rulesets/dnd35e/conditions/`).

### 2.4 Direct Spell Effect Unit Handlers & `spell_modifiers.ts` Integration
- In `src/rulesets/dnd35e/magic/spell_cast_effects.ts:301-304`, `case 'quicken_cast_grant':`, `case 'retaliation_rider':`, and `case 'form_overlay':` are currently no-op `break;` statements.
- In `src/rulesets/dnd35e/magic/spell_modifiers.ts`, `resolveEffectiveCasterLevel`, `resolveEffectiveSpellSaveDC` (which implements *Spell Focus*, *Greater Spell Focus*, and *Heighten Spell* DC increases), and `buildSummonedCreatureModifiers` (which implements *Augment Summoning* `+4 STR / +4 CON`) are tested in isolation but not called by `spell_cast_resolver.ts` or `spell_cast_units.ts`.
- **Fix**: Wire `resolveEffectiveCasterLevel` and `resolveEffectiveSpellSaveDC` into `spell_cast_resolver.ts`, wire `buildSummonedCreatureModifiers` into `executeSummonUnit` in `spell_cast_units.ts`, and implement direct active-effect handlers for `quicken_cast_grant`, `retaliation_rider`, and `form_overlay` in `spell_cast_effects.ts`.

### 2.5 SRD Magic Item `effectId`s, 39 Empty Spells & Legacy Root Monoliths
- **Magic Items (`public/data/rulesets/dnd35e/items/consumables.json`, `magic_gear.json`)**:
  - `potion_of_cure_light_wounds`, `potion_of_bulls_strength`, `scroll_of_mage_armor`, `wand_of_magic_missile`, and `staff_of_fire` currently reference Classic placeholder effect IDs (`"heal_5"`, `"damage_5_cold"`).
  - **Fix**: Point their `consumable.effectId` / `zappable.spellId` to the real D&D 3.5e spell pipeline (`spell:cure_light_wounds`, `spell:bulls_strength`, `spell:mage_armor`, `spell:magic_missile`, `spell:fireball`) and ensure `effects.system.ts` / `zap.system.ts` routes `spell:<id>` consumables through `resolveDnD35eSpellCast`.
- **39 Empty SRD Spells (`public/data/rulesets/dnd35e/spells/arcane.json`, `divine.json`)**:
  - Populate declarative `effectUnits` and/or `effectBundle` for all 39 spells that currently lack both.
- **Modular `races/*.json` & Root Monolith Cleanup**:
  - Split `public/data/rulesets/dnd35e/races.json` into `public/data/rulesets/dnd35e/races/*.json` (updating `manifest.json` and `src/core/loader.ts`) and retire unused root monolith files (`classes.json`, `feats.json`, `items.json`, `skills.json`, `spells.json`).

---

## 3. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors / Tests) | Downstream (Consumers / Renderers / Validators / Save Schemas) | Lateral (Sibling JSONs / Docs / Parallel Registries) |
| :--- | :--- | :--- | :--- |
| **1. Parchment Theme Naming & `--ui-kbd-*` / Hover Tokens** (`SettingsModal.tsx`, `tokens.css`, `parchment.css`, `primitives.css`, `dnd35e.css`) | `SettingsModal.tsx` theme selector options; `tokens.css` & `parchment.css` token definitions | `<Keycap>` (`Keycap.tsx`), `HelpReminderChip.tsx`, `CommandDockCard.tsx`, `.ui-dnd-list-row:hover`, `.ui-dnd-table-scroll`, `.ui-dnd-quickcast-count` | `obsidian-brass.css`, `retro-crt.css`, `docs/UI_UX_STANDARDS.md`, `tests/console_ui_architecture.test.ts` |
| **2. `ModalShell` `fullHeight` & Content-Adaptive `SplitPane` / `.ui-dnd-wizard-stage`** (`ModalShell.tsx`, `primitives.css`, `RulesetSelectModal.tsx`, `CampaignSelectModal.tsx`, `dnd35e.css`) | `RulesetSelectModal` & `CampaignSelectModal` passing `fullHeight` + `size="xl"` + `leftWidth="minmax(320px, max-content)"`; `DnD35eCharBuilderModal` & `DnD35eLevelUpModal` stages | All 5 D&D 3.5e Character Builder steps (`Race/Abilities`, `Class`, `Skills`, `Feats`, `Summary`) and Level-Up steps | Other `ModalShell` consumers (`GameOverModal`, `HelpModal`, `SettingsModal`) remain unaffected because `fullHeight` is opt-in |
| **3. Class `featureDetails` Label Resolution & Validator Check** (`CharBuilderClassStep.tsx`, `DnD35eLevelUpClassStep.tsx`, `class_race_validator.ts`) | `public/data/rulesets/dnd35e/classes/*.json` (`progression[].features`, `featureDetails`, `alternateClassFeatures`) | `CharBuilderClassStep` 20-level table & ACF cards; `DnD35eLevelUpClassStep` class preview table; `bun run scripts/run-validator.ts` | `systemContent.feats` fallback lookup for bonus feat progression entries (`fighter_bonus_feat`) |
| **4. HUD Single-Row `End Turn`, Compact Chronicle Log Tabs & Unified `Pack [I]` Dock Command** (`BottomActionDock.tsx`, `hud.css`, `CommandDockCard.tsx`, `dnd35e_ui_registration.tsx`) | `dnd35eUIDefinition.dockCommands` (removing duplicate `dnd35e_sheet` dock entry); `CommandDockCard` deduplicating cartridge inventory command | `CommandDockCard` DOM buttons; `BottomActionDock` hotbar row layout; `ChronicleLogCard` tab strip | `classic_ui_registration.tsx` (retains Classic Dossier `[C]` + Console Pack `[I]`), `tests/input_scope_and_keymap.test.ts` |
| **5. `"Inspect"` Card Rename & `RulesetContract.projectInspectStats`** (`TacticalScannerCard.tsx`, `inspect_tooltip.ts`, `ruleset.types.ts`, `dnd35e_ruleset.ts`) | Mouse hover / `Look` (`[X]`) reticle updates calling `buildTileInspectTooltip(state, x, y)` | `TacticalScannerCard` HUD panel rendering `InspectTooltipDTO.sections`; `evaluateDnD35eEntityDAG` | `classicRulesetContract` (falls back cleanly to `HP`, `ATK`, `DEF` + `Patience`) |
| **6. `Look` (`[X]`) + `Enter` Reticle Targeting & Extensible Interaction Reach** (`gameplay_input.ts`, `apply.system.ts`, `reaction.system.ts`, `mouse_input.ts`, `ruleset.types.ts`, `dnd35e_ruleset.ts`) | Keyboard `action.verb_menu` (`Enter`/`m`), `target.confirm` (`Enter` in `inspectMode`), `action.interact` (`e`), mouse right-click `openTileVerbMenu` | `getValidVerbsForTile`, `processApplyIntent` reach check, `resolveActorInteractionReachTiles`, `dnd35eRulesetContract.resolveInteractionReachTiles` (`interaction_reach_tiles` StatModifier) | Existing reach probe tests (`tests/m156_durability_doors_spells_ecology.test.ts` for `pole_10ft`), door/trap interaction tests |
| **7. `VerbMenuPopover` Valid-Only Filtering & Auto-Focused Fuzzy Search** (`VerbMenuPopover.tsx`, `mouse_input.ts`, `modal_input.ts`, `input_scope_manager.ts`, `hud.css`) | `openTileVerbMenu` filtering to valid verbs; user typing & pressing `ArrowUp`/`ArrowDown`/`Enter`/`Escape` in `VerbMenuPopover` search input | `executeVerbMenuOption` in `modal_input.ts`, `InputScopeManager` `Escape` handling in `UIMode.VerbMenu` | `tests/companion_ai_commands.test.ts` (headless `handleModalKey` calls with `'ArrowDown'`, `'Enter'`, `'1'`–`'9'`) |
| **8. Milestone 167 D&D 3.5e Mechanics & Content Parity** (`dag_helpers.ts`, `ac_breakdown.ts`, `spell_cast_*.ts`, `turning_resolver.ts`, `public/data/rulesets/dnd35e/**/*.json`) | `feats/*.json`, `races/*.json`, `classes/*.json`, `spells/*.json`, `items/*.json` | `evaluateDnD35eEntityDAG`, `resolveDnD35eSpellCast`, `resolveTurnOrRebukeUndead`, `scripts/run-validator.ts` | Default campaign showcase entities & items (`public/data/campaigns/default/*.json`) |

---

## 4. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Class Feature Display Labels** (`aura`, `cleric_domains`, etc.) | Hardcoding a `FEATURE_LABELS: Record<string, string>` dictionary in `CharBuilderClassStep.tsx` | Look up `classDef.featureDetails[featureId]?.name ?? sys.feats[featureId]?.name` from Tier 3 JSON + enforce coverage in `class_race_validator.ts` | **Yes** — Campaign authors add new features in `classes/*.json` `featureDetails` without touching `.ts`/`.tsx`. |
| **HUD `"Inspect"` Combat Stats per Ruleset** | Branching `if (state.campaign.rulesetId === 'dnd35e')` inside `src/rendering/inspect_tooltip.ts` | Optional `RulesetContract.projectInspectStats?(state, entityId)` method implemented by `dnd35eRulesetContract` | **Yes** — Any ruleset cartridge can project custom inspect stats via `RulesetContract`. |
| **Extended Interaction Reach** (*Mage Hand*, 10-ft pole, reach creatures) | Branching `if (hasSpell('mage_hand') \|\| itemId === 'pole_10ft')` in `apply.system.ts` | Baseline `getEntitySpatialProfile(state, actorId).naturalReachTiles` + declarative item tag `REACH_PROBE_ITEM_TAG` + `RulesetContract.resolveInteractionReachTiles` reading `StatModifier` target `'interaction_reach_tiles'` | **Yes** — Any new spell, feat, or item in JSON can grant `target: 'interaction_reach_tiles'` without editing `.ts` code. |
| **Command Dock `Pack [I]` Deduplication** | Checking `if (rulesetId === 'dnd35e')` inside `CommandDockCard.tsx` | Declarative deduplication in `CommandDockCard.tsx` matching cartridge `dockCommands` that bind/replace inventory (`UIMode.Inventory` / `'Pack'`) | **Yes** — Any cartridge can override or supplement Console dock commands declaratively. |
| **Magic Item Spell Effects** (`potion_of_cure_light_wounds`, etc.) | Hardcoding `if (itemId === 'potion_of_cure_light_wounds')` in `effects.system.ts` | Declarative `effectId: "spell:cure_light_wounds"` routed generically through `resolveDnD35eSpellCast` | **Yes** — Any new potion, scroll, wand, or staff in JSON works automatically by referencing `"spell:<spell_id>"`. |
