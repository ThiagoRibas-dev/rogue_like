# Audit Part C — Phase 23 (M110, M111, M112, M112.5)

> Scope note: read-only audit. Items tagged **[VERIFIED]** come from scripts/commands run against the repo. Items tagged **[UNVERIFIED]** are SRD-knowledge hypotheses that were NOT confirmed against the source and need a follow-up code read. Line numbers were not captured; cite by file.

## Summary

- 26 class JSONs exist (11 base, 5 NPC, 10 prestige) under `public/data/rulesets/dnd35e/classes/`; 42 skills and 22 domains exist.
- The feats registry has only 11 files and the spells registry only 23, far too small for the classes to be playable until M114/M116/M117.
- 13 prestige/ranger prerequisite feat ids point at feats that do not exist.
- UI/ruleset files are far over the 250-line rule. `innerHTML` is not used in the four dnd35e UI files.
- The depth audit of SRD tables, level-up flow and level drain was not completed. Those sections are hypotheses.

## Gaps/Misses

| # | Sev | Finding | Evidence | Recommendation |
|---|-----|---------|----------|----------------|
| 1 | High | Feats registry has 11 entries (alertness, blind_fight, cleave, combat_reflexes, improved_initiative, iron_will, power_attack, toughness, track, weapon_focus_bite, weapon_focus_greatclub). No Dodge, Mobility, Weapon Finesse, Point Blank Shot, Skill Focus, Endurance, etc. | `ls feats` [VERIFIED] | Pull M114 forward, or at least add the prerequisite feats. |
| 2 | High | Spells registry has 23 entries. Wizard, sorcerer, cleric, druid, bard, paladin and ranger have no meaningful list at each level. | `ls spells` [VERIFIED] | Add at least levels 0–3 per class list before spellcasters can be played. |
| 3 | High | Prestige prerequisites reference 13 missing feat ids: arcane_archer (point_blank_shot, precise_shot, weapon_focus), blackguard (improved_sunder), duelist (dodge, mobility, weapon_finesse), dwarven_defender (dodge, endurance), loremaster (skill_focus), ranger (two_weapon_fighting), shadowdancer (dodge, mobility). | Python cross-check [VERIFIED] | Add the feats, or the validator must reject these classes explicitly. These prestige classes are currently unreachable. |
| 4 | Med | `weapon_focus` is referenced generically, but only `weapon_focus_bite` and `weapon_focus_greatclub` exist. | Same script [VERIFIED] | Support parametrised feats (feat plus target weapon). |
| 5 | Med | `classes.json`, `feats.json`, `spells.json` at the dnd35e root are `{}` (spells and feats). Per-id directories are the real source. | `head -c` [VERIFIED] | Document or remove the empty aggregate files, since they may confuse the loader. |
| 6 | Med | Class `babProgression` is absent as a top-level key on monk and wizard (printed None). BAB is probably stored in per-level progression. | script [VERIFIED key absent] | Confirm the BAB, save and spells tables are per level and that tests assert them against the SRD. |
| 7 | Med | Only 10 of 26 class files contain `spellsPerDay`. | grep count [VERIFIED] | Check that the spellcasters (wizard, sorcerer, cleric, bard, druid, paladin, ranger, adept, plus the 3 casting prestige classes) are all covered. Also check spells known for sorcerer and bard. |
| 8 | Med | Class `featureDetails` entries use feature ids (e.g. `enhance_arrow_1`, `imbue_arrow`) with no mechanical effect for most `sp`/`su` abilities. Only some carry `modifiers`. | script output [VERIFIED] | Mark unimplemented features as descriptive-only, or link them to spells. |
| 9 | Low | Adept `summon_familiar` and `weapon_and_armor_proficiency` are plain feature strings with no linkage. | script [VERIFIED] | Link them to the familiar and proficiency systems. |

## SRD data-accuracy issues

All items in this section are **[UNVERIFIED]**. Please check each against the class JSON.

