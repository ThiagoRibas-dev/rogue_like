import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent } from '../src/core/ecs.ts';
import { dispatchAction } from '../src/actions/action.registry.ts';
import { runActorMovementStep, runActorTurnStart } from '../src/systems/lifecycle.system.ts';
import { applyStatusEffect } from '../src/systems/status-effect.system.ts';
import {
  ComponentType,
  toItemInstanceId,
  type DamageComponent,
  type EquipmentComponent,
  type FighterComponent,
  type PositionComponent,
  type ResourcePoolComponent,
  type StatusEffectsComponent,
  type TacticalDoctrineComponent
} from '../src/types/components.types.ts';
import { EngineMode, UIMode } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import type { DnD35ResolvedStrikeProfile } from '../src/rulesets/dnd35e/combat/attack_routine.ts';
import { resolveBullRushImpact } from '../src/rulesets/dnd35e/combat/bull_rush_resolver.ts';
import { executeDnD35eChargeAction } from '../src/rulesets/dnd35e/combat/charge_resolver.ts';
import {
  collectRageAndFrenzyModifiers,
  resolvePrecisionDamageOnHit,
  resolveSmiteAndChargeContext
} from '../src/rulesets/dnd35e/combat/combat_acf_riders.ts';
import { executeCombatStrikeExchange } from '../src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts';
import {
  evaluateOffTurnImmediateReactions,
  executeAbruptJauntTeleport,
  executeInvisibleFistImmediate,
  getNextReactionTrigger,
  INVISIBLE_ACTIVE_STATUS_ID,
  INVISIBLE_FIST_COOLDOWN_STATUS_ID
} from '../src/rulesets/dnd35e/combat/immediate_reactions.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { resolveDnD35eMeleeAttack } from '../src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts';
import { resolveDnD35eActionEnergyCost } from '../src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts';
import { dnd35eRulesetContract } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { buildHitDieTrackFromClass } from '../src/rulesets/dnd35e/progression.ts';
import {
  DISTRACTED_FLANKED_STATUS_ID,
  evaluateEntityFlankingTarget,
  FLANKED_STATUS_ID,
  FLANKING_STATUS_ID,
  syncSpatialFlankingGraph
} from '../src/rulesets/dnd35e/spatial/flanking_graph.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import type { DnD35EntityData, HitDieTrack } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { buildActorStanceModes } from '../src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { coordToIndex } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function makeDnd35Data(
  state: ReturnType<typeof buildGameState>,
  entityId: number,
  overrides: Partial<DnD35EntityData> = {}
): DnD35EntityData {
  const base = getDnD35EntityData(state, entityId);
  return {
    ...base,
    ...overrides
  };
}

function makeClassTrack(campaign: CampaignData, classId: string, levels: number): HitDieTrack {
  const sysContent = getDnD35SystemContent(campaign);
  const classDef = sysContent?.classes[classId];
  if (!classDef) {
    throw new Error(`Missing classDef '${classId}' in test fixture`);
  }
  return buildHitDieTrackFromClass(classDef, levels);
}

function makeSimpleStrike(overrides: Partial<DnD35ResolvedStrikeProfile> = {}): DnD35ResolvedStrikeProfile {
  return {
    index: 0,
    attackBonus: 12,
    critThreatMin: 20,
    critMultiplier: 2,
    strDamageBonus: 4,
    doctrineDamageBonus: 0,
    flatDamageBonus: 0,
    weaponDice: '1d8',
    weaponDamageType: 'slashing',
    attackSource: 'manufactured_primary',
    handedness: 'one_handed',
    isNaturalOrUnarmed: false,
    bypassTags: ['slashing'],
    label: 'Longsword',
    ...overrides
  };
}

