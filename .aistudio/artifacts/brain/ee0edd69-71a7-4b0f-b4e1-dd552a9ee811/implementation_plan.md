# Implementation Plan — Milestone 119: Feature-Driven Progression & Tagged Companion Architecture

## 1. Architectural Goal & Audit Summary
Replace all remaining hardcoded class-ID checks (`draft.classId === 'druid'`, `choice.classId === 'ranger'`, `track.classId === 'rogue'`) and magic progression constants (`RANGER_COMBAT_STYLE_LEVEL`, `RANGER_FAVORED_ENEMY_UPGRADE_LEVELS`, `ROGUE_SPECIAL_ABILITY_LEVELS`, `RANGER_ANIMAL_COMPANION_MIN_LEVEL`, `CLERIC_REQUIRED_DOMAIN_COUNT`) with **100% declarative feature & scaling-pool inspection**, and unify companion/familiar synchronization through a **tag-driven `companions` registry evaluated by the 4-Stage Stat DAG (`evaluateDnD35ActorStatDAG`)**.

### Audit of Hardcoded Checks & Declarative Replacements

| Area | Current Hardcoding / Issue | Declarative Replacement |
| :--- | :--- | :--- |
| **JSON Data (`races.json`, `cleric.json`, `ranger.json`, `rogue.json`)** | 1) `weasel` in `races.json` uses legacy `{ sourceId, targetStat, bonusType }` and all 9 familiars lack `name`/`category` and object-form `virtualFeatGrants`.<br>2) `cleric.json` lacks a `cleric_domains` feature ID at level 1.<br>3) `ranger.json` has a buggy static `+2 damage` modifier on `favored_enemy_1` against 5 hardcoded creature types and omits `improved_combat_style` / `combat_style_mastery` from `featureDetails`.<br>4) `rogue.json` omits `bonusFeatPool` on `rogue_special_ability_1..4`. | 1) Normalize all 9 familiar `masterEffectBundle` objects in `races.json` to strict `DnD35EffectBundle` format.<br>2) Add `cleric_domains` to `cleric.json` level 1.<br>3) Remove static `modifiers` from `favored_enemy_1` in `ranger.json` and add `improved_combat_style` & `combat_style_mastery` to `featureDetails`.<br>4) Add `bonusFeatPool: ["crippling_strike", "defensive_roll", "improved_evasion", "opportunist", "skill_mastery", "slippery_mind"]` + `featureDetails` entries to `rogue.json`. |
| **Combat Style & Familiar Feats (`ledger_choices.ts`, `builder_prereq_context.ts`)** | `collectClassChoiceFeats` checks `track.classId === 'ranger' && track.level >= 2 / 6 / 11` and checks `familiarId !== undefined` without verifying `familiar_master_effective_level > 0`. | Inspect active features (`combat_style`, `improved_combat_style`, `combat_style_mastery`) via `getClassActiveFeaturesUpToLevel`, and check `familiar_master_effective_level > 0` before granting `familiarData.masterEffectBundle.virtualFeatGrants`. Update callers in `level_ledger.ts`, `builder_prereq_context.ts`, and `builder_hydrator_creation.ts`. |
| **Creation & Level-Up Validation (`builder_validation.ts`, `builder_levelup_validation.ts`)** | Hardcodes `draft.classId === 'cleric' \| 'wizard' \| 'druid' \| 'ranger'` and level constants (`2`, `4`, `[5,10,15,20]`, `[10,13,16,19]`). | Inspect active features at level 1 (`builder_validation.ts`) and newly unlocked features at `newClassLevel` (`builder_levelup_validation.ts`): `cleric_domains`, `arcane_school_specialization`, `combat_style`, `favored_enemy_*`, `rogue_special_ability_*`, and `scalingPoolContribution.poolId` transitions (`0 -> >0`). |
| **Character Creation & Level-Up UI (`dnd35e_char_builder_class*.ui.ts`, `dnd35e_level_up_class*.ui.ts`)** | Hardcodes `draftState.classId` branches and level constants; Sorcerer lacks Familiar picker; Wizard Abrupt Jaunt ACF does not hide Familiar picker; Rogue special abilities hardcoded in UI. | Gate all sub-option panels by active class features & `scalingPoolContribution.poolId`. Split `renderWizardOptions` into `renderArcaneSchoolOptions` + `renderFamiliarOptions`. Clear invalidated draft choices on ACF toggle. Read Rogue special abilities from `featureDetails[featId].bonusFeatPool`. |
| **Companion Sync & Stat Calculation (`companions.ts`, `builder_hydrator_*.ts`, `level_ledger.ts`)** | Separate `animalCompanionId` / `familiarId` sync blocks; manual HP/BAB/AC math; 304 lines (> 300 limit). | Hydrate `companions: ReadonlyArray<DnD35CompanionEntry>` (`tags: ['animal_companion' \| 'familiar']`). Stack progression bonuses per tag in `syncActorCompanions` and compute servant stats via `evaluateDnD35ActorStatDAG`. |

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Old-Brain / Duplicate Location (To Evict) | Canonical SSOT Owner |
| :--- | :--- | :--- |
| Class feature progression levels (Combat Style, Favored Enemy, Rogue Special Abilities, Animal Companion unlock, Cleric Domains) | `RANGER_COMBAT_STYLE_LEVEL`, `RANGER_IMPROVED_COMBAT_STYLE_LEVEL`, `RANGER_COMBAT_STYLE_MASTERY_LEVEL`, `RANGER_ANIMAL_COMPANION_MIN_LEVEL`, `RANGER_FAVORED_ENEMY_UPGRADE_LEVELS`, `ROGUE_SPECIAL_ABILITY_LEVELS`, `CLERIC_REQUIRED_DOMAIN_COUNT` in `src/rulesets/dnd35e/companions.ts` & `src/rulesets/registry.ts` | `public/data/rulesets/dnd35e/classes/*.json` (`progression` & `featureDetails`) queried via `getClassActiveFeaturesUpToLevel` (`src/rulesets/dnd35e/progression/class_features_xp.ts`) |
| Rogue Special Ability option pool & labels | `ROGUE_SPECIAL_ABILITIES` hardcoded array in `src/rendering/ui/dnd35e_level_up_class_options.ui.ts` | `public/data/rulesets/dnd35e/classes/rogue.json` (`featureDetails.rogue_special_ability_*.bonusFeatPool` & `featureDetails`) |
| Ranger Favored Enemy damage & skill modifiers | Duplicate static `modifiers` on `favored_enemy_1` in `public/data/rulesets/dnd35e/classes/ranger.json` | `buildClassChoiceModifiers` in `src/rulesets/dnd35e/progression/ledger_choices.ts` |
| Companion & Familiar stat calculation (HP, AC, BAB, Saves, Ability Mods) | Manual arithmetic in `upsertLinkedServantActor` (`src/rulesets/dnd35e/companions.ts`) | `evaluateDnD35ActorStatDAG` (`src/rulesets/dnd35e/modifiers/dag_resolver.ts`) |

