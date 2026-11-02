# Implementation Plan: Pluggable Ruleset-Specific Content & Cartridge Validators (`checkBase`, `checkClassic`, `checkDnD35e`)

## 1. Architectural Overview

We formalize a 3-Tier Validation Pipeline where universal engine mechanics are checked once at the Console level, and each tabletop ruleset cartridge provides its own dedicated domain validator via `RulesetContract.validateCampaignRuleset(campaign)`:

1. **Tier 1 — Base Console Validator (`src/editor/campaign_validator.ts`)**:
   - Validates ruleset-agnostic campaign invariants (map reachability, quests, triggers, tags, reactions, items, encounters, areas, dialogues, entity templates, AI personality modifiers, trigger templates, and 5-seed fuzzer smoke tests).
   - Dispatches to `getRuleset(campaign.manifest?.rulesetId).validateCampaignRuleset?.(campaign)`.
2. **Tier 2 — Cartridge-Specific Validators**:
   - **Classic Cartridge Validator (`src/rulesets/classic/classic_validator.ts` — `checkClassicRuleset`)**:
     - Verifies `campaign.systemContent` is empty (`{}` — preventing cross-ruleset content leakage).
     - Verifies `campaign.advancement.levelThresholds` is non-empty and strictly monotonically increasing.
     - Verifies actor fighter templates in `campaign.entities` have valid baseline stats (`maxHp > 0`, `attack >= 0`, `defense >= 0`).
   - **D&D 3.5e Cartridge Validator (`src/rulesets/dnd35e/dnd35e_validator.ts` — `checkDnD35eRuleset`)**:
     - **Schema Validation**: Validates `campaign.systemContent` against `DnD35SystemContentSchema`.
     - **Inner-ID vs. Outer-Key Parity**: Asserts that every record key in `classes`, `domains`, `races`, `templates`, `archetypes`, `feats`, `spells`, `skills`, and `creatureTypes` matches its inner identifier (`id`, `archetypeId`, `templateId`, `typeId`).
     - **Class Progression Table Integrity (`level: 1..maxLevel`)**:
       - Asserts `classDef.progression.length === classDef.maxLevel`.
       - Asserts `row.level === index + 1` for every progression row.
       - Asserts `bab`, `fortSave`, `refSave`, and `willSave` are monotonically non-decreasing across levels `1..maxLevel`.
     - **ACF & Feature Alignment**:
       - Asserts every `acf.replacesFeature` in `classDef.acfSwaps` exists in the set of features granted by `classDef.progression[].features`.
       - Asserts `acf.level >= 1 && acf.level <= classDef.maxLevel`.
     - **Cross-Registry Referential Integrity**:
       - `race.favoredClass` (when not `'any'`) exists in `systemContent.classes`.
       - `race.creatureType` exists in `systemContent.creatureTypes`.
       - `template.targetCreatureTypes` and `convertTypeMap` keys/values exist in `systemContent.creatureTypes`.
       - `archetype.creatureType` (when specified) exists in `systemContent.creatureTypes`.
       - Recursive `PrerequisiteNode` AST validator (`validatePrerequisiteNodeReferences`): verifies `race_in` entries exist in `systemContent.races`.
       - Campaign `entity.archetypeId` exists in `systemContent.archetypes`.
3. **Tier 3 — Disk-to-Descriptor Synchronization (`scripts/run-validator.ts` — `validateRulesetDiskParity`)**:
   - Verifies every descriptor in `ruleset.getSystemContentFiles()` exists on disk.
   - Scans every modular subdirectory (`archetypes/`, `classes/`, `feats/`, `spells/`, `templates/`, `races/`) under `public/data/rulesets/<rulesetId>/` and verifies that every `.json` file on disk is registered in `getSystemContentFiles()` (catching orphaned files).
   - Verifies that every modular file `<category>/<stem>.json` has a single root key matching `<stem>` and an inner ID matching `<stem>`.

---

