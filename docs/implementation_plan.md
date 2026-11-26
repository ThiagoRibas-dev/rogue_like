# Implementation Plan — Phase 50: UX Polish, Content Provenance Tagging, Console Language & Social Verbs (`talk`, `attack`, `shove`), Map Generation Fixes & 3-Tier Command/Keybind Overhaul (Milestones 190–192)

*Drafted and enhanced per `AGENTS.md` Kickoff Flow Steps 4–5 after user confirmation of research and design choices.*

---

## 1. Architectural Rules & Standards Compliance

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16):**
   - **Tier 1 Console (`src/types/`, `src/constants/`, `src/utils/`, `src/core/`, `src/systems/`, `src/map/`, `src/rendering/`):**
     - `ModalShell` `scrollMode="panes"` independent sub-pane scrollbars.
     - Always-on `Z` coordinate display in `ChronosStrip.tsx`.
     - Digger door-framing validation (`generator_stages.ts` — scoped strictly to procedural `r.getDoors()` doors, never affecting magical portals or *Gate* spells) and unified edge/portal/stair entity spawning (`bootstrap.ts`, `map_generation_spawner.ts`).
     - Universal `ContentSourceOriginSchema` (`'srd' | 'non_srd' | 'second_party' | 'third_party' | 'homebrew'`) shared across Console campaign schemas and Cartridge system content.
     - Console Language & Deterministic Phonetic Obfuscation System (`src/systems/language.system.ts`) + `languages` / `primaryLanguage` / `languageId` on entity templates, actors, and dialogue trees/nodes.
     - Console `talk`, `attack`, and `shove` interaction verbs (`verbs.constants.ts`, `apply.system.ts`), `immovable?: boolean` flag on `EntityTemplateSchema` (and `trait:immovable` / `immovable` tag check in `movement_displacement.ts`), plus friendly/neutral targeting support in Aim (`targeting.system.ts`).
     - 3-Tier Command Classification (`commandTier: 'primary' | 'secondary' | 'tertiary'`), `debugModeEnabled: boolean` (default `false`) in `PlayerSettings`, and synchronized Command Dock / Keybinds.
   - **Tier 2 Cartridge (`src/rulesets/dnd35e/`):**
     - Shared fuzzy search & expanded declarative category/attribute filter chips on `<DnD35eSharedFeatsStep />` (removing the redundant `[Fighter]` title suffix) and `<DnD35eSharedSkillsStep />`, plus provenance badges (`SRD`, `Homebrew`, etc.) in `<DnD35eInspector />`.
     - Conditional Level-Up `Feats` tab (`DnD35eLevelUpModal.tsx` — omitted whenever `totalFeatSlots === 0`).
     - `IRuleset.evaluateLanguageComprehension` implementation in `src/rulesets/dnd35e/skills/language_comprehension.ts` evaluating actor `languages`, `Speak Language` ranks, and declarative Layer B tags/overrides (`comprehend_all_languages`, `speak_all_languages`, `communicate_creature_type:<type>`, `telepathy`).
     - `IRuleset.resolveShove` implementation in `src/rulesets/dnd35e/` delegating hostile `shove` to a stationary Bull Rush knockback (`resolveBullRushImpact` in `bull_rush_resolver.ts` without charging or advancing the attacker).
   - **Tier 3 System Content & Campaign Data (`public/data/`):**
     - Tag `judicious_spell.json` with `"sourceOrigin": "homebrew"` (defaulting all SRD files to `'srd'`).
     - Add declarative communication spells (`comprehend_languages.json`, `tongues.json`, `speak_with_animals.json`, `speak_with_plants.json`, `speak_with_dead.json`) emitting Layer B language tags/overrides.
     - Update Shroudgarde `stone_floor_portal` and edge portal visual definitions so horizontal town transitions use gateway/passage visuals instead of downward stairs.

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Content Provenance (`SRD`, `Non-SRD`, `2nd-Party`, `3rd-Party`, `Homebrew`)** | Hardcoding `if (feat.id === 'judicious_spell') return 'Homebrew'` in UI components | `ContentSourceOriginSchema = z.enum(['srd', 'non_srd', 'second_party', 'third_party', 'homebrew']).default('srd')` on Feat, Spell, Class, Race, Item, Template, Domain, and Skill schemas (`judicious_spell.json` sets `"sourceOrigin": "homebrew"`) | **Yes** — any modded JSON record can declare `"sourceOrigin"` and receive automatic badge rendering and filtering. |
| **Feat Category Filtering (`Metamagic`, `Combat`, `Magic`, `Skill`, `Proficiency`, `Monster`, `Item Creation`)** | Matching hardcoded feat ID lists in `DnD35eSharedFeatsStep.tsx` | Inspect declarative schema fields (`feat.metamagicDescriptor`, `feat.isFighterBonusFeat`, `feat.skillCheckCombatBonus`, `feat.effectBundle.category`, `feat.repeatable.targetCategory`, `feat.featCategory`) | **Yes** — new feats classify automatically from their schema fields or optional `featCategory`. |
| **Skill Group & Governing Attribute Filtering (`Knowledge`, `STR..CHA`)** | Hardcoding `if (skill.id === 'knowledge_arcana' \|\| ...)` | Inspect declarative `skill.keyAbility` (`'str'..'cha'`), `skill.studiedCreatureTags`, and optional `skill.skillGroup` (`'knowledge' \| 'craft' \| 'perform' \| 'profession' \| 'general'`) | **Yes** — any custom Knowledge or attribute-governed skill filters automatically. |
| **Unshovable / Immovable Guardians & Statues** | Checking `if (templateId === 'stone_guardian')` in shove/displacement code | `immovable: z.boolean().optional()` on `EntityTemplateSchema` + `trait:immovable` / `immovable` tag checked by `isEntityImmovable(state, entityId)` in `movement_displacement.ts` and `resolveBullRushImpact` | **Yes** — any creature or object template can set `"immovable": true` or grant `"trait:immovable"` via spell/feat/effect bundle. |
| **Language & Creature-Type Communication (*Speak with Animals*, *Tongues*, etc.)** | Checking `if (hasStatus(player, 'speak_with_animals') && target.id === 'wolf')` | Console `evaluateActorCommunication` calls `ruleset.evaluateLanguageComprehension`, which checks shared `languages` array plus declarative Layer A/B tags on the speaker/listener (`lang:comprehend_all`, `lang:speak_all`, `lang:speak_creature_type:<type>` matched against target `type:<type>`) | **Yes** — any new spell, item, or class feature granting `lang:speak_creature_type:elemental` or `lang:comprehend_all` works without touching `.ts` code. |
| **Procedural Door vs. Magical Portal Placement** | Applying global entity deduplication/wall-frame checks to all entities or portals | Scope wall-frame and orthogonal-spacing validation strictly to `ROT.Map.Digger`'s `r.getDoors()` loop in `generator_stages.ts`, leaving `portals` and spell-spawned gates completely unconstrained | **Yes** — freestanding or adjacent magical portals and *Gate* spells remain 100% supported. |

