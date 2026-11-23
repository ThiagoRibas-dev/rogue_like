# Implementation Plan — Milestones 166 & 167: Gameplay UI, Parchment Contrast, Adaptive Layouts, Reach-Gated Fuzzy Verb Menu & D&D 3.5e Mechanics/Content Audit

**Date:** 2026-11-23  
**Scope:**
- **Milestone 166**: Post-Phase-43 Gameplay UI, Parchment Contrast, Adaptive Layouts & Reach-Gated Fuzzy Verb Menu Polish
- **Milestone 167**: D&D 3.5e Mechanics, Modifier Targets, Spell Effect Units & SRD Content Parity  
**Workflow Stage:** `AGENTS.md` Phase 1 Kickoff Flow — Steps 4 & 5 (`./docs/implementation_plan.md` Draft + Enhanced Code Diffs)

---

## 0. Architectural Governance & SSOT Ownership (`AGENTS.md` Rules 15–21)

- **Three-Tier Placement (`Rule 16`)**:
  - **Tier 1 (Console Engine — `src/core/`, `src/systems/`, `src/types/`, `src/rendering/`, `src/styles/`)**:
    - Semantic keycap tokens (`--ui-kbd-bg`, `--ui-kbd-ink`, `--ui-kbd-border`), `ModalShell` `fullHeight` prop, `CommandDockCard` cartridge inventory command deduplication, `TacticalScannerCard` `"Inspect"` label, `RulesetContract.projectInspectStats` & `RulesetContract.resolveInteractionReachTiles` contract hooks, `resolveActorInteractionReachTiles` & `isTargetWithinInteractionReach` in `src/systems/apply.system.ts`, `Look` (`[X]`) + `Enter` reticle interaction in `src/core/input/gameplay_input.ts`, and `VerbMenuPopover` valid-only filtering + auto-focused fuzzy search.
  - **Tier 2 (Ruleset Cartridge — `src/rulesets/dnd35e/`, `src/rendering/ui/cartridges/dnd35e/`)**:
    - `projectDnD35eInspectStats` and `resolveDnD35eInteractionReachTiles` in `src/rulesets/dnd35e/dnd35e_ruleset.ts` (evaluating `StatModifier` target `'interaction_reach_tiles'`), class `featureDetails` label lookup in `CharBuilderClassStep.tsx` and `DnD35eLevelUpClassStep.tsx`, `class_race_validator.ts` feature coverage check, and Milestone 167 DAG/spell/turning resolver fixes.
  - **Tier 3 (System Content — `public/data/rulesets/dnd35e/**/*.json`)**:
    - Canonical `StatModifier` target IDs, magic item `spell:<id>` effect hooks, 39 SRD spell `effectUnits` / `effectBundle` definitions, and modular `races/*.json`.

---

