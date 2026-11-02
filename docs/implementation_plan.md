# Phase 23 Implementation Plan: D&D 3.5e System Content Pillar 2 — Core 11 Classes, Prestige Classes, ACFs & Character Builder (Milestones 110–112)

---

## 1. Architectural Rules & Guardrails (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Three-Tier Separation & Cartridge Isolation (`AGENTS.md` Rule 16 & Decision #15):**
   - **Tier 1 (`src/core/`, `src/types/`, `src/rendering/`):** Multi-descriptor shallow-merging in `loader.ts` (`tests/helpers.ts`, `scripts/run-validator.ts`), generic `UIMode.CHAR_CREATION` and `UIMode.LEVEL_UP`, and `IntentType.OPEN_LEVEL_UP`. The `classic` ruleset (`classic_ruleset.ts` returning `[]` from `getSystemContentFiles()`) remains 100% isolated and unaffected.
   - **Tier 2 (`src/rulesets/dnd35e/`):** Pure D&D 3.5e progression math, multiclass XP penalty calculation (`progression.ts`), `alignment` and `spell_level` prerequisite AST evaluation (`prerequisites.ts`), Class/Domain/ACF Effect Provider emission with hierarchical `sourcePath`s, and pure deterministic Character Builder & Level-Up state transformers (`character_builder.ts`).
   - **Tier 3 (`public/data/rulesets/dnd35e/`):** `classes.json` + modular per-class JSON files (`classes/<classId>.json` for all 11 Base Classes and 10 Prestige Classes) + `domains.json` for all 22 SRD Cleric Domains.
2. **Unified Effect Providers & Hierarchical Provenance (`AGENTS.md` Rules 17 & 19):**
   - Class features, Cleric Domain granted powers, Wizard Specialist School bonuses, and ACFs emit declarative `StatModifier`s, `RuleOverride`s, and `ResourcePool` definitions stamped with slash-delimited `sourcePath`s (`"class:<classId>/level:<N>/feature:<featureId>"`, `"class:<classId>/level:<N>/acf:<acfId>"`, `"class:cleric/domain:<domainId>/power:<powerId>"`).
3. **Strict TypeScript & UI Hygiene (`AGENTS.md` §3, §4, §7, §8):**
   - Zero `any`, zero magic numbers, explicit return types on all functions, `exactOptionalPropertyTypes: true` compliance, pure JSON-serializable ECS components, native `document.createElement()` DOM rendering (zero `.innerHTML`), and modular files (~250 lines max per file).

---

