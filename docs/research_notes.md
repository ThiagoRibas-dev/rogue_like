# Research Notes — Milestones 114 & 115: Complete SRD Feat Registry & SRD Equipment/Magic Item Compendium

**Date:** 2026-11-04  
**Status:** In Review (Kickoff Flow Step 3: Research Gate)  
**Author:** AI Agent (GeminiPro / DeepSeek Harness)  
**Milestones:** 114 & 115 (Phase 24: D&D 3.5e System Content Pillars 3 & 5)  
**Working Directory:** `/export/DownloadsSSD/Projects/Game Dev/rogue-like`  
**Canonical Rules Reference:** `docs/MILESTONES.md#L1592-L1628` and `docs/dnd35e/`

---

## 1. Executive Summary & Objectives

The joint objective of Milestones 114 and 115 is to establish the complete System Content (Tier 3) catalogs for SRD Feats (M114) and SRD Equipment, Weapons, Armor, Special Materials, and Magic Items (M115) in modular JSON formats, while ensuring deep integration with Tier 2 ruleset mechanics (the 4-Stage Topological Sub-Stat DAG, tactical maneuvers, attack routine synthesis, weapon profile scaling, and metamagic spellcasting) via declarative `DnD35EffectBundle`s with hierarchical `sourcePath` provenance.

### Milestone 114: Complete SRD Feat Registry, Combat Chains & Metamagic Trees
- Author modular `public/data/rulesets/dnd35e/feats/<id>.json` files covering:
  1. **Melee, Tactical Stance & Maneuver Feat Chains**: *Power Attack* (`variable_dial 0..BAB`), *Cleave*, *Great Cleave*, *Improved Bull Rush*, *Improved Overrun*, *Improved Sunder*, *Combat Expertise* (`variable_dial 0..min(5, BAB)`), *Improved Disarm*, *Improved Feint*, *Improved Trip*, *Whirlwind Attack*, *Dodge*, *Mobility*, *Spring Attack*, *Weapon Finesse*, *Weapon Focus*, *Weapon Specialization*, *Greater Weapon Focus*, *Greater Weapon Specialization*, *Improved Critical*, *Two-Weapon Fighting*, *Two-Weapon Defense*, *Improved Two-Weapon Fighting*, *Greater Two-Weapon Fighting*, *Improved Unarmed Strike*, *Improved Grapple*, *Deflect Arrows*, *Snatch Arrows*, *Stunning Fist*.
  2. **Ranged, Defensive, Save, Skill & Monster Feats**: *Point Blank Shot*, *Precise Shot*, *Improved Precise Shot*, *Far Shot*, *Rapid Shot*, *Manyshot*, *Shot on the Run*, *Rapid Reload*, *Quick Draw*, *Combat Reflexes*, *Blind-Fight*, *Improved Initiative*, *Toughness*, *Endurance*, *Diehard*, *Iron Will*, *Lightning Reflexes*, *Great Fortitude*, *Skill Focus*, *Alertness*, *Stealthy*, *Nimble Fingers*, *Acrobatic*, *Agile*, *Athletic*, *Deceitful*, *Deft Hands*, *Diligent*, *Investigator*, *Magical Aptitude*, *Negotiator*, *Persuasive*, *Self-Sufficient*. Monster feats: *Multiattack*, *Multiweapon Fighting*, *Improved/Greater Multiweapon Fighting*, *Ability Focus*, *Awesome Blow*, *Empower/Quicken Spell-Like Ability*, *Flyby Attack*, *Hover*, *Improved Natural Armor*, *Improved Natural Attack*, *Snatch*, *Wingover*.
  3. **Spellcasting & Metamagic Feats**: *Combat Casting*, *Spell Focus*, *Greater Spell Focus*, *Spell Penetration*, *Greater Spell Penetration*, *Augment Summoning*, *Natural Spell*, *Eschew Materials*. Metamagic: *Empower Spell*, *Enlarge Spell*, *Extend Spell*, *Heighten Spell*, *Maximize Spell*, *Quicken Spell*, *Silent Spell*, *Still Spell*, *Widen Spell*.
