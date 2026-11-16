# Milestone 137 Research Notes — Core Class ACF Expansion (Druid, Sorcerer, Bard) & Regression Parity

## 1. Architectural Rules & Standards Reiteration (`AGENTS.md` & `docs/ARCHITECTURE.md`)
- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any`, explicit return types on all functions, `exactOptionalPropertyTypes: true` compliance, and named constants for all gameplay numbers.
- **Rule 15 (Three-Axis Cascading Effects Mapping):** Map Upstream, Downstream, and Lateral impacts for every schema, data, and resolver change.
- **Rule 16 (Three-Tier Placement Heuristic):**
  - **Tier 1 (`src/types/`, `src/systems/`):** Generic Console primitives (`PropertyOverlayComponent`, `ResourcePoolComponent`, `TacticalDoctrineComponent`, `StatusEffectsComponent`).
  - **Tier 2 (`src/rulesets/dnd35e/`):** Baseline D&D 3.5e progression, skill checks, spellcasting action economy, healing resolution, and form/overlay evaluation.
  - **Tier 3 (`public/data/rulesets/dnd35e/classes/*.json`):** Declarative `acfSwaps` and `featureDetails` for Druid, Sorcerer, and Bard.
- **Rule 17, 19 & 21 (4-Layer Unified Effect Providers & Zero Content-ID Branching):**
  - Multi-feature ACF replacements (e.g., *Druidic Avenger* trading `animal_companion` and `wild_empathy`, *Shapeshift* trading `animal_companion` and `wild_shape_*`) must use a generic declarative field (`alsoReplacesFeatures: string[]`) on `DnD35AcfSwapSchema` rather than class-specific branches.
  - Capabilities are projected via semantic tags (`trait:druidic_avenger`, `trait:shapeshift`, `trait:metamagic_specialist`, `trait:bardic_knack`, `trait:healing_hymn`), scaling pools (`bardic_knack_level`), and modular resource pools (`rage`, `metamagic_specialist`, `bardic_music`).

---

## 2. Codebase Findings & Task Mapping

### 2.1 Multi-Feature ACF Replacement (`DnD35AcfSwapSchema` & `class_features_xp.ts`)
- **Current State:**
  - `DnD35AcfSwapSchema` (`src/rulesets/dnd35e/types/system/effect_system.types.ts`) defines `replacesFeature: z.string()` and `grantedFeature: z.string()`.
  - `resolveActiveClassFeatures` (`src/rulesets/dnd35e/progression/class_features_xp.ts`) filters out `swap.replacesFeature` and appends `swap.grantedFeature`.
  - `validateDnD35eClassesRacesTemplates` (`src/rulesets/dnd35e/validation/class_race_validator.ts`) verifies `grantedFeatures.has(acf.replacesFeature)`.
- **Required Enhancement:**
  - Add `alsoReplacesFeatures: z.array(z.string()).default([])` to `DnD35AcfSwapSchema`.
  - Update `resolveActiveClassFeatures` so any feature in `[swap.replacesFeature, ...(swap.alsoReplacesFeatures ?? [])]` is removed when `acfId` is active.
  - Update `validateDnD35eClassesRacesTemplates` to validate every entry in `acf.alsoReplacesFeatures` against `grantedFeatures`.

### 2.2 Druid ACFs (`public/data/rulesets/dnd35e/classes/druid.json` & `src/rulesets/dnd35e/shapeshift.ts`)
1. **Druidic Avenger (`Unearthed Arcana p. 51`)**:
   - `acfId`: `"druid_druidic_avenger_1"` at Level 1.
   - `replacesFeature`: `"animal_companion"`, `alsoReplacesFeatures`: `["wild_empathy"]`, `grantedFeature`: `"druidic_avenger"`.
   - Suppresses `animal_companion_effective_level` scaling pool automatically because `animal_companion` is removed from `activeClassFeatures`.
   - `featureDetails.druidic_avenger`:
     - Emits `+10 ft` Fast Movement (`target: "speed", value: 10, type: "untyped", condition: { selfTagsNone: ["armor:heavy", "load:heavy"] }`).
     - Emits `+2` Survival bonus (`target: "skill:survival", value: 2, type: "untyped"`).
     - Grants `resourcePool`: `{ poolId: "rage", maxBase: 1, perClassLevel: 0.2, refreshCycle: "rest_8h" }` (1/day at L1, scaling by +1/day per 5 Druid levels) and `grantedTags: ["trait:druidic_avenger", "trait:fast_movement", "feature:rage_1"]`.
     - Activating `pool:rage` via `executeDnD35eResourcePoolAbility` applies `status:rage_active`, resolved by `collectRageAndFrenzyModifiers` (`+4 STR, +4 CON, +2 morale Will, -2 AC`).
2. **Shapeshift (`PHB II p. 39`)**:
   - `acfId`: `"druid_shapeshift_1"` (Level 1, `replacesFeature: "animal_companion"`, `alsoReplacesFeatures: ["wild_shape_1", "wild_shape_2", "wild_shape_3", "wild_shape_large", "wild_shape_4", "wild_shape_tiny", "wild_shape_plant", "wild_shape_5", "wild_shape_huge", "wild_shape_elemental_1", "wild_shape_6", "wild_shape_elemental_2", "wild_shape_elemental_3_huge"]`) and `"druid_shapeshift_5"` (Level 5, `replacesFeature: "wild_shape_1"`, `alsoReplacesFeatures: ["animal_companion", ...]`), both granting `"shapeshift"`.
   - Runtime resolver (`src/rulesets/dnd35e/shapeshift.ts`, re-exported from `wild_shape.ts` and `dnd35e_ruleset.ts`):
     - `executeDruidShapeshift(state, actorId, formId)` (`'predator' | 'aerial' | 'ferocious_slayer' | 'normal'`):
       - Validates `trait:shapeshift` / `feature:shapeshift` and minimum Druid level (`1` for `'predator'`, `5` for `'aerial'`, `8` for `'ferocious_slayer'`).
       - Consumes `1` Swift Action (`consumeSwiftOrImmediateActionFromBudget(budget, 'swift')`) in TurnBased mode, at-will (no daily pool charge required).
       - Updates `PropertyOverlayComponent` (`overlayId: 'acf:shapeshift'`) and `TacticalDoctrineComponent.activeStanceGroups['druid_shapeshift_form']`:
         - **Predator Form (L1+)**: `+4` enhancement STR, `+4` natural armor AC, `50 ft` land speed (`+20 ft` speed modifier), primary `1d6` Bite natural weapon, `form:shapeshift_predator`.
         - **Aerial Form (L5+)**: `+2` enhancement STR, `+2` natural armor AC, `+2` competence Reflex save, `40 ft` fly speed (`movement:fly`), primary `1d6` Talon natural weapon, `form:shapeshift_aerial`.
         - **Ferocious Slayer Form (L8+)**: `large` size (`sizeCategoryOverride: 'large'`), `+8` enhancement STR, `+8` natural armor AC, `40 ft` land speed (`+10 ft` speed modifier), primary `1d8` Bite + secondary `2x 1d6` Claw natural weapons, `form:shapeshift_ferocious_slayer`.
         - **Normal Form (`'normal'`)**: Removes `'acf:shapeshift'` overlay and clears `activeStanceGroups['druid_shapeshift_form']`.

### 2.3 Sorcerer ACF (`public/data/rulesets/dnd35e/classes/sorcerer.json` & `src/rulesets/dnd35e/magic/`)
- **Metamagic Specialist (`PHB II p. 61`)**:
  - `acfId`: `"sorcerer_metamagic_specialist_1"` at Level 1 (`replacesFeature: "summon_familiar"`, `grantedFeature: "metamagic_specialist"`).
  - Suppresses `familiar_master_effective_level` scaling pool automatically.
  - `featureDetails.metamagic_specialist`:
    - `grantedTags: ["trait:metamagic_specialist"]`
    - `resourcePool: { poolId: "metamagic_specialist", maxBase: 3, abilityModStat: "int", refreshCycle: "rest_8h" }` (`3 + max(0, INT mod)` uses/day).
  - Runtime wiring in `consumeSpellActionBudget` (`src/rulesets/dnd35e/magic/spell_cast_helpers.ts`) and `executeDnD35eSpellCast` (`src/rulesets/dnd35e/magic/spell_cast_resolver.ts`):
    - When `isSpontaneous && meta.hasNonQuickenMetamagic && !meta.isQuickened`, if the caster has `trait:metamagic_specialist` / `feature:metamagic_specialist` and `ResourcePoolComponent.pools['metamagic_specialist'].current >= 1`:
      - Does **not** upgrade casting time to `'full_round'` (retains base `'standard'` action cost, allowing movement + metamagic cast in the same round).
      - Expends `1` charge from `ResourcePoolComponent` pool `'metamagic_specialist'`.

### 2.4 Bard ACFs (`public/data/rulesets/dnd35e/classes/bard.json`, `src/rulesets/dnd35e/skills.ts`, `src/rulesets/dnd35e/magic/spell_cast_effects.ts`)
1. **Bardic Knack (`PHB II p. 35`)**:
   - `acfId`: `"bard_bardic_knack_1"` at Level 1 (`replacesFeature: "bardic_knowledge"`, `grantedFeature: "bardic_knack"`).
   - `featureDetails.bardic_knack`:
     - `grantedTags: ["trait:bardic_knack"]`
     - `scalingPoolContribution: { poolId: "bardic_knack_level", multiplier: 1, offset: 0, minClassLevel: 1 }`.
   - Runtime wiring (`resolveBardicKnackSkillBonus` in `src/rulesets/dnd35e/skills.ts`, wired into `evaluateActorSkillCheck` in `skill_verb_helpers.ts` and `computePassiveSkillModifier` in `dnd35e_ui_char_sheet.ts`):
     - Effective knack rank floor = `Math.max(1, Math.floor(bardicKnackLevel / 2))`.
     - Whenever an actor with `trait:bardic_knack` / `feature:bardic_knack` has `wholeRanks < knackFloor` on a skill check (and either `!definition.trainedOnly` or `wholeRanks >= 1`), emits a `StatModifier` (`sourceId: 'class:bard:bardic_knack'`, `bonusType: 'untyped'`, `value: knackFloor - wholeRanks`) so untrained skills (`0` ranks) receive `+knackFloor` (`floor(bardLevel / 2)`, min 1) and partially trained skills with `< knackFloor` ranks scale up to `knackFloor`!
2. **Healing Hymn (`Complete Champion p. 47`)**:
   - `acfId`: `"bard_healing_hymn_1"` at Level 1 (`replacesFeature: "fascinate"`, `grantedFeature: "healing_hymn"`).
   - `featureDetails.healing_hymn`:
     - `grantedTags: ["trait:healing_hymn"]`
     - `activatedAbilities: [{ abilityId: "healing_hymn", name: "Healing Hymn", actionCost: "standard", usageLimitPoolId: "bardic_music" }]`.
   - Runtime wiring:
     - In `executeDnD35eResourcePoolAbility` (`src/rulesets/dnd35e/combat/pool_ability_resolver.ts`), when an actor with `trait:healing_hymn` / `feature:healing_hymn` activates `pool:bardic_music` (or `pool:healing_hymn`), applies `status:healing_hymn_active` (for `5` rounds) in addition to `pool_bardic_music_active`.
     - In `applySingleSpellUnit` (`src/rulesets/dnd35e/magic/spell_cast_effects.ts`), when resolving `case 'healing'`, `resolveHealingHymnBonus(runningState, casterId)` checks if the caster or any non-hostile ally within `30 ft` has `trait:healing_hymn` / `feature:healing_hymn` and is actively performing (`status:healing_hymn_active`, `status:pool_bardic_music_active`, `status:bardic_music_active`, or `stance:bardic_music:healing_hymn`). If so, adds `+performRanks` (`Math.max(0, Math.floor(bardData.skillRanks['perform'] ?? 0))`) to the healing amount!
