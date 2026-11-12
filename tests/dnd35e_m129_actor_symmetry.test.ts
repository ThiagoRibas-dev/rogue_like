import { describe, expect, it } from 'bun:test';
import { getComponent, spawnEntity } from '../src/core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent
} from '../src/types/components.types.ts';
import { hydrateArchetypeData } from '../src/rulesets/dnd35e/archetype_resolver.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { parseParameterizedFeatId } from '../src/rulesets/dnd35e/effect_bundle.ts';
import { resolveAllEquippedWeaponProfiles } from '../src/rulesets/dnd35e/equipment_physics.ts';
import { applyRaceToActorChassis, evaluateRacialModifiers } from '../src/rulesets/dnd35e/races.ts';
import type { DnD35EntityData } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';
import { validateDnD35eSystemContentIntegrity } from '../src/rulesets/dnd35e/dnd35e_validator.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function createBlankEntityData(): DnD35EntityData {
  const makeScore = (val: number) => ({
    base: val,
    inherentBonus: 0,
    damage: 0,
    drain: 0,
    tempPenalty: 0
  });
  return {
    archetypeId: 'test',
    sizeCategory: 'medium',
    abilityScores: {
      str: makeScore(10),
      dex: makeScore(10),
      con: makeScore(10),
      int: makeScore(10),
      wis: makeScore(10),
      cha: makeScore(10)
    },
    tracks: [],
    naturalArmorBonus: 0,
    armorBonus: 0,
    shieldBonus: 0,
    weaponDice: '1d3',
    weaponDamageType: 'bludgeoning',
    weaponCritThreatMin: 20,
    weaponCritMultiplier: 2,
    weaponBypassTags: ['bludgeoning'],
    naturalWeapons: [],
    subtypes: [],
    energyResistance: {},
    immunities: [],
    vulnerabilities: [],
    nonlethalDamage: 0,
    tempHp: 0,
    isStable: true,
    conditions: [],
    feats: [],
    skillRanks: {},
    statModifiers: []
  };
}