- Validate recursive `prerequisites` AST nodes (`min_ability`, `min_bab`, `min_skill_ranks`, `has_feat`, `race_in`, etc.) against system content.
- Ensure feat effect bundles emit hierarchical provenance: `sourcePath: "feat:<featId>/..."`.

### Milestone 115: Complete SRD Weapons, Armors, Special Materials & Magic Item Compendium
- Establish modular item definitions in `public/data/rulesets/dnd35e/items/<id>.json` loaded via `system_content_files.ts` and `system_content_loader.ts`.
- Standardize schema: Ensure compatibility between generic console `ItemDefinitionSchema` (or ruleset-extended `DnD35ItemDefinitionSchema`) with `effectBundle?: DnD35EffectBundle` supporting:
  1. **Weapons**: Simple, Martial, and Exotic melee, ranged, double, reach, and finesse weapons with damage dice, damage types, critical threat/multipliers, range increments, and combat maneuver tags (`reach_10ft`, `brace`, `double_weapon`, `trip`, `finesse`, `disarm`).
  2. **Armors & Shields**: Light, Medium, Heavy armors, Buckler, Light/Heavy Shields, and Tower Shield with proper AC bonus, Max Dex bonus, Armor Check Penalty (ACP), and Arcane Spell Failure (ASF).
  3. **Special Materials**: Mithral, Adamantine, Darkwood, Cold Iron, Alchemical Silver variants (e.g. Mithral Full Plate as medium armor, Adamantine Full Plate with DR 3/-, Darkwood Heavy Shield with ACP 0).
  4. **Magical Armaments & Properties**: `+1` to `+5` enhancements, *Flaming*, *Frost*, *Shock*, *Keen*, *Ghost Touch*, *Bane*, *Disruption*, *Wounding*, *Fortification*, *Spell Resistance*.
  5. **Wondrous Items & Anatomical Slot Equipment**: Stat boosters (*Belt of Giant Strength*, *Gloves of Dexterity*, *Headband of Intellect*, *Periapt of Wisdom*, *Amulet of Health*, *Cloak of Charisma*), defensive gear (*Ring of Protection*, *Amulet of Natural Armor*, *Bracers of Armor*, *Cloak of Resistance*), movement/utility (*Boots of Speed*, *Boots of Striding and Springing*, *Cloak of Elvenkind*, *Ring of Evasion*, *Ring of Invisibility*).
  6. **Consumables & Charged Items**: Potions, Scrolls, Wands, Staves, and Metamagic Rods.

---

## 2. Canonical D&D 3.5e Rules & Mechanical Foundations

### 2.1 Feat System & DAG Integration
1. **Usage Modes**:
   - `passive`: Always-on stat modifiers and semantic tags (e.g., *Iron Will* `+2 resistance` to Will saves, *Weapon Focus* `+1` attack).
   - `variable_dial`: Parameterized combat choices (*Power Attack* dials attack penalty for damage bonus; *Combat Expertise* dials attack penalty for dodge AC).
   - `toggle`: Optional mode per attack sequence (*Rapid Shot* `-2` to all attacks for 1 extra attack at highest BAB).
   - `triggered`: Reactive triggers (*Cleave* on enemy drop, *Deflect Arrows* on incoming ranged hit).
   - `activated`: Active abilities (*Stunning Fist* consuming daily charges, *Manyshot* standard action volley).
2. **Provenance & Layer Boundaries**:
   - Every feat modifier must carry `sourcePath: "feat:<id>/<subpath>"`.
   - Modifiers feed into `evaluateDnD35ActorStatDAG` at their proper stage:
     - Stage 1: Size adjustments (*Righteous Might* or monster size increases).
     - Stage 2: Ability score modifications (*Belt of Giant Strength* enhancement bonus, etc.).
     - Stage 3: Base saves, armor, shield, natural armor, deflection, and speed.
     - Stage 4: Attack bonuses, damage bonuses, and AC resolution.

### 2.2 Equipment, Weapon Profiles & Special Materials
1. **Weapon Profiles (`weapon_profile_parser.ts`)**:
   - Reads `handedness` ('light' | 'one_handed' | 'two_handed'), `damageDice`, `critThreatMin`, `critMultiplier`, `damageType`, and special flags from item definition tags.
   - Automatically handles size-step dice scaling via `scaleWeaponDamageDice`.
