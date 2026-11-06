# Phase 26 Implementation Plan — Milestones 118 & 119

This revised plan implements **Approach 4 (Console Slot/Modal Host API + Cartridge UI Registry)**—evicting hardcoded cartridge modes (`UIMode.CharCreation`, `UIMode.LevelUp`) and direct `dnd35e_*` UI imports from Tier 1 Console files—while delivering all **Milestone 118** and **Milestone 119** features in strict compliance with `AGENTS.md` (zero `any`, zero magic values, $\le 250\text{--}300$ lines per `.ts` file, native `document.createElement` DOM construction, Three-Tier Placement Heuristic, and 3-Axis Cascading Effects).

---

## 1. SSOT Ownership & Old-Brain Eviction Table

### 1.1 Old-Brain Eviction Table (Console vs. Cartridge Boundary Refactoring)
| Legacy / Split-Brain Pattern | Evicted From (Tier 1 Console) | New Canonical Owner |
| :--- | :--- | :--- |
| `UIMode.CharCreation` & `UIMode.LevelUp` enum members | `src/types/game-state.types.ts`, `src/core/input_handler.ts`, `src/core/session_controller.ts` | Replaced by generic `UIMode.CartridgeModal = 'cartridge_modal'` + `activeCartridgeModalId?: string` on `GameState`, managed by `src/rendering/ui/cartridge_ui_registry.ts`. |
| Hardcoded `if (rulesetId === 'dnd35e')` new-game hook | `src/core/session/session_dom.ts` | Replaced by `applyCartridgeNewGameHook(state)` in `src/rendering/ui/cartridge_ui_registry.ts` (delegating to `CartridgeUIDefinition.onStartNewGame`). |
| Direct imports of `renderDnD35eCharBuilderModal`, `renderDnD35eLevelUpModal`, `renderDnD35eInspector` | `src/rendering/presenter.ts` | Replaced by generic `syncCartridgeModalVisibility(state)`, `renderActiveCartridgeModal(state)`, and `renderCartridgeInspectorExtension(...)` in `src/rendering/ui/cartridge_ui_registry.ts`. |
| Direct import of `canPlayerLevelUpDnD35e` | `src/rendering/ui/hud_alerts.ui.ts` | Replaced by `getActiveCartridgeUI(state)?.projectHudAlerts?.(state, playerEntityId)` in `src/rendering/ui/cartridge_ui_registry.ts`. |

