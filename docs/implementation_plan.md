# Milestone 137 Implementation Plan — Core Class ACF Expansion (Druid, Sorcerer, Bard) & Regression Parity

## 1. Overview & Architectural Alignment
Milestone 137 completes **Phase 33 (Alternate Class Features & Runtime Mechanics)** by authoring and wiring the remaining 5 core class ACFs for **Druid** (*Druidic Avenger*, *Shapeshift*), **Sorcerer** (*Metamagic Specialist*), and **Bard** (*Bardic Knack*, *Healing Hymn*), backed by end-to-end regression parity across Milestones 135–137.

### SSOT Ownership & New Module Table
| Responsibility | Canonical Owner | Tier |
| :--- | :--- | :--- |
| Multi-feature ACF swap schema (`alsoReplacesFeatures`) | `src/rulesets/dnd35e/types/system/effect_system.types.ts` | Tier 2 Schema |
| Multi-feature ACF progression filtering & validation | `src/rulesets/dnd35e/progression/class_features_xp.ts`, `src/rulesets/dnd35e/validation/class_race_validator.ts` | Tier 2 Progression / Validation |
| Druid *Shapeshift* swift-action form overlays (`predator`, `aerial`, `ferocious_slayer`, `normal`) | `src/rulesets/dnd35e/shapeshift.ts` (re-exported from `wild_shape.ts` & `dnd35e_ruleset.ts`) | Tier 2 Form Resolver |
| Sorcerer *Metamagic Specialist* spontaneous casting time reduction & pool consumption | `src/rulesets/dnd35e/magic/spell_cast_helpers.ts`, `src/rulesets/dnd35e/magic/spell_cast_resolver.ts` | Tier 2 Magic |
| Bard *Bardic Knack* untrained/low-rank skill floor (`Math.max(1, Math.floor(level / 2))`) | `src/rulesets/dnd35e/skills.ts`, `src/rulesets/dnd35e/skills/skill_verb_helpers.ts`, `src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts` | Tier 2 Skills & UI |
| Bard *Healing Hymn* performance status & `+performRanks` conjuration healing bonus | `src/rulesets/dnd35e/combat/pool_ability_resolver.ts`, `src/rulesets/dnd35e/magic/spell_cast_effects.ts` | Tier 2 Magic & Pools |
| Declarative ACF definitions (`druid.json`, `sorcerer.json`, `bard.json`) | `public/data/rulesets/dnd35e/classes/{druid,sorcerer,bard}.json` | Tier 3 Content |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)
| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| Single ACF trading multiple progression features (*Druidic Avenger* trading `animal_companion` + `wild_empathy`; *Shapeshift* trading `animal_companion` + `wild_shape_*`) | Hardcoding `if (acfId === 'druid_shapeshift_1')` in `resolveActiveClassFeatures` | Generic `alsoReplacesFeatures: string[]` on `DnD35AcfSwapSchema` evaluated uniformly in `resolveActiveClassFeatures` and `validateDnD35eClassesRacesTemplates` | **Yes** — any JSON ACF can replace multiple features declaratively. |
| *Druidic Avenger* Fast Movement (`+10 ft`), `+2` Survival, and scaling `rage` pool (`1/day + 1 per 5 levels`) | Custom Druid class-ID checks in movement/skill/rage resolvers | `featureDetails.druidic_avenger` declaring `modifiers` (`speed +10`, `skill:survival +2`), `grantedTags` (`trait:druidic_avenger`, `trait:fast_movement`, `feature:rage_1`), and `resourcePool` (`poolId: "rage"`, `maxBase: 1`, `perClassLevel: 0.2`) | **Yes** — resolved entirely by existing DAG and `ResourcePoolComponent` builders. |
| *Shapeshift* Predator / Aerial / Ferocious Slayer forms | Hardcoding form stats inside `attack_resolver.ts` | `PropertyOverlayComponent` (`overlayId: 'acf:shapeshift'`) + `TacticalDoctrineComponent.activeStanceGroups['druid_shapeshift_form']` projecting typed `StatModifier`s, `sizeCategoryOverride`, `movementModesOverride`, and `naturalWeapons` | **Yes** — reuses the universal `PropertyOverlayComponent` & stance group pipeline. |
| *Metamagic Specialist* spontaneous metamagic without full-round casting time increase (`3 + INT mod / day`) | Checking `classId === 'sorcerer'` in `consumeSpellActionBudget` | Checking semantic tag `trait:metamagic_specialist` / `feature:metamagic_specialist` + remaining charges in `ResourcePoolComponent.pools['metamagic_specialist']` | **Yes** — any spontaneous class or feat granting `trait:metamagic_specialist` and the `metamagic_specialist` pool works identically. |
| *Bardic Knack* effective rank floor (`max(1, floor(level / 2))`) | Hardcoding `trackId === 'bard'` in `resolveSkillCheck` | `scalingPoolContribution: { poolId: "bardic_knack_level", multiplier: 1 }` on `featureDetails.bardic_knack` + `trait:bardic_knack` evaluated by `resolveBardicKnackSkillBonus` | **Yes** — scales from `scalingPools.bardic_knack_level` (with track fallback). |
| *Healing Hymn* `+performRanks` bonus on healing spells while performing | Hardcoding spell IDs (`spellId === 'cure_light_wounds'`) | Inspecting `unit.type === 'healing'` in `applySingleSpellUnit` and checking for any non-hostile performer within `30 ft` with `trait:healing_hymn` and active performance status | **Yes** — works automatically for all Conjuration (Healing) spells. |

