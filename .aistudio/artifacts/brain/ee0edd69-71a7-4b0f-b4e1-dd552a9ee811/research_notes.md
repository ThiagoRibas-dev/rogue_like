# Research Notes — Granular Level-by-Level Class Progression Tables & Chronological Multiclass/Level-Drain Ledger

## 1. Architectural Rules & Standards Reiterated
Per `AGENTS.md` and `docs/ARCHITECTURE.md`:
1. **Strict TypeScript (`exactOptionalPropertyTypes: true`):** Zero `any` types, explicit return types on all functions, and no `undefined` assigned directly to optional properties without explicit union typing.
2. **Pure Serializable ECS Data:** All structures inside `DnD35EntityData` (`RulesetDataComponent`) and JSON registries must be plain JSON-serializable arrays and records (no `Map` or `Set`).
3. **Three-Tier Placement Heuristic (Rule 16):**
   - **Tier 1 (Console):** Generic ECS & UI rendering primitives.
   - **Tier 2 (`src/rulesets/dnd35e/`):** Pure D&D 3.5e progression table evaluators, chronological level-history reducers, negative level / permanent level drain resolvers, and Zod schemas.
   - **Tier 3 (`public/data/rulesets/dnd35e/classes/*.json`):** Declarative rulebook-faithful class definitions (Invariant Class Header + 1-to-`maxLevel` Level-by-Level Progression Table).
4. **Unified Effect Providers & Hierarchical Provenance (`sourcePath`, Rule 19):** Every modifier emitted by a class feature, ACF, domain, or negative level must carry a slash-delimited `sourcePath` (`"class:cleric/feature:turn_or_rebuke_undead/..."`, `"condition:negative_level/..."`).

---

## 2. Problem Analysis: Rulebook Class Tables vs. Implicit Curve Split

### 2.1 Class Definition Granularity (Rulebook Header + Level Table)
In D&D 3.5e rulebooks (e.g., *PHB* **Table: The Cleric** and *Complete Champion* **Table: The Ordained Champion**), a class is structured in two parts:
1. **Class Header (Level-Invariant Properties):**
   - `id`, `name`, `isPrestige`, `maxLevel`, `hitDieSides`, `skillPointsPerLevel`, `classSkills`
   - `castingMode`, `castingTradition`, `castingKeyAbility`
   - `allowedAlignments`, `prerequisites`, `proficiencies`
   - `featureDetails` (encyclopedia of features granted by the table) and `acfSwaps`
