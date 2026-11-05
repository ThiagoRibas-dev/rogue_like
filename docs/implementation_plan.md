# Milestone 114 & 115 Implementation Plan: Complete SRD Feat Registry, Combat Chains & Metamagic Trees + Complete SRD Equipment & Magic Item Compendium

**Date:** 2026-11-04  
**Status:** In Review (Kickoff Flow Step 4 & 5: Implementation Plan Gate)  
**Authors:** AI Agent (Antigravity / DeepSeek Harness) & User  
**Milestones Covered:**
- **Milestone 114**: Complete SRD Feat Registry, Combat Chains & Metamagic Trees (`public/data/rulesets/dnd35e/feats/<id>.json`)
- **Milestone 115**: Complete SRD Weapons, Armors, Special Materials & Magic Item Compendium (`public/data/rulesets/dnd35e/items/<id>.json`)
**Architecture References:** `docs/ARCHITECTURE.md`, `AGENTS.md` (§0 Golden Rules 1–20), `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`, `docs/MILESTONES.md#L1592-L1635`, `docs/research_notes.md`

---

## 1. Executive Summary & Architectural Goals

The joint objective of **Milestones 114 and 115** is to establish the complete System Content (Tier 3) catalogs for SRD Feats and SRD Equipment (Weapons, Armors, Shields, Special Materials, Magic Properties, Wondrous Items, Rings, Rods, Staves, Wands, and Consumables) in modular, data-driven JSON formats, while delivering deep, reusable Tier 2 Cartridge integrations into the 4-Stage Topological Stat DAG, attack routines, tactical maneuvers, special material physics, and metamagic spellcasting.

### User Architectural Directive: Data-Driven Reusability
Per user architectural guidance, **hardcoding specific feat IDs or item IDs in combat or stat resolvers is strictly forbidden unless no general abstraction makes sense**. All feat bonuses, stat adjustments, and equipment effects must be expressed through:
1. **Declarative `DnD35EffectBundle`s** carrying typed `statModifiers`, `grantedTags`, and `ruleOverrides` with hierarchical `sourcePath` provenance (`feat:<id>/...` and `item:<itemId>/...`).
2. **Generic Tactical Stance Dials** (e.g. `CANONICAL_TACTICAL_DIALS` in `tactical_doctrine.ts`) dynamically parameterized by character stats (`bab`, `handedness`) and stance tags, rather than ad-hoc feat branches.
3. **Semantic Tag Projections** (`item:weapon:finesse`, `item:weapon:reach_10ft`, `feat:cleave_eligible`, `material:mithral`) that downstream combat mechanics consume uniformly.

---

## 2. Reiteration of Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16)**:
   - **Tier 1 (Core Console Engine):**
     - Extend `ItemDefinitionSchema` in `src/types/campaign/item.ts` to support optional ruleset payload `effectBundle?: unknown`, allowing any ruleset cartridge to attach declarative effect bundles without coupling the engine to D&D 3.5e types.
     - Base ECS components (`ItemComponent`, `EquipmentComponent`) remain pure, ruleset-agnostic data holders.
   - **Tier 2 (Ruleset Cartridge):**
     - Define `DnD35ItemDefinitionSchema` in `src/rulesets/dnd35e/types/dnd35e_system.types.ts` strictly validating `ItemDefinitionSchema` extended with `effectBundle?: DnD35EffectBundle`.
     - Feat effect extraction in `src/rulesets/dnd35e/progression/ledger_modifiers.ts` and `level_ledger.ts`, evaluating passive `effectBundle`s into `statModifiers` with `sourcePath: "feat:<featId>/<targetStat>"`.
     - Dynamic equipped item evaluation in `src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`: iterates equipped items in `EquipmentComponent.slots`, resolves their `effectBundle` via `evaluateEffectBundle`, and injects modifiers (`sourcePath: "item:<itemId>/<targetStat>"`) into the 4-Stage Topological Stat DAG.
     - Tabletop mechanics: Special material physics (`special_materials.ts`), weapon profile parsing and size-dice scaling (`weapon_profile_parser.ts`), tactical doctrine dial calculations (`tactical_doctrine.ts`), and metamagic spell slot/casting adjustments (`metamagic_dispel.ts`).
   - **Tier 3 (System Content):**
     - Modular JSON definitions in `public/data/rulesets/dnd35e/feats/<id>.json` (80+ SRD feats).
     - Modular JSON definitions in `public/data/rulesets/dnd35e/items/<id>.json` (110+ SRD weapons, armors, special materials, magic items, wondrous items, and consumables).
     - Registered in `src/rulesets/dnd35e/system_content_files.ts` and validated in `dnd35e_validator.ts` and `scripts/run-validator.ts`.
2. **Declarative Overrides & Modifiers (`AGENTS.md` Rule 17)**:
   - Feat bonuses (e.g. *Iron Will* `+2 Will`, *Lightning Reflexes* `+2 Reflex`, *Great Fortitude* `+2 Fortitude`, *Toughness* `+3 HP`, *Weapon Focus* `+1 attack`) declare typed modifiers in their JSON `effectBundle`.
   - Combat maneuvers and dials (*Power Attack*, *Combat Expertise*) are driven by `variable_dial` schemas and evaluated by the existing generic dial processor.
