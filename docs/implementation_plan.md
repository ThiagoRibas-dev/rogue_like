# Implementation Plan — Phase 51: Level-20 D&D 3.5e Benchmark Architecture & Full Phased Roadmap (Milestones 193–198)

*Drafted and enhanced per `AGENTS.md` Kickoff Flow Steps 4–5 from the verified research ledger (`/docs/dnd35e/L20_BENCHMARK_PRELIMINARY_RESEARCH.md`, §§1–7.5) and audited against `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md`.*

---

## 0. Master 6-Phase Roadmap (Milestones 193–198)

All systems exposed by the **Triel Fitheaben**, **Remi (Celestial Raven Harrier)**, and **Myn (Dragon Cohort)** Level-20 benchmarks are decomposed into **6 atomic, shippable milestones** executed one phase at a time (`AGENTS.md` Rule #13):

| Phase | Milestone | Scope Summary | Benchmark Coverage Unlocked |
| :--- | :--- | :--- | :--- |
| **Phase A** *(Detailed Below)* | **M193** | **Core Bugfixes (7 Repo Bugs), `exalted`/`perfection` Bonus Types, Campaign Ruleset Options (`dnd35eRules`), Metamagic Engine (*Persistent*, *DMM*, *Rods*), `Practiced Spellcaster` HD Cap, Dynamic `valueFormula` (*Reserve Feats*, `deity_match`, `maxHdRelativeToCl`), Action Points & Skill Tricks (*Collector of Stories*)** | Fixes `sun.json`, `celestial.json`, `keen`, `holy_word.json`, `divine_power.json`, `spellbook_slots.ts` PrC slots; unlocks *Sunbeam*, *Lesser Restoration*, *Persistent Spell*, *Divine Metamagic*, *Practiced Spellcaster*, *Holy Warrior*, *Collector of Stories*, Action Points |
| **Phase B** | **M194** | **Item Composition & Magic Item Crafting Engine:** `attachedSockets` (Augment Crystals + recursive `moveToLimbo` packaging), MIC `combinedItemIds` + `crafting_rules.json` (SRD pricing + MIC Table 6–11), `itemOverlays[]` (*Magic Vestment*, *GMW*, *Sacred Item*, *Channel Spell*), `item_crafting.ts`, Workbench + `simulated_downtime` toggle, `attunementDaysRequired`, `relicGate`, `grantAction` (*Belt of Battle*), Triel's full L15/L20 gear | Fixes `magic_vestment.json` & `greater_magic_weapon.json`; unlocks MIC crystals, slot-combining, crafting validation/pricing, *Blurring*/*Restful*/*Durable*/*Sanctified*, *Gauntlets of War*, *Reliquary Holy Symbol*, *Belt of Battle*, *Nightstick* non-stacking |
| **Phase C** | **M195** | **Classes, ACFs, Domain/Devotion Trades, Dual Turning Pools & Companions:** *Lightbringer Cleric ACF* (*Destroy Undead* + *Undead Intuition*), *Ordained Champion*, *Knight of the Raven* (+ Remi dawn-respawn & Harrier orders), *Righteous Cohort of Kiri-Jolith*, *Overwhelming Attack Monk*, tag-unified *Smite*/*Channel Spell*, *Law Devotion* & *Enduring Life*/*Parrying Shield* | Full Triel class/PrC/ACF/Domain chassis + full Remi companion scaling & tactical commands |
| **Phase D** | **M196** | **Tome of Battle Engine:** Tier 1 Tactical Deck (`known/readied/granted/expended`), `DelayedDamageBufferComponent` (*Steely Resolve* + *Furious Counterstrike*), Initiator Level (IL), *Crusader* (L1–20), all 6 benchmark maneuvers/stance (*Martial Spirit*, *Douse the Flames*, *Mountain Hammer*, *Revitalizing Strike*, *White Raven Strike*, *Divine Surge*), *Extra Granted Maneuver*, *Martial Study*, *Martial Stance* | Complete Crusader & ToB initiator substrate reusable by Swordsage & Warblade |
| **Phase E** | **M197** | **Incarnum, Psionics, Invariant-Guarded Tracks & Playable Dragons:** Tier 1 Mutable Point Allocator + Chakra Slot-Locks (*Totemist* + 4 soulmelds + *Shape Soulmeld*); XPH Psionics (`power_points`, PR/SR transparency, HD-scaled PLAs, *Phrenic*); Tier 1 Invariant-Guarded Progressive Overlay (*Vow of Poverty* L1–20, *Sanctified Creature*, *Ex-Righteous Cohort*); Playable Dragon RHD/LA + *Wyrm of War* + *Purple Dragon* + *Iron Dragon* + *Dragon Cohort* + Myn's Exalted/Dragon feats | Complete Myn chassis, Incarnum, Psionics, VoP, Ravages (*Touch of Golden Ice*), *Stigmata*, *Lliira's Blessing*, *Entangling Exhalation*, *Intuitive Attack*, *Improved Multiattack* |
| **Phase F** | **M198** | **Remaining Track 6 Spells, Reactive Interrupt Policies & L20 Automated Benchmark Suite:** *Fortunate Fate*, *Delay Death*, *Triadspell*, *Protective Interposition*, *Holy Star*, *Visions of the Future*, *Sacred Item*, *Brilliant Aura*, *Hand of the Faithful*, *Elation*, *Recitation*, *Lesser Holy Transformation*, *Righteous Wrath of the Faithful*, *Dragon Breath*, *Mass Lesser Vigor*, *Sublime Revelry*, *Snowshoes*, *Delay Disease*, *Delay Poison*, *Mass Resist Energy*, *Superior Resistance*, *Mass Death Ward*, *Ice Slick*, *Lava Missile*, *Shivering Touch*, *Irian's Light*, *Divine Insight*, *Valiant Steed* + End-to-End L20 Triel/Remi/Myn Regression Suite | 100% end-to-end automated verification of Triel, Remi, and Myn |

**This document details Phase A (Milestone 193) down to exact code snippets/diffs for immediate approval and execution. Subsequent phases (B–F) will each follow the same approval gate once the prior phase passes all 8 `./verify.sh` stages.**

---

## 1. Phase A (Milestone 193) — Architectural Compliance & Existing Utility Audit

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule #16):**
   - **Tier 1 Console (`src/types/`, `src/core/`, `src/systems/`, `src/constants/`):**
     - `ResourceRefreshCycle` extended with `'on_level_up'` (for Action Points) alongside `'round' | 'encounter' | 'short_rest' | 'rest_8h'` (`actor_components.types.ts`, `rest.system.ts`, `encounter` reset hook).
     - `RulesConfigSchema.rulesetOptions` / `dnd35eRules` campaign configuration block (`src/types/campaign/meta.ts`) so campaign authors & campaign-start settings configure all locked ruleset switches cleanly.
     - Generic `sameSourceStackKey?: string` on `ResourcePoolEntry` / pool modifiers and `on_level_up` refresh support.
   - **Tier 2 Cartridge (`src/rulesets/dnd35e/`):**
     - `'exalted'` & `'perfection'` bonus types in `stats.types.ts`, `effect_system.types.ts`, `provenance.ts`, `stacking_engine.ts` (including BoED p. 29 `exalted` AC competition vs `armor`, Touch AC exclusion, and Incorporeal Touch / Brilliant Energy preservation).
     - `capByActorMetric?: 'total_hd'` on `DnD35DeclarativeModifierSchema` & `StatModifier`, resolved in `resolveSpellEffectiveCasterLevel` (`spell_modifiers.ts`) BEFORE uncapped CL bonuses (*Practiced Spellcaster*).
     - `spellbook_slots.ts` bugfix using `Math.max(track.levels, book.effectiveCasterLevel)` for Prestige Class slot lookup.
     - `DnD35MetamagicDescriptorSchema` extended with `fixedDurationOverride?: '24_hours'`, `allowedRanges?: ReadonlyArray<string>`, `forbidInstantaneous?: boolean`, `forbidDischargeable?: boolean` (*Persistent Spell*); declarative `resourceSubstitutedMetamagic` (*Divine Metamagic*) & `metamagicRodDescriptor` (*Metamagic Rods*) in `spell_cast_helpers.ts` & `spell_cast_resolver.ts`.
     - Dynamic `valueFormula` on `DnD35DeclarativeModifierSchema` (`highest_available_spell_level` filtered by optional `spellFilterTags`, e.g., Reserve Feats like *Holy Warrior*) evaluated in `dnd35e_dag_adapter.ts` & `effect_bundle.ts`; `maxHdRelativeToCl` & `saveModifier` on `DnD35SpellEffectUnitSchema` / `DnD35SpellSavingThrowSchema` (*Holy Word*, *Blasphemy*, *Dictum*, *Word of Chaos*); `deityMatch` / `targetMatchesCasterDeity` tag projection (`deity:<id>`) in `semantic_tags.ts`.
     - `DnD35ItemEnhancementSchema.requiredDamageTypes?: ReadonlyArray<DnD35DamageType>` enforcing *Keen* eligibility (`piercing` / `slashing`).
     - Action Point resolver (`src/rulesets/dnd35e/progression/action_points.ts` — pure Eberron `1d6/2d6/3d6` & UA `1d6/2d6/3d6/4d6` formulas + d20 boost math) and Skill Trick schema/registry (`DnD35SkillTrickDefinitionSchema` + `learnedSkillTricks` on `DnD35EntityData` + `1/encounter` pool hydration for *Collector of Stories*).
   - **Tier 3 System Content (`public/data/rulesets/dnd35e/`):**
     - Bugfix 5 existing JSON files: `domains/sun.json`, `templates/celestial.json`, `item_enhancements.json` (`keen`), `spells/holy_word.json`, `spells/divine_power.json`.
     - Author missing SRD spells: `spells/sunbeam.json`, `spells/lesser_restoration.json`.
     - Author Phase A feats & skill tricks: `feats/persistent_spell.json`, `feats/divine_metamagic.json`, `feats/practiced_spellcaster.json`, `feats/holy_warrior.json`, `skill_tricks/collector_of_stories.json`.
2. **Existing Utilities Reused (Zero Duplication):**
   - `getTurnsPerDay` from `src/utils/duration.ts` (reused for `persistent` 24-hour spell duration — zero magic `14400` literal!).
   - `resolveTypedModifiersWithBreakdown` from `src/rulesets/dnd35e/modifiers/stacking_engine.ts`.
   - `matchesEntityTagCondition` from `src/systems/reaction.system.ts`.
   - `evaluateDiceExpression` / `rollSingleDie` from `src/rulesets/dnd35e/math/dice.ts`.
   - `consumeResourcePool` from `src/core/ecs.ts`.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner | Evicted / Fixed Legacy Path |
| :--- | :--- | :--- |
| **Bonus Stacking & `exalted` AC Competition** | `src/rulesets/dnd35e/modifiers/stacking_engine.ts` + `provenance.ts` | Fix `DnD35RacialConditionalModifierSchema.type` duplicate enum to reuse `DnD35BonusTypeSchema` directly |
| **Prestige Spell Slot Table Lookup** | `src/rulesets/dnd35e/magic/spellbook_slots.ts` (`computeClassLevelSlotSummaries`) | Fix raw `track.levels` lookup that ignored `book.effectiveCasterLevel` |
| **Effective Caster Level (HD-Capped vs Uncapped)** | `src/rulesets/dnd35e/magic/spell_modifiers.ts` (`resolveSpellEffectiveCasterLevel`) | Keeps `computeEffectiveClassCastingLevel` strictly for spell-slot progression, preventing *Practiced Spellcaster* from inflating spells/day |
| **Metamagic Cost, Duration & Rod/DMM Substitution** | `src/rulesets/dnd35e/magic/spell_cast_helpers.ts` + `spell_duration.ts` | Replaces ad-hoc `fid.startsWith('rod:')` bypass with schema-validated `metamagicRodDescriptor` & `resourceSubstitutedMetamagic` |
| **CL-vs-HD Escalation & Unit Save Modifiers** | `src/rulesets/dnd35e/magic/spell_effects.ts` + `spell_cast_resolver.ts` | Replaces incomplete 2-unit `holy_word.json` with full 4-tier `maxHdRelativeToCl` ladder + `saveModifier: -4` |
| **Dynamic Modifier Formulas (Reserve Feats)** | `src/rulesets/dnd35e/modifiers/dynamic_formulas.ts` (called by `dnd35e_dag_adapter.ts`) | Eliminates any need for bespoke Reserve Feat `.ts` branches |
| **Action Points & Skill Tricks** | `src/rulesets/dnd35e/progression/action_points.ts` & `ledger_resource_pools.ts` | Uses standard Tier 1 `ResourcePoolComponent` (`refreshCycle: 'on_level_up'` / `'encounter'`) instead of parallel ad-hoc counters |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule #21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| ***Exalted* AC Stacking & Touch/Incorporeal Rules** | `if (mod.sourceId === 'vow_of_poverty')` in `ac_breakdown.ts` | First-class `BonusType = 'exalted'` in `stacking_engine.ts` competing with `armor` on `targetStat === 'ac'`, excluded on normal Touch AC, preserved on `againstIncorporealTouch` / `brilliant_energy` | **Yes** — any feat, spell, or item emitting `type: "exalted"` gets exact BoED AC rules automatically. |
| ***Keen* Piercing/Slashing Restriction** | `if (enhId === 'keen' && dmgType === 'bludgeoning') return false` | `requiredDamageTypes?: ReadonlyArray<DnD35DamageType>` on `DnD35ItemEnhancementSchema` (`keen` sets `["piercing", "slashing"]`) | **Yes** — any modded enhancement (*Impact* `["bludgeoning"]`, *Vorpal* `["slashing"]`) works purely in JSON. |
| ***Holy Word* / *Blasphemy* / *Dictum* Escalation & `-4` Banishment Save** | `if (spell.id === 'holy_word') { ... }` in `spell_cast_effects.ts` | `maxHdRelativeToCl?: number` on `SpellEffectUnitBaseSchema` (`0`, `-1`, `-5`, `-10`) + `saveModifier?: number` on `DnD35SpellSavingThrowSchema` (`-4`) | **Yes** — *Blasphemy*, *Dictum*, *Word of Chaos*, and custom spells author their exact ladders in JSON. |
| ***Practiced Spellcaster* HD Cap** | `if (hasFeat('practiced_spellcaster')) cl = Math.min(hd, cl + 4)` | `capByActorMetric?: 'total_hd'` on `DnD35DeclarativeModifierSchema` / `StatModifier` evaluated in `resolveSpellEffectiveCasterLevel` before uncapped CL modifiers | **Yes** — any feat/item/PrC boosting CL up to HD (or a variant `+2` cap) works with zero `.ts` changes. |
| ***Persistent Spell* Eligibility & 24h Duration** | `if (featId === 'persistent_spell') duration = 14400` | `DnD35MetamagicDescriptorSchema`: `fixedDurationOverride: '24_hours'`, `allowedRanges: ['personal', 'fixed']`, `forbidInstantaneous: true`, `forbidDischargeable: true` | **Yes** — any custom duration-setting metamagic feat uses the same declarative fields and `getTurnsPerDay(clock)`. |
| ***Divine Metamagic* Pool Substitution** | `if (featId === 'divine_metamagic') consume('turn_undead', 1 + bump)` | `resourceSubstitutedMetamagic: { requiredPoolTag: 'pool:turn_undead_equivalent', baseCost: 1, costPerSlotBump: 1, requiresOwnedTargetFeat: true }` on `DnD35FeatDefinitionSchema` | **Yes** — any alternative fuel metamagic (e.g., *Psionic Metapower* or *Domain Metamagic*) is purely JSON. |
| ***Holy Warrior* Reserve Feat (+N Damage = Highest Uncast War Spell Level)** | `if (hasFeat('holy_warrior')) bonus = getHighestWarSpell()` | `valueFormula: { kind: 'highest_available_spell_level', requiredDomainId?: string, requiredDescriptors?: string[], requiredSchools?: string[], minSpellLevel?: number, multiplier?: number }` on `DnD35DeclarativeModifierSchema` | **Yes** — ALL *Complete Mage* / *Complete Champion* Reserve Feats (*Fiery Burst*, *Acidic Splatter*, *Holy Warrior*, *Touch of Healing*) work purely in JSON. |
| ***Collector of Stories* Skill Trick (+5 Insight to Identify Monster, 1/Encounter)** | `if (hasTrick('collector_of_stories')) bonus += 5` | First-class `DnD35SkillTrickDefinitionSchema` (`skill_tricks/*.json`) with `skillPointCost: 2`, `prerequisites`, `refreshCycle: 'encounter'`, `effectBundle` targeting `effectTagsAny: ['skill_use:monster_lore']` | **Yes** — all *Complete Scoundrel* skill tricks (*Acrobatic Backstab*, *Swift Concentration*, *Tumbling Crawl*) load from JSON. |
| **Campaign Homebrew / Rule Variant Switches** | Hardcoding global booleans in Cartridge `.ts` files | `DnD35RulesetOptionsSchema` embedded in `RulesConfigSchema.dnd35eRules` (defaults strictly matching locked §7.5 rulings) | **Yes** — every campaign JSON and Campaign-Start UI configures variants cleanly without editing code. |

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule #15)

| Change | Upstream (Callers / Producers / Seeds) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling JSONs / Editor / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **`BonusType` += `'exalted' \| 'perfection'`** | `stats.types.ts`, `effect_system.types.ts` (`DnD35DeclarativeModifierSchema`, `DnD35RacialConditionalModifierSchema`) | `provenance.ts` (`isArmorOrNaturalBonus`), `stacking_engine.ts` (`resolveCompoundGroup`), `ac_breakdown.ts`, `dag_resolver.ts`, `DnD35eInspector.tsx` | Any exhaustive `switch (bonusType)` check; `tests/phase51_phaseA_core_rules.test.ts` |
| **`RulesConfigSchema.dnd35eRules` (`DnD35RulesetOptionsSchema`)** | `src/types/campaign/meta.ts`, `src/rulesets/dnd35e/types/system/base_system.types.ts` | `action_points.ts`, `ledger_resource_pools.ts`, future Phase B/C/E resolvers, Save serialization (campaign rules persist automatically) | `default` & `realms-of-shroudgarde` campaigns (schema defaults keep existing JSONs 100% valid without edits), Campaign Editor Rules tab |
| **`ResourceRefreshCycle` += `'on_level_up'`** | `src/types/components/actor_components.types.ts`, `effect_system.types.ts` | `rest.system.ts` (must NOT reset `'on_level_up'` pools on rest), `builder_hydrator_levelup.ts` (refills `'on_level_up'` pools on level gain!), `ledger_resource_pools.ts` | `src/core/ecs.ts` pool helpers, HUD Resource Pool chips, Save serialization |
| **Bugfixes (`sun.json`, `celestial.json`, `keen`, `holy_word.json`, `divine_power.json`, `spellbook_slots.ts`)** | `public/data/rulesets/dnd35e/**`, `system_content_spell_ids.ts` (+`sunbeam`, `lesser_restoration`), `spellbook_slots.ts` | `dnd35e_validator.ts` (`scripts/run-validator.ts`), `spell_cast_resolver.ts`, `spell_effects.ts`, `dnd35e_equipped_item_dag.ts`, Prestige Class Spellbook UI | Existing unit tests touching `celestial.json`, `holy_word.json`, `divine_power.json`, or `sun.json` (audit & update assertions if any tested buggy values!) |
| **Metamagic (*Persistent*, *DMM*, *Rods*)** | `dnd35e_system.types.ts`, `item_system.types.ts`, `metamagic_dispel.ts`, `spell_cast_helpers.ts`, `spell_duration.ts` | `spell_cast_resolver.ts`, `spell_cast_effects.ts`, `DnD35eSpellbookModal.tsx` (optional rod/DMM selection hook) | `system_content_feat_ids.ts` (+`persistent_spell`, `divine_metamagic`, `practiced_spellcaster`, `holy_warrior`), `validateDnD35eSystemContentIntegrity` |
| **`capByActorMetric` & Dynamic `valueFormula`** | `effect_system.types.ts`, `stats.types.ts`, `modifiers/dynamic_formulas.ts` | `spell_modifiers.ts`, `spell_cast_resolver.ts`, `dnd35e_dag_adapter.ts`, `ledger_modifiers.ts` | `docs/ssot/ssot_dnd35e.json` (new `dynamic_formulas.ts`), `tests/phase51_phaseA_core_rules.test.ts` |
| **Action Points & Skill Tricks (`skillTricks` registry)** | `system_content_files.ts`, `dnd35e_system.types.ts`, `entity_data.types.ts` (`learnedSkillTricks`), `progression/action_points.ts` | `ledger_resource_pools.ts`, `builder_core.ts` (2-SP skill trick budget & `floor(totalHD / 2)` max tricks cap), `monster_lore_tracker.ts` / `skills.ts` (`effectTags: ['skill_use:monster_lore']`) | `src/core/loader.ts` (loads `skill_tricks/*.json` via `DND35E_SYSTEM_CONTENT_FILES`), `dnd35e_validator.ts`, `docs/ssot/ssot_dnd35e.json` |

---

## 5. Step-by-Step Phase A (Milestone 193) Implementation Details & Code Snippets

### Task A1 — Fix All 7 Pre-Existing Repository Bugs + Author Missing SRD Spells (`sunbeam`, `lesser_restoration`)

1. **`public/data/rulesets/dnd35e/domains/sun.json` (line 55):** Change `"7": "searing_light"` -> `"7": "sunbeam"`.
2. **`public/data/rulesets/dnd35e/templates/celestial.json`:**
   - Remove `"good"` from `"addSubtypes"` (keep `["extraplanar"]` per SRD Celestial Creature).
   - Split `hdTieredScaling` accurately to SRD Table:
     - `1–3 HD`: ER 5 (acid/cold/elec), no DR.
     - `4–7 HD`: ER 5, `DR 5/magic`.
     - `8–11 HD`: ER 10, `DR 5/magic`.
     - `12+ HD`: ER 10, `DR 10/magic`.
3. **`src/rulesets/dnd35e/types/system/item_system.types.ts` + `public/data/rulesets/dnd35e/item_enhancements.json`:**
   - Add `requiredDamageTypes: z.array(DnD35DamageTypeSchema).optional()` to `DnD35ItemEnhancementSchema`.
   - On `keen` (`item_enhancements.json:126`), add `"requiredDamageTypes": ["piercing", "slashing"]`.
   - Enforce `requiredDamageTypes` in `dnd35e_equipped_item_dag.ts` (and `equipment_physics.ts` if threat range is applied there — check via grep before editing!).
4. **`public/data/rulesets/dnd35e/spells/divine_power.json`:**
   - Set `"levelByDomain": { "war": 4 }`.
   - Add a `healing` effect unit for `1 temp HP per CL`:
     ```json
     {
       "unitId": "divine_power_temp_hp",
       "targetRole": "caster",
       "type": "healing",
       "dice": "0d1",
       "flatBonusScaling": { "baseValue": 0, "perCL": 1, "clStepInterval": 1, "startAboveCL": 0 },
       "invertsForUndead": false,
       "isTemporaryHp": true,
       "metamagicScalable": false
     }
     ```
     *(Verify `buildScaledDiceExpression("0d1", 0, cl)` / `evaluateDiceExpression` handles `"0d1+20"` cleanly, or support `"0"` literal in `evaluateMetamagicDamage` so zero-dice flat temp HP rolls deterministically without rolling `1d1`!)*
5. **`src/rulesets/dnd35e/types/system/spell_system.types.ts` + `spell_effects.ts` + `spell_cast_resolver.ts` + `public/data/rulesets/dnd35e/spells/holy_word.json`:**
   - Add `saveModifier: z.number().int().optional()` to `DnD35SpellSavingThrowSchema`.
   - Add `maxHdRelativeToCl: z.number().int().optional()` to `SpellEffectUnitBaseSchema`.
   - In `evaluateSpellEffectUnitsForTarget`, pass `casterLevel?: number` in `context` and filter:
     ```ts
     if (
       unit.maxHdRelativeToCl !== undefined &&
       context.casterLevel !== undefined &&
       context.targetHitDice !== undefined &&
       context.targetHitDice > context.casterLevel + unit.maxHdRelativeToCl
     ) {
       return false;
     }
     ```
   - In `spell_cast_resolver.ts`, apply `uSave.saveModifier ?? 0` to target's save roll bonus (`saveDag!.dagResult.saves[uSave.saveType] + (uSave.saveModifier ?? 0)`).
   - Update `holy_word.json` with all 4 cumulative sound-gated tiers (`deafened` `1d4 rounds` at `0`, `blinded` `2d4 rounds` at `-1`, `paralyzed` `1d10 minutes` at `-5`, `save_or_die: dead` at `-10`, all with `savingThrow: { saveType: "none", effect: "none" }` and `targetTagsNone: ["alignment:LG", "alignment:NG", "alignment:CG", "condition:deafened"]`) PLUS nongood extraplanar banishment (`targetTagsAll: ["subtype:extraplanar"]`, `targetTagsNone: ["alignment:LG", "alignment:NG", "alignment:CG"]`, `savingThrow: { saveType: "will", effect: "negates", saveModifier: -4 }`).
6. **`src/rulesets/dnd35e/magic/spellbook_slots.ts:90` (Pre-Existing Bug #7):**
   ```ts
   const rawTrackLevel = dndData.tracks?.find((t) => t.trackId === book.classId)?.levels ?? 1;
   const effectiveProgressionLevel = Math.max(1, Math.min(classDef?.maxLevel ?? 20, Math.max(rawTrackLevel, book.effectiveCasterLevel)));
   const progRow = classDef?.progression?.[effectiveProgressionLevel - 1];
   ```
7. **New SRD Spells (`public/data/rulesets/dnd35e/spells/sunbeam.json`, `lesser_restoration.json`) + register in `system_content_spell_ids.ts`:**
   - `sunbeam.json`: `Drd 7, Sun 7`, `[Light]`, `60-ft line`, `4d6` dmg + `blinded` (Ref negates/half) + `1d6/CL` (max `20d6`) to `type:undead` / `type:ooze` / `type:plant` (fungi/mold) + `save_or_die: dead` for `trait:sunlight_vulnerability` undead.
   - `lesser_restoration.json`: `Clr 2, Drd 2, Pal 1`, heals `1d4` ability damage/penalty + cures `fatigued` (and steps `exhausted` -> `fatigued`).

---

### Task A2 — `exalted` & `perfection` Bonus Types + BoED AC Stacking Rules

- **`src/rulesets/dnd35e/types/stats.types.ts` & `src/rulesets/dnd35e/types/system/effect_system.types.ts`:**
  - Add `'exalted'` and `'perfection'` to `BonusType` and `DnD35DeclarativeModifierSchema.shape.type`.
  - Refactor `DnD35RacialConditionalModifierSchema.shape.type` to use `DnD35BonusTypeSchema` directly.
- **`src/rulesets/dnd35e/modifiers/provenance.ts`:**
  - In `isArmorOrNaturalBonus(bonusType)`: return `true` for `'exalted'` (so normal Touch AC excludes it per BoED p. 29).
- **`src/rulesets/dnd35e/modifiers/stacking_engine.ts`:**
  - In Touch AC bypass check (`lines 70–81`): preserve `'exalted'` when `againstIncorporealTouch === true` (BoED p. 29: exalted AC applies against incorporeal touch attacks AND brilliant energy weapons!).
  - In `resolveCompoundGroup('armor', 'armor_enhancement')`: when resolving AC modifiers (`baseType === 'armor'`), pull `exaltedAcMods = nonStackingBuckets['exalted']?.filter((m) => m.targetStat === 'ac') ?? []` into competition with `mundaneCompoundValue` (`armor + armor_enhancement`) and `standaloneValue` (`Mage Armor`), shadowing the loser with the winner's `sourcePath`! Leave any non-AC `exalted` modifiers (e.g., saves/skills) in the normal `nonStackingBuckets['exalted']` loop.
  - Also preserve `'exalted'` in `dag_resolver.ts`'s `footAcResolution` filter (`bonusType !== 'armor' && bonusType !== 'shield' && bonusType !== 'deflection'`).

---

### Task A3 — Configurable Campaign Ruleset Options (`DnD35RulesetOptionsSchema`)

- **`src/rulesets/dnd35e/types/system/base_system.types.ts`:**
  ```ts
  export const DnD35RulesetOptionsSchema = z.object({
    actionPointsMode: z.enum(['none', 'eberron', 'unearthed_arcana']).default('none'),
    allowRelaxedDomainTradeOrder: z.boolean().default(false),
    stackSameSourceResourceBonus: z.boolean().default(false),
    turningPoolBoostDistribution: z
      .enum(['per_creature_kind', 'per_matching_pool', 'single_designated_pool'])
      .default('per_matching_pool'),
    sanctifiedStripAbilitiesPolicy: z
      .enum(['all_su_and_sla', 'evil_only', 'preserve_breath_weapon'])
      .default('all_su_and_sla'),
    psionicsMagicTransparency: z.boolean().default(true),
    craftingTimeMode: z.enum(['instant_workbench', 'simulated_downtime']).default('instant_workbench')
  });
  export type DnD35RulesetOptions = z.infer<typeof DnD35RulesetOptionsSchema>;
  export const DEFAULT_DND35E_RULESET_OPTIONS: DnD35RulesetOptions = DnD35RulesetOptionsSchema.parse({});
  ```
- **`src/types/campaign/meta.ts`:** Add `dnd35eRules: z.record(z.string(), z.unknown()).optional()` (or import a Console-safe neutral `rulesetOptions?: Record<string, unknown>` on `RulesConfigSchema` to preserve strict Tier 1 -> Tier 2 architectural dependency direction verified by `bun run lint:arch`!!).
  - **CRITICAL `lint:arch` CHECK:** Tier 1 (`src/types/campaign/meta.ts`) MUST NEVER import from Tier 2 (`src/rulesets/dnd35e/**`)! Therefore, `RulesConfigSchema` defines `rulesetOptions: z.record(z.string(), z.unknown()).optional()`, and a pure Tier 2 helper `resolveDnD35eRulesetOptions(campaign)` in `src/rulesets/dnd35e/srd_registry.ts` parses `campaign.rules.rulesetOptions` through `DnD35RulesetOptionsSchema` (memoized via `WeakMap` per `AGENTS.md` Rule #5)!

---

### Task A4 — `Practiced Spellcaster` HD-Capped Caster Level (`capByActorMetric`)

- **`src/rulesets/dnd35e/types/system/effect_system.types.ts` & `stats.types.ts`:**
  - Add `capByActorMetric: z.enum(['total_hd']).optional()` to `DnD35DeclarativeModifierSchema` and `StatModifier`.
  - Forward `capByActorMetric` in `effect_bundle.ts` and `ledger_modifiers.ts`.
  - Extend `DnD35FeatRepeatableSchema.targetCategory` with `'class'` (so `practiced_spellcaster:cleric` parameterizes cleanly by class ID and scopes its modifier to `effectTagsAny: ['casting_class:cleric']`!).
- **`src/rulesets/dnd35e/magic/spell_modifiers.ts` (`resolveSpellEffectiveCasterLevel`):**
  - Accept optional `actorTotalHd?: number` and `castingClassId?: string` in `context`.
  - Project `casting_class:<classId>` into `effectTags`.
  - Partition matching `caster_level` modifiers into `hdCappedMods` (`capByActorMetric === 'total_hd'`) and `uncappedMods`.
  - Compute:
    ```ts
    const cappedBonus = hdCappedMods.length > 0 ? resolveTypedModifiers(hdCappedMods, queryCtx) : 0;
    const afterCapped =
      context?.actorTotalHd !== undefined && cappedBonus > 0
        ? Math.max(baseCasterLevel, Math.min(context.actorTotalHd, baseCasterLevel + cappedBonus))
        : baseCasterLevel + cappedBonus;
    const uncappedBonus = uncappedMods.length > 0 ? resolveTypedModifiers(uncappedMods, queryCtx) : 0;
    return afterCapped + uncappedBonus;
    ```
  - Pass `actorTotalHd: aggregateProgressionChassis(casterDag.dndData.tracks, 0).totalHD` and `castingClassId: book.classId` from `spell_cast_resolver.ts`.
- **Tier 3 JSON (`public/data/rulesets/dnd35e/feats/practiced_spellcaster.json`):** `sourceOrigin: "non_srd"`, prereq `skill_ranks: spellcraft >= 4`, `repeatable: { mode: "targeted", targetCategory: "class" }`, modifier `{ target: "caster_level", value: 4, type: "untyped", capByActorMetric: "total_hd" }`.

---

### Task A5 — Metamagic Engine (*Persistent Spell*, *Divine Metamagic*, *Metamagic Rods*)

1. **Persistent Spell (`dnd35e_system.types.ts`, `metamagic_dispel.ts`, `spell_cast_helpers.ts`, `spell_duration.ts`):**
   - Add to `DnD35MetamagicDescriptorSchema`:
     ```ts
     fixedDurationOverride: z.enum(['24_hours']).optional(),
     allowedRanges: z.array(z.enum(['personal', 'fixed', 'touch', 'close', 'medium', 'long'])).optional(),
     forbidInstantaneous: z.boolean().optional(),
     forbidDischargeable: z.boolean().optional()
     ```
   - Add `persistent?: boolean | undefined` to `MetamagicSpellModifiers`.
   - Add pure validator `validateMetamagicForSpell(spell, featIds, sysContent): { valid: boolean; reason?: string }` checking `allowedRanges` (accepting `'personal'` or `'fixed'` — where a spell qualifies as `'fixed'` if `spell.range === 'personal'` or `spell.aoeShape !== 'single' && spell.aoeRadiusFt > 0 && spell.range === 'personal'` or `spell.hasFixedRange === true`), `forbidInstantaneous` (`spell.duration !== 'instantaneous'`), and `forbidDischargeable` (`!spell.duration.toLowerCase().includes('discharged')`).
   - In `parseSpellDurationTurns` (`spell_duration.ts`): accept `persistent?: boolean | undefined`; when `true` and non-instantaneous, return `durationTurns = mults.turnsPerDay` (using `getTurnsPerDay(clock)`!).
2. **Divine Metamagic (`dnd35e_system.types.ts`, `spell_cast_helpers.ts`, `spell_cast_resolver.ts`):**
   - Add to `DnD35FeatDefinitionSchema`:
     ```ts
     resourceSubstitutedMetamagic: z.object({
       requiredPoolTag: z.string(),
       baseCost: z.number().int().nonnegative().default(1),
       costPerSlotBump: z.number().int().positive().default(1),
       allowedCastingTraditions: z.array(z.enum(['arcane', 'divine'])).optional(),
       requiresOwnedTargetFeat: z.boolean().default(true)
     }).optional()
     ```
   - Extend `DnD35SpellCastContext` with `divineMetamagicSubstitutions?: ReadonlyArray<{ readonly featId: string; readonly targetMetamagicFeatId: string; readonly poolId?: string }> | undefined` and `metamagicRodEntityId?: EntityId | undefined`.
   - When a cast uses `divineMetamagicSubstitutions` (e.g., `divine_metamagic:persistent_spell`), validate the actor owns the substitution feat (and target metamagic feat if `requiresOwnedTargetFeat`), check casting tradition (`divine`), compute `poolCost = baseCost + targetSlotBump * costPerSlotBump` (`1 + 6 = 7` for DMM Persist!), deduct `poolCost` from a qualifying `ResourcePoolEntry` (matching `requiredPoolTag`, e.g., `destroy_undead` or `turn_undead`), and reduce `slotBump` by `targetSlotBump` (minimum `+0`)!
3. **Metamagic Rods (`item_system.types.ts`, `spell_cast_helpers.ts`, `spell_cast_resolver.ts`):**
   - Add `metamagicRodDescriptor: z.object({ metamagicFeatId: z.string(), maxSpellLevel: z.number().int().min(1).max(9), usesPerDay: z.number().int().positive().default(3) }).optional()` to `DnD35ItemDefinitionSchema`.
   - Validate at cast time: actor holds/carries the rod entity, `baseSpellLevel <= rod.maxSpellLevel`, rod has `>= 1` remaining daily charge (tracked via `ItemComponent.charges` refreshed on 8h rest), max 1 rod per spell, and apply the rod's `metamagicFeatId` with `+0` slot bump (still triggering spontaneous full-round cast time unless quickened!).
4. **Tier 3 JSONs:** `feats/persistent_spell.json` (`+6`, prereq `extend_spell`, `sourceOrigin: "non_srd"`), `feats/divine_metamagic.json` (`sourceOrigin: "non_srd"`, prereq `feature:turn_or_rebuke`, `repeatable: { mode: "targeted", targetCategory: "metamagic_feat" }`).

---

### Task A6 — Dynamic `valueFormula` (*Reserve Feats* like *Holy Warrior*) & `deity_match` Tagging

- **Schema (`effect_system.types.ts` & `stats.types.ts`):**
  ```ts
  export const DnD35ModifierValueFormulaSchema = z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('highest_available_spell_level'),
      requiredDomainId: z.string().optional(),
      requiredDescriptors: z.array(z.string()).optional(),
      requiredSchools: z.array(z.string()).optional(),
      minSpellLevel: z.number().int().min(1).max(9).default(1),
      multiplier: z.number().default(1)
    })
  ]);
  ```
  - Add `valueFormula: DnD35ModifierValueFormulaSchema.optional()` to `DnD35DeclarativeModifierSchema` and `StatModifier`.
- **Pure Evaluator (`src/rulesets/dnd35e/modifiers/dynamic_formulas.ts` — new focused module registered in `ssot_dnd35e.json`):**
  - `resolveDynamicModifierValues(modifiers, dndData, sysContent): ReadonlyArray<StatModifier>`: inspects unexpended `preparedSlots` (for prepared casters) and unexpended `spellsPerDay` + `knownSpellIds` (for spontaneous casters) across `dndData.spellbooksByClass` to compute the highest currently available spell level matching `requiredDomainId` / `requiredDescriptors` / `requiredSchools`.
  - Called in `dnd35e_dag_adapter.ts` immediately before Stage 1–4 DAG evaluation!
  - Also in `semantic_tags.ts`: project `deity:<dndData.deityId>` (if set) and `deity_offers_domain:<domainId>` onto `selfTags`, enabling zero-hardcoding `deity_match` conditions for *Recitation*, *Hand of the Faithful*, and *Gauntlets of War*!
- **Tier 3 JSON (`public/data/rulesets/dnd35e/feats/holy_warrior.json`):**
  - `sourceOrigin: "non_srd"`, prereq `domain:war` + able to cast 4th-level divine spells.
  - Modifier: `target: "damage"`, `value: 0`, `valueFormula: { kind: "highest_available_spell_level", requiredDomainId: "war", minSpellLevel: 4, multiplier: 1 }`, `type: "untyped"`, `condition: { effectTagsAny: ["weapon:melee", "weapon:ranged"] }`.

---

### Task A7 — Tier 1 `on_level_up` Pool Cycle, Action Points Engine & Skill Tricks (*Collector of Stories*)

1. **Tier 1 `ResourceRefreshCycle` (`src/types/components/actor_components.types.ts`):**
   - Extend `ResourceRefreshCycle = 'round' | 'encounter' | 'short_rest' | 'rest_8h' | 'on_level_up'`.
   - Ensure `rest.system.ts` skips `refreshCycle === 'on_level_up'` pools on rest (`resetOnRest: false`).
   - Add `sameSourceStackKey?: string | undefined` to `StatModifier` & `DnD35DeclarativeModifierSchema` so `ledger_resource_pools.ts` (`resolvePoolModifierBonus`) enforces `stackSameSourceResourceBonus: false` generically for any slotless pool booster (like *Nightstick* in Phase B) starting right now!
2. **Action Points (`src/rulesets/dnd35e/progression/action_points.ts` — new pure module registered in `ssot_dnd35e.json`):**
   - `computeActionPointPoolMax(characterLevel, mode)`:
     - `'none'` -> `0`
     - `'eberron'` -> `5 + Math.floor(characterLevel / 2)`
     - `'unearthed_arcana'` -> `5 + Math.floor(characterLevel / 2)`
   - `computeActionPointDieCount(characterLevel, mode)`:
     - `'eberron'`: `1` (L1–7), `2` (L8–14), `3` (L15+)
     - `'unearthed_arcana'`: `1` (L1–7), `2` (L8–14), `3` (L15–19), `4` (L20+)
   - `rollActionPointBonus(characterLevel, mode, forcedRolls?)`: rolls `N`d6 and returns `Math.max(...rolls)` (take highest single d6!).
   - Hydrate `'action_points'` pool (`refreshCycle: 'on_level_up'`) in `ledger_resource_pools.ts` when `options.actionPointsMode !== 'none'`, and refill it to new max on level-up in `builder_hydrator_levelup.ts`.
3. **Skill Tricks (`dnd35e_system.types.ts`, `entity_data.types.ts`, `system_content_files.ts`, `builder_core.ts`, `monster_lore_tracker.ts`):**
   - Add `DnD35SkillTrickDefinitionSchema`:
     ```ts
     export const DnD35SkillTrickDefinitionSchema = z.object({
       id: z.string(),
       name: z.string(),
       sourceOrigin: ContentSourceOriginSchema.default('non_srd'),
       category: z.enum(['interaction', 'manipulation', 'mental', 'movement']),
       skillPointCost: z.number().int().positive().default(2),
       description: z.string(),
       prerequisites: PrerequisiteNodeSchema.optional(),
       refreshCycle: z.enum(['encounter', 'rest_8h']).default('encounter'),
       effectBundle: DnD35EffectBundleSchema
     });
     ```
   - Add `skillTricks: z.record(z.string(), DnD35SkillTrickDefinitionSchema).default({})` to `DnD35SystemContentSchema`, wire `skill_tricks/collector_of_stories.json` into `system_content_files.ts` and `dnd35e_validator.ts`.
   - Add `learnedSkillTricks?: ReadonlyArray<string>` to `DnD35EntityData` and `DnD35CharacterLevelRecord`, enforcing `maxSkillTricks = Math.floor(totalHD / 2)` and `2` skill points per trick (`1` max per level-up) in `builder_core.ts` / `builder_levelup_validation.ts`.
   - Hydrate `1/encounter` resource pool for each learned skill trick in `ledger_resource_pools.ts`, and tag Monster Lore rolls in `skills/monster_lore_tracker.ts` & `skills/specialized_skill_checks.ts` with `effectTags: ['skill_use:monster_lore']` so *Collector of Stories* (`+5 competence` to Knowledge check identifying a creature, `1/encounter`) activates cleanly without any content-ID check!

---

## 6. Verification & Automated Regression Test Plan (Phase A)

1. **New Regression Test Suite (`tests/phase51_phaseA_core_rules.test.ts`):**
   - Verifies all 7 bugfixes (`sun.json` L7 `sunbeam`, `celestial.json` DR 5/magic at HD 8–11 & DR 10/magic at HD 12+ without `good` subtype, `keen` rejected on bludgeoning weapons, `holy_word.json` 4-tier CL-HD ladder + `-4` Will banishment, `divine_power.json` War 4 + `1 temp HP/CL`, `spellbook_slots.ts` Cleric 4 + PrC 13 = 17th-level slots, `sunbeam.json` & `lesser_restoration.json` valid & castable).
   - Verifies `'exalted'` AC non-stacking with armor, exclusion on Touch AC, preservation on Incorporeal Touch, and `'perfection'` bonus type stacking.
   - Verifies `Practiced Spellcaster` `+4 CL` capped at `totalHD` BEFORE uncapped CL bonuses (*War Caster* `+2` -> `20 + 2 = 22`!).
   - Verifies *Persistent Spell* (`24h` via `getTurnsPerDay`, rejects instantaneous/dischargeable/non-fixed range), *Divine Metamagic (Persistent Spell)* (`1 + 6 = 7` turning pool cost, `+0` slot bump), and *Metamagic Rod (Extend, Lesser)* (`<= 3rd` level enforcement, `3/day` charge deduction, `+0` slot bump).
   - Verifies *Holy Warrior* Reserve Feat dynamically updates melee/ranged damage bonus from `+9` (9th-level War spell available) -> `+7` (after expending 9th & 8th War slots) -> `+0` (when no `>= 4th` War spell remains).
   - Verifies Action Points (`none` / `eberron` / `unearthed_arcana` pool max & die curves, `on_level_up` non-reset on rest) and *Collector of Stories* (`+5` on `skill_use:monster_lore`, `1/encounter` pool, 2-SP cost & `floor(HD/2)` cap).
2. **8-Stage Verification Pipeline:** Execute `./verify.sh` (`tsc`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `build`, `run-validator.ts`), update `docs/ssot/ssot_dnd35e.json` & regenerate `docs/SSOT_DND35E.md` via `bun scripts/map-codebase.ts`, and verify 0 SSOT parity errors.

---

**STOP GATE (`AGENTS.md` Golden Rule #5):** Awaiting User's explicit approval of this plan before editing any `.ts` or `.json` source files.
