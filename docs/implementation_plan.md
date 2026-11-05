# Milestone 114 & 115 Implementation Plan: Complete SRD Feat Registry, Combat Chains & Metamagic Trees + Complete SRD Equipment, Magic Item Compendium & Data-Driven Weapon Profile Parser

**Date:** 2026-11-05  
**Status:** Revised & Ready for Review (Kickoff Flow Step 4 & 5: Implementation Plan Gate)  
**Authors:** AI Agent & User  
**Milestones Covered:**
- **Milestone 114**: Complete SRD Feat Registry, Combat Chains & Metamagic Trees (`public/data/rulesets/dnd35e/feats/<id>.json`)
- **Milestone 115**: Complete SRD Weapons, Armors, Special Materials, Magic Item Compendium & Data-Driven Weapon Profile Parser (`public/data/rulesets/dnd35e/items/<id>.json`)
**Architecture References:** `docs/ARCHITECTURE.md`, `AGENTS.md` (§0 Golden Rules 1–20), `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`, `docs/MILESTONES.md#L1592-L1635`, `docs/research_notes.md`

---

## 1. Executive Summary & Architectural Goals

The joint objective of **Milestones 114 and 115** is to establish the complete System Content (Tier 3) catalogs for SRD Feats and SRD Equipment (Weapons, Armors, Shields, Special Materials, Magic Properties, Wondrous Items, Rings, Rods, Staves, Wands, Scrolls, and Potions) in modular, data-driven JSON formats, while refactoring all hardcoded item-ID and feat-ID branches in Tier 2 cartridge resolvers into 100% declarative schemas and Effect Providers.

### Key Architectural Directives
1. **Zero Hardcoded Item or Feat Branches (`AGENTS.md` Rule 17)**:
   - Eliminate all 6 hardcoded item-ID heuristics in `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` (damage dice, damage type, critical threat range, handedness/effort/special flags, dwarven weapon familiarity, and unarmed strike size ladder) and the parallel armor substring checks in `src/rulesets/dnd35e/semantic_tags.ts`.
   - Drive all weapon and armor mechanics from structured `weaponStats`, `armorStats`, `specialMaterial`, and `magicalProperties` defined on `DnD35ItemDefinitionSchema`.
   - Drive all feat stat bonuses, combat rule overrides (*Weapon Finesse*, *Two-Weapon Fighting*, *Improved Critical*, *Multiattack*, *Improved Trip/Disarm/Bull Rush/Sunder/Overrun/Grapple/Feint*, *Natural Spell*), and metamagic adjustments from declarative `DnD35FeatDefinitionSchema` (`effectBundle`, `modifiers`, `ruleOverrides`, `metamagicDescriptor`).
2. **Unified Effect Providers & Hierarchical Provenance (`AGENTS.md` Rule 19)**:
   - Every modifier emitted by a feat carries `sourcePath: "feat:<featId>/..."` (or `"feat:<featId>#<instance>/..."` for stacking repeatable feats like *Toughness*).
   - Every modifier emitted by an equipped item carries `sourcePath: "item:<itemId>/..."`.
3. **Strict File Size Modularity (`AGENTS.md` Rule 8)**:
   - Every `.ts` file must remain strictly $\le 300$ code lines (`bun run lint:filelength` passes with 0 warnings). New item schemas live in a dedicated `src/rulesets/dnd35e/types/system/item_system.types.ts` module.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner (New SSOT) | Legacy / Old-Brain Implementation | Eviction Action |
