# Research Notes — Milestones 114 & 115: Complete SRD Feat Registry, Combat Chains, Metamagic Trees, SRD Equipment/Magic Item Compendium & Data-Driven Weapon Profile Parser

**Date:** 2026-11-05  
**Status:** Revised & Complete (Kickoff Flow Step 3: Research Gate)  
**Author:** AI Agent & User  
**Milestones:** 114 & 115 (Phase 24: D&D 3.5e System Content Pillars 3 & 5)  
**Canonical Rules Reference:** `docs/MILESTONES.md#L1592-L1635`, `docs/ARCHITECTURE.md`, `AGENTS.md` (§0 Golden Rules 1–20), `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`

---

## 1. Executive Summary & Objectives

The joint objective of **Milestones 114 and 115** is to establish the complete System Content (Tier 3) catalogs for SRD Feats (`public/data/rulesets/dnd35e/feats/<id>.json`) and SRD Equipment, Weapons, Armors, Special Materials, and Magic Items (`public/data/rulesets/dnd35e/items/<id>.json`), while refactoring all hardcoded item-ID and feat-ID heuristics in Tier 2 ruleset resolvers (`weapon_profile_parser.ts`, `semantic_tags.ts`, `ledger_modifiers.ts`, `dnd35e_dag_adapter.ts`, `attack_routine.ts`, and `stacking_engine.ts`) into 100% data-driven Effect Providers and structured item schemas with hierarchical `sourcePath` provenance.

---

## 2. Deep-Dive Audit: Hardcoded Heuristics in `weapon_profile_parser.ts` & `semantic_tags.ts`

An audit of `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` (284 lines) and `src/rulesets/dnd35e/semantic_tags.ts` (336 lines) revealed **6 hardcoded item-ID substring/equality branches** in `weapon_profile_parser.ts` plus **parallel hardcoded armor substring branches** in `semantic_tags.ts` that were written before the D&D 3.5e item registry existed:

### 2.1 Hardcoded Branches in `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`
1. **Weapon Damage Dice (`lines 175–185`)**:
   - Currently hardcodes:
     - `baseItemDef.id === 'longsword' || baseItemDef.id === 'heavy_mace'` $\to$ `'1d8'`
     - `baseItemDef.id === 'short_sword' || baseItemDef.id === 'quarterstaff'` $\to$ `'1d6'`
     - `baseItemDef.id.includes('dagger') || baseItemDef.id.includes('knife')` $\to$ `'1d4'`
     - `baseItemDef.id.includes('greatsword')` $\to$ `'2d6'`
     - `baseItemDef.id.includes('bastard_sword') || baseItemDef.id.includes('dwarven_waraxe')` $\to$ `'1d10'`
   - **Data-Driven Replacement**: Read `itemDef.weaponStats.damageDice` (default Medium damage dice, e.g. `'1d8'`, `'2d6'`, `'1d10'`) directly from the validated `DnD35ItemDefinitionSchema`, falling back to `weaponDice:` tag only for legacy test fixtures.
2. **Weapon Damage Type (`lines 190–200`)**:
   - Currently hardcodes:
     - `baseItemDef.id.includes('mace') || baseItemDef.id.includes('staff')` $\to$ `'bludgeoning'`
     - `baseItemDef.id.includes('short_sword') || baseItemDef.id.includes('dagger')` $\to$ `'piercing'`
     - `baseItemDef.id.includes('longsword')` $\to$ `'slashing'`
   - **Data-Driven Replacement**: Read `itemDef.weaponStats.damageType` (`'bludgeoning' | 'piercing' | 'slashing'`) and `secondaryDamageTypes` (for weapons like *morningstar* `[bludgeoning, piercing]` or *halberd* `[piercing, slashing]`).
3. **Critical Threat Range & Multiplier (`lines 202–218`)**:
   - Currently hardcodes `baseItemDef.id === 'longsword' || baseItemDef.id === 'short_sword' || baseItemDef.id.includes('dagger')` $\to$ `19`.
   - **Data-Driven Replacement**: Read `itemDef.weaponStats.critThreatMin` (default `20`, `19` for 19–20, `18` for 18–20) and `itemDef.weaponStats.critMultiplier` (default `2`, `3` for $\times 3$, `4` for $\times 4$). Furthermore, apply *Keen* (`magicalProperties.keen === true`) or *Improved Critical* (`ruleOverrides: [{ ruleKey: 'double_crit_threat_range', value: true }]`) dynamically to double the threat range (`21 - (21 - critThreatMin) * 2`).