## 2. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling JSONs / Kits / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. Multi-Descriptor Shallow Merge for `classes.json` + `classes/<classId>.json` + `domains.json` (`loader.ts`, `dnd35e_ruleset.ts`)** | `DnD35eRuleset.getSystemContentFiles()` declares `classes.json` and 21 `classes/<id>.json` files under `key: 'classes'`, plus `domains.json` under `key: 'domains'`. `classic` returns `[]` and is untouched. | `src/core/loader.ts`, `tests/helpers.ts`, and `scripts/run-validator.ts` merge descriptors sharing the same `key` into `rawSystemContent[desc.key]`. `DnD35SystemContentSchema` validates the unified `classes` and `domains` dictionaries. | `docs/MILESTONES.md`, `docs/ARCHITECTURE.md`, `docs/DND_35E_PYRAMID_ARCHITECTURE.md`, and `docs/DECISIONS.md` (already updated). `public/data/campaigns/default/` & `arena/` continue consuming `systemContent.classes` unchanged. |
| **2. Expand `DnD35ClassDefinitionSchema`, `DnD35DomainDefinitionSchema`, & `PrerequisiteNodeSchema` (`dnd35e_system.types.ts`, `prerequisites.ts`)** | Authored across `public/data/rulesets/dnd35e/classes/*.json` and `domains.json`. | `evaluatePrerequisiteAST()` in `src/rulesets/dnd35e/prerequisites.ts` evaluates `'alignment'` and `'spell_level'` nodes; `progression.ts` and `character_builder.ts` consume `featureMetadata`, `allowedAlignments`, `proficiencies`, `bonusFeatLevels`, and `domains`. | `src/rulesets/dnd35e/srd_registry.ts` exposes `getDnD35Domain()` and `getDnD35Class()`; `tests/dnd35e_classes_builder.test.ts` validates all 11 base classes, 10 PrCs, and 22 domains. |
| **3. Multiclass XP Penalty Calculator (`src/rulesets/dnd35e/progression.ts` & `dnd35e_ruleset.ts`)** | `calculateMulticlassXpMultiplier()` in `progression.ts`, invoked by `grantDnD35eXp()` in `dnd35e_ruleset.ts`. | Scales XP gained in `DnD35ActorProgressionComponent.xp` when uneven non-favored base classes differ by $\ge 2$ levels; Level-Up UI displays active XP multiplier warning. | `races.json` (`favoredClass: 'any'` on Human/Half-Elf ignores highest base class; specific `favoredClass` on other races ignores that class; Prestige Classes `isPrestige: true` are always exempt). |
| **4. Extend `DnD35ActorProgressionComponent` with `alignment`, `domains`, `arcaneSchool`, `prohibitedSchools`, `favoredEnemies`, `combatStyle` (`dnd35e.types.ts`)** | Populated by `character_builder.ts` (`applyCharacterCreationToPlayer`, `applyLevelUpToActor`) and entity hydration. | Consumed by `prerequisites.ts`, `spellcasting.ts` (Cleric domain slots, Specialist Wizard +1 school slot & prohibited schools), `progression.ts`, and `character_sheet.ui.ts`. | `save_manager.ts` serializes all plain JSON fields automatically; optional fields preserve backward compatibility with all existing test fixtures. |
| **5. Add `UIMode.CHAR_CREATION`, `UIMode.LEVEL_UP` & `IntentType.OPEN_LEVEL_UP` (`game-state.types.ts`, `intent.types.ts`, `engine.ts`, `input_handler.ts`, `presenter.ts`, `ui.ts`, `session_controller.ts`)** | `input_handler.ts` (`KeyL` or HUD click emits `OPEN_LEVEL_UP`); `session_controller.ts` opens `CHAR_CREATION` when starting a new `dnd35e` run. | `src/core/engine.ts` handles `OPEN_LEVEL_UP` in exhaustive switch; `presenter.ts` and `menus.ui.ts` coordinate `dnd35e_char_builder.ui.ts` and `dnd35e_level_up.ui.ts` modals; `index.html` adds modal containers. | Existing headless tests calling `initNewGame()` continue to start in `UIMode.EXPLORATION` with default `player_hero` stats unless the interactive wizard is triggered by `session_controller.ts` or invoked directly via `applyCharacterCreationToPlayer()`. |

---

## 3. Step-by-Step Implementation Plan & Code Snippets

### Step 1: Multi-Descriptor Shallow Merging in Loaders (`src/core/loader.ts`, `tests/helpers.ts`, `scripts/run-validator.ts`)

Update the system content loading loop in all three loader entry points so multiple descriptors sharing the same `desc.key` (such as `key: 'classes'` for `classes.json` and `classes/<classId>.json`) shallow-merge into `rawSystemContent[desc.key]`.

#### `src/core/loader.ts` (and mirrored in `tests/helpers.ts` & `scripts/run-validator.ts`)
```typescript
/**
 * Merges a loaded system content payload into the target dictionary key.
 * If both the existing entry and the incoming payload are plain objects, shallow-merges them.
 */
function mergeSystemContentEntry(
  target: Record<string, unknown>,
  key: string,
  incoming: unknown
): void {
  const existing = target[key];
  if (
    existing !== undefined &&
    existing !== null &&
    typeof existing === 'object' &&
    !Array.isArray(existing) &&
    incoming !== null &&
    typeof incoming === 'object' &&
    !Array.isArray(incoming)
  ) {
    target[key] = {
      ...(existing as Record<string, unknown>),
      ...(incoming as Record<string, unknown>)
    };
    return;
  }
  target[key] = incoming;
}
```