2. **Special Materials Physics (`special_materials.ts`)**:
   - *Mithral*: Reduces armor category by one step (Heavy $\to$ Medium, Medium $\to$ Light), decreases ACP by 3 (min 0), increases Max Dex bonus by +2, decreases ASF by 10%, halves weight.
   - *Adamantine*: Grants Damage Reduction (`DR 1/-` for light armor, `DR 2/-` for medium armor, `DR 3/-` for heavy armor), bypasses hardness under 20.
   - *Darkwood*: Halves weight, reduces shield ACP by 2 (e.g. Heavy Shield ACP becomes 0).
   - *Alchemical Silver* & *Cold Iron*: Overcomes damage reduction `DR/silver` and `DR/cold_iron`.
3. **Equipped Item Modifier Extraction**:
   - `EquipmentComponent.slots` holds equipped item IDs.
   - When equipped, an item's `effectBundle` is evaluated and its modifiers injected with `sourcePath: "item:<itemId>/..."`.

### 2.3 Metamagic Rules
1. **Slot Adjustments & Casting Times (`metamagic_dispel.ts`)**:
   - *Empower Spell*: $+2$ spell level, variable numeric damage $\times 1.5$.
   - *Maximize Spell*: $+3$ spell level, variable numeric dice maximize.
   - *Empower + Maximize*: Maximized damage $+ 50\%$ of rolled damage.
   - *Extend Spell*: $+1$ spell level, doubles duration.
   - *Enlarge Spell*: $+1$ spell level, doubles range.
   - *Quicken Spell*: $+4$ spell level, casts as a swift action.
   - *Widen Spell*: $+3$ spell level, $+100\%$ area.
   - *Silent Spell* / *Still Spell*: $+1$ spell level, eliminates verbal/somatic component.
   - Spontaneous casting (Sorcerer/Bard): Applying metamagic increases casting time from standard action to a full-round action (`getSpontaneousMetamagicActionType`).

---

## 3. Codebase Architecture & Technical Mapping

### 3.1 Modular File Structure & Registration
- Existing feats: 12 files in `public/data/rulesets/dnd35e/feats/*.json`.
  - Must author the complete remaining SRD feat catalog as individual files in `public/data/rulesets/dnd35e/feats/<id>.json`.
  - Update `src/rulesets/dnd35e/system_content_files.ts` to export the comprehensive `FEAT_IDS` list.
- Modular items:
  - Create `public/data/rulesets/dnd35e/items/` containing all SRD weapons, armors, special material variants, magic weapons, wondrous items, rings, and consumables.
  - Register `ITEM_IDS` and add `{ key: 'items', filename: 'items.json' }` and `...ITEM_IDS.map(id => ({ key: 'items', filename: 'items/${id}.json' }))` to `DND35E_SYSTEM_CONTENT_FILES` in `system_content_files.ts`.
- Content Loader & Integration:
  - `src/core/loader/system_content_loader.ts` already supports shallow-merging modular files under any key.
  - `src/core/loader.ts` and `tests/helpers.ts` assemble `campaign.items = { ...rulesetBase.items, ...campaign.items }`.

### 3.2 Schema Extensions
- `DnD35FeatDefinitionSchema` in `src/rulesets/dnd35e/types/dnd35e_system.types.ts`:
  - Contains `id`, `name`, `description`, `isFighterBonusFeat`, `prerequisites`, `effectBundle`, `modifiers`, `ruleOverrides`, `activatedAbilities`.
  - Fully compatible with recursive `PrerequisiteNodeSchema`.
- `DnD35SystemContentSchema`:
  - Currently contains `feats`, `spells`, `templates`, `races`, `creatureTypes`, `subtypes`, `dragonFamilies`.
  - Add `items: z.record(z.string(), DnD35ItemDefinitionSchema).default({})` (or ensure `ItemDefinitionSchema` with optional `effectBundle?: DnD35EffectBundle` is validated).
- Item Definitions:
  - `src/types/campaign/item.ts` defines base `ItemDefinitionSchema`. We can define `DnD35ItemDefinitionSchema` in `dnd35e_system.types.ts` as `ItemDefinitionSchema.extend({ effectBundle: DnD35EffectBundleSchema.optional() })`.

