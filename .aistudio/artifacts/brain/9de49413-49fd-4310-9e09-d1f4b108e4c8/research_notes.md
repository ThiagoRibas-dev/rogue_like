# Research Notes — Milestone 124: Post-M123 Audit Remediation (Weapon Enhancement Scoping, Lateral Spell & Feat StatModifier Parity, Crit Immunity, Blind-Fight & Bane Weapons)

## 1. Reiteration of Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Zero `any` & Strict TypeScript (`AGENTS.md` Rule 11 & Section 3):** `exactOptionalPropertyTypes: true` is enforced across the project. All exported functions, types, and constants must carry explicit types and JSDoc comments.
2. **Zero Magic Values (`AGENTS.md` Rule 12):** Every gameplay literal must be a named constant or data-driven JSON entry.
3. **Map Cascading Effects Across All Three Directions (`AGENTS.md` Rule 15):** Every change to data shapes, call-site ordering, or modifier keys must be mapped across **Upstream** (producers/authors), **Downstream** (consumers/resolvers/UI), and **Lateral** (sibling JSONs, tests, validators).
4. **Baseline Rules + Declarative Overrides & Modifiers (`AGENTS.md` Rule 17):**
   - Domain resolvers (`evaluateDnD35eEntityDAG`, `resolveActorAttackRoutine`, `resolveDnD35eMeleeAttack`, `resolveCombatManeuver`) must never hardcode `if (dndData.feats?.includes(...))` branches.
   - Any numeric count, step, bonus, penalty, or percentage (`0–100%`) with stacking or non-stacking rules MUST be modeled as a `StatModifier` and resolved through `resolveTypedModifiersWithBreakdown` — never as a boolean `ruleKey` or numeric `ruleOverrides` payload. Reserve `RuleOverride` strictly for qualitative behavioral switches (`grapple_no_aoo`, `trip_no_aoo`, `reroll_concealment_miss_chance`, `cleave_extra_attack_on_drop`, etc.).
5. **Unified Effect Providers & 4-Layer Decision Matrix (`AGENTS.md` Rule 19):**
   - Layer A: Semantic Tags (`type:elemental`, `subtype:swarm`, `alignment:evil`, `weapon:longsword`).
   - Layer B: Effect Bundles (`DnD35EffectBundle` with hierarchical `sourcePath`).
   - Layer C: Scaling Pools (`ResourcePoolComponent` / `scalingPools`).
   - Layer D: Domain Resolvers.
6. **Three-Horizon Computation Boundaries (`AGENTS.md` Rule 20):**
   - Horizon 1: Immutable `levelHistory`.
   - Horizon 2: Aggregated progression layers (`ledger_modifiers.ts`).
   - Horizon 3: Live equipment & situational tag projection (`dnd35e_equipped_item_dag.ts`, `weapon_profile_parser.ts`, `semantic_tags_context.ts`).

---

## 2. Detailed Research Findings from Post-M123 Audit

### Finding 1 — Weapon-Scoped Enhancement `effectBundle` Modifiers in `dnd35e_equipped_item_dag.ts`
* **Current Behavior:**
  - `public/data/rulesets/dnd35e/item_enhancements.json` defines `"keen"` (`target: "crit_threat_doubling"`, `type: "threat_expansion"`) and `"speed"` (`target: "extra_full_bab_attacks"`, `type: "haste"`) inside `effectBundle.modifiers` without an `effectTagsAny` weapon filter, because the enhancement definition in `item_enhancements.json` is weapon-agnostic.
  - In `src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts` (lines 116–127), `collectEquippedItemDAGContributions` evaluates `enh.effectBundle` for every equipped item and pushes `evalRes.statModifiers` directly into the actor's modifier list without scoping weapon-targeted modifiers to the specific weapon (`weapon:${itemDef.id}` / `weapon:${baseWeaponId}`).
  - Furthermore, lines 98–108 of `dnd35e_equipped_item_dag.ts` emit a duplicate `crit_threat_doubling` modifier with `condition: { effectTagsAny: ['weapon:${itemDef.id}'] }` (missing `weapon:${itemDef.baseItemId}` for inherited items!).