| :--- | :--- | :--- | :--- |
| **Weapon Profile Resolution** | `parseEquippedItem`, `evaluateNonproficiencyPenalty`, and `buildUnarmedProfile` in `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` reading `itemDef.weaponStats` | Hardcoded `baseItemDef.id === 'longsword'`, `.includes('dagger')`, `.includes('dwarven')`, and 7-branch unarmed size ladder | Replace all hardcoded ID branches with declarative reads from `weaponStats`, `specialMaterial`, and `magicalProperties` (retaining tag fallbacks for legacy unit tests) |
| **Armor Category & Material Tag Projection** | `resolveEntitySituationalTagContext` in `src/rulesets/dnd35e/semantic_tags.ts` reading `itemDef.armorStats` & `applyMaterialPhysics` | Hardcoded `lowerId.includes('full_plate')`, `lowerId.includes('breastplate')`, `lowerId.includes('chain')` | Read `armorStats.armorCategory` and `armorStats.isMetal` directly after applying special material step-downs (e.g. Mithral) |
| **Feat Stat Modifiers & Combat Overrides** | `buildFeatEffectModifiers` and `collectActiveFeatRuleOverrides` in `src/rulesets/dnd35e/progression/ledger_modifiers.ts` | Feats stored in `dndData.feats` were never evaluated into `StatModifier`s | Evaluate `featDef.modifiers`, `featDef.effectBundle`, and `featDef.ruleOverrides` across Horizon 2 (`level_ledger.ts`) and Horizon 3 (`dnd35e_dag_adapter.ts`) |
| **Equipped Item Effect Bundles & Armor/Shield DAG** | `collectEquippedItemModifiers` in `src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts` | `getEquippedItemBonuses` in `srd_registry.ts` only summed untyped `attackBonus` and `defenseBonus` | Evaluate `itemDef.effectBundle`, `armorStats`, and `magicalProperties` (`ghostTouch`, `force`) into typed DAG modifiers with `sourcePath: "item:<itemId>/..."` |
| **SRD Item Catalog** | Modular `public/data/rulesets/dnd35e/items/<id>.json` merged into `campaign.items` | Only 7 campaign-specific items in `dnd35e-crypt/items.json` | Register all 110+ SRD items in `system_content_files.ts` and shallow-merge `parsedSystemContent['items']` into `campaign.items` in `loader.ts`, `tests/helpers.ts`, and `run-validator.ts` |

---

## 3. Step-by-Step Implementation Plan

### Phase 1: Item & Feat Schemas and System Content Merging (Tier 1 & Tier 2)

1. **Extend Tier 1 Console `ItemDefinitionSchema` (`src/types/campaign/item.ts`)**:
   - Add optional ruleset pass-through fields so `CampaignDataSchema.parse` preserves them on `campaign.items`:
     ```ts
     weaponStats: z.unknown().optional(),
     armorStats: z.unknown().optional(),
     specialMaterial: z.unknown().optional(),
     magicalProperties: z.unknown().optional(),
     effectBundle: z.unknown().optional(),
     ```
2. **Create `src/rulesets/dnd35e/types/system/item_system.types.ts` (Tier 2)**:
   - Define `DnD35SpecialMaterialSchema` (`'mundane' | 'masterwork' | 'mithral' | 'adamantine' | 'darkwood' | 'alchemical_silver' | 'cold_iron'`).
   - Define `DnD35WeaponStatsSchema` (`proficiencyCategory`, `weaponCategory`, `effort`, `damageDice`, `damageType`, `secondaryDamageTypes`, `critThreatMin`, `critMultiplier`, `rangeIncrementFt`, `reachFt`, `strikesAdjacent`, `isDoubleWeapon`, `offHandDamageDice`, `offHandDamageType`, `isFinesseEligible`, `cannotTwoHandStr`, `isExotic1HMartial2H`, `familiaritySubtypes`, `maneuverTags`).
   - Define `DnD35ArmorStatsSchema` (`armorCategory`, `armorBonus`, `maxDexBonus`, `armorCheckPenalty`, `arcaneSpellFailure`, `speed30Ft`, `speed20Ft`, `isMetal`).
   - Define `DnD35MagicalPropertiesSchema` (`enhancementBonus`, `isMasterwork`, `keen`, `ghostTouch`, `animated`, `fortificationType`, `baneCreatureType`, `energyRiders`, `onHitEffectIds`).
   - Define `DnD35ItemDefinitionSchema` extending `ItemDefinitionSchema` with these typed schemas and `effectBundle: DnD35EffectBundleSchema.optional()`.
3. **Update `effect_system.types.ts` & `dnd35e_system.types.ts`**:
   - In `effect_system.types.ts`:
     - Add `effectTags: z.array(z.string()).optional()` to `DnD35DeclarativeModifierSchema`.
     - Forward `effectTags` onto emitted `StatModifier`s in `src/rulesets/dnd35e/effect_bundle.ts`.
   - In `dnd35e_system.types.ts`:
     - Re-export `* from './system/item_system.types.ts'`.
     - Add `repeatable` (`mode: 'stacking' | 'targeted'`, `targetCategory?: 'weapon' | 'school' | 'skill' | 'ability'`) and `metamagicDescriptor` (`slotLevelAdjustment`, `actionTimeOverride`, `rangeMultiplier`, `durationMultiplier`, `areaMultiplier`, `empowerDamageMultiplier`, `maximizeVariableDice`, `suppressVerbalComponent`, `suppressSomaticComponent`) to `DnD35FeatDefinitionSchema`.
     - Add `items: z.record(z.string(), DnD35ItemDefinitionSchema).default({})` to `DnD35SystemContentSchema`.
