import { describe, expect, test } from 'bun:test';
import { addComponent, getComponent, queryEntities, spawnEntity } from '../src/core/ecs.ts';
import { buildTacticalViewportData } from '../src/rendering/tactical_snapshot.ts';
import { buildViewportSnapshot } from '../src/rendering/viewport_snapshot.ts';
import {
  consumeMovementStepFt,
  createRoundActionBudget,
  takeFiveFootStep
} from '../src/rulesets/dnd35e/action_economy.ts';
import { evaluateDnD35eEntityDAG, resolveDnD35eActionEnergyCost } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { enumerateSpellTargets } from '../src/rulesets/dnd35e/magic/target_category_filter.ts';
import { evaluateEntityFlankingTarget } from '../src/rulesets/dnd35e/spatial/flanking_graph.ts';
import {
  computeTacticalLandSpeedWithArmor,
  measureFootprintToFootprintDistanceFt,
  measureFootprintToTileDistanceFt,
  resolveDnD35eActorSpatialProfile,
  resolveEntityBaseFootprintDimensions,
  syncDnD35eActorSpatialFootprint
} from '../src/rulesets/dnd35e/spatial/footprint_resolver.ts';
import { FEET_PER_GRID_SQUARE, SIZE_METRICS } from '../src/rulesets/dnd35e/spatial/grid_geometry.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import type { CreatureSizeCategory } from '../src/rulesets/dnd35e/types/stats.types.ts';
import { processMoveIntent } from '../src/systems/movement.system.ts';
import {
  computeRectDistanceTiles,
  computeRectNearestDelta,
  evaluateFootprintOccupancy,
  isFootprintDiagonalBlockedByHardCorner
} from '../src/systems/movement_footprint.ts';
import { ComponentType, type FighterComponent, type PositionComponent } from '../src/types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { coordToIndex } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function buildOpenArenaState(
  campaign: ReturnType<typeof loadCampaignFromDisk>,
  width: number,
  height: number,
  floorTileId?: string
): GameState {
  const base = buildGameState(campaign);
  const resolvedFloorId =
    floorTileId ?? Object.values(campaign.tiles).find((t) => t.walkable && (t.movementCost ?? 100) <= 100)?.id ?? 'stone_floor';
  const tiles = Array.from({ length: width * height }, () => ({
    tileId: resolvedFloorId,
    explored: true,
    visible: true
  }));
  // Keep only the player entity to avoid stray campaign mobs colliding inside open arena tests
  const playerIds = queryEntities(base, [ComponentType.Player]);
  return {
    ...base,
    engineMode: EngineMode.TurnBased,
    entities: playerIds,
    spatialIndex: new Map(),
    map: {
      ...base.map,
      width,
      height,
      tiles,
      isFullyExplored: true
    }
  };
}

function setMapTile(state: GameState, x: number, y: number, tileId: string): GameState {
  const nextTiles = [...state.map.tiles];
  nextTiles[coordToIndex(x, y, state.map.width)] = { tileId, explored: true, visible: true };
  return {
    ...state,
    map: {
      ...state.map,
      tiles: nextTiles
    }
  };
}

function createMinimalActorWithSize(
  baseState: GameState,
  x: number,
  y: number,
  sizeCategory: CreatureSizeCategory,
  faction?: string,
  extraDndData: Partial<ReturnType<typeof getDnD35EntityData>> = {}
): { readonly state: GameState; readonly entityId: EntityId } {
  const [spawnedState, entityId] = spawnEntity(baseState, 'skeleton', x, y);
  const data = getDnD35EntityData(spawnedState, entityId);
  let next = setDnD35EntityData(spawnedState, entityId, {
    ...data,
    creatureType: 'humanoid',
    subtypes: [],
    immunities: [],
    sizeCategory,
    ...extraDndData
  });
  const factionComp = getComponent(next, entityId, ComponentType.Faction);
  if (factionComp && faction !== undefined) {
    next = addComponent(next, entityId, { ...factionComp, factionId: faction });
  }
  next = syncDnD35eActorSpatialFootprint(next, entityId);
  return { state: next, entityId };
}

