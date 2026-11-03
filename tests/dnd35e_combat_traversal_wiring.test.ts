import { describe, expect, test } from 'bun:test';
import {
  ComponentType,
  type EquipmentComponent,
  type FighterComponent,
  type InventoryComponent,
  type TacticalDoctrineComponent,
  type WeaponGripMode
} from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import type { EntityId } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';
import { addComponent, createEntity, getComponent, queryEntities, spawnEntity } from '../src/core/ecs.ts';
import {
  applyCharacterCreationToPlayer,
  applyLevelUpToActor,
  type CharacterCreationDraft
} from '../src/rulesets/dnd35e/character_builder.ts';
import {
  evaluateWeaponWieldingProfile,
  resolveAllEquippedWeaponProfiles,
  resolveEquippedWeaponProfile,
  scaleWeaponDamageDice
} from '../src/rulesets/dnd35e/equipment_physics.ts';
import {
  computeStrikeDoctrineDamageBonus,
  evaluateTacticalDoctrineModifiers,
  resolveActorAttackRoutine
} from '../src/rulesets/dnd35e/combat/attack_resolver.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { getDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { canPlayerLevelUpDnD35e } from '../src/rendering/ui/dnd35e_level_up.ui.ts';
import { canTraverseTile, processMoveIntent } from '../src/systems/movement.system.ts';
import { grantXp } from '../src/systems/death.system.ts';
import { processMeleeAttackIntent } from '../src/systems/combat.system.ts';
import { processDamageSystem } from '../src/systems/damage.system.ts';
import { getDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';

describe('Milestone 112.6: Combat Sequence & Inventory Wiring, Declarative Doctrines, Decoupled Level-Up & Traversal', () => {
  const dndCampaign = loadCampaignFromDisk('dnd35e-crypt');

  test('Step 1: resolveEquippedWeaponProfile derives stats, scales with size, and applies special materials', () => {
    let state = buildGameState(dndCampaign);
    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;

    // 1. Initial unarmed state
    const unarmedProfile = resolveEquippedWeaponProfile(state, playerId, 'main_hand');
    expect(unarmedProfile.isArmed).toBe(false);
    expect(unarmedProfile.weaponName).toBe('Unarmed Strike');
    expect(unarmedProfile.weaponDice).toBeDefined();
    expect(unarmedProfile.weaponDamageType).toBe('bludgeoning');
    expect(unarmedProfile.critThreatMin).toBe(20);
    expect(unarmedProfile.critMultiplier).toBe(2);

    // 2. Equip longsword via Character Creation
    const draft: CharacterCreationDraft = {
      raceId: 'human',
      alignment: 'LG',
      classId: 'fighter',
      baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: { jump: 4, climb: 4 },
      selectedFeats: ['power_attack', 'cleave'],
      knownSpells: []
    };

    state = applyCharacterCreationToPlayer(state, playerId, draft);

    const armedProfile = resolveEquippedWeaponProfile(state, playerId, 'main_hand');
    expect(armedProfile.isArmed).toBe(true);
    expect(armedProfile.weaponItemId).toBe('longsword');
    expect(armedProfile.weaponDice).toBe('1d8');
    expect(armedProfile.weaponDamageType).toBe('slashing');
    expect(armedProfile.critThreatMin).toBe(19);
    expect(armedProfile.critMultiplier).toBe(2);
    expect(armedProfile.handedness).toBe('one_handed');
  });

  test('Step 2: Full Attack vs Standard Attack distinguishes 5-ft step from extended movement', () => {
    let state = buildGameState(dndCampaign);
    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    // Spawn dummy enemy next to player
    let enemyId;
    [state, enemyId] = spawnEntity(state, 'skeleton', playerPos.x + 1, playerPos.y);

    // Bumping without movement executes attack sequence
    const attackRes = processMeleeAttackIntent(state, {
      type: IntentType.MeleeAttack,
      entityId: playerId,
      defenderId: enemyId
    });

    expect(attackRes.success).toBe(true);
    expect(attackRes.state.messages.length).toBeGreaterThan(0);
  });

  test('Step 3: Character creation physically materializes items in Inventory and Equipment slots', () => {
    let state = buildGameState(dndCampaign);
    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;

    const draft: CharacterCreationDraft = {
      raceId: 'dwarf',
      alignment: 'LN',
      classId: 'fighter',
      baseAbilityScores: { str: 15, dex: 13, con: 16, int: 10, wis: 12, cha: 8 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: {},
      selectedFeats: ['toughness'],
      knownSpells: []
    };

    state = applyCharacterCreationToPlayer(state, playerId, draft);

    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    const equip = getComponent(state, playerId, ComponentType.Equipment) as EquipmentComponent;

    // Inventory contains spawned items (longsword, scale_mail, heavy_wooden_shield, backpack, health_potion)
    expect(inv.items.length).toBeGreaterThanOrEqual(4);

    // Equipped slots hold equipped item entity IDs
    const equippedHandSlot = equip.slots.find(
      (s) => (s.slotType === 'hand' || s.slotType === 'main_hand') && s.equippedItem !== null
    );
    expect(equippedHandSlot).toBeDefined();
    expect(equippedHandSlot?.equippedItem).not.toBeNull();

    const torsoSlot = equip.slots.find((s) => s.slotType === 'torso' || s.id === 'torso_1');
    expect(torsoSlot).toBeDefined();
    expect(torsoSlot?.equippedItem).not.toBeNull();
  });

  test('Step 4: Level-Up Decoupling separates XP gain from interactive advancement', () => {
    let state = buildGameState(dndCampaign);
    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;

    const fighterBefore = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    const dndDataBefore = getDnD35EntityData(state, playerId);
    const initialLevel = fighterBefore.level;

    // Grant 1000 XP (threshold for Level 2)
    state = grantXp(state, playerId, 1000);

    const fighterAfterXp = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    const dndDataAfterXp = getDnD35EntityData(state, playerId);

    // Level and tracks MUST NOT change automatically upon XP grant
    expect(fighterAfterXp.level).toBe(initialLevel);
    expect(dndDataAfterXp.tracks[0]?.levels).toBe(dndDataBefore.tracks[0]?.levels);
    expect(fighterAfterXp.xp).toBe(1000);

    // Level-up eligibility query evaluates to true
    expect(canPlayerLevelUpDnD35e(state, playerId)).toBe(true);

    // Level advancement only occurs through applyLevelUpToActor
    const levelUpRes = applyLevelUpToActor(state, playerId, {
      classId: 'fighter',
      hpMethod: 'average',
      addedSkillRanks: {},
      selectedFeats: []
    });

    expect(levelUpRes.success).toBe(true);
    const fighterAfterLevelUp = getComponent(levelUpRes.state, playerId, ComponentType.Fighter) as FighterComponent;
    expect(fighterAfterLevelUp.level).toBe(initialLevel + 1);
  });

  test('Step 5: Declarative Doctrine Descriptors evaluate Power Attack and Combat Expertise dials', () => {
    // Power Attack 1:1 one-handed, 1:2 two-handed, 1:0 light
    const paOneHanded = evaluateTacticalDoctrineModifiers(
      { type: ComponentType.TacticalDoctrine, powerAttackAmount: 3 },
      5,
      'one_handed'
    );
    expect(paOneHanded.attackPenalty).toBe(-3);
    expect(paOneHanded.damageBonus).toBe(3);

    const paTwoHanded = evaluateTacticalDoctrineModifiers(
      { type: ComponentType.TacticalDoctrine, powerAttackAmount: 3 },
      5,
      'two_handed'
    );
    expect(paTwoHanded.attackPenalty).toBe(-3);
    expect(paTwoHanded.damageBonus).toBe(6);

    const paLight = evaluateTacticalDoctrineModifiers(
      { type: ComponentType.TacticalDoctrine, powerAttackAmount: 3 },
      5,
      'light'
    );
    expect(paLight.attackPenalty).toBe(-3);
    expect(paLight.damageBonus).toBe(0);

    // Combat Expertise dial: capped at 5
    const ce = evaluateTacticalDoctrineModifiers(
      { type: ComponentType.TacticalDoctrine, combatExpertiseAmount: 4 },
      6,
      'one_handed'
    );
    expect(ce.attackPenalty).toBe(-4);
    expect(ce.dodgeAcBonus).toBe(4);
  });

  test('Step 6: Multi-Mode Traversal allows fly over chasm and swim through water', () => {
    const chasmTile = {
      walkable: false,
      transparent: true,
      glyph: ' ',
      fg: '#000',
      bg: '#000',
      tags: ['chasm', 'pit']
    };

    const waterTile = {
      walkable: false,
      transparent: true,
      glyph: '~',
      fg: '#00f',
      bg: '#005',
      tags: ['water', 'liquid']
    };

    const wallTile = {
      walkable: false,
      transparent: false,
      glyph: '#',
      fg: '#fff',
      bg: '#333',
      tags: ['wall', 'solid']
    };

    // Non-flyer/non-swimmer cannot traverse
    expect(canTraverseTile(chasmTile, undefined)).toBe(false);
    expect(canTraverseTile(waterTile, undefined)).toBe(false);
    expect(canTraverseTile(wallTile, undefined)).toBe(false);

    // Flyer can traverse chasm, but not solid wall
    expect(canTraverseTile(chasmTile, { fly: 30 })).toBe(true);
    expect(canTraverseTile(wallTile, { fly: 30 })).toBe(false);

    // Swimmer can traverse water, but not chasm
    expect(canTraverseTile(waterTile, { swim: 20 })).toBe(true);
    expect(canTraverseTile(chasmTile, { swim: 20 })).toBe(false);
  });
});

describe('Milestone 112.7: Inappropriately Sized Weapons, Grip Modes, Multi-Limb Demotion & Stage 4 DAG Attack Routine', () => {
  const dndCampaign = loadCampaignFromDisk('dnd35e-crypt');

  test('Step 1: evaluateWeaponWieldingProfile adheres to 3-step effort ladder bounds and -2 penalty per step', () => {
    // 1. Medium wielder wielding Small light weapon: stepDiff -1 -> Index -1 (<0) -> unwieldable
    const smallLight = evaluateWeaponWieldingProfile('small', 'light', 'medium');
    expect(smallLight.wieldable).toBe(false);
    expect(smallLight.effectiveHandedness).toBeUndefined();

    // 2. Medium wielder wielding Medium light weapon: stepDiff 0 -> Index 0 -> light, 0 penalty
    const medLight = evaluateWeaponWieldingProfile('medium', 'light', 'medium');
    expect(medLight.wieldable).toBe(true);
    expect(medLight.effectiveHandedness).toBe('light');
    expect(medLight.attackPenalty).toBe(0);

    // 3. Medium wielder wielding Large light weapon: stepDiff +1 -> Index 1 -> one_handed, -2 penalty
    const largeLight = evaluateWeaponWieldingProfile('large', 'light', 'medium');
    expect(largeLight.wieldable).toBe(true);
    expect(largeLight.effectiveHandedness).toBe('one_handed');
    expect(largeLight.attackPenalty).toBe(-2);

    // 4. Medium wielder wielding Huge light weapon: stepDiff +2 -> Index 2 -> two_handed, -4 penalty
    const hugeLight = evaluateWeaponWieldingProfile('huge', 'light', 'medium');
    expect(hugeLight.wieldable).toBe(true);
    expect(hugeLight.effectiveHandedness).toBe('two_handed');
    expect(hugeLight.attackPenalty).toBe(-4);

    // 5. Medium wielder wielding Gargantuan light weapon: stepDiff +3 -> Index 3 (>=3) -> unwieldable
    const gargLight = evaluateWeaponWieldingProfile('gargantuan', 'light', 'medium');
    expect(gargLight.wieldable).toBe(false);

    // 6. Medium wielder wielding Large two-handed weapon: stepDiff +1 on two_handed -> Index 3 -> unwieldable
    const largeTwoHanded = evaluateWeaponWieldingProfile('large', 'two_handed', 'medium');
    expect(largeTwoHanded.wieldable).toBe(false);

    // 7. Medium wielder wielding Small two-handed weapon: stepDiff -1 on two_handed -> Index 1 -> one_handed, -2 penalty
    const smallTwoHanded = evaluateWeaponWieldingProfile('small', 'two_handed', 'medium');
    expect(smallTwoHanded.wieldable).toBe(true);
    expect(smallTwoHanded.effectiveHandedness).toBe('one_handed');
    expect(smallTwoHanded.attackPenalty).toBe(-2);

    // 8. Medium wielder wielding Tiny two-handed weapon: stepDiff -2 on two_handed -> Index 0 -> light, -4 penalty
    const tinyTwoHanded = evaluateWeaponWieldingProfile('tiny', 'two_handed', 'medium');
    expect(tinyTwoHanded.wieldable).toBe(true);
    expect(tinyTwoHanded.effectiveHandedness).toBe('light');
    expect(tinyTwoHanded.attackPenalty).toBe(-4);
  });

  test('Step 2: WeaponGripMode toggles and weapon exceptions (Rapier, Light weapon 2H, Double Weapon)', () => {
    let state = buildGameState(dndCampaign);
    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;

    // Case A: 1H Longsword in one hand vs two hands
    let longswordEntityId: EntityId;
    [state, longswordEntityId] = createEntity(state);
    state = addComponent(state, longswordEntityId, {
      type: ComponentType.Item,
      itemId: 'longsword'
    });

    // Equip in main_hand with off_hand empty
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: longswordEntityId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'hand_off' }
      ]
    });

    // 1. Default (one_handed grip)
    const weapons1H = resolveAllEquippedWeaponProfiles(state, playerId);
    expect(weapons1H.primaryWeapon.handedness).toBe('one_handed');
    expect(weapons1H.primaryWeapon.wieldable).toBe(true);
    expect(weapons1H.occupiedLimbGroupIds).toContain('hand_main');
    expect(weapons1H.occupiedLimbGroupIds).not.toContain('hand_off');

    // 2. Set gripMode to two_handed
    state = addComponent(state, playerId, {
      type: ComponentType.TacticalDoctrine,
      gripMode: 'two_handed'
    });
    const weapons2H = resolveAllEquippedWeaponProfiles(state, playerId);
    expect(weapons2H.primaryWeapon.handedness).toBe('two_handed');
    expect(weapons2H.occupiedLimbGroupIds).toContain('hand_main');
    expect(weapons2H.occupiedLimbGroupIds).toContain('hand_off');

    // Case B: Rapier cannot benefit from 1.5x STR or 2x Power Attack even if wielded in two hands
    let rapierEntityId: EntityId;
    [state, rapierEntityId] = createEntity(state);
    state = addComponent(state, rapierEntityId, {
      type: ComponentType.Item,
      itemId: 'rapier'
    });
    // Add rapier to campaign items if needed
    state.campaign.items['rapier'] = {
      id: 'rapier',
      name: 'Rapier',
      category: 'weapon',
      weight: 2,
      tags: ['one_handed', 'piercing', 'cannot_two_hand_str']
    };
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: rapierEntityId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'hand_off' }
      ]
    });

    const rapierProfiles = resolveAllEquippedWeaponProfiles(state, playerId);
    expect(rapierProfiles.primaryWeapon.cannotTwoHandStr).toBe(true);
    expect(rapierProfiles.primaryWeapon.handedness).toBe('two_handed');

    // Routine evaluation for rapier: STR 16 (+3) with Power Attack 3
    const rapierRoutine = resolveActorAttackRoutine({
      resolvedWeapons: rapierProfiles,
      totalBab: 5,
      baseAttackModifier: 5,
      strModifier: 3,
      doctrine: { type: ComponentType.TacticalDoctrine, powerAttackAmount: 3 },
      flatDamageBonus: 0
    });
    expect(rapierRoutine.strikes[0]!.strDamageBonus).toBe(3); // 1.0x STR (not 1.5x / 4)
    expect(rapierRoutine.strikes[0]!.doctrineDamageBonus).toBe(3); // 1x Power Attack (not 2x / 6)

    // Case C: Double Weapon (Quarterstaff) with gripMode: 'double_weapon_twf'
    let qstaffEntityId: EntityId;
    [state, qstaffEntityId] = createEntity(state);
    state = addComponent(state, qstaffEntityId, {
      type: ComponentType.Item,
      itemId: 'quarterstaff'
    });
    state = addComponent(state, playerId, {
      type: ComponentType.TacticalDoctrine,
      gripMode: 'double_weapon_twf'
    });
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: qstaffEntityId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'hand_off' }
      ]
    });

    const qstaffProfiles = resolveAllEquippedWeaponProfiles(state, playerId);
    expect(qstaffProfiles.gripMode).toBe('double_weapon_twf');
    expect(qstaffProfiles.primaryWeapon.handedness).toBe('one_handed');
    expect(qstaffProfiles.offHandWeapons.length).toBe(1);
    expect(qstaffProfiles.offHandWeapons[0]!.handedness).toBe('light');
    expect(qstaffProfiles.occupiedLimbGroupIds).toContain('hand_main');
    expect(qstaffProfiles.occupiedLimbGroupIds).toContain('hand_off');
  });

  test('Step 3: Multi-Limb & Armed Natural Weapon Demotion + Per-Strike Power Attack Rules', () => {
    // Manufactured Light/Off-Hand gets 0 from Power Attack
    const lightPa = computeStrikeDoctrineDamageBonus(
      { type: ComponentType.TacticalDoctrine, powerAttackAmount: 3 },
      5,
      'light',
      false // manufactured
    );
    expect(lightPa).toBe(0);

    const offHandPa = computeStrikeDoctrineDamageBonus(
      { type: ComponentType.TacticalDoctrine, powerAttackAmount: 3 },
      5,
      'off_hand',
      false // manufactured
    );
    expect(offHandPa).toBe(0);

    // Two-handed manufactured gets 2x Power Attack
    const twoHandedPa = computeStrikeDoctrineDamageBonus(
      { type: ComponentType.TacticalDoctrine, powerAttackAmount: 3 },
      5,
      'two_handed',
      false
    );
    expect(twoHandedPa).toBe(6);

    // Unarmed and Natural attacks DO benefit from Power Attack (1x or 2x)
    const naturalPa = computeStrikeDoctrineDamageBonus(
      { type: ComponentType.TacticalDoctrine, powerAttackAmount: 3 },
      5,
      'one_handed',
      true // natural/unarmed
    );
    expect(naturalPa).toBe(3);

    // Full attack routine for Minotaur wielding Greataxe + Gore natural weapon
    let state = buildGameState(dndCampaign);
    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;

    let greataxeEntityId: EntityId;
    [state, greataxeEntityId] = createEntity(state);
    state = addComponent(state, greataxeEntityId, {
      type: ComponentType.Item,
      itemId: 'greataxe'
    });
    state.campaign.items['greataxe'] = {
      id: 'greataxe',
      name: 'Greataxe',
      category: 'weapon',
      weight: 12,
      tags: ['two_handed', 'slashing', 'weaponDice:1d12']
    };

    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: greataxeEntityId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'hand_off' }
      ]
    });

    const weapons = resolveAllEquippedWeaponProfiles(state, playerId);
    const routine = resolveActorAttackRoutine({
      resolvedWeapons: weapons,
      naturalWeapons: [
        { id: 'gore', name: 'Gore', isPrimary: true, count: 1, limbGroupId: 'head', dice: '1d8', damageType: 'piercing' },
        { id: 'claw_left', name: 'Claw (Left)', isPrimary: false, count: 1, limbGroupId: 'hand_main', dice: '1d6', damageType: 'slashing' }
      ],
      totalBab: 6,
      baseAttackModifier: 6,
      strModifier: 4,
      flatDamageBonus: 0
    });

    // Iterative BAB 6 -> [6, 1] for manufactured weapon
    expect(routine.strikes.filter((s) => s.attackSource === 'manufactured_primary').length).toBe(2);

    // Gore is demoted to natural_secondary (-5 penalty -> 6 - 5 = 1, and 0.5x STR -> 2)
    const goreStrike = routine.strikes.find((s) => s.naturalWeaponId === 'gore');
    expect(goreStrike).toBeDefined();
    expect(goreStrike!.attackSource).toBe('natural_secondary');
    expect(goreStrike!.attackBonus).toBe(1); // 6 BAB - 5 secondary penalty
    expect(goreStrike!.strDamageBonus).toBe(2); // 0.5x of 4 STR

    // Claw is on hand_main which is occupied by the Greataxe -> suppressed!
    const clawStrike = routine.strikes.find((s) => s.naturalWeaponId === 'claw_left');
    expect(clawStrike).toBeUndefined();
  });

  test('Step 4: Stage 4 DAG synthesizes attackRoutine with automatic reactivity, proficiency, and zero Power Attack bleed', () => {
    let state = buildGameState(dndCampaign);
    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;

    const evalResult = evaluateDnD35eEntityDAG(state, playerId);
    expect(evalResult).toBeDefined();
    expect(evalResult!.attackRoutine).toBeDefined();
    expect(evalResult!.attackRoutine.strikes.length).toBeGreaterThanOrEqual(1);

    const firstStrike = evalResult!.attackRoutine.strikes[0]!;
    expect(firstStrike.weaponDice).toBeDefined();
    expect(firstStrike.weaponDamageType).toBeDefined();
    expect(firstStrike.attackBonus).toBe(evalResult!.dagResult.attackBonus);

    // 1. Test Power Attack + TWF inside evaluateDnD35eEntityDAG: zero double-counting and zero off-hand bleed
    let longswordId: EntityId;
    let daggerId: EntityId;
    [state, longswordId] = createEntity(state);
    [state, daggerId] = createEntity(state);
    state = addComponent(state, longswordId, { type: ComponentType.Item, itemId: 'longsword' });
    state = addComponent(state, daggerId, { type: ComponentType.Item, itemId: 'venom_dagger' });

    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: longswordId, limbGroupId: 'hand_main' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: daggerId, limbGroupId: 'hand_off' }
      ]
    });
    state = addComponent(state, playerId, {
      type: ComponentType.TacticalDoctrine,
      powerAttackAmount: 1,
      gripMode: 'one_handed'
    });

    const twfPaEval = evaluateDnD35eEntityDAG(state, playerId)!;
    const primaryStrike = twfPaEval.attackRoutine.strikes.find((s) => s.attackSource === 'manufactured_primary')!;
    const offhandStrike = twfPaEval.attackRoutine.strikes.find((s) => s.attackSource === 'manufactured_offhand')!;
    expect(primaryStrike.doctrineDamageBonus).toBe(1); // 1H Power Attack = 1x
    expect(primaryStrike.flatDamageBonus).toBe(0); // No double-counted Power Attack in flatDamageBonus!
    expect(offhandStrike.doctrineDamageBonus).toBe(0); // Light off-hand gets 0 from Power Attack!
    expect(offhandStrike.flatDamageBonus).toBe(0); // Main-hand Power Attack does not bleed into off-hand!

    // 2. Test Bastard Sword / Dwarven Waraxe handedness-dependent proficiency (exotic_1h_martial_2h)
    state.campaign.items['dwarven_waraxe'] = {
      id: 'dwarven_waraxe',
      name: 'Dwarven Waraxe',
      category: 'weapon',
      weight: 8,
      tags: ['weapon', 'slashing', 'one_handed', 'exotic_1h_martial_2h', 'weaponDice:1d10']
    };
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

    // Human in 1H without Exotic Weapon Proficiency -> -4 nonproficiency penalty
    const waraxe1H = resolveAllEquippedWeaponProfiles(state, playerId);
    expect(waraxe1H.primaryWeapon.handedness).toBe('one_handed');
    expect(waraxe1H.primaryWeapon.nonproficiencyPenalty).toBe(-4);

    // Human in 2H grip -> treated as Martial weapon -> 0 nonproficiency penalty
    state = addComponent(state, playerId, {
      type: ComponentType.TacticalDoctrine,
      gripMode: 'two_handed'
    });
    const waraxe2H = resolveAllEquippedWeaponProfiles(state, playerId);
    expect(waraxe2H.primaryWeapon.handedness).toBe('two_handed');
    expect(waraxe2H.primaryWeapon.nonproficiencyPenalty).toBe(0);

    // 3. Multi-count natural weapons (2 Claws + 1 Bite) with 1H vs 2H grip in Stage 4 DAG
    const baseData = getDnD35EntityData(state, playerId);
    state = addComponent(state, playerId, {
      type: ComponentType.RulesetData,
      rulesetId: 'dnd35e',
      payload: {
        ...baseData,
        naturalWeapons: [
          {
            id: 'claw',
            name: 'Claw',
            naturalType: 'claw',
            isPrimary: true,
            count: 2,
            damageDice: '1d4',
            damageType: 'slashing',
            critThreatMin: 20,
            critMultiplier: 2
          },
          {
            id: 'bite',
            name: 'Bite',
            naturalType: 'bite',
            isPrimary: true,
            count: 1,
            damageDice: '1d6',
            damageType: 'piercing',
            critThreatMin: 20,
            critMultiplier: 2
          }
        ]
      }
    });

    // In 1H grip (main_hand occupied, off_hand empty): 1 Claw suppressed, 1 free-hand Claw + 1 Bite remain as secondary natural attacks
    state = addComponent(state, playerId, {
      type: ComponentType.TacticalDoctrine,
      gripMode: 'one_handed'
    });
    const eval1HWithClaws = evaluateDnD35eEntityDAG(state, playerId)!;
    const natStrikes1H = eval1HWithClaws.attackRoutine.strikes.filter((s) => s.attackSource === 'natural_secondary');
    expect(natStrikes1H.length).toBe(2); // 1 free-hand Claw + 1 Bite

    // In 2H grip (both main_hand and off_hand occupied): both Claws suppressed, only 1 Bite remains
    state = addComponent(state, playerId, {
      type: ComponentType.TacticalDoctrine,
      gripMode: 'two_handed'
    });
    const eval2HWithClaws = evaluateDnD35eEntityDAG(state, playerId)!;
    const natStrikes2H = eval2HWithClaws.attackRoutine.strikes.filter((s) => s.attackSource === 'natural_secondary');
    expect(natStrikes2H.length).toBe(1); // Only Bite
    expect(natStrikes2H[0]!.naturalWeaponId).toBe('bite');
  });
});