## 1. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors / Tests) | Downstream (Consumers / Renderers / Validators / Save Schemas) | Lateral (Sibling JSONs / Docs / Parallel Registries) |
| :--- | :--- | :--- | :--- |
| **1. Parchment Theme Naming & `--ui-kbd-*` / Hover Tokens** (`SettingsModal.tsx`, `tokens.css`, `parchment.css`, `primitives.css`, `dnd35e.css`) | `SettingsModal.tsx` `THEME_OPTIONS`; `tokens.css` & `parchment.css` token definitions | `<Keycap>` (`Keycap.tsx`), `HelpReminderChip.tsx`, `CommandDockCard.tsx`, `.ui-dnd-list-row:hover`, `.ui-dnd-table-scroll`, `.ui-dnd-quickcast-count` | `obsidian-brass.css`, `retro-crt.css`, `docs/UI_UX_STANDARDS.md`, `tests/console_ui_architecture.test.ts` |
| **2. `ModalShell` `fullHeight` & Content-Adaptive `SplitPane` / `.ui-dnd-wizard-stage`** (`ModalShell.tsx`, `primitives.css`, `RulesetSelectModal.tsx`, `CampaignSelectModal.tsx`, `dnd35e.css`) | `RulesetSelectModal` & `CampaignSelectModal` passing `fullHeight` + `size="xl"` + `leftWidth="minmax(320px, max-content)"`; `DnD35eCharBuilderModal` & `DnD35eLevelUpModal` stages | All 5 D&D 3.5e Character Builder steps (`Race/Abilities`, `Class`, `Skills`, `Feats`, `Summary`) and Level-Up steps | Other `ModalShell` consumers (`GameOverModal`, `HelpModal`, `SettingsModal`) remain unaffected because `fullHeight` is opt-in |
| **3. Class `featureDetails` Label Resolution & Validator Check** (`CharBuilderClassStep.tsx`, `DnD35eLevelUpClassStep.tsx`, `class_race_validator.ts`) | `public/data/rulesets/dnd35e/classes/*.json` (`progression[].features`, `featureDetails`, `acfSwaps`) | `CharBuilderClassStep` progression preview & ACF cards; `DnD35eLevelUpClassStep` progression preview & ACF cards; `bun run scripts/run-validator.ts` | `systemContent.feats` fallback lookup for bonus feat progression entries (`fighter_bonus_feat`, `wizard_bonus_feat`) |
| **4. HUD Single-Row `End Turn`, Compact Chronicle Log Tabs & Unified `Pack [I]` Dock Command** (`BottomActionDock.tsx`, `hud.css`, `CommandDockCard.tsx`, `dnd35e_ui_registration.tsx`) | `dnd35eUIDefinition.dockCommands` (consolidating `dnd35e_sheet` + `dnd35e_inventory` into a single `Pack [I]` dock entry while preserving `C` and `I` keyboard commands); `CommandDockCard` deduplicating Console `dock-btn-inventory` when cartridge provides `dnd35e:inventory` / `Pack` | `CommandDockCard` DOM buttons; `BottomActionDock` hotbar row layout; `ChronicleLogCard` tab strip | `classic_ui_registration.tsx` (retains Classic Dossier `[C]` + Console Pack `[I]`), `tests/input_scope_and_keymap.test.ts` |
| **5. `"Inspect"` Card Rename & `RulesetContract.projectInspectStats`** (`TacticalScannerCard.tsx`, `inspect_tooltip.ts`, `ruleset.types.ts`, `dnd35e_ruleset.ts`) | Mouse hover / `Look` (`[X]`) reticle updates calling `buildInspectTooltip(state, ...)` | `TacticalScannerCard` HUD panel rendering `InspectTooltipDTO.sections`; `evaluateDnD35eEntityDAG` | `classicRulesetContract` (falls back cleanly to `HP`, `ATK`, `DEF` + `Patience`) |
| **6. `Look` (`[X]`) + `Enter` Reticle Targeting & Extensible Interaction Reach** (`gameplay_input.ts`, `apply.system.ts`, `mouse_input.ts`, `ruleset.types.ts`, `dnd35e_ruleset.ts`) | Keyboard `action.verb_menu` (`Enter`/`m`), `combat.target_confirm` (`Enter` in `inspectMode`), `action.interact` (`e`), mouse right-click `openContextVerbMenuAtTile` | `getValidVerbsForTarget`, `processApplyIntent` reach check, `resolveActorInteractionReachTiles`, `dnd35eRulesetContract.resolveInteractionReachTiles` (`interaction_reach_tiles` StatModifier) | Existing reach probe tests (`tests/m156_durability_doors_spells_ecology.test.ts` for `pole_10ft`), door/trap interaction tests |
| **7. `VerbMenuPopover` Valid-Only Filtering & Auto-Focused Fuzzy Search** (`VerbMenuPopover.tsx`, `apply.system.ts`, `modal_input.ts`, `input_scope_manager.ts`, `hud.css`) | `VerbMenuPopover` filtering to `option.valid`, auto-focusing search `<input>`, handling `ArrowUp`/`ArrowDown`/`Enter`/`Escape` | `InputScopeManager` `Escape` handling in `UIMode.VerbMenu` when text input is focused | `tests/companion_ai_commands.test.ts` (headless `handleModalKey` calls with `'1'`–`'9'`, `'Enter'`, `'Escape'`) |
| **8. Milestone 167 D&D 3.5e Mechanics & Content Parity** (`dag_helpers.ts`, `ac_breakdown.ts`, `spell_cast_*.ts`, `turning_resolver.ts`, `public/data/rulesets/dnd35e/**/*.json`) | `feats/*.json`, `races/*.json`, `classes/*.json`, `spells/*.json`, `items/*.json` | `evaluateDnD35eEntityDAG`, `resolveDnD35eSpellCast`, `resolveTurnOrRebukeUndead`, `scripts/run-validator.ts` | Default campaign showcase entities & items (`public/data/campaigns/default/*.json`) |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Class Feature Display Labels** (`aura`, `cleric_domains`, etc.) | Hardcoding a `FEATURE_LABELS: Record<string, string>` dictionary in `CharBuilderClassStep.tsx` | Look up `classDef.featureDetails[featureId]?.name ?? sys.feats[featureId]?.name` from Tier 3 JSON + enforce coverage in `class_race_validator.ts` | **Yes** — Campaign authors add new features in `classes/*.json` `featureDetails` without touching `.ts`/`.tsx`. |
| **HUD `"Inspect"` Combat Stats per Ruleset** | Branching `if (state.campaign.rulesetId === 'dnd35e')` inside `src/rendering/inspect_tooltip.ts` | Optional `RulesetContract.projectInspectStats?(state, entityId)` method implemented by `dnd35eRulesetContract` | **Yes** — Any ruleset cartridge can project custom inspect stats via `RulesetContract`. |
| **Extended Interaction Reach** (*Mage Hand*, 10-ft pole, reach creatures) | Branching `if (hasSpell('mage_hand') \|\| itemId === 'pole_10ft')` in `apply.system.ts` | Baseline `getEntitySpatialProfile(state, actorId).naturalReachTiles` + declarative item tag `REACH_PROBE_ITEM_TAG` + `RulesetContract.resolveInteractionReachTiles` reading `StatModifier` target `'interaction_reach_tiles'` | **Yes** — Any new spell, feat, or item in JSON can grant `target: 'interaction_reach_tiles'` without editing `.ts` code. |
| **Command Dock `Pack [I]` Deduplication** | Checking `if (rulesetId === 'dnd35e')` inside `CommandDockCard.tsx` | Declarative deduplication in `CommandDockCard.tsx` suppressing Console `dock-btn-inventory` when any cartridge `dockCommands` entry binds key `'i'` or label `'Pack'` | **Yes** — Any cartridge can override or supplement Console dock commands declaratively. |
| **Magic Item Spell Effects** (`potion_of_cure_light_wounds`, etc.) | Hardcoding `if (itemId === 'potion_of_cure_light_wounds')` in `effects.system.ts` | Declarative `effectId: "spell:cure_light_wounds"` routed generically through `resolveDnD35eSpellCast` | **Yes** — Any new potion, scroll, wand, or staff in JSON works automatically by referencing `"spell:<spell_id>"`. |

