import type { GameState } from '../types/game-state.types.ts';
import type { ApplyIntent } from '../types/intents/interaction.intents.ts';
import { ComponentType, type ItemComponent, type PositionComponent } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { getBresenhamLine } from '../utils/grid.ts';
import { applyItemEffect } from './effects.system.ts';
import { processReactions } from './reaction.system.ts';
import { rng } from '../core/rng.ts';

/**
 * Processes a Wand Zap.
 * Calculates affected tiles based on the wand's pattern (beam, bolt, cone)
 * and applies the wand's effect to all hit targets.
 */
export function processWandZap(state: GameState, intent: ApplyIntent): { state: GameState; success: boolean } {
  if (!intent.toolEntityId) return { state, success: false };

  const itemComp = getComponent(state, intent.toolEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return { state, success: false };

  const itemDef = state.campaign.items[itemComp.itemId];
  if (!itemDef || !itemDef.zappable) return { state, success: false };

  const zappable = itemDef.zappable;

  const userPos = getComponent(state, intent.entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!userPos) return { state, success: false };

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
    return { state, success: false };
  }

  const isPlayer = getComponent(state, intent.entityId, ComponentType.Player) !== undefined;
  const userName = isPlayer ? 'You' : 'Something';
  const verb = isPlayer ? 'zap' : 'zaps';
  const itemName = state.identifiedItems.has(itemComp.itemId)
    ? itemDef.name
    : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? itemDef.unidentifiedName ?? itemComp.itemId);

  let nextState = addMessage(state, `${userName} ${verb} the ${itemName}.`, MessageLogCategory.System);

  const affectedTiles: Array<{ x: number; y: number }> = [];

  if (zappable.pattern === 'bolt' || zappable.pattern === 'beam') {
    const path = getBresenhamLine(userPos.x, userPos.y, targetX, targetY);
    for (let i = 1; i < path.length; i++) {
      const point = path[i];
      if (!point) break;

      const distance = Math.max(Math.abs(point.x - userPos.x), Math.abs(point.y - userPos.y));
      if (distance > zappable.range) break;

      affectedTiles.push(point);

      // Check for walls
      const tileIndex = point.y * state.map.width + point.x;
      const tile = state.map.tiles[tileIndex];
      const tileDef = tile ? state.campaign.tiles[tile.tileId] : null;
      if (!tileDef || !tileDef.walkable) {
        break; // Stop at walls for both bolt and beam
      }

      // Check for entities (bolt stops at first entity, beam goes through)
      if (zappable.pattern === 'bolt') {
        const entitiesAtPoint = state.spatialIndex.get(`${point.x},${point.y}`) || [];
        const hitEntity = entitiesAtPoint.find((id) => getComponent(state, id, ComponentType.Fighter) !== undefined);
        if (hitEntity && hitEntity !== intent.entityId) {
          break; // Bolt stops on hit
        }
      }
    }
  } else if (zappable.pattern === 'cone') {
    // Basic cone implementation based on distance and angle
    const dx = targetX - userPos.x;
    const dy = targetY - userPos.y;
    const targetAngle = Math.atan2(dy, dx);
    const coneAngle = Math.PI / 4; // 45 degrees spread

    for (let y = userPos.y - zappable.range; y <= userPos.y + zappable.range; y++) {
      for (let x = userPos.x - zappable.range; x <= userPos.x + zappable.range; x++) {
        if (x === userPos.x && y === userPos.y) continue;

        const dist = Math.sqrt(Math.pow(x - userPos.x, 2) + Math.pow(y - userPos.y, 2));
        if (dist <= zappable.range) {
          const angle = Math.atan2(y - userPos.y, x - userPos.x);
          let diff = Math.abs(angle - targetAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;

          if (diff <= coneAngle / 2) {
            affectedTiles.push({ x, y });
          }
        }
      }
    }
  }

  // Apply effect to all entities in the affected tiles
  let hitSomeone = false;
  for (const pt of affectedTiles) {
    const entitiesAtPoint = state.spatialIndex.get(`${pt.x},${pt.y}`) || [];
    for (const id of entitiesAtPoint) {
      if (id !== intent.entityId) {
        nextState = applyItemEffect(nextState, intent.entityId, zappable.effectId, itemName, id);
        hitSomeone = true;

        // Trigger zap reaction
        const targetPayload = { type: 'entity' as const, entityId: id };
        const reactionResult = processReactions(nextState, 'zap', intent.entityId, targetPayload, intent.toolEntityId);
        nextState = reactionResult.state;
      }
    }

    // Trigger tile reaction
    const tilePayload = { type: 'tile' as const, x: pt.x, y: pt.y };
    const tileReactionResult = processReactions(nextState, 'zap', intent.entityId, tilePayload, intent.toolEntityId);
    nextState = tileReactionResult.state;

    // Add visual effect
    const visualEffect = {
      id: `zap_${Math.floor(rng.getUniform() * 1000000)}`,
      type: 'floating_text' as const,
      x: pt.x,
      y: pt.y,
      content: '*',
      color: '#3498db', // blueish magic color
      expiresAt: performance.now() + 300
    };
    nextState = { ...nextState, visualEffects: [...nextState.visualEffects, visualEffect] };
  }

  if (!hitSomeone) {
    nextState = addMessage(nextState, 'The magic dissipates harmlessly.', MessageLogCategory.System);
  }

  return { state: nextState, success: true };
}
