# Research Notes — Milestone 115.1: Declarative Rule-Override Routing, Codified Crit Threat Expansion, Per-Strike Weapon-Scoped Modifiers & Data-Driven Cleanup

## 1. Architectural Rules & Standards Reiteration (`AGENTS.md` & `docs/ARCHITECTURE.md`)

- **Rule 11 (Zero `any`):** Every type, helper, and schema extension must be strictly typed (`exactOptionalPropertyTypes: true`).
- **Rule 12 (Zero Magic Values):** Every gameplay constant must be a named constant or defined in declarative JSON registries.
- **Rule 15 (Cascading Effects Matrix):** Map **Upstream**, **Downstream**, and **Lateral** effects across all call sites, schemas, validators, and tests.
- **Rule 16 (Three-Tier Placement Heuristic):** Keep generic stat stacking, rule overrides, and per-strike tag filtering in Tier 2 (`src/rulesets/dnd35e/`), parameterized by Tier 3 data (`public/data/rulesets/dnd35e/{feats,items,skills,classes}/*.json`).
- **Rule 17 (Baseline Rules + Declarative Overrides & Modifiers — No Feat/Content Spaghetti):** Baseline resolvers (`evaluateDnD35eEntityDAG`, `resolveActorAttackRoutine`, `resolveDnD35eMeleeAttack`, `evaluateNonproficiencyPenalty`, `evaluateTacticalDoctrineModifiers`) must never hardcode `if (feats.includes('...'))` or `if (skillId === '...')`. They must consume declarative `StatModifier`s (filtered via `selfTags*`, `targetTags*`, `effectTags*`) and `RuleOverride`s (`collectActiveFeatRuleOverrides`).
- **Rule 19 (Unified Effect Providers & Hierarchical Provenance `sourcePath`):** Every emitted modifier must carry a slash-delimited `sourcePath` (e.g., `"item:keen_rapier_plus1/keen"`, `"feat:improved_critical/threat_expansion"`, `"feat:weapon_focus_longsword/atk_bonus"`) so `resolveTypedModifiersWithBreakdown` records active winners, shadowed losers (`shadowedModifiers`), and suppressed modifiers (`suppressedModifiers`).
- **Rule 20 (Three-Horizon Computation Boundaries):** Preserve conditional weapon/stance modifiers in Horizon 2 (`level_ledger.ts`) and evaluate them dynamically against active weapon/stance tags in Horizon 3 (`evaluateDnD35eEntityDAG` and `resolveActorAttackRoutine`).

---

## 2. SSOT Ownership & Old-Brain Eviction Table (`docs/SSOT_DND35E.md` Audit)

Per Kickoff Step 4, we audited `docs/SSOT_DND35E.md` and `docs/ssot/ssot_dnd35e.json` to map every responsibility to its canonical owner and evict remaining hardcoded "old-brain" branches:

| Responsibility | Canonical SSOT Owner (`docs/SSOT_DND35E.md`) | Old-Brain / Split-Brain Code to Evict |
| :--- | :--- | :--- |
| **Non-stacking critical threat expansion (`'threat_expansion'`)** | `src/rulesets/dnd35e/modifiers/stacking_engine.ts` (`resolveTypedModifiersWithBreakdown`) + `src/rulesets/dnd35e/types/stats.types.ts` (`BonusType`) | Evict `feats.some(f => f === 'improved_critical' ...)` and boolean `isKeen \|\| hasImprovedCrit` from `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`. |
| **Combat rule overrides (`twf_primary_penalty`, `twf_offhand_penalty`, `secondary_natural_penalty`, `extra_offhand_attacks`, `use_dex_for_light_finesse_melee_attack`, `cleave_followup_on_drop`, `great_cleave_unlimited_on_drop`)** | `src/rulesets/dnd35e/progression/ledger_modifiers.ts` (`collectActiveFeatRuleOverrides`, `buildCombatRuleOverridesFromActiveRules`) | Evict `dndData.feats?.includes('weapon_finesse' \| 'two_weapon_fighting' \| 'multiweapon_fighting' \| 'multiattack')` from `dnd35e_dag_adapter.ts` and `attackerData.feats?.includes('cleave' \| 'great_cleave')` from `dnd35e_combat_adapter.ts`. |
| **Per-strike weapon-scoped attack, damage & crit threat modifiers (`strike_attack`, `strike_damage`, `crit_threat_doubling`)** | `src/rulesets/dnd35e/combat/attack_routine.ts` (`resolveActorAttackRoutine`) | Evict unscoped `target: 'attack'` on `weapon_focus_*.json` that bled onto non-matching weapons (`docs/SSOT_DND35E.md` anti-pattern: *"Never fold per-weapon enhancement or main-hand doctrine modifiers into the actor-wide stat modifier pool"*). |
| **Tactical Doctrine Dials & Defensive Stance Modifiers** | `src/rulesets/dnd35e/combat/tactical_doctrine.ts` (`extractActorTacticalDials`, `evaluateTacticalDoctrineModifiers`) + `public/data/rulesets/dnd35e/skills/tumble.json` | Evict `hasTumbleSynergy` duplicate branch in `dnd35e_dag_adapter.ts` (`effectiveTumbleRanks` workaround) and extract `TacticalDialDescriptor[]` dynamically from `featDef.effectBundle.activatedAbilities[].variableDial`. |
| **Monster Class Track Curves (`babCurve`, `fortCurve`, `refCurve`, `willCurve`)** | `src/rulesets/dnd35e/archetype/race_hydrator.ts` (`hydrateRaceAsArchetype`) reading `sysContent.classes[cl.classId]` | Evict hardcoded `cl.classId === 'warrior' \|\| cl.classId === 'fighter' \|\| cl.classId === 'barbarian'` ternaries when `clsDef` is present. |
| **Horizon 3 Literacy & Situational Tag Projection** | `src/rulesets/dnd35e/semantic_tags.ts` (`projectDnD35ActorSemanticTags`) | Evict `t.trackId === 'barbarian'` string check in `semantic_tags.ts` (`docs/SSOT_DND35E.md` anti-pattern: *"Never hardcode class names (e.g. if (classId === 'barbarian')) for illiteracy"*). |
| **Domain Spell List Eligibility & Skill Take-10/20 Gating** | `src/rulesets/dnd35e/builder/builder_spells.ts` (`getSpellLevelForClass`) & `src/rulesets/dnd35e/skills.ts` (`resolveSkillCheck`) | Evict `if (classId === 'cleric')` in `builder_spells.ts` and `params.definition.skillId === 'use_magic_device'` in `skills.ts`. |
| **UI Feat Category Filter Classification** | `src/rendering/ui/dnd35e_char_builder_feats.ui.ts` (`classifyFeatCategory`) | Evict hardcoded `COMBAT_FEAT_IDS` list and 17 `idLower.includes(...)` substring checks in favor of declarative inspection of `feat.isFighterBonusFeat`, `feat.metamagicDescriptor`, `feat.prerequisites`, and `feat.effectBundle`. |

---

## 3. Detailed Task Research & Codebase Mapping

