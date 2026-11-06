# Implementation Plan — Phase 25, Milestone 117: Mid- & High-Level Spells (4th–9th Level Arcane & Divine) & 100% 22-Domain Grimoire Coverage

## 1. Objective & `AGENTS.md` Compliance
Complete **Phase 25 (Milestone 117)** in strict compliance with `AGENTS.md`:
- **Rule 11 & 12 (Zero `any`, Zero Magic Values)**: No magic numbers (such as `+4` for *Augment Summoning*) exist in `.ts` logic files; all values reside in JSON (`augment_summoning.json`, `domains/*.json`, `spells/*.json`).
- **Rule 17 (Baseline Rules + Declarative Overrides & Modifiers — No Feat/Content Spaghetti)**: `spell_effects.ts` never checks `if (hasFeat('augment_summoning'))` or `supportsAugmentSummoning`. Instead:
  - `public/data/rulesets/dnd35e/feats/augment_summoning.json` declares `modifiers` targeting `"summoned_creature:str"` (`+4` `enhancement`) and `"summoned_creature:con"` (`+4` `enhancement`) gated by `condition: { effectTagsAny: ["subschool:summoning", "summoning"] }`.
  - `materializeSummonedCreatureModifiers` in `spell_effects.ts` generically filters any active caster `StatModifier[]` targeting `"summoned_creature:<stat>"` against the spell's projected `effectTags`, strips the `"summoned_creature:"` prefix, and attaches hierarchical `sourcePath` provenance (`"spell:<spellId>:<castId>/unit:<unitId>/<casterMod.sourcePath>"`).
  - `resolveSpellEffectiveCasterLevel` in `spell_effects.ts` generically evaluates any active caster `StatModifier[]` targeting `"caster_level"` (such as *Good Domain* `+1 CL` on `effectTagsAny: ["good"]` or *Healing Domain* `+1 CL` on `effectTagsAny: ["healing"]`) against the spell's projected `effectTags`.
- **Rule 18 (Universal Actor Symmetry)**: All 18 *Summon Monster I–IX* and *Summon Nature's Ally I–IX* spells reference canonical `raceId` (`sys.races`) + `templateId` (`sys.templates`) entries.
- **100% 22-Domain Spell Coverage**: Author all **175 new modular spell JSON files** (bringing `SPELL_IDS` from 98 to **273 total spells**), covering every 4th–9th level spell in Milestone 117 and all 198 domain spell slots across the 22 Cleric Domains (`domains/*.json`).

---

## 2. Step-by-Step Implementation Plan & Code Snippets

### Step 1: Extend `DnD35SpellEffectUnitSchema` in `src/rulesets/dnd35e/types/system/spell_system.types.ts`

Add the 4 high-level discriminated union variants (`energy_drain`, `save_or_die`, `summon`, `form_overlay`) with zero feat-specific booleans:

```typescript
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('energy_drain'),
    dice: z.string().default('1d4'),
    durationHoursScaling: DnD35SpellScalingRuleSchema.optional(),
    isPermanent: z.boolean().default(false)
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('save_or_die'),
    onFailOutcome: z.enum(['dead', 'blinded', 'stunned', 'petrified', 'banished']).default('dead'),
    minTargetCurrentHp: z.number().int().positive().optional(),
    maxTargetCurrentHp: z.number().int().positive().optional(),
    minTargetHitDice: z.number().int().positive().optional(),
    maxTargetHitDice: z.number().int().positive().optional(),
    durationFormula: z.string().optional(),
    onSavePartialDamageDice: z.string().optional(),
    onSavePartialFlatScaling: DnD35SpellScalingRuleSchema.optional(),
    onSaveDamageType: DnD35DamageTypeSchema.optional()
  }),
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('summon'),
    summonPool: z
      .array(
        z.object({
          raceId: z.string(),
          templateId: z.string().optional(),
          countDice: z.string().default('1'),
          minCasterLevel: z.number().int().positive().default(1)
        })
      )
      .default([]),
    durationRoundsScaling: DnD35SpellScalingRuleSchema.optional()
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
```

---

### Step 2: Upgrade `src/rulesets/dnd35e/magic/spell_effects.ts` ($\le 300$ lines) & `augment_summoning.json`