---

## 3. Detailed Step-by-Step Implementation Plan & Code Diffs — Milestone 166

### Step 166.1: Parchment Theme Naming, Dark Leather Keycap Contrast & D&D 3.5e Hover/Table Surfaces

#### 1. `src/rendering/ui/menus/SettingsModal.tsx`
Rename `'Warm Tactical Parchment'` to `'Parchment'`:
```diff
 const THEME_OPTIONS: ReadonlyArray<SelectOption> = [
   { value: 'auto', label: 'Auto (Default / Match Game System)' },
   { value: 'obsidian-brass', label: 'Obsidian & Brass (Classic Dark)' },
-  { value: 'parchment', label: 'Warm Tactical Parchment' },
+  { value: 'parchment', label: 'Parchment' },
   { value: 'retro-crt', label: 'Retro Phosphor CRT' }
 ];
```

#### 2. `src/styles/tokens.css`, `src/styles/themes/parchment.css` & `src/styles/primitives.css`
Define semantic `--ui-kbd-bg`, `--ui-kbd-ink`, and `--ui-kbd-border` tokens so `.ui-kbd` renders as Dark Leather (`#2a241e`) with high-contrast Cream Text (`#f5ebd9`) and a warm leather border (`#5c4730`) in Parchment while preserving Obsidian & Brass and Retro CRT:

In `src/styles/tokens.css`:
```diff
   --ui-btn-primary-border: var(--ui-border-accent);
   --ui-btn-primary-ink: var(--ui-accent-primary-ink);
   --ui-btn-primary-shadow: none;
+
+  /* Keycap (<kbd>) Surface & Ink Defaults */
+  --ui-kbd-bg: var(--ui-bg-socket);
+  --ui-kbd-ink: var(--ui-ink-heading);
+  --ui-kbd-border: var(--ui-border-strong);
```

In `src/styles/themes/parchment.css`:
```diff
   --ui-btn-primary-border: var(--ui-border-accent);
   --ui-btn-primary-ink: var(--ui-accent-primary-ink);
   --ui-btn-primary-shadow: none;
+  --ui-kbd-bg: #2a241e;
+  --ui-kbd-ink: #f5ebd9;
+  --ui-kbd-border: #6e5536;
```

In `src/styles/primitives.css`:
```diff
 .ui-kbd {
   display: inline-flex;
   align-items: center;
   justify-content: center;
   min-width: 1.4em;
   padding: 0.12rem 0.38rem;
   border-radius: var(--ui-radius-sm);
-  border: 1px solid var(--ui-border-strong);
-  background: var(--ui-bg-socket);
-  color: var(--ui-ink-heading);
+  border: 1px solid var(--ui-kbd-border);
+  background: var(--ui-kbd-bg);
+  color: var(--ui-kbd-ink);
   font-family: var(--ui-font-mono);
   font-size: var(--ui-text-xs);
   font-weight: 600;
   line-height: 1.25;
   box-shadow: inset 0 -1px 0 var(--ui-border-subtle);
 }
```

#### 3. `src/styles/views/dnd35e.css`
Fix `--ui-bg-canvas` leaks on `.ui-dnd-table-scroll`, `.ui-dnd-quickcast-count`, and `.ui-dnd-list-row:hover:not(:disabled)`:
```diff
 /* ---------- Tables (Skills, Progression, Companions) ---------- */
 .ui-dnd-table-scroll {
   overflow-y: auto;
   max-height: 280px;
   border: 1px solid var(--ui-border-subtle);
   border-radius: var(--ui-radius-sm);
-  background: var(--ui-bg-canvas);
+  background: var(--ui-bg-panel-alt);
 }
...
 .ui-dnd-quickcast-count {
   padding: 1px 5px;
   border-radius: var(--ui-radius-sm);
-  background: var(--ui-bg-canvas);
+  background: var(--ui-bg-panel-alt);
   font-family: var(--ui-font-mono);
   font-weight: 700;
   color: var(--ui-accent-primary);
 }
...
 .ui-dnd-list-row:hover:not(:disabled) {
   border-color: var(--ui-border-strong);
-  background: var(--ui-bg-canvas);
+  background: var(--ui-bg-hover);
 }
```

---

### Step 166.2: Full-Height Selection Modals & Content-Adaptive Left Columns

#### 1. `src/rendering/ui/primitives/ModalShell.tsx` & `src/styles/primitives.css`
Add opt-in `fullHeight?: boolean | undefined` to `ModalShellProps`:
```diff
 export interface ModalShellProps {
   readonly title: string;
   readonly subtitle?: string | undefined;
   readonly isOpen?: boolean | undefined;
   readonly size?: ModalSize | undefined;
+  readonly fullHeight?: boolean | undefined;
   readonly layer?: ModalLayer | undefined;
```
```diff
 export function ModalShell({
   title,
   subtitle,
   isOpen = true,
   size = 'md',
+  fullHeight = false,
   layer = 'modal',
```
```diff
-  const modalClasses = ['ui-modal', size !== 'md' ? `ui-modal--${size}` : '', className ?? '']
+  const modalClasses = [
+    'ui-modal',
+    size !== 'md' ? `ui-modal--${size}` : '',
+    fullHeight ? 'ui-modal--full-height' : '',
+    className ?? ''
+  ]
     .filter(Boolean)
     .join(' ');
```

