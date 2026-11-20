import { addComponent, getComponent } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import type { TileDefinition } from '../types/campaign/world.ts';
import {
  ComponentType,
  type CrossingComponent,
  type MovementModes,
  type PositionComponent,
  type PropertyOverlayComponent
} from '../types/components.types.ts';
import type { CardinalFacing } from '../types/components/world_components.types.ts';
import { type GameEvent, GameEventType } from '../types/events.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import type {
  ActorSpatialProfile,
  DisplacementContext,
  DisplacementMode,
  DisplacementResult,
  TilePassabilityTier,
  TileTraversalEvaluation
} from '../types/ruleset.types.ts';
import { coordToIndex, isInBounds } from '../utils/grid.ts';
import { runActorMovementStep } from './lifecycle.system.ts';
import {
  evaluateFootprintOccupancy,
  type FootprintPlacementResult,
  getEntitySpatialProfile,
  resolveMovementFootprintPlacement
} from './movement_footprint.ts';

export type { DisplacementContext, DisplacementMode, DisplacementResult, TilePassabilityTier, TileTraversalEvaluation };

/** Default tile registry movement cost baseline representing normal 1x terrain (`100`). */
const NORMAL_TILE_MOVEMENT_COST = 100;

/** Minimum multiplier applied to difficult terrain (`2`). */
const DIFFICULT_TERRAIN_MIN_MULTIPLIER = 2;

function findActiveCrossingAtPosition(
  state: Readonly<GameState> | undefined,
  x: number | undefined,
  y: number | undefined
): CrossingComponent | undefined {
  if (!state || x === undefined || y === undefined) return undefined;
  const candidates = state.spatialIndex.get(`${x},${y}`);
  if (!candidates || candidates.length === 0) return undefined;
  for (const eid of candidates) {
    const crossing = getComponent(state, eid, ComponentType.Crossing) as CrossingComponent | undefined;
    if (crossing) return crossing;
  }
  return undefined;
}

/**
 * Constructs an updated `PositionComponent` preserving multi-tile footprint, facing, squeezing,
 * size-rank, sharing, and sub-tile scale metadata cleanly under `exactOptionalPropertyTypes`.
 */
export function buildUpdatedPositionComponent(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  facing: CardinalFacing | undefined,
  isSqueezing: boolean,
  profile: ActorSpatialProfile,
  existingFacing?: CardinalFacing
): PositionComponent {
  const effectiveFacing = profile.baseWidth !== profile.baseHeight ? (facing ?? existingFacing) : undefined;
  const isMultiTile = width > 1 || height > 1;
  return {
    type: ComponentType.Position,
    x: anchorX,
    y: anchorY,
    ...(isMultiTile || isSqueezing ? { footprintWidth: width, footprintHeight: height } : {}),
    ...(effectiveFacing !== undefined ? { facing: effectiveFacing } : {}),
    ...(isSqueezing ? { isSqueezing: true } : {}),
    ...(profile.sizeRankIndex !== 0 ? { sizeRankIndex: profile.sizeRankIndex } : {}),
    ...(profile.canShareTile ? { canShareTile: true } : {}),
    ...(profile.subTileScale !== 1 ? { subTileScale: profile.subTileScale } : {})
  };
}

/**
 * Resolves an entity's active `MovementModes` from Tier 1 `PropertyOverlayComponent` overrides
 * or via `RulesetContract.getEntityMovementModes` without cartridge-specific imports or ID branches.
 *
 * @param state Current immutable GameState.
 * @param entityId The acting entity ID.
 * @returns Active MovementModes or `undefined`.
 */
