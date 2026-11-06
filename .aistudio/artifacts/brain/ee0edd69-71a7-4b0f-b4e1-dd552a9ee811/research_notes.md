# Phase 26 Research Notes — Milestones 118 & 119

## 1. Core Architectural Constraints (`AGENTS.md`, `docs/ARCHITECTURE.md`, `.dependency-cruiser.cjs`)

1. **Zero `any` & Strict TypeScript (`Rule 11`, `exactOptionalPropertyTypes: true`)**:
   - No `any` types anywhere. Optional properties cannot be assigned `undefined` explicitly (`foo?: string` must be omitted or typed `string | undefined`).
2. **Zero Magic Values (`Rule 12`)**:
   - Every numerical or string literal governing gameplay, layout bounds, or UI limits must be extracted to a named constant or JSON registry.
3. **One Concern Per File & $\le 250\text{--}300$ Line Limit (`Section 8`)**:
   - Large UI surfaces (`cartridge_ui_registry.ts`, `dnd35e_doctrine_bar.ui.ts`, `equipment.ui.ts`, `dnd35e_sheet.ui.ts`, `dnd35e_spellbook.ui.ts`, `resizable_panels.ui.ts`) MUST be decomposed into single-concern sub-modules so no `.ts` file exceeds 300 lines.
4. **Pure DOM Construction & View/Controller Separation (`Rule 7`)**:
   - Never use `.innerHTML` for dynamic UI rendering. Build DOM elements using `document.createElement()` and `textContent`.
   - Separate View rendering (`src/rendering/ui/*.ui.ts`) from Intent creation and state transitions.
5. **Three-Tier Placement Heuristic (`Rule 16`) & Dependency Cruiser Boundaries**:
   - **`headless-simulation-purity`**: `src/rulesets/**` must never import from `src/rendering/` or touch the DOM.
   - **`no-direct-cartridge-imports-outside-registry`**: `src/(core|systems|actions|rendering)/` must never import from `src/rulesets/dnd35e/` directly—only through `src/rulesets/registry.ts`.
   - **Console UI Host API vs. Cartridge UI Adapter**:
     - **Tier 1 (Console Engine)**: Owns the generic **Cartridge UI Host & Slot API** (`src/rendering/ui/cartridge_ui_registry.ts`), generic `UIMode.CartridgeModal` (`activeCartridgeModalId?: string`), generic `IntentType.ToggleCartridgeModal`, Resizable Panels (`src/rendering/ui/resizable_panels.ui.ts`), and the Visual Anatomical Paper Doll primitive (`src/rendering/ui/equipment.ui.ts`).
     - **Old-Brain Eviction**: Evict the hardcoded `UIMode.CharCreation` and `UIMode.LevelUp` enum members and all direct `dnd35e_*` imports from Tier 1 Console files (`game-state.types.ts`, `presenter.ts`, `session_dom.ts`, `session_controller.ts`, `input_handler.ts`, `hud_alerts.ui.ts`), migrating `'char_creation'` and `'level_up'` into the unified `CartridgeUIRegistry` alongside `'character_sheet'` and `'spellbook'`.
     - **Tier 2 (D&D 3.5e Cartridge & Cartridge UI Adapter)**: Registers `'dnd35e'` into `cartridge_ui_registry.ts` with its HUD Tactical Doctrine & Maneuver Bar (`dnd35e_doctrine_bar.ui.ts`), 7-Tab Character Sheet (`dnd35e_sheet.ui.ts`), Class-Tabbed Vancian Spellbook (`dnd35e_spellbook.ui.ts`), Character Creation (`dnd35e_char_builder.ui.ts`), Level-Up (`dnd35e_level_up.ui.ts`), and Inspector (`dnd35e_inspector.ui.ts`).
     - **Tier 3 (System & Campaign Content)**: `public/data/campaigns/dnd35e-crypt/*.json` showcasing the 4-zone *"The Sunless Reliquary"* adventure.
