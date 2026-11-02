# Research Notes: Ruleset-Specific Content & Cartridge Validators (`checkBase`, `checkClassic`, `checkDnD35e`)

## 1. Context & Architectural Goal

The user proposed:
> "We could create specific validators for the rule system specific content since not every system will have feats or domains, etc. So a Check base, check classic, checkdnd35, check shadowofthedemonlord, etc"

In our **Three-Tier Architecture** (`AGENTS.md` Rule 16):
- **Tier 1 — Core Console Engine (`src/editor/campaign_validator.ts` — `checkBaseCampaign`)**:
  Validates ruleset-agnostic campaign structures shared by every RPG ruleset: map reachability, quests, triggers, tags, reactions, items, encounters, areas, dialogues, entity spawn references, AI personality facets, trigger templates, and the headless 5-seed fuzzer smoke test.
- **Tier 2 — Ruleset Cartridge Validators (`RulesetContract.validateCampaignRuleset`)**:
  Each ruleset cartridge owns its own domain validator because tabletop systems have fundamentally different schemas and invariants:
  - **`checkClassicRuleset` (`src/rulesets/classic/classic_validator.ts`)**:
    Validates Classic roguelike invariants:
    1. Classic campaigns must have empty `systemContent` (`{}` — no leaked foreign D&D 3.5e registries).
    2. `advancement.levelThresholds` must be strictly increasing (`levelThresholds[i] > levelThresholds[i - 1]`).
    3. Actor entities with `fighter` components must have positive `hp` and non-negative `attack`/`defense`.
    4. Consumable food/satiation items with `nutrition` effects have positive values.
  - **`checkDnD35eRuleset` (`src/rulesets/dnd35e/dnd35e_validator.ts`)**:
    Validates D&D 3.5e System Content (`systemContent`) and campaign-to-ruleset links:
    1. **Zod Schema Compliance**: `DnD35SystemContentSchema.safeParse(campaign.systemContent)`.
    2. **Inner-ID vs. Dictionary-Key Parity**: Every entry across `classes`, `domains`, `races`, `templates`, `archetypes`, `feats`, `spells`, `skills`, and `creatureTypes` must have its inner ID (`id`, `archetypeId`, `templateId`, `typeId`) match its outer dictionary key.
    3. **Class Progression Table Invariants (`level: 1..maxLevel`)**:
       - `classDef.progression.length === classDef.maxLevel`.
       - Every row at index `i` has `row.level === i + 1`.
       - Monotonically non-decreasing `bab`, `fortSave`, `refSave`, and `willSave` across levels `1..maxLevel`.
    4. **Alternate Class Feature (ACF) & Progression Integrity**:
       - Every `acf.replacesFeature` in `classDef.acfSwaps` must exist in the set of features actually granted by `classDef.progression[].features`.
       - `acf.level` must be within `1..classDef.maxLevel`.
    5. **Cross-Registry Referential Integrity**:
       - `race.favoredClass` (when not `'any'`) must reference a valid class ID in `systemContent.classes`.
       - `race.creatureType` must reference a valid creature type in `systemContent.creatureTypes`.
       - `template.targetCreatureTypes` and `convertTypeMap` keys/values must reference valid creature types in `systemContent.creatureTypes`.
       - `archetype.creatureType` (when defined) must reference a valid creature type in `systemContent.creatureTypes`.
       - `prerequisite` ASTs (`PrerequisiteNode`) on Prestige Classes and Feats:
         - `race_in` entries must reference valid race IDs in `systemContent.races`.
       - Campaign `entities[id].archetypeId` must resolve in `systemContent.archetypes` (or synthesized dragon/elemental family).