---

## 3. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Producers / Seeds) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling JSONs / Editor / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **`ModalShell` `scrollMode="panes"` & Pane CSS** | `DnD35eCharBuilderModal`, `DnD35eLevelUpModal`, `DnD35eSpellbookModal`, `DnD35eSheetModal`, `QuestsModal`, `InvestigationModal`, `NemesisDossierModal`, `LegendsModal`, `TradeModal` | `ModalShell.tsx`, `src/styles/primitives.css`, `src/styles/views/dnd35e.css` | Responsive `@media` layout rules, Preact UI tests |
| **`ContentSourceOriginSchema` & Feat/Skill Fuzzy Search + Filters** | `base_system.types.ts`, `dnd35e_system.types.ts`, `public/data/rulesets/dnd35e/feats/judicious_spell.json`, `src/utils/fuzzy_match.ts` | `DnD35eSharedFeatsStep.tsx`, `DnD35eSharedSkillsStep.tsx`, `DnD35eInspector.tsx`, `VerbMenuPopover.tsx` | `scripts/run-validator.ts`, Character Builder & Level-Up tests |
| **Conditional Level-Up Feats Tab & Top-Bar `Z` Coordinate** | `DnD35eLevelUpModal.tsx`, `ChronosStrip.tsx` | Level-Up tab navigation & validation, HUD top strip | `tests/dnd35e_char_builder_ui.test.ts` |
| **Digger Door Framing & Edge Portal Visuals** | `src/map/generator_stages.ts`, `src/systems/map/map_generation_spawner.ts`, `src/core/bootstrap.ts` | `realms-of-shroudgarde/entities.json`, procedural digger maps, edge portal entities | `scripts/visualize-campaign.ts`, `docs/CAMPAIGN_TOPOLOGIES.md`, `docs/campaign_atlas_3d.html` |
| **Console Language System & Cartridge Comprehension** | `EntityTemplateSchema` (`languages`, `primaryLanguage`), `DialogueTreeSchema` / `DialogueNodeSchema` (`languageId`), `src/systems/language.system.ts`, 5 communication spells in `public/data/rulesets/dnd35e/spells/` | `dialogue.system.ts`, `DialogueModal.tsx`, `inspect_tooltip.ts`, `dnd35e_ruleset.ts` (`evaluateLanguageComprehension`) | `system_content_files.ts`, `system_content_spell_ids.ts`, `ssot_console.json`, `ssot_dnd35e.json` |
| **`talk`, `attack`, `shove` Verbs, `immovable` Flag & Stationary Bull Rush** | `verbs.constants.ts`, `EntityTemplateSchema` (`immovable`), `apply.system.ts`, `targeting.system.ts`, `gameplay_input.ts` | `movement_displacement.ts` (`isEntityImmovable`), `bull_rush_resolver.ts`, `dnd35e_ruleset.ts` (`resolveShove`), `VerbMenuPopover.tsx` | `dnd35e_turn_budget.ts`, `tests/phase50_*.test.tsx` |
| **3-Tier Command Taxonomy, Debug Mode Gate & Keybind Revision** | `input.types.ts` (`CommandTier`), `command_catalog.ts`, `dnd35e_ui_registration.tsx`, `classic_ui_registration.tsx`, `settings.ts` (`debugModeEnabled`) | `hud_dock.ui.ts`, `CommandDockCard.tsx`, `shortcut_input.ts`, `SettingsModal.tsx`, `HelpModal.tsx`, `Automap3DModal.tsx`, `keybind_migration.ts` | `public/data/campaigns/*/keybinds.json`, `tests/input_scope_and_keymap.test.ts`, `tests/phase49_automap3d.test.tsx` |