6. **Declarative Effect Providers & Provenance (`Rule 17`, `Rule 19`)**:
   - Character sheet stat tooltips and AC/Attack/Save breakdowns must read directly from `evaluateDnD35eEntityDAG` and `buildEffectProvenanceIndex` (`sourcePath` attribution, winner/shadowed/suppressed status)—never recomputing ad-hoc math in the UI.

---

## 2. Subsystem Analysis & Existing Codebase Integration Points

### 2.1 Console Slot/Modal Host API & Eviction of Hardcoded Cartridge Modes (`src/rendering/ui/cartridge_ui_registry.ts`)
- **Problem Identified in Existing Codebase**:
  - Previously, `UIMode.CharCreation` and `UIMode.LevelUp` were hardcoded in `src/types/game-state.types.ts`, `src/core/session/session_dom.ts` had `if (newState.campaign.manifest.rulesetId === 'dnd35e')`, `src/rendering/presenter.ts` directly imported `renderDnD35eCharBuilderModal`, `renderDnD35eLevelUpModal`, and `renderDnD35eInspector`, and `src/rendering/ui/hud_alerts.ui.ts` directly imported `canPlayerLevelUpDnD35e`.
- **Console-Level Solution (Approach 4)**:
  - Replace `UIMode.CharCreation` and `UIMode.LevelUp` in `src/types/game-state.types.ts` with a single universal **`UIMode.CartridgeModal = 'cartridge_modal'`** and `readonly activeCartridgeModalId?: string | undefined` on `GameState`.
  - Add a single generic **`IntentType.ToggleCartridgeModal = 'TOGGLE_CARTRIDGE_MODAL'`** (`{ type: IntentType.ToggleCartridgeModal, entityId, modalId: string, isImmediate: true }`) handled in `src/systems/intent.system.ts`.
  - Create `src/rendering/ui/cartridge_ui_registry.ts` exposing the Console UI Host API (`CartridgeUIDefinition`, `CartridgeModalDescriptor`, `CartridgeDockCommandDescriptor`, `CartridgeHudAlertDescriptor`) and helper functions (`getActiveCartridgeUI`, `openCartridgeModal`, `closeCartridgeModal`, `syncCartridgeModalVisibility`, `renderActiveCartridgeModal`).
  - Register `'dnd35e'` in `src/rendering/ui/dnd35e_ui_adapter.ts` providing:
    - `onStartNewGame`: resets character builder draft and opens `modalId: 'char_creation'` (`allowEscapeClose: false`).
    - `modals`: `'char_creation'`, `'level_up'`, `'character_sheet'`, `'spellbook'`.
    - `dockCommands`: `Sheet [C]`, `Spells [B]`, `Level Up [L]` (dynamically rendered in `hud_dock.ui.ts` and handled in `shortcut_input.ts` & `modal_input.ts`).
    - `projectHudAlerts`: projects the `Level Up Available!` ribbon into `hud_alerts.ui.ts` without `hud_alerts.ui.ts` importing D&D files.
    - `renderHudPanel`: mounts the D&D 3.5e Tactical Doctrine & Maneuver Bar into `#hud-cartridge-panel-slot` in `hud.ui.ts`.
    - `renderInspectorExtension`: mounts the D&D 3.5e entity inspector into `#inspector-content` in `presenter.ts`.

