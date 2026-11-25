import { getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { createInteractionChain } from '../../../systems/interaction_provenance.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  displaceEntityAlongVector,
  evaluateTileTraversal,
  getEntityMovementModes
} from '../../../systems/movement_displacement.ts';
import {
  computeRectNearestDelta,
  evaluateFootprintOccupancy,
  resolveMovementFootprintPlacement
} from '../../../systems/movement_footprint.ts';
import type { TileDefinition } from '../../../types/campaign/world.ts';
import {
  ComponentType,
  type FighterComponent,
  type MovementModes,
  type PositionComponent,
  type PropertyOverlayComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { IntentType } from '../../../types/intents/intent.enum.ts';
import { isInMapBounds } from '../../../map/map_accessor.ts';
import { resolveDnD35eMeleeAttack } from '../cartridge/dnd35e_combat_adapter.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { computeActorTacticalLandSpeedFt } from '../cartridge/dnd35e_turn_budget.ts';
import {
  measureFootprintToFootprintDistanceFt,
  resolveDnD35eActorSpatialProfile
} from '../spatial/footprint_resolver.ts';
import { FEET_PER_GRID_SQUARE } from '../spatial/grid_geometry.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import { resolveEffectiveEntityDataWithOverlays } from '../wild_shape.ts';
import { CHARGE_MOVEMENT_MIN_FT } from './combat_acf_riders.ts';
import { applyConditionWithEscalation } from './maneuvers_conditions.ts';

/** Standard Charge full-round speed multiplier (`2x` tactical speed, PHB p. 154). */
const CHARGE_SPEED_MULTIPLIER = 2;

/** Minimum number of grid squares moved required for a Charge (`2` squares = `10 ft`, PHB p. 154). */
const CHARGE_MIN_STEPS = 2;

/** Alternating even-diagonal grid cost in feet (`10 ft`). */
const EVEN_DIAGONAL_COST_FT = 10;

/** Condition tags/IDs that physically prevent executing a Charge action. */
const CHARGE_BLOCKING_CONDITIONS: ReadonlySet<string> = new Set([
  'prone',
  'paralyzed',
  'helpless',
  'stunned',
  'unconscious',
  'grappled',
  'panicked'
]);

/** Structured validation output produced by `validateChargeLine`. */
export interface ChargeValidationResult {
  readonly valid: boolean;
  readonly reason?: string | undefined;
  readonly stepDeltas: ReadonlyArray<{ readonly dx: number; readonly dy: number }>;
  readonly totalDistanceFt: number;
  readonly ignoresDifficultTerrainForCharge: boolean;
  readonly landingPos?: { readonly x: number; readonly y: number } | undefined;
  readonly reachFt?: number | undefined;
  readonly strikesAdjacent?: boolean | undefined;
}

function canChargeTraverseTile(
  tileDef: TileDefinition | undefined,
  movementModes: MovementModes | undefined,
  ignoresDifficultTerrain: boolean,
  state?: Readonly<GameState>,
  x?: number,
  y?: number
): boolean {
  const evalRes = evaluateTileTraversal(tileDef, movementModes, state, x, y);
  if (evalRes.passability === 'unimpeded') return true;
  if (evalRes.passability === 'difficult') {
    return ignoresDifficultTerrain && tileDef?.blocksCharge !== true;
  }
  return false;
}

function computeActorTacticalChargeSpeedFt(
  state: Readonly<GameState>,
  actorId: EntityId,
  movementModes: MovementModes | undefined
): number {
  const landSpeed = movementModes?.land ?? 0;
  const flySpeed = movementModes?.fly ?? 0;
  const swimSpeed = movementModes?.swim ?? 0;
  const burrowSpeed = movementModes?.burrow ?? 0;
  const climbSpeed = movementModes?.climb ?? 0;

  if (flySpeed > 0 && flySpeed >= landSpeed) {
    return computeActorTacticalLandSpeedFt(state, actorId, flySpeed);
  }
  if (landSpeed > 0) {
    return computeActorTacticalLandSpeedFt(state, actorId, landSpeed);
  }
  const bestAltSpeed = Math.max(flySpeed, swimSpeed, burrowSpeed, climbSpeed);
  if (bestAltSpeed > 0) {
    return computeActorTacticalLandSpeedFt(state, actorId, bestAltSpeed);
  }
  return computeActorTacticalLandSpeedFt(state, actorId, undefined);
}

function resolvePrimaryChargeStrikeReach(
  state: Readonly<GameState>,
  attackerId: EntityId,
  naturalReachFt: number,
  precomputedEval?: ReturnType<typeof evaluateDnD35eEntityDAG>
): { readonly reachFt: number; readonly strikesAdjacent: boolean } {
  const attackerEval = precomputedEval ?? evaluateDnD35eEntityDAG(state, attackerId);
  const primaryStrike = attackerEval?.attackRoutine.strikes[0];
  if (!primaryStrike) {
    return { reachFt: naturalReachFt, strikesAdjacent: true };
  }
  const strikeReachFt = Math.max(naturalReachFt, primaryStrike.reachFt ?? naturalReachFt);
  const strikesAdjacent = primaryStrike.strikesAdjacent ?? true;
  return {
    reachFt: strikeReachFt,
    strikesAdjacent
  };
}

function isWithinLegalStrikeBand(distFt: number, reachFt: number, strikesAdjacent: boolean): boolean {
  if (distFt > reachFt) return false;
  if (!strikesAdjacent && distFt <= FEET_PER_GRID_SQUARE) {
    return false;
  }
  return true;
}

function computeBresenhamSteps(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): ReadonlyArray<{ readonly dx: number; readonly dy: number }> {
  const steps: Array<{ readonly dx: number; readonly dy: number }> = [];
  let x = startX;
  let y = startY;
  const totalDx = Math.abs(endX - startX);
  const totalDy = Math.abs(endY - startY);
  const sx = startX < endX ? 1 : -1;
  const sy = startY < endY ? 1 : -1;
  let err = totalDx - totalDy;

  const maxIter = Math.max(totalDx, totalDy) + 2;
  for (let i = 0; i < maxIter && (x !== endX || y !== endY); i++) {
    const e2 = 2 * err;
    let stepDx = 0;
    let stepDy = 0;
    if (e2 > -totalDy) {
      err -= totalDy;
      stepDx = sx;
    }
    if (e2 < totalDx) {
      err += totalDx;
      stepDy = sy;
    }
    if (stepDx === 0 && stepDy === 0) break;
    x += stepDx;
    y += stepDy;
    steps.push({ dx: stepDx, dy: stepDy });
  }
  return steps;
}

/**
 * Evaluates whether `attackerId` can legally execute an explicit Full-Round **Charge** action
 * against `defenderId`, checking Full-Round action availability, straight-line clear path (`charge_step`),
 * difficult terrain rules (or declarative `charge_ignores_difficult_terrain`), creature blockers,
 * minimum `10 ft` (`2` squares) distance, weapon reach band (`reachFt` and `strikesAdjacent`),
 * and maximum `2x` tactical speed range across all active movement modes (land, fly, swim, etc.).
 */
export function validateChargeLine(
  state: GameState,
  attackerId: EntityId,
  defenderId: EntityId
): ChargeValidationResult {
  const fail = (reason: string): ChargeValidationResult => ({
    valid: false,
    reason,
    stepDeltas: [],
    totalDistanceFt: 0,
    ignoresDifficultTerrainForCharge: false
  });

  if (attackerId === defenderId) {
    return fail('Cannot Charge yourself.');
  }

  const attackerFighter = getComponent(state, attackerId, ComponentType.Fighter) as FighterComponent | undefined;
  const defenderFighter = getComponent(state, defenderId, ComponentType.Fighter) as FighterComponent | undefined;
  const attackerPos = getComponent(state, attackerId, ComponentType.Position) as PositionComponent | undefined;
  const defenderPos = getComponent(state, defenderId, ComponentType.Position) as PositionComponent | undefined;

  if (!attackerFighter || attackerFighter.hp <= 0 || !attackerPos) {
    return fail('Attacker cannot act.');
  }
  if (!defenderFighter || defenderFighter.hp <= 0 || !defenderPos) {
    return fail('Charge requires a living target.');
  }

  const attackerOverlay = getComponent(state, attackerId, ComponentType.PropertyOverlay) as
    PropertyOverlayComponent | undefined;
  const attackerData = resolveEffectiveEntityDataWithOverlays(getDnD35EntityData(state, attackerId), attackerOverlay);
  if (attackerData.conditions.some((c) => CHARGE_BLOCKING_CONDITIONS.has(c))) {
    return fail('Current condition prevents executing a Charge.');
  }

  const budget = attackerData.actionBudget;
  if (budget) {
    if (budget.standardRemaining < 1 || budget.moveRemaining < 1 || budget.distanceMovedThisRoundFt > 0) {
      return fail('Charge requires a Full-Round Action with no prior movement this round.');
    }
  }

  const attackerEval = evaluateDnD35eEntityDAG(state, attackerId);
  if (attackerEval && !attackerEval.canAttack) {
    return fail('Cannot Charge while in Total Defense stance.');
  }
  if (attackerEval?.canCharge === false) {
    return fail('Current condition prevents executing a Charge.');
  }

  const ignoresDifficultTerrain =
    attackerEval?.chargeIgnoresDifficultTerrain === true ||
    (attackerEval?.selfTags.includes('trait:charge_ignores_difficult_terrain') ?? false);
  const attackerProfile = resolveDnD35eActorSpatialProfile(state, attackerId, attackerPos.facing);
  const naturalReachFt = Math.max(FEET_PER_GRID_SQUARE, attackerProfile.naturalReachTiles * FEET_PER_GRID_SQUARE);
  const { reachFt, strikesAdjacent } = resolvePrimaryChargeStrikeReach(state, attackerId, naturalReachFt, attackerEval);

  const atkW = Math.max(1, attackerPos.footprintWidth ?? attackerProfile.baseWidth);
  const atkH = Math.max(1, attackerPos.footprintHeight ?? attackerProfile.baseHeight);
  const defW = Math.max(1, defenderPos.footprintWidth ?? 1);
  const defH = Math.max(1, defenderPos.footprintHeight ?? 1);

  const movementModes = getEntityMovementModes(state, attackerId) ?? attackerData.movementModes;
  const attackerZ = attackerPos.z ?? 0;
  const defenderZ = defenderPos.z ?? 0;
  if (attackerZ !== defenderZ && (movementModes?.fly === undefined || movementModes.fly <= 0)) {
    return fail('Cannot Charge across elevation tiers without flight.');
  }

  const hStartDistFt = measureFootprintToFootprintDistanceFt(
    attackerPos.x,
    attackerPos.y,
    atkW,
    atkH,
    defenderPos.x,
    defenderPos.y,
    defW,
    defH
  );
  const feetPerZ = state.campaign.rules.map.feetPerZLevel ?? FEET_PER_GRID_SQUARE;
  const startDistFt = Math.max(hStartDistFt, Math.abs(attackerZ - defenderZ) * feetPerZ);
  if (startDistFt <= reachFt) {
    return fail('Too close to Charge; requires moving at least 10 ft in a straight line.');
  }

  const tacticalSpeedFt = computeActorTacticalChargeSpeedFt(state, attackerId, movementModes);
  const maxChargeDistanceFt = tacticalSpeedFt * CHARGE_SPEED_MULTIPLIER;

  const nearestDelta = computeRectNearestDelta(
    attackerPos.x,
    attackerPos.y,
    atkW,
    atkH,
    defenderPos.x,
    defenderPos.y,
    defW,
    defH
  );
  const rawSteps = computeBresenhamSteps(
    attackerPos.x,
    attackerPos.y,
    attackerPos.x + nearestDelta.dx,
    attackerPos.y + nearestDelta.dy
  );

  const validSteps: Array<{ readonly dx: number; readonly dy: number }> = [];
  let simPos: PositionComponent = attackerPos;
  let totalDistanceFt = 0;
  let diagonalCount = 0;

  for (const step of rawSteps) {
    const nextX = simPos.x + step.dx;
    const nextY = simPos.y + step.dy;
    if (!isInMapBounds(state.map, nextX, nextY)) {
      return fail('Charge path leaves the map.');
    }

    const placement = resolveMovementFootprintPlacement({
      state,
      entityId: attackerId,
      fromPos: simPos,
      dx: step.dx,
      dy: step.dy,
      canTraverse: (tileDef, tx, ty) =>
        canChargeTraverseTile(tileDef, movementModes, ignoresDifficultTerrain, state, tx, ty)
    });
    if (!placement.valid) {
      return fail('Charge line is blocked by an obstacle or difficult terrain.');
    }
    if (placement.isSqueezing) {
      return fail('Cannot Charge while squeezing through a narrow space.');
    }

    const occupancy = evaluateFootprintOccupancy({
      state,
      moverId: attackerId,
      moverPos: simPos,
      targetX: placement.anchorX,
      targetY: placement.anchorY,
      targetW: placement.width,
      targetH: placement.height
    });
    if (occupancy.blocked) {
      return fail('Charge line is obstructed by another creature.');
    }

    const isDiag = step.dx !== 0 && step.dy !== 0;
    const stepCostFt = isDiag && diagonalCount % 2 === 1 ? EVEN_DIAGONAL_COST_FT : FEET_PER_GRID_SQUARE;
    if (isDiag) diagonalCount += 1;
    totalDistanceFt += stepCostFt;
    validSteps.push(step);

    simPos = {
      ...simPos,
      x: placement.anchorX,
      y: placement.anchorY,
      footprintWidth: placement.width,
      footprintHeight: placement.height,
      ...(placement.facing !== undefined ? { facing: placement.facing } : {})
    };

    const currentDistFt = measureFootprintToFootprintDistanceFt(
      simPos.x,
      simPos.y,
      placement.width,
      placement.height,
      defenderPos.x,
      defenderPos.y,
      defW,
      defH
    );
    if (isWithinLegalStrikeBand(currentDistFt, reachFt, strikesAdjacent)) {
      break;
    }
  }

  const endDistFt = measureFootprintToFootprintDistanceFt(
    simPos.x,
    simPos.y,
    simPos.footprintWidth ?? atkW,
    simPos.footprintHeight ?? atkH,
    defenderPos.x,
    defenderPos.y,
    defW,
    defH
  );
  if (!isWithinLegalStrikeBand(endDistFt, reachFt, strikesAdjacent)) {
    return fail('Charge target cannot be reached along a clear straight line.');
  }
  if (validSteps.length < CHARGE_MIN_STEPS || totalDistanceFt < CHARGE_MOVEMENT_MIN_FT) {
    return fail('Charge requires moving at least 10 ft (2 squares) in a straight line.');
  }
  if (totalDistanceFt > maxChargeDistanceFt) {
    return fail(`Charge distance (${totalDistanceFt} ft) exceeds 2x tactical speed (${maxChargeDistanceFt} ft).`);
  }

  return {
    valid: true,
    stepDeltas: validSteps,
    totalDistanceFt,
    ignoresDifficultTerrainForCharge: ignoresDifficultTerrain,
    landingPos: { x: simPos.x, y: simPos.y },
    reachFt,
    strikesAdjacent
  };
}

/**
 * Initiates interactive two-step targeting mode (`verb: 'charge'`) up to `2x` tactical speed range.
 */
export function initiateDnD35eChargeTargeting(
  state: GameState,
  actorId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const pos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return { state, success: false };

  const dndData = getDnD35EntityData(state, actorId);
  const budget = dndData.actionBudget;
  if (budget && (budget.standardRemaining < 1 || budget.moveRemaining < 1 || budget.distanceMovedThisRoundFt > 0)) {
    return {
      state: addMessage(
        state,
        'Charge requires a Full-Round Action with no prior movement this round.',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const movementModes = getEntityMovementModes(state, actorId) ?? dndData.movementModes;
  const tacticalSpeedFt = computeActorTacticalChargeSpeedFt(state, actorId, movementModes);
  const maxRangeTiles = Math.floor((tacticalSpeedFt * CHARGE_SPEED_MULTIPLIER) / FEET_PER_GRID_SQUARE) + 1;
  const targetingMode = {
    active: true,
    x: pos.x,
    y: pos.y,
    maxRangeTiles,
    context: { verb: 'charge' }
  };

  return {
    state: addMessage(
      { ...state, targetingMode },
      `Charge active (range up to ${tacticalSpeedFt * CHARGE_SPEED_MULTIPLIER} ft). Select target creature and confirm.`,
      MessageLogCategory.System
    ),
    success: true
  };
}

function consumeFullRoundChargeBudget(state: GameState, actorId: EntityId, actualDistanceMovedFt: number): GameState {
  const dndData = getDnD35EntityData(state, actorId);
  if (!dndData.actionBudget) return state;
  return setDnD35EntityData(state, actorId, {
    ...dndData,
    actionBudget: {
      ...dndData.actionBudget,
      standardRemaining: 0,
      moveRemaining: 0,
      movementRemainingFt: 0,
      distanceMovedThisRoundFt: dndData.actionBudget.distanceMovedThisRoundFt + actualDistanceMovedFt,
      fiveFootStepAvailable: false,
      canMoveFurtherThisRound: false,
      hasActedThisRound: true
    }
  });
}

function computeActualChargeDistanceMovedFt(
  executedSteps: ReadonlyArray<{ readonly dx: number; readonly dy: number }>
): number {
  let distanceFt = 0;
  let diagonalCount = 0;
  for (const step of executedSteps) {
    const isDiag = step.dx !== 0 && step.dy !== 0;
    const stepCostFt = isDiag && diagonalCount % 2 === 1 ? EVEN_DIAGONAL_COST_FT : FEET_PER_GRID_SQUARE;
    if (isDiag) diagonalCount += 1;
    distanceFt += stepCostFt;
  }
  return distanceFt;
}

/**
 * Executes an explicit Full-Round **Charge** action (`PHB p. 154`) symmetrically for any actor:
 * 1. Validates straight-line Charge geometry, terrain, blockers, reach band, and Full-Round budget.
 * 2. Applies the `'charging'` condition (`-2 AC` until the start of the charger's next turn) immediately
 *    before displacement so Attacks of Opportunity during the charge movement observe the `-2 AC` penalty.
 * 3. Displaces the charger step-by-step via `displaceEntityAlongVector(..., { mode: 'charge_step', provokesAoO: true })`.
 * 4. Records actual `distanceMovedThisRoundFt` and consumes the actor's Full-Round action budget.
 * 5. Resolves melee strike(s) with `isChargeAttack: true` (`+2` charge attack bonus, single strike unless `Pounce`).
 */
export function executeDnD35eChargeAction(
  state: GameState,
  attackerId: EntityId,
  defenderId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const validation = validateChargeLine(state, attackerId, defenderId);
  if (!validation.valid) {
    return {
      state: addMessage(
        state,
        `[Charge] ${validation.reason ?? 'Cannot Charge target.'}`,
        MessageLogCategory.CombatMiss
      ),
      success: false
    };
  }

  const chargeChain = createInteractionChain(attackerId, {
    kind: 'action',
    actionId: 'charge',
    actorId: attackerId
  });

  // Apply 'charging' condition (-2 AC) immediately before displacement so AoOs observe the penalty (P3.2)
  const preDnd = getDnD35EntityData(state, attackerId);
  const preChargeState = setDnD35EntityData(state, attackerId, {
    ...preDnd,
    conditions: applyConditionWithEscalation(preDnd.conditions, 'charging')
  });

  const dispRes = displaceEntityAlongVector({
    state: preChargeState,
    entityId: attackerId,
    maxSteps: validation.stepDeltas.length,
    stepDeltas: validation.stepDeltas,
    context: {
      mode: 'charge_step',
      isForced: false,
      provokesAoO: true,
      sourceEntityId: attackerId,
      ignoresDifficultTerrainForCharge: validation.ignoresDifficultTerrainForCharge,
      interaction: chargeChain
    }
  });

  const executedSteps = validation.stepDeltas.slice(0, dispRes.stepsMoved);
  const actualDistanceMovedFt = computeActualChargeDistanceMovedFt(executedSteps);
  let nextState = consumeFullRoundChargeBudget(dispRes.state, attackerId, actualDistanceMovedFt);

  const postAtkFighter = getComponent(nextState, attackerId, ComponentType.Fighter) as FighterComponent | undefined;
  const postAtkPos = getComponent(nextState, attackerId, ComponentType.Position) as PositionComponent | undefined;
  const postDefFighter = getComponent(nextState, defenderId, ComponentType.Fighter) as FighterComponent | undefined;
  const postDefPos = getComponent(nextState, defenderId, ComponentType.Position) as PositionComponent | undefined;

  if (
    !postAtkFighter ||
    postAtkFighter.hp <= 0 ||
    !postAtkPos ||
    !postDefFighter ||
    postDefFighter.hp <= 0 ||
    !postDefPos
  ) {
    return { state: nextState, success: dispRes.moved };
  }

  const postDnd = getDnD35EntityData(nextState, attackerId);
  if (postDnd.conditions.some((c) => CHARGE_BLOCKING_CONDITIONS.has(c))) {
    nextState = addMessage(
      nextState,
      '[Charge] Movement was interrupted before reaching melee range!',
      MessageLogCategory.CombatMiss
    );
    return { state: nextState, success: true };
  }

  const postProfile = resolveDnD35eActorSpatialProfile(nextState, attackerId, postAtkPos.facing);
  const naturalReachFt = Math.max(FEET_PER_GRID_SQUARE, postProfile.naturalReachTiles * FEET_PER_GRID_SQUARE);
  const { reachFt, strikesAdjacent } = resolvePrimaryChargeStrikeReach(nextState, attackerId, naturalReachFt);
  const postDistFt = measureFootprintToFootprintDistanceFt(
    postAtkPos.x,
    postAtkPos.y,
    postAtkPos.footprintWidth ?? postProfile.baseWidth,
    postAtkPos.footprintHeight ?? postProfile.baseHeight,
    postDefPos.x,
    postDefPos.y,
    postDefPos.footprintWidth ?? 1,
    postDefPos.footprintHeight ?? 1
  );
  if (
    !isWithinLegalStrikeBand(postDistFt, reachFt, strikesAdjacent) ||
    dispRes.stepsMoved < CHARGE_MIN_STEPS ||
    actualDistanceMovedFt < CHARGE_MOVEMENT_MIN_FT
  ) {
    nextState = addMessage(
      nextState,
      '[Charge] Movement was interrupted before reaching melee range!',
      MessageLogCategory.CombatMiss
    );
    return { state: nextState, success: true };
  }

  const atkName = resolveEntityDisplayName(nextState, attackerId, 'Attacker');
  const defName = resolveEntityDisplayName(nextState, defenderId, 'Target');
  nextState = addMessage(
    nextState,
    `[Charge] ${atkName} charges ${actualDistanceMovedFt} ft into ${defName} (+2 attack, -2 AC until next turn)!`,
    MessageLogCategory.CombatHit
  );

  const meleeRes = resolveDnD35eMeleeAttack(
    nextState,
    {
      type: IntentType.MeleeAttack,
      entityId: attackerId,
      defenderId,
      interaction: chargeChain
    },
    {
      isChargeAttack: true,
      interaction: chargeChain,
      skipActionBudgetCheck: true
    }
  );
  nextState = meleeRes.state;

  return {
    state: nextState,
    success: true
  };
}
