# Implementation Plan — Milestone 112.5: Full-Screen 2-Pane Character Creation & Level-Up UX Overhaul, Playable Race Filtering, Full 42-Skill SRD Specifics & Class Spell-List Tagging

## 1. Architectural Rules & Standards Reiteration (`AGENTS.md` & `docs/ARCHITECTURE.md`)
- **Three-Tier Placement Heuristic (Rule 16):**
  - **Tier 2 (`src/rulesets/dnd35e/`):** Reuse and extend existing `DnD35RaceDefinitionSchema`, `DnD35SpellDefinitionSchema`, `DnD35SkillDefinitionSchema`, `skills.ts`, `character_builder.ts`, `dnd35e_validator.ts`, and `system_content_files.ts`.
  - **Tier 3 (`public/data/rulesets/dnd35e/`):** `"isPlayableRace": true` on playable race JSONs, all 42 PHB skill JSONs in `skills/*.json` (30 new + 12 existing backfilled with complete SRD `synergyFromSkills`, `synergyNotes`, `actions`, `rankThresholdModifiers`, and `take10Allowed`/`take20Allowed`), and `levelByClass` / `levelByDomain` / `description` on spell JSONs in `spells/*.json` (plus starter 0th/1st-level spells for Wizard/Sorcerer, Cleric, Druid, and Bard).
  - **UI & View Layer (`index.html`, `src/rendering/ui/dnd35e_inspector.ui.ts`, `src/rendering/ui/dnd35e_char_builder.ui.ts`, `src/rendering/ui/dnd35e_char_builder_steps.ui.ts`, `src/rendering/ui/dnd35e_level_up.ui.ts`):** Pure DOM construction via `document.createElement()` (no `.innerHTML`), persistent 2-pane split layout, scroll position (`scrollTop`) preservation across re-renders, and a single shared `dnd35e_inspector.ui.ts` module used by both Character Creation and Level-Up modals (keeping each file modular and under the ~250-line guideline).
- **TypeScript Strictness:** Zero `any`, `exactOptionalPropertyTypes: true`, explicit return types on all functions, `readonly` arrays/records, no magic numbers.

---

## 2. Existing Engine Primitives & Zero-Duplication Reuse Map

To guarantee we **never reinvent the wheel**, every part of Milestone 112.5 builds directly on existing schemas, resolvers, and Effect Provider pipelines already in `src/rulesets/dnd35e/`:

| Existing Module | Existing Exports Reused As-Is | Consolidation / Deduplication Applied |
| :--- | :--- | :--- |
| **`src/rulesets/dnd35e/types/dnd35e_system.types.ts`** | `DnD35SkillDefinitionSchema` (`id`, `name`, `keyAbility`, `trainedOnly`, `acpMultiplier`, `synergyFromSkills`, `actions`, `rankThresholdModifiers`), `DnD35SkillActionDescriptorSchema` (`actionId`, `name`, `actionCost`, `dc`, `opposedBySkill`, `description`, `onSuccessModifiers`, `onSuccessRuleOverrides`), `DnD35DeclarativeModifierSchema`, `DnD35RuleOverrideEntrySchema`. | Only add missing SRD fields (`take10Allowed`, `take20Allowed`, `retryAllowed`, `synergyNotes`, and `ruleOverrides` on `rankThresholdModifiers`; `isPlayableRace` on `DnD35RaceDefinitionSchema`; `levelByClass`, `levelByDomain`, `description` on `DnD35SpellDefinitionSchema`). |
| **`src/rulesets/dnd35e/skills.ts`** | `SYNERGY_REQUIRED_RANKS`, `SYNERGY_BONUS_AMOUNT`, `computeMaxSkillRankCap`, `computeSkillSynergyBonus`, `buildSkillRankThresholdModifiers`, `resolveSkillCheck`, `resolveOpposedCheck`, `resolveDiplomacyCheck`. | Upgrade `computeSkillSynergyBonus` in place for epic `+2` per +20 ranks; use `definition.take10Allowed` / `take20Allowed` inside `resolveSkillCheck` instead of hardcoding `skillId === 'use_magic_device'`; add `getSkillsGrantedSynergyBy` helper. |
| **`src/rulesets/dnd35e/character_builder.ts`** | `POINT_BUY_COST_TABLE`, `POINT_BUY_PRESETS`, `ELITE_ABILITY_ARRAY`, `POINT_BUY_MIN_SCORE`, `POINT_BUY_MAX_SCORE`, `calculatePointBuyCost`, `rollAbilityScores4d6DropLowest`, `calculateLevelSkillPointBudget`, `calculateSkillAllocationCost`, `validateSpecialistSchoolSelection`, `buildPrerequisiteContextForActor`. | Deduplicate `getSkillMaxRanks` to delegate directly to `computeMaxSkillRankCap` from `skills.ts`, and re-export `SYNERGY_REQUIRED_RANKS as SYNERGY_RANK_THRESHOLD` from `skills.ts` instead of redefining `5`. |
| **`src/rulesets/dnd35e/races.ts`, `level_ledger.ts` & `modifiers.ts`** | `applyRaceToActorChassis`, `buildClassAndDomainEffectModifiers`, `collectActiveGrantedAndVirtualFeats`, `evaluateEffectBundle`, `resolveTypedModifiers`. | Reuse `applyRaceToActorChassis` + `buildClassAndDomainEffectModifiers` + `resolveTypedModifiers` to compute racial/domain/feat `skill:<id>` bonuses in the UI rather than writing a separate UI stat calculator. |
| **`src/rendering/ui/dnd35e_inspector.ui.ts` (Shared View Helper)** | Shared DOM card/badge builders across Character Creation and Level-Up modals. | Extract Race, Class, Skill (with Synergy & Action tables), Feat, and Spell right-pane DOM inspectors into `dnd35e_inspector.ui.ts` so `dnd35e_char_builder_steps.ui.ts` and `dnd35e_level_up.ui.ts` share 100% of their inspector rendering code. |

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Producers / Data) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling JSONs / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. `DnD35RaceDefinitionSchema` (`isPlayableRace`)** | `public/data/rulesets/dnd35e/races/*.json` (14 playable races set `"isPlayableRace": true`; monstrous races omit and default to `false`). | `dnd35e_char_builder.ui.ts` (Step 1 filters by `isPlayableRace` unless `showMonstrousRaces` toggle is enabled), `dnd35e_validator.ts` (verifies core PHB races have `isPlayableRace: true`). | `tests/dnd35e_classes_builder.test.ts`, `tests/ruleset_validators.test.ts`. |
| **2. `DnD35SpellDefinitionSchema` (`levelByClass`, `levelByDomain`, `description`)** | `public/data/rulesets/dnd35e/spells/*.json` & `SPELL_IDS` in `src/rulesets/dnd35e/system_content_files.ts`. | `dnd35e_char_builder_steps.ui.ts` (Step 6 filters spells via `getSpellLevelForClass` and excludes `prohibitedSchools`), `dnd35e_level_up.ui.ts` (filters new spells by class/domain), `dnd35e_validator.ts` (checks class/domain references in `levelByClass` / `levelByDomain`). | `tests/dnd35e_classes_builder.test.ts`, `tests/ruleset_validators.test.ts`. |
| **3. `SKILL_IDS`, `DnD35SkillDefinitionSchema`, `skills.ts` & `public/data/rulesets/dnd35e/skills/*.json` (Full 42-Skill SRD Specifics)** | `src/rulesets/dnd35e/system_content_files.ts` (`SKILL_IDS` expanded from 12 to 42 skills), 30 new `public/data/rulesets/dnd35e/skills/<id>.json` files, and 12 existing skill JSONs backfilled with complete synergies & actions. | `src/rulesets/dnd35e/skills.ts` (`computeSkillSynergyBonus`, `resolveSkillCheck`, `getSkillsGrantedSynergyBy`), `dnd35e_inspector.ui.ts` & `dnd35e_char_builder_steps.ui.ts` (Step 4 computes live synergy/racial bonuses and renders Skill Actions & Synergies in Right Pane Inspector), `dnd35e_validator.ts` (validates `classSkills`, `synergyFromSkills`, and `opposedBySkill` references against `sys.skills`). | `public/data/rulesets/dnd35e/classes/*.json` (`classSkills` arrays now 100% backed by `sys.skills`), `tests/dnd35e_cartridge.test.ts`, `tests/dnd35e_classes_builder.test.ts`. |
| **4. `character_builder.ts` (`computeFirstLevelFeatSlotBudget`, `sanitizeDraftOnRaceOrClassChange`, `getSpellLevelForClass`)** | Called by `dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts`, `dnd35e_level_up.ui.ts`, and `validateCharacterCreationDraft`. | Prevents invalid default feat (`'weapon_focus'` -> `'power_attack'`), enforces feat slot budget (`1 General + 1 Human Bonus + 1 Fighter Bonus`), resets stale domains/schools/spells/over-budget skills on class/race switch. | `tests/dnd35e_classes_builder.test.ts`. |
| **5. 2-Pane Modal Layout, Shared Inspector & Scroll Preservation (`index.html`, `dnd35e_inspector.ui.ts`, `dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts`, `dnd35e_level_up.ui.ts`)** | Triggered by `showDnD35CharacterCreationModal()` and `showDnD35LevelUpModal()`. | Renders persistent 2-pane split (`Left Selection List` + `Right Live Inspector`), preserves `scrollTop` across re-renders, fixes Ability Method state machine and Specialist Wizard prohibited school selection. | `docs/ARCHITECTURE.md`, `docs/MILESTONES.md`. |

