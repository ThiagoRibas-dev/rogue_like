import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { ApplyIntent } from '../types/intents/interaction.intents.ts';
import {
  ComponentType,
  type ItemComponent,
  type PositionComponent,
  type DamageComponent,
  type CoatingComponent
} from '../types/components.types.ts';
import {
  getComponent,
  getEntitiesAtPosition,
  addComponent,
  removeComponent,
  removeEntity,
  resolveEntityDisplayName
} from '../core/ecs.ts';
import { getTileDefAt } from '../map/map_accessor.ts';
import { getBresenhamLine3D } from '../utils/grid.ts';
import { resolveGravityForEntity } from './gravity.system.ts';
import { processReactions } from './reaction.system.ts';
import { rng } from '../core/rng.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { applyStatusEffect } from './status-effect.system.ts';

/**
 * Processes the deterministic 3D flight of a thrown item, including 3D Bresenham trajectory,
 * wall/floor occlusion, open-air flight, entity collisions, range checks, scatter, and gravity drop.
 */
export function processProjectileThrow(state: GameState, intent: ApplyIntent): { state: GameState; success: boolean } {
  if (!intent.toolEntityId) return { state, success: false };

  const itemComp = getComponent(state, intent.toolEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return { state, success: false };

  const itemDef = state.campaign.items[itemComp.itemId];
  if (!itemDef) return { state, success: false };

  const throwerPos = getComponent(state, intent.entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!throwerPos) return { state, success: false };

  const throwerZ = throwerPos.z ?? 0;
  let targetX: number;
  let targetY: number;
  let targetZ: number;

  if (intent.target.type === 'tile') {
    targetX = intent.target.x;
    targetY = intent.target.y;
    targetZ = intent.target.z ?? throwerZ;
  } else if (intent.target.type === 'entity') {
    const targetPos = getComponent(state, intent.target.entityId, ComponentType.Position) as
      PositionComponent | undefined;
    if (!targetPos) return { state, success: false };
    targetX = targetPos.x;
    targetY = targetPos.y;
    targetZ = targetPos.z ?? 0;
  } else {
    // Unsupported target type for throwing
    return { state, success: false };
  }

  const maxRange = itemDef.throwable?.range ?? 3;
  const path = getBresenhamLine3D(throwerPos.x, throwerPos.y, throwerZ, targetX, targetY, targetZ);

  let impactX = throwerPos.x;
  let impactY = throwerPos.y;
  let impactZ = throwerZ;
  let hitEntityId: EntityId | undefined;

  // Skip index 0 (thrower's own tile)
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1]!;
    const point = path[i];
    if (!point) break;

    const distance = Math.max(
      Math.abs(point.x - throwerPos.x),
      Math.abs(point.y - throwerPos.y),
      Math.abs(point.z - throwerZ)
    );
    if (distance > maxRange) {
      break;
    }

    // Check vertical floor/ceiling barriers when transitioning across Z strata
    if (point.z !== prev.z) {
      const upperZ = Math.max(prev.z, point.z);
      const upperPrevDef = getTileDefAt(state, prev.x, prev.y, upperZ);
      const upperPtDef = getTileDefAt(state, point.x, point.y, upperZ);
      const verticalOpeningExists =
        upperPrevDef?.isOpenAir === true ||
        upperPrevDef?.verticalLink !== undefined ||
        upperPrevDef?.blocksVerticalLoS === false ||
        upperPtDef?.isOpenAir === true ||
        upperPtDef?.verticalLink !== undefined ||
        upperPtDef?.blocksVerticalLoS === false;
      if (!verticalOpeningExists) {
        impactX = prev.x;
        impactY = prev.y;
        impactZ = prev.z;
        break;
      }
    }

    // Check voxel walls while allowing flight across open_air gaps
    const tileDef = getTileDefAt(state, point.x, point.y, point.z);
    if (!tileDef) break;
    if (!tileDef.walkable && tileDef.isOpenAir !== true && tileDef.verticalLink === undefined) {
      impactX = prev.x;
      impactY = prev.y;
      impactZ = prev.z;
      break;
    }

    // Check Entity Collisions
    const entitiesAtPoint = getEntitiesAtPosition(state, point.x, point.y, point.z);
    const blocker = entitiesAtPoint.find(
      (id) =>
        id !== intent.entityId &&
        (getComponent(state, id, ComponentType.Fighter) !== undefined ||
          getComponent(state, id, ComponentType.Structural) !== undefined)
    );

    if (blocker && blocker !== intent.entityId) {
      hitEntityId = blocker;
      impactX = point.x;
      impactY = point.y;
      impactZ = point.z;
      break;
    }

    impactX = point.x;
    impactY = point.y;
    impactZ = point.z;
  }

  let missed = false;

  // If we aimed at an entity but it moved or wasn't there
  if (intent.target.type === 'entity') {
    if (hitEntityId !== intent.target.entityId) {
      missed = true;
    }
  }

  // Handle Scatter
  if (missed && !hitEntityId) {
    const scatterX = impactX + rng.getUniformInt(-1, 1);
    const scatterY = impactY + rng.getUniformInt(-1, 1);
    const scatterTileDef = getTileDefAt(state, scatterX, scatterY, impactZ);
    if (scatterTileDef?.walkable || scatterTileDef?.isOpenAir === true) {
      impactX = scatterX;
      impactY = scatterY;
    }
  }

  let nextState = state;

  // Log message
  const itemName = state.identifiedItems.has(itemComp.itemId)
    ? itemDef.name
    : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? itemDef.unidentifiedName ?? itemComp.itemId);

  const isPlayerThrowing = getComponent(state, intent.entityId, ComponentType.Player) !== undefined;
  const throwerName = isPlayerThrowing ? 'You' : resolveEntityDisplayName(state, intent.entityId, 'Something');
  const verb = isPlayerThrowing ? 'throw' : 'throws';

  nextState = addMessage(nextState, `${throwerName} ${verb} the ${itemName}.`, MessageLogCategory.System);

  // Apply base physical damage
  if (hitEntityId) {
    const baseDamage = itemDef.throwable?.damage ?? Math.max(1, Math.floor(itemDef.weight / 10));
    const existingDmg = getComponent(nextState, hitEntityId, ComponentType.Damage) as DamageComponent | undefined;
    const dmgComp: DamageComponent = {
      type: ComponentType.Damage,
      instances: [
        ...(existingDmg?.instances || []),
        {
          sourceEntityId: intent.entityId,
          amount: baseDamage,
          tags: ['throw', itemDef.category, ...(itemDef.tags ?? [])],
          ...(intent.interaction !== undefined ? { interaction: intent.interaction } : {})
        }
      ]
    };
    nextState = addComponent(nextState, hitEntityId, dmgComp);
    nextState = addMessage(nextState, `The ${itemName} hits!`, MessageLogCategory.CombatHit);

    // Apply weapon coating if present
    const coating = getComponent(nextState, intent.toolEntityId, ComponentType.Coating) as CoatingComponent | undefined;
    if (coating) {
      nextState = applyStatusEffect(
        nextState,
        hitEntityId,
        coating.statusId,
        coating.duration,
        intent.entityId,
        coating.interaction ?? intent.interaction
      );

      const newCharges = coating.charges - 1;
      if (newCharges <= 0) {
        nextState = removeComponent(nextState, intent.toolEntityId, ComponentType.Coating);
        nextState = addMessage(nextState, `The coating on the ${itemName} wears off.`, MessageLogCategory.System);
      } else {
        nextState = addComponent(nextState, intent.toolEntityId, { ...coating, charges: newCharges });
      }
    }
  } else if (missed) {
    nextState = addMessage(nextState, `The ${itemName} misses.`, MessageLogCategory.CombatMiss);
  }

  // Visual Effect
  const visualEffect = {
    id: `proj_${Math.floor(rng.getUniform() * 1000000)}`,
    type: 'floating_text' as const,
    x: impactX,
    y: impactY,
    content: itemDef.glyph,
    color: itemDef.fg,
    expiresAt: performance.now() + 300 // brief flash
  };
  nextState = { ...nextState, visualEffects: [...nextState.visualEffects, visualEffect] };

  // Remove from thrower's inventory list and move to map
  const throwerInv = getComponent(nextState, intent.entityId, ComponentType.Inventory);
  if (throwerInv && throwerInv.items.includes(intent.toolEntityId)) {
    nextState = addComponent(nextState, intent.entityId, {
      ...throwerInv,
      items: throwerInv.items.filter((id) => id !== intent.toolEntityId)
    });
  }
  nextState = removeComponent(nextState, intent.toolEntityId, ComponentType.Inventory);
  nextState = addComponent(nextState, intent.toolEntityId, {
    type: ComponentType.Position,
    x: impactX,
    y: impactY,
    ...(impactZ !== 0 ? { z: impactZ } : {})
  });
  nextState = resolveGravityForEntity(nextState, intent.toolEntityId).state;

  // Invoke Reaction System
  const postDropPos = getComponent(nextState, intent.toolEntityId, ComponentType.Position) as
    PositionComponent | undefined;
  const landedX = postDropPos?.x ?? impactX;
  const landedY = postDropPos?.y ?? impactY;
  const reactionTarget = hitEntityId
    ? { type: 'entity' as const, entityId: hitEntityId }
    : { type: 'tile' as const, x: landedX, y: landedY };

  const reactionResult = processReactions(nextState, 'impact', intent.toolEntityId, reactionTarget, undefined);
  nextState = reactionResult.state;

  // If item wasn't destroyed by reaction, and it has destroyOnImpact, destroy it.
  if (itemDef.throwable?.destroyOnImpact) {
    // Check if it still exists (reaction didn't remove it)
    if (nextState.entities.includes(intent.toolEntityId)) {
      nextState = removeEntity(nextState, intent.toolEntityId);
    }
  }

  return { state: nextState, success: true };
}