3. **Universal Actor Symmetry (`AGENTS.md` Rule 18)**:
   - PCs, NPCs, and monsters utilize the exact same feat prerequisite engine, stat DAG evaluation, weapon scaling, and equipment pipelines.
4. **Hierarchical Provenance (`AGENTS.md` Rule 19)**:
   - Feat modifiers: `sourcePath: "feat:<featId>/<subpath>"`.
   - Item modifiers: `sourcePath: "item:<itemId>/<subpath>"`.
   - Tactical dials: `sourcePath: "stance:doctrine/<dialId>_<effect>"`.
5. **Three-Horizon Boundaries (`AGENTS.md` Rule 20)**:
   - Horizon 1 (`levelHistory`): Immutable choice of feats and skill ranks.
   - Horizon 2 (`rebuildActorStateFromLevelHistory`): Compiles active feat set and passive effect bundle modifiers into `dndData.statModifiers`.
   - Horizon 3 (`evaluateDnD35eEntityDAG`): Dynamically resolves equipped item effect bundles, tactical doctrine dials, and situational tags into the final stat DAG.
6. **TypeScript Strictness (`AGENTS.md` Rules 10–14)**:
   - Zero `any`, explicit return types on every function, exhaustive switch guards with `assertNever`, `exactOptionalPropertyTypes: true` compliance.

---

## 3. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner (New SSOT) | Legacy / Old-Brain Implementation | Eviction Action |
| :--- | :--- | :--- | :--- |
| **Equipped Item Modifiers** | `evaluateEquippedItemEffectBundles` in `dnd35e_dag_adapter.ts` feeding `extraModifiers` into DAG Stages 1–4 | `getEquippedItemBonuses` in `srd_registry.ts` which only summed untyped `attackBonus` and `defenseBonus` | Deprecate `getEquippedItemBonuses` in favor of declarative `effectBundle` evaluation; keep thin fallback wrapper for legacy tests without breaking backward compatibility |
| **Feat Stat Modifiers** | `buildFeatEffectModifiers` in `ledger_modifiers.ts` + `level_ledger.ts` | No evaluation existed; feat modifiers were ignored by the stat DAG | Implement `buildFeatEffectModifiers` to evaluate `sysContent.feats[f].effectBundle` into `dndData.statModifiers` |
| **Tactical Combat Dials** | `evaluateTacticalDoctrineModifiers` in `tactical_doctrine.ts` via `CANONICAL_TACTICAL_DIALS` | Ad-hoc checks in combat attack resolver | Use canonical dial definitions and feed through DAG `extraModifiers` |
| **Item Definitions Catalog** | Modular files `public/data/rulesets/dnd35e/items/<id>.json` + `system_content_files.ts` + merged in `loader.ts` and `tests/helpers.ts` | Hardcoded monolithic campaign `items.json` in `dnd35e-crypt` | Modular SRD catalog loaded as ruleset base content; campaigns override or extend specific items |
| **Metamagic Computations** | `metamagic_dispel.ts` (`calculateAdjustedSpellLevel`, `getSpontaneousMetamagicActionType`) | Scattered slot adjustments | Canonical centralized metamagic calculation |

---

## 4. Step-by-Step Implementation Strategy

### Step 1: Type & Loader Harmonization (Tier 1 & Tier 2)
1. **Tier 1 Base Item Schema (`src/types/campaign/item.ts`)**:
   - Add `effectBundle: z.unknown().optional()` to `ItemDefinitionSchema`. This allows rulesets to attach arbitrary effect bundle payloads without coupling core engine types to specific rulesets.
