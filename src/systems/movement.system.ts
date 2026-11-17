import { addComponent, getComponent } from '../core/ecs.ts';
import {
  ComponentType,
  type MovementModes,
  type PositionComponent,
  type PropertyOverlayComponent
} from '../types/components.types.ts';
import type { TileDefinition } from '../types/campaign/world.ts';
import { GameEventType } from '../types/events.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';

import type { GameEvent } from '../types/events.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import type { MoveIntent } from '../types/intents/movement.intents.ts';
import { getFactionRelation } from '../utils/faction.ts';
import { coordToIndex, isInBounds } from '../utils/grid.ts';
import { processMeleeAttackIntent } from './combat.system.ts';
import { processApplyIntent } from './apply.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { processInteractIntent } from './intent.system.ts';
import { runActorMovementStep } from './lifecycle.system.ts';
import { isPlayerControlledCompanion } from './companion_commands.system.ts';
import { evaluateFootprintOccupancy, resolveMovementFootprintPlacement } from './movement_footprint.ts';
import type { ActorSpatialProfile } from '../types/ruleset.types.ts';
import type { CardinalFacing } from '../types/components/world_components.types.ts';

function buildUpdatedPositionComponent(
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
    ...(isMultiTile ? { footprintWidth: width, footprintHeight: height } : {}),
    ...(effectiveFacing !== undefined ? { facing: effectiveFacing } : {}),
    ...(isSqueezing ? { isSqueezing: true } : {}),
    ...(profile.sizeRankIndex !== 0 ? { sizeRankIndex: profile.sizeRankIndex } : {}),
    ...(profile.canShareTile ? { canShareTile: true } : {}),
    ...(profile.subTileScale !== 1 ? { subTileScale: profile.subTileScale } : {})
  };
}

/**
 * Resolves active movement modes on an entity from PropertyOverlayComponent or RulesetDataComponent.
 */
function getEntityMovementModes(state: GameState, entityId: EntityId): MovementModes | undefined {
  const overlay = getComponent(state, entityId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
  if (overlay?.movementModesOverride) {
    return overlay.movementModesOverride;
  }
  const rulesetComp = getComponent(state, entityId, ComponentType.RulesetData);
  if (rulesetComp && rulesetComp.rulesetId === 'dnd35e' && rulesetComp.payload) {
    const dndData = rulesetComp.payload as { movementModes?: MovementModes };
    if (dndData.movementModes) {
      return dndData.movementModes;
    }
  }
  return undefined;
}

/**
 * Canonical Single Source of Truth for tile traversal validation across movement modes.
 * Walking creatures can traverse walkable tiles.
 * Flying creatures (fly > 0) can traverse chasms, pits, and tiles marked traversable by 'fly'.
 * Swimming creatures (swim > 0) can traverse water, liquid, and tiles marked traversable by 'swim'.
 * Burrowing creatures (burrow > 0) can traverse burrowable tiles.
 *
 * @param tileDef TileDefinition of the target tile.
 * @param movementModes Optional MovementModes of the moving entity.
 * @returns True if the entity can traverse the tile.
 */
export function canTraverseTile(
  tileDef: TileDefinition | undefined,
  movementModes?: MovementModes | undefined
): boolean {
  if (!tileDef) return false;
  if (tileDef.walkable) return true;

  const tags = tileDef.tags ?? [];
  const traversableBy = tileDef.traversableBy ?? [];

  if (
    (tags.includes('chasm') || tags.includes('pit') || traversableBy.includes('fly')) &&
    movementModes?.fly !== undefined &&
    movementModes.fly > 0
  ) {
    return true;
  }

  if (
    (tags.includes('water') || tags.includes('liquid') || traversableBy.includes('swim')) &&
    movementModes?.swim !== undefined &&
    movementModes.swim > 0
  ) {
    return true;
  }

  if (
    (tags.includes('burrowable') || traversableBy.includes('burrow')) &&
    movementModes?.burrow !== undefined &&
    movementModes.burrow > 0
  ) {
    return true;
  }

  return false;
}

/**
 * Processes a MoveIntent.
 * Checks for collision against walls, hazard tiles (accounting for multi-mode movement modes),
 * and entities using the spatial index.
 * Returns updated GameState if movement was successful, or the original GameState (plus a message) if blocked.
 * @param state The current GameState.
 * @param intent The MoveIntent to process.
 * @returns The new or original GameState.
 */
export function processMoveIntent(
  state: GameState,
  intent: MoveIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } {
  const { entityId, dx, dy } = intent;

  const position = getComponent(state, entityId, ComponentType.Position);
  if (position === undefined) {
    return { state, success: false };
  }

  const targetX: number = position.x + dx;
  const targetY: number = position.y + dy;

  if (!isInBounds(targetX, targetY, state.map.width, state.map.height)) {
    return { state, success: false };
  }

  const targetTileIndex: number = coordToIndex(targetX, targetY, state.map.width);
  const targetTile = state.map.tiles[targetTileIndex];
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
    canTraverse: (def) => canTraverseTile(def, movementModes)
  });

  if (!placement.valid) {
    const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
    const directTileDef = state.campaign.tiles[targetTile.tileId];
    const bumpTileDef = directTileDef?.bumpTransition ? directTileDef : placement.blockedByObstacleDef;
    if (bumpTileDef?.bumpTransition) {
      let bumpIdx = targetTileIndex;
      if (bumpTileDef !== directTileDef) {
        const fw = Math.max(1, placement.width);
        const fh = Math.max(1, placement.height);
        for (let oy = 0; oy < fh; oy++) {
          for (let ox = 0; ox < fw; ox++) {
            const bx = targetX + ox;
            const by = targetY + oy;
            if (!isInBounds(bx, by, state.map.width, state.map.height)) continue;
            const idx = coordToIndex(bx, by, state.map.width);
            const t = state.map.tiles[idx];
            if (t && state.campaign.tiles[t.tileId]?.bumpTransition) {
              bumpIdx = idx;
              break;
            }
          }
        }
      }
      const nextTiles = [...state.map.tiles];
      const existingBumpTile = nextTiles[bumpIdx];
      if (existingBumpTile) {
        nextTiles[bumpIdx] = { ...existingBumpTile, tileId: bumpTileDef.bumpTransition };
        const nextMap = { ...state.map, tiles: nextTiles };
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
      const obstacleName =
        tileDef?.tags?.includes('chasm') || tileDef?.tags?.includes('pit')
          ? 'a deep chasm'
          : tileDef?.tags?.includes('liquid') || tileDef?.tags?.includes('water')
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
      const originTile = state.map.tiles[coordToIndex(position.x, position.y, state.map.width)];
      const originTileDef = originTile ? state.campaign.tiles[originTile.tileId] : undefined;
      const blockerPos = getComponent(state, blockedByEntityId, ComponentType.Position);
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
        canTraverseTile(originTileDef, getEntityMovementModes(state, blockedByEntityId));

      if (canFriendlySwap) {
        const moverProfile = placement.profile;
        let nextState = addComponent(
          state,
          entityId,
          buildUpdatedPositionComponent(
            placement.anchorX,
            placement.anchorY,
            placement.width,
            placement.height,
            placement.facing,
            placement.isSqueezing,
            moverProfile,
            position.facing
          )
        );
        nextState = addComponent(nextState, blockedByEntityId, {
          ...blockerPos,
          type: ComponentType.Position,
          x: position.x,
          y: position.y
        });
        nextState = runActorMovementStep(
          nextState,
          entityId,
          { x: position.x, y: position.y },
          { x: placement.anchorX, y: placement.anchorY }
        );
        nextState = runActorMovementStep(
          nextState,
          blockedByEntityId,
          { x: placement.anchorX, y: placement.anchorY },
          { x: position.x, y: position.y }
        );

        const isPlayerMover = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
        if (isPlayerMover) {
          nextState = { ...nextState, fovNeedsUpdate: true };
          const identity = getComponent(nextState, blockedByEntityId, ComponentType.Identity);
          const companionName = identity ? identity.name : 'your ally';
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
    }

    const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
    if (isPlayer) {
      return { state: addMessage(state, 'Something is in the way.', MessageLogCategory.CombatHit), success: false };
    }
    return { state, success: false };
  }

  // 3. Apply Movement
  const moverProfile = placement.profile;
  const nextPosition = buildUpdatedPositionComponent(
    placement.anchorX,
    placement.anchorY,
    placement.width,
    placement.height,
    placement.facing,
    placement.isSqueezing,
    moverProfile,
    position.facing
  );

  let nextState = addComponent(state, entityId, nextPosition);
  nextState = runActorMovementStep(
    nextState,
    entityId,
    { x: position.x, y: position.y },
    { x: placement.anchorX, y: placement.anchorY }
  );

  const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
  if (isPlayer) {
    nextState = { ...nextState, fovNeedsUpdate: true };
    if (placement.isSqueezing && position.isSqueezing !== true) {
      nextState = addMessage(
        nextState,
        'You squeeze into the narrow space (-4 attack, -4 AC, double movement cost).',
        MessageLogCategory.System
      );
    }
  }

  const enteredTile =
    nextState.map.tiles[coordToIndex(placement.anchorX, placement.anchorY, nextState.map.width)] ?? targetTile;
  const tileTags = nextState.campaign.tiles[enteredTile.tileId]?.tags ?? [enteredTile.tileId];
  const events = tileTags.map((tag) => ({
    type: GameEventType.TileEntered as const,
    entityId,
    x: placement.anchorX,
    y: placement.anchorY,
    tileTag: tag
  }));

  return { state: nextState, success: true, events };
}
