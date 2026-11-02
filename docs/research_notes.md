# Phase 23 Research Notes: D&D 3.5e System Content Pillar 2 — Core 11 Classes, Prestige Classes, ACFs & Character Builder (Milestones 110–112)

---

## 1. Reiteration of Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16 & `docs/DND_35E_PYRAMID_ARCHITECTURE.md`):**
   - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/types/`):** Generic UI modes (`UIMode.CHAR_CREATION`, `UIMode.LEVEL_UP`), session flow hooks, and loader merging of multi-file system content descriptors (`src/core/loader.ts`).
   - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`):** Pure D&D 3.5e mathematical laws: class progression resolution, multiclass XP penalty calculation (`progression.ts`), point-buy / elite array / `4d6kh3` ability generation, domain & specialist school selection rules, ACF feature-swap resolution (`PRIM-2.1`), and level-up state application (`character_builder.ts`).
   - **Tier 3 — System Content (`public/data/rulesets/dnd35e/`):** Declarative JSON definitions for the 11 SRD Base Classes, 10 SRD Prestige Classes, 22 Cleric Domains, Wizard Specialist Schools, and Alternate Class Features (`acfSwaps`).
2. **Baseline Rules + Declarative Overrides & Modifiers (`AGENTS.md` Rule 17):**
   - Class features (Rage, Sneak Attack, Evasion, Uncanny Dodge, Fast Movement, Flurry of Blows, Monk AC Bonus, Smite Evil, Divine Grace, Favored Enemy, Bardic Music, Turn/Rebuke Undead, Cleric Domain Granted Powers, Prestige Class features) must never be hardcoded as `if (classId === 'monk')` branches in combat resolvers. They emit declarative `StatModifier`s, `RuleOverride`s, `ResourcePool`s, and `proficiencyGrants` via the Unified Effect Provider pipeline.
3. **Universal Actor Symmetry (`AGENTS.md` Rule 18):**
   - Player characters created in the Character Builder and leveled up via the Level-Up Modal use the exact same `DnD35ActorProgressionComponent` (`classLevels`, `feats`, `skillRanks`, `selectedAcfs`, `hpRollsByHd`), `DnD35SpellcastingComponent`, and `StatModifierComponent` schemas as NPCs and monsters with class levels.
4. **Unified Effect Providers & Hierarchical Provenance (`AGENTS.md` Rule 19):**
   - Every modifier, proficiency, or rule override granted by a class feature, Cleric domain, specialist school, or ACF carries a slash-delimited `sourcePath`:
     - Class Feature: `"class:barbarian/level:1/feature:fast_movement"`
     - ACF Replacement: `"class:barbarian/level:1/acf:lion_spirit_totem"`
     - Cleric Domain Granted Power: `"class:cleric/domain:war/power:weapon_focus"`
     - Prestige Class Feature: `"class:duelist/level:1/feature:canny_defense"`
5. **Strict TypeScript & Code Hygiene (`AGENTS.md` Rules 10–14, §3, §4, §7, §8):**
   - Zero `any`, zero magic numbers, explicit return types on all functions, `exactOptionalPropertyTypes: true` compliance, pure JSON-serializable ECS components (no `Map`/`Set` in components), native DOM construction (`document.createElement` — never `.innerHTML`), and modular files (~250 lines max per file).

---

## 2. Architectural Evaluation: `classes.json` + Per-Class JSON Files (`public/data/rulesets/dnd35e/classes/<classId>.json`)

### Why Splitting `classes.json` into `classes.json` + Per-Class JSONs Makes Strong Architectural Sense
A complete D&D 3.5e class definition (20 levels of `spellsPerDay` / `spellsKnown` matrices, `featureGrants` with declarative `StatModifier` / `RuleOverride` / `ResourcePool` payloads, `acfSwaps`, proficiencies, class skills, alignment restrictions, and `PrerequisiteNode` ASTs for Prestige Classes) takes **120–250 lines of JSON per class**.
- Putting **11 Base Classes + 10 Prestige Classes + 22 Cleric Domains** into a single monolithic `public/data/rulesets/dnd35e/classes.json` would bloat that single file to **3,500–4,500+ lines**, making diffs, reviews, and maintenance cumbersome.
- Having **`classes.json` + one JSON file per class (`public/data/rulesets/dnd35e/classes/<id>.json`)** keeps every file between **80 and 220 lines**, aligns with `AGENTS.md` §8 ("One concern per file... split files if they exceed ~250 lines"), and makes adding or modding individual classes trivial.

