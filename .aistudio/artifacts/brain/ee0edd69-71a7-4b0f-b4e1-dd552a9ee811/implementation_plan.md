# Implementation Plan: SRD Registry Decomposition & File Length Warning Check

## Executive Summary
This plan addresses two critical engineering improvements:
1. **Decomposing `src/rulesets/dnd35e/srd_registry.ts` (1,154 lines)** into four focused, single-concern modules adhering to `AGENTS.md` Rule 8 (one concern per file, files <= 250–300 lines, no barrel files):
   - `src/rulesets/dnd35e/effect_bundle.ts` (~120 lines): Pure `DnD35EffectBundle` activation & evaluation with hierarchical `sourcePath` tagging.
   - `src/rulesets/dnd35e/semantic_tags.ts` (~230 lines): Creature type/subtype effect providers, situational equipment context resolution, and Horizon 3 actor semantic self-tag projection.
   - `src/rulesets/dnd35e/archetype_resolver.ts` (~260 lines): Race-to-archetype hydration, dragon/elemental delegation to `family_synthesizer.ts`, progression tracks, and runtime entity data hydration.
   - `src/rulesets/dnd35e/srd_registry.ts` (~140 lines): Pure entity data get/set facade, equipped item bonus calculator, and system content lookup helpers.
2. **Adding a Verification File Length Warning Check (`scripts/check-file-length.ts`)**:
   - Scans all `.ts` files under `src/` (excluding `.d.ts`).
   - Emits a styled warning for any file exceeding 300 lines.
   - Integrated as `"lint:filelength"` in `package.json`, `verify.sh`, and `verify.bat`.
   - Returns exit code 0 to serve as an actionable, non-fatal advisory check without breaking the existing verification pipeline.

---

## 1. SSOT Ownership & Old-Brain Eviction Table

| Responsibility / Symbol | Legacy Location | New Canonical SSOT Location | Rationale & Boundaries |
| :--- | :--- | :--- | :--- |
| `EvaluatedEffectBundleResult` | `srd_registry.ts` | `src/rulesets/dnd35e/effect_bundle.ts` | Type definition for evaluated effect bundle results. |
| `isActivationConditionMet` | `srd_registry.ts` | `src/rulesets/dnd35e/effect_bundle.ts` | Pure boolean check evaluating `selfTagsAll`, `selfTagsAny`, `selfTagsNone`. |
| `evaluateEffectBundle` | `srd_registry.ts` | `src/rulesets/dnd35e/effect_bundle.ts` | Evaluates modifiers, overrides, granted tags/feats, immunities, tagging `sourcePath`. |
| `CONSTRUCT_BONUS_HP_BY_SIZE` | `srd_registry.ts` | `src/rulesets/dnd35e/semantic_tags.ts` | Constant bonus HP lookup table for Construct creature type. |
| `buildCreatureTypeAndSubtypeModifiers` | `srd_registry.ts` | `src/rulesets/dnd35e/semantic_tags.ts` | Generates declarative modifiers for Construct bonus HP and Incorporeal deflection AC. |
| `SituationalTagContext` | `srd_registry.ts` | `src/rulesets/dnd35e/semantic_tags.ts` | Interface representing situational equipment and physical condition context. |
| `HEAVY_ARMOR_BONUS_THRESHOLD`, `MEDIUM_ARMOR_BONUS_THRESHOLD`, `DEFAULT_ACROBATIC_SKILL_THRESHOLD_RANKS` | `srd_registry.ts` | `src/rulesets/dnd35e/semantic_tags.ts` | Numerical thresholds for armor categorization and synergy tags. |
| `projectDnD35ActorSemanticTags` | `srd_registry.ts` | `src/rulesets/dnd35e/semantic_tags.ts` | Horizon 3 dynamic projection of semantic self-tags from entity state. |
| `resolveEntitySituationalTagContext` | `srd_registry.ts` | `src/rulesets/dnd35e/semantic_tags.ts` | Inspects live ECS equipment slots to construct `SituationalTagContext`. |
| `buildAbilityScoresRecord` | `srd_registry.ts` | `src/rulesets/dnd35e/archetype_resolver.ts` | Converts partial ability score objects into fully populated records with default 10. |
| `hydrateRaceAsArchetype` | `srd_registry.ts` | `src/rulesets/dnd35e/archetype_resolver.ts` | Converts unified `races/<id>.json` schema into `DnD35Archetype`. |
| `DEFAULT_PLAYER_ARCHETYPE`, `DEFAULT_CREATURE_ARCHETYPE` | `srd_registry.ts` | `src/rulesets/dnd35e/archetype_resolver.ts` | Fallback archetype constants. |
| `getDnD35Archetype` | `srd_registry.ts` | `src/rulesets/dnd35e/archetype_resolver.ts` | Resolves archetypes with dragon/elemental parametric delegation. |
| `hydrateArchetypeData` | `srd_registry.ts` | `src/rulesets/dnd35e/archetype_resolver.ts` | Hydrates raw runtime `DnD35EntityData` from an archetype. |
| `getDnD35EntityData` | `srd_registry.ts` | `src/rulesets/dnd35e/srd_registry.ts` (retained) | Reads or lazily hydrates `DnD35EntityData` from ECS components. |
| `setDnD35EntityData` | `srd_registry.ts` | `src/rulesets/dnd35e/srd_registry.ts` (retained) | Writes updated `DnD35EntityData` back to ECS `RulesetDataComponent`. |
| `getEquippedItemBonuses` | `srd_registry.ts` | `src/rulesets/dnd35e/srd_registry.ts` (retained) | Inspects equipped items for attack/armor bonuses. |
| `resolveDamageTypeFromTags` | `srd_registry.ts` | `src/rulesets/dnd35e/srd_registry.ts` (retained) | Extracts canonical damage type from item tags. |
| `getDnD35Race`, `getDnD35Template`, `getDnD35CreatureTypeEngine`, `getDnD35Subtype` | `srd_registry.ts` | `src/rulesets/dnd35e/srd_registry.ts` (retained) | Lookup helpers for system content registries. |