---

## 3. Cascading Effects Matrix (`AGENTS.md` Rule 15)
| Change | Upstream (Callers / Producers) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling JSONs / Docs / SSOT) |
| :--- | :--- | :--- | :--- |
| Add `alsoReplacesFeatures` to `DnD35AcfSwapSchema` | `druid.json`, `sorcerer.json`, `bard.json` | `resolveActiveClassFeatures` (`class_features_xp.ts`), `validateDnD35eClassesRacesTemplates` (`class_race_validator.ts`) | All existing class JSONs default `alsoReplacesFeatures` to `[]` seamlessly |
| Add `src/rulesets/dnd35e/shapeshift.ts` & wire `resolveEffectiveEntityDataWithOverlays` naturalWeapons override | `dnd35eRulesetContract.resolveUseAbility`, `wild_shape.ts`, `evaluateDnD35eEntityDAG` | `buildActorNaturalWeaponLimbs` (`dnd35e_equipped_item_dag.ts`), `buildActorStanceModes` (`dnd35e_ui_hotbar.ts`), `canDnD35eActorPerformIntent` (`dnd35e_turn_budget.ts`) | Register `src/rulesets/dnd35e/shapeshift.ts` in `docs/ssot/ssot_dnd35e.json` and run `bun scripts/map-codebase.ts` |
| Wire `metamagic_specialist` in `consumeSpellActionBudget` & `executeDnD35eSpellCast` | `executeDnD35eSpellCast` (`spell_cast_resolver.ts`) | `consumeSpellActionBudget` (`spell_cast_helpers.ts`), `ResourcePoolComponent` (`metamagic_specialist` pool) | `sorcerer.json` (`metamagic_specialist` feature & ACF swap) |
| Wire `resolveBardicKnackSkillBonus` & `resolveHealingHymnBonus` | `evaluateActorSkillCheck`, `computePassiveSkillModifier`, `executeDnD35eResourcePoolAbility`, `applySingleSpellUnit` | Skill checks, Character Sheet skill rows, `healing` spell effect units | `bard.json` (`bardic_knack` & `healing_hymn` features & ACF swaps) |

---

## 4. Step-by-Step Implementation Plan

### Step 1: Multi-Feature ACF Schema & Validator Support
- **`src/rulesets/dnd35e/types/system/effect_system.types.ts`**:
  - Add `alsoReplacesFeatures: z.array(z.string()).default([])` to `DnD35AcfSwapSchema`.
- **`src/rulesets/dnd35e/progression/class_features_xp.ts`**:
  - Update `resolveActiveClassFeatures` to remove both `swap.replacesFeature` and any feature in `swap.alsoReplacesFeatures ?? []`.
