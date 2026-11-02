# Implementation Plan: Rulebook-Faithful Class Header + Level-by-Level Progression Table & Chronological Multiclass / Level-Drain Ledger

## 1. Architectural Goal & Core Constraints

1. **Rulebook-Faithful Class Representation (`Class Header + Level-by-Level Table`)**:
   - Model every D&D 3.5e Base Class and Prestige Class (`public/data/rulesets/dnd35e/classes/<classId>.json` & `classes.json`) exactly like the printed 3.5e rulebook entries (*Table: The Cleric*, *Table: The Ordained Champion*):
     - **Class Header (Level-Invariant Parameters):** `id`, `name`, `isPrestige`, `maxLevel`, `hitDieSides`, `skillPointsPerLevel`, `classSkills`, `castingMode`, `castingTradition`, `castingKeyAbility`, `allowedAlignments`, `prerequisites`, `proficiencies`, `featureDetails`, and `acfSwaps`.
     - **Class Progression Table (`progression: ReadonlyArray<DnD35ClassLevelRow>`):** An ordered 1-indexed array (`level: 1 .. maxLevel`) where each row is a self-contained snapshot of that exact class level (`bab`, `fortSave`, `refSave`, `willSave`, `features`, `bonusFeatSlot`, `spellsPerDay`, `domainSpellSlots`, `spellsKnown`, `advancesSpellcasting`, `scalingValues`).
   - Eliminate the scattered level-keyed dictionaries and curve fields (`babCurve`, `fortCurve`, `refCurve`, `willCurve`, `featuresByLevel`, `bonusFeatLevels`, `spellsPerDayTable`, `spellsKnownTable`, `advancesExistingSpellcasting`) from `DnD35ClassDefinitionSchema`.
   - Preserve formulaic `babCurve`/`fortCurve`/`refCurve`/`willCurve` on `HitDieTrack` for **Monster Racial Hit Dice** (`creature_types.json`, `races.json`, `archetypes.json`), while allowing class tracks to supply `explicitBab`, `explicitFort`, `explicitRef`, and `explicitWill` directly from `classDef.progression[classLevel - 1]`.

2. **Chronological Actor Level Ledger (`levelHistory`) & Level Drain / Negative Levels**:
   - Store `levelHistory?: ReadonlyArray<DnD35CharacterLevelRecord>` and `negativeLevels?: number` on `DnD35EntityData`.
   - Every character creation and level-up appends a `DnD35CharacterLevelRecord` capturing the exact choices made at that character level (`characterLevel`, `classId`, `classLevel`, `hpRolled`, `abilityScoreIncrease`, `addedSkillRanks`, `selectedFeats`, `selectedAcfs`, `learnedSpells`).
   - Support interleaved multiclassing (e.g., `Fighter 1..4 -> Rogue 1..2 -> Fighter 5`) and **Permanent Level Drain** (`applyPermanentLevelDrainToActor(state, entityId, levelsDrained)`) by popping the last $N$ records from `levelHistory` and deterministically rebuilding `tracks`, `maxHp` (including retroactive `CON` modifier changes), `abilityScores`, `skillRanks`, `feats`, `selectedAcfs`, `knownSpells`, and Unified Effect Provider `statModifiers`.
   - Support temporary **Negative Levels** (`applyNegativeLevelsToActor(state, entityId, count)`) via Unified Effect Provider `StatModifier`s (`-1` attack, `-1` saves, `-5` HP per negative level) under `sourcePath: "condition:negative_level"`.

3. **Permanent Architectural Documentation**:
   - Record this design in `docs/DECISIONS.md` (`ADR: Rulebook-Faithful Class Header + Level-by-Level Progression Table & Chronological Actor Level Ledger`) and update `docs/MILESTONES.md`, `docs/DND_35E_PYRAMID_ARCHITECTURE.md`, and `docs/ARCHITECTURE.md` so future sessions recognize this granular level-by-level representation as a core project standard.

---