1. **In `public/data/rulesets/dnd35e/feats/augment_summoning.json`**, add declarative `modifiers` targeting `"summoned_creature:str"` and `"summoned_creature:con"` gated by `effectTagsAny: ["subschool:summoning", "summoning"]`:
```json
{
  "augment_summoning": {
    "id": "augment_summoning",
    "name": "Augment Summoning",
    "description": "Each creature you conjure with any summon spell gains a +4 enhancement bonus to Strength and Constitution for the duration of the spell.",
    "isFighterBonusFeat": false,
    "prerequisites": {
      "type": "has_feat",
      "featId": "spell_focus"
    },
    "modifiers": [
      {
        "id": "augment_summoning_str",
        "target": "summoned_creature:str",
        "value": 4,
        "type": "enhancement",
        "condition": {
          "effectTagsAny": ["subschool:summoning", "summoning"]
        }
      },
      {
        "id": "augment_summoning_con",
        "target": "summoned_creature:con",
        "value": 4,
        "type": "enhancement",
        "condition": {
          "effectTagsAny": ["subschool:summoning", "summoning"]
        }
      }
    ],
    "ruleOverrides": [
      {
        "id": "summoned_creature_str_con_enhancement",
        "ruleKey": "summoned_creature_str_con_enhancement",
        "value": 4
      }
    ]
  }
}
```

2. **In `src/rulesets/dnd35e/magic/spell_effects.ts`**:
   - Project both namespaced (`school:conjuration`, `subschool:healing`, `descriptor:good`) and bare (`conjuration`, `healing`, `good`) tags in `projectSpellEffectTags` so existing domain conditions (`effectTagsAny: ["good"]`, `effectTagsAny: ["healing"]`) match seamlessly.
   - Extend `evaluateSpellEffectUnitsForTarget` with `targetCurrentHp?: number` and `targetHitDice?: number` bracket filtering.
   - Add generic, feat-agnostic `resolveSpellEffectiveCasterLevel` and `materializeSummonedCreatureModifiers`:
```typescript
const SUMMONED_CREATURE_STAT_PREFIX = 'summoned_creature:';

/**
 * Resolves the effective Caster Level for a spell by evaluating any `targetStat === 'caster_level'`
 * modifiers on the caster against the spell's projected `effectTags` (e.g. Good/Healing/Fire Domain +1 CL).
 */
export function resolveSpellEffectiveCasterLevel(
  spell: DnD35SpellDefinition,
  baseCasterLevel: number,
  casterModifiers: ReadonlyArray<StatModifier>,
  context?: {
    readonly casterSelfTags?: ReadonlyArray<string>;
    readonly targetTags?: ReadonlyArray<string>;
    readonly metamagic?: MetamagicSpellModifiers;
  }
): number {
  const effectTags = projectSpellEffectTags(spell, context?.metamagic);
  const clMods = casterModifiers.filter((m) => m.targetStat === 'caster_level');
  if (clMods.length === 0) return baseCasterLevel;

  const bonus = resolveTypedModifiers(clMods, {
    selfTags: context?.casterSelfTags,
    targetTags: context?.targetTags,
    effectTags
  });
  return baseCasterLevel + bonus;
}

/**
 * Generically materializes `StatModifier`s projected onto summoned creatures by the caster's active
 * feats, domains, class features, or items (any caster modifier with `targetStat` prefixed by
 * `"summoned_creature:"` whose tag condition matches the spell's projected `effectTags`).
 */
export function materializeSummonedCreatureModifiers(
  spell: DnD35SpellDefinition,
  unit: DnD35SpellEffectUnit,
  casterModifiers: ReadonlyArray<StatModifier>,
  castId: string,
  context?: {
    readonly casterSelfTags?: ReadonlyArray<string>;
    readonly targetTags?: ReadonlyArray<string>;
    readonly metamagic?: MetamagicSpellModifiers;
  }
): ReadonlyArray<StatModifier> {
  if (unit.type !== 'summon') {
    return [];
  }
  const effectTags = projectSpellEffectTags(spell, context?.metamagic);
  const unitBasePath = appendSourcePath(`spell:${spell.id}:${castId}`, `unit:${unit.unitId}`);
  const result: StatModifier[] = [];

  for (const mod of casterModifiers) {
    if (!mod.targetStat.startsWith(SUMMONED_CREATURE_STAT_PREFIX)) continue;
    if (
      mod.condition &&
      !matchesEntityTagCondition(mod.condition, context?.targetTags, effectTags, context?.casterSelfTags)
    ) {
      continue;
    }
    const innerStat = mod.targetStat.slice(SUMMONED_CREATURE_STAT_PREFIX.length);
    const modLineage = mod.sourcePath ?? mod.sourceId;
    result.push({
      ...mod,
      targetStat: innerStat,
      sourcePath: appendSourcePath(unitBasePath, modLineage)
    });
  }

  return result;
}
```

---

### Step 3: Referential Validation in `dnd35e_validator.ts` & `class_race_validator.ts`
1. In `src/rulesets/dnd35e/dnd35e_validator.ts`: Validate that every `summon` unit's `summonPool` references valid `sys.races[entry.raceId]` and `sys.templates[entry.templateId]`, and every `form_overlay` unit's `allowedCreatureTypes` references valid `sys.creatureTypes[ct]`.
2. In `src/rulesets/dnd35e/validation/class_race_validator.ts`: Validate that every `spellId` in `domDef.domainSpells` exists in `sys.spells`.