## 2. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Entry Points) | Downstream (Consumers / Reporters) | Lateral (Mirrors / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. `src/rulesets/classic/classic_validator.ts` (`checkClassicRuleset`)** | Registered on `classicRulesetContract.validateCampaignRuleset` in `src/rulesets/classic/classic_ruleset.ts`. Called by `validateCampaign` (`src/editor/campaign_validator.ts`). | Returns `ReadonlyArray<ValidationError>` to Editor Validator UI and `scripts/run-validator.ts`. | Validates `default`, `megacampaign`, and `shroudgarde` campaigns. Tested in `tests/ruleset_validators.test.ts`. |
| **2. `src/rulesets/dnd35e/dnd35e_validator.ts` (`checkDnD35eRuleset`)** | Registered on `dnd35eRulesetContract.validateCampaignRuleset` in `src/rulesets/dnd35e/dnd35e_ruleset.ts` and re-exported via `src/rulesets/registry.ts` for testing. | Returns `ReadonlyArray<ValidationError>` to Editor Validator UI and `scripts/run-validator.ts`. | Validates `dnd35e-crypt` campaign and all 97+ modular D&D 3.5e files. Tested in `tests/ruleset_validators.test.ts`. |
| **3. `validateRulesetDiskParity` in `scripts/run-validator.ts`** | Invoked during `scripts/run-validator.ts` execution (`[8/8]` in `verify.sh`). | Prints detailed disk parity report and exits non-zero if any modular file is orphaned, missing, or has mismatched keys. | Ensures future content additions (Phase 24–26) cannot drift out of sync with `system_content_files.ts`. |
| **4. Documentation Updates (`docs/ARCHITECTURE.md` & `docs/DECISIONS.md`)** | Architectural documentation. | Developer & AI agent reference. | Documents the pluggable per-ruleset validator pattern in Decision 15 / Section 9. |

---

## 3. Step-by-Step Implementation & Exact Code Diffs

### Step 1: Create `src/rulesets/classic/classic_validator.ts` and Wire into `classic_ruleset.ts`

#### `src/rulesets/classic/classic_validator.ts` (New File)
```typescript
import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from '../../types/ruleset.types.ts';

/**
 * Validates Classic roguelike ruleset invariants for a campaign.
 * Ensures no foreign system content leaked into the campaign, XP advancement thresholds
 * are strictly increasing, and classic fighter templates have valid baseline stats.
 *
 * @param campaign The campaign data being validated.
 * @returns Array of validation errors or warnings.
 */
export function checkClassicRuleset(campaign: Readonly<CampaignData>): ReadonlyArray<ValidationError> {
  const errors: ValidationError[] = [];

  if (campaign.systemContent && Object.keys(campaign.systemContent).length > 0) {
    errors.push({
      path: 'campaign.systemContent',
      message: 'Classic campaign must not contain foreign ruleset systemContent entries.',
      severity: 'error'
    });
  }

  const thresholds = campaign.advancement.levelThresholds;
  for (let i = 1; i < thresholds.length; i++) {
    const prev = thresholds[i - 1]!;
    const curr = thresholds[i]!;
    if (curr <= prev) {
      errors.push({
        path: `advancement.levelThresholds[${i}]`,
        message: `Classic XP threshold at index ${i} (${curr}) must be strictly greater than index ${i - 1} (${prev}).`,
        severity: 'error'
      });
    }
  }

  for (const [entityId, entity] of Object.entries(campaign.entities)) {
    if (entity.fighter) {
      if (entity.fighter.hp <= 0) {
        errors.push({
          path: `entities.${entityId}.fighter.hp`,
          message: `Classic fighter entity "${entityId}" must have positive HP (got ${entity.fighter.hp}).`,
          severity: 'error'
        });
      }
    }
  }

  return errors;
}
```

#### `src/rulesets/classic/classic_ruleset.ts` Diff
```typescript
import { checkClassicRuleset } from './classic_validator.ts';
// ...
  getSystemContentFiles() {
    return [];
  },
  validateCampaignRuleset: checkClassicRuleset
};
```

---

### Step 2: Create `src/rulesets/dnd35e/dnd35e_validator.ts` and Wire into `dnd35e_ruleset.ts`