---

## 3. Cascading Effects Matrix

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Validators / Renderers) | Lateral (Sibling JSONs / Registries / Tests) |
| :--- | :--- | :--- | :--- |
| **Step 1: JSON Data Normalization (`races.json`, `cleric.json`, `ranger.json`, `rogue.json`)** | `public/data/rulesets/dnd35e/races.json`, `classes/cleric.json`, `classes/ranger.json`, `classes/rogue.json` | `DnD35EffectBundleSchema` (`effect_system.types.ts`), `ledger_choices.ts`, `ledger_modifiers.ts`, `builder_validation.ts`, `builder_levelup_validation.ts`, UI class option views | `scripts/run-validator.ts` |
| **Step 2: Feature-Driven `ledger_choices.ts` & `builder_prereq_context.ts`** | `level_ledger.ts`, `builder_prereq_context.ts`, `builder_hydrator_creation.ts` | `collectClassChoiceFeats`, `buildClassChoiceModifiers`, actor `feats` & `modifiers` arrays | `tests/dnd35e_char_builder.test.ts` |
| **Step 3: Feature-Driven Validation & Tagged Companion Hydration (`builder_*.ts`, `level_ledger.ts`)** | `character_builder.ts`, `level_ledger.ts` | `validateCharacterCreationDraft`, `validateLevelUpChoice`, `hydrateDnD35ActorFromBuilder`, `applyDnD35LevelUp`, `rebuildActorStateFromLevelHistory` | `src/rulesets/dnd35e/types/data/actor_data.types.ts` |
| **Step 4: Tagged Companion Sync & Stat DAG Evaluation (`companions.ts`, `registry.ts`)** | `builder_hydrator_creation.ts`, `builder_hydrator_levelup.ts`, `dnd35e/index.ts` | `syncActorCompanions`, `evaluateDnD35ActorStatDAG`, `ControllerLinkComponent` (`tags`) | `src/rulesets/registry.ts`, `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |
| **Step 5: Feature-Reactive Class Options UI (`dnd35e_char_builder_class*.ui.ts`, `dnd35e_level_up_class*.ui.ts`)** | `dnd35e_char_builder.ui.ts`, `dnd35e_level_up.ui.ts` | DOM rendering for Cleric Domains, Wizard Arcane School, Wizard/Sorcerer Familiar (ACF-reactive), Druid Animal Companion (ACF-reactive), Ranger Favored Enemy / Combat Style / Companion, Rogue Special Abilities | `docs/ssot/ssot_console.json` (verified clean) |

---

## 4. Step-by-Step Implementation Details & Code Diffs

### Step 1: Normalize JSON Data (`races.json`, `cleric.json`, `ranger.json`, `rogue.json`) & Strict `effect_system.types.ts`

1. **`public/data/rulesets/dnd35e/races.json`**:
   - Normalize all 9 familiar `masterEffectBundle` definitions (`bat`, `cat`, `hawk`, `owl`, `rat`, `raven`, `viper`, `toad`, and `weasel`) to the canonical `DnD35EffectBundle` schema:
     ```json
     "masterEffectBundle": {
       "bundleId": "familiar_weasel",
       "name": "Familiar Master Bonus (Weasel)",
       "category": "ex",
       "modifiers": [
         {
           "id": "familiar_weasel_ref",
           "target": "save_ref",
           "value": 2,
           "type": "untyped"
         }
       ],
       "virtualFeatGrants": [
         {
           "featId": "alertness",
           "ignorePrerequisites": true
         }
       ]
     }
     ```
2. **`src/rulesets/dnd35e/types/system/effect_system.types.ts`**:
   - Remove the temporary `.union(...)` fallback transforms on `DnD35DeclarativeModifierSchema`, `DnD35VirtualFeatGrantSchema`, and `DnD35EffectBundleSchema` now that `races.json` and `war.json` are 100% normalized.
3. **`public/data/rulesets/dnd35e/classes/cleric.json`**:
   - Add `"cleric_domains"` to `featureDetails` and level-1 `progression.features`.
4. **`public/data/rulesets/dnd35e/classes/ranger.json`**:
   - Remove the static `modifiers` array from `featureDetails.favored_enemy_1`.
   - Add `improved_combat_style` and `combat_style_mastery` to `featureDetails`.
5. **`public/data/rulesets/dnd35e/classes/rogue.json`**:
   - Add `"bonusFeatPool": ["crippling_strike", "defensive_roll", "improved_evasion", "opportunist", "skill_mastery", "slippery_mind"]` to `rogue_special_ability_1`, and add `rogue_special_ability_2`, `rogue_special_ability_3`, `rogue_special_ability_4` plus the 6 ability entries (`crippling_strike`, `defensive_roll`, `improved_evasion`, `opportunist`, `skill_mastery`, `slippery_mind`) to `featureDetails`.

---

### Step 2: Feature-Driven `ledger_choices.ts` & `builder_prereq_context.ts`

In `src/rulesets/dnd35e/progression/ledger_choices.ts`:
- Remove `RANGER_COMBAT_STYLE_LEVEL`, `RANGER_IMPROVED_COMBAT_STYLE_LEVEL`, `RANGER_COMBAT_STYLE_MASTERY_LEVEL` imports.
- Update `collectClassChoiceFeats` to accept `activeFeatures: ReadonlyArray<string>` and `scalingPools: Readonly<Record<string, number>>` (or compute active features from `tracks`, `classes`, `selectedAcfIds`):
  ```typescript
  export function collectClassChoiceFeats(
    activeFeatures: ReadonlyArray<string>,
    combatStyle: 'archery' | 'two_weapon' | undefined,
    rogueSpecialAbilities: ReadonlyArray<string> | undefined,
    familiarId: string | undefined,
    companions: ReadonlyArray<DnD35CompanionEntry> | undefined,
    scalingPools: Readonly<Record<string, number>>,
    races: Readonly<Record<string, DnD35Race>>,
  ): ReadonlyArray<string>
  ```
- Grant Combat Style feats (`rapid_shot` / `two_weapon_fighting`, `manyshot` / `improved_two_weapon_fighting`, `improved_precise_shot` / `greater_two_weapon_fighting`) strictly when `activeFeatures` includes `'combat_style'`, `'improved_combat_style'`, and `'combat_style_mastery'`.
- Resolve familiar race ID from `companions?.find((c) => c.tags.includes('familiar'))?.raceId ?? familiarId` and grant `masterEffectBundle.virtualFeatGrants` only when `(scalingPools['familiar_master_effective_level'] ?? 0) > 0`.
- Update `buildClassAndDomainEffectModifiers` in `ledger_modifiers.ts` to check `(scalingPools['familiar_master_effective_level'] ?? 0) > 0` and resolve familiar race ID from `companions` or `familiarId`.
- Update callers in `src/rulesets/dnd35e/level_ledger.ts`, `src/rulesets/dnd35e/builder/builder_prereq_context.ts`, and `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`.

---

### Step 3: Feature-Driven Validation & Tagged Companion Hydration (`builder_validation.ts`, `builder_levelup_validation.ts`, `builder_hydrator_*.ts`, `level_ledger.ts`)

1. **`src/rulesets/dnd35e/builder/builder_validation.ts`**:
   - Compute `const activeFeatures = getClassActiveFeaturesUpToLevel(classDef, 1, draft.selectedAcfIds);`
   - Gate Cleric domain validation on `activeFeatures.includes('cleric_domains')` (requiring 2 distinct domains from `sys.domains`).
   - Gate Wizard school specialization on `activeFeatures.includes('arcane_school_specialization')`.
   - Gate Familiar validation on `activeFeatures.some(fId => classDef.featureDetails?.[fId]?.scalingPoolContribution?.poolId === 'familiar_master_effective_level')`.
   - Gate Animal Companion validation on `activeFeatures.some(fId => classDef.featureDetails?.[fId]?.scalingPoolContribution?.poolId === 'animal_companion_effective_level' && (classDef.featureDetails?.[fId]?.scalingPoolContribution?.minClassLevel ?? 1) <= 1)`.
   - Gate Favored Enemy validation on `activeFeatures.some(fId => fId.startsWith('favored_enemy_'))`.
2. **`src/rulesets/dnd35e/builder/builder_levelup_validation.ts`**:
   - Compare `prevFeatures = getClassActiveFeaturesUpToLevel(classDef, prevClassLevel, prevAcfs)` vs `currFeatures = getClassActiveFeaturesUpToLevel(classDef, newClassLevel, nextAcfs)` and `newFeatures = currFeatures.filter(f => !prevFeatures.includes(f))`.
   - Gate `combatStyle` requirement on `newFeatures.includes('combat_style')`.
   - Gate `animalCompanionId` requirement on `animal_companion_effective_level` pool transitioning from `0` at `prevClassLevel` to `> 0` at `newClassLevel` (when no animal companion is already selected).
   - Gate `newFavoredEnemy` / `upgradedFavoredEnemy` on `newFeatures.some(f => f.startsWith('favored_enemy_'))`.
   - Gate `rogueSpecialAbilityId` on `const rogueFeatId = newFeatures.find(f => f.startsWith('rogue_special_ability_'))`, and validate against `classDef.featureDetails?.[rogueFeatId]?.bonusFeatPool`!
3. **`src/rulesets/dnd35e/builder/builder_hydrator_creation.ts` & `src/rulesets/dnd35e/level_ledger.ts`**:
   - Build a helper `buildTaggedCompanionsList(animalCompanionId, familiarId, existingCompanions)` that constructs `ReadonlyArray<DnD35CompanionEntry>` with `tags: ['animal_companion']`, `tags: ['familiar']`, or merged `tags: ['animal_companion', 'familiar']` if both point to the same race ID, while keeping `animalCompanionId` and `familiarId` synchronized.

---

### Step 4: Tagged Companion Sync & 4-Stage Stat DAG Evaluation (`src/rulesets/dnd35e/companions.ts` & `src/rulesets/registry.ts`)

1. Evict `RANGER_COMBAT_STYLE_LEVEL`, `RANGER_IMPROVED_COMBAT_STYLE_LEVEL`, `RANGER_COMBAT_STYLE_MASTERY_LEVEL`, `RANGER_ANIMAL_COMPANION_MIN_LEVEL`, `RANGER_FAVORED_ENEMY_UPGRADE_LEVELS`, `ROGUE_SPECIAL_ABILITY_LEVELS`, and `CLERIC_REQUIRED_DOMAIN_COUNT` from `src/rulesets/dnd35e/companions.ts` and `src/rulesets/registry.ts`.
2. Refactor `syncActorCompanions` and `upsertLinkedServantActor` in `src/rulesets/dnd35e/companions.ts`:
   - Normalize `data.companions` (falling back to `data.animalCompanionId` / `data.familiarId` for legacy save/test fixtures).
   - For each `DnD35CompanionEntry`, check `entry.tags.includes('animal_companion')` (`compLevel > 0`) and `entry.tags.includes('familiar')` (`famLevel > 0`).
   - Construct the servant's `DnD35ActorRulesetData` with:
     - Racial `HitDieTrack.levels = baseRaceHd + compAdv.bonusHd`
     - `naturalArmorBonus = baseNatArmor + compAdv.naturalArmorBonus + famAdv.naturalArmorBonus`
     - `abilities` with `str + compAdv.strDexBonus`, `dex + compAdv.strDexBonus`, and `int = isFamiliar ? Math.max(baseInt, famAdv.intScore) : baseInt`
   - Call `evaluateDnD35ActorStatDAG(servantRulesetData)` to compute full 3.5e stats (size modifiers, DEX AC, natural armor, CON HP, feats, saves, BAB).
   - Apply familiar master overrides (`totalHp = isFamiliar ? Math.max(dag.maxHp, Math.max(1, Math.floor(masterMaxHp / 2))) : dag.maxHp`, `totalAttack = isFamiliar ? Math.max(dag.attackBonus, masterBab + dag.effectiveAbilityModifiers.dex) : dag.attackBonus`, `totalAc = dag.acBreakdown.fullAC`).
   - Update `ControllerLinkComponent` (`tags: entry.tags`) on both newly spawned and existing linked servant entities.

---

### Step 5: Feature-Reactive Class Options UI (`dnd35e_char_builder_class*.ui.ts` & `dnd35e_level_up_class*.ui.ts`)

1. **`src/rendering/ui/dnd35e_char_builder_class_options.ui.ts` & `dnd35e_char_builder_class.ui.ts`**:
   - Split `renderWizardOptions` into `renderArcaneSchoolOptions` and `renderFamiliarOptions`.
   - In `dnd35e_char_builder_class.ui.ts`, compute active level-1 features (`getClassActiveFeaturesUpToLevel(classDef, 1, draftState.selectedAcfIds)`) and render sub-panels strictly by active feature / scaling pool (`cleric_domains`, `arcane_school_specialization`, `familiar_master_effective_level`, `animal_companion_effective_level`, `favored_enemy_*`).
   - When an ACF checkbox is toggled, re-check active level-1 features and clear any draft properties (`animalCompanionId`, `familiarId`, `clericDomains`, `wizardSpecialistSchool`, `favoredEnemyType`) whose governing feature is no longer active.
2. **`src/rendering/ui/dnd35e_level_up_class_options.ui.ts` & `dnd35e_level_up_class.ui.ts`**:
   - Remove imports of evicted constants and remove the hardcoded `ROGUE_SPECIAL_ABILITIES` array.
   - Gate level-up sub-option pickers in `dnd35e_level_up_class.ui.ts` by `newFeatures` at `nextClassLevel`.
   - Pass the active `rogue_special_ability_*` feature's `bonusFeatPool` and `classDef.featureDetails` into `renderLevelUpRogueSpecialAbilityOptions` so options and labels come 100% from `rogue.json`.

---

### Step 6: Verification, Tests & SSOT Sync
1. Update `tests/dnd35e_char_builder.test.ts` to verify:
   - Sorcerer level-1 familiar selection & validation.
   - Wizard `wizard_abrupt_jaunt_1` ACF replacing `summon_familiar` suppresses familiar requirement and `alertness` grant.
   - Dual-tag companion (`tags: ['animal_companion', 'familiar']`) stacking both Druid and Wizard progression bonuses through `evaluateDnD35ActorStatDAG`.
   - Ranger `favored_enemy_1` only applies damage bonus to the player's chosen `favoredEnemies` (no phantom static modifier).
2. Update `docs/ssot/ssot_dnd35e.json` and run `bun scripts/map-codebase.ts`.
3. Run `./verify.sh` across all 8 stages and confirm 0 errors.
