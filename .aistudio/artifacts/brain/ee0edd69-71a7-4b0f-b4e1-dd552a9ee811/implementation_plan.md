# Implementation Plan — Milestone 115.1: Declarative Rule-Override Routing, Codified Crit Threat Expansion, Per-Strike Weapon-Scoped Modifiers & Data-Driven Cleanup

## 1. SSOT Ownership & Old-Brain Eviction Table (`docs/SSOT_DND35E.md`)

| Responsibility | Canonical SSOT Owner | Old-Brain / Hardcoded Code to Evict |
| :--- | :--- | :--- |
| **Non-stacking critical threat expansion (`'threat_expansion'`)** | `src/rulesets/dnd35e/modifiers/stacking_engine.ts` (`resolveTypedModifiersWithBreakdown`) + `src/rulesets/dnd35e/types/stats.types.ts` (`BonusType`) | Evict `feats.some(f => f === 'improved_critical' ...)` and boolean `isKeen \|\| hasImprovedCrit` from `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`. |
| **Combat rule overrides (`twf_primary_penalty`, `twf_offhand_penalty`, `secondary_natural_penalty`, `extra_offhand_attacks`, `use_dex_for_light_finesse_melee_attack`, `cleave_followup_on_drop`, `great_cleave_unlimited_on_drop`)** | `src/rulesets/dnd35e/progression/ledger_modifiers.ts` (`collectActiveFeatRuleOverrides`, `buildCombatRuleOverridesFromActiveRules`) | Evict `dndData.feats?.includes('weapon_finesse' \| 'two_weapon_fighting' \| 'multiweapon_fighting' \| 'multiattack')` from `dnd35e_dag_adapter.ts` and `attackerData.feats?.includes('cleave' \| 'great_cleave')` from `dnd35e_combat_adapter.ts`. |
| **Per-strike weapon-scoped attack, damage & crit threat modifiers (`strike_attack`, `strike_damage`, `crit_threat_doubling`)** | `src/rulesets/dnd35e/combat/attack_routine.ts` (`resolveActorAttackRoutine`) | Evict unscoped `target: 'attack'` on `weapon_focus_*.json` that bled onto non-matching weapons (`docs/SSOT_DND35E.md` anti-pattern: *"Never fold per-weapon enhancement or main-hand doctrine modifiers into the actor-wide stat modifier pool"*). |
| **Tactical Doctrine Dials & Defensive Stance Modifiers** | `src/rulesets/dnd35e/combat/tactical_doctrine.ts` (`extractActorTacticalDials`, `evaluateTacticalDoctrineModifiers`) + `public/data/rulesets/dnd35e/skills/tumble.json` | Evict `effectiveTumbleRanks` workaround in `dnd35e_dag_adapter.ts` and extract `TacticalDialDescriptor[]` dynamically from `featDef.effectBundle.activatedAbilities[].variableDial`. |
| **Monster Class Track Curves (`babCurve`, `fortCurve`, `refCurve`, `willCurve`)** | `src/rulesets/dnd35e/archetype/race_hydrator.ts` (`hydrateRaceAsArchetype`) reading `sysContent.classes[cl.classId]` | Evict hardcoded `cl.classId === 'warrior' \|\| cl.classId === 'fighter' \|\| cl.classId === 'barbarian'` ternaries when `clsDef` is present. |
| **Horizon 3 Literacy & Situational Tag Projection** | `src/rulesets/dnd35e/semantic_tags.ts` (`projectDnD35ActorSemanticTags`) | Evict `t.trackId === 'barbarian'` string check in `semantic_tags.ts`. |
| **Domain Spell List Eligibility & Skill Take-10/20 Gating** | `src/rulesets/dnd35e/builder/builder_spells.ts` (`getSpellLevelForClass`) & `src/rulesets/dnd35e/skills.ts` (`resolveSkillCheck`) | Evict `if (classId === 'cleric')` in `builder_spells.ts` and `params.definition.skillId === 'use_magic_device'` in `skills.ts`. |
| **UI Feat Category Filter Classification** | `src/rendering/ui/dnd35e_char_builder_feats.ui.ts` (`classifyFeatCategory`) | Evict hardcoded `COMBAT_FEAT_IDS` list and 17 `idLower.includes(...)` substring checks in favor of declarative inspection of `feat.isFighterBonusFeat`, `feat.metamagicDescriptor`, `feat.prerequisites`, and `feat.effectBundle`. |

