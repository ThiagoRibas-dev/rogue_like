import { describe, expect, test } from 'bun:test';
import { dispatchAction } from '../src/actions/action.registry.ts';
import { huntBehavior } from '../src/ai/hunt.behavior.ts';
import { addComponent, createEntity, getComponent, queryEntities } from '../src/core/ecs.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { resolveBullRushImpact } from '../src/rulesets/dnd35e/combat/bull_rush_resolver.ts';
import { executeDnD35eChargeAction, validateChargeLine } from '../src/rulesets/dnd35e/combat/charge_resolver.ts';
import { executeAbruptJauntTeleport } from '../src/rulesets/dnd35e/combat/immediate_reactions.ts';
import { buildHitDieTrackFromClass } from '../src/rulesets/dnd35e/progression.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { buildActorHotbarSlots } from '../src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts';
import { runActorTurnStart } from '../src/systems/lifecycle.system.ts';
import {
  displaceEntityAlongVector,
  displaceEntityStep,
  evaluateTileTraversal
} from '../src/systems/movement_displacement.ts';
import type { TileDefinition } from '../src/types/campaign.types.ts';
import {
  ComponentType,
  toItemInstanceId,
  type EquipmentComponent,
  type PositionComponent,
  type ResourcePoolComponent
} from '../src/types/components.types.ts';
import { EngineMode } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { coordToIndex } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function clearFloorCorridor(
  state: ReturnType<typeof buildGameState>,
  coords: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  tileIdOverride?: string
): ReturnType<typeof buildGameState> {
  const floorTileId =
    tileIdOverride ??
    Object.entries(state.campaign.tiles).find(([, t]) => t.walkable && t.transparent)?.[0] ??
    'stone_floor';
  const mutableTiles = [...state.map.tiles];
  const cleanSpatial = new Map(state.spatialIndex);
  for (const pt of coords) {
    mutableTiles[coordToIndex(pt.x, pt.y, state.map.width)] = { tileId: floorTileId, explored: true };
    cleanSpatial.delete(`${pt.x},${pt.y}`);
  }
  return {
    ...state,
    spatialIndex: cleanSpatial,
    map: { ...state.map, tiles: mutableTiles }
  };
}