### How `classes.json` + Per-Class JSONs Work Seamlessly Together
1. **What lives in `public/data/rulesets/dnd35e/classes.json`:**
   - Acts as the base/index class registry file (can hold shared class metadata/domains or base definitions, or merge directly with `classes/<classId>.json`).
   - Additionally, Cleric Domains (`22 SRD Domains`) and Wizard Specialist Schools (`8 Schools + Universal`) can either live in `classes.json` (or `domains.json`) while each of the **11 Base Classes** (`classes/barbarian.json`, `classes/bard.json`, `classes/cleric.json`, `classes/druid.json`, `classes/fighter.json`, `classes/monk.json`, `classes/paladin.json`, `classes/ranger.json`, `classes/rogue.json`, `classes/sorcerer.json`, `classes/wizard.json`) and **10 Prestige Classes** (`classes/arcane_archer.json`, `classes/assassin.json`, `classes/blackguard.json`, `classes/dragon_disciple.json`, `classes/duelist.json`, `classes/dwarven_defender.json`, `classes/eldritch_knight.json`, `classes/loremaster.json`, `classes/mystic_theurge.json`, `classes/shadowdancer.json`) has its own dedicated file under `public/data/rulesets/dnd35e/classes/<classId>.json`.
2. **How the Loader Pipeline Merges Multi-File Descriptors (`key: 'classes'`):**
   - Currently, `RulesetContract.getSystemContentFiles()` returns `ReadonlyArray<RulesetSystemFileDescriptor>` (`{ key: string; filename: string }`).
   - Three places load these descriptors:
     1. `src/core/loader.ts` (`loadRulesetSystemContent`)
     2. `tests/helpers.ts` (`loadCampaignFromDisk`)
     3. `scripts/run-validator.ts` (`loadAndValidateZod`)
   - Right now, each of those three functions assigns `rawSystemContent[desc.key] = content`.
   - By updating those three loader loops so that when multiple descriptors share the same `desc.key` (e.g. `key: 'classes'`), plain object records are shallow-merged (`rawSystemContent[desc.key] = { ...(rawSystemContent[desc.key] as Record<string, unknown>), ...(content as Record<string, unknown>) }`) — and if a per-class JSON is authored either as `{ "<classId>": { ... } }` or as a single class object `{ "id": "<classId>", ... }` normalized into `{ [content.id]: content }`:
     - **On disk:** Clean, modular `classes.json` + `classes/<classId>.json` files!
     - **In memory (`campaign.systemContent.classes`):** Unified `Record<string, DnD35ClassDefinition>`! Zero breaking changes to `DnD35SystemContentSchema`, `progression.ts`, `srd_registry.ts`, `bootstrap-campaign.ts`, or any existing tests.

---

## 3. Existing Codebase Inspection & Gap Analysis

### 3.1 Milestone 110: Complete 11 SRD Base Classes, 22 Cleric Domains & ACFs
- **Current State (`src/rulesets/dnd35e/types/dnd35e_system.types.ts` & `public/data/rulesets/dnd35e/classes.json`):**
  - `DnD35ClassDefinitionSchema` currently supports: `id`, `name`, `isPrestige`, `hitDie`, `babProgression`, `fortSave`, `refSave`, `willSave`, `skillPointsPerLevel`, `classSkills`, `prerequisites`, `featureGrants`, `acfSwaps`, `spellcasting` (`stat`, `type`, `progressionTable`).
  - `public/data/rulesets/dnd35e/classes.json` currently has only 4 stub classes (`fighter`, `rogue`, `cleric`, `wizard`) with minimal level 1–2 features and 2-level spell tables.