### 2.2 Milestone 118.1 — HUD Tactical Doctrine Dials, Combat Maneuvers, Active Class Abilities & Level-Up Banner
- **Existing Primitives**:
  - `src/rulesets/dnd35e/combat/tactical_doctrine.ts`: Exports `extractActorTacticalDials(featIds, featRegistry, suppressedBundleIds)` and `evaluateTacticalDoctrineModifiers(...)`.
  - `src/types/components.types.ts`: `TacticalDoctrineComponent` holds `powerAttackAmount`, `combatExpertiseAmount`, `fightingDefensively`, `totalDefense`, `castDefensively`, `weaponGrip` (`'one_handed' | 'two_handed' | 'double_weapon'`), and `settings: Readonly<Record<string, number | boolean | string>>`.
  - `src/rulesets/dnd35e/resource_pools.ts` & `src/rulesets/dnd35e/wild_shape.ts`: Manage `ResourcePoolComponent` and `applyWildShapeOverlay` / `revertWildShapeOverlay`.
  - `src/rulesets/dnd35e/action_economy.ts`: Provides `ActionBudgetState` (`hasStandard`, `hasMove`, `hasSwift`, `canTake5FootStep`, `nextTurnSwiftConsumedByImmediate`, `distanceMovedFt`).
  - `src/rulesets/dnd35e/combat/maneuvers_conditions.ts`: Exports `CombatManeuverType` (`'trip' | 'bull_rush' | 'disarm' | 'sunder' | 'overrun' | 'grapple' | 'feint'`) and `resolveCombatManeuver(params)`.
  - `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts`: `resolveDnD35eMeleeAttack` already resolves full iterative + off-hand + secondary natural weapon routines (`attackerEval.attackRoutine.strikes`) when `distanceMovedFt <= FIVE_FOOT_STEP_MAX_DISTANCE_FT`. By reading `doctrine?.settings?.['active_maneuver']`, `resolveDnD35eMeleeAttack` can execute a chosen Special Combat Maneuver (`resolveCombatManeuver`), a Charge (`+2` attack, `-2` AC, Pounce check), a Full-Round Attack (`strikes`), or a Standard single strike (`strikes.slice(0, 1)`).

### 2.3 Milestone 118.2 — Visual Anatomical Paper Doll & In-Game HUD Overhaul
- **Existing Primitives**:
  - `src/systems/inventory/equipment_slots.ts`: Defines `buildAnatomyEquipmentSlots(bodyPlan)` supporting `'humanoid_biped'`, `'quadruped'`, `'marilith_6arm'`, `'avian'`, `'serpentine'`.
- **Required Integration**:
  - Create Console-level `src/rendering/ui/equipment.ui.ts` rendering the interactive **Visual Anatomical Paper Doll** around an actor silhouette (`Head`, `Eyes`, `Neck`, `Shoulders`, `Torso`, `Body/Armor`, `Waist`, `Arms/Wrists`, `Hands`, `Ring L`, `Ring R`, `Feet`, `Main Hand`, `Off Hand`, plus dynamic extra limb slots for `marilith_6arm` and melded/suppressed state badges when Wild Shaped).
  - Embed the compact anatomical paper doll in `#hud-paperdoll-grid` (`src/rendering/ui/hud_paperdoll.ui.ts`) and the full-size interactive paper doll in both the Inventory Modal (`src/rendering/ui/inventory.ui.ts`) and Tab 3 of the D&D 3.5e Character Sheet.
  - Upgrade `projectHudVitals` in `src/rulesets/dnd35e/dnd35e_ruleset.ts` to surface live `Full / Touch / FF AC`, `Fort / Ref / Will` saves, `BAB` / iterative attack summary, active conditions, and encumbrance tier (`Light / Med / Heavy`).