### 1.2 File Decomposition Map ($\le 250\text{--}300$ Lines Per File)
| File Path | Tier | Responsibility | Target Line Budget |
| :--- | :---: | :--- | :---: |
| `src/rendering/ui/cartridge_ui_registry.ts` | Tier 1 (Console) | Generic **Console UI Slot & Modal Host API** (`CartridgeUIDefinition`, `CartridgeModalDescriptor`, `CartridgeDockCommandDescriptor`, `CartridgeHudAlertDescriptor`), modal lifecycle helpers (`openCartridgeModal`, `closeCartridgeModal`, `syncCartridgeModalVisibility`, `renderActiveCartridgeModal`), and HUD/Inspector slot dispatchers. | ~190 lines |
| `src/rendering/ui/resizable_panels.ui.ts` | Tier 1 (Console) | Interactive vertical/horizontal drag-splitters for `#hud-left-stack`, `#hud-right-stack`, `#hud-log-drawer`, and 2-pane Master/Detail modals, persisting widths in `PlayerSettings.panelLayout` and dispatching `resize` events for ROT.js canvas re-projection. | ~210 lines |
| `src/rendering/ui/equipment.ui.ts` | Tier 1 (Console) | Visual **Anatomical Paper Doll** primitive (`renderAnatomicalPaperDoll`) rendering interactive slot cards (`Head`, `Eyes`, `Neck`, `Shoulders`, `Torso`, `Body/Armor`, `Waist`, `Arms/Wrists`, `Hands`, `Ring L`, `Ring R`, `Feet`, `Main Hand`, `Off Hand` + dynamic extra limb / melded badges) around an actor silhouette with click-to-equip/unequip/inspect popovers. | ~250 lines |
| `src/rendering/ui/dnd35e_ui_adapter.ts` | Tier 2 (Cartridge UI) | Registers the `dnd35e` `CartridgeUIDefinition` into `cartridge_ui_registry.ts` (wiring `onStartNewGame`, `dockCommands` `[C] Sheet`, `[B] Spells`, `[L] Level Up`, `projectHudAlerts`, `renderHudPanel`, `renderInspectorExtension`, and the 4 modals `'char_creation'`, `'level_up'`, `'character_sheet'`, `'spellbook'`). | ~140 lines |
| `src/rendering/ui/dnd35e_doctrine_bar.ui.ts` | Tier 2 (Cartridge UI) | Compact HUD Tactical Doctrine & Maneuver Bar mounted into `#hud-cartridge-panel-slot`, rendering `variable_dial` sliders (*Power Attack*, *Combat Expertise*), grip & stance toggles, 5-Tier Action Budget pips, `ResourcePoolComponent` `[Activate]` buttons (including Wild Shape form picker), Special Combat Maneuver selector, and `[Level Up Available!]`. | ~260 lines |
| `src/rendering/ui/dnd35e_doctrine_actions.ts` | Tier 2 (Cartridge UI) | Pure state-update controllers invoked by `dnd35e_doctrine_bar.ui.ts` (updating `TacticalDoctrineComponent`, activating `ResourcePoolComponent` / Wild Shape overlays, and setting the active combat maneuver / attack mode). | ~220 lines |
| `src/rendering/ui/dnd35e_sheet.ui.ts` | Tier 2 (Cartridge UI) | Coordinator for the **7-Tab D&D 3.5e Character Sheet** (`modalId: 'character_sheet'`), managing tab navigation (`Overview`, `Progression`, `Equipment`, `Skills`, `Feats`, `Abilities`, `Conditions`) and header summary. | ~190 lines |
| `src/rendering/ui/sheet/sheet_overview_tab.ui.ts` | Tier 2 (Cartridge UI) | Tab 1 (Overview & Combat DAG Breakdown) & Tab 2 (Classes, Racial HD & Level History) renderers powered by `evaluateDnD35eEntityDAG`, `buildEffectProvenanceIndex`, and `computeEncumbranceState`. | ~260 lines |
| `src/rendering/ui/sheet/sheet_skills_tab.ui.ts` | Tier 2 (Cartridge UI) | Tab 4 (42+ Skill Table + Active Dungeon/Combat `[Use Skill]` dispatcher for *Search*, *Open Lock*, *Disable Device*, *Hide*, *Tumble*, *Intimidate: Demoralize*, *Heal*, *Use Magic Device*). | ~250 lines |
| `src/rendering/ui/sheet/sheet_feats_abilities_tab.ui.ts` | Tier 2 (Cartridge UI) | Tab 5 (Categorized Feats), Tab 6 (Racial/Type/Subtype Traits, Class Features, Domains), and Tab 7 (Active Conditions, Overlays & Auras). | ~240 lines |
| `src/rendering/ui/dnd35e_spellbook.ui.ts` | Tier 2 (Cartridge UI) | Coordinator for the **Class-Tabbed Vancian Spellbook** (`modalId: 'spellbook'`), rendering class tabs from `dndData.spellbooksByClass`, Level 0–9 + Domain `(+1)` slot matrix, Metamagic preparation picker, Spontaneous conversion buttons, `[Prepare in 15m]`, `[Cast]`, and `[8-Hour Rest & Study]`. | ~265 lines |
| `src/rendering/ui/spellbook/spellbook_actions.ts` | Tier 2 (Cartridge UI) | Pure state-transition controllers for assigning/clearing prepared slots (with Metamagic), 15-minute (`150`-round) open-slot dungeon preparation, spontaneous conversion, casting prepared/spontaneous spells onto dungeon targets, and 8-hour rest recovery. | ~240 lines |