- **Required Enhancements for Milestone 110:**
  1. **Schema Extensions (`src/rulesets/dnd35e/types/dnd35e_system.types.ts` & `dnd35e.types.ts`):**
     - **Structured Class Feature Grants (`DnD35ClassFeatureDefinitionSchema`):** Allow each class/domain/ACF feature to carry:
       - `id`, `name`, `level`, `category` (`'ex' | 'su' | 'sp' | 'proficiency' | 'bonus_feat'`)
       - `modifiers?: ReadonlyArray<StatModifier>` (e.g., Barbarian Fast Movement `+10 ft` untyped speed when not in heavy armor; Monk AC Bonus `+1` per 5 levels + WIS mod when unarmored; Paladin Divine Grace; Fighter Armor Mastery)
       - `ruleOverrides?: ReadonlyArray<RuleOverride>` (e.g., Evasion, Improved Evasion, Uncanny Dodge, Woodland Stride, Trackless Step, Venom Immunity)
       - `resourcePool?: { id: string; maxFormula: string; recovery: 'encounter' | 'daily' }` (e.g., Rage/day, Stunning Fist/day, Turn Undead `3 + CHA mod`/day, Smite Evil/day, Bardic Music `level`/day, Lay on Hands `level * CHA mod`, Wholeness of Body `level * 2`)
       - `scalingValue?: { key: string; value: number }` (e.g., `sneak_attack_d6`, `skirmish_d6`, `unarmed_damage_step`, `flurry_penalty`, `favored_enemy_count`)
       - `bonusFeatPool?: ReadonlyArray<string>` (e.g., Fighter bonus feats at 1, 2, 4, 6, ..., 20; Wizard bonus metamagic/item creation feats at 5, 10, 15, 20; Monk fixed choice bonus feats at 1, 2, 6; Ranger combat style feats at 2, 6, 11)
     - **Alignment Restrictions & Proficiencies on `DnD35ClassDefinitionSchema`:**
       - `allowedAlignments?: ReadonlyArray<Alignment>` (e.g., Barbarian non-lawful, Bard non-lawful, Monk lawful, Paladin `LG`, Druid neutral component, Assassin/Blackguard evil)
       - `proficiencies?: { weapons?: ReadonlyArray<string>; armor?: ReadonlyArray<string>; shields?: ReadonlyArray<string> }`
     - **Full 20-Level Spellcasting Tables (`spellsPerDay` & `spellsKnown`):**
       - Expand `spellcasting.progressionTable` across levels 1–20 for `bard` (0–6th + `spellsKnown`), `cleric` (0–9th + `+1` domain slot at 1–9th), `druid` (0–9th), `paladin` (1–4th from level 4, `casterLevelOffset: -3` or half-level), `ranger` (1–4th from level 4), `sorcerer` (0–9th + `spellsKnown`), `wizard` (0–9th), `assassin` (1–4th + `spellsKnown`), and `blackguard` (1–4th).
     - **22 SRD Cleric Domains (`DnD35DomainDefinitionSchema` in `domains.json` or `classes.json`):**
       - `air`, `animal`, `chaos`, `death`, `destruction`, `earth`, `evil`, `fire`, `good`, `healing`, `knowledge`, `law`, `luck`, `magic`, `plant`, `protection`, `strength`, `sun`, `travel`, `trickery`, `war`, `water`.
       - Each domain defines: `id`, `name`, `grantedPower` (description, `classSkillsAdded`, `modifiers`, `resourcePool`, `featGrants`), and `domainSpells` (`Record<string, string>` for spell levels 1–9).
     - **Wizard 8 Specialist Schools (`DnD35ArcaneSchoolSpecSchema`):**
       - `abjuration`, `conjuration`, `divination`, `enchantment`, `evocation`, `illusion`, `necromancy`, `transmutation` (+ `universal`).
       - Specialist wizards gain `+1` spell slot per spell level from their specialty school, `+2` Spellcraft to learn spells of that school, and must choose **2 prohibited schools** (`1` for Divination; `divination` itself can never be prohibited).
     - **Alternate Class Features (`acfSwaps` via `PRIM-2.1`):**
       - Barbarian: *Whirling Frenzy* (replaces `rage_1`), *Lion Spirit Totem* (`pounce` replaces `fast_movement`), *Wolf Totem* (`improved_trip` replaces `uncanny_dodge` / `trap_sense`).
       - Monk: *Decisive Strike* (replaces `flurry_of_blows`), *Invisible Fist* (replaces `evasion`).
       - Paladin: *Charging Smite* (replaces `special_mount`).
       - Ranger: *Distracting Attack* (replaces `animal_companion`).
       - Rogue: *Penetrating Strike* (replaces `trap_sense_1` — half sneak attack dice vs sneak-immune targets when flanking).
       - Cleric: *Domain Spontaneity* (replaces `turn_undead` pool usage with spontaneous domain spell conversion).
       - Wizard: *Immediate Magic / Abrupt Jaunt* (replaces `summon_familiar`).

