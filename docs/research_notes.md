# Research Notes — Full D&D 3.5e SRD Alignment Audit (Requirements, Prerequisites, Grants, Evaluators & Builder UI)

## 1. Governing Architectural Rules (`AGENTS.md`, `docs/ARCHITECTURE.md` & `docs/SSOT_DND35E.md`)
- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any`, `exactOptionalPropertyTypes: true` (omit optional properties rather than assigning `undefined`), explicit return types on all functions, exhaustive `switch` checks with `assertNever`, named constants or JSON fields for all gameplay thresholds.
- **Rule 14 (Flat Control Flow):** Guard clauses and early returns rather than deep nested `if/else` blocks.
- **Rule 15 (Three-Axis Cascading Effects):** Enumerate Upstream, Downstream, and Lateral impacts before drafting the implementation plan.
- **Rule 16 & 17 (Three-Tier Placement & Declarative Overrides):**
  - Keep prerequisite logic declarative in Tier 3 JSON (`PrerequisiteNode` ASTs, `featureDetails`, `effectBundle`, `proficiencies`) evaluated by pure Tier 2 Cartridge functions (`prerequisites.ts`, `semantic_tags.ts`, `builder_prereq_context.ts`). Never hardcode `if (featId === ...)` or `if (classId === ...)` branches in combat or progression resolvers.
- **Rule 19 (Unified Effect Providers & `sourcePath`):** Semantic tags (Layer A) project situational and capability states (e.g. `feature:wild_shape`, `feature:turn_or_rebuke`, `proficiency:*`); Effect Bundles (Layer B) supply modifiers/virtual feats; Scaling Pools (Layer C) track class/ability scaling; Domain Resolvers (Layer D) consume Layers A–C.
- **Rule §5 (Zod Schema Parity & Boundary Validation):** Any new `PrerequisiteNode` or `DnD35AcfSwap` variants MUST mirror `PrerequisiteNodeSchema` (`z.discriminatedUnion('type', ...)`) and `validatePrerequisiteNodeReferences` (`src/rulesets/dnd35e/validation/class_race_validator.ts`). Schema parsing executes at load/edit boundaries, never in hot loops.
- **Canonical SSOT Ownership (`docs/SSOT_DND35E.md`):**
  - `src/rulesets/dnd35e/prerequisites.ts`: `PrerequisiteNode`, `PrerequisiteEvalContext`, `evaluatePrerequisiteAST`.
  - `src/rulesets/dnd35e/semantic_tags.ts`: `projectDnD35ActorSemanticTags`.
  - `src/rulesets/dnd35e/builder/builder_prereq_context.ts`: `buildPrerequisiteContextForActor`, `buildPostLevelUpPrerequisiteContext`.
  - `src/rulesets/dnd35e/builder/builder_validation.ts` & `builder_levelup_validation.ts`: Character creation and level-up validation.
  - `src/rulesets/dnd35e/builder/builder_feats.ts`: Typed feat slot budgets and slot filters (`isFeatAllowedInSlot`).
  - `src/rulesets/dnd35e/builder/builder_spells.ts`: `isSpellSelectableForDraft`, spell selection budgets.
  - `src/rulesets/dnd35e/equipment/item_inheritance.ts`: Weapon/armor proficiency resolution (`evaluateNonproficiencyPenalty`).
  - `src/rulesets/dnd35e/validation/class_race_validator.ts`: Integrity & reference checks across classes, feats, races, templates, and prerequisite ASTs.

---

## 2. Comprehensive SRD Audit Findings

### 2.1 Engine, Schema, Context & Evaluator Bugs

#### A. Missing `PrerequisiteNode` Variants & Broken Predicates (`src/rulesets/dnd35e/prerequisites.ts`, `effect_system.types.ts`, `class_race_validator.ts`)
Currently `PrerequisiteNode` supports 13 node types (`and`, `or`, `not`, `min_ability`, `min_bab`, `min_skill_ranks`, `has_feat`, `has_tag`, `min_caster_level`, `size_in`, `alignment_in`, `min_spell_level`, `race_in`). Strict D&D 3.5e SRD prerequisites cannot be expressed accurately without fixing/extending these:
1. **`min_class_level` (Missing):** Needed for Fighter-exclusive feats (*Weapon Specialization* = Fighter 4, *Greater Weapon Focus* = Fighter 8, *Greater Weapon Specialization* = Fighter 12). Currently these feats approximate class level using `min_bab: 4/8/12`, letting Rangers/Barbarians/Paladins take Fighter-only feats.
2. **`min_character_level` (Missing):** Needed for *Leadership* (Character Level 6th = Total Hit Dice, including RHD + class levels).
3. **`has_feat` Target-Binding Bug (`prerequisites.ts:78-90`):**
   - Currently, if `context.targetId` is set (e.g. evaluating *Weapon Specialization (Longsword)* where `targetId: 'longsword'`), `has_feat: "spell_focus"` checks `spell_focus:longsword`. More critically, when `context.targetId` is `undefined` (untargeted feats or Prestige Classes):
     - *Augment Summoning* has `{ type: "has_feat", featId: "spell_focus" }`, so any school (e.g. *Spell Focus (Evocation)*) illegally qualifies instead of strictly **Spell Focus (Conjuration)**.
     - *Arcane Archer* has `{ type: "has_feat", featId: "weapon_focus" }`, so *Weapon Focus (Dagger)* illegally qualifies instead of strictly **Weapon Focus (Longbow)** or **Weapon Focus (Shortbow)** (and composite bows treated as their base bow category).
   - **Fix:** Support explicit target matching on `has_feat` (e.g., `featId: "spell_focus:conjuration"` or optional `targetId` / `targetPrefix` / `targetCategoryPrefix`), and avoid appending outer `context.targetId` when the `has_feat` node specifies a fixed target or prefix!
4. **`min_spell_level` Spontaneous vs. Prepared (`prerequisites.ts:99-109`):**
   - *Dragon Disciple* requires *"Ability to cast arcane spells without preparation"* (spontaneous arcane casting, e.g., Sorcerer/Bard, NOT Wizard).
   - **Fix:** Add optional `castingMode?: 'prepared' | 'spontaneous' | 'any'` on `min_spell_level`, and compute `maxSpontaneousArcaneSpellLevel` / `maxPreparedArcaneSpellLevel` (or per-tradition+mode maxes) in `PrerequisiteEvalContext`.
5. **`has_proficiency` (Missing):**
   - Many feats and PRCs require weapon/armor/shield proficiencies:
     - *Weapon Focus*, *Improved Critical*, *Weapon Specialization*, *Greater Weapon Focus*, *Greater Weapon Specialization*: Proficiency with the **selected weapon** (`targetId`).
     - *Rapid Reload*: Proficiency with the **selected crossbow** (`hand_crossbow`, `light_crossbow`, or `heavy_crossbow`).
     - *Armor Proficiency (Medium)* / *Armor Proficiency (Heavy)*: Proficiency with Light (and Medium) armor — currently checks `has_feat: "armor_proficiency_light"` / `"armor_proficiency_medium"`, which fails for Fighters, Clerics, Paladins, Rogues, Bards, Barbarians, Rangers, and Druids because classes store `proficiencies.armor` rather than literal feats!
     - *Improved Shield Bash* / *Tower Shield Proficiency*: Proficiency with Shields (`proficiencies.shields`), failing for Fighters/Clerics/Paladins/Barbarians/Rangers for the same reason!
     - *Eldritch Knight*: Proficiency with **all martial weapons** (not just one *Martial Weapon Proficiency (Longsword)* feat!).
   - **Fix:** Resolve canonical proficiencies in one shared place (reusing/aligning with `item_inheritance.ts` `evaluateNonproficiencyPenalty` rules: class `proficiencies`, War domain deity weapon, `*_proficiency` feats, and weapon ID matching including base composite bows) + add `{ type: 'has_proficiency', scope: 'selected_weapon' | 'weapon' | 'martial_all' | 'simple_all' | 'armor_light' | 'armor_medium' | 'armor_heavy' | 'shield' | 'tower_shield', id?: string }` (and/or project `proficiency:*` tags).
6. **Composite / Pattern Prerequisites for *Loremaster* & Monster Feats:**
   - *Loremaster*: Requires any **two Knowledge skills at 10+ ranks**, **Skill Focus (any Knowledge skill)**, **3 Metamagic or Item Creation feats**, and **7 different divination spells, one of which must be 3rd level or higher** (or 3rd-level spells).
     - Expressible cleanly via declarative AST nodes:
       - `min_skill_count_at_ranks`: `{ type: 'min_skill_count_at_ranks', skillPrefix: string, minRanks: number, minCount: number }` (validated against skills matching prefix).
       - `min_feat_count`: `{ type: 'min_feat_count', pool: 'metamagic_or_item_creation', minCount: number }`.
       - `has_feat` with `targetPrefix: 'knowledge_'` for `skill_focus`.
       - Optional `min_spells_by_school` (or `min_spell_level` + divination spell count if we enforce the full 7 divination spells check).
   - Monster & Flight Feats:
     - *Multiattack*: `3 or more natural attacks` (count `naturalWeapons` entries summing `count`, e.g., Ghoul/Ghast bite + 2 claws = 3 natural attacks).
     - *Multiweapon Fighting* (plus Improved/Greater): `3 or more hands` (resolve from `anatomyBodyPlan` or hand-type `EquipmentSlotInstance`s, e.g., `marilith_6arm`).
     - *Improved Natural Armor*: `Natural armor >= 1`.
     - *Improved Natural Attack*: `1 or more natural weapons` + `BAB +4`.
     - *Flyby Attack*, *Hover*, *Wingover*: `Fly speed > 0` (`movementModes.fly`).
     - *Ability Focus*: `Special attack` (`specialAttacks` or `spellLikeAbilities` / breath weapon).
     - *Empower/Quicken Spell-Like Ability*: `Spell-like ability` at minimum caster level (CL 6th+ / CL 10th+, scaled by ability spell-level caps per MM1 p.303–304).

#### B. Caster Level & Spell Level Context Bugs (`src/rulesets/dnd35e/builder/builder_prereq_context.ts`)
1. **Cross-Class Caster Level Stacking Bug (`builder_prereq_context.ts:39-44, 157-162`):**
   - `buildPrerequisiteContextForActor` and `buildPostLevelUpPrerequisiteContext` sum `track.levels` across **all** spellcasting classes (`totalCasterLevel += track.levels`). A Wizard 3 / Cleric 2 falsely reports `casterLevel: 5` (qualifying for *Craft Magic Arms and Armor* despite having Arcane CL 3 and Divine CL 2).
   - Worse, it counts **all levels of Paladin and Ranger as full caster levels**: a Level 1 Paladin or Level 1 Ranger gets `casterLevel: 1`! Per SRD, Paladins and Rangers have **no caster level at levels 1–3**, and their caster level from 4th level onward is **half their class level** (`floor(level / 2)`). Notice `scribe_scroll` requires `CL 1` and `craft_wand` requires `CL 5`, so Paladin 1 could illegally qualify for *Scribe Scroll*!
   - Conversely, when taking Prestige Classes that advance spellcasting (`eldritch_knight`, `loremaster`, `mystic_theurge`, `arcane_archer` does not), `builder_prereq_context.ts:45` looks up `track.levels` of Wizard instead of `computeEffectiveClassCastingLevel(...)`, undercounting `maxArcaneSpellLevel` and `casterLevel` after PRC levels!
2. **Fix:** Compute per-base-casting-class effective level via `computeEffectiveClassCastingLevel`, apply half-caster CL rule for Paladin/Ranger (`effectiveLevel >= 4 ? floor(effectiveLevel / 2) : 0`, or declarative `casterLevelRule` / `half_from_4`), set `casterLevel` to the **max single-class effective caster level** (and allow optional class-specific CL tracking), and track arcane/divine max spell level separately by `prepared` vs `spontaneous` casting mode.

#### C. Level-Up & Character Creation Split-Brain (`builder_validation.ts`, `character_builder.ts`, `builder_levelup_validation.ts`, `builder_hydrator_levelup.ts`, `dnd35e_level_up_class.ui.ts`)
1. **Multiclass Alignment Enforcement Missing:**
   - `validateCharacterCreationStep` (`builder_validation.ts:46-53`) checks `classDef.allowedAlignments`, AND `applyCharacterCreationToPlayer` enforces starting alignment.
   - However, `validateLevelUpStep` (`builder_levelup_validation.ts:55-64`), `dnd35e_level_up_class.ui.ts:68`, and `applyLevelUpToActor` (`builder_hydrator_levelup.ts`) **never check `classDef.allowedAlignments`**! A Chaotic Evil Rogue can multiclass into Paladin (`LG`) or Monk (`LG/LN/LE`), and a Lawful Good Fighter can multiclass into Barbarian (`non-lawful`) or Bard (`non-lawful`).
2. **Incomplete Level 1 `PrerequisiteEvalContext` (`builder_validation.ts:133-150`, `character_builder.ts:99-116`):**
   - Both functions hand-construct a skeletal `PrerequisiteEvalContext` with `feats: []`, `tags: ['type:...', 'size:...']`, and `casterLevel: classDef.castingMode !== 'none' ? 1 : 0`.
   - This ignores:
     - Level 1 class-granted feats (*Monk* IUS, *Ranger* Track, *Wizard* Scribe Scroll, *War Domain* Martial Prof + Weapon Focus),
     - Level 1 class/race proficiencies (blocking *Improved Shield Bash* / *Tower Shield Proficiency* / *Armor Prof Medium*),
     - Paladin/Ranger Lv 1 having `casterLevel: 0`,
     - Racial Hit Dice / RHD tracks (`bugbear`, `goblin`, etc. with Monster HD BAB or bonus feats),
     - Semantic tags projected by `projectDnD35ActorSemanticTags` (alignment tags, literacy, racial features).
   - Meanwhile, `dnd35e_char_builder_feats.ui.ts:289-291` creates a preview actor via `applyCharacterCreationToPlayer` + `buildPrerequisiteContextForActor`. Unifying Creation Validation, Sanitization, and UI onto **one canonical Lv 1 `PrerequisiteEvalContext` helper** removes this split-brain completely.
3. **Alternate Class Feature (ACF) Prerequisites (`effect_system.types.ts:242-252`):**
   - `DnD35AcfSwapSchema` has no `prerequisites` / `requiredArcaneSchool` field. As a result, `wizard_abrupt_jaunt_1` (Immediate Magic: Abrupt Jaunt — PHB2 **Conjurer specialist** only, replaces Summon Familiar) can be selected by a Universalist or Evoker Wizard without restriction in both UI and validators.

#### D. Spell Alignment Restrictions (`builder_spells.ts`, `ledger_features_spells.ts`, `spellbook_slots.ts`)
- Public data contains 30 spells with alignment descriptors (`["good"]`, `["evil"]`, `["lawful"]`, `["chaotic"]` — e.g., *Animate Dead*, *Contagion*, *Create Undead*, *Desecrate*, *Death Knell*, *Destruction*, *Dispel Good*, *Holy Smite*, *Unholy Blight* / *Blasphemy*, *Protection from Evil/Good/Law/Chaos*, etc.).
- Per D&D 3.5e SRD (Cleric/Druid): a Cleric or Druid **cannot cast spells of an alignment opposed to their own alignment** (e.g., a Good Cleric cannot cast `[Evil]` spells; a Chaotic Druid cannot cast `[Lawful]` spells).
- Currently `buildActorSpellbooksByClass`, `isSpellSelectableForDraft`, and `spellbook_slots.ts` never check spell alignment descriptors against actor alignment!

---

### 2.2 Tier 3 System Content SRD Discrepancies

#### A. Feats (`public/data/rulesets/dnd35e/feats/*.json` — All 121 Feats Audited)
Every feat currently without or with mismatched prerequisites compared to D&D 3.5e SRD:

| Feat ID | Current Prerequisite | Strict SRD Prerequisite | Required Engine / Data Change |
| :--- | :--- | :--- | :--- |
| `power_attack` | `STR 13` **AND `BAB +1`** | **`STR 13` ONLY** (PHB p.98 / SRD; no BAB +1!) | Remove `min_bab: 1` from `power_attack.json` (explicitly requested by user). |
| `extra_turning` | `NONE` | **Turn or rebuke creatures ability** | `has_tag: "feature:turn_or_rebuke"` (projected by Cleric, Paladin Lv 4+, Blackguard Lv 3+, elemental/plant domains). |
| `improved_turning` | `NONE` | **Ability to turn or rebuke creatures** | `has_tag: "feature:turn_or_rebuke"`. |
| `leadership` | `NONE` | **Character level 6th** | `min_character_level: 6`. |
| `augment_summoning` | `has_feat: "spell_focus"` (any!) | **Spell Focus (Conjuration)** | Require exact `spell_focus:conjuration` (`has_feat` exact target support). |
| `weapon_focus` | `BAB +1` | **Proficiency with selected weapon, BAB +1** | Add `has_proficiency` for `selected_weapon`. |
| `improved_critical` | `BAB +8` | **Proficiency with selected weapon, BAB +8** | Add `has_proficiency` for `selected_weapon`. |
| `weapon_specialization` | `Weapon Focus (matching), BAB +4` | **Proficiency with selected weapon, Weapon Focus with selected weapon, Fighter level 4th** | Add `has_proficiency` (`selected_weapon`) + `min_class_level: { classId: 'fighter', minLevel: 4 }`. |
| `greater_weapon_focus` | `Weapon Focus (matching), BAB +8` | **Proficiency with selected weapon, Weapon Focus with selected weapon, Fighter level 8th** | Add `has_proficiency` (`selected_weapon`) + `min_class_level: { classId: 'fighter', minLevel: 8 }`. |
| `greater_weapon_specialization` | `WF + WS + GWF + BAB +12` | **Proficiency with selected weapon, WF, WS, GWF, Fighter level 12th** | Add `has_proficiency` (`selected_weapon`) + `min_class_level: { classId: 'fighter', minLevel: 12 }`. |
| `rapid_reload` | `NONE` | **Weapon Proficiency (crossbow type chosen)** | Add `has_proficiency` (`selected_weapon`), and restrict targeted choices / eligibility to crossbows (`hand_crossbow`, `light_crossbow`, `heavy_crossbow`). |
| `armor_proficiency_medium` | `has_feat: "armor_proficiency_light"` | **Armor Proficiency (light)** | Keep feat / update check via `has_proficiency: { scope: 'armor_light' }` so classes with Light armor prof qualify automatically. |
| `armor_proficiency_heavy` | `armor_proficiency_light` + `medium` | **Armor Proficiency (light), Armor Proficiency (medium)** | Evaluate via `has_proficiency` (`armor_light` + `armor_medium`). |
| `improved_shield_bash` | `has_feat: "shield_proficiency"` | **Shield Proficiency** | Evaluate via `has_proficiency: { scope: 'shield' }`. |
| `tower_shield_proficiency` | `has_feat: "shield_proficiency"` | **Shield Proficiency** | Evaluate via `has_proficiency: { scope: 'shield' }`. |
| `multiattack` | `NONE` | **Three or more natural attacks** | Check natural attack count $\ge 3$. |
| `multiweapon_fighting` | `DEX 13` | **DEX 13, three or more hands** | Check hand slot / body plan count $\ge 3$. |
| `improved_natural_armor` | `CON 13` | **Natural armor, CON 13** | Check natural armor bonus $\ge 1$ + CON 13. |
| `improved_natural_attack` | `BAB +4` | **Natural weapon, BAB +4** | Check at least 1 natural weapon + BAB +4. |
| `flyby_attack` | `NONE` | **Fly speed** | Check `movementModes.fly > 0` (via tag `movement:fly` or context). |
| `hover` | `NONE` | **Fly speed** | Check `movementModes.fly > 0`. |
| `wingover` | `NONE` | **Fly speed** | Check `movementModes.fly > 0`. |
| `ability_focus` | `NONE` | **Special attack** | Check `has_tag: "trait:special_attack"` (or race `specialAttacks` / breath weapon / SLA). |
| `empower_spell_like_ability` | `NONE` | **Spell-like ability at CL 6th or higher** | Check SLA presence + SLA CL $\ge 6$. |
| `quicken_spell_like_ability` | `NONE` | **Spell-like ability at CL 10th or higher** | Check SLA presence + SLA CL $\ge 10$. |

*(Note: All remaining SRD general, metamagic, item creation, mounted, archery, TWF, and combat feats — `scribe_scroll` CL 1, `brew_potion` CL 3, `craft_wondrous_item` CL 3, `craft_magic_arms_and_armor` CL 5, `craft_wand` CL 5, `craft_rod` CL 9, `craft_staff` CL 12, `forge_ring` CL 12, `snatch` Huge+, `awesome_blow` STR 25 / PA / IBR / Large+, `stunning_fist`, `deflect_arrows`, `snatch_arrows`, `natural_spell`, `exotic_weapon_proficiency`, etc. — match SRD once evaluators & tags are fixed.)*

#### B. Classes, Prestige Classes & Domains (`public/data/rulesets/dnd35e/classes/*.json` & `domains/*.json`)
1. **Prestige Classes (5 of 10 PRCs have discrepancies; 5 match SRD):**
   - `arcane_archer.json`: Has `has_feat: "weapon_focus"` (any weapon). SRD requires **Weapon Focus (longbow or shortbow)**.
   - `blackguard.json`: Missing **`Knowledge (religion) 2 ranks`** (`min_skill_ranks: { skillId: "knowledge_religion", minRanks: 2 }`). Currently only checks Evil, BAB +6, Hide 5, Power Attack, Cleave, Improved Sunder.
   - `dragon_disciple.json`: Missing **Race: Any nondragon** (`not: has_tag: "type:dragon"`) and **Spontaneous arcane casting** (`castingMode: 'spontaneous'` on `min_spell_level`). Also note SRD lists *Languages: Draconic* (actors do not yet store spoken languages; flagged in Open Questions).
   - `eldritch_knight.json`: Only checks `min_spell_level arcane 3`. Missing **Weapon Proficiency: Must be proficient with all martial weapons** (`has_proficiency: { scope: 'martial_all' }`). In addition, Lv 1 feature `ek_bonus_fighter_feat` is ignored by `computeLevelUpFeatSlots` (`builder_feats.ts:196` only checks `fId.startsWith('fighter_bonus_feat')`).
   - `loremaster.json`: Currently checks `knowledge_arcana: 10`, generic `skill_focus`, and `min_spell_level any 3`. SRD requires:
     - **Any two Knowledge skills at 10 ranks** (`knowledge_*` count $\ge 2$ at 10+),
     - **Skill Focus (any Knowledge skill)** (`has_feat: "skill_focus"` with `targetPrefix: "knowledge_"`),
     - **Any three metamagic or item creation feats**,
     - **Able to cast seven different divination spells, one of which must be 3rd level or higher** (flagged in Open Questions whether to check divination spellbook count or retain `min_spell_level: 3` + 3 MM/IC + 2x Know 10 + SF(Knowledge)).
   - *(Already accurate: `assassin`, `duelist`, `dwarven_defender`, `mystic_theurge`, `shadowdancer`.)*
2. **Base Class Grants & Feature Details:**
   - `wizard.json`: `featureDetails.scribe_scroll` lacks `grantedFeats: ["scribe_scroll"]`, so Level 1 Wizards do not actually receive *Scribe Scroll*! Also `wizard_abrupt_jaunt_1` ACF lacks Conjurer school restriction, and `proficiencies.weapons` uses `"crossbow_heavy"`, `"crossbow_light"` instead of canonical `"heavy_crossbow"`, `"light_crossbow"`.
   - `druid.json`: Level 5 feature `wild_shape_1` has `id: "wild_shape_1"` without `grantedTags: ["feature:wild_shape"]`. `semantic_tags.ts:169-173` only emits `feature:wild_shape_1`, so `natural_spell.json` (`has_tag: "feature:wild_shape"`) **fails even at Druid Level 5+**. Moreover, `level_ledger.ts:111` passes `featurePoolSummary.grantedTags` into `projectDnD35ActorSemanticTags(..., existingTags)` during rebuilds, which persists if added to `grantedTags` or `classRegistry` featureDetails projection in `semantic_tags.ts` — projecting `detail.grantedTags` directly inside `projectDnD35ActorSemanticTags` ensures Horizon 3 UI/DAG preview sees `feature:wild_shape` cleanly as well.
   - `ranger.json`:
     - Level 3 `endurance` lacks `featureDetails.endurance` (`grantedFeats: ["endurance"]`), so Level 3 Rangers never receive *Endurance*.
     - Level 2 `combat_style` has hardcoded `virtualFeatGrants: [{ featId: "two_weapon_fighting", ignorePrerequisites: true }]` in `ranger.json:71-76`, duplicating `ledger_choices.ts:45-53` and granting Two-Weapon Fighting even to Archery Rangers!
   - `blackguard.json` & Turn/Rebuke Tagging:
     - `blackguard.json` Lv 3 `command_undead` has no `featureDetails` entry (no `turn_undead` `resourcePool`, no `turn_undead_effective_level` `scalingPoolContribution`, no `feature:turn_or_rebuke` tag).
     - `cleric.json` (`turn_or_rebuke_undead`), `paladin.json` (`turn_undead_paladin` at Lv 4), `blackguard.json` (`command_undead` at Lv 3), and Elemental/Plant `domains/{air,earth,fire,water,plant}.json` (Turn/Rebuke Air/Earth/Fire/Water/Plant creatures at Lv 1) should all emit `"feature:turn_or_rebuke"` so *Extra Turning* and *Improved Turning* evaluate accurately for all of them.
3. **Weapon Proficiency Item ID Typos Across Classes & Races:**
   - Canonical base weapon IDs (`public/data/rulesets/dnd35e/items/weapons/*.json`) are `hand_crossbow`, `light_crossbow`, `heavy_crossbow`, `light_mace`, `short_sword`.
   - Mismatches found in:
     - `assassin.json`: `"crossbow_hand"`, `"crossbow_light"`, `"crossbow_heavy"`.
     - `monk.json`: `"crossbow_light"`, `"crossbow_heavy"`.
     - `shadowdancer.json`: `"crossbow_hand"`, `"crossbow_light"`, `"Crossbow_heavy"`, `"mace_light"`.
     - `wizard.json`: `"crossbow_heavy"`, `"crossbow_light"`.
     - `drow.json`: `"hand_crossbow"` (matches!), `rogue.json`: `"hand_crossbow"` (matches!). Note `cleric.json`, `fighter.json`, `warrior.json`, `dwarven_defender.json` shields (`["shields"]` vs `["light", "heavy", "tower"]`) should match normalized shield scope checks.

#### C. Races & Templates (`public/data/rulesets/dnd35e/races/*.json`, `templates/*.json`, `templates.ts`)
1. **Monster Races Missing `movementModes.fly` Needed for Flight Feats:**
   - `dragon_black`..`dragon_white` already define `movementModes.fly` (`100`–`200`).
   - `beholder` (`feats: [..., "flyby_attack", ...]`), `chimera` (`feats: [..., "hover", ...]`), and `manticore` (`feats: [..., "flyby_attack", ...]`) lack `movementModes.fly` (Beholder 20 ft good, Chimera 50 ft poor, Manticore 50 ft clumsy).
2. **Natural Attack Counts for Monster Feats (All 75 Races Audited):**
   - Automated audit of all 75 race JSONs against their assigned feats found **only 4 monster statblock gaps**:
     - `beholder.json`: has `flyby_attack` but `movementModes.fly` is omitted (SRD: `fly: 20`).
     - `chimera.json`: has `hover` but `movementModes.fly` is omitted (SRD: `fly: 50`).
     - `manticore.json`: has `flyby_attack` but `movementModes.fly` is omitted (SRD: `fly: 50`).
     - `marilith.json`: has `multiattack` and `multiweapon_fighting` (`anatomyBodyPlan: "marilith_6arm"`), but `naturalWeapons` only lists `tail_slam` (`count: 1`), omitting her MM1 **6 primary `slam` natural attacks (`1d8`, `count: 6`)** used when her 6 arms are not occupied by longswords! Adding the `slam` (`count: 6`) entry makes `marilith` 100% MM1-accurate (and automatically suppressed per-limb when wielding manufactured weapons) while satisfying `multiattack` ($\ge 3$ natural attacks).
   - `ghoul.json` & `ghast.json` have `bite` (`count: 1`) + `claw` (`count: 2`) = `3` total natural attacks when summing `nw.count ?? 1` (confirming `min_natural_attacks` must sum `nw.count ?? 1`, not `naturalWeapons.length`).
3. **Templates (`public/data/rulesets/dnd35e/templates/*.json` & `templates.ts`):**
   - `celestial.json`, `fiendish.json`: Currently `["animal", "vermin", "magical_beast", "humanoid", "monstrous_humanoid"]`. SRD: any corporeal aberration, animal, dragon, fey, giant, humanoid, magical beast, monstrous humanoid, ooze, plant, or vermin.
   - `ghost.json`: Currently `["humanoid", "monstrous_humanoid", "giant"]`. SRD: any aberration, animal, dragon, giant, humanoid, magical beast, monstrous humanoid, or plant with **CHA $\ge 6$** (living, corporeal).
   - `half_celestial.json`, `half_fiend.json`, `half_dragon_*.json`: Currently `targetCreatureTypes: undefined` (allows undead/constructs!). SRD: any **living, corporeal** creature (`aberration`, `animal`, `dragon`, `fey`, `giant`, `humanoid`, `magical_beast`, `monstrous_humanoid`, `ooze`, `plant`, `vermin`; Half-Celestial also requires **INT $\ge 4$**).
   - `lich.json`: Currently `targetCreatureTypes: ["humanoid"]` with **no** CL 11+ or *Craft Wondrous Item* requirement (SRD: humanoid, able to cast spells, CL 11th+, *Craft Wondrous Item*, Evil alignment).
   - `skeleton.json`, `zombie.json`: Include `aberration`, `fey` alongside existing living corporeal types (excluding `undead`, `construct`, `elemental`, `ooze`).

---

### 2.3 Character Builder, Level-Up & Inspector UI Bugs

1. **`src/rendering/ui/dnd35e_char_builder_feats.ui.ts`:**
   - Line 300: Creation passes `alreadyOwnedFeatIds: []` instead of auto-granted class/race/domain feats (`dndData.feats`), allowing duplicate selection of `scribe_scroll` (Wizard), `track` (Ranger), `improved_unarmed_strike` (Monk), or War Domain `weapon_focus:<weapon>`.
   - Lines 161–162, 192, 206–207, 240–249: Treats every feat as single-instance by `feat.id`. Blocks:
     - **Stacking feats** (`repeatable.mode === 'stacking'`: *Toughness*, *Extra Turning*) from being selected more than once!
     - **Targeted feats** (`repeatable.mode === 'targeted'`: *Weapon Focus*, *Skill Focus*, *Spell Focus*, *Weapon Specialization*, *Improved Critical*, *Rapid Reload*, etc.) from taking a **second target** (e.g., *Weapon Focus (Longsword)* + *Weapon Focus (Shortbow)*) in the same session or later level-up!
   - Lines 166–184 & 258–261: `targetSelect` has no `change` event listener to recompute eligibility and update the row badge / right-pane inspector, resets on `onRefresh()` unless persisted per feat, and `renderFeatInspector` is called on line 260 without `targetId` of the active targeted feat! Also `getTargetedWeaponOptions` could better support feat-specific filtering if desired (e.g. *Rapid Reload* crossbows vs all weapons).
2. **`src/rendering/ui/dnd35e_feat_spell_inspector.ui.ts:37-60`:**
   - `renderPrerequisiteNodeChecklist` only formats 5 node types (`min_ability`, `min_bab`, `has_feat`, `min_skill_ranks`, `min_caster_level`).
   - All other nodes (`has_tag`, `size_in`, `alignment_in`, `min_spell_level`, `race_in`, `not`, plus new nodes like `min_class_level`, `min_character_level`, `has_proficiency`, etc.) display raw code identifiers like `🔴 Requires size_in` or flatten `or`/`not` children misleadingly!
3. **`src/rendering/ui/dnd35e_level_up_class.ui.ts:68` & `dnd35e_level_up.ui.ts`:**
   - Only evaluates `cls.prerequisites`, skipping `cls.allowedAlignments`! Shows alignment-illegal classes (Barbarian/Bard/Monk/Paladin/Druid) as `Eligible` in the left pane.
   - ACF selection UI does not filter/annotate ACF prerequisites (e.g. `wizard_abrupt_jaunt_1` requiring Conjuration specialization).
4. **`src/rendering/ui/dnd35e_char_builder_spells.ui.ts`:**
   - Does not filter alignment-opposed spells for Clerics/Druids.

---

## 3. Cascading Effects Matrix (`Rule 15`)

| Change | Upstream (Callers / Producers) | Downstream (Consumers / Validators) | Lateral (Sibling Files / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Extend `PrerequisiteNode` AST, `PrerequisiteNodeSchema`, & `validatePrerequisiteNodeReferences`** (`prerequisites.ts`, `effect_system.types.ts`, `class_race_validator.ts`) | `feats/*.json`, `classes/*.json`, `DnD35FeatDefinitionSchema`, `DnD35ClassDefinitionSchema` | `evaluatePrerequisiteAST`, `validateCharacterCreationStep`, `validateLevelUpStep`, `renderPrerequisiteNodeChecklist` | `tests/ruleset_validators.test.ts`, `tests/dnd35e_equipment_m115.test.ts` (needs Fighter 4 + dagger prof in mock `ctx`), `tests/dnd35e_classes_builder.test.ts` |
| **2. Fix `has_feat` target binding & `min_spell_level` castingMode** (`prerequisites.ts`) | `augment_summoning.json` (`spell_focus:conjuration`), `arcane_archer.json` (`weapon_focus:longbow` / `shortbow`), `dragon_disciple.json` | `evaluatePrerequisiteAST`, `renderFeatInspector` | `tests/dnd35e_classes_builder.test.ts:174` (currently passes untargeted `'weapon_focus'` for Arcane Archer!), `tests/console_ui_architecture.test.ts:139` (`'spell_focus_conjuration'`) |
| **3. Fix per-class Caster Level & Paladin/Ranger half-CL + Prestige casting in `PrerequisiteEvalContext`** (`builder_prereq_context.ts`) | `buildPrerequisiteContextForActor`, `buildPostLevelUpPrerequisiteContext`, unified Lv 1 context helper (`builder_validation.ts`, `character_builder.ts`) | `min_caster_level`, `min_spell_level`, item creation & metamagic eligibility, PRC eligibility | `tests/dnd35e_classes_builder.test.ts`, `tests/dnd35e_multiclass_and_builder.test.ts`, `tests/dnd35e_phase26_ui_and_showcase.test.ts` |
| **4. Canonical Proficiency Evaluation & `has_proficiency` AST** (`item_inheritance.ts`, `prerequisites.ts`, `builder_prereq_context.ts`) | `classes/*.json` (`proficiencies`), `domains/war.json`, `races/*.json`, proficiency feats | `weapon_focus`, `improved_critical`, `weapon_specialization`, `greater_weapon_*`, `rapid_reload`, `armor_proficiency_*`, `improved_shield_bash`, `tower_shield_proficiency`, `eldritch_knight` | Weapon ID typo fixes (`hand_crossbow`, `light_crossbow`, `heavy_crossbow`, `light_mace`) across `assassin`, `monk`, `shadowdancer`, `wizard`; `tests/dnd35e_multiclass_and_builder.test.ts:303` |
| **5. Enforce `allowedAlignments` on Level-Up / Multiclass & ACF prerequisites** (`builder_levelup_validation.ts`, `builder_hydrator_levelup.ts`, `dnd35e_level_up_class.ui.ts`, `effect_system.types.ts`) | `classes/*.json` (`allowedAlignments`, `acfSwaps`) | `validateLevelUpStep`, `applyLevelUpToActor`, Level-Up & Creation Class UI | `tests/dnd35e_classes_builder.test.ts`, `tests/dnd35e_multiclass_and_builder.test.ts` |
| **6. Unify Lv 1 Creation `PrerequisiteEvalContext` & Fix Class/Domain Grants** (`builder_validation.ts`, `character_builder.ts`, `builder_feats.ts`, `wizard.json`, `ranger.json`, `druid.json`, `blackguard.json`, `domains/*.json`, `semantic_tags.ts`) | `validateCharacterCreationStep`, `sanitizeDraftOnRaceOrClassChange`, `rebuildActorStateFromLevelHistory` | `dnd35e_char_builder_feats.ui.ts`, `ek_bonus_fighter_feat` slot in `builder_feats.ts`, `natural_spell` (`feature:wild_shape`), `extra_turning` (`feature:turn_or_rebuke`) | `tests/dnd35e_phase26_ui_and_showcase.test.ts:162` (Wizard auto-gets `scribe_scroll`), `tests/dnd35e_classes_builder.test.ts:579` (Ranger `combat_style` TWF) |
| **7. Feat JSON SRD Fixes (`power_attack`, `extra_turning`, `improved_turning`, `leadership`, `augment_summoning`, weapon/monster/flight feats)** (`public/data/rulesets/dnd35e/feats/*.json`) | Loader + Zod validation (`dnd35e_validator.ts`) | All Feat Pickers, Character Creation, Level-Up, AI/Monster hydration (`applyRaceToActorChassis`) | `tests/dnd35e_phase26_ui_and_showcase.test.ts:190` (currently asserts Power Attack FAILS for Lv 1 Cleric!), `races/{beholder,chimera,manticore}.json`, `public/data/campaigns/dnd35e-crypt/entities.json` |
| **8. Template Prerequisite Definitions & Validator** (`templates/*.json`, `templates.ts`) | `DnD35TemplateSchema`, `validateTemplatePrerequisites` | `applyCreatureTemplate`, campaign entity hydrator / summon/bestiary tools | `tests/dnd35e_phase22_bestiary.test.ts` (must remain backward-compatible with synthetic test chassis without `alignment` unless strict check invoked) |
| **9. Aligned Spell Filtering for Clerics / Druids** (`builder_spells.ts`, `ledger_features_spells.ts`, `dnd35e_char_builder_spells.ui.ts`) | `spells/*.json` (`descriptors`), actor `alignment` | `isSpellSelectableForDraft`, `buildActorSpellbooksByClass`, `validateClassSpellSelection` | `tests/dnd35e_spellbook_slots.test.ts`, `tests/dnd35e_classes_builder.test.ts` |
| **10. Builder & Inspector UI Fixes** (`dnd35e_char_builder_feats.ui.ts`, `dnd35e_feat_spell_inspector.ui.ts`, `dnd35e_level_up_class.ui.ts`, `dnd35e_char_builder_spells.ui.ts`) | `renderCharBuilderFeatsStep`, `renderLevelUpFeatsStage` | `renderFeatInspector`, DOM interactions for stacking & multi-target feats, full AST node human-readable checklist | No architecture violation (keep rules math in Tier 2, DOM projection in `rendering/ui/`) |

---

## 4. Open Questions & Design Confirmations Required Before Planning

Before drafting `./docs/implementation_plan.md`, please confirm or clarify the following design boundaries:

1. **Test Alignment on Non-SRD Assertions:**
   Existing test assertions explicitly verify a few non-SRD behaviors:
   - `tests/dnd35e_phase26_ui_and_showcase.test.ts:190` asserts that a Lv 1 Cleric (BAB +0) is **rejected** for `power_attack` because of the old non-SRD `min_bab: 1`.
   - `tests/dnd35e_phase26_ui_and_showcase.test.ts:162` has a Human Wizard manually selecting `scribe_scroll` in `selectedFeats`, which will be an auto-granted Lv 1 bonus feat once fixed.
   - `tests/dnd35e_classes_builder.test.ts:174` passes untargeted `'weapon_focus'` for `arcane_archer`, and `tests/dnd35e_multiclass_and_builder.test.ts:303` passes untargeted `'weapon_focus'` for Cleric 3/Paladin 4.
   - `tests/dnd35e_equipment_m115.test.ts:411` evaluates `weapon_specialization:dagger` against a synthetic context with `totalBab: 4` and no Fighter levels.
   - `tests/dnd35e_classes_builder.test.ts:579` asserts `collectActiveGrantedAndVirtualFeats([rangerTrack], ...)` grants `two_weapon_fighting` without any `combatStyle` choice.
   - `tests/console_ui_architecture.test.ts:139` uses legacy `'spell_focus_conjuration'`.
   **Confirmation:** Should all these tests be updated alongside the SRD fixes so they validate strict SRD compliance?

2. **Language & Divination Spell-Count Edge Cases (`dragon_disciple` & `loremaster`):**
   - `dragon_disciple` SRD includes **Languages: Draconic**, and actors do not currently track known spoken languages in `DnD35EntityData` or Character Creation. Should we omit the language requirement for now (documenting it as out-of-scope until a Language system exists), or add a minimal `knownLanguages` list on actors/races?
   - `loremaster` SRD requires *"Able to cast seven different divination spells, one of which must be 3rd level or higher"*. For Prayerbook casters (Cleric/Druid) who automatically know all list spells (and check how many divination spells currently exist in `public/data/rulesets/dnd35e/spells/`), should we check 7+ divination spells in known/prepared spellbook OR keep `Able to cast 3rd-level spells (at least one divination)` / check how many divination spells exist in the registry first so it's actually achievable?

3. **Template Prerequisite Enforcement (`templates.ts`):**
   - Strictly adding **Lich** (`CL 11+`, `Craft Wondrous Item`, Evil) or **Ghost** (`CHA >= 6`) or alignment checks (`Celestial` non-evil, `Fiendish` non-good, `Half-Celestial` Any Good + `INT >= 4`, `Half-Fiend` Any Evil, `Vampire` Any Evil) inside `applyCreatureTemplate` could throw in unit tests (`tests/dnd35e_phase22_bestiary.test.ts:190`) where minimal mock `Archetype` fixtures omit `alignment` or `spellbooksByClass`.
   - **Proposal:** Expose a canonical pure validator `validateTemplatePrerequisites(base, template, sysContent)` (used by UI/builders/validators and optionally enabled via `{ strictPrerequisites: true }` in `applyCreatureTemplate`), while always enforcing structural `targetCreatureTypes` compatibility (expanded to strict SRD lists). Confirm if this split is acceptable.

4. **Weapon-Targeted Feat Requirements (`weapon_focus`, `improved_critical`, `rapid_reload`) vs. Special Targets:**
   - The Feat Picker currently offers base weapons from `sys.items` plus `['unarmed_strike', 'bite', 'claw']` (should also allow `'grapple'`, `'ray'`, `'slam'`, `'gore'`, etc. if present or keep standard natural/touch targets). How should proficiency work for non-item targets (`unarmed_strike`, `ray`, `grapple`, natural weapons)? Per SRD, all creatures are proficient with unarmed strikes, natural weapons, rays, and grapples—so `has_proficiency` should treat natural/unarmed/ray/grapple targets as automatically proficient while requiring actual proficiency for manufactured weapons!
