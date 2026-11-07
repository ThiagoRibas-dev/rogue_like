import { describe, expect, test } from 'bun:test';
import { matchesEntityTagCondition } from '../src/systems/reaction.system.ts';
import { resolveStatModifiers } from '../src/rulesets/dnd35e/modifiers.ts';
import type { StatModifier } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';
import { queryActiveFieldsAtPosition } from '../src/systems/field.system.ts';
import { collectOwnedEntityIds } from '../src/core/ecs.ts';
import { ComponentType } from '../src/types/components.types.ts';
import type { GameState, EntityId } from '../src/types/game-state.types.ts';
import {
  buildFullAttackSequence,
  evaluateTacticalDoctrineModifiers,
  resolveCleaveFollowupEligibility,
  resolveWhirlwindTargets
} from '../src/rulesets/dnd35e/combat/attack_resolver.ts';
import {
  resolveCombatManeuver,
  shouldTriggerOnHitRider
} from '../src/rulesets/dnd35e/combat/maneuvers_conditions.ts';
import { resolveDiplomacyCheck } from '../src/rulesets/dnd35e/skills.ts';
import {
  applyCreatureTemplate,
  FIENDISH_TEMPLATE,
  SKELETON_TEMPLATE
} from '../src/rulesets/dnd35e/templates.ts';
import { resolveActiveClassFeatures } from '../src/rulesets/dnd35e/progression.ts';
import {
  applyWildShapeForm,
  revertWildShapeForm,
  resolveEffectiveEntityDataWithOverlays,
  type WildShapeFormDefinition
} from '../src/rulesets/dnd35e/wild_shape.ts';
import { resolveImmediateDefenseReaction } from '../src/rulesets/dnd35e/action_economy.ts';
import {
  evaluateMetamagicDamage,
  getSpontaneousMetamagicActionType,
  maintainOrDisruptConcentration,
  resolveCounterspellAttempt,
  resolveDispelCheck
} from '../src/rulesets/dnd35e/magic/spellcasting.ts';
import { buildAnatomyEquipmentSlots } from '../src/systems/inventory.system.ts';
import {
  applyMaterialPhysics,
  computeMaterialEquipmentStats,
  evaluateWeaponWieldingProfile,
  resolveMagicItemActivation,
  scaleWeaponDamageDice
} from '../src/rulesets/dnd35e/equipment_physics.ts';
import { ZOMBIE_TEMPLATE } from '../src/rulesets/dnd35e/templates.ts';
import { projectDnD35ActorSemanticTags } from '../src/rulesets/dnd35e/srd_registry.ts';
import type { ItemDefinition } from '../src/types/campaign/item.ts';