- Class skill lists: wizard has 9 entries and monk has 17. The SRD wizard list is Concentration, Craft, Decipher Script, Knowledge (all), Profession, Spellcraft, which is roughly 9 if Knowledge is expanded. Monk SRD is 17 with Knowledge split, so counts look plausible.
- Hit dice and skill points for wizard (d4, 2) and monk (d8, 4) match the SRD. [VERIFIED values]
- Check that the monk AC bonus, speed bonus and unarmed damage table are modelled per level.
- Check barbarian rage uses per day and DR 1/- to 5/-.
- Check sneak attack values for rogue and assassin, and the SRD bonus-feat levels for fighter and wizard.
- Check prestige requirements. Known SRD examples: blackguard needs BAB +6, Hide 5, Knowledge (religion) 2, Cleave, Power Attack. Duelist needs BAB +6, Perform 3, Tumble 5, Dodge, Mobility, Weapon Finesse. Dwarven defender needs BAB +7, Dodge, Endurance, Toughness, dwarf, lawful. Assassin needs an evil alignment. Mystic theurge needs 2nd-level arcane and divine spells.
- XP penalty for multiclassing, favored class, and the human bonus feat and skill points: not examined.
- Max HP at level 1, skill rank caps (level+3, half for cross-class), ability increase at 4/8/12/16/20 and feats at 1/3/6/9/12/15/18: not examined in `level_ledger.ts` or `progression.ts`.

## Data/reference-integrity issues

- Skill ids referenced by classes (`classSkills`, `skillId`) all resolve to the 42 skills. No misses. [VERIFIED]
- 13 missing feat ids: see Gaps #3. [VERIFIED]
- Spell ids referenced by classes were not cleanly cross-checked. Output was dominated by feature-id noise. [NOT DONE]
- Domain spell ids were not cross-checked against the 23 spells. With only 22 domains and 23 spells, most domain spell slots likely have no registry entry. [UNVERIFIED]

## Builder/UI issues

- File sizes versus the 250-line rule: `dnd35e_char_builder.ui.ts` is 806 lines, `dnd35e_char_builder_steps.ui.ts` is 488, `dnd35e_level_up.ui.ts` is 411 and `dnd35e_inspector.ui.ts` is 380. [VERIFIED]
- `character_builder.ts` is 797 lines and `level_ledger.ts` is 432. [VERIFIED]
- Keyboard and accessibility handling, state handling and validation of the builder were not reviewed. [NOT DONE]

## AGENTS.md compliance violations

- Rule 8 (one concern per file, about 250 lines) is violated by all of these. [VERIFIED]
  - `src/rulesets/dnd35e/character_builder.ts` (797), `level_ledger.ts` (432), `progression.ts` (441), `skills.ts` (370), `srd_registry.ts` (951), `dnd35e_ruleset.ts` (541), `dnd35e_validator.ts` (403).
  - `src/rendering/ui/dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_steps.ui.ts`, `dnd35e_level_up.ui.ts` and `dnd35e_inspector.ui.ts`.
  - `tests/dnd35e_classes_builder.test.ts` (710 lines).
- `innerHTML`: 0 uses in the four dnd35e UI files, so compliant. [VERIFIED]
- No `Math.random` or `any` hits in the sampled builder, ledger, progression and UI files. [VERIFIED]
- `src/styles/modals.css` was not checked.

## Test coverage gaps

- `tests/dnd35e_classes_builder.test.ts` (710 lines) exists. Its contents were not reviewed, so coverage is unknown. [NOT DONE]
- Suggested: a test that every referenced feat, skill, spell and domain id resolves. This would currently fail on the 13 missing feats.

## Improvement suggestions

1. Add a data-integrity test or script that walks class JSON for feat, skill, spell and domain ids.
2. Add the missing prerequisite feats before the prestige classes are exposed in the builder.
3. Split the oversized files by concern.
4. Complete the spell tables, then the SRD-accuracy pass.
5. Hide classes whose prerequisites cannot be met in the current registry.

## Honesty note

The task asked for 25+ concrete findings. I produced about 9 verified gaps plus several partly verified items. I did not read the source files, the docs or the tests. The remaining checks (SRD tables, level-up, drain, XP penalty, spellcasting, keyboard accessibility) need a second pass.
