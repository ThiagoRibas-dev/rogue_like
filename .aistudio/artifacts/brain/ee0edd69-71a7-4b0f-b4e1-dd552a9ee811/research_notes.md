# Research Notes — Phase 25, Milestone 117: Mid- & High-Level Spells (4th–9th Level Arcane & Divine)

## 1. Rules & Architectural Standards Reiteration (`AGENTS.md` & `docs/ARCHITECTURE.md`)
- **Zero `any` & Strict TypeScript (`exactOptionalPropertyTypes: true`)**: Every schema, discriminated union variant, and evaluator function must have explicit parameter and return types with zero `any`.
- **Zero Magic Values**: All spell parameters (CL scaling steps, dice caps, HP/HD thresholds, material GP costs, XP costs, summon tables) must live declaratively in `public/data/rulesets/dnd35e/spells/<id>.json`.
- **Tag-Driven Modular Spell Architecture (Rules 17, 18, 19)**:
  - Spells are composite capabilities composed of tag-conditioned `effectUnits` (`DnD35SpellEffectUnitSchema`) and `effectBundle`s (`DnD35EffectBundleSchema`).
  - Feats (*Augment Summoning*, *Spell Focus*, *Silent/Still Spell*), creature types/subtypes (`type:undead`, `type:plant`, `subtype:water`, `subtype:extraplanar`), alignments (`alignment:good`, `alignment:evil`, `alignment:lawful`, `alignment:chaotic`), and immunities (`descriptor:death`, `descriptor:mind_affecting`, `school:divination`) interact via semantic tags (`selfTags`, `targetTags`, `effectTags`) rather than hardcoded spell/feat branches.
  - Every materialized modifier or summon/overlay effect carries hierarchical `sourcePath` provenance (`"spell:<spellId>:<castId>/unit:<unitId>/..."`) for `buildEffectProvenanceIndex` and `revokeModifiersByPathPrefix`.
- **File Size Discipline**: Every `.ts` file must remain strictly $\le 300$ lines.

---

## 2. Milestone 117 Scope & Cross-Reference Analysis

### 2.1 New Modular `DnD35SpellEffectUnit` Variants Needed for 4th–9th Level Spells
In Milestone 116, we established 8 `DnD35SpellEffectUnit` variants (`damage`, `healing`, `ability_harm`, `condition`, `stat_bundle`, `spatial_field`, `dispel`, `quicken_cast_grant`). Examining the 4th–9th level SRD repertoire in `docs/MILESTONES.md` (lines 1671–1682) reveals 4 additional high-level tactical mechanics that fit naturally as discriminated union variants in `DnD35SpellEffectUnitSchema`:

1. **`energy_drain` (Negative Levels — *Enervation*, *Energy Drain*)**:
   - Inflicts `dice` (`"1d4"` for *Enervation*, `"2d4"` for *Energy Drain*) temporary negative levels, routing directly to `applyNegativeLevelsToActor` (`src/rulesets/dnd35e/level_ledger.ts`).
   - Blocked declaratively when the target has `death_ward_active` or `immunity:energy_drain` / `type:undead` / `type:construct`.

2. **`save_or_die` (Instant Death / Fort Partial & HP-Threshold Compulsions — *Phantasmal Killer*, *Slay Living*, *Finger of Death*, *Wail of the Banshee*, *Implosion*, *Cloudkill*, *Power Word Blind/Stun/Kill*)**:
   - Supports both **Save-or-Die with Partial Damage on Save** (*Finger of Death* `Fort negates` or `3d6 + CL` damage on save; *Slay Living* `3d6 + CL` on save; *Phantasmal Killer* `Will disbelief` then `Fort partial 3d6`) and **HP-Threshold / HD-Threshold Compulsions** (*Power Word Kill* $\le 100$ current HP $\rightarrow$ `dead`; *Power Word Stun* $\le 50 / 100 / 150$ HP brackets; *Power Word Blind* $\le 50 / 100 / 200$ HP brackets; *Cloudkill* $\le 3$ HD instant death, $4\text{–}6$ HD `Fort` save or die).
   - Fields:
     - `minTargetCurrentHp?: number`, `maxTargetCurrentHp?: number`
     - `minTargetHitDice?: number`, `maxTargetHitDice?: number`
     - `onFailOutcome: 'dead' | 'blinded' | 'stunned' | 'petrified'`
     - `onSavePartialDamageDice?: string`, `onSavePartialFlatScaling?: DnD35SpellScalingRule`, `onSaveDamageType?: DnD35DamageType`

