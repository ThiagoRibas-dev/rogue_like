# Research Notes — Milestone 119: Feature-Driven Progression & Tagged Companion Architecture

## 1. Objective & Architectural Mandate
Per `AGENTS.md` Rules 12, 16, 17, 18, 19, and 20, baseline ruleset resolvers, character builders, and UI projections must never hardcode `if (classId === 'druid')`, `if (level === 2)`, or magic progression arrays (`RANGER_FAVORED_ENEMY_UPGRADE_LEVELS = [5, 10, 15, 20]`). Instead:
- **Progression Choices & Grants** must derive strictly from active class features (`getClassActiveFeaturesUpToLevel(classDef, classLevel, acfIds)`), feature prefixes (`favored_enemy_`, `rogue_special_ability_`, `cleric_domains`, `arcane_school_specialization`, `combat_style`, `improved_combat_style`, `combat_style_mastery`), and `scalingPoolContribution` metadata (`animal_companion_effective_level`, `familiar_master_effective_level`).
- **Alternate Class Features (ACFs)** that replace a baseline feature automatically suppress the replaced feature's UI picker, validation requirement, and mechanical grant without custom `if (acfId === ...)` branches.
- **Companion / Servant Synchronization** must operate over a generic, tag-driven `companions: ReadonlyArray<DnD35CompanionEntry>` registry (`tags: ['animal_companion', 'familiar', ...]`) and evaluate servant stats through the canonical 4-stage Stat DAG (`evaluateDnD35ActorStatDAG`) rather than manual HP/BAB/AC arithmetic.

---

## 2. Audit of Hardcoded Progression Constants & Class-ID Branches

| File | Current Hardcoding / Issue | Declarative Replacement |
| :--- | :--- | :--- |
| `src/rulesets/dnd35e/companions.ts` | Exports 7 hardcoded progression constants (`RANGER_COMBAT_STYLE_LEVEL`, `RANGER_IMPROVED_COMBAT_STYLE_LEVEL`, `RANGER_COMBAT_STYLE_MASTERY_LEVEL`, `RANGER_ANIMAL_COMPANION_MIN_LEVEL`, `RANGER_FAVORED_ENEMY_UPGRADE_LEVELS`, `ROGUE_SPECIAL_ABILITY_LEVELS`, `CLERIC_REQUIRED_DOMAIN_COUNT`); duplicates `animalCompanionId` and `familiarId` syncing; computes HP/BAB/AC manually (304 lines, exceeding 300-line limit). | Evict all 7 progression constants. Iterate over unified `companions: ReadonlyArray<DnD35CompanionEntry>`, stack bonuses per `tag` (`animal_companion`, `familiar`) from `scalingPools`, and compute servant stats via `evaluateDnD35ActorStatDAG`. |
| `src/rulesets/registry.ts` | Re-exports the 7 evicted progression constants from `companions.ts`. | Remove the 7 evicted progression constants from `registry.ts` (keep `RANGER_FAVORED_ENEMY_BONUS_STEP` and `WIZARD_DIVINATION_PROHIBITED_COUNT`). |
| `src/rulesets/dnd35e/progression/ledger_choices.ts` | `collectClassChoiceFeats` checks `track.classId === 'ranger' && track.level >= RANGER_COMBAT_STYLE_LEVEL` (and `6`, `11`) and `familiarId !== undefined` directly. | Check active features (`hasCombatStyle`, `hasImprovedCombatStyle`, `hasCombatStyleMastery`) from `getClassActiveFeaturesUpToLevel`, and check `familiar_master_effective_level > 0` before reading `familiarData.masterEffectBundle`. |
| `src/rulesets/dnd35e/builder/builder_prereq_context.ts` | Calls `collectClassChoiceFeats(nextTracks, ...)` using the old signature (`line 123`). | Pass `sys.classes` and `data.companions` to the updated `collectClassChoiceFeats` signature. |
| `src/rulesets/dnd35e/builder/builder_validation.ts` | Branches on `draft.classId === 'cleric'`, `'wizard'`, `'druid'`, `'ranger'` at creation. Misses Sorcerer `summon_familiar` and does not suppress validation if an ACF swaps out a feature (e.g. `wizard_abrupt_jaunt_1` replacing `summon_familiar`). | Inspect active level-1 features via `getClassActiveFeaturesUpToLevel(classDef, 1, draft.selectedAcfIds)` (`cleric_domains`, `arcane_school_specialization`, `favored_enemy_1`, and `scalingPoolContribution.poolId`). |
| `src/rulesets/dnd35e/builder/builder_levelup_validation.ts` | Uses `RANGER_COMBAT_STYLE_LEVEL`, `RANGER_ANIMAL_COMPANION_MIN_LEVEL`, `RANGER_FAVORED_ENEMY_UPGRADE_LEVELS`, `ROGUE_SPECIAL_ABILITY_LEVELS` and `choice.classId === 'ranger' \| 'rogue'`. | Inspect `newFeatures` at `newClassLevel` (`currFeatures.filter(f => !prevFeatures.includes(f))`) for `combat_style`, `favored_enemy_*`, `rogue_special_ability_*`, and `scalingPoolContribution.poolId === 'animal_companion_effective_level'` transition from `0` to `> 0`. |
| `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts` & `level_ledger.ts` | Hydrates only `animalCompanionId` and `familiarId` strings on `DnD35ActorRulesetData`. | Hydrate `companions: ReadonlyArray<DnD35CompanionEntry>` (`tags: ['animal_companion']`, `['familiar']`, or merged tags when both point to the same companion) alongside backward-compatible `animalCompanionId` / `familiarId`. |
| `src/rendering/ui/dnd35e_char_builder_class.ui.ts` & `dnd35e_char_builder_class_options.ui.ts` | Branches on `draftState.classId === 'cleric' \| 'wizard' \| 'druid' \| 'ranger'`. Sorcerer never sees the Familiar picker; selecting Wizard's `wizard_abrupt_jaunt_1` ACF does not hide the Familiar picker. | Gate sub-option panels by active level-1 features (`cleric_domains`, `arcane_school_specialization`, `favored_enemy_*`, `animal_companion_effective_level`, `familiar_master_effective_level`). Split `renderWizardOptions` into `renderArcaneSchoolOptions` + `renderFamiliarOptions`. Clear invalidated draft choices when an ACF toggle replaces their gating feature. |
| `src/rendering/ui/dnd35e_level_up_class.ui.ts` & `dnd35e_level_up_class_options.ui.ts` | Uses `RANGER_COMBAT_STYLE_LEVEL`, `RANGER_FAVORED_ENEMY_UPGRADE_LEVELS`, `RANGER_ANIMAL_COMPANION_MIN_LEVEL`, `ROGUE_SPECIAL_ABILITY_LEVELS`, and hardcoded `ROGUE_SPECIAL_ABILITIES` array. | Gate level-up sub-option pickers by newly unlocked active features at `nextClassLevel` and read Rogue special ability options from `featureDetails[featId].bonusFeatPool`. |

