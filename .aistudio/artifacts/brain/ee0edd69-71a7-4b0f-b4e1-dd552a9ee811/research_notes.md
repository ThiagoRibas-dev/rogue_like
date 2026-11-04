# Research Notes: SRD Registry Decomposition & Verification File Length Warning Check

## 1. Reiteration of Architectural Rules & Standards (Step 1)
Per `AGENTS.md` and `docs/ARCHITECTURE.md`:
- **File Organization & Line Length Discipline (`AGENTS.md` Rule 8):**
  - "One concern per file. Split files if they handle multiple responsibilities or exceed ~250 lines."
  - "Barrel files (`index.ts`) are BANNED. Use direct imports."
  - `src/rulesets/dnd35e/srd_registry.ts` is currently **1,154 lines**, conflating 5 distinct architectural responsibilities (Effect Bundle evaluation, creature type/subtype effect providers, archetype hydration & dragon/elemental delegation, live Horizon 3 situational tag projection, and entity data persistence).
- **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16):**
  - All four decomposed modules belong to **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`)**, operating purely on declarative D&D 3.5e mechanics, system content schemas, and ECS components without hardcoding monster/character silos.
- **Unified Effect Providers & Hierarchical Provenance (`AGENTS.md` Rule 19):**
  - Effect bundles and creature types/subtypes emit `StatModifier`s with hierarchical `sourcePath`s (e.g. `"<parent>/bundle:<id>/<modId>"`, `"type:construct/trait:construct_bonus_hp"`, `"subtype:incorporeal/deflection_ac"`).
- **Three-Horizon Computation Boundaries (`AGENTS.md` Rule 20):**
  - Semantic tag projection (`projectDnD35ActorSemanticTags`) and live situational context (`resolveEntitySituationalTagContext`) operate strictly at **Horizon 3** without mutating persistent `levelHistory` or component state.
- **Verification Pipeline Integrity (`AGENTS.md` Rule 8 & Step 8):**
  - The verification pipeline must warn when TypeScript files in `src/` exceed 300 lines without breaking the build, maintaining 100% green status across all existing stages.

---

## 2. Codebase Audit of `src/rulesets/dnd35e/srd_registry.ts` (Step 2)

Currently `src/rulesets/dnd35e/srd_registry.ts` (1,154 lines) contains the following distinct logical sections:

### 2.1. Effect Bundle Evaluation (Lines 55–209, ~155 lines)
- **Exports:**
  - `EvaluatedEffectBundleResult` (interface)
  - `isActivationConditionMet` (function)
  - `evaluateEffectBundle` (function)
- **Responsibilities:** Gating on `activationCondition` (`selfTagsAll`, `selfTagsAny`, `selfTagsNone`), checking atomic bundle suppression (`suppressedBundleIds`), tagging emitted modifiers with `sourcePath` provenance (`"<parent>/bundle:<id>/<modId>"`), and extracting granted tags, feats, class skills, immunities, vulnerabilities, and abilities.
- **Dependencies:** `appendSourcePath` (`modifiers.ts`), `DnD35EffectBundle`, `StatModifier`.
- **Target File:** `src/rulesets/dnd35e/effect_bundle.ts`.

### 2.2. Semantic Tags & Creature Type/Subtype Effect Providers (Lines 45–53, 210–294, 587–812, ~315 lines)
- **Exports:**
  - `CONSTRUCT_BONUS_HP_BY_SIZE` (constant)
  - `buildCreatureTypeAndSubtypeModifiers` (function)
  - `SituationalTagContext` (interface)
  - `HEAVY_ARMOR_BONUS_THRESHOLD`, `MEDIUM_ARMOR_BONUS_THRESHOLD`, `DEFAULT_ACROBATIC_SKILL_THRESHOLD_RANKS` (constants)
  - `projectDnD35ActorSemanticTags` (function)
  - `resolveEntitySituationalTagContext` (function)
- **Responsibilities:**
  - Emitting declarative construct bonus HP and incorporeal deflection AC modifiers.
  - Projecting semantic tags (`type:*`, `subtype:*`, `size:*`, `trait:literate`, `trait:illiterate`, `feature:*`, `armor:*`, `shield:*`, `armor_material:*`, `load:*`, and skill rank threshold tags).
  - Inspecting live equipment slots to derive `SituationalTagContext`.
- **Dependencies:** `appendSourcePath` (`modifiers.ts`), `evaluateEffectBundle` (`effect_bundle.ts`), ECS getters (`ecs.ts`), component types (`components.types.ts`), `DnD35EntityData`, `StatModifier`.
- **Target File:** `src/rulesets/dnd35e/semantic_tags.ts`.

### 2.3. Archetype Synthesis, Resolution & Hydration (Lines 302–585, 1014–1153, ~420 lines)
- **Exports:**
  - `buildAbilityScoresRecord` (function)
  - `hydrateRaceAsArchetype` (function)
  - `hydrateArchetypeData` (function)
  - `DEFAULT_PLAYER_ARCHETYPE`, `DEFAULT_CREATURE_ARCHETYPE` (constants)
  - `getDnD35Archetype` (function)
- **Responsibilities:**
  - Deriving `DnD35Archetype` from unified `races/<id>.json`, delegating dragon varieties and elemental size steps to `family_synthesizer.ts`.
  - Computing racial HD tracks and class tracks.
  - Hydrating runtime `DnD35EntityData` with base ability scores, tracks, natural weapons, senses, movement modes, and provider modifiers.
- **Dependencies:** `family_synthesizer.ts`, `progression.ts`, `abilities.ts`, `buildCreatureTypeAndSubtypeModifiers` (`semantic_tags.ts`), system content types.
- **Target File:** `src/rulesets/dnd35e/archetype_resolver.ts`.

### 2.4. Entity Data Access, Persistence & System Content Registry (Lines 814–1012, ~200 lines)
- **Exports:**
  - `getDnD35EntityData` (function)
  - `setDnD35EntityData` (function)
  - `getEquippedItemBonuses` (function)
  - `resolveDamageTypeFromTags` (function)
  - `getDnD35Race` (function)
  - `getDnD35Template` (function)
  - `getDnD35CreatureTypeEngine` (function)
  - `getDnD35Subtype` (function)
- **Responsibilities:**
  - Fetching or hydrating entity ruleset data from `RulesetDataComponent`, `TemplateComponent`, or `IdentityComponent`.
  - Persisting `DnD35EntityData` back into ECS.
  - Calculating raw equipped attack/defense item bonuses.
  - Extracting damage types and looking up system content definitions.
- **Target File:** Retained in `src/rulesets/dnd35e/srd_registry.ts` (slimmer, focused entity data & lookup facade, ~170 lines, well under the 300-line ceiling).

---

## 3. Verify Scripts File Length Warning Check Design

### 3.1. Requirements
1. Add a dedicated script: `scripts/check-file-length.ts`.
2. Scan all `.ts` files under `src/` (excluding `.d.ts`).
3. Count lines for each file.
4. Warn (with yellow/amber formatting) for any file exceeding 300 lines:
   `[WARN] src/foo/bar.ts has 345 lines (exceeds 300-line recommendation)`
5. Summarize total files scanned, total files exceeding 300 lines, and longest files.
6. Return exit code `0` so existing codebase files over 300 lines produce actionable warnings without failing the verification pipeline.
7. Add `"lint:filelength": "bun scripts/check-file-length.ts"` to `package.json`.
8. Integrate into `verify.sh` and `verify.bat` as an explicit check.

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Tests) | Downstream (Consumers / Validators / Serializers) | Lateral (SSOT Registries / Docs / Sibling Files) |
| :--- | :--- | :--- | :--- |
| **1. Create `src/rulesets/dnd35e/effect_bundle.ts`** | `skills.ts`, `races.ts`, `templates.ts`, `archetype_resolver.ts`, `semantic_tags.ts`. | `evaluateEffectBundle`, `isActivationConditionMet`, `EvaluatedEffectBundleResult`. | Update `docs/ssot/ssot_dnd35e.json` with new entry; regenerate `docs/SSOT_DND35E.md`. |
| **2. Create `src/rulesets/dnd35e/semantic_tags.ts`** | `dnd35e_ruleset.ts`, `character_builder.ts`, `skill_verbs.ts`, `templates.ts`, `tests/dnd35e_phase21_primitives.test.ts`, `tests/dnd35e_skills_matrix.test.ts`. | `projectDnD35ActorSemanticTags`, `buildCreatureTypeAndSubtypeModifiers`, `resolveEntitySituationalTagContext`, `CONSTRUCT_BONUS_HP_BY_SIZE`. | Update `docs/ssot/ssot_dnd35e.json` with new entry; regenerate `docs/SSOT_DND35E.md`. |
| **3. Create `src/rulesets/dnd35e/archetype_resolver.ts`** | `dnd35e_ruleset.ts`, `dnd35e_validator.ts`, `srd_registry.ts`, `tests/dnd35e_cartridge.test.ts`, `tests/dnd35e_phase22_bestiary.test.ts`. | `hydrateArchetypeData`, `hydrateRaceAsArchetype`, `getDnD35Archetype`, `buildAbilityScoresRecord`. | Update `docs/ssot/ssot_dnd35e.json` with new entry; regenerate `docs/SSOT_DND35E.md`. |
| **4. Streamline `src/rulesets/dnd35e/srd_registry.ts`** | `character_builder.ts`, `level_ledger.ts`, `skill_verbs.ts`, `src/rulesets/registry.ts`, `tests/dnd35e_classes_builder.test.ts`, `tests/dnd35e_combat_traversal_wiring.test.ts`. | `getDnD35EntityData`, `setDnD35EntityData`, `getEquippedItemBonuses`, `resolveDamageTypeFromTags`, `getDnD35Race`, `getDnD35Template`. | Update `docs/ssot/ssot_dnd35e.json` responsibility and canonical entry points for `srd_registry.ts`. |
| **5. Add `scripts/check-file-length.ts` and update `verify.sh` & `verify.bat`** | `package.json` (`"lint:filelength"`), `verify.sh`, `verify.bat`. | All developers and CI runs will receive warnings for files > 300 lines. | `tsconfig.scripts.json` checks script compilation; `AGENTS.md` Rule 8 compliance. |

---

## 5. Architectural Alignment & Anti-Patterns to Prevent

1. **Anti-Pattern: Barrel Files:** Do not create `index.ts` re-export hubs (`AGENTS.md` Rule 8). Direct imports must be used everywhere.
2. **Anti-Pattern: Circular Dependencies:**
   - `effect_bundle.ts` imports from `modifiers.ts` and `dnd35e_system.types.ts`.
   - `semantic_tags.ts` imports from `effect_bundle.ts`, `modifiers.ts`, `ecs.ts`, `components.types.ts`.
   - `archetype_resolver.ts` imports from `semantic_tags.ts`, `family_synthesizer.ts`, `progression.ts`, `abilities.ts`.
   - `srd_registry.ts` imports from `archetype_resolver.ts`, `semantic_tags.ts`, `ecs.ts`.
   - The dependency graph flows strictly unidirectionally without cycles, passing `bun run lint:arch` with 0 violations.
3. **SSOT Parity:** `docs/ssot/ssot_dnd35e.json` must be updated with the 3 new files and the trimmed `srd_registry.ts`. `bun run scripts/run-validator.ts` will verify 100% SSOT parity.