- **Tier 3 — Disk-to-Descriptor Synchronization (`scripts/run-validator.ts` — `validateRulesetDiskParity`)**:
  Validates on-disk file hygiene for `public/data/rulesets/<rulesetId>/`:
  1. Every descriptor in `ruleset.getSystemContentFiles()` must exist on disk.
  2. For every modular subdirectory (`archetypes/`, `classes/`, `feats/`, `spells/`, `templates/`, `races/`), every `.json` file on disk must be registered in `ruleset.getSystemContentFiles()` (no orphan files silently ignored at runtime).
  3. Every modular file `<category>/<stem>.json` must have a single top-level key equal to `<stem>` and an inner ID (`id` / `archetypeId` / `templateId`) equal to `<stem>`.

---

## 2. Audit of Current Data Against Proposed Checks

We executed a programmatic audit script against `public/data/rulesets/dnd35e/` and all 4 campaigns:
- **Disk-to-Descriptor Synchronization**: 100% match across all 6 subdirectories (`archetypes`: 51, `classes`: 21, `feats`: 11, `spells`: 5, `templates`: 13, `races`: 17).
- **Filename === Outer Key === Inner ID**: 100% match across all 118 modular files + `domains.json` + `skills.json` + `creature_types.json`.
- **Class Progression Tables**: All 21 classes have exact `1..maxLevel` contiguous rows and monotonically non-decreasing `bab`, `fortSave`, `refSave`, and `willSave`.
- **ACF Swaps**: All 11 ACFs across base classes reference valid `replacesFeature` IDs granted in `progression[].features`.
- **Races, Templates & Creature Types**: All 17 races, 13 templates, and 51 archetypes reference valid `creatureTypes` and `favoredClass` IDs.
- **Note on Phase 24 Skills & Feats**: Because `skills.json` (currently 12 core skills) and `feats/` (currently 11 core feats) are scheduled for full SRD expansion in Phase 24 (Milestones 113–114), classes and monster archetypes already reference upcoming Phase 24 skill/feat IDs (e.g., `survival`, `craft`, `dodge`, `multiattack`). Those two specific cross-checks (`classSkills -> skills.json` and `archetype.feats -> feats/`) can either emit informational diagnostics or be promoted to hard errors once Milestones 113–114 are completed. All other checks above can be enforced as **strict `severity: 'error'` checks immediately today**.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Entry Points) | Downstream (Consumers / Reporters) | Lateral (Mirrors / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Extract `checkClassicRuleset` (`src/rulesets/classic/classic_validator.ts`)** | Wired into `classicRulesetContract.validateCampaignRuleset` in `src/rulesets/classic/classic_ruleset.ts`. Invoked by `validateCampaign` (`src/editor/campaign_validator.ts`). | Surfaces `ValidationError[]` in Campaign Editor Validator Modal and CLI `scripts/run-validator.ts`. | `default`, `megacampaign`, and `shroudgarde` campaigns validated by `checkClassicRuleset` during `verify.sh`. |
| **2. Extract `checkDnD35eRuleset` (`src/rulesets/dnd35e/dnd35e_validator.ts`)** | Wired into `dnd35eRulesetContract.validateCampaignRuleset` in `src/rulesets/dnd35e/dnd35e_ruleset.ts`. Invoked by `validateCampaign`. | Surfaces `ValidationError[]` for schema, ID parity, progression table continuity, monotonicity, ACF swaps, race/template/creatureType links, Prerequisite AST race references, and campaign `archetypeId` links. | `dnd35e-crypt` campaign validated by `checkDnD35eRuleset` during `verify.sh`. Unit tests in `tests/ruleset_validators.test.ts`. |
| **3. Add `validateRulesetDiskParity` (`scripts/run-validator.ts`)** | Invoked in `scripts/run-validator.ts` before/during campaign validation for each active ruleset with files on disk. | Fails `verify.sh` if any `.json` file in `public/data/rulesets/<id>/<category>/` is orphaned, missing, or has mismatched filename/outer-key/inner-ID. | Protects all future content milestones (Phase 24–26) from accidental copy-paste ID errors or forgotten descriptor registrations. |