---

## 4. Step-by-Step Implementation Plan & Code Snippets

### Step 1: Targeted Schema Extensions (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`)
Reuse existing `DnD35SkillDefinitionSchema`, `DnD35SkillActionDescriptorSchema`, `DnD35RaceDefinitionSchema`, and `DnD35SpellDefinitionSchema`, adding only the missing fields:
1. `isPlayableRace: z.boolean().default(false)` on `DnD35RaceDefinitionSchema`.
2. `levelByClass`, `levelByDomain`, and `description` on `DnD35SpellDefinitionSchema`.
3. `retryAllowed: z.boolean().default(true)`, `take10Allowed: z.boolean().default(true)`, `take20Allowed: z.boolean().default(true)`, `synergyNotes: z.array(z.string()).default([])`, and `ruleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([])` inside `rankThresholdModifiers` on `DnD35SkillDefinitionSchema`.

```ts
// In src/rulesets/dnd35e/types/dnd35e_system.types.ts:

// Inside DnD35RaceDefinitionSchema:
  favoredClass: z.string().default('fighter'),
  isPlayableRace: z.boolean().default(false),
  bonusFeatAtFirstLevel: z.boolean().default(false),

// Inside DnD35SkillDefinitionSchema:
export const DnD35SkillDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyAbility: z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']),
  trainedOnly: z.boolean().default(false),
  acpMultiplier: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  retryAllowed: z.boolean().default(true),
  take10Allowed: z.boolean().default(true),
  take20Allowed: z.boolean().default(true),
  synergyFromSkills: z.array(z.string()).default([]),
  synergyNotes: z.array(z.string()).default([]),
  actions: z.array(DnD35SkillActionDescriptorSchema).default([]),
  rankThresholdModifiers: z
    .array(
      z.object({
        minRanks: z.number().int().positive(),
        modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
        ruleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([])
      })
    )
    .default([])
});

// Inside DnD35SpellDefinitionSchema:
  id: z.string(),
  name: z.string(),
  level: z.number().int().min(0).max(9),
  levelByClass: z.record(z.string(), z.number().int().min(0).max(9)).default({}),
  levelByDomain: z.record(z.string(), z.number().int().min(1).max(9)).default({}),
  description: z.string().default(''),
  school: z.string(),
```

---

### Step 2: Playable Race Tagging (`public/data/rulesets/dnd35e/races/*.json`)
Update the 7 core PHB races (`human`, `dwarf`, `elf`, `gnome`, `half_elf`, `half_orc`, `halfling`) and 7 iconic LA/humanoid playable options (`aasimar`, `tiefling`, `drow`, `goblin`, `hobgoblin`, `kobold`, `orc`) to include `"isPlayableRace": true`. All other monstrous/animal/vermin/undead/dragon/construct racial files default to `false` via Zod.