---

## 2. Step-by-Step Implementation Plan & Code Snippets

### Step 1: Console UI Slot & Modal Host API + Eviction of `CharCreation` & `LevelUp` (`src/rendering/ui/cartridge_ui_registry.ts`, `src/rendering/ui/dnd35e_ui_adapter.ts`)
1. **Update `src/types/game-state.types.ts`, `src/types/intents/intent.enum.ts`, `src/types/intents/ui.intents.ts`, `src/types/intents/intent.union.ts`, `src/actions/core.actions.ts`, `src/systems/intent.system.ts`**:
   - Replace `CharCreation` and `LevelUp` in `UIMode` with `CartridgeModal = 'cartridge_modal'`, and add `readonly activeCartridgeModalId?: string | undefined;` to `GameState`.
   - Add a single generic `IntentType.ToggleCartridgeModal = 'TOGGLE_CARTRIDGE_MODAL'` and `ToggleCartridgeModalIntent` (`{ type: IntentType.ToggleCartridgeModal, entityId, modalId: string, isImmediate: true }`) + `createToggleCartridgeModalAction(entityId, modalId)`.
2. **Create `src/rendering/ui/cartridge_ui_registry.ts` & `src/rendering/ui/dnd35e_ui_adapter.ts`**:
   - Define the Console-level `CartridgeUIDefinition` contract and registry:
```ts
// Excerpt from src/rendering/ui/cartridge_ui_registry.ts
export interface CartridgeDockCommandDescriptor {
  readonly id: string;
  readonly label: string;
  readonly modalId: string;
  readonly defaultKey: string;
  readonly isAvailable?: (state: GameState, playerId: EntityId) => boolean;
}

export interface CartridgeModalDescriptor {
  readonly modalId: string;
  readonly overlayElementId: string;
  readonly allowEscapeClose: boolean;
  readonly render: (state: GameState) => void;
}

export interface CartridgeUIDefinition {
  readonly rulesetId: RulesetId;
  readonly onStartNewGame?: (state: GameState) => GameState;
  readonly dockCommands?: ReadonlyArray<CartridgeDockCommandDescriptor>;
  readonly projectHudAlerts?: (state: GameState, playerId: EntityId) => ReadonlyArray<CartridgeHudAlertDescriptor>;
  readonly renderHudPanel?: (container: HTMLElement, state: GameState, playerId: EntityId) => void;
  readonly renderInspectorExtension?: (container: HTMLElement, state: GameState, targetId: EntityId) => boolean;
  readonly modals: Readonly<Record<string, CartridgeModalDescriptor>>;
}
```
3. **Update `index.html`, `src/rendering/presenter.ts`, `src/core/session/session_dom.ts`, `src/core/session_controller.ts`, `src/core/input/modal_input.ts`, `src/core/input/shortcut_input.ts`, `src/rendering/ui/hud_dock.ui.ts`, and `src/rendering/ui/hud_alerts.ui.ts`**:
   - Add `#hud-cartridge-panel-slot` inside `#hud-left-stack` and `#cartridge-modal-overlay` in `index.html`.
   - Refactor `dnd35e_char_builder.ui.ts` and `dnd35e_level_up.ui.ts` to check `state.uiMode === UIMode.CartridgeModal && state.activeCartridgeModalId === 'char_creation' | 'level_up'`.
   - Wire `modal_input.ts` and `shortcut_input.ts` to dynamically query `getActiveCartridgeUI(state)` for `dockCommands` and `allowEscapeClose`.

---