- **`src/rulesets/dnd35e/validation/class_race_validator.ts`**:
  - Validate that every feature ID in `acf.alsoReplacesFeatures ?? []` exists in `grantedFeatures` for the class.

### Step 2: Author Druid, Sorcerer, and Bard ACF JSON Definitions
- **`public/data/rulesets/dnd35e/classes/druid.json`**:
  - Add `featureDetails.druidic_avenger`:
    - `modifiers`: `+10 ft` `speed` (when not in heavy armor/load) and `+2` `skill:survival`.
    - `grantedTags`: `["trait:druidic_avenger", "trait:fast_movement", "feature:rage_1"]`.
    - `resourcePool`: `{ "poolId": "rage", "maxBase": 1, "perClassLevel": 0.2, "refreshCycle": "rest_8h" }`.
  - Add `featureDetails.shapeshift`:
    - `category: "su"`, `usageMode: "toggle"`, `grantedTags: ["trait:shapeshift"]`.
    - `activatedAbilities`: `shapeshift_predator` (L1+), `shapeshift_aerial` (L5+), `shapeshift_ferocious_slayer` (L8+) in `toggleGroup: "druid_shapeshift_form"` (`actionCost: "swift"`).
  - Add `acfSwaps`:
    - `druid_druidic_avenger_1` (Level 1, replaces `animal_companion`, `alsoReplacesFeatures: ["wild_empathy"]`, grants `druidic_avenger`).
    - `druid_shapeshift_1` (Level 1, replaces `animal_companion`, `alsoReplacesFeatures: ["wild_shape_1", "wild_shape_2", "wild_shape_3", "wild_shape_large", "wild_shape_4", "wild_shape_tiny", "wild_shape_plant", "wild_shape_5", "wild_shape_huge", "wild_shape_elemental_1", "wild_shape_6", "wild_shape_elemental_2", "wild_shape_elemental_3_huge"]`, grants `shapeshift`).
    - `druid_shapeshift_5` (Level 5, replaces `wild_shape_1`, `alsoReplacesFeatures: ["animal_companion", "wild_shape_2", "wild_shape_3", "wild_shape_large", "wild_shape_4", "wild_shape_tiny", "wild_shape_plant", "wild_shape_5", "wild_shape_huge", "wild_shape_elemental_1", "wild_shape_6", "wild_shape_elemental_2", "wild_shape_elemental_3_huge"]`, grants `shapeshift`).
- **`public/data/rulesets/dnd35e/classes/sorcerer.json`**:
  - Add `featureDetails.metamagic_specialist`:
    - `category: "ex"`, `usageMode: "triggered"`, `grantedTags: ["trait:metamagic_specialist"]`.
    - `ruleOverrides`: `[{ "id": "metamagic_specialist_rapid", "ruleKey": "spontaneous_metamagic_no_time_increase", "value": true, "priority": 20 }]`.
    - `resourcePool`: `{ "poolId": "metamagic_specialist", "maxBase": 3, "abilityModStat": "int", "refreshCycle": "rest_8h" }`.
  - Add `acfSwaps`:
    - `sorcerer_metamagic_specialist_1` (Level 1, replaces `summon_familiar`, grants `metamagic_specialist`).
- **`public/data/rulesets/dnd35e/classes/bard.json`**:
  - Add `featureDetails.bardic_knack`:
    - `category: "ex"`, `usageMode: "passive"`, `grantedTags: ["trait:bardic_knack"]`.
    - `scalingPoolContribution`: `{ "poolId": "bardic_knack_level", "multiplier": 1, "offset": 0, "minClassLevel": 1 }`.
  - Add `featureDetails.healing_hymn`:
    - `category: "su"`, `usageMode: "activated"`, `grantedTags: ["trait:healing_hymn"]`.
    - `activatedAbilities`: `[{ "abilityId": "healing_hymn", "name": "Healing Hymn", "actionCost": "standard", "usageLimitPoolId": "bardic_music" }]`.
  - Add `acfSwaps`:
    - `bard_bardic_knack_1` (Level 1, replaces `bardic_knowledge`, grants `bardic_knack`).
    - `bard_healing_hymn_1` (Level 1, replaces `fascinate`, grants `healing_hymn`).

