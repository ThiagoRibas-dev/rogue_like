# Research Notes — Phase 25, Milestone 117: Mid- & High-Level Spells (4th–9th Level Arcane & Divine) & 100% 22-Domain Grimoire Coverage

## 1. Rules & Architectural Standards Audit (`AGENTS.md` & `docs/ARCHITECTURE.md`)
- **Rule 11 (Zero `any`) & Strict TypeScript (`exactOptionalPropertyTypes: true`)**: Every Zod schema, discriminated union variant, and evaluator function must have explicit parameter and return types with zero `any`.
- **Rule 12 (Zero Magic Values)**: Every numerical value affecting gameplay (CL scaling steps, dice caps, HP/HD thresholds, material GP costs, XP costs, summon tables, feat bonuses like *Augment Summoning*'s `+4`) must live in JSON data (`public/data/rulesets/dnd35e/`), never as a constant in `.ts` logic files.
- **Rule 17 (Baseline Rules + Declarative Overrides & Modifiers — No Feat/Content Spaghetti)**:
  - `spell_effects.ts` must **never** hardcode `if (casterSelfTags.includes('feat:augment_summoning'))` or `AUGMENT_SUMMONING_ENHANCEMENT_BONUS = 4` or `supportsAugmentSummoning: boolean`.
  - Instead, *Augment Summoning* (`public/data/rulesets/dnd35e/feats/augment_summoning.json`) declares `modifiers` targeting `"summoned_creature:str"` (`+4` `enhancement`) and `"summoned_creature:con"` (`+4` `enhancement`) gated by `condition: { effectTagsAny: ["subschool:summoning", "summoning"] }`.
  - `spell_effects.ts` provides a generic, feat-agnostic resolver `materializeSummonedCreatureModifiers(spell, unit, casterModifiers, castId, context)` that filters the caster's active `StatModifier[]` for `"summoned_creature:<stat>"` whose `condition` matches the spell's projected `effectTags`, strips the `"summoned_creature:"` prefix, and stamps hierarchical `sourcePath` provenance (`"spell:<spellId>:<castId>/unit:<unitId>/<casterMod.sourcePath>"`).
  - Similarly, `resolveSpellEffectiveCasterLevel(spell, baseCasterLevel, casterModifiers, context)` evaluates any `"caster_level"` modifiers on the caster (such as *Good Domain* `+1 CL` on `effectTagsAny: ["good"]` or *Healing Domain* `+1 CL` on `effectTagsAny: ["healing"]`) against `projectSpellEffectTags(spell)` without hardcoding domain or feat IDs.
- **Rule 18 (Universal Actor Symmetry)**: Summoned creatures in *Summon Monster I–IX* and *Summon Nature's Ally I–IX* reference canonical `raceId` (`sys.races`) + optional `templateId` (`sys.templates`) rather than bespoke summoned-monster statblock schemas.
- **Rule 19 (Unified Effect Providers & Hierarchical Provenance `sourcePath`)**: Every modifier emitted onto a target, caster, or summoned creature carries a slash-delimited `sourcePath` revocable via `revokeModifiersByPathPrefix`.

---

## 2. Deep Codebase & Data Discovery for Milestone 117

### 2.1 Audit of the 22 Cleric Domains (`public/data/rulesets/dnd35e/domains/*.json`)
Auditing all 22 Cleric Domain files (`air`, `animal`, `chaos`, `death`, `destruction`, `earth`, `evil`, `fire`, `good`, `healing`, `knowledge`, `law`, `luck`, `magic`, `plant`, `protection`, `strength`, `sun`, `travel`, `trickery`, `war`, `water`) revealed:
- Each domain defines `domainSpells: { "1": "<id>", ..., "9": "<id>" }` ($22 \times 9 = 198$ domain slots) referencing **173 unique domain spell IDs** (`147` of which were not yet in `SPELL_IDS`).
- In addition, existing domain modifiers in `domains/*.json` (such as `good.json` and `healing.json`) use `condition: { effectTagsAny: ["good"] }` and `condition: { effectTagsAny: ["healing"] }`. Updating `projectSpellEffectTags(spell)` to project both the namespaced tag (`school:conjuration`, `subschool:healing`, `descriptor:good`) and the bare school/subschool/descriptor tag (`conjuration`, `healing`, `good`) ensures 100% compatibility with all existing domain and feat `effectTagsAny` conditions!
- By authoring **all 147 remaining domain spells** plus the **28 additional non-domain Milestone 117 4th–9th level spells & summoning tiers** (**175 new modular spell JSONs**, bringing `SPELL_IDS` from 98 to **273 total modular spells**), we achieve **100% referential integrity across all 22 Cleric Domains (Levels 1–9)** and **100% coverage of Milestone 117**.

---

### 2.2 Four New High-Level `DnD35SpellEffectUnit` Variants (`src/rulesets/dnd35e/types/system/spell_system.types.ts`)
To model 4th–9th level mechanics declaratively, we extend `DnD35SpellEffectUnitSchema` with 4 variants:
1. **`energy_drain`**: Inflicts temporary or permanent negative levels (`dice: "1d4"` on *Enervation*, `"2d4"` on *Energy Drain*), routing to `applyNegativeLevelsToActor` (`level_ledger.ts`).
2. **`save_or_die`**: Handles both Save-or-Die with partial damage on save (*Phantasmal Killer*, *Slay Living*, *Finger of Death*, *Destruction*, *Wail of the Banshee*, *Implosion*, *Flesh to Stone*) and HP/HD-bracketed no-save compulsions (*Power Word Blind*, *Power Word Stun*, *Power Word Kill*, *Cloudkill*).
3. **`summon`**: Connects *Summon Monster I–IX*, *Summon Nature's Ally I–IX*, *Elemental Swarm*, *Animate Dead*, *Create Undead*, and *Create Greater Undead* to `sys.races` + `sys.templates` (`summonPool: [{ raceId, templateId, countDice, minCasterLevel }]`). No feat-specific flags (`supportsAugmentSummoning`) are placed on the unit; instead, *Augment Summoning* (`augment_summoning.json`) triggers declaratively via `effectTagsAny: ["subschool:summoning", "summoning"]`.
4. **`form_overlay`**: Connects *Baleful Polymorph*, *Animal Shapes*, *Polymorph Any Object*, and *Shapechange* (`PRIM-2.3`) to `PropertyOverlayComponent` (`wild_shape.ts`).

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Authors) | Downstream (Consumers / Resolvers) | Lateral (Mirrors / Validators / Docs) |
| :--- | :--- | :--- | :--- |
| **Add `energy_drain`, `save_or_die`, `summon`, `form_overlay` to `DnD35SpellEffectUnitSchema` (`spell_system.types.ts`)** | 175 new modular spell JSON files (`public/data/rulesets/dnd35e/spells/<id>.json`) | `parseDnD35SystemContent`, `spell_effects.ts`, `renderSpellInspector` | `dnd35e_validator.ts` (`summonPool` race/template & `form_overlay` creatureType checks) |
| **Declarative `"summoned_creature:<stat>"` modifiers in `augment_summoning.json` & generic `materializeSummonedCreatureModifiers` / `resolveSpellEffectiveCasterLevel` (`spell_effects.ts`)** | `buildFeatEffectModifiers` (`ledger_modifiers.ts`), `buildClassAndDomainEffectModifiers` | Summoned creature stat synthesis, Domain `+1 CL` evaluation (*Good*, *Evil*, *Law*, *Chaos*, *Healing* domains) | `tests/dnd35e_m117_spells.test.ts`, `docs/SSOT_DND35E.md` |
| **Author 175 new modular spells (`SPELL_IDS` $\rightarrow$ 273 total spells)** | `system_content_spell_ids.ts` imported by `system_content_files.ts` | `loader.ts`, `builder_spells.ts`, `run-validator.ts` (disk parity across all 772 modular ruleset files) | All 22 `public/data/rulesets/dnd35e/domains/*.json` (`domainSpells` 100% resolved), `docs/MILESTONES.md` |
| **Validate `domainSpells` in `class_race_validator.ts` & `summonPool` in `dnd35e_validator.ts`** | `validateDnD35eSystemContentIntegrity` | `checkDnD35eRuleset`, `scripts/run-validator.ts` | `tests/ruleset_validators.test.ts`, `tests/dnd35e_m117_spells.test.ts` |
