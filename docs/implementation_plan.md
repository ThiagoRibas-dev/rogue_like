# Implementation Plan — Phase 30: Universal Actor Symmetry, Unified Race/Archetype Hydration & Real Monster Armament Equipping (Milestones 129 & 130)

## 1. Architectural Overview & Goals
In accordance with **AGENTS.md Rule 18** (*Universal Actor Symmetry & Composable Diffs*), **Rule 16** (*Three-Tier Placement Heuristic*), and **Rule 19** (*Unified Effect Providers & Hierarchical Provenance*), Phase 30 eliminates the remaining structural asymmetries between Player Characters, NPCs, and Bestiary Creatures across two milestones:

1. **Milestone 129 — Unified Race & Actor Hydration Pipeline, Class Ledger Parity & Legacy Schema Eviction**:
   - Unify `applyRaceToActorChassis` (`src/rulesets/dnd35e/races.ts`) and `hydrateRaceAsArchetype` / `hydrateArchetypeData` (`src/rulesets/dnd35e/archetype/race_hydrator.ts`, `src/rulesets/dnd35e/archetype_resolver.ts`) so both player and non-player hydration paths evaluate 100% of racial mechanics (`traitBundles`, `conditionalModifiers`, `saveBonuses`, `spellResistanceFormula`, `buildCreatureTypeAndSubtypeModifiers`, and `goodSaveBySubtype`).
   - Evaluate `collectActiveClassFeaturesAndPools`, `buildClassAndDomainEffectModifiers`, and `collectActiveGrantedAndVirtualFeats` when hydrating non-player actors with `defaultClassLevels` or `options.classLevels`.
   - Evict legacy underscore feat prefix fallbacks (`KNOWN_PARAMETERIZED_FEAT_PREFIXES`), duplicate `hasImprovedCrit` injection in `weapon_profile_parser.ts`, dead `DnD35DragonFamiliesData` synthesis branches, and the duplicate singular `energyResistance` schema key on `DnD35TemplateSchema`.
2. **Milestone 130 — Anatomical Equipment Slot Auto-Initialization & Declarative Monster/NPC Armament Loadouts**:
   - Wire `buildAnatomyEquipmentSlots(bodyPlan)` into `spawnEntity` (`src/core/ecs/ecs_spawner.ts`) so every spawned Actor receives anatomical `EquipmentComponent` slots with linked `limbGroupId`s (`humanoid_biped`, `quadruped`, `marilith_6arm`, `avian`, `serpentine`) and an `InventoryComponent`.
   - Add `defaultEquipment` (`ReadonlyArray<{ itemId: string; equipSlot?: string }>`) to `DnD35RaceDefinitionSchema` and `DnD35ArchetypeSchema`, populate SRD armaments across armed bestiary races (`orc`, `goblin`, `hobgoblin`, `kobold`, `bugbear`, `gnoll`, `ogre`, `hill_giant`, `stone_giant`, `frost_giant`, `fire_giant`, `ettin`, `minotaur`, `balor`, `marilith`, `skeleton`), add missing natural weapons (`skeleton` claw, `zombie` slam, `manticore` spikes), and auto-equip `defaultEquipment` on non-player actor spawn.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner (SSOT) | Old-Brain / Duplicate Code to Evict |
| :--- | :--- | :--- |
| Racial trait bundle, conditional modifier, save bonus, SR formula & creatureType/subtype modifier evaluation | `evaluateRacialModifiersAndSenses` in `src/rulesets/dnd35e/races.ts` shared by `applyRaceToActorChassis` and `hydrateArchetypeData` | Split evaluation between `races.ts` and `race_hydrator.ts` / `archetype_resolver.ts` |
| Parameterized feat ID parsing (`baseFeatId:targetId`) | `parseParameterizedFeatId` in `src/rulesets/dnd35e/effect_bundle.ts` | `KNOWN_PARAMETERIZED_FEAT_PREFIXES` underscore fallback in `effect_bundle.ts` |
| Critical threat range expansion (`'threat_expansion'`) | `buildFeatEffectModifiers` (`ledger_modifiers.ts`) + `resolveActorAttackRoutine` (`attack_routine.ts`) | Duplicate `hasImprovedCrit` injection in `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` |
| True Dragon & Elemental tier synthesis | `synthesizeDragonFromRaceTier` & `synthesizeElementalFromRaceTier` (`src/rulesets/dnd35e/families/`) | Legacy `DnD35DragonFamiliesData` fallback branches and `DnD35DragonFamiliesDataSchema` |
| Template energy resistance schema key | `energyResistances` in `DnD35TemplateSchema` & `DnD35TemplateHdTierSchema` | Duplicate singular `energyResistance` field on `DnD35TemplateSchema` & `DnD35TemplateHdTierSchema` |
| Actor anatomical slot topology & default armament equipping | `buildAnatomyEquipmentSlots` (`src/systems/inventory/equipment_slots.ts`) + `spawnEntity` (`src/core/ecs/ecs_spawner.ts`) | Unwired `buildAnatomyEquipmentSlots` and unequipped armed monsters falling back to `1d3` unarmed strikes |