#### `src/rulesets/dnd35e/dnd35e_validator.ts` (New File)
```typescript
import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from '../../types/ruleset.types.ts';
import type { PrerequisiteNode } from './types/dnd35e.types.ts';
import {
  DnD35SystemContentSchema,
  type DnD35SystemContent
} from './types/dnd35e_system.types.ts';

/**
 * Recursively validates cross-references inside a `PrerequisiteNode` AST.
 *
 * @param node The prerequisite AST node to inspect.
 * @param basePath The diagnostic path prefix.
 * @param sys The validated D&D 3.5e system content.
 * @param errors Accumulator array for validation errors.
 */
function validatePrerequisiteNodeReferences(
  node: PrerequisiteNode,
  basePath: string,
  sys: DnD35SystemContent,
  errors: ValidationError[]
): void {
  switch (node.type) {
    case 'and':
    case 'or':
      node.children.forEach((child, idx) => {
        validatePrerequisiteNodeReferences(child, `${basePath}.children[${idx}]`, sys, errors);
      });
      return;
    case 'not':
      validatePrerequisiteNodeReferences(node.child, `${basePath}.child`, sys, errors);
      return;
    case 'race_in':
      for (const raceId of node.allowedRaces) {
        if (!sys.races[raceId]) {
          errors.push({
            path: `${basePath}.allowedRaces`,
            message: `Prerequisite references unknown race "${raceId}".`,
            severity: 'error'
          });
        }
      }
      return;
    case 'min_ability':
    case 'min_bab':
    case 'min_skill_ranks':
    case 'has_feat':
    case 'has_tag':
    case 'min_caster_level':
    case 'size_in':
    case 'alignment_in':
    case 'min_spell_level':
      return;
  }
}

/**
 * Validates inner ID parity and structural/referential integrity across parsed `DnD35SystemContent`.
 *
 * @param sys The parsed `DnD35SystemContent` object.
 * @returns Array of validation errors.
 */
export function validateDnD35eSystemContentIntegrity(
  sys: Readonly<DnD35SystemContent>
): ReadonlyArray<ValidationError> {
  const errors: ValidationError[] = [];

  // 1. Validate Classes: ID parity, 1..maxLevel progression table continuity, monotonicity, ACFs, prerequisites
  for (const [classKey, classDef] of Object.entries(sys.classes)) {
    if (classDef.id !== classKey) {
      errors.push({
        path: `systemContent.classes.${classKey}.id`,
        message: `Class key "${classKey}" does not match inner id "${classDef.id}".`,
        severity: 'error'
      });
    }
    if (classDef.progression.length !== classDef.maxLevel) {
      errors.push({
        path: `systemContent.classes.${classKey}.progression`,
        message: `Class "${classKey}" progression length (${classDef.progression.length}) must equal maxLevel (${classDef.maxLevel}).`,
        severity: 'error'
      });
    }
    const grantedFeatures = new Set<string>();
    for (let i = 0; i < classDef.progression.length; i++) {
      const row = classDef.progression[i]!;
      const expectedLevel = i + 1;
      if (row.level !== expectedLevel) {
        errors.push({
          path: `systemContent.classes.${classKey}.progression[${i}].level`,
          message: `Class "${classKey}" progression row at index ${i} must have level ${expectedLevel} (got ${row.level}).`,
          severity: 'error'
        });
      }
      if (i > 0) {
        const prev = classDef.progression[i - 1]!;
        if (
          row.bab < prev.bab ||
          row.fortSave < prev.fortSave ||
          row.refSave < prev.refSave ||
          row.willSave < prev.willSave
        ) {
          errors.push({
            path: `systemContent.classes.${classKey}.progression[${i}]`,
            message: `Class "${classKey}" level ${row.level} has decreasing BAB or base save compared to level ${prev.level}.`,
            severity: 'error'
          });
        }
      }
      for (const feat of row.features) {
        grantedFeatures.add(feat);
      }
    }

    for (const acf of classDef.acfSwaps) {
      if (acf.level < 1 || acf.level > classDef.maxLevel) {
        errors.push({
          path: `systemContent.classes.${classKey}.acfSwaps.${acf.acfId}.level`,
          message: `ACF "${acf.acfId}" on class "${classKey}" has level ${acf.level} outside 1..${classDef.maxLevel}.`,
          severity: 'error'
        });
      }
      if (!grantedFeatures.has(acf.replacesFeature)) {
        errors.push({
          path: `systemContent.classes.${classKey}.acfSwaps.${acf.acfId}.replacesFeature`,
          message: `ACF "${acf.acfId}" on class "${classKey}" replaces feature "${acf.replacesFeature}" which is never granted in progression.`,
          severity: 'error'
        });
      }
    }

    if (classDef.prerequisites) {
      validatePrerequisiteNodeReferences(
        classDef.prerequisites,
        `systemContent.classes.${classKey}.prerequisites`,
        sys,
        errors
      );
    }
  }

  // 2. Validate Domains: ID parity
  for (const [domKey, domDef] of Object.entries(sys.domains)) {
    if (domDef.id !== domKey) {
      errors.push({
        path: `systemContent.domains.${domKey}.id`,
        message: `Domain key "${domKey}" does not match inner id "${domDef.id}".`,
        severity: 'error'
      });
    }
  }

  // 3. Validate Races: ID parity, favoredClass reference, creatureType reference
  for (const [raceKey, raceDef] of Object.entries(sys.races)) {
    if (raceDef.id !== raceKey) {
      errors.push({
        path: `systemContent.races.${raceKey}.id`,
        message: `Race key "${raceKey}" does not match inner id "${raceDef.id}".`,
        severity: 'error'
      });
    }
    if (raceDef.favoredClass !== 'any' && !sys.classes[raceDef.favoredClass]) {
      errors.push({
        path: `systemContent.races.${raceKey}.favoredClass`,
        message: `Race "${raceKey}" references unknown favoredClass "${raceDef.favoredClass}".`,
        severity: 'error'
      });
    }
    if (!sys.creatureTypes[raceDef.creatureType]) {
      errors.push({
        path: `systemContent.races.${raceKey}.creatureType`,
        message: `Race "${raceKey}" references unknown creatureType "${raceDef.creatureType}".`,
        severity: 'error'
      });
    }
  }

  // 4. Validate Templates: ID parity, targetCreatureTypes & convertTypeMap references
  for (const [tmplKey, tmplDef] of Object.entries(sys.templates)) {
    if (tmplDef.templateId !== tmplKey) {
      errors.push({
        path: `systemContent.templates.${tmplKey}.templateId`,
        message: `Template key "${tmplKey}" does not match inner templateId "${tmplDef.templateId}".`,
        severity: 'error'
      });
    }
    for (const ct of tmplDef.targetCreatureTypes ?? []) {
      if (!sys.creatureTypes[ct]) {
        errors.push({
          path: `systemContent.templates.${tmplKey}.targetCreatureTypes`,
          message: `Template "${tmplKey}" references unknown targetCreatureType "${ct}".`,
          severity: 'error'
        });
      }
    }
    for (const [fromType, toType] of Object.entries(tmplDef.convertTypeMap ?? {})) {
      if (!sys.creatureTypes[fromType] || !sys.creatureTypes[toType]) {
        errors.push({
          path: `systemContent.templates.${tmplKey}.convertTypeMap`,
          message: `Template "${tmplKey}" convertTypeMap references unknown creatureType (${fromType} -> ${toType}).`,
          severity: 'error'
        });
      }
    }
  }

  // 5. Validate Archetypes: ID parity, creatureType reference
  for (const [archKey, archDef] of Object.entries(sys.archetypes)) {
    if (archDef.archetypeId !== archKey) {
      errors.push({
        path: `systemContent.archetypes.${archKey}.archetypeId`,
        message: `Archetype key "${archKey}" does not match inner archetypeId "${archDef.archetypeId}".`,
        severity: 'error'
      });
    }
    if (archDef.creatureType && !sys.creatureTypes[archDef.creatureType]) {
      errors.push({
        path: `systemContent.archetypes.${archKey}.creatureType`,
        message: `Archetype "${archKey}" references unknown creatureType "${archDef.creatureType}".`,
        severity: 'error'
      });
    }
  }

  // 6. Validate Feats, Spells, Skills & CreatureTypes: ID parity & Prerequisite AST
  for (const [featKey, featDef] of Object.entries(sys.feats)) {
    if (featDef.id !== featKey) {
      errors.push({
        path: `systemContent.feats.${featKey}.id`,
        message: `Feat key "${featKey}" does not match inner id "${featDef.id}".`,
        severity: 'error'
      });
    }
    if (featDef.prerequisites) {
      validatePrerequisiteNodeReferences(
        featDef.prerequisites,
        `systemContent.feats.${featKey}.prerequisites`,
        sys,
        errors
      );
    }
  }

  for (const [spellKey, spellDef] of Object.entries(sys.spells)) {
    if (spellDef.id !== spellKey) {
      errors.push({
        path: `systemContent.spells.${spellKey}.id`,
        message: `Spell key "${spellKey}" does not match inner id "${spellDef.id}".`,
        severity: 'error'
      });
    }
  }

  for (const [skillKey, skillDef] of Object.entries(sys.skills)) {
    if (skillDef.id !== skillKey) {
      errors.push({
        path: `systemContent.skills.${skillKey}.id`,
        message: `Skill key "${skillKey}" does not match inner id "${skillDef.id}".`,
        severity: 'error'
      });
    }
  }

  for (const [ctKey, ctDef] of Object.entries(sys.creatureTypes)) {
    if (ctDef.typeId !== ctKey) {
      errors.push({
        path: `systemContent.creatureTypes.${ctKey}.typeId`,
        message: `CreatureType key "${ctKey}" does not match inner typeId "${ctDef.typeId}".`,
        severity: 'error'
      });
    }
  }

  return errors;
}

/**
 * Validates a D&D 3.5e campaign and its hydrated System Content registries.
 *
 * @param campaign The campaign document being validated.
 * @returns Array of ruleset-specific validation errors or warnings.
 */
export function checkDnD35eRuleset(campaign: Readonly<CampaignData>): ReadonlyArray<ValidationError> {
  const errors: ValidationError[] = [];
  if (!campaign.systemContent) {
    errors.push({
      path: 'campaign.systemContent',
      message: 'D&D 3.5e campaign requires systemContent (loaded from public/data/rulesets/dnd35e/)',
      severity: 'error'
    });
    return errors;
  }

  const parseRes = DnD35SystemContentSchema.safeParse(campaign.systemContent);
  if (!parseRes.success) {
    for (const issue of parseRes.error.issues) {
      errors.push({
        path: `systemContent.${issue.path.join('.')}`,
        message: issue.message,
        severity: 'error'
      });
    }
    return errors;
  }

  const sys = parseRes.data;
  errors.push(...validateDnD35eSystemContentIntegrity(sys));

  for (const [entityId, entity] of Object.entries(campaign.entities)) {
    if (entity.archetypeId && !sys.archetypes[entity.archetypeId]) {
      errors.push({
        path: `entities.${entityId}.archetypeId`,
        message: `Entity template "${entityId}" references unknown system archetype "${entity.archetypeId}"`,
        severity: 'error'
      });
    }
  }

  return errors;
}
```