---

## 4. Step-by-Step Implementation Plan & Code Snippets

### Milestone 190: Two-Pane Modal Independent Scrollbars, Top-Bar Z Coordinate, Level-Up Conditional Feats Tab, Content Provenance (`sourceOrigin`) & Feat/Skill Fuzzy Filters

1. **`ModalShell.tsx`, `src/styles/primitives.css` & `src/styles/views/dnd35e.css` — Two-Pane Independent Scrollbars:**
   - Add `scrollMode?: 'body' | 'panes' | undefined` to `ModalShellProps`. When `scrollMode === 'panes'`, apply `.ui-modal--full-height` and `.ui-modal__body--panes`:
   ```css
   .ui-modal__body--panes {
     display: flex;
     flex-direction: column;
     overflow: hidden;
     min-height: 0;
   }
   .ui-split-pane {
     display: grid;
     gap: var(--ui-space-3);
     min-height: 0;
     height: 100%;
     flex: 1 1 auto;
     overflow: hidden;
   }
   .ui-split-pane > * {
     min-height: 0;
     overflow-y: auto;
   }
   ```
   - Ensure `.ui-dnd-sheet-body` has `overflow: hidden; min-height: 0; flex: 1 1 auto;` and `.ui-dnd-wizard-stage`, `.ui-dnd-sheet-2col`, `.ui-dnd-sheet-3col` have `overflow: hidden; min-height: 0; flex: 1 1 auto;` while each `.ui-dnd-wizard-pane` and `.ui-dnd-col` has `overflow-y: auto; min-height: 0;`.
   - Enable `scrollMode="panes"` on `<DnD35eCharBuilderModal />`, `<DnD35eLevelUpModal />`, `<DnD35eSpellbookModal />`, `<DnD35eSheetModal />`, `<ClassicSheetModal />`, `<QuestsModal />`, `<InvestigationModal />`, `<NemesisDossierModal />`, `<LegendsModal />`, and `<TradeModal />`.

