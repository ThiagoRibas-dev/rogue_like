# D&D 3.5e Declarative Special Attacks, Semantic Tags & Targeted Feats

Per **AGENTS.md Rule 21 (Zero Content-ID or Bespoke-Property Branching)**, all special attack qualification, domain tags, and targeted feat UI dropdowns are driven declaratively from Tier 3 JSON schemas (`public/data/rulesets/dnd35e/`). Never hardcode feat IDs, domain IDs, class feature IDs, or weapon IDs inside `.ts` projectors or prerequisite builders.

---

## 1. Tagging Special Attacks (`trait:special_attack` & `special_attack:<id>`)

Any race, template, class feature, feat, or natural weapon rider representing a special attack for **Ability Focus** (`"trait:special_attack"` AND `"special_attack:$selected"`) must project both `"trait:special_attack"` and one or more specific `"special_attack:<id>"` tags declaratively:

1. **Breath Weapons (`races/<id>.json`)**:
   - `DnD35RaceDefinitionSchema.breathWeapon` supports `"grantedTags": string[]`.
   - If omitted in JSON, `evaluateRacialModifiers` defaults `breathWeapon.grantedTags` to `["trait:special_attack", "special_attack:breath_weapon"]`.
2. **On-Hit Natural Weapon Riders (`OnHitRiderDescriptorSchema`)**:
   - Poison, disease, paralysis, energy drain, and curse riders support `"grantedTags": string[]`.
   - `races.ts` and `semantic_tags.ts` default rider `grantedTags` to `["trait:special_attack"]` and project both `special_attack:${rider.type}` and `special_attack:${rider.riderId}` (plus `special_attack:pounce` when `hasPounce === true`).
3. **Class Features (`classes/<id>.json` `featureDetails`)**:
   - Add `"grantedTags": ["trait:special_attack", "special_attack:<id>"]` on class special attack `featureDetails` entries (e.g. `sneak_attack_1d6` -> `special_attack:sneak_attack`, `death_attack` -> `special_attack:death_attack`, `smite_evil_1` -> `special_attack:smite`, `turn_or_rebuke_undead` -> `special_attack:turn_undead`).
   - Turn/Rebuke class features and domain bundles also declare `"feature:turn_or_rebuke"`.
4. **Feats (`feats/<id>.json`)**:
   - Feats granting a qualifying special attack (e.g., `stunning_fist.json`) declare `effectBundle.grantedTags: ["trait:special_attack", "special_attack:stun"]`.
5. **Creature Templates (`templates/<id>.json`)**:
   - Add `"trait:special_attack"` and `"special_attack:<id>"` (e.g. `"special_attack:breath_weapon"` on `half_dragon_*.json`) to `grantedTags`.
   - `applyCreatureTemplate` merges `template.grantedTags` into the entity's `subtypes` array so `projectDnD35ActorSemanticTags` projects them automatically.

---

## 2. Declarative Targeted Feats (`DnD35FeatRepeatableSchema`) & `$selected` Gating

Targeted repeatable feats configure their UI option pool and modifier scoping strictly via `repeatable` and `effectBundle.category` in `feats/<id>.json`:

| Field | Values | Meaning |
| :--- | :--- | :--- |
| `mode` | `'stacking' \| 'targeted'` | Stacking vs. parameter-targeted repeatable feat |
| `targetCategory` | `'weapon' \| 'natural_weapon' \| 'school' \| 'skill' \| 'ability'` | UI target pool selector, `effectTagsAll` binding prefix, and Rule 21 modifier routing |
| `weaponProficiencyFilter` | `'simple' \| 'martial' \| 'exotic'` | Filters `getCanonicalBaseWeapons(sys)` by `weaponStats.proficiencyCategory` |
| `allowedTargets` | `string[]` | Explicit allow-list of target IDs (e.g. Rapid Reload crossbows) |
| `effectBundle.category` | `'proficiency' \| ...` | When combined with `weapon`/`natural_weapon`, grants `proficiency:weapon:<targetId>` |

- **`$selected` Tag Interpolation (`prerequisites.ts`)**: `has_tag` nodes containing `$selected` (e.g., `"tag": "special_attack:$selected"`) validate `context.tags.includes(tag.replace('$selected', context.targetId))` when a target is chosen, and filter the UI target `<select>` in `dnd35e_char_builder_feat_row.ui.ts` down to owned `special_attack:*` capabilities.
- **Natural Weapon Ownership (`naturalWeaponIds`)**: `min_natural_attacks` checks both `naturalAttackCount >= minCount` and `context.naturalWeaponIds.includes(context.targetId)` when `prereqCtx` is populated, filtering `Improved Natural Attack` to natural weapons actually possessed by the actor.

---

## 3. Declarative Class, Domain & Weapon Equivalence Properties

- **Composite / Equivalent Weapon Proficiency (`DnD35WeaponStatsSchema.proficiencyEquivalentWeaponId`)**: Items such as `longbow.json` / `composite_longbow.json` and `shortbow.json` / `composite_shortbow.json` link symmetrically via `proficiencyEquivalentWeaponId` so `collectActorProficiencies` never hardcodes weapon IDs.
- **Deity Favored Weapon Domains (`DnD35DomainDefinitionSchema.grantsDeityFavoredWeaponProficiencyAndFocus`)**: Declared in `domains/war.json` to drive both `collectClassChoiceFeats` (`ledger_choices.ts`) and `collectActorProficiencies` (`builder_prereq_proficiencies.ts`).
- **Combat Style Feat Progression (`DnD35ClassFeatureDetailSchema.combatStyleFeatByChoice`)**: Declared on `combat_style`, `improved_combat_style`, and `combat_style_mastery` in `classes/ranger.json` with `activationCondition: { selfTagsNone: ['armor:medium', 'armor:heavy'] }`.

---

## 4. Authoring Checklist ("New Content Mod" Litmus Test)

When adding a new monster, class feature, weapon, domain, or targeted feat:
- Adding a new exotic 1H / martial 2H weapon? Set `"proficiencyCategory": "exotic"` and `"isExotic1HMartial2H": true` in `items/<id>.json`. Zero `.ts` changes needed.
- Adding a new composite/paired weapon proficiency? Set `"proficiencyEquivalentWeaponId"` in `items/<id>.json`. Zero `.ts` changes needed.
- Adding a new targeted crossbow-style or special-weapon feat? Set `repeatable.allowedTargets` or `repeatable.weaponProficiencyFilter` in `feats/<id>.json`. Zero `.ts` changes needed.
- Adding a new natural attack step-up effect? Emit `StatModifier` `{ "target": "natural_damage_size_step", "value": 1, "type": "untyped" }`.
- Adding a new special attack + `Ability Focus` target? Project `"trait:special_attack"` and `"special_attack:<id>"` from `grantedTags` or `NaturalWeaponDescriptor.riders` and resolve DCs via `resolveSpecialAbilitySaveDc`.