## 2. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors / Tests) | Downstream (Consumers / Validators / UI / Save Schemas) | Lateral (Sibling JSONs / Docs / Parallel Registries) |
| :--- | :--- | :--- | :--- |
| **1. `DnD35ClassLevelRowSchema` & `DnD35ClassDefinitionSchema` refactor (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`)** | `public/data/rulesets/dnd35e/classes/*.json` (21 files), `public/data/rulesets/dnd35e/classes.json` (4 starter classes), `src/core/loader.ts` | `scripts/run-validator.ts`, `src/rulesets/dnd35e/progression.ts`, `src/rulesets/dnd35e/character_builder.ts`, `src/rendering/ui/dnd35e_char_builder.ui.ts`, `src/rendering/ui/dnd35e_level_up.ui.ts`, `tests/dnd35e_classes_builder.test.ts` | `archetypes.json` and `creature_types.json` remain unchanged (they use `DnD35ProgressionTrackSchema` for monster Racial HD tracks). Classic ruleset is 100% isolated (`manifest.rulesetId !== 'dnd35e'`). |
| **2. `HitDieTrack` explicit table overrides & `DnD35CharacterLevelRecord` (`src/rulesets/dnd35e/types/dnd35e.types.ts`)** | `applyCharacterCreationToPlayer`, `applyLevelUpToActor`, `applyPermanentLevelDrainToActor`, `rebuildActorStateFromLevelHistory` | `aggregateProgressionChassis` (`progression.ts`), `resolveDnD35ActorStats` (`srd_registry.ts`), `buildPrerequisiteContextForActor` (`character_builder.ts`) | `RulesetDataComponent.payload` remains 100% plain JSON-serializable (`No Maps/Sets in ECS`). Backward-compatible with spawned monster archetypes that omit `levelHistory`. |
| **3. `getClassLevelRow`, `collectClassFeaturesUpToLevel`, `computeEffectiveCasterLevelForClass` (`src/rulesets/dnd35e/progression.ts`)** | `buildClassAndDomainEffectModifiers`, `buildPrerequisiteContextForActor`, `dnd35e_char_builder.ui.ts`, `dnd35e_level_up.ui.ts` | `evaluatePrerequisiteAST` (Prestige Class & Feat spell/caster level gates), `resolveActiveClassFeatures` (ACF swaps) | Exported via `src/rulesets/registry.ts` so UI modules never import directly from `src/rulesets/dnd35e/*`. |
| **4. `applyPermanentLevelDrainToActor` & `applyNegativeLevelsToActor` (`src/rulesets/dnd35e/character_builder.ts`)** | Energy Drain / Wight / Vampire / *Enervation* combat riders and tests (`tests/dnd35e_classes_builder.test.ts`) | `FighterComponent` (`level`, `hp`, `maxHp`, `attack`), `DnD35EntityData` (`tracks`, `levelHistory`, `negativeLevels`, `statModifiers`) | Integrates with `revokeModifiersByPathPrefix` (`sourcePath: "condition:negative_level"`). |
| **5. Documentation Updates (`docs/DECISIONS.md`, `docs/MILESTONES.md`, `docs/DND_35E_PYRAMID_ARCHITECTURE.md`, `docs/ARCHITECTURE.md`)** | Project maintainers and future AI sessions consulting project docs (`AGENTS.md` Rule 4 & 11) | Implementation plans and architecture audits in Phase 24–26 | Keeps `DECISIONS.md` and `MILESTONES.md` synchronized with the per-class JSON + level-by-level table standard. |

---

## 3. Step-by-Step Implementation Details & Code Diffs

### Step 1: Update `DnD35ClassLevelRowSchema` & `DnD35ClassDefinitionSchema` (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`)

Replace the curve/map properties on `DnD35ClassDefinitionSchema` with `DnD35ClassLevelRowSchema` and `progression: z.array(DnD35ClassLevelRowSchema).min(1)`:

```typescript
/** Zod schema for a single row in a class's level-by-level progression table (levels 1..maxLevel). */
export const DnD35ClassLevelRowSchema = z.object({
  level: z.number().int().positive(),
  bab: z.number().int().nonnegative(),
  fortSave: z.number().int().nonnegative(),
  refSave: z.number().int().nonnegative(),
  willSave: z.number().int().nonnegative(),
  features: z.array(z.string()).default([]),
  bonusFeatSlot: z.boolean().optional(),
  spellsPerDay: z.record(z.string(), z.number().int().nonnegative()).optional(),
  domainSpellSlots: z.record(z.string(), z.number().int().nonnegative()).optional(),
  spellsKnown: z.record(z.string(), z.number().int().nonnegative()).optional(),
  advancesSpellcasting: z.enum(['arcane', 'divine', 'both', 'any']).optional(),
  scalingValues: z.record(z.string(), z.union([z.number(), z.string()])).optional()
});
/** Inferred type for a single class level progression row. */
export type DnD35ClassLevelRow = z.infer<typeof DnD35ClassLevelRowSchema>;

/** Zod schema for a declarative character class definition (`classes.json` & `classes/<id>.json`). */
export const DnD35ClassDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPrestige: z.boolean().default(false),
  maxLevel: z.number().int().positive().default(20),
  hitDieSides: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  skillPointsPerLevel: z.number().int().nonnegative(),
  classSkills: z.array(z.string()).default([]),
  castingMode: z.enum(['none', 'prepared', 'spontaneous']).default('none'),
  castingTradition: z.enum(['none', 'arcane', 'divine']).default('none'),
  castingKeyAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']).optional(),
  allowedAlignments: z.array(DnD35AlignmentSchema).optional(),
  prerequisites: PrerequisiteNodeSchema.optional(),
  proficiencies: z
    .object({
      weapons: z.array(z.string()).default([]),
      armor: z.array(z.string()).default([]),
      shields: z.array(z.string()).default([])
    })
    .optional(),
  progression: z.array(DnD35ClassLevelRowSchema).min(1),
  featureDetails: z.record(z.string(), DnD35ClassFeatureDetailSchema).default({}),
  acfSwaps: z.array(DnD35AcfSwapSchema).default([])
});
/** Inferred type for a declarative class definition. */
export type DnD35ClassDefinition = z.infer<typeof DnD35ClassDefinitionSchema>;
```

---

### Step 2: Update `HitDieTrack`, `DnD35CharacterLevelRecord` & `DnD35EntityData` (`src/rulesets/dnd35e/types/dnd35e.types.ts`)

1. Add optional explicit table values (`explicitBab`, `explicitFort`, `explicitRef`, `explicitWill`) to `HitDieTrack` so class tracks read directly from their `DnD35ClassLevelRow` while monster Racial HD tracks continue using `babCurve` / `fortCurve` / `refCurve` / `willCurve`.
2. Add `DnD35CharacterLevelRecord` and `levelHistory` / `negativeLevels` to `DnD35EntityData`:

```typescript
/** A single Hit Die / Class Level track contributing to an entity's chassis. */
export interface HitDieTrack {
  readonly trackId: string;
  readonly levels: number;
  readonly hitDieSides: number;
  readonly babCurve: BabCurveType;
  readonly fortCurve: SaveCurveType;
  readonly refCurve: SaveCurveType;
  readonly willCurve: SaveCurveType;
  readonly skillPointsPerLevel: number;
  readonly explicitBab?: number | undefined;
  readonly explicitFort?: number | undefined;
  readonly explicitRef?: number | undefined;
  readonly explicitWill?: number | undefined;
}