2. **`src/rendering/ui/hud/ChronosStrip.tsx` — Always Show `Z` Coordinate:**
   ```tsx
   {pos ? (
     <Badge tone={zOffset !== 0 ? 'warning' : 'neutral'}>
       {zOffset !== 0
         ? `X:${pos.x} Y:${pos.y} Z:${playerZ} (View:${viewZ})`
         : `X:${pos.x} Y:${pos.y} Z:${playerZ}`}
     </Badge>
   ) : null}
   ```

3. **`src/rendering/ui/cartridges/dnd35e/DnD35eLevelUpModal.tsx` — Hide Feats Tab When `totalFeatSlots === 0`:**
   ```ts
   const tabsMeta: Array<{ readonly id: LevelUpTabId; readonly label: string }> = [
     { id: 'class', label: `1. Class & HP (HD ${nextCharLevel})` },
     { id: 'skills', label: `2. Skills (${skillRemaining}/${skillBudget} pts)` }
   ];
   if (totalFeatSlots > 0) {
     tabsMeta.push({
       id: 'feats',
       label: `3. Feats (${effectiveDraft.selectedFeats.length}/${totalFeatSlots})`
     });
   }
   spellTabs.forEach((st) => {
     const pickedCount =
       effectiveDraft.learnedSpellsByClass?.[st.classId]?.length ??
       (st.classId === activeCls.id ? (effectiveDraft.learnedSpells ?? []).length : 0);
     const stepNum = tabsMeta.length + 1;
     tabsMeta.push({ id: st.tabId, label: `${stepNum}. ${st.className} Spells (${pickedCount})` });
   });
   ```

4. **Content Provenance Schema (`ContentSourceOriginSchema`) & `judicious_spell.json` Tagging:**
   - In `src/rulesets/dnd35e/types/system/base_system.types.ts`:
     ```ts
     export const ContentSourceOriginSchema = z.enum([
       'srd',
       'non_srd',
       'second_party',
       'third_party',
       'homebrew'
     ]);
     export type ContentSourceOrigin = z.infer<typeof ContentSourceOriginSchema>;
     ```
   - Add `sourceOrigin: ContentSourceOriginSchema.default('srd')` to `DnD35FeatDefinitionSchema`, `DnD35SkillDefinitionSchema`, `DnD35ClassDefinitionSchema`, `DnD35SpellDefinitionSchema`, `DnD35RaceDefinitionSchema`, `DnD35ItemDefinitionSchema`, `DnD35DomainDefinitionSchema`, and `DnD35TemplateSchema`, as well as Console `EntityTemplateSchema` and `ItemTemplateSchema`.
   - Set `"sourceOrigin": "homebrew"` in `public/data/rulesets/dnd35e/feats/judicious_spell.json`.
   - Render a provenance `<Badge />` (`SRD 3.5e`, `Non-SRD Official`, `2nd Party`, `3rd Party`, `Homebrew`) in `<DnD35eFeatInspector />`, `<DnD35eSkillInspector />`, `<DnD35eSpellInspector />`, `<DnD35eRaceInspector />`, and `<DnD35eClassInspector />`.