---

### Step 2: Expand Schemas & Types (`src/rulesets/dnd35e/types/dnd35e_system.types.ts` & `src/rulesets/dnd35e/types/dnd35e.types.ts`)

1. **Extend `PrerequisiteNodeSchema` (`dnd35e_system.types.ts`)** with `'alignment'` and `'spell_level'` nodes for Prestige Classes and alignment-restricted Base Classes:
```typescript
export const AlignmentEnumSchema = z.enum([
  'LG',
  'NG',
  'CG',
  'LN',
  'N',
  'CN',
  'LE',
  'NE',
  'CE'
]);
export type DnD35Alignment = z.infer<typeof AlignmentEnumSchema>;

// Added inside PrerequisiteNodeSchema z.discriminatedUnion('type', [...]):
z.object({
  type: z.literal('alignment'),
  allowed: z.array(AlignmentEnumSchema).readonly()
}),
z.object({
  type: z.literal('spell_level'),
  tradition: z.enum(['arcane', 'divine', 'any']).optional(),
  minSpellLevel: z.number().int().min(0).max(9)
})
```

2. **Add Structured Class Feature Metadata, Specialist Schools & Cleric Domain Schema (`dnd35e_system.types.ts`):**
```typescript
export const DnD35ClassFeatureMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['ex', 'su', 'sp', 'proficiency', 'bonus_feat', 'caster_advancement']).optional(),
  description: z.string().optional(),
  modifiers: z.array(DnD35RacialStatModifierSchema).readonly().optional(),
  resourcePool: z
    .object({
      poolId: z.string().min(1),
      maxBase: z.number().int().min(0),
      perClassLevel: z.number().optional(),
      abilityModStat: AbilityIdSchema.optional(),
      refreshCycle: z.enum(['round', 'encounter', 'short_rest', 'rest_8h'])
    })
    .optional(),
  bonusFeatPool: z.array(z.string().min(1)).readonly().optional()
});
export type DnD35ClassFeatureMetadata = z.infer<typeof DnD35ClassFeatureMetadataSchema>;

export const DnD35DomainDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  grantedPowerDescription: z.string().min(1),
  classSkillsAdded: z.array(z.string().min(1)).readonly().optional(),
  featGrants: z.array(z.string().min(1)).readonly().optional(),
  modifiers: z.array(DnD35RacialStatModifierSchema).readonly().optional(),
  resourcePool: z
    .object({
      poolId: z.string().min(1),
      maxBase: z.number().int().min(0),
      abilityModStat: AbilityIdSchema.optional(),
      refreshCycle: z.enum(['round', 'encounter', 'short_rest', 'rest_8h'])
    })
    .optional(),
  domainSpells: z.record(z.string(), z.string().min(1))
});
export type DnD35DomainDefinition = z.infer<typeof DnD35DomainDefinitionSchema>;
```
- Extend `DnD35ClassDefinitionSchema` with optional `allowedAlignments`, `proficiencies`, `bonusFeatLevels`, `featureMetadata`, `spellsKnownTable` (for Spontaneous casters like Bard, Sorcerer, Assassin), and `advancesExistingSpellcasting` (for Prestige Classes like Eldritch Knight, Loremaster, Mystic Theurge).
- Extend `DnD35SystemContentSchema` with `domains: z.record(z.string(), DnD35DomainDefinitionSchema).optional()`.
- Extend `DnD35ActorProgressionComponent` (`src/rulesets/dnd35e/types/dnd35e.types.ts`) with optional:
  - `alignment?: Alignment`
  - `domains?: ReadonlyArray<string>`
  - `arcaneSchool?: SpellSchool`
  - `prohibitedSchools?: ReadonlyArray<SpellSchool>`
  - `favoredEnemies?: ReadonlyArray<{ creatureType: string; bonus: number }>`
  - `combatStyle?: 'archery' | 'two_weapon'`