2. **Tier 2 D&D 3.5e Item & Feat Schema (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`)**:
   - Define `DnD35ItemDefinitionSchema`:
     ```ts
     export const DnD35ItemDefinitionSchema = ItemDefinitionSchema.extend({
       effectBundle: DnD35EffectBundleSchema.optional()
     });
     export type DnD35ItemDefinition = z.infer<typeof DnD35ItemDefinitionSchema>;
     ```
   - Update `DnD35SystemContentSchema` to include `items: z.record(z.string(), DnD35ItemDefinitionSchema).default({})`.
   - Extend `DnD35FeatDefinitionSchema` with optional `repeatable?: { mode: 'stacking' | 'targeted'; targetCategory?: 'weapon' | 'school' | 'skill'; }`:
     - `mode: 'stacking'` (e.g. *Toughness*, *Extra Turning*): Can be chosen multiple times; effects stack cumulatively across takes.
     - `mode: 'targeted'` (e.g. *Weapon Focus*, *Spell Focus*, *Skill Focus*): Can be chosen multiple times, but each selection must choose a distinct sub-target (weapon, school, skill) and effects do not stack on the same target.
3. **Ruleset System Content Registry (`src/rulesets/dnd35e/system_content_files.ts`)**:
   - Expand `FEAT_IDS` with all 80+ SRD feats.
   - Define and export `ITEM_IDS` containing all 110+ SRD weapons, armors, special materials, and magic items.
   - Add `{ key: 'items', filename: 'items.json' }` and `...ITEM_IDS.map((id) => ({ key: 'items', filename: `items/${id}.json` }))` to `DND35E_SYSTEM_CONTENT_FILES`.
4. **System Content Loader & Assembler (`src/core/loader.ts` & `tests/helpers.ts`)**:
   - In `loader.ts` and `tests/helpers.ts`, ensure `rawSystemContent['items']` (from modular `items/*.json`) merges cleanly into `campaign.items = { ...rulesetBase.items, ...systemContentItems, ...campaign.items }`.

### Step 2: Feat Effect Bundle Integration & Repeatable Feat Support (Tier 2 Cartridge)
1. **Passive Feat Modifier Compiler (`src/rulesets/dnd35e/progression/ledger_modifiers.ts`)**:
   - Implement `buildFeatEffectModifiers`:
     ```ts
     export function buildFeatEffectModifiers(
       featIds: ReadonlyArray<string>,
       featDefs: Record<string, DnD35FeatDefinition> | undefined,
       activeTags: ReadonlyArray<string>
     ): ReadonlyArray<DnD35StatModifier>
     ```
   - Iterates active feats. For stacking repeatable feats (e.g. *Toughness* taken N times), tracks instance counts and generates distinct, deterministic hierarchical `sourcePath` lineages: `feat:<featId>#<instance>/<targetStat>` (Rule 19), avoiding DAG node collisions.
   - For parameterized feats (e.g. `weapon_focus:longsword` or `weapon_focus_longsword`), resolves against base definition `weapon_focus` and scopes the modifier with target tags.
2. **Level Ledger Rebuilder (`src/rulesets/dnd35e/level_ledger.ts`)**:
   - Update `rebuildActorStateFromLevelHistory`:
     - Previously, `featsSet = new Set<string>()` silently collapsed duplicate feat selections, stripping multiple takes of stacking feats (*Toughness*).
     - Revise feat aggregation: Preserve duplicate occurrences for feats marked `repeatable.mode === 'stacking'`. For non-stacking feats, deduplicate identical entries.
     - Filter out existing `feat:` prefixes in `nonClassMods`.
     - Call `buildFeatEffectModifiers(rebuiltFeats, sysContent.feats, activeTags)` and append to returned `statModifiers`.
3. **Character Builder & Prerequisite Validation Alignment (`dnd35e_char_builder_feats.ui.ts`, `prerequisites.ts`)**:
   - Allow selecting a feat that is already owned/selected if `featDef.repeatable?.mode === 'stacking'`, as long as feat slots remain.
   - For targeted feats (`repeatable.mode === 'targeted'`), require selecting an unchosen target (e.g. weapon, school, skill).

### Step 3: Dynamic Equipped Item Evaluation in Stat DAG (Tier 2 Cartridge)
1. **Equipped Item Effect Bundler (`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`)**:
   - Implement `collectEquippedItemEffectModifiers(state, entityId, activeTags)`:
     - Scans `EquipmentComponent.slots`. For each equipped, non-suppressed item:
     - Resolves `itemComp.itemId` against `state.campaign.items`.
     - If the item has `effectBundle`:
       - Evaluates `evaluateEffectBundle(itemDef.effectBundle, 'item:' + itemComp.itemId, activeTags)`.
       - Appends emitted `statModifiers` (with `sourcePath: "item:<itemId>/..."`) into `extraModifiers`.
       - Merges any `grantedTags` into the live entity tag projection.
       - Accumulates any `ruleOverrides`.
     - Preserves base armor/shield ACP and Max Dex calculations using item definition tags (`material:mithral`, `material:darkwood`, etc.) via `special_materials.ts`.

### Step 4: Author Complete SRD Feat Registry (`public/data/rulesets/dnd35e/feats/*.json`)
Author modular JSON files conforming to `DnD35FeatDefinitionSchema`:
1. **Melee, Stance & Maneuver Feats (29 feats)**:
   - `power_attack.json` (variable dial 0..BAB, double for 2H)
   - `cleave.json` & `great_cleave.json` (triggered extra attack on foe drop)
   - `combat_expertise.json` (variable dial 0..min(5, BAB) for dodge AC)
   - `improved_bull_rush.json`, `improved_overrun.json`, `improved_sunder.json`, `improved_disarm.json`, `improved_feint.json`, `improved_trip.json` (+4 maneuver checks, no AoO)
   - `whirlwind_attack.json` (melee full attack vs all adjacent foes)
   - `dodge.json` (+1 dodge AC), `mobility.json` (+4 dodge AC vs AoO), `spring_attack.json` (move-attack-move)
   - `weapon_finesse.json` (use DEX mod for attack rolls with light/finesse weapons)
   - `weapon_focus.json` (+1 attack), `weapon_specialization.json` (+2 damage, Fighter 4)
   - `greater_weapon_focus.json` (+1 attack, Fighter 8), `greater_weapon_specialization.json` (+2 damage, Fighter 12)
   - `improved_critical.json` (doubles critical threat range)
   - `two_weapon_fighting.json` (reduces TWF penalties to -2/-2)
   - `two_weapon_defense.json` (+1 shield AC when wielding two weapons)
   - `improved_two_weapon_fighting.json` (second off-hand attack at -5)
   - `greater_two_weapon_fighting.json` (third off-hand attack at -10)
   - `improved_unarmed_strike.json` (lethal unarmed damage, no AoO)
   - `improved_grapple.json` (+4 grapple, no AoO)
   - `deflect_arrows.json` & `snatch_arrows.json` (negate/catch 1 ranged attack/round)
   - `stunning_fist.json` (DC 10 + 1/2 level + WIS stun on unarmed hit)
2. **Ranged, Defensive, Save & Monster Feats (32 feats)**:
   - `point_blank_shot.json` (+1 attack/damage within 30 ft)
   - `precise_shot.json` (negates -4 penalty firing into melee)
   - `improved_precise_shot.json` (ignores anything less than total cover/concealment)
   - `far_shot.json` (multiplies range increment by 1.5x / 2.0x)
   - `rapid_shot.json` (extra ranged attack at -2 on all attacks)
   - `manyshot.json` (fire 2+ arrows as standard action)
   - `shot_on_the_run.json` (move-ranged attack-move)
   - `rapid_reload.json` (reduces crossbow reload time)
   - `quick_draw.json` (draw weapon as free action)
   - `combat_reflexes.json` (extra AoOs equal to DEX modifier, AoO while flat-footed)
   - `blind_fight.json` (reroll miss chance for concealment)
   - `improved_initiative.json` (+4 initiative)
   - `toughness.json` (+3 HP), `endurance.json`, `diehard.json` (stay conscious 0 to -9 HP)
   - `iron_will.json` (+2 Will), `lightning_reflexes.json` (+2 Reflex), `great_fortitude.json` (+2 Fortitude)
   - `skill_focus.json` (+3 to chosen skill), `alertness.json`, `stealthy.json`, `nimble_fingers.json`, `acrobatic.json`, `agile.json`, `athletic.json`, `deceitful.json`, `deft_hands.json`, `diligent.json`, `investigator.json`, `magical_aptitude.json`, `negotiator.json`, `persuasive.json`, `self_sufficient.json`
   - Monster feats: `multiattack.json` (reduces secondary natural attack penalty from -5 to -2), `multiweapon_fighting.json`, `improved_multiweapon_fighting.json`, `greater_multiweapon_fighting.json`, `ability_focus.json` (+2 special attack DC), `awesome_blow.json`, `empower_spell_like_ability.json`, `quicken_spell_like_ability.json`, `flyby_attack.json`, `hover.json`, `improved_natural_armor.json`, `improved_natural_attack.json`, `snatch.json`, `wingover.json`
3. **Spellcasting & Metamagic Feats (17 feats)**:
   - `combat_casting.json` (+4 Concentration checks when casting defensively)
   - `spell_focus.json` (+1 save DC), `greater_spell_focus.json` (+1 save DC)
   - `spell_penetration.json` (+2 caster level to overcome SR), `greater_spell_penetration.json` (+2)
   - `augment_summoning.json` (+4 STR/CON to summoned creatures)
   - `natural_spell.json` (cast spells while in wild shape)
   - `eschew_materials.json` (cast spells without inexpensive material components)
   - Metamagic: `empower_spell.json` (+2 slot, x1.5 variable numeric damage), `enlarge_spell.json` (+1 slot, 2x range), `extend_spell.json` (+1 slot, 2x duration), `heighten_spell.json` (increase effective spell level), `maximize_spell.json` (+3 slot, max dice damage), `quicken_spell.json` (+4 slot, swift action cast), `silent_spell.json` (+1 slot, no verbal), `still_spell.json` (+1 slot, no somatic), `widen_spell.json` (+3 slot, 2x area)

### Step 5: Author Complete SRD Equipment Registry (`public/data/rulesets/dnd35e/items/*.json`)
Author modular JSON files conforming to `DnD35ItemDefinitionSchema`:
1. **Simple, Martial & Exotic Weapons (50+ weapons)**:
   - Simple Melee: `dagger`, `punching_dagger`, `gauntlet`, `spiked_gauntlet`, `light_mace`, `sickle`, `club`, `heavy_mace`, `morningstar`, `shortspear`, `longspear`, `quarterstaff`, `spear`
   - Simple Ranged: `heavy_crossbow`, `light_crossbow`, `dart`, `javelin`, `sling`
   - Martial Melee: `throwing_axe`, `light_hammer`, `handaxe`, `kukri`, `light_pick`, `sap`, `short_sword`, `battleaxe`, `flail`, `heavy_flail`, `longsword`, `heavy_pick`, `rapier`, `scimitar`, `trident`, `warhammer`, `falchion`, `glaive`, `greataxe`, `greatclub`, `greatsword`, `guisarme`, `halberd`, `lance`, `ranseur`, `scythe`
   - Martial Ranged: `shortbow`, `composite_shortbow`, `longbow`, `composite_longbow`
   - Exotic Melee: `bastard_sword`, `dwarven_waraxe`, `whip`, `spiked_chain`, `kama`, `nunchaku`, `sai`, `siangham`, `orc_double_axe`, `two_bladed_sword`, `dwarven_urgrosh`, `gnome_hooked_hammer`
   - Exotic Ranged: `hand_crossbow`, `repeating_heavy_crossbow`, `repeating_light_crossbow`, `shuriken`, `bolas`, `net`
2. **Armors, Shields & Special Material Variants (25+ armors & shields)**:
   - Light: `padded_armor`, `leather_armor`, `studded_leather_armor`, `chain_shirt`, `mithral_chain_shirt`
   - Medium: `hide_armor`, `scale_mail`, `chainmail`, `breastplate`, `mithral_full_plate`
   - Heavy: `splint_mail`, `banded_mail`, `half_plate`, `full_plate`, `adamantine_full_plate`
   - Shields: `buckler`, `light_wooden_shield`, `light_steel_shield`, `heavy_wooden_shield`, `heavy_steel_shield`, `darkwood_heavy_shield`, `tower_shield`
3. **Magical Armaments & Properties (15+ items & property descriptors)**:
   - `longsword_plus1`, `longsword_plus2`, `flaming_longsword`, `frost_battleaxe`, `shock_shortsword`, `keen_rapier`, `ghost_touch_spear`, `holy_greatsword`
   - `chain_shirt_plus1`, `full_plate_plus1`, `fortification_light_full_plate`, `shadow_leather_armor`, `spell_resistance_breastplate`
4. **Wondrous Items & Slotted Equipment (25+ slotted items)**:
   - Stat Belts/Headbands/Cloaks: `belt_of_giant_strength_plus2`, `plus4`, `plus6`; `gloves_of_dexterity_plus2`, `plus4`, `plus6`; `headband_of_intellect_plus2`, `plus4`, `plus6`; `periapt_of_wisdom_plus2`, `plus4`, `plus6`; `amulet_of_health_plus2`, `plus4`, `plus6`; `cloak_of_charisma_plus2`, `plus4`, `plus6`
   - Defensive: `ring_of_protection_plus1` through `plus5`, `amulet_of_natural_armor_plus1` through `plus5`, `bracers_of_armor_plus1` through `plus8`, `cloak_of_resistance_plus1` through `plus5`
   - Utility: `boots_of_speed`, `boots_of_striding_and_springing`, `boots_of_elvenkind`, `cloak_of_elvenkind`, `ring_of_evasion`, `ring_of_invisibility`, `ring_of_feather_falling`, `ring_of_sustenance`, `gauntlets_of_ogre_power`
5. **Consumables & Charged Items (15+ consumables)**:
   - Potions: `potion_cure_light_wounds`, `potion_cure_moderate_wounds`, `potion_cure_serious_wounds`, `potion_invisibility`, `potion_bulls_strength`, `potion_cats_grace`, `potion_bears_endurance`
   - Scrolls & Wands: `scroll_magic_missile`, `scroll_fireball`, `wand_magic_missile`, `wand_cure_light_wounds`
   - Staves & Metamagic Rods: `staff_of_fire`, `staff_of_healing`, `metamagic_rod_empower`, `metamagic_rod_extend`, `metamagic_rod_maximize`, `metamagic_rod_quicken`

### Step 6: Validation & Automated Test Verification
1. **System Content Validator (`src/rulesets/dnd35e/dnd35e_validator.ts`)**:
   - Extend `validateDnD35eSystemContentIntegrity` to validate:
     - Feat prerequisite graph: ensures all `has_feat` references resolve to valid feats in `sys.feats`.
     - Feat category, fighter bonus feat flags, and effectBundle schemas.
     - Item inner ID parity: `itemDef.id === itemKey`.
     - Equipment slots and category tags validity.
2. **Dedicated Test Suites**:
   - `tests/dnd35e_feats_m114.test.ts`: Test prerequisite evaluation, fighter bonus feat filtering, passive feat effect bundles (Iron Will, Weapon Focus, Toughness), tactical doctrine dials (Power Attack, Combat Expertise), and metamagic calculations.
   - `tests/dnd35e_equipment_m115.test.ts`: Test weapon profile parsing (reach, finesse, crit, damage dice scaling), special materials physics (Mithral weight/ACP/category reduction, Adamantine DR, Darkwood shield ACP), and equipped item effect bundles feeding into the Stat DAG (Belt of Giant Strength increasing STR in Stage 2, Ring of Protection increasing deflection AC in Stage 3, Cloak of Resistance increasing saves in Stage 3).
3. **Verification Runner**:
   - Run full `./verify.sh` covering TypeScript checks, unit tests, linter, formatting, SSOT registry parity, and schema validation.

---

## 5. Cascading Effects Matrix

| Change | Upstream Dependencies | Downstream Consumers | Lateral / Sibling Systems |
| :--- | :--- | :--- | :--- |
| **1. Base Item Schema (`src/types/campaign/item.ts`)** | `CampaignDataSchema` in `campaign.types.ts`, core loader (`loader.ts`). | `dnd35e_system.types.ts`, item serializers, save/load state. | Sibling campaign items (`dnd35e-crypt/items.json`), classic ruleset items. |
| **2. Modular Item System Content (`system_content_files.ts`, `items/*.json`)** | `system_content_loader.ts`, `loader.ts`, `tests/helpers.ts`. | `state.campaign.items`, `weapon_profile_parser.ts`, `special_materials.ts`, paperdoll HUD, inventory system. | Sibling campaign item definitions, validator scripts (`run-validator.ts`, `ssot_registry_parity.test.ts`). |
| **3. Feat Registry Expansion (`feats/*.json`, `system_content_files.ts`)** | Character builder UI (`dnd35e_char_builder_feats.ui.ts`), level-up ledger, archetype resolver. | `prerequisites.ts` AST validator, `buildFeatEffectModifiers`, tactical doctrine stances, attack resolver. | `public/data/rulesets/dnd35e/feats.json` (empty root), validator parity tests. |
| **4. Passive Feat Effect Modifier Wiring (`ledger_modifiers.ts`, `level_ledger.ts`)** | `sysContent.feats`, `levelHistory.selectedFeats`. | `evaluateDnD35ActorStatDAG` (Stages 1–4 receiving feat bonuses), saving throw calculators, HP computation. | Monster feat hydrators, NPC stat generation. |
| **5. Equipped Item Effect Bundle Evaluation (`dnd35e_dag_adapter.ts`)** | `EquipmentComponent.slots`, `state.campaign.items`. | `evaluateDnD35ActorStatDAG` (Stage 2 ability enhancements, Stage 3 deflection/resistance/armor/shield AC, Stage 4 attack bonuses). | `getEquippedItemBonuses` in `srd_registry.ts` (deprecating double-count). |
| **6. Repeatable Feats Handling (`level_ledger.ts`, `ledger_modifiers.ts`, `dnd35e_char_builder_feats.ui.ts`)** | `levelHistory.selectedFeats`, character creation/level-up feat pickers. | `dndData.feats`, `buildFeatEffectModifiers`, Stat DAG vitality & saves, modifier provenance indexing. | Feat schema validator (`dnd35e_validator.ts`), test fixtures with multiple *Toughness* takes. |
| **7. Validator Extensions (`dnd35e_validator.ts`)** | `validateDnD35eSystemContentIntegrity`. | `scripts/run-validator.ts`, CI test suite, verify script Stage 8. | Campaign data validators, test helpers. |

---

## 6. Concrete Implementation Diffs & Code Snippets

### Snippet 1: Base Item Schema Extension (`src/types/campaign/item.ts`)
```ts
export const ItemDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  glyph: z.string().length(1),
  fg: z.string(),
  bg: z.string(),
  spriteId: z.string().optional(),
  category: ItemCategoryEnum,
  tags: z.array(z.string()).default([]),
  weight: z.number().int().nonnegative(),
  baseValue: z.number().int().nonnegative().default(0),
  isArtifact: z.boolean().optional(),
  effectBundle: z.unknown().optional(), // Ruleset-agnostic payload (validated by ruleset cartridge)
  consumable: z.object({
    effectId: z.string(),
    charges: z.number().int().positive()
  }).optional(),
  equippable: z.object({
    slot: EquipmentSlotEnum,
    attackBonus: z.number().int(),
    defenseBonus: z.number().int(),
    maxHpBonus: z.number().int(),
    carryBonus: z.number().int(),
    onHit: z.object({
      statusId: z.string(),
      duration: z.number().int().positive()
    }).optional()
  }).optional(),
  // throwable, zappable...
});
```

### Snippet 2: D&D 3.5e Item Definition & Repeatable Feat Schema (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`)
```ts
export const DnD35ItemDefinitionSchema = ItemDefinitionSchema.extend({
  effectBundle: DnD35EffectBundleSchema.optional()
});
export type DnD35ItemDefinition = z.infer<typeof DnD35ItemDefinitionSchema>;

/** Repeatable feat configuration distinguishing stacking vs targeted mechanics. */
export const DnD35FeatRepeatableSchema = z.object({
  mode: z.enum(['stacking', 'targeted']),
  targetCategory: z.enum(['weapon', 'school', 'skill']).optional()
});
export type DnD35FeatRepeatable = z.infer<typeof DnD35FeatRepeatableSchema>;

export const DnD35FeatDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isFighterBonusFeat: z.boolean().default(false),
  repeatable: DnD35FeatRepeatableSchema.optional(),
  prerequisites: PrerequisiteNodeSchema.optional(),
  effectBundle: DnD35EffectBundleSchema.optional(),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  ruleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([]),
  activatedAbilities: z.array(DnD35ActivatedAbilityDescriptorSchema).default([])
});