---

## 2. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Validators / UI) | Lateral (Sibling JSONs / Tests / SSOT) |
| :--- | :--- | :--- | :--- |
| **Step 1: Add `'threat_expansion'` to `BonusType` & `DnD35BonusTypeSchema`** | `improved_critical.json`, `collectEquippedItemDAGContributions` (`keen`), future *Keen Edge* spell | `resolveTypedModifiersWithBreakdown` (`stacking_engine.ts`), `resolveActorAttackRoutine` (`attack_routine.ts`), `parseEquippedItem` (`weapon_profile_parser.ts`) | `tests/dnd35e_feats_m114.test.ts`, `tests/dnd35e_equipment_m115.test.ts` |
| **Step 2: Pure `featRuleOverrides` routing (`buildCombatRuleOverridesFromActiveRules`)** | `collectActiveFeatRuleOverrides` (`ledger_modifiers.ts`), `two_weapon_fighting.json`, `multiweapon_fighting.json`, `multiattack.json`, `weapon_finesse.json`, `cleave.json`, `great_cleave.json` | `evaluateDnD35eEntityDAG`, `resolveActorAttackRoutine`, `resolveDnD35eMeleeAttack` | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |
| **Step 3: Per-strike weapon-scoped modifiers (`strike_attack`, `strike_damage`, `crit_threat_doubling`)** | `weapon_focus_*.json`, `weapon_focus.json`, `weapon_specialization.json`, `greater_weapon_*.json`, `improved_critical.json` | `resolveActorAttackRoutine` (`attack_routine.ts`), `evaluateDnD35eEntityDAG` (`dnd35e_dag_adapter.ts`) | `tests/dnd35e_classes_builder.test.ts`, `tests/dnd35e_feats_m114.test.ts` |
| **Step 4: Dynamic `extractActorTacticalDials` & Tumble synergy cleanup** | `power_attack.json`, `combat_expertise.json`, `tumble.json` | `evaluateTacticalDoctrineModifiers`, `computeStrikeDoctrineDamageBonus`, `evaluateDnD35eEntityDAG` | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |
| **Step 5: `race_hydrator.ts`, `semantic_tags.ts`, `builder_spells.ts`, `skills.ts`, `dnd35e_char_builder_feats.ui.ts` cleanup** | `classes/*.json`, `skills/use_magic_device.json`, `feats/*.json` | `hydrateRaceAsArchetype`, `projectDnD35ActorSemanticTags`, `getSpellLevelForClass`, `resolveSkillCheck`, `renderSharedFeatsStep` | `tests/dnd35e_skills_phase3.test.ts`, `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md` |

---

## 3. Step-by-Step Implementation Plan & Code Snippets

### Step 1: Codify `'threat_expansion'` Bonus Type & Weapon-Scoped Crit Threat Expansion

#### 1.1 `src/rulesets/dnd35e/types/stats.types.ts` & `src/rulesets/dnd35e/types/system/shared_system.types.ts`
Add `'threat_expansion'` to `BonusType` and `DnD35BonusTypeSchema`:
```ts
// src/rulesets/dnd35e/types/stats.types.ts
export type BonusType =
  | 'alchemical'
  | 'armor'
  | 'armor_enhancement'
  | 'base'
  | 'circumstance'
  | 'competence'
  | 'deflection'
  | 'dodge'
  | 'enhancement'
  | 'form_override'
  | 'inherent'
  | 'insight'
  | 'luck'
  | 'morale'
  | 'natural_armor'
  | 'natural_armor_enhancement'
  | 'profane'
  | 'racial'
  | 'resistance'
  | 'sacred'
  | 'shield'
  | 'shield_enhancement'
  | 'size'
  | 'size_step'
  | 'threat_expansion'
  | 'untyped';
```