4. **Handedness / Effort & Special Combat Flags (`lines 220–248`)**:
   - Currently hardcodes:
     - `baseItemDef.id.includes('greatsword') || baseItemDef.id.includes('greataxe') || baseItemDef.id.includes('quarterstaff') || baseItemDef.id.includes('staff')` $\to$ `'two_handed'`
     - `baseItemDef.id.includes('dagger') || baseItemDef.id === 'short_sword'` $\to$ `'light'`
     - `baseItemDef.id === 'longsword' || baseItemDef.id === 'heavy_mace' || baseItemDef.id.includes('rapier')` $\to$ `'one_handed'`
     - `isDoubleWeapon`: `baseItemDef.id.includes('quarterstaff') || baseItemDef.id.includes('double_')`
     - `cannotTwoHandStr`: `baseItemDef.id.includes('rapier')`
     - `isExotic1HMartial2H`: `baseItemDef.id.includes('bastard_sword') || baseItemDef.id.includes('dwarven_waraxe')`
   - **Data-Driven Replacement**: Read structured `itemDef.weaponStats`:
     - `effort: 'light' | 'one_handed' | 'two_handed'`
     - `proficiencyCategory: 'simple' | 'martial' | 'exotic'`
     - `weaponCategory: 'unarmed' | 'melee' | 'ranged' | 'thrown'`
     - `isDoubleWeapon?: boolean`
     - `isFinesseEligible?: boolean` (for *rapier*, *whip*, *spiked chain*, plus all light weapons)
     - `cannotTwoHandStr?: boolean` (for *rapier*, *whip*)
     - `isExotic1HMartial2H?: boolean` (for *bastard sword*, *dwarven waraxe*)
     - `reachFt?: number` (`10` for reach weapons)
     - ` strikesAdjacent?: boolean` (`true` for *spiked chain*, `false` for standard reach polearms)
5. **Dwarven / Racial Weapon Familiarity (`lines 85–89`)**:
   - Currently hardcodes `weaponItemId.includes('dwarven')` and checks `raceId === 'dwarf' || subtypes.includes('dwarf')`.
   - **Data-Driven Replacement**: Add `familiaritySubtypes?: string[]` to `DnD35WeaponStatsSchema` (e.g., `familiaritySubtypes: ['dwarf']` on *dwarven waraxe* and *dwarven urgrosh*; `familiaritySubtypes: ['gnome']` on *gnome hooked hammer*). In `evaluateNonproficiencyPenalty`, if `weaponStats.familiaritySubtypes` intersects the actor's `raceId` or `subtypes` (or if the actor has tag `trait:weapon_familiarity:<subtype>`), treat the exotic weapon as martial!
6. **Unarmed Strike Size Scaling (`lines 96–105`)**:
   - Currently uses a 7-branch `if / else if` ladder on `wielderSize` (`fine` $\to$ `'1'`, `small` $\to$ `'1d2'`, `medium` $\to$ `'1d3'`, `large` $\to$ `'1d4'`, `huge` $\to$ `'1d6'`, `gargantuan` $\to$ `'1d8'`, `colossal` $\to$ `'2d6'`).
   - **Data-Driven Replacement**: Author `public/data/rulesets/dnd35e/items/unarmed_strike.json` with `weaponStats.damageDice: '1d3'` (Medium base) and call `scaleWeaponDamageDice('1d3', 'medium', wielderSize)` directly, eliminating the duplicated size ladder.

