import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, queryEntities } from '../src/core/ecs.ts';
import { applyCharacterCreationToPlayer } from '../src/rulesets/dnd35e/character_builder.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { checkDnD35eRuleset } from '../src/rulesets/dnd35e/dnd35e_validator.ts';
import {
  getCanonicalBaseWeapons,
  resolveAllEquippedWeaponProfiles,
  resolveEffectiveItemDefinition,
  resolveEquippedWeaponProfile
} from '../src/rulesets/dnd35e/equipment_physics.ts';
import { resolveAttackRoll } from '../src/rulesets/dnd35e/combat/attack_roll.ts';
import { evaluateEffectBundle, resolveFeatEffectBundle } from '../src/rulesets/dnd35e/effect_bundle.ts';
import { evaluatePrerequisiteAST } from '../src/rulesets/dnd35e/prerequisites.ts';
import { buildFeatEffectModifiers } from '../src/rulesets/dnd35e/progression/ledger_modifiers.ts';
import {
  projectDnD35ActorSemanticTags,
  resolveEntitySituationalTagContext
} from '../src/rulesets/dnd35e/semantic_tags.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType, type ItemComponent, toItemInstanceId } from '../src/types/components.types.ts';
import type { EntityId } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 115: Complete SRD Weapons, Armors, Special Materials, Magic Item Compendium & Data-Driven Weapon Profile Parser', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const sys = getDnD35SystemContent(campaign)!;

  test('loads 100+ modular SRD items into sys.items and merges them into campaign.items with 0 validation errors', () => {
    expect(sys).toBeDefined();
    const itemKeys = Object.keys(sys.items);
    expect(itemKeys.length).toBeGreaterThanOrEqual(100);
    expect(checkDnD35eRuleset(campaign)).toEqual([]);

    // Verify campaign.items contains merged SRD items
    expect(campaign.items['greatsword']?.weaponStats?.damageDice).toBe('2d6');
    expect(campaign.items['scythe']?.weaponStats?.critMultiplier).toBe(4);
    expect(campaign.items['spiked_chain']?.weaponStats?.reachFt).toBe(10);
    expect(campaign.items['mithral_full_plate']?.specialMaterial).toBe('mithral');
    expect(campaign.items['belt_of_giant_strength_plus4']?.effectBundle).toBeDefined();
    expect(campaign.items['bracers_of_armor_plus4']?.effectBundle).toBeDefined();
  });

  test('parses weapon profiles 100% declaratively from weaponStats, specialMaterial, and magicalProperties', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Dwarf Fighter: test racial familiarity on dwarven_waraxe & dwarven_urgrosh vs gnome_hooked_hammer
    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'dwarf',
      alignment: 'LG',
      classId: 'fighter',
      baseAbilityScores: { str: 16, dex: 14, con: 16, int: 10, wis: 12, cha: 8 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: ['power_attack', 'cleave'],
      knownSpells: []
    });

    // 1. Equip Dwarven Waraxe in 1H: Dwarf treats it as Martial via weaponStats.familiaritySubtypes: ['dwarf'] -> 0 penalty!
    let waraxeId: EntityId;
    [state, waraxeId] = createEntity(state);
    state = addComponent(state, waraxeId, { type: ComponentType.Item, itemId: 'dwarven_waraxe' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: waraxeId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'hand_off' }
      ]
    });
    const dwarfWaraxe = resolveEquippedWeaponProfile(state, playerId, 'main_hand');
    expect(dwarfWaraxe.weaponDice).toBe('1d10');
    expect(dwarfWaraxe.critMultiplier).toBe(3);
    expect(dwarfWaraxe.nonproficiencyPenalty).toBe(0);

    // 2. Equip Gnome Hooked Hammer on Dwarf (without Exotic Weapon Proficiency): takes -4 nonproficiency penalty!
    let gnomeHammerId: EntityId;
    [state, gnomeHammerId] = createEntity(state);
    state = addComponent(state, gnomeHammerId, { type: ComponentType.Item, itemId: 'gnome_hooked_hammer' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: gnomeHammerId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'hand_off' }
      ]
    });
    const dwarfGnomeHammer = resolveEquippedWeaponProfile(state, playerId, 'main_hand');
    expect(dwarfGnomeHammer.isDoubleWeapon).toBe(true);
    expect(dwarfGnomeHammer.nonproficiencyPenalty).toBe(-4);

    // 3. Equip +1 Keen Rapier: threat range doubles from 18-20 to 15-20 and projects bypass:magic
    let keenRapierId: EntityId;
    [state, keenRapierId] = createEntity(state);
    state = addComponent(state, keenRapierId, { type: ComponentType.Item, itemId: 'keen_rapier_plus1' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: keenRapierId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'hand_off' }
      ]
    });
    const keenProfile = resolveEquippedWeaponProfile(state, playerId, 'main_hand');
    expect(keenProfile.critThreatMin).toBe(15);
    expect(keenProfile.cannotTwoHandStr).toBe(true);
    expect(keenProfile.isFinesseEligible).toBe(true);
    expect(keenProfile.bypassTags).toContain('bypass:magic');

    // 4. Equip Alchemical Silver Dagger: -1 material damage penalty and bypass:silver
    let silverDaggerId: EntityId;
    [state, silverDaggerId] = createEntity(state);
    state = addComponent(state, silverDaggerId, { type: ComponentType.Item, itemId: 'alchemical_silver_dagger' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: silverDaggerId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'hand_off' }
      ]
    });
    const silverProfile = resolveAllEquippedWeaponProfiles(state, playerId).primaryWeapon;
    expect(silverProfile.damageBonus).toBe(-1);
    expect(silverProfile.bypassTags).toContain('bypass:silver');
  });

  test('applies Mithral armor category step-down and Max Dex cap increase in Horizon 3', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Human Barbarian with DEX 16 (+3)
    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'CN',
      classId: 'barbarian',
      baseAbilityScores: { str: 16, dex: 16, con: 14, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'shadow_stalker',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: { jump: 4, climb: 4, listen: 4, survival: 4, intimidate: 4 },
      selectedFeats: ['power_attack', 'cleave'],
      knownSpells: []
    });
    // Zero out legacy flat armorBonus so equipped armor drives AC
    const baseData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, { ...baseData, armorBonus: 0, shieldBonus: 0 });

    // 1. Equip standard Full Plate (Heavy Armor, Max Dex +1): suppresses Barbarian Fast Movement (speed 100) and caps DEX at +1
    let fullPlateId: EntityId;
    [state, fullPlateId] = createEntity(state);
    state = addComponent(state, fullPlateId, { type: ComponentType.Item, itemId: 'full_plate' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'torso_1', slotType: 'torso', equippedItem: fullPlateId }]
    });

    const heavyCtx = resolveEntitySituationalTagContext(state, playerId, getDnD35EntityData(state, playerId));
    expect(heavyCtx.armorCategory).toBe('heavy');
    expect(heavyCtx.isMetalArmorOrShield).toBe(true);

    const stdPlateEval = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(stdPlateEval.dagResult.speed).toBe(100); // Fast Movement suppressed in Heavy Armor!
    expect(stdPlateEval.dagResult.acBreakdown.dexContribution).toBe(1); // Capped at +1 Max Dex!
    expect(stdPlateEval.dagResult.acBreakdown.fullAC).toBe(10 + 8 + 1); // 19 AC

    // 2. Equip Mithral Full Plate (steps down Heavy -> Medium, Max Dex +1 + 2 = +3): restores Barbarian Fast Movement (speed 110) and allows full +3 DEX!
    let mithralPlateId: EntityId;
    [state, mithralPlateId] = createEntity(state);
    state = addComponent(state, mithralPlateId, { type: ComponentType.Item, itemId: 'mithral_full_plate' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'torso_1', slotType: 'torso', equippedItem: mithralPlateId }]
    });

    const mithralCtx = resolveEntitySituationalTagContext(state, playerId, getDnD35EntityData(state, playerId));
    expect(mithralCtx.armorCategory).toBe('medium');

    const mithralPlateEval = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(mithralPlateEval.dagResult.speed).toBe(110); // Fast Movement active in Mithral Full Plate!
    expect(mithralPlateEval.dagResult.acBreakdown.dexContribution).toBe(3); // Capped at +3 Max Dex!
    expect(mithralPlateEval.dagResult.acBreakdown.fullAC).toBe(10 + 8 + 3); // 21 AC
  });

  test('evaluates Wondrous Items in the 4-Stage Stat DAG and preserves Ghost Touch / Force AC against incorporeal touch attacks', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'LG',
      classId: 'fighter',
      baseAbilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: ['power_attack', 'cleave'],
      knownSpells: []
    });
    const baseData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, { ...baseData, armorBonus: 0, shieldBonus: 0 });

    let beltId: EntityId;
    let ringId: EntityId;
    let cloakId: EntityId;
    let bracersId: EntityId;
    [state, beltId] = createEntity(state);
    [state, ringId] = createEntity(state);
    [state, cloakId] = createEntity(state);
    [state, bracersId] = createEntity(state);
    state = addComponent(state, beltId, { type: ComponentType.Item, itemId: 'belt_of_giant_strength_plus4' });
    state = addComponent(state, ringId, { type: ComponentType.Item, itemId: 'ring_of_protection_plus2' });
    state = addComponent(state, cloakId, { type: ComponentType.Item, itemId: 'cloak_of_resistance_plus2' });
    state = addComponent(state, bracersId, { type: ComponentType.Item, itemId: 'bracers_of_armor_plus4' });

    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'torso_1', slotType: 'torso', equippedItem: beltId },
        { id: 'finger_1', slotType: 'finger', equippedItem: ringId },
        { id: 'back_1', slotType: 'back', equippedItem: cloakId },
        { id: 'arm_1', slotType: 'arm', equippedItem: bracersId }
      ]
    });

    const evalNormal = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(evalNormal.dagResult.effectiveAbilities.str.base).toBe(18); // 14 + 4 Belt of Giant Strength
    expect(evalNormal.dagResult.saves.fort).toBe(2 + 2 + 2); // Base 2 + CON 2 + Cloak of Resistance 2 = 6
    expect(evalNormal.dagResult.acBreakdown.fullAC).toBe(10 + 1 + 2 + 4); // 10 + 1 DEX + 2 Deflection + 4 Bracers = 17

    // Against an incorporeal touch attack, Bracers of Armor +4 (effectTags: ['force']) and Ring of Protection +2 are BOTH preserved in touchAC!
    const evalIncorporealTouch = evaluateDnD35eEntityDAG(state, playerId, {
      againstIncorporealTouch: true,
      effectTags: ['attack:incorporeal_touch']
    })!;
    expect(evalIncorporealTouch.dagResult.acBreakdown.touchAC).toBe(10 + 1 + 2 + 4); // 17 Touch AC!

    // Equip +1 Ghost Touch Full Plate (8 armor + 1 armor_enhancement = 9, ghostTouch: true): preserved against incorporeal touch!
    let gtPlateId: EntityId;
    [state, gtPlateId] = createEntity(state);
    state = addComponent(state, gtPlateId, { type: ComponentType.Item, itemId: 'ghost_touch_full_plate_plus1' });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'torso_1', slotType: 'torso', equippedItem: gtPlateId },
        { id: 'finger_1', slotType: 'finger', equippedItem: ringId }
      ]
    });
    const evalGhostTouchArmor = evaluateDnD35eEntityDAG(state, playerId, {
      againstIncorporealTouch: true,
      effectTags: ['attack:incorporeal_touch']
    })!;
    expect(evalGhostTouchArmor.dagResult.acBreakdown.touchAC).toBe(10 + 1 + 2 + 9); // 22 Touch AC!
  });

  test('canonical base weapons: getCanonicalBaseWeapons filters out magic and material variants', () => {
    const baseWeapons = getCanonicalBaseWeapons(sys);
    const ids = baseWeapons.map((w) => w.id);

    // Verify canonical weapons exist
    expect(ids).toContain('longsword');
    expect(ids).toContain('dagger');
    expect(ids).toContain('greatsword');
    expect(ids).toContain('rapier');
    expect(ids).toContain('shortbow');

    // Verify variants and non-base weapons are omitted
    expect(ids).not.toContain('longsword_plus1');
    expect(ids).not.toContain('flaming_longsword_plus1');
    expect(ids).not.toContain('cold_iron_longsword');
    expect(ids).not.toContain('keen_rapier_plus1');
    expect(ids).not.toContain('mithral_breastplate');
  });

  test('weapon inheritance & instance templating: resolveEffectiveItemDefinition merges templates & instance overrides', () => {
    const rawFlaming = campaign.items['flaming_longsword_plus1']!;
    expect(rawFlaming.baseItemId).toBe('longsword');

    const resolvedDef = resolveEffectiveItemDefinition(rawFlaming, campaign.items);
    expect(resolvedDef.baseItemId).toBe('longsword');
    expect(resolvedDef.weaponStats?.damageDice).toBe('1d8');
    expect(resolvedDef.weaponStats?.damageType).toBe('slashing');
    expect(resolvedDef.weaponStats?.critThreatMin).toBe(19);
    expect(resolvedDef.magicalProperties?.enhancementBonus).toBe(1);
    expect(resolvedDef.magicalProperties?.enhancements).toContain('flaming');

    // Bare template inheriting everything from base longsword without declaring weaponStats
    const bareCustomWeapon = {
      id: 'custom_runeblade',
      baseItemId: 'longsword',
      name: 'Custom Runeblade',
      glyph: '/',
      fg: '#fff',
      bg: 'transparent',
      category: 'weapon' as const,
      weight: 4,
      baseValue: 1000,
      tags: ['weapon', 'martial'],
      unidentifiedName: 'Sword'
    };
    const resolvedBare = resolveEffectiveItemDefinition(bareCustomWeapon, campaign.items);
    expect(resolvedBare.weaponStats?.damageDice).toBe('1d8');
    expect(resolvedBare.weaponStats?.critThreatMin).toBe(19);

    // ECS ItemComponent instance overrides: Holy Avenger!
    const customComp: ItemComponent = {
      type: ComponentType.Item,
      itemId: 'longsword',
      instanceId: toItemInstanceId('item_inst_holy_avenger'),
      customName: 'Holy Avenger',
      enhancementBonus: 5,
      enhancements: ['holy']
    };
    const holyAvenger = resolveEffectiveItemDefinition(campaign.items['longsword']!, campaign.items, customComp);
    expect(holyAvenger.name).toBe('Holy Avenger');
    expect(holyAvenger.magicalProperties?.enhancementBonus).toBe(5);
    expect(holyAvenger.magicalProperties?.enhancements).toContain('holy');
    expect(holyAvenger.weaponStats?.damageDice).toBe('1d8');
  });

  test('item enhancements & damage riders: flamingLongsword produces on_hit fire damage riders and strike tags', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Equip flaming_longsword_plus1
    let swordId: EntityId;
    [state, swordId] = createEntity(state);
    state = addComponent(state, swordId, {
      type: ComponentType.Item,
      itemId: 'flaming_longsword_plus1'
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'main_hand_1', slotType: 'main_hand', equippedItem: swordId }]
    });

    const equipped = resolveEquippedWeaponProfile(state, playerId);
    expect(equipped).toBeDefined();
    expect(equipped?.baseWeaponId).toBe('longsword');
    expect(equipped?.damageRiders).toBeDefined();
    expect(equipped?.damageRiders?.length).toBe(1);
    expect(equipped?.damageRiders?.[0]?.damageType).toBe('fire');
    expect(equipped?.damageRiders?.[0]?.dice).toBe('1d6');
    expect(equipped?.damageRiders?.[0]?.trigger).toBe('on_hit');

    // Evaluate DAG Stage 4 Attack Routine
    const evalResult = evaluateDnD35eEntityDAG(state, playerId)!;
    const routine = evalResult.attackRoutine;
    expect(routine.strikes.length).toBeGreaterThanOrEqual(1);
    const strike = routine.strikes[0]!;
    expect(strike.baseWeaponId).toBe('longsword');
    expect(strike.damageRiders?.[0]?.damageType).toBe('fire');
  });

  test('feat matching with variants: weapon_focus & weapon_specialization match baseWeaponId on magic items', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'LG',
      classId: 'fighter',
      baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: ['power_attack', 'weapon_focus:longsword'],
      knownSpells: []
    });

    // Add weapon_specialization:longsword to feats and statModifiers via resolved effect bundle
    const dndData = getDnD35EntityData(state, playerId);
    const specBundle = resolveFeatEffectBundle(sys.feats['weapon_specialization']!, 'longsword');
    const evaluatedSpec = evaluateEffectBundle(specBundle);
    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      feats: [...dndData.feats, 'weapon_specialization:longsword'],
      statModifiers: [...dndData.statModifiers, ...evaluatedSpec.statModifiers]
    });

    // Equip flaming_longsword_plus1 (itemId != longsword, but baseWeaponId == longsword)
    let swordId: EntityId;
    [state, swordId] = createEntity(state);
    state = addComponent(state, swordId, {
      type: ComponentType.Item,
      itemId: 'flaming_longsword_plus1'
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'main_hand_1', slotType: 'main_hand', equippedItem: swordId }]
    });

    const evalResult = evaluateDnD35eEntityDAG(state, playerId)!;
    const strike = evalResult.attackRoutine.strikes[0]!;

    // BAB 1 + STR 3 + Enh 1 + Weapon Focus 1 = 6 Attack Bonus
    expect(strike.attackBonus).toBe(1 + 3 + 1 + 1);

    // STR 3 + Enh 1 + Weapon Specialization 2 = 6 Damage Bonus (flatDamageBonus)
    expect(strike.flatDamageBonus).toBe(1 + 2); // Enh 1 + Spec 2 (STR is in strDamageBonus = 3)
    expect(strike.strDamageBonus).toBe(3);
  });

  test('strict prerequisite evaluation: weapon_specialization does not allow mismatched weapon focus targets', () => {
    // Context with weapon_focus:dagger
    const ctx = {
      totalBab: 4,
      feats: ['weapon_focus:dagger'],
      skillRanks: {},
      abilityScores: { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
      tags: [],
      casterLevel: 0,
      sizeCategory: 'medium' as const,
      classLevels: { fighter: 4 }
    };

    const weaponSpecDef = sys.feats['weapon_specialization']!;

    // Trying to take weapon_specialization:longsword with only weapon_focus:dagger must FAIL
    const canTakeLongsword = evaluatePrerequisiteAST(weaponSpecDef.prerequisites!, {
      ...ctx,
      targetId: 'longsword'
    });
    expect(canTakeLongsword).toBe(false);

    // Trying to take weapon_specialization:dagger with weapon_focus:dagger must SUCCEED
    const canTakeDagger = evaluatePrerequisiteAST(weaponSpecDef.prerequisites!, {
      ...ctx,
      targetId: 'dagger'
    });
    expect(canTakeDagger).toBe(true);
  });

  test('M123: Horizon 2 buildFeatEffectModifiers scopes weapon_focus:longsword strictly to longsword', () => {
    const mods = buildFeatEffectModifiers(['weapon_focus:longsword', 'weapon_specialization:longsword'], sys.feats);
    expect(mods.length).toBe(2);
    expect(mods[0]?.condition?.effectTagsAll).toEqual(['weapon:longsword']);
    expect(mods[1]?.condition?.effectTagsAll).toEqual(['weapon:longsword']);

    // Verify a character with weapon_focus:longsword gets +1 on longsword, NOT on dagger
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'LG',
      classId: 'fighter',
      baseAbilityScores: { str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: ['power_attack', 'weapon_focus:longsword'],
      knownSpells: []
    });

    let daggerId: EntityId;
    [state, daggerId] = createEntity(state);
    state = addComponent(state, daggerId, {
      type: ComponentType.Item,
      itemId: 'dagger'
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'main_hand_1', slotType: 'main_hand', equippedItem: daggerId }]
    });

    const daggerEval = evaluateDnD35eEntityDAG(state, playerId)!;
    // BAB 1 + STR 2 = 3 (NO +1 from weapon_focus:longsword!)
    expect(daggerEval.attackRoutine.strikes[0]?.attackBonus).toBe(3);
  });

  test('M123: unified StatModifier extra_full_bab_attacks (Speed non-stacking haste vs untyped stacking)', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    let speedSwordId: EntityId;
    [state, speedSwordId] = createEntity(state);
    state = addComponent(state, speedSwordId, {
      type: ComponentType.Item,
      itemId: 'longsword',
      enhancementBonus: 1,
      enhancements: ['speed']
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'main_hand_1', slotType: 'main_hand', equippedItem: speedSwordId }]
    });

    // Speed weapon grants 1 extra attack at full BAB
    const evalSpeed = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(evalSpeed.attackRoutine.strikes.length).toBe(2);
    expect(evalSpeed.attackRoutine.strikes[0]?.attackBonus).toBe(evalSpeed.attackRoutine.strikes[1]?.attackBonus);

    // Adding a second 'haste' bonus to extra_full_bab_attacks does NOT stack with Speed ('haste' bonusType)
    const dndData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      statModifiers: [
        ...(dndData.statModifiers ?? []),
        {
          targetStat: 'extra_full_bab_attacks',
          value: 1,
          bonusType: 'haste',
          sourceId: 'spell:haste',
          sourcePath: 'spell:haste/extra_attack',
          origin: 'sp'
        }
      ]
    });
    const evalDoubleHaste = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(evalDoubleHaste.attackRoutine.strikes.length).toBe(2);

    // Adding an 'untyped' extra_full_bab_attacks modifier DOES stack with Speed ('haste')
    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      statModifiers: [
        ...(dndData.statModifiers ?? []),
        {
          targetStat: 'extra_full_bab_attacks',
          value: 1,
          bonusType: 'untyped',
          sourceId: 'class:monk:flurry',
          sourcePath: 'class:monk/feature:flurry_of_blows',
          origin: 'ex'
        }
      ]
    });
    const evalHastePlusUntyped = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(evalHastePlusUntyped.attackRoutine.strikes.length).toBe(3);
  });

  test('M123: unified StatModifier fortification (25%, 75%, 100%, and arbitrary custom %) negates crits and precision', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    let armorId: EntityId;
    [state, armorId] = createEntity(state);
    state = addComponent(state, armorId, {
      type: ComponentType.Item,
      itemId: 'full_plate',
      enhancementBonus: 1,
      enhancements: ['fortification_moderate']
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'torso_1', slotType: 'torso', equippedItem: armorId }]
    });

    const evalMod = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(evalMod.dagResult.fortificationPercent).toBe(75);

    // Roll attack with natural 20 threat against 35% custom fortification:
    // Roll 30 (<= 35) negates critical threat and sneak attack precision dice
    const negatedRes = resolveAttackRoll({
      attackBonus: 10,
      targetAC: 15,
      weaponDice: '1d8',
      strModifier: 2,
      handedness: 'one_handed',
      flatDamageBonus: 0,
      critThreatMin: 19,
      critMultiplier: 2,
      precisionDice: ['2d6'],
      fortificationPercent: 35,
      forcedAttackRoll: 20,
      forcedConfirmRoll: 20,
      forcedFortificationRoll: 30
    });
    expect(negatedRes.hit).toBe(true);
    expect(negatedRes.isCriticalConfirmed).toBe(false);
    expect(negatedRes.unmultipliedExtraDamage).toBe(0);

    // Roll 40 (> 35) fails fortification, confirming critical and rolling precision dice
    const confirmedRes = resolveAttackRoll({
      attackBonus: 10,
      targetAC: 15,
      weaponDice: '1d8',
      strModifier: 2,
      handedness: 'one_handed',
      flatDamageBonus: 0,
      critThreatMin: 19,
      critMultiplier: 2,
      precisionDice: ['2d6'],
      fortificationPercent: 35,
      forcedAttackRoll: 20,
      forcedConfirmRoll: 20,
      forcedFortificationRoll: 40
    });
    expect(confirmedRes.hit).toBe(true);
    expect(confirmedRes.isCriticalConfirmed).toBe(true);
    expect(confirmedRes.unmultipliedExtraDamage).toBeGreaterThanOrEqual(2);
  });

  test('M123: alignment semantic tags, Animated shield hand-freeing, and Wizard martial nonproficiency penalty', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // 1. Alignment semantic tag projection
    const dndData = getDnD35EntityData(state, playerId);
    const evilTags = projectDnD35ActorSemanticTags({ ...dndData, alignment: 'LE' });
    expect(evilTags).toContain('alignment:le');
    expect(evilTags).toContain('alignment:lawful');
    expect(evilTags).toContain('alignment:evil');

    // 2. Animated shield frees off-hand so main-hand longsword can be gripped two-handed (1.5x STR)
    let swordId: EntityId;
    let animShieldId: EntityId;
    [state, swordId] = createEntity(state);
    [state, animShieldId] = createEntity(state);
    state = addComponent(state, swordId, { type: ComponentType.Item, itemId: 'longsword_plus1' });
    state = addComponent(state, animShieldId, {
      type: ComponentType.Item,
      itemId: 'animated_heavy_steel_shield_plus1'
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', limbGroupId: 'hand_main', equippedItem: swordId },
        { id: 'off_hand_1', slotType: 'off_hand', limbGroupId: 'hand_off', equippedItem: animShieldId }
      ]
    });
    state = addComponent(state, playerId, {
      type: ComponentType.TacticalDoctrine,
      gripMode: 'two_handed',
      powerAttackTradeoff: 0,
      combatExpertiseTradeoff: 0,
      fightingDefensively: false,
      totalDefense: false
    });

    const resolvedWeapons = resolveAllEquippedWeaponProfiles(state, playerId);
    expect(resolvedWeapons.gripMode).toBe('two_handed');
    expect(resolvedWeapons.primaryWeapon.handedness).toBe('two_handed');

    // 3. Wizard without martial proficiency gets -4 penalty on longsword
    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      alignment: 'LN',
      classId: 'wizard',
      baseAbilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
      equipmentPackageId: 'arcane_scholar',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: ['scribe_scroll', 'toughness'],
      knownSpells: ['magic_missile']
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'main_hand_1', slotType: 'main_hand', equippedItem: swordId }]
    });
    const wizWeapon = resolveEquippedWeaponProfile(state, playerId);
    expect(wizWeapon.nonproficiencyPenalty).toBe(-4);
  });

  test('M124: off-hand weapon enhancements (Keen / Speed) are scoped to that weapon and do not leak onto main-hand weapon', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Equip mundane Longsword in main-hand and +1 Speed Short Sword in off-hand
    let mainSwordId: EntityId;
    let offSpeedSwordId: EntityId;
    [state, mainSwordId] = createEntity(state);
    [state, offSpeedSwordId] = createEntity(state);
    state = addComponent(state, mainSwordId, { type: ComponentType.Item, itemId: 'longsword' });
    state = addComponent(state, offSpeedSwordId, {
      type: ComponentType.Item,
      itemId: 'short_sword',
      enhancementBonus: 1,
      enhancements: ['speed', 'keen']
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', limbGroupId: 'hand_main', equippedItem: mainSwordId },
        { id: 'off_hand_1', slotType: 'off_hand', limbGroupId: 'hand_off', equippedItem: offSpeedSwordId }
      ]
    });

    const evalOffSpeed = evaluateDnD35eEntityDAG(state, playerId)!;
    // Main-hand longsword should only get 1 primary attack (off-hand Speed is scoped to weapon:short_sword, not weapon:longsword)
    const primaryStrikes = evalOffSpeed.attackRoutine.strikes.filter((s) => s.attackSource === 'manufactured_primary');
    expect(primaryStrikes.length).toBe(1);
    // Main-hand longsword critThreatMin remains 19 (off-hand Keen does not leak onto main-hand weapon)
    expect(primaryStrikes[0]?.critThreatMin).toBe(19);
    // Top-level dagResult.attackBonus is 4 (BAB 1 + STR 3 + 0 main-hand enh), NOT inflated by off-hand short_sword
    expect(evalOffSpeed.dagResult.attackBonus).toBe(4);
    const offHandStrikes = evalOffSpeed.attackRoutine.strikes.filter((s) => s.attackSource === 'manufactured_offhand');
    expect(primaryStrikes[0]?.attackBonus).toBe(0);
    // Off-hand short_sword has its Keen expansion (19-20 -> 17-20) and its own attack bonus (-4 TWF + 3 item = -1)
    expect(offHandStrikes[0]?.critThreatMin).toBe(17);
    expect(offHandStrikes[0]?.attackBonus).toBe(-1);
  });

  test('M124: Bane weapon enhancement grants +2 attack, +2 damage, and +2d6 on-hit rider against matching creature type', () => {
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Create +1 Undead-Bane Longsword via magicalProperties override in campaign.items
    campaign.items['undead_bane_longsword_plus1'] = {
      id: 'undead_bane_longsword_plus1',
      baseItemId: 'longsword',
      name: '+1 Undead Bane Longsword',
      glyph: '/',
      fg: '#ffffff',
      bg: '#000000',
      category: 'weapon',
      weight: 4,
      baseValue: 8315,
      tags: ['weapon', 'martial', 'melee', 'slashing', 'magic'],
      magicalProperties: {
        isMasterwork: true,
        enhancementBonus: 1,
        enhancements: ['bane'],
        baneCreatureType: 'undead'
      }
    };

    let baneSwordId: EntityId;
    [state, baneSwordId] = createEntity(state);
    state = addComponent(state, baneSwordId, {
      type: ComponentType.Item,
      itemId: 'undead_bane_longsword_plus1'
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'main_hand_1', slotType: 'main_hand', equippedItem: baneSwordId }]
    });

    // 1. Against Humanoid target: normal +1 enhancement
    const evalVsHumanoid = evaluateDnD35eEntityDAG(state, playerId, { targetTags: ['type:humanoid'] })!;
    const strikeVsHumanoid = evalVsHumanoid.attackRoutine.strikes[0]!;

    // 2. Against Undead target: +2 attack and +2 damage from Bane, plus 2d6 conditional damageRider
    const evalVsUndead = evaluateDnD35eEntityDAG(state, playerId, { targetTags: ['type:undead'] })!;
    const strikeVsUndead = evalVsUndead.attackRoutine.strikes[0]!;

    expect(strikeVsUndead.attackBonus).toBe(strikeVsHumanoid.attackBonus + 2);
    expect(strikeVsUndead.flatDamageBonus).toBe(strikeVsHumanoid.flatDamageBonus + 2);
    expect(strikeVsUndead.damageRiders?.some((r) => r.dice === '2d6' && r.condition?.targetTagsAny?.includes('type:undead'))).toBe(
      true
    );
  });

  test('M124: lateral spell StatModifiers (Haste, Blur, Displacement) and parameterized Spell Focus / Ability Focus / Maneuver Feats', () => {
    // 1. Verify Haste, Blur, and Displacement spell bundles emit StatModifiers instead of legacy ruleOverrides
    const hasteSpell = sys.spells['haste']!;
    const hasteBundle = hasteSpell.effectUnits?.[0]?.effectBundle;
    expect(hasteBundle).toBeDefined();
    expect(
      hasteBundle?.modifiers.some((m) => m.target === 'extra_full_bab_attacks' && m.value === 1 && m.type === 'haste')
    ).toBe(true);
    expect(hasteBundle?.modifiers.some((m) => m.target === 'ref' && m.value === 1 && m.type === 'dodge')).toBe(true);
    expect(hasteBundle?.ruleOverrides).toEqual([]);

    const blurSpell = sys.spells['blur']!;
    expect(blurSpell.effectBundle?.modifiers.some((m) => m.target === 'miss_chance' && m.value === 20)).toBe(true);
    expect(blurSpell.effectBundle?.ruleOverrides).toEqual([]);

    const displacementSpell = sys.spells['displacement']!;
    expect(displacementSpell.effectBundle?.modifiers.some((m) => m.target === 'miss_chance' && m.value === 50)).toBe(
      true
    );
    expect(displacementSpell.effectBundle?.ruleOverrides).toEqual([]);

    // 2. Verify Spell Focus (Evocation), Ability Focus (Poison), and Improved Trip emit StatModifiers
    const featMods = buildFeatEffectModifiers(
      ['spell_focus:evocation', 'greater_spell_focus:evocation', 'ability_focus:poison', 'improved_trip'],
      sys.feats
    );
    const evocationMods = featMods.filter((m) => m.targetStat === 'spell_save_dc');
    expect(evocationMods.length).toBe(2);
    expect(evocationMods[0]?.condition?.effectTagsAll).toEqual(['school:evocation']);
    expect(evocationMods[1]?.condition?.effectTagsAll).toEqual(['school:evocation']);

    const poisonMod = featMods.find((m) => m.targetStat === 'special_ability_save_dc');
    expect(poisonMod?.value).toBe(2);
    expect(poisonMod?.condition?.effectTagsAll).toEqual(['ability:poison']);

    const tripMod = featMods.find((m) => m.targetStat === 'trip');
    expect(tripMod?.value).toBe(4);
  });
});