#### 1.2 `src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`
Emit a weapon-scoped `crit_threat_doubling` modifier (`bonusType: 'threat_expansion'`) whenever an equipped weapon has `magicalProperties?.keen === true` or `itemTags.includes('keen')`:
```ts
    if (
      itemDef.category === 'weapon' &&
      (itemDef.magicalProperties?.keen === true || itemTags.includes('keen'))
    ) {
      modifiers.push({
        targetStat: 'crit_threat_doubling',
        value: 1,
        bonusType: 'threat_expansion',
        sourceId: `${itemRoot}:keen`,
        sourcePath: `${itemRoot}/keen`,
        origin: 'magical',
        condition: { effectTagsAny: [`weapon:${itemDef.id}`] }
      });
    }
```

#### 1.3 `public/data/rulesets/dnd35e/feats/improved_critical.json` & Weapon-Specific Feat JSONs
Update `improved_critical.json` to emit a declarative `'threat_expansion'` modifier on `crit_threat_doubling`:
```json
{
  "id": "improved_critical",
  "name": "Improved Critical",
  "isFighterBonusFeat": true,
  "repeatable": {
    "allowMultiple": true,
    "mode": "per_choice",
    "choiceCategory": "weapon"
  },
  "prerequisites": { "type": "min_bab", "value": 8 },
  "description": "When using the weapon you selected, your threat range is doubled. This effect doesn't stack with any other effect that expands the threat range of a weapon (such as the keen edge spell or the keen special ability).",
  "modifiers": [
    {
      "id": "improved_crit_threat_expansion",
      "target": "crit_threat_doubling",
      "value": 1,
      "type": "threat_expansion"
    }
  ],
  "ruleOverrides": [
    {
      "ruleKey": "double_weapon_threat_range",
      "value": true
    }
  ]
}
```
Update `weapon_focus_*.json`, `weapon_focus.json`, `greater_weapon_focus.json`, `weapon_specialization.json`, and `greater_weapon_specialization.json` to emit `strike_attack` / `strike_damage` modifiers (and `attack` / `damage` conditioned on `selfTagsAll: ['wielding:primary:<weaponId>']` for primary-weapon sheet summary), and enhance `buildFeatEffectModifiers` in `src/rulesets/dnd35e/progression/ledger_modifiers.ts` so weapon-parameterized feat IDs (`improved_critical:rapier`, `improved_critical_rapier`, `weapon_focus:longsword`, `weapon_specialization:longsword`) automatically attach `condition: { effectTagsAny: [\`weapon:\${weaponChoice}\`] }` to their strike modifiers!

---

### Step 2: Pure Declarative `featRuleOverrides` Routing (`ledger_modifiers.ts`, `dnd35e_dag_adapter.ts`, `dnd35e_combat_adapter.ts`, `weapon_profile_parser.ts`)

