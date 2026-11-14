# Implementation Plan: Milestone 132 Post-Audit Remediation & Milestone Documentation

## 1. Architectural Rules & Standards
- **ECS Purity & Immutability**: All component states remain JSON-serializable records; state updates return new objects.
- **TypeScript Strictness (`AGENTS.md` Rules 10–14)**: Zero `any`, explicit return types on all functions, named constants/enums, exhaustive `switch` (`assertNever`), flat control flow.
- **Rule 15 (Cascading Effects Matrix)**: Upstream, downstream, and lateral impacts are mapped below.
- **Rule 17 (StatModifier vs. RuleOverride Boundary)**: Numeric save DC bonuses (`special_ability_save_dc`) and damage size steps (`natural_damage_size_step`) use `StatModifier` and `resolveTypedModifiersWithBreakdown`.
- **Rule 21 (Zero Content-ID or Bespoke-Property Branching — "New Content Mod" Litmus Test)**: All legacy content-ID branches in touched files (`effect_bundle.ts`, `ledger_choices.ts`, `builder_prereq_proficiencies.ts`, `semantic_tags.ts`) are replaced with declarative schema properties and Tier 3 JSON definitions.

---

## 2. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling Modules / Docs / SSOT) |
| :--- | :--- | :--- | :--- |
| **1. Live `OnHitRiderDescriptor` Combat Pipeline Wiring** | `NaturalWeaponDescriptor.riders` in `races/*.json` & `templates/*.json`; `buildActorNaturalWeaponLimbs` (`dnd35e_equipped_item_dag.ts`); `resolveActorAttackRoutine` (`attack_routine.ts`) | `executeCombatStrikeExchange` (`combat_exchange_pipeline.ts`); `shouldTriggerOnHitRider` & `resolveSpecialAbilitySaveDc` (`maneuvers_conditions.ts`); `resolveSavingThrow` & `mitigateIncomingDamage` (`damage_vitality.ts`) | `DnD35ResolvedStrikeProfile`, `NaturalWeaponLimbEntry`, combat log messages, `tests/dnd35e_feat_mechanics_fixes.test.ts` |
| **2. Owned-Target Prerequisite Gating & Dropdown Filtering (`Ability Focus` & `Improved Natural Attack`)** | `builder_prereq_context.ts`, `builder_draft_prereq_context.ts`, `builder_levelup_prereq_context.ts`, `races.ts`, `templates.ts`, `semantic_tags.ts`, `ability_focus.json`, `stunning_fist.json` | `evaluatePrerequisiteAST` (`prerequisites.ts`), `getFeatTargetOptions` & `buildFeatTargetSelect` (`dnd35e_char_builder_feat_row.ui.ts`), `renderSharedFeatsStep` (`dnd35e_char_builder_feats.ui.ts`), `renderFeatInspector` (`dnd35e_feat_spell_inspector.ui.ts`) | `docs/dnd35e/SPECIAL_ATTACKS_AND_TAGS.md`, `half_dragon_*.json`, `rogue.json`, `assassin.json`, `paladin.json`, `blackguard.json`, `sun.json` |
| **3. Rule 21 Legacy Content-ID Fallback Eviction** | `effect_bundle.ts`, `ledger_choices.ts`, `builder_prereq_proficiencies.ts`, `semantic_tags.ts`, `domains/war.json`, `classes/ranger.json`, `*bow.json` | `DnD35DomainDefinitionSchema`, `DnD35ClassFeatureDetailSchema`, `DnD35WeaponStatsSchema`, `run-validator.ts` | `docs/DECISIONS.md`, `docs/ARCHITECTURE.md` |
| **4. Milestone Documentation (`docs/MILESTONES.md`)** | Completed M132 tasks & verification metrics | Project roadmap tracking (`docs/MILESTONES.md`) | `docs/SSOT_DND35E.md`, `docs/ssot/ssot_dnd35e.json` |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :---: |
| **Weapon / Skill / School / Ability Target Binding (`effect_bundle.ts`)** | `featDef.id.startsWith('weapon_') \|\| featDef.id === 'improved_critical' \|\| featDef.id.includes('weapon_proficiency')` | Strictly read `featDef.repeatable?.targetCategory` (`'weapon' \| 'natural_weapon' \| 'skill' \| 'school' \| 'ability'`) and `baseBundle.category === 'proficiency'` | **YES** |
| **Composite & Standard Bow Proficiency Equivalence (`builder_prereq_proficiencies.ts`)** | `if (weaponIds.has('longbow')) weaponIds.add('composite_longbow')` | `proficiencyEquivalentWeaponId?: string` on `DnD35WeaponStatsSchema` authored in `longbow.json`, `composite_longbow.json`, `shortbow.json`, `composite_shortbow.json` | **YES** |
| **War Domain Deity Favored Weapon Grants (`ledger_choices.ts`)** | `if (domains.includes('war') && deityFavoredWeaponId)` | `grantsDeityFavoredWeaponProficiencyAndFocus?: boolean` on `DnD35DomainDefinitionSchema` authored in `domains/war.json` | **YES** |
| **Ranger Combat Style Virtual Feat Progression (`ledger_choices.ts`)** | `if (combatStyle === 'archery') { if (activeFeatures.includes('combat_style')) ... }` | `combatStyleFeatByChoice?: Record<string, string>` on `DnD35ClassFeatureDetailSchema` authored on `combat_style`, `improved_combat_style`, and `combat_style_mastery` in `classes/ranger.json`, gated by `isActivationConditionMet` | **YES** |
| **Barbarian Illiteracy Suppression by Literacy (`semantic_tags.ts`)** | `if (featId === 'illiteracy' && tags.has('trait:literate')) continue;` | `activationCondition: { selfTagsNone: ['trait:literate'] }` already declared on `illiteracy` in `classes/barbarian.json`, evaluated by `isActivationConditionMet` | **YES** |
| **Owned Special Attack & Natural Weapon Target Gating (`prerequisites.ts`, `dnd35e_char_builder_feat_row.ui.ts`)** | Hardcoding `if (feat.id === 'ability_focus')` or monster-specific lookup tables | `special_attack:<id>` tags in `grantedTags` + `"tag": "special_attack:$selected"` AST interpolation + `PrerequisiteEvalContext.naturalWeaponIds` | **YES** |