---

### Step 3: Full 42-Skill SRD Roster, Synergies, Actions & Rank Thresholds (`src/rulesets/dnd35e/skills.ts`, `src/rulesets/dnd35e/system_content_files.ts` & `public/data/rulesets/dnd35e/skills/*.json`)

#### 3A. Enhance Existing `src/rulesets/dnd35e/skills.ts` (Zero Duplication)
1. Export `SYNERGY_REQUIRED_RANKS` from `skills.ts` and re-export it as `SYNERGY_RANK_THRESHOLD` in `character_builder.ts`.
2. Upgrade `computeSkillSynergyBonus` in place to support the SRD epic scaling rule (`+2` at 5 ranks, plus `+2` per additional 20 whole ranks).
3. Update `SkillCheckDefinition` & `resolveSkillCheck` so `take10Allowed` and `take20Allowed` from `DnD35SkillDefinition` drive Take 10 / Take 20 eligibility declaratively (alongside the existing `'use_magic_device'` fallback for backward compatibility with existing tests).
4. Add `getSkillsGrantedSynergyBy(sourceSkillId, skillRegistry)` for reverse synergy lookup in the UI inspector.

```ts
// In src/rulesets/dnd35e/skills.ts:

/** Minimum whole ranks required in a source skill to grant an initial +2 Synergy bonus. */
export const SYNERGY_REQUIRED_RANKS = 5;

/** Additional whole ranks interval per extra +2 Synergy tier (25 ranks = +4, 45 ranks = +6). */
const SYNERGY_EPIC_RANK_INTERVAL = 20;

/** Untyped bonus granted per qualifying 5-rank skill synergy (`+2`). */
const SYNERGY_BONUS_AMOUNT = 2;

export function computeSkillSynergyBonus(
  synergyFromSkills: ReadonlyArray<string>,
  allSkillRanks: Readonly<Record<string, number>>
): number {
  let bonus = 0;
  for (const sourceSkillId of synergyFromSkills) {
    const wholeRanks = dndFloor(Math.max(0, allSkillRanks[sourceSkillId] ?? 0));
    if (wholeRanks >= SYNERGY_REQUIRED_RANKS) {
      const tiers = 1 + dndFloor((wholeRanks - SYNERGY_REQUIRED_RANKS) / SYNERGY_EPIC_RANK_INTERVAL);
      bonus += tiers * SYNERGY_BONUS_AMOUNT;
    }
  }
  return bonus;
}

export function getSkillsGrantedSynergyBy(
  sourceSkillId: string,
  skillRegistry: Readonly<Record<string, DnD35SkillDefinition>>
): ReadonlyArray<string> {
  const targets: string[] = [];
  for (const skill of Object.values(skillRegistry)) {
    if (skill.synergyFromSkills.includes(sourceSkillId)) {
      targets.push(skill.id);
    }
  }
  return targets.sort();
}
```

#### 3B. Backfilling the 12 Existing Skills (`public/data/rulesets/dnd35e/skills/*.json`)
Update the 12 existing skill JSONs (`climb`, `concentration`, `diplomacy`, `hide`, `intimidate`, `jump`, `listen`, `move_silently`, `spot`, `swim`, `tumble`, `use_magic_device`) so their `synergyFromSkills`, `synergyNotes`, `take10Allowed`/`take20Allowed`, and `actions` are complete now that all 42 PHB skills exist in `sys.skills`.

#### 3C. Authoring the 30 Missing PHB Skills (`public/data/rulesets/dnd35e/skills/*.json` & `SKILL_IDS`)
Create the 30 missing skill JSON files (`appraise`, `balance`, `bluff`, `craft`, `decipher_script`, `disable_device`, `disguise`, `escape_artist`, `forgery`, `gather_information`, `handle_animal`, `heal`, `knowledge_arcana`, `knowledge_dungeoneering`, `knowledge_local`, `knowledge_nature`, `knowledge_nobility`, `knowledge_planes`, `knowledge_religion`, `open_lock`, `perform`, `profession`, `ride`, `search`, `sense_motive`, `sleight_of_hand`, `speak_language`, `spellcraft`, `survival`, `use_rope`) using the existing `DnD35SkillDefinitionSchema` and `DnD35SkillActionDescriptorSchema` shapes, and register all 42 IDs in `SKILL_IDS`.