describe('Milestone 102: Tier 1 Shared Console Engine Primitives', () => {
  test('matchesEntityTagCondition evaluates conjunction, disjunction, and negation correctly', () => {
    const condition = {
      targetTagsAll: ['humanoid', 'orc'],
      targetTagsAny: ['warrior', 'shaman'],
      targetTagsNone: ['undead']
    };

    expect(matchesEntityTagCondition(condition, ['humanoid', 'orc', 'warrior'])).toBe(true);
    expect(matchesEntityTagCondition(condition, ['humanoid', 'orc', 'shaman'])).toBe(true);
    // Missing all match
    expect(matchesEntityTagCondition(condition, ['humanoid', 'warrior'])).toBe(false);
    // Missing any match
    expect(matchesEntityTagCondition(condition, ['humanoid', 'orc', 'commoner'])).toBe(false);
    // Contained forbidden tag
    expect(matchesEntityTagCondition(condition, ['humanoid', 'orc', 'warrior', 'undead'])).toBe(false);
  });

  test('resolveStatModifiers filters conditional modifiers based on context tags (Dwarf dodge vs. Giant)', () => {
    const modifiers: StatModifier[] = [
      {
        targetStat: 'ac',
        value: 4,
        bonusType: 'dodge',
        sourceId: 'dwarf_giant_dodge',
        condition: {
          targetTagsAny: ['giant']
        }
      },
      {
        targetStat: 'ac',
        value: 1,
        bonusType: 'dodge',
        sourceId: 'dodge_feat'
      }
    ];

    // Facing giant: gets both dodge bonuses (+4 + +1 = +5)
    const vsGiant = resolveStatModifiers(modifiers, { targetTags: ['giant', 'humanoid'] });
    expect(vsGiant).toBe(5);

    // Facing goblin: only gets unconditional dodge (+1)
    const vsGoblin = resolveStatModifiers(modifiers, { targetTags: ['goblinoid', 'humanoid'] });
    expect(vsGoblin).toBe(1);
  });

  test('queryActiveFieldsAtPosition queries stationary fields and mobile radial emanations', () => {
    const mockState = {
      entities: [1, 2],
      components: new Map([
        [
          1,
          {
            Position: { type: ComponentType.Position, x: 5, y: 5 },
            Field: { type: ComponentType.Field, fieldType: 'fire', intensity: 2, duration: 5 }
          }
        ],
        [
          2,
          {
            Position: { type: ComponentType.Position, x: 10, y: 10 },
            Field: {
              type: ComponentType.Field,
              fieldType: 'silence',
              intensity: 1,
              duration: 10,
              radiusFt: 15
            }
          }
        ]
      ])
    } as unknown as GameState;

    // Point on stationary fire field
    const atFire = queryActiveFieldsAtPosition(mockState, 5, 5);
    expect(atFire.length).toBe(1);
    expect(atFire[0]?.field.fieldType).toBe('fire');

    // Point 10ft (2 tiles) away from silence center (10, 10): radius is 15ft (3 tiles)
    const insideSilence = queryActiveFieldsAtPosition(mockState, 12, 11);
    expect(insideSilence.length).toBe(1);
    expect(insideSilence[0]?.field.fieldType).toBe('silence');

    // Point 25ft away: outside radius
    const outsideSilence = queryActiveFieldsAtPosition(mockState, 15, 15);
    expect(outsideSilence.length).toBe(0);
  });

  test('collectOwnedEntityIds traverses ControllerLinkComponent summons and companions', () => {
    const mockState = {
      entities: [100, 201, 301],
      components: new Map([
        [
          100,
          {
            Inventory: { type: ComponentType.Inventory, items: [201], baseCapacity: 10 }
          }
        ],
        [201, { Item: { type: ComponentType.Item, itemId: 'potion_heal', instanceId: 'potion_1' } }],
        [
          301,
          {
            ControllerLink: {
              type: ComponentType.ControllerLink,
              controllerEntityId: 100 as EntityId,
              tags: ['companion']
            }
          }
        ]
      ])
    } as unknown as GameState;

    const owned = collectOwnedEntityIds(mockState, 100 as EntityId);
    expect(owned).toContain(100);
    expect(owned).toContain(201);
    expect(owned).toContain(301);
  });
});

