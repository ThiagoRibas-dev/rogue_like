import { getComponent, resolveEntityDisplayName, withEcsBatchState } from '../core/ecs.ts';
import { ComponentType, type MovementModes, type PositionComponent } from '../types/components.types.ts';
import type { TileDefinition } from '../types/campaign/world.ts';
import type { GameEvent } from '../types/events.types.ts';
import type { GameState } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import type { MoveIntent } from '../types/intents/movement.intents.ts';
import { getFactionRelation } from '../utils/faction.ts';
import { getTileAt, getTileDefAt, getTileIdAt, isInMapBounds, setTileIdAt } from '../map/map_accessor.ts';
import { processApplyIntent } from './apply.system.ts';
import { processMeleeAttackIntent } from './combat.system.ts';
import { isPlayerControlledCompanion } from './companion_commands.system.ts';
import { processInteractIntent } from './intent.system.ts';
import { runActorMovementStep } from './lifecycle.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import {
  buildUpdatedPositionComponent,
  displaceEntityStep,
  evaluateTileTraversal,
  getEntityMovementModes
} from './movement_displacement.ts';
import { evaluateFootprintOccupancy, resolveMovementFootprintPlacement } from './movement_footprint.ts';

/**
 * Canonical Single Source of Truth for tile traversal validation across movement modes.
 * Delegates to `evaluateTileTraversal`, permitting `unimpeded` and `difficult` tiles for voluntary walking/flying/swimming/burrowing.
 *
 * @param tileDef TileDefinition of the target tile.
 * @param movementModes Optional MovementModes of the moving entity.
 * @param state Optional GameState used to check world-owned `CrossingComponent` entities at `(x, y)`.
 * @param x Optional grid X coordinate.
 * @param y Optional grid Y coordinate.
 * @returns True if the entity can voluntarily traverse the tile.
 */
export function canTraverseTile(
  tileDef: TileDefinition | undefined,
  movementModes?: MovementModes | undefined,
  state?: Readonly<GameState>,
  x?: number,
  y?: number
): boolean {
  const evalRes = evaluateTileTraversal(tileDef, movementModes, state, x, y);
  return evalRes.passability === 'unimpeded' || evalRes.passability === 'difficult';
}

/**
 * Processes a MoveIntent.
 * Checks for collision against walls, hazard tiles (accounting for multi-mode movement modes),
 * and entities using the spatial index, then delegates displacement to the Tier 1 kernel.
 * @param state The current GameState.
 * @param intent The MoveIntent to process.
 * @returns The new or original GameState.
 */