---

### Step 4: Spell Class/Domain Tagging & Starter Spell Roster (`public/data/rulesets/dnd35e/spells/*.json` & `src/rulesets/dnd35e/system_content_files.ts`)
Update the 5 existing spells (`burning_hands`, `cure_light_wounds`, `fireball`, `magic_missile`, `ray_of_enfeeblement`) and add 18 starter 0th/1st-level spells (`acid_splash`, `ray_of_frost`, `daze`, `detect_magic`, `light`, `resistance`, `mage_armor`, `shield`, `sleep`, `grease`, `bless`, `shield_of_faith`, `divine_favor`, `entangle`, `produce_flame`, `shillelagh`, `summon_monster_i`, `summon_natures_ally_i`) with `levelByClass`, `levelByDomain`, and `description`, and register them in `SPELL_IDS`.

---

### Step 5: Character Builder Helpers, Feat Slot Budget & Validator (`src/rulesets/dnd35e/character_builder.ts` & `src/rulesets/dnd35e/dnd35e_validator.ts`)
1. In `src/rulesets/dnd35e/character_builder.ts`:
   - Re-export `SYNERGY_REQUIRED_RANKS as SYNERGY_RANK_THRESHOLD` and delegate `getSkillMaxRanks` to `computeMaxSkillRankCap` from `./skills.ts`.
   - Add `computeFirstLevelFeatSlotBudget(race, cls, selectedAcfs)` to compute `{ totalSlots, generalSlots, racialBonusSlots, fighterBonusSlots }`.
   - Add `getSpellLevelForClass(spell, classId, domains)` and `isSpellSelectableForDraft(spell, classId, domains, arcaneSchool, prohibitedSchools, maxSpellLevel)` to centralize spell filtering for both Character Creation and Level-Up.
   - Add `getEffectiveClassSkillIds(cls, domains, domainRegistry)` to combine `cls.classSkills` with any `classSkillsAdded` from active Cleric domain `grantedPowerBundle`s (e.g. Knowledge/Trickery domains).
   - Add `sanitizeDraftOnRaceOrClassChange(draft, sys)` so changing `raceId` or `classId` automatically prunes invalid `selectedAcfs`, resets `domains` (if non-Cleric), resets `arcaneSchool` / `prohibitedSchools` (if non-Wizard), prunes `knownSpells` not on the new class list, and clamps/resets `skillRanks` and `selectedFeats` if they exceed the new budget.
   - Fix `createDefaultDraft()` in `dnd35e_char_builder.ui.ts` to use `'power_attack'` instead of `'weapon_focus'`, and update `validateCharacterCreationDraft()` to validate feat count against `computeFirstLevelFeatSlotBudget()`.
2. In `src/rulesets/dnd35e/dnd35e_validator.ts`:
   - Verify every `classSkillId` in `classDef.classSkills` exists in `sys.skills`.
   - Verify every `sourceSkillId` in `skillDef.synergyFromSkills` and every `opposedBySkill` in `skillDef.actions` exists in `sys.skills`.
   - Verify every class ID in `spellDef.levelByClass` exists in `sys.classes` and every domain ID in `spellDef.levelByDomain` exists in `sys.domains`.

---

### Step 6: Full-Screen 2-Pane CSS Layout (`index.html`)
Expand `#char-creation-overlay .modal-content` and `#level-up-overlay .modal-content` in `index.html` and add `.dnd35-two-pane-stage`, `.dnd35-pane-left`, `.dnd35-pane-right`, `.dnd35-counter-group`, and `.dnd35-filter-bar` styles.

---

