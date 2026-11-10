# Implementation Plan — Milestone 124: Post-M123 Audit Remediation (Weapon Enhancement Scoping, Lateral Spell & Feat StatModifier Parity, Crit Immunity, Blind-Fight & Bane Weapons)

## 1. Overview & Objectives

Based on the post-M123 audit and `./docs/research_notes.md`, this plan resolves all 6 audit findings across Horizon 2, Horizon 3, Combat Resolvers, and System Content JSONs:

1. **Weapon-Scoped Enhancement `effectBundle` Modifiers (`dnd35e_equipped_item_dag.ts`)**: Prevent weapon-specific modifiers (`crit_threat_doubling`, `extra_full_bab_attacks`, `strike_attack`, `strike_damage`) emitted by an off-hand weapon's `enh.effectBundle` or `itemDef.effectBundle` from leaking onto the main-hand weapon by scoping their `condition.effectTagsAny` to `['weapon:${itemDef.id}', ...(itemDef.baseItemId ? ['weapon:${itemDef.baseItemId}'] : [])]`.
2. **Lateral Spell & Subtype JSON Parity (`haste.json`, `battletide.json`, `blur.json`, `displacement.json`, `incorporeal.json`)**: Replace legacy boolean `ruleOverrides` (`extra_full_attack_haste`, `concealment_20_percent`, `concealment_50_percent`, `corporeal_magic_miss_chance_pct`) and `"save_ref"` target strings with canonical `StatModifier` entries (`extra_full_bab_attacks` with `type: 'haste'`, `miss_chance`, and `ref`).
3. **SRD Crit Immunity, `Blind-Fight`, and Feat Rule-Key Alignment (`dnd35e_combat_adapter.ts`, `ledger_modifiers.ts`, `dnd35e_dag_adapter.ts`, feat JSONs)**:
   - Expand `targetImmuneToCrits` in `resolveDnD35eMeleeAttack` to check `defenderData.immunities.includes('critical_hits')` and Elemental/Ooze/Plant/Swarm/Incorporeal tags (unless negated by *Ghost Touch*).
   - Expose `hasBlindFight` on `ResolvedActiveCombatRules` and `DnD35EntityDAGResult`, and wire it into `resolveAttackRoll` inside `resolveDnD35eMeleeAttack`.
   - Align `buildCombatRuleOverridesFromActiveRules` (`ledger_modifiers.ts`) with `cleave.json`, `great_cleave.json`, `multiattack.json`, `two_weapon_fighting.json`, and `multiweapon_fighting.json`, and remove all hardcoded `dndData.feats?.includes(...)` fallbacks from `dnd35e_dag_adapter.ts` (`AGENTS.md` Rule 17).