---

## 3. Cascading Effects Matrix (AGENTS.md Rule 15)

| Change | Upstream (Callers, Data Authors, Fixtures) | Downstream (Resolvers, Validators, Renderers, Save Schemas) | Lateral (Sibling JSONs, Bundled Monoliths, SSOT Docs) |
| :--- | :--- | :--- | :--- |
| **1. Unify Race & Class Hydration (`races.ts`, `race_hydrator.ts`, `archetype_resolver.ts`)** | `applyCharacterCreationToPlayer`, `getDnD35EntityData`, `syncActorCompanionsAndFamiliars`, `tests/dnd35e_phase22_bestiary.test.ts` | `evaluateDnD35eEntityDAG` receives complete racial `traitBundles`, `conditionalModifiers`, `saveBonuses`, `spellResistance`, and class feature modifiers for both PCs and NPCs/monsters | `builder_hydrator_creation.ts` filters out default Warrior feats when `raceDef.defaultClassLevels.length > 0` so PCs don't inherit Monster Manual Warrior feats |
| **2. Evict `KNOWN_PARAMETERIZED_FEAT_PREFIXES`, duplicate `hasImprovedCrit`, `DnD35DragonFamiliesData`, & template `energyResistance`** | `parseParameterizedFeatId`, `parseEquippedItem`, `synthesizeTrueDragonArchetype`, `synthesizeElementalArchetype`, `applyCreatureTemplate` | `evaluateDnD35eEntityDAG` & `resolveActorAttackRoutine` resolve `improved_critical:<weapon>` via `buildFeatEffectModifiers`; `dnd35e_validator.ts` validates templates using `energyResistances` | Update any unit tests calling `parseEquippedItem` directly without `buildFeatEffectModifiers` (`tests/dnd35e_equipment_m115.test.ts`) |
| **3. Auto-Initialize Anatomical `EquipmentComponent` & `defaultEquipment` in `spawnEntity` (`ecs_spawner.ts`, `races/*.json`)** | `spawnEntity` callers (map generator, encounter director, summons, tests), `public/data/rulesets/dnd35e/races/*.json` | `resolveAllEquippedWeaponProfiles`, `collectEquippedItemDAGContributions`, `resolveActorAttackRoutine`, `collectOwnedEntityIds` (traverses equipped items on floor transition/limbo), Paper Doll UI | Sync modular `public/data/rulesets/dnd35e/races/<id>.json` and monolith `public/data/rulesets/dnd35e/races.json`; update `dnd35e_validator.ts` to verify `defaultEquipment` item IDs exist in `items` registry |

---

## 4. Step-by-Step Implementation Plan & Code Snippets

### Step 1 (M129.1): Unify Race Hydration & Class Feature Evaluation (`src/rulesets/dnd35e/races.ts`, `src/rulesets/dnd35e/archetype/race_hydrator.ts`, `src/rulesets/dnd35e/archetype_resolver.ts`)

1. In `src/rulesets/dnd35e/races.ts`:
   - Extract a shared helper `evaluateRacialModifiers(race: DnD35RaceDefinition, suppressedBundles?: ReadonlyArray<string>): { readonly statModifiers: StatModifier[]; readonly grantedTags: string[] }` that evaluates `race.traitBundles`, `race.conditionalModifiers`, and `race.saveBonuses`.
   - Update `applyRaceToActorChassis` to also check `creatureTypeEngine?.goodSaveBySubtype`, call `buildCreatureTypeAndSubtypeModifiers` when `systemContent` is available (or accept optional `systemContent`), and set `anatomyBodyPlan`.
2. In `src/rulesets/dnd35e/archetype/race_hydrator.ts` and `src/rulesets/dnd35e/archetype_resolver.ts`:
   - Pass `raceDef` traits (`evaluateRacialModifiers(raceDef)`) and `spellResistanceFormula` (`base + perHitDie * totalHd`) into `hydrateRaceAsArchetype` / `hydrateArchetypeData`.
   - In `hydrateArchetypeData`, when `systemContent` contains `classes` and the archetype has class tracks (`t.trackCategory === 'pc' || t.trackCategory === 'npc' || t.trackCategory === 'prestige'`), evaluate `collectActiveClassFeaturesAndPools`, `buildClassAndDomainEffectModifiers`, and `collectActiveGrantedAndVirtualFeats` so NPCs/monsters with class levels gain their class features, scaling pools, granted feats, and modifiers automatically:

```ts
// In src/rulesets/dnd35e/archetype_resolver.ts:
const racialEval = archetypeOrRace && !('archetypeId' in archetypeOrRace)
  ? evaluateRacialModifiers(archetypeOrRace)
  : { statModifiers: [...(archetype.statModifiers ?? [])], grantedTags: [] };
```

3. In `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`:
   - Ensure `withRace.feats` only includes true racial bonus feats (`raceDef.defaultClassLevels.length === 0 ? raceDef.feats : []`) so playable races that double as 1st-level Monster Manual Warriors (`orc`, `goblin`, `hobgoblin`, `kobold`) do not leak their Warrior 1 feat onto a newly created Player Character.

---

### Step 2 (M129.2): Evict Legacy Feat Prefixes, Duplicate `hasImprovedCrit` & Dead Schemas

1. **`src/rulesets/dnd35e/effect_bundle.ts`**:
   - Simplify `parseParameterizedFeatId(rawFeatId)` to strictly split on `':'`:
```ts
export function parseParameterizedFeatId(rawFeatId: string): {
  readonly baseFeatId: string;
  readonly targetId?: string;
} {
  const colonIdx = rawFeatId.indexOf(':');
  if (colonIdx !== -1) {
    const baseFeatId = rawFeatId.slice(0, colonIdx);
    const targetId = rawFeatId.slice(colonIdx + 1);
    return targetId.length > 0 ? { baseFeatId, targetId } : { baseFeatId };
  }
  return { baseFeatId: rawFeatId };
}
```
2. **`src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`**:
   - Remove the manual `improved_critical_${baseWeaponId}` check in `parseEquippedItem` and instead resolve `buildFeatEffectModifiers` from `dndData.feats` when `dndData.statModifiers` does not already include `feat:` modifiers (so both full DAG evaluations and isolated `parseEquippedItem` calls use the canonical `buildFeatEffectModifiers` pipeline).
3. **`src/rulesets/dnd35e/families/dragon_synthesizer.ts`, `elemental_synthesizer.ts`, `base_system.types.ts`, `dnd35e_system.types.ts`, `archetype_resolver.ts`**:
   - Remove `DnD35DragonFamiliesDataSchema` and the legacy `DnD35DragonFamiliesData` fallback code, keeping `synthesizeTrueDragonArchetype` and `synthesizeElementalArchetype` as clean wrappers over `synthesizeDragonFromRaceTier` and `synthesizeElementalFromRaceTier`.
4. **`src/rulesets/dnd35e/types/system/creature_system.types.ts` & `src/rulesets/dnd35e/templates.ts`**:
   - Remove the duplicate singular `energyResistance` field from `DnD35TemplateSchema` and `DnD35TemplateHdTierSchema`, keeping `energyResistances` as the single canonical property on template definitions.

---

### Step 3 (M130.1): Anatomical `EquipmentComponent` & `defaultEquipment` Auto-Equipping (`src/core/ecs/ecs_spawner.ts`, `src/systems/inventory/equipment_slots.ts`)

1. Add `DnD35DefaultEquipmentEntrySchema` to `src/rulesets/dnd35e/types/system/creature_system.types.ts`:
```ts
export const DnD35DefaultEquipmentEntrySchema = z.object({
  itemId: z.string(),
  equipSlot: z.string().optional()
});
export type DnD35DefaultEquipmentEntry = z.infer<typeof DnD35DefaultEquipmentEntrySchema>;
```
   - Add `defaultEquipment: z.array(DnD35DefaultEquipmentEntrySchema).default([])` to `DnD35RaceDefinitionSchema` and `DnD35ArchetypeSchema`.
2. Update `spawnEntity` in `src/core/ecs/ecs_spawner.ts`:
   - When `template.isActor` is true:
     - Resolve the actor's `anatomyBodyPlan` from `races[archetypeKey]?.anatomyBodyPlan ?? 'humanoid_biped'`.
     - If `template.equipmentSlots` is provided, link the first two hand/arm slots to `arm_group_1` and `arm_group_2` (or use `buildAnatomyEquipmentSlots(bodyPlan)` when `template.equipmentSlots` is omitted) so every Actor in the game has a valid `EquipmentComponent` with `limbGroupId` links.
     - Ensure an `InventoryComponent` is present on actors that receive `defaultEquipment` or `staticInventory`.
     - If `templateId !== 'player'` and the actor's resolved race/archetype defines `defaultEquipment`, spawn and equip those items into the actor's `EquipmentComponent.slots` (matching `main_hand`, `off_hand`, `torso`/`body`, etc.).

---

### Step 4 (M130.2): Populate `defaultEquipment` & Missing Natural Weapons Across SRD Bestiary (`public/data/rulesets/dnd35e/races/*.json` & `races.json`)