In `src/styles/primitives.css`:
```diff
 .ui-modal--xl {
   width: min(96vw, 1240px);
 }
+
+.ui-modal--full-height {
+  height: 90vh;
+}
```

#### 2. `src/rendering/ui/menus/RulesetSelectModal.tsx` & `src/rendering/ui/menus/CampaignSelectModal.tsx`
Enable `size="xl"`, `fullHeight`, and content-adaptive `leftWidth="minmax(320px, max-content)"`:

In `src/rendering/ui/menus/RulesetSelectModal.tsx`:
```diff
   return (
     <ModalShell
       title="Choose Game System"
       subtitle="Select the ruleset and combat system for your adventure"
-      size="lg"
+      size="xl"
+      fullHeight
       onClose={(): void => returnToMainMenu()}
```
```diff
       <SplitPane
-        leftWidth="280px"
+        leftWidth="minmax(320px, max-content)"
         left={
```

In `src/rendering/ui/menus/CampaignSelectModal.tsx`:
```diff
   return (
     <ModalShell
       title="Select Campaign"
       subtitle={`System: ${activeRuleset.metadata.badgeIcon} ${activeRuleset.metadata.name}`}
-      size="lg"
+      size="xl"
+      fullHeight
       onClose={(): void => openRulesetSelectMenu()}
```
```diff
       <SplitPane
-        leftWidth="280px"
+        leftWidth="minmax(320px, max-content)"
         left={
```

#### 3. Content-Adaptive Left Pane in D&D 3.5e Character Creation & Level-Up (`src/styles/views/dnd35e.css`)
Make the left column of `.ui-dnd-wizard-stage` adapt to its content (`minmax(280px, max-content)`) with a sensible `max-width: 420px` ceiling so pure selection lists (`Race`, `Class`) hug their content while the right detail column (`minmax(0, 1fr)`) receives the bulk of the modal width:
```diff
 .ui-dnd-wizard-stage {
   display: grid;
-  grid-template-columns: minmax(320px, 1.15fr) minmax(260px, 0.85fr);
+  grid-template-columns: minmax(280px, max-content) minmax(0, 1fr);
   gap: var(--ui-space-3);
   min-height: 0;
   flex: 1;
 }
+
+.ui-dnd-wizard-stage > .ui-dnd-wizard-pane:first-child {
+  max-width: 420px;
+}
```

---

### Step 166.3: Resolve Class Feature Labels from `featureDetails` / `feats` & Enforce in Validator

#### 1. `src/rendering/ui/cartridges/dnd35e/CharBuilderClassStep.tsx` & `src/rendering/ui/cartridges/dnd35e/DnD35eLevelUpClassStep.tsx`
Add a pure helper `resolveClassFeatureLabel(featureId: string, activeCls: DnD35ClassDefinition, sys: DnD35SystemContent): string` returning `activeCls.featureDetails[featureId]?.name ?? sys.feats[featureId]?.name ?? featureId`:

In `src/rendering/ui/cartridges/dnd35e/CharBuilderClassStep.tsx`:
```diff
+function resolveClassFeatureLabel(
+  featureId: string,
+  activeCls: DnD35ClassDefinition,
+  sys: DnD35SystemContent
+): string {
+  return activeCls.featureDetails[featureId]?.name ?? sys.feats[featureId]?.name ?? featureId;
+}
```
```diff
             <div className="ui-dnd-card">
               {activeCls.progression.slice(0, 5).map((row) => {
-                const featsStr = row.features.length > 0 ? ` [${row.features.join(', ')}]` : '';
+                const featureLabels = row.features.map((fId) => resolveClassFeatureLabel(fId, activeCls, sys));
+                const featsStr = featureLabels.length > 0 ? ` [${featureLabels.join(', ')}]` : '';
                 return (
                   <div key={row.level} className="ui-dnd-card__sub ui-dnd-mono">
                     {`Lv ${row.level}: BAB +${row.bab} | Fort +${row.fortSave}, Ref +${row.refSave}, Will +${row.willSave}${featsStr}`}
                   </div>
                 );
               })}
             </div>
```
```diff
+                      const replacesLabel = resolveClassFeatureLabel(acf.replacesFeature, activeCls, sys);
+                      const grantedLabel = resolveClassFeatureLabel(acf.grantedFeature, activeCls, sys);
                       return (
                         <button
...
                           <span>
-                            {`${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${acf.replacesFeature} → ${acf.grantedFeature})${reqSuffix}`}
+                            {`${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${replacesLabel} → ${grantedLabel})${reqSuffix}`}
                           </span>
                         </button>
                       );
```

In `src/rendering/ui/cartridges/dnd35e/DnD35eLevelUpClassStep.tsx`:
```diff
           <div className="ui-dnd-card__sub">
-            {`Features: ${rowDef?.features && rowDef.features.length > 0 ? rowDef.features.join(', ') : 'None'}`}
+            {`Features: ${
+              rowDef?.features && rowDef.features.length > 0
+                ? rowDef.features
+                    .map((fId) => activeCls.featureDetails[fId]?.name ?? sys.feats[fId]?.name ?? fId)
+                    .join(', ')
+                : 'None'
+            }`}
           </div>
```
```diff
+                const replacesLabel =
+                  activeCls.featureDetails[acf.replacesFeature]?.name ??
+                  sys.feats[acf.replacesFeature]?.name ??
+                  acf.replacesFeature;
+                const grantedLabel =
+                  activeCls.featureDetails[acf.grantedFeature]?.name ??
+                  sys.feats[acf.grantedFeature]?.name ??
+                  acf.grantedFeature;
                 return (
                   <button
...
                     <span>
-                      {`${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${acf.replacesFeature} → ${acf.grantedFeature})`}
+                      {`${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${replacesLabel} → ${grantedLabel})`}
                     </span>
                   </button>
```