### Step 7: Shared Right-Pane Inspector Module (`src/rendering/ui/dnd35e_inspector.ui.ts`)
Create a concise, reusable pure-DOM inspector module used by both `dnd35e_char_builder_steps.ui.ts` and `dnd35e_level_up.ui.ts`:
- `renderRaceInspector(pane, race)` — Ability adjustments, size, speed, senses, favored class, bonus feat/skill points, languages, weapon familiarities, save/conditional modifiers, RHD/LA.
- `renderSkillInspector(pane, skill, allSkillRanks, abilityMod, miscBonus, sys)` — Key ability, Trained Only, ACP multiplier, Take 10/Take 20/Retry badges, full modifier breakdown (`Whole Ranks + Ability Mod + Synergy + Misc = Total`), **Synergies Received From** (with live `[ACTIVE +2]` status), **Synergies Granted To** (via `getSkillsGrantedSynergyBy` + `synergyNotes`), **Skill Actions Table** (`actionCost`, `DC / Opposed Skill`, `description`, `onSuccessRuleOverrides`), and **Rank Threshold Unlocks** (`rankThresholdModifiers`).
- `renderFeatInspector(pane, feat, prereqPassed, isGranted)` — Benefit description, Fighter Bonus badge, Prerequisite status.
- `renderSpellInspector(pane, spell, spellLevel)` — School, Level, Components, Range, Target/Area, Duration, Saving Throw, Spell Resistance, Description.

---

### Step 8: Character Creation & Level-Up Modal Overhaul (`src/rendering/ui/dnd35e_char_builder.ui.ts`, `src/rendering/ui/dnd35e_char_builder_steps.ui.ts`, `src/rendering/ui/dnd35e_level_up.ui.ts`)
1. **Scroll Position Preservation:** Capture `scrollTop` of `.dnd35-pane-left` and `.dnd35-pane-right` before re-rendering and restore immediately after DOM insertion so clicking `[+]`/`[−]` or selecting options never jumps the scroll position.
2. **Step 1 (Race):** Playable race filter (`isPlayableRace: true` by default + `"Show Monstrous / Savage Species (RHD / LA)"` checkbox) on the left; `renderRaceInspector` on the right.
3. **Step 2 (Class, Alignment, ACFs, Domains & Specialist School):** Base PC class filter (`isPC` by default + `"Show DMG NPC Classes"` checkbox) on the left; Class Inspector + Alignment, ACFs, Cleric Domains, and **Wizard Specialist Prohibited Schools Picker** (using existing `validateSpecialistSchoolSelection`) on the right.
4. **Step 3 (Ability Scores):** Strict branch on `draft.abilityMethod` (`'point_buy'` shows `Point-Buy Cost: X / 28 pts` + `[−]`/`[+]`; `'elite_array'` and `'rolled_4d6kh3'` show `[↑]`/`[↓]` swap buttons + `[Re-Roll]` for rolled) on the left; live derived combat/save/HP preview on the right.
5. **Step 4 (Skills):** Filter toggle (`All Skills (42)` vs `Class Skills Only`) + `[−] Ranks [+]` counter steppers with separate `Ranks`, `Abil + Syn`, and `Total` columns on the left; `renderSkillInspector` on the right.
6. **Step 5 (Feats):** Enforced `computeFirstLevelFeatSlotBudget` counter (`1 General + 1 Human Bonus + 1 Fighter Bonus`) on the left; `renderFeatInspector` on the right.
7. **Step 6 (Spells & Gear):** Class/domain/prohibited-school filtered 0th & 1st-level spells (`isSpellSelectableForDraft`) on the left; `renderSpellInspector` + Starting Equipment selector on the right.
8. **Level-Up Modal (`dnd35e_level_up.ui.ts`):** Upgraded to `.dnd35-two-pane-stage` with scroll preservation, `[−]`/`[+]` skill rank steppers, live 5-rank Synergy unlock indicators, class-filtered spell selection, and shared `dnd35e_inspector.ui.ts` right-pane views.

---

### Step 9: Verification & Regression Tests
1. Run `bun test` and `compile_applet` / `lint_applet` to verify all TypeScript types, Zod schemas, and unit tests pass with 0 errors.
2. Add unit test coverage in `tests/dnd35e_classes_builder.test.ts` and `tests/ruleset_validators.test.ts` for playable race filtering, all 42 PHB skills (synergies, actions, rank thresholds, validator integrity), spell class/domain filtering, feat slot budgets, and draft sanitization.