### Step 3: Druid *Shapeshift* Runtime Resolver (`src/rulesets/dnd35e/shapeshift.ts` & `wild_shape.ts`)
- Create `src/rulesets/dnd35e/shapeshift.ts` (re-exported from `wild_shape.ts` and `dnd35e_ruleset.ts`):
  - Define `DnD35ShapeshiftFormId = 'predator' | 'aerial' | 'ferocious_slayer' | 'normal'`.
  - Implement `executeDruidShapeshift(state, actorId, formId)`:
    - Validates `trait:shapeshift` / `feature:shapeshift` and Druid level requirement (`1` for `'predator'`, `5` for `'aerial'`, `8` for `'ferocious_slayer'`).
    - In TurnBased mode, consumes 1 Swift Action (`consumeSwiftOrImmediateActionFromBudget(budget, 'swift')`).
    - Applies/updates `PropertyOverlayComponent` (`overlayId: 'acf:shapeshift'`) and `TacticalDoctrineComponent.activeStanceGroups['druid_shapeshift_form']`:
      - **Predator Form**: `+4` enhancement STR, `+4` natural armor AC, `+20 ft` speed (`50 ft` land speed), primary `1d6` Bite natural weapon, `form:shapeshift_predator`.
      - **Aerial Form**: `+2` enhancement STR, `+2` natural armor AC, `+2` competence Reflex save, `40 ft` fly speed (`movement:fly`), primary `1d6` Talon natural weapon, `form:shapeshift_aerial`.
      - **Ferocious Slayer Form**: `sizeCategoryOverride: 'large'`, `+8` enhancement STR, `+8` natural armor AC, `+10 ft` speed (`40 ft` land speed), primary `1d8` Bite + secondary `2x 1d6` Claw natural weapons, `form:shapeshift_ferocious_slayer`.
      - **Normal Form**: Removes `'acf:shapeshift'` overlay and clears `activeStanceGroups['druid_shapeshift_form']`.
  - Support `statOverrides.naturalWeapons` in `resolveEffectiveEntityDataWithOverlays` (`src/rulesets/dnd35e/wild_shape.ts`) so form overlays seamlessly inject their natural weapons into `dndData.naturalWeapons`.
  - Wire `shapeshift:<formId>` in `dnd35eRulesetContract.resolveUseAbility`, `canDnD35eActorPerformIntent`, and `resolveDnD35eActionEnergyCost` (`0` world energy cost as a swift action), and project Shapeshift stances in `buildActorStanceModes` (`dnd35e_ui_hotbar.ts`).

### Step 4: Sorcerer *Metamagic Specialist* Runtime Wiring (`spell_cast_helpers.ts` & `spell_cast_resolver.ts`)
- Update `consumeSpellActionBudget` in `src/rulesets/dnd35e/magic/spell_cast_helpers.ts` to accept an optional `bypassSpontaneousMetamagicTimeIncrease = false` parameter.
- In `executeDnD35eSpellCast` (`src/rulesets/dnd35e/magic/spell_cast_resolver.ts`):
  - Check if `book.castingMode === 'spontaneous' && meta.hasNonQuickenMetamagic && !meta.isQuickened`.
  - If the caster has `trait:metamagic_specialist` or `feature:metamagic_specialist` and `ResourcePoolComponent.pools['metamagic_specialist']?.current >= 1`:
    - Pass `bypassSpontaneousMetamagicTimeIncrease = true` to `consumeSpellActionBudget` (retaining `'standard'` action casting time instead of `'full_round'`).
    - Expend `1` charge from `metamagic_specialist` via `consumeResourcePool(runningState, casterId, 'metamagic_specialist', 1)`.