5. **Shared Fuzzy Search (`src/utils/fuzzy_match.ts`), Feat Filter Expansion & Removal of `[Fighter]` Suffix:**
   - Extract `scoreFuzzyTextMatch(query, candidate)` into `src/utils/fuzzy_match.ts` (reused by `VerbMenuPopover.tsx`, `DnD35eSharedFeatsStep.tsx`, and `DnD35eSharedSkillsStep.tsx`).
   - In `DnD35eSharedFeatsStep.tsx`:
     - Remove `${cat.isFighterBonus ? ' [Fighter]' : ''}` from line 285.
     - Add a fuzzy search `<Input />` (`placeholder="Search feats by name, effect, or prerequisite..."`).
     - Expand filter chips to: **`All`**, **`Eligible`**, **`Fighter Bonus`**, **`Combat`**, **`Metamagic`**, **`Spellcasting`**, **`Skill & Utility`**, **`Proficiency`**, **`Monster / Natural`**, and **`Homebrew / Non-SRD`** (when present).
   - In `DnD35eSharedSkillsStep.tsx`:
     - Add a fuzzy search `<Input />` (`placeholder="Search skills..."`).
     - Expand category chips to: **`All`**, **`Class`**, **`Knowledge`**, **`Trained-Only`**, **`Invested`** + an attribute filter chip strip: **`Any Attr`**, **`STR`**, **`DEX`**, **`CON`**, **`INT`**, **`WIS`**, **`CHA`**.

---

### Milestone 191: Procedural Digger Door Framing, Edge Portal Visuals, Console Language Obfuscation System, D&D 3.5e Communication Spells & Look/Verb Menu (`talk`, `attack`, `shove` + `immovable`)

1. **`src/map/generator_stages.ts` — Digger Door Framing & Orthogonal Spacing (Scoped Strictly to Procedural Doors):**
   - In `generator_stages.ts`, collect `r.getDoors()` coordinates across `diggerRooms` into a candidate list, then validate each candidate `(dx, dy)` before spawning `palette.door`:
     ```ts
     function isValidDiggerDoorPlacement(
       dx: number,
       dy: number,
       width: number,
       height: number,
       isSolidAt: (x: number, y: number) => boolean,
       occupiedKeys: ReadonlySet<string>
     ): boolean {
       if (dx <= 0 || dx >= width - 1 || dy <= 0 || dy >= height - 1) return false;
       if (occupiedKeys.has(`${dx},${dy}`)) return false;
       // Prevent orthogonally adjacent procedural doors
       if (
         occupiedKeys.has(`${dx - 1},${dy}`) ||
         occupiedKeys.has(`${dx + 1},${dy}`) ||
         occupiedKeys.has(`${dx},${dy - 1}`) ||
         occupiedKeys.has(`${dx},${dy + 1}`)
       ) {
         return false;
       }
       const nSolid = isSolidAt(dx, dy - 1);
       const sSolid = isSolidAt(dx, dy + 1);
       const wSolid = isSolidAt(dx - 1, dy);
       const eSolid = isSolidAt(dx + 1, dy);
       const horizontalFrame = wSolid && eSolid && !nSolid && !sSolid;
       const verticalFrame = nSolid && sSolid && !wSolid && !eSolid;
       return horizontalFrame || verticalFrame;
     }
     ```
   - If a candidate cell sent by `ROT.Map.Digger.getDoors` lacks a valid wall frame, leave it as a normal corridor floor tile (`palette.floor`) without spawning a floating/duplicate door entity. Magical portals and *Gate* spells do not pass through `r.getDoors()` and remain completely unaffected.

2. **`src/systems/map/map_generation_spawner.ts`, `src/core/bootstrap.ts` & Shroudgarde Edge Transitions:**
   - Extract a shared `spawnAreaPortalEntity(state, portal)` helper used by both `bootstrap.ts` and `map_generation_spawner.ts` so starting areas and traveled areas behave identically.
   - When `portal.connection.direction` is `'edge'` or `'portal'` (and no `portalTemplateId` is specified), resolve tile/sprite & glyph from `'archway_portal'` / `'open_wooden_door'` (`glyph: '∩'` or `'Π'`, `spriteId: state.campaign.tiles['open_wooden_door']?.spriteId ?? 'tile_framed_door_1_open'`) instead of `'stairs_down'` (`tile_staircase_down`).
   - Update `public/data/campaigns/realms-of-shroudgarde/entities.json` (`stone_floor_portal` or add `town_gate_archway`) so Shroudgarde transitions render as archways/passages rather than downward stairs.

