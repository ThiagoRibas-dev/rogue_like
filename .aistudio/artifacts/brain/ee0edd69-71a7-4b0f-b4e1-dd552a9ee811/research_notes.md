# Research Notes — Milestone 112.5: Full-Screen 2-Pane Character Creation & Level-Up UX Overhaul, Playable Race Filtering & Class Spell-List Tagging

## 1. Standards & Architectural Constraints Reiteration (`AGENTS.md`)

- **No `any` & Strict TypeScript (`exactOptionalPropertyTypes: true`):** Every function must declare an explicit return type; optional fields must be omitted when undefined rather than assigned `undefined`.
- **No Magic Values:** All gameplay/UI rule constants (point-buy budgets, elite array values, feat slot rules, max skill rank offsets) must live in named constants or data-driven JSON.
- **Pure DOM Construction (`document.createElement`):** Never use `.innerHTML`. Keep UI rendering in `src/rendering/ui/` and rules/validation math in `src/rulesets/dnd35e/character_builder.ts`.
- **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16):**
  - **Tier 2 (`src/rulesets/dnd35e/character_builder.ts`, `src/rulesets/dnd35e/types/dnd35e_system.types.ts`):** Pure character creation validation, feat slot budget calculation, skill rank/bonus breakdown math, draft sanitization on race/class change, and class/domain spell-list filtering.
  - **Tier 3 (`public/data/rulesets/dnd35e/races/<id>.json`, `spells/<id>.json`, `skills/<id>.json`):** Declarative `isPlayableRace`, `levelByClass`, `levelByDomain`, and missing PHB class skills/starter spells.
- **Universal Actor Symmetry (`AGENTS.md` Rule 18):** Playable races and monstrous creatures share the unified `races/<id>.json` schema (`DnD35RaceDefinitionSchema`). Filtering Step 1 to playable races by default while offering a **"Show Monstrous / Savage Species (RHD / LA)"** toggle preserves 100% actor symmetry while giving players a clean PHB default experience.

---

## 2. Root-Cause Analysis of Current Character Creation & Level-Up Issues

### Issue 1: Cramped Single-Column Modal & Scroll Reset on Every Click
- **Where:** `index.html` (lines 304–320) and `src/rendering/ui/dnd35e_char_builder.ui.ts` (lines 97–220).
- **Root Cause:**
  1. `#char-creation-overlay .modal-content` in `index.html` is constrained to `max-width: 720px; width: 92vw`, and `dnd35e_char_builder.ui.ts` renders a single vertical `stage` container (`max-height: 360px; overflow-y: auto`).
  2. Every click handler calls `renderStep()` which executes `content.replaceChildren()` and creates a brand-new `stage` DOM element without recording or restoring `scrollTop`. Consequently, clicking any race, class, skill button, feat, or spell resets the list scroll position to `0`.

### Issue 2: Step 1 (Race) Lists All 76 Unified Monsters/Races Without Filtering
- **Where:** `src/rendering/ui/dnd35e_char_builder.ui.ts` (`renderRaceStep`, lines 225–244) and `src/rulesets/dnd35e/types/dnd35e_system.types.ts` (`DnD35RaceDefinitionSchema`, lines 606–659).
- **Root Cause:**
  - After unifying `races.json` and `archetypes.json` into `public/data/rulesets/dnd35e/races/<id>.json` (Milestone 108), `sys.races` contains all 76 races and monsters (`aboleth`, `balor`, `dire_rat`, `dragon_red`, etc.).
  - `DnD35RaceDefinitionSchema` lacks `isPlayableRace: z.boolean().default(false)`, so Step 1 displays all 76 entries mixed together and only shows `size`, `baseLandSpeedFt`, and `levelAdjustment` on each row without a right-hand detail inspector.

### Issue 3: Step 2 (Class) Lists NPC Classes, Lacks Prohibited School Picker, and Leaves Stale State on Switch
- **Where:** `src/rendering/ui/dnd35e_char_builder.ui.ts` (`renderClassStep`, lines 246–399) and `src/rulesets/dnd35e/character_builder.ts` (`createDefaultDraft`, lines 124–144).
- **Root Cause:**
  1. `renderClassStep` filters only by `!c.isPrestige`, so the 5 DMG NPC classes (`adept`, `aristocrat`, `commoner`, `expert`, `warrior` with `isNpcClass: true`) clutter the primary class list alongside the 11 PHB base classes.
  2. When `draftState.classId === 'wizard'` and a specialist `arcaneSchool` (e.g., `'evocation'`) is clicked (lines 365–385), the click handler sets `arcaneSchool: school, prohibitedSchools: []`, **but there are no UI controls to pick the required 1 or 2 `prohibitedSchools`!** Thus `validateSpecialistSchoolSelection` permanently fails validation (`"evocation specialization requires exactly 2 prohibited school(s)."`), making it impossible to create a Specialist Wizard.
  3. `createDefaultDraft()` pre-populates `skillRanks: { climb: 4, jump: 4, intimidate: 4 }` and `selectedFeats: ['power_attack', 'cleave', 'weapon_focus']` (note: `'weapon_focus'` is not even a valid ID in `FEAT_IDS`, which has `'weapon_focus_bite'` and `'weapon_focus_greatclub'`). Switching `classId` or `raceId` never sanitizes or resets `skillRanks`, `selectedFeats`, `knownSpells`, `domains`, `arcaneSchool`, or `prohibitedSchools`.