---

### Step 3: Prerequisite AST Extensions & Multiclass XP Penalty Math (`src/rulesets/dnd35e/prerequisites.ts` & `src/rulesets/dnd35e/progression.ts`)

1. **`src/rulesets/dnd35e/prerequisites.ts`:**
   - Extend `PrerequisiteActorSnapshot` with `alignment?: Alignment`, `maxArcaneSpellLevel?: number`, and `maxDivineSpellLevel?: number` (derived automatically in `buildPrerequisiteSnapshot` from `DnD35ActorProgressionComponent`, `IdentityComponent`, and `DnD35SpellcastingComponent`).
   - Handle `case 'alignment':` and `case 'spell_level':` in `evaluatePrerequisiteAST()`.

2. **`src/rulesets/dnd35e/progression.ts`:**
   - Implement `calculateMulticlassXpMultiplier(classLevels, classRegistry, favoredClass, enforcePenalty = true)`:
```typescript
/** Multiclass XP penalty per uneven non-favored base class (20% per offending class). */
export const MULTICLASS_XP_PENALTY_PER_CLASS = 0.2;

/** Minimum XP multiplier floor when multiple base classes are uneven. */
export const MIN_MULTICLASS_XP_MULTIPLIER = 0.2;

/** Maximum allowed level difference between non-favored base classes before XP penalty applies. */
export const MAX_UNPENALIZED_BASE_CLASS_GAP = 1;

/**
 * Computes the D&D 3.5e multiclass XP multiplier (1.0 = no penalty, 0.8 = -20%, etc.).
 * - Ignores all Prestige Classes (`isPrestige === true`) and Racial HD tracks.
 * - Ignores the actor's `favoredClass` (or the highest-level base class when `favoredClass === 'any'`).
 * - Applies `-0.20` for each remaining base class that is more than 1 level below the highest remaining base class.
 *
 * @param classLevels The actor's class level progression array.
 * @param classRegistry The loaded D&D 3.5e class definitions dictionary.
 * @param favoredClass The actor's racial favored class ID or `'any'` (e.g. Human / Half-Elf).
 * @param enforcePenalty Campaign rule toggle to enable/disable multiclass XP penalties.
 * @returns The XP multiplier in the range `[0.2, 1.0]`.
 */
export function calculateMulticlassXpMultiplier(
  classLevels: ReadonlyArray<{ readonly classId: string; readonly count: number }>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  favoredClass: string = 'any',
  enforcePenalty: boolean = true
): number {
  if (!enforcePenalty) {
    return 1.0;
  }

  // Filter strictly to base classes (Prestige Classes are exempt per PHB p. 60)
  const baseClassEntries = classLevels.filter((entry) => {
    if (entry.count <= 0) return false;
    const def = classRegistry[entry.classId];
    return def !== undefined && !def.isPrestige;
  });

  if (baseClassEntries.length <= 1) {
    return 1.0;
  }

  let remainingBaseClasses: ReadonlyArray<{ readonly classId: string; readonly count: number }>;
  if (favoredClass === 'any') {
    // Ignore the single highest-level base class
    let maxIdx = 0;
    for (let i = 1; i < baseClassEntries.length; i++) {
      const current = baseClassEntries[i];
      const best = baseClassEntries[maxIdx];
      if (current !== undefined && best !== undefined && current.count > best.count) {
        maxIdx = i;
      }
    }
    remainingBaseClasses = baseClassEntries.filter((_, idx) => idx !== maxIdx);
  } else {
    remainingBaseClasses = baseClassEntries.filter((entry) => entry.classId !== favoredClass);
  }

  if (remainingBaseClasses.length <= 1) {
    return 1.0;
  }

  let highestRemainingLevel = 0;
  for (const entry of remainingBaseClasses) {
    if (entry.count > highestRemainingLevel) {
      highestRemainingLevel = entry.count;
    }
  }

  let offendingClasses = 0;
  for (const entry of remainingBaseClasses) {
    if (highestRemainingLevel - entry.count > MAX_UNPENALIZED_BASE_CLASS_GAP) {
      offendingClasses += 1;
    }
  }

  if (offendingClasses === 0) {
    return 1.0;
  }

  return Math.max(
    MIN_MULTICLASS_XP_MULTIPLIER,
    Number((1.0 - offendingClasses * MULTICLASS_XP_PENALTY_PER_CLASS).toFixed(2))
  );
}
```
   - Wire `calculateMulticlassXpMultiplier` into `grantDnD35eXp()` in `src/rulesets/dnd35e/dnd35e_ruleset.ts`.

