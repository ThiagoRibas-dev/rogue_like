# Implementation Plan — Full D&D 3.5e SRD Requirements, Prerequisites, Grants & Builder UI Alignment

## 1. Architectural Rules & SSOT Ownership (`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SSOT_DND35E.md`)
- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any`, `exactOptionalPropertyTypes: true` (omit optional properties rather than assigning `undefined`), explicit return types on all functions, exhaustive `switch` checks with `assertNever`, named constants or JSON fields for all gameplay thresholds.
- **Rule 14 (Flat Control Flow):** Guard clauses and early returns rather than deeply nested `if/else` blocks.
- **Rule 15 (Cascading Effects Matrix):** All upstream, downstream, and lateral impacts mapped below.
- **Rule 16 & 17 (Three-Tier Placement & Declarative Rules):** All prerequisite definitions live in Tier 3 JSON (`public/data/rulesets/dnd35e/{feats,classes,domains,races,templates}/*.json`), validated at load boundaries by Zod schemas (`effect_system.types.ts`, `creature_system.types.ts`) and cross-reference validators (`class_race_validator.ts`), and evaluated by pure Tier 2 Cartridge functions (`prerequisites.ts`, `builder_prereq_context.ts`).

### SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner | Evicted Legacy / Split-Brain Pattern |
| :--- | :--- | :--- |
| Declarative prerequisite AST & evaluation | `src/rulesets/dnd35e/prerequisites.ts` (`PrerequisiteNode`, `PrerequisiteEvalContext`, `evaluatePrerequisiteAST`) | Ad-hoc BAB approximations (`min_bab: 4/8/12` instead of Fighter 4/8/12) and untargeted `has_feat` checks |
| Prerequisite Zod schema & reference integrity | `src/rulesets/dnd35e/types/system/effect_system.types.ts` (`PrerequisiteNodeSchema`) & `src/rulesets/dnd35e/validation/class_race_validator.ts` (`validatePrerequisiteNodeReferences`) | Unvalidated feat/class/skill/proficiency references in JSON |
| Actor, Level-Up & Creation `PrerequisiteEvalContext` assembly | `src/rulesets/dnd35e/builder/builder_prereq_context.ts` (`buildPrerequisiteContextForActor`, `buildPostLevelUpPrerequisiteContext`, `buildCreationDraftPrerequisiteContext`) | Hand-rolled skeletal `prereqCtx` in `builder_validation.ts:133-150` and `character_builder.ts:99-116`; cross-class summed `totalCasterLevel` |
| Semantic tag projection (`feature:*`, `movement:fly`, `trait:special_attack`) | `src/rulesets/dnd35e/semantic_tags.ts` (`projectDnD35ActorSemanticTags`) | Missing `detail.grantedTags` projection in Horizon 3 / UI preview |
| Ranger Combat Style feat grants | `src/rulesets/dnd35e/progression/ledger_choices.ts` (`collectClassChoiceFeats`) | Duplicate unconditional `virtualFeatGrants: [two_weapon_fighting]` inside `ranger.json` `combat_style` |
| Template eligibility validation | `src/rulesets/dnd35e/templates.ts` (`validateTemplatePrerequisites`, `applyCreatureTemplate`) | Unchecked template application ignoring SRD CL/feat/ability/alignment requirements |
| Divine aligned spell restrictions | `src/rulesets/dnd35e/builder/builder_spells.ts` (`isSpellSelectableForDraft`, `isSpellAlignmentAllowedForActor`) & `src/rulesets/dnd35e/progression/ledger_features_spells.ts` (`buildActorSpellbooksByClass`) | Unrestricted aligned spell access for Good/Evil/Lawful/Chaotic divine casters |

---

## 2. Cascading Effects Matrix (`Rule 15`)

| Change | Upstream (Callers / Producers) | Downstream (Consumers / Validators) | Lateral (Sibling Files / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Extend `PrerequisiteNode` AST, `PrerequisiteNodeSchema`, & `validatePrerequisiteNodeReferences`** (`prerequisites.ts`, `effect_system.types.ts`, `creature_system.types.ts`, `class_race_validator.ts`) | `feats/*.json`, `classes/*.json`, `templates/*.json`, `DnD35AcfSwapSchema`, `DnD35TemplateSchema` | `evaluatePrerequisiteAST`, `validateCharacterCreationStep`, `validateLevelUpStep`, `renderPrerequisiteNodeChecklist` | `tests/ruleset_validators.test.ts`, `tests/dnd35e_equipment_m115.test.ts`, `tests/dnd35e_classes_builder.test.ts` |
| **2. Per-class Caster Level, Spontaneous/Prepared Spell Maxes, Proficiencies & Unified Lv 1 Context** (`builder_prereq_context.ts`, `builder_validation.ts`, `character_builder.ts`) | `applyCharacterCreationToPlayer`, `validateCharacterCreationStep`, `sanitizeDraftOnRaceOrClassChange`, `validateLevelUpStep` | `evaluatePrerequisiteAST` (`min_caster_level`, `min_spell_level`, `has_proficiency`, `min_class_level`, `min_character_level`), `renderCharBuilderFeatsStep` | `tests/dnd35e_phase26_ui_and_showcase.test.ts`, `tests/dnd35e_multiclass_and_builder.test.ts` |
| **3. Project `detail.grantedTags`, `movement:fly`, & `trait:special_attack`** (`semantic_tags.ts`, `druid.json`, `cleric.json`, `paladin.json`, `blackguard.json`, `domains/*.json`) | `rebuildActorStateFromLevelHistory`, `buildPrerequisiteContextForActor`, `evaluateDnD35eEntityDAG` | `natural_spell` (`feature:wild_shape`), `extra_turning` & `improved_turning` (`feature:turn_or_rebuke`), `flyby_attack`/`hover`/`wingover` (`movement:fly`) | `races/{beholder,chimera,manticore,marilith}.json` |
| **4. Enforce Multiclass `allowedAlignments`, ACF `prerequisites`, `ek_bonus_fighter_feat`, & Aligned Spells** (`builder_levelup_validation.ts`, `builder_hydrator_levelup.ts`, `builder_feats.ts`, `builder_spells.ts`, `ledger_features_spells.ts`) | `LevelUpChoice`, `CharacterCreationDraft`, `spells/*.json` (`descriptors`) | `validateLevelUpStep`, `applyLevelUpToActor`, `computeLevelUpFeatSlots`, `isSpellSelectableForDraft`, `buildActorSpellbooksByClass` | `dnd35e_level_up_class.ui.ts`, `dnd35e_level_up_class_options.ui.ts`, `dnd35e_char_builder_class.ui.ts`, `dnd35e_char_builder_spells.ui.ts` |
| **5. Tier 3 JSON SRD Alignment (`feats`, `classes`, `domains`, `races`, `templates`)** | `loader.ts`, `dnd35e_validator.ts` | All runtime systems, Character Creation, Level-Up, Monster Hydration, Bestiary Templates | `tests/dnd35e_phase26_ui_and_showcase.test.ts`, `tests/dnd35e_classes_builder.test.ts`, `tests/dnd35e_equipment_m115.test.ts`, `tests/console_ui_architecture.test.ts` |
| **6. Feat Picker, Level-Up Class, & Inspector UI** (`dnd35e_char_builder_feats.ui.ts`, `dnd35e_feat_spell_inspector.ui.ts`, `dnd35e_level_up_class.ui.ts`) | `renderCharBuilderFeatsStep`, `renderLevelUpModal` | DOM rendering for stacking/targeted feats, crossbow filter for `rapid_reload`, full AST checklist labels | `docs/SSOT_DND35E.md` (regenerated via `bun scripts/map-codebase.ts`) |

---

## 3. Step-by-Step Implementation Plan with Enhanced Code Snippets

### Step 1: Extend `PrerequisiteNode` AST, Schemas, and Cross-Reference Validator

#### 1.1 `src/rulesets/dnd35e/prerequisites.ts`
Extend `PrerequisiteNode` and `PrerequisiteEvalContext` to support all strict SRD requirements without any hardcoded feat/class branches:

```ts
import { dndFloor } from './math/multipliers.ts';
import type { AbilityId, CreatureSizeCategory, DnD35Alignment, DnD35SpellSchool } from './types/dnd35e.types.ts';

/** Scope categories for declarative proficiency checks (`has_proficiency`). */
export type ProficiencyPrerequisiteScope =
  | 'selected_weapon'
  | 'weapon'
  | 'martial_all'
  | 'simple_all'
  | 'armor_light'
  | 'armor_medium'
  | 'armor_heavy'
  | 'shield'
  | 'tower_shield';