#### 2. `src/rulesets/dnd35e/validation/class_race_validator.ts`
Validate that every feature ID in `classDef.progression[].features` exists in `classDef.featureDetails` or `sys.feats`:
```diff
       for (const feat of row.features) {
         grantedFeatures.add(feat);
+        const hasDetail = classDef.featureDetails && classDef.featureDetails[feat] !== undefined;
+        const hasFeat = sys.feats && sys.feats[feat] !== undefined;
+        if (!hasDetail && !hasFeat) {
+          errors.push({
+            path: `systemContent.classes.${classKey}.progression[${i}].features`,
+            message: `Class "${classKey}" level ${row.level} grants feature "${feat}" which is missing from both class featureDetails and systemContent.feats.`,
+            severity: 'error'
+          });
+        }
       }
```

---

### Step 166.4: HUD Polish — Single-Row `End Turn`, Compact Chronicle Log Tabs & Unified `Pack [I]` Dock Command

#### 1. `src/styles/views/hud.css` & `src/rendering/ui/hud/BottomActionDock.tsx`
Keep `End Turn` on the same row as the hotkeys and make the Chronicle Log filter tabs fit inside the `280px` right column without horizontal scrollbars:

In `src/styles/views/hud.css`:
```diff
+.ui-hud-card .ui-tabs__list {
+  gap: 2px;
+  overflow-x: hidden;
+}
+
+.ui-hud-card .ui-tabs__tab {
+  flex: 1 1 0;
+  padding: 4px 6px;
+  font-size: var(--ui-text-xs);
+  text-align: center;
+  white-space: nowrap;
+}
```
```diff
 /* --- Bottom Action Dock --- */
 .ui-bottom-dock {
   align-self: center;
   display: flex;
   flex-direction: column;
   gap: 6px;
   padding: 8px var(--ui-space-3);
   background: var(--ui-surface-glass);
   backdrop-filter: blur(var(--ui-glass-blur));
   border: 1px solid var(--ui-border-accent);
   border-radius: var(--ui-radius-lg);
   box-shadow: var(--ui-shadow-modal);
-  max-width: min(860px, 94vw);
+  max-width: min(960px, 96vw);
 }
```
```diff
 .ui-hotbar-row {
   display: flex;
   align-items: center;
   gap: 6px;
-  flex-wrap: wrap;
+  flex-wrap: nowrap;
 }
 
 .ui-hotbar-grid {
   display: grid;
-  grid-template-columns: repeat(12, minmax(52px, 1fr));
+  grid-template-columns: repeat(12, minmax(44px, 1fr));
   gap: 4px;
   flex: 1;
+  min-width: 0;
 }
```

#### 2. `src/rendering/ui/cartridges/dnd35e/dnd35e_ui_registration.tsx` & `src/rendering/ui/hud/CommandDockCard.tsx`
Remove the separate `dnd35e_sheet` (`Sheet [C]`) button from `dnd35eUIDefinition.dockCommands` so D&D 3.5e only registers `Pack [I]` (`dnd35e_inventory`, opening `character_sheet`), and deduplicate Console's `dock-btn-inventory` in `CommandDockCard.tsx` when the active cartridge provides its own `Pack` / `i` dock command:

In `src/rendering/ui/cartridges/dnd35e/dnd35e_ui_registration.tsx`:
```diff
   dockCommands: [
-    {
-      id: 'dnd35e_sheet',
-      commandId: 'dnd35e:sheet',
-      label: 'Sheet',
-      icon: '📜',
-      modalId: 'character_sheet',
-      defaultKey: 'c'
-    },
     {
       id: 'dnd35e_inventory',
       commandId: 'dnd35e:inventory',
       label: 'Pack',
       icon: '🎒',
       modalId: 'character_sheet',
       defaultKey: 'i'
     },
```
*(Note: `dnd35e:sheet` remains in `dnd35eUIDefinition.commands` bound to `'c'`, and in `src/core/input/shortcut_input.ts` / `modal_input.ts` we ensure both `dnd35e:sheet` (`c`) and `dnd35e:inventory` (`i`) toggle `character_sheet` via keyboard!)*

Let's check `src/core/input/shortcut_input.ts` lines 100–170 to make sure `dnd35e:sheet` (`c`) still works if it's in `commands` rather than `dockCommands`, or keep `dnd35e:sheet` routed cleanly. In `CommandDockCard.tsx`:
```diff
   const cartridgeCommands = (cartridgeUI?.dockCommands ?? []).filter(
     (cmd) => !cmd.isAvailable || cmd.isAvailable(state, playerId)
   );
+  const cartridgeOverridesInventory = cartridgeCommands.some(
+    (cmd) => cmd.defaultKey.toLowerCase() === 'i' || cmd.label === 'Pack'
+  );
+  const consoleDockCommands = cartridgeOverridesInventory
+    ? DOCK_COMMANDS.filter((spec) => spec.commandId !== 'panel.inventory')
+    : DOCK_COMMANDS;
```
And render `consoleDockCommands.map(...)` instead of `DOCK_COMMANDS.map(...)`!