4. **Merge `parsedSystemContent.items` into `campaign.items`**:
   - Update `src/core/loader.ts`, `tests/helpers.ts`, and `scripts/run-validator.ts` so `campaign.items` shallow-merges `{ ...rulesetBase.items, ...(parsedSystemContent['items'] ?? {}), ...campaignItems }`.

---

### Phase 2: Milestone 114 — Complete SRD Feat Catalog & Effect Provider Wiring

1. **Implement `buildFeatEffectModifiers` and `collectActiveFeatRuleOverrides` (`src/rulesets/dnd35e/progression/ledger_modifiers.ts`)**:
   - `buildFeatEffectModifiers(featIds, featRegistry, suppressedBundleIds, activeSelfTags)`:
     - Iterates `featIds`. Tracks occurrence counts per feat ID so stacking repeatable feats (*Toughness*) receive unique provenance (`feat:toughness#1/...`, `feat:toughness#2/...`).
     - Resolves parameterized feat IDs (`weapon_focus:longsword` or `weapon_focus_longsword`) against `featRegistry[rawId] ?? featRegistry[baseId]`.
     - Evaluates both `featDef.modifiers` and `featDef.effectBundle`, returning `ReadonlyArray<StatModifier>`.
   - `collectActiveFeatRuleOverrides(featIds, featRegistry, suppressedBundleIds, activeSelfTags)`:
     - Collects all `DnD35RuleOverrideEntry` items from active feats (`use_dex_for_light_finesse_melee_attack`, `double_crit_threat_range`, `secondary_natural_penalty`, `twf_primary_penalty_light`, `twf_offhand_penalty_light`, `extra_offhand_attacks`, `maneuver_no_aoo:<type>`, `maneuver_bonus:<type>`, `cast_spells_in_wild_shape`).
2. **Wire Feat Modifiers into Horizon 2 & Horizon 3**:
   - In `src/rulesets/dnd35e/level_ledger.ts` (`rebuildActorStateFromLevelHistory`):
     - Preserve duplicate occurrences for feats with `repeatable?.mode === 'stacking'`.
     - Strip old `feat:` modifiers and append `buildFeatEffectModifiers(...)`.
   - In `src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts` (`evaluateDnD35eEntityDAG`):
     - If `dndData.feats` has feats not yet represented in `extraModifiers` with `sourcePath: 'feat:...'`, evaluate `buildFeatEffectModifiers` dynamically so monster statblocks and spawned NPCs automatically receive all feat modifiers (*Alertness*, *Iron Will*, *Toughness*, *Improved Initiative*, *Dodge*, *Weapon Focus*, etc.).
     - Apply *Weapon Finesse* (`use_dex_for_light_finesse_melee_attack` or `dndData.feats.includes('weapon_finesse')`): when the primary/off-hand melee weapon is light or `isFinesseEligible === true` (or unarmed/natural), use `Math.max(strMod, dexMod)` for melee attack rolls!
     - Pass active feat `CombatRuleOverrides` into `resolveActorAttackRoutine`.
3. **Enable `has_feat` Reference Check in `src/rulesets/dnd35e/validation/class_race_validator.ts`**:
   - In `validatePrerequisiteNodeReferences`, validate `case 'has_feat':` against `sys.feats[node.featId] ?? sys.feats[node.featId.split(':')[0]!]`.