### Step 2: General Resizable Panels & Drag Splitters (`src/rendering/ui/resizable_panels.ui.ts`, `src/core/settings.ts`)
1. Extend `PlayerSettings` in `src/core/settings.ts` with `panelLayout`:
```ts
export interface PanelLayoutSettings {
  readonly leftSidebarWidthPx?: number | undefined;
  readonly rightSidebarWidthPx?: number | undefined;
  readonly logDrawerHeightPx?: number | undefined;
  readonly modalMasterWidthPercent?: number | undefined;
}
```
2. Create `src/rendering/ui/resizable_panels.ui.ts`:
   - Define named constants for clamping: `MIN_SIDEBAR_WIDTH_PX = 200`, `MAX_SIDEBAR_WIDTH_PX = 480`, `MIN_LOG_HEIGHT_PX = 96`, `MAX_LOG_HEIGHT_PX = 360`, `MIN_MODAL_MASTER_PCT = 22`, `MAX_MODAL_MASTER_PCT = 60`.
   - Export `initResizablePanels()` and `applyPanelLayoutSettings()` which attach pointer-drag splitters to `#hud-left-stack`, `#hud-right-stack`, `#hud-log-drawer`, and 2-pane modals, update CSS variables (`--hud-left-width`, `--hud-right-width`, `--hud-log-height`, `--modal-master-width`), persist to `PlayerSettings`, and fire `window.dispatchEvent(new Event('resize'))` on pointerup so `applyViewportResize` re-projects the ROT.js canvas.

---

### Step 3: Visual Anatomical Paper Doll & In-Game HUD Vitals Overhaul (`src/rendering/ui/equipment.ui.ts`, `src/rendering/ui/hud_paperdoll.ui.ts`, `src/rendering/ui/inventory.ui.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`)
1. Create `src/rendering/ui/equipment.ui.ts`:
   - Export `renderAnatomicalPaperDoll(container: HTMLElement, state: GameState, entityId: EntityId, options?: { compact?: boolean; selectedSlotId?: string | null; onSelectSlot?: (slotId: string) => void }): void`.
   - Read `EquipmentComponent.slots` (falling back to `buildAnatomyEquipmentSlots('humanoid_biped')` if uninitialized) and `PropertyOverlayComponent` (detecting suppressed/melded slots).
   - Position slot cards (`Head`, `Eyes`, `Neck`, `Shoulders`, `Torso`, `Body/Armor`, `Waist`, `Arms/Wrists`, `Hands`, `Ring L`, `Ring R`, `Feet`, `Main Hand`, `Off Hand`, plus dynamic extra limb rows for `marilith_6arm` / `quadruped`) around an anatomical silhouette grid.
   - Display equipped item glyph/name, enhancement badge (`+1..+5`), weapon effort tag (`Light`, `1H`, `2H`), two-handed or shield limb occupation lock (`[2H Grip]` on `off_hand_1` when `weaponGrip === 'two_handed'`), and interactive click actions (`[Unequip]`, `[Equip Compatible Item]`, `[Toggle 1H/2H Grip]`).
2. Integrate `renderAnatomicalPaperDoll` into `src/rendering/ui/hud_paperdoll.ui.ts` (compact mode) and `src/rendering/ui/inventory.ui.ts` (full 2-pane mode alongside the backpack list).
3. Upgrade `projectHudVitals` in `src/rulesets/dnd35e/dnd35e_ruleset.ts` to project rich combat vitals (`ATK +X (+X/+X) | AC Full/T/FF`, `F/R/W +X/+Y/+Z | Load`).

---