export const DnD35SystemContentSchema = z.object({
  classes: z.record(z.string(), DnD35ClassDefinitionSchema).default({}),
  domains: z.record(z.string(), DnD35DomainDefinitionSchema).default({}),
  skills: z.record(z.string(), DnD35SkillDefinitionSchema).default({}),
  feats: z.record(z.string(), DnD35FeatDefinitionSchema).default({}),
  items: z.record(z.string(), DnD35ItemDefinitionSchema).default({}),
  spells: z.record(z.string(), DnD35SpellDefinitionSchema).default({}),
  templates: z.record(z.string(), DnD35CreatureTemplateSchema).default({}),
  races: z.record(z.string(), DnD35RaceDefinitionSchema).default({}),
  creatureTypes: z.record(z.string(), DnD35CreatureTypeDefinitionSchema).default({}),
  subtypes: z.record(z.string(), DnD35SubtypeDefinitionSchema).default({}),
  dragonFamilies: z.record(z.string(), DnD35DragonFamilyDefinitionSchema).default({})
});
```

### Snippet 3: Feat Modifier Compiler with Repeatable Instance Provenance (`src/rulesets/dnd35e/progression/ledger_modifiers.ts`)
```ts
import type { DnD35FeatDefinition, DnD35StatModifier } from '../types/dnd35e_system.types.ts';
import { evaluateEffectBundle } from '../effect_bundle.ts';

