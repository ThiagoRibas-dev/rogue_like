# Research Notes — Unified Effect Providers, Sub-Stat DAG & Origin-Layer Resolution

## 1. Standards & Architectural Rules Reiterated (Step 1)

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16 & `DECISIONS.md` #10):**
   - **Tier 1 (Console Engine — `src/core/`, `src/systems/`, `src/types/`):** Generic tag-condition matching (`matchesEntityTagCondition`), `PropertyOverlayComponent`, anatomical `EquipmentSlotInstance[]` suppression, and hierarchical `sourcePath` provenance indexing.
   - **Tier 2 (Ruleset Cartridge — `src/rulesets/dnd35e/`):** Pure tabletop mathematical laws: the 4-Stage Topological Sub-Stat DAG (`size -> ability_scores -> compound_defenses -> combat_stats`), 18-type bonus stacking, Origin-Layer suppression filters, and provenance breakdown DTOs.
   - **Tier 3 (System Content — `public/data/rulesets/dnd35e/*.json`):** Declarative JSON definitions emitting `StatModifier`s and `RuleOverride`s.
2. **Baseline Rules + Declarative Overrides (`AGENTS.md` Rule 17 & `DECISIONS.md` #11):**
   - Zero hardcoded `if (hasFeat(...))` or `if (spell === 'barkskin')` branches in resolvers.
3. **Universal Actor Symmetry (`AGENTS.md` Rule 18 & `DECISIONS.md` #12):**
   - Every actor (PC, NPC, monster, construct, dragon) resolves stats through the exact same pipeline.
4. **Unified Effect Providers & Hierarchical Provenance (`AGENTS.md` Rule 19 & `DECISIONS.md` #13):**
   - Every structural building block (`Size`, `CreatureType`, `Subtype`, `Race`, `Template`, `Class`, `Feat`, `Equipment`, `Spell/Buff`, `Condition`, `TacticalStance`, `SpatialField`) is an Effect Provider that projects semantic self-tags (`size:*`, `type:*`, `subtype:*`, `trait:*`) and emits `StatModifier`s with a slash-delimited `sourcePath`.
5. **Strict TypeScript & ECS Purity (`AGENTS.md` §§3–4):**
   - Zero `any`, zero magic numbers, `exactOptionalPropertyTypes: true`, explicit return types, exhaustive switches, and 100% JSON-serializable ECS components (no `Map` or `Set` in components).

---

## 2. Codebase Audit & Gaps Discovered in Current Implementation (Step 2)

Cross-referencing `src/rulesets/dnd35e/modifiers.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`, `src/rulesets/dnd35e/abilities.ts`, `src/rulesets/dnd35e/srd_registry.ts`, and `src/rulesets/dnd35e/wild_shape.ts` revealed **five concrete architectural gaps** that our post-Phase 22 design discussions directly solve:

### Gap 1: Flat Compound-Bonus Folding Bug (`Worn Armor + Enhancement` vs. `Mage Armor`)
- **Current Code (`src/rulesets/dnd35e/modifiers.ts:230–235`):**
  ```ts
  const armorTotal = (maxByNonStackingType.armor ?? 0) + (maxByNonStackingType.armor_enhancement ?? 0);
  const shieldTotal = (maxByNonStackingType.shield ?? 0) + (maxByNonStackingType.shield_enhancement ?? 0);
  const naturalTotal =
    (maxByNonStackingType.natural_armor ?? 0) + (maxByNonStackingType.natural_armor_enhancement ?? 0);
  ```
- **The Problem:**
  1. If an actor wears Padded Armor (`+1` base, `+2` enhancement = `+3` total) **and** casts *Mage Armor* (`+4` armor bonus), `modifiers.ts` takes `max(armor: 1, 4) = 4` and adds `max(armor_enhancement: 2) = 2` for a total of **`+6` Armor**, which violates D&D 3.5e rules! Enhancement to armor enhances the *suit of armor* (`1 + 2 = 3`), which then competes against *Mage Armor* (`max(3, 4) = 4`).
  2. Incorporeal touch attacks ignore physical armor, shields, and natural armor, **except** `[Force]` effects like *Mage Armor* and *Shield* (`effectTags: ['force']`). Currently, `ignoreArmorAndNatural` blindly strips all `armor` and `shield` bonuses even when `effectTags` includes `'force'`.

### Gap 2: Natural Armor "Bonus to a Bonus" (Base + Untyped Class/Feat Increase + Enhancement)
- **Current Code (`src/rulesets/dnd35e/dnd35e_ruleset.ts:116–121`):**
  Emits a single `{ targetStat: 'ac', value: dndData.naturalArmorBonus, bonusType: 'natural_armor' }`.
- **The Problem:**
  In D&D 3.5e, an actor can simultaneously have:
  - Base racial/form Natural Armor (e.g., Lizardfolk `+5` or Bear form `+5`, `bonusType: 'base'` on `natural_armor`),
  - Additive Natural Armor increases (e.g., *Improved Natural Armor* feat `+1`, *Dragon Disciple* class `+1..+4`, or Template `+2` delta, which are `bonusType: 'untyped'` on `natural_armor` and stack with base natural armor),
  - Competing Enhancement bonuses to Natural Armor (e.g., *Amulet of Natural Armor +2* vs. *Barkskin +3*, which are `bonusType: 'enhancement'` on `natural_armor` and take `max(2, 3) = 3`).
  - All of these sum into the actor's effective **Natural Armor Bonus** (`5 + 1 + 3 = +9`), which then applies to `Full AC` and `Flat-Footed AC` as `bonusType: 'natural_armor'`, and is **excluded as a unit from `Touch AC`**.
  - Modeling `natural_armor`, `worn_armor_bonus`, and `worn_shield_bonus` as **Stage 3 Sub-Stat Nodes** in the DAG solves both Natural Armor and Worn Armor/Shield with **zero** special-case `if` statements in `resolveTypedModifiers` (while retaining backward compatibility for legacy `armor_enhancement`, `shield_enhancement`, and `natural_armor_enhancement` modifiers).

### Gap 3: `Size` Is Still a Passive Field Rather Than a Stage 1 Sub-Stat & Effect Provider
- **Current Code (`src/rulesets/dnd35e/modifiers.ts:287`, `dnd35e_ruleset.ts:146`):**
  `SIZE_AC_AND_ATTACK_MODIFIERS[sizeCategory]` is manually added inside `computeEffectiveAC` and `computeDnD35eEffectiveStats`.
- **The Problem:**
  1. Magical size increases (*Enlarge Person* `+1` step, *Righteous Might* `+1` step) do **not** stack with each other in D&D 3.5e (`bonusType: 'size_step'` takes `max`), whereas polymorphed base size (`bonusType: 'form_override'`) replaces `base` size.
  2. Per **Rule 19**, once Effective Size is resolved in **Stage 1** of the DAG, the **Size Effect Provider** (`buildSizeEffectProviderModifiers(sizeCategory, parentSourcePath)`) should project `size:<category>` and emit standard `bonusType: 'size'` modifiers to `'ac'`, `'attack'`, `'grapple'`, and `'hide'` with full `sourcePath` provenance (e.g., `"race:gnome/size:small/ac_size_mod"` or `"spell:enlarge_person/size:large/grapple_size_mod"`).

### Gap 4: Ability Score `StatModifier`s Are Not Wired Into `computeDnD35eEffectiveStats`
- **Current Code (`src/rulesets/dnd35e/dnd35e_ruleset.ts:74–86`):**
  Calls `computeEffectiveAbilityScore(dndData.abilityScores.str)` without passing `typedBonusNet` from `dndData.statModifiers` targeting `'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'`!
- **The Problem:**
  Modifiers targeting ability scores (such as *Belt of Giant Strength +4* `{ targetStat: 'str', bonusType: 'enhancement', value: 4 }`, *Barbarian Rage* `{ targetStat: 'str', bonusType: 'morale', value: 4 }`, or *Enlarge Person* `{ targetStat: 'str', bonusType: 'size', value: 2 }`) are currently ignored when computing `strMod`, `dexMod`, `conMod`, `attack`, `ac`, and `maxHp` in `computeDnD35eEffectiveStats` and `resolveDnD35eMeleeAttack`!
  Evaluating Ability Scores in **Stage 2** of the DAG (after Stage 1 Size tags are projected) ensures every typed ability bonus/penalty flows into `strMod..chaMod` and downstream into Stage 3/4 stats (including dynamic `chaMod` for `subtype:incorporeal` deflection AC and `conMod * totalHD` for `maxHp`!).

### Gap 5: Orthogonal Origin-Layer Classification & Winner/Shadowed Breakdown for UI & Suppression
- **Current Code (`src/rulesets/dnd35e/modifiers.ts`):**
  `resolveTypedModifiers` returns only a bare `number`, discarding which modifiers won, which were shadowed by a higher same-type bonus (e.g., *Barkskin +1* shadowed by *Amulet of Natural Armor +2*), and which were suppressed (by *Antimagic Field*, tag conditions, or Form Overlays).
- **The Solution (Inspired by *Incursion*'s `Attr[Stat][Origin]` Readout Without Its Conflated Enum):**
  - Keep `BonusType` strictly for **stacking rules** (`base`, `form_override`, `size_step`, `enhancement`, `dodge`, `untyped`, etc.).
  - Derive an orthogonal **`OriginLayer`** (`'base' | 'racial' | 'progression' | 'form' | 'equipment' | 'temporary' | 'environment'`) from the root segment of `sourcePath` (`race:*`, `class:*`/`feat:*`/`template:*`, `form:*`/`wild_shape:*`, `item:*`/`equip:*`, `spell:*`/`condition:*`, `field:*`).
  - Provide `resolveTypedModifiersWithBreakdown(modifiers, context)` returning:
    - `total: number`
    - `activeModifiers: ReadonlyArray<StatModifier>` (the winners contributing to `total`)
    - `shadowedModifiers: ReadonlyArray<{ modifier: StatModifier; shadowedBySourcePath: string }>` (losers of non-stacking `Math.max` competition)
    - `suppressedModifiers: ReadonlyArray<{ modifier: StatModifier; reason: 'antimagic' | 'tag_condition' | 'touch_attack' | 'flat_footed' | 'origin_suppressed' }>`
    - `byOriginLayer: Readonly<Record<OriginLayer, number>>` (net contribution per origin layer for Character Sheet / Tooltip display).

---

## 3. Proposed 4-Stage Topological Sub-Stat DAG Architecture

| Stage | Target Stats Resolved | Inputs | Emits Downstream |
| :--- | :--- | :--- | :--- |
| **Stage 1: Effective Size & Self-Tags** | `'size'` (`rankIndex: -4..+4`) | Base race/archetype size (`bonusType: 'base'`), Form Overlay size (`bonusType: 'form_override'`), Magical size steps (`bonusType: 'size_step'`, non-stacking `max`/`min`) | Resolved `CreatureSizeCategory`, projects `size:<category>` self-tag, and emits Size Effect Provider modifiers (`ac`, `attack`, `grapple`, `hide`, and triggers `type:construct` size HP condition). |
| **Stage 2: Effective Ability Scores** | `'str'`, `'dex'`, `'con'`, `'int'`, `'wis'`, `'cha'` | Base/Form ability score + `inherent` + resolved typed modifiers (`enhancement`, `morale`, `alchemical`, `size`, `racial`, `sacred`, `profane`, `untyped`, penalties) + `drain`/`damage` | Effective scores (`number \| null`) and modifiers (`strMod..chaMod`) feeding Stage 3 & Stage 4. |
| **Stage 3: Compound Defense Sub-Stats** | `'natural_armor'`, `'worn_armor_bonus'`, `'worn_shield_bonus'` | `base` (racial/form NA, physical worn armor/shield) + `untyped` increases (Dragon Disciple, Improved Natural Armor) + `max(enhancement)` (*Amulet of Natural Armor*, *Barkskin*, *Magic Vestment*, `+1..+5` armor/shield) | Emits consolidated `{ targetStat: 'ac', bonusType: 'natural_armor' }`, `{ targetStat: 'ac', bonusType: 'armor' }`, and `{ targetStat: 'ac', bonusType: 'shield' }` into Stage 4. |
| **Stage 4: Derived Combat & Check Stats** | `'ac'`, `'touch_ac'`, `'flat_footed_ac'`, `'attack'`, `'damage'`, `'save_fort'`, `'save_ref'`, `'save_will'`, `'max_hp'`, `'speed'`, `'initiative'`, `'grapple'`, `'hide'` | Stage 1 Size mods + Stage 2 Ability mods + Stage 3 Compound Defense outputs + direct Stage 4 modifiers (*Mage Armor* `bonusType: 'armor', effectTags: ['force']`, *Shield of Faith* `deflection`, *Haste* `dodge`, Dwarf `+4 dodge vs giant`, etc.) | Final `DnD35ResolvedActorStats` & `EffectiveStats` + full provenance & origin-layer breakdowns. |

---

## 4. Cascading Effects Matrix (`Rule 15`: Upstream / Downstream / Lateral)

| Change | Upstream (Callers / Producers / Data) | Downstream (Consumers / Validators / UI) | Lateral (Sibling Modules / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. `BonusType`, `OriginLayer`, `StatModifier` (`effectTags`, `'base'`, `'form_override'`, `'size_step'`) & `StatResolutionBreakdown` in `src/rulesets/dnd35e/types/dnd35e.types.ts`** | Produced by `races.ts`, `templates.ts`, `srd_registry.ts`, `wild_shape.ts`, `dnd35e_ruleset.ts`, and `races.json` (`DnD35ConditionalModifierSchema`). | Consumed by `modifiers.ts`, `dnd35e_ruleset.ts`, and future Character Sheet UI (`Phase 26`). | Mirror new `BonusType` literals (`'base'`, `'form_override'`, `'size_step'`) in `DnD35BonusTypeSchema` in `src/rulesets/dnd35e/types/dnd35e_system.types.ts`. |
| **2. Origin-Layer Classifier & `resolveTypedModifiersWithBreakdown` in `src/rulesets/dnd35e/modifiers.ts`** | Called by `resolveTypedModifiers`, `computeEffectiveAC`, and the 4-stage DAG evaluator. | Preserves exact signature and return type (`number`) of `resolveTypedModifiers` for all existing callers while exposing rich breakdown DTOs and `ignoreArmorAndNatural` `[Force]` exemption (`effectTags: ['force']` against ` againstIncorporealTouch: true`). | Backward-compatible with existing tests in `tests/dnd35e_cartridge.test.ts` and `tests/dnd35e_phase22_bestiary.test.ts`. |
| **3. Size Effect Provider (`buildSizeEffectProviderModifiers` & `resolveEffectiveSizeCategory`) in `src/rulesets/dnd35e/modifiers.ts`** | Consumes `SIZE_METRICS` from `src/rulesets/dnd35e/spatial/grid_geometry.ts` and `size` sub-stat modifiers. | Emits `size` modifiers to `'ac'`, `'attack'`, `'grapple'`, and `'hide'` with `sourcePath: "<parent>/size:<category>/<stat>_size_mod"`. Avoids double-counting size AC/attack in `computeEffectiveAC` when size provider mods are present. | Aligns with `buildCreatureTypeAndSubtypeModifiers` in `srd_registry.ts`. |
| **4. 4-Stage Topological Actor Stat DAG Evaluator (`evaluateDnD35ActorStatDAG`) in `src/rulesets/dnd35e/modifiers.ts` & `dnd35e_ruleset.ts`** | Called by `computeDnD35eEffectiveStats` and `resolveDnD35eMeleeAttack` in `src/rulesets/dnd35e/dnd35e_ruleset.ts`. | Drives `EffectiveStats` (`attack`, `defense`, `maxHp`, `speed`), `ACBreakdownDTO`, and melee attack/damage rolls (`strMod` from Stage 2, `conMod` HP deltas from Stage 2, `chaMod` incorporeal deflection from Stage 2, and `natural_armor` / `worn_armor_bonus` / `worn_shield_bonus` from Stage 3). | Updates `docs/ARCHITECTURE.md` (§9.5) and `docs/DECISIONS.md` (#14) and adds unit tests in `tests/dnd35e_phase22_bestiary.test.ts` (or dedicated test suite). |