* **Impact:**
  - If an actor equips a mundane Longsword in their main hand and a *Keen* or *Speed* Shortsword in their off-hand, the unscoped `enh.effectBundle` modifier from the off-hand Shortsword leaks globally onto the main-hand Longsword!
* **Resolution:**
  - In `collectEquippedItemDAGContributions` (`src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`), when `itemDef.category === 'weapon'`, compute `const weaponTags = Array.from(new Set([`weapon:${itemDef.id}`, ...(itemDef.baseItemId ? [`weapon:${itemDef.baseItemId}`] : [])]))`.
  - Scope any weapon-intrinsic modifier (`crit_threat_doubling`, `extra_full_bab_attacks`, `strike_attack`, `strike_damage`) emitted from `itemDef.effectBundle` or `enh.effectBundle` (and the `keen` property check on line 98) so its `condition.effectTagsAny` includes `weaponTags` unless already restricted.

---

### Finding 2 — Lateral Spell & Subtype JSON Parity (`haste.json`, `battletide.json`, `blur.json`, `displacement.json`, `incorporeal.json`)
* **Current Behavior:**
  - `public/data/rulesets/dnd35e/spells/haste.json`:
    - Line 66 uses `"target": "save_ref"` instead of `"target": "ref"` (which `evaluateDnD35ActorStatDAG` in `src/rulesets/dnd35e/modifiers/dag_resolver.ts` line 183 resolves via `modsByStat['ref']`).
    - Lines 77–83 still use `"ruleOverrides": [{ "id": "haste_extra_attack", "ruleKey": "extra_full_attack_haste", "value": true }]` instead of a `StatModifier` `{ "id": "haste_extra_attack", "target": "extra_full_bab_attacks", "value": 1, "type": "haste" }`.
  - `public/data/rulesets/dnd35e/spells/battletide.json`:
    - Line 117 uses `"target": "save_ref"` instead of `"target": "ref"`.
    - Lines 133–139 still use `"ruleOverrides": [{ "id": "battletide_extra_attack", "ruleKey": "extra_full_attack_haste", "value": true }]` instead of `{ "id": "battletide_extra_attack", "target": "extra_full_bab_attacks", "value": 1, "type": "haste" }` (matching the spell description: *"1 extra full-attack strike (non-cumulative with haste)"*).
  - `public/data/rulesets/dnd35e/spells/blur.json`:
    - Lines 47–53 use `"ruleOverrides": [{ "id": "blur_concealment", "ruleKey": "concealment_20_percent", "value": true }]` instead of `{ "id": "blur_concealment", "target": "miss_chance", "value": 20, "type": "enhancement" }`.
  - `public/data/rulesets/dnd35e/spells/displacement.json`:
    - Lines 47–53 use `"ruleOverrides": [{ "id": "displacement_concealment", "ruleKey": "concealment_50_percent", "value": true }]` instead of `{ "id": "displacement_concealment", "target": "miss_chance", "value": 50, "type": "enhancement" }`.
  - `public/data/rulesets/dnd35e/subtypes/incorporeal.json`:
    - Lines 18–24 use `"ruleKey": "corporeal_magic_miss_chance_pct", "value": 50`. Adding a conditional `StatModifier` `{ "id": "incorporeal_miss_chance", "target": "miss_chance", "value": 50, "type": "base", "condition": { "effectTagsNone": ["ghost_touch", "force"] } }` in `modifiers` and `traitBundles[0].modifiers` integrates Incorporeal miss chance directly with the `miss_chance` DAG target.

---

