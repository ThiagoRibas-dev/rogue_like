import { describe, expect, test } from 'bun:test';
import { rng } from '../src/core/rng.ts';
import { evaluateDiceExpression, rollD20 } from '../src/rulesets/dnd35e/math/dice.ts';
import {
  combineAbstractMultipliers,
  combineRealWorldMultipliers,
  dndFloor
} from '../src/rulesets/dnd35e/math/multipliers.ts';
import {
  applyAbilityScoreLoss,
  computeAbilityModifier,
  computeEffectiveAbilityScore,
  createAbilityScoreState,
  evaluateAbilityCollapseState,
  getConcentrationKeyAbility,
  isImmuneToFortitudeSave,
  isMindlessImmune
} from '../src/rulesets/dnd35e/abilities.ts';
import { computeEffectiveAC, resolveTypedModifiers } from '../src/rulesets/dnd35e/modifiers.ts';
import {
  aggregateProgressionChassis,
  computeXpThresholdForLevel,
  evaluateBabCurve,
  evaluateSaveCurve,
  getIterativeBabSequence
} from '../src/rulesets/dnd35e/progression.ts';
import { resolveOpposedCheck, resolveSkillCheck } from '../src/rulesets/dnd35e/skills.ts';
import { evaluatePrerequisiteAST } from '../src/rulesets/dnd35e/prerequisites.ts';
import {
  computeFootprintSquares,
  computeThreatenedSquares,
  isDiagonalStepBlockedByHardCorner,
  measureDnD35DistanceFt
} from '../src/rulesets/dnd35e/spatial/grid_geometry.ts';
import {
  evaluateConcealmentAndSenses,
  evaluateCover,
  isFlankingTarget
} from '../src/rulesets/dnd35e/spatial/cover_senses.ts';
import {
  consumeMovementStepFt,
  createRoundActionBudget,
  filterAndOrderAoOReactors,
  takeFiveFootStep,
  useImmediateAction
} from '../src/rulesets/dnd35e/action_economy.ts';
import {
  buildFullAttackSequence,
  computeEncumbranceState,
  resolveAttackRoll
} from '../src/rulesets/dnd35e/combat/attack_resolver.ts';
import {
  evaluateVitalityStatus,
  mitigateIncomingDamage,
  resolveSavingThrow,
  rollDyingStabilization
} from '../src/rulesets/dnd35e/combat/damage_vitality.ts';
import {
  applyConditionWithEscalation,
  resolveCombatManeuver,
  summarizeConditionEffects
} from '../src/rulesets/dnd35e/combat/maneuvers_conditions.ts';
import {
  canCastSpellOfLevel,
  computeBonusSpellSlots,
  convertPreparedSlotSpontaneously,
  resolveCastPipeline
} from '../src/rulesets/dnd35e/magic/spellcasting.ts';
import {
  computeAoEAffectedSquares,
  prepareOpenSpellSlot,
  resolveEightHourRest
} from '../src/rulesets/dnd35e/magic/aoe_rest.ts';
import {
  buildAbilityScoresRecord,
  getDnD35EntityData,
  hydrateArchetypeData
} from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';
import { queryEntities, spawnEntity, getComponent } from '../src/core/ecs.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { processMeleeAttackIntent } from '../src/systems/combat.system.ts';
import { processDamageSystem } from '../src/systems/damage.system.ts';
import { grantXp } from '../src/systems/death.system.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';