1. Populate `defaultEquipment` on armed SRD races in `public/data/rulesets/dnd35e/races/<id>.json` (and sync `public/data/rulesets/dnd35e/races.json`):
   - `orc.json`: `[{ "itemId": "greataxe", "equipSlot": "main_hand" }, { "itemId": "studded_leather", "equipSlot": "torso" }]`
   - `goblin.json`: `[{ "itemId": "morningstar", "equipSlot": "main_hand" }, { "itemId": "leather_armor", "equipSlot": "torso" }, { "itemId": "light_wooden_shield", "equipSlot": "off_hand" }]`
   - `hobgoblin.json`: `[{ "itemId": "longsword", "equipSlot": "main_hand" }, { "itemId": "studded_leather", "equipSlot": "torso" }, { "itemId": "light_steel_shield", "equipSlot": "off_hand" }]`
   - `kobold.json`: `[{ "itemId": "spear", "equipSlot": "main_hand" }, { "itemId": "leather_armor", "equipSlot": "torso" }]`
   - `bugbear.json`: `[{ "itemId": "morningstar", "equipSlot": "main_hand" }, { "itemId": "leather_armor", "equipSlot": "torso" }, { "itemId": "light_wooden_shield", "equipSlot": "off_hand" }]`
   - `gnoll.json`: `[{ "itemId": "battleaxe", "equipSlot": "main_hand" }, { "itemId": "leather_armor", "equipSlot": "torso" }, { "itemId": "heavy_steel_shield", "equipSlot": "off_hand" }]`
   - `ogre.json`: `[{ "itemId": "greatclub", "equipSlot": "main_hand" }, { "itemId": "hide_armor", "equipSlot": "torso" }]`
   - `hill_giant.json`: `[{ "itemId": "greatclub", "equipSlot": "main_hand" }, { "itemId": "hide_armor", "equipSlot": "torso" }]`
   - `stone_giant.json`: `[{ "itemId": "greatclub", "equipSlot": "main_hand" }, { "itemId": "hide_armor", "equipSlot": "torso" }]`
   - `frost_giant.json`: `[{ "itemId": "greataxe", "equipSlot": "main_hand" }, { "itemId": "chain_shirt", "equipSlot": "torso" }]`
   - `fire_giant.json`: `[{ "itemId": "greatsword", "equipSlot": "main_hand" }, { "itemId": "half_plate", "equipSlot": "torso" }]`
   - `ettin.json`: `[{ "itemId": "morningstar", "equipSlot": "main_hand" }, { "itemId": "morningstar", "equipSlot": "off_hand" }, { "itemId": "leather_armor", "equipSlot": "torso" }]`
   - `minotaur.json`: `[{ "itemId": "greataxe", "equipSlot": "main_hand" }]`
   - `balor.json`: `[{ "itemId": "longsword", "equipSlot": "main_hand" }, { "itemId": "whip", "equipSlot": "off_hand" }]`
   - `marilith.json`: 6 `longsword` entries (`1` in `main_hand`, `5` in `off_hand`).
   - `skeleton.json`: Add `claw` natural weapon (`1d4` slashing, count 2) and `defaultEquipment: [{ "itemId": "scimitar", "equipSlot": "main_hand" }, { "itemId": "heavy_steel_shield", "equipSlot": "off_hand" }]`.
   - `zombie.json`: Add `slam` natural weapon (`1d6` bludgeoning, count 1).
   - `manticore.json`: Add `spikes` natural weapon (`1d8` piercing, count 1) to `naturalWeapons` so `"weapon_focus:spikes"` targets its spikes attack.
2. Add cross-reference validation in `src/rulesets/dnd35e/dnd35e_validator.ts` verifying that every `itemId` in `race.defaultEquipment` exists in `sys.items`.

---

### Step 5: Verification & Regression Testing
1. Add dedicated unit tests verifying:
   - Unified race hydration (`hydrateArchetypeData` on `dwarf` and `drow` preserves `saveBonuses`, `conditionalModifiers`, `traitBundles`, and `spellResistanceFormula`; `applyRaceToActorChassis` on `tiefling` preserves creatureType/subtype modifiers).
   - Spawned `orc`, `bugbear`, `ogre`, and 6-armed `marilith` automatically initialize anatomical `EquipmentComponent` slots, equip their `defaultEquipment` items (`greataxe`, `morningstar`, `greatclub`, 6 `longsword`s), and receive their `+1` attack bonus from `weapon_focus:<weaponId>` in `evaluateDnD35eEntityDAG`!
2. Run `bun scripts/map-codebase.ts` and `./verify.sh` across all 8 stages (`tsc`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `bun run build`, `run-validator.ts`).
