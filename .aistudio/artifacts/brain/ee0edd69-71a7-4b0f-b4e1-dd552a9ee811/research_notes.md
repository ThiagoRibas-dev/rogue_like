# Research Notes: Universal Actor Symmetry, Unified Races/Bestiary & Modular Effect Registries

## 1. Reiteration of Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)
- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any`, `exactOptionalPropertyTypes: true`, explicit return types on all functions, exhaustive switches, and all gameplay literals in declarative JSON registries or named constants.
- **Rule 15 (Three-Axis Cascading Effects Mapping):** Every change to schemas, registries, hydration pipelines, and validators must be mapped across **Upstream** (JSON data, loaders, character builder, tests), **Downstream** (DAG stat resolver, combat, wild shape, templates, validators), and **Lateral** (campaigns, file descriptors, disk parity CLI).
- **Rule 16 (Three-Tier Placement Heuristic):**
  - *Tier 1 (Core Console):* Agnostic ECS & loader (`loader.ts` shallow-merging multi-file descriptors sharing a `key`).
  - *Tier 2 (Ruleset Cartridge `src/rulesets/dnd35e/`):* Mathematical laws of D&D 3.5e (RHD progression by Creature Type, 1-HD Humanoid class replacement, SRD Size Advancement tables, Unified Effect Providers, 4-Stage Stat DAG).
  - *Tier 3 (System Content `public/data/rulesets/dnd35e/`):* Modular per-entry JSON registries for `races/`, `classes/`, `creature_types/`, `subtypes/`, `domains/`, `skills/`, `feats/`, `spells/`, and `templates/`.
- **Rule 18 (Universal Actor Symmetry & Composable Diffs):** Do not maintain separate "Player Race" vs. "Monster Statblock (`archetypes`)" vs. "Dragon Family (`dragon_families`)" schemas or pipelines. Every actor (PC, NPC, animal, construct, elemental, or dragon) is composed of the exact same building blocks:
  $$\text{Base Ability Array} + \text{Race/Species Chassis} + \text{Racial HD Track (from Creature Type)} + \text{Class Level Tracks} + \text{Templates}$$
- **Rule 19 (Unified Effect Providers & Hierarchical Provenance `sourcePath`):** Creature Types, Subtypes, Races, Classes, Domains, Skills, Feats, and Templates all act as declarative Effect Providers emitting `StatModifier`s and semantic tags with slash-delimited `sourcePath` provenance.

---

## 2. Current Codebase Findings & Architectural Gaps

### 2.1. Redundant Split Between `races/`, `archetypes/`, and `dragon_families.json`
1. **Duplicate Definitions:**
   - Currently, `public/data/rulesets/dnd35e/races/` has 17 entries (`human`, `dwarf`, `elf`, `goblin`, `kobold`, `orc`, `hobgoblin`, `bugbear`, etc.), while `public/data/rulesets/dnd35e/archetypes/` has 51 entries (`goblin`, `kobold`, `orc`, `hobgoblin`, `bugbear`, `ogre`, `troll`, `marilith`, etc.).
   - Creatures like `goblin`, `kobold`, `orc`, `hobgoblin`, and `bugbear` are defined **twice** in two incompatible schemas (`DnD35RaceDefinitionSchema` vs. `DnD35ArchetypeSchema`).
2. **Hardcoded RHD Curves in `archetypes/`:**
   - Every monster in `archetypes/*.json` manually duplicates `tracks: [{ trackId: "giant", levels: 4, hitDieSides: 8, babCurve: "three_quarters", fortCurve: "good", refCurve: "poor", willCurve: "poor", skillPointsPerLevel: 2 }]` instead of deriving its RHD progression from its `creatureType` (`creature_types/giant.json`).
3. **Bespoke `dragon_families.json` & `family_synthesizer.ts` Silo:**
   - `dragon_families.json` defines `ageCategories`, `varieties`, and `elementalSteps` in a custom schema only used by `synthesizeTrueDragonArchetype` and `synthesizeElementalArchetype`.
   - In reality, True Dragons (`red_dragon`, `gold_dragon`, etc.) and Elementals (`air_elemental`, `earth_elemental`, `fire_elemental`, `water_elemental`) are simply **Races/Species** whose RHD advancement has named growth tiers (`progressionTiers`: `wyrmling`..`great_wyrm` or `small`..`elder`) and size-gated natural weapons (`minSizeCategory: 'medium'` for `wings`, `'large'` for `tail_slap`, `'huge'` for `crush`, `'gargantuan'` for `tail_sweep`).
4. **Missing 1-HD Humanoid Class Replacement & NPC Classes:**
   - Per SRD *Humanoids and Class Levels*, Humanoids with $\le 1$ RHD exchange their 1 RHD for a 1st-level class (defaulting to 1st-level `warrior` for standard monster statblocks like Goblin, Kobold, Orc, Hobgoblin).
   - Currently, `goblin.json` in `archetypes/` has `tracks: [{ trackId: "warrior", ... }]`, and `races/human.json` has `favoredClass: "any"`, while `races/elf.json` has `favoredClass: "wizard"`, yet the 5 canonical SRD NPC classes (`warrior`, `expert`, `adept`, `aristocrat`, `commoner`) do not exist in `classes/`!

### 2.2. Unmodularized Registries & Missing `subtypes/` Registry
1. **Monolithic JSON Files Remaining:**
   - `creature_types.json` (15 entries), `domains.json` (20 entries), and `skills.json` (12 entries) are still single monolithic JSON files rather than modular subdirectories (`creature_types/*.json`, `domains/*.json`, `skills/*.json`).
2. **Missing First-Class `subtypes/` Registry:**
   - Subtypes (`air`, `angel`, `aquatic`, `archon`, `augmented`, `chaotic`, `cold`, `earth`, `evil`, `extraplanar`, `fire`, `goblinoid`, `good`, `incorporeal`, `lawful`, `native`, `reptilian`, `shapechanger`, `swarm`, `water`) are currently just unvalidated strings on `subtypes: string[]`, with only `incorporeal` hardcoded in `srd_registry.ts`.
   - Creating `subtypes.json` + `subtypes/<id>.json` allows every SRD subtype to declaratively specify its immunities, vulnerabilities (`fire` $\rightarrow$ immune `fire`, vulnerable `cold`; `cold` $\rightarrow$ immune `cold`, vulnerable `fire`), DR bypass alignment tags (`good`, `evil`, `lawful`, `chaotic`), save overrides (`air`/`fire` elementals $\rightarrow$ Good Ref; `earth`/`water` elementals $\rightarrow$ Good Fort), sensory/movement traits, `incorporeal` rules, and `swarm` rules (HD-scaled `1d6..5d6` auto-damage, distraction DC, weapon immunity/half-damage, +50% area vulnerability).
3. **Skills as Declarative Effect & Action Bundles:**
   - Currently `skills.json` only stores `{ id, name, keyAbility, trainedOnly, acpMultiplier, synergyFromSkills }`.
   - Expanding `DnD35SkillDefinitionSchema` and decomposing into `skills/<id>.json` allows each skill to declare its structured **Skill Actions & Mechanics** (`actions`: action cost, base DC or opposed check, retry eligibility, special condition/movement rules, and rank-threshold effect modifiers like 5-rank Tumble boosting Fighting Defensively / Total Defense dodge bonuses).

---

## 3. Target Architecture & Task Mapping

### Task 1: Modularize `creature_types/`, `subtypes/`, `domains/`, and `skills/` as Effect & Rule Bundles
- **`creature_types/` (15 files + `{}` root `creature_types.json`):**
  - `aberration`, `animal`, `construct`, `dragon`, `elemental`, `fey`, `giant`, `humanoid`, `magical_beast`, `monstrous_humanoid`, `ooze`, `outsider`, `plant`, `undead`, `vermin`.
  - Clearly models **Features** (`hitDieSides`, `babCurve`, `fortCurve`, `refCurve`, `willCurve`, `skillPointsPerLevel`, `goodSaveBySubtype`) and **Traits** (`hasConstitutionScore`, `hasIntelligenceScore`, `defaultTraits`, `immunities`, `constructBonusHpBySize`, `weaponProficiencies`, `armorProficiencies`, `physiology`: `{ eats, sleeps, breathes }`).
- **`subtypes/` (20 files + `{}` root `subtypes.json`):**
  - `air`, `angel`, `aquatic`, `archon`, `augmented`, `chaotic`, `cold`, `earth`, `evil`, `extraplanar`, `fire`, `goblinoid`, `good`, `incorporeal`, `lawful`, `native`, `reptilian`, `shapechanger`, `swarm`, `water`.
  - Validated by `DnD35SubtypeDefinitionSchema` and cross-checked by `dnd35e_validator.ts` whenever a race, class, or template references a subtype.
- **`domains/` (20 files + `{}` root `domains.json`):**
  - Decompose all 20 Cleric Domains (`air`, `animal`, `chaos`, `death`, `destruction`, `earth`, `evil`, `fire`, `good`, `healing`, `knowledge`, `law`, `luck`, `magic`, `plant`, `protection`, `strength`, `sun`, `travel`, `trickery`, `war`, `water`) into `public/data/rulesets/dnd35e/domains/<id>.json`.
- **`skills/` (12+ files + `{}` root `skills.json`):**
  - Decompose all skills into `public/data/rulesets/dnd35e/skills/<id>.json` with enriched `actions` and rank-conditional modifiers.

### Task 2: Add the 5 SRD NPC Classes to `classes/`
- Author `warrior.json`, `expert.json`, `adept.json`, `aristocrat.json`, and `commoner.json` in `public/data/rulesets/dnd35e/classes/` with full 20-level progression tables.
- Add `isNpcClass: z.boolean().default(false)` to `DnD35ClassDefinitionSchema`.

### Task 3: Merge `archetypes/` and `dragon_families.json` into Unified `races/` Registry
- **Unified `DnD35RaceDefinitionSchema` (`public/data/rulesets/dnd35e/races/<id>.json`):**
  - Supports every playable race, monster species, construct, undead, elemental, and dragon in one symmetric schema:
    - **Ability Scores:** `abilityAdjustments` (even-numbered racial modifiers relative to the 10/11 standard array), `nonabilities` (`['con']`, `['int']`, etc.), and optional `statblockAbilityScores` (or computed directly from Standard Array `[10/11]` + `abilityAdjustments`).
    - **Racial Hit Dice & Class Tracks:**
      - `racialHdCount`: number of base Racial Hit Dice (`0` for 1-HD humanoids whose single HD is replaced by a class level; `>= 1` for monsters with true RHD).
      - `racialSaveOverrides`: optional override for species whose good saves differ from their Creature Type default (e.g. `dire_rat`, `dire_wolf`, `dire_bear` having Good Fort, Ref, AND Will).
      - `defaultClassLevels`: optional starting class levels for standard statblock instantiation (e.g., `[{ classId: 'warrior', levels: 1 }]` for `goblin`, `kobold`, `orc`, `hobgoblin`).
    - **Generic RHD Advancement & Named Progression Tiers:**
      - `advancementRanges`: SRD HD-to-Size advancement brackets (`minHd`, `maxHd`, `sizeCategory`, `crAdjustment`).
      - `progressionTiers`: Optional keyed dictionary of named growth/age tiers (replacing `dragon_families.json`! Used by `red_dragon`, `black_dragon`, `blue_dragon`, `green_dragon`, `white_dragon`, `gold_dragon`, `silver_dragon`, `bronze_dragon`, `copper_dragon`, `brass_dragon`, and `air_elemental`, `earth_elemental`, `fire_elemental`, `water_elemental`), where each tier specifies `hitDice`, `sizeCategory`, `abilityAdjustmentsDelta`, `naturalArmorDelta`, `cr`, `spellResistance`, `damageReduction`, `breathWeapon`, etc.
    - **Combat, Natural Weapons & Size-Gated Weapons:**
      - `naturalWeapons`: `NaturalWeaponDescriptor[]`, enhanced with optional `minSizeCategory: SizeCategorySchema.optional()` so size-gated natural weapons (`wings` at `medium`, `tail_slap` at `large`, `crush` at `huge`, `tail_sweep` at `gargantuan`) activate automatically whenever a creature's effective size is $\ge \text{minSizeCategory}$!
- **Retiring `archetypes/` and `dragon_families.json`:**
  - Delete `public/data/rulesets/dnd35e/dragon_families.json` and `public/data/rulesets/dnd35e/archetypes/` (`archetypes.json`).
  - Migrate all Bestiary species, True Dragon varieties, and Elemental species into `public/data/rulesets/dnd35e/races/<id>.json`.
  - Update `hydrateActorFromRace` (and keep `hydrateArchetypeData` / `getDnD35Archetype` as clean compatibility facades delegating to the unified `races` registry) so campaign entities (`archetypeId` / `raceId`), Wild Shape, Templates, and HD Advancement all operate seamlessly on the unified Race/Actor model.

---

## 4. Three-Axis Cascading Effects Matrix (`Rule 15`)

| Change | Upstream (Callers / Producers / Data) | Downstream (Consumers / Resolvers / Validators) | Lateral (Campaigns / Tests / CLI / Docs) |
| :--- | :--- | :--- | :---
| **1. Modularize `creature_types/`, `subtypes/`, `domains/`, `skills/`** | `public/data/rulesets/dnd35e/{creature_types,subtypes,domains,skills}/*.json`, `system_content_files.ts` | `DnD35SystemContentSchema`, `srd_registry.ts` (`buildCreatureTypeAndSubtypeModifiers`), `skills.ts`, `dnd35e_validator.ts` | `scripts/run-validator.ts` (disk parity check), `tests/ruleset_validators.test.ts` |
| **2. Add 5 SRD NPC Classes (`warrior`, `expert`, `adept`, `aristocrat`, `commoner`)** | `public/data/rulesets/dnd35e/classes/*.json`, `system_content_files.ts` | `progression.ts`, `character_builder.ts`, `templates.ts` (Skeleton/Zombie class-HD stripping now checks `!sysContent.classes[trackId]` or `isClassTrack` instead of a hardcoded 11-class list) | `tests/dnd35e_cartridge.test.ts`, `tests/dnd35e_phase23_classes.test.ts` |
| **3. Merge `archetypes/` & `dragon_families.json` into Unified `races/`** | `public/data/rulesets/dnd35e/races/*.json`, `system_content_files.ts`, `family_synthesizer.ts`, `races.ts`, `creature_advancement.ts` | `srd_registry.ts` (`getDnD35EntityData`, `getDnD35Race`, `getDnD35Archetype`), `character_builder.ts`, `dnd35e_validator.ts` | `public/data/campaigns/dnd35e-crypt/entities.json`, `tests/dnd35e_phase22_bestiary.test.ts`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` |