/**
 * Chronological ledger entry for a single Character Level (1..20) on an actor.
 * Enables exact multiclass interleaving, retroactive CON HP recalculation, and O(1) permanent level drain rollback.
 */
export interface DnD35CharacterLevelRecord {
  readonly characterLevel: number;
  readonly classId: string;
  readonly classLevel: number;
  readonly hpRolled: number;
  readonly abilityScoreIncrease?: AbilityId | undefined;
  readonly addedSkillRanks: Readonly<Record<string, number>>;
  readonly selectedFeats: ReadonlyArray<string>;
  readonly selectedAcfs: ReadonlyArray<string>;
  readonly learnedSpells: ReadonlyArray<string>;
}
```

And in `DnD35EntityData`:
```typescript
  readonly levelHistory?: ReadonlyArray<DnD35CharacterLevelRecord> | undefined;
  readonly negativeLevels?: number | undefined;
```

---

### Step 3: Update `src/rulesets/dnd35e/progression.ts`

1. **`getClassLevelRow(classDef, classLevel)`**:
   Returns the exact `DnD35ClassLevelRow` for `classLevel` ($1 \le \text{classLevel} \le \text{maxLevel}$).
2. **`buildHitDieTrackFromClass(classDef, classLevel)`**:
   Constructs a `HitDieTrack` for `classDef` at `classLevel`, populating `explicitBab`, `explicitFort`, `explicitRef`, and `explicitWill` directly from `getClassLevelRow(classDef, classLevel)`.
3. **`aggregateProgressionChassis` update**:
   Uses `track.explicitBab ?? evaluateBabCurve(track.babCurve, levels)` (and likewise for `explicitFort`, `explicitRef`, `explicitWill`).
4. **`collectClassFeaturesUpToLevel(classDef, maxReachedLevel, activeAcfIds)`**:
   Iterates `classDef.progression` rows with `row.level <= maxReachedLevel`, collects `row.features`, and passes them through `resolveActiveClassFeatures`.
5. **`computeEffectiveClassCastingLevel(tracks, baseClassDef, classRegistry)`**:
   Computes the effective spellcasting table level for a base casting class by adding the actor's levels in `baseClassDef.id` plus the count of achieved rows in any Prestige Class in `tracks` whose `row.advancesSpellcasting` matches `baseClassDef.castingTradition` (or `'both'` / `'any'`).

```typescript
/**
 * Looks up the exact progression row for a class at `classLevel` (1..maxLevel).
 *
 * @param classDef Class definition from System Content.
 * @param classLevel Target class level (1-indexed).
 * @returns The matching `DnD35ClassLevelRow`, or `undefined` if out of bounds.
 */