### Task 1: Codified Non-Stacking Critical Threat Range Expansion (`BonusType: 'threat_expansion'`)
- Add `'threat_expansion'` to `BonusType` (`src/rulesets/dnd35e/types/stats.types.ts`) and `DnD35BonusTypeSchema` (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`).
- Update `computeExpandedCritThreatMin(baseCritThreatMin: number, expandThreatRange: boolean | number)` in `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` so `expandThreatRange` accepts either a boolean or a numeric expansion multiplier count (`steps >= 1`), where `1` step doubles the threat span (`span * 2`) and `steps` stacks additively per SRD multiplier rules (`span * (1 + steps)`).
- In `collectEquippedItemDAGContributions` (`src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`), when an equipped weapon has `magicalProperties?.keen === true` or `itemTags.includes('keen')`, emit:
  ```ts
  {
    targetStat: 'crit_threat_doubling',
    value: 1,
    bonusType: 'threat_expansion',
    sourceId: `${itemRoot}:keen`,
    sourcePath: `${itemRoot}/keen`,
    origin: 'magical',
    condition: { effectTagsAny: [`weapon:${itemDef.id}`] }
  }
  ```
- In `public/data/rulesets/dnd35e/feats/improved_critical.json`, add a declarative modifier `{ id: 'improved_crit_threat_expansion', target: 'crit_threat_doubling', value: 1, type: 'threat_expansion' }`.
- In `buildFeatEffectModifiers` (`src/rulesets/dnd35e/progression/ledger_modifiers.ts`), support weapon-parameterized feat IDs (`improved_critical:longsword`, `improved_critical_longsword`, `weapon_focus:longsword`, `weapon_specialization:longsword`, etc.) by extracting the target weapon ID when a repeatable `choiceCategory === 'weapon'` feat has a `:weaponId` or `_weaponId` suffix and attaching `condition: { effectTagsAny: [\`weapon:\${weaponId}\`] }` to its emitted modifiers.
- In `parseEquippedItem` (`weapon_profile_parser.ts`) and `resolveActorAttackRoutine` (`attack_routine.ts`), resolve `crit_threat_doubling` via `resolveTypedModifiersWithBreakdown` with `effectTags: [\`weapon:\${weaponId}\`, ...]` and record `critThreatBreakdown?: StatResolutionBreakdown` on `DnD35ResolvedStrikeProfile`.

### Task 2: Pure Declarative `featRuleOverrides` Routing (`dnd35e_dag_adapter.ts`, `dnd35e_combat_adapter.ts`, `weapon_profile_parser.ts`)
- Add `buildCombatRuleOverridesFromActiveRules(ruleOverrides: ReadonlyArray<DnD35RuleOverrideEntry>, offHandIsLight: boolean)` in `src/rulesets/dnd35e/progression/ledger_modifiers.ts` (and export via `level_ledger.ts`) that derives:
  - `hasWeaponFinesse`: `ruleOverrides.some(r => r.ruleKey === 'use_dex_for_light_finesse_melee_attack' && r.value === true)`
  - `hasCleave`: `ruleOverrides.some(r => r.ruleKey === 'cleave_followup_on_drop' && r.value === true)`
  - `hasGreatCleave`: `ruleOverrides.some(r => r.ruleKey === 'great_cleave_unlimited_on_drop' && r.value === true)`
  - `combatOverrides: CombatRuleOverrides`: computes `twfPrimaryPenalty`, `twfOffHandPenalty`, `secondaryNaturalPenalty`, and `extraOffHandAttacks` from `twf_primary_penalty`, `twf_offhand_penalty`, `twf_light_offhand_bonus`, `secondary_natural_penalty`, and `extra_offhand_attacks` `ruleOverrides`.
- Wire `buildCombatRuleOverridesFromActiveRules` into `evaluateDnD35eEntityDAG` (`dnd35e_dag_adapter.ts`) and expose `hasCleave` / `hasGreatCleave` on `DnD35EntityDAGResult` so `resolveDnD35eMeleeAttack` (`dnd35e_combat_adapter.ts`) has zero `feats.includes(...)` checks.
- Update `evaluateNonproficiencyPenalty` (`weapon_profile_parser.ts`) to remove `weaponItemId.includes('dwarven')` and check `familiaritySubtypes` + `ruleOverrides` / `selfTags` (`proficiency:exotic`, `proficiency:weapon:<id>`).

### Task 3: Per-Strike Weapon-Scoped Feat & Item Modifiers (`attack_routine.ts`, `feats/weapon_focus*.json`)
- Update `weapon_focus_*.json`, `weapon_focus.json`, `greater_weapon_focus.json`, `weapon_specialization.json`, and `greater_weapon_specialization.json` to emit `StatModifier`s with `condition: { effectTagsAny: ['weapon:<id>'] }` (or `selfTagsAll: ['wielding:primary:<id>']` for primary-weapon sheet summary).
- Pass `statModifiers` and `selfTags` into `resolveActorAttackRoutine` (`attack_routine.ts`) so each strike evaluates `strike_attack`, `strike_damage`, and `crit_threat_doubling` filtered by `effectTags: [\`weapon:\${strikeWeaponId}\`, \`attack_source:\${entry.attackSource}\`]` via `resolveTypedModifiersWithBreakdown`.

### Task 4: Dynamic Tactical Doctrine Dials & Pure Tumble Rank-Threshold Synergy (`tactical_doctrine.ts`, `dnd35e_dag_adapter.ts`)
- Implement `extractActorTacticalDials(featIds, featRegistry, suppressedBundleIds)` in `tactical_doctrine.ts` reading `featDef.effectBundle.activatedAbilities[].variableDial` from `sysContent.feats` (`power_attack.json`, `combat_expertise.json`), falling back to `CANONICAL_TACTICAL_DIALS` only when `featRegistry` is undefined.
- In `dnd35e_dag_adapter.ts`, ensure `buildSkillRankThresholdModifiers` from `sysContent.skills` is included when `skill:` modifiers are not yet in `dndData.statModifiers`, and pass `0` for `tumbleRanks` into `evaluateTacticalDoctrineModifiers` so `tumble.json`'s 5-rank threshold modifiers are the single source of truth for defensive fighting AC synergy in the Stat DAG.

### Task 5: Data-Driven Class Curves, Literacy, Domain Spell Slots, Skill Take-10/20 Flags & UI Feat Category Filters
- `race_hydrator.ts`: Read `clsDef.babCurve`, `clsDef.fortCurve`, `clsDef.refCurve`, `clsDef.willCurve` from `classes?.[cl.classId]`.
- `semantic_tags.ts` & `dnd35e_combat_adapter.ts`: Pass `sysContent?.classes` and `sysContent?.skills` in `dnd35e_combat_adapter.ts` and remove the legacy `'barbarian'` string check in `semantic_tags.ts`.
- `builder_spells.ts`: Replace `if (classId === 'cleric')` with `if (domainIds.length > 0)`.
- `skills.ts`: Remove `params.definition.skillId === 'use_magic_device'` and rely strictly on `take10Allowed === false` and `take20Allowed === false`.
- `dnd35e_char_builder_feats.ui.ts`: Replace `COMBAT_FEAT_IDS` and substring checks in `classifyFeatCategory` with declarative inspection of `DnD35FeatDefinition`.

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Validators / UI) | Lateral (Sibling JSONs / Tests / SSOT) |
| :--- | :--- | :--- | :--- |
| **1. Add `'threat_expansion'` to `BonusType` & `DnD35BonusTypeSchema`** | `improved_critical.json`, `collectEquippedItemDAGContributions` (`keen`), future *Keen Edge* spell | `resolveTypedModifiersWithBreakdown` (`stacking_engine.ts`), `resolveActorAttackRoutine` (`attack_routine.ts`), `parseEquippedItem` (`weapon_profile_parser.ts`) | `tests/dnd35e_feats_m114.test.ts`, `tests/dnd35e_equipment_m115.test.ts` |
| **2. Pure `featRuleOverrides` routing (`buildCombatRuleOverridesFromActiveRules`)** | `collectActiveFeatRuleOverrides` (`ledger_modifiers.ts`), `two_weapon_fighting.json`, `multiweapon_fighting.json`, `multiattack.json`, `weapon_finesse.json`, `cleave.json`, `great_cleave.json` | `evaluateDnD35eEntityDAG`, `resolveActorAttackRoutine`, `resolveDnD35eMeleeAttack` | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |
| **3. Per-strike weapon-scoped modifiers (`strike_attack`, `strike_damage`, `crit_threat_doubling`)** | `weapon_focus_*.json`, `weapon_focus.json`, `weapon_specialization.json`, `greater_weapon_*.json`, `improved_critical.json` | `resolveActorAttackRoutine` (`attack_routine.ts`), `evaluateDnD35eEntityDAG` (`dnd35e_dag_adapter.ts`) | `tests/dnd35e_classes_builder.test.ts`, `tests/dnd35e_feats_m114.test.ts` |
| **4. Dynamic `extractActorTacticalDials` & Tumble synergy cleanup** | `power_attack.json`, `combat_expertise.json`, `tumble.json` | `evaluateTacticalDoctrineModifiers`, `computeStrikeDoctrineDamageBonus`, `evaluateDnD35eEntityDAG` | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |
| **5. `race_hydrator.ts`, `semantic_tags.ts`, `builder_spells.ts`, `skills.ts`, `dnd35e_char_builder_feats.ui.ts` cleanup** | `classes/*.json`, `skills/use_magic_device.json`, `feats/*.json` | `hydrateRaceAsArchetype`, `projectDnD35ActorSemanticTags`, `getSpellLevelForClass`, `resolveSkillCheck`, `renderSharedFeatsStep` | `tests/dnd35e_skills_phase3.test.ts`, `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |
