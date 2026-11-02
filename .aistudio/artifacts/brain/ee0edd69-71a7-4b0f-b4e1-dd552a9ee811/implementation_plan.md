# Implementation Plan (Revised): Unified Races/Bestiary, RHD Tracks, Universal Effect Bundles & Modular Registries

## 0. Direct Responses to Review Comments & Design Revisions

### 1. Reusing `DnD35EffectBundleSchema` Across Feats, Class Features, Domains, Racial Traits & Types (Passive vs. Active vs. Structural Grants)
Yes! Making `DnD35EffectBundleSchema` the **universal mechanical payload** across **Feats (`feats/`)**, **Class Features & ACFs (`classes/`)**, **Domain Granted Powers (`domains/`)**, **Racial Traits (`races/`)**, **Creature Types & Subtypes (`creature_types/`, `subtypes/`)**, and **Templates (`templates/`)** significantly simplifies and strengthens the architecture.

Recognizing that some effects are **passive**, some **grant feats or skills** (sometimes bypassing prerequisites or shutting off in medium/heavy armor), and others are **actively triggered or toggled** changes the design of `DnD35EffectBundleSchema` in four clean ways:

1. **Bundle Activation & Suppression Envelope (`activationCondition`, `actionType`, `usageMode`):**
   - Every bundle has an `actionType` (`'Origin' | 'Passive' | 'Free' | 'Swift' | 'Immediate' | 'Move' | 'Standard' | 'FullRound' | 'Reaction'`) and `usageMode`:
     - `'passive'`: Always active as long as `activationCondition` (e.g. `selfTagsNone: ['armor:medium', 'armor:heavy']`) holds and the bundle ID is not in `suppressedBundleIds`.
     - `'toggle'` / `'variable_dial'`: Tactical stance or dial (e.g. *Power Attack*, *Combat Expertise*, *Fighting Defensively*).
     - `'activated'`: Costs an action and/or uses from a `resourcePool` or cooldown (e.g. *Barbarian Rage*, *Turn Undead*, *Smite Evil*, *Strength Domain* feat of strength, Dragon *Breath Weapon* with `1d4` round recharge).
     - `'spell_like'`: Casts a spell from `spells/<id>.json` at-will or $N/\text{day}$ (e.g. Gnome or Demon racial SLAs).
     - `'triggered'`: Fires on a combat event hook (e.g. *Cleave* on dropping a target, *Improved Trip* follow-up attack on successful trip).
2. **Passive Modifiers & Rule Overrides (`modifiers`, `ruleOverrides`):**
   - Evaluated continuously in the 4-stage Stat DAG whenever the bundle is active.
   - `ruleOverrides` declaratively toggle baseline combat flags (e.g. `provokesAoO: false` for *Improved Grapple/Trip/Sunder*, `retainDexWhenFlatFooted: true` for *Uncanny Dodge*, `reflexSaveZeroDamageOnSuccess: true` for *Evasion*).
3. **Structural Grants (`grantedFeats`, `virtualFeatGrants`, `bonusFeatChoice`, `classSkills`, `proficiencies`, `grantedSenses`):**
   - **Direct vs. Virtual Feat Grants:** In D&D 3.5e, some bundles grant a feat permanently (e.g. *War Domain* granting `weapon_focus`), while others grant a **virtual feat** (`ignorePrerequisites: true`, e.g. Ranger's *Combat Style* granting `two_weapon_fighting` at level 2 without requiring `Dex 15`, gated on the bundle's `activationCondition: { selfTagsNone: ['armor:medium', 'armor:heavy'] }`). Because the virtual feat lives inside the parent `DnD35EffectBundle`, putting on heavy armor or trading away the bundle via an ACF automatically suppresses the granted feat!