---

### Step 166.5: Rename `"Tactical Scanner"` to `"Inspect"` & Add `RulesetContract.projectInspectStats`

#### 1. `src/rendering/ui/hud/TacticalScannerCard.tsx`
Rename `"Tactical Scanner"` to **`"Inspect"`**:
```diff
   return (
     <section
       className="ui-hud-card ui-hud-zone"
       data-hud-zone="3"
       data-hud-focused={isHudFocused ? 'true' : undefined}
-      aria-label="Tactical Scanner"
+      aria-label="Inspect"
     >
       <div className="ui-hud-card__header">
-        <h3 className="ui-hud-card__title">Tactical Scanner</h3>
+        <h3 className="ui-hud-card__title">Inspect</h3>
         <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
           <Badge tone={inspectTooltip?.active ? 'accent' : 'neutral'}>
             {firstHeader ? firstHeader.value.slice(0, 12) : 'IDLE'}
           </Badge>
           <IconButton
-            ariaLabel={folded ? 'Expand Tactical Scanner' : 'Fold Tactical Scanner'}
+            ariaLabel={folded ? 'Expand Inspect' : 'Fold Inspect'}
             onClick={(): void => uiStore.toggleHudFolded('scanner')}
           >
```

#### 2. `src/types/ruleset.types.ts`, `src/rendering/inspect_tooltip.ts` & `src/rulesets/dnd35e/dnd35e_ruleset.ts`
Add `projectInspectStats` to `RulesetContract`:

In `src/types/ruleset.types.ts`:
```diff
+  /**
+   * Optional cartridge hook to project ruleset-native combat stats into the HUD Inspect panel
+   * (e.g., D&D 3.5e HP, Full/Touch/Flat-Footed AC, BAB, and Fort/Ref/Will saves) instead of Classic ATK/DEF.
+   */
+  readonly projectInspectStats?: (
+    state: GameState,
+    targetEntityId: EntityId
+  ) => ReadonlyArray<{
+    readonly label: string;
+    readonly value: string;
+    readonly color?: string | undefined;
+  }>;
```

In `src/rendering/inspect_tooltip.ts`:
```diff
 function appendEntityComponentSections(state: GameState, entityId: EntityId, sections: InspectSectionDTO[]): void {
   const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
   if (fighter) {
-    const stats = getEffectiveStats(state, entityId);
-    sections.push({ type: 'stat', label: 'HP', value: `${fighter.hp}/${stats.maxHp}` });
-    sections.push({ type: 'stat', label: 'ATK', value: `${stats.attack}` });
-    sections.push({ type: 'stat', label: 'DEF', value: `${stats.defense}` });
+    const activeRuleset = getActiveRuleset(state);
+    const customStats = activeRuleset.projectInspectStats?.(state, entityId);
+    if (customStats && customStats.length > 0) {
+      for (const stat of customStats) {
+        sections.push({
+          type: 'stat',
+          label: stat.label,
+          value: stat.value,
+          ...(stat.color !== undefined ? { color: stat.color } : {})
+        });
+      }
+    } else {
+      const stats = getEffectiveStats(state, entityId);
+      sections.push({ type: 'stat', label: 'HP', value: `${fighter.hp}/${stats.maxHp}` });
+      sections.push({ type: 'stat', label: 'ATK', value: `${stats.attack}` });
+      sections.push({ type: 'stat', label: 'DEF', value: `${stats.defense}` });
+    }
   }
```

In `src/rulesets/dnd35e/dnd35e_ruleset.ts`:
```ts
function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

function projectDnD35eInspectStats(
  state: GameState,
  targetEntityId: EntityId
): ReadonlyArray<{ readonly label: string; readonly value: string; readonly color?: string | undefined }> {
  const fighter = getComponent(state, targetEntityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return [];
  const stats = computeDnD35eEffectiveStats(state, targetEntityId);
  const dag = evaluateDnD35eEntityDAG(state, targetEntityId);
  if (!dag) {
    return [
      { label: 'HP', value: `${fighter.hp}/${stats.maxHp}` },
      { label: 'AC', value: `${DND35E_BASE_AC + stats.defense}` },
      { label: 'BAB', value: formatSigned(stats.attack) }
    ];
  }
  const { acBreakdown, saves, bab } = dag.dagResult;
  return [
    { label: 'HP', value: `${fighter.hp}/${stats.maxHp}` },
    {
      label: 'AC',
      value: `${acBreakdown.fullAC} (T ${acBreakdown.touchAC} / FF ${acBreakdown.flatFootedAC})`
    },
    { label: 'BAB', value: formatSigned(bab) },
    {
      label: 'Saves',
      value: `F ${formatSigned(saves.fort)} / R ${formatSigned(saves.ref)} / W ${formatSigned(saves.will)}`
    }
  ];
}
```

---

### Step 166.6: `Look` (`[X]`) + `Enter` Reticle Targeting & Extensible Interaction Reach