### 2.2 Parallel Hardcoded Armor Heuristics in `src/rulesets/dnd35e/semantic_tags.ts` (`lines 275–315`)
- Currently `resolveEntitySituationalTagContext` inspects `lowerId.includes('chain')`, `lowerId.includes('plate')`, `lowerId.includes('scale')`, `lowerId.includes('full_plate')`, `lowerId.includes('half_plate')`, `lowerId.includes('splint')`, `lowerId.includes('banded')`, `lowerId.includes('breastplate')`, `lowerId.includes('chainmail')`, `lowerId.includes('scale_mail')`, `lowerId.includes('hide')`.
- **Data-Driven Replacement**: Define `DnD35ArmorStatsSchema` on `DnD35ItemDefinitionSchema`:
  - `armorCategory: 'light' | 'medium' | 'heavy' | 'shield' | 'tower_shield'`
  - `armorBonus: number` (or `shieldBonus: number`)
  - `maxDexBonus: number | null` (`null` for uncapped shields)
  - `armorCheckPenalty: number` (non-positive integer, e.g. `-6`, `-1`, `0`)
  - `arcaneSpellFailure: number` (`0..100`)
  - `speed30Ft?: number`, `speed20Ft?: number`
  - `isMetal: boolean`
- When `specialMaterial: 'mithral'` is applied via `applyMaterialPhysics`, Mithral automatically steps down `armorCategory` (`'heavy' -> 'medium'`, `'medium' -> 'light'`), increases `maxDexBonus` by `+2`, reduces `armorCheckPenalty` magnitude by `3`, and reduces `arcaneSpellFailure` by `10%`. `resolveEntitySituationalTagContext` simply reads `finalItemDef.armorStats`!

---

## 3. Milestone 114 Research: Complete SRD Feat Registry, Combat Chains & Metamagic Trees

### 3.1 Current State & Gaps Identified
1. **Incomplete Feat Catalog**: Only 12 feat files currently exist in `public/data/rulesets/dnd35e/feats/`:
   - `alertness.json`, `blind_fight.json`, `cleave.json`, `combat_casting.json`, `combat_reflexes.json`, `dodge.json`, `great_fortitude.json`, `improved_initiative.json`, `iron_will.json`, `lightning_reflexes.json`, `power_attack.json`, `toughness.json`, `weapon_focus.json`.
   - Furthermore, several SRD monster race files in `public/data/rulesets/dnd35e/races/*.json` reference feats that do not yet exist in `feats/` (e.g., `multiattack`, `weapon_finesse`, `improved_overrun`, `improved_bull_rush`, `improved_sunder`, `awesome_blow`, `flyby_attack`, `hover`, `wingover`, `snatch`, `empower_spell_like_ability`, `quicken_spell_like_ability`, `ability_focus_poison`, `weapon_focus_bite`, `weapon_focus_claw`, `weapon_focus_greataxe`, `weapon_focus_longsword`, `weapon_focus_hoof`, `weapon_focus_ray`, `track`, `endurance`, `diehard`, `run`, `stealthy`, `athletic`, `persuasive`, `point_blank_shot`, `precise_shot`, `rapid_shot`, `two_weapon_fighting`, `multiweapon_fighting`).
2. **Missing Feat Effect Provider Wiring (Horizon 2 & Horizon 3)**:
   - While `dndData.feats` stores acquired feat IDs, **nothing in `ledger_modifiers.ts`, `level_ledger.ts`, `character_builder.ts`, `archetype_resolver.ts`, or `dnd35e_dag_adapter.ts` currently evaluates `featDef.effectBundle`, `featDef.modifiers`, or `featDef.ruleOverrides` into `StatModifier`s (`sourcePath: "feat:<id>/..."`)**!
   - As a result, taking *Iron Will* (`+2 Will`), *Lightning Reflexes* (`+2 Reflex`), *Great Fortitude* (`+2 Fortitude`), *Improved Initiative* (`+4 Initiative`), *Toughness* (`+3 HP`), *Dodge* (`+1 Dodge AC`), *Alertness* (`+2 Listen/Spot`), or *Weapon Focus* (`+1 Attack`) does not currently emit `StatModifier`s into the 4-Stage Topological Stat DAG.
3. **Missing Metamagic Descriptor Schema**:
   - `DnD35FeatDefinitionSchema` in `src/rulesets/dnd35e/types/dnd35e_system.types.ts` lacks a structured `metamagicDescriptor` field to drive `metamagic_dispel.ts` (`slotLevelAdjustment`, `actionTimeOverride`, `rangeMultiplier`, `durationMultiplier`, `areaMultiplier`, `empowerDamageMultiplier`, `maximizeVariableDice`, `suppressVerbalComponent`, `suppressSomaticComponent`).