4. **Legacy `getEquippedItemBonuses` Split-Brain Cleanup (`srd_registry.ts`)**: Resolve equipped items via `resolveEffectiveItemDefinition` and take the primary/highest weapon attack bonus instead of summing across dual-wielded weapons.
5. **Feat Numeric `ruleOverrides` -> `StatModifier` Migration (`feats/*.json` & `effect_bundle.ts`)**: Migrate numeric bonuses in `spell_focus`, `greater_spell_focus`, `spell_penetration`, `greater_spell_penetration`, `improved_turning`, `extra_turning`, `ability_focus`, `ability_focus_poison`, and the 5 combat maneuver feats (`improved_trip`, `improved_bull_rush`, `improved_disarm`, `improved_overrun`, `improved_sunder`) from `ruleOverrides` to `modifiers`.
6. **`baneCreatureType` Weapon Enhancement Resolution (`item_enhancements.json`, `weapon_profile_parser.ts`, `dnd35e_equipped_item_dag.ts`)**: Add `"bane"` to `item_enhancements.json` and emit `+2` attack/damage and `+2d6` on-hit damage gated on `targetTagsAny: ['type:<baneCreatureType>', 'subtype:<baneCreatureType>']`.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner | Legacy / Split-Brain Evicted |
| :--- | :--- | :--- |
| **Weapon Enhancement Modifier Scoping** | `collectEquippedItemDAGContributions` (`src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`) | Unscoped `enh.effectBundle` weapon modifiers leaking across hands |
| **Spell Haste & Concealment Modifiers** | `StatModifier` (`target: 'extra_full_bab_attacks' | 'miss_chance' | 'ref'`) in `spells/*.json` | Legacy `ruleKey: 'extra_full_attack_haste' | 'concealment_20_percent' | 'concealment_50_percent'` and `target: 'save_ref'` |
| **Combat Rule Overrides & `Blind-Fight`** | `buildCombatRuleOverridesFromActiveRules` (`src/rulesets/dnd35e/progression/ledger_modifiers.ts`) | Hardcoded `dndData.feats?.includes(...)` fallbacks in `dnd35e_dag_adapter.ts` |
| **Feat Numeric Bonuses (`+1`/`+2`/`+4`)** | `modifiers: ReadonlyArray<DnD35DeclarativeModifier>` in `public/data/rulesets/dnd35e/feats/*.json` | Numeric `ruleOverrides` (`*_check_bonus: 4`, `spell_save_dc_bonus: 1`, `caster_level_check_vs_sr_bonus: 2`, etc.) |
| **Bane Weapon Enhancement (`+2` / `+2d6`)** | `parseEquippedItem` (`weapon_profile_parser.ts`) & `collectEquippedItemDAGContributions` (`dnd35e_equipped_item_dag.ts`) | Unwired `baneCreatureType` schema field |

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

---

## 4. Step-by-Step Implementation & Code Snippets

### Step 1: Weapon-Scoped Enhancement Modifiers & `baneCreatureType` in `src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`

Add a helper `scopeWeaponModifiers` inside `src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts` so any weapon-intrinsic modifier (`crit_threat_doubling`, `extra_full_bab_attacks`, `strike_attack`, `strike_damage`) emitted by a weapon's `effectBundle` or attached `enh.effectBundle` is scoped to `weaponTags` (`['weapon:${itemDef.id}', ...(itemDef.baseItemId ? ['weapon:${itemDef.baseItemId}'] : [])]`), and emit conditional `+2` `strike_attack` and `strike_damage` modifiers when `itemDef.magicalProperties?.baneCreatureType` is present:

```typescript
const WEAPON_SCOPED_TARGET_STATS: ReadonlySet<string> = new Set([
  'crit_threat_doubling',
  'extra_full_bab_attacks',
  'strike_attack',
  'strike_damage'
]);

const BANE_ENHANCEMENT_BONUS_DELTA = 2;

function scopeWeaponModifiers(
  mods: ReadonlyArray<StatModifier>,
  weaponTags: ReadonlyArray<string>
): ReadonlyArray<StatModifier> {
  if (weaponTags.length === 0) return mods;
  return mods.map((mod) => {
    if (!WEAPON_SCOPED_TARGET_STATS.has(mod.targetStat)) return mod;
    const existingAny = mod.condition?.effectTagsAny ?? [];
    const mergedAny = Array.from(new Set([...existingAny, ...weaponTags]));
    return {
      ...mod,
      condition: {
        ...(mod.condition ?? {}),
        effectTagsAny: mergedAny
      }
    };
  });
}
```