#### 1. `src/core/input/gameplay_input.ts`
Fix both `combat.target_confirm` (`Enter` while in `TargetingInspectScope`) and `action.verb_menu` (`Enter`/`V` in `WorldGameplayScope`) so pressing `Enter` while `inspectMode.active === true` opens the verb menu / interacts with `(inspectMode.x, inspectMode.y)` instead of the player's own position:
```diff
+  const isInspecting = currentState.inspectMode?.active === true;
+  const inspectMode = currentState.inspectMode;
+
   if (isTargeting && targeting !== undefined && isCommandMatched(event, 'combat.target_confirm')) {
...
     return true;
   }
 
+  if (isInspecting && inspectMode !== undefined && isCommandMatched(event, 'combat.target_confirm')) {
+    event.preventDefault();
+    interactWithTile(currentState, playerEntityId, inspectMode.x, inspectMode.y);
+    return true;
+  }
+
   if (isTargeting && targeting !== undefined && isCommandMatched(event, 'action.verb_menu')) {
     event.preventDefault();
     handleSmartInteraction(currentState, playerEntityId, { type: 'tile', x: targeting.x, y: targeting.y });
     return true;
   }
 
+  if (isInspecting && inspectMode !== undefined && isCommandMatched(event, 'action.verb_menu')) {
+    event.preventDefault();
+    interactWithTile(currentState, playerEntityId, inspectMode.x, inspectMode.y);
+    return true;
+  }
```
And in the fallback `if (isCommandMatched(event, 'action.verb_menu'))` block at lines 245–251:
```diff
   if (isCommandMatched(event, 'action.verb_menu')) {
     event.preventDefault();
+    if (inspectMode?.active === true) {
+      interactWithTile(currentState, playerEntityId, inspectMode.x, inspectMode.y);
+      return true;
+    }
     const position = getComponent(currentState, playerEntityId, ComponentType.Position);
     if (position === undefined) return false;
     interactWithTile(currentState, playerEntityId, position.x, position.y);
     return true;
   }
```

#### 2. Extensible Physical/Touch Interaction Reach (`src/types/ruleset.types.ts`, `src/systems/apply.system.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`)
- Add optional `resolveInteractionReachTiles` hook to `RulesetContract` (`src/types/ruleset.types.ts`):
  ```ts
  /**
   * Optional cartridge hook to adjust an actor's effective interaction reach (in Chebyshev footprint tiles)
   * for a physical/touch verb (e.g., applying `interaction_reach_tiles` StatModifiers from Mage Hand or reach effects).
   */
  readonly resolveInteractionReachTiles?: (
    state: GameState,
    actorId: EntityId,
    verb: Verb,
    baseReachTiles: number,
    toolEntityId?: EntityId
  ) => number;
  ```
- Implement `resolveDnD35eInteractionReachTiles` in `src/rulesets/dnd35e/dnd35e_ruleset.ts`:
  ```ts
  function resolveDnD35eInteractionReachTiles(
    state: GameState,
    actorId: EntityId,
    _verb: Verb,
    baseReachTiles: number
  ): number {
    const dag = evaluateDnD35eEntityDAG(state, actorId);
    if (!dag) return baseReachTiles;
    const bonusReach = resolveTypedModifiers(dag.allModifiers, 'interaction_reach_tiles', {
      selfTags: dag.selfTags
    });
    return Math.max(baseReachTiles, baseReachTiles + bonusReach);
  }
  ```
- In `src/systems/apply.system.ts`, add `TOUCH_INTERACTION_VERBS`, `resolveActorInteractionReachTiles`, and `isTargetWithinInteractionReach`:
  - `TOUCH_INTERACTION_VERBS`: `'open'`, `'close'`, `'lock'`, `'unlock'`, `'kick'`, `'search'`, `'disarm'`, `'harvest'`, `'pray'`, `'apply'`, `'dip'`, `'ignite'`, `'eat'`, `'drink'`, `'heal'`, `'feint'`.
  - When `target` is `{ type: 'self' }` or an item already in `actorId`'s `InventoryComponent`, distance is `0` (always within reach).
  - Otherwise, resolve the target's world coordinates + footprint `(tx, ty, tw, th)` and actor's footprint `(ax, ay, aw, ah)` and compute `distanceTiles = computeRectDistanceTiles(ax, ay, aw, ah, tx, ty, tw, th)`.
  - Base reach is `Math.max(1, getEntitySpatialProfile(state, actorId).naturalReachTiles)`.
  - If `verb === 'search' || verb === 'disarm'` and the actor carries or uses a tool with `REACH_PROBE_ITEM_TAG` (`'pole_10ft'`), base reach is `Math.max(baseReach, REACH_PROBE_MAX_RANGE_TILES)` (`2` tiles).
  - Pass `baseReach` through `activeRuleset.resolveInteractionReachTiles?.(state, actorId, verb, baseReach, toolEntityId) ?? baseReach`.
  - Filter out-of-reach physical verbs in `getValidVerbsForTarget` and guard `processApplyIntent` so attempting a touch verb on an out-of-reach target returns `{ state: addMessage(state, 'That is out of reach.', MessageLogCategory.System), success: false }`.

---

### Step 166.7: `VerbMenuPopover` Valid-Only Filtering & Auto-Focused Fuzzy Finder

#### 1. `src/rendering/ui/hud/VerbMenuPopover.tsx` & `src/styles/views/hud.css`
- Filter options to **valid verbs only** (`gameState.verbMenu.verbOptions.filter((opt) => opt.valid)`).
- Add a pure fuzzy matcher `scoreFuzzyVerbMatch(query: string, verb: string): number | null`:
  - Empty query returns `0` (keeps original priority order).
  - Prefix match scores `100 - verb.length`, substring match scores `75 - index`, ordered character subsequence match scores `50 - span`, non-match returns `null`.