export type PrerequisiteNode =
  | { readonly type: 'and'; readonly children: ReadonlyArray<PrerequisiteNode> }
  | { readonly type: 'or'; readonly children: ReadonlyArray<PrerequisiteNode> }
  | { readonly type: 'not'; readonly child: PrerequisiteNode }
  | { readonly type: 'min_ability'; readonly ability: AbilityId; readonly minScore: number }
  | { readonly type: 'min_bab'; readonly minBab: number }
  | { readonly type: 'min_skill_ranks'; readonly skillId: string; readonly minRanks: number }
  | {
      readonly type: 'min_skill_count_at_ranks';
      readonly skillPrefix: string;
      readonly minRanks: number;
      readonly minCount: number;
    }
  | {
      readonly type: 'has_feat';
      readonly featId: string;
      readonly targetId?: string | undefined;
      readonly targetPrefix?: string | undefined;
      readonly targetIdsAny?: ReadonlyArray<string> | undefined;
    }
  | {
      readonly type: 'min_feat_count';
      readonly pool: 'metamagic_or_item_creation';
      readonly minCount: number;
    }
  | { readonly type: 'has_tag'; readonly tag: string }
  | { readonly type: 'min_caster_level'; readonly minCasterLevel: number }
  | { readonly type: 'min_class_level'; readonly classId: string; readonly minLevel: number }
  | { readonly type: 'min_character_level'; readonly minLevel: number }
  | {
      readonly type: 'has_proficiency';
      readonly scope: ProficiencyPrerequisiteScope;
      readonly weaponId?: string | undefined;
    }
  | { readonly type: 'min_natural_attacks'; readonly minCount: number }
  | { readonly type: 'min_hands'; readonly minHands: number }
  | { readonly type: 'min_natural_armor'; readonly minBonus: number }
  | { readonly type: 'min_fly_speed'; readonly minSpeedFt: number }
  | { readonly type: 'min_sla_caster_level'; readonly minCasterLevel: number }
  | {
      readonly type: 'size_in';
      readonly allowedSizes: ReadonlyArray<CreatureSizeCategory>;
    }
  | {
      readonly type: 'alignment_in';
      readonly allowedAlignments: ReadonlyArray<DnD35Alignment>;
    }
  | {
      readonly type: 'min_spell_level';
      readonly tradition: 'arcane' | 'divine' | 'any';
      readonly minSpellLevel: number;
      readonly castingMode?: 'prepared' | 'spontaneous' | 'any' | undefined;
      readonly school?: DnD35SpellSchool | undefined;
      readonly minSchoolSpellCount?: number | undefined;
    }
  | {
      readonly type: 'race_in';
      readonly allowedRaces: ReadonlyArray<string>;
    };