### 3.2 Milestone 111: SRD Prestige Classes & Multiclassing Rules
- **10 SRD Prestige Classes (`isPrestige: true`):**
  1. `arcane_archer` (10 levels, d8, Full BAB, Fort/Ref Good; requires BAB +6, Elves/Half-Elves, Point Blank Shot, Precise Shot, Weapon Focus (bow), 1st-level arcane spells)
  2. `assassin` (10 levels, d6, Medium BAB, Ref Good; requires Evil alignment, Disguise 4 ranks, Hide 8 ranks, Move Silently 8 ranks; grants Sneak Attack, Death Attack, Poison Use, Uncanny Dodge, arcane spells)
  3. `blackguard` (10 levels, d10, Full BAB, Fort Good; requires Evil alignment, BAB +6, Hide 5 ranks, Cleave, Improved Sunder, Power Attack; grants Aura of Evil, Detect Good, Dark Blessing CHA-to-saves, Smite Good, Sneak Attack, Command Undead)
  4. `dragon_disciple` (10 levels, d12, Medium BAB, Fort/Will Good; requires non-dragon, Knowledge (arcana) 8 ranks, spontaneous arcane casting; grants Natural Armor, Ability Boosts STR/CON/INT, Claws/Bite, Breath Weapon, Blindsense, Half-Dragon apotheosis at 10)
  5. `duelist` (10 levels, d10, Full BAB, Ref Good; requires BAB +6, Perform 3 ranks, Tumble 5 ranks, Dodge, Mobility, Weapon Finesse; grants Canny Defense INT-to-AC, Improved Reaction, Enhanced Mobility, Grace, Precise Strike)
  6. `dwarven_defender` (10 levels, d12, Full BAB, Fort/Will Good; requires Dwarf, Lawful alignment, BAB +7, Dodge, Endurance, Toughness; grants AC bonus, Defensive Stance, Uncanny Dodge, Trap Sense, Damage Reduction)
  7. `eldritch_knight` (10 levels, d6, Full BAB, Fort Good; requires proficiency with all martial weapons, 3rd-level arcane spells; grants Bonus Fighter Feat at 1, +1 existing arcane spellcasting class at levels 2–10)
  8. `loremaster` (10 levels, d4, Poor BAB, Will Good; requires 10 ranks in two Knowledge skills, any three metamagic/item creation feats, Skill Focus (Knowledge), 7 divination spells including 3rd-level; grants Lore, Secrets, +1 spellcasting class at 1–10)
  9. `mystic_theurge` (10 levels, d4, Poor BAB, Will Good; requires Knowledge (arcana) 6 ranks, Knowledge (religion) 6 ranks, 2nd-level arcane spells AND 2nd-level divine spells; grants +1 arcane AND +1 divine spellcasting level at 1–10)
  10. `shadowdancer` (10 levels, d8, Medium BAB, Ref Good; requires Move Silently 8 ranks, Hide 10 ranks, Perform (dance) 5 ranks, Combat Reflexes, Dodge, Mobility; grants Hide in Plain Sight, Evasion, Darkvision, Uncanny Dodge, Shadow Illusion, Summon Shadow, Shadow Jump, Defensive Roll, Slippery Mind)
- **Prerequisite AST Gap Check (`src/rulesets/dnd35e/prerequisites.ts` & `dnd35e_system.types.ts`):**
  - Currently `PrerequisiteNodeSchema` supports: `and`, `or`, `not`, `stat`, `bab`, `feat`, `skill_rank`, `caster_level`, `class_level`, `race`, `size`, `creature_type`, `subtype`, `class_feature`.
  - Prestige Classes also require:
    - `alignment`: `{ type: 'alignment', allowed: ReadonlyArray<Alignment> }` (for Assassin, Blackguard, Dwarven Defender, Monk, Paladin, Barbarian, Bard, Druid)
    - `spell_level`: `{ type: 'spell_level', tradition?: 'arcane' | 'divine' | 'any', minSpellLevel: number }` (for Arcane Archer 1st arcane, Eldritch Knight 3rd arcane, Mystic Theurge 2nd arcane + 2nd divine)
  - Adding `alignment` and `spell_level` variants to `PrerequisiteNodeSchema` and `evaluatePrerequisiteAST()` allows 100% of Prestige Class and Base Class alignment/casting requirements to be validated declaratively by the same AST engine!
