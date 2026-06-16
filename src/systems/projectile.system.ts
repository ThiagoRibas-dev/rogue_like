import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { ApplyIntent } from '../types/intents/interaction.intents.ts';
import {
  ComponentType,
  type ItemComponent,
  type PositionComponent,
  type DamageComponent
} from '../types/components.types.ts';
import { getComponent, addComponent, removeComponent, removeEntity } from '../core/ecs.ts';
import { processReactions } from './reaction.system.ts';
import { rng } from '../core/rng.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { applyStatusEffect } from './status-effect.system.ts';

/**
 * Returns an array of points representing a line from (x0, y0) to (x1, y1)
 * using Bresenham's line algorithm.
 */
function getBresenhamLine(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
  const points = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return points;
}

/**
 * Processes the deterministic flight of a thrown item, including Bresenham line calculation,
 * collisions, range checks, and miss scatter.
 */
export function processProjectileThrow(state: GameState, intent: ApplyIntent): { state: GameState; success: boolean } {
  if (!intent.toolEntityId) return { state, success: false };

  const itemComp = getComponent(state, intent.toolEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return { state, success: false };

  const itemDef = state.campaign.items[itemComp.itemId];
  if (!itemDef) return { state, success: false };

  const throwerPos = getComponent(state, intent.entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!throwerPos) return { state, success: false };

  let targetX: number;
  let targetY: number;

  if (intent.target.type === 'tile') {
    targetX = intent.target.x;
    targetY = intent.target.y;
  } else if (intent.target.type === 'entity') {
    const targetPos = getComponent(state, intent.target.entityId, ComponentType.Position) as
      | PositionComponent
      | undefined;
    if (!targetPos) return { state, success: false };
    targetX = targetPos.x;
    targetY = targetPos.y;
  } else {
    // Unsupported target type for throwing
    return { state, success: false };
  }

  const maxRange = itemDef.throwable?.range ?? 3;
  const path = getBresenhamLine(throwerPos.x, throwerPos.y, targetX, targetY);

  let impactX = throwerPos.x;
  let impactY = throwerPos.y;
  let hitEntityId: EntityId | undefined;

  // We skip the first point since it's the thrower's tile
  for (let i = 1; i < path.length; i++) {
    const point = path[i];
    if (!point) break;

    // Check Range
    const distance = Math.max(Math.abs(point.x - throwerPos.x), Math.abs(point.y - throwerPos.y));
    if (distance > maxRange) {
      break;
    }

    // Check Map Walls
    const tileIndex = point.y * state.map.width + point.x;
    const tile = state.map.tiles[tileIndex];
    if (!tile) break;

    const tileDef = state.campaign.tiles[tile.tileId];
    if (!tileDef || !tileDef.walkable) {
      // Impact is the LAST valid tile before the wall, or the wall itself?
      // Typically, hitting a wall means it drops right before the wall or at the wall if it's an impact effect.
      // Let's set impact to the previous point so it drops on the floor instead of "inside" the wall.
      impactX = path[i - 1]?.x ?? throwerPos.x;
      impactY = path[i - 1]?.y ?? throwerPos.y;
      break;
    }

    // Check Entity Collisions
    const entitiesAtPoint = state.spatialIndex.get(`${point.x},${point.y}`) || [];
    const blocker = entitiesAtPoint.find((id) => getComponent(state, id, ComponentType.Fighter) !== undefined);

    if (blocker && blocker !== intent.entityId) {
      hitEntityId = blocker;
      impactX = point.x;
      impactY = point.y;
      break;
    }

    impactX = point.x;
    impactY = point.y;
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
    const scatterTileIdx = scatterY * state.map.width + scatterX;
    const scatterTile = state.map.tiles[scatterTileIdx];
    if (scatterTile) {
      const scatterTileDef = state.campaign.tiles[scatterTile.tileId];
      if (scatterTileDef?.walkable) {
        impactX = scatterX;
        impactY = scatterY;
      }
    }
  }

  let nextState = state;

  // Log message
  const itemName = state.identifiedItems.has(itemComp.itemId)
    ? itemDef.name
    : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? itemDef.unidentifiedName ?? itemComp.itemId);

  const isPlayerThrowing = getComponent(state, intent.entityId, ComponentType.Player) !== undefined;
  const throwerName = isPlayerThrowing ? 'You' : 'Something';
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
          tags: ['throw', itemDef.category]
        }
      ]
    };
    nextState = addComponent(nextState, hitEntityId, dmgComp);
    nextState = addMessage(nextState, `The ${itemName} hits!`, MessageLogCategory.CombatHit);

    // Apply weapon coating if present
    const coating = getComponent(nextState, intent.toolEntityId, ComponentType.Coating) as
      | import('../types/components.types.ts').CoatingComponent
      | undefined;
    if (coating) {
      nextState = applyStatusEffect(nextState, hitEntityId, coating.statusId, coating.duration, intent.entityId);

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

  // Remove from inventory, move to map
  nextState = removeComponent(nextState, intent.toolEntityId, ComponentType.Inventory);
  nextState = addComponent(nextState, intent.toolEntityId, { type: ComponentType.Position, x: impactX, y: impactY });

  // Invoke Reaction System
  const reactionTarget = hitEntityId
    ? { type: 'entity' as const, entityId: hitEntityId }
    : { type: 'tile' as const, x: impactX, y: impactY };

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