---

## 4. Detailed Step-by-Step Implementation & Code Snippets

### Diff 1: Thread `onHitRiders` Through Attack Routine & Execute in `combat_exchange_pipeline.ts`

1. **`src/rulesets/dnd35e/combat/full_attack_sequence.ts`**:
   - Add `readonly riders?: ReadonlyArray<OnHitRiderDescriptor> | undefined;` to `NaturalWeaponLimbEntry`.
2. **`src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`**:
   - In `buildActorNaturalWeaponLimbs`, pass `...(nw.riders !== undefined ? { riders: nw.riders } : {})` onto each pushed `NaturalWeaponLimbEntry`.
3. **`src/rulesets/dnd35e/combat/attack_routine.ts`**:
   - Add `readonly onHitRiders?: ReadonlyArray<OnHitRiderDescriptor> | undefined;` to `DnD35ResolvedStrikeProfile` and populate it from `natLimb?.riders` on natural weapon strikes.
4. **`src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts`**:
   - In Phase 3 (`OnHitRidersPhase`), after calculating physical damage, evaluate `strike.onHitRiders` (if any):
   ```ts
   if (strike.onHitRiders && strike.onHitRiders.length > 0) {
     const physMitigation = mitigateIncomingDamage({
       rawDamage: rollResult.totalDamage,
       damageType: weaponDamageType,
       attackBypassTags: bypassTags,
       ...(defenderData.damageReduction !== undefined ? { damageReduction: defenderData.damageReduction } : {}),
       energyResistance: defenderData.energyResistance,
       immunities: defenderData.immunities,
       vulnerabilities: defenderData.vulnerabilities
     });
     const defenderConNull = defenderData.abilityScores.con.base === null;

     for (const rider of strike.onHitRiders) {
       if (!shouldTriggerOnHitRider(rider, physMitigation.finalDamage, true)) {
         continue;
       }
       const isImmune =
         defenderData.immunities.includes(rider.type) ||
         defenderData.immunities.includes(rider.riderId) ||
         (rider.saveType === 'fort' && defenderConNull);
       if (isImmune) {
         runningState = addMessage(
           runningState,
           `[${rider.initialEffectDescription}] Target is immune to ${rider.type}!`,
           MessageLogCategory.CombatMiss
         );
         continue;
       }

       const dcWithType = resolveSpecialAbilitySaveDc(
         rider.dc,
         rider.type,
         attackerData.statModifiers ?? [],
         attackerSelfTags
       );
       const effectiveDc =
         rider.riderId !== rider.type
           ? Math.max(
               dcWithType,
               resolveSpecialAbilitySaveDc(rider.dc, rider.riderId, attackerData.statModifiers ?? [], attackerSelfTags)
             )
           : dcWithType;

       const saveBonus = defenderEval.dagResult.saves[rider.saveType];
       const saveRes = resolveSavingThrow({
         saveType: rider.saveType,
         baseSave: saveBonus,
         abilityModifier: 0,
         dc: effectiveDc
       });

       if (saveRes.success) {
         runningState = addMessage(
           runningState,
           `[${rider.saveType.toUpperCase()} Save vs ${rider.initialEffectDescription} (DC ${effectiveDc}): d20(${saveRes.naturalRoll}) + ${saveBonus} = ${saveRes.total} — SAVED!]`,
           MessageLogCategory.CombatMiss
         );
       } else {
         runningState = addMessage(
           runningState,
           `[${rider.saveType.toUpperCase()} Save vs ${rider.initialEffectDescription} (DC ${effectiveDc}): d20(${saveRes.naturalRoll}) + ${saveBonus} = ${saveRes.total} — FAILED!]`,
           MessageLogCategory.CombatHit
         );
         const defRulesetComp = getComponent(runningState, defenderId, ComponentType.RulesetData);
         if (defRulesetComp && defRulesetComp.rulesetId === 'dnd35e') {
           const curDefData = defRulesetComp.payload as DnD35EntityData;
           if (rider.type === 'paralysis') {
             runningState = addComponent(runningState, defenderId, {
               ...defRulesetComp,
               payload: {
                 ...curDefData,
                 conditions: applyConditionWithEscalation(curDefData.conditions, 'paralyzed')
               }
             });
           } else if (rider.type === 'energy_drain') {
             runningState = addComponent(runningState, defenderId, {
               ...defRulesetComp,
               payload: {
                 ...curDefData,
                 negativeLevels: (curDefData.negativeLevels ?? 0) + 1
               }
             });
           } else if (rider.type === 'poison' || rider.type === 'disease' || rider.type === 'curse') {
             runningState = addComponent(runningState, defenderId, {
               ...defRulesetComp,
               payload: {
                 ...curDefData,
                 conditions: applyConditionWithEscalation(curDefData.conditions, 'sickened')
               }
             });
           }
         }
       }
     }
   }
   ```