### Issue 4: Step 3 (Ability Scores) Displays "Point-Buy Cost" Label in Rolled / Elite Array Modes
- **Where:** `src/rendering/ui/dnd35e_char_builder.ui.ts` (`renderAbilityStep`, lines 401–489).
- **Root Cause:**
  - Lines 442–445 compute `const spent = calculatePointBuyCost(draftState.baseAbilityScores)` and check `Number.isFinite(spent)`.
  - `calculatePointBuyCost` returns a finite number whenever all 6 scores happen to lie between `8` and `18`—regardless of `draftState.abilityMethod`! So when a player clicks `ROLLED 4D6KH3` and rolls `[16, 14, 13, 12, 11, 10]`, `spent` is `29`, and the label still says `"Point-Buy Cost: 29 / 28 pts"` instead of switching to a Rolled mode header with a `[🎲 Re-Roll]` button.
  - Furthermore, in `elite_array` and `rolled_4d6kh3` modes, the `−` and `+` point-buy buttons remain wired up instead of providing swap/assignment controls to arrange the array/rolled scores across `STR..CHA`.

### Issue 5: Step 4 (Skills) Conflates Ranks vs. Bonuses, Lacks `[−]`/`[+]` Counter, and Is Missing PHB Skills
- **Where:** `src/rendering/ui/dnd35e_char_builder_steps.ui.ts` (`renderCharBuilderSkillsStep`, lines 23–81), `public/data/rulesets/dnd35e/skills/`, and `src/rulesets/dnd35e/system_content_files.ts` (`SKILL_IDS`).
- **Root Cause:**
  1. `renderCharBuilderSkillsStep` only renders a single toggle button (`+1 Rank` or `Reset` when `current >= maxRanks`), always adds `+1` rank on click (even for Cross-Class skills where 1 skill point buys `0.5` ranks), and never checks if `spent >= budget` before incrementing—allowing players to exceed their budget (`16 / 12 pts`).
  2. When switching from Fighter (`climb: 4, jump: 4, intimidate: 4` = 3 pts) to Wizard (where Climb, Jump, and Intimidate are Cross-Class, costing 2 pts per rank = 24 pts!), `spent` immediately jumps to `24 / 12 pts`, and resetting one skill drops `spent` to `16 / 12 pts`.
  3. The UI only displays `Ranks: X / Y` without showing `Key Ability Mod`, `Racial/Feat/Synergy Bonus`, `Armor Check Penalty`, or `Total Skill Modifier`.
  4. `SKILL_IDS` in `system_content_files.ts` only contains 12 skills (`climb`, `concentration`, `diplomacy`, `hide`, `intimidate`, `jump`, `listen`, `move_silently`, `spot`, `swim`, `tumble`, `use_magic_device`), whereas class definitions (`cleric.json`, `wizard.json`, `rogue.json`, `ranger.json`, `bard.json`, etc.) reference 23 additional PHB skills (`appraise`, `balance`, `bluff`, `craft`, `decipher_script`, `disable_device`, `disguise`, `escape_artist`, `forgery`, `gather_information`, `handle_animal`, `heal`, `knowledge_arcana`, `knowledge_dungeoneering`, `knowledge_local`, `knowledge_nature`, `knowledge_nobility`, `knowledge_planes`, `knowledge_religion`, `open_lock`, `perform`, `profession`, `ride`, `search`, `sense_motive`, `sleight_of_hand`, `speak_language`, `spellcraft`, `Ride`, `survival`, `use_rope`).

### Issue 6: Step 5 (Feats) Has No Slot Budget Enforcement & Invalid Default Feat ID
- **Where:** `src/rendering/ui/dnd35e_char_builder_steps.ui.ts` (`renderCharBuilderFeatsStep`, lines 87–126) and `src/rulesets/dnd35e/character_builder.ts`.
- **Root Cause:**
  - `renderCharBuilderFeatsStep` allows toggling an unlimited number of feats as long as `evaluatePrerequisiteAST` passes. It does not calculate or enforce 1st-level feat slot budgets (`1 General Feat` + `1 Human Bonus Feat` if `race.bonusFeatAtFirstLevel` + `1 Fighter Bonus Feat` restricted to `isFighterBonusFeat: true` if Fighter 1).