4. **Resource Pools & Nested Sub-Bundles (`resourcePool`, `childBundles`):**
   - Bundles that have daily/encounter charges (e.g. *Rage*, *Bardic Music*, *Turn Undead*, *Stunning Fist*, *Luck Domain* reroll) declare their `resourcePool` (`maxBase`, `perLevel`, `abilityModStat`, `refreshCycle`, or `rechargeDice`) directly on the bundle.
   - All effects emitted by a bundle (including its granted feats, skills, modifiers, and resource pools) share the hierarchical provenance path `"<provider>:<id>/bundle:<bundleId>/..."`, so trading or suppressing `bundleId` (e.g. *Ordained Champion* trading a Cleric Domain's `grantedPowerBundle` for a Fighter bonus feat) cleanly suppresses the entire bundle as an atomic unit while leaving the Domain's spell list untouched.

---

### 2. Creature-Specific Size-Gated Natural Weapons (Not Global to `wings` / `tail_slap`)
- `wings` and `tail_slap` are **never** globally gated by size. A Medium creature whose racial `naturalWeapons` lists a `tail_slap` or `wings` has those attacks immediately at Medium.
- Unlocking new natural weapons as a creature advances (such as True Dragons gaining `wings` at Medium+, `tail_slap` at Large+, `crush` at Huge+, and `tail_sweep` at Gargantuan+) is modeled on that specific creature's `rhdProgression.tiers` (`unlockedNaturalWeapons`).

---

### 3. What `isNpcClass: boolean` Entails in D&D 3.5e Rules
1. **Challenge Rating (CR) Scaling:** Pure NPC-class actors have $\text{CR} = 1/2$ at level 1 and $\text{CR} = \text{Level} - 1$ at levels $\ge 2$ (whereas PC classes have $\text{CR} = \text{Level}$). On monsters with RHD, NPC class levels always count as nonassociated ($+1/2\text{ CR}$ per level).
2. **Default Ability Score Array & 1st-HD Hit Points:** Actors with only NPC class levels use the **Nonelite Array** ($13, 12, 11, 10, 9, 8$) and average HP on their 1st HD, whereas PC/Prestige classes use the **Elite Array** ($15, 14, 13, 12, 10, 8$) and maximum HP on their 1st HD.
3. **1-HD Humanoid Replacement Rule:** Creatures with $0\text{ RHD}$ of the `humanoid` type replace their single Racial HD with their 1st class level (`warrior` 1 by default for baseline monster encounters).
4. **Template Class-HD Stripping (*Skeleton* & *Zombie*):** Templates with `stripClassLevels: true` strip all `'pc'`, `'npc'`, and `'prestige'` class tracks while retaining `'racial_hd'` tracks (converting a 0-RHD humanoid into $1\text{ d12}$ Undead RHD).

---

### 4. Separating Biological Race Chassis from RHD Progression (`rhdProgression`)
Every creature in `races/<id>.json` separates:
1. **Race Chassis (Biological / Species Identity):** `creatureType`, `subtypes`, `size`, `baseLandSpeedFt`, `movementModes`, `abilityAdjustments`, `naturalArmorBonus`, innate `naturalWeapons`, `senses`, `traitBundles`, `favoredClass`, `levelAdjustment`, and `defaultClassLevels`.
2. **RHD Progression (`rhdProgression` — Analogous to a Class):** `baseHdCount` (`0` for 1-HD humanoids; $\ge 1$ for monsters with true RHD), `saveCurveOverrides`, `advancementRanges`, and optional `tiers` (Dragon 12 age categories or Elemental 6 size steps). The RHD track's `hitDieSides`, `babCurve`, `fortCurve`, `refCurve`, `willCurve`, and `skillPointsPerLevel` are inherited from `creature_types/<creatureType>.json`.

---

## 1. Architectural Principles & `AGENTS.md` Alignment

- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any`, `exactOptionalPropertyTypes: true`, explicit return types, exhaustive switches, and all gameplay numbers in JSON registries or named constants.
- **Rule 15 (Three-Axis Cascading Effects Mapping):** Mapped across **Upstream**, **Downstream**, and **Lateral** consumers below.
- **Rule 16 (Three-Tier Placement Heuristic):**
  - *Tier 1 (Core Console):* Multi-file JSON descriptor merging (`loader.ts`) and hierarchical `sourcePath` provenance indexing/revocation (`effect_provider.ts`).
  - *Tier 2 (Ruleset Cartridge `src/rulesets/dnd35e/`):* RHD track derivation from Creature Type, Universal Effect Bundle evaluation & suppression (`evaluateEffectBundle`), 1-HD Humanoid class replacement, SRD Size/RHD Advancement, and 4-Stage Stat DAG.
  - *Tier 3 (System Content `public/data/rulesets/dnd35e/`):* Modular JSON files in `races/`, `classes/`, `creature_types/`, `subtypes/`, `domains/`, `skills/`, `feats/`, `spells/`, `templates/`.
- **Rule 18 (Universal Actor Symmetry & Composable Diffs):** Retire separate `archetypes/` and `dragon_families.json`. Every creature is defined in `races/<id>.json` with a Race Chassis + `rhdProgression` + Class Tracks + Templates.
- **Rule 19 (Unified Effect Providers & Hierarchical Provenance `sourcePath`):** Feats, Class Features, Domains, Races, Creature Types, Subtypes, Skills, and Templates emit mechanical effects through `DnD35EffectBundle` objects with deterministic `sourcePath` prefixes.

---

## 2. Three-Axis Cascading Effects Matrix (`Rule 15`)

| Change | Upstream (Callers / Producers / Data) | Downstream (Consumers / Resolvers / Validators) | Lateral (Campaigns / Tests / CLI / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Introduce Universal `DnD35EffectBundleSchema` (Passive, Active, Virtual Feat Grants, Resource Pools & `suppressedBundleIds`)** | `dnd35e_system.types.ts`, `feats/<id>.json` (`effectBundle`), `domains/<id>.json` (`grantedPowerBundle`), `races/<id>.json` (`traitBundles`), `creature_types/<id>.json` (`traitBundles`), `subtypes/<id>.json` (`traitBundles`), `classes/<id>.json` (`featureDetails`) | `srd_registry.ts` (`evaluateEffectBundle`, `buildCreatureTypeAndSubtypeModifiers`), `races.ts`, `character_builder.ts`, `dnd35e_validator.ts` | `tests/dnd35e_phase22_bestiary.test.ts`, `tests/dnd35e_classes_builder.test.ts` (test trading/suppressing a Domain `grantedPowerBundle` and virtual feat armor-gating) |
| **2. Modularize `creature_types/` (15 files) & Add `subtypes/` (20 files)** | `public/data/rulesets/dnd35e/creature_types/*.json`, `public/data/rulesets/dnd35e/subtypes/*.json`, `system_content_files.ts` | `DnD35CreatureTypeEngineSchema`, `DnD35SubtypeDefinitionSchema`, `srd_registry.ts`, `dnd35e_validator.ts` | `scripts/run-validator.ts`, `tests/ruleset_validators.test.ts`, `tests/dnd35e_phase22_bestiary.test.ts` |
| **3. Modularize `domains/` (22 files with `grantedPowerBundle`) & `skills/` (12 files with `actions` & `rankThresholdModifiers`)** | `public/data/rulesets/dnd35e/domains/*.json`, `public/data/rulesets/dnd35e/skills/*.json`, `system_content_files.ts` | `DnD35DomainDefinitionSchema`, `DnD35SkillDefinitionSchema`, `skills.ts` (`buildSkillRankEffectModifiers`), `character_builder.ts`, `dnd35e_validator.ts` | `scripts/run-validator.ts`, `tests/dnd35e_classes_builder.test.ts`, `tests/ruleset_validators.test.ts` |
| **4. Add 5 SRD NPC Classes (`warrior`, `expert`, `adept`, `aristocrat`, `commoner`) & `isNpcClass` Rules** | `public/data/rulesets/dnd35e/classes/{warrior,expert,adept,aristocrat,commoner}.json`, `system_content_files.ts` | `DnD35ClassDefinitionSchema` (`isNpcClass`), `character_builder.ts`, `templates.ts` (Skeleton/Zombie class-HD stripping & CR scaling) | `tests/dnd35e_cartridge.test.ts` (`classes` count `21 -> 26`), `tests/dnd35e_classes_builder.test.ts` |
| **5. Unify `archetypes/` & `dragon_families.json` into `races/<id>.json` with Separate Race Chassis & `rhdProgression`** | Delete `archetypes/`, `archetypes.json`, and `dragon_families.json`; migrate all Bestiary species, 10 True Dragons (`dragon_red`..`dragon_brass`), and 4 Elementals (`elemental_air`..`elemental_water`) into `races/<id>.json`; update `system_content_files.ts` | `DnD35RaceDefinitionSchema` (Race Chassis + `rhdProgression`), `races.ts`, `family_synthesizer.ts`, `srd_registry.ts` (`getDnD35Race`, `getDnD35Archetype`, `getDnD35EntityData`), `dnd35e_validator.ts` | `public/data/campaigns/dnd35e-crypt/entities.json`, `tests/dnd35e_phase22_bestiary.test.ts`, `tests/dnd35e_cartridge.test.ts`, `tests/ruleset_validators.test.ts`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` |

---

## 3. Step-by-Step Implementation Plan & Code Diffs

### Step 1: Universal `DnD35EffectBundleSchema`, `rhdProgression` & Unified Race Schema (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`)

1. **Define Universal `DnD35EffectBundleSchema` (Supporting Passive, Active/Toggled/SLA, Structural Grants & Child Bundles):**

```typescript
/** Zod schema for a virtual or direct feat grant inside an Effect Bundle. */
export const DnD35FeatGrantDescriptorSchema = z.object({
  featId: z.string(),
  ignorePrerequisites: z.boolean().default(true)
});
export type DnD35FeatGrantDescriptor = z.infer<typeof DnD35FeatGrantDescriptorSchema>;

/** Zod schema for an activated, toggled, triggered, or spell-like ability inside an Effect Bundle. */
export const DnD35ActivatedAbilityDescriptorSchema = z.object({
  id: z.string(),
  name: z.string(),
  usageMode: z.enum(['activated', 'toggle', 'variable_dial', 'spell_like', 'triggered']).default('activated'),
  actionCost: z
    .enum(['free', 'swift', 'immediate', 'move', 'standard', 'full_round', 'attack_action', 'reaction', 'none'])
    .default('standard'),
  spellId: z.string().optional(),
  usesPerDay: z.union([z.number().int().positive(), z.literal('at_will')]).optional(),
  rechargeRoundsDice: z.string().optional(),
  durationRoundsFormula: z.string().optional(),
  activeModifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  triggerEvent: z.string().optional()
});
export type DnD35ActivatedAbilityDescriptor = z.infer<typeof DnD35ActivatedAbilityDescriptorSchema>;

/** Zod schema for a universal, named Effect & Rule Bundle reusable across Feats, Class Features, Domains, Races, Creature Types, Subtypes, and Templates. */
export const DnD35EffectBundleSchema = z.object({
  id: z.string(),
  name: z.string(),
  bundleKind: z
    .enum([
      'feat_benefit',
      'domain_granted_power',
      'racial_trait',
      'class_feature',
      'creature_type_trait',
      'subtype_trait',
      'template_special_quality'
    ])
    .default('racial_trait'),
  category: z.enum(['ex', 'su', 'sp', 'na', 'bonus_feat', 'proficiency']).default('ex'),
  usageMode: z.enum(['passive', 'activated', 'toggle', 'variable_dial', 'spell_like', 'triggered']).default('passive'),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  activationCondition: z
    .object({
      selfTagsAll: z.array(z.string()).optional(),
      selfTagsAny: z.array(z.string()).optional(),
      selfTagsNone: z.array(z.string()).optional()
    })
    .optional(),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  ruleOverrides: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).default({}),
  grantedTraits: z.array(z.string()).default([]),
  grantedFeats: z.array(z.string()).default([]),
  virtualFeatGrants: z.array(DnD35FeatGrantDescriptorSchema).default([]),
  bonusFeatPool: z.array(z.string()).optional(),
  grantedSenses: DnD35SensoryProfileSchema.optional(),
  classSkills: z.array(z.string()).default([]),
  immunities: z.array(z.string()).default([]),
  vulnerabilities: z.array(z.string()).default([]),
  damageReduction: DnD35DamageReductionSchema.optional(),
  spellResistance: z.number().int().nonnegative().optional(),
  resourcePool: z
    .object({
      poolId: z.string(),
      maxBase: z.number().int().nonnegative(),
      perLevel: z.number().nonnegative().optional(),
      abilityModStat: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
      refreshCycle: z.enum(['round', 'encounter', 'short_rest', 'rest_8h']).default('rest_8h')
    })
    .optional(),
  activatedAbilities: z.array(DnD35ActivatedAbilityDescriptorSchema).default([])
});
export type DnD35EffectBundle = z.infer<typeof DnD35EffectBundleSchema>;
```

2. **Connect `DnD35EffectBundleSchema` Across All Providers:**
   - **Feats (`DnD35FeatDefinitionSchema`):** Add optional `effectBundle: DnD35EffectBundleSchema.optional()` (alongside `modifiers`, `ruleOverrides`, and `activatedAbilities`) so any feat's benefit can be evaluated as a standard `DnD35EffectBundle` with `sourcePath: "feat:<featId>/..."`!
   - **Domains (`DnD35DomainDefinitionSchema`):** Add `grantedPowerBundle: DnD35EffectBundleSchema.optional()` so a Cleric Domain's granted power (`id: "domain_power:<domainId>"`) is a named bundle containing its `classSkills`, `grantedFeats`, `modifiers`, `resourcePool`, and `activatedAbilities`, which can be traded away as a single unit via `suppressedBundleIds: ["domain_power:<domainId>"]` while keeping `domainSpells`.
   - **Class Features (`DnD35ClassFeatureDetailSchema`):** Embed or align with `DnD35EffectBundleSchema` (`virtualFeatGrants`, `activationCondition`, `activatedAbilities`, `ruleOverrides`, `modifiers`, `resourcePool`, `bonusFeatPool`), so e.g. Ranger's *Combat Style* can grant a virtual feat (`two_weapon_fighting` or `rapid_shot`, `ignorePrerequisites: true`) conditioned on `selfTagsNone: ['armor:medium', 'armor:heavy']`.
   - **Races, Creature Types, Subtypes, and RHD Tiers:** Add `traitBundles: z.array(DnD35EffectBundleSchema).default([])`.

3. **Separate Race Chassis vs. `rhdProgression` (`DnD35RhdProgressionSchema` & `DnD35ProgressionTierSchema`):**
   - `DnD35RhdProgressionSchema` holds `baseHdCount` (`0` for 1-HD humanoids; $\ge 1$ for monsters with RHD), `saveCurveOverrides`, `advancementRanges`, and optional `tiers` (Dragon 12 age categories or Elemental 6 size steps, including `unlockedNaturalWeapons` and `grantedBundles`).

---

### Step 2: Modularize `creature_types/`, `subtypes/`, `domains/`, and `skills/` in `public/data/rulesets/dnd35e/`

1. **`creature_types/<id>.json` (15 files + `{}` root `creature_types.json`):**
   - Separates **RHD Class Progression** (`hitDieSides`, `babCurve`, `fortCurve`, `refCurve`, `willCurve`, `goodSaveBySubtype`, `skillPointsPerLevel`) from **Creature Type Traits & Bundles** (`nonabilities`, `immunities`, `weaponProficiencies`, `armorProficiencies`, `physiology`, `defaultTraits`, `traitBundles`).
2. **`subtypes/<id>.json` (20 files + `{}` root `subtypes.json`):**
   - Modular files for `air`, `angel`, `aquatic`, `archon`, `augmented`, `chaotic`, `cold`, `earth`, `evil`, `extraplanar`, `fire`, `goblinoid`, `good`, `incorporeal`, `lawful`, `native`, `reptilian`, `shapechanger`, `swarm`, `water` with `retainsOriginalTypeFeatures`, `immunities`, `vulnerabilities`, `drBypassTags`, `grantedTraits`, `modifiers`, `traitBundles`, and `swarmRules`.
3. **`domains/<id>.json` (22 files + `{}` root `domains.json`):**
   - Split all 22 Cleric Domains into `public/data/rulesets/dnd35e/domains/<id>.json`, each featuring a named `grantedPowerBundle` (`id: "domain_power:<id>"`, `bundleKind: "domain_granted_power"`).
4. **`skills/<id>.json` (12 files + `{}` root `skills.json`):**
   - Split all 12 skills into `public/data/rulesets/dnd35e/skills/<id>.json` with declarative `actions` and `rankThresholdModifiers`.

---

### Step 3: Add the 5 SRD NPC Classes (`public/data/rulesets/dnd35e/classes/<id>.json`)

Create 5 modular 20-level class files in `public/data/rulesets/dnd35e/classes/` with `isNpcClass: true`:
1. `warrior.json`: `d8` HD, `full` BAB, Good `fort` / Poor `ref` & `will`, `2` skill points/level, simple & martial weapons + all armor & shields.
2. `expert.json`: `d6` HD, `three_quarters` BAB, Good `will` / Poor `fort` & `ref`, `6` skill points/level, simple weapons + light armor.
3. `adept.json`: `d6` HD, `half` BAB, Good `will` / Poor `fort` & `ref`, `2` skill points/level, prepared divine spellcasting (`wis`, levels 0..5 spell slots across levels 1..20), `summon_familiar` feature bundle at level 2.
4. `aristocrat.json`: `d8` HD, `three_quarters` BAB, Good `will` / Poor `fort` & `ref`, `4` skill points/level, simple & martial weapons + all armor & shields.
5. `commoner.json`: `d4` HD, `half` BAB, Poor `fort`, `ref`, & `will`, `2` skill points/level, proficiency with one simple weapon.

---

### Step 4: Merge `archetypes/` and `dragon_families.json` into Unified `races/<id>.json`

1. **Delete `public/data/rulesets/dnd35e/dragon_families.json`, `public/data/rulesets/dnd35e/archetypes.json`, and `public/data/rulesets/dnd35e/archetypes/*.json`.**
2. **Migrate all playable races, monsters, 10 True Dragon varieties (`dragon_red`..`dragon_brass`), and 4 Elemental species (`elemental_air`..`elemental_water`) into `public/data/rulesets/dnd35e/races/<id>.json`:**
   - **Race Chassis** holds biological traits (`creatureType`, `subtypes`, `size`, `abilityAdjustments`, `baseLandSpeedFt`, `movementModes`, `naturalArmorBonus`, innate `naturalWeapons`, `senses`, `traitBundles`, `favoredClass`, `levelAdjustment`, `defaultClassLevels`).
   - **RHD Progression (`rhdProgression`)** holds `baseHdCount`, `saveCurveOverrides`, `advancementRanges`, and optional `tiers` (including `unlockedNaturalWeapons` on Dragon tiers).

---

### Step 5: Update Hydration, Universal Effect Bundle Evaluation, Templates & Validator Logic (`src/rulesets/dnd35e/`)

1. **`src/rulesets/dnd35e/system_content_files.ts`:**
   - Register modular descriptors for `races/*.json`, `classes/*.json` (26 classes), `creature_types/*.json` (15 files), `subtypes/*.json` (20 files), `domains/*.json` (22 files), `skills/*.json` (12 files), `feats/*.json`, `spells/*.json`, and `templates/*.json`.
2. **`src/rulesets/dnd35e/srd_registry.ts` & `src/rulesets/dnd35e/races.ts`:**
   - Implement `evaluateEffectBundle(bundle, sourcePrefix, activeSelfTags, suppressedBundleIds)` returning `{ modifiers, grantedTraits, grantedFeats, virtualFeatGrants, classSkills, resourcePools, activatedAbilities, ruleOverrides }`:
     - Skips the bundle if `bundle.id` is in `suppressedBundleIds` or if `bundle.activationCondition` is not satisfied by `activeSelfTags`.
     - Stamps every emitted `StatModifier` with `sourcePath: "${sourcePrefix}/bundle:${bundle.id}/${mod.id}"`.
   - Derive RHD tracks from `race.rhdProgression.baseHdCount` + `creatureTypes[race.creatureType]` (or `race.defaultClassLevels` when `baseHdCount === 0` and no explicit PC class levels are supplied).
3. **`src/rulesets/dnd35e/character_builder.ts`:**
   - Evaluate Domain `grantedPowerBundle`, Race `traitBundles`, Class Feature `effectBundle`s, and Feat `effectBundle`s through `evaluateEffectBundle`, honoring `suppressedBundleIds` and `activationCondition` (e.g. Ordained Champion trading `domain_power:war` for a bonus Fighter feat, or virtual feats from class features respecting armor restrictions).
4. **`src/rulesets/dnd35e/templates.ts`:**
   - Strip class tracks (`pc`, `npc`, `prestige`) while keeping `racial_hd` tracks on `stripClassLevels: true` templates (*Skeleton*, *Zombie*), and respect `subtype:augmented` (`retainsOriginalTypeFeatures: true`).
5. **`src/rulesets/dnd35e/dnd35e_validator.ts`:**
   - Validate `sys.subtypes` ID parity, cross-check `race.subtypes` and `template.addSubtypes` against `sys.subtypes`, cross-check `race.defaultClassLevels` against `sys.classes`, and validate campaign `entity.archetypeId` against `getDnD35Archetype(sys, entity.archetypeId)`.

---

### Step 6: Update Tests & Documentation

1. **`tests/dnd35e_phase22_bestiary.test.ts`:**
   - Test unified `races/` hydration (playable races, 0-RHD humanoids with `warrior` 1 vs PC class 1, multi-RHD monsters, True Dragon age tiers with Dragon-specific tier-unlocked natural weapons, and Elemental tiers).
2. **`tests/dnd35e_classes_builder.test.ts` & `tests/dnd35e_cartridge.test.ts`:**
   - Test all 26 classes (11 PC + 5 NPC + 10 Prestige), modular `domains/` with `grantedPowerBundle` suppression/trading (Ordained Champion pattern), virtual feat grants with armor `activationCondition`, and modular `skills/`.
3. **`tests/ruleset_validators.test.ts`:**
   - Test `validateDnD35eSystemContentIntegrity` for `subtypes` and `defaultClassLevels`.
4. **`docs/ARCHITECTURE.md` & `docs/DECISIONS.md`:**
   - Document the Universal `DnD35EffectBundle` anatomy (Passive, Active/Toggled/SLA, Structural & Virtual Feat Grants, Child Bundles), Race Chassis vs. RHD Progression, Class/Track categories, and modular registries.