---

### Diff 2: Target-Specific Prerequisite Gating & Owned-Target Dropdown Filtering (`Ability Focus` & `Improved Natural Attack`)

1. **`src/rulesets/dnd35e/prerequisite_types.ts`**:
   - Add `readonly naturalWeaponIds?: ReadonlyArray<string> | undefined;` to `PrerequisiteEvalContext`.
2. **`src/rulesets/dnd35e/builder/builder_prereq_helpers.ts`, `builder_prereq_context.ts`, `builder_draft_prereq_context.ts`, `builder_levelup_prereq_context.ts`**:
   - Add helper `collectActorNaturalWeaponIds(naturalWeapons)`:
     ```ts
     export function collectActorNaturalWeaponIds(
       naturalWeapons?: ReadonlyArray<{ readonly id: string; readonly naturalType: string }>
     ): ReadonlyArray<string> {
       const ids = new Set<string>();
       for (const nw of naturalWeapons ?? []) {
         ids.add(nw.naturalType);
         ids.add(nw.id);
       }
       return Array.from(ids);
     }
     ```
   - Populate `naturalWeaponIds` in `buildPrerequisiteContextForActor`, `buildCreationDraftPrerequisiteContext`, and `buildPostLevelUpPrerequisiteContext`.
3. **Specific `special_attack:<id>` Tag Projection (`races.ts`, `templates.ts`, `semantic_tags.ts`, and Tier 3 JSONs)**:
   - In `races.ts` (`evaluateRacialModifiers`):
     - When `race.breathWeapon` is present, emit `race.breathWeapon.grantedTags ?? ['trait:special_attack', 'special_attack:breath_weapon']`.
     - For each `rider` in `nw.riders`, emit `...(rider.grantedTags ?? ['trait:special_attack'])`, `special_attack:${rider.type}`, and `special_attack:${rider.riderId}`.
   - In `semantic_tags.ts` (`projectDnD35ActorSemanticTags`):
     - For each `rider` in `nw.riders`, emit `...(rider.grantedTags ?? ['trait:special_attack'])`, `special_attack:${rider.type}`, and `special_attack:${rider.riderId}`.
     - When `dndData.hasPounce === true`, emit `'trait:special_attack'` and `'special_attack:pounce'`.
   - In `templates.ts`:
     - When `template.breathWeapon` is present, emit `...(template.breathWeapon.grantedTags ?? ['trait:special_attack', 'special_attack:breath_weapon'])`.
   - In `public/data/rulesets/dnd35e/templates/half_dragon_{red,black,gold,silver}.json`, `classes/{rogue,assassin,paladin,blackguard}.json`, `domains/sun.json`, and `feats/stunning_fist.json`:
     - Add corresponding `special_attack:<id>` tags (`special_attack:breath_weapon`, `special_attack:sneak_attack`, `special_attack:death_attack`, `special_attack:smite`, `special_attack:turn_undead`, `special_attack:stun`).