- **Multiclass XP Penalty Calculator (`src/rulesets/dnd35e/progression.ts`):**
  - Per D&D 3.5e PHB p. 60:
    1. **Prestige Classes (`isPrestige: true`)** and **Racial Hit Dice** are completely exempt and never count toward multiclass XP penalties.
    2. The actor's **Favored Class** (`raceDef.favoredClass`) is ignored when comparing base class levels.
    3. If `raceDef.favoredClass === 'any'` (Human, Half-Elf), whichever **base class has the highest level** (picking one if tied) is treated as the favored class and ignored.
    4. Among the remaining base classes, find the highest level `maxBaseLevel`. Every other remaining base class whose level is `< maxBaseLevel - 1` (i.e. 2 or more levels below the highest non-favored base class) triggers a **`-20%` XP penalty** (`0.20` per offending class, capped at `0.80` / min multiplier `0.20`).
    5. Controlled by a campaign rule toggle (`enforceMulticlassXpPenalty?: boolean`, defaulting to `true` in `progression.ts` with an explicit parameter).

### 3.3 Milestone 112: Interactive D&D 3.5e Character Creation Wizard & Level-Up Advancement UI
- **Current Flow Inspection:**
  - `src/types/game-state.types.ts`: `UIMode` enum currently has `EXPLORATION`, `INVENTORY`, `LOOK`, `TARGETING`, `DIALOGUE`, `GAME_OVER`, `FACTION_RELATIONS`, `CHARACTER_SHEET`, `CODEX`, `ZONE_MAP`, `WORLD_MAP`, `OVERWORLD`, `SPELLBOOK`.
  - `src/core/session_controller.ts`: `startNewRun()` calls `initNewGame()`, which immediately spawns the player from the static `player_hero` entity template in `entities.json` without a character creation step.
  - `src/rulesets/dnd35e/dnd35e_ruleset.ts`: `grantDnD35eXp()` updates `actorProg.xp`, and `renderHudAlerts()` (`src/rendering/ui/hud_alerts.ui.ts`) already displays a `"LEVEL UP READY! [L]"` badge when `actorProg.xp >= getNextLevelXpThreshold(ecl)` — **but pressing `L` currently has no bound `Intent` or Level-Up Modal!**