---

## 3. Newly Uncovered Gaps from Deep Audit

1. **Gap 1 — Duplicate Static Modifier Bug in `public/data/rulesets/dnd35e/classes/ranger.json`**:
   - `ranger.json` lines 50–65 currently attach a static modifier (`sourceId: "favored_enemy_1"`, `targetStat: "strike_damage"`, `value: 2`, `targetTagsAny: ["subtype:orc", "subtype:goblinoid", "type:undead", "type:magical_beast", "type:dragon"]`) directly to `featureDetails.favored_enemy_1`.
   - Because `buildClassAndDomainEffectModifiers` in `ledger_modifiers.ts` collects all modifiers in `featureDetails` and `buildClassChoiceModifiers` in `ledger_choices.ts` *also* emits dynamic modifiers for `favoredEnemies`, every Ranger currently gets an extra unconditional +2 damage against those 5 creature types regardless of their actual Favored Enemy choice!
   - Furthermore, `ranger.json` `featureDetails` was missing definitions for `improved_combat_style` and `combat_style_mastery`.
   - **Fix**: Remove the static `modifiers` array from `favored_enemy_1` in `ranger.json` and add `improved_combat_style` and `combat_style_mastery` entries to `featureDetails`.

2. **Gap 2 — Legacy `weasel` Familiar Shape in `public/data/rulesets/dnd35e/races.json`**:
   - In `races.json`, 8 of the 9 familiars (`bat`, `cat`, `hawk`, `owl`, `rat`, `raven`, `viper`, `toad`) use `{ id, target, value, type: "untyped" }`, whereas **`weasel` (lines 349–361)** still uses `{ sourceId: "familiar_weasel_ref", targetStat: "save_ref", value: 2, bonusType: "untyped", sourcePath: "familiar:weasel" }`.
   - Also, all 9 familiars' `masterEffectBundle` entries omit `"name"` and `"category": "ex"` and store `virtualFeatGrants` as `["alertness"]` instead of `[{ "featId": "alertness", "ignorePrerequisites": true }]`.
   - **Fix**: Normalize all 9 familiar `masterEffectBundle` objects in `races.json` to the strict `DnD35EffectBundle` schema (`bundleId`, `name`, `category: "ex"`, `modifiers: [{ id, target, value, type: "untyped" }]`, `virtualFeatGrants: [{ featId: "alertness", ignorePrerequisites: true }]`).