export interface PrerequisiteEvalContext {
  readonly abilityScores: Readonly<Record<AbilityId, number | null>>;
  readonly totalBab: number;
  readonly skillRanks: Readonly<Record<string, number>>;
  readonly feats: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly casterLevel: number;
  readonly sizeCategory: CreatureSizeCategory;
  readonly alignment?: DnD35Alignment | undefined;
  readonly raceId?: string | undefined;
  readonly maxArcaneSpellLevel?: number | undefined;
  readonly maxDivineSpellLevel?: number | undefined;
  readonly maxPreparedArcaneSpellLevel?: number | undefined;
  readonly maxSpontaneousArcaneSpellLevel?: number | undefined;
  readonly maxPreparedDivineSpellLevel?: number | undefined;
  readonly maxSpontaneousDivineSpellLevel?: number | undefined;
  readonly classLevels?: Readonly<Record<string, number>> | undefined;
  readonly characterLevel?: number | undefined;
  readonly proficientWeaponCategories?: ReadonlyArray<'simple' | 'martial' | 'exotic'> | undefined;
  readonly proficientWeaponIds?: ReadonlyArray<string> | undefined;
  readonly proficientArmorCategories?: ReadonlyArray<'light' | 'medium' | 'heavy'> | undefined;
  readonly proficientShieldCategories?: ReadonlyArray<'shield' | 'tower'> | undefined;
  readonly naturalAttackCount?: number | undefined;
  readonly handCount?: number | undefined;
  readonly naturalArmorBonus?: number | undefined;
  readonly flySpeedFt?: number | undefined;
  readonly maxSlaCasterLevel?: number | undefined;
  readonly metamagicOrItemCreationFeatCount?: number | undefined;
  readonly spellCountBySchool?: Readonly<Partial<Record<DnD35SpellSchool, number>>> | undefined;
  readonly maxSpellLevelBySchool?: Readonly<Partial<Record<DnD35SpellSchool, number>>> | undefined;
  readonly arcaneSchool?: DnD35SpellSchool | 'universal' | undefined;
  readonly targetId?: string | undefined;
}
```

Key evaluation rules in `evaluatePrerequisiteAST`:
- **`has_feat`**:
  - If `node.featId.includes(':')` or `node.targetId !== undefined`: match exact target (`const reqTarget = node.targetId ?? node.featId.split(':')[1]!; const baseId = node.featId.split(':')[0]!;` checks `context.feats.includes(`${baseId}:${reqTarget}`)` or `${baseId}_${reqTarget}`).
  - Else if `node.targetIdsAny && node.targetIdsAny.length > 0`: check if `context.feats` contains `${node.featId}:${t}` or `${node.featId}_${t}` for any `t` in `node.targetIdsAny`.
  - Else if `node.targetPrefix !== undefined`: check if `context.feats.some((f) => (f.startsWith(`${node.featId}:`) && f.slice(node.featId.length + 1).startsWith(node.targetPrefix!)) || (f.startsWith(`${node.featId}_`) && f.slice(node.featId.length + 1).startsWith(node.targetPrefix!)))`.
  - Else if `context.targetId !== undefined`: check `${node.featId}:${context.targetId}`, `${node.featId}_${context.targetId}`, or untargeted `node.featId`.
  - Else: check `context.feats.includes(node.featId)` or any `${node.featId}:*` / `${node.featId}_*`.
- **`has_proficiency`**:
  - Natural/unarmed/touch targets (`'unarmed_strike'`, `'grapple'`, `'ray'`, `'bite'`, `'claw'`, `'slam'`, `'gore'`, `'sting'`, `'tail_slap'`, `'tentacle'`, `'hoof'`, `'wing'`, `'talon'`, `'pincers'`, `'spikes'`) are universally proficient per SRD.
  - For `'selected_weapon'` / `'weapon'`: checks `targetWeaponId = node.weaponId ?? context.targetId`. If `!targetWeaponId`, returns `true` only if `proficientWeaponCategories` includes `'simple'` or `'martial'` or `proficientWeaponIds` is non-empty (or if `proficientWeaponCategories === undefined` in minimal unit test contexts without proficiency fields, see below: when `proficientWeaponCategories` AND `proficientWeaponIds` are both `undefined` on synthetic mock contexts, fall back to checking `tags` / `feats` or default appropriately; wait — let's make sure `buildPrerequisiteContextForActor` always populates `proficientWeaponCategories` and `proficientWeaponIds`, and for `weapon` check weapon category / ID!).
- **`min_class_level`**: `(context.classLevels?.[node.classId] ?? 0) >= node.minLevel`.
- **`min_character_level`**: `(context.characterLevel ?? 1) >= node.minLevel`.
- **`min_spell_level`**:
  - Evaluates `tradition` (`arcane` | `divine` | `any`), optional `castingMode` (`spontaneous` | `prepared` | `any`), optional `school` + `minSchoolSpellCount` (for *Loremaster*: `school: 'divination'`, `minSchoolSpellCount: 7`, `minSpellLevel: 3`).

#### 1.2 `src/rulesets/dnd35e/types/system/effect_system.types.ts` & `creature_system.types.ts` & `class_race_validator.ts`
- Mirror all new `PrerequisiteNode` variants in `PrerequisiteNodeSchema`.
- Add `prerequisites: PrerequisiteNodeSchema.optional()` and `requiredArcaneSchool: DnD35SpellSchoolSchema.optional()` to `DnD35AcfSwapSchema`.
- Add `prerequisites: PrerequisiteNodeSchema.optional()` and `allowedAlignments: z.array(DnD35AlignmentSchema).optional()` to `DnD35TemplateSchema`.
- Update `validatePrerequisiteNodeReferences` in `src/rulesets/dnd35e/validation/class_race_validator.ts` to validate:
  - `min_class_level`: `sys.classes[node.classId]` must exist.
  - `min_skill_count_at_ranks`: at least one skill in `sys.skills` must start with `node.skillPrefix`.
  - `has_proficiency`: if `node.weaponId` is set, `sys.items[node.weaponId]` must exist.
  - Also validate `acf.prerequisites` on every class ACF and `tmpl.prerequisites` on every template!

---

### Step 2: Canonical Proficiency, Caster Level & Unified Level 1 Prerequisite Context

#### 2.1 `src/rulesets/dnd35e/semantic_tags.ts`
Update `projectDnD35ActorSemanticTags` so that:
1. Active class features in `dndData.activeClassFeatures` project their `classRegistry[trackId]?.featureDetails[featId]?.grantedTags` even when `existingTags` is not pre-populated (fixing Horizon 3 / UI preview for `feature:wild_shape` and `feature:turn_or_rebuke`).
2. Active domains in `dndData.domains` project their `domainRegistry?.[domId]?.grantedPowerBundle?.grantedTags`.
3. `dndData.movementModes?.fly !== undefined && dndData.movementModes.fly > 0` projects `'movement:fly'`.
4. `dndData.breathWeapon !== undefined || (dndData.activeClassFeatures ?? []).some((f) => f.startsWith('sneak_attack') || f.startsWith('smite_') || f === 'death_attack')` projects `'trait:special_attack'`.

#### 2.2 `src/rulesets/dnd35e/builder/builder_prereq_context.ts`
Create a single canonical proficiency & casting context builder used by:
- `buildPrerequisiteContextForActor(dndData, classRegistry, sysContent?)`
- `buildPostLevelUpPrerequisiteContext(dndData, choice, classDef, sysContent, accumulatedFeatsThisLevel)`
- `buildCreationDraftPrerequisiteContext(draft, sysContent, accumulatedFeatsThisStep)`

```ts
/** Minimum class level at which half-casters (Paladin, Ranger) gain a Caster Level (`4`). */
const HALF_CASTER_MIN_CLASS_LEVEL = 4;