#### 2.1 `src/rulesets/dnd35e/progression/ledger_modifiers.ts`
Add `ResolvedActiveCombatRules` and `buildCombatRuleOverridesFromActiveRules`:
```ts
/**
 * Resolved combat behavioral flags and numerical penalty overrides derived purely from active `DnD35RuleOverrideEntry` records.
 */
export interface ResolvedActiveCombatRules {
  readonly hasWeaponFinesse: boolean;
  readonly hasCleave: boolean;
  readonly hasGreatCleave: boolean;
  readonly hasExoticWeaponProficiency: boolean;
  readonly combatOverrides: {
    readonly secondaryNaturalPenalty?: number | undefined;
    readonly twfPrimaryPenalty?: number | undefined;
    readonly twfOffHandPenalty?: number | undefined;
    readonly extraOffHandAttacks?: number | undefined;
  };
}

/**
 * Derives `ResolvedActiveCombatRules` strictly from declarative `DnD35RuleOverrideEntry` records
 * without inspecting feat IDs directly (`AGENTS.md` Rule 17).
 */
export function buildCombatRuleOverridesFromActiveRules(
  ruleOverrides: ReadonlyArray<DnD35RuleOverrideEntry>,
  offHandIsLight: boolean
): ResolvedActiveCombatRules {
  const hasWeaponFinesse = ruleOverrides.some(
    (r) => r.ruleKey === 'use_dex_for_light_finesse_melee_attack' && r.value === true
  );
  const hasCleave = ruleOverrides.some((r) => r.ruleKey === 'cleave_followup_on_drop' && r.value === true);
  const hasGreatCleave = ruleOverrides.some((r) => r.ruleKey === 'great_cleave_unlimited_on_drop' && r.value === true);
  const hasExoticWeaponProficiency = ruleOverrides.some(
    (r) => r.ruleKey === 'exotic_weapon_proficiency' && r.value === true
  );

  let secondaryNaturalPenalty: number | undefined;
  let baseTwfPrimary: number | undefined;
  let baseTwfOffHand: number | undefined;
  let twfLightBonus = 0;
  let extraOffHandAttacks = 0;

  for (const r of ruleOverrides) {
    if (r.ruleKey === 'secondary_natural_penalty' && typeof r.value === 'number') {
      secondaryNaturalPenalty =
        secondaryNaturalPenalty === undefined ? r.value : Math.max(secondaryNaturalPenalty, r.value);
    } else if (r.ruleKey === 'twf_primary_penalty' && typeof r.value === 'number') {
      baseTwfPrimary = baseTwfPrimary === undefined ? r.value : Math.max(baseTwfPrimary, r.value);
    } else if (r.ruleKey === 'twf_offhand_penalty' && typeof r.value === 'number') {
      baseTwfOffHand = baseTwfOffHand === undefined ? r.value : Math.max(baseTwfOffHand, r.value);
    } else if (r.ruleKey === 'twf_light_offhand_bonus' && typeof r.value === 'number') {
      twfLightBonus = Math.max(twfLightBonus, r.value);
    } else if (r.ruleKey === 'extra_offhand_attacks' && typeof r.value === 'number') {
      extraOffHandAttacks = Math.max(extraOffHandAttacks, r.value);
    }
  }

  const lightBonus = offHandIsLight ? (twfLightBonus > 0 ? twfLightBonus : 2) : 0;
  const twfPrimaryPenalty = baseTwfPrimary !== undefined ? baseTwfPrimary + lightBonus : undefined;
  const twfOffHandPenalty = baseTwfOffHand !== undefined ? baseTwfOffHand + lightBonus : undefined;

  return {
    hasWeaponFinesse,
    hasCleave,
    hasGreatCleave,
    hasExoticWeaponProficiency,
    combatOverrides: {
      ...(secondaryNaturalPenalty !== undefined ? { secondaryNaturalPenalty } : {}),
      ...(twfPrimaryPenalty !== undefined ? { twfPrimaryPenalty } : {}),
      ...(twfOffHandPenalty !== undefined ? { twfOffHandPenalty } : {}),
      ...(extraOffHandAttacks > 0 ? { extraOffHandAttacks } : {})
    }
  };
}
```

#### 2.2 `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`
- Update `computeExpandedCritThreatMin(baseCritThreatMin: number, expandThreatRange: boolean | number): number` to support numeric expansion step counts from `resolveTypedModifiersWithBreakdown`:
```ts
export function computeExpandedCritThreatMin(
  baseCritThreatMin: number,
  expandThreatRange: boolean | number
): number {
  const expansionSteps = typeof expandThreatRange === 'boolean' ? (expandThreatRange ? 1 : 0) : expandThreatRange;
  if (expansionSteps <= 0) return baseCritThreatMin;
  const span = Math.max(1, CRIT_THREAT_CEILING - baseCritThreatMin);
  return Math.max(MIN_CRIT_THREAT_ROLL, CRIT_THREAT_CEILING - span * (1 + expansionSteps));
}
```
- In `parseEquippedItem`:
  - Remove `feats.some(f => f === 'improved_critical' ...)` and resolve `critThreatMin` via `resolveTypedModifiersWithBreakdown` over candidate `crit_threat_doubling` modifiers (`keen` + `dndData.statModifiers` / `buildFeatEffectModifiers`).
  - In `evaluateNonproficiencyPenalty`, remove `weaponItemId.includes('dwarven')` and check `familiaritySubtypes` + `ruleOverrides` (`exotic_weapon_proficiency`) or projected proficiency tags (`proficiency:exotic`, `proficiency:weapon:<id>`).

---