/**
 * Builds stat modifiers from an actor's acquired feats via their declarative effectBundles.
 * For repeatable stacking feats (e.g. Toughness taken multiple times), tracks occurrence index
 * to produce unique, deterministic sourcePath lineages (Rule 19) such as `feat:toughness#1` and `feat:toughness#2`.
 */
export function buildFeatEffectModifiers(
  featIds: ReadonlyArray<string>,
  featDefs: Record<string, DnD35FeatDefinition> | undefined,
  activeTags: ReadonlyArray<string>
): ReadonlyArray<DnD35StatModifier> {
  if (!featDefs || featIds.length === 0) return [];
  const modifiers: DnD35StatModifier[] = [];
  const featOccurrences = new Map<string, number>();

  for (const rawFeatId of featIds) {
    // Parameterized feats (e.g. "weapon_focus:longsword") resolve to base feat definition
    const baseFeatId = rawFeatId.includes(':') ? rawFeatId.split(':')[0]! : rawFeatId;
    const featDef = featDefs[rawFeatId] ?? featDefs[baseFeatId];
    if (!featDef?.effectBundle) continue;

    const occurrence = (featOccurrences.get(rawFeatId) ?? 0) + 1;
    featOccurrences.set(rawFeatId, occurrence);
    const instanceSuffix = occurrence > 1 ? `#${occurrence}` : '';
    const sourcePath = `feat:${rawFeatId}${instanceSuffix}`;

    const bundleResult = evaluateEffectBundle(featDef.effectBundle, sourcePath, activeTags);
    modifiers.push(...bundleResult.statModifiers);
  }

  return modifiers;
}
```

### Snippet 4: Dynamic Equipped Item Evaluation (`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`)
```ts
/**
 * Evaluates declarative effect bundles from equipped items, feeding typed modifiers into the Stat DAG.
 */