describe('D&D 3.5e Ruleset Cartridge — 6-Layer Pyramid & 3-Tier Separation Verification (Milestones 85–100)', () => {
  test('Layer 1 (M85): Seeded dice expression evaluator, d20 bounds, and abstract multiplier math', () => {
    rng.setSeed(101);
    const roll1d8 = evaluateDiceExpression('1d8+3');
    expect(roll1d8.rolls.length).toBe(1);
    expect(roll1d8.flatModifier).toBe(3);
    expect(roll1d8.total).toBe(roll1d8.rolls[0]! + 3);

    const roll4d6kh3 = evaluateDiceExpression('4d6kh3');
    expect(roll4d6kh3.rolls.length).toBe(4);
    expect(roll4d6kh3.keptRolls.length).toBe(3);

    // Nat 1 / Nat 20 apply ONLY to attack and save modes, never skill checks
    const atkNat1 = rollD20('attack', 15, 1);
    expect(atkNat1.isAutoFailure).toBe(true);
    const skillNat1 = rollD20('skill_check', 15, 1);
    expect(skillNat1.isAutoFailure).toBe(false);
    expect(skillNat1.total).toBe(16);

    const saveNat20 = rollD20('save', -2, 20);
    expect(saveNat20.isAutoSuccess).toBe(true);
    const initNat20 = rollD20('initiative', 4, 20);
    expect(initNat20.isAutoSuccess).toBe(false);

    // Abstract multiplier rule: x2 + x2 -> x3; x2 + x1.5 -> x2.5
    expect(combineAbstractMultipliers([2, 2])).toBe(3);
    expect(combineAbstractMultipliers([2, 1.5])).toBe(2.5);
    expect(combineRealWorldMultipliers([2, 2])).toBe(4);
    expect(dndFloor(3.9)).toBe(3);
  });

  test('Layer 1 (M86): 6-Ability Score model, Nonabilities (null), penalty floor 1, and collapse states', () => {
    // Nonability (CON: null on Undead hydrated from declarative public/data/rulesets/dnd35e/archetypes.json)
    const dndCampaign = loadCampaignFromDisk('dnd35e-crypt');
    const skeletonArchetype = dndCampaign.systemContent!.archetypes['skeleton']!;
    const undeadScores = hydrateArchetypeData(skeletonArchetype).abilityScores;
    expect(computeEffectiveAbilityScore(undeadScores.con)).toBeNull();
    expect(computeAbilityModifier(null)).toBe(0);
    expect(isImmuneToFortitudeSave(undeadScores, false)).toBe(true);
    expect(isImmuneToFortitudeSave(undeadScores, true)).toBe(false);
    expect(isMindlessImmune(undeadScores)).toBe(true);
    expect(getConcentrationKeyAbility(undeadScores)).toBe('cha');

    // Temporary penalty cannot reduce an active ability score below 1
    const str10 = createAbilityScoreState(10);
    const penalized = applyAbilityScoreLoss(str10, { tempPenalty: 14 });
    expect(computeEffectiveAbilityScore(penalized)).toBe(1);

    // Ability damage/drain can reduce score to 0 and trigger collapse
    const drainedCon = applyAbilityScoreLoss(createAbilityScoreState(10), { drainDelta: 10 });
    const deadRecord = {
      ...buildAbilityScoresRecord({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
      con: drainedCon
    };
    expect(evaluateAbilityCollapseState(deadRecord)).toBe('dead');
  });

  test('Layer 1 (M87): 18-Type Bonus Stacking Resolver, compound enhancement folding, Antimagic, and AC Triplet', () => {
    const modifiers = [
      { targetStat: 'ac', value: 4, bonusType: 'armor' as const, sourceId: 'chain_shirt', origin: 'mundane' as const },
      {
        targetStat: 'ac',
        value: 2,
        bonusType: 'armor_enhancement' as const,
        sourceId: 'magic_vestment',
        origin: 'spell' as const
      },
      { targetStat: 'ac', value: 4, bonusType: 'armor' as const, sourceId: 'mage_armor', origin: 'spell' as const },
      { targetStat: 'ac', value: 1, bonusType: 'dodge' as const, sourceId: 'dodge_feat', origin: 'ex' as const },
      { targetStat: 'ac', value: 1, bonusType: 'dodge' as const, sourceId: 'haste', origin: 'spell' as const },
      {
        targetStat: 'ac',
        value: 2,
        bonusType: 'deflection' as const,
        sourceId: 'ring_of_protection',
        origin: 'magical' as const
      }
    ];

    // Normal: Armor (4 + 2 = 6 beats 4) + Dodge (1 + 1 = 2) + Deflection (2) = +10
    expect(resolveTypedModifiers(modifiers)).toBe(10);

    // In Antimagic Field: spell/magical suppressed -> Armor (4) + Dodge (1) = +5
    expect(resolveTypedModifiers(modifiers, { inAntimagicField: true })).toBe(5);

    const ac = computeEffectiveAC(3, 'medium', modifiers);
    expect(ac.fullAC).toBe(23); // 10 + 3 Dex + 6 Armor + 2 Dodge + 2 Deflection
    expect(ac.touchAC).toBe(17); // 10 + 3 Dex + 2 Dodge + 2 Deflection (no Armor)
    expect(ac.flatFootedAC).toBe(18); // 10 + 6 Armor + 2 Deflection (no positive Dex or Dodge)
  });

  test('Layer 2 (M88 & M89): BAB/Save curves, iteratives, multi-source HD chassis, Skills, and Prerequisite AST', () => {
    expect(evaluateBabCurve('full', 16)).toBe(16);
    expect(evaluateBabCurve('three_quarters', 4)).toBe(3);
    expect(evaluateBabCurve('half', 5)).toBe(2);
    expect(getIterativeBabSequence(16)).toEqual([16, 11, 6, 1]);
    expect(evaluateSaveCurve('good', 4)).toBe(4);
    expect(evaluateSaveCurve('poor', 4)).toBe(1);
    expect(computeXpThresholdForLevel(1)).toBe(0);
    expect(computeXpThresholdForLevel(2)).toBe(1000);
    expect(computeXpThresholdForLevel(3)).toBe(3000);

    const chassis = aggregateProgressionChassis(
      [
        {
          trackId: 'fighter',
          levels: 2,
          hitDieSides: 10,
          babCurve: 'full',
          fortCurve: 'good',
          refCurve: 'poor',
          willCurve: 'poor',
          skillPointsPerLevel: 2
        }
      ],
      2
    );
    expect(chassis.totalHD).toBe(2);
    expect(chassis.totalBab).toBe(2);
    expect(chassis.maxHp).toBe(10 + 2 + (6 + 2)); // 1st d10 max (10+2) + 2nd d10 avg (6+2) = 20

    // Skill check with 5-rank Tumble -> Jump synergy (+2) and Swim 2x ACP
    const jumpCheck = resolveSkillCheck({
      definition: {
        skillId: 'jump',
        keyAbility: 'str',
        trainedOnly: false,
        acpMultiplier: 1,
        synergyFromSkills: ['tumble']
      },
      rawRanks: 4.5, // cross-class half rank floors to 4
      allSkillRanks: { tumble: 5, jump: 4.5 },
      keyAbilityModifier: 3,
      armorCheckPenalty: -2,
      dc: 15,
      forcedNaturalRoll: 8
    });
    expect(jumpCheck.wholeRanks).toBe(4);
    expect(jumpCheck.synergyBonus).toBe(2);
    expect(jumpCheck.totalModifier).toBe(4 + 3 + 2 - 2); // +7
    expect(jumpCheck.totalRoll).toBe(15);
    expect(jumpCheck.success).toBe(true);

    // Take 10 blocked when threatened
    const threatenedTake10 = resolveSkillCheck({
      definition: {
        skillId: 'jump',
        keyAbility: 'str',
        trainedOnly: false,
        acpMultiplier: 1,
        synergyFromSkills: []
      },
      rawRanks: 4,
      allSkillRanks: { jump: 4 },
      keyAbilityModifier: 3,
      armorCheckPenalty: 0,
      dc: 10,
      takeMode: 'take10',
      isThreatenedOrDistracted: true
    });
    expect(threatenedTake10.allowed).toBe(false);

    // Opposed check tie-breaker favors higher modifier
    const opposed = resolveOpposedCheck(6, 4, { rollA: 10, rollB: 12 });
    expect(opposed.totalA).toBe(16);
    expect(opposed.totalB).toBe(16);
    expect(opposed.winner).toBe('A');

    // Prerequisite AST
    const cleavePrereq = {
      type: 'and' as const,
      children: [
        { type: 'min_ability' as const, ability: 'str' as const, minScore: 13 },
        { type: 'has_feat' as const, featId: 'power_attack' }
      ]
    };
    expect(
      evaluatePrerequisiteAST(cleavePrereq, {
        abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
        totalBab: 1,
        skillRanks: {},
        feats: ['power_attack'],
        tags: [],
        casterLevel: 0,
        sizeCategory: 'medium'
      })
    ).toBe(true);
  });

  test('Layer 3 (M90–M92): 1-2-1-2 diagonals, footprints, reach dead zones, cover, flanking, and senses', () => {
    expect(measureDnD35DistanceFt(0, 0, 1, 1)).toBe(5);
    expect(measureDnD35DistanceFt(0, 0, 2, 2)).toBe(15); // 1-2-1-2 rule: 5 + 10 = 15 ft
    expect(measureDnD35DistanceFt(0, 0, 3, 3)).toBe(20);
    expect(measureDnD35DistanceFt(0, 0, 4, 4)).toBe(30);

    // Hard corner blocks diagonal step
    const blockedCorner = isDiagonalStepBlockedByHardCorner(0, 0, 1, 1, (x, y) => x === 1 && y === 0);
    expect(blockedCorner).toBe(true);

    // Large (2x2) footprint
    expect(computeFootprintSquares(5, 5, 'large').length).toBe(4);

    // Tiny creature (0-ft reach) threatens 0 adjacent squares
    expect(computeThreatenedSquares(5, 5, 'tiny', { minReachFt: 0, maxReachFt: 0 }).length).toBe(0);

    // Reach weapon (10-ft reach with 5-ft dead zone) does not threaten adjacent tile (5, 6)
    const reachSquares = computeThreatenedSquares(5, 5, 'medium', {
      minReachFt: 10,
      maxReachFt: 10
    });
    expect(reachSquares.some((sq) => sq.x === 5 && sq.y === 6)).toBe(false);
    expect(reachSquares.some((sq) => sq.x === 5 && sq.y === 7)).toBe(true);

    // Cover blocks AoOs; Soft Cover does not block AoOs
    const softCover = evaluateCover(
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      () => false,
      (x, y) => x === 1 && y === 0,
      true
    );
    expect(softCover.coverState).toBe('soft');
    expect(softCover.acBonus).toBe(4);
    expect(softCover.blocksAoO).toBe(false);

    // Flanking across opposite sides
    expect(isFlankingTarget({ x: 4, y: 5 }, [{ x: 6, y: 5 }], { x: 5, y: 5 })).toBe(true);

    // Senses & Concealment: Darkness grants 50% Total Concealment & blocks AoOs unless Darkvision
    const humanInDark = evaluateConcealmentAndSenses(
      'darkness',
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      {
        lowLightVision: false,
        darkvisionRangeFt: 0,
        blindsenseRangeFt: 0,
        blindsightRangeFt: 0,
        tremorsenseRangeFt: 0,
        scentRangeFt: 0
      }
    );
    expect(humanInDark.missChancePercent).toBe(50);
    expect(humanInDark.blocksAoO).toBe(true);

    const dwarfInDark = evaluateConcealmentAndSenses(
      'darkness',
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      {
        lowLightVision: false,
        darkvisionRangeFt: 60,
        blindsenseRangeFt: 0,
        blindsightRangeFt: 0,
        tremorsenseRangeFt: 0,
        scentRangeFt: 0
      }
    );
    expect(dwarfInDark.missChancePercent).toBe(0);
    expect(dwarfInDark.blocksAoO).toBe(false);
  });

  test('Layer 4 (M93 & M94): 6-second round action budget, 5-ft step, immediate debt, and LIFO AoO deduplication', () => {
    // Off-turn Immediate action consumes next turn's Swift action
    const round1 = createRoundActionBudget({
      dexModifier: 2,
      hasCombatReflexes: true,
      isFlatFooted: false
    });
    const afterOffTurnImmediate = useImmediateAction(round1, false);
    expect(afterOffTurnImmediate.allowed).toBe(true);
    expect(afterOffTurnImmediate.budget.immediateUsedOffTurn).toBe(true);

    const round2 = createRoundActionBudget({
      dexModifier: 2,
      hasCombatReflexes: true,
      isFlatFooted: false,
      immediateUsedOffTurn: afterOffTurnImmediate.budget.immediateUsedOffTurn
    });
    expect(round2.swiftRemaining).toBe(0);
    expect(round2.aooMax).toBe(3);

    // Moving 5 ft disables 5-Foot Step for the rest of the round
    const afterStep = consumeMovementStepFt(round1, 30, 5, false);
    expect(afterStep.allowed).toBe(true);
    expect(afterStep.budget.movementRemainingFt).toBe(25);
    expect(takeFiveFootStep(afterStep.budget).allowed).toBe(false);

    // LIFO AoO deduplication: leaving two threatened squares in the same round only triggers 1 movement AoO per reactor
    const firstMoveAoO = filterAndOrderAoOReactors('movement', round1, [
      {
        reactorId: 10,
        aooRemaining: 2,
        isFlatFooted: false,
        hasCombatReflexes: true,
        isArmedOrThreatening: true,
        targetHasCover: false,
        targetHasTotalConcealment: false
      },
      {
        reactorId: 20,
        aooRemaining: 1,
        isFlatFooted: false,
        hasCombatReflexes: false,
        isArmedOrThreatening: true,
        targetHasCover: false,
        targetHasTotalConcealment: false
      }
    ]);
    expect(firstMoveAoO.lifoReactorIds).toEqual([20, 10]);

    // Second movement step in same round: reactor 10 cannot make a second movement AoO even with Combat Reflexes
    const resetOpportunityBudget = {
      ...firstMoveAoO.updatedProvokerBudget,
      reactorsThisOpportunity: []
    };
    const secondMoveAoO = filterAndOrderAoOReactors('movement', resetOpportunityBudget, [
      {
        reactorId: 10,
        aooRemaining: 1,
        isFlatFooted: false,
        hasCombatReflexes: true,
        isArmedOrThreatening: true,
        targetHasCover: false,
        targetHasTotalConcealment: false
      }
    ]);
    expect(secondMoveAoO.lifoReactorIds).toEqual([]);

    // Subsequent spellcast ('action' opportunity): reactor 10 CAN make a second AoO via Combat Reflexes!
    const actionAoO = filterAndOrderAoOReactors('action', resetOpportunityBudget, [
      {
        reactorId: 10,
        aooRemaining: 1,
        isFlatFooted: false,
        hasCombatReflexes: true,
        isArmedOrThreatening: true,
        targetHasCover: false,
        targetHasTotalConcealment: false
      }
    ]);
    expect(actionAoO.lifoReactorIds).toEqual([10]);
  });

  test('Layer 5 (M95 & M96): Crit confirmation, TWF/natural sequences, DR injury suppression, vitality, maneuvers, and conditions', () => {
    const critHit = resolveAttackRoll({
      attackBonus: 6,
      targetAC: 15,
      weaponDice: '1d8',
      strModifier: 4,
      handedness: 'two_handed',
      flatDamageBonus: 0,
      critThreatMin: 19,
      critMultiplier: 2,
      precisionDice: ['2d6'],
      forcedAttackRoll: 19,
      forcedConfirmRoll: 12
    });
    expect(critHit.hit).toBe(true);
    expect(critHit.isCriticalConfirmed).toBe(true);
    expect(critHit.unmultipliedExtraDamage).toBeGreaterThanOrEqual(2);

    const fullSeq = buildFullAttackSequence({
      totalBab: 11,
      baseAttackModifier: 15,
      hasOffHandWeapon: true,
      offHandIsLight: true,
      hasTwoWeaponFightingFeat: true,
      secondaryNaturalCount: 1,
      hasMultiattackFeat: true
    });
    expect(fullSeq.primaryAttacks).toEqual([13, 8, 3]);
    expect(fullSeq.offHandAttacks).toEqual([13]);
    expect(fullSeq.naturalAttacks).toEqual([13]);

    const enc = computeEncumbranceState(16, 'medium', 100, 30);
    expect(enc.loadTier).toBe('medium');
    expect(enc.effectiveSpeedFt).toBe(20);

    // DR 5/bludgeoning completely absorbs 4 slashing damage and suppresses injury poison riders
    const drBlocked = mitigateIncomingDamage({
      rawDamage: 4,
      damageType: 'slashing',
      attackBypassTags: ['slashing'],
      damageReduction: { amount: 5, bypassTags: ['bludgeoning'] }
    });
    expect(drBlocked.finalDamage).toBe(0);
    expect(drBlocked.suppressSecondaryInjuryRiders).toBe(true);

    // Vitality: -5 HP is dying; -10 HP is dead; CON: null is dead at 0 HP
    expect(evaluateVitalityStatus(-5, 0, false, false).status).toBe('dying');
    expect(evaluateVitalityStatus(-10, 0, false, false).status).toBe('dead');
    expect(evaluateVitalityStatus(0, 0, false, true).status).toBe('dead');
    expect(rollDyingStabilization(-5, 8).isStable).toBe(true);

    // Reflex save with Evasion takes 0x damage on success
    const evaded = resolveSavingThrow({
      saveType: 'ref',
      baseSave: 5,
      abilityModifier: 3,
      dc: 15,
      isReflexHalfDamageEffect: true,
      evasionTier: 'evasion',
      forcedNaturalRoll: 10
    });
    expect(evaded.success).toBe(true);
    expect(evaded.damageMultiplier).toBe(0);

    // Trip maneuver & Condition Escalation (Shaken + Shaken -> Frightened -> Panicked)
    const trip = resolveCombatManeuver({
      maneuver: 'trip',
      attackerSize: 'large',
      defenderSize: 'medium',
      attackerBab: 4,
      defenderBab: 2,
      attackerStrMod: 5,
      defenderStrOrDexMod: 2,
      attackerTouchAttackBonus: 8,
      defenderTouchAC: 12,
      hasImprovedManeuverFeat: true,
      forcedTouchRoll: 10,
      forcedOpposedRolls: { rollA: 12, rollB: 10 }
    });
    expect(trip.opposedSuccess).toBe(true);

    const c1 = applyConditionWithEscalation(['shaken'], 'shaken');
    expect(c1).toEqual(['frightened']);
    const c2 = applyConditionWithEscalation(c1, 'shaken');
    expect(c2).toEqual(['panicked']);
    expect(summarizeConditionEffects(['blinded']).losesDexToAC).toBe(true);
  });

  test('Layer 6 (M97 & M98): Vancian bonus slots, 7-step Cast Pipeline, AoE geometry, and 8-Hour Rest retention', () => {
    expect(canCastSpellOfLevel(12, 3)).toBe(false);
    expect(canCastSpellOfLevel(16, 3)).toBe(true);
    expect(computeBonusSpellSlots(18, 0)).toBe(0); // Never bonus 0-level cantrips
    expect(computeBonusSpellSlots(18, 1)).toBe(1);

    const converted = convertPreparedSlotSpontaneously(
      { spellLevel: 2, status: 'prepared', preparedSpellId: 'hold_person' },
      'cure_moderate_wounds',
      2,
      100
    );
    expect(converted.success).toBe(true);
    expect(converted.slot.status).toBe('expended');

    const castRes = resolveCastPipeline({
      classification: 'spell',
      spellLevel: 3,
      casterLevel: 5,
      keyAbilityScore: 18,
      concentrationModifier: 9,
      hasVerbalComponent: true,
      hasSomaticComponent: true,
      castDefensively: true,
      targetSpellResistance: 14,
      forcedConcentrationRoll: 12,
      forcedSrRoll: 11
    });
    expect(castRes.succeeded).toBe(true);
    expect(castRes.saveDC).toBe(10 + 3 + 4); // DC 17

    const burstSquares = computeAoEAffectedSquares('burst', { x: 5, y: 5 }, { x: 5, y: 5 }, 10, () => false);
    expect(burstSquares.length).toBeGreaterThan(9);

    // 8-Hour Rest: slot cast 1000 rounds ago (< 4800 rounds) is retained as expended!
    const restResult = resolveEightHourRest({
      slots: [
        { spellLevel: 1, status: 'expended', castTimestampTurn: 100 },
        { spellLevel: 2, status: 'expended', castTimestampTurn: 5000 }
      ],
      restCompletionTurn: 6000,
      characterLevel: 3,
      isThreatened: false
    });
    expect(restResult.restSucceeded).toBe(true);
    expect(restResult.retainedRecentCastCount).toBe(1);
    expect(restResult.refreshedSlots[0]?.status).toBe('open');
    expect(restResult.refreshedSlots[1]?.status).toBe('expended');

    const preparedInDungeon = prepareOpenSpellSlot(restResult.refreshedSlots[0]!, 'magic_missile', 1, false);
    expect(preparedInDungeon.success).toBe(true);
    expect(preparedInDungeon.roundsSpent).toBe(150);
  });

  test('Layer 6 / M99 & M100: 3-Tier Separation (Rules Engine vs System Content vs Campaign Content) & end-to-end integration', () => {
    const dndCampaign = loadCampaignFromDisk('dnd35e-crypt');
    expect(dndCampaign.manifest.rulesetId).toBe('dnd35e');

    // Verify Tier 2 System Content was loaded from public/data/rulesets/dnd35e/ and validated by Zod
    expect(dndCampaign.systemContent).toBeDefined();
    const sysContent = getDnD35SystemContent(dndCampaign);
    expect(sysContent).not.toBeNull();
    expect(Object.keys(sysContent!.classes)).toEqual(
      expect.arrayContaining(['fighter', 'rogue', 'cleric', 'wizard'])
    );
    expect(Object.keys(sysContent!.classes).length).toBe(21);
    expect(sysContent!.classes['cleric']?.progression[0]?.bab).toBe(0);
    expect(sysContent!.classes['cleric']?.progression[1]?.bab).toBe(1);
    expect(sysContent!.skills['swim']?.acpMultiplier).toBe(2);
    expect(sysContent!.feats['power_attack']?.isFighterBonusFeat).toBe(true);
    expect(sysContent!.spells['fireball']?.aoeRadiusFt).toBe(20);

    // Verify classic campaign has no foreign D&D system content files
    const classicCampaign = loadCampaignFromDisk('default');
    expect(classicCampaign.systemContent).toEqual({});
    expect(getDnD35SystemContent(classicCampaign)).toBeNull();

    let state = buildGameState(dndCampaign);
    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    // Spawn Crypt Skeleton defined in campaign entities.json referencing system archetype 'skeleton'
    let skeletonId;
    [state, skeletonId] = spawnEntity(state, 'skeleton', playerPos.x + 1, playerPos.y);
    const skeletonData = getDnD35EntityData(state, skeletonId);
    expect(skeletonData.archetypeId).toBe('skeleton');
    expect(skeletonData.damageReduction?.amount).toBe(5);
    expect(skeletonData.damageReduction?.bypassTags).toEqual(['bludgeoning']);
    expect(skeletonData.abilityScores.con.base).toBeNull();

    const combatRes = processMeleeAttackIntent(state, {
      type: IntentType.MeleeAttack,
      entityId: playerId,
      defenderId: skeletonId
    });
    expect(combatRes.success).toBe(true);
    state = processDamageSystem(combatRes.state);

    // Grant 1000 XP -> reaches Level 2 under D&D 3.5e triangular progression
    state = grantXp(state, playerId, 1000);
    const fighterAfterXp = getComponent(state, playerId, ComponentType.Fighter)!;
    expect(fighterAfterXp.level).toBe(2);
  });
});