/** Divisor for half-caster Caster Level (`floor(effectiveClassLevel / 2)`). */
const HALF_CASTER_CL_DIVISOR = 2;

/** Standard hand count for humanoid/quadruped vs 6-armed Marilith body plans. */
const MARILITH_HAND_COUNT = 6;
const DEFAULT_BIPED_HAND_COUNT = 2;
```
- **Half-Caster & Single-Class Caster Level Rule:**
  - For `paladin` and `ranger`, class caster level is `effectiveLevel >= HALF_CASTER_MIN_CLASS_LEVEL ? dndFloor(effectiveLevel / HALF_CASTER_CL_DIVISOR) : 0`.
  - For all other spellcasting classes (`wizard`, `sorcerer`, `cleric`, `druid`, `bard`, `adept`, `assassin`, `blackguard`), class caster level is `computeEffectiveClassCastingLevel(tracks, classDef, classRegistry, levelHistory)`.
  - `casterLevel` is `Math.max(0, ...perClassCasterLevels)` (never summed across classes!).
- **Proficiency Resolution:**
  - Collects `proficientWeaponCategories` (`'simple'`, `'martial'`, `'exotic'`), `proficientWeaponIds` (specific class weapons + `martial_weapon_proficiency:<id>` + `exotic_weapon_proficiency:<id>` + War domain `deityFavoredWeaponId` + racial `weaponFamiliarityIds` promoted from exotic to martial when the actor has `'martial'` category proficiency, plus `composite_longbow` $\leftrightarrow$ `longbow` and `composite_shortbow` $\leftrightarrow$ `shortbow` equivalence per SRD), `proficientArmorCategories` (`'light'`, `'medium'`, `'heavy'`), and `proficientShieldCategories` (`'shield'`, `'tower'`).
- **Metamagic / Item Creation Count & Divination Spell Count:**
  - Counts owned + selected feats where `featDef.metamagicDescriptor !== undefined || WIZARD_BONUS_ITEM_CREATION_AND_MASTERY_FEATS.includes(baseFeatId) && baseFeatId !== 'spell_mastery'`.
  - Computes known/accessible Divination spells across `spellbooksByClass` (or class spell list for `prayerbook_full_list` casters up to `maxCastableLevel`) and highest castable Divination spell level.

---

### Step 3: Multiclass Alignment, ACF Prerequisites, Eldritch Knight Slot & Aligned Spells

#### 3.1 `src/rulesets/dnd35e/builder/builder_levelup_validation.ts` & `builder_hydrator_levelup.ts`
In both `validateLevelUpStep` (`stepKey === 'class'`) and `applyLevelUpToActor`:
```ts
if (classDef.allowedAlignments && classDef.allowedAlignments.length > 0) {
  if (!dndData.alignment || !classDef.allowedAlignments.includes(dndData.alignment)) {
    return {
      valid: false,
      reason: `${classDef.name} requires alignment in: ${classDef.allowedAlignments.join(', ')}.`
    };
  }
}
```
And validate selected ACFs against `acf.requiredArcaneSchool` and `acf.prerequisites`:
```ts
for (const acfId of choice.selectedAcfs ?? []) {
  const acf = classDef.acfSwaps.find((a) => a.acfId === acfId && a.level === nextClassLevel);
  if (!acf) {
    return { valid: false, reason: `Invalid Alternate Class Feature "${acfId}" for ${classDef.name} level ${nextClassLevel}.` };
  }
  if (acf.requiredArcaneSchool && dndData.arcaneSchool !== acf.requiredArcaneSchool) {
    return { valid: false, reason: `${acf.name} requires ${acf.requiredArcaneSchool} school specialization.` };
  }
  if (acf.prerequisites && !evaluatePrerequisiteAST(acf.prerequisites, prereqCtx)) {
    return { valid: false, reason: `Prerequisites not met for Alternate Class Feature: ${acf.name}.` };
  }
}
```
(Mirror the same ACF check in `validateCharacterCreationStep` and `sanitizeDraftOnRaceOrClassChange`.)

#### 3.2 `src/rulesets/dnd35e/builder/builder_feats.ts`
Update `computeLevelUpFeatSlots` (line 196) to include `ek_bonus_fighter_feat`:
```ts
if (fId.startsWith('fighter_bonus_feat') || fId === 'ek_bonus_fighter_feat') {
  slots.push({
    slotIndex: slotIndex++,
    poolType: 'fighter_bonus',
    label: `Fighter Bonus Feat (${classDef.name} ${nextClassLevel})`
  });
}
```

#### 3.3 `src/rulesets/dnd35e/builder/builder_spells.ts` & `src/rulesets/dnd35e/progression/ledger_features_spells.ts`
Add SRD Divine Aligned Spell filtering:
```ts
/**
 * Checks whether a spell's alignment descriptors (`good`, `evil`, `lawful`, `chaotic`)
 * are permitted for a caster of `alignment` in `classId`.
 * Per SRD, Clerics, Druids, Paladins, and Blackguards cannot cast spells with an alignment
 * descriptor opposed to their alignment.
 */