### Step 4: HUD Tactical Doctrine Dials, Combat Maneuvers & Full-Attack Wiring (`src/rendering/ui/dnd35e_doctrine_bar.ui.ts`, `src/rendering/ui/dnd35e_doctrine_actions.ts`, `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts`)
1. Create `src/rendering/ui/dnd35e_doctrine_actions.ts` and `src/rendering/ui/dnd35e_doctrine_bar.ui.ts`:
   - Mounted into `#hud-cartridge-panel-slot` via `dnd35e_ui_adapter.ts`.
   - Render glowing **`[Level Up Available! (L)]`** button at the top of the panel when `canPlayerLevelUpDnD35e(state, playerId)` is true (opening `modalId: 'level_up'`).
   - Render 5-Tier Action Budget pips (`Std`, `Move`, `Swift`, `5ft Step`, `Imm Debt`).
   - Render dynamic sliders from `extractActorTacticalDials` (*Power Attack* `0..BAB`, *Combat Expertise* `0..min(5, BAB)`).
   - Render tactical stance & grip buttons (*1H / 2H / Double Grip*, *Fight Defensively*, *Total Defense*, *Cast Defensively*, *Rapid Shot*, *Deflect Arrows*).
   - Render **Combat Mode / Special Maneuver** selector pills (`Full Attack`, `Standard`, `Charge`, `Trip`, `Disarm`, `Sunder`, `Bull Rush`, `Overrun`, `Grapple`, `Feint`) stored in `TacticalDoctrineComponent.settings['active_maneuver']`.
   - Render active `ResourcePoolComponent` class/racial ability counters and `[Activate]` buttons (*Barbarian Rage*, *Turn Undead*, *Smite Evil*, *Lay on Hands*, *Bardic Music*, *Druid Wild Shape* form selector for Wolf / Brown Bear / Dire Bear / Small Fire Elemental, *Monk Ki / Stunning Fist*, *Abrupt Jaunt*).
2. Wire `resolveDnD35eMeleeAttack` in `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts`:
   - Read `doctrine?.settings?.['active_maneuver']`:
     - If a Special Combat Maneuver (`trip`, `disarm`, `sunder`, `bull_rush`, `overrun`, `grapple`, `feint`) is active, invoke `resolveCombatManeuver(...)`, log the opposed roll breakdown (`Attacker +X vs Defender +Y`), apply the resulting condition (`prone` on Trip, `grappled` on Grapple, `flat_footed` on Feint, knockback on Bull Rush, weapon unequip on Disarm) and if `grantedFreeFollowupAttack === true` (*Improved Trip*), immediately execute a free follow-up melee strike.
     - If `charge` is selected, apply `+2` attack bonus and `-2` AC penalty, executing the full attack sequence if `attackerEval.dndData.hasPounce === true` or a single strike otherwise.
     - If `standard` is selected, execute `strikes.slice(0, 1)`; if `full_attack` (default when `distanceMovedFt <= 5`), execute all `attackerEval.attackRoutine.strikes` (`PRIM-1.3` manufactured iteratives + off-hand + secondary natural weapons).

---