- **Required Architecture for Milestone 112:**
  1. **Pure Ruleset Logic (`src/rulesets/dnd35e/character_builder.ts`):**
     - All D&D 3.5e math lives in a pure, deterministic Tier 2 module (`character_builder.ts`) so it can be unit-tested headlessly and invoked by both the UI and automated tests:
       - **Point-Buy Calculator:** Standard 3.5e DMG point-buy cost table (`8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 8, 16: 10, 17: 13, 18: 16`), supporting presets `25` (Standard), `28` (High-Powered), and `32` (Elite), plus **Elite Array** (`[15, 14, 13, 12, 10, 8]`) and **Seeded `4d6kh3` Roll** using `rng` from `src/core/rng.ts`.
       - **Skill Budget & Rank Validator:**
         - Level 1 budget: `Math.max(1, classDef.skillPointsPerLevel + intMod) * 4 + (hasHumanBonusSkillPoints ? 4 : 0)`.
         - Subsequent level budget: `Math.max(1, classDef.skillPointsPerLevel + intMod) + (hasHumanBonusSkillPoints ? 1 : 0)`.
         - Class skill cost: `1 point = 1.0 rank`, max rank `totalHd + 3`.
         - Cross-class skill cost: `1 point = 0.5 rank`, max rank `(totalHd + 3) / 2` (unless ever a class skill across any taken class or granted domain, in which case max rank is `totalHd + 3`).
         - Live 5-rank synergy preview (`getSkillSynergyPreview`).
       - **Feat Slot Calculator:**
         - Level 1: `1` General Feat + `1` Racial Bonus Feat (if Human `bonusFeatAtFirstLevel`) + `1` Class Bonus Feat (e.g., Fighter 1, Monk 1, Wizard 1 Scribe Scroll).
         - Level `N`: `1` General Feat if `newTotalHd % 3 === 0`, plus any Class Bonus Feat scheduled at the new class level (`fighter` even levels, `wizard` 5/10/15/20, `monk` 2/6, `ranger` 2/6/11, `eldritch_knight` 1).
       - **Apply Character Creation (`applyCharacterCreationToPlayer`) & Apply Level-Up (`applyLevelUpToActor`):**
         - Pure state transformers that update `StatsComponent`, `HealthComponent`, `DnD35ActorProgressionComponent` (`raceId`, `classLevels`, `feats`, `skillRanks`, `selectedAcfs`, `favoredClass`, `domains`, `arcaneSchool`, `prohibitedSchools`), `DnD35SpellcastingComponent`, `StatModifierComponent` (emitting class/race/domain/feat Effect Provider modifiers with `sourcePath`), and starting equipment items.
  2. **UI Modes & Intents (`src/types/game-state.types.ts`, `src/types/intent.types.ts`, `src/rendering/ui/dnd35e_char_builder.ui.ts`):**
     - Add `UIMode.CHAR_CREATION = 'CHAR_CREATION'` and `UIMode.LEVEL_UP = 'LEVEL_UP'`.
     - Add `IntentType.OPEN_LEVEL_UP = 'OPEN_LEVEL_UP'` (bound to `KeyL` when level-up is ready or via HUD click).
     - Build `src/rendering/ui/dnd35e_char_builder.ui.ts` (~220 lines) + `src/rendering/ui/dnd35e_level_up.ui.ts` (~180 lines) using `document.createElement()` (strict zero-`.innerHTML` policy per `AGENTS.md` §7):
       - **7-Step Character Creation Wizard:** (1) Race, (2) Class + Domains/Specialty/ACFs, (3) Ability Scores (Point Buy 25/28/32, Elite Array, 4d6kh3), (4) Skills (with synergy indicators), (5) Feats (with live green/red `evaluatePrerequisiteAST` badges), (6) Starting Spells, (7) Starting Equipment Package.
       - **Interactive Level-Up Modal:** Triggered when `actorProg.xp >= getNextLevelXpThreshold(ecl)` via `[L]` or clicking the `"LEVEL UP READY! [L]"` HUD alert. Guides the player through Class selection (Base or eligible Prestige Class with live prerequisite breakdown), Hit Die HP gain (Average vs Seeded Roll + CON mod, min 1), Every-4th-HD Ability Score Increase, Skill Points, Earned Feats, and New Spells.

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling JSONs / Kits / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. Split `classes.json` into `classes.json` + `classes/<classId>.json` + `domains.json` (`dnd35e_ruleset.ts`, `loader.ts`)** | `DnD35eRuleset.getSystemContentFiles()` declares descriptors for `classes.json`, `classes/<id>.json` (sharing `key: 'classes'`), and `domains.json` (`key: 'domains'`). **`classic` ruleset (`classic_ruleset.ts`) returns `[]` from `getSystemContentFiles()` and is 100% unaffected.** | `src/core/loader.ts`, `tests/helpers.ts`, and `scripts/run-validator.ts` shallow-merge multiple descriptors sharing the same `key` into `rawSystemContent[desc.key]`. `DnD35SystemContentSchema` validates the merged `classes` and `domains` dictionaries. | `docs/MILESTONES.md` (Milestones 110–111 updated to specify `classes.json` + `classes/<classId>.json` + `domains.json`), `docs/DND_35E_PYRAMID_ARCHITECTURE.md`, `docs/DECISIONS.md`, `scripts/bootstrap-campaign.ts`, and `public/data/campaigns/default/` & `arena/` (unaffected in memory because `systemContent.classes` remains a unified `Record<string, DnD35ClassDefinition>`). |
| **2. Expand `DnD35ClassDefinitionSchema`, `DnD35DomainDefinitionSchema`, & `PrerequisiteNodeSchema` (`dnd35e_system.types.ts`, `prerequisites.ts`)** | Authored in `public/data/rulesets/dnd35e/classes/*.json` and `domains.json`. | `evaluatePrerequisiteAST()` in `src/rulesets/dnd35e/prerequisites.ts` handles new `'alignment'` and `'spell_level'` AST nodes; `progression.ts` and `character_builder.ts` consume `allowedAlignments`, `proficiencies`, `bonusFeatPool`, and `domains`. | `src/rulesets/dnd35e/srd_registry.ts` exposes `getDomainDefinition()` and `getAllClasses()` helpers; `tests/dnd35e_cartridge.test.ts` and new `tests/dnd35e_classes_builder.test.ts` validate all 11 base classes, 10 PrCs, and 22 domains. |
| **3. Multiclass XP Penalty Calculator (`src/rulesets/dnd35e/progression.ts` & `dnd35e_ruleset.ts`)** | `grantDnD35eXp()` in `src/rulesets/dnd35e/dnd35e_ruleset.ts` and `calculateMulticlassXpMultiplier()` in `progression.ts`. | `DnD35ActorProgressionComponent.xp` gain on monster kills/quest rewards; Character Sheet & Level-Up Modal display active multiclass XP multiplier warning if `< 1.0`. | `races.json` (`favoredClass: 'any'` on Human/Half-Elf vs specific class on Dwarf/Elf/Gnome/Halfling/Half-Orc); Prestige Classes (`isPrestige: true`) exempted. |
| **4. Extend `DnD35ActorProgressionComponent` with `domains`, `arcaneSchool`, `prohibitedSchools`, `alignment` (`dnd35e.types.ts`)** | Populated by `character_builder.ts` (`applyCharacterCreationToPlayer`, `applyLevelUpToActor`) and monster/NPC synthesizer. | Consumed by `spellcasting.ts` (specialist school +1 slot, Cleric +1 domain slot, prohibited school check), `prerequisites.ts` (`alignment` and `spell_level` checks), and `character_sheet.ui.ts`. | Save/load serializer (`src/core/save_manager.ts`) automatically persists plain JSON fields on `DnD35ActorProgressionComponent` (all new fields optional for backward compatibility with existing fixtures). |
| **5. Add `UIMode.CHAR_CREATION`, `UIMode.LEVEL_UP` & `IntentType.OPEN_LEVEL_UP` (`game-state.types.ts`, `intent.types.ts`, `input_handler.ts`, `presenter.ts`, `ui.ts`, `session_controller.ts`)** | `input_handler.ts` (`KeyL` or HUD click emits `OPEN_LEVEL_UP`), `session_controller.ts` (opens Character Creation Wizard on new `dnd35e` run or applies character build). | `src/core/engine.ts` (exhaustive `IntentType` switch), `src/rendering/presenter.ts` (renders `CHAR_CREATION` and `LEVEL_UP` modals), `src/rendering/ui/menus.ui.ts` (`hideAllModals`), `index.html` (modal container nodes). | `docs/ARCHITECTURE.md` and `docs/MILESTONES.md` updated to document the Character Builder & Level-Up subsystems. |

