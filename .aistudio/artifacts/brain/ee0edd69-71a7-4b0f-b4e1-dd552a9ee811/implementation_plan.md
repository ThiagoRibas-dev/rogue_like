# Implementation Plan — Phase 25, Milestone 117: Mid- & High-Level Spells (4th–9th Level Arcane & Divine) & Phase 25 Completion

## 1. Objective & Scope
Complete Phase 25 by implementing **Milestone 117 (4th–9th Level Arcane & Divine Spells)** across modular `public/data/rulesets/dnd35e/spells/<id>.json` definitions. This expands the modular D&D 3.5e Grimoire with **89 new 4th–9th level spells** (bringing `SPELL_IDS` to **187 total spells**), supported by 4 new high-level `DnD35SpellEffectUnit` variants (`energy_drain`, `save_or_die`, `summon`, and `form_overlay`).

---

## 2. Step-by-Step Implementation Plan

### Step 1: Extend `DnD35SpellEffectUnitSchema` in `src/rulesets/dnd35e/types/system/spell_system.types.ts`
Extend `DnD35SpellEffectUnitSchema` with 4 new discriminated union variants:
```typescript
export const DnD35SpellEffectUnitSchema = z.discriminatedUnion('type', [
  // ... existing 8 variants (damage, healing, ability_harm, condition, stat_bundle, spatial_field, dispel, quicken_cast_grant) ...
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('energy_drain'),
    dice: z.string().default('1d4'),
    durationHoursScaling: DnD35SpellScalingRuleSchema.optional(),
    isPermanent: z.boolean().default(false)
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('save_or_die'),
    onFailOutcome: z.enum(['dead', 'blinded', 'stunned', 'petrified']).default('dead'),
    minTargetCurrentHp: z.number().int().positive().optional(),
    maxTargetCurrentHp: z.number().int().positive().optional(),
    minTargetHitDice: z.number().int().positive().optional(),
    maxTargetHitDice: z.number().int().positive().optional(),
    onSavePartialDamageDice: z.string().optional(),
    onSavePartialFlatScaling: DnD35SpellScalingRuleSchema.optional(),
    onSaveDamageType: DnD35DamageTypeSchema.optional()
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('summon'),
    summonPool: z.array(z.object({
      raceId: z.string(),
      templateId: z.string().optional(),
      minCasterLevel: z.number().int().positive().default(1)
    })).default([]),
    durationRoundsScaling: DnD35SpellScalingRuleSchema.optional(),
    supportsAugmentSummoning: z.boolean().default(true)
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('form_overlay'),
    overlayMode: z.enum(['baleful_polymorph', 'polymorph', 'shapechange']).default('polymorph'),
    allowedCreatureTypes: z.array(z.string()).default([]),
    maxHitDiceScaling: DnD35SpellScalingRuleSchema.optional(),
    grantsExAbilities: z.boolean().default(false),
    grantsSuAbilities: z.boolean().default(false),
    freeActionFormShift: z.boolean().default(false)
  })
]);
```

---

### Step 2: Update Evaluators in `src/rulesets/dnd35e/magic/spell_effects.ts` ($\le 300$ lines)
1. Update `evaluateSpellEffectUnitsForTarget`:
   - Accept optional `context.targetCurrentHp?: number` and `context.targetHitDice?: number`.
   - Filter `save_or_die` or `condition` units by `minTargetCurrentHp` / `maxTargetCurrentHp` and `minTargetHitDice` / `maxTargetHitDice` brackets so HP-threshold compulsions (*Power Word Blind/Stun/Kill*, *Cloudkill*, *Sleep*) automatically select the matching unit declaratively.
2. Add `materializeSummonAugmentModifiers(spell, unit, casterSelfTags, castId)`:
   - When `unit.supportsAugmentSummoning !== false` and `casterSelfTags` includes `'feat:augment_summoning'`, emits `+4` `enhancement` `STR` and `+4` `enhancement` `CON` `StatModifier`s with `sourcePath: "spell:<spellId>:<castId>/unit:<unitId>/feat:augment_summoning/..."`.

---

### Step 3: Validate `summon` Effect Units in `src/rulesets/dnd35e/dnd35e_validator.ts`
Inside `validateDnD35eSystemContentIntegrity`:
- Iterate over `spellDef.effectUnits`: if `unit.type === 'summon'`, verify each entry in `unit.summonPool` references a valid `raceId` in `sys.races` and (if specified) a valid `templateId` in `sys.templates`.

---