3. **`summon` (Summoning Chains — *Summon Monster I–IX* & *Summon Nature's Ally I–IX*)**:
   - References canonical creature entries from `sys.races` (`races/<id>.json`) + optional template from `sys.templates` (`templates/celestial.json`, `templates/fiendish.json`), adhering strictly to **Rule 18 (Universal Actor Symmetry)**: summoned creatures are never separate statblock schemas, but synthesized from existing `races/<id>.json` + `templates/<id>.json`!
   - Supports **Declarative Tag-Gated *Augment Summoning***: when the caster's `selfTags` includes `'feat:augment_summoning'`, `materializeSummonAugmentModifiers(spell, unit, casterSelfTags, castId)` automatically emits `+4` `enhancement` to `STR` and `+4` `enhancement` to `CON` with `sourcePath: "spell:<spellId>:<castId>/unit:<unitId>/feat:augment_summoning/..."`.

4. **`form_overlay` (Polymorph & Shapechange — *Baleful Polymorph*, *Shapechange*) (`PRIM-2.3`)**:
   - Connects declarative spells to `PropertyOverlayComponent` (`src/rulesets/dnd35e/wild_shape.ts`):
     - `overlayMode: 'baleful_polymorph' | 'polymorph' | 'shapechange'`
     - `allowedCreatureTypes: ReadonlyArray<string>`
     - `maxHitDiceScaling: DnD35SpellScalingRule` (e.g., `1/CL` capped at `15` for *Polymorph* or `25` for *Shapechange*)
     - `grantsExAbilities: boolean`, `grantsSuAbilities: boolean`, `freeActionFormShift: boolean`

---

### 2.2 Complete Catalog of Milestone 117 Spells (84 New Spells $\rightarrow$ 182 Total Spells in `SPELL_IDS`)

1. **4th Level Spells (18)**:
   - `dimension_door`, `stoneskin`, `greater_invisibility`, `evards_black_tentacles`, `solid_fog`, `ice_storm`, `wall_of_fire`, `wall_of_ice`, `phantasmal_killer`, `fear`, `enervation`, `divine_power`, `freedom_of_movement`, `death_ward`, `restoration`, `flame_strike`, `cure_critical_wounds`, `inflict_critical_wounds`, `neutralize_poison` (19 spells).
2. **5th Level Spells (14)**:
   - `cone_of_cold`, `cloudkill`, `hold_monster`, `feeblemind`, `baleful_polymorph`, `telekinesis`, `wall_of_force`, `wall_of_stone`, `righteous_might`, `slay_living`, `spell_resistance`, `true_seeing`, `breath_of_life`, `raise_dead`.
3. **6th Level Spells (11)**:
   - `disintegrate`, `chain_lightning`, `flesh_to_stone`, `stone_to_flesh`, `antimagic_field`, `globe_of_invulnerability`, `greater_dispel_magic`, `heal`, `harm`, `blade_barrier`, `heroes_feast`.
4. **Summoning Progression Chains (18)**:
   - *Summon Monster I–IX*: `summon_monster_i`, `summon_monster_ii`, `summon_monster_iii`, `summon_monster_iv`, `summon_monster_v`, `summon_monster_vi`, `summon_monster_vii`, `summon_monster_viii`, `summon_monster_ix`.
   - *Summon Nature's Ally I–IX*: `summon_natures_ally_i`, `summon_natures_ally_ii`, `summon_natures_ally_iii`, `summon_natures_ally_iv`, `summon_natures_ally_v`, `summon_natures_ally_vi`, `summon_natures_ally_vii`, `summon_natures_ally_viii`, `summon_natures_ally_ix`.
5. **7th–9th Level Apex Spells (24)**:
   - `finger_of_death`, `delayed_blast_fireball`, `prismatic_spray`, `power_word_blind`, `power_word_stun`, `power_word_kill`, `forcecage`, `spell_turning`, `holy_word`, `blasphemy`, `dictum`, `word_of_chaos`, `fire_storm`, `regenerate`, `horrid_wilting`, `polar_ray`, `mind_blank`, `iron_body`, `shapechange`, `meteor_swarm`, `energy_drain`, `wail_of_banshee`, `implosion`, `mass_heal`, `miracle`, `wish`, `time_stop` (27 spells).

Total new spells in Milestone 117: **89 spells** (bringing `SPELL_IDS` to **187 modular spells** across Levels 0–9).

---

### 2.3 Evaluator Enhancements in `src/rulesets/dnd35e/magic/spell_effects.ts`
To keep `spell_effects.ts` under 300 lines while supporting Milestone 117 mechanics:
- Enhance `evaluateSpellEffectUnitsForTarget(spell, context)` so `context` optionally accepts `targetCurrentHp?: number` and `targetHitDice?: number`. If a `save_or_die` or `condition` unit specifies `minTargetCurrentHp` / `maxTargetCurrentHp` or `minTargetHitDice` / `maxTargetHitDice`, `evaluateSpellEffectUnitsForTarget` automatically filters units by those brackets (enabling *Power Word Blind/Stun/Kill*, *Cloudkill*, *Sleep*, and *Daze* to select the exact matching unit declaratively!).
- Add `materializeSummonAugmentModifiers(spell, unit, casterSelfTags, castId)` to emit the `+4` enhancement `STR` and `+4` `CON` `StatModifier`s when `'feat:augment_summoning'` is present in `casterSelfTags`.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Authors) | Downstream (Consumers / Resolvers) | Lateral (Mirrors / Validators / Docs) |
| :--- | :--- | :--- | :--- |
| **Add `energy_drain`, `save_or_die`, `summon`, and `form_overlay` to `DnD35SpellEffectUnitSchema` (`spell_system.types.ts`)** | 89 new 4th–9th level spell JSON files (`public/data/rulesets/dnd35e/spells/<id>.json`) | `parseDnD35SystemContent`, `spell_effects.ts`, `renderSpellInspector` | `dnd35e_validator.ts` (validates `summonPool` `raceId` and `templateId` references against `sys.races` and `sys.templates`!) |
| **Extend `evaluateSpellEffectUnitsForTarget` with HP/HD bracket filtering & `materializeSummonAugmentModifiers` (`spell_effects.ts`)** | Re-exported by `src/rulesets/dnd35e/magic/spellcasting.ts` | *Power Word Blind/Stun/Kill*, *Cloudkill*, *Horrid Wilting*, *Holy Word/Blasphemy/Dictum/Word of Chaos*, *Summon Monster I–IX* + *Augment Summoning* | `tests/dnd35e_m117_spells.test.ts` |
| **Expand `SPELL_IDS` (`system_content_spell_ids.ts`) with 89 4th–9th level spells (187 total)** | Imported by `src/rulesets/dnd35e/system_content_files.ts` | `loader.ts`, `scripts/run-validator.ts` (disk parity across all modular ruleset files) | `docs/MILESTONES.md` (Phase 25 / Milestone 117 marked `[x]`) |
| **Validate `summon` unit `raceId` / `templateId` references in `dnd35e_validator.ts`** | `validateDnD35eSystemContentIntegrity` | `checkDnD35eRuleset`, `scripts/run-validator.ts` | `tests/dnd35e_m117_spells.test.ts` |