And inside `collectEquippedItemDAGContributions` for `itemDef.category === 'weapon'`:
```typescript
    const weaponTags =
      itemDef.category === 'weapon'
        ? Array.from(new Set([`weapon:${itemDef.id}`, ...(itemDef.baseItemId ? [`weapon:${itemDef.baseItemId}`] : [])]))
        : [];

    if (itemDef.category === 'weapon' && (itemDef.magicalProperties?.keen === true || itemTags.includes('keen'))) {
      modifiers.push({
        targetStat: 'crit_threat_doubling',
        value: 1,
        bonusType: 'threat_expansion',
        sourceId: `${itemRoot}:keen`,
        sourcePath: `${itemRoot}/keen`,
        origin: 'magical',
        condition: { effectTagsAny: weaponTags }
      });
    }

    const baneType = itemDef.magicalProperties?.baneCreatureType;
    if (itemDef.category === 'weapon' && baneType) {
      const baneTargetTags = [`type:${baneType}`, `subtype:${baneType}`];
      modifiers.push(
        {
          targetStat: 'strike_attack',
          value: BANE_ENHANCEMENT_BONUS_DELTA,
          bonusType: 'untyped',
          sourceId: `${itemRoot}:bane_atk`,
          sourcePath: `${itemRoot}/enh:bane/attack`,
          origin: 'magical',
          condition: {
            targetTagsAny: baneTargetTags,
            effectTagsAny: weaponTags
          }
        },
        {
          targetStat: 'strike_damage',
          value: BANE_ENHANCEMENT_BONUS_DELTA,
          bonusType: 'untyped',
          sourceId: `${itemRoot}:bane_dmg`,
          sourcePath: `${itemRoot}/enh:bane/damage`,
          origin: 'magical',
          condition: {
            targetTagsAny: baneTargetTags,
            effectTagsAny: weaponTags
          }
        }
      );
    }

    if (itemDef.effectBundle) {
      const evalRes = evaluateEffectBundle(itemDef.effectBundle, itemRoot, suppressedBundleIds, activeSelfTags);
      modifiers.push(...scopeWeaponModifiers(evalRes.statModifiers, weaponTags));
      grantedTags.push(...evalRes.grantedTags);
    }

    const sysEnhancements =
      (state.campaign.systemContent?.['itemEnhancements'] as Record<string, DnD35ItemEnhancement> | undefined) ?? {};
    const enhancementsList = Array.from(
      new Set([...(itemDef.enhancements ?? []), ...(itemDef.magicalProperties?.enhancements ?? [])])
    );
    for (const enhId of enhancementsList) {
      const enh = sysEnhancements[enhId];
      if (enh?.effectBundle) {
        const enhRoot = `${itemRoot}/enh:${enhId}`;
        const evalRes = evaluateEffectBundle(enh.effectBundle, enhRoot, suppressedBundleIds, activeSelfTags);
        modifiers.push(...scopeWeaponModifiers(evalRes.statModifiers, weaponTags));
        grantedTags.push(...evalRes.grantedTags);
      }
    }
```

---

### Step 2: `baneCreatureType` Damage Rider in `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` & `public/data/rulesets/dnd35e/item_enhancements.json`

1. In `public/data/rulesets/dnd35e/item_enhancements.json`, add `"bane"`:
```json
  "bane": {
    "id": "bane",
    "name": "Bane",
    "description": "A bane weapon excels at attacking one type or subtype of creature. Against its designated foe, its effective enhancement bonus is +2 higher than normal and it deals an extra 2d6 points of damage.",
    "appliesTo": ["melee_weapon", "ranged_weapon", "thrown_weapon"],
    "bonusEquivalent": 1
  },
```
2. In `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts` (`parseEquippedItem`), emit the conditional `2d6` `on_hit` damage rider when `magicalProps?.baneCreatureType` is set:
```typescript
  const baneType = magicalProps?.baneCreatureType;
  if (baneType) {
    damageRiders.push({
      id: `bane_${baneType}_hit`,
      trigger: 'on_hit',
      dice: '2d6',
      damageType: 'untyped',
      condition: {
        targetTagsAny: [`type:${baneType}`, `subtype:${baneType}`]
      }
    });
  }
```

---

### Step 3: Lateral Spell & Subtype JSON Parity (`haste.json`, `battletide.json`, `blur.json`, `displacement.json`, `incorporeal.json`)