---

## 5. Verification & Test Strategy

1. **System Content & Schema Validation:**
   - Verify all **11 SRD Base Classes** (levels 1–20 BAB, saves, skill points, class skills, spell tables, features, and ACFs), **10 SRD Prestige Classes** (levels 1–10 + `PrerequisiteNode` ASTs), and **22 Cleric Domains** pass `DnD35SystemContentSchema` validation in `bun run validate-data` and unit tests.
2. **Unit & Integration Tests (`tests/dnd35e_classes_builder.test.ts`):**
   - Test multi-file `classes.json` + `classes/<id>.json` merging via `loadCampaignFromDisk`.
   - Test ACF `PRIM-2.1` swaps (e.g., Barbarian *Lion Spirit Totem* swapping `fast_movement` for `pounce`, Rogue *Penetrating Strike* swapping `trap_sense_1`, Monk *Invisible Fist* swapping `evasion`).
   - Test Cleric Domain selection (2 domains granting domain powers with `sourcePath` and domain spells) and Wizard Specialist School selection (+1 specialty slot, prohibited school enforcement, Divination 1-prohibited-school rule).
   - Test Prestige Class `evaluatePrerequisiteAST` validation (e.g., *Mystic Theurge* requiring 2nd-level arcane + 2nd-level divine + Knowledge skills; *Assassin* requiring Evil alignment + Hide 8 / Move Silently 8 / Disguise 4; *Dwarven Defender* requiring Dwarf + Lawful + BAB +7 + Dodge/Endurance/Toughness).
   - Test Multiclass XP penalty math (Human `favoredClass: 'any'` ignoring highest base class; Dwarf `favoredClass: 'fighter'` ignoring Fighter; Prestige Classes `isPrestige: true` never causing penalties; `-20%` per offending base class > 1 level apart).
   - Test Character Builder point-buy (25/28/32 pt), skill rank allocation (class `1:1` max `HD+3`, cross-class `1:0.5` max `(HD+3)/2`), feat prerequisite checking, and `applyLevelUpToActor` progression.
