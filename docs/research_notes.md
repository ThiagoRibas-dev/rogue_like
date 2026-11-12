# Research Notes — Phase 30: Universal Actor Symmetry, Unified Race/Archetype Hydration & Real Monster Armament Equipping (Milestones 129 & 130)

## 1. Core Architectural Rules & Standards Reiterated
- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any`, `exactOptionalPropertyTypes: true`, explicit return types on all functions, and named constants or declarative JSON definitions for all gameplay parameters.
- **Rule 15 (Three-Axis Cascading Effects Mapping):** Every change to behavior, ordering, or data shape must map Upstream (callers, emitters, data authors, tests), Downstream (renderers, validators, serializers, DAG resolvers), and Lateral (sibling JSONs, editor schemas, SSOT docs) effects.
- **Rule 16 (Three-Tier Placement Heuristic):**
  - Tier 1 (`src/core/`, `src/systems/`, `src/types/`): Console-level anatomical `EquipmentSlotInstance[]` initialization (`buildAnatomyEquipmentSlots`).
  - Tier 2 (`src/rulesets/dnd35e/`): Symmetrical D&D 3.5e race/class hydration, DAG evaluation, and equipment physics.
  - Tier 3 (`public/data/rulesets/dnd35e/*.json`): Declarative race definitions, `defaultEquipment` loadouts, and natural weapon descriptors.
- **Rule 18 (Universal Actor Symmetry & Composable Diffs):** Every actor (PC, NPC, animal, 6-armed Marilith, or dragon) is composed of the exact same building blocks: Racial Hit Dice / Base Race, Class tracks, Anatomical Equipment Slots, Natural & Manufactured Weapons, Skills, Feats, and Abilities.
- **Rule 19 & 20 (Unified Effect Providers & Three-Horizon Boundaries):** All modifiers carry hierarchical `sourcePath` provenance across Horizon 1 (`levelHistory`), Horizon 2 (aggregated progression layers), and Horizon 3 (live equipment & tag projection).

---

## 2. Detailed Audit Findings & Root Causes

### Finding 1: Split Race Hydration Pipelines (`applyRaceToActorChassis` vs. `hydrateRaceAsArchetype` + `hydrateArchetypeData`)
- **Current State:**
  - **Player Path (`src/rulesets/dnd35e/races.ts` $\to$ `applyRaceToActorChassis`)**:
    - Evaluates `race.traitBundles` via `evaluateEffectBundle`, `race.conditionalModifiers`, `race.saveBonuses`, and `race.spellResistanceFormula`.
    - **Missing**: Does not call `buildCreatureTypeAndSubtypeModifiers` (from `src/rulesets/dnd35e/semantic_tags.ts`), meaning a player of a race with `outsider` type (`aasimar`, `tiefling`) or specific subtypes (`elf`, `orc`, `goblinoid`, `fire`, `cold`) does not receive automatic Creature Type / Subtype `traitBundles` or modifiers during `applyRaceToActorChassis`. Also does not inspect `creatureTypeEngine.goodSaveBySubtype` when constructing RHD tracks.
  - **Monster/NPC Path (`src/rulesets/dnd35e/archetype/race_hydrator.ts` $\to$ `hydrateRaceAsArchetype` $\to$ `hydrateArchetypeData` in `src/rulesets/dnd35e/archetype_resolver.ts`)**:
    - Calls `buildCreatureTypeAndSubtypeModifiers` and checks `ctEngine.goodSaveBySubtype`.
    - **Missing**: Drops `race.traitBundles`, `race.conditionalModifiers`, `race.saveBonuses`, and `race.spellResistanceFormula`! If a `dwarf`, `elf`, `gnome`, `halfling`, `drow`, or `svirfneblin` is hydrated via `getDnD35Archetype` + `hydrateArchetypeData` (e.g., as an NPC or monster), its racial save bonuses, conditional AC/attack bonuses against giants/orcs, and dynamic SR formula (`11 + HD`) are silently lost.
- **Playable Monster-Race Feat Contamination (`builder_hydrator_creation.ts`)**:
  - `orc.json`, `goblin.json`, `hobgoblin.json`, and `kobold.json` have `"isPlayableRace": true` alongside Monster Manual 1st-level Warrior defaults (`"defaultClassLevels": [{ "classId": "warrior", "levels": 1 }]` and `"feats": ["weapon_focus:greataxe"]` / `["alertness"]`).
  - While `builder_hydrator_creation.ts` resets `withBaseAbilities.feats = []`, any future unification of racial bonus feats vs. default Warrior feats must distinguish true racial bonus feats from default Monster Manual Warrior 1 feats when `defaultClassLevels.length > 0`.

### Finding 2: Non-Player `defaultClassLevels` Bypass Class Feature & Modifier Evaluation
- **Current State:**
  - In `src/rulesets/dnd35e/archetype/race_hydrator.ts` (lines 87–122), `requestedClassLevels` (from `raceDef.defaultClassLevels` or `options.classLevels`) only constructs bare `DnD35ProgressionTrack` entries (`levels`, `hitDieSides`, `babCurve`, `fortCurve`, `refCurve`, `willCurve`, `skillPointsPerLevel`).
  - When `hydrateArchetypeData` (`src/rulesets/dnd35e/archetype_resolver.ts`) turns that `DnD35Archetype` into `DnD35EntityData`, it never calls `collectActiveClassFeaturesAndPools`, `buildClassAndDomainEffectModifiers`, `collectActiveGrantedAndVirtualFeats`, or `buildFeatEffectModifiers` from `src/rulesets/dnd35e/level_ledger.ts`.
  - Consequently, an NPC or monster hydrated with class levels (e.g., `barbarian`, `fighter`, `monk`, `ranger`, `warrior`) does not get its class feature modifiers (`activeClassFeatures`, `scalingPools`, `classAndDomainMods`) on `DnD35EntityData`.

### Finding 3: Baked-In Statblock Armaments vs. Real Equipped Items (`defaultEquipment`) & Missing Natural Weapons
- **Current State:**
  - `resolveAllEquippedWeaponProfiles` (`src/rulesets/dnd35e/equipment_physics.ts` lines 97–105) inspects `EquipmentComponent.slots`. When no weapon item entity is equipped in a hand slot, it returns `buildUnarmedProfile` (`1d3` bludgeoning, `weaponItemId: 'unarmed_strike'`).
  - Armed monster races (`orc`, `goblin`, `hobgoblin`, `kobold`, `bugbear`, `gnoll`, `ogre`, `hill_giant`, `stone_giant`, `frost_giant`, `fire_giant`, `ettin`, `minotaur`, `balor`, `marilith`, `skeleton`) currently rely on legacy flat fields (`weaponDice`, `armorBonus`, `shieldBonus`) in `races/<id>.json` and have no equipped items when spawned.
  - Because `resolveAllEquippedWeaponProfiles` returns `unarmed_strike` for unequipped actors:
    1. Their melee strikes use `1d3` unarmed damage instead of their SRD weapon (`greataxe`, `greatclub`, `morningstar`, `longsword`, etc.) unless they have `naturalWeapons`.
    2. Their parameterized weapon feats (`weapon_focus:greataxe`, `weapon_focus:greatclub`, `weapon_focus:morningstar`, `weapon_focus:longsword`) never match `weapon:unarmed_strike`!
    3. `marilith` (`anatomyBodyPlan: "marilith_6arm"`, `feats: [..., "multiweapon_fighting", "weapon_focus:longsword"]`) has no longswords equipped across its 6 hands.
    4. `manticore.json` has `"weapon_focus:spikes"` in `feats`, but its `naturalWeapons` array only lists `claw` and `bite` (missing `spikes`).
    5. `skeleton.json` and `zombie.json` in `races/` have `naturalWeapons: []` (unlike `templates/skeleton.json` and `templates/zombie.json`, which grant `claw` and `slam`).

### Finding 4: `buildAnatomyEquipmentSlots` Not Wired Into `spawnEntity` (`src/core/ecs/ecs_spawner.ts`)
- **Current State:**
  - `buildAnatomyEquipmentSlots(bodyPlan)` in `src/systems/inventory/equipment_slots.ts` defines complete anatomical slot graphs with `limbGroupId` links (`arm_group_1`..`arm_group_6`, `foreleg_left`, etc.) for all 5 body plans (`humanoid_biped`, `quadruped`, `marilith_6arm`, `avian`, `serpentine`).
  - However, `spawnEntity` in `src/core/ecs/ecs_spawner.ts` only creates an `EquipmentComponent` if `template.equipmentSlots` is explicitly present on the campaign entity template (`entities.json`), and even then it constructs naive `{ id: "${slotType}_${index}", slotType, equippedItem: null }` records without `limbGroupId`!
  - Non-player actors in `dnd35e-crypt/entities.json` omit `equipmentSlots` and `inventoryConfig`, so spawned monsters lack `EquipmentComponent` and `InventoryComponent` entirely.

### Finding 5: Legacy Feat Prefix Fallbacks, Duplicate `improved_critical` Injection & Dead Schemas
- **`src/rulesets/dnd35e/effect_bundle.ts` (lines 164–182)**: `parseParameterizedFeatId` still loops over `KNOWN_PARAMETERIZED_FEAT_PREFIXES` (`weapon_focus_`, `weapon_specialization_`, etc.) for underscore-delimited feat IDs that have been completely eliminated.
- **`src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` (lines 242–261)**: `parseEquippedItem` manually checks `feats.some(f => f === 'improved_critical:...')` and injects a duplicate `crit_threat_doubling` modifier, which is already handled canonically by `buildFeatEffectModifiers` + `resolveActorAttackRoutine` (`attack_routine.ts`).
- **`src/rulesets/dnd35e/families/dragon_synthesizer.ts` & `elemental_synthesizer.ts`**: Retain 150+ lines of dead fallback code for `DnD35DragonFamiliesData` (`dragon_families.json`), which was replaced by `races/dragon_*.json` and `races/elemental_*.json` in Milestone 108.
- **`src/rulesets/dnd35e/types/system/creature_system.types.ts` & `templates.ts`**: `DnD35TemplateSchema` and `DnD35TemplateHdTierSchema` define both `energyResistance` and `energyResistances`, even though all 9 `public/data/rulesets/dnd35e/templates/*.json` files use `energyResistances`.

---

## 3. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner (SSOT) | Old-Brain / Duplicate Location to Evict |
| :--- | :--- | :--- |
| Racial trait bundle, conditional modifier, save bonus, SR formula & creatureType/subtype modifier evaluation | `src/rulesets/dnd35e/races.ts` (`evaluateRacialModifiersAndSenses` / `applyRaceToActorChassis`) shared by `hydrateArchetypeData` (`src/rulesets/dnd35e/archetype_resolver.ts`) | Divergent ad-hoc subsets in `races.ts` vs. `race_hydrator.ts` / `archetype_resolver.ts` |
| Parameterized feat ID parsing (`baseFeatId:targetId`) | `src/rulesets/dnd35e/effect_bundle.ts` (`parseParameterizedFeatId` colon-syntax only) | `KNOWN_PARAMETERIZED_FEAT_PREFIXES` underscore fallback in `effect_bundle.ts` and `improved_critical_*` check in `weapon_profile_parser.ts` |
| Critical threat range expansion (`'threat_expansion'`) | `src/rulesets/dnd35e/progression/ledger_modifiers.ts` (`buildFeatEffectModifiers`) + `src/rulesets/dnd35e/combat/attack_routine.ts` | Duplicate `hasImprovedCrit` injection in `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` |
| True Dragon & Elemental tier synthesis | `synthesizeDragonFromRaceTier` (`dragon_synthesizer.ts`) & `synthesizeElementalFromRaceTier` (`elemental_synthesizer.ts`) | Legacy `DnD35DragonFamiliesData` branches in `dragon_synthesizer.ts`, `elemental_synthesizer.ts`, `archetype_resolver.ts`, `base_system.types.ts`, and `dnd35e_system.types.ts` |
| Template energy resistance schema key | `energyResistances` in `DnD35TemplateSchema` & `DnD35TemplateHdTierSchema` (`creature_system.types.ts`) | Duplicate singular `energyResistance` property on `DnD35TemplateSchema` & `DnD35TemplateHdTierSchema` |
| Actor anatomical slot topology & default armament equipping | `buildAnatomyEquipmentSlots` (`src/systems/inventory/equipment_slots.ts`) invoked by `spawnEntity` (`src/core/ecs/ecs_spawner.ts`) + `defaultEquipment` in `races/*.json` | Unwired `buildAnatomyEquipmentSlots` and unequipped armed monsters falling back to `1d3` unarmed strikes |

---

## 4. Cascading Effects Matrix (AGENTS.md Rule 15)

| Change | Upstream (Callers, Data Authors, Fixtures) | Downstream (Resolvers, Validators, Renderers, Save Schemas) | Lateral (Sibling JSONs, Bundled Monoliths, SSOT Docs) |
| :--- | :--- | :--- | :--- |
| **1. Unify Race & Class Hydration (`races.ts`, `race_hydrator.ts`, `archetype_resolver.ts`)** | `applyCharacterCreationToPlayer`, `getDnD35EntityData`, `syncActorCompanionsAndFamiliars`, `tests/dnd35e_phase22_bestiary.test.ts` | `evaluateDnD35eEntityDAG` receives complete racial `traitBundles`, `conditionalModifiers`, `saveBonuses`, `spellResistance`, and class feature modifiers for both PCs and NPCs/monsters | `builder_hydrator_creation.ts` filters out default Warrior feats when `raceDef.defaultClassLevels.length > 0` so PCs don't inherit Monster Manual Warrior feats |
| **2. Evict `KNOWN_PARAMETERIZED_FEAT_PREFIXES`, duplicate `hasImprovedCrit`, `DnD35DragonFamiliesData`, & template `energyResistance`** | `parseParameterizedFeatId`, `parseEquippedItem`, `synthesizeTrueDragonArchetype`, `synthesizeElementalArchetype`, `applyCreatureTemplate` | `evaluateDnD35eEntityDAG` & `resolveActorAttackRoutine` resolve `improved_critical:<weapon>` via `buildFeatEffectModifiers`; `dnd35e_validator.ts` validates templates using `energyResistances` | `public/data/rulesets/dnd35e/templates/*.json` & `templates.json` already use `energyResistances`; check `tests/dnd35e_equipment_m115.test.ts` for any direct `parseEquippedItem` crit test |
| **3. Auto-Initialize Anatomical `EquipmentComponent` & `defaultEquipment` in `spawnEntity` (`ecs_spawner.ts`, `races/*.json`)** | `spawnEntity` callers (map generator, encounter director, summons, tests), `public/data/rulesets/dnd35e/races/*.json` | `resolveAllEquippedWeaponProfiles`, `collectEquippedItemDAGContributions`, `resolveActorAttackRoutine`, `collectOwnedEntityIds` (traverses equipped items on floor transition/limbo), Paper Doll UI | Sync modular `public/data/rulesets/dnd35e/races/<id>.json` and monolith `public/data/rulesets/dnd35e/races.json`; update `dnd35e_validator.ts` to verify `defaultEquipment` item IDs exist in `items` registry |