3. **Console Language System (`src/systems/language.system.ts`) & Cartridge Comprehension Hook:**
   - **Schema additions:**
     - `EntityTemplateSchema`: `languages: z.array(z.string()).optional()`, `primaryLanguage: z.string().optional()`, `immovable: z.boolean().optional()`.
     - `DialogueTreeSchema` & `DialogueNodeSchema`: `languageId: z.string().optional()`.
     - `DnD35RaceDefinitionSchema` & `DnD35EntityData`: `automaticLanguages: z.array(z.string()).default(['common'])`, `bonusLanguages: z.array(z.string()).default([])`, `languages: z.array(z.string()).default(['common'])`.
   - **Console Deterministic Obfuscator (`src/systems/language.system.ts`):**
     - `obfuscateDialogueText(text, languageId)`: Preserves punctuation, capitalization, `[WikiBracket]` structure, and word lengths while deterministically mapping each word to syllable tokens from the target language's phoneme profile (`draconic`, `infernal`, `abyssal`, `elven`, `dwarven`, `sylvan`, `undercommon`, `animal`, `plant`, `necrotic`, etc.) and prepending a `[Speaking <Language> — Uncomprehended]` indicator.
     - `evaluateActorDialogueComprehension(state, listenerId, speakerId, explicitLanguageId)`:
       1. Delegates to `getActiveRuleset(state).evaluateLanguageComprehension?.(state, listenerId, speakerId, explicitLanguageId)` if provided.
       2. Otherwise checks Console actor `languages` / `primaryLanguage` (defaulting to `'common'`).
   - **D&D 3.5e Cartridge Comprehension & 5 New SRD Communication Spells:**
     - Author `public/data/rulesets/dnd35e/spells/{comprehend_languages,tongues,speak_with_animals,speak_with_plants,speak_with_dead}.json` granting status effects with declarative tags (`lang:comprehend_all`, `lang:speak_all`, `lang:speak_creature_type:animal`, `lang:speak_creature_type:plant`, `lang:speak_creature_type:undead`).
     - In `src/rulesets/dnd35e/skills/language_comprehension.ts`:
       - Checks if target is a non-speaking creature type (`type:animal`, `type:plant`, `type:vermin`, mindless `type:undead`): requires matching `lang:speak_creature_type:<type>` (from *Speak with Animals*, *Speak with Plants*, *Speak with Dead*, Wild Empathy, etc.).
       - For spoken languages (`draconic`, `goblin`, `infernal`, etc.): checks if listener shares `languageId` in `dndData.languages` (populated from racial `automaticLanguages` + `Speak Language` skill ranks + INT bonus languages), or has `lang:comprehend_all` (*Comprehend Languages*) or `lang:speak_all` (*Tongues*) or `trait:telepathy`.
   - **Dialogue Integration (`src/rendering/ui/modals/DialogueModal.tsx`):**
     - Evaluates `evaluateActorDialogueComprehension(state, playerId, npcEntityId, node.languageId ?? tree.languageId)`. If not understood, renders obfuscated NPC speech and shows a language badge (`🗣️ Language: <Name> (Uncomprehended)` or `(Translated via <Source>)`).