1. **`public/data/rulesets/dnd35e/spells/haste.json`**:
   - Change `"target": "save_ref"` to `"target": "ref"`.
   - Move `haste_extra_attack` from `ruleOverrides` into `modifiers`:
     ```json
     {
       "id": "haste_extra_attack",
       "target": "extra_full_bab_attacks",
       "value": 1,
       "type": "haste"
     }
     ```
   - Set `"ruleOverrides": []`.
2. **`public/data/rulesets/dnd35e/spells/battletide.json`**:
   - Change `"target": "save_ref"` to `"target": "ref"`.
   - Move `battletide_extra_attack` from `ruleOverrides` into `modifiers`:
     ```json
     {
       "id": "battletide_extra_attack",
       "target": "extra_full_bab_attacks",
       "value": 1,
       "type": "haste"
     }
     ```
   - Set `"ruleOverrides": []`.
3. **`public/data/rulesets/dnd35e/spells/blur.json`**:
   - Move `blur_concealment` from `ruleOverrides` into `modifiers`:
     ```json
     {
       "id": "blur_concealment",
       "target": "miss_chance",
       "value": 20,
       "type": "enhancement"
     }
     ```
   - Set `"ruleOverrides": []`.
4. **`public/data/rulesets/dnd35e/spells/displacement.json`**:
   - Move `displacement_concealment` from `ruleOverrides` into `modifiers`:
     ```json
     {
       "id": "displacement_concealment",
       "target": "miss_chance",
       "value": 50,
       "type": "enhancement"
     }
     ```
   - Set `"ruleOverrides": []`.
5. **`public/data/rulesets/dnd35e/subtypes/incorporeal.json`**:
   - Add `{ "id": "incorporeal_miss_chance", "target": "miss_chance", "value": 50, "type": "base", "condition": { "effectTagsNone": ["ghost_touch", "force"] } }` to `modifiers` and `traitBundles[0].modifiers`, and remove `incorporeal_corporeal_miss_chance` from `ruleOverrides`.

---

### Step 4: SRD Crit Immunity, `Blind-Fight`, and Feat Rule-Key Alignment (`ledger_modifiers.ts`, `dnd35e_dag_adapter.ts`, `dnd35e_combat_adapter.ts`)

1. **`src/rulesets/dnd35e/progression/ledger_modifiers.ts`**:
   - Add `readonly hasBlindFight: boolean;` to `ResolvedActiveCombatRules`.
   - In `buildCombatRuleOverridesFromActiveRules`:
     - Support canonical rule keys from feat JSONs:
       - `hasBlindFight = ruleOverrides.some((r) => r.ruleKey === 'reroll_concealment_miss_chance' && r.value === true)`
       - `hasCleave = ruleOverrides.some((r) => (r.ruleKey === 'cleave_followup_on_drop' || r.ruleKey === 'cleave_extra_attack_on_drop') && r.value === true)`
       - `hasGreatCleave = ruleOverrides.some((r) => (r.ruleKey === 'great_cleave_unlimited_on_drop' || r.ruleKey === 'great_cleave_unlimited') && r.value === true)`
       - Recognize `r.ruleKey === 'secondary_natural_penalty' || r.ruleKey === 'secondary_natural_attack_penalty'`
       - Recognize `r.ruleKey === 'twf_penalty_reduction' && r.value === true` (setting `baseTwfPrimary = -4` and `baseTwfOffHand = -4` when not already set).
2. **`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`**:
   - Add `readonly hasBlindFight: boolean;` to `DnD35EntityDAGResult`.
   - Remove hardcoded `|| dndData.feats?.includes(...)` fallbacks on lines 202, 207–211, 224–225 (`activeCombatRules` now resolves them purely from `featRuleOverrides`).
