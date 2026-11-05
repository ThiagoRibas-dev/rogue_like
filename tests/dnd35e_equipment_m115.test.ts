import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, queryEntities } from '../src/core/ecs.ts';
import { applyCharacterCreationToPlayer } from '../src/rulesets/dnd35e/character_builder.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { checkDnD35eRuleset } from '../src/rulesets/dnd35e/dnd35e_validator.ts';
import {
  resolveAllEquippedWeaponProfiles,
  resolveEquippedWeaponProfile
} from '../src/rulesets/dnd35e/equipment_physics.ts';
import { resolveEntitySituationalTagContext } from '../src/rulesets/dnd35e/semantic_tags.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType } from '../src/types/components.types.ts';
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
});