### Finding 3 — Critical Hit Immunity, `Blind-Fight`, and Feat Rule-Key Alignment in Combat Resolvers
* **Current Behavior:**
  1. **`targetImmuneToCrits` (`src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts` line 154):**
     - Currently only checks `defenderData.abilityScores.con.base === null` (Undead and Constructs).
     - Per D&D 3.5e SRD, **Elementals**, **Oozes**, **Plants**, and creatures with the **Swarm** or **Incorporeal** subtype (unless struck by a *Ghost Touch* weapon) are immune to critical hits, and their JSON definitions (`public/data/rulesets/dnd35e/creature_types/{elemental,ooze,plant}.json` and `subtypes/{swarm,incorporeal}.json`) already declare `"critical_hits"` in `immunities`!
     - Checking `defenderData.abilityScores.con.base === null || defenderData.immunities.includes('critical_hits') || defenderSelfTags.includes('type:elemental') || defenderSelfTags.includes('type:ooze') || defenderSelfTags.includes('type:plant') || defenderSelfTags.includes('subtype:swarm')` ensures 100% SRD crit immunity parity.
  2. **`hasBlindFight` (`src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts` line 145 & `src/rulesets/dnd35e/progression/ledger_modifiers.ts`):**
     - `public/data/rulesets/dnd35e/feats/blind_fight.json` emits `ruleKey: "reroll_concealment_miss_chance", value: true`.
     - `resolveAttackRoll` (`src/rulesets/dnd35e/combat/attack_roll.ts` line 32) accepts `hasBlindFight?: boolean`, which rerolls a failed concealment miss-chance roll once.
     - However, `ResolvedActiveCombatRules` (`ledger_modifiers.ts`) and `DnD35EntityDAGResult` (`dnd35e_dag_adapter.ts`) do not expose `hasBlindFight`, so `resolveDnD35eMeleeAttack` never passes `hasBlindFight` to `resolveAttackRoll`.
  3. **Feat `ruleKey` Mismatches & Hardcoded `dndData.feats?.includes(...)` Fallbacks (`ledger_modifiers.ts` & `dnd35e_dag_adapter.ts`):**
     - In `src/rulesets/dnd35e/progression/ledger_modifiers.ts` (`buildCombatRuleOverridesFromActiveRules`, lines 297–325):
       - Checks `r.ruleKey === 'cleave_followup_on_drop'`, while `cleave.json` has `"ruleKey": "cleave_extra_attack_on_drop"`.
       - Checks `r.ruleKey === 'great_cleave_unlimited_on_drop'`, while `great_cleave.json` has `"ruleKey": "great_cleave_unlimited"`.
       - Checks `r.ruleKey === 'secondary_natural_penalty'`, while `multiattack.json` has `"ruleKey": "secondary_natural_attack_penalty"`.
       - Checks `r.ruleKey === 'twf_primary_penalty'` / `'twf_offhand_penalty'`, while `two_weapon_fighting.json` and `multiweapon_fighting.json` have `"ruleKey": "twf_penalty_reduction", "value": true`.
     - Because of those mismatches, `dnd35e_dag_adapter.ts` (lines 202, 207–211, 224–225) had hardcoded `|| dndData.feats?.includes('cleave') === true` fallbacks (violating `AGENTS.md` Rule 17).
     - Aligning `buildCombatRuleOverridesFromActiveRules` and the feat JSONs allows removing all `dndData.feats?.includes(...)` checks from `dnd35e_dag_adapter.ts`.

---

### Finding 4 — Legacy `getEquippedItemBonuses` Split-Brain in `srd_registry.ts` & `dnd35e_dag_adapter.ts`
* **Current Behavior:**
  - `getEquippedItemBonuses` in `src/rulesets/dnd35e/srd_registry.ts` (lines 160–181) reads raw `state.campaign.items[itemComp.itemId]` without `resolveEffectiveItemDefinition` and sums `itemDef.equippable.attackBonus` across all equipped slots.
  - If an actor dual-wields two `+1` weapons, `equipAttackBonus` becomes `+2`, which `dnd35e_dag_adapter.ts` line 115 pushes to `dagResult.attackBonus` (inflating the actor's top-level `attackBonus` by the off-hand weapon's enhancement bonus!).
* **Resolution:**
  - Update `getEquippedItemBonuses` in `src/rulesets/dnd35e/srd_registry.ts` to:
    1. Resolve each item via `resolveEffectiveItemDefinition(rawItemDef, state.campaign.items, itemComp)`.
    2. Compute `equipAttackBonus` as the **main-hand (or highest single weapon)** enhancement/masterwork/equippable attack bonus rather than summing across multiple weapons, and only include legacy `equippable.defenseBonus` when the item does not already have structured `armorStats` (preventing double-counting with `collectEquippedItemDAGContributions`).