### Step 5: 7-Tab D&D 3.5e Character Sheet & Active Dungeon Skill Loop (`src/rendering/ui/dnd35e_sheet.ui.ts`, `src/rendering/ui/sheet/*.ts`)
1. Create `src/rendering/ui/dnd35e_sheet.ui.ts` + sub-modules under `src/rendering/ui/sheet/`:
   - **Tab 1 (`Overview & Combat DAG`)**:
     - 6 Ability Score cards (`STR`, `DEX`, `CON`, `INT`, `WIS`, `CHA`) with base score, enhancement/inherent/morale/alchemical bonuses, drain/damage, and `sourcePath` provenance lines from `dagResult.provenanceIndex`.
     - `Full / Touch / Flat-Footed AC` breakdown showing `10 + Armor + Shield + Dex (capped) + Size + Natural + Deflection + Dodge + Misc` and listing any shadowed/suppressed modifiers.
     - `Fortitude / Reflex / Will` save breakdowns, `BAB` & Full Attack routine preview, Grapple modifier, Initiative, `SR`, `DR`, Energy Resistances, and `Light / Medium / Heavy` Encumbrance gauge.
   - **Tab 2 (`Classes, Racial HD & Level History`)**:
     - Chronological `levelHistory` table (`Level 1..20`: class/RHD track, HP roll, skill points spent, feats chosen), `rhdProgression` summary, Favored Class & Multiclass XP status, and `acfSwaps`.
   - **Tab 3 (`Anatomical Equipment Paper Doll`)**:
     - Full interactive `renderAnatomicalPaperDoll` + slot-filtered inventory equip picker + `ACP`, `ASF%`, and `Max DEX` summary.
   - **Tab 4 (`Skills & Active Skill Actions`)**:
     - Full 42+ skill table (`Total = Ranks + KeyMod + Synergy + Typed - ACP`, class vs. cross-class indicator).
     - Direct **`[Use Skill]`** buttons for active dungeon/combat skills:
       - *Search*: Rolls `1d20 + Search` to reveal adjacent/nearby `hidden_trap` entities (`renderable: true`).
       - *Disable Device*: Rolls `1d20 + Disable Device` against adjacent trap DC to disarm and remove the trap.
       - *Open Lock*: Rolls `1d20 + Open Lock` against adjacent locked door/chest (`LockComponent`) to unlock it without a key.
       - *Intimidate (Demoralize)*: Rolls opposed `Intimidate` vs adjacent hostile's level/Hit Dice + Wisdom to inflict `shaken`.
       - *Heal (First Aid)*: Rolls `DC 15 Heal` check to stabilize dying allies or cure secondary poison/condition effects.
       - *Tumble / Hide / Use Magic Device*: Toggles active skill stance tags (`self:tumbling`, `self:hiding`, `self:umd_active`) and logs the check roll.
   - **Tab 5, 6 & 7 (`Feats`, `Special Abilities & Domains`, `Conditions & Overlays`)**:
     - Categorized feats with `DnD35EffectBundle` inspector, Racial/Type/Subtype traits, Domain granted powers, and active conditions/overlays with `sourcePath` provenance.

---

### Step 6: Class-Tabbed Vancian Spellbook, Spontaneous Casting & 8h Rest / 15-Min Open Slot UI (`src/rendering/ui/dnd35e_spellbook.ui.ts`, `src/rendering/ui/spellbook/spellbook_actions.ts`)
1. Create `src/rendering/ui/dnd35e_spellbook.ui.ts` and `src/rendering/ui/spellbook/spellbook_actions.ts`:
   - Render top-level **Class Spellbook Tabs** from `dndData.spellbooksByClass` (e.g. `Wizard`, `Cleric`, `Druid`, `Sorcerer`, `Bard`, `Paladin`, `Ranger`), displaying class Caster Level, Save DC baseline (`10 + SpellLvl + KeyMod`), and `ASF%`.
   - Render Level `0..9` + Domain `(+1)` slot rows:
     - Prepared casters can assign known/prayerbook spells into open slots (with optional Metamagic checkboxes—*Empower*, *Maximize*, *Extend*, *Quicken*, *Silent*, *Still*—computing inflated slot level via `applyMetamagicToSpell`), clear slots to leave them **Open**, or click **`[Prepare in 15m (150 turns)]`** on an open slot mid-dungeon via `prepareOpenSpellSlotInDungeon`.
     - Clerics can click **`[Spontaneous Cure/Inflict]`** (or Domain Spontaneity) on any prepared non-domain slot (`convertPreparedSlotSpontaneously`), and Druids can click **`[Spontaneous SNA]`**.
     - Clicking **`[Cast]`** on any prepared slot or spontaneous spell executes `resolveCastPipeline` + `executeModularSpellEffects` against the player (for self/party buffs/heals/summons) or the currently targeted / nearest hostile actor, expending the slot and recording `castTimestampTurn: state.globalTurn`.
     - Clicking **`[8-Hour Rest & Study]`** calls `resolveRestSlotRecovery` (checking the recent-cast window `globalTurn - castTimestampTurn < 80`), refreshes eligible spell slots and daily `ResourcePoolComponent` charges, advances `globalTurn` by `80`, and logs the rest summary.