---

### Step 4: Author Modular Class & Domain Registries (`public/data/rulesets/dnd35e/classes.json`, `classes/<classId>.json` & `domains.json`)

1. **`public/data/rulesets/dnd35e/domains.json`:**
   - Author all **22 SRD Cleric Domains**: `air`, `animal`, `chaos`, `death`, `destruction`, `earth`, `evil`, `fire`, `good`, `healing`, `knowledge`, `law`, `luck`, `magic`, `plant`, `protection`, `strength`, `sun`, `travel`, `trickery`, `war`, `water`.
   - Include granted powers (e.g., `war` granting *Weapon Focus*, `travel` adding *Survival* as a class skill + freedom of movement pool, `trickery` adding *Bluff*, *Disguise*, *Hide*, `knowledge` adding all *Knowledge* skills + `+1` divination caster level, `protection` protective ward, `strength` feat of strength, `luck` good fortune reroll, `sun` greater turning) and 1st–9th level domain spells.

2. **`public/data/rulesets/dnd35e/classes.json` + 11 Base Classes (`public/data/rulesets/dnd35e/classes/<classId>.json`):**
   - `classes.json`: Base index object `{}` (merged with all `classes/<classId>.json` descriptors under `key: 'classes'`).
   - `classes/barbarian.json` (levels 1–20, `d12`, Full BAB, Good Fort, Fast Movement `+10 ft`, Illiteracy, Rage 1/day $\to$ Mighty Rage 6/day, Uncanny Dodge, Improved Uncanny Dodge, Trap Sense `+1..+6`, DR `1/-..5/-`, Indomitable Will; ACFs: `whirling_frenzy`, `lion_spirit_totem`, `wolf_totem`).
   - `classes/bard.json` (levels 1–20, `d6`, 3/4 BAB, Good Ref/Will, 6 skill pts, 0–6th spontaneous Arcane casting with `spellsPerDay` & `spellsKnownTable`, Bardic Knowledge, Bardic Music: Countersong, Fascinate, Inspire Courage `+1..+4`, Inspire Competence, Suggestion, Inspire Greatness, Song of Freedom, Inspire Heroics).
   - `classes/cleric.json` (levels 1–20, `d8`, 3/4 BAB, Good Fort/Will, 0–9th prepared Divine casting + domain slots, Aura, Spontaneous Cure/Inflict, Turn/Rebuke Undead, 2 Domains; ACF: `domain_spontaneity`).
   - `classes/druid.json` (levels 1–20, `d8`, 3/4 BAB, Good Fort/Will, 0–9th prepared Divine casting + spontaneous Summon Nature's Ally, Animal Companion, Nature Sense `+2` Knowledge Nature/Survival, Wild Empathy, Woodland Stride, Trackless Step, Resist Nature's Lure `+4` vs fey, Wild Shape 5–20, Venom Immunity, A Thousand Faces, Timeless Body).
   - `classes/fighter.json` (levels 1–20, `d10`, Full BAB, Good Fort, Fighter Bonus Feats at `1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20`).
   - `classes/monk.json` (levels 1–20, `d8`, 3/4 BAB, all Good saves, Lawful alignment, Unarmored AC Bonus `+1..+4` + WIS, Unarmed Strike scaling, Flurry of Blows, Monk Bonus Feats at 1/2/6, Evasion / Improved Evasion, Fast Movement `+10..+60 ft`, Still Mind `+2` vs enchantment, Ki Strike magic/lawful/adamantine, Slow Fall, Purity of Body, Wholeness of Body, Diamond Body, Abundant Step, Diamond Soul, Quivering Palm, Timeless Body, Empty Body, Perfect Self; ACFs: `decisive_strike`, `invisible_fist`).
   - `classes/paladin.json` (levels 1–20, `d10`, Full BAB, Good Fort, `LG` alignment, Aura of Good, Detect Evil, Smite Evil `1..5/day`, Divine Grace `+CHA` to saves, Lay on Hands, Aura of Courage, Divine Health, Turn Undead, Special Mount, Remove Disease, 1st–4th Divine spells from level 4; ACF: `charging_smite`).
   - `classes/ranger.json` (levels 1–20, `d8`, Full BAB, Good Fort/Ref, 6 skill pts, Favored Enemy `1, 5, 10, 15, 20`, Track, Wild Empathy, Combat Style `2, 6, 11`, Endurance, Animal Companion, Woodland Stride, Swift Tracker, Evasion, Camouflage, Hide in Plain Sight, 1st–4th Divine spells from level 4; ACF: `distracting_attack`).
   - `classes/rogue.json` (levels 1–20, `d6`, 3/4 BAB, Good Ref, 8 skill pts, Sneak Attack `+1d6..+10d6`, Trapfinding, Evasion, Trap Sense `+1..+6`, Uncanny Dodge, Improved Uncanny Dodge, Special Abilities at `10, 13, 16, 19`; ACF: `penetrating_strike`).
   - `classes/sorcerer.json` (levels 1–20, `d4`, 1/2 BAB, Good Will, 0–9th spontaneous Arcane casting with `spellsPerDay` & `spellsKnownTable`, Summon Familiar).
   - `classes/wizard.json` (levels 1–20, `d4`, 1/2 BAB, Good Will, 0–9th prepared Arcane casting, Summon Familiar, Scribe Scroll, Wizard Bonus Feats at `5, 10, 15, 20`, Specialist School options; ACF: `abrupt_jaunt`).