### Issue 7: Step 6 (Spells) Does Not Filter by Class or Domain Spell Lists
- **Where:** `src/rendering/ui/dnd35e_char_builder_steps.ui.ts` (`renderCharBuilderSpellsStep`, lines 132–171), `src/rulesets/dnd35e/types/dnd35e_system.types.ts` (`DnD35SpellDefinitionSchema`, lines 869–892), and `public/data/rulesets/dnd35e/spells/*.json`.
- **Root Cause:**
  1. `DnD35SpellDefinitionSchema` only has `level: z.number().int().min(0).max(9)` and `school: z.string()`, lacking `levelByClass: Record<string, number>` and `levelByDomain: Record<string, number>`.
  2. `renderCharBuilderSpellsStep` lists every spell in `sys.spells` where `spell.level <= 1`, regardless of `draft.classId`, `classDef.castingTradition`, or `draft.prohibitedSchools`—allowing a Cleric to select *Magic Missile* or a Specialist Wizard to select spells from their prohibited schools.
  3. Also, `SPELL_IDS` in `system_content_files.ts` lists 8 spell IDs (`cure_light_wounds`, `fireball`, `magic_missile`, `ray_of_enfeeblement`, `summon_monster_i`, `summon_natures_ally_i`, `teleport`, `wall_of_fire`), while `public/data/rulesets/dnd35e/spells/` on disk has 5 files (`burning_hands.json`, `cure_light_wounds.json`, `fireball.json`, `magic_missile.json`, `ray_of_enfeeblement.json`). Syncing `SPELL_IDS` with disk and adding core 0th/1st-level spells across classes (`light`, `detect_magic`, `read_magic`, `mage_armor`, `shield`, `sleep`, `bless`, `shield_of_faith`, `entangle`, `cure_minor_wounds`, `ray_of_frost`, `resistance`, `grease`, `charm_person`) with explicit `levelByClass` and `levelByDomain` will ensure every spellcasting class has authentic SRD 3.5e 0th/1st-level spells in Step 6.

---

## 3. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Data Authors / Emitters) | Downstream (Consumers / Renderers / Validators / Save Schemas) | Lateral (Sibling Registries / Modals / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Add `isPlayableRace: z.boolean().default(false)` to `DnD35RaceDefinitionSchema`** | `public/data/rulesets/dnd35e/races/<id>.json` (set `true` on PHB races & playable humanoids/planetouched; defaults to `false` on monstrous creatures) | `renderRaceStep` in `dnd35e_char_builder.ui.ts` (filters default view to `isPlayableRace === true`, with toggle for monstrous/RHD species); `validateDnD35eSystemContentIntegrity` | `races.ts`, `creature_advancement.ts` (unaffected because `.default(false)` is backward-compatible) |
| **2. Add `levelByClass`, `levelByDomain`, and `description` to `DnD35SpellDefinitionSchema`** | `public/data/rulesets/dnd35e/spells/<id>.json` & `src/rulesets/dnd35e/system_content_files.ts` (`SPELL_IDS`) | `character_builder.ts` (`getSelectableSpellsForClass`, `validateCharacterCreationDraft`); `renderCharBuilderSpellsStep` in `dnd35e_char_builder_steps.ui.ts`; `dnd35e_level_up.ui.ts` | `src/rulesets/dnd35e/magic/` spell resolvers & `domains/<id>.json` `domainSpells` references |
| **3. Expand `public/data/rulesets/dnd35e/skills/<id>.json` & `SKILL_IDS` to full PHB Skill Roster** | `public/data/rulesets/dnd35e/skills/<id>.json` & `system_content_files.ts` (`SKILL_IDS`) | `renderCharBuilderSkillsStep` (`dnd35e_char_builder_steps.ui.ts`), `renderDnD35eLevelUpModal` (`dnd35e_level_up.ui.ts`), `skills.ts` (`resolveSkillCheck`) | `public/data/rulesets/dnd35e/classes/<id>.json` (`classSkills` arrays now resolve 100% of referenced skill IDs) |
| **4. Add Draft Sanitization, Feat Slot Budget & Skill Breakdown Helpers in `character_builder.ts`** | `dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts` | `validateCharacterCreationDraft`, `finalizeCharacterCreationDraft` | `tests/` unit tests for `character_builder.ts` (Note: `createDefaultDraft()` must remain valid for default Human Fighter or clean empty-investment state so existing tests pass) |
| **5. Full-Screen 2-Pane Modal Layout & Scroll Preservation (`index.html`, `dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts`, `dnd35e_level_up.ui.ts`)** | `main.ts` (`openDnD35eCharBuilderModal`, `openDnD35eLevelUpModal`) | DOM `#char-creation-overlay` and `#level-up-overlay` | Shared modal styles in `index.html` |