export function getClassLevelRow(
  classDef: DnD35ClassDefinition,
  classLevel: number
): DnD35ClassLevelRow | undefined {
  const clamped = dndFloor(classLevel);
  if (clamped < 1) return undefined;
  return classDef.progression.find((row) => row.level === clamped);
}

/**
 * Builds a `HitDieTrack` for a character class at `classLevel`, reading exact BAB and base saves
 * from the class's level-by-level progression table.
 *
 * @param classDef Class definition from System Content.
 * @param classLevel Class level achieved (>= 1).
 * @returns Populated `HitDieTrack` with explicit table BAB and saves.
 */
export function buildHitDieTrackFromClass(
  classDef: DnD35ClassDefinition,
  classLevel: number
): HitDieTrack {
  const clamped = Math.max(1, Math.min(classDef.maxLevel, dndFloor(classLevel)));
  const row = getClassLevelRow(classDef, clamped) ?? classDef.progression[classDef.progression.length - 1]!;
  return {
    trackId: classDef.id,
    levels: clamped,
    hitDieSides: classDef.hitDieSides,
    babCurve: 'half',
    fortCurve: 'poor',
    refCurve: 'poor',
    willCurve: 'poor',
    skillPointsPerLevel: classDef.skillPointsPerLevel,
    explicitBab: row.bab,
    explicitFort: row.fortSave,
    explicitRef: row.refSave,
    explicitWill: row.willSave
  };
}
```

---

### Step 4: Chronological `levelHistory`, Level-Up & Level-Drain Engine (`src/rulesets/dnd35e/character_builder.ts`)

To keep file sizes well under the 300-line / modular threshold (`AGENTS.md` §8), we will split the chronological ledger & level-drain helpers into a dedicated module `src/rulesets/dnd35e/level_ledger.ts` and re-export them from `character_builder.ts` and `src/rulesets/registry.ts`:

1. **`rebuildActorStateFromLevelHistory(baseData, levelHistory, sysContent)`**:
   - Starts from the actor's initial racial/base ability scores (`initialAbilityScores` or reverse-computed from `levelHistory` ability increases) and racial `tracks`.
   - Replays `levelHistory[0 .. k-1]` in chronological order:
     - Counts `classLevel` per `classId` and constructs class `HitDieTrack`s via `buildHitDieTrackFromClass(classDef, count)`.
     - Applies each record's `abilityScoreIncrease`.
     - Sums `addedSkillRanks`, `selectedFeats` (+ domain `featGrants`), `selectedAcfs`, and `learnedSpells`.
     - Computes total HP from each record's `Math.max(1, record.hpRolled + currentConMod)` (automatically handling retroactive Constitution increases/decreases!).
     - Rebuilds class, ACF, domain, and negative-level `StatModifier`s with full `sourcePath` provenance.
2. **`applyCharacterCreationToPlayer`**:
   - Creates the initial `DnD35CharacterLevelRecord` for `characterLevel: 1, classId: draft.classId, classLevel: 1, hpRolled: classDef.hitDieSides` and stores `levelHistory: [levelOneRecord]`.
3. **`applyLevelUpToActor`**:
   - Validates Prestige Class `prerequisites`, alignment, and `maxLevel` (`currentClassLevel + 1 <= classDef.maxLevel`).
   - Appends the new `DnD35CharacterLevelRecord` to `levelHistory` and invokes `rebuildActorStateFromLevelHistory`.
4. **`applyPermanentLevelDrainToActor(state, entityId, levelsDrained)`**:
   - Slices off the last `levelsDrained` entries from `levelHistory` (clamped to a minimum of 1 remaining character level if the actor survives, or marks dead if total levels drop to 0).
   - Calls `rebuildActorStateFromLevelHistory` to roll back `tracks`, `maxHp`, `abilityScores`, `skillRanks`, `feats`, `selectedAcfs`, `knownSpells`, and `statModifiers`, and lowers `fighter.xp` to the midpoint/floor of the new ECL.
5. **`applyNegativeLevelsToActor(state, entityId, negativeLevelCount)`**:
   - Sets `negativeLevels` on `DnD35EntityData` and injects Unified Effect Provider `StatModifier`s with `sourcePath: "condition:negative_level"` (`attack: -N`, `fort: -N`, `ref: -N`, `will: -N`, `max_hp: -5 * N`).

---

### Step 5: Migrate All 21 Class JSONs (`public/data/rulesets/dnd35e/classes/*.json` & `classes.json`)

Update all 11 Base Classes (`barbarian`, `bard`, `cleric`, `druid`, `fighter`, `monk`, `paladin`, `ranger`, `rogue`, `sorcerer`, `wizard` in `classes/*.json` plus the 4 starter entries in `classes.json`) and all 10 Prestige Classes (`arcane_archer`, `assassin`, `blackguard`, `dragon_disciple`, `duelist`, `dwarven_defender`, `eldritch_knight`, `loremaster`, `mystic_theurge`, `shadowdancer`) to use the Header + `progression` Level-by-Level Table format:

- **Cleric (`cleric.json`)** includes both `spellsPerDay` and `domainSpellSlots: { "1": 1, ... }` on levels 1–20 (`1+1`, `2+1`, etc. matching *Table: The Cleric*).
- **Monk (`monk.json`)**, **Rogue (`rogue.json`)**, and **Barbarian (`barbarian.json`)** include `scalingValues` on their level rows (`unarmed_damage_dice`, `unarmored_ac_bonus`, `unarmored_speed_bonus`, `sneak_attack_d6`, `rage_uses_per_day`, `trap_sense_bonus`).
- **Prestige Classes (`mystic_theurge.json`, `eldritch_knight.json`, `arcane_archer.json`, `dragon_disciple.json`, `loremaster.json`)** place `advancesSpellcasting: "arcane" | "divine" | "both" | "any"` directly on the exact rows that advance existing spellcasting (e.g., `eldritch_knight.json` has no `advancesSpellcasting` on row 1, and `advancesSpellcasting: "arcane"` on rows 2–10).

---

### Step 6: Update Character Creation & Level-Up UI (`src/rendering/ui/dnd35e_char_builder.ui.ts` & `src/rendering/ui/dnd35e_level_up.ui.ts`)

1. In `dnd35e_char_builder.ui.ts`:
   - Read Level 1 features and stats from `getClassLevelRow(cls, 1)` (`row1.bab`, `row1.fortSave`, `row1.refSave`, `row1.willSave`, `row1.features`) instead of `cls.babCurve` / `cls.featuresByLevel['1']`.
   - Render a compact **Class Progression Table Preview** (Levels 1–20 / 1–10 showing `Lvl | BAB | Fort | Ref | Will | Special`) in Step 2 so the player can inspect what any level of the selected class looks like right in the UI!
2. In `dnd35e_level_up.ui.ts`:
   - Build preview tracks using `buildHitDieTrackFromClass(cls, nextClassLevel)` and show the exact next class level row (`Lvl ${nextClassLevel}: BAB +${nextRow.bab}, Fort +${nextRow.fortSave}, Ref +${nextRow.refSave}, Will +${nextRow.willSave}, Special: ${nextRow.features.join(', ') || '—'}`).

---

### Step 7: Update Unit Tests (`tests/dnd35e_classes_builder.test.ts`)

Expand `tests/dnd35e_classes_builder.test.ts` to verify:
1. Every one of the 21 classes has `progression.length === maxLevel` with monotonically increasing `level: 1..maxLevel`.
2. Direct `getClassLevelRow(cleric, 3)` snapshot returns `{ level: 3, bab: 2, fortSave: 3, refSave: 1, willSave: 3, spellsPerDay: { "0": 4, "1": 2, "2": 1 }, domainSpellSlots: { "1": 1, "2": 1 } }`.
3. Prestige Class spellcasting advancement rows (`eldritch_knight` row 1 has `advancesSpellcasting === undefined`, rows 2–10 have `advancesSpellcasting === 'arcane'`; `mystic_theurge` rows 1–10 have `advancesSpellcasting === 'both'`).
4. **Interleaved Multiclassing + Permanent Level Drain Rollback**:
   - Create a Level 1 Human Fighter (`Fighter 1`), advance to `Fighter 4` (+1 STR at HD 4), take 2 levels of Rogue (`Rogue 1..2`), then take `Fighter 5` (`Character Level 7`: `Fighter 5 / Rogue 2`, `BAB = +5 + +1 = +6`, `Fort = +4 + +0 = +4`, `Ref = +1 + +3 = +4`, `Will = +1 + +0 = +1`).
   - Apply 1 Temporary Negative Level (`applyNegativeLevelsToActor`) and verify `-1` attack/saves and `-5` max HP modifiers with `sourcePath: "condition:negative_level"`.
   - Apply 2 Permanent Levels Drained (`applyPermanentLevelDrainToActor(state, playerId, 2)`) and verify that `Fighter 5` and `Rogue 2` are popped in exact LIFO chronological order, leaving `Fighter 4 / Rogue 1` (`Character Level 5`, `BAB = +4 + +0 = +4`, `Fort = +4`, `Ref = +1 + +2 = +3`, `Will = +1`) with exact HP, skill ranks, and feats restored.

---

### Step 8: Permanent Architectural Documentation (`docs/DECISIONS.md`, `docs/MILESTONES.md`, `docs/DND_35E_PYRAMID_ARCHITECTURE.md`, `docs/ARCHITECTURE.md`)

1. **`docs/DECISIONS.md`**: Add a new Architectural Decision Record:
   - **`Rulebook-Faithful Class Header + Level-by-Level Progression Table & Chronological Actor Level Ledger (`levelHistory`)`**:
     - Explains why Character Classes and Prestige Classes use explicit level-by-level `progression` tables (`1..maxLevel`) paired with a level-invariant Class Header (mirroring the physical 3.5e books), whereas Monster Racial HD tracks (`creature_types.json`, `archetypes.json`) retain formulaic curves (`babCurve`, `fortCurve`, `refCurve`, `willCurve`) to scale across arbitrary monster HD (`1..60+`).
     - Documents why actors maintain a chronological `levelHistory: ReadonlyArray<DnD35CharacterLevelRecord>` alongside aggregated `tracks`, making interleaved multiclassing and permanent level drain (`applyPermanentLevelDrainToActor`) exact and deterministic.
     - Explicitly states that this granular level-by-level table representation is the canonical standard for all class progressions and must not be reverted to curve-only class definitions.
2. **`docs/MILESTONES.md`**, **`docs/DND_35E_PYRAMID_ARCHITECTURE.md`**, and **`docs/ARCHITECTURE.md`**:
   - Update Milestone 91 (`PRIM-1.4`), Milestone 94 (`PRIM-2.1`), and Milestones 110–112 descriptions to document `progression: ReadonlyArray<DnD35ClassLevelRow>`, per-class JSON files (`classes/<classId>.json`), and `levelHistory` / level-drain support.