---

### Step 7: Milestone 119 — *"The Sunless Reliquary"* Full SRD Content Showcase (`public/data/campaigns/dnd35e-crypt/*.json`) & Verification Suite
1. Expand `public/data/campaigns/dnd35e-crypt/areas.json`, `entities.json`, `items.json`, `spawn_pools.json`, `quests.json`, and `dialogues.json`:
   - **Outfitter Sanctuary Hub (`safe_hub`)**: Stock `merchant` with SRD weapons/armor/special materials (`longsword`, `greatsword`, `composite_longbow`, `full_plate`, `mithral_chain_shirt`, `adamantine_greataxe`, `alchemical_silver_dagger`, `cold_iron_longsword`, `heavy_steel_shield`, `wand_of_cure_light_wounds`, `wand_of_magic_missile`, `scroll_of_mage_armor`, `lockpick`, `health_potion`).
   - **Goblinoid & Orcish Outer Warrens (`dungeon_1`)**: Add `dire_rat` (`archetypeId: "dire_rat"`) alongside `goblin`, `goblin_archer`, `orc`, `orc_shaman`, `hidden_trap`, and locked `wooden_chest` containers.
   - **The Desecrated Ossuary (`dungeon_2`)**: Add Undead & Construct showcase templates (`zombie_ogre`, `ghoul`, `wight`, `wraith`, `iron_golem`) hydrated with authentic SRD `archetypeId`s and `rulesetData` (`DR 5/bludgeoning`, `DR 5/slashing`, `Incorporeal` subtype, `Construct` immunities) into `entities.json` and `spawn_pools.json`.
   - **The Reliquary Sanctum (`bandit_stronghold` & `shrine_vault_hub`)**: Include high-ECL SRD showcase bosses/guardians (`troll` with Regeneration 5 bypassed by fire/acid, `beholder` with Antimagic Cone, and `dragon_red_young` synthesized via `getDnD35Archetype(sys, 'dragon_red_young')`).
2. Create `tests/dnd35e_phase26_ui_and_showcase.test.ts`:
   - Test Console `CartridgeUIRegistry` modal routing (`'char_creation'`, `'level_up'`, `'character_sheet'`, `'spellbook'`) and verify `UIMode.CharCreation` / `UIMode.LevelUp` eviction.
   - Test HUD Tactical Doctrine Bar & Special Combat Maneuvers (`Trip`, `Disarm`, `Grapple`, `Full Attack` iterative + natural routine, `Level Up` alert & banner detection).
   - Test Anatomical Paper Doll slot projection (`humanoid_biped`, `quadruped`, `marilith_6arm`, Wild Shape melded slots, `1H`/`2H` grip toggles).
   - Test 7-Tab Character Sheet DAG breakdown, `sourcePath` provenance attribution, and active dungeon skill execution (*Search*, *Disable Device*, *Open Lock*, *Intimidate*).
   - Test Class-Tabbed Vancian Spellbook slot preparation, Metamagic inflation, Spontaneous Cleric/Druid conversion, 15-minute mid-dungeon open-slot preparation, casting, and 8-hour Rest with recent-cast retention.
   - Test Resizable Panels clamping and settings persistence.
   - Test full headless play-session loop in `dnd35e-crypt` and verify `./verify.sh` passes all 8 stages with 0 errors.

---

## 3. Three-Axis Cascading Effects Matrix (`Rule 15`)