4. **Look / Context Verb Menu (`talk`, `attack`, `shove`), Friendly Aim & `immovable` Creature Flag:**
   - Add `'talk'`, `'attack'`, and `'shove'` to `Verb` and `VERBS` in `src/constants/verbs.constants.ts`.
   - **`talk` Verb (`apply.system.ts`):**
     - Valid on any adjacent (or in-reach) living entity with `DialogueComponent`, `ShopComponent`, `ServicesComponent`, or `ActorComponent`.
     - Executes `processInteractIntent` (opening dialogue/trade/companion orders, or emitting a language-filtered bark if the actor has no dialogue tree).
   - **`attack` Verb & Friendly Aim (`apply.system.ts`, `targeting.system.ts`, `gameplay_input.ts`):**
     - Valid in Look / Verb Menu on any living entity (`id !== sourceEntityId` with `FighterComponent`).
     - When executed on a friendly/neutral actor, flips hostility / records assault attitude shift and dispatches `processMeleeAttackIntent` (if within melee reach) or enters ranged attack resolution.
     - In `targeting.system.ts` (`processFireAimedIntent`), when Aim mode is confirmed without a special spell/order context (`context === undefined`), if the targeted tile contains a living actor (hostile, neutral, or friendly), execute a ranged weapon attack (if wielding a ranged weapon) or melee attack (if within reach) against that actor! Also allow `Shift+Tab` / `Tab` in Aim mode to cycle all visible actors when no hostile actors are in FOV.
   - **`shove` Verb, `immovable` Flag & Stationary Bull Rush (`apply.system.ts`, `movement_displacement.ts`, `bull_rush_resolver.ts`):**
     - Add `isEntityImmovable(state, entityId)` in `src/systems/movement_displacement.ts` checking:
       1. Template `immovable === true`
       2. `TagsComponent` / `TraitsComponent` / `PropertyOverlayComponent` / ruleset active tags containing `'immovable'` or `'trait:immovable'`.
     - Enforce `isEntityImmovable` inside `displaceEntityAlongVector` (returning `stopReason: 'solid_obstacle'` if immovable) and inside `shove`.
     - When `'shove'` is executed on an adjacent actor:
       - If `isEntityImmovable(state, targetId)` is true: log `"<Target> is immovable and cannot be shoved!"` and return `{ state, success: false }`.
       - If target is friendly/willing and not immovable: push target 1 square away along `(dx, dy)` (or swap places if the square behind them is blocked).
       - If target is hostile (or unwilling): delegate to `activeRuleset.resolveShove?.(state, sourceEntityId, targetId)` (or Console 1-tile opposed ATK vs DEF push fallback). In `dnd35e_ruleset.ts`, `resolveShove` invokes `resolveBullRushImpact(state, { attackerId: sourceEntityId, defenderId: targetId })`, which performs the opposed Strength + Size + `Improved Bull Rush` + Stability check and knocks the enemy back $1 + \lfloor\text{margin}/5\rfloor$ squares (including Dungeon Crasher wall-slam damage) while the attacker remains stationary!

---

### Milestone 192: Debug Mode Switch (`debugModeEnabled`) & 3-Tier Command/Keybind Overhaul (Console + Cartridges)

1. **`src/types/input.types.ts` & `src/core/settings.ts` — `CommandTier` & `debugModeEnabled`:**
   - Add `export type CommandTier = 'primary' | 'secondary' | 'tertiary';` and optional `readonly tier?: CommandTier | undefined;` + `readonly requiresDebugMode?: boolean | undefined;` to `CommandDefinition` in `src/types/input.types.ts`.
   - Add `debugModeEnabled?: boolean | undefined` (default `false`) to `PlayerSettings` in `src/core/settings.ts`, plus a **"Developer Debug Mode (Enable Debug Commands & God-Mode Toggles)"** switch in `<SettingsModal />`.
   - When `getSettings().debugModeEnabled !== true`:
     - `shortcut_input.ts` ignores `debug.reveal_map`, `debug.god_mode`, `debug.spawn_entity`, and `panel.debug`.
     - `CommandDockCard.tsx` hides the `Debug` dock button (`dock-btn-debug`).
     - `Automap3DModal.tsx` hides the `Reveal Unexplored (God Mode)` button unless `debugModeEnabled` or `GodModeComponent` is active.