### 2.4 Milestone 118.3 — 7-Tab D&D 3.5e Character Sheet (`src/rendering/ui/dnd35e_sheet.ui.ts`)
- Decompose the 7-Tab Character Sheet into focused modules under `src/rendering/ui/sheet/` coordinated by `src/rendering/ui/dnd35e_sheet.ui.ts`:
  1. **Tab 1 — Overview & Combat DAG Breakdown** (`sheet_overview_tab.ui.ts`): 6 Ability Scores with itemized `sourcePath` provenance from `dagResult.provenanceIndex`, `Full / Touch / Flat-Footed AC` breakdown (winning, shadowed, and suppressed modifiers), `Fort / Ref / Will` save breakdowns, `BAB` + iterative/natural attack sequence, Grapple, Initiative, `SR`, `DR`, Energy Resistances, and Encumbrance load gauge.
  2. **Tab 2 — Classes, Racial HD & Level History** (`sheet_overview_tab.ui.ts`): Chronological `levelHistory` (`1..20`), Racial HD tiers (`rhdProgression`), Favored Class & Multiclass XP penalty status, and active `acfSwaps`.
  3. **Tab 3 — Dynamic Anatomical Equipment Paper Doll** (`dnd35e_sheet.ui.ts` + `equipment.ui.ts`): Full interactive paper doll with slot-filtered equip pickers, grip toggles (`1H / 2H / Double`), and itemized `ACP / ASF% / Max DEX` readouts.
  4. **Tab 4 — Skills & Active Skill Actions** (`sheet_skills_tab.ui.ts`): Full 42+ skill table (`Total = Ranks + KeyMod + Synergy + Typed - ACP`) with `[Use Skill]` buttons for active dungeon/combat skills (*Search*, *Open Lock*, *Disable Device*, *Hide*, *Tumble*, *Intimidate: Demoralize*, *Heal*, *Use Magic Device*) that execute real skill checks against adjacent tiles/actors/traps/locks in the current dungeon.
  5. **Tab 5, 6 & 7 — Feats, Special Abilities/Domains, and Active Conditions/Overlays** (`sheet_feats_abilities_tab.ui.ts`).

### 2.5 Milestone 118.4 — Class-Tabbed Vancian Spellbook, Spontaneous Casting & 8h Rest / 15-Min Open Slot UI (`src/rendering/ui/dnd35e_spellbook.ui.ts`)
- Create `src/rendering/ui/dnd35e_spellbook.ui.ts` and `src/rendering/ui/spellbook/spellbook_actions.ts`:
  - Render top-level **Class Spellbook Tabs** from `dndData.spellbooksByClass` showing class Caster Level, governing ability score, Save DCs (`10 + SpellLvl + KeyMod`), and Arcane Spell Failure % (`ASF%`).
  - Level 0–9 + Domain `(+1)` slot matrix supporting Metamagic preparation (`applyMetamagicToSpell`), Open slots for **15-Minute (`150`-round) Mid-Dungeon Preparation** (`prepareOpenSpellSlotInDungeon`), Cleric/Druid spontaneous conversion (`convertPreparedSlotSpontaneously`), direct `[Cast]` execution (`resolveCastPipeline` + `executeModularSpellEffects`), and `[8-Hour Rest & Study]` (`resolveRestSlotRecovery`).

### 2.6 Milestone 118.5 — General Resizable Panels & Drag Splitters (`src/rendering/ui/resizable_panels.ui.ts`, `src/styles/layout.css`, `src/core/settings.ts`)
- Extend `PlayerSettings` in `src/core/settings.ts` with `panelLayout?: { leftSidebarWidthPx?: number; rightSidebarWidthPx?: number; logDrawerHeightPx?: number; modalMasterWidthPercent?: number }`.
- Create Console-level `src/rendering/ui/resizable_panels.ui.ts` attaching pointer-drag splitters to `#hud-left-stack`, `#hud-right-stack`, `#hud-log-drawer`, and 2-pane Master/Detail modals, clamping dimensions, persisting to `PlayerSettings`, and dispatching `window.dispatchEvent(new Event('resize'))` on drag end so ROT.js re-projects the canvas cleanly.

### 2.7 Milestone 119 — *"The Sunless Reliquary"* Full SRD Content Showcase & Campaign Editor Verification
- Expand `public/data/campaigns/dnd35e-crypt/` across all 4 adventure zones (Outfitter Sanctuary Hub, Goblinoid & Orcish Outer Warrens, The Desecrated Ossuary, and The Reliquary Sanctum) and verify with `tests/dnd35e_phase26_ui_and_showcase.test.ts` and `./verify.sh`.

---

## 3. Three-Axis Cascading Effects Matrix (`Rule 15`)