4. **Missing `effectTags` on `DnD35DeclarativeModifierSchema`**:
   - `StatModifier` in `dnd35e.types.ts` supports `effectTags?: ReadonlyArray<string>` (used by `stacking_engine.ts` line 73 to preserve `effectTags: ['force']` against incorporeal touch attacks), but `DnD35DeclarativeModifierSchema` in `effect_system.types.ts` does not yet include `effectTags: z.array(z.string()).optional()`.
5. **Unvalidated `has_feat` Prerequisite References**:
   - In `src/rulesets/dnd35e/validation/class_race_validator.ts` (`line 51`), `case 'has_feat':` is a no-op rather than verifying that `node.featId` (or its base feat ID before `:`) exists in `sys.feats`.

### 3.2 Milestone 114 Architecture & Solutions
1. **Extend `DnD35FeatDefinitionSchema` & `DnD35DeclarativeModifierSchema`**:
   - Add `effectTags: z.array(z.string()).optional()` to `DnD35DeclarativeModifierSchema` and forward it in `evaluateEffectBundle`.
   - Add `repeatable: z.object({ mode: z.enum(['stacking', 'targeted']), targetCategory: z.enum(['weapon', 'school', 'skill', 'ability']).optional() }).optional()` and `metamagicDescriptor: DnD35MetamagicDescriptorSchema.optional()` to `DnD35FeatDefinitionSchema`.
2. **Implement `buildFeatEffectModifiers` and `collectActiveFeatRuleOverrides` (`src/rulesets/dnd35e/progression/ledger_modifiers.ts`)**:
   - Evaluates both `featDef.modifiers` and `featDef.effectBundle` for all active feats (`dndData.feats` + `activeGrantedAndVirtualFeats`).
   - Assigns deterministic hierarchical `sourcePath`:
     - Standard feat: `feat:<featId>/<modId>` (or `feat:<featId>/bundle:<bundleId>/<modId>`).
     - Repeatable stacking feat (*Toughness* taken multiple times): `feat:toughness#1/hp`, `feat:toughness#2/hp` so each instance has a unique `sourceId` and `sourcePath` and stacks cleanly in the DAG.
     - Parameterized/targeted feat (e.g. `weapon_focus:longsword` or `weapon_focus_longsword`): resolves base `weapon_focus` or exact `weapon_focus_longsword` definition, attaching weapon target tag condition when parameterized.
   - `collectActiveFeatRuleOverrides` aggregates `featDef.ruleOverrides` and `featDef.effectBundle.ruleOverrides` into a structured lookup map (`CombatRuleOverrides` & `ManeuverRuleOverrides`) so combat resolvers never hardcode feat names:
     - `weapon_finesse` $\to$ `ruleKey: 'use_dex_for_light_finesse_melee_attack', value: true`
     - `two_weapon_fighting` $\to$ `ruleKey: 'twf_ReducePenalty', value: true`
     - `improved_two_weapon_fighting` $\to$ `ruleKey: 'twf_extra_offhand_attacks', value: 1`
     - `greater_two_weapon_fighting` $\to$ `ruleKey: 'twf_extra_offhand_attacks', value: 2`
     - `multiattack` $\to$ `ruleKey: 'secondary_natural_penalty', value: -2`
     - `improved_critical` $\to$ `ruleKey: 'double_crit_threat_range', value: true`
     - `improved_trip` / `improved_disarm` / `improved_bull_rush` / `improved_sunder` / `improved_overrun` / `improved_grapple` / `improved_feint` $\to$ `provokesAoO: false`, `opposedBonus: 4`, `grantsFreeFollowupAttackOnSuccess: true` (for Trip).
     - `natural_spell` $\to$ `ruleKey: 'cast_spells_in_wild_shape', value: true`.
3. **Wire Feat Modifiers Across Horizon 2 & Horizon 3**:
   - In `level_ledger.ts` (`rebuildActorStateFromLevelHistory`): preserve multiple occurrences of `repeatable.mode === 'stacking'` feats (*Toughness*) instead of collapsing with `new Set()`, strip stale `feat:` modifiers, and append `buildFeatEffectModifiers(...)`.
   - In `dnd35e_dag_adapter.ts` (`evaluateDnD35eEntityDAG`): if an entity's `dndData.feats` have not yet been expanded into `dndData.statModifiers` with `sourcePath: 'feat:...'` (e.g., spawned monsters or test entities), dynamically evaluate `buildFeatEffectModifiers` and `collectActiveFeatRuleOverrides` in Horizon 3, and apply `use_dex_for_light_finesse_melee_attack` when resolving light/finesse melee attacks!