2. **3-Tier Command & Keybind Revision (`src/core/input/command_catalog.ts`, `src/rendering/ui/hud_dock.ui.ts`, `dnd35e_ui_registration.tsx`, `classic_ui_registration.tsx`, `keybind_migration.ts`):**
   - Fix all stale Command Dock IDs in `src/rendering/ui/hud_dock.ui.ts`:
     - `dock-btn-aim`: `commandId: 'combat.target_toggle'`, `fallbackBadge: 'F'` (fixing the `Aim (R)` bug!).
     - `dock-btn-wait`: `commandId: 'action.wait'`, `fallbackBadge: 'Space'`.
     - `dock-btn-settings`: `commandId: 'system.escape_or_pause'`, `fallbackBadge: 'Esc'`.
   - Assign `tier: 'primary' | 'secondary' | 'tertiary'` across all Console and Cartridge commands and update default bindings:
     - **Primary (`tier: 'primary'`):**
       - Movement: `move.north/south/west/east/nw/ne/sw/se`, `move.up_z` (`<`), `move.down_z` (`>`), `action.wait` (`Space`)
       - World Interaction: `action.interact` (`E`, `.`, `,`), `action.pick_up` (`G`), `action.inspect` (`X`), `combat.target_toggle` (`F`), `combat.target_confirm` (`Enter`), `combat.target_next` (`Tab`), `combat.target_prev` (`Shift+Tab`), `action.verb_menu` (`V`, `Enter`)
       - Core Modals: `panel.inventory` (`I`), `panel.automap` (`M`), `classic:sheet` / `dnd35e:character_sheet` (`C`)
       - D&D 3.5e Core: `dnd35e:quickcast` (`Z`), `dnd35e:spellbook` (`B`), `dnd35e:rest_8h` (`R`)
     - **Secondary (`tier: 'secondary'`):**
       - Campaign Panels: `panel.quests` (`Q`), `dnd35e:level_up` (`U`), `panel.investigation` (`K`), `panel.factions` (`J` in `modern`, `Shift+Y` in `classic_vi`), `panel.dossier` (`N` in `modern`, `Shift+N` in `classic_vi`), `panel.ledger` (`Shift+L`), `panel.legends` (`Shift+H`)
       - Camera & Hotbar: `camera.peek_z_up` (`PageUp`, `[`), `camera.peek_z_down` (`PageDown`, `]`), `camera.peek_z_reset` (`Home`), `hotbar.bank_prev` (`Shift+ArrowUp`), `hotbar.bank_next` (`Shift+ArrowDown`), `hud.toggle_fold_all` (`\`), `hud.cycle_focus` (`F6`)
     - **Tertiary (`tier: 'tertiary'`):**
       - System: `system.toggle_help` (`F1`), `system.escape_or_pause` (`Esc`), `editor.*` (`Ctrl+Z`, `Ctrl+Y`, `Ctrl+S`, `F2`)
       - Debug (`requiresDebugMode: true`): `debug.reveal_map` (`Alt+R`), `debug.god_mode` (`Alt+G`), `debug.spawn_entity` (`Alt+E`), `panel.debug` (`Alt+\``)
   - Update `keybind_migration.ts` (`STOCK_V1_DEFAULT_VARIANTS`), `public/data/campaigns/*/keybinds.json`, `<HelpModal />` (displaying Primary / Secondary / Tertiary badges and hiding Debug commands when Debug Mode is off), and `<TacticalScannerCard />` help hint so zero keybind conflicts exist in either `modern` or `classic_vi` presets.

3. **Regression Tests, SSOT Sync & 8-Stage Verification (`tests/phase50_ux_languages_keybinds.test.tsx`, `verify.sh`):**
   - Add unit and Preact tests covering:
     - Two-pane `ModalShell` `scrollMode="panes"` class application & conditional Level-Up Feats tab (`totalFeatSlots === 0` vs `> 0`).
     - Top-bar `Z` coordinate rendering on single-Z and multi-Z maps.
     - `ContentSourceOriginSchema` (`judicious_spell` tagged `'homebrew'`), feat/skill fuzzy search, and category/attribute filter chips.
     - Digger door-framing validation (rejecting floating/adjacent procedural doors while preserving freestanding/adjacent portals).
     - Edge portal spawning (using archway/passage visuals rather than `stairs_down`).
     - Console language obfuscation & D&D 3.5e language comprehension (*Comprehend Languages*, *Tongues*, *Speak with Animals*, `Speak Language` ranks).
     - Look/Verb Menu `talk`, `attack`, `shove` verbs, `immovable` creature flag blocking shove/Bull Rush, and stationary D&D 3.5e Bull Rush knockback on enemies.
     - 3-Tier Command taxonomy, zero keybind conflicts across `modern` and `classic_vi`, `Aim (F)` dock badge, and `debugModeEnabled: false` gating of `Alt+R` Reveal Map.
   - Update `docs/ssot/ssot_console.json` and `docs/ssot/ssot_dnd35e.json`, run `bun scripts/map-codebase.ts`, regenerate `docs/CAMPAIGN_TOPOLOGIES.md` + `docs/campaign_atlas_3d.html`, and pass all 8 stages of `./verify.sh`.