| Change / Subsystem | Upstream (Callers, Emitters, Inputs) | Downstream (Consumers, Renderers, Validators) | Lateral (Sibling Configs, Keybinds, SSOT Docs) |
| :--- | :--- | :--- | :--- |
| **1. Console Slot/Modal Host (`UIMode.CartridgeModal`, `ToggleCartridgeModal`, `cartridge_ui_registry.ts`) & Eviction of `CharCreation`/`LevelUp`** | `shortcut_input.ts`, `modal_input.ts`, `hud_dock.ui.ts`, `session_dom.ts` (`onStartNewGame`), `hud_alerts.ui.ts` | `presenter.ts` (`syncCartridgeModalVisibility`, `renderActiveCartridgeModal`), `session_controller.ts` (focus trap), `intent.system.ts` exhaustive switch | `dnd35e_ui_adapter.ts`, `dnd35e_char_builder.ui.ts`, `dnd35e_level_up.ui.ts`, `index.html` |
| **2. HUD Tactical Doctrine & Maneuver Bar** (`dnd35e_doctrine_bar.ui.ts`, `dnd35e_doctrine_actions.ts`, `dnd35e_combat_adapter.ts`) | `TacticalDoctrineComponent`, `ResourcePoolComponent`, `ActionBudgetComponent`, `dndData.feats`, `canPlayerLevelUpDnD35e` | `evaluateDnD35eEntityDAG`, `resolveDnD35eMeleeAttack` (dispatches selected maneuver or Full/Standard attack) | `dnd35e_ui_adapter.ts` (`renderHudPanel`), `hud.ui.ts` (`#hud-cartridge-panel-slot`) |
| **3. Visual Anatomical Paper Doll** (`equipment.ui.ts`, `hud_paperdoll.ui.ts`, `inventory.ui.ts`, `inventory.css`) | `EquipmentComponent.slots`, `buildAnatomyEquipmentSlots`, `PropertyOverlayComponent` (Wild Shape melded slots) | `processEquipItemIntent`, `processUnequipItemIntent`, Tab 3 of `dnd35e_sheet.ui.ts`, `#hud-paperdoll-grid` | `equipment_physics.ts` (1H/2H grip & off-hand shield occupation) |
| **4. 7-Tab Character Sheet & Active Skill Loop** (`dnd35e_sheet.ui.ts`, `src/rendering/ui/sheet/*.ts`) | `evaluateDnD35eEntityDAG`, `buildEffectProvenanceIndex`, `computeEncumbranceState`, `dndData.levelHistory` | `cartridge_ui_registry.ts` (`modalId: 'character_sheet'`), active dungeon skill resolver (Search, Open Lock, Disable Device, Heal, Demoralize) | `dnd35e_feat_spell_inspector.ui.ts` |
| **5. Class-Tabbed Vancian Spellbook & Rest/Cast Loop** (`dnd35e_spellbook.ui.ts`, `src/rendering/ui/spellbook/*.ts`) | `dndData.spellbooksByClass`, `sysContent.spells`, `sysContent.domains`, `dndData.feats` (Metamagic) | `cartridge_ui_registry.ts` (`modalId: 'spellbook'`), `setDnD35EntityData`, `resolveCastPipeline`, `executeModularSpellEffects`, `resolveRestSlotRecovery`, `prepareOpenSpellSlotInDungeon` | `dnd35e_char_builder.ui.ts`, `dnd35e_level_up.ui.ts` |
| **6. Resizable Layout Panels** (`resizable_panels.ui.ts`, `settings.ts`, `layout.css`) | Pointer drag events on `.panel-splitter-v` / `.panel-splitter-h`, `PlayerSettings.panelLayout` | CSS custom properties (`--hud-left-width`, `--hud-right-width`, `--modal-master-width`), `window` `'resize'` event -> `applyViewportResize` | All 2-pane modals (`char-creation`, `level-up`, `character-sheet`, `spellbook`, `editor`) |
| **7. `dnd35e-crypt` Campaign Showcase Expansion** (`public/data/campaigns/dnd35e-crypt/*.json`) | `loadCampaign('dnd35e-crypt')`, SRD `races/*.json` & `items/*.json` | `scripts/run-validator.ts` (referential integrity, spawn pools, area connections, dialogue trees) | `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json`, `docs/MILESTONES.md`, `docs/DECISIONS.md` |
