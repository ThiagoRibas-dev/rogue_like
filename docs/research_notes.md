# Research Notes: Milestone 132 Post-Audit Remediation & Milestone Documentation

## 1. Rules & Standards Acknowledgment (`AGENTS.md` & `docs/ARCHITECTURE.md`)
- **ECS Purity & Immutability**: All component data remain plain JSON-serializable records; state changes return new objects without mutating inputs.
- **Strict TypeScript & Zero Magic Values (`AGENTS.md` Rules 10–14)**: Zero `any`, explicit return types on every function, named constants/enums, exhaustive `switch` (`assertNever`), flat control flow.
- **Three-Tier Architecture (Rule 16)**:
  - **Tier 1 (Console Engine)**: Ruleset-agnostic ECS, turn loop, and UI shells remain untouched.
  - **Tier 2 (Cartridge & Cartridge UI)**: Combat Exchange Pipeline (`combat_exchange_pipeline.ts`), Prerequisite AST evaluator (`prerequisites.ts`, `prerequisite_proficiency.ts`), Effect Bundle resolver (`effect_bundle.ts`), Class Choice Feat collector (`ledger_choices.ts`), Semantic Tag projector (`semantic_tags.ts`), and Feat Row UI (`dnd35e_char_builder_feat_row.ui.ts`).
  - **Tier 3 (System Content JSON)**: `ability_focus.json`, `improved_natural_attack.json`, `domains/war.json`, `classes/ranger.json`, `items/{longbow,shortbow,composite_longbow,composite_shortbow}.json`, `feats/stunning_fist.json`, and `docs/MILESTONES.md`.
- **Rule 17 (StatModifier vs. RuleOverride Boundary)**:
  - Numeric DC bonuses (`special_ability_save_dc`) and damage size steps (`natural_damage_size_step`) are resolved exclusively via `StatModifier` and `resolveTypedModifiersWithBreakdown`.
- **Rule 19 (4-Layer Decision Matrix & Provenance)**:
  - Layer A (`Semantic Tags`): `trait:special_attack` and `special_attack:<id>` predicates.
  - Layer B (`Effect Bundles`): `resolveFeatEffectBundle` and domain/class feature bundles with `sourcePath`.
  - Layer D (`Domain Resolvers`): `executeCombatStrikeExchange` and `resolveSpecialAbilitySaveDc`.
- **Rule 21 (Zero Content-ID or Bespoke-Property Branching — "New Content Mod" Litmus Test)**:
  - Every remaining legacy content-ID branch in touched files (`effect_bundle.ts`, `ledger_choices.ts`, `builder_prereq_proficiencies.ts`, `semantic_tags.ts`) must be replaced with declarative schema fields in Tier 3 JSON.
- **Pre-Execution Gate (Step 3 of 6-Step Kickoff Flow)**:
  - **STOP after compiling this research document and wait for explicit User confirmation before drafting the Implementation Plan or writing code.**

---

## 2. Research Findings & Subsystem Mapping

### Task 1: Live Combat Pipeline Integration for Creature `OnHitRiderDescriptor`s & `resolveSpecialAbilitySaveDc`
1. **Current State & Gap**:
   - Ten SRD bestiary races/templates (`ghoul.json`, `ghast.json`, `giant_spider.json`, `giant_centipede.json`, `dire_rat.json`, `wight.json`, `mummy.json`, `medusa.json`, `gelatinous_cube.json`, `vampire.json`) author `riders: OnHitRiderDescriptor[]` on their `naturalWeapons` entries (`poison`, `disease`, `paralysis`, `energy_drain`, `curse`).
   - `maneuvers_conditions.ts` exports `shouldTriggerOnHitRider(rider, damageDealtAfterDR, attackHit)` and `resolveSpecialAbilitySaveDc(baseDc, abilityId, statModifiers, selfTags)`.
   - However:
     1. `NaturalWeaponLimbEntry` (`src/rulesets/dnd35e/combat/full_attack_sequence.ts`) and `buildActorNaturalWeaponLimbs` (`src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`) do not carry `riders?: ReadonlyArray<OnHitRiderDescriptor>` forward from `dndData.naturalWeapons`.
     2. `DnD35ResolvedStrikeProfile` (`src/rulesets/dnd35e/combat/attack_routine.ts`) only carries `damageRiders?: ReadonlyArray<DnD35WeaponDamageRider>` (for elemental dice like *Flaming*), not `onHitRiders?: ReadonlyArray<OnHitRiderDescriptor>`.
     3. `executeCombatStrikeExchange` (`src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts`, Phase 3 `OnHitRidersPhase`) never evaluates `strike.onHitRiders`.