2. **Class Table (`progression: ReadonlyArray<DnD35ClassLevelRow>`):**
   - Currently, class progression is fragmented across 5 separate fields (`babCurve`/`fortCurve`/`refCurve`/`willCurve`, `featuresByLevel`, `bonusFeatLevels`, `spellsPerDayTable`, `spellsKnownTable`, and `advancesExistingSpellcasting`).
   - Replacing those scattered maps with an explicit level-by-level `progression` array (`level: 1 .. maxLevel`) where each row contains:
     - `level`: `1..maxLevel`
     - `bab`: cumulative Base Attack Bonus at this class level (`+0`, `+1`, `+2`, ...)
     - `fortSave`, `refSave`, `willSave`: cumulative base saving throws at this class level
     - `features`: array of feature IDs gained at this exact class level (`special` column)
     - `bonusFeatSlot`: optional boolean (`true` on Fighter 1, 2, 4... or Wizard 5, 10, 15, 20)
     - `spellsPerDay`: optional map of spell level `"0".."9"` to base daily slots at this class level
     - `domainSpellSlots`: optional map of spell level `"1".."9"` to domain bonus slots (the `+1` in Cleric's `1+1`, `2+1` table cells)
     - `spellsKnown`: optional map of spell level `"0".."9"` to known spells at this class level (Bard, Sorcerer)
     - `advancesSpellcasting`: optional `'arcane' | 'divine' | 'both' | 'any'` for Prestige Classes on the exact levels that grant `+1 level of existing spellcasting class` (e.g., Ordained Champion at levels 2, 3, and 5; Mystic Theurge at 1..10)
     - `scalingValues`: optional key-value map for class-specific scaling table columns (e.g., Monk `unarmed_damage_dice`, `unarmored_ac_bonus`, `unarmored_speed_bonus`; Rogue `sneak_attack_d6`; Barbarian `rage_uses_per_day`)
   - **Result:** Querying *"What does Level $L$ of Class $X$ look like?"* becomes an $O(1)$ lookup (`getClassLevelSnapshot(classDef, L)`), and computing the exact delta between Level $L-1$ and Level $L$ is a simple row subtraction.

### 2.2 Actor Multiclassing Interleaving & Permanent Level Drain (`levelHistory`)
When a character interleaves classes (e.g., `Fighter 1–4 → Rogue 1–2 → Fighter 5`) and then suffers **Permanent Level Drain** (failing a 24-hour Fortitude save against a negative level), collapsed `tracks` (`fighter: 5, rogue: 2`) lose chronological ordering and per-level choices.
- By storing an append-only chronological ledger `levelHistory: ReadonlyArray<DnD35CharacterLevelRecord>` on `DnD35EntityData`:
  - Each record stores `{ characterLevel, classId, classLevel, hpRolled, abilityScoreIncrease?, addedSkillRanks, selectedFeats, selectedAcfs, learnedSpells }`.
  - **On-the-Fly Derivation:** `tracks`, `maxHp` (including retroactive Constitution modifier changes per PHB p. 171), `skillRanks`, `feats`, `abilityScores`, and `statModifiers` are deterministically derived from `levelHistory` + racial base tracks.
  - **Permanent Level Drain (`applyPermanentLevelDrainToActor`):** Pops the last $N$ records from `levelHistory` and re-runs the pure derivation function, cleanly unwinding the exact class level (`Fighter 5 → Fighter 4`), HP roll, skill ranks, 4th-HD ability bump, and feats gained at the lost level.
  - **Temporary Negative Levels (`negativeLevels`):** Stored on `DnD35EntityData` and emitted as Unified Effect Provider `StatModifier`s (`-1` attack, `-1` saves, `-5` max HP per negative level) with `sourcePath: "condition:negative_level"`.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Producers / JSON Data) | Downstream (Consumers / Validators / UI / Tests) | Lateral (Sibling Configs / Docs / Classic Cartridge) |
| :--- | :--- | :--- | :--- |
| **`DnD35ClassLevelRowSchema` & `progression` array on `DnD35ClassDefinitionSchema`** (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`) | All 21 split class JSONs (`public/data/rulesets/dnd35e/classes/*.json`) | `progression.ts` (`getClassLevelRow`, `collectClassFeaturesUpToLevel`), `character_builder.ts`, `dnd35e_char_builder.ui.ts`, `dnd35e_level_up.ui.ts`, `scripts/validate-campaign.ts` | Classic cartridge (`classic`) is 100% unaffected. Monster Racial HD (`creature_types.json`, `races.json`, `archetypes.json`) retain `babCurve`/`fortCurve` for arbitrary monster HD scaling. |
| **Explicit `bab` / `baseSaves` on `HitDieTrack`** (`src/rulesets/dnd35e/types/dnd35e.types.ts`) | `character_builder.ts` (hydrates class tracks from `classDef.progression[level - 1]`) | `aggregateProgressionChassis` in `progression.ts` & `evaluateDnD35ActorStatDAG` in `modifiers.ts` (uses explicit row `bab`/`fort`/`ref`/`will` when present on a class track, or curve formula for Racial HD tracks) | Existing monster archetypes in `archetypes.json` continue to work without modification. |
| **Actor `levelHistory` & `applyPermanentLevelDrainToActor`** (`src/rulesets/dnd35e/character_builder.ts`, `dnd35e.types.ts`) | `applyCharacterCreationToPlayer` (initializes `levelHistory[0]`), `applyLevelUpToActor` (appends `levelHistory[k]`) | `tests/dnd35e_classes_builder.test.ts` (tests interleaved `Fighter 4 -> Rogue 2 -> Fighter 5` + permanent level drain rollback) | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/DND_35E_PYRAMID_ARCHITECTURE.md`, `docs/MILESTONES.md` |