export function isSpellAlignmentAllowedForActor(
  spell: DnD35SpellDefinition,
  classId: string,
  alignment?: DnD35Alignment
): { readonly allowed: boolean; readonly reason?: string } {
  if (!alignment) return { allowed: true };
  const divineRestrictedClasses = ['cleric', 'druid', 'paladin', 'blackguard', 'ranger', 'adept'];
  if (!divineRestrictedClasses.includes(classId)) return { allowed: true };

  const descriptors = (spell.descriptors ?? []).map((d) => d.toLowerCase());
  const isGood = alignment.endsWith('G');
  const isEvil = alignment.endsWith('E');
  const isLawful = alignment.startsWith('L');
  const isChaotic = alignment.startsWith('C');

  if (isGood && descriptors.includes('evil')) {
    return { allowed: false, reason: 'Good divine casters cannot cast [Evil] spells' };
  }
  if (isEvil && descriptors.includes('good')) {
    return { allowed: false, reason: 'Evil divine casters cannot cast [Good] spells' };
  }
  if (isLawful && (descriptors.includes('chaotic') || descriptors.includes('chaos'))) {
    return { allowed: false, reason: 'Lawful divine casters cannot cast [Chaotic] spells' };
  }
  if (isChaotic && (descriptors.includes('lawful') || descriptors.includes('law'))) {
    return { allowed: false, reason: 'Chaotic divine casters cannot cast [Lawful] spells' };
  }
  return { allowed: true };
}
```
Integrate `isSpellAlignmentAllowedForActor` into `isSpellSelectableForDraft` (accepting optional `alignment?: DnD35Alignment`) and `buildActorSpellbooksByClass` (`ledger_features_spells.ts`).

#### 3.4 `src/rulesets/dnd35e/templates.ts`
Add `validateTemplatePrerequisites(base, template, sysContent?)` checking `targetCreatureTypes`, `allowedAlignments`, and `template.prerequisites`, and support optional `{ enforcePrerequisites?: boolean }` in `applyCreatureTemplate`.

---

### Step 4: Tier 3 System Content JSON Updates (`public/data/rulesets/dnd35e/`)

#### 4.1 Feats (`public/data/rulesets/dnd35e/feats/*.json`)
1. `power_attack.json`:
   ```json
   "prerequisites": {
     "type": "min_ability",
     "ability": "str",
     "minScore": 13
   }
   ```
2. `extra_turning.json` & `improved_turning.json`:
   ```json
   "prerequisites": {
     "type": "has_tag",
     "tag": "feature:turn_or_rebuke"
   }
   ```
3. `leadership.json`:
   ```json
   "prerequisites": {
     "type": "min_character_level",
     "minLevel": 6
   }
   ```
4. `augment_summoning.json`:
   ```json
   "prerequisites": {
     "type": "has_feat",
     "featId": "spell_focus",
     "targetId": "conjuration"
   }
   ```
5. `weapon_focus.json`:
   ```json
   "prerequisites": {
     "type": "and",
     "children": [
       { "type": "has_proficiency", "scope": "selected_weapon" },
       { "type": "min_bab", "minBab": 1 }
     ]
   }
   ```
6. `improved_critical.json`:
   ```json
   "prerequisites": {
     "type": "and",
     "children": [
       { "type": "has_proficiency", "scope": "selected_weapon" },
       { "type": "min_bab", "minBab": 8 }
     ]
   }
   ```
7. `weapon_specialization.json`:
   ```json
   "prerequisites": {
     "type": "and",
     "children": [
       { "type": "has_proficiency", "scope": "selected_weapon" },
       { "type": "has_feat", "featId": "weapon_focus" },
       { "type": "min_class_level", "classId": "fighter", "minLevel": 4 }
     ]
   }
   ```
8. `greater_weapon_focus.json`:
   ```json
   "prerequisites": {
     "type": "and",
     "children": [
       { "type": "has_proficiency", "scope": "selected_weapon" },
       { "type": "has_feat", "featId": "weapon_focus" },
       { "type": "min_class_level", "classId": "fighter", "minLevel": 8 }
     ]
   }
   ```
9. `greater_weapon_specialization.json`:
   ```json
   "prerequisites": {
     "type": "and",
     "children": [
       { "type": "has_proficiency", "scope": "selected_weapon" },
       { "type": "has_feat", "featId": "weapon_focus" },
       { "type": "has_feat", "featId": "weapon_specialization" },
       { "type": "has_feat", "featId": "greater_weapon_focus" },
       { "type": "min_class_level", "classId": "fighter", "minLevel": 12 }
     ]
   }
   ```
10. `rapid_reload.json`:
    ```json
    "prerequisites": {
      "type": "has_proficiency",
      "scope": "selected_weapon"
    }
    ```
11. `armor_proficiency_medium.json`, `armor_proficiency_heavy.json`, `improved_shield_bash.json`, `tower_shield_proficiency.json`:
    - `armor_proficiency_medium`: `{ "type": "has_proficiency", "scope": "armor_light" }`
    - `armor_proficiency_heavy`: `{ "type": "and", "children": [{ "type": "has_proficiency", "scope": "armor_light" }, { "type": "has_proficiency", "scope": "armor_medium" }] }`
    - `improved_shield_bash` & `tower_shield_proficiency`: `{ "type": "has_proficiency", "scope": "shield" }`
12. Monster & Flight Feats:
    - `multiattack.json`: `{ "type": "min_natural_attacks", "minCount": 3 }`
    - `multiweapon_fighting.json`: `{ "type": "and", "children": [{ "type": "min_ability", "ability": "dex", "minScore": 13 }, { "type": "min_hands", "minHands": 3 }] }`
    - `improved_natural_armor.json`: `{ "type": "and", "children": [{ "type": "min_natural_armor", "minBonus": 1 }, { "type": "min_ability", "ability": "con", "minScore": 13 }] }`
    - `improved_natural_attack.json`: `{ "type": "and", "children": [{ "type": "min_natural_attacks", "minCount": 1 }, { "type": "min_bab", "minBab": 4 }] }`
    - `flyby_attack.json`, `hover.json`, `wingover.json`: `{ "type": "min_fly_speed", "minSpeedFt": 1 }`
    - `ability_focus.json`: `{ "type": "has_tag", "tag": "trait:special_attack" }`
    - `empower_spell_like_ability.json`: `{ "type": "min_sla_caster_level", "minCasterLevel": 6 }`
    - `quicken_spell_like_ability.json`: `{ "type": "min_sla_caster_level", "minCasterLevel": 10 }`

#### 4.2 Classes & Domains (`public/data/rulesets/dnd35e/classes/*.json` & `domains/*.json`)
- **`arcane_archer.json`**: `has_feat` on `weapon_focus` with `targetIdsAny: ["longbow", "shortbow", "composite_longbow", "composite_shortbow"]`.
- **`blackguard.json`**: Add `{ "type": "min_skill_ranks", "skillId": "knowledge_religion", "minRanks": 2 }` to `prerequisites.children`; add `featureDetails.command_undead` with `grantedTags: ["feature:turn_or_rebuke"]`, `scalingPoolContribution: { "poolId": "turn_undead_effective_level", "multiplier": 1, "offset": -2, "minClassLevel": 3 }`, and `resourcePool: { "poolId": "turn_undead", "maxBase": 3, "abilityModStat": "cha", "refreshCycle": "rest_8h" }`.
- **`dragon_disciple.json`**: Add `{ "type": "not", "child": { "type": "has_tag", "tag": "type:dragon" } }` and `"castingMode": "spontaneous"` on `min_spell_level`.
- **`eldritch_knight.json`**: Add `{ "type": "has_proficiency", "scope": "martial_all" }` to `prerequisites.children`.
- **`loremaster.json`**:
  ```json
  "prerequisites": {
    "type": "and",
    "children": [
      { "type": "min_skill_count_at_ranks", "skillPrefix": "knowledge_", "minRanks": 10, "minCount": 2 },
      { "type": "has_feat", "featId": "skill_focus", "targetPrefix": "knowledge_" },
      { "type": "min_feat_count", "pool": "metamagic_or_item_creation", "minCount": 3 },
      { "type": "min_spell_level", "tradition": "any", "minSpellLevel": 3, "school": "divination", "minSchoolSpellCount": 7 }
    ]
  }
  ```
- **`wizard.json`**: Add `"grantedFeats": ["scribe_scroll"]` to `featureDetails.scribe_scroll`; add `"requiredArcaneSchool": "conjuration"` to `wizard_abrupt_jaunt_1`; fix `"crossbow_heavy"`, `"crossbow_light"` $\rightarrow$ `"heavy_crossbow"`, `"light_crossbow"`.
- **`druid.json`**: Add `"grantedTags": ["feature:wild_shape"]` to `featureDetails.wild_shape_1`.
- **`ranger.json`**: Add `featureDetails.endurance` (`"grantedFeats": ["endurance"]`); remove `"virtualFeatGrants"` from `featureDetails.combat_style` (handled via `collectClassChoiceFeats` based on `combatStyle`).
- **`cleric.json` & `paladin.json` & `domains/{air,earth,fire,water,plant}.json`**: Add `"feature:turn_or_rebuke"` to `grantedTags` on `turn_or_rebuke_undead`, `turn_undead_paladin`, and the 5 elemental/plant turning domains.
- **`assassin.json`, `monk.json`, `shadowdancer.json`**: Fix weapon IDs (`"hand_crossbow"`, `"light_crossbow"`, `"heavy_crossbow"`, `"light_mace"`).

#### 4.3 Races & Templates (`public/data/rulesets/dnd35e/races/*.json` & `templates/*.json`)
- `beholder.json`: `"movementModes": { "land": 5, "fly": 20 }`.
- `chimera.json`: `"movementModes": { "land": 30, "fly": 50 }`.
- `manticore.json`: `"movementModes": { "land": 30, "fly": 50 }`.
- `marilith.json`: Add primary `"slam"` natural weapon (`"count": 6`, `"damageDice": "1d8"`).
- `templates/*.json`: Expand `targetCreatureTypes` to strict SRD lists and add declarative `allowedAlignments` and `prerequisites` (`lich`: CL 11 + `craft_wondrous_item`, `ghost`: CHA 6, `half_celestial`: INT 4).

---

### Step 5: Character Builder, Level-Up & Inspector UI Updates

1. **`src/rendering/ui/dnd35e_char_builder_feats.ui.ts`:**
   - Pass auto-granted Lv 1 feats (`prereqCtx.feats`) as `alreadyOwnedFeatIds` in `renderCharBuilderFeatsStep`.
   - Support `repeatable.mode === 'stacking'` (`toughness`, `extra_turning`) so they can be added multiple times and show a count badge (e.g. `×2`).
   - Support `repeatable.mode === 'targeted'` so selecting one target (`weapon_focus:longsword`) does not block selecting a second target (`weapon_focus:shortbow`), while preventing duplicate selection of the *exact same* `featId:targetId`.
   - For `rapid_reload`, filter the target dropdown options to crossbows (`hand_crossbow`, `light_crossbow`, `heavy_crossbow`).
   - Persist selected dropdown targets in a module-scoped `Map<string, string>` (`selectedTargetByFeatId`) and attach a `change` listener to `targetSelect` so changing the target immediately updates eligibility (`🟢`/`🔴`) and refreshes `renderFeatInspector`.
2. **`src/rendering/ui/dnd35e_feat_spell_inspector.ui.ts`:**
   - Format all 20 `PrerequisiteNode` types with clear, human-readable SRD descriptions (`Fighter Level 4+`, `Character Level 6+`, `Proficiency with selected weapon`, `Any 2 Knowledge skills (10+ ranks)`, `3+ Metamagic or Item Creation feats`, `Spontaneous Arcane Spell Level 1+`, `Size: Huge, Gargantuan, Colossal`, `Not: Dragon type`, etc.).
3. **`src/rendering/ui/dnd35e_level_up_class.ui.ts`, `dnd35e_level_up_class_options.ui.ts`, `dnd35e_char_builder_class.ui.ts`, `dnd35e_char_builder_spells.ui.ts`:**
   - Check `cls.allowedAlignments` in `renderLevelUpClassStage` and show `Alignment Restricted` when not met.
   - Disable or hide ACFs whose `requiredArcaneSchool` or `prerequisites` are not met.
   - Pass actor `alignment` into `isSpellSelectableForDraft` and `computeClassSpellSelectionBudget` in Creation and Level-Up spell steps.

---

### Step 6: Test Updates & Verification Pipeline

1. Update coupled test expectations:
   - `tests/dnd35e_phase26_ui_and_showcase.test.ts`:
     - Line 162: Replace duplicate `'scribe_scroll'` in Wizard's manual `selectedFeats` with `'spell_focus:evocation'` (and assert `'scribe_scroll'` is automatically present in `dndData.feats`).
     - Line 190: Update Power Attack test to verify that a Lv 1 Cleric with STR 16 **can** take `power_attack` (BAB +0 allowed per SRD), while a Lv 1 Cleric with STR 12 is **rejected** for `power_attack`, and a Lv 1 Cleric (BAB +0) is **rejected** for `weapon_focus:mace_heavy` / `quick_draw` (BAB +1 required).
   - `tests/dnd35e_classes_builder.test.ts`:
     - Line 174: Use `'weapon_focus:longbow'` for `arcane_archer` prerequisite test, and verify `'weapon_focus:dagger'` fails.
     - Line 579: Pass `combatStyle: 'two_weapon'` via `collectClassChoiceFeats` (or verify `collectClassChoiceFeats` grants `two_weapon_fighting` in light armor and suppresses it in heavy armor).
   - `tests/dnd35e_equipment_m115.test.ts`:
     - Line 411: Include `classLevels: { fighter: 4 }` and `proficientWeaponCategories: ['simple', 'martial']` in `weapon_specialization` test context, and also assert Fighter 3 fails.
   - `tests/dnd35e_multiclass_and_builder.test.ts`:
     - Line 303: Use `'weapon_focus:longsword'` instead of untargeted `'weapon_focus'`.
   - `tests/console_ui_architecture.test.ts`:
     - Line 139: Use `'spell_focus:conjuration'`.
2. Add dedicated SRD prerequisite unit tests covering `extra_turning`, `leadership`, `augment_summoning`, `weapon_specialization` / `greater_weapon_focus` / `greater_weapon_specialization`, `rapid_reload`, `blackguard`, `dragon_disciple`, `eldritch_knight`, `loremaster`, half-caster CL, multiclass alignment checks, and aligned spell restrictions.
3. Run `./verify.sh` across all 8 stages (`tsc`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `build`, `run-validator.ts`).