4. **Author Complete Modular SRD Feat Catalog (`public/data/rulesets/dnd35e/feats/<id>.json` & `system_content_files.ts`)**:
   - Author 85+ modular JSON files covering:
     - **Melee & Tactical Stance Chains**: `power_attack`, `cleave`, `great_cleave`, `combat_expertise`, `whirlwind_attack`, `dodge`, `mobility`, `spring_attack`, `weapon_finesse`, `weapon_focus`, `weapon_specialization`, `greater_weapon_focus`, `greater_weapon_specialization`, `improved_critical`, `exotic_weapon_proficiency`, `martial_weapon_proficiency`, `simple_weapon_proficiency`, `armor_proficiency_light`, `armor_proficiency_medium`, `armor_proficiency_heavy`, `shield_proficiency`, `tower_shield_proficiency`.
     - **Combat Maneuver Chains**: `improved_bull_rush`, `improved_overrun`, `improved_sunder`, `improved_disarm`, `improved_feint`, `improved_trip`, `improved_unarmed_strike`, `improved_grapple`, `deflect_arrows`, `snatch_arrows`, `stunning_fist`.
     - **Two-Weapon & Ranged Chains**: `two_weapon_fighting`, `two_weapon_defense`, `improved_two_weapon_fighting`, `greater_two_weapon_fighting`, `point_blank_shot`, `precise_shot`, `improved_precise_shot`, `far_shot`, `rapid_shot`, `manyshot`, `shot_on_the_run`, `rapid_reload`, `quick_draw`, `mounted_combat`, `mounted_archery`, `ride_by_attack`, `spirited_charge`, `trample`.
     - **Save, Defensive, Skill & General Feats**: `combat_reflexes`, `blind_fight`, `improved_initiative`, `toughness`, `endurance`, `diehard`, `run`, `track`, `iron_will`, `lightning_reflexes`, `great_fortitude`, `skill_focus`, `alertness`, `stealthy`, `nimble_fingers`, `acrobatic`, `agile`, `athletic`, `deceitful`, `deft_hands`, `diligent`, `investigator`, `magical_aptitude`, `negotiator`, `persuasive`, `self_sufficient`, `extra_turning`, `improved_turning`.
     - **Monster & Weapon-Specific Feats**: `multiattack`, `multiweapon_fighting`, `improved_multiweapon_fighting`, `greater_multiweapon_fighting`, `ability_focus`, `ability_focus_poison`, `awesome_blow`, `empower_spell_like_ability`, `quicken_spell_like_ability`, `flyby_attack`, `hover`, `improved_natural_armor`, `improved_natural_attack`, `snatch`, `wingover`, `weapon_focus_bite`, `weapon_focus_claw`, `weapon_focus_greataxe`, `weapon_focus_longsword`, `weapon_focus_hoof`, `weapon_focus_ray`.
     - **Spellcasting & Metamagic Feats**: `combat_casting`, `spell_focus`, `greater_spell_focus`, `spell_penetration`, `greater_spell_penetration`, `augment_summoning`, `natural_spell`, `eschew_materials`, `empower_spell`, `enlarge_spell`, `extend_spell`, `heighten_spell`, `maximize_spell`, `quicken_spell`, `silent_spell`, `still_spell`, `widen_spell`.

---

### Phase 3: Milestone 115 — Data-Driven `weapon_profile_parser.ts`, `semantic_tags.ts` & SRD Item Compendium

1. **Refactor `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` (100% Data-Driven)**:
   - Add `isFinesseEligible?: boolean` and `reachFt?: number` to `EquippedWeaponProfile`.
   - Refactor `evaluateNonproficiencyPenalty`:
     - Accept `familiaritySubtypes?: ReadonlyArray<string>` from `weaponStats`.
     - Check if any subtype in `familiaritySubtypes` matches `dndData.raceId` or `dndData.subtypes` (handling *Dwarven Waraxe*, *Dwarven Urgrosh*, and *Gnome Hooked Hammer* declaratively without `weaponItemId.includes('dwarven')`).
   - Refactor `buildUnarmedProfile`:
     - Replace the 7-branch `if/else` size ladder with `scaleWeaponDamageDice('1d3', 'medium', wielderSize)`, and set `isFinesseEligible: true`.
   - Refactor `parseEquippedItem`:
     - Read `weaponStats`, `specialMaterial`, and `magicalProperties` directly from `baseItemDef as DnD35ItemDefinition`:
       - `baseDice = weaponStats?.damageDice ?? diceTagFallback ?? '1d8'`
       - `damageType = weaponStats?.damageType ?? tagDamageTypeFallback ?? 'slashing'`
       - `critThreatMin = weaponStats?.critThreatMin ?? threatTagFallback ?? 20` (if `magicalProperties?.keen === true` or actor has `improved_critical`, double threat range: `21 - (21 - critThreatMin) * 2`)
       - `critMultiplier = weaponStats?.critMultiplier ?? critMultTagFallback ?? 2`
       - `inherentEffort = weaponStats?.effort ?? effortTagFallback ?? 'one_handed'`
       - `isDoubleWeapon = weaponStats?.isDoubleWeapon ?? itemTags.includes('double_weapon')`
       - `isFinesseEligible = weaponStats?.isFinesseEligible === true || inherentEffort === 'light' || itemTags.includes('finesse')`
       - `cannotTwoHandStr = weaponStats?.cannotTwoHandStr === true || itemTags.includes('cannot_two_hand_str')`
       - `isExotic1HMartial2H = weaponStats?.isExotic1HMartial2H === true || itemTags.includes('exotic_1h_martial_2h')`
     - Zero hardcoded `baseItemDef.id === ...` or `baseItemDef.id.includes(...)` branches!