3. **`src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts`**:
   - Compute `targetImmuneToCrits`:
     ```typescript
     const isIncorporealWithoutGhostTouch =
       defenderSelfTags.includes('subtype:incorporeal') &&
       !bypassTags.includes('ghost_touch') &&
       !bypassTags.includes('bypass:incorporeal');
     const targetImmuneToCrits =
       defenderData.abilityScores.con.base === null ||
       defenderData.immunities.includes('critical_hits') ||
       defenderSelfTags.includes('type:elemental') ||
       defenderSelfTags.includes('type:ooze') ||
       defenderSelfTags.includes('type:plant') ||
       defenderSelfTags.includes('subtype:swarm') ||
       isIncorporealWithoutGhostTouch;
     ```
   - Pass `hasBlindFight: attackerEval.hasBlindFight` to `resolveAttackRoll`.

---

### Step 5: Legacy `getEquippedItemBonuses` Cleanup (`src/rulesets/dnd35e/srd_registry.ts`)

Update `getEquippedItemBonuses` in `src/rulesets/dnd35e/srd_registry.ts` to use `resolveEffectiveItemDefinition` and take the highest weapon attack bonus (rather than summing across multiple weapons), while only counting `equippable.defenseBonus` for items without structured `armorStats`:

```typescript
export function getEquippedItemBonuses(
  state: GameState,
  entityId: EntityId
): { readonly equipAttackBonus: number; readonly equipArmorBonus: number } {
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!equipment) {
    return { equipAttackBonus: 0, equipArmorBonus: 0 };
  }

  let equipAttackBonus = 0;
  let equipArmorBonus = 0;
  for (const slot of equipment.slots) {
    if (slot.equippedItem === null || slot.suppressed === true) continue;
    const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
    const rawItemDef = itemComp ? (state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined) : undefined;
    if (!rawItemDef) continue;
    const itemDef = resolveEffectiveItemDefinition(rawItemDef, state.campaign.items, itemComp);
    if (itemDef.category === 'weapon') {
      const enhBonus = itemDef.magicalProperties?.enhancementBonus ?? 0;
      const mwBonus = itemDef.magicalProperties?.isMasterwork === true && enhBonus === 0 ? 1 : 0;
      const wpnAtk = Math.max(itemDef.equippable?.attackBonus ?? 0, enhBonus, mwBonus);
      if (slot.slotType === 'main_hand' || slot.id.startsWith('main_hand') || equipAttackBonus === 0) {
        equipAttackBonus = Math.max(equipAttackBonus, wpnAtk);
      }
    } else if (itemDef.equippable && !itemDef.armorStats) {
      equipAttackBonus += itemDef.equippable.attackBonus ?? 0;
      equipArmorBonus += itemDef.equippable.defenseBonus ?? 0;
    }
  }
  return { equipAttackBonus, equipArmorBonus };
}
```

---

### Step 6: Migrate Numeric `ruleOverrides` in `public/data/rulesets/dnd35e/feats/*.json` to `modifiers` & Bind `ability` Target in `src/rulesets/dnd35e/effect_bundle.ts`

1. In `src/rulesets/dnd35e/effect_bundle.ts` (`resolveFeatEffectBundle`):
   - Add `isAbilityTargeted = targetCategory === 'ability' || featDef.id.startsWith('ability_focus')` support so `mod.target === 'special_ability_save_dc'` binds `condition: { effectTagsAll: ['ability:${targetId}'] }`.
   - Remove the legacy `rule.ruleKey === 'spell_save_dc_bonus'` bridge once `spell_focus.json` and `greater_spell_focus.json` use `modifiers` directly.