2. **Interaction with Existing Systems**:
   - When a natural strike (or weapon enhancement with `onHitRiders`) hits in `executeCombatStrikeExchange`:
     - Physical damage penetration against defender DR is computed via `mitigateIncomingDamage` (`src/rulesets/dnd35e/combat/damage_vitality.ts`).
     - `shouldTriggerOnHitRider(rider, mitigatedPhysical.finalDamage, true)` checks whether the rider triggers (`'contact'` triggers on any hit; `'injury'` requires `finalDamage > 0` after DR).
     - `resolveSpecialAbilitySaveDc` resolves the effective save DC against both `ability:${rider.type}` and `ability:${rider.riderId}` so `ability_focus:poison` (or `ability_focus:spider_venom`) adds `+2` DC.
     - `resolveSavingThrow` rolls the defender's `fort` / `ref` / `will` save (`defenderEval.dagResult.saves[rider.saveType]`) and logs the roll result to the combat message log.
     - On a failed save (when not immune via `defenderData.immunities` or undead/construct trait rules), condition/level consequences (`paralyzed` condition on `paralysis`, `negativeLevels + 1` on `energy_drain`, `sickened` or status log on `poison`/`disease`/`curse`) are applied to the defender's `RulesetDataComponent`.

---

### Task 2: Target-Specific Prerequisite Gating & Owned-Target Dropdown Filtering (`Ability Focus` & `Improved Natural Attack`)
1. **Current State & Gap**:
   - `improved_natural_attack.json` checks `{ "type": "min_natural_attacks", "minCount": 1 }` + `{ "type": "min_bab", "minBab": 4 }`. It does not check whether the actor actually possesses the selected natural weapon (`ctx.targetId`), and `getFeatTargetOptions` in `dnd35e_char_builder_feat_row.ui.ts` always lists all 8 `CANONICAL_NATURAL_WEAPONS`.
   - `ability_focus.json` checks `{ "type": "has_tag", "tag": "trait:special_attack" }`. It does not verify that the actor possesses the specific special attack selected in the dropdown (`ctx.targetId`), and `getFeatTargetOptions` always lists all 11 `CANONICAL_SPECIAL_ATTACKS`.
2. **Declarative Design**:
   - **Natural Weapon Target Validation & Dropdown**:
     - Extend `PrerequisiteEvalContext` (`src/rulesets/dnd35e/prerequisite_types.ts`) with `readonly naturalWeaponIds?: ReadonlyArray<string> | undefined`.
     - Populate `naturalWeaponIds` in `buildPrerequisiteContextForActor`, `buildCreationDraftPrerequisiteContext`, and `buildPostLevelUpPrerequisiteContext` from `dndData.naturalWeapons` / `raceDef.naturalWeapons` (collecting deduplicated `nw.naturalType` and `nw.id`).
     - In `evaluatePrerequisiteAST` (`src/rulesets/dnd35e/prerequisites.ts`), under `case 'min_natural_attacks'`: if `context.targetId !== undefined && context.naturalWeaponIds !== undefined`, require `(context.naturalAttackCount ?? 0) >= node.minCount && context.naturalWeaponIds.includes(context.targetId)`.
     - In `getFeatTargetOptions` (`src/rendering/ui/dnd35e_char_builder_feat_row.ui.ts`), accept `prereqCtx?: PrerequisiteEvalContext`; when `targetCategory === 'natural_weapon'` and `prereqCtx?.naturalWeaponIds && prereqCtx.naturalWeaponIds.length > 0`, return `prereqCtx.naturalWeaponIds` (falling back to `CANONICAL_NATURAL_WEAPONS` when the actor has no natural weapons so the inspector still displays the red unmet prerequisite).
   - **Special Attack Target Validation & Dropdown**:
     - Emit specific `special_attack:<id>` tags alongside `trait:special_attack`:
       - Natural weapon `OnHitRiderDescriptor`s in `races.ts`, `templates.ts`, and `semantic_tags.ts` emit `special_attack:${rider.type}` and `special_attack:${rider.riderId}` in addition to `rider.grantedTags ?? ['trait:special_attack']`.
       - `breathWeapon` in `races.ts`, `templates.ts`, and `half_dragon_*.json` emits `special_attack:breath_weapon` alongside `trait:special_attack`.
       - Class features and domains (`rogue.json` -> `special_attack:sneak_attack`, `assassin.json` -> `special_attack:death_attack`, `paladin.json` / `blackguard.json` -> `special_attack:smite`, `sun.json` -> `special_attack:turn_undead`) and feats (`stunning_fist.json` -> `special_attack:stun`) emit their corresponding `special_attack:<id>` tag in `grantedTags`.
     - Support `$selected` target interpolation in `case 'has_tag'` in `evaluatePrerequisiteAST` (`src/rulesets/dnd35e/prerequisites.ts`) and `formatPrerequisiteLeafLabel` (`src/rendering/ui/dnd35e_feat_spell_inspector.ui.ts`), matching the existing `$selected` convention in `case 'has_feat'`:
       - When `node.tag` contains `$selected` (e.g. `"special_attack:$selected"`):
         - If `context.targetId !== undefined`, check `context.tags.includes(node.tag.replace('$selected', context.targetId))`.
         - If `context.targetId === undefined`, check `context.tags.some((t) => t.startsWith(node.tag.replace('$selected', '')))`.
     - Update `public/data/rulesets/dnd35e/feats/ability_focus.json` prerequisites to require both `trait:special_attack` and `special_attack:$selected`.
     - In `getFeatTargetOptions` (`src/rendering/ui/dnd35e_char_builder_feat_row.ui.ts`), when `targetCategory === 'ability'` and `prereqCtx?.tags` contains `special_attack:<id>` tags, extract those `<id>`s so the dropdown offers the actor's owned special attacks (falling back to `CANONICAL_SPECIAL_ATTACKS` if none are owned).