2. **Refactor `src/rulesets/dnd35e/semantic_tags.ts` (100% Data-Driven Armor Context)**:
   - Update `resolveEntitySituationalTagContext`:
     - Inspect `itemDef.armorStats` and `itemDef.specialMaterial` (applying `applyMaterialPhysics` when `specialMaterial === 'mithral'` or `itemTags` includes `'mithral'`).
     - Derive `armorCategory` (`'light' | 'medium' | 'heavy'`), `hasShield` (`armorCategory === 'shield' || armorCategory === 'tower_shield'`), and `isMetalArmorOrShield` (`armorStats.isMetal === true`) directly from `armorStats` (falling back to tags/thresholds only when `armorStats` is absent).
     - Remove all hardcoded `lowerId.includes('full_plate')`, `lowerId.includes('breastplate')`, etc.
3. **Wire Equipped Item `effectBundle`, Armor/Shield Modifiers, and *Ghost Touch* / *Force* AC into `dnd35e_dag_adapter.ts` & `stacking_engine.ts`**:
   - In `dnd35e_dag_adapter.ts`:
     - Evaluate `itemDef.effectBundle` on every equipped, non-suppressed item (`sourcePath: "item:<itemId>"`), merging `statModifiers` and `grantedTags` into the entity's DAG inputs.
     - For equipped items with `armorStats`, emit typed `'armor'`, `'armor_enhancement'`, `'shield'`, and `'shield_enhancement'` modifiers with `effectTags: ['ghost_touch']` when `magicalProperties?.ghostTouch === true`.
     - Pass the lowest equipped `armorStats.maxDexBonus` into `evaluateDnD35ActorStatDAG`.
   - In `stacking_engine.ts`:
     - Preserve armor/shield bonuses against incorporeal touch attacks when `mod.effectTags` includes `'force'` or `'ghost_touch'`.