- Render an auto-focused `<input ref={searchInputRef} type="text" className="ui-input ui-verb-popover__search" placeholder="Type to filter actions..." />` above `.ui-verb-popover__list`.
- Track `selectedIndex` in component state (clamped to `0 .. filteredOptions.length - 1`, resetting to `0` when `searchQuery` or `gameState.verbMenu.target` changes).
- Handle keyboard navigation directly in the search input's `onKeyDown` (and container `onKeyDown`):
  - `ArrowDown`: `event.preventDefault(); event.stopPropagation();` -> `setSelectedIndex((prev) => (prev + 1) % filteredOptions.length)`
  - `ArrowUp`: `event.preventDefault(); event.stopPropagation();` -> `setSelectedIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length)`
  - `Enter`: `event.preventDefault(); event.stopPropagation();` -> execute `filteredOptions[selectedIndex]`
  - `Escape`: `event.preventDefault(); event.stopPropagation();` -> `closeMenu()`
- In `src/core/input/input_scope_manager.ts:185-191`, when `state.uiMode === UIMode.VerbMenu` and `isTextInput` is true, pressing `Escape` delegates to `handleModalKey(event, state, playerEntityId)` so a single `Escape` press closes `VerbMenuPopover` immediately instead of only blurring the search input.
- In `src/styles/views/hud.css:418`:
  ```diff
  +.ui-verb-popover__search-wrap {
  +  padding: 6px;
  +  border-bottom: 1px solid var(--ui-border-subtle);
  +  background: var(--ui-surface-sunken);
  +}
  +
   .ui-verb-popover__list {
     display: flex;
     flex-direction: column;
     padding: 4px;
     gap: 2px;
  +  max-height: 240px;
  +  overflow-y: auto;
   }
  +
  +.ui-verb-popover__item[data-highlighted='true'] {
  +  background: var(--ui-surface-selected);
  +  border-color: var(--ui-border-accent);
  +}
  ```

---

## 4. Detailed Step-by-Step Implementation Plan — Milestone 167 (D&D 3.5e Mechanics & Content Data Audit)

1. **Step 167.1 — Canonical StatModifier Target Wiring & Normalization**:
   - Wire `saves_all`, `save_reflex`, and `save_fear` in `src/rulesets/dnd35e/dag/dag_helpers.ts`.
   - Wire `ac_deflection` and `ac_insight` in `src/rulesets/dnd35e/dag/ac_breakdown.ts` and normalize JSON entries in `public/data/rulesets/dnd35e/spells/divine.json` & `feats/psionic.json`.
   - Normalize `skill_hide` -> `skill:hide` and `skill_swim` -> `skill:swim` in `public/data/rulesets/dnd35e/races.json`.
   - Wire `caster_level_check_vs_sr` in `src/rulesets/dnd35e/magic/spell_cast_helpers.ts` (`resolveSpellResistanceCheck`).
   - Wire `effective_turning_level` in `src/rulesets/dnd35e/combat/turning_resolver.ts`.
2. **Step 167.2 — Spontaneous Slot `maxDaily === 0` Guard & Cure-Spell Condition Cleanup**:
   - In `src/rulesets/dnd35e/magic/spell_cast_helpers.ts:253`, change `if (maxDaily > 0 && used >= maxDaily)` to `if (maxDaily <= 0 || used >= maxDaily)`.
   - In `src/rulesets/dnd35e/magic/spell_cast_effects.ts:249-256`, only push `unit.conditionId` when it is not `'none'` / `'heal_restoration'` and exists in `sysContent.conditions`.
3. **Step 167.3 — Direct Spell Effect Unit Handlers & `spell_modifiers.ts` Pipeline Integration**:
   - Connect `resolveEffectiveCasterLevel` and `resolveEffectiveSpellSaveDC` in `spell_cast_resolver.ts`.
   - Connect `buildSummonedCreatureModifiers` in `spell_cast_units.ts`.
   - Implement direct handlers for `quicken_cast_grant`, `retaliation_rider`, and `form_overlay` in `spell_cast_effects.ts`.
4. **Step 167.4 — SRD Magic Item `effectId` Wiring, 39 Spell `effectUnits` Population & Modular `races/*.json`**:
   - Wire `potion_of_cure_light_wounds`, `potion_of_bulls_strength`, `scroll_of_mage_armor`, `wand_of_magic_missile`, and `staff_of_fire` to their canonical D&D 3.5e spells.
   - Populate `effectUnits` / `effectBundle` for the 39 SRD spells.
   - Split `races.json` into modular `races/*.json` and retire unused root monolith shells.

---

## 5. Verification Plan (`AGENTS.md` Phase 3)

After executing each milestone:
1. Run the 8-stage verification pipeline (`./verify.sh`):
   - `[1/8]` `bun x tsc --noEmit`
   - `[2/8]` `bun run format`
   - `[3/8]` `bun run lint --fix`
   - `[4/8]` `bun run lint:arch`
   - `[5/8]` `bun run lint:deadcode`
   - `[6/8]` `bun test` (including new unit tests for `projectInspectStats`, `resolveActorInteractionReachTiles`, `Look` + `Enter` reticle interaction, `VerbMenuPopover` fuzzy filtering, and class `featureDetails` validator parity)
   - `[7/8]` `bun run build`
   - `[8/8]` `bun run scripts/run-validator.ts`
2. Re-verify the Cascading Effects Matrix and update `docs/MILESTONES.md`.
