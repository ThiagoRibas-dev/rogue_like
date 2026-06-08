import { getComponent, removeEntity } from '../core/ecs.ts';
import { removeActor } from '../core/scheduler.ts';
import {
  ComponentType,
  type FighterComponent,
  type InventoryComponent,
  type ItemComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { assertNever } from '../utils/assert.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { applyStatusEffect } from './status-effect.system.ts';
import { deleteSave } from '../core/save.ts';

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
  const effectDef = state.campaign.effects[effectId];
  if (!effectDef) {
    return addMessage(state, `Unknown effect: ${effectId}`, MessageLogCategory.System);
  }

  switch (effectDef.type) {
    case 'heal': {
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

    case 'damage_nearest': {
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
        const isPlayer = getComponent(nextState, nearestId, ComponentType.Player) !== undefined;
        if (isPlayer) {
          nextState = addMessage(nextState, `Game Over! You were slain by a spell.`, MessageLogCategory.CombatDeath);
          nextState = { ...nextState, isGameOver: true, uiMode: UIMode.GameOver };
          deleteSave();
        } else {
          nextState = removeEntity(nextState, nearestId);
          removeActor(nearestId);
        }
      }

      return nextState;
    }

    case 'damage_area': {
      const userPos = getComponent(state, userId, ComponentType.Position);
      if (!userPos) return state;

      const radius = effectDef.radius ?? 3;
      let nextState = state;
      let hitSomeone = false;

      for (const id of state.entities) {
        if (id === userId) continue; // Assume PBAoE that doesn't hit caster for now
        const targetFighter = getComponent(state, id, ComponentType.Fighter);
        const targetPos = getComponent(state, id, ComponentType.Position);
        if (!targetFighter || !targetPos) continue;

        const dist = Math.sqrt(Math.pow(targetPos.x - userPos.x, 2) + Math.pow(targetPos.y - userPos.y, 2));
        if (dist <= radius) {
          hitSomeone = true;
          const targetRenderable = getComponent(state, id, ComponentType.Renderable);
          const targetName = targetRenderable?.glyph ?? 'target';
          const msg = effectDef.message.replace('{target}', targetName).replace('{value}', String(effectDef.value));

          nextState = addMessage(nextState, msg, MessageLogCategory.CombatHit);

          const newHp = Math.max(0, targetFighter.hp - effectDef.value);
          const nextFighter: FighterComponent = { ...targetFighter, hp: newHp };
          const nextComponents = new Map(nextState.components);
          const targetComps = nextComponents.get(id) ?? [];
          nextComponents.set(
            id,
            targetComps.map((c) => (c.type === ComponentType.Fighter ? nextFighter : c))
          );
          nextState = { ...nextState, components: nextComponents };

          if (newHp === 0) {
            nextState = addMessage(nextState, `${targetName} dies!`, MessageLogCategory.CombatDeath);
            const isPlayer = getComponent(nextState, id, ComponentType.Player) !== undefined;
            if (isPlayer) {
              nextState = addMessage(nextState, `Game Over! You were slain by a spell.`, MessageLogCategory.CombatDeath);
              nextState = { ...nextState, isGameOver: true, uiMode: UIMode.GameOver };
              deleteSave();
            } else {
              nextState = removeEntity(nextState, id);
              removeActor(id);
            }
          }
        }
      }

      if (!hitSomeone) {
        nextState = addMessage(nextState, 'The area is blasted, but nothing was hit.', MessageLogCategory.System);
      }
      return nextState;
    }

    case 'apply_status': {
      if (!effectDef.statusId || !effectDef.duration) return state;

      if (effectDef.range) {
        // Hit nearest target
        const userPos = getComponent(state, userId, ComponentType.Position);
        if (!userPos) return state;

        let nearestId: EntityId | undefined;
        let nearestDist = Infinity;

        for (const id of state.entities) {
          if (id === userId) continue;
          const targetFighter = getComponent(state, id, ComponentType.Fighter);
          const targetPos = getComponent(state, id, ComponentType.Position);
          if (!targetFighter || !targetPos) continue;

          const dist = Math.sqrt(Math.pow(targetPos.x - userPos.x, 2) + Math.pow(targetPos.y - userPos.y, 2));
          if (dist <= effectDef.range && dist < nearestDist) {
            nearestDist = dist;
            nearestId = id;
          }
        }

        if (nearestId === undefined) {
          return addMessage(state, 'The magic crackles... but finds no target.', MessageLogCategory.System);
        }

        const targetRenderable = getComponent(state, nearestId, ComponentType.Renderable);
        const targetName = targetRenderable?.glyph ?? 'target';
        const msg = effectDef.message.replace('{target}', targetName);

        let nextState = addMessage(state, msg, MessageLogCategory.CombatHit);
        nextState = applyStatusEffect(nextState, nearestId, effectDef.statusId, effectDef.duration, userId);
        return nextState;
      } else {
        // Apply to self
        const msg = effectDef.message.replace('{item}', itemName);
        let nextState = addMessage(state, msg, MessageLogCategory.System);
        nextState = applyStatusEffect(nextState, userId, effectDef.statusId, effectDef.duration, userId);
        return nextState;
      }
    }

    case 'identify': {
      const inventory = getComponent(state, userId, ComponentType.Inventory);
      if (!inventory) return state;

      const newIdentifiedSet = new Set(state.identifiedItems);
      for (const itemEntityId of inventory.items) {
        const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
        if (itemComp) {
          newIdentifiedSet.add(itemComp.itemId);
        }
      }

      const msg = effectDef.message.replace('{item}', itemName);
      const nextState = addMessage(state, msg, MessageLogCategory.System);
      return { ...nextState, identifiedItems: newIdentifiedSet };
    }

    case 'satiate': {
      const hunger = getComponent(state, userId, ComponentType.Hunger);
      if (!hunger) return state;

      const newSatiation = Math.min(state.campaign.rules.hunger.maxSatiation, hunger.satiation + effectDef.value);
      const nextHunger = { ...hunger, satiation: newSatiation };

      const nextComponents = new Map(state.components);
      const userComps = nextComponents.get(userId) ?? [];
      nextComponents.set(
        userId,
        userComps.map((c) => (c.type === ComponentType.Hunger ? nextHunger : c))
      );

      const msg = effectDef.message.replace('{item}', itemName);
      return addMessage({ ...state, components: nextComponents }, msg, MessageLogCategory.System);
    }

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
export function processUseItemIntent(
  state: GameState,
  entityId: EntityId,
  itemIndex: number
): { state: GameState; success: boolean } {
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  if (!inventory) return { state, success: false };

  const itemEntityId = inventory.items[itemIndex];
  if (itemEntityId === undefined) return { state, success: false };

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return { state, success: false };

  const def = state.campaign.items[itemComp.itemId];
  const isIdentified = state.identifiedItems.has(itemComp.itemId);
  const itemName = isIdentified
    ? def?.name
    : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? def?.unidentifiedName ?? itemComp.itemId);

  if (!def?.consumable) {
    return {
      state: addMessage(state, `The ${itemName} cannot be used directly. Try equipping it.`, MessageLogCategory.System),
      success: false
    };
  }

  // Identify on use
  let nextState = state;
  if (!isIdentified) {
    const newIdentifiedSet = new Set(nextState.identifiedItems);
    newIdentifiedSet.add(itemComp.itemId);
    nextState = { ...nextState, identifiedItems: newIdentifiedSet };
  }

  const itemNameFinal =
    (nextState.identifiedItems.has(def.id) ? def.name : nextState.itemUnidentifiedNames.get(def.id)) ??
    def.unidentifiedName ??
    def.name;
  nextState = applyItemEffect(nextState, entityId, def.consumable.effectId, itemNameFinal);

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
    nextState = { ...nextState, components: nextComponents };
    nextState = removeEntity(nextState, itemEntityId);
  } else {
    // Just decrement charges
    const nextItemComp: ItemComponent = { ...itemComp, charges: remainingCharges };
    const entityComps = nextComponents.get(itemEntityId) ?? [];
    nextComponents.set(
      itemEntityId,
      entityComps.map((c) => (c.type === ComponentType.Item ? nextItemComp : c))
    );
    nextState = { ...nextState, components: nextComponents };
  }

  return { state: nextState, success: true };
}

/**
 * Processes a UseAbility intent (typically from AI).
 * Re-uses applyItemEffect but doesn't require an actual Item entity.
 */
export function processUseAbilityIntent(
  state: GameState,
  entityId: EntityId,
  effectId: string,
  abilityName: string
): { state: GameState; success: boolean } {
  return { state: applyItemEffect(state, entityId, effectId, abilityName), success: true };
}