---

## 2. Cascading Effects Matrix (Rule 15)

| Change | Upstream Callers & Call Sites | Downstream Consumers & Data Shape | Lateral Mirrors & Registries |
| :--- | :--- | :--- | :--- |
| **1. Create `effect_bundle.ts`** | `skills.ts`, `races.ts`, `templates.ts`, `semantic_tags.ts`, `archetype_resolver.ts`. Direct imports updated. | Consumes `DnD35EffectBundle`, `StatModifier`. Output shape `EvaluatedEffectBundleResult` is unchanged. | Add entry to `docs/ssot/ssot_dnd35e.json`; regenerate `docs/SSOT_DND35E.md`. |
| **2. Create `semantic_tags.ts`** | `dnd35e_ruleset.ts`, `character_builder.ts`, `skill_verbs.ts`, `templates.ts`, `tests/dnd35e_phase21_primitives.test.ts`, `tests/dnd35e_skills_matrix.test.ts`. Direct imports updated. | Consumes `GameState`, `EntityId`, `DnD35EntityData`. Returns `ReadonlyArray<string>`. Data shape unchanged. | Add entry to `docs/ssot/ssot_dnd35e.json`; regenerate `docs/SSOT_DND35E.md`. |
| **3. Create `archetype_resolver.ts`** | `dnd35e_ruleset.ts`, `dnd35e_validator.ts`, `srd_registry.ts`, `tests/dnd35e_cartridge.test.ts`, `tests/dnd35e_phase22_bestiary.test.ts`. Direct imports updated. | Consumes `DnD35Race`, `CampaignData`. Returns `DnD35Archetype` and `DnD35EntityData`. Data shape unchanged. | Add entry to `docs/ssot/ssot_dnd35e.json`; regenerate `docs/SSOT_DND35E.md`. |
| **4. Slim down `srd_registry.ts`** | `character_builder.ts`, `level_ledger.ts`, `skill_verbs.ts`, `src/rulesets/registry.ts`, `tests/dnd35e_classes_builder.test.ts`, `tests/dnd35e_combat_traversal_wiring.test.ts`. Direct imports retained. | Consumes `GameState`, `EntityId`. Returns `DnD35EntityData`. Retains entity access facade. | Update entry in `docs/ssot/ssot_dnd35e.json`; regenerate `docs/SSOT_DND35E.md`. |
| **5. Add `scripts/check-file-length.ts`** | `package.json` (`"lint:filelength"`), `verify.sh` (Step 4b), `verify.bat` (Step 4b). | Scans all `.ts` files under `src/` (excluding `.d.ts`). Reports line count warnings. | `tsconfig.scripts.json` includes `scripts/*.ts`. |