describe('Milestone 136 — Active ACF Mechanical Pipeline, Relational Flanking & Immediate Reactions', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');

  test('1. Relational Flanking Graph: tracks flankingTargetIds / flankedByEntityIds & flanking/flanked statuses across movement', () => {
    let state = buildGameState(campaign);
    const [s1, allyAId] = createEntity(state);
    const [s2, allyBId] = createEntity(s1);
    const [s3, goblinId] = createEntity(s2);
    state = s3;

    state = addComponent(state, allyAId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, allyAId, { type: ComponentType.Fighter, hp: 30, maxHp: 30 });
    state = addComponent(state, allyAId, { type: ComponentType.Player });
    state = addComponent(state, allyAId, { type: ComponentType.Faction, factionId: 'player' });

    state = addComponent(state, allyBId, { type: ComponentType.Position, x: 7, y: 5 });
    state = addComponent(state, allyBId, { type: ComponentType.Fighter, hp: 30, maxHp: 30 });
    state = addComponent(state, allyBId, { type: ComponentType.Faction, factionId: 'player' });
    state = addComponent(state, allyBId, { type: ComponentType.Attitude, attitude: 'friendly' });

    state = addComponent(state, goblinId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, goblinId, { type: ComponentType.Fighter, hp: 20, maxHp: 20 });
    state = addComponent(state, goblinId, { type: ComponentType.Faction, factionId: 'monster' });
    state = addComponent(state, goblinId, { type: ComponentType.Attitude, attitude: 'hostile' });

    state = syncSpatialFlankingGraph(state);

    const aData = getDnD35EntityData(state, allyAId);
    const bData = getDnD35EntityData(state, allyBId);
    const gData = getDnD35EntityData(state, goblinId);

    expect(aData.flankingRelations?.flankingTargetIds).toEqual([goblinId]);
    expect(bData.flankingRelations?.flankingTargetIds).toEqual([goblinId]);
    expect([...(gData.flankingRelations?.flankedByEntityIds ?? [])].sort()).toEqual([allyAId, allyBId].sort());

    const aStatuses = (getComponent(state, allyAId, ComponentType.StatusEffects) as StatusEffectsComponent).activeEffects;
    const gStatuses = (getComponent(state, goblinId, ComponentType.StatusEffects) as StatusEffectsComponent).activeEffects;
    expect(aStatuses.some((e) => e.effectId === FLANKING_STATUS_ID)).toBe(true);
    expect(gStatuses.some((e) => e.effectId === FLANKED_STATUS_ID)).toBe(true);

    // Move Ally B away from opposite position -> flanking ceases immediately
    state = addComponent(state, allyBId, { type: ComponentType.Position, x: 9, y: 5 });
    state = runActorMovementStep(state, allyBId, { x: 7, y: 5 }, { x: 9, y: 5 });

    const aAfter = getDnD35EntityData(state, allyAId);
    const gAfter = getDnD35EntityData(state, goblinId);
    expect(aAfter.flankingRelations?.flankingTargetIds).toEqual([]);
    expect(gAfter.flankingRelations?.flankedByEntityIds).toEqual([]);

    const aStatusesAfter = getComponent(state, allyAId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
    const gStatusesAfter = getComponent(state, goblinId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
    expect(aStatusesAfter?.activeEffects.some((e) => e.effectId === FLANKING_STATUS_ID) ?? false).toBe(false);
    expect(gStatusesAfter?.activeEffects.some((e) => e.effectId === FLANKED_STATUS_ID) ?? false).toBe(false);
  });

  test('2. Flanking Overrides & Immunities: offset flanking, solo flanking, and Improved Uncanny Dodge', () => {
    let state = buildGameState(campaign);
    const [s1, allyAId] = createEntity(state);
    const [s2, allyBId] = createEntity(s1);
    const [s3, goblinId] = createEntity(s2);
    state = s3;

    // Non-opposite L-shape positions: (5,5) and (6,6) both threaten (6,5)
    state = addComponent(state, allyAId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, allyAId, { type: ComponentType.Fighter, hp: 30, maxHp: 30 });
    state = addComponent(state, allyAId, { type: ComponentType.Player });
    state = addComponent(state, allyAId, { type: ComponentType.Faction, factionId: 'player' });

    state = addComponent(state, allyBId, { type: ComponentType.Position, x: 6, y: 6 });
    state = addComponent(state, allyBId, { type: ComponentType.Fighter, hp: 30, maxHp: 30 });
    state = addComponent(state, allyBId, { type: ComponentType.Faction, factionId: 'player' });
    state = addComponent(state, allyBId, { type: ComponentType.Attitude, attitude: 'friendly' });

    state = addComponent(state, goblinId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, goblinId, { type: ComponentType.Fighter, hp: 20, maxHp: 20 });
    state = addComponent(state, goblinId, { type: ComponentType.Faction, factionId: 'monster' });
    state = addComponent(state, goblinId, { type: ComponentType.Attitude, attitude: 'hostile' });

    const aData = makeDnd35Data(state, allyAId);
    const gData = makeDnd35Data(state, goblinId);

    // Without offset flanking, L-shape does not flank
    expect(
      evaluateEntityFlankingTarget({
        state,
        attackerId: allyAId,
        defenderId: goblinId,
        attackerPos: { x: 5, y: 5 },
        defenderPos: { x: 6, y: 5 },
        attackerData: aData,
        defenderData: gData,
        attackerSelfTags: [],
        defenderSelfTags: []
      })
    ).toBe(false);

    // With trait:offset_flanking, L-shape counts as flanking
    expect(
      evaluateEntityFlankingTarget({
        state,
        attackerId: allyAId,
        defenderId: goblinId,
        attackerPos: { x: 5, y: 5 },
        defenderPos: { x: 6, y: 5 },
        attackerData: aData,
        defenderData: gData,
        attackerSelfTags: ['trait:offset_flanking'],
        defenderSelfTags: []
      })
    ).toBe(true);

    // Solo flanker works without any ally at all
    state = addComponent(state, allyBId, { type: ComponentType.Position, x: 12, y: 12 });
    expect(
      evaluateEntityFlankingTarget({
        state,
        attackerId: allyAId,
        defenderId: goblinId,
        attackerPos: { x: 5, y: 5 },
        defenderPos: { x: 6, y: 5 },
        attackerData: aData,
        defenderData: gData,
        attackerSelfTags: ['trait:flank_alone'],
        defenderSelfTags: []
      })
    ).toBe(true);

    // Improved Uncanny Dodge blocks flanking unless rogue level >= defender + 4
    const highLevelDef = makeDnd35Data(state, goblinId, {
      tracks: [makeClassTrack(campaign, 'barbarian', 5)]
    });
    const lowRogueAtk = makeDnd35Data(state, allyAId, {
      tracks: [makeClassTrack(campaign, 'rogue', 5)],
      scalingPools: { sneak_attack_dice: 3 }
    });
    expect(
      evaluateEntityFlankingTarget({
        state,
        attackerId: allyAId,
        defenderId: goblinId,
        attackerPos: { x: 5, y: 5 },
        defenderPos: { x: 6, y: 5 },
        attackerData: lowRogueAtk,
        defenderData: highLevelDef,
        attackerSelfTags: ['trait:flank_alone'],
        defenderSelfTags: ['feature:improved_uncanny_dodge']
      })
    ).toBe(false);
  });

  test('3. Distracting Attack (Ranger ACF): applies distracted_flanked on hit and expires at Ranger next turn start', () => {
    let state = buildGameState(campaign);
    const [s1, rangerId] = createEntity(state);
    const [s2, targetId] = createEntity(s1);
    const [s3, rogueId] = createEntity(s2);
    state = s3;

    state = addComponent(state, rangerId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, rangerId, { type: ComponentType.Fighter, hp: 30, maxHp: 30 });
    state = addComponent(state, rangerId, { type: ComponentType.Player });
    state = addComponent(state, rangerId, { type: ComponentType.Faction, factionId: 'player' });

    state = addComponent(state, targetId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, targetId, { type: ComponentType.Fighter, hp: 50, maxHp: 50 });
    state = addComponent(state, targetId, { type: ComponentType.Faction, factionId: 'monster' });
    state = addComponent(state, targetId, { type: ComponentType.Attitude, attitude: 'hostile' });

    state = addComponent(state, rogueId, { type: ComponentType.Position, x: 6, y: 6 });
    state = addComponent(state, rogueId, { type: ComponentType.Fighter, hp: 25, maxHp: 25 });
    state = addComponent(state, rogueId, { type: ComponentType.Faction, factionId: 'player' });
    state = addComponent(state, rogueId, { type: ComponentType.Attitude, attitude: 'friendly' });

    const rangerData = makeDnd35Data(state, rangerId, {
      tracks: [makeClassTrack(campaign, 'ranger', 4)],
      activeClassFeatures: ['distracting_attack']
    });
    state = setDnD35EntityData(state, rangerId, rangerData);
    const rangerEval = evaluateDnD35eEntityDAG(state, rangerId)!;
    const targetEval = evaluateDnD35eEntityDAG(state, targetId)!;

    const strikeRes = executeCombatStrikeExchange({
      state,
      attackerId: rangerId,
      defenderId: targetId,
      strike: makeSimpleStrike(),
      strikeIndex: 0,
      totalStrikes: 1,
      attackerData: rangerData,
      defenderData: targetEval.dndData,
      attackerSelfTags: [...rangerEval.selfTags, 'trait:distracting_attack'],
      defenderSelfTags: targetEval.selfTags,
      attackerEval: rangerEval,
      defenderEval: targetEval,
      defenderHpRemaining: 50,
      cleavesUsedThisTurn: 0,
      forcedAttackRoll: 18
    });

    state = strikeRes.state;
    const targetStatuses = (getComponent(state, targetId, ComponentType.StatusEffects) as StatusEffectsComponent)
      .activeEffects;
    expect(targetStatuses.some((e) => e.effectId === DISTRACTED_FLANKED_STATUS_ID && e.sourceEntityId === rangerId)).toBe(
      true
    );

    // Even Rogue standing adjacent (not opposite) is now considered flanking the distracted target
    const rogueData = getDnD35EntityData(state, rogueId);
    expect(rogueData.flankingRelations?.flankingTargetIds).toContain(targetId);

    // At start of Ranger's next turn, distracted_flanked expires and graph updates
    state = runActorTurnStart(state, rangerId);
    const targetStatusesNextTurn = getComponent(
      state,
      targetId,
      ComponentType.StatusEffects
    ) as StatusEffectsComponent | undefined;
    expect(targetStatusesNextTurn?.activeEffects.some((e) => e.effectId === DISTRACTED_FLANKED_STATUS_ID) ?? false).toBe(
      false
    );
  });

  test('4. Pounce (Barbarian Spirit Lion Totem ACF): executes full attack only on explicit Charge, not passive walking', () => {
    let state = buildGameState(campaign);
    const floorTileId =
      Object.entries(state.campaign.tiles).find(([, t]) => t.walkable && t.transparent)?.[0] ?? 'stone_floor';
    const mutableTiles = [...state.map.tiles];
    for (const x of [3, 4, 5, 6]) {
      mutableTiles[coordToIndex(x, 5, state.map.width)] = { tileId: floorTileId, explored: true };
    }
    const cleanSpatial = new Map(state.spatialIndex);
    for (const x of [3, 4, 5, 6]) cleanSpatial.delete(`${x},5`);
    state = { ...state, spatialIndex: cleanSpatial, map: { ...state.map, tiles: mutableTiles } };

    const [s1, barbId] = createEntity(state);
    const [s2, orcId] = createEntity(s1);
    const [s3, swordId] = createEntity(s2);
    state = s3;

    state = addComponent(state, swordId, {
      type: ComponentType.Item,
      itemId: 'longsword',
      instanceId: toItemInstanceId('test-longsword-1')
    });
    state = addComponent(state, barbId, { type: ComponentType.Position, x: 3, y: 5 });
    state = addComponent(state, barbId, { type: ComponentType.Fighter, hp: 60, maxHp: 60 });
    state = addComponent(state, barbId, { type: ComponentType.Player });
    state = addComponent(state, barbId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'main_hand', slotType: 'main_hand', equippedItem: swordId }]
    } as EquipmentComponent);

    state = addComponent(state, orcId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, orcId, { type: ComponentType.Fighter, hp: 200, maxHp: 200 });
    state = addComponent(state, orcId, { type: ComponentType.Attitude, attitude: 'hostile' });

    const barbPounceData = makeDnd35Data(state, barbId, {
      tracks: [makeClassTrack(campaign, 'barbarian', 6)],
      activeClassFeatures: ['pounce'],
      hasPounce: true,
      actionBudget: {
        standardRemaining: 1,
        moveRemaining: 1,
        swiftRemaining: 1,
        aooRemaining: 1,
        movementRemainingFt: 0,
        distanceMovedThisRoundFt: 0,
        fiveFootStepAvailable: true,
        canMoveFurtherThisRound: true,
        immediateUsedOffTurn: false,
        hasActedThisRound: false
      }
    });
    state = setDnD35EntityData(state, barbId, barbPounceData);

    // Explicit Charge action moves 10 ft straight to (5,5) and triggers Pounce full attack (2 iterative strikes)
    const pounceRes = executeDnD35eChargeAction(state, barbId, orcId);
    expect(pounceRes.success).toBe(true);
    expect(getComponent(pounceRes.state, barbId, ComponentType.Position)?.x).toBe(5);
    const pounceStrikeLogs = pounceRes.state.messages.filter((m) => m.text.includes('Longsword'));
    expect(pounceStrikeLogs.length).toBe(2);

    // Plain melee attack after passive 10 ft walking must NOT grant Charge/Pounce full attack
    let walkedState = addComponent(state, barbId, { type: ComponentType.Position, x: 5, y: 5 });
    walkedState = setDnD35EntityData(walkedState, barbId, {
      ...barbPounceData,
      actionBudget: {
        ...barbPounceData.actionBudget!,
        moveRemaining: 0,
        distanceMovedThisRoundFt: 10
      }
    });
    const passiveWalkAttackRes = resolveDnD35eMeleeAttack(walkedState, {
      type: IntentType.MeleeAttack,
      entityId: barbId,
      defenderId: orcId
    });
    const passiveStrikeLogs = passiveWalkAttackRes.state.messages.filter((m) => m.text.includes('Longsword'));
    expect(passiveStrikeLogs.length).toBe(1);
    expect(passiveStrikeLogs.some((m) => m.text.includes('[Charge +2]'))).toBe(false);
  });

  test('5. Bull Rush Spatial Push & Dungeon Crasher Tiers 1 & 2 wall-slam damage', () => {
    let state = buildGameState(campaign);
    const wallX = 7;
    const y = 5;
    const wallTileId =
      Object.entries(state.campaign.tiles).find(([, t]) => !t.walkable)?.[0] ?? 'stone_wall';
    const floorTileId =
      Object.entries(state.campaign.tiles).find(([, t]) => t.walkable && t.transparent)?.[0] ?? 'stone_floor';
    const mutableTiles = [...state.map.tiles];
    for (const x of [4, 5, 6]) {
      mutableTiles[coordToIndex(x, y, state.map.width)] = { tileId: floorTileId, explored: true };
    }
    mutableTiles[coordToIndex(wallX, y, state.map.width)] = { tileId: wallTileId, explored: true };
    const cleanSpatial = new Map(state.spatialIndex);
    for (const x of [4, 5, 6, 7]) cleanSpatial.delete(`${x},${y}`);
    state = { ...state, spatialIndex: cleanSpatial, map: { ...state.map, tiles: mutableTiles } };

    const [s1, fighterId] = createEntity(state);
    const [s2, enemyId] = createEntity(s1);
    state = s2;

    state = addComponent(state, fighterId, { type: ComponentType.Position, x: 4, y });
    state = addComponent(state, fighterId, { type: ComponentType.Fighter, hp: 50, maxHp: 50 });
    state = addComponent(state, fighterId, { type: ComponentType.Player });

    state = addComponent(state, enemyId, { type: ComponentType.Position, x: 5, y });
    state = addComponent(state, enemyId, { type: ComponentType.Fighter, hp: 100, maxHp: 100 });
    state = addComponent(state, enemyId, { type: ComponentType.Attitude, attitude: 'hostile' });

    const baseAbilityScores = getDnD35EntityData(state, fighterId).abilityScores;
    const str18Scores = {
      ...baseAbilityScores,
      str: { ...baseAbilityScores.str, base: 18 } // +4 STR mod
    };

    // Tier 1 Fighter L2: 4d6 + 2*4 = 4d6 + 8 -> [12..32]
    const t1Data = makeDnd35Data(state, fighterId, {
      abilityScores: str18Scores,
      tracks: [makeClassTrack(campaign, 'fighter', 2)],
      activeClassFeatures: ['dungeon_crasher_1']
    });
    const t1State = setDnD35EntityData(state, fighterId, t1Data);
    const t1Res = resolveBullRushImpact(t1State, {
      attackerId: fighterId,
      defenderId: enemyId,
      forcedOpposedRolls: { rollA: 18, rollB: 2 } // margin pushes >= 2 squares into wall at x=7
    });

    expect(t1Res.success).toBe(true);
    expect(t1Res.pushedSquares).toBe(1); // stopped at x=6 right before wall x=7
    expect(t1Res.finalPosition).toEqual({ x: 6, y });
    expect(t1Res.collidedWithWall).toBe(true);
    expect(t1Res.wallCrashDamage).toBeGreaterThanOrEqual(4 + 8);
    expect(t1Res.wallCrashDamage).toBeLessThanOrEqual(24 + 8);

    // Tier 2 Fighter L6: 8d6 + 3*4 = 8d6 + 12 -> [20..60]
    const t2Data = makeDnd35Data(state, fighterId, {
      abilityScores: str18Scores,
      tracks: [makeClassTrack(campaign, 'fighter', 6)],
      activeClassFeatures: ['dungeon_crasher_1', 'dungeon_crasher_2']
    });
    const t2State = setDnD35EntityData(state, fighterId, t2Data);
    const t2Res = resolveBullRushImpact(t2State, {
      attackerId: fighterId,
      defenderId: enemyId,
      forcedOpposedRolls: { rollA: 18, rollB: 2 }
    });

    expect(t2Res.collidedWithWall).toBe(true);
    expect(t2Res.wallCrashDamage).toBeGreaterThanOrEqual(8 + 12);
    expect(t2Res.wallCrashDamage).toBeLessThanOrEqual(48 + 12);
    const dmgComp = getComponent(t2Res.state, enemyId, ComponentType.Damage) as DamageComponent | undefined;
    expect(dmgComp?.instances.some((inst) => inst.tags.includes('dungeon_crasher'))).toBe(true);
  });

  test('6. Penetrating Strike (Rogue ACF) & Charging Smite (Paladin ACF with miss refund)', () => {
    const penFlanked = resolvePrecisionDamageOnHit({
      sneakAttackDice: 3,
      isFlanking: true,
      isTargetDeniedDex: false,
      targetImmuneToCrits: true,
      fortificationNegated: false,
      concealmentMissChance: 0,
      attackerSelfTags: ['trait:penetrating_strike']
    });
    expect(penFlanked.diceUsed).toBe(1);
    expect(penFlanked.usedPenetratingStrike).toBe(true);
    expect(penFlanked.damage).toBeGreaterThanOrEqual(1);
    expect(penFlanked.damage).toBeLessThanOrEqual(6);

    const penDeniedDexOnly = resolvePrecisionDamageOnHit({
      sneakAttackDice: 3,
      isFlanking: false,
      isTargetDeniedDex: true,
      targetImmuneToCrits: true,
      fortificationNegated: false,
      concealmentMissChance: 0,
      attackerSelfTags: ['trait:penetrating_strike']
    });
    expect(penDeniedDexOnly.diceUsed).toBe(0);
    expect(penDeniedDexOnly.damage).toBe(0);

    // Charging Smite context & miss refund in full combat exchange pipeline
    let state = buildGameState(campaign);
    const [s1, paladinId] = createEntity(state);
    const [s2, demonId] = createEntity(s1);
    state = s2;

    state = addComponent(state, paladinId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, paladinId, { type: ComponentType.Fighter, hp: 50, maxHp: 50 });
    state = addComponent(state, paladinId, { type: ComponentType.Player });
    state = addComponent(state, paladinId, {
      type: ComponentType.ResourcePool,
      pools: { smite_evil: { current: 1, max: 2, refreshOn: 'rest' } }
    } as ResourcePoolComponent);
    state = applyStatusEffect(state, paladinId, 'pool_smite_evil_active', 1, paladinId);

    state = addComponent(state, demonId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, demonId, { type: ComponentType.Fighter, hp: 80, maxHp: 80 });
    state = addComponent(state, demonId, { type: ComponentType.Attitude, attitude: 'hostile' });

    const basePaladinScores = getDnD35EntityData(state, paladinId).abilityScores;
    const paladinData = makeDnd35Data(state, paladinId, {
      abilityScores: { ...basePaladinScores, cha: { ...basePaladinScores.cha, base: 16 } }, // +3 CHA
      tracks: [makeClassTrack(campaign, 'paladin', 4)],
      activeClassFeatures: ['charging_smite'],
      scalingPools: { smite_evil_damage_level: 4 }
    });
    state = setDnD35EntityData(state, paladinId, paladinData);
    state = setDnD35EntityData(
      state,
      demonId,
      makeDnd35Data(state, demonId, { alignment: 'CE' })
    );

    const smiteCtx = resolveSmiteAndChargeContext({
      attackerData: paladinData,
      attackerSelfTags: ['status:pool_smite_evil_active', 'trait:charging_smite'],
      defenderSelfTags: ['alignment:evil'],
      attackerChaMod: 3,
      isChargeAttack: true
    });
    expect(smiteCtx.smiteAttackBonus).toBe(3);
    expect(smiteCtx.smiteDamageBonus).toBe(12); // 3 * level 4

    const paladinEval = evaluateDnD35eEntityDAG(state, paladinId)!;
    const demonEval = evaluateDnD35eEntityDAG(state, demonId)!;

    // Missing with Charging Smite refunds 1 smite_evil charge and clears pool_smite_evil_active
    const missRes = executeCombatStrikeExchange({
      state,
      attackerId: paladinId,
      defenderId: demonId,
      strike: makeSimpleStrike(),
      strikeIndex: 0,
      totalStrikes: 1,
      attackerData: paladinData,
      defenderData: demonEval.dndData,
      attackerSelfTags: paladinEval.selfTags,
      defenderSelfTags: demonEval.selfTags,
      attackerEval: paladinEval,
      defenderEval: demonEval,
      defenderHpRemaining: 80,
      cleavesUsedThisTurn: 0,
      forcedAttackRoll: 1,
      isChargeAttack: true
    });

    const poolAfterMiss = getComponent(missRes.state, paladinId, ComponentType.ResourcePool) as ResourcePoolComponent;
    expect(poolAfterMiss.pools['smite_evil']?.current).toBe(2);
    const statusesAfterMiss = getComponent(
      missRes.state,
      paladinId,
      ComponentType.StatusEffects
    ) as StatusEffectsComponent | undefined;
    expect(statusesAfterMiss?.activeEffects.some((e) => e.effectId === 'pool_smite_evil_active') ?? false).toBe(false);
  });

  test('7. Tactical Stances: Whirling Frenzy & Decisive Strike bonuses, strike counts, and stance projection', () => {
    // Inactive passive stance:whirling_frenzy must NOT emit modifiers
    const inactiveMods = collectRageAndFrenzyModifiers(['stance:whirling_frenzy']);
    expect(inactiveMods.length).toBe(0);

    // Active via doctrine OR status:pool_whirling_frenzy_active emits +4 STR, +2 dodge AC/Ref, -2 attack, +1 extra strike
    const activeMods = collectRageAndFrenzyModifiers(['stance:whirling_frenzy', 'status:pool_whirling_frenzy_active']);
    expect(activeMods.find((m) => m.targetStat === 'str')?.value).toBe(4);
    expect(activeMods.find((m) => m.targetStat === 'ac')?.value).toBe(2);
    expect(activeMods.find((m) => m.targetStat === 'ref')?.value).toBe(2);
    expect(activeMods.find((m) => m.targetStat === 'attack')?.value).toBe(-2);
    expect(activeMods.find((m) => m.targetStat === 'extra_full_bab_attacks')?.value).toBe(1);

    let state = buildGameState(campaign);
    const [s1, monkId] = createEntity(state);
    state = s1;
    state = addComponent(state, monkId, { type: ComponentType.Fighter, hp: 40, maxHp: 40 });
    state = addComponent(state, monkId, { type: ComponentType.Player });

    const monkData = makeDnd35Data(state, monkId, {
      tracks: [makeClassTrack(campaign, 'monk', 6)],
      activeClassFeatures: ['decisive_strike']
    });
    state = setDnD35EntityData(state, monkId, monkData);
    state = addComponent(state, monkId, {
      type: ComponentType.TacticalDoctrine,
      powerAttackAmount: 0,
      decisiveStrike: true
    } as TacticalDoctrineComponent);

    const monkEval = evaluateDnD35eEntityDAG(state, monkId)!;
    expect(monkEval.attackRoutine.strikes.length).toBe(1);
    expect(monkEval.attackRoutine.strikes[0]?.damageMultiplier).toBe(2);

    const stanceModes = buildActorStanceModes(monkData, 4, {
      type: ComponentType.TacticalDoctrine,
      powerAttackAmount: 0,
      decisiveStrike: true
    });
    expect(stanceModes.find((m) => m.id === 'decisive_strike')?.isActive).toBe(true);

    // Execute Decisive Strike through pipeline: doubles strike damage and applies decisive_strike_aoo_active
    const [s2, dummyId] = createEntity(state);
    state = addComponent(s2, dummyId, { type: ComponentType.Fighter, hp: 100, maxHp: 100 });
    state = addComponent(state, dummyId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, monkId, { type: ComponentType.Position, x: 5, y: 5 });
    const dummyEval = evaluateDnD35eEntityDAG(state, dummyId)!;
    const baseStrike = makeSimpleStrike({ weaponDice: '1d1', strDamageBonus: 3, damageMultiplier: 2 });
    const dsHit = executeCombatStrikeExchange({
      state,
      attackerId: monkId,
      defenderId: dummyId,
      strike: baseStrike,
      strikeIndex: 0,
      totalStrikes: 1,
      attackerData: monkData,
      defenderData: dummyEval.dndData,
      attackerSelfTags: monkEval.selfTags,
      defenderSelfTags: dummyEval.selfTags,
      attackerEval: monkEval,
      defenderEval: dummyEval,
      defenderHpRemaining: 100,
      cleavesUsedThisTurn: 0,
      forcedAttackRoll: 18
    });
    expect(dsHit.hit).toBe(true);
    expect(100 - dsHit.defenderHpRemaining).toBe(8); // (1 + 3) * 2 = 8
    const dsStatuses = (getComponent(dsHit.state, monkId, ComponentType.StatusEffects) as StatusEffectsComponent)
      .activeEffects;
    expect(dsStatuses.some((e) => e.effectId === 'decisive_strike_aoo_active')).toBe(true);

    // Whirling Frenzy DAG evaluation: +4 STR, +2 dodge AC/Ref, +1 full-BAB strike, -2 attack penalty
    const [s3, barbId] = createEntity(state);
    let barbState = addComponent(s3, barbId, { type: ComponentType.Fighter, hp: 50, maxHp: 50 });
    barbState = setDnD35EntityData(
      barbState,
      barbId,
      makeDnd35Data(barbState, barbId, {
        tracks: [makeClassTrack(campaign, 'barbarian', 4)],
        activeClassFeatures: ['whirling_frenzy']
      })
    );
    const barbBaseEval = evaluateDnD35eEntityDAG(barbState, barbId)!;
    const barbFrenzyState = addComponent(barbState, barbId, {
      type: ComponentType.TacticalDoctrine,
      powerAttackAmount: 0,
      whirlingFrenzy: true
    } as TacticalDoctrineComponent);
    const barbFrenzyEval = evaluateDnD35eEntityDAG(barbFrenzyState, barbId)!;
    expect(barbFrenzyEval.dagResult.effectiveAbilities.str.base).toBe(
      barbBaseEval.dagResult.effectiveAbilities.str.base + 4
    );
    expect(barbFrenzyEval.dagResult.acBreakdown.fullAC).toBe(barbBaseEval.dagResult.acBreakdown.fullAC + 2);
    expect(barbFrenzyEval.dagResult.saves.ref).toBe(barbBaseEval.dagResult.saves.ref + 2);
    expect(barbFrenzyEval.attackRoutine.strikes.length).toBe(barbBaseEval.attackRoutine.strikes.length + 1);
  });

  test('8. Invisible Fist, Abrupt Jaunt Two-Step Targeting & Off-Turn Immediate Reaction Policies', () => {
    let state = buildGameState(campaign);
    const floorTileId =
      Object.entries(state.campaign.tiles).find(([, t]) => t.walkable && t.transparent)?.[0] ?? 'stone_floor';
    const mutableTiles = [...state.map.tiles];
    for (let y = 4; y <= 9; y++) {
      for (let x = 4; x <= 9; x++) {
        mutableTiles[coordToIndex(x, y, state.map.width)] = { tileId: floorTileId, explored: true };
      }
    }
    const cleanSpatial = new Map(state.spatialIndex);
    for (let y = 4; y <= 9; y++) {
      for (let x = 4; x <= 9; x++) {
        cleanSpatial.delete(`${x},${y}`);
      }
    }
    state = {
      ...state,
      engineMode: EngineMode.TurnBased,
      uiMode: UIMode.Game,
      spatialIndex: cleanSpatial,
      map: { ...state.map, tiles: mutableTiles }
    };

    const [s1, conjurerId] = createEntity(state);
    const [s2, attackerId] = createEntity(s1);
    state = s2;

    state = addComponent(state, conjurerId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, conjurerId, { type: ComponentType.Fighter, hp: 30, maxHp: 30 });
    state = addComponent(state, conjurerId, { type: ComponentType.Player });
    state = addComponent(state, conjurerId, {
      type: ComponentType.ResourcePool,
      pools: {
        abrupt_jaunt: { current: 3, max: 3, refreshOn: 'rest' },
        invisible_fist: { current: 2, max: 2, refreshOn: 'rest' }
      }
    } as ResourcePoolComponent);

    state = addComponent(state, attackerId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, attackerId, { type: ComponentType.Fighter, hp: 40, maxHp: 40 });
    state = addComponent(state, attackerId, { type: ComponentType.Attitude, attitude: 'hostile' });

    // Invisible Fist: applies invisible_active (1 rd) + cooldown (3 rds), rejects reuse on cooldown
    const inv1 = executeInvisibleFistImmediate(state, conjurerId, true);
    expect(inv1.success).toBe(true);
    const statusesInv = (getComponent(inv1.state, conjurerId, ComponentType.StatusEffects) as StatusEffectsComponent)
      .activeEffects;
    expect(statusesInv.some((e) => e.effectId === INVISIBLE_ACTIVE_STATUS_ID && e.duration === 1)).toBe(true);
    expect(statusesInv.some((e) => e.effectId === INVISIBLE_FIST_COOLDOWN_STATUS_ID && e.duration === 3)).toBe(true);
    const invDag = evaluateDnD35eEntityDAG(inv1.state, conjurerId)!;
    expect(invDag.selfTags).toContain('trait:invisible');

    const inv2 = executeInvisibleFistImmediate(inv1.state, conjurerId, true);
    expect(inv2.success).toBe(false);

    // Two-Step Abrupt Jaunt targeting via dispatchAction(UseAbility) -> targetingMode active, 0 standard actions burned yet
    const jauntIntent = {
      type: IntentType.UseAbility as const,
      entityId: conjurerId,
      effectId: 'pool:abrupt_jaunt'
    };
    const jauntStep1Res = dispatchAction(state, jauntIntent);
    const jauntStep1 = jauntStep1Res.state;
    expect(jauntStep1Res.success).toBe(true);
    expect(jauntStep1.targetingMode?.active).toBe(true);
    expect(jauntStep1.targetingMode?.maxRangeTiles).toBe(2);
    expect(jauntStep1.targetingMode?.context?.verb).toBe('abrupt_jaunt');
    const step1Energy = resolveDnD35eActionEnergyCost(jauntStep1, jauntIntent, 100, state);
    expect(step1Energy.energyCost).toBe(0);

    // Confirming via FireAimed / resolveAimedAction teleports conjurer 10 ft to (7, 7) and spends 1 charge
    const aimRes = dnd35eRulesetContract.resolveAimedAction!(
      jauntStep1,
      conjurerId,
      { x: 7, y: 7 },
      jauntStep1.targetingMode!.context!
    );
    expect(aimRes.success).toBe(true);
    const posAfterAim = getComponent(aimRes.state, conjurerId, ComponentType.Position) as PositionComponent;
    expect({ x: posAfterAim.x, y: posAfterAim.y }).toEqual({ x: 7, y: 7 });
    const poolsAfterAim = getComponent(aimRes.state, conjurerId, ComponentType.ResourcePool) as ResourcePoolComponent;
    expect(poolsAfterAim.pools['abrupt_jaunt']?.current).toBe(2);

    // Direct off-turn reaction policy: before_melee_attack causes conjurer to Abrupt Jaunt out of attacker reach
    let reactionState = addComponent(state, conjurerId, {
      type: ComponentType.TacticalDoctrine,
      powerAttackAmount: 0,
      reactionPolicies: {
        abrupt_jaunt: { enabled: true, trigger: 'before_melee_attack' }
      }
    } as TacticalDoctrineComponent);

    expect(getNextReactionTrigger('off')).toBe('before_melee_attack');
    expect(getNextReactionTrigger('on_enemy_adjacent_move')).toBe('off');

    const meleeRes = resolveDnD35eMeleeAttack(reactionState, {
      type: IntentType.MeleeAttack,
      entityId: attackerId,
      defenderId: conjurerId
    });
    expect(meleeRes.success).toBe(true);
    const conjurerPosAfterEvade = getComponent(meleeRes.state, conjurerId, ComponentType.Position) as PositionComponent;
    const distAfterEvade = Math.max(Math.abs(conjurerPosAfterEvade.x - 6), Math.abs(conjurerPosAfterEvade.y - 5));
    expect(distAfterEvade).toBeGreaterThan(1);
    expect((getComponent(meleeRes.state, conjurerId, ComponentType.Fighter) as FighterComponent).hp).toBe(30);

    // Movement-step reaction: on_enemy_adjacent_move with invisible_fist armed
    reactionState = addComponent(state, conjurerId, {
      type: ComponentType.TacticalDoctrine,
      powerAttackAmount: 0,
      reactionPolicies: {
        invisible_fist: { enabled: true, trigger: 'on_enemy_adjacent_move' }
      }
    } as TacticalDoctrineComponent);
    reactionState = addComponent(reactionState, attackerId, { type: ComponentType.Position, x: 8, y: 5 });
    reactionState = addComponent(reactionState, attackerId, { type: ComponentType.Position, x: 6, y: 5 });
    const afterMoveReaction = runActorMovementStep(reactionState, attackerId, { x: 8, y: 5 }, { x: 6, y: 5 });
    const statusesAfterAdj = getComponent(
      afterMoveReaction,
      conjurerId,
      ComponentType.StatusEffects
    ) as StatusEffectsComponent | undefined;
    expect(statusesAfterAdj?.activeEffects.some((e) => e.effectId === INVISIBLE_ACTIVE_STATUS_ID)).toBe(true);

    // Direct helper check rejects out-of-range teleport (> 2 tiles)
    const farJaunt = executeAbruptJauntTeleport(state, conjurerId, 9, 9, true);
    expect(farJaunt.success).toBe(false);
    // And direct off-turn check skips when disabled
    const noPolicyRes = evaluateOffTurnImmediateReactions(state, 'before_melee_attack', attackerId, conjurerId);
    expect(noPolicyRes.triggered).toBe(false);
  });
});
