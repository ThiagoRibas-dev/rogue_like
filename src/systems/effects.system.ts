import type { GameState, EntityId } from '../types/game-state.types.ts';
import { ComponentType, type FighterComponent, type InventoryComponent } from '../types/components.types.ts';
import { getComponent, removeEntity } from '../core/ecs.ts';
import { ITEM_EFFECTS, ItemEffectType } from '../constants/effects.constants.ts';
import { ITEM_REGISTRY } from '../constants/items.constants.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { assertNever } from '../utils/assert.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { removeActor } from '../core/scheduler.ts';

/**
 * Applies an item effect to a target entity, interpreting the declarative
 * ItemEffectDefinition rather than encoding logic inline.
 * Every new effect type requires a case here + an entry in ITEM_EFFECTS.
 *
 * @param state The current GameState.
 * @param userId The entity that used the item (for range calculations, messaging).
 * @param effectId The effectId string from the consumable's ItemDefinition.
 * @param itemName The display name of the item (for log messages).
 * @returns The updated GameState.
 */
export function applyItemEffect(state: GameState, userId: EntityId, effectId: string, itemName: string): GameState {
  const effectDef = ITEM_EFFECTS[effectId];
  if (!effectDef) {
    return addMessage(state, `Unknown effect: ${effectId}`, MessageLogCategory.System);
  }

  switch (effectDef.type) {
    case ItemEffectType.Heal: {
      const fighter = getComponent(state, userId, ComponentType.Fighter);
      if (!fighter) return state;

      const { maxHp } = getEffectiveStats(state, userId);
      const healed = Math.min(effectDef.value, maxHp - fighter.hp);
      if (healed <= 0) {
        return addMessage(
          state,
          `You drink the ${itemName}, but you are already at full health.`,
          MessageLogCategory.System
        );
      }

      const nextFighter: FighterComponent = { ...fighter, hp: fighter.hp + healed };
      const nextComponents = new Map(state.components);
      const userComps = nextComponents.get(userId) ?? [];
      nextComponents.set(
        userId,
        userComps.map((c) => (c.type === ComponentType.Fighter ? nextFighter : c))
      );

      const msg = effectDef.message.replace('{item}', itemName).replace('{value}', String(healed));
      return addMessage({ ...state, components: nextComponents }, msg, MessageLogCategory.CombatHit);
    }

    case ItemEffectType.DamageNearest: {
      const userPos = getComponent(state, userId, ComponentType.Position);
      if (!userPos) return state;

      const range = effectDef.range ?? 8;

      // Find the nearest visible enemy within range
      let nearestId: EntityId | undefined;
      let nearestDist = Infinity;

      for (const id of state.entities) {
        if (id === userId) continue;
        const targetFighter = getComponent(state, id, ComponentType.Fighter);
        const targetPos = getComponent(state, id, ComponentType.Position);
        if (!targetFighter || !targetPos) continue;

        const dist = Math.sqrt(Math.pow(targetPos.x - userPos.x, 2) + Math.pow(targetPos.y - userPos.y, 2));
        if (dist <= range && dist < nearestDist) {
          nearestDist = dist;
          nearestId = id;
        }
      }

      if (nearestId === undefined) {
        return addMessage(state, 'The scroll crackles... but finds no target.', MessageLogCategory.System);
      }

      const targetFighter = getComponent(state, nearestId, ComponentType.Fighter);
      if (!targetFighter) return state;

      const targetRenderable = getComponent(state, nearestId, ComponentType.Renderable);
      const targetName = targetRenderable?.glyph ?? 'target';

      const newHp = Math.max(0, targetFighter.hp - effectDef.value);
      const nextFighter: FighterComponent = { ...targetFighter, hp: newHp };
      const nextComponents = new Map(state.components);
      const targetComps = nextComponents.get(nearestId) ?? [];
      nextComponents.set(
        nearestId,
        targetComps.map((c) => (c.type === ComponentType.Fighter ? nextFighter : c))
      );

      const msg = effectDef.message.replace('{target}', targetName).replace('{value}', String(effectDef.value));
      let nextState = addMessage({ ...state, components: nextComponents }, msg, MessageLogCategory.CombatHit);

      if (newHp === 0) {
        nextState = addMessage(nextState, `${targetName} dies!`, MessageLogCategory.CombatDeath);
        nextState = removeEntity(nextState, nearestId);
        removeActor(nearestId);
      }

      return nextState;
    }

    case ItemEffectType.DamageArea:
      // Stub — full AoE targeting implemented in M8
      return addMessage(state, 'The scroll fizzles... (Area effect not yet implemented.)', MessageLogCategory.System);

    default:
      return assertNever(effectDef.type);
  }
}

/**
 * Processes a UseItem intent.
 * Looks up the item's consumable effect, applies it, and removes the item from inventory
 * (decrementing charges if > 1, removing entity entirely if charges reach 0).
 *
 * @param state The current GameState.
 * @param entityId The entity using the item.
 * @param itemIndex The index of the item in the entity's inventory array.
 * @returns The updated GameState.
 */
export function processUseItemIntent(state: GameState, entityId: EntityId, itemIndex: number): GameState {
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  if (!inventory) return state;

  const itemEntityId = inventory.items[itemIndex];
  if (itemEntityId === undefined) return state;

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return state;

  const def = ITEM_REGISTRY[itemComp.itemId];
  const itemName = (itemComp.identified ? def?.name : def?.unidentifiedName) ?? itemComp.itemId;

  if (!def?.consumable) {
    return addMessage(state, `The ${itemName} cannot be used directly. Try equipping it.`, MessageLogCategory.System);
  }

  // Apply the effect
  let nextState = applyItemEffect(state, entityId, def.consumable.effectId, itemName);

  // Remove item from inventory
  const remainingCharges = (itemComp.charges ?? 1) - 1;
  const nextComponents = new Map(nextState.components);

  if (remainingCharges <= 0) {
    // Remove item entity entirely
    const nextInventory: InventoryComponent = {
      ...inventory,
      items: inventory.items.filter((_, i) => i !== itemIndex)
    };
    const entityComps = nextComponents.get(entityId) ?? [];
    nextComponents.set(
      entityId,
      entityComps.map((c) => (c.type === ComponentType.Inventory ? nextInventory : c))
    );
    nextComponents.delete(itemEntityId);
    const nextEntities = nextState.entities.filter((id) => id !== itemEntityId);
    nextState = { ...nextState, entities: nextEntities, components: nextComponents };
  } else {
    // Decrement charges
    const updatedItem = { ...itemComp, charges: remainingCharges };
    const itemComps = nextComponents.get(itemEntityId) ?? [];
    nextComponents.set(
      itemEntityId,
      itemComps.map((c) => (c.type === ComponentType.Item ? updatedItem : c))
    );
    nextState = { ...nextState, components: nextComponents };
  }

  return nextState;
}