---

### Finding 5 — Pre-existing Feats Using Numeric `ruleOverrides` Instead of `StatModifier`s (`AGENTS.md` Rule 17)
* **Current Behavior:**
  - Several feats in `public/data/rulesets/dnd35e/feats/*.json` store numeric bonuses or capacities inside `ruleOverrides` instead of `modifiers`:
    1. `spell_focus.json`: `"ruleOverrides": [{ "id": "spell_save_dc_bonus", "ruleKey": "spell_save_dc_bonus", "value": 1 }]` -> should be in `"modifiers": [{ "id": "spell_save_dc_bonus", "target": "spell_save_dc", "value": 1, "type": "untyped" }]` (which `resolveFeatEffectBundle` in `src/rulesets/dnd35e/effect_bundle.ts` lines 258–272 already transforms by binding `condition: { effectTagsAll: ['school:<targetId>'] }`!).
    2. `greater_spell_focus.json`: `"ruleOverrides": [{ "id": "greater_spell_save_dc_bonus", "ruleKey": "greater_spell_save_dc_bonus", "value": 1 }]` -> should be in `"modifiers": [{ "id": "greater_spell_save_dc_bonus", "target": "spell_save_dc", "value": 1, "type": "untyped" }]`.
    3. `spell_penetration.json` & `greater_spell_penetration.json`: use `ruleOverrides` with `value: 2` -> should emit `"modifiers": [{ "id": "...", "target": "caster_level_check_vs_sr", "value": 2, "type": "untyped" }]`.
    4. `improved_turning.json` & `extra_turning.json`: use `ruleOverrides` with `value: 1` and `value: 4` -> should emit `"modifiers"` targeting `"effective_turning_level"` (`value: 1, type: "untyped"`) and `"turn_attempts_per_day"` (`value: 4, type: "untyped"`).
    5. `ability_focus.json` & `ability_focus_poison.json`: use `ruleOverrides` with `value: 2` -> should emit `"modifiers"` targeting `"special_ability_save_dc"` (`value: 2, type: "untyped"`, bound to `ability:<targetId>` when targeted).
    6. Combat maneuver feats (`improved_trip.json`, `improved_bull_rush.json`, `improved_disarm.json`, `improved_overrun.json`, `improved_sunder.json`): unlike `improved_grapple.json` (which properly uses `"modifiers": [{ "id": "mod_0", "target": "grapple", "value": 4, "type": "untyped" }]`), these 5 feats put their `+4` check bonus in `ruleOverrides` (`*_check_bonus: 4`). Moving the `+4` bonus to `"modifiers"` (`target: "trip" | "bull_rush" | "disarm" | "overrun" | "sunder"`, `value: 4`, `type: "untyped"`) while keeping their qualitative flags (`trip_no_aoo`, `trip_followup_melee_attack`, `bull_rush_no_aoo`, `disarm_no_aoo`, `disarm_no_counter`, `overrun_target_cannot_avoid`, `sunder_no_aoo`) in `ruleOverrides` makes all 6 maneuver feats 100% consistent with `improved_grapple.json` and Rule 17!

---

### Finding 6 — `baneCreatureType` Weapon Enhancement Resolution (`weapon_profile_parser.ts` & `item_enhancements.json`)
* **Current Behavior:**
  - `DnD35MagicalPropertiesSchema` (`src/rulesets/dnd35e/types/system/item_system.types.ts` line 92) defines `baneCreatureType: z.string().optional()`.
  - Per D&D 3.5e SRD (DMG p. 224, *Bane*): A *bane* weapon excels at attacking one type or subtype of creature. Against its designated foe, its effective enhancement bonus is `+2` higher than its normal enhancement bonus (granting `+2` attack and `+2` damage) and it deals an extra `+2d6` points of damage against the foe.