---

## 3. Step-by-Step Implementation Flow

### Step 1: Create `src/rulesets/dnd35e/effect_bundle.ts`
- Extract `EvaluatedEffectBundleResult`, `isActivationConditionMet`, and `evaluateEffectBundle`.
- Retain exact logic, comments, and strict typing.
- Import `appendSourcePath` from `./modifiers.ts`.
- File length: ~125 lines (well within the <= 250–300 limit).

### Step 2: Create `src/rulesets/dnd35e/semantic_tags.ts`
- Extract `CONSTRUCT_BONUS_HP_BY_SIZE`, `buildCreatureTypeAndSubtypeModifiers`.
- Extract `SituationalTagContext`, `HEAVY_ARMOR_BONUS_THRESHOLD`, `MEDIUM_ARMOR_BONUS_THRESHOLD`, `DEFAULT_ACROBATIC_SKILL_THRESHOLD_RANKS`.
- Extract `projectDnD35ActorSemanticTags` and `resolveEntitySituationalTagContext`.
- Import `evaluateEffectBundle` from `./effect_bundle.ts` and `appendSourcePath` from `./modifiers.ts`.
- Import ECS functions from `../../core/ecs.ts` and component types from `../../types/components.types.ts`.
- File length: ~245 lines (within the <= 250–300 limit).

### Step 3: Create `src/rulesets/dnd35e/archetype_resolver.ts`
- Extract `buildAbilityScoresRecord`, `hydrateRaceAsArchetype`.
- Extract `DEFAULT_PLAYER_ARCHETYPE`, `DEFAULT_CREATURE_ARCHETYPE`.
- Extract `getDnD35Archetype` (including delegation to `synthesizeDragonVarietyArchetype` and `synthesizeElementalSizeArchetype`).
- Extract `hydrateArchetypeData`.
- Import `buildCreatureTypeAndSubtypeModifiers` from `./semantic_tags.ts`.
- Import `synthesizeDragonVarietyArchetype`, `synthesizeElementalSizeArchetype` from `./family_synthesizer.ts`.
- Import `getDnD35ClassProgressionTrack` from `./progression.ts`.
- Import `DEFAULT_RACIAL_STAT_ALLOCATION`, `DND35E_DEFAULT_ABILITY_VALUE` from `./abilities.ts`.
- File length: ~270 lines (within the <= 300 limit).

### Step 4: Refactor `src/rulesets/dnd35e/srd_registry.ts`
- Retain only entity data get/set facade: `getDnD35EntityData`, `setDnD35EntityData`, `getEquippedItemBonuses`, `resolveDamageTypeFromTags`.
- Retain system content lookups: `getDnD35Race`, `getDnD35Template`, `getDnD35CreatureTypeEngine`, `getDnD35Subtype`.
- Remove the extracted code blocks.
- In `srd_registry.ts`, import `getDnD35Archetype` and `hydrateArchetypeData` from `./archetype_resolver.ts`.
- Also re-export the extracted symbols with deprecation JSDoc or direct re-exports to preserve backward compatibility for any existing call site, while updating direct consumers.
- File length: ~175 lines (drastic reduction from 1,154 lines!).

### Step 5: Update Call Sites Across Codebase & Tests
- Update call sites that specifically use `projectDnD35ActorSemanticTags`, `buildCreatureTypeAndSubtypeModifiers`, `evaluateEffectBundle`, `hydrateArchetypeData`, etc., to directly import from their dedicated modules (`semantic_tags.ts`, `effect_bundle.ts`, `archetype_resolver.ts`).
- Verify no barrel file violations (`AGENTS.md` Rule 8).