2. Update the 13 feat JSONs in `public/data/rulesets/dnd35e/feats/` so numeric bonuses live in `modifiers`:
   - `spell_focus.json`: `"modifiers": [{ "id": "spell_save_dc_bonus", "target": "spell_save_dc", "value": 1, "type": "untyped" }]`
   - `greater_spell_focus.json`: `"modifiers": [{ "id": "greater_spell_save_dc_bonus", "target": "spell_save_dc", "value": 1, "type": "untyped" }]`
   - `spell_penetration.json`: `"modifiers": [{ "id": "caster_level_check_vs_sr_bonus", "target": "caster_level_check_vs_sr", "value": 2, "type": "untyped" }]`
   - `greater_spell_penetration.json`: `"modifiers": [{ "id": "greater_caster_level_check_vs_sr_bonus", "target": "caster_level_check_vs_sr", "value": 2, "type": "untyped" }]`
   - `improved_turning.json`: `"modifiers": [{ "id": "effective_turning_level_bonus", "target": "effective_turning_level", "value": 1, "type": "untyped" }]`
   - `extra_turning.json`: `"modifiers": [{ "id": "extra_turn_attempts_per_day", "target": "turn_attempts_per_day", "value": 4, "type": "untyped" }]`
   - `ability_focus.json`: `"modifiers": [{ "id": "special_ability_save_dc_bonus", "target": "special_ability_save_dc", "value": 2, "type": "untyped" }]`
   - `ability_focus_poison.json`: `"modifiers": [{ "id": "poison_save_dc_bonus", "target": "special_ability_save_dc", "value": 2, "type": "untyped", "condition": { "effectTagsAll": ["ability:poison"] } }]`
   - `improved_trip.json`: move `trip_check_bonus` (`4`) to `"modifiers": [{ "id": "trip_check_bonus", "target": "trip", "value": 4, "type": "untyped" }]`, keeping `trip_no_aoo` and `trip_followup_melee_attack` in `ruleOverrides`.
   - `improved_bull_rush.json`: move `bull_rush_check_bonus` (`4`) to `"modifiers": [{ "id": "bull_rush_check_bonus", "target": "bull_rush", "value": 4, "type": "untyped" }]`, keeping `bull_rush_no_aoo` in `ruleOverrides`.
   - `improved_disarm.json`: move `disarm_check_bonus` (`4`) to `"modifiers": [{ "id": "disarm_check_bonus", "target": "disarm", "value": 4, "type": "untyped" }]`, keeping `disarm_no_aoo` and `disarm_no_counter` in `ruleOverrides`.
   - `improved_overrun.json`: move `overrun_check_bonus` (`4`) to `"modifiers": [{ "id": "overrun_check_bonus", "target": "overrun", "value": 4, "type": "untyped" }]`, keeping `overrun_target_cannot_avoid` in `ruleOverrides`.
   - `improved_sunder.json`: move `sunder_check_bonus` (`4`) to `"modifiers": [{ "id": "sunder_check_bonus", "target": "sunder", "value": 4, "type": "untyped" }]`, keeping `sunder_no_aoo` in `ruleOverrides`.

---

### Step 7: Unit Tests & Verification (`tests/dnd35e_equipment_m115.test.ts` & `./verify.sh`)

Add unit tests in `tests/dnd35e_equipment_m115.test.ts` verifying:
1. Off-hand weapon enhancement scoping (an off-hand *Keen* or *Speed* weapon does not leak `crit_threat_doubling` or `extra_full_bab_attacks` onto a mundane main-hand weapon).
2. *Bane (Undead)* weapon granting `+2` attack, `+2` damage, and `+2d6` on-hit damage against `type:undead` foes while granting `0` extra bonus against `type:humanoid` foes.
3. Spell `haste`, `blur`, and `displacement` effect bundles resolving `extra_full_bab_attacks`, `ref` dodge save, and `concealmentMissChancePercent` via the DAG, plus `Blind-Fight` reroll and Elemental/Ooze/Plant `critical_hits` immunity.
4. Parameterized `spell_focus:evocation` and `ability_focus:poison` emitting `StatModifier`s with `effectTagsAll: ['school:evocation']` and `effectTagsAll: ['ability:poison']`.
5. Run `./verify.sh` across all 8 verification stages and update `docs/MILESTONES.md`.