4. **Author Complete Modular SRD Item Compendium (`public/data/rulesets/dnd35e/items/<id>.json` & `system_content_files.ts`)**:
   - Author 110+ modular JSON files covering:
     - **Simple, Martial & Exotic Weapons (60+ weapons)**: All SRD unarmed, light, one-handed, two-handed, reach, double, thrown, and projectile weapons (`unarmed_strike`, `gauntlet`, `dagger`, `punching_dagger`, `spiked_gauntlet`, `light_mace`, `sickle`, `club`, `heavy_mace`, `morningstar`, `shortspear`, `longspear`, `quarterstaff`, `spear`, `heavy_crossbow`, `light_crossbow`, `dart`, `javelin`, `sling`, `throwing_axe`, `light_hammer`, `handaxe`, `kukri`, `light_pick`, `sap`, `short_sword`, `battleaxe`, `flail`, `longsword`, `heavy_pick`, `rapier`, `scimitar`, `trident`, `warhammer`, `falchion`, `glaive`, `greataxe`, `greatclub`, `heavy_flail`, `greatsword`, `guisarme`, `halberd`, `lance`, `ranseur`, `scythe`, `shortbow`, `composite_shortbow`, `longbow`, `composite_longbow`, `kama`, `nunchaku`, `sai`, `siangham`, `bastard_sword`, `dwarven_waraxe`, `whip`, `orc_double_axe`, `spiked_chain`, `dire_flail`, `gnome_hooked_hammer`, `two_bladed_sword`, `dwarven_urgrosh`, `bolas`, `hand_crossbow`, `repeating_heavy_crossbow`, `repeating_light_crossbow`, `net`, `shuriken`).
     - **Armors, Shields & Special Material Variants (25+ items)**: `padded_armor`, `leather_armor`, `studded_leather_armor`, `chain_shirt`, `mithral_chain_shirt`, `hide_armor`, `scale_mail`, `chainmail`, `breastplate`, `mithral_full_plate`, `splint_mail`, `banded_mail`, `half_plate`, `full_plate`, `adamantine_full_plate`, `buckler`, `light_wooden_shield`, `light_steel_shield`, `heavy_wooden_shield`, `heavy_steel_shield`, `darkwood_heavy_shield`, `tower_shield`.
     - **Magical Weapons & Armors (15+ items)**: `longsword_plus1`, `longsword_plus2`, `flaming_longsword_plus1`, `frost_battleaxe_plus1`, `shock_shortbow_plus1`, `keen_rapier_plus1`, `ghost_touch_longsword_plus1`, `holy_greatsword_plus2`, `adamantine_greataxe`, `cold_iron_longsword`, `alchemical_silver_dagger`, `chain_shirt_plus1`, `full_plate_plus1`, `ghost_touch_full_plate_plus1`, `animated_heavy_steel_shield_plus1`, `heavy_fortification_full_plate_plus1`.
     - **Wondrous Items, Rings, Rods, Staves, Wands, Scrolls & Potions (30+ items)**: `belt_of_giant_strength_plus2`, `belt_of_giant_strength_plus4`, `belt_of_giant_strength_plus6`, `gloves_of_dexterity_plus2`, `gloves_of_dexterity_plus4`, `gloves_of_dexterity_plus6`, `headband_of_intellect_plus2`, `headband_of_intellect_plus4`, `headband_of_intellect_plus6`, `periapt_of_wisdom_plus2`, `periapt_of_wisdom_plus4`, `periapt_of_wisdom_plus6`, `amulet_of_health_plus2`, `amulet_of_health_plus4`, `amulet_of_health_plus6`, `cloak_of_charisma_plus2`, `cloak_of_charisma_plus4`, `cloak_of_charisma_plus6`, `ring_of_protection_plus1`, `ring_of_protection_plus2`, `ring_of_protection_plus3`, `amulet_of_natural_armor_plus1`, `amulet_of_natural_armor_plus2`, `amulet_of_natural_armor_plus3`, `amulet_of_mighty_fists_plus1`, `bracers_of_armor_plus2`, `bracers_of_armor_plus4`, `cloak_of_resistance_plus1`, `cloak_of_resistance_plus2`, `cloak_of_resistance_plus3`, `boots_of_speed`, `boots_of_striding_and_springing`, `cloak_of_elvenkind`, `boots_of_elvenkind`, `goggles_of_night`, `handy_haversack`, `bag_of_holding_type_i`, `ring_of_evasion`, `ring_of_feather_falling`, `metamagic_rod_empower_lesser`, `metamagic_rod_extend_lesser`, `metamagic_rod_quicken_lesser`, `staff_of_fire`, `staff_of_healing`, `wand_magic_missile`, `wand_cure_light_wounds`, `scroll_fireball`, `scroll_magic_missile`, `potion_cure_light_wounds`, `potion_cure_serious_wounds`, `potion_bulls_strength`, `potion_cats_grace`.

---

## 4. Concrete Code Snippets & Diffs