---

### Task 3: Evict Pre-Existing Legacy Rule 21 Content-ID Branches in Touched/Adjacent Files
1. **`src/rulesets/dnd35e/effect_bundle.ts` (`resolveFeatEffectBundle`)**:
   - Every targeted feat in `public/data/rulesets/dnd35e/feats/*.json` now declares `repeatable.targetCategory` (`'weapon' | 'natural_weapon' | 'skill' | 'school' | 'ability'`), and both `exotic_weapon_proficiency.json` and `martial_weapon_proficiency.json` declare `effectBundle.category: "proficiency"`.
   - We can remove all string-prefix fallbacks (`featDef.id.startsWith('weapon_')`, `featDef.id.startsWith('greater_weapon_')`, `featDef.id === 'improved_critical'`, `featDef.id.includes('weapon_proficiency')`, `featDef.id.startsWith('skill_')`, `featDef.id.startsWith('spell_focus')`, `featDef.id.startsWith('ability_focus')`) and replace the line 276 check with `if (isWeaponTargeted && baseBundle.category === 'proficiency')`.
2. **`src/rulesets/dnd35e/builder/builder_prereq_proficiencies.ts` & `src/rulesets/dnd35e/prerequisite_proficiency.ts`**:
   - Add `proficiencyEquivalentWeaponId: z.string().optional()` to `DnD35WeaponStatsSchema` (`src/rulesets/dnd35e/types/system/item_system.types.ts`) and author it in `longbow.json` (`"composite_longbow"`), `composite_longbow.json` (`"longbow"`), `shortbow.json` (`"composite_shortbow"`), and `composite_shortbow.json` (`"shortbow"`).
   - Update `collectActorProficiencies` in `builder_prereq_proficiencies.ts` to expand `weaponIds` declaratively via `itemDef.weaponStats?.proficiencyEquivalentWeaponId` instead of hardcoded `if (weaponIds.has('longbow'))` checks.
3. **`src/rulesets/dnd35e/progression/ledger_choices.ts`, `public/data/rulesets/dnd35e/domains/war.json`, and `public/data/rulesets/dnd35e/classes/ranger.json`**:
   - Add `grantsDeityFavoredWeaponProficiencyAndFocus: z.boolean().optional()` to `DnD35DomainDefinitionSchema` (`effect_system.types.ts`) and set it to `true` in `domains/war.json`.
   - Add `combatStyleFeatByChoice: z.record(z.string(), z.string()).optional()` to `DnD35ClassFeatureDetailSchema` (`effect_system.types.ts`) and author `{ "archery": "rapid_shot", "two_weapon": "two_weapon_fighting" }` (and the level 6 / 11 equivalents) on `combat_style`, `improved_combat_style`, and `combat_style_mastery` in `classes/ranger.json`.
   - Update `collectClassChoiceFeats` in `ledger_choices.ts` to read `domDef.grantsDeityFavoredWeaponProficiencyAndFocus` and `featureDetail.combatStyleFeatByChoice[combatStyle]` (gated by `isActivationConditionMet(featureDetail.activationCondition, activeTags)`), eliminating `domains.includes('war')` and `combatStyle === 'archery' | 'two_weapon'` branches.