### 3.3 Dynamic DAG Evaluation & Equipment Pipeline
- In `src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`:
  - Currently extracts `equipAttackBonus` and `equipArmorBonus` via `getEquippedItemBonuses`.
  - To support wondrous items, stat belts, rings of protection, cloaks of resistance, and weapon properties:
    - Iterate through equipped items in `equipment.slots`.
    - Retrieve item definition and evaluate its `effectBundle` via `evaluateEffectBundle(itemDef.effectBundle, 'item:' + itemComp.itemId)`.
    - Accumulate emitted `statModifiers`, `grantedTags`, and `ruleOverrides` into `extraModifiers` passed to `evaluateDnD35ActorStatDAG`.

### 3.4 Validation Pipeline (`dnd35e_validator.ts`)
- Add item validation to `validateDnD35eSystemContentIntegrity`:
  - Verify inner ID parity: `itemDef.id === itemKey`.
  - Verify weapon/armor tag validity and effectBundle source paths.
  - Verify feat prerequisite links: ensure referenced feats in `has_feat` AST nodes exist in `sys.feats`.

---

## 4. Cascading Effects Matrix

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| **Comprehensive Feat Registry (`feats/<id>.json`)** | Character builder feat selection (`dnd35e_char_builder_feats.ui.ts`), level-up feat selection, archetype hydrator (`archetype_resolver.ts`). | `evaluatePrerequisiteAST`, DAG modifier evaluator, tactical doctrine dials (`tactical_doctrine.ts`), maneuver resolvers. | `public/data/rulesets/dnd35e/feats.json` (cleared or kept empty), `system_content_files.ts`, test fixtures. |
| **Modular Item Registry (`items/<id>.json`)** | `system_content_loader.ts`, `loader.ts`, `tests/helpers.ts`, starter equipment packages (`equipment_packages.ts`). | `weapon_profile_parser.ts`, `special_materials.ts`, `evaluateDnD35eEntityDAG`, inventory UI, paperdoll HUD, shop system. | `public/data/rulesets/dnd35e/items.json`, default campaign item catalog, `run-validator.ts`. |
| **Equipped Item `effectBundle` Evaluation in DAG Adapter** | `EquipmentComponent.slots`, item equipping actions (`inventory.system.ts`). | `evaluateDnD35ActorStatDAG` (Stages 1–4 receiving enhancement, deflection, resistance, and stat bonuses). | `getEquippedItemBonuses` in `srd_registry.ts` (harmonized to avoid double-counting). |
| **Validator Enhancements for Feats & Items** | `checkDnD35eRuleset`, `validateDnD35eSystemContentIntegrity`. | CI & `./verify.sh` Stage 8 validator runner. | Sibling campaign validations and SSOT parity tests. |

---

## 5. Architectural Standards Compliance Verification

- **Three-Tier Placement Heuristic (Rule 16)**:
  - Tier 1: Generic item components (`ItemComponent`, `EquipmentComponent`), equipment slots, base item schema in `src/types/campaign/item.ts`.
  - Tier 2: Tabletop math, DAG evaluation, weapon scaling, material physics, tactical doctrines, metamagic calculators in `src/rulesets/dnd35e/`.
  - Tier 3: Declarative data definitions in `public/data/rulesets/dnd35e/feats/*.json` and `public/data/rulesets/dnd35e/items/*.json`.
- **Declarative Overrides & Modifiers (Rule 17)**:
  - Maneuvers and attack sequences receive modifiers/overrides (`provokesAoO`, `twfPrimaryPenalty`, `secondaryNaturalPenalty`) rather than hardcoded feat checks.
- **Hierarchical Provenance (Rule 19)**:
  - All feat modifiers tagged with `sourcePath: "feat:<id>/..."`.
  - All item modifiers tagged with `sourcePath: "item:<itemId>/..."`.
- **Three-Horizon Boundaries (Rule 20)**:
  - Horizon 1 (`levelHistory`): Feat choices recorded immutably.
  - Horizon 2 (`rebuildActorStateFromLevelHistory`): Aggregates total feat set and passive feature pools.
  - Horizon 3 (`evaluateDnD35eEntityDAG`): Dynamically resolves equipped items, weapon profiles, tactical doctrine stances, and live tag projections.