### Snippet 1: `src/rulesets/dnd35e/types/system/item_system.types.ts`
```ts
import { z } from 'zod';
import { ItemDefinitionSchema } from '../../../../types/campaign/item.ts';
import { DnD35DamageTypeSchema } from './base_system.types.ts';
import { DnD35EffectBundleSchema } from './effect_system.types.ts';

/** Canonical D&D 3.5e special material types. */
export const DnD35SpecialMaterialSchema = z.enum([
  'mundane',
  'masterwork',
  'mithral',
  'adamantine',
  'darkwood',
  'alchemical_silver',
  'cold_iron'
]);
export type DnD35SpecialMaterial = z.infer<typeof DnD35SpecialMaterialSchema>;

/** Structured D&D 3.5e weapon statistics driving `weapon_profile_parser.ts` without hardcoded IDs. */
export const DnD35WeaponStatsSchema = z.object({
  proficiencyCategory: z.enum(['simple', 'martial', 'exotic']),
  weaponCategory: z.enum(['unarmed', 'melee', 'ranged', 'thrown']),
  effort: z.enum(['light', 'one_handed', 'two_handed']),
  damageDice: z.string(),
  damageType: DnD35DamageTypeSchema,
  secondaryDamageTypes: z.array(DnD35DamageTypeSchema).optional(),
  critThreatMin: z.number().int().min(15).max(20).default(20),
  critMultiplier: z.number().int().min(2).max(4).default(2),
  rangeIncrementFt: z.number().int().positive().optional(),
  reachFt: z.number().int().positive().default(5),
  strikesAdjacent: z.boolean().default(true),
  isDoubleWeapon: z.boolean().default(false),
  offHandDamageDice: z.string().optional(),
  offHandDamageType: DnD35DamageTypeSchema.optional(),
  isFinesseEligible: z.boolean().default(false),
  cannotTwoHandStr: z.boolean().default(false),
  isExotic1HMartial2H: z.boolean().default(false),
  familiaritySubtypes: z.array(z.string()).default([]),
  maneuverTags: z
    .array(z.enum(['trip', 'disarm', 'brace_vs_charge', 'monk', 'nonlethal_only', 'composite_str']))
    .default([])
});
export type DnD35WeaponStats = z.infer<typeof DnD35WeaponStatsSchema>;

/** Structured D&D 3.5e armor & shield statistics driving `semantic_tags.ts` and Stage 3/4 Stat DAG. */
export const DnD35ArmorStatsSchema = z.object({
  armorCategory: z.enum(['light', 'medium', 'heavy', 'shield', 'tower_shield']),
  armorBonus: z.number().int().nonnegative(),
  maxDexBonus: z.number().int().nonnegative().nullable().default(null),
  armorCheckPenalty: z.number().int().max(0).default(0),
  arcaneSpellFailure: z.number().int().min(0).max(100).default(0),
  speed30Ft: z.number().int().positive().optional(),
  speed20Ft: z.number().int().positive().optional(),
  isMetal: z.boolean().default(false)
});
export type DnD35ArmorStats = z.infer<typeof DnD35ArmorStatsSchema>;

/** Structured magical armament properties. */
export const DnD35MagicalPropertiesSchema = z.object({
  enhancementBonus: z.number().int().min(0).max(5).default(0),
  isMasterwork: z.boolean().default(false),
  keen: z.boolean().optional(),
  ghostTouch: z.boolean().optional(),
  animated: z.boolean().optional(),
  fortificationType: z.enum(['light', 'moderate', 'heavy']).optional(),
  baneCreatureType: z.string().optional(),
  energyRiders: z
    .array(
      z.object({
        propertyId: z.string(),
        dice: z.string(),
        damageType: DnD35DamageTypeSchema
      })
    )
    .optional(),
  onHitEffectIds: z.array(z.string()).optional()
});
export type DnD35MagicalProperties = z.infer<typeof DnD35MagicalPropertiesSchema>;

/** Complete D&D 3.5e Item Definition schema (`public/data/rulesets/dnd35e/items/<id>.json`). */
export const DnD35ItemDefinitionSchema = ItemDefinitionSchema.extend({
  weaponStats: DnD35WeaponStatsSchema.optional(),
  armorStats: DnD35ArmorStatsSchema.optional(),
  specialMaterial: DnD35SpecialMaterialSchema.optional(),
  magicalProperties: DnD35MagicalPropertiesSchema.optional(),
  effectBundle: DnD35EffectBundleSchema.optional()
});
export type DnD35ItemDefinition = z.infer<typeof DnD35ItemDefinitionSchema>;
```

### Snippet 2: Data-Driven `parseEquippedItem` & `evaluateNonproficiencyPenalty` (`src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`)
```ts
export function evaluateNonproficiencyPenalty(
  weaponItemId: string | undefined,
  isExotic1HMartial2H: boolean | undefined,
  finalHandedness: 'light' | 'one_handed' | 'two_handed',
  dndData: Partial<DnD35EntityData> | undefined,
  familiaritySubtypes: ReadonlyArray<string> = []
): number {
  if (!isExotic1HMartial2H || finalHandedness === 'two_handed') {
    return 0;
  }
  const feats = dndData?.feats ?? [];
  const hasExoticProficiency = feats.some(
    (f) =>
      f === 'exotic_weapon_proficiency' ||
      (weaponItemId !== undefined &&
        (f === `exotic_weapon_proficiency_${weaponItemId}` || f === `exotic_weapon_proficiency:${weaponItemId}`))
  );
  if (hasExoticProficiency) {
    return 0;
  }
  if (familiaritySubtypes.length > 0) {
    const actorSubtypes = new Set<string>([
      ...(dndData?.raceId ? [dndData.raceId] : []),
      ...(dndData?.subtypes ?? [])
    ]);
    if (familiaritySubtypes.some((sub) => actorSubtypes.has(sub))) {
      return 0;
    }
  }
  return NONPROFICIENCY_ATTACK_PENALTY;
}

export function buildUnarmedProfile(wielderSize: CreatureSizeCategory, isOffHand: boolean): EquippedWeaponProfile {
  const unarmedDice = scaleWeaponDamageDice('1d3', 'medium', wielderSize);
  return {
    isArmed: false,
    wieldable: true,
    weaponName: isOffHand ? 'Unarmed Strike (Off-Hand)' : 'Unarmed Strike',
    weaponSize: wielderSize,
    weaponDice: unarmedDice,
    weaponDamageType: 'bludgeoning',
    critThreatMin: DEFAULT_CRIT_THREAT_MIN,
    critMultiplier: DEFAULT_CRIT_MULTIPLIER,
    inherentEffort: 'light',
    effectiveEffort: 'light',
    handedness: 'light',
    isFinesseEligible: true,
    attackBonus: 0,
    sizeAttackPenalty: 0,
    nonproficiencyPenalty: 0,
    damageBonus: 0,
    bypassTags: ['bludgeoning']
  };
}
```