### Step 6: Create `scripts/check-file-length.ts` & Update Verification Pipeline
- Create `scripts/check-file-length.ts`:
  - Scans `src/**/*.ts` (ignoring `.d.ts`).
  - Measures line count (`content.split('\n').length`).
  - Formats styled warnings using standard ANSI terminal colors for any file with line count > 300.
  - Displays summary: Total files scanned, count of files > 300 lines, top 5 longest files.
  - Exits with code 0 (warning check).
- In `package.json`, add `"lint:filelength": "bun scripts/check-file-length.ts"`.
- In `verify.sh`, add `[4b/8]`:
  ```bash
  echo ""
  echo "[4b/8] Checking file lengths (<= 300 lines warning check)..."
  bun run lint:filelength
  ```
- In `verify.bat`, add matching step for Windows environment.

### Step 7: Update SSOT Registries & Regenerate Codebase Maps
- Update `docs/ssot/ssot_dnd35e.json`:
  - Add entries for `src/rulesets/dnd35e/effect_bundle.ts`, `src/rulesets/dnd35e/semantic_tags.ts`, and `src/rulesets/dnd35e/archetype_resolver.ts`.
  - Update entry for `src/rulesets/dnd35e/srd_registry.ts` to reflect its narrowed responsibility and canonical entry points.
- Run `bun scripts/map-codebase.ts` to regenerate `docs/SSOT_DND35E.md`.
- Run `bun run scripts/run-validator.ts` to verify 100% SSOT parity.

### Step 8: Execute Full 8-Stage Verification Pipeline
- Run `./verify.sh` to execute all stages:
  1. TypeScript check (`bun x tsc --noEmit`)
  2. Format check (`bun run format`)
  3. Lint check (`bun run lint --fix`)
  4. Architectural dependency check (`bun run lint:arch`)
  5. File length warning check (`bun run lint:filelength`)
  6. Dead-code check (`bun run lint:deadcode`)
  7. Regression tests (`bun test`)
  8. Build check (`bun run build`)
  9. Campaign, ruleset & SSOT parity validation (`bun run scripts/run-validator.ts`)
- Verify all stages pass with 0 errors.

---

## 4. Code Diffs & Integration Previews

### Preview: `scripts/check-file-length.ts`
```typescript
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(process.cwd(), 'src');
const MAX_RECOMMENDED_LINES = 300;

interface FileLengthReport {
  readonly filePath: string;
  readonly relativePath: string;
  readonly lines: number;
}

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

export function runFileLengthCheck(): void {
  const files = collectTsFiles(SRC_DIR);
  const reports: FileLengthReport[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').length;
    reports.push({
      filePath: file,
      relativePath: path.relative(process.cwd(), file),
      lines,
    });
  }

  const warnings = reports.filter((r) => r.lines > MAX_RECOMMENDED_LINES);
  warnings.sort((a, b) => b.lines - a.lines);

  console.log('====================================');
  console.log('File Length Check (Target <= 300 lines per AGENTS.md Rule 8)');
  console.log('====================================');
  console.log(`Scanned ${files.length} TypeScript files under src/`);

  if (warnings.length === 0) {
    console.log('✅ All TypeScript files are under 300 lines!');
  } else {
    console.log(`⚠️  Found ${warnings.length} file(s) exceeding ${MAX_RECOMMENDED_LINES} lines:`);
    for (const w of warnings) {
      console.log(`   - ${w.relativePath}: ${w.lines} lines`);
    }
  }
}

if (import.meta.main) {
  runFileLengthCheck();
}
```

### Preview: `verify.sh` Addition
```bash
echo ""
echo "[4b/8] Checking file lengths (<= 300 lines warning check)..."
bun run lint:filelength
```

---

## 5. Manual Playtest & Verification Scenarios
1. **Verification Pipeline:** Run `./verify.sh` and observe step `[4b/8]` reporting file length warnings in real time while all 8 standard verification steps pass with 0 errors.
2. **Character Builder & Archetypes:** Launch the game, enter the Character Builder, select various races (Human, Elf, Fiendish Dire Rat, etc.), and verify ability score synthesis, RHD progressions, natural weapons, and semantic tag projection work seamlessly.
3. **Combat Verification:** Start a combat encounter with a creature having Construct or Incorporeal traits (e.g. Incorporeal Deflection AC or Construct Bonus HP) and confirm combat calculation and attack resolution function identically.