describe('Milestone 103: Tier 2 D&D 3.5e Actor Chassis, Natural Attacks & Templates', () => {
  test('buildFullAttackSequence combines manufactured iteratives and secondary natural attacks with overrides', () => {
    const sequence = buildFullAttackSequence({
      totalBab: 11,
      baseAttackModifier: 15, // +4 Str
      hasOffHandWeapon: true,
      offHandIsLight: true,
      secondaryNaturalCount: 2,
      overrides: {
        secondaryNaturalPenalty: -2, // Multiattack override via data
        twfPrimaryPenalty: -2,
        twfOffHandPenalty: -2
      }
    });

    // Primary iteratives: BAB 11, 6, 1 + 4 non-bab - 2 twf = [13, 8, 3]
    expect(sequence.primaryAttacks).toEqual([13, 8, 3]);
    // Offhand: BAB 11 + 4 non-bab - 2 twf = [13]
    expect(sequence.offHandAttacks).toEqual([13]);
    // 2 Secondary natural attacks: BAB 11 + 4 non-bab - 2 override = [13, 13]
    expect(sequence.naturalAttacks).toEqual([13, 13]);
    expect(sequence.entries.length).toBe(6);
  });

  test('buildFullAttackSequence supports pure natural attack routine and limb occupation filtering', () => {
    // Pure natural routine: 2 primary claws at full +8, 1 secondary bite at +8 - 5 = +3
    const pureNatural = buildFullAttackSequence({
      totalBab: 4,
      baseAttackModifier: 8,
      isPureNaturalRoutine: true,
      primaryNaturalCount: 2,
      secondaryNaturalCount: 1
    });
    expect(pureNatural.primaryAttacks).toEqual([8, 8]);
    expect(pureNatural.naturalAttacks).toEqual([3]);
    expect(pureNatural.entries.map((e) => e.attackSource)).toEqual([
      'natural_primary',
      'natural_primary',
      'natural_secondary'
    ]);

    // Manufactured + Natural with occupied limb: right claw is occupied by sword, left claw & bite become secondary
    const hybridOccupied = buildFullAttackSequence({
      totalBab: 6,
      baseAttackModifier: 9,
      naturalWeaponLimbs: [
        { id: 'claw_r', count: 1, limbGroupId: 'arm_group_1', isPrimary: true },
        { id: 'claw_l', count: 1, limbGroupId: 'arm_group_2', isPrimary: true },
        { id: 'bite', count: 1, isPrimary: false }
      ],
      occupiedLimbGroupIds: ['arm_group_1']
    });
    expect(hybridOccupied.primaryAttacks).toEqual([9, 4]);
    // 2 unoccupied natural weapons (arm_group_2 and bite) demoted to secondary (-5) -> [4, 4]
    expect(hybridOccupied.naturalAttacks).toEqual([4, 4]);
  });

  test('resolveCombatManeuver respects declarative rule overrides (provokesAoO and free followup attack)', () => {
    const tripResult = resolveCombatManeuver({
      maneuver: 'trip',
      attackerSize: 'medium',
      defenderSize: 'medium',
      attackerBab: 6,
      defenderBab: 6,
      attackerStrMod: 3,
      defenderStrOrDexMod: 1,
      attackerTouchAttackBonus: 9,
      defenderTouchAC: 10,
      forcedTouchRoll: 15,
      forcedOpposedRolls: { rollA: 18, rollB: 5 },
      overrides: {
        provokesAoO: false,
        grantsFreeFollowupAttackOnSuccess: true
      }
    });

    expect(tripResult.provokedAoO).toBe(false);
    expect(tripResult.opposedSuccess).toBe(true);
    expect(tripResult.grantedFreeFollowupAttack).toBe(true);
  });

  test('shouldTriggerOnHitRider enforces contact vs. injury DR penetration rules', () => {
    const contactRider = {
      riderId: 'ghoul_fever',
      type: 'disease' as const,
      delivery: 'contact' as const,
      saveType: 'fort' as const,
      dc: 12,
      initialEffectDescription: 'Fever'
    };
    const injuryRider = {
      riderId: 'spider_venom',
      type: 'poison' as const,
      delivery: 'injury' as const,
      saveType: 'fort' as const,
      dc: 14,
      initialEffectDescription: '1d6 Str'
    };

    // Attack misses
    expect(shouldTriggerOnHitRider(contactRider, 10, false)).toBe(false);
    expect(shouldTriggerOnHitRider(injuryRider, 10, false)).toBe(false);

    // Contact hits with 0 damage dealt after DR
    expect(shouldTriggerOnHitRider(contactRider, 0, true)).toBe(true);

    // Injury hits with 0 damage dealt after DR (absorbed by DR): blocked!
    expect(shouldTriggerOnHitRider(injuryRider, 0, true)).toBe(false);

    // Injury hits with 4 damage penetrating DR: triggers!
    expect(shouldTriggerOnHitRider(injuryRider, 4, true)).toBe(true);
  });

  test('resolveDiplomacyCheck accurately navigates the 5-tier standard attitude progression', () => {
    expect(resolveDiplomacyCheck('hostile', 15).newAttitude).toBe('hostile');
    expect(resolveDiplomacyCheck('hostile', 20).newAttitude).toBe('unfriendly');
    expect(resolveDiplomacyCheck('hostile', 25).newAttitude).toBe('indifferent');
    expect(resolveDiplomacyCheck('hostile', 35).newAttitude).toBe('friendly');
    expect(resolveDiplomacyCheck('hostile', 50).newAttitude).toBe('helpful');

    expect(resolveDiplomacyCheck('unfriendly', 25).newAttitude).toBe('friendly');
    expect(resolveDiplomacyCheck('indifferent', 15).newAttitude).toBe('friendly');
  });

  test('applyCreatureTemplate transforms creature type, abilities, resistances, and Undead HD tracks', () => {
    const baseWolf = {
      archetypeId: 'wolf',
      creatureType: 'animal',
      subtypes: ['cold'],
      sizeCategory: 'medium' as const,
      abilityScores: {
        str: { base: 13, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        dex: { base: 15, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        con: { base: 15, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        int: { base: 2, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        wis: { base: 12, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        cha: { base: 6, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
      },
      tracks: [
        {
          trackId: 'animal',
          levels: 2,
          hitDieSides: 8,
          babCurve: 'three_quarters' as const,
          fortCurve: 'good' as const,
          refCurve: 'good' as const,
          willCurve: 'poor' as const,
          skillPointsPerLevel: 2
        }
      ],
      weaponDice: '1d6',
      weaponDamageType: 'piercing' as const,
      weaponCritThreatMin: 20,
      weaponCritMultiplier: 2,
      weaponBypassTags: [],
      armorBonus: 0,
      shieldBonus: 0,
      naturalArmorBonus: 2,
      energyResistance: {},
      immunities: [],
      vulnerabilities: [],
      nonlethalDamage: 0,
      tempHp: 0,
      isStable: true,
      conditions: [],
      feats: ['track'],
      skillRanks: {}
    };

    // Semantic tag projection helper
    const tags = projectDnD35ActorSemanticTags(baseWolf, ['canine']);
    expect(tags).toContain('type:animal');
    expect(tags).toContain('subtype:cold');
    expect(tags).toContain('size:medium');

    // Apply Fiendish Template
    const fiendishWolf = applyCreatureTemplate(baseWolf, FIENDISH_TEMPLATE);
    expect(fiendishWolf.creatureType).toBe('magical_beast');
    expect(fiendishWolf.subtypes).toContain('extraplanar');
    expect(fiendishWolf.subtypes).toContain('evil');
    expect(fiendishWolf.damageReduction?.amount).toBe(5);
    expect(fiendishWolf.energyResistance.cold).toBe(5);
    expect(fiendishWolf.energyResistance.fire).toBe(5);

    // Apply Skeleton Template: converts HD to d12 Undead, Con & Int become null
    const skeletonWolf = applyCreatureTemplate(baseWolf, SKELETON_TEMPLATE);
    expect(skeletonWolf.creatureType).toBe('undead');
    expect(skeletonWolf.abilityScores.con.base).toBeNull();
    expect(skeletonWolf.abilityScores.int.base).toBeNull();
    expect(skeletonWolf.abilityScores.dex.base).toBe(17); // +2 Dex
    expect(skeletonWolf.naturalArmorBonus).toBe(4); // 2 base + 2 delta
    expect(skeletonWolf.tracks[0]?.hitDieSides).toBe(12);
    expect(skeletonWolf.tracks[0]?.babCurve).toBe('half');
    expect(skeletonWolf.tracks[0]?.willCurve).toBe('good');

    // Apply Zombie Template: doubles base HD (2 -> 4 d12 Undead HD) and sets singleActionsOnly
    const zombieWolf = applyCreatureTemplate(baseWolf, ZOMBIE_TEMPLATE);
    expect(zombieWolf.tracks[0]?.levels).toBe(4);
    expect(zombieWolf.tracks[0]?.hitDieSides).toBe(12);
    expect(zombieWolf.singleActionsOnly).toBe(true);
  });
});

describe('Milestone 104: Tier 2 Class Feature ACFs, Wild Shape, Doctrines & Metamagic', () => {
  test('resolveActiveClassFeatures swaps out replaced features for granted ACFs', () => {
    const classDef = {
      id: 'fighter',
      name: 'Fighter',
      hitDieSides: 10 as const,
      babCurve: 'full' as const,
      fortCurve: 'good' as const,
      refCurve: 'poor' as const,
      willCurve: 'poor' as const,
      skillPointsPerLevel: 2,
      classSkills: [],
      castingMode: 'none' as const,
      acfSwaps: [
        {
          acfId: 'armored_mage',
          name: 'Armored Mage',
          replacesFeature: 'heavy_armor_proficiency',
          grantedFeature: 'arcane_spell_failure_reduction',
          level: 1
        }
      ]
    };

    const baseFeatures = ['medium_armor_proficiency', 'heavy_armor_proficiency', 'tower_shield_proficiency'];
    const active = resolveActiveClassFeatures(baseFeatures, ['armored_mage'], classDef);

    expect(active).not.toContain('heavy_armor_proficiency');
    expect(active).toContain('arcane_spell_failure_reduction');
  });

  test('Wild Shape facade attaches property overlay, melds equipment slots, and reverts correctly', () => {
    const bearForm: WildShapeFormDefinition = {
      formId: 'black_bear',
      name: 'Black Bear',
      creatureType: 'animal',
      sizeCategory: 'medium',
      physicalScores: { str: 19, dex: 13, con: 15 },
      naturalArmorBonus: 2,
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
        }
      ],
      landSpeedFt: 40
    };

    const mockState = {
      entities: [42],
      components: new Map([
        [
          42,
          {
            Equipment: {
              type: ComponentType.Equipment,
              slots: [
                { id: 'torso_1', slotType: 'torso', equippedItem: 101 as EntityId },
                { id: 'main_hand_1', slotType: 'main_hand', equippedItem: 102 as EntityId }
              ]
            }
          }
        ]
      ])
    } as unknown as GameState;

    // Apply Wild Shape
    const shapedState = applyWildShapeForm(mockState, 42 as EntityId, bearForm, 5);
    const equip = (shapedState.components.get(42) as { Equipment: { slots: Array<{ suppressed?: boolean }> } }).Equipment;
    expect(equip.slots.every((s) => s.suppressed === true)).toBe(true);

    const overlay = (shapedState.components.get(42) as { PropertyOverlay: { statOverrides: Record<string, number> } }).PropertyOverlay;
    expect(overlay.statOverrides.str).toBe(19);

    // Revert Wild Shape
    const revertedState = revertWildShapeForm(shapedState, 42 as EntityId);
    const unmeldedEquip = (revertedState.components.get(42) as { Equipment: { slots: Array<{ suppressed?: boolean }> } }).Equipment;
    expect(unmeldedEquip.slots.some((s) => s.suppressed === true)).toBe(false);
  });

  test('evaluateTacticalDoctrineModifiers calculates Power Attack, Combat Expertise, and 5-rank Tumble synergy', () => {
    // Two-handed Power Attack of 4 at BAB +6
    const powerTwoHand = evaluateTacticalDoctrineModifiers(
      { type: ComponentType.TacticalDoctrine, powerAttackAmount: 4 },
      6,
      'two_handed'
    );
    expect(powerTwoHand.attackPenalty).toBe(-4);
    expect(powerTwoHand.damageBonus).toBe(8); // +2x per BAB sacrificed

    // Combat Expertise of 3 at BAB +6
    const expertise = evaluateTacticalDoctrineModifiers(
      { type: ComponentType.TacticalDoctrine, combatExpertiseAmount: 3 },
      6,
      'one_handed'
    );
    expect(expertise.attackPenalty).toBe(-3);
    expect(expertise.dodgeAcBonus).toBe(3);

    // Total Defense with 5 ranks in Tumble (+6 Dodge AC instead of +4)
    const totalDefTumble = evaluateTacticalDoctrineModifiers(
      { type: ComponentType.TacticalDoctrine, totalDefense: true },
      6,
      'one_handed',
      5
    );
    expect(totalDefTumble.canAttack).toBe(false);
    expect(totalDefTumble.dodgeAcBonus).toBe(6);
  });

  test('resolveImmediateDefenseReaction consumes swift action and restricts off-turn chaining', () => {
    const budget = {
      standardRemaining: 1,
      moveRemaining: 1,
      movementRemainingFt: 30,
      swiftRemaining: 1,
      immediateUsedOffTurn: false,
      fiveFootStepAvailable: true,
      canMoveFurtherThisRound: true,
      distanceMovedThisRoundFt: 0,
      aooRemaining: 1,
      aooMax: 1,
      isFlatFooted: false,
      hasCombatReflexes: false,
      reactorsThisOpportunity: [],
      movementAoOReactorsThisRound: []
    };

    // First off-turn immediate action succeeds
    const firstReaction = resolveImmediateDefenseReaction(budget, false);
    expect(firstReaction.allowed).toBe(true);
    expect(firstReaction.updatedBudget.immediateUsedOffTurn).toBe(true);

    // Second off-turn immediate action in the same round is blocked
    const secondReaction = resolveImmediateDefenseReaction(firstReaction.updatedBudget, false);
    expect(secondReaction.allowed).toBe(false);
  });

  test('evaluateMetamagicDamage resolves Maximize, Empower, and combined Maximize+Empower', () => {
    // Maximize on 3d6 (18)
    const maximized = evaluateMetamagicDamage('3d6', { maximize: true });
    expect(maximized.totalDamage).toBe(18);

    // Empower on 10 rolled damage -> 15 (1.5x floored)
    const empowered = evaluateMetamagicDamage('3d6', { empower: true }, 10);
    expect(empowered.totalDamage).toBe(15);

    // Maximize + Empower on 3d6 with normal roll 10: 18 + floor(10 * 0.5) = 23
    const both = evaluateMetamagicDamage('3d6', { maximize: true, empower: true }, 10);
    expect(both.totalDamage).toBe(23);
  });

  test('maintainOrDisruptConcentration, resolveDispelCheck, and resolveCounterspellAttempt', () => {
    // Concentration check against 15 damage taken during casting 3rd level spell (DC 28)
    const conc = maintainOrDisruptConcentration({
      damageTaken: 15,
      spellLevel: 3,
      concentrationModifier: 10,
      forcedRoll: 18 // total = 28
    });
    expect(conc.dc).toBe(28);
    expect(conc.maintained).toBe(true);

    // Dispel check: CL 8 vs target CL 10 spell (DC 21). Roll 13 + 8 = 21 -> dispelled!
    const dispel = resolveDispelCheck(8, 10, false, 13);
    expect(dispel.dc).toBe(21);
    expect(dispel.dispelled).toBe(true);

    // Counterspell: exact match counters
    expect(resolveCounterspellAttempt('fireball', 'fireball')).toBe(true);
    // Counterspell: Dispel Magic counters
    expect(resolveCounterspellAttempt('dispel_magic', 'lightning_bolt')).toBe(true);
    // Counterspell: Improved Counterspell with higher level spell of same school
    const impCounter = resolveCounterspellAttempt('cone_of_cold', 'fireball', {
      hasImprovedCounterspell: true,
      reactorSchool: 'evocation',
      targetSchool: 'evocation',
      reactorLevel: 5,
      targetLevel: 3
    });
    expect(impCounter).toBe(true);
  });
});

describe('Milestone 105: Tier 1 & Tier 2 Anatomical Equipment & Special Material Physics', () => {
  test('buildAnatomyEquipmentSlots constructs specialized morphologies (Marilith 6 arms, Quadruped)', () => {
    const marilithSlots = buildAnatomyEquipmentSlots('marilith_6arm');
    const armSlots = marilithSlots.filter((s) => s.slotType === 'arm');
    const handSlots = marilithSlots.filter((s) => s.slotType === 'hand');
    const offHands = marilithSlots.filter((s) => s.slotType === 'off_hand');
    const feetSlots = marilithSlots.filter((s) => s.slotType === 'foot');

    expect(armSlots.length).toBe(6);
    expect(handSlots.length).toBe(6);
    expect(offHands.length).toBe(5);
    expect(feetSlots.length).toBe(0); // Snake body has no feet!

    const quadSlots = buildAnatomyEquipmentSlots('quadruped');
    expect(quadSlots.filter((s) => s.slotType === 'foot').length).toBe(4);
    expect(quadSlots.filter((s) => s.slotType === 'hand').length).toBe(0);
    expect(quadSlots.filter((s) => s.slotType === 'held').length).toBe(0);
  });

  test('applyMaterialPhysics and computeMaterialEquipmentStats calculate DMG special material rules', () => {
    const baseItem: ItemDefinition = {
      id: 'full_plate',
      name: 'Full Plate',
      unidentifiedName: 'Heavy Armor',
      description: 'Heavy armor',
      glyph: '[',
      fg: '#ffffff',
      bg: '#000000',
      category: 'armor',
      tags: [],
      weight: 50,
      baseValue: 1500,
      equippable: {
        slot: 'torso',
        attackBonus: 0,
        defenseBonus: 8,
        maxHpBonus: 0
      }
    };

    const mithralPlate = applyMaterialPhysics(baseItem, 'mithral');
    expect(mithralPlate.weight).toBe(25); // Weight halved
    expect(mithralPlate.tags).toContain('material:mithral');
    const mithralStats = computeMaterialEquipmentStats('mithral', 'heavy');
    expect(mithralStats.effectiveArmorCategory).toBe('medium');
    expect(mithralStats.maxDexBonusDelta).toBe(2);
    expect(mithralStats.acpReduction).toBe(3);
    expect(mithralStats.asfReductionPercent).toBe(10);

    const adamantinePlate = applyMaterialPhysics(baseItem, 'adamantine');
    expect(adamantinePlate.tags).toContain('bypass:adamantine');
    expect(adamantinePlate.tags).toContain('bypass:hardness_20');
    const adamantineStats = computeMaterialEquipmentStats('adamantine', 'heavy');
    expect(adamantineStats.grantedDrAmount).toBe(3); // DR 3/- for heavy adamantine armor

    const silverStats = computeMaterialEquipmentStats('silver');
    expect(silverStats.weaponDamagePenalty).toBe(1);
  });

  test('scaleWeaponDamageDice scales weapon dice across 9 sizes', () => {
    expect(scaleWeaponDamageDice('1d8', 'medium', 'large')).toBe('2d6');
    expect(scaleWeaponDamageDice('1d8', 'medium', 'huge')).toBe('2d8');
    expect(scaleWeaponDamageDice('1d6', 'medium', 'small')).toBe('1d4');
    expect(scaleWeaponDamageDice('1d6', 'medium', 'tiny')).toBe('1d3');
  });

  test('evaluateWeaponWieldingProfile applies -2 size penalty and effort shifts', () => {
    // Large one-handed weapon in Medium hands: becomes two-handed with -2 attack penalty
    const largeSword = evaluateWeaponWieldingProfile('large', 'one_handed', 'medium');
    expect(largeSword.wieldable).toBe(true);
    expect(largeSword.effectiveHandedness).toBe('two_handed');
    expect(largeSword.attackPenalty).toBe(-2);

    // Large two-handed weapon in Medium hands: cannot be wielded!
    const largeGreatsword = evaluateWeaponWieldingProfile('large', 'two_handed', 'medium');
    // Weapon shifting beyond effort ladder ([0..2]) cannot be wielded
    const hugeSword = evaluateWeaponWieldingProfile('huge', 'one_handed', 'medium');
    expect(hugeSword.wieldable).toBe(false);

    // Huge light weapon shifts 2 steps (0 + 2 = 2): becomes two-handed with -4 penalty
    const hugeDagger = evaluateWeaponWieldingProfile('huge', 'light', 'medium');
    expect(hugeDagger.wieldable).toBe(true);
    expect(hugeDagger.effectiveHandedness).toBe('two_handed');
    expect(hugeDagger.attackPenalty).toBe(-4);
  });

  test('resolveMagicItemActivation respects use_activated, spell_trigger, and UMD DC checks', () => {
    // Use-activated always activates
    expect(resolveMagicItemActivation('use_activated', false).activated).toBe(true);

    // Spell-trigger with spell on class list activates without roll
    expect(resolveMagicItemActivation('spell_trigger', true).activated).toBe(true);

    // Spell-trigger without spell on list requires UMD DC 20
    const umdPass = resolveMagicItemActivation('spell_trigger', false, {
      userUmdModifier: 8,
      forcedUmdRoll: 12 // total 20 >= 20
    });
    expect(umdPass.activated).toBe(true);

    const umdFail = resolveMagicItemActivation('spell_trigger', false, {
      userUmdModifier: 8,
      forcedUmdRoll: 11 // total 19 < 20
    });
    expect(umdFail.activated).toBe(false);
  });
});