4. **Author Complete Modular SRD Feat Registry (`public/data/rulesets/dnd35e/feats/<id>.json`)**:
   - Author all 85+ SRD feats covering Melee, Tactical Chains, Maneuver Chains, Ranged Chains, TWF/Multiweapon Chains, Unarmed/Grapple Chains, Defensive/Save/Skill Feats, Monster Feats (including weapon-specific feats referenced by `races/*.json`), Spellcasting Feats, and Metamagic Feats.
5. **Enable `has_feat` Prerequisite AST Validation (`class_race_validator.ts`)**:
   - Update `validatePrerequisiteNodeReferences` so `case 'has_feat':` checks `sys.feats[node.featId] ?? sys.feats[node.featId.split(':')[0]!]`.

---

## 4. Milestone 115 Research: Complete SRD Equipment, Special Materials, Magic Item Compendium & Data-Driven Parser

### 4.1 Structured Item Schema (`src/rulesets/dnd35e/types/system/item_system.types.ts`)
To keep all files strictly $\le 300$ lines (`AGENTS.md` Rule 8), we will create `src/rulesets/dnd35e/types/system/item_system.types.ts` (and re-export from `dnd35e_system.types.ts`) defining:
1. **`DnD35WeaponStatsSchema`**:
   - `proficiencyCategory: z.enum(['simple', 'martial', 'exotic'])`
   - `weaponCategory: z.enum(['unarmed', 'melee', 'ranged', 'thrown'])`
   - `effort: z.enum(['light', 'one_handed', 'two_handed'])`
   - `damageDice: z.string()` (Medium base dice, e.g. `'1d8'`, `'2d6'`)
   - `damageType: DnD35DamageTypeSchema`
   - `secondaryDamageTypes: z.array(DnD35DamageTypeSchema).optional()`
   - `critThreatMin: z.number().int().min(15).max(20).default(20)`
   - `critMultiplier: z.number().int().min(2).max(4).default(2)`
   - `rangeIncrementFt: z.number().int().positive().optional()`
   - `reachFt: z.number().int().positive().default(5)`
   - `strikesAdjacent: z.boolean().default(true)`
   - `isDoubleWeapon: z.boolean().default(false)`
   - `offHandDamageDice: z.string().optional()`
   - `offHandDamageType: DnD35DamageTypeSchema.optional()`
   - `offHandCritThreatMin: z.number().int().min(15).max(20).optional()`
   - `offHandCritMultiplier: z.number().int().min(2).max(4).optional()`
   - `isFinesseEligible: z.boolean().default(false)`
   - `cannotTwoHandStr: z.boolean().default(false)`
   - `isExotic1HMartial2H: z.boolean().default(false)`
   - `familiaritySubtypes: z.array(z.string()).default([])`
   - `maneuverTags: z.array(z.enum(['trip', 'disarm', 'brace_vs_charge', 'monk', 'nonlethal_only', 'composite_str'])).default([])`
2. **`DnD35ArmorStatsSchema`**:
   - `armorCategory: z.enum(['light', 'medium', 'heavy', 'shield', 'tower_shield'])`
   - `armorBonus: z.number().int().nonnegative()`
   - `maxDexBonus: z.number().int().nonnegative().nullable().default(null)`
   - `armorCheckPenalty: z.number().int().max(0).default(0)`
   - `arcaneSpellFailure: z.number().int().min(0).max(100).default(0)`
   - `speed30Ft: z.number().int().positive().optional()`
   - `speed20Ft: z.number().int().positive().optional()`
   - `isMetal: z.boolean().default(false)`
3. **`DnD35SpecialMaterialSchema`**:
   - `z.enum(['mundane', 'masterwork', 'mithral', 'adamantine', 'darkwood', 'alchemical_silver', 'cold_iron'])`