function collectEquippedItemModifiers(
  state: GameState,
  entityId: EntityId,
  activeTags: ReadonlyArray<string>
): {
  readonly modifiers: ReadonlyArray<DnD35StatModifier>;
  readonly grantedTags: ReadonlyArray<string>;
} {
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!equipment) return { modifiers: [], grantedTags: [] };

  const modifiers: DnD35StatModifier[] = [];
  const grantedTags: string[] = [];

  for (const slot of equipment.slots) {
    if (slot.equippedItem === null || slot.suppressed === true) continue;
    const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const itemDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
    if (!itemDef?.effectBundle) continue;

    const bundleResult = evaluateEffectBundle(
      itemDef.effectBundle,
      `item:${itemComp.itemId}`,
      activeTags
    );
    modifiers.push(...bundleResult.statModifiers);
    grantedTags.push(...bundleResult.grantedTags);
  }

  return { modifiers, grantedTags };
}
```

### Snippet 5: Example Feat JSON (`public/data/rulesets/dnd35e/feats/weapon_focus.json`)
```json
{
  "id": "weapon_focus",
  "name": "Weapon Focus",
  "description": "+1 bonus on all attack rolls made with the selected weapon.",
  "category": "general",
  "isFighterBonusFeat": true,
  "prerequisites": {
    "kind": "all",
    "children": [
      { "kind": "min_bab", "value": 1 },
      { "kind": "proficiency", "proficiencyType": "weapon", "target": "$weapon" }
    ]
  },
  "effectBundle": {
    "statModifiers": [
      {
        "targetStat": "attack",
        "value": 1,
        "bonusType": "untyped",
        "sourceId": "weapon_focus"
      }
    ]
  }
}
```

### Snippet 6: Example Special Material Armor JSON (`public/data/rulesets/dnd35e/items/mithral_full_plate.json`)
```json
{
  "id": "mithral_full_plate",
  "name": "Mithral Full Plate",
  "description": "Full plate forged of shimmering mithral. Treated as medium armor with Max Dex +3, ACP -3, and ASF 25%.",
  "glyph": "[",
  "fg": "#c0c0d8",
  "bg": "#000000",
  "category": "armor",
  "tags": [
    "armor:medium",
    "armor:heavy_base",
    "material:mithral",
    "acp:3",
    "max_dex:3",
    "asf:25"
  ],
  "weight": 25,
  "baseValue": 10500,
  "equippable": {
    "slot": "body",
    "attackBonus": 0,
    "defenseBonus": 8,
    "maxHpBonus": 0,
    "carryBonus": 0
  },
  "effectBundle": {
    "statModifiers": [
      {
        "targetStat": "ac",
        "value": 8,
        "bonusType": "armor",
        "sourceId": "mithral_full_plate"
      }
    ],
    "grantedTags": ["material:mithral", "armor:medium"]
  }
}
```

### Snippet 7: Example Wondrous Item JSON (`public/data/rulesets/dnd35e/items/belt_of_giant_strength_plus4.json`)
```json
{
  "id": "belt_of_giant_strength_plus4",
  "name": "Belt of Giant Strength +4",
  "description": "This wide leather belt is adorned with an iron buckle. It grants the wearer a +4 enhancement bonus to Strength.",
  "glyph": "&",
  "fg": "#d4af37",
  "bg": "#000000",
  "category": "accessory",
  "tags": ["slot:waist", "magic:wondrous", "bonus:strength"],
  "weight": 1,
  "baseValue": 16000,
  "equippable": {
    "slot": "waist",
    "attackBonus": 0,
    "defenseBonus": 0,
    "maxHpBonus": 0,
    "carryBonus": 0
  },
  "effectBundle": {
    "statModifiers": [
      {
        "targetStat": "strength",
        "value": 4,
        "bonusType": "enhancement",
        "sourceId": "belt_of_giant_strength_plus4"
      }
    ]
  }
}
```

---

## 7. Open Questions & Architectural Alignment

1. **Item Catalog Coexistence (`ruleset items` vs `campaign items`)**:
   - The proposed architecture loads SRD items as ruleset base content (`public/data/rulesets/dnd35e/items/<id>.json`), while allowing specific campaigns (like `dnd35e-crypt`) to define custom items that either override SRD items or add dungeon-specific loot. Does this shallow-merge hierarchy match your expected campaign authoring model?
2. **Tactical Stance Dials vs Passive Modifiers**:
   - Feats like *Power Attack* and *Combat Expertise* have both a passive unlock tag (e.g. `feat:power_attack`) and a variable dial (0..BAB). The existing `CANONICAL_TACTICAL_DIALS` in `tactical_doctrine.ts` handles this cleanly without hardcoding. We will keep this unified pattern.
3. **Double-Counting Avoidance**:
   - `getEquippedItemBonuses` in `srd_registry.ts` previously returned untyped `equipArmorBonus` from `itemDef.equippable.defenseBonus`. To avoid double-counting with `itemDef.effectBundle.statModifiers` (which specifies typed `bonusType: "armor"`, `"shield"`, or `"deflection"`), `dnd35e_dag_adapter.ts` will strictly evaluate `effectBundle` when present, only falling back to legacy `defenseBonus` if an item lacks an `effectBundle`.
4. **Repeatable Feats Architecture (Stacking vs Parameterized)**:
   - **Stacking Feats** (*Toughness*, *Extra Turning*):
     - `repeatable: { mode: 'stacking' }`.
     - Ledger (`level_ledger.ts`) does not collapse them into a deduplication set; multiple acquisitions across levels remain intact in `dndData.feats`.
     - Modifier generation in `buildFeatEffectModifiers` assigns indexed provenance: `sourcePath: "feat:toughness#1/vitality:hp"`, `sourcePath: "feat:toughness#2/vitality:hp"`, so each +3 HP stacks in the DAG without modifier collisions.
     - Character creation and level-up feat selection modals allow choosing stacking feats again as long as feat slots are available.
   - **Parameterized / Targeted Feats** (*Weapon Focus*, *Spell Focus*, *Skill Focus*, *Exotic Weapon Proficiency*):
     - `repeatable: { mode: 'targeted', targetCategory: 'weapon' | 'school' | 'skill' }`.
     - Can be taken multiple times, but each take must specify a distinct sub-target (e.g. `weapon_focus:longsword`, `weapon_focus:shortbow`).
     - Effects apply only to that specific weapon, school, or skill; effects do not stack on the same target.
     - Feat prerequisite checks for general qualification (e.g. `has_feat: weapon_focus`) match any specialized instance or base definition.

---

## 8. Verification Strategy & Step 5 Gate

The implementation will be verified through:
1. `tests/dnd35e_feats_m114.test.ts` (Feat registry coverage, prerequisite tree checks, fighter bonus feat validation, passive stat modifiers in DAG, metamagic computations).
2. `tests/dnd35e_equipment_m115.test.ts` (Weapon profiles, dice scaling, material physics, equipped effect bundles, wondrous items).
3. `tests/ssot_registry_parity.test.ts` (Parity between modular JSON files and `system_content_files.ts`).
4. Full `./verify.sh` pipeline (Typecheck, tests, linter, schema validators across all 8 stages).

**Implementation Plan Gate:**
Per `AGENTS.md` Step 5:
> **STOP HERE and wait for the User's explicit approval of the Implementation Plan before writing or modifying any actual codebase files.**
