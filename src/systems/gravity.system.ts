import {
  DEFAULT_FALL_DAMAGE_PER_Z,
  DEFAULT_FEET_PER_Z_LEVEL,
  MAX_FALL_DISTANCE_Z
} from '../constants/world_chunk.constants.ts';
import { addComponent, getComponent, resolveEntityDisplayName } from '../core/ecs.ts';
import { getMapZBounds, getTileDefAt, isInMapBounds, isMultiZMap } from '../map/map_accessor.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import {
  ComponentType,
  type DamageComponent,
  type FighterComponent,
  type MovementModes,
  type PositionComponent,
  type PropertyOverlayComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { queryCrossingAtPosition } from './crossing.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

function resolveGravityMovementModes(state: Readonly<GameState>, entityId: EntityId): MovementModes | undefined {
  const overlay = getComponent(state, entityId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
  if (overlay?.movementModesOverride) {
    return overlay.movementModesOverride;
  }
  return getActiveRuleset(state as GameState).getEntityMovementModes?.(state as GameState, entityId);
}

/**
 * Evaluates whether an entity has physical or magical support preventing gravity from pulling it down from `(x, y, z)`.
 *
 * Returns `true` on single-Z maps, at the minimum Z stratum, when flying, when standing on floor/stairs/ladder/ramp
 * or a `CrossingComponent`, or when hovering directly above an opaque solid ceiling block.
 */
export function isEntitySupportedAt(
  state: Readonly<GameState>,
  entityId: EntityId,
  x: number,
  y: number,
  z: number
): boolean {
  if (!isMultiZMap(state.map)) return true;
  const { minZ } = getMapZBounds(state.map);
  if (z <= minZ) return true;

  const modes = resolveGravityMovementModes(state, entityId);
  if (modes?.fly !== undefined && modes.fly > 0) {
    return true;
  }

  if (queryCrossingAtPosition(state, x, y, z) !== undefined) {
    return true;
  }

  const tileDef = getTileDefAt(state, x, y, z);
  if (tileDef) {
    if (tileDef.hasFloorSupport === true) return true;
    if (
      tileDef.verticalLink === 'stairs_up' ||
      tileDef.verticalLink === 'stairs_down' ||
      tileDef.verticalLink === 'stairs_both' ||
      tileDef.verticalLink === 'ladder' ||
      tileDef.verticalLink === 'ramp'
    ) {
      return true;
    }
    if (tileDef.isClimbable === true) {
      return true;
    }
    if (
      tileDef.isOpenAir !== true &&
      tileDef.walkable === true &&
      tileDef.hazardKind !== 'pit' &&
      tileDef.hazardKind !== 'chasm'
    ) {
      return true;
    }
  }

  // If the current cell is open air, check whether the cell immediately below is an opaque solid ceiling block
  if (tileDef?.isOpenAir === true && isInMapBounds(state.map, x, y, z - 1)) {
    const belowDef = getTileDefAt(state, x, y, z - 1);
    if (belowDef && belowDef.isOpenAir !== true && !belowDef.walkable && belowDef.hazardKind === undefined) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves vertical gravity drop for an entity if its current `(x, y, z)` cell lacks support.
 * Drops step-by-step down through unsupported air/pit cells until landing on a supported Z level
 * (or bedrock `minZ`), then delegates impact resolution to `RulesetContract.onEntityFallLanded`
 * with a generic Console damage fallback.
 */
export function resolveGravityForEntity(
  state: GameState,
  entityId: EntityId
): { readonly state: GameState; readonly fellLevels: number; readonly finalZ: number } {
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return { state, fellLevels: 0, finalZ: 0 };

  const startZ = pos.z ?? 0;
  if (!isMultiZMap(state.map)) {
    return { state, fellLevels: 0, finalZ: startZ };
  }

  const { minZ } = getMapZBounds(state.map);
  let targetZ = startZ;
  let fellLevels = 0;

  while (
    targetZ > minZ &&
    fellLevels < MAX_FALL_DISTANCE_Z &&
    !isEntitySupportedAt(state, entityId, pos.x, pos.y, targetZ)
  ) {
    const nextZ = targetZ - 1;
    if (!isInMapBounds(state.map, pos.x, pos.y, nextZ)) break;
    const belowDef = getTileDefAt(state, pos.x, pos.y, nextZ);
    // Cannot fall inside an unwalkable solid rock cell (top face already handled by isEntitySupportedAt, guard anyway)
    if (belowDef && belowDef.isOpenAir !== true && !belowDef.walkable && belowDef.hazardKind === undefined) {
      break;
    }
    targetZ = nextZ;
    fellLevels += 1;
  }

  if (fellLevels === 0) {
    return { state, fellLevels: 0, finalZ: startZ };
  }

  const { z: _prevZ, ...restPos } = pos;
  const updatedPos: PositionComponent = {
    ...restPos,
    ...(targetZ !== 0 ? { z: targetZ } : {})
  };
  let nextState = addComponent(state, entityId, updatedPos);
  if (getComponent(nextState, entityId, ComponentType.Player) !== undefined) {
    nextState = { ...nextState, fovNeedsUpdate: true };
  }

  const activeRuleset = getActiveRuleset(nextState);
  if (activeRuleset.onEntityFallLanded) {
    nextState = activeRuleset.onEntityFallLanded(nextState, entityId, fellLevels, pos.x, pos.y, targetZ);
    return { state: nextState, fellLevels, finalZ: targetZ };
  }

  // Generic Console fallback damage when active ruleset does not supply custom fall math
  const feetPerZ = nextState.campaign.rules.map.feetPerZLevel ?? DEFAULT_FEET_PER_Z_LEVEL;
  const fallFeet = fellLevels * feetPerZ;
  const name = resolveEntityDisplayName(nextState, entityId, 'Someone');
  nextState = addMessage(nextState, `${name} falls ${fallFeet} ft!`, MessageLogCategory.CombatHit);

  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (fighter) {
    const damageAmount = fellLevels * DEFAULT_FALL_DAMAGE_PER_Z;
    const existingDamage = getComponent(nextState, entityId, ComponentType.Damage) as DamageComponent | undefined;
    const instance = {
      amount: damageAmount,
      tags: ['falling', 'bludgeoning'] as const
    };
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Damage,
      instances: existingDamage ? [...existingDamage.instances, instance] : [instance]
    });
  }

  return { state: nextState, fellLevels, finalZ: targetZ };
}