4. **`DnD35MagicalPropertiesSchema`**:
   - `enhancementBonus: z.number().int().min(0).max(5).default(0)`
   - `isMasterwork: z.boolean().default(false)`
   - `keen: z.boolean().optional()`
   - `ghostTouch: z.boolean().optional()`
   - `animated: z.boolean().optional()`
   - `fortificationType: z.enum(['light', 'moderate', 'heavy']).optional()`
   - `baneCreatureType: z.string().optional()`
   - `energyRiders: z.array(z.object({ propertyId: z.string(), dice: z.string(), damageType: DnD35DamageTypeSchema })).optional()`
   - `onHitEffectIds: z.array(z.string()).optional()`
5. **`DnD35ItemDefinitionSchema`**:
   - Extends `ItemDefinitionSchema` (from `src/types/campaign/item.ts`, which gains optional ruleset fields `weaponStats?: unknown`, `armorStats?: unknown`, `specialMaterial?: unknown`, `magicalProperties?: unknown`, `effectBundle?: unknown`) with strongly typed `weaponStats`, `armorStats`, `specialMaterial`, `magicalProperties`, and `effectBundle: DnD35EffectBundleSchema.optional()`.

### 4.2 System Content Merging (`loader.ts`, `tests/helpers.ts`, `run-validator.ts`)
- Add `items: z.record(z.string(), DnD35ItemDefinitionSchema).default({})` to `DnD35SystemContentSchema`.
- Register `{ key: 'items', filename: 'items.json' }` and modular `items/<id>.json` in `DND35E_SYSTEM_CONTENT_FILES` (`src/rulesets/dnd35e/system_content_files.ts`).
- In `src/core/loader.ts`, `tests/helpers.ts`, and `scripts/run-validator.ts`, shallow-merge `parsedSystemContent['items']` into `campaign.items`:
  ```ts
  items: {
    ...rulesetBase.items,
    ...((parsedSystemContent['items'] as Record<string, unknown> | undefined) ?? {}),
    ...(items as Record<string, unknown>)
  }
  ```
  This makes every modular SRD item in `public/data/rulesets/dnd35e/items/<id>.json` automatically available in `state.campaign.items[itemId]` while still allowing campaign-specific `items.json` overrides.

### 4.3 Equipped Item DAG Integration & Ghost Touch / Force AC Preservation
- In `dnd35e_dag_adapter.ts`:
  - Implement `collectEquippedItemModifiers(state, entityId, activeSelfTags)` which scans active, non-suppressed `EquipmentComponent.slots`:
    1. Evaluates `itemDef.effectBundle` via `evaluateEffectBundle(itemDef.effectBundle, "item:" + itemDef.id, [], activeSelfTags)`, collecting `statModifiers` (`sourcePath: "item:<itemId>/..."`) and `grantedTags`.
    2. For equipped armors and shields with `armorStats`, emits typed `'armor'`, `'armor_enhancement'`, `'shield'`, and `'shield_enhancement'` modifiers with `sourcePath: "item:<itemId>/armor"` or `"item:<itemId>/shield"`. If `magicalProperties.ghostTouch === true`, attaches `effectTags: ['force', 'ghost_touch']` so `stacking_engine.ts` preserves the armor/shield bonus against incorporeal touch attacks!
    3. Computes the most restrictive `maxDexBonus` across equipped armor and tower shields (after applying Mithral adjustments) and passes `maxDexBonus` into Stage 3/4 of `evaluateDnD35ActorStatDAG`.
- In `stacking_engine.ts`:
  - Check `(mod.effectTags?.includes('force') === true || mod.effectTags?.includes('ghost_touch') === true)` when `againstIncorporealTouch` is true so both *Bracers of Armor* (`effectTags: ['force']`) and *Ghost Touch* armor/shields (`effectTags: ['ghost_touch']`) protect against incorporeal touch attacks.

---

## 5. Cascading Effects Matrix (Rule 15)