export function getEntityMovementModes(state: GameState, entityId: EntityId): MovementModes | undefined {
  const overlay = getComponent(state, entityId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
  if (overlay?.movementModesOverride) {
    return overlay.movementModesOverride;
  }
  const activeRuleset = getActiveRuleset(state);
  if (activeRuleset.getEntityMovementModes) {
    return activeRuleset.getEntityMovementModes(state, entityId);
  }
  return undefined;
}

/**
 * Classifies a tile into a 3-tier passability result (`unimpeded`, `difficult`, `hazardous`, `solid_obstacle`)
 * under an entity's active `MovementModes`. Declaratively evaluates `isSolidObstacle`, `hazardKind`,
 * `blocksCharge`, `walkable`, `traversableBy`, `movementCost`, legacy terrain tags (`pit`, `chasm`,
 * `water`, `liquid`, `burrowable`), and any live `CrossingComponent` spanning `(x, y)` in `state.spatialIndex`.
 *
 * @param tileDef TileDefinition of the evaluated tile.
 * @param movementModes Active MovementModes of the moving entity.
 * @param state Optional GameState used to inspect `state.spatialIndex` for placed world crossings.
 * @param x Optional grid X coordinate.
 * @param y Optional grid Y coordinate.
 * @returns Structured `TileTraversalEvaluation`.
 */
export function evaluateTileTraversal(
  tileDef: TileDefinition | undefined,
  movementModes?: MovementModes | undefined,
  state?: Readonly<GameState>,
  x?: number,
  y?: number
): TileTraversalEvaluation {
  if (!tileDef) {
    return {
      passability: 'solid_obstacle',
      moveCostMultiplier: 1,
      triggersSolidCollision: true,
      blocksCharge: true
    };
  }

  const tags = tileDef.tags ?? [];
  const traversableBy = tileDef.traversableBy ?? [];
  const canFly = movementModes?.fly !== undefined && movementModes.fly > 0;
  const canSwim = movementModes?.swim !== undefined && movementModes.swim > 0;
  const canBurrow = movementModes?.burrow !== undefined && movementModes.burrow > 0;

  if (tileDef.walkable) {
    const baseCost = tileDef.movementCost ?? NORMAL_TILE_MOVEMENT_COST;
    const isShallowWaterOrBog =
      tileDef.hazardKind === 'shallow_water' ||
      tileDef.hazardKind === 'bog' ||
      tags.includes('shallow_water') ||
      tags.includes('bog');
    const isDifficult =
      !canFly &&
      (baseCost > NORMAL_TILE_MOVEMENT_COST ||
        tileDef.blocksCharge === true ||
        tags.includes('difficult') ||
        isShallowWaterOrBog);
    const multiplier = isDifficult
      ? Math.max(DIFFICULT_TERRAIN_MIN_MULTIPLIER, Math.round(baseCost / NORMAL_TILE_MOVEMENT_COST))
      : 1;
    const passability: TilePassabilityTier = isDifficult ? 'difficult' : 'unimpeded';
    return {
      passability,
      moveCostMultiplier: multiplier,
      triggersSolidCollision: false,
      blocksCharge: tileDef.blocksCharge ?? isDifficult,
      ...(tileDef.hazardKind !== undefined ? { hazardKind: tileDef.hazardKind } : {})
    };
  }

  // World-owned crossing entity (`bridge`, `rope_line`, `ladder_span`, `frozen_surface`) overrides underlying hazards
  const activeCrossing = findActiveCrossingAtPosition(state, x, y);
  if (activeCrossing && tileDef.isSolidObstacle !== true) {
    if (activeCrossing.crossingKind === 'bridge') {
      return {
        passability: 'unimpeded',
        moveCostMultiplier: 1,
        triggersSolidCollision: false,
        blocksCharge: false
      };
    }
    return {
      passability: 'difficult',
      moveCostMultiplier: DIFFICULT_TERRAIN_MIN_MULTIPLIER,
      triggersSolidCollision: false,
      blocksCharge: true
    };
  }

  const isChasmOrPit =
    tileDef.hazardKind === 'pit' || tileDef.hazardKind === 'chasm' || tags.includes('pit') || tags.includes('chasm');
  const isWater =
    tileDef.hazardKind === 'water' ||
    tileDef.hazardKind === 'deep_water' ||
    tags.includes('water') ||
    tags.includes('liquid');
  const isBurrowable = tags.includes('burrowable') || traversableBy.includes('burrow');

  if ((isChasmOrPit || traversableBy.includes('fly')) && canFly) {
    return {
      passability: 'unimpeded',
      moveCostMultiplier: 1,
      triggersSolidCollision: false,
      blocksCharge: tileDef.blocksCharge ?? false,
      ...(tileDef.hazardKind !== undefined ? { hazardKind: tileDef.hazardKind } : {})
    };
  }

  if ((isWater || traversableBy.includes('swim')) && canSwim) {
    return {
      passability: 'unimpeded',
      moveCostMultiplier: 1,
      triggersSolidCollision: false,
      blocksCharge: tileDef.blocksCharge ?? false,
      ...(tileDef.hazardKind !== undefined ? { hazardKind: tileDef.hazardKind } : {})
    };
  }

  if (isBurrowable && canBurrow) {
    return {
      passability: 'unimpeded',
      moveCostMultiplier: 1,
      triggersSolidCollision: false,
      blocksCharge: tileDef.blocksCharge ?? false
    };
  }

  if (tileDef.isSolidObstacle === true) {
    return {
      passability: 'solid_obstacle',
      moveCostMultiplier: 1,
      triggersSolidCollision: true,
      blocksCharge: true,
      ...(tileDef.hazardKind !== undefined ? { hazardKind: tileDef.hazardKind } : {})
    };
  }

  const inferredHazardKind =
    tileDef.hazardKind ?? (isChasmOrPit ? (tags.includes('pit') ? 'pit' : 'chasm') : isWater ? 'water' : undefined);
  if (inferredHazardKind !== undefined && !tags.includes('wall') && !tags.includes('solid')) {
    return {
      passability: 'hazardous',
      moveCostMultiplier: 1,
      triggersSolidCollision: false,
      blocksCharge: true,
      hazardKind: inferredHazardKind
    };
  }

  return {
    passability: 'solid_obstacle',
    moveCostMultiplier: 1,
    triggersSolidCollision: true,
    blocksCharge: true
  };
}

function canModeTraverseEvaluation(
  evalRes: TileTraversalEvaluation,
  context: DisplacementContext,
  tileDef: TileDefinition | undefined
): boolean {
  switch (evalRes.passability) {
    case 'unimpeded':
      return true;
    case 'difficult':
      if (context.mode === 'charge_step') {
        return context.ignoresDifficultTerrainForCharge === true && tileDef?.blocksCharge !== true;
      }
      return true;
    case 'hazardous':
      return context.mode === 'forced_push' || context.mode === 'forced_pull';
    case 'solid_obstacle':
      return false;
  }
}

function evaluateFootprintMaxTier(
  state: GameState,
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  movementModes: MovementModes | undefined,
  context: DisplacementContext
): {
  readonly allowed: boolean;
  readonly enteredHazard: boolean;
  readonly stopReason: DisplacementResult['stopReason'];
  readonly collidedTileId: string | undefined;
} {
  let enteredHazard = false;
  let blockedReason: DisplacementResult['stopReason'] | undefined;
  let collidedTileId: string | undefined;

  for (let oy = 0; oy < height; oy++) {
    for (let ox = 0; ox < width; ox++) {
      const tx = anchorX + ox;
      const ty = anchorY + oy;
      if (!isInBounds(tx, ty, state.map.width, state.map.height)) {
        return { allowed: false, enteredHazard: false, stopReason: 'out_of_bounds', collidedTileId: undefined };
      }
      const tile = state.map.tiles[coordToIndex(tx, ty, state.map.width)];
      const tileDef = tile ? state.campaign.tiles[tile.tileId] : undefined;
      const evalRes = evaluateTileTraversal(tileDef, movementModes, state, tx, ty);
      if (evalRes.passability === 'hazardous') {
        enteredHazard = true;
      }
      if (!canModeTraverseEvaluation(evalRes, context, tileDef)) {
        if (evalRes.passability === 'solid_obstacle') {
          return {
            allowed: false,
            enteredHazard: false,
            stopReason: 'solid_obstacle',
            collidedTileId: tile?.tileId
          };
        }
        if (evalRes.passability === 'difficult') {
          blockedReason = blockedReason ?? 'difficult_terrain_blocked';
          collidedTileId = collidedTileId ?? tile?.tileId;
        } else {
          blockedReason = blockedReason ?? 'hazard_halted';
          collidedTileId = collidedTileId ?? tile?.tileId;
        }
      }
    }
  }

  if (blockedReason !== undefined) {
    return { allowed: false, enteredHazard, stopReason: blockedReason, collidedTileId };
  }

  return { allowed: true, enteredHazard, stopReason: 'completed', collidedTileId: undefined };
}

function buildTileEnteredEvents(state: GameState, entityId: EntityId, x: number, y: number): ReadonlyArray<GameEvent> {
  if (!isInBounds(x, y, state.map.width, state.map.height)) return [];
  const tile = state.map.tiles[coordToIndex(x, y, state.map.width)];
  if (!tile) return [];
  const tileTags = state.campaign.tiles[tile.tileId]?.tags ?? [tile.tileId];
  return tileTags.map((tag) => ({
    type: GameEventType.TileEntered as const,
    entityId,
    x,
    y,
    tileTag: tag
  }));
}

/**
 * Executes a single atomic spatial displacement step to `(targetX, targetY)`:
 * 1. Validates tile passability policy against `context.mode`.
 * 2. Resolves multi-tile footprint placement, hard-corner diagonals, squeezing, and occupancy.
 * 3. Commits updated `PositionComponent` atomically, flags `fovNeedsUpdate` for player,
 *    invokes `runActorMovementStep(..., context)`, and emits `TileEntered` events.
 *
 * @param params Structured displacement request parameters.
 * @returns `DisplacementResult` detailing final position, stop reason, and emitted events.
 */
export function displaceEntityStep(params: {
  readonly state: GameState;
  readonly entityId: EntityId;
  readonly targetX: number;
  readonly targetY: number;
  readonly context: DisplacementContext;
  readonly precomputedPlacement?: FootprintPlacementResult | undefined;
  readonly skipOccupancyCheck?: boolean | undefined;
}): DisplacementResult {
  const { state, entityId, targetX, targetY, context, precomputedPlacement, skipOccupancyCheck } = params;
  const fromPos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!fromPos) {
    return {
      state,
      moved: false,
      stepsMoved: 0,
      finalPos: { x: targetX, y: targetY },
      stopReason: 'out_of_bounds',
      events: []
    };
  }

  if (!isInBounds(targetX, targetY, state.map.width, state.map.height)) {
    return {
      state,
      moved: false,
      stepsMoved: 0,
      finalPos: { x: fromPos.x, y: fromPos.y },
      stopReason: 'out_of_bounds',
      events: []
    };
  }

  const movementModes = getEntityMovementModes(state, entityId);
  const dx = targetX - fromPos.x;
  const dy = targetY - fromPos.y;
  const isAdjacentStep = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx !== 0 || dy !== 0);

  let anchorX = targetX;
  let anchorY = targetY;
  let width = Math.max(1, fromPos.footprintWidth ?? 1);
  let height = Math.max(1, fromPos.footprintHeight ?? 1);
  let facing = fromPos.facing;
  let isSqueezing = fromPos.isSqueezing === true;
  let profile = getEntitySpatialProfile(state, entityId, fromPos.facing);
  let enteredHazard = false;

  if (context.mode === 'teleport' || !isAdjacentStep) {
    width = profile.baseWidth;
    height = profile.baseHeight;
    isSqueezing = false;
    const tierCheck = evaluateFootprintMaxTier(state, anchorX, anchorY, width, height, movementModes, context);
    if (!tierCheck.allowed) {
      return {
        state,
        moved: false,
        stepsMoved: 0,
        finalPos: { x: fromPos.x, y: fromPos.y },
        stopReason: tierCheck.stopReason,
        ...(tierCheck.collidedTileId !== undefined ? { collidedTileId: tierCheck.collidedTileId } : {}),
        events: []
      };
    }
    enteredHazard = tierCheck.enteredHazard;
  } else {
    const placement =
      precomputedPlacement ??
      resolveMovementFootprintPlacement({
        state,
        entityId,
        fromPos,
        dx,
        dy,
        canTraverse: (tileDef, tx, ty) =>
          canModeTraverseEvaluation(evaluateTileTraversal(tileDef, movementModes, state, tx, ty), context, tileDef)
      });

    if (!placement.valid) {
      const tierCheck = evaluateFootprintMaxTier(
        state,
        targetX,
        targetY,
        profile.baseWidth,
        profile.baseHeight,
        movementModes,
        context
      );
      const stopReason: DisplacementResult['stopReason'] =
        tierCheck.stopReason === 'completed' ? 'solid_obstacle' : tierCheck.stopReason;
      return {
        state,
        moved: false,
        stepsMoved: 0,
        finalPos: { x: fromPos.x, y: fromPos.y },
        stopReason,
        ...(tierCheck.collidedTileId !== undefined ? { collidedTileId: tierCheck.collidedTileId } : {}),
        events: []
      };
    }

    anchorX = placement.anchorX;
    anchorY = placement.anchorY;
    width = placement.width;
    height = placement.height;
    facing = placement.facing;
    isSqueezing = placement.isSqueezing;
    profile = placement.profile;

    const postTierCheck = evaluateFootprintMaxTier(state, anchorX, anchorY, width, height, movementModes, context);
    enteredHazard = postTierCheck.enteredHazard;
  }

  if (skipOccupancyCheck !== true) {
    const occupancy = evaluateFootprintOccupancy({
      state,
      moverId: entityId,
      moverPos: fromPos,
      targetX: anchorX,
      targetY: anchorY,
      targetW: width,
      targetH: height
    });
    if (occupancy.blocked) {
      const blockerId = occupancy.meleeTargetId ?? occupancy.solidBlockerId ?? occupancy.swapCandidateId;
      return {
        state,
        moved: false,
        stepsMoved: 0,
        finalPos: { x: fromPos.x, y: fromPos.y },
        stopReason: 'entity_blocker',
        ...(blockerId !== undefined ? { collidedEntityId: blockerId } : {}),
        events: []
      };
    }
  }

  const nextPos = buildUpdatedPositionComponent(
    anchorX,
    anchorY,
    width,
    height,
    facing,
    isSqueezing,
    profile,
    fromPos.facing
  );

  let nextState = addComponent(state, entityId, nextPos);
  if (getComponent(nextState, entityId, ComponentType.Player) !== undefined) {
    nextState = { ...nextState, fovNeedsUpdate: true };
  }
  nextState = runActorMovementStep(
    nextState,
    entityId,
    { x: fromPos.x, y: fromPos.y },
    { x: anchorX, y: anchorY },
    context
  );
  const events = buildTileEnteredEvents(nextState, entityId, anchorX, anchorY);

  return {
    state: nextState,
    moved: anchorX !== fromPos.x || anchorY !== fromPos.y,
    stepsMoved: 1,
    finalPos: { x: anchorX, y: anchorY },
    stopReason: enteredHazard ? 'hazard_halted' : 'completed',
    events
  };
}