describe('D&D 3.5e Multi-Tile Footprints, Dynamic Size Rendering, SRD Squeezing & Tactical Movement', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');

  test('All 9 creature sizes resolve default square footprints, sub-tile scales, and multi-tile spatialIndex keys', () => {
    const expectedSpans: Record<CreatureSizeCategory, number> = {
      fine: 1,
      diminutive: 1,
      tiny: 1,
      small: 1,
      medium: 1,
      large: 2,
      huge: 3,
      gargantuan: 4,
      colossal: 6
    };
    const arena = buildOpenArenaState(campaign, 20, 20);

    for (const size of Object.keys(expectedSpans) as CreatureSizeCategory[]) {
      const dims = resolveEntityBaseFootprintDimensions(size);
      expect(dims.width).toBe(expectedSpans[size]);
      expect(dims.height).toBe(expectedSpans[size]);

      const { state, entityId } = createMinimalActorWithSize(arena, 4, 4, size);
      const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent;
      expect(pos.footprintWidth ?? 1).toBe(expectedSpans[size]);
      expect(pos.footprintHeight ?? 1).toBe(expectedSpans[size]);
      expect(pos.canShareTile ?? false).toBe(SIZE_METRICS[size].canShareTileWithMedium);

      if (size === 'fine' || size === 'diminutive' || size === 'tiny') {
        expect(pos.subTileScale ?? 1).toBeLessThan(1);
      } else {
        expect(pos.subTileScale ?? 1).toBe(1);
      }

      for (let dy = 0; dy < expectedSpans[size]; dy++) {
        for (let dx = 0; dx < expectedSpans[size]; dx++) {
          const occupants = state.spatialIndex.get(`${4 + dx},${4 + dy},0`) ?? [];
          expect(occupants).toContain(entityId);
        }
      }
    }
  });

  test('Declarative custom elongated footprint (1x3) rotates to 3x1 when moving East/West and 1x3 North/South', () => {
    const arena = buildOpenArenaState(campaign, 20, 20);
    const { state: initState, entityId: wormId } = createMinimalActorWithSize(arena, 6, 6, 'huge', 'hostile', {
      footprint: { width: 1, height: 3 }
    });

    // Move East -> rotates footprint horizontally to 3x1
    const moveEast = processMoveIntent(initState, {
      type: IntentType.Move,
      entityId: wormId,
      dx: 1,
      dy: 0
    });
    expect(moveEast.success).toBe(true);
    const eastPos = getComponent(moveEast.state, wormId, ComponentType.Position) as PositionComponent;
    expect(eastPos.facing).toBe('east');
    expect(eastPos.footprintWidth).toBe(3);
    expect(eastPos.footprintHeight).toBe(1);
    expect(moveEast.state.spatialIndex.get(`${eastPos.x + 2},${eastPos.y},0`) ?? []).toContain(wormId);

    // Move South -> rotates footprint vertically to 1x3
    const moveSouth = processMoveIntent(moveEast.state, {
      type: IntentType.Move,
      entityId: wormId,
      dx: 0,
      dy: 1
    });
    expect(moveSouth.success).toBe(true);
    const southPos = getComponent(moveSouth.state, wormId, ComponentType.Position) as PositionComponent;
    expect(southPos.facing).toBe('south');
    expect(southPos.footprintWidth).toBe(1);
    expect(southPos.footprintHeight).toBe(3);
    expect(moveSouth.state.spatialIndex.get(`${southPos.x},${southPos.y + 2},0`) ?? []).toContain(wormId);
  });

  test('Dynamic size modifiers (Enlarge/Reduce Person style) update PositionComponent footprint & AoE deduplication', () => {
    let state = buildOpenArenaState(campaign, 20, 20);
    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 2, y: 2 });
    state = syncDnD35eActorSpatialFootprint(state, playerId);

    const { state: s2, entityId: giantId } = createMinimalActorWithSize(state, 10, 10, 'medium');
    state = s2;
    expect((getComponent(state, giantId, ComponentType.Position) as PositionComponent).footprintWidth ?? 1).toBe(1);

    // Apply Enlarge (+1 size step -> Large 2x2)
    const gData = getDnD35EntityData(state, giantId);
    state = setDnD35EntityData(state, giantId, {
      ...gData,
      statModifiers: [
        ...(gData.statModifiers ?? []),
        {
          targetStat: 'size',
          value: 1,
          bonusType: 'size_step',
          sourceId: 'spell:enlarge_person:test',
          sourcePath: 'spell:enlarge_person/size'
        }
      ]
    });
    state = syncDnD35eActorSpatialFootprint(state, giantId);

    const enlargedPos = getComponent(state, giantId, ComponentType.Position) as PositionComponent;
    expect(enlargedPos.footprintWidth).toBe(2);
    expect(enlargedPos.footprintHeight).toBe(2);
    expect(state.spatialIndex.get('11,11,0') ?? []).toContain(giantId);

    // Fireball targeting (12, 12) radius 5 ft clips ONLY square (11, 11) of the 2x2 creature -> hits once!
    const fireball = getDnD35SystemContent(campaign)?.spells['fireball'];
    if (fireball) {
      const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
      const targets = enumerateSpellTargets(state, playerId, playerPos, { x: 11, y: 11 }, fireball, 1);
      const giantHits = targets.filter((id) => id === giantId);
      expect(giantHits.length).toBe(1);
    }
  });

  test('SRD Squeezing: 2x2 creature squeezes into 1-tile corridor, takes -4 Attack / -4 AC, and pays 2x (or 4x in difficult terrain)', () => {
    let state = buildOpenArenaState(campaign, 20, 20);
    const wallTileId =
      Object.values(state.campaign.tiles).find((t) => !t.walkable && !t.tags?.includes('chasm'))?.id ?? 'stone_wall';
    // Create vertical walls leaving a 1-tile corridor at x = 6, y = 4..8
    for (let y = 3; y <= 9; y++) {
      state = setMapTile(state, 5, y, wallTileId);
      state = setMapTile(state, 7, y, wallTileId);
    }
    // Put difficult terrain tile on corridor floor at (6, 4) -> wait, use existing difficult tile if any, or synthesize
    const difficultTileId =
      Object.values(state.campaign.tiles).find((t) => t.walkable && (t.movementCost ?? 100) > 100)?.id ?? 'rubble_test';
    if (!state.campaign.tiles[difficultTileId]) {
      state = {
        ...state,
        campaign: {
          ...state.campaign,
          tiles: {
            ...state.campaign.tiles,
            [difficultTileId]: {
              id: difficultTileId,
              name: 'Rubble',
              glyph: '^',
              fg: '#888888',
              bg: '#000000',
              walkable: true,
              transparent: true,
              movementCost: 200
            }
          }
        }
      };
    }

    const { state: s2, entityId: ogreId } = createMinimalActorWithSize(state, 5, 10, 'large', 'player');
    state = s2;

    const baselineEval = evaluateDnD35eEntityDAG(state, ogreId)!;

    // Move North into 1-tile wide opening at (6, 9) -> automatically shifts & squeezes to 1x2 at x=6, y=8!
    const preStep = state;
    const squeezeRes = processMoveIntent(state, {
      type: IntentType.Move,
      entityId: ogreId,
      dx: 0,
      dy: -1
    });
    expect(squeezeRes.success).toBe(true);
    const sqPos = getComponent(squeezeRes.state, ogreId, ComponentType.Position) as PositionComponent;
    expect(sqPos.isSqueezing).toBe(true);
    expect(sqPos.footprintWidth).toBe(1);
    expect(sqPos.footprintHeight).toBe(2);

    // Check -4 Attack / -4 AC penalty in Stat DAG
    const squeezedEval = evaluateDnD35eEntityDAG(squeezeRes.state, ogreId)!;
    expect(squeezedEval.selfTags).toContain('condition:squeezing');
    expect(squeezedEval.dagResult.attackBonus).toBe(baselineEval.dagResult.attackBonus - 4);
    expect(squeezedEval.dagResult.acBreakdown.fullAC).toBe(baselineEval.dagResult.acBreakdown.fullAC - 4);

    // Check 2x squeezing movement cost = 10 ft per 5-ft step
    const budgetAfterOne = resolveDnD35eActionEnergyCost(
      squeezeRes.state,
      { type: IntentType.Move, entityId: ogreId, dx: 0, dy: -1 },
      100,
      preStep
    );
    const ogreBudget1 = getDnD35EntityData(budgetAfterOne.state, ogreId).actionBudget!;
    expect(ogreBudget1.distanceMovedThisRoundFt).toBe(10);

    // Next step onto difficult terrain rubble at (6, 8) while squeezing (2x * 2x = 4x -> 20 ft!)
    let difficultCorridor = setMapTile(budgetAfterOne.state, 6, 8, difficultTileId);
    const preDifficult = difficultCorridor;
    const step2 = processMoveIntent(difficultCorridor, {
      type: IntentType.Move,
      entityId: ogreId,
      dx: 0,
      dy: -1
    });
    expect(step2.success).toBe(true);
    const budgetAfterDifficult = resolveDnD35eActionEnergyCost(
      step2.state,
      { type: IntentType.Move, entityId: ogreId, dx: 0, dy: -1 },
      100,
      preDifficult
    );
    // 10 ft + 20 ft = 30 ft total (or budget cleared on completion depending on ogre speed)
    const ogrePostData = getDnD35EntityData(budgetAfterDifficult.state, ogreId);
    if (ogrePostData.actionBudget) {
      expect(ogrePostData.actionBudget.distanceMovedThisRoundFt).toBe(30);
    } else {
      expect(budgetAfterDifficult.energyCost).toBe(100);
    }
  });

  test('Hard-corner diagonals block past wall corners while allowing diagonal steps past pits/chasms', () => {
    let state = buildOpenArenaState(campaign, 12, 12);
    const wallTileId =
      Object.values(state.campaign.tiles).find((t) => !t.walkable && !t.tags?.includes('chasm'))?.id ?? 'stone_wall';
    state = setMapTile(state, 5, 5, wallTileId);
    const chasmTileId =
      Object.values(state.campaign.tiles).find((t) => !t.walkable && t.tags?.includes('chasm'))?.id ?? 'chasm_test';
    if (!state.campaign.tiles[chasmTileId]) {
      state = {
        ...state,
        campaign: {
          ...state.campaign,
          tiles: {
            ...state.campaign.tiles,
            [chasmTileId]: {
              id: chasmTileId,
              name: 'Chasm',
              glyph: ' ',
              fg: '#000000',
              bg: '#000000',
              walkable: false,
              transparent: true,
              movementCost: 100,
              tags: ['chasm']
            }
          }
        }
      };
    }
    state = setMapTile(state, 3, 5, chasmTileId);

    const { state: s2, entityId: heroId } = createMinimalActorWithSize(state, 4, 5, 'medium', 'player');

    // NE from (4,5) -> (5,4) crosses wall corner (5,5) -> blocked by hard corner
    expect(isFootprintDiagonalBlockedByHardCorner(s2, 4, 5, 1, 1, 1, -1)).toBe(true);
    const blockedWallDiag = processMoveIntent(s2, { type: IntentType.Move, entityId: heroId, dx: 1, dy: -1 });
    expect(blockedWallDiag.success).toBe(false);

    // NW from (4,5) -> (3,4) crosses chasm (3,5) -> permitted diagonally!
    expect(isFootprintDiagonalBlockedByHardCorner(s2, 4, 5, 1, 1, -1, -1)).toBe(false);
    const allowedPitDiag = processMoveIntent(s2, { type: IntentType.Move, entityId: heroId, dx: -1, dy: -1 });
    expect(allowedPitDiag.success).toBe(true);
  });

  test('Tiny 0-ft reach, square-sharing, flanking suppression, helpless pass-through & Gelatinous Cube exception', () => {
    let state = buildOpenArenaState(campaign, 16, 16);
    const { state: s1, entityId: guardId } = createMinimalActorWithSize(state, 8, 8, 'medium');
    const { state: s2, entityId: ratId } = createMinimalActorWithSize(s1, 7, 8, 'tiny', 'player');
    const { state: s3, entityId: rogueId } = createMinimalActorWithSize(s2, 9, 8, 'medium', 'player');
    state = s3;

    const ratProfile = resolveDnD35eActorSpatialProfile(state, ratId);
    expect(ratProfile.naturalReachTiles).toBe(0);
    expect(ratProfile.canShareTile).toBe(true);

    // Tiny creature at (7,8) has 0-ft reach so cannot threaten/flank Medium guard at (8,8) across 5 ft
    const roguePos = getComponent(state, rogueId, ComponentType.Position) as PositionComponent;
    const guardPos = getComponent(state, guardId, ComponentType.Position) as PositionComponent;
    const isFlankedWithTinyAlly = evaluateEntityFlankingTarget({
      state,
      attackerId: rogueId,
      defenderId: guardId,
      attackerPos: roguePos,
      defenderPos: guardPos,
      attackerData: getDnD35EntityData(state, rogueId),
      defenderData: getDnD35EntityData(state, guardId),
      attackerSelfTags: [],
      defenderSelfTags: []
    });
    expect(isFlankedWithTinyAlly).toBe(false);

    // Tiny rat CAN step directly into the guard's occupied square (8,8) to achieve 0-ft reach
    const enterGuardSq = processMoveIntent(state, { type: IntentType.Move, entityId: ratId, dx: 1, dy: 0 });
    expect(enterGuardSq.success).toBe(true);
    const ratSharedPos = getComponent(enterGuardSq.state, ratId, ComponentType.Position) as PositionComponent;
    expect(ratSharedPos.x).toBe(8);
    expect(ratSharedPos.y).toBe(8);
    expect(
      measureFootprintToFootprintDistanceFt(
        ratSharedPos.x,
        ratSharedPos.y,
        1,
        1,
        guardPos.x,
        guardPos.y,
        1,
        1
      )
    ).toBe(0);

    // Designated exception (Gelatinous Cube fills space): blocks Tiny square sharing
    const { state: s4, entityId: cubeId } = createMinimalActorWithSize(state, 4, 8, 'large', undefined, {
      isCompletelyFillingSpace: true
    });
    const occCube = evaluateFootprintOccupancy({
      state: s4,
      moverId: ratId,
      moverPos: getComponent(s4, ratId, ComponentType.Position) as PositionComponent,
      targetX: 4,
      targetY: 8,
      targetW: 1,
      targetH: 1
    });
    expect(occCube.meleeTargetId).toBe(cubeId);

    // Helpless opponent pass-through: Guard knocked to negative HP lets rogue share/pass through
    const guardFighter = getComponent(state, guardId, ComponentType.Fighter) as FighterComponent;
    const helplessState = addComponent(state, guardId, { ...guardFighter, hp: -3 });
    expect(computeRectDistanceTiles(8, 8, 1, 1, 9, 8, 1, 1)).toBe(1);
    const stepOnHelpless = processMoveIntent(helplessState, { type: IntentType.Move, entityId: rogueId, dx: -1, dy: 0 });
    expect(stepOnHelpless.success).toBe(true);
  });

  test('Armor tactical speed table, 1-2-1-2 diagonals, Double Move & Minimum 1-Square Full-Round Move', () => {
    expect(computeTacticalLandSpeedWithArmor(30, true, false)).toBe(20);
    expect(computeTacticalLandSpeedWithArmor(20, true, false)).toBe(15);
    expect(computeTacticalLandSpeedWithArmor(40, true, false)).toBe(30); // Barbarian +10 ft before armor scaling
    expect(computeTacticalLandSpeedWithArmor(20, true, true)).toBe(20); // Dwarf trait:unencumbered_speed

    // 1-2-1-2 Diagonal counting + Double Move
    let budget = createRoundActionBudget({ dexModifier: 0 });
    const diag1 = consumeMovementStepFt(budget, 20, FEET_PER_GRID_SQUARE, 1, true);
    expect(diag1.allowed).toBe(true);
    expect(diag1.budget.distanceMovedThisRoundFt).toBe(5); // 1st diag = 5 ft
    expect(diag1.budget.moveRemaining).toBe(0);
    expect(diag1.budget.standardRemaining).toBe(1);

    const diag2 = consumeMovementStepFt(diag1.budget, 20, FEET_PER_GRID_SQUARE, 1, true);
    expect(diag2.allowed).toBe(true);
    expect(diag2.budget.distanceMovedThisRoundFt).toBe(15); // + 2nd diag 10 ft = 15 ft

    // Double Move triggers automatically when remaining ft (5 ft) < step cost (10 ft) using standard action!
    const diag4 = consumeMovementStepFt(diag2.budget, 20, FEET_PER_GRID_SQUARE, 2, false);
    expect(diag4.allowed).toBe(true);
    expect(diag4.budget.standardRemaining).toBe(0);

    // Minimum 1-Square Full-Round Move: speed 15 ft, hampered 4x on 2nd-style/difficult+squeezing 20 ft step -> wait
    // Test speed 15 ft facing a 40 ft single step cost (exceeds 15 + 15 = 30 ft Double Move!)
    const freshSlowBudget = createRoundActionBudget({ dexModifier: 0 });
    const minMove = consumeMovementStepFt(freshSlowBudget, 15, FEET_PER_GRID_SQUARE * 2, 4, false);
    expect(minMove.allowed).toBe(true);
    expect(minMove.budget.moveRemaining).toBe(0);
    expect(minMove.budget.standardRemaining).toBe(0);
    expect(minMove.budget.canMoveFurtherThisRound).toBe(false);
  });

  test('Viewport & tactical snapshots expose multi-tile footprints and shared sub-tile badges without 1x1 duplicates', () => {
    let state = buildOpenArenaState(campaign, 16, 16);
    const { state: s1, entityId: ogreId } = createMinimalActorWithSize(state, 5, 5, 'large', 'hostile');
    const { state: s2, entityId: ratId } = createMinimalActorWithSize(s1, 3, 3, 'tiny', 'friendly');
    const { state: s3, entityId: playerId } = createMinimalActorWithSize(s2, 3, 3, 'medium', 'player');
    state = s3;

    const visibleIndices = new Set<number>(
      Array.from({ length: state.map.width * state.map.height }, (_, idx) => idx)
    );
    const tactical = buildTacticalViewportData(state, 0, 0, 16, 16, visibleIndices);

    const ogreBadge = tactical.unitBadges.find((b) => b.vx === 5 && b.vy === 5);
    expect(ogreBadge).toBeDefined();
    expect(ogreBadge?.footprintW).toBe(2);
    expect(ogreBadge?.footprintH).toBe(2);

    const tinySharedBadge = tactical.unitBadges.find(
      (b) => b.vx === 3 && b.vy === 3 && (b.subTileScale ?? 1) < 1
    );
    expect(tinySharedBadge).toBeDefined();
    expect(tinySharedBadge?.isSharedTile).toBe(true);

    // Viewport snapshot must NOT duplicate 1x1 entitiesAtTile on secondary square (6, 6) of the 2x2 ogre
    const snap = buildViewportSnapshot(state, 16, 16);
    const cell66 = snap.cells.find((c) => c.vx === 6 && c.vy === 6);
    expect(cell66?.entities.length).toBe(0);
    expect(ogreId).not.toBe(ratId);
    expect(playerId).toBeGreaterThan(0);
  });

  test('Audit fixes: multi-tile flanking across non-anchor rows, helpless Large 2x obstacle cost, 5-ft step squeezing block & footprint range', () => {
    let state = buildOpenArenaState(campaign, 16, 16);
    // 1. Large 2x2 Ogre at (5,5)..(6,6) flanked on southern row y=6 by allies at (4,6) and (7,6)
    const { state: s1, entityId: ogreId } = createMinimalActorWithSize(state, 5, 5, 'large');
    const { state: s2, entityId: allyWestId } = createMinimalActorWithSize(s1, 4, 6, 'medium', 'player');
    const { state: s3, entityId: allyEastId } = createMinimalActorWithSize(s2, 7, 6, 'medium', 'player');
    state = s3;

    const ogrePos = getComponent(state, ogreId, ComponentType.Position) as PositionComponent;
    const westPos = getComponent(state, allyWestId, ComponentType.Position) as PositionComponent;
    expect(
      evaluateEntityFlankingTarget({
        state,
        attackerId: allyWestId,
        defenderId: ogreId,
        attackerPos: westPos,
        defenderPos: ogrePos,
        attackerData: getDnD35EntityData(state, allyWestId),
        defenderData: getDnD35EntityData(state, ogreId),
        attackerSelfTags: [],
        defenderSelfTags: []
      })
    ).toBe(true);

    // 2. Multi-tile footprint-to-tile distance and edge-relative nearest delta for 2x2 at (5,5)..(6,6) -> (7,6)
    expect(measureFootprintToTileDistanceFt(5, 5, 2, 2, 7, 6)).toBe(FEET_PER_GRID_SQUARE);
    expect(computeRectNearestDelta(5, 5, 2, 2, 7, 6, 1, 1)).toEqual({ dx: 1, dy: 0 });
    expect(computeRectNearestDelta(5, 5, 2, 2, 6, 6, 1, 1)).toEqual({ dx: 0, dy: 0 });

    // 3. Helpless Large (2x2) creature imposes 2x movement cost (10 ft) when stepped through
    const ogreFighter = getComponent(state, ogreId, ComponentType.Fighter) as FighterComponent;
    state = addComponent(state, ogreId, { ...ogreFighter, hp: -4 });
    const preMoveState = state;
    const moveOntoHelplessOgre = processMoveIntent(state, {
      type: IntentType.Move,
      entityId: allyWestId,
      dx: 1,
      dy: 0
    });
    expect(moveOntoHelplessOgre.success).toBe(true);
    const costRes = resolveDnD35eActionEnergyCost(
      moveOntoHelplessOgre.state,
      { type: IntentType.Move, entityId: allyWestId, dx: 1, dy: 0 },
      100,
      preMoveState
    );
    expect(getDnD35EntityData(costRes.state, allyWestId).actionBudget?.distanceMovedThisRoundFt).toBe(10);

    // 4. takeFiveFootStep is rejected when hampered / squeezing (multiplier > 1)
    const freshBudget = createRoundActionBudget({ dexModifier: 0 });
    expect(takeFiveFootStep(freshBudget, 2).allowed).toBe(false);
    expect(takeFiveFootStep(freshBudget, 1).allowed).toBe(true);
    expect(allyEastId).toBeGreaterThan(0);
  });
});