describe('Universal Actor Symmetry & Armament Equipping (Milestones 129 & 130)', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const sys = campaign.systemContent as unknown as import('../src/rulesets/dnd35e/types/dnd35e_system.types.ts').DnD35SystemContent;

  it('validates 100% referential integrity across system content with defaultEquipment', () => {
    const errors = validateDnD35eSystemContentIntegrity(sys);
    expect(errors).toEqual([]);
  });

  it('evaluates racial modifiers symmetrically across evaluateRacialModifiers, applyRaceToActorChassis, and hydrateArchetypeData', () => {
    const dwarfRace = sys.races['dwarf']!;
    expect(dwarfRace).toBeDefined();

    const racialMods = evaluateRacialModifiers(dwarfRace);
    expect(racialMods.statModifiers.length).toBeGreaterThan(0);
    // Dwarf has save bonuses vs poison and spells (+2 racial), and dodge AC vs giants (+4)
    const giantDodgeMod = racialMods.statModifiers.find((m) => m.sourceId.includes('dodge_vs_giants'));
    expect(giantDodgeMod).toBeDefined();
    expect(giantDodgeMod?.value).toBe(4);
    expect(giantDodgeMod?.condition?.targetTagsAny).toContain('type:giant');

    // Applied chassis
    const baseChassis = createBlankEntityData();
    const applied = applyRaceToActorChassis(baseChassis, dwarfRace);
    expect(applied.entityData.raceId).toBe('dwarf');
    expect(applied.entityData.sizeCategory).toBe('medium');
    expect(applied.entityData.abilityScores.con.base).toBe(12); // +2 Con
    expect(applied.entityData.abilityScores.cha.base).toBe(8); // -2 Cha
    expect(applied.entityData.statModifiers.some((m) => m.sourceId.includes('dodge_vs_giants'))).toBe(true);

    // Archetype hydrator
    const hydrated = hydrateArchetypeData(dwarfRace, undefined, campaign.systemContent as Record<string, unknown>);
    expect(hydrated.raceId).toBe('dwarf');
    expect(hydrated.abilityScores.con.base).toBe(12);
    expect(hydrated.abilityScores.cha.base).toBe(8);
    expect(hydrated.statModifiers.some((m) => m.sourceId.includes('dodge_vs_giants'))).toBe(true);
  });

  it('prevents 1st-level Monster Manual Warrior feats from leaking onto character chassis without warrior levels', () => {
    const orcRace = sys.races['orc']!;
    expect(orcRace.defaultClassLevels).toEqual([{ classId: 'warrior', levels: 1 }]);
    expect(orcRace.feats).toContain('weapon_focus:greataxe');

    const baseChassis = createBlankEntityData();
    const applied = applyRaceToActorChassis(baseChassis, orcRace);
    // Base chassis without warrior levels must NOT inherit warrior feat
    expect(applied.entityData.feats).not.toContain('weapon_focus:greataxe');
  });

  it('splits parameterized feats strictly on colon and does not guess underscores', () => {
    expect(parseParameterizedFeatId('weapon_focus:longsword')).toEqual({
      baseFeatId: 'weapon_focus',
      targetId: 'longsword'
    });
    expect(parseParameterizedFeatId('power_attack')).toEqual({
      baseFeatId: 'power_attack'
    });
    expect(parseParameterizedFeatId('weapon_focus_greataxe')).toEqual({
      baseFeatId: 'weapon_focus_greataxe'
    });
  });

  it('spawns armed monster actors with anatomical equipment slots, equips default weapons & armor, and resolves full DAG', () => {
    const state = buildGameState(campaign);
    const [spawnedState, orcEntityId] = spawnEntity(state, 'orc', 5, 5);

    const equipComp = getComponent(spawnedState, orcEntityId, ComponentType.Equipment) as EquipmentComponent | undefined;
    expect(equipComp).toBeDefined();
    expect(equipComp?.slots.length).toBeGreaterThan(10); // humanoid_biped slots

    const invComp = getComponent(spawnedState, orcEntityId, ComponentType.Inventory) as InventoryComponent | undefined;
    expect(invComp).toBeDefined();
    expect(invComp?.items.length).toBe(3); // greataxe, studded_leather_armor, and javelin

    // Check main hand and torso slots
    const mainHandSlot = equipComp?.slots.find((s) => s.slotType === 'main_hand' || s.id === 'main_hand_1');
    expect(mainHandSlot?.equippedItem).not.toBeNull();
    const torsoSlot = equipComp?.slots.find((s) => s.slotType === 'torso');
    expect(torsoSlot?.equippedItem).not.toBeNull();

    // Verify combat weapon resolution on spawned orc
    const weaponProfiles = resolveAllEquippedWeaponProfiles(spawnedState, orcEntityId);
    expect(weaponProfiles.primaryWeapon.isArmed).toBe(true);
    expect(weaponProfiles.primaryWeapon.weaponItemId).toBe('greataxe');
    expect(weaponProfiles.primaryWeapon.weaponDamageType).toBe('slashing');
    expect(weaponProfiles.primaryWeapon.critMultiplier).toBe(3);

    // Verify full 4-Stage DAG on spawned orc (weapon_focus:greataxe +1 attack, studded leather +3 armor AC)
    const orcDag = evaluateDnD35eEntityDAG(spawnedState, orcEntityId);
    expect(orcDag).toBeDefined();
    expect(orcDag?.dagResult.acBreakdown.fullAC).toBe(13); // 10 base + 3 studded leather + 0 Dex
    expect(orcDag?.attackRoutine.strikes.length).toBe(1);
    expect(orcDag?.attackRoutine.strikes[0]?.weaponId).toBe('greataxe');
    expect(orcDag?.attackRoutine.strikes[0]?.weaponDice).toBe('1d12');
    // BAB +1 (Warrior 1) + STR +3 (17) + Weapon Focus +1 = +5 attack bonus
    expect(orcDag?.attackRoutine.strikes[0]?.attackBonus).toBe(5);
  });

  it('spawns Large Ogre and 6-armed Marilith with scaled weapon dice, multi-limb attack routines, and feat modifiers', () => {
    const baseState = buildGameState(campaign);
    const orcTemplate = baseState.campaign.entities['orc']!;
    const stateWithMonsters = {
      ...baseState,
      campaign: {
        ...baseState.campaign,
        entities: {
          ...baseState.campaign.entities,
          ogre: { ...orcTemplate, id: 'ogre', archetypeId: 'ogre', name: 'Ogre' },
          marilith: { ...orcTemplate, id: 'marilith', archetypeId: 'marilith', name: 'Marilith' }
        }
      }
    };

    // 1. Spawn Large Ogre: Greatclub (1d10 Medium -> 2d8 Large) + Hide Armor (+3 AC) + Weapon Focus (greatclub)
    const [stateAfterOgre, ogreId] = spawnEntity(stateWithMonsters, 'ogre', 6, 6);
    const ogreProfiles = resolveAllEquippedWeaponProfiles(stateAfterOgre, ogreId);
    expect(ogreProfiles.primaryWeapon.weaponItemId).toBe('greatclub');
    expect(ogreProfiles.primaryWeapon.weaponDice).toBe('2d8');

    const ogreDag = evaluateDnD35eEntityDAG(stateAfterOgre, ogreId);
    expect(ogreDag?.attackRoutine.strikes[0]?.weaponDice).toBe('2d8');
    // Ogre: BAB +3 (4 Giant HD), STR +5 (21), Size -1 (Large), Weapon Focus (greatclub) +1 = +8 attack bonus
    expect(ogreDag?.attackRoutine.strikes[0]?.attackBonus).toBe(8);

    // 2. Spawn 6-armed Large Marilith: 6 Large Longswords (1d8 Medium -> 2d6 Large) + Tail Slam
    const [stateAfterMarilith, marilithId] = spawnEntity(stateAfterOgre, 'marilith', 7, 7);
    const marilithEquip = getComponent(stateAfterMarilith, marilithId, ComponentType.Equipment) as EquipmentComponent | undefined;
    const equippedMainAndOffHands = marilithEquip?.slots.filter(
      (s) => (s.slotType === 'main_hand' || s.slotType === 'off_hand') && s.equippedItem !== null
    );
    expect(equippedMainAndOffHands?.length).toBe(6);

    const marilithProfiles = resolveAllEquippedWeaponProfiles(stateAfterMarilith, marilithId);
    expect(marilithProfiles.primaryWeapon.weaponItemId).toBe('longsword');
    expect(marilithProfiles.primaryWeapon.weaponDice).toBe('2d6');
    expect(marilithProfiles.offHandWeapons.length).toBe(5);
    for (const offWep of marilithProfiles.offHandWeapons) {
      expect(offWep.weaponItemId).toBe('longsword');
      expect(offWep.weaponDice).toBe('2d6');
    }

    const marilithDag = evaluateDnD35eEntityDAG(stateAfterMarilith, marilithId);
    const longswordAttacks = marilithDag?.attackRoutine.strikes.filter((a) => a.weaponId === 'longsword') ?? [];
    const tailSlamAttacks = marilithDag?.attackRoutine.strikes.filter((a) => a.naturalWeaponId === 'tail_slam') ?? [];
    // Primary longsword gets 4 iterative attacks (BAB +16 -> +16/+11/+6/+1) + 5 off-hand longswords = 9 longsword attacks + 1 tail slam
    expect(longswordAttacks.length).toBe(9);
    expect(tailSlamAttacks.length).toBe(1);
    expect(tailSlamAttacks[0]?.weaponDice).toBe('4d6');
  });

  it('resolves skeleton equipped scimitar & shield and natural claw weapons, plus zombie slam and manticore spikes', () => {
    const skeletonRace = sys.races['skeleton']!;
    expect(skeletonRace.naturalWeapons.some((w) => w.id === 'claw')).toBe(true);
    expect(skeletonRace.defaultEquipment.some((eq) => eq.itemId === 'scimitar')).toBe(true);
    expect(skeletonRace.defaultEquipment.some((eq) => eq.itemId === 'heavy_steel_shield')).toBe(true);

    const zombieRace = sys.races['zombie']!;
    expect(zombieRace.naturalWeapons.some((w) => w.id === 'slam')).toBe(true);

    const manticoreRace = sys.races['manticore']!;
    expect(manticoreRace.naturalWeapons.some((w) => w.id === 'spikes')).toBe(true);
  });
});