### Step 4: Author All 89 New Milestone 117 Spell JSONs & Update `SPELL_IDS`
1. Update `src/rulesets/dnd35e/system_content_spell_ids.ts` to include all 89 new 4th–9th level spell IDs (187 total spells).
2. Author all 89 JSON files in `public/data/rulesets/dnd35e/spells/<id>.json`:
   - **4th Level (19)**: `dimension_door`, `stoneskin`, `greater_invisibility`, `evards_black_tentacles`, `solid_fog`, `ice_storm`, `wall_of_fire`, `wall_of_ice`, `phantasmal_killer`, `fear`, `enervation`, `divine_power`, `freedom_of_movement`, `death_ward`, `restoration`, `flame_strike`, `cure_critical_wounds`, `inflict_critical_wounds`, `neutralize_poison`.
   - **5th Level (14)**: `cone_of_cold`, `cloudkill`, `hold_monster`, `feeblemind`, `baleful_polymorph`, `telekinesis`, `wall_of_force`, `wall_of_stone`, `righteous_might`, `slay_living`, `spell_resistance`, `true_seeing`, `breath_of_life`, `raise_dead`.
   - **6th Level (11)**: `disintegrate`, `chain_lightning`, `flesh_to_stone`, `stone_to_flesh`, `antimagic_field`, `globe_of_invulnerability`, `greater_dispel_magic`, `heal`, `harm`, `blade_barrier`, `heroes_feast`.
   - **Summoning Progression Chains (18)**: `summon_monster_i` through `summon_monster_ix`, `summon_natures_ally_i` through `summon_natures_ally_ix`.
   - **7th–9th Level Apex Spells (27)**: `finger_of_death`, `delayed_blast_fireball`, `prismatic_spray`, `power_word_blind`, `power_word_stun`, `power_word_kill`, `forcecage`, `spell_turning`, `holy_word`, `blasphemy`, `dictum`, `word_of_chaos`, `fire_storm`, `regenerate`, `horrid_wilting`, `polar_ray`, `mind_blank`, `iron_body`, `shapechange`, `meteor_swarm`, `energy_drain`, `wail_of_banshee`, `implosion`, `mass_heal`, `miracle`, `wish`, `time_stop`.

---

### Step 5: Update `renderSpellInspector` in `src/rendering/ui/dnd35e_feat_spell_inspector.ui.ts`
Surface high-level unit details in the Inspector view:
- **`energy_drain`**: Displays negative level dice and duration/permanence.
- **`save_or_die`**: Displays HP/HD threshold brackets, outcome (`Dead`, `Petrified`, `Stunned`), and partial save damage.
- **`summon`**: Displays candidate summon races/templates and *Augment Summoning* compatibility.
- **`form_overlay`**: Displays allowed creature types, HD cap, and Extraordinary/Supernatural ability grants.

---

### Step 6: Unit Tests, SSOT Parity & Full 8-Stage Verification (`./verify.sh`)
1. Create `tests/dnd35e_m117_spells.test.ts` verifying:
   - All 187 modular spells in `SPELL_IDS` load and validate cleanly via `getDnD35SystemContent`.
   - Negative level emission on *Enervation* and *Energy Drain* via `applyNegativeLevelsToActor`.
   - HP/HD bracket filtering on *Power Word Kill* ($\le 100$ HP), *Power Word Stun* ($\le 50 / 100 / 150$ HP), and *Cloudkill* ($\le 3$ HD death, $4\text{–}6$ HD save vs death).
   - Save-or-die Fort-partial damage scaling on *Finger of Death* and *Slay Living*.
   - *Summon Monster* chain race/template pool validation and *Augment Summoning* `+4` `STR`/`CON` modifier emission.
   - *Baleful Polymorph* and *Shapechange* `form_overlay` unit parameters and `PropertyOverlayComponent` compatibility.
2. Update `docs/ssot/ssot_dnd35e.json`, regenerate `docs/SSOT_DND35E.md` via `bun scripts/map-codebase.ts`, and mark Milestone 117 `[x]` and Phase 25 `Completed` in `docs/MILESTONES.md`.
3. Run `./verify.sh` and ensure all 8 stages pass with 0 errors.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Authors) | Downstream (Consumers / Resolvers) | Lateral (Mirrors / Validators / Docs) |
| :--- | :--- | :--- | :--- |
| **New `DnD35SpellEffectUnit` variants (`spell_system.types.ts`)** | 89 new spell JSON files (`public/data/rulesets/dnd35e/spells/<id>.json`) | `parseDnD35SystemContent`, `spell_effects.ts`, `renderSpellInspector` | `dnd35e_validator.ts` (`summonPool` referential checks) |
| **HP/HD bracket filtering & `materializeSummonAugmentModifiers` (`spell_effects.ts`)** | Re-exported by `src/rulesets/dnd35e/magic/spellcasting.ts` | *Power Word* series, *Cloudkill*, *Summon Monster/Ally I–IX*, *Augment Summoning* feat | `tests/dnd35e_m117_spells.test.ts` |
| **89 New Spell JSONs & `SPELL_IDS` (187 total spells)** | `system_content_spell_ids.ts` imported by `system_content_files.ts` | `loader.ts`, `run-validator.ts` (597+ modular ruleset disk files) | `docs/MILESTONES.md` (Phase 25 marked `[x]`) |