### Step 3: Per-Strike Weapon-Scoped Modifiers & Crit Breakdown in `attack_routine.ts`

In `src/rulesets/dnd35e/combat/attack_routine.ts`:
- Add optional `statModifiers?: ReadonlyArray<StatModifier>` and `selfTags?: ReadonlyArray<string>` to `resolveActorAttackRoutine` params, and optional `critThreatBreakdown?: StatResolutionBreakdown` to `DnD35ResolvedStrikeProfile`.
- For each strike (`manufactured_primary`, `manufactured_offhand`, `natural_primary`, `natural_secondary`), build `strikeEffectTags`:
  ```ts
  const strikeEffectTags: ReadonlyArray<string> = [
    ...(strikeWeaponId !== undefined ? [`weapon:${strikeWeaponId}`] : []),
    `attack_source:${entry.attackSource}`,
    isNaturalOrUnarmed ? 'weapon_group:natural' : 'weapon_group:manufactured'
  ];
  ```
- Resolve per-strike `strike_attack`, `strike_damage`, and `crit_threat_doubling` modifiers via `resolveTypedModifiersWithBreakdown(candidateMods, { selfTags: params.selfTags, effectTags: strikeEffectTags })`, applying the resolved `strike_attack` and `strike_damage` totals and `computeExpandedCritThreatMin(baseCritThreatMin, critBreakdown.total)` to that strike!

---

### Step 4: Dynamic `extractActorTacticalDials` & Tumble Rank-Threshold Synergy Cleanup (`tactical_doctrine.ts`, `dnd35e_dag_adapter.ts`)

#### 4.1 `src/rulesets/dnd35e/combat/tactical_doctrine.ts`
Add `extractActorTacticalDials`:
```ts
/**
 * Extracts active `TacticalDialDescriptor` entries declaratively from an actor's owned feats
 * (`featDef.effectBundle.activatedAbilities[].variableDial`), falling back to `CANONICAL_TACTICAL_DIALS`
 * only when no feat registry is provided.
 */
export function extractActorTacticalDials(
  featIds: ReadonlyArray<string>,
  featRegistry: Readonly<Record<string, DnD35FeatDefinition>> | undefined,
  suppressedBundleIds: ReadonlyArray<string> = []
): ReadonlyArray<TacticalDialDescriptor> {
  if (!featRegistry) return CANONICAL_TACTICAL_DIALS;
  const dials: TacticalDialDescriptor[] = [];

  for (const rawFeatId of featIds) {
    const baseFeatId = rawFeatId.includes(':') ? rawFeatId.split(':')[0]! : rawFeatId;
    const featDef = featRegistry[rawFeatId] ?? featRegistry[baseFeatId];
    if (!featDef || !featDef.effectBundle) continue;
    if (suppressedBundleIds.includes(rawFeatId) || suppressedBundleIds.includes(featDef.id)) continue;

    for (const act of featDef.effectBundle.activatedAbilities ?? []) {
      const vd = act.variableDial;
      if (!vd) continue;
      const isPowerAttack = featDef.id === 'power_attack';
      const isCombatExpertise = featDef.id === 'combat_expertise';
      dials.push({
        abilityId: featDef.id,
        name: featDef.name,
        min: 0,
        maxCapRule: vd.capStat === 'fixed:5' ? 'fixed_5' : vd.capStat === 'class_level' ? 'class_level' : 'bab',
        attackDeltaPerPoint: vd.inputRatio,
        damageDeltaPerPoint: isCombatExpertise ? 0 : vd.primaryOutputRatio,
        acDeltaPerPoint: isCombatExpertise ? vd.primaryOutputRatio : 0,
        ...(vd.twoHandedOutputRatio !== undefined ? { twoHandedMultiplier: vd.twoHandedOutputRatio } : {}),
        ...(isPowerAttack
          ? { legacyPropertyKey: 'powerAttackAmount' }
          : isCombatExpertise
            ? { legacyPropertyKey: 'combatExpertiseAmount' }
            : {})
      });
    }
  }

  return dials.length > 0 ? dials : CANONICAL_TACTICAL_DIALS;
}
```
In `dnd35e_dag_adapter.ts`, remove `effectiveTumbleRanks`, ensure `buildSkillRankThresholdModifiers(dndData.skillRanks, sysContent.skills)` is included when `skill:` modifiers are not yet in `dndData.statModifiers`, and pass `0` for `tumbleRanks` + `activeDials` into `evaluateTacticalDoctrineModifiers`!