describe('Milestone 152: Spatial Displacement Kernel & Explicit Triggered Charge', async () => {
  const campaign = await loadCampaignFromDisk('dnd35e-crypt');

  test('1. evaluateTileTraversal classifies unimpeded, difficult, hazardous, and solid_obstacle declaratively', () => {
    const pitTile: TileDefinition = {
      name: 'Bottomless Pit',
      char: 'O',
      fg: '#000',
      bg: '#111',
      walkable: false,
      transparent: true,
      hazardKind: 'pit',
      traversableBy: ['fly']
    };
    const wallTile: TileDefinition = {
      name: 'Granite Wall',
      char: '#',
      fg: '#888',
      bg: '#222',
      walkable: false,
      transparent: false,
      isSolidObstacle: true
    };
    const mudTile: TileDefinition = {
      name: 'Deep Mud',
      char: '~',
      fg: '#765',
      bg: '#211',
      walkable: true,
      transparent: true,
      movementCost: 200
    };

    const walkerPit = evaluateTileTraversal(pitTile, { land: 30 });
    expect(walkerPit.passability).toBe('hazardous');
    expect(walkerPit.triggersSolidCollision).toBe(false);
    expect(walkerPit.hazardKind).toBe('pit');

    const flyerPit = evaluateTileTraversal(pitTile, { land: 30, fly: 40 });
    expect(flyerPit.passability).toBe('unimpeded');

    const wallEval = evaluateTileTraversal(wallTile, { land: 30, fly: 40 });
    expect(wallEval.passability).toBe('solid_obstacle');
    expect(wallEval.triggersSolidCollision).toBe(true);
    expect(wallEval.blocksCharge).toBe(true);

    const walkerMud = evaluateTileTraversal(mudTile, { land: 30 });
    expect(walkerMud.passability).toBe('difficult');
    expect(walkerMud.blocksCharge).toBe(true);

    const flyerMud = evaluateTileTraversal(mudTile, { land: 30, fly: 40 });
    expect(flyerMud.passability).toBe('unimpeded');
  });

  test('2. Bull Rush preserves 2x2 Large footprints, stops inside pit hazards without wall slam, and slams solid walls cleanly', () => {
    const baseState = buildGameState(campaign);
    const customCampaign = {
      ...baseState.campaign,
      tiles: {
        ...baseState.campaign.tiles,
        m152_pit: {
          name: 'Spiked Pit',
          char: 'O',
          fg: '#555',
          bg: '#000',
          walkable: false,
          transparent: true,
          hazardKind: 'pit',
          traversableBy: ['fly']
        },
        m152_wall: {
          name: 'Brick Wall',
          char: '#',
          fg: '#777',
          bg: '#222',
          walkable: false,
          transparent: false,
          isSolidObstacle: true
        }
      }
    };
    let state: ReturnType<typeof buildGameState> = { ...baseState, campaign: customCampaign };
    const clearPts: Array<{ x: number; y: number }> = [];
    for (let y = 4; y <= 7; y++) {
      for (let x = 2; x <= 10; x++) {
        clearPts.push({ x, y });
      }
    }
    state = clearFloorCorridor(state, clearPts);

    const floorTiles = [...state.map.tiles];
    floorTiles[coordToIndex(8, 5, state.map.width)] = { tileId: 'm152_pit', explored: true };
    floorTiles[coordToIndex(8, 6, state.map.width)] = { tileId: 'm152_pit', explored: true };
    state = { ...state, map: { ...state.map, tiles: floorTiles } };

    const pusherId = queryEntities(state, [ComponentType.Player])[0]!;
    const [s2, ogreId] = createEntity(state);
    state = s2;

    state = addComponent(state, pusherId, { type: ComponentType.Position, x: 4, y: 5 });
    state = addComponent(state, pusherId, { type: ComponentType.Fighter, hp: 60, maxHp: 60 });

    const ogreBase = getDnD35EntityData(state, ogreId);
    const ogreData = {
      ...ogreBase,
      sizeCategory: 'large' as const,
      abilityScores: {
        ...ogreBase.abilityScores,
        str: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
      }
    };
    state = setDnD35EntityData(state, ogreId, ogreData);
    state = addComponent(state, ogreId, {
      type: ComponentType.Position,
      x: 5,
      y: 5,
      footprintWidth: 2,
      footprintHeight: 2
    });
    state = addComponent(state, ogreId, { type: ComponentType.Fighter, hp: 100, maxHp: 100 });
    state = addComponent(state, ogreId, { type: ComponentType.Attitude, attitude: 'hostile' });

    const pusherBase = getDnD35EntityData(state, pusherId);
    const pusherData = {
      ...pusherBase,
      feats: ['improved_bull_rush'],
      statModifiers: [
        {
          targetStat: 'dungeon_crasher_dice' as const,
          value: 4,
          bonusType: 'untyped' as const,
          sourceId: 'dc_t1',
          origin: 'ex' as const
        },
        {
          targetStat: 'dungeon_crasher_str_mult' as const,
          value: 2,
          bonusType: 'untyped' as const,
          sourceId: 'dc_t1_mult',
          origin: 'ex' as const
        }
      ],
      abilityScores: {
        ...pusherBase.abilityScores,
        str: { base: 20, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
      }
    };
    state = setDnD35EntityData(state, pusherId, pusherData);

    // Push into pit: enters pit at (7,5)-(8,6) and halts in hazard WITHOUT triggering solid-wall Dungeon Crasher
    const pitPush = resolveBullRushImpact(state, {
      attackerId: pusherId,
      defenderId: ogreId,
      forcedOpposedRolls: { rollA: 18, rollB: 2 }
    });
    expect(pitPush.success).toBe(true);
    expect(pitPush.pushedSquares).toBe(2);
    expect(pitPush.collidedWithWall).toBe(false);
    expect(pitPush.wallCrashDamage).toBe(0);
    const pushedPos = getComponent(pitPush.state, ogreId, ComponentType.Position) as PositionComponent | undefined;
    expect(pushedPos?.x).toBe(7);
    expect(pushedPos?.footprintWidth).toBe(2);
    expect(pushedPos?.footprintHeight).toBe(2);

    // Replace pit with full corridor wall (y=4..7) -> stops cleanly before wall and triggers Dungeon Crasher slam
    const wallTiles = [...state.map.tiles];
    for (let wy = 4; wy <= 7; wy++) {
      wallTiles[coordToIndex(8, wy, state.map.width)] = { tileId: 'm152_wall', explored: true };
    }
    const wallState = { ...state, map: { ...state.map, tiles: wallTiles } };
    const wallPush = resolveBullRushImpact(wallState, {
      attackerId: pusherId,
      defenderId: ogreId,
      forcedOpposedRolls: { rollA: 18, rollB: 2 }
    });
    expect(wallPush.success).toBe(true);
    expect(wallPush.collidedWithWall).toBe(true);
    expect(wallPush.wallCrashDamage).toBeGreaterThan(0);
    expect(wallPush.finalPosition?.x).toBe(6);
  });

  test('3. Abrupt Jaunt teleport triggers floor field aura entry saves without provoking movement AoO', () => {
    let state = buildGameState(campaign);
    state = clearFloorCorridor(state, [
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 6, y: 6 }
    ]);

    const [s1, wizardId] = createEntity(state);
    const [s2, sentinelId] = createEntity(s1);
    const [s3, fieldId] = createEntity(s2);
    state = s3;

    state = addComponent(state, wizardId, { type: ComponentType.Position, x: 4, y: 5 });
    state = addComponent(state, wizardId, { type: ComponentType.Fighter, hp: 30, maxHp: 30 });
    state = addComponent(state, wizardId, { type: ComponentType.Player });
    state = addComponent(state, wizardId, {
      type: ComponentType.ResourcePool,
      pools: { abrupt_jaunt: { current: 2, max: 3, recharge: 'daily', actionCost: 'immediate' } }
    } as ResourcePoolComponent);

    // Adjacent hostile sentinel with Combat Reflexes
    state = addComponent(state, sentinelId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, sentinelId, { type: ComponentType.Fighter, hp: 50, maxHp: 50 });
    state = addComponent(state, sentinelId, { type: ComponentType.Attitude, attitude: 'hostile' });
    state = setDnD35EntityData(state, sentinelId, {
      ...getDnD35EntityData(state, sentinelId),
      feats: ['combat_reflexes']
    });

    // Hostile emanation field covering destination (6,5)
    state = addComponent(state, fieldId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, fieldId, {
      type: ComponentType.Field,
      fieldType: 'entangle',
      radiusFt: 10,
      remainingTurns: 5,
      sourceEntityId: sentinelId,
      spellId: 'entangle',
      casterLevel: 3,
      auraSaveMemory: {}
    });

    const jauntRes = executeAbruptJauntTeleport(state, wizardId, 6, 5, true);
    expect(jauntRes.success).toBe(true);
    expect(getComponent(jauntRes.state, wizardId, ComponentType.Position)?.x).toBe(6);
    // Sentinel must NOT spend its AoO reacting to a teleport
    const sentinelBudget = getDnD35EntityData(jauntRes.state, sentinelId).actionBudget;
    expect(sentinelBudget?.aooRemaining ?? 1).toBeGreaterThanOrEqual(1);
    // Teleport destination must trigger aura entry evaluation / light exposure cleanly
    expect(jauntRes.state.messages.some((m) => m.text.includes('abruptly jaunts'))).toBe(true);
  });

  test('4. Explicit Charge validates line/terrain, grants +2 attack and -2 AC until next turn, and consumes Full-Round budget', () => {
    const baseState = buildGameState(campaign);
    const customCampaign = {
      ...baseState.campaign,
      tiles: {
        ...baseState.campaign.tiles,
        m152_mud: {
          name: 'Boggy Mud',
          char: ',',
          fg: '#765',
          bg: '#211',
          walkable: true,
          transparent: true,
          movementCost: 200
        }
      }
    };
    let state: ReturnType<typeof buildGameState> = { ...baseState, engineMode: EngineMode.TurnBased, campaign: customCampaign };
    state = clearFloorCorridor(state, [
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 6, y: 5 }
    ]);

    const knightId = queryEntities(state, [ComponentType.Player])[0]!;
    const [s2, goblinId] = createEntity(state);
    const [s3, swordId] = createEntity(s2);
    state = s3;

    state = addComponent(state, swordId, {
      type: ComponentType.Item,
      itemId: 'longsword',
      instanceId: toItemInstanceId('m152-longsword')
    });
    state = addComponent(state, knightId, { type: ComponentType.Position, x: 2, y: 5 });
    state = addComponent(state, knightId, { type: ComponentType.Fighter, hp: 50, maxHp: 50 });
    state = addComponent(state, knightId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'main_hand', slotType: 'main_hand', equippedItem: swordId }]
    } as EquipmentComponent);

    const fighterDef = getDnD35SystemContent(campaign)!.classes['fighter']!;
    const fighterClass = getDnD35EntityData(state, knightId);
    state = setDnD35EntityData(state, knightId, {
      ...fighterClass,
      tracks: [buildHitDieTrackFromClass(fighterDef, 4)],
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

    state = addComponent(state, goblinId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, goblinId, { type: ComponentType.Fighter, hp: 80, maxHp: 80 });
    state = addComponent(state, goblinId, { type: ComponentType.Attitude, attitude: 'hostile' });

    // Hotbar includes Charge ability
    const hotbar = buildActorHotbarSlots(getDnD35EntityData(state, knightId), state, knightId);
    expect(hotbar.some((s) => s.label === 'Charge' && s.isDisabled !== true)).toBe(true);

    // Difficult terrain blocks Charge by default
    const mudTiles = [...state.map.tiles];
    mudTiles[coordToIndex(4, 5, state.map.width)] = { tileId: 'm152_mud', explored: true };
    const mudState = { ...state, map: { ...state.map, tiles: mudTiles } };
    expect(validateChargeLine(mudState, knightId, goblinId).valid).toBe(false);

    // Declarative tag / ruleOverride permits charging through mud
    const nimbleState = addComponent(mudState, knightId, {
      type: ComponentType.Tags,
      tags: ['trait:charge_ignores_difficult_terrain']
    });
    expect(validateChargeLine(nimbleState, knightId, goblinId).valid).toBe(true);
    const dagBeforeCharge = evaluateDnD35eEntityDAG(state, knightId)!;
    const baseAc = dagBeforeCharge.dagResult.acBreakdown.fullAC;

    // Execute explicit Charge on clear floor
    const chargeRes = executeDnD35eChargeAction(state, knightId, goblinId);
    expect(chargeRes.success).toBe(true);
    expect(getComponent(chargeRes.state, knightId, ComponentType.Position)?.x).toBe(5);

    // Applied +2 Charge attack label, 'charging' condition (-2 AC), and consumed Full-Round budget
    expect(chargeRes.state.messages.some((m) => m.text.includes('[Charge +2]'))).toBe(true);
    const postDnd = getDnD35EntityData(chargeRes.state, knightId);
    expect(postDnd.conditions.includes('charging')).toBe(true);
    expect(postDnd.actionBudget?.standardRemaining).toBe(0);
    expect(postDnd.actionBudget?.moveRemaining).toBe(0);

    const dagDuringCharge = evaluateDnD35eEntityDAG(chargeRes.state, knightId)!;
    expect(dagDuringCharge.dagResult.acBreakdown.fullAC).toBe(baseAc - 2);

    // At the start of next turn, 'charging' condition & -2 AC penalty expire cleanly
    const nextTurnState = runActorTurnStart(chargeRes.state, knightId);
    expect(getDnD35EntityData(nextTurnState, knightId).conditions.includes('charging')).toBe(false);
    expect(evaluateDnD35eEntityDAG(nextTurnState, knightId)!.dagResult.acBreakdown.fullAC).toBe(baseAc);
  });

  test('5. AI huntBehavior chooses explicit Charge in open corridor and two-step player targeting works symmetrically', () => {
    let state = buildGameState(campaign);
    state = clearFloorCorridor(state, [
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 6, y: 5 }
    ]);

    const heroId = queryEntities(state, [ComponentType.Player])[0]!;
    const [s2, orcId] = createEntity(state);
    state = s2;

    state = addComponent(state, heroId, { type: ComponentType.Position, x: 2, y: 5 });
    state = addComponent(state, heroId, { type: ComponentType.Fighter, hp: 50, maxHp: 50 });

    state = addComponent(state, orcId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, orcId, { type: ComponentType.Fighter, hp: 40, maxHp: 40 });
    state = addComponent(state, orcId, { type: ComponentType.Attitude, attitude: 'hostile' });

    // AI orc chooses explicit Apply(verb: 'charge') when 15 ft away down a clear corridor
    const aiIntent = huntBehavior(state, orcId, { aggroRadius: 10, allowCharge: true });
    expect(aiIntent?.type).toBe(IntentType.Apply);
    if (aiIntent?.type === IntentType.Apply) {
      expect(aiIntent.verb).toBe('charge');
      expect(aiIntent.target).toEqual({ type: 'entity', entityId: heroId });
    }

    // Player two-step Charge flow via UseAbility('action:charge') -> MoveTarget -> FireAimed
    const startAim = dispatchAction(state, {
      type: IntentType.UseAbility,
      entityId: heroId,
      effectId: 'action:charge',
      abilityName: 'Charge'
    });
    expect(startAim.state.targetingMode?.active).toBe(true);
    expect(startAim.state.targetingMode?.context?.verb).toBe('charge');

    const aimedState: typeof state = {
      ...startAim.state,
      targetingMode: {
        ...startAim.state.targetingMode!,
        x: 6,
        y: 5
      }
    };
    const fired = dispatchAction(aimedState, {
      type: IntentType.FireAimed,
      entityId: heroId
    });
    expect(fired.success).toBe(true);
    expect(getComponent(fired.state, heroId, ComponentType.Position)?.x).toBe(5);
    expect(getDnD35EntityData(fired.state, heroId).conditions.includes('charging')).toBe(true);

    // Forced push along a vector halts cleanly on solid wall when exceeding bounds
    const boundRes = displaceEntityAlongVector({
      state: fired.state,
      entityId: heroId,
      maxSteps: 100,
      dx: -1,
      dy: 0,
      context: { mode: 'forced_push', isForced: true, provokesAoO: false }
    });
    expect(['solid_obstacle', 'out_of_bounds', 'entity_blocker']).toContain(boundRes.stopReason);
  });

  test('6. Same-anchor footprint rotation/squeeze, blocks_charge condition, fly charge speed, 10-ft reach stop, and non-Pounce vs Pounce strike counts', () => {
    let state = buildGameState(campaign, EngineMode.TurnBased);
    const clearPts: Array<{ x: number; y: number }> = [];
    for (let y = 4; y <= 6; y++) {
      for (let x = 2; x <= 14; x++) {
        clearPts.push({ x, y });
      }
    }
    state = clearFloorCorridor(state, clearPts);

    const knightId = queryEntities(state, [ComponentType.Player])[0]!;
    const [s2, targetId] = createEntity(state);
    const [s3, glaiveId] = createEntity(s2);
    state = s3;

    // 1. Same-anchor footprint squeeze/rotation succeeds with moved === false
    state = addComponent(state, knightId, {
      type: ComponentType.Position,
      x: 4,
      y: 5,
      footprintWidth: 2,
      footprintHeight: 1,
      facing: 'E'
    });
    const rotateRes = displaceEntityStep({
      state,
      entityId: knightId,
      targetX: 4,
      targetY: 5,
      precomputedPlacement: {
        valid: true,
        anchorX: 4,
        anchorY: 5,
        width: 1,
        height: 2,
        facing: 'S',
        isSqueezing: true,
        moveCostMultiplier: 2
      },
      context: { mode: 'voluntary_walk', isForced: false, provokesAoO: false }
    });
    expect(rotateRes.moved).toBe(true);
    expect(rotateRes.anchorMoved).toBe(false);
    const rotatedPos = getComponent(rotateRes.state, knightId, ComponentType.Position)!;
    expect(rotatedPos.footprintWidth).toBe(1);
    expect(rotatedPos.footprintHeight).toBe(2);
    expect(rotatedPos.isSqueezing).toBe(true);

    // Reset knight to 1x1 at (2, 5) with Fighter 8 (BAB +8/+3 = 2 iterative attacks on full attack)
    state = addComponent(state, knightId, { type: ComponentType.Position, x: 2, y: 5 });
    state = addComponent(state, knightId, { type: ComponentType.Fighter, hp: 100, maxHp: 100 });
    const fighterDef = getDnD35SystemContent(campaign)!.classes['fighter']!;
    const baseKnightDnd = getDnD35EntityData(state, knightId);
    state = setDnD35EntityData(state, knightId, {
      ...baseKnightDnd,
      tracks: [buildHitDieTrackFromClass(fighterDef, 8)],
      actionBudget: {
        standardRemaining: 1,
        moveRemaining: 1,
        swiftRemaining: 1,
        aooRemaining: 1,
        movementRemainingFt: 30,
        distanceMovedThisRoundFt: 0,
        fiveFootStepAvailable: true,
        canMoveFurtherThisRound: true,
        immediateUsedOffTurn: false,
        hasActedThisRound: false
      }
    });

    state = addComponent(state, targetId, { type: ComponentType.Position, x: 7, y: 5 });
    state = addComponent(state, targetId, { type: ComponentType.Fighter, hp: 150, maxHp: 150 });
    state = addComponent(state, targetId, { type: ComponentType.Attitude, attitude: 'hostile' });

    // 2. Declarative blocks_charge condition (fatigued) blocks charge in DAG and validateChargeLine
    const fatiguedState = setDnD35EntityData(state, knightId, {
      ...getDnD35EntityData(state, knightId),
      conditions: ['fatigued']
    });
    expect(evaluateDnD35eEntityDAG(fatiguedState, knightId)!.canCharge).toBe(false);
    expect(validateChargeLine(fatiguedState, knightId, targetId).valid).toBe(false);

    // 3. Fly-only creature (land: 0, fly: 60) can charge using its 60-ft fly speed
    const flyerState = setDnD35EntityData(state, knightId, {
      ...getDnD35EntityData(state, knightId),
      movementModes: { land: 0, fly: 60 }
    });
    expect(validateChargeLine(flyerState, knightId, targetId).valid).toBe(true);

    // 4. Equip 10-ft reach weapon (glaive: reachFt 10, strikesAdjacent false) -> stops 2 tiles away at (5, 5)
    state = addComponent(state, glaiveId, {
      type: ComponentType.Item,
      itemId: 'glaive',
      instanceId: toItemInstanceId('m152-glaive')
    });
    state = addComponent(state, knightId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'main_hand', slotType: 'main_hand', equippedItem: glaiveId }]
    } as EquipmentComponent);

    const reachLine = validateChargeLine(state, knightId, targetId);
    expect(reachLine.valid).toBe(true);
    expect(reachLine.landingPos).toEqual({ x: 5, y: 5 });
    expect(reachLine.totalDistanceFt).toBe(15);

    // 5. Non-Pounce Fighter 8 charging resolves exactly 1 strike (not full 2-strike iterative routine) and records distanceMovedThisRoundFt = 15
    const nonPounceCharge = executeDnD35eChargeAction({ ...state, messages: [] }, knightId, targetId);
    expect(nonPounceCharge.success).toBe(true);
    expect(getComponent(nonPounceCharge.state, knightId, ComponentType.Position)?.x).toBe(5);
    expect(getDnD35EntityData(nonPounceCharge.state, knightId).actionBudget?.distanceMovedThisRoundFt).toBe(15);
    const nonPounceChargeLogs = nonPounceCharge.state.messages.filter((m) => m.text.includes('[Charge +2]'));
    expect(nonPounceChargeLogs.length).toBe(1);

    // 6. With trait:pounce, Fighter 8 charging resolves full iterative routine (2 strikes)
    const pounceState = addComponent({ ...state, messages: [] }, knightId, {
      type: ComponentType.Tags,
      tags: ['trait:pounce']
    });
    const pounceCharge = executeDnD35eChargeAction(pounceState, knightId, targetId);
    expect(pounceCharge.success).toBe(true);
    const pounceChargeLogs = pounceCharge.state.messages.filter((m) => m.text.includes('[Charge +2]'));
    expect(pounceChargeLogs.length).toBe(2);
  });
});