| Change / Subsystem | Upstream Callers & Producers | Downstream Consumers | Lateral / Sibling Mirrors |
| :--- | :--- | :--- | :--- |
| **1. `item_system.types.ts` & `ItemDefinitionSchema`** | `public/data/rulesets/dnd35e/items/*.json`, `public/data/campaigns/*/items.json`, `loader.ts`. | `weapon_profile_parser.ts`, `semantic_tags.ts`, `dnd35e_dag_adapter.ts`, `special_materials.ts`, `dnd35e_validator.ts`. | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md`, `ai-prompt-kit`. |
| **2. Modular `items/<id>.json` Merging** | `system_content_files.ts`, `loadCampaign`, `loadCampaignFromDisk`, `loadAndValidateZod`. | `state.campaign.items`, inventory UI, paperdoll HUD, character builder equipment step, combat resolvers. | `public/data/campaigns/dnd35e-crypt/items.json`, `run-validator.ts` disk parity check. |
| **3. Data-Driven `weapon_profile_parser.ts` & `semantic_tags.ts`** | `parseEquippedItem`, `evaluateNonproficiencyPenalty`, `buildUnarmedProfile`, `resolveEntitySituationalTagContext`. | `resolveEquippedWeaponProfile`, `resolveAllEquippedWeaponProfiles`, `evaluateDnD35eEntityDAG`, `resolveActorAttackRoutine`. | `special_materials.ts`, existing weapon/material unit tests (`dnd35e_combat_engine.test.ts`). |
| **4. Feat Schema & Modular `feats/<id>.json` Catalog** | `effect_system.types.ts`, `dnd35e_system.types.ts`, `system_content_files.ts`. | `prerequisites.ts`, `class_race_validator.ts`, `metamagic_dispel.ts`, character builder & level-up feat pickers. | `public/data/rulesets/dnd35e/races/*.json` (monster feat lists), `classes/*.json` (bonusFeatPool). |
| **5. `buildFeatEffectModifiers` & `collectActiveFeatRuleOverrides`** | `level_ledger.ts`, `character_builder.ts`, `archetype_resolver.ts`, `dnd35e_dag_adapter.ts`. | `evaluateDnD35ActorStatDAG` (Stages 1–4), `resolveActorAttackRoutine` (Weapon Finesse, TWF, Multiattack, Improved Critical), `resolveCombatManeuver`. | `provenance.ts` (`feat:` classified as `'progression'` OriginLayer). |
| **6. Equipped Item `effectBundle` & Armor/Shield DAG Wiring** | `EquipmentComponent.slots`, `collectEquippedItemModifiers` in `dnd35e_dag_adapter.ts`. | `evaluateDnD35ActorStatDAG`, `resolveTypedModifiersWithBreakdown` (`stacking_engine.ts`). | `getEquippedItemBonuses` in `srd_registry.ts` (avoid double-counting when `armorStats` / `effectBundle` is present). |

---

## 6. Verification Plan

1. **8-Stage `./verify.sh` Pipeline**:
   - `[1/8]` `bun x tsc --noEmit` (0 errors)
   - `[2/8]` `bun run format`
   - `[3/8]` `bun run lint --fix` & `bun run lint:filelength` (0 files > 300 code lines)
   - `[4/8]` `bun run lint:arch` (0 circular or upward dependencies)
   - `[5/8]` `bun run lint:deadcode` (0 unused exports)
   - `[6/8]` `bun test` (all existing + new M114/M115 test suites pass)
   - `[7/8]` `bun run build`
   - `[8/8]` `bun run scripts/run-validator.ts` (0 errors, 0 warnings, 100% disk & SSOT parity)
2. **New Regression Test Suites**:
   - `tests/dnd35e_feats_m114.test.ts`: Validates all 85+ SRD feats, prerequisite AST resolution, passive `effectBundle` stat modifiers in the 4-Stage DAG (*Iron Will*, *Lightning Reflexes*, *Great Fortitude*, *Improved Initiative*, stacking *Toughness*, *Dodge*, *Weapon Focus*, *Weapon Specialization*), *Weapon Finesse* DEX-to-attack override, *Improved Critical* threat doubling, *Multiattack*, and metamagic descriptors.
   - `tests/dnd35e_equipment_m115.test.ts`: Validates all 110+ SRD items, 100% data-driven `weapon_profile_parser.ts` (dice, damage types, crit ranges, reach, finesse, dwarven/gnome weapon familiarity, unarmed strike scaling), `semantic_tags.ts` armor category & Mithral step-down, equipped wondrous items in Stage 2/3/4 DAG (*Belt of Giant Strength*, *Gloves of Dexterity*, *Headband of Intellect*, *Cloak of Resistance*, *Ring of Protection*, *Amulet of Natural Armor*, *Bracers of Armor*), and *Ghost Touch* / *Force* AC preservation against incorporeal touch attacks.