4. **`src/rulesets/dnd35e/prerequisites.ts` & `src/rendering/ui/dnd35e_feat_spell_inspector.ui.ts`**:
   - In `evaluatePrerequisiteAST`:
     ```ts
     case 'has_tag': {
       if (node.tag.includes('$selected')) {
         if (context.targetId !== undefined) {
           return context.tags.includes(node.tag.replace('$selected', context.targetId));
         }
         const prefix = node.tag.replace('$selected', '');
         return context.tags.some((t) => t.startsWith(prefix));
       }
       return context.tags.includes(node.tag);
     }
     case 'min_natural_attacks': {
       const hasCount = (context.naturalAttackCount ?? 0) >= node.minCount;
       if (!hasCount) return false;
       if (context.targetId !== undefined && context.naturalWeaponIds !== undefined) {
         return context.naturalWeaponIds.includes(context.targetId);
       }
       return true;
     }
     ```
   - In `formatPrerequisiteLeafLabel` (`dnd35e_feat_spell_inspector.ui.ts`):
     - Format `has_tag` with `$selected` cleanly (`Trait/Feature: ${node.tag.replace('$selected', ctx.targetId ?? 'selected target')}`).
     - Format `min_natural_attacks` when `ctx.targetId` is present (`${node.minCount}+ Natural Attacks (${ctx.targetId})`).
   - Update `public/data/rulesets/dnd35e/feats/ability_focus.json`:
     ```json
     "prerequisites": {
       "type": "and",
       "children": [
         {
           "type": "has_tag",
           "tag": "trait:special_attack"
         },
         {
           "type": "has_tag",
           "tag": "special_attack:$selected"
         }
       ]
     }
     ```
5. **`src/rendering/ui/dnd35e_char_builder_feat_row.ui.ts` & `src/rendering/ui/dnd35e_char_builder_feats.ui.ts`**:
   - Pass optional `prereqCtx?: PrerequisiteEvalContext` into `getTargetedWeaponOptions`, `getFeatTargetOptions`, and `buildFeatTargetSelect`:
     - When `repeatable?.targetCategory === 'natural_weapon'`: if `prereqCtx?.naturalWeaponIds && prereqCtx.naturalWeaponIds.length > 0`, return `prereqCtx.naturalWeaponIds`; otherwise return `CANONICAL_NATURAL_WEAPONS`.
     - When `repeatable?.targetCategory === 'ability'`: extract owned special attack IDs from `prereqCtx?.tags` (`t.startsWith('special_attack:')`); if non-empty, return those owned target IDs; otherwise return `CANONICAL_SPECIAL_ATTACKS`.

---

### Diff 3: Evict Legacy Rule 21 Content-ID Branches (`effect_bundle.ts`, `builder_prereq_proficiencies.ts`, `ledger_choices.ts`, `semantic_tags.ts`)

