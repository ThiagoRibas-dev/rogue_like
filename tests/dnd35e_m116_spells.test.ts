import { describe, expect, test } from 'bun:test';
import { getSpellLevelForClass } from '../src/rulesets/dnd35e/builder/builder_spells.ts';
import {
  evaluateSpellEffectUnitsForTarget,
  evaluateSpellScalingRule,
  materializeSpellUnitModifiers,
  materializeTopLevelSpellModifiers,
  projectActiveSpellTetherTags,
  projectSpellEffectTags
} from '../src/rulesets/dnd35e/magic/spellcasting.ts';
import {
  evaluateDnD35ActorStatDAG,
  revokeModifiersByPathPrefix
} from '../src/rulesets/dnd35e/modifiers.ts';
import { SPELL_IDS } from '../src/rulesets/dnd35e/system_content_spell_ids.ts';
import {
  DnD35SpellDefinitionSchema,
  getDnD35SystemContent
} from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 116: Tag-Driven Modular Spell Architecture & 0th-3rd Level SRD Grimoire', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const sys = getDnD35SystemContent(campaign)!;

  test('loads and validates all 98 modular spells in SPELL_IDS', () => {
    expect(sys).not.toBeNull();
    expect(SPELL_IDS.length).toBeGreaterThanOrEqual(98);

    for (const id of SPELL_IDS) {
      const spell = sys.spells[id];
      expect(spell).toBeDefined();
      expect(spell?.id).toBe(id);
    }
  });

  test('projectSpellEffectTags projects school, subschool, descriptors, components, and respects Silent/Still metamagic', () => {
    const fireball = sys.spells['fireball']!;
    const baseTags = projectSpellEffectTags(fireball);
    expect(baseTags).toContain('school:evocation');
    expect(baseTags).toContain('descriptor:fire');
    expect(baseTags).toContain('component:verbal');
    expect(baseTags).toContain('component:somatic');
    expect(baseTags).toContain('component:material');

    const silentStillTags = projectSpellEffectTags(fireball, { silent: true, still: true });
    expect(silentStillTags).not.toContain('component:verbal');
    expect(silentStillTags).not.toContain('component:somatic');
    expect(silentStillTags).toContain('component:material');
  });

  test('evaluateSpellScalingRule and materializeSpellUnitModifiers scale Barkskin, Shield of Faith, and Divine Favor accurately', () => {
    const barkskin = sys.spells['barkskin']!;
    const barkUnit = barkskin.effectUnits[0]!;
    expect(materializeSpellUnitModifiers(barkskin, barkUnit, 3, 'c1')[0]?.value).toBe(2);
    expect(materializeSpellUnitModifiers(barkskin, barkUnit, 6, 'c1')[0]?.value).toBe(3);
    expect(materializeSpellUnitModifiers(barkskin, barkUnit, 9, 'c1')[0]?.value).toBe(4);
    expect(materializeSpellUnitModifiers(barkskin, barkUnit, 12, 'c1')[0]?.value).toBe(5);
    expect(materializeSpellUnitModifiers(barkskin, barkUnit, 18, 'c1')[0]?.value).toBe(5);

    const sof = sys.spells['shield_of_faith']!;
    const sofUnit = sof.effectUnits[0]!;
    expect(materializeSpellUnitModifiers(sof, sofUnit, 1, 'c2')[0]?.value).toBe(2);
    expect(materializeSpellUnitModifiers(sof, sofUnit, 6, 'c2')[0]?.value).toBe(3);
    expect(materializeSpellUnitModifiers(sof, sofUnit, 12, 'c2')[0]?.value).toBe(4);
    expect(materializeSpellUnitModifiers(sof, sofUnit, 18, 'c2')[0]?.value).toBe(5);

    const df = sys.spells['divine_favor']!;
    const dfUnit = df.effectUnits[0]!;
    expect(materializeSpellUnitModifiers(df, dfUnit, 1, 'c3')[0]?.value).toBe(1);
    expect(materializeSpellUnitModifiers(df, dfUnit, 6, 'c3')[0]?.value).toBe(2);
    expect(materializeSpellUnitModifiers(df, dfUnit, 9, 'c3')[0]?.value).toBe(3);
    expect(materializeSpellUnitModifiers(df, dfUnit, 15, 'c3')[0]?.value).toBe(3);
  });

  test('Mage Armor and Shield emit [Force] armor/shield modifiers that apply against incorporeal touch attacks in the 4-Stage Stat DAG', () => {
    const mageArmor = sys.spells['mage_armor']!;
    const shield = sys.spells['shield']!;

    const maMods = materializeTopLevelSpellModifiers(mageArmor, 'cast_ma');
    const shMods = materializeTopLevelSpellModifiers(shield, 'cast_sh');

    const rawAbilities = {
      str: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      dex: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      con: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      int: { base: 16, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      wis: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      cha: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
    };

    const dagNormalTouch = evaluateDnD35ActorStatDAG({
      baseSize: 'medium',
      rawAbilities,
      tracks: [],
      baseSpeed: 30,
      statModifiers: [...maMods, ...shMods]
    });

    // Full AC: 10 + 2 (Dex) + 4 (Mage Armor) + 4 (Shield) = 20
    expect(dagNormalTouch.acBreakdown.fullAC).toBe(20);
    // Normal Touch AC ignores armor and shield: 10 + 2 (Dex) = 12
    expect(dagNormalTouch.acBreakdown.touchAC).toBe(12);

    const dagIncorporealTouch = evaluateDnD35ActorStatDAG({
      baseSize: 'medium',
      rawAbilities,
      tracks: [],
      baseSpeed: 30,
      statModifiers: [...maMods, ...shMods],
      context: { againstIncorporealTouch: true }
    });

    // Against Incorporeal Touch, [Force] armor and shield bonuses apply to Touch AC! (10 + 2 + 4 + 4 = 20)
    expect(dagIncorporealTouch.acBreakdown.touchAC).toBe(20);
  });

  test('Enlarge Person emits Stage 1 size_step +1 modifier and cascades into Stage 3/4 stats', () => {
    const enlarge = sys.spells['enlarge_person']!;
    const unit = enlarge.effectUnits[0]!;
    const enlargeMods = materializeSpellUnitModifiers(enlarge, unit, 3, 'cast_enl');

    const dag = evaluateDnD35ActorStatDAG({
      baseSize: 'medium',
      rawAbilities: {
        str: { base: 16, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        dex: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        con: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        int: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        wis: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        cha: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
      },
      tracks: [],
      baseSpeed: 30,
      statModifiers: enlargeMods
    });

    expect(dag.effectiveSize).toBe('large');
    expect(dag.effectiveAbilities.str.base).toBe(18);
    expect(dag.effectiveAbilities.dex.base).toBe(12);
    // AC: 10 + 1 (Dex 12) - 1 (Large size) = 10
    expect(dag.acBreakdown.fullAC).toBe(10);
  });

  test('Searing Light filters its 3 damage units declaratively via targetTags without hardcoded Undead checks', () => {
    const searing = sys.spells['searing_light']!;

    const livingUnits = evaluateSpellEffectUnitsForTarget(searing, {
      targetTags: ['type:humanoid']
    });
    expect(livingUnits.map((u) => u.unitId)).toEqual(['searing_living_damage']);

    const undeadUnits = evaluateSpellEffectUnitsForTarget(searing, {
      targetTags: ['type:undead']
    });
    expect(undeadUnits.map((u) => u.unitId)).toEqual(['searing_undead_damage']);

    const vampireUnits = evaluateSpellEffectUnitsForTarget(searing, {
      targetTags: ['type:undead', 'vulnerability:light']
    });
    expect(vampireUnits.map((u) => u.unitId)).toEqual(['searing_vulnerable_undead_damage']);
  });

  test('Battletide supports feat-gated access, enemy debuff tether projection, Quicken CL scaling, and automatic dispel revocation', () => {
    const battletide = sys.spells['battletide']!;

    // 1. Access via feat:initiate_of_bane tag
    expect(getSpellLevelForClass(battletide, 'paladin', [], [])).toBeNull();
    expect(getSpellLevelForClass(battletide, 'paladin', [], ['feat:initiate_of_bane'])).toBe(5);

    // 2. Enemy debuff materialization & tether tag projection
    const enemyUnit = battletide.effectUnits.find((u) => u.unitId === 'enemy_energy_steal')!;
    const casterBuffUnit = battletide.effectUnits.find((u) => u.unitId === 'caster_battletide_buff')!;
    const casterQuickenUnit = battletide.effectUnits.find((u) => u.unitId === 'caster_battletide_quicken')!;

    const enemyMods = materializeSpellUnitModifiers(battletide, enemyUnit, 13, 'cast_bt1');
    expect(enemyMods.length).toBe(3);

    // While at least 1 enemy has enemyMods active, caster receives 'tether:battletide:enemy_affected'
    const activeTetherTags = projectActiveSpellTetherTags(battletide, 'cast_bt1', enemyMods);
    expect(activeTetherTags).toEqual(['tether:battletide:enemy_affected']);

    // Caster's buff & quicken units activate when casterSelfTags includes the tether tag
    const activeCasterUnits = evaluateSpellEffectUnitsForTarget(battletide, {
      casterSelfTags: activeTetherTags
    }).filter((u) => u.targetRole === 'caster');
    expect(activeCasterUnits.map((u) => u.unitId)).toEqual([
      'caster_battletide_buff',
      'caster_battletide_quicken'
    ]);

    // 3. Quicken spell level cap scales from Lv 1 at CL 9 to Lv 5 at CL 17
    if (casterQuickenUnit.type === 'quicken_cast_grant') {
      expect(evaluateSpellScalingRule(casterQuickenUnit.maxSpellLevelScaling, 9)).toBe(1);
      expect(evaluateSpellScalingRule(casterQuickenUnit.maxSpellLevelScaling, 11)).toBe(2);
      expect(evaluateSpellScalingRule(casterQuickenUnit.maxSpellLevelScaling, 13)).toBe(3);
      expect(evaluateSpellScalingRule(casterQuickenUnit.maxSpellLevelScaling, 15)).toBe(4);
      expect(evaluateSpellScalingRule(casterQuickenUnit.maxSpellLevelScaling, 17)).toBe(5);
      expect(evaluateSpellScalingRule(casterQuickenUnit.maxSpellLevelScaling, 20)).toBe(5);
    }

    // 4. If all enemies are dispelled (revokeModifiersByPathPrefix), tether tag vanishes and caster buff deactivates!
    const afterDispelMods = revokeModifiersByPathPrefix(enemyMods, 'spell:battletide:cast_bt1');
    expect(afterDispelMods.length).toBe(0);

    const postDispelTetherTags = projectActiveSpellTetherTags(battletide, 'cast_bt1', afterDispelMods);
    expect(postDispelTetherTags).toEqual([]);

    const remainingCasterUnits = evaluateSpellEffectUnitsForTarget(battletide, {
      casterSelfTags: postDispelTetherTags
    }).filter((u) => u.targetRole === 'caster');
    expect(remainingCasterUnits).toEqual([]);

    // Confirm casterBuffUnit modifiers also materialize cleanly
    const casterMods = materializeSpellUnitModifiers(battletide, casterBuffUnit, 13, 'cast_bt1');
    expect(casterMods.some((m) => m.targetStat === 'speed' && m.value === 30)).toBe(true);
  });

  test('validates exotic Sacrifice / Sanctified spells like Restore Souls Treasure via DnD35SpellDefinitionSchema', () => {
    const restoreSoulsTreasure = DnD35SpellDefinitionSchema.parse({
      id: 'restore_souls_treasure',
      name: "Restore Soul's Treasure",
      description: "Restores a valuable item destroyed by Soul's Treasure Lost within 4 hours.",
      level: 8,
      levelByAccessTag: { 'special:sanctified': 8, 'alignment:LG': 8, 'alignment:NG': 8, 'alignment:CG': 8 },
      school: 'transmutation',
      castingTime: '1_round',
      range: 'close',
      duration: 'instantaneous',
      components: {
        verbal: false,
        somatic: false,
        material: false,
        sacrifice: true,
        casterCosts: [
          {
            costType: 'ability_sacrifice',
            ability: 'con',
            harmKind: 'drain',
            diceFormula: '1d4',
            timing: 'on_cast',
            description: '1d4 points of Constitution drain'
          }
        ]
      },
      allowsSpellResistance: false
    });

    expect(restoreSoulsTreasure.components.sacrifice).toBe(true);
    expect(restoreSoulsTreasure.components.casterCosts[0]?.costType).toBe('ability_sacrifice');
    expect(projectSpellEffectTags(restoreSoulsTreasure)).toContain('component:sacrifice');
    expect(getSpellLevelForClass(restoreSoulsTreasure, 'cleric', [], ['special:sanctified'])).toBe(8);
  });
});