3. **Gap 3 — Data-Driven `bonusFeatPool` for Rogue Special Abilities in `public/data/rulesets/dnd35e/classes/rogue.json`**:
   - `rogue.json` grants `rogue_special_ability_1..4` at levels 10, 13, 16, 19, but `featureDetails` only defined `rogue_special_ability_1` without a `bonusFeatPool`, forcing `dnd35e_level_up_class_options.ui.ts` to hardcode `ROGUE_SPECIAL_ABILITIES`.
   - **Fix**: Add `bonusFeatPool: ["crippling_strike", "defensive_roll", "improved_evasion", "opportunist", "skill_mastery", "slippery_mind"]` to `rogue_special_ability_1..4` and add metadata entries for those 6 abilities in `rogue.json`'s `featureDetails` so both UI rendering and level-up validation derive 100% from `rogue.json`.

4. **Gap 4 — `cleric_domains` Feature in `public/data/rulesets/dnd35e/classes/cleric.json`**:
   - `cleric.json` level 1 `progression` only lists `["turn_undead", "aura"]`, so there was no level-1 feature ID indicating that the class grants 2 divine domains.
   - **Fix**: Add `"cleric_domains"` to `cleric.json` `featureDetails` and level-1 `progression.features`.

5. **Gap 5 — Sorcerer Familiar Picker & Wizard Abrupt Jaunt ACF Reactivity**:
   - Splitting `renderWizardOptions` into `renderArcaneSchoolOptions` (gated by `arcane_school_specialization`) and `renderFamiliarOptions` (gated by any level-1 feature contributing to `familiar_master_effective_level`) automatically enables the Familiar picker for **Sorcerers** at creation and automatically hides/clears `familiarId` when a Wizard enables the **Abrupt Jaunt** ACF (`wizard_abrupt_jaunt_1`, which replaces `summon_familiar`).

6. **Gap 6 — `builder_prereq_context.ts`, `registry.ts`, and `docs/ssot/ssot_dnd35e.json` Cascades**:
   - Updating `collectClassChoiceFeats` requires updating its caller in `src/rulesets/dnd35e/builder/builder_prereq_context.ts`.
   - Removing the 7 constants from `companions.ts` requires removing their re-exports in `src/rulesets/registry.ts` and updating `docs/ssot/ssot_dnd35e.json` + regenerating `docs/SSOT_DND35E.md`.

---

## 4. Cascading Effects Matrix

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Validators / Renderers) | Lateral (Sibling JSONs / Registries / Tests) |
| :--- | :--- | :--- | :--- |
| **1. Normalize `masterEffectBundle` in `races.json` & strict `DnD35EffectBundleSchema`** | `public/data/rulesets/dnd35e/races.json` (all 9 familiars including `weasel`) | `DnD35RaceSchema` (`character_progression.types.ts`), `collectClassChoiceFeats` (`ledger_choices.ts`), `buildClassAndDomainEffectModifiers` (`ledger_modifiers.ts`), `unrollEffectBundleToModifiers` (`effect_bundle.ts`) | `scripts/run-validator.ts` |
| **2. Enrich `cleric.json`, `ranger.json`, `rogue.json` features** | `cleric.json` (`cleric_domains`), `ranger.json` (remove static `favored_enemy_1` modifier, add `improved_combat_style`, `combat_style_mastery`), `rogue.json` (`rogue_special_ability_1..4` with `bonusFeatPool` + ability `featureDetails`) | `builder_validation.ts`, `builder_levelup_validation.ts`, `ledger_choices.ts`, `dnd35e_char_builder_class*.ui.ts`, `dnd35e_level_up_class*.ui.ts` | `wizard.json`, `sorcerer.json`, `druid.json` (already have `summon_familiar` / `animal_companion`) |
| **3. Feature-driven `collectClassChoiceFeats` (`ledger_choices.ts`)** | `rebuildActorStateFromLevelHistory` (`level_ledger.ts`), `buildPostLevelUpPrerequisiteContext` (`builder_prereq_context.ts`), `hydrateDnD35ActorFromBuilder` (`builder_hydrator_creation.ts`) | Actor `feats` list, prerequisite checks, combat style virtual feats (`rapid_shot`, `manyshot`, `improved_precise_shot`, `two_weapon_fighting`, `improved_two_weapon_fighting`, `greater_two_weapon_fighting`), familiar `alertness` grant | `tests/dnd35e_char_builder.test.ts` |
| **4. Evict 7 hardcoded level/count constants from `companions.ts` & `registry.ts`** | `companions.ts`, `src/rulesets/registry.ts` | `builder_validation.ts`, `builder_levelup_validation.ts`, `ledger_choices.ts`, `dnd35e_char_builder_class*.ui.ts`, `dnd35e_level_up_class*.ui.ts` | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |
| **5. Tagged `companions: ReadonlyArray<DnD35CompanionEntry>` & DAG evaluation (`companions.ts`)** | `builder_hydrator_creation.ts`, `builder_hydrator_levelup.ts`, `level_ledger.ts` | `syncActorCompanions` (`companions.ts`), `evaluateDnD35ActorStatDAG` (`dag_resolver.ts`), `ControllerLinkComponent` (`ecs.types.ts`) | `tests/dnd35e_char_builder.test.ts` |