export function processMoveIntent(
  state: GameState,
  intent: MoveIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } {
  const { entityId, dx, dy } = intent;

  const position = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (position === undefined) {
    return { state, success: false };
  }

  const targetX: number = position.x + dx;
  const targetY: number = position.y + dy;

  if (!isInMapBounds(state.map, targetX, targetY)) {
    return { state, success: false };
  }

  const targetTile = getTileAt(state.map, targetX, targetY);
  if (targetTile === undefined) {
    return { state, success: false };
  }

  // 1. Multi-Tile Footprint Placement, Hard-Corner Diagonals & SRD Squeezing
  const movementModes = getEntityMovementModes(state, entityId);
  const placement = resolveMovementFootprintPlacement({
    state,
    entityId,
    fromPos: position,
    dx,
    dy,
    canTraverse: (def, tx, ty) => canTraverseTile(def, movementModes, state, tx, ty)
  });

  if (!placement.valid) {
    const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
    const directTileDef = state.campaign.tiles[targetTile.tileId];
    const bumpTileDef = directTileDef?.bumpTransition ? directTileDef : placement.blockedByObstacleDef;
    if (bumpTileDef?.bumpTransition) {
      let bumpX = targetX;
      let bumpY = targetY;
      if (bumpTileDef !== directTileDef) {
        const fw = Math.max(1, placement.width);
        const fh = Math.max(1, placement.height);
        bumpSearch: for (let oy = 0; oy < fh; oy++) {
          for (let ox = 0; ox < fw; ox++) {
            const bx = targetX + ox;
            const by = targetY + oy;
            if (!isInMapBounds(state.map, bx, by)) continue;
            if (getTileDefAt(state, bx, by)?.bumpTransition) {
              bumpX = bx;
              bumpY = by;
              break bumpSearch;
            }
          }
        }
      }
      if (getTileIdAt(state.map, bumpX, bumpY) !== undefined) {
        const nextMap = setTileIdAt(state.map, bumpX, bumpY, bumpTileDef.bumpTransition);
        let nextState: GameState = { ...state, map: nextMap, fovNeedsUpdate: true };
        if (isPlayer) {
          const msg = bumpTileDef.interactMessage ?? 'You bump into it.';
          nextState = addMessage(nextState, msg, MessageLogCategory.System);
        }
        return { state: nextState, success: true };
      }
    }

    if (isPlayer) {
      const tileDef = placement.blockedByObstacleDef ?? directTileDef;
      const evalBlocked = evaluateTileTraversal(tileDef, movementModes, state, targetX, targetY);
      const obstacleName =
        evalBlocked.hazardKind === 'pit' ||
        evalBlocked.hazardKind === 'chasm' ||
        tileDef?.tags?.includes('chasm') ||
        tileDef?.tags?.includes('pit')
          ? 'a deep chasm'
          : evalBlocked.hazardKind === 'water' ||
              evalBlocked.hazardKind === 'deep_water' ||
              tileDef?.tags?.includes('liquid') ||
              tileDef?.tags?.includes('water')
            ? 'deep water'
            : 'a wall';
      return {
        state: addMessage(state, `Ouch! You bumped into ${obstacleName}.`, MessageLogCategory.CombatHit),
        success: false
      };
    }
    return { state, success: false };
  }

  // 2. Entity Collision across Occupied Footprint
  const occupancy = evaluateFootprintOccupancy({
    state,
    moverId: entityId,
    moverPos: position,
    targetX: placement.anchorX,
    targetY: placement.anchorY,
    targetW: placement.width,
    targetH: placement.height
  });

  if (occupancy.meleeTargetId !== undefined) {
    return processMeleeAttackIntent(state, {
      type: IntentType.MeleeAttack,
      entityId,
      defenderId: occupancy.meleeTargetId
    });
  }

  if (occupancy.blocked) {
    const blockedByEntityId = occupancy.swapCandidateId ?? occupancy.solidBlockerId;
    if (blockedByEntityId !== undefined) {
      const dialogueComp = getComponent(state, blockedByEntityId, ComponentType.Dialogue);
      const interactable = getComponent(state, blockedByEntityId, ComponentType.Interactable);
      const originTileDef = getTileDefAt(state, position.x, position.y);
      const blockerPos = getComponent(state, blockedByEntityId, ComponentType.Position) as
        PositionComponent | undefined;
      const moverIsSingleTile = (position.footprintWidth ?? 1) === 1 && (position.footprintHeight ?? 1) === 1;
      const blockerIsSingleTile =
        blockerPos !== undefined && (blockerPos.footprintWidth ?? 1) === 1 && (blockerPos.footprintHeight ?? 1) === 1;
      const canFriendlySwap =
        !dialogueComp &&
        !interactable &&
        moverIsSingleTile &&
        blockerIsSingleTile &&
        (isPlayerControlledCompanion(state, entityId, blockedByEntityId) ||
          getFactionRelation(state, entityId, blockedByEntityId) === 'friendly') &&
        canTraverseTile(originTileDef, getEntityMovementModes(state, blockedByEntityId), state, position.x, position.y);

      if (canFriendlySwap && blockerPos) {
        const swapContext = { mode: 'swap' as const, isForced: false, provokesAoO: true };
        const moverPosComp = buildUpdatedPositionComponent(
          placement.anchorX,
          placement.anchorY,
          placement.width,
          placement.height,
          placement.facing,
          placement.isSqueezing,
          placement.profile,
          position.facing
        );
        let nextState = withEcsBatchState(state, (batch) => {
          batch.addComponent(entityId, moverPosComp);
          batch.addComponent(blockedByEntityId, {
            ...blockerPos,
            type: ComponentType.Position,
            x: position.x,
            y: position.y
          });
        });
        nextState = runActorMovementStep(
          nextState,
          entityId,
          { x: position.x, y: position.y },
          { x: placement.anchorX, y: placement.anchorY },
          swapContext
        );
        nextState = runActorMovementStep(
          nextState,
          blockedByEntityId,
          { x: placement.anchorX, y: placement.anchorY },
          { x: position.x, y: position.y },
          { mode: 'swap', isForced: false, provokesAoO: false }
        );

        const isPlayerMover = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
        if (isPlayerMover) {
          nextState = { ...nextState, fovNeedsUpdate: true };
          const companionName = resolveEntityDisplayName(nextState, blockedByEntityId, 'your ally');
          nextState = addMessage(nextState, `You swap places with ${companionName}.`, MessageLogCategory.System);
        }

        return { state: nextState, success: true };
      }

      if (dialogueComp) {
        return processInteractIntent(state, {
          type: IntentType.Interact,
          entityId,
          targetId: blockedByEntityId
        });
      }

      if (interactable && interactable.type === ComponentType.Interactable && interactable.intents.length > 0) {
        const firstIntent = interactable.intents[0];
        if (firstIntent && firstIntent.type === IntentType.Apply) {
          return processApplyIntent(state, {
            type: IntentType.Apply,
            entityId,
            verb: firstIntent.verb,
            target: { type: 'entity', entityId: blockedByEntityId }
          });
        }
      }

      const structural = getComponent(state, blockedByEntityId, ComponentType.Structural);
      if (structural) {
        const lock = getComponent(state, blockedByEntityId, ComponentType.Lock);
        if (
          structural.isDoor === true &&
          structural.isOpen !== true &&
          lock?.locked !== true &&
          structural.jammed !== true &&
          structural.spikedByEntityId === undefined
        ) {
          return processApplyIntent(state, {
            type: IntentType.Apply,
            entityId,
            verb: 'open',
            target: { type: 'entity', entityId: blockedByEntityId }
          });
        }
        return processMeleeAttackIntent(state, {
          type: IntentType.MeleeAttack,
          entityId,
          defenderId: blockedByEntityId
        });
      }
    }

    const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
    if (isPlayer) {
      return { state: addMessage(state, 'Something is in the way.', MessageLogCategory.CombatHit), success: false };
    }
    return { state, success: false };
  }

  // 3. Apply Movement via Atomic Tier 1 Displacement Kernel
  const dispRes = displaceEntityStep({
    state,
    entityId,
    targetX: placement.anchorX,
    targetY: placement.anchorY,
    context: { mode: 'voluntary_walk', isForced: false, provokesAoO: true },
    precomputedPlacement: placement,
    skipOccupancyCheck: true
  });

  let nextState = dispRes.state;
  const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
  if (isPlayer && placement.isSqueezing && position.isSqueezing !== true) {
    nextState = addMessage(
      nextState,
      'You squeeze into the narrow space (-4 attack, -4 AC, double movement cost).',
      MessageLogCategory.System
    );
  }

  return { state: nextState, success: dispRes.moved, events: dispRes.events };
}