---

### Step 5: Data-Driven Class Curves, Literacy, Domain Spell Slots, Skill Take-10/20 Flags & UI Feat Category Filters

1. **`src/rulesets/dnd35e/archetype/race_hydrator.ts`:**
   ```ts
   for (const cl of requestedClassLevels) {
     const clsDef = classes?.[cl.classId];
     tracks.push({
       trackId: cl.classId,
       levels: cl.levels,
       hitDieSides: clsDef?.hitDieSides ?? 8,
       babCurve: clsDef?.babCurve ?? (cl.classId === 'warrior' ? 'full' : 'three_quarters'),
       fortCurve: clsDef?.fortCurve ?? (cl.classId === 'warrior' ? 'good' : 'poor'),
       refCurve: clsDef?.refCurve ?? 'poor',
       willCurve: clsDef?.willCurve ?? 'poor',
       skillPointsPerLevel: clsDef?.skillPointsPerLevel ?? 2,
       trackCategory: clsDef?.isPrestige ? 'prestige' : clsDef?.isNpcClass || cl.classId === 'warrior' ? 'npc' : 'pc'
     });
   }
   ```
2. **`src/rulesets/dnd35e/semantic_tags.ts` & `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts`:**
   - Pass `situationalContext`, `sysContent?.classes`, and `sysContent?.skills` into `projectDnD35ActorSemanticTags` in `dnd35e_combat_adapter.ts`.
   - Remove the redundant `if (!tags.has('trait:literate') && dndData.tracks.some((t) => t.trackId === 'barbarian' && t.levels > 0))` block from `semantic_tags.ts`.
3. **`src/rulesets/dnd35e/builder/builder_spells.ts`:**
   - Replace `if (classId === 'cleric')` with `if (domainIds.length > 0)`.
4. **`src/rulesets/dnd35e/skills.ts`:**
   - Remove `params.definition.skillId === 'use_magic_device'` from `resolveSkillCheck` so Take 10 / Take 20 prohibition is governed strictly by `params.definition.take10Allowed === false` and `params.definition.take20Allowed === false`.
5. **`src/rendering/ui/dnd35e_char_builder_feats.ui.ts`:**
   - Remove `COMBAT_FEAT_IDS` and substring checks in `classifyFeatCategory`, deriving `isFighterBonus`, `isCombat`, and `isMagic` declaratively from `feat.isFighterBonusFeat`, `feat.metamagicDescriptor`, `feat.prerequisites`, `feat.modifiers`, `feat.ruleOverrides`, and `feat.effectBundle`.

---

### Step 6: Regression Tests, SSOT Sync & 8-Stage Verification (`./verify.sh`)
- Add unit tests in `tests/dnd35e_feats_m114.test.ts` and `tests/dnd35e_equipment_m115.test.ts` verifying:
  - Codified `'threat_expansion'` non-stacking competition between *Keen* (`item:keen_rapier_plus1/keen`) and *Improved Critical* (`feat:improved_critical:rapier/improved_crit_threat_expansion`), asserting that `critThreatMin` is `15` (`18–20` doubled once) and `critThreatBreakdown.shadowedModifiers` records the shadowed `'threat_expansion'` modifier.
  - Per-strike weapon-scoped *Weapon Focus (longsword)* and *Weapon Specialization (longsword)* applying `+1` attack / `+2` damage to the main-hand longsword strike while NOT bleeding onto an off-hand dagger or secondary natural bite strike.
  - Pure `featRuleOverrides` routing for *Two-Weapon Fighting*, *Multiattack*, *Weapon Finesse*, and *Cleave*.
- Update `docs/ssot/ssot_dnd35e.json`, regenerate `docs/SSOT_DND35E.md` via `bun scripts/map-codebase.ts`, mark Milestone 115.1 complete in `docs/MILESTONES.md`, and run `./verify.sh` across all 8 stages.