3. **10 SRD Prestige Classes (`public/data/rulesets/dnd35e/classes/<prcId>.json`):**
   - `classes/arcane_archer.json`, `classes/assassin.json`, `classes/blackguard.json`, `classes/dragon_disciple.json`, `classes/duelist.json`, `classes/dwarven_defender.json`, `classes/eldritch_knight.json`, `classes/loremaster.json`, `classes/mystic_theurge.json`, `classes/shadowdancer.json`.
   - Register all descriptors in `DnD35eRuleset.getSystemContentFiles()` (`src/rulesets/dnd35e/dnd35e_ruleset.ts`).

---

### Step 5: Pure D&D 3.5e Character Builder & Level-Up Engine (`src/rulesets/dnd35e/character_builder.ts`)

Create `src/rulesets/dnd35e/character_builder.ts` (~240 lines) containing all deterministic D&D 3.5e character creation and level-up calculations:
- **Point-Buy & Ability Generation:**
  - `POINT_BUY_COSTS: Readonly<Record<number, number>> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 8, 16: 10, 17: 13, 18: 16 }`
  - `ELITE_ABILITY_ARRAY: ReadonlyArray<number> = [15, 14, 13, 12, 10, 8]`
  - `calculatePointBuyCost(scores)` & `rollAbilityScores4d6DropLowest()` (using deterministic `rng` from `src/core/rng.ts`).
- **Skill Point Budget & Rank Allocation:**
  - `calculateLevelSkillPointBudget(classDef, intMod, isFirstCharacterLevel, isHuman)`
  - `getSkillMaxRanks(totalHd, isClassSkillEver)` (`totalHd + 3` vs `(totalHd + 3) / 2`)
  - `calculateSkillAllocationCost(addedRanksBySkill, currentClassSkills)` (`1` per 1.0 rank for class skills, `2` per 1.0 rank / `1` per 0.5 rank for cross-class skills).
- **Specialist School Validator:**
  - `validateSpecialistSchoolSelection(school, prohibitedSchools)`: enforces 2 prohibited schools (1 for `divination`), and forbids prohibiting `divination` or `universal`.
- **State Application Functions:**
  - `applyCharacterCreationToPlayer(state, draft)`: Hydrates the player entity's race (`applyRaceToActorChassis`), base ability scores + racial adjustments, Level 1 class track, max HP (`hitDie + conMod`), selected ACFs (`selectedAcfs`), Cleric domains (`domains`), Wizard specialist school (`arcaneSchool`, `prohibitedSchools`), skill ranks (`skillRanks`), starting feats (`feats`), class/domain/feat Effect Provider `StatModifier`s with hierarchical `sourcePath`s, starting spellbook/known spells, and starting equipment package.
  - `applyLevelUpToActor(state, entityId, choice)`: Appends or increments the chosen Base or Prestige Class in `classLevels` (validating `evaluatePrerequisiteAST` if `isPrestige`), adds HP (`roll` or `Math.floor(hitDie / 2) + 1` + `conMod`, min 1), applies every-4th-HD ability score increase if `newTotalHd % 4 === 0`, adds skill ranks, adds general/bonus feats, advances spellcasting slots (`advancesExistingSpellcasting` for Eldritch Knight/Loremaster/Mystic Theurge or intrinsic class spell table), and emits new class feature Effect Provider modifiers with `sourcePath: "class:<id>/level:<L>/feature:<featId>"`.

---

### Step 6: Interactive 7-Step Character Creation Wizard & Level-Up Modal UI (`src/rendering/ui/dnd35e_char_builder.ui.ts` & `src/rendering/ui/dnd35e_level_up.ui.ts`)

1. **Add UI Modes & Intent (`src/types/game-state.types.ts`, `src/types/intent.types.ts`, `src/core/engine.ts`, `src/core/input_handler.ts`):**
   - `UIMode.CHAR_CREATION = 'CHAR_CREATION'`
   - `UIMode.LEVEL_UP = 'LEVEL_UP'`
   - `IntentType.OPEN_LEVEL_UP = 'OPEN_LEVEL_UP'` (bound to `KeyL` in `EXPLORATION` mode and clicking the `"LEVEL UP READY! [L]"` alert in `hud_alerts.ui.ts`).
2. **Build `src/rendering/ui/dnd35e_char_builder.ui.ts` (~230 lines):**
   - Renders the 7-Step Character Creation Wizard using native `document.createElement()`:
     1. **Step 1 — Race Selection:** Select from playable races in `races.json` with live ability adjustments, size/speed, vision, traits, and favored class preview.
     2. **Step 2 — Class, Specialty/Domains & ACFs:** Select from the 11 SRD Base Classes, pick 2 Cleric Domains (if Cleric), Specialist School + Prohibited Schools (if Wizard), Favored Enemy (if Ranger), and toggle optional `acfSwaps` (`PRIM-2.1`).
     3. **Step 3 — Ability Scores:** Switch between **25 / 28 / 32-Point Buy**, **Elite Array (`15, 14, 13, 12, 10, 8`)**, and **Seeded `4d6kh3` Roll**, showing base + racial = effective score, modifier, carrying capacity, and bonus spell slots.
     4. **Step 4 — Skill Point Allocation:** Spend `(classPoints + INT mod) × 4` (+4 Human) across `skills.json` with class (`1:1`, max `4`) vs cross-class (`1:0.5`, max `2`) controls and 5-rank synergy badges.
     5. **Step 5 — Feat Selection:** Pick 1st-level General Feat (+1 Human Bonus Feat, +1 Fighter Bonus Feat) with live green/red `evaluatePrerequisiteAST` badges.
     6. **Step 6 — Starting Spells / Domains:** Select starting Wizard spellbook / Sorcerer or Bard known spells / Cleric domain spells preview.
     7. **Step 7 — Starting Equipment Package:** Choose between curated class kits (*Martial Vanguard Kit*, *Arcane Scholar Kit*, *Divine Templar Kit*, *Skirmisher Scout Kit*) or Gold Outfitter, then click **Begin Adventure** to invoke `applyCharacterCreationToPlayer()`.
3. **Build `src/rendering/ui/dnd35e_level_up.ui.ts` (~190 lines):**
   - Renders the Interactive Level-Up Modal when `UIMode.LEVEL_UP` is active:
     - Displays all 11 Base Classes and 10 Prestige Classes (with live `evaluatePrerequisiteAST` green/red badges for Prestige Classes and multiclass XP penalty preview if applicable).
     - Allows choosing HP method (Fixed Average vs Seeded Hit Die Roll + CON mod, min 1), Every-4th-HD Ability Score Increase (at HD 4, 8, 12, 16, 20), Skill Point allocation (showing newly unlocked 5-rank synergies!), Earned General/Bonus Feats, and New Spells, then commits via `applyLevelUpToActor()`.
4. **Wire into `index.html`, `src/rendering/ui/menus.ui.ts`, `src/rendering/presenter.ts`, and `src/core/session_controller.ts`:**
   - Add `#char-creation-modal` and `#level-up-modal` containers in `index.html`.
   - When starting a new run in `session_controller.ts` for a `dnd35e` campaign, open `UIMode.CHAR_CREATION` so the player builds their character (with a "Quick Start Default Hero" button for instant 1-click entry).

---

### Step 7: Comprehensive Test Suite (`tests/dnd35e_classes_builder.test.ts`)

Create `tests/dnd35e_classes_builder.test.ts` verifying:
1. Multi-file `classes.json` + `classes/<classId>.json` + `domains.json` loading and schema validation across all **11 Base Classes**, **10 Prestige Classes**, and **22 Cleric Domains**.
2. ACF `PRIM-2.1` swaps (`resolveActiveClassFeatures` swapping *Fast Movement* for *Lion Spirit Totem Pounce*, *Rage* for *Whirling Frenzy*, *Evasion* for *Invisible Fist*, *Trap Sense* for *Penetrating Strike*, *Summon Familiar* for *Abrupt Jaunt*).
3. Cleric Domain granted powers and domain spells, plus Wizard Specialist School slot bonuses and prohibited school validation (including Divination's 1-school rule).
4. Prestige Class `evaluatePrerequisiteAST` evaluation (e.g., *Mystic Theurge* arcane + divine spell level checks, *Assassin* Evil alignment + skill ranks, *Dwarven Defender* Dwarf + Lawful + BAB +7 + feats, *Arcane Archer* Elf/Half-Elf + BAB +6 + bow feats + arcane casting).
5. Multiclass XP penalty calculator (`calculateMulticlassXpMultiplier`) covering `favoredClass: 'any'`, racial `favoredClass`, Prestige Class exemption, `-20%` per uneven base class, and the campaign rule toggle.
6. Character Builder point-buy (`25`/`28`/`32`), Elite Array, `4d6kh3`, skill rank caps, `applyCharacterCreationToPlayer`, and `applyLevelUpToActor` (including Prestige Class caster level advancement and 4th-HD ability increases).
