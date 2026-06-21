import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent, addComponent, spawnItem, removeComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import type { ShopComponent, RenderableComponent } from '../types/components.types.ts';
import type { Quest } from '../types/quests.types.ts';
import { rng } from '../core/rng.ts';

/**
 * Restocks a shop if it is completely empty.
 * Either magically restocks the inventory or generates a dynamic fetch quest.
 */
export function restockShop(state: GameState, shopEntityId: EntityId): GameState {
  const shop = getComponent(state, shopEntityId, ComponentType.Shop) as ShopComponent | undefined;
  if (!shop) return state;

  if (shop.inventory.length > 0) return state; // Only restock if completely empty

  if (shop.buyTags.length === 0) return state; // Can't procedurally restock if they don't buy anything

  // Find items that match the buyTags
  const validItems = Object.values(state.campaign.items).filter(
    (item) => item.tags && item.tags.some((tag) => shop.buyTags.includes(tag))
  );

  if (validItems.length === 0) return state;

  // 50% chance to just magically restock standard items, 50% chance to post a fetch quest
  const shouldPostQuest = rng.getUniform() > 0.5;

  let nextState = state;

  if (!shouldPostQuest) {
    // Magically restock 1-3 items
    const amount = Math.floor(rng.getUniform() * 3) + 1;
    const newItems: EntityId[] = [...shop.inventory];

    for (let i = 0; i < amount; i++) {
      const itemDef = rng.getItem(validItems)!;
      let itemEntityId: EntityId;
      [nextState, itemEntityId] = spawnItem(nextState, itemDef.id, 0, 0);
      nextState = removeComponent(nextState, itemEntityId, ComponentType.Position);
      newItems.push(itemEntityId);
    }

    nextState = addComponent(nextState, shopEntityId, {
      ...shop,
      inventory: newItems
    });
  } else {
    // Post a fetch quest to the dynamic quests
    const targetItemDef = rng.getItem(validItems)!;
    const amount = Math.floor(rng.getUniform() * 3) + 1;

    const questId = `dyn_restock_${shopEntityId}_${nextState.nextQuestId}`;

    const rend = getComponent(nextState, shopEntityId, ComponentType.Renderable) as RenderableComponent | undefined;
    const shopName = rend?.glyph ?? 'Merchant';

    const quest: Quest = {
      id: questId,
      title: `Supply Run for ${shopName}`,
      description: `${shopName} is completely out of stock and needs ${amount}x ${targetItemDef.name ?? targetItemDef.id}.`,
      objectives: [
        {
          id: 'obj_0',
          type: 'gather',
          targetId: targetItemDef.id,
          requiredAmount: amount,
          description: `Bring ${amount}x ${targetItemDef.name ?? targetItemDef.id} to ${shopName}.`
        }
      ],
      rewards: [
        {
          type: 'xp',
          amount: (targetItemDef.baseValue ?? 10) * amount * 2 // pay double base value in xp for now
        }
      ]
    };

    nextState = {
      ...nextState,
      nextQuestId: nextState.nextQuestId + 1,
      dynamicQuests: {
        ...nextState.dynamicQuests,
        [questId]: quest
      }
    };
  }

  return nextState;
}