| Change / Subsystem | Upstream (Callers, Emitters, Inputs) | Downstream (Consumers, Renderers, Validators) | Lateral (Sibling Configs, Keybinds, SSOT Docs) |
| :--- | :--- | :--- | :--- |
| **1. Console Slot/Modal Host (`UIMode.CartridgeModal`, `ToggleCartridgeModal`, `cartridge_ui_registry.ts`) & Eviction of `CharCreation`/`LevelUp`** | `shortcut_input.ts`, `modal_input.ts`, `hud_dock.ui.ts`, `session_dom.ts` (`onStartNewGame`), `hud_alerts.ui.ts` | `presenter.ts` (`syncCartridgeModalVisibility`, `renderActiveCartridgeModal`), `session_controller.ts` (focus trap), `intent.system.ts` exhaustive switch | `dnd35e_ui_adapter.ts`, `dnd35e_char_builder.ui.ts`, `dnd35e_level_up.ui.ts`, `index.html` |
| **2. HUD Tactical Doctrine & Maneuver Bar** (`dnd35e_doctrine_bar.ui.ts`, `dnd35e_doctrine_actions.ts`, `dnd35e_combat_adapter.ts`) | `TacticalDoctrineComponent`, `ResourcePoolComponent`, `ActionBudgetComponent`, `dndData.feats`, `canPlayerLevelUpDnD35e` | `evaluateDnD35eEntityDAG`, `resolveDnD35eMeleeAttack` (executes chosen maneuver or Full/Standard attack) | `dnd35e_ui_adapter.ts` (`renderHudPanel`), `hud.ui.ts` (`#hud-cartridge-panel-slot`) |
| **3. Visual Anatomical Paper Doll** (`equipment.ui.ts`, `hud_paperdoll.ui.ts`, `inventory.ui.ts`, `inventory.css`) | `EquipmentComponent.slots`, `buildAnatomyEquipmentSlots`, `PropertyOverlayComponent` (Wild Shape melded slots) | `processEquipItemIntent`, `processUnequipItemIntent`, Tab 3 of `dnd35e_sheet.ui.ts`, `#hud-paperdoll-grid` | `equipment_physics.ts` (1H/2H grip & off-hand shield occupation) |
| **4. 7-Tab Character Sheet & Active Skill Loop** (`dnd35e_sheet.ui.ts`, `src/rendering/ui/sheet/*.ts`) | `evaluateDnD35eEntityDAG`, `buildEffectProvenanceIndex`, `computeEncumbranceState`, `dndData.levelHistory` | `cartridge_ui_registry.ts` (`modalId: 'character_sheet'`), active dungeon skill resolver (Search, Open Lock, Disable Device, Heal, Demoralize) | `dnd35e_feat_spell_inspector.ui.ts` |
| **5. Class-Tabbed Vancian Spellbook & Rest/Cast Loop** (`dnd35e_spellbook.ui.ts`, `src/rendering/ui/spellbook/*.ts`) | `dndData.spellbooksByClass`, `sysContent.spells`, `sysContent.domains`, `dndData.feats` (Metamagic) | `cartridge_ui_registry.ts` (`modalId: 'spellbook'`), `setDnD35EntityData`, `resolveCastPipeline`, `executeModularSpellEffects`, `resolveRestSlotRecovery`, `prepareOpenSpellSlotInDungeon` | `dnd35e_char_builder.ui.ts`, `dnd35e_level_up.ui.ts` |
| **6. Resizable Layout Panels** (`resizable_panels.ui.ts`, `settings.ts`, `layout.css`) | Pointer drag events on `.panel-splitter-v` / `.panel-splitter-h`, `PlayerSettings.panelLayout` | CSS custom properties (`--hud-left-width`, `--hud-right-width`, `--modal-master-width`), `window` `'resize'` event -> `applyViewportResize` | All 2-pane modals (`char-creation`, `level-up`, `character-sheet`, `spellbook`, `editor`) |
| **7. `dnd35e-crypt` Campaign Showcase Expansion** (`public/data/campaigns/dnd35e-crypt/*.json`) | `loadCampaign('dnd35e-crypt')`, SRD `races/*.json` & `items/*.json` | `scripts/run-validator.ts` (referential integrity, spawn pools, area connections, dialogue trees) | `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json`, `docs/MILESTONES.md`, `docs/DECISIONS.md` |