1. **`src/rulesets/dnd35e/effect_bundle.ts`**:
   - Replace lines 200–213 and 275–278 in `resolveFeatEffectBundle` with strictly declarative `targetCategory` and `baseBundle.category` checks:
   ```ts
   const targetCategory = featDef.repeatable?.targetCategory;
   const isWeaponTargeted = targetCategory === 'weapon' || targetCategory === 'natural_weapon';
   const isSkillTargeted = targetCategory === 'skill';
   const isSchoolTargeted = targetCategory === 'school';
   const isAbilityTargeted = targetCategory === 'ability';
   ```
   and:
   ```ts
   const nextGrantedTags = [...baseBundle.grantedTags];
   if (isWeaponTargeted && baseBundle.category === 'proficiency') {
     nextGrantedTags.push(`proficiency:weapon:${targetId}`);
   }
   ```
2. **`src/rulesets/dnd35e/types/system/item_system.types.ts`, `builder_prereq_proficiencies.ts`, & `*bow.json`**:
   - Add `proficiencyEquivalentWeaponId: z.string().optional()` to `DnD35WeaponStatsSchema`.
   - Author `"proficiencyEquivalentWeaponId"` in `longbow.json` (`"composite_longbow"`), `composite_longbow.json` (`"longbow"`), `shortbow.json` (`"composite_shortbow"`), and `composite_shortbow.json` (`"shortbow"`).
   - In `builder_prereq_proficiencies.ts`, replace lines 160–163 (`if (weaponIds.has('longbow')) ...`) with:
   ```ts
   if (sysContent) {
     for (const wId of Array.from(weaponIds)) {
       const equivId = sysContent.items[wId]?.weaponStats?.proficiencyEquivalentWeaponId;
       if (equivId) {
         weaponIds.add(equivId);
       }
     }
   }
   ```
3. **`src/rulesets/dnd35e/types/system/effect_system.types.ts`, `progression/ledger_choices.ts`, `domains/war.json`, & `classes/ranger.json`**:
   - Add `combatStyleFeatByChoice: z.record(z.string(), z.string()).optional()` to `DnD35ClassFeatureDetailSchema`.
   - Add `grantsDeityFavoredWeaponProficiencyAndFocus: z.boolean().optional()` to `DnD35DomainDefinitionSchema`.
   - Author `"grantsDeityFavoredWeaponProficiencyAndFocus": true` in `public/data/rulesets/dnd35e/domains/war.json`.
   - Author `"combatStyleFeatByChoice"` on `combat_style` (`{"archery": "rapid_shot", "two_weapon": "two_weapon_fighting"}`), `improved_combat_style` (`{"archery": "manyshot", "two_weapon": "improved_two_weapon_fighting"}`), and `combat_style_mastery` (`{"archery": "improved_precise_shot", "two_weapon": "greater_two_weapon_fighting"}`) in `public/data/rulesets/dnd35e/classes/ranger.json`.
   - In `src/rulesets/dnd35e/progression/ledger_choices.ts` (`collectClassChoiceFeats`), replace the hardcoded `domains.includes('war')` and `combatStyle === 'archery' | 'two_weapon'` blocks with declarative evaluation against `sysContent?.domains` and `sysContent?.classes` (with fallback only when `sysContent === undefined` in unit tests).
4. **`src/rulesets/dnd35e/semantic_tags.ts`**:
   - Remove `if (featId === 'illiteracy' && tags.has('trait:literate')) continue;` and let `isActivationConditionMet(detail.activationCondition, currentTagSnapshot)` govern tag emission, only adding `feature:${featId}` when the feature's `activationCondition` passes across its owning class track.

---

### Diff 4: Update `docs/MILESTONES.md`, `docs/DECISIONS.md`, & `tests/dnd35e_feat_mechanics_fixes.test.ts`
- Append **Phase 32 / Milestone 132** to `docs/MILESTONES.md`.
- Add unit tests in `tests/dnd35e_feat_mechanics_fixes.test.ts` covering:
  1. Live `executeCombatStrikeExchange` with a Giant Spider (`bite` + `spider_venom` injury poison rider) and `ability_focus:poison`, verifying that `resolveSpecialAbilitySaveDc` increases the Fortitude save DC from `14` to `16` and that DR absorbing all physical damage suppresses the `'injury'` rider.
  2. Target-specific prerequisite validation and dropdown filtering for `Ability Focus` (`special_attack:$selected`) and `Improved Natural Attack` (`naturalWeaponIds`).
  3. Declarative `war.json`, `ranger.json`, and bow `proficiencyEquivalentWeaponId` resolution.
- Run `./verify.sh` across all 8 stages to confirm 0 errors.