### Step 5: Bard *Bardic Knack* & *Healing Hymn* Runtime Wiring (`skills.ts`, `pool_ability_resolver.ts`, `spell_cast_effects.ts`)
- **Bardic Knack**:
  - Add `resolveBardicKnackSkillBonus(dndData, selfTags, skillId, wholeRanks, trainedOnly)` in `src/rulesets/dnd35e/skills.ts`:
    - Computes `knackLevel = dndData.scalingPools?.['bardic_knack_level'] ?? bardTrackLevels`.
    - Computes `knackFloor = Math.max(1, Math.floor(knackLevel / 2))`.
    - When the actor has `trait:bardic_knack` or `feature:bardic_knack`, `wholeRanks < knackFloor`, and (`!trainedOnly || wholeRanks >= 1`), returns an untyped `StatModifier` with `value: knackFloor - wholeRanks` (`sourceId: 'class:bard:bardic_knack'`, `sourcePath: 'class:bard/feature:bardic_knack/skill_floor'`).
  - Wire into `evaluateActorSkillCheck` (`src/rulesets/dnd35e/skills/skill_verb_helpers.ts`) and `computePassiveSkillModifier` (`src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts`).
- **Healing Hymn**:
  - In `executeDnD35eResourcePoolAbility` (`src/rulesets/dnd35e/combat/pool_ability_resolver.ts`), when `poolId === 'bardic_music'` or `'healing_hymn'` and the actor has `trait:healing_hymn` / `feature:healing_hymn`, apply `status:healing_hymn_active` (duration `5` rounds) alongside `pool_bardic_music_active`.
  - In `applySingleSpellUnit` (`src/rulesets/dnd35e/magic/spell_cast_effects.ts`), inside `case 'healing'`, compute `healingHymnBonus = resolveHealingHymnBonus(runningState, casterId)` (checking the caster and any non-hostile ally within `30 ft` who has `trait:healing_hymn` / `feature:healing_hymn` and active performance status `status:healing_hymn_active` / `status:pool_bardic_music_active` / `status:bardic_music_active`, returning `Math.max(0, Math.floor(performRanks))`) and add it to `amount`.

### Step 6: Comprehensive Regression Suite, Documentation & 8-Stage Verification
- Extend `tests/dnd35e_m136_acf_mechanics.test.ts` (or add `tests/dnd35e_m137_acf_mechanics.test.ts`) testing all 5 Milestone 137 ACFs end-to-end:
  1. Druid *Druidic Avenger*: replaces `animal_companion` and `wild_empathy`, grants `+10 ft` Fast Movement, `+2` Survival, and scaling `rage` pool (`1/day` at L1, `2/day` at L5) activating `status:rage_active` (`+4 STR, +4 CON, +2 Will, -2 AC`).
  2. Druid *Shapeshift*: replaces `animal_companion` and `wild_shape_*`; swift-action transformation into Predator Form (`+4` STR, `+4` natural armor, `50 ft` speed, `1d6` bite), Aerial Form at L5 (`+2` STR, `+2` natural armor, `+2` Ref, `40 ft` fly, `1d6` talon), Ferocious Slayer Form at L8 (`large` size, `+8` STR, `+8` natural armor, `1d8` bite + `2x 1d6` claws), and reverting to Normal form.
  3. Sorcerer *Metamagic Specialist*: replaces `summon_familiar` (suppressing familiar scaling pool), grants `3 + INT mod` uses/day in `metamagic_specialist` pool, casts Empowered/Silent spontaneous spell as a Standard Action (even after moving) while decrementing `metamagic_specialist` pool, and reverts to Full-Round casting time when pool reaches `0`.
  4. Bard *Bardic Knack*: replaces `bardic_knowledge`, adds `max(1, floor(bardLevel / 2))` on untrained (`0`-rank) skill checks (`+1` at L1, `+3` at L6) while respecting `trainedOnly` restrictions when `rawRanks === 0`.
  5. Bard *Healing Hymn*: replaces `fascinate`, activating `pool:bardic_music` applies `healing_hymn_active`, and casting *Cure Light Wounds* by self or a nearby ally within `30 ft` adds `+performRanks` to HP restored (and positive-energy damage against undead).
- Sync `docs/ssot/ssot_dnd35e.json`, run `bun scripts/map-codebase.ts`, update `docs/MILESTONES.md`, `docs/DECISIONS.md`, and `docs/ARCHITECTURE.md`, and run `./verify.sh`.