/**
 * Displaces an entity step-by-step along a sequence of unit grid deltas or a constant direction vector,
 * halting cleanly on solid obstacles (`solid_obstacle`), entity collisions (`entity_blocker`),
 * hazards (`hazard_halted`, stopping inside the hazard when forced), or difficult terrain (`difficult_terrain_blocked`).
 *
 * @param params Multi-step displacement parameters (`stepDeltas` or `dx, dy, maxSteps`).
 * @returns Aggregate `DisplacementResult` after all executed steps.
 */
export function displaceEntityAlongVector(params: {
  readonly state: GameState;
  readonly entityId: EntityId;
  readonly maxSteps: number;
  readonly dx?: number | undefined;
  readonly dy?: number | undefined;
  readonly stepDeltas?: ReadonlyArray<{ readonly dx: number; readonly dy: number }> | undefined;
  readonly context: DisplacementContext;
}): DisplacementResult {
  const { entityId, maxSteps, context, stepDeltas } = params;
  const dirX = Math.sign(params.dx ?? 0);
  const dirY = Math.sign(params.dy ?? 0);

  let runningState = params.state;
  const allEvents: GameEvent[] = [];
  let stepsMoved = 0;

  const initialPos = getComponent(runningState, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!initialPos) {
    return {
      state: runningState,
      moved: false,
      stepsMoved: 0,
      finalPos: { x: 0, y: 0 },
      stopReason: 'out_of_bounds',
      events: []
    };
  }

  let currentX = initialPos.x;
  let currentY = initialPos.y;
  let stopReason: DisplacementResult['stopReason'] = 'completed';
  let collidedTileId: string | undefined;
  let collidedEntityId: EntityId | undefined;

  const totalIterations = stepDeltas ? stepDeltas.length : Math.max(0, maxSteps);
  for (let i = 0; i < totalIterations; i++) {
    const step = stepDeltas ? stepDeltas[i]! : { dx: dirX, dy: dirY };
    if (step.dx === 0 && step.dy === 0) break;

    const livePos = getComponent(runningState, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!livePos) break;

    const stepRes = displaceEntityStep({
      state: runningState,
      entityId,
      targetX: livePos.x + step.dx,
      targetY: livePos.y + step.dy,
      context
    });

    runningState = stepRes.state;
    if (stepRes.events.length > 0) {
      allEvents.push(...stepRes.events);
    }

    if (!stepRes.moved) {
      stopReason = stepRes.stopReason;
      collidedTileId = stepRes.collidedTileId;
      collidedEntityId = stepRes.collidedEntityId;
      break;
    }

    stepsMoved += 1;
    currentX = stepRes.finalPos.x;
    currentY = stepRes.finalPos.y;

    if (stepRes.stopReason === 'hazard_halted') {
      stopReason = 'hazard_halted';
      break;
    }
  }

  return {
    state: runningState,
    moved: stepsMoved > 0,
    stepsMoved,
    finalPos: { x: currentX, y: currentY },
    stopReason,
    ...(collidedTileId !== undefined ? { collidedTileId } : {}),
    ...(collidedEntityId !== undefined ? { collidedEntityId } : {}),
    events: allEvents
  };
}