* **Resolution:**
  - Add `"bane"` to `public/data/rulesets/dnd35e/item_enhancements.json` (`bonusEquivalent: 1`).
  - In `parseEquippedItem` (`src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`), when `magicalProps?.baneCreatureType` is defined (e.g., `"undead"`, `"evil_outsider"`, `"construct"`):
    - Emit a conditional `DnD35WeaponDamageRider` (`id: 'bane_hit'`, `trigger: 'on_hit'`, `dice: '2d6'`, `damageType: 'untyped'`, `condition: { targetTagsAny: ['type:${baneType}', 'subtype:${baneType}'] }`).
  - In `collectEquippedItemDAGContributions` (`src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`), when an equipped weapon has `magicalProps?.baneCreatureType`, emit conditional `+2` `untyped` (effective enhancement delta) modifiers to `strike_attack` and `strike_damage` gated on `targetTagsAny: ['type:${baneType}', 'subtype:${baneType}']` and `effectTagsAny: weaponTags`.

---

## 3. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Producers / Data) | Downstream (Consumers / Resolvers / UI) | Lateral (Sibling JSONs / Tests / Validators) |
| :--- | :--- | :--- | :--- |
| **1. Scope weapon enhancement `effectBundle` modifiers in `collectEquippedItemDAGContributions`** | `item_enhancements.json` (`keen`, `speed`), `DnD35ItemDefinition` | `evaluateDnD35eEntityDAG`, `resolveActorAttackRoutine` (`extra_full_bab_attacks`), `parseEquippedItem` (`crit_threat_doubling`) | `tests/dnd35e_equipment_m115.test.ts` |
| **2. Migrate spell/subtype JSONs (`haste`, `battletide`, `blur`, `displacement`, `incorporeal`) to `StatModifier`s (`extra_full_bab_attacks`, `miss_chance`, `ref`)** | `public/data/rulesets/dnd35e/spells/{haste,battletide,blur,displacement}.json`, `subtypes/incorporeal.json` | `evaluateDnD35ActorStatDAG` (`modsByStat['ref']`, `modsByStat['miss_chance']`), `resolveActorAttackRoutine` (`extra_full_bab_attacks`) | `scripts/run-validator.ts`, spell & subtype tests |
| **3. Wire `targetImmuneToCrits`, `hasBlindFight`, and align feat `ruleKey`s in `ledger_modifiers.ts` & `dnd35e_combat_adapter.ts`** | `blind_fight.json`, `cleave.json`, `great_cleave.json`, `multiattack.json`, `two_weapon_fighting.json`, `multiweapon_fighting.json`, `creature_types/*.json`, `subtypes/*.json` | `buildCombatRuleOverridesFromActiveRules`, `evaluateDnD35eEntityDAG`, `resolveDnD35eMeleeAttack`, `resolveAttackRoll` | `tests/dnd35e_feats_m114.test.ts`, `tests/dnd35e_equipment_m115.test.ts` |
| **4. Update `getEquippedItemBonuses` in `srd_registry.ts` to use `resolveEffectiveItemDefinition` and avoid summing off-hand weapon attack bonuses** | `EquipmentComponent`, `ItemComponent`, `DnD35ItemDefinition` | `evaluateDnD35eEntityDAG` (`dnd35e_dag_adapter.ts`) | `tests/dnd35e_equipment_m115.test.ts` |
| **5. Migrate numeric `ruleOverrides` in `feats/*.json` to `modifiers`** | `spell_focus.json`, `greater_spell_focus.json`, `spell_penetration.json`, `greater_spell_penetration.json`, `improved_turning.json`, `extra_turning.json`, `ability_focus.json`, `ability_focus_poison.json`, `improved_{trip,bull_rush,disarm,overrun,sunder}.json` | `resolveFeatEffectBundle` (`effect_bundle.ts`), `buildFeatEffectModifiers` (`ledger_modifiers.ts`) | `tests/dnd35e_feats_m114.test.ts`, `scripts/run-validator.ts` |
| **6. Implement `baneCreatureType` weapon enhancement resolution** | `DnD35MagicalPropertiesSchema`, `item_enhancements.json` (`bane`) | `parseEquippedItem` (`weapon_profile_parser.ts`), `collectEquippedItemDAGContributions` (`dnd35e_equipped_item_dag.ts`), `resolveDnD35eMeleeAttack` | `tests/dnd35e_equipment_m115.test.ts` |
