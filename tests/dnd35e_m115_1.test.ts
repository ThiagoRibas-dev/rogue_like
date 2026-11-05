import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, queryEntities } from '../src/core/ecs.ts';
import { applyCharacterCreationToPlayer } from '../src/rulesets/dnd35e/character_builder.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { checkDnD35eRuleset } from '../src/rulesets/dnd35e/dnd35e_validator.ts';
import { resolveEquippedWeaponProfile } from '../src/rulesets/dnd35e/equipment_physics.ts';
import { buildCombatRuleOverridesFromActiveRules } from '../src/rulesets/dnd35e/progression/ledger_modifiers.ts';
import { extractActorTacticalDials } from '../src/rulesets/dnd35e/combat/tactical_doctrine.ts';
import { resolveSkillCheck } from '../src/rulesets/dnd35e/skills.ts';
import { getSpellLevelForClass } from '../src/rulesets/dnd35e/builder/builder_spells.ts';
import type { DnD35SpellDefinition } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { DnD35BonusTypeSchema } from '../src/rulesets/dnd35e/types/system/effect_system.types.ts';
import { ComponentType } from '../src/types/components.types.ts';
import type { EntityId } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 115.1: Declarative Rule-Override Routing, Codified Threat Expansion, Per-Strike Modifiers & Data-Driven Cleanups', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const sys = getDnD35SystemContent(campaign)!;

  test('validates ruleset and system content cleanly with threat_expansion bonus type in schema', () => {
    expect(sys).toBeDefined();
    expect(checkDnD35eRuleset(campaign)).toEqual([]);
    expect(DnD35BonusTypeSchema.safeParse('threat_expansion').success).toBe(true);
  });

  test('enforces threat_expansion non-stacking between Keen weapon and Improved Critical feat', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Player with Improved Critical (Longsword)
    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'TN',
      classId: 'fighter',
      baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: ['improved_critical', 'power_attack'],
      knownSpells: []
    });

    // 1. Standard longsword (19-20 base, span 2). With Improved Critical (threat_expansion: +1 step), expanded to 17-20.
    let normalLongswordId: EntityId;
    [state, normalLongswordId] = createEntity(state);
    state = addComponent(state, normalLongswordId, { type: ComponentType.Item, itemId: 'longsword' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: normalLongswordId, limbGroupId: 'hand_main' }
      ]
    });

    let profile = resolveEquippedWeaponProfile(state, playerId, 'main_hand');
    expect(profile).toBeDefined();
    expect(profile.critThreatMin).toBe(17); // 19 doubled to 17-20
    expect(profile.critMultiplier).toBe(2);

    // 2. Keen longsword on character WITH Improved Critical
    let keenLongswordId: EntityId;
    [state, keenLongswordId] = createEntity(state);
    state = addComponent(state, keenLongswordId, {
      type: ComponentType.Item,
      itemId: 'longsword',
      tags: ['keen']
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: keenLongswordId, limbGroupId: 'hand_main' }
      ]
    });

    profile = resolveEquippedWeaponProfile(state, playerId, 'main_hand');
    expect(profile).toBeDefined();
    // In D&D 3.5e rules, Keen and Improved Critical do NOT stack (both are threat_expansion bonus type)
    // Threat min must be 17 (span 4), NEVER 15 (span 6 or 8)
    expect(profile.critThreatMin).toBe(17);

    // Inspect breakdown to confirm one modifier applied and one shadowed
    expect(profile.critThreatBreakdown).toBeDefined();
    expect(profile.critThreatBreakdown!.total).toBe(1);
    expect(profile.critThreatBreakdown!.shadowedModifiers.length).toBeGreaterThanOrEqual(1);
    expect(profile.critThreatBreakdown!.shadowedModifiers.some((s) => s.modifier.bonusType === 'threat_expansion')).toBe(true);
  });

  test('applies per-strike weapon-scoped attack and damage modifiers declaratively', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'TN',
      classId: 'fighter',
      baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: ['weapon_focus_longsword', 'weapon_specialization_longsword'],
      knownSpells: []
    });

    // Equip longsword in main hand, dagger in off hand
    let swordId: EntityId;
    let daggerId: EntityId;
    [state, swordId] = createEntity(state);
    state = addComponent(state, swordId, { type: ComponentType.Item, itemId: 'longsword' });
    [state, daggerId] = createEntity(state);
    state = addComponent(state, daggerId, { type: ComponentType.Item, itemId: 'dagger' });

    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: swordId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: daggerId, limbGroupId: 'hand_off' }
      ]
    });

    const dag = evaluateDnD35eEntityDAG(state, playerId, campaign);
    expect(dag.attackRoutine).toBeDefined();
    expect(dag.attackRoutine.strikes.length).toBeGreaterThanOrEqual(2);

    const swordStrike = dag.attackRoutine.strikes.find((s) => s.weaponId === 'longsword');
    const daggerStrike = dag.attackRoutine.strikes.find((s) => s.weaponId === 'dagger');
    expect(swordStrike).toBeDefined();
    expect(daggerStrike).toBeDefined();

    // Weapon focus longsword applies +1 attack to longsword, but not to dagger
    // Base BAB (1) + STR (3) = 4. TWF without TWF feat gives -4 primary, -8 off-hand.
    // Longsword gets +1 strike_attack -> 4 - 4 + 1 = 1.
    // Dagger gets no strike_attack -> 4 - 8 = -4.
    expect(swordStrike!.attackBonus).toBe(1);
    expect(daggerStrike!.attackBonus).toBe(-4);
  });

  test('buildCombatRuleOverridesFromActiveRules resolves combat parameters without hardcoded feat IDs', () => {
    const activeRules = [
      {
        id: 'cleave_1',
        ruleKey: 'cleave_followup_on_drop',
        value: true
      },
      {
        id: 'great_cleave_1',
        ruleKey: 'great_cleave_unlimited_on_drop',
        value: true
      },
      {
        id: 'finesse_1',
        ruleKey: 'use_dex_for_light_finesse_melee_attack',
        value: true
      },
      {
        id: 'twf_1',
        ruleKey: 'twf_primary_penalty',
        value: -4
      },
      {
        id: 'twf_2',
        ruleKey: 'twf_offhand_penalty',
        value: -4
      },
      {
        id: 'multiattack_1',
        ruleKey: 'secondary_natural_penalty',
        value: -2
      }
    ];

    const resolved = buildCombatRuleOverridesFromActiveRules(activeRules, true);
    expect(resolved.hasCleave).toBe(true);
    expect(resolved.hasGreatCleave).toBe(true);
    expect(resolved.hasWeaponFinesse).toBe(true);
    expect(resolved.combatOverrides.twfPrimaryPenalty).toBe(-2); // -4 + 2 light bonus
    expect(resolved.combatOverrides.twfOffHandPenalty).toBe(-2);
    expect(resolved.combatOverrides.secondaryNaturalPenalty).toBe(-2);
  });

  test('extractActorTacticalDials reads doctrine dials from feat definitions declaratively', () => {
    // When actor has power_attack and combat_expertise in featIds
    const dials = extractActorTacticalDials(['power_attack', 'combat_expertise'], sys.feats);
    expect(dials.length).toBe(2);
    expect(dials.some((d) => d.abilityId === 'power_attack')).toBe(true);
    expect(dials.some((d) => d.abilityId === 'combat_expertise')).toBe(true);
  });

  test('enforces data-driven skill take 10 and take 20 rules without hardcoding use_magic_device', () => {
    // 1. Standard skill with take10Allowed: true
    const climbResult = resolveSkillCheck({
      definition: {
        skillId: 'climb',
        keyAbility: 'str',
        trainedOnly: false,
        acpMultiplier: 1,
        synergyFromSkills: [],
        take10Allowed: true,
        take20Allowed: true
      },
      rawRanks: 5,
      allSkillRanks: { climb: 5 },
      keyAbilityModifier: 3,
      armorCheckPenalty: 0,
      dc: 15,
      takeMode: 'take10'
    });
    expect(climbResult.allowed).toBe(true);
    expect(climbResult.naturalRoll).toBe(10);
    expect(climbResult.totalRoll).toBe(18); // 10 + 5 + 3

    // 2. Skill with take10Allowed: false, take20Allowed: false (such as Use Magic Device)
    const umdResult = resolveSkillCheck({
      definition: {
        skillId: 'use_magic_device',
        keyAbility: 'cha',
        trainedOnly: true,
        acpMultiplier: 0,
        synergyFromSkills: [],
        take10Allowed: false,
        take20Allowed: false
      },
      rawRanks: 5,
      allSkillRanks: { use_magic_device: 5 },
      keyAbilityModifier: 2,
      armorCheckPenalty: 0,
      dc: 20,
      takeMode: 'take10'
    });
    expect(umdResult.allowed).toBe(false);
    expect(umdResult.blockedReason).toBe('take_10_prohibited');

    // 3. Take 20 on prohibited skill
    const umd20Result = resolveSkillCheck({
      definition: {
        skillId: 'use_magic_device',
        keyAbility: 'cha',
        trainedOnly: true,
        acpMultiplier: 0,
        synergyFromSkills: [],
        take10Allowed: false,
        take20Allowed: false
      },
      rawRanks: 5,
      allSkillRanks: { use_magic_device: 5 },
      keyAbilityModifier: 2,
      armorCheckPenalty: 0,
      dc: 20,
      takeMode: 'take20'
    });
    expect(umd20Result.allowed).toBe(false);
    expect(umd20Result.blockedReason).toBe('take_20_prohibited');
  });

  test('resolves domain spell level for any class passing active domains in builder spells', () => {
    const magicDomainSpell: DnD35SpellDefinition = {
      id: 'identify',
      name: 'Identify',
      school: 'divination',
      subschool: null,
      descriptors: [],
      components: { verbal: true, somatic: true, material: true, focus: false, xpCost: false },
      castingTime: '1_standard_action',
      range: 'touch',
      target: 'one touched object',
      duration: 'instantaneous',
      savingThrow: { allowed: false, type: null, effect: 'none' },
      spellResistance: false,
      description: 'Determines magical properties of an item.',
      levelByClass: { wizard: 1, bard: 1 },
      levelByDomain: { magic: 2 }
    };

    // Wizard querying level: gets 1 from levelByClass
    expect(getSpellLevelForClass(magicDomainSpell, 'wizard', [])).toBe(1);

    // Divine class querying without magic domain: gets null
    expect(getSpellLevelForClass(magicDomainSpell, 'cleric', ['war', 'healing'])).toBe(null);

    // Divine class querying with magic domain: gets 2 from levelByDomain
    expect(getSpellLevelForClass(magicDomainSpell, 'cleric', ['magic', 'war'])).toBe(2);

    // Custom homebrew divine class or variant with magic domain: gets 2 from levelByDomain
    expect(getSpellLevelForClass(magicDomainSpell, 'crusader', ['magic'])).toBe(2);
  });
});
