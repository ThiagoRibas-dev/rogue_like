import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent, queryEntities } from '../src/core/ecs.ts';
import { applyCharacterCreationToPlayer, applyLevelUpToActor } from '../src/rulesets/dnd35e/character_builder.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { checkDnD35eRuleset } from '../src/rulesets/dnd35e/dnd35e_validator.ts';
import { computeExpandedCritThreatMin } from '../src/rulesets/dnd35e/equipment_physics.ts';
import { buildFeatEffectModifiers, collectActiveFeatRuleOverrides } from '../src/rulesets/dnd35e/level_ledger.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType } from '../src/types/components.types.ts';
import type { EntityId } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 114: Complete SRD Feat Registry, Combat Chains & Metamagic Trees', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const sys = getDnD35SystemContent(campaign)!;

  test('loads 95+ modular SRD feats and passes validateDnD35SystemContent with 0 errors', () => {
    expect(sys).toBeDefined();
    const featKeys = Object.keys(sys.feats);
    expect(featKeys.length).toBeGreaterThanOrEqual(95);

    const validationErrors = checkDnD35eRuleset(campaign);
    expect(validationErrors).toEqual([]);

    // Core chains exist
    expect(sys.feats['power_attack']).toBeDefined();
    expect(sys.feats['cleave']).toBeDefined();
    expect(sys.feats['great_cleave']).toBeDefined();
    expect(sys.feats['whirlwind_attack']).toBeDefined();
    expect(sys.feats['spring_attack']).toBeDefined();
    expect(sys.feats['weapon_finesse']).toBeDefined();
    expect(sys.feats['weapon_specialization']).toBeDefined();
    expect(sys.feats['greater_weapon_focus']).toBeDefined();
    expect(sys.feats['greater_weapon_specialization']).toBeDefined();
    expect(sys.feats['improved_critical']).toBeDefined();
    expect(sys.feats['two_weapon_defense']).toBeDefined();
    expect(sys.feats['improved_two_weapon_fighting']).toBeDefined();
    expect(sys.feats['greater_two_weapon_fighting']).toBeDefined();
    expect(sys.feats['natural_spell']).toBeDefined();
  });

  test('evaluates passive feat modifiers and stacking repeatable Toughness with feat:<id> provenance', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'LN',
      classId: 'fighter',
      baseAbilityScores: { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: { jump: 4, climb: 4 },
      selectedFeats: ['toughness', 'dodge', 'iron_will'],
      knownSpells: []
    });

    const eval1 = evaluateDnD35eEntityDAG(state, playerId)!;
    // Fighter 1 (10 + 2 CON = 12) + Toughness (+3) = 15 maxHp
    expect(eval1.dagResult.maxHp).toBe(15);
    // Fighter 1 Will save (0 base + 0 WIS + 2 Iron Will) = 2
    expect(eval1.dagResult.saves.will).toBe(2);
    // Dodge grants +1 dodge AC
    expect(
      eval1.dagResult.acResolution.activeModifiers.some((m) => m.bonusType === 'dodge' && m.value === 1)
    ).toBe(true);

    // Advance to Level 3 and take a second stacking Toughness feat
    state = applyLevelUpToActor(state, playerId, {
      classId: 'fighter',
      hpMethod: 'average',
      addedSkillRanks: { jump: 1 },
      selectedFeats: ['improved_initiative'],
      learnedSpells: []
    }).state;
    state = applyLevelUpToActor(state, playerId, {
      classId: 'fighter',
      hpMethod: 'average',
      addedSkillRanks: { jump: 1 },
      selectedFeats: ['toughness'],
      learnedSpells: []
    }).state;

    const dndData = getDnD35EntityData(state, playerId);
    expect(dndData.feats.filter((f) => f === 'toughness').length).toBe(2);

    const toughnessMods = (dndData.statModifiers ?? []).filter(
      (m) => (m.sourcePath ?? '').startsWith('feat:toughness') && m.targetStat === 'max_hp'
    );
    expect(toughnessMods.length).toBe(2);
    expect(toughnessMods[0]?.sourcePath).toBe('feat:toughness#1/mod_0');
    expect(toughnessMods[1]?.sourcePath).toBe('feat:toughness#2/mod_0');

    const initMods = (dndData.statModifiers ?? []).filter(
      (m) => (m.sourcePath ?? '').startsWith('feat:improved_initiative') && m.targetStat === 'initiative'
    );
    expect(initMods[0]?.value).toBe(4);
  });

  test('applies Weapon Finesse to light, finesse-eligible (Rapier/Spiked Chain), and natural weapons while keeping Longsword on STR', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Create high-DEX (+4), low-STR (+0) Fighter with Weapon Finesse
    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'NG',
      classId: 'fighter',
      baseAbilityScores: { str: 10, dex: 18, con: 12, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: ['weapon_finesse', 'dodge', 'two_weapon_fighting'],
      knownSpells: []
    });

    // 1. With Longsword equipped (one-handed, not finesse-eligible): uses STR (+0) + BAB (+1) = +1
    const longswordEval = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(longswordEval.attackRoutine.strikes[0]?.weaponId).toBe('longsword');
    expect(longswordEval.attackRoutine.strikes[0]?.attackBonus).toBe(1);

    // 2. Equip Rapier (one-handed, isFinesseEligible: true): uses DEX (+4) + BAB (+1) = +5 (damage still uses STR +0)
    let rapierEntityId: EntityId;
    [state, rapierEntityId] = createEntity(state);
    state = addComponent(state, rapierEntityId, { type: ComponentType.Item, itemId: 'rapier' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: rapierEntityId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'hand_off' }
      ]
    });

    const rapierEval = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(rapierEval.attackRoutine.strikes[0]?.weaponId).toBe('rapier');
    expect(rapierEval.attackRoutine.strikes[0]?.attackBonus).toBe(5);
    expect(rapierEval.attackRoutine.strikes[0]?.strDamageBonus).toBe(0);
  });

  test('evaluates Two-Weapon Defense (+1/+2 shield AC when dual-wielding) and Improved/Greater TWF extra off-hand attacks', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'CG',
      classId: 'fighter',
      baseAbilityScores: { str: 14, dex: 19, con: 14, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: [
        'two_weapon_fighting',
        'two_weapon_defense',
        'improved_two_weapon_fighting',
        'greater_two_weapon_fighting'
      ],
      knownSpells: []
    });

    const dndData = getDnD35EntityData(state, playerId);
    // Give Fighter 11 levels for BAB +11 and equip two short swords
    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      shieldBonus: 0,
      tracks: [
        {
          trackId: 'fighter',
          levels: 11,
          hitDieSides: 10,
          babCurve: 'full',
          fortCurve: 'good',
          refCurve: 'poor',
          willCurve: 'poor',
          skillPointsPerLevel: 2
        }
      ],
      feats: [
        'two_weapon_fighting',
        'two_weapon_defense',
        'improved_two_weapon_fighting',
        'greater_two_weapon_fighting'
      ],
      statModifiers: buildFeatEffectModifiers(
        [
          'two_weapon_fighting',
          'two_weapon_defense',
          'improved_two_weapon_fighting',
          'greater_two_weapon_fighting'
        ],
        sys.feats,
        [],
        ['wielding:two_weapons']
      )
    });

    let ss1: EntityId;
    let ss2: EntityId;
    [state, ss1] = createEntity(state);
    [state, ss2] = createEntity(state);
    state = addComponent(state, ss1, { type: ComponentType.Item, itemId: 'short_sword' });
    state = addComponent(state, ss2, { type: ComponentType.Item, itemId: 'dagger' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: ss1, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: ss2, limbGroupId: 'hand_off' }
      ]
    });

    const twfEval = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(twfEval.selfTags).toContain('wielding:two_weapons');
    expect(
      twfEval.dagResult.acResolution.activeModifiers.some((m) => m.bonusType === 'shield' && m.value === 1)
    ).toBe(true); // +1 shield bonus from Two-Weapon Defense

    // 3 primary iterative strikes (+11/+6/+1) + 3 off-hand strikes (base + ITWF -5 + GTWF -10) = 6 strikes!
    const primaryStrikes = twfEval.attackRoutine.strikes.filter((s) => s.attackSource === 'manufactured_primary');
    const offhandStrikes = twfEval.attackRoutine.strikes.filter((s) => s.attackSource === 'manufactured_offhand');
    expect(primaryStrikes.length).toBe(3);
    expect(offhandStrikes.length).toBe(3);
  });

  test('verifies structured metamagic descriptors, Natural Spell wild shape tag, and Improved Critical non-stacking', () => {
    expect(sys.feats['empower_spell']?.metamagicDescriptor?.slotLevelAdjustment).toBe(2);
    expect(sys.feats['empower_spell']?.metamagicDescriptor?.empowerDamageMultiplier).toBe(1.5);
    expect(sys.feats['maximize_spell']?.metamagicDescriptor?.slotLevelAdjustment).toBe(3);
    expect(sys.feats['maximize_spell']?.metamagicDescriptor?.maximizeVariableDice).toBe(true);
    expect(sys.feats['quicken_spell']?.metamagicDescriptor?.slotLevelAdjustment).toBe(4);
    expect(sys.feats['quicken_spell']?.metamagicDescriptor?.actionTimeOverride).toBe('swift');
    expect(sys.feats['silent_spell']?.metamagicDescriptor?.suppressVerbalComponent).toBe(true);
    expect(sys.feats['still_spell']?.metamagicDescriptor?.suppressSomaticComponent).toBe(true);

    const natSpellOverrides = collectActiveFeatRuleOverrides(['natural_spell'], sys.feats, [], []);
    expect(natSpellOverrides.some((r) => r.ruleKey === 'allow_casting_in_wild_shape' && r.value === true)).toBe(true);

    // Keen + Improved Critical do not stack (18-20 doubles once to 15-20)
    expect(computeExpandedCritThreatMin(18, true)).toBe(15);
    expect(computeExpandedCritThreatMin(18, false)).toBe(18);
  });
});