### Snippet 3: Example Weapon JSON (`public/data/rulesets/dnd35e/items/dwarven_waraxe.json`)
```json
{
  "dwarven_waraxe": {
    "id": "dwarven_waraxe",
    "name": "Dwarven Waraxe",
    "description": "A dwarven waraxe is too large to use in one hand without special training; thus, it is an exotic weapon. A Medium character can use a dwarven waraxe two-handed as a martial weapon, or a Large creature can use it one-handed in the same way. A dwarf treats a dwarven waraxe as a martial weapon even when using it in one hand.",
    "glyph": ")",
    "fg": "#c0c0c0",
    "bg": "#000000",
    "category": "weapon",
    "tags": ["slashing", "exotic_1h_martial_2h"],
    "weight": 8,
    "baseValue": 30,
    "equippable": {
      "slot": "main_hand",
      "attackBonus": 0,
      "defenseBonus": 0,
      "maxHpBonus": 0,
      "carryBonus": 0
    },
    "weaponStats": {
      "proficiencyCategory": "exotic",
      "weaponCategory": "melee",
      "effort": "one_handed",
      "damageDice": "1d10",
      "damageType": "slashing",
      "critThreatMin": 20,
      "critMultiplier": 3,
      "reachFt": 5,
      "strikesAdjacent": true,
      "isDoubleWeapon": false,
      "isFinesseEligible": false,
      "cannotTwoHandStr": false,
      "isExotic1HMartial2H": true,
      "familiaritySubtypes": ["dwarf"],
      "maneuverTags": []
    }
  }
}
```

### Snippet 4: Example Metamagic Feat JSON (`public/data/rulesets/dnd35e/feats/empower_spell.json`)
```json
{
  "empower_spell": {
    "id": "empower_spell",
    "name": "Empower Spell",
    "description": "All variable, numeric effects of an empowered spell are increased by one-half. An empowered spell uses up a spell slot two levels higher than the spell's actual level.",
    "isFighterBonusFeat": false,
    "metamagicDescriptor": {
      "slotLevelAdjustment": 2,
      "empowerDamageMultiplier": 1.5
    },
    "effectBundle": {
      "bundleId": "feat:empower_spell",
      "name": "Empower Spell",
      "category": "feat",
      "usageMode": "passive",
      "grantedTags": ["metamagic:empower_spell"]
    }
  }
}
```

---

## 5. Verification Strategy & Step 5 Gate

1. **Automated Test Suites**:
   - `tests/dnd35e_feats_m114.test.ts`: Tests all 85+ SRD feats, prerequisite AST validation (`has_feat`), passive stat modifiers in the 4-Stage DAG, stacking repeatable *Toughness*, *Weapon Finesse* DEX-to-attack override, *Improved Critical*, *Multiattack*, and metamagic descriptors.
   - `tests/dnd35e_equipment_m115.test.ts`: Tests all 110+ SRD items, 100% data-driven `weapon_profile_parser.ts` (zero hardcoded ID branches, dwarven/gnome weapon familiarity, finesse, reach, double weapons, unarmed strike scaling), `semantic_tags.ts` armor category & Mithral step-down, equipped wondrous items in the Stat DAG, and *Ghost Touch* / *Force* AC preservation against incorporeal touch attacks.
   - `tests/ssot_registry_parity.test.ts`: Verifies `ssot_dnd35e.json` and `SSOT_DND35E.md` include `item_system.types.ts` and all new modular files.
2. **Full 8-Stage `./verify.sh` Pipeline**:
   - Must pass with 0 errors and 0 warnings across TypeScript, Prettier, ESLint, File Length ($\le 300$ lines), Architecture, Knip dead-code, Bun tests, Vite build, and Campaign/SSOT Validator.

**Implementation Plan Gate:**
Per `AGENTS.md` Step 5:
> **STOP HERE and wait for the User's explicit approval of the Implementation Plan before writing or modifying any actual codebase files.**