4. **`src/rulesets/dnd35e/semantic_tags.ts`**:
   - Remove the redundant `if (featId === 'illiteracy' && tags.has('trait:literate')) continue;` check (line 176), since `barbarian.json` already defines `"activationCondition": { "selfTagsNone": ["trait:literate"] }` on `illiteracy`, which is evaluated by `isActivationConditionMet` on line 185.

---

### Task 4: Update `docs/MILESTONES.md`
- Append **Phase 32 / Milestone 132** to `docs/MILESTONES.md` documenting:
  - Golden Rule 21 (*Zero Content-ID or Bespoke-Property Branching / "New Content Mod" Litmus Test*) and workflow audit tables in `AGENTS.md`.
  - Declarative `Ability Focus` (`grantedTags`, `special_attack:$selected` prerequisite, `resolveSpecialAbilitySaveDc`, and live `OnHitRiderDescriptor` saving throw execution in `combat_exchange_pipeline.ts`).
  - `Bastard Sword` & Weapon Proficiency Category filtering (`weaponProficiencyFilter`, `isExotic1HMartial2H` two-handed martial equivalence in `equipment_physics.ts` & `builder_prereq_proficiencies.ts`, `proficiencyEquivalentWeaponId`).
  - `Improved Natural Attack` `StatModifier` (`natural_damage_size_step`), `stepDamageDiceLadder` integration, and owned natural-weapon target filtering/validation.
  - Legacy content-ID fallback eviction across `effect_bundle.ts`, `ledger_choices.ts`, `builder_prereq_proficiencies.ts`, and `semantic_tags.ts`.

---

## 3. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling Modules / Docs / SSOT) |
| :--- | :--- | :--- | :--- |
| **1. `OnHitRiderDescriptor` Combat Pipeline Wiring** | `NaturalWeaponDescriptor.riders` in `races/*.json` & `templates/*.json`; `buildActorNaturalWeaponLimbs` (`dnd35e_equipped_item_dag.ts`); `resolveActorAttackRoutine` (`attack_routine.ts`) | `executeCombatStrikeExchange` (`combat_exchange_pipeline.ts`); `shouldTriggerOnHitRider` & `resolveSpecialAbilitySaveDc` (`maneuvers_conditions.ts`); `resolveSavingThrow` (`damage_vitality.ts`) | `DnD35ResolvedStrikeProfile`, `NaturalWeaponLimbEntry`, combat log messages, unit tests |
| **2. Target-Specific Prerequisite Gating & Dropdown Filtering (`Ability Focus` & `Improved Natural Attack`)** | `builder_prereq_context.ts`, `builder_draft_prereq_context.ts`, `builder_levelup_prereq_context.ts`, `races.ts`, `templates.ts`, `semantic_tags.ts`, `ability_focus.json` | `evaluatePrerequisiteAST` (`prerequisites.ts`), `getFeatTargetOptions` & `buildFeatTargetSelect` (`dnd35e_char_builder_feat_row.ui.ts`), `renderSharedFeatsStep` (`dnd35e_char_builder_feats.ui.ts`), `renderFeatInspector` (`dnd35e_feat_spell_inspector.ui.ts`) | `docs/dnd35e/SPECIAL_ATTACKS_AND_TAGS.md`, `half_dragon_*.json`, `rogue.json`, `assassin.json`, `paladin.json`, `blackguard.json`, `sun.json` |
| **3. Rule 21 Legacy Content-ID Fallback Eviction** | `effect_bundle.ts`, `ledger_choices.ts`, `builder_prereq_proficiencies.ts`, `semantic_tags.ts`, `domains/war.json`, `classes/ranger.json`, `*bow.json` | `DnD35DomainDefinitionSchema`, `DnD35ClassFeatureDetailSchema`, `DnD35WeaponStatsSchema`, `run-validator.ts` | `docs/DECISIONS.md`, `docs/ARCHITECTURE.md` |
| **4. Milestone Documentation (`docs/MILESTONES.md`)** | Completed M132 tasks & verification metrics | Project roadmap tracking (`docs/MILESTONES.md`) | `docs/SSOT_DND35E.md`, `docs/ssot/ssot_dnd35e.json` |