---

### Step 4: Author All 175 New Modular Spell JSONs (`public/data/rulesets/dnd35e/spells/<id>.json`) & Update `SPELL_IDS` (`273` Total Spells)
Author all 175 modular spell JSON files covering:
- **18 Summoning Progression Spells**: `summon_monster_i`..`summon_monster_ix` and `summon_natures_ally_i`..`summon_natures_ally_ix`.
- **All 4th–9th Level Milestone 117 Spells & All 147 Remaining Cleric Domain Spells** across all 22 Domains (`air`, `animal`, `chaos`, `death`, `destruction`, `earth`, `evil`, `fire`, `good`, `healing`, `knowledge`, `law`, `luck`, `magic`, `plant`, `protection`, `strength`, `sun`, `travel`, `trickery`, `war`, `water`).

---

### Step 5: Upgrade `renderSpellInspector` in `src/rendering/ui/dnd35e_feat_spell_inspector.ui.ts`
Render a concise **Modular Effect Units** summary in `renderSpellInspector` for `damage`, `healing`, `ability_harm`, `condition`, `stat_bundle`, `spatial_field`, `dispel`, `quicken_cast_grant`, `energy_drain`, `save_or_die`, `summon`, and `form_overlay`.

---

### Step 6: Unit Tests, SSOT Sync & Full 8-Stage Verification (`./verify.sh`)
1. Create `tests/dnd35e_m117_spells.test.ts` verifying:
   - All **273 modular spells** load and pass `checkDnD35eRuleset` with 0 errors.
   - All **22 Cleric Domains** resolve 100% of their `domainSpells["1".."9"]` and apply domain `+1` Caster Level modifiers (*Good Domain*, *Healing Domain*) declaratively via `resolveSpellEffectiveCasterLevel`.
   - Declarative *Augment Summoning* (`augment_summoning.json` $\rightarrow$ `buildFeatEffectModifiers` $\rightarrow$ `materializeSummonedCreatureModifiers`) emits `+4` `enhancement` `STR` and `CON` onto summoned creatures for `subschool:summoning` spells without any hardcoded feat IDs in `spell_effects.ts`.
   - HP/HD-bracket filtering for *Power Word Kill*, *Power Word Stun*, *Power Word Blind*, and *Cloudkill*.
   - Negative level application for *Enervation* / *Energy Drain*, and Stage 1–4 Stat DAG evaluation for *Righteous Might*, *Divine Power*, and *Iron Body*.
2. Mark Milestone 117 `[x]` in `docs/MILESTONES.md`, regenerate `docs/SSOT_DND35E.md`, and run `./verify.sh`.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Authors) | Downstream (Consumers / Resolvers) | Lateral (Mirrors / Validators / Docs) |
| :--- | :--- | :--- | :--- |
| **`energy_drain`, `save_or_die`, `summon`, `form_overlay` in `DnD35SpellEffectUnitSchema` (`spell_system.types.ts`)** | 175 new modular spell JSON files (`public/data/rulesets/dnd35e/spells/<id>.json`) | `parseDnD35SystemContent`, `spell_effects.ts`, `renderSpellInspector` | `dnd35e_validator.ts` (`summonPool` & `allowedCreatureTypes` checks) |
| **Declarative `"summoned_creature:<stat>"` in `augment_summoning.json` & generic `materializeSummonedCreatureModifiers` / `resolveSpellEffectiveCasterLevel` (`spell_effects.ts`)** | `buildFeatEffectModifiers`, `buildClassAndDomainEffectModifiers` | Summoned creature stat synthesis, Domain `+1 CL` evaluation | `tests/dnd35e_m117_spells.test.ts`, `docs/SSOT_DND35E.md` |
| **175 New Spell JSONs & `SPELL_IDS` (`273` total spells)** | `system_content_spell_ids.ts` imported by `system_content_files.ts` | `loader.ts`, `builder_spells.ts`, `run-validator.ts` (disk parity across all 772 modular ruleset files) | All 22 `public/data/rulesets/dnd35e/domains/*.json` (`domainSpells` 100% resolved), `docs/MILESTONES.md` |
| **Validate `domainSpells` in `class_race_validator.ts` & `summonPool` in `dnd35e_validator.ts`** | `validateDnD35eSystemContentIntegrity` | `checkDnD35eRuleset`, `scripts/run-validator.ts` | `tests/ruleset_validators.test.ts`, `tests/dnd35e_m117_spells.test.ts` |
