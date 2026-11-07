# Implementation Plan — D&D 3.5e Feature-Driven Progression & Tagged Companion Architecture (Milestone 119)

## 1. Audit of Hardcoded Data & Declarative Architecture Parity

Following the architectural review, we identified eight distinct places where gameplay data, progression rules, and class logic were hardcoded in TypeScript instead of being driven declaratively by the D&D 3.5e JSON content:

| System / File | Hardcoded Anti-Pattern | Data-Driven / Declarative Replacement |
| :--- | :--- | :--- |
| **1. Class Progression Constants** (`companions.ts` / `progression.ts`) | `RANGER_COMBAT_STYLE_LEVEL = 2`, `RANGER_ANIMAL_COMPANION_MIN_LEVEL = 4`, `ROGUE_SPECIAL_ABILITY_LEVELS = [10,13,16,19]`, `CLERIC_REQUIRED_DOMAIN_COUNT = 2` | **Zero Level Constants**: Derive directly from class progression features (`progression[lvl - 1].features`) after applying active ACF swaps. E.g. prompt for Animal Companion when gaining a feature with `scalingPoolContribution.poolId === 'animal_companion_effective_level'`. |
| **2. Class ID Branching** (`character_builder.ts`, `builder_validation.ts`, `builder_levelup_validation.ts`, UI) | `if (classDef.id === 'cleric')`, `if (classDef.id === 'ranger')`, `if (classDef.id === 'wizard')`, `if (classDef.id === 'druid')` | **Feature-Driven Predicates**: Check active features (`features.includes('deity_domains')`, `features.includes('combat_style')`, `scalingPoolContribution.poolId === 'familiar_master_effective_level'`). Supports ACFs, homebrew, and prestige classes seamlessly. |
| **3. Companion Stat Formulas** (`companions.ts`) | `ANIMAL_BAB_MULTIPLIER = 0.75`, `COMPANION_HP_PER_BONUS_HD = 5`, `FAMILIAR_BASE_AC = 14`, ad-hoc AC math | **4-Stage Stat DAG (`evaluateDnD35ActorStatDAG`)**: Advance companion's racial HD track by `bonusHd`, adjust natural armor and abilities on `DnD35EntityData`, and evaluate DAG. Familiar gets `max(dag.attack, masterBab)` and `max(dag.maxHp, floor(masterHp / 2))`. |
| **4. Companion Advancement Tables** (`companions.ts`) | `computeAnimalCompanionAdvancement` and `computeFamiliarAdvancement` hardcoded math | Keep pure progression tables parameterized by effective level pools (`animal_companion_effective_level`, `familiar_master_effective_level`) with future JSON migration path. |
| **5. Favored Enemy Skills & Step** (`ledger_choices.ts`, `builder_hydrator_creation.ts`) | `FAVORED_ENEMY_SKILLS = ['bluff', 'listen', ...]` and `FAVORED_ENEMY_BONUS_STEP = 2` hardcoded in TS | Derive skill list and initial bonus from `featureDetails.favored_enemy_1.modifiers` in `ranger.json` (or canonical `DEFAULT_FAVORED_ENEMY_BONUS = 2`). |
| **6. Rogue Special Abilities** (`dnd35e_level_up_class_options.ui.ts`) | Hardcoded `ROGUE_SPECIAL_ABILITIES` array in UI component | Derive from `featureDetails.rogue_special_ability_1.bonusFeatPool` or `sys.feats` tagged with `pool:rogue_special_abilities`. |
| **7. Favored Enemy Candidates** (`dnd35e_level_up_class_options.ui.ts`, `dnd35e_char_builder_class_options.ui.ts`) | Only `Object.keys(sys.creatureTypes)` without subtypes | Derive from `sys.creatureTypes` + `sys.subtypes` (e.g. `type:undead`, `subtype:goblinoid`, `subtype:orc`, `subtype:elf`). |
| **8. Familiar Effect Bundles** (`races.json`) | Familiar modifiers using `{ sourceId, targetStat, bonusType, sourcePath }` violating `DnD35DeclarativeModifierSchema` | Update all familiars in `races.json` to `{ id, target, value, type: "untyped" }` and evaluate with `evaluateEffectBundle`. |

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Old Brain (To Evict) | Canonical Owner (New Brain) |
| :--- | :--- | :--- |
| **Controller Link Relationships** | Hardcoded `relationship: 'companion' \| 'familiar' \| ...` | Tier 1 Console `ControllerLinkComponent.tags: ReadonlyArray<string>` (`actor_components.types.ts`) |
| **Bonded Companions State** | `dndData.animalCompanionId`, `dndData.familiarId` | Tier 2 Cartridge `dndData.companions: ReadonlyArray<DnD35CompanionEntry>` with multi-role tags |
| **Companion Mechanics & Spawning** | Deleted `companion_data.ts` & ad-hoc formulas in `companions.ts` | `companions.ts` using `evaluateDnD35ActorStatDAG` |
| **Familiar Master Grants** | Ad-hoc modifier assembly in `ledger_choices.ts` | `evaluateEffectBundle` in `ledger_choices.ts` reading `famRace.masterEffectBundle` |
| **Class Progression Validation** | Hardcoded level constants (`RANGER_*`, `ROGUE_*`, `CLERIC_*`) | Feature-presence checks in `builder_validation.ts` & `builder_levelup_validation.ts` |
| **Class Options UI Rendering** | Hardcoded `classId === '...'` in `dnd35e_char_builder_class.ui.ts` & `dnd35e_level_up_class_options.ui.ts` | Active feature inspection from `classDef.progression[level - 1]` with ACF substitutions |

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Data / Schemas) | Downstream (Consumers / Validators / DAG / UI) | Lateral (Sibling JSONs / Docs / Mirrors) |
| :--- | :--- | :--- | :--- |
| **1. Declarative Modifiers in `races.json` & `evaluateEffectBundle`** | `public/data/rulesets/dnd35e/races.json`, `DnD35RaceDefinitionSchema` | `collectClassChoiceFeats`, `buildClassChoiceModifiers`, `rebuildActorStateFromLevelHistory`, `run-validator.ts` | `dnd35e_char_builder_class_options.ui.ts` (`.target`) |
| **2. Feature-Driven Choice Checks (Zero Level Constants)** | Class JSONs (`ranger.json`, `cleric.json`, `rogue.json`, `druid.json`, `wizard.json`) | `builder_validation.ts`, `builder_levelup_validation.ts`, `character_builder.ts`, `level_ledger.ts`, `dnd35e_char_builder_class.ui.ts`, `dnd35e_level_up_class_options.ui.ts` | Removes all imports of deleted `companion_data.ts` and progression level constants |
| **3. Tagged `companions` Array + 4-Stage Stat DAG** | `CharacterCreationDraft`, `LevelUpChoice`, `DnD35CharacterLevelRecord`, `rebuildActorStateFromLevelHistory` | `syncActorCompanionsAndFamiliars`, `evaluateDnD35ActorStatDAG`, `ControllerLinkComponent.tags`, `projectDnD35ActorSemanticTags` | `tests/dnd35e_char_builder.test.ts`, `tests/dnd35e_level_ledger.test.ts` |
| **4. Data-Driven UI Pickers** | `sys.races`, `sys.creatureTypes`, `sys.subtypes`, `sys.items`, `sys.feats` | Character Creation & Level-Up modals | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |

---

## 4. Step-by-Step Implementation Flow

### Step 1: Finish `races.json` & UI Modifier Schema Fixes
- Ensure all 9 familiars (`bat`, `cat`, `hawk`, `owl`, `rat`, `raven`, `viper`, `toad`, `weasel`) in [`races.json`](file:///d:/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/races.json) use `DnD35DeclarativeModifierSchema` (`{ id, target, value, type: "untyped" }`).
- In [`dnd35e_char_builder_class_options.ui.ts`](file:///d:/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_char_builder_class_options.ui.ts), read `.target` instead of `.targetStat`.

### Step 2: Feature-Driven Refactoring in `ledger_choices.ts`
- Remove all imports of level constants from `ledger_choices.ts`.
- Accept `activeFeatures: ReadonlyArray<string>` and `companions: ReadonlyArray<DnD35CompanionEntry>`.
- Combat style feats granted when:
  - `activeFeatures.includes('combat_style')` $\to$ `rapid_shot` or `two_weapon_fighting`
  - `activeFeatures.includes('improved_combat_style')` $\to$ `manyshot` or `improved_two_weapon_fighting`
  - `activeFeatures.includes('combat_style_mastery')` $\to$ `improved_precise_shot` or `greater_two_weapon_fighting`
- Familiar master bonuses evaluated via canonical `evaluateEffectBundle(famRace.masterEffectBundle, 'familiar:' + comp.raceId, activeTags)`.

### Step 3: Pure 4-Stage Stat DAG for Companions in `companions.ts`
- Remove all 8 class progression constants and hardcoded stat formulas from `companions.ts`.
- Fix `getDnD35SystemContent(nextState.campaign)`.
- In `syncSingleCompanionEntry`:
  - Advance the companion's racial HD track by `bonusHd`.
  - Apply `totalNatArmor` and STR/DEX bonuses to `scaledData`.
  - Call `evaluateDnD35ActorStatDAG` to compute true HP, Attack, and AC.
  - Familiar scales HP to `max(dag.maxHp, floor(masterHp / 2))` and attack to `max(dag.attack, masterBab)`.
- In `upsertLinkedServantActor`, update `link.tags` when an existing companion entity is modified.
- Keep file length strictly $\le 260$ lines.

### Step 4: Feature-Driven Character Builder & Validation
- In `character_builder.ts`:
  - Determine active level 1 features from `classDef.progression[0].features` and `selectedAcfs`.
  - Keep domains if active features include `"deity_domains"`.
  - Keep familiar if active features include a feature with `poolId === 'familiar_master_effective_level'`.
  - Keep companion if active features include a feature with `poolId === 'animal_companion_effective_level'`.
- In `builder_validation.ts` and `builder_levelup_validation.ts`:
  - Remove all dangling `companion_data.ts` imports.
  - Derive required choices at `nextClassLevel` by inspecting that level's features:
    - Feature `"combat_style"` $\to$ validate `choice.combatStyle`.
    - Feature matching `/^favored_enemy_([2-9]|\d{2,})$/` $\to$ validate `choice.favoredEnemyAdded` and `choice.favoredEnemyBoosted`.
    - Feature with `poolId === 'animal_companion_effective_level'` $\to$ validate `choice.animalCompanionId`.
    - Feature with `bonusFeatPool` or starting with `"rogue_special_ability_"` $\to$ validate `choice.rogueSpecialAbility`.

### Step 5: Feature-Driven UI Panels
- In `dnd35e_char_builder_class.ui.ts`:
  - Inspect active level 1 features instead of `draftState.classId === '...'`.
  - Render Cleric domains if active features have `"deity_domains"`.
  - Render Arcane schools if active features have `"arcane_school_specialization"`.
  - Render Familiar if active features have `familiar_master_effective_level`.
  - Render Animal Companion if active features have `animal_companion_effective_level`.
  - Render Favored Enemy if active features have `"favored_enemy_1"`.
- In `dnd35e_level_up_class_options.ui.ts`:
  - Inspect gained features at `nextClassLevel` (with ACF swaps applied).
  - Dynamically render Combat Style, Favored Enemy upgrade, Animal Companion, or Rogue Special Ability based on the gained features.
  - Derive Rogue special abilities from `activeCls.featureDetails` or `sys.feats`.

### Step 6: SSOT Registries & 8-Stage Verification
- Update `docs/ssot/ssot_dnd35e.json`.
- Run `bun scripts/map-codebase.ts` to regenerate SSOT docs.
- Run `.\verify.bat` and fix any stage failures until all 8 stages pass with 0 errors.