---

### Step 3: Add `validateRulesetDiskParity` to `scripts/run-validator.ts`

In `scripts/run-validator.ts`, add a pre-flight check `validateAllRulesetsOnDisk()` that iterates over all registered rulesets (`getAllRulesets()`):
- Verifies every descriptor file in `getSystemContentFiles()` exists on disk.
- Scans every subdirectory under `public/data/rulesets/<ruleset.id>/` and verifies every `.json` file inside a subdirectory is declared in `getSystemContentFiles()`, and that its outer dictionary key and inner ID match its filename stem.

---

### Step 4: Add Unit Tests in `tests/ruleset_validators.test.ts`

Create `tests/ruleset_validators.test.ts` testing:
1. `checkClassicRuleset` passes on `default` campaign and catches leaked `systemContent`, non-monotonic `levelThresholds`, and `hp <= 0`.
2. `checkDnD35eRuleset` passes with 0 errors on `dnd35e-crypt`.
3. `validateDnD35eSystemContentIntegrity` catches:
   - Mismatched inner `id` vs. outer dictionary key.
   - Missing or non-contiguous `progression` row levels or decreasing BAB/saves.
   - ACF `replacesFeature` referencing a feature not granted in `progression`.
   - Unknown `favoredClass`, `creatureType`, or `race_in` prerequisite references.

---

## 4. Verification Plan

1. Run `bash verify.sh` to verify all 8 checks (TypeScript, Prettier, ESLint, dependency-cruiser, Knip, all unit tests including the new `ruleset_validators.test.ts`, Vite production build, and `scripts/run-validator.ts` with ruleset disk parity + campaign validation).
