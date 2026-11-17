import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent, addComponent, spawnItem, removeComponent, resolveEntityDisplayName } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import { ComponentType } from '../types/components.types.ts';
import type {
  EquipmentComponent,
  InventoryComponent,
  ItemComponent,
  MemoryComponent,
  ShopComponent
} from '../types/components.types.ts';
import { GameEventType, type ApplyResolvedEvent, type GameEvent } from '../types/events.types.ts';
import type { Quest } from '../types/quests.types.ts';
import { rng } from '../core/rng.ts';
import { getEffectiveItemPriceInBaseUnits } from '../utils/trade.ts';
import {
  addEntityCurrency,
  formatCurrency,
  getEntityCurrencyBalance,
  resolveCurrencyConfig
} from './currency.system.ts';
import { getEffectiveCapacity } from './inventory.system.ts';
import { grantQuest, processQuestEvent } from './quest.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/**
 * Executes a purchase of an item from a merchant's `ShopComponent.inventory` by a buyer entity.
 */
export function executeBuyItem(
  state: GameState,
  buyerId: EntityId,
  shopEntityId: EntityId,
  itemEntityId: EntityId
): { readonly state: GameState; readonly success: boolean; readonly events?: readonly GameEvent[] } {
  const shop = getComponent(state, shopEntityId, ComponentType.Shop) as ShopComponent | undefined;
  const buyerInv = getComponent(state, buyerId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (!shop || !buyerInv) {
    return {
      state: addMessage(state, 'Unable to trade here.', MessageLogCategory.System),
      success: false
    };
  }

  if (!shop.inventory.includes(itemEntityId)) {
    return {
      state: addMessage(state, 'That item is no longer in stock.', MessageLogCategory.System),
      success: false
    };
  }

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  const itemDef = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
  if (!itemComp || !itemDef) {
    return { state, success: false };
  }

  const currencyCfg = resolveCurrencyConfig(state);
  const price = getEffectiveItemPriceInBaseUnits(state, itemDef, shopEntityId, buyerId, false);
  const buyerBalance = getEntityCurrencyBalance(state, buyerId);
  if (buyerBalance < price) {
    const needed = formatCurrency(price, currencyCfg);
    const owned = formatCurrency(buyerBalance, currencyCfg);
    return {
      state: addMessage(state, `Not enough coin! Need ${needed} (you carry ${owned}).`, MessageLogCategory.System),
      success: false
    };
  }

  if (buyerInv.items.length >= getEffectiveCapacity(state, buyerId)) {
    return {
      state: addMessage(state, 'Your inventory is full!', MessageLogCategory.System),
      success: false
    };
  }

  let nextState = addEntityCurrency(state, buyerId, -price).state;
  const shopInv = getComponent(nextState, shopEntityId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (shopInv) {
    nextState = addEntityCurrency(nextState, shopEntityId, price).state;
  }

  const latestShop = getComponent(nextState, shopEntityId, ComponentType.Shop) as ShopComponent;
  nextState = addComponent(nextState, shopEntityId, {
    ...latestShop,
    inventory: latestShop.inventory.filter((id) => id !== itemEntityId)
  });

  const latestBuyerInv = getComponent(nextState, buyerId, ComponentType.Inventory) as InventoryComponent;
  nextState = addComponent(nextState, buyerId, {
    ...latestBuyerInv,
    items: [...latestBuyerInv.items, itemEntityId]
  });

  const npcMemory = getComponent(nextState, shopEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (npcMemory) {
    nextState = addComponent(nextState, shopEntityId, {
      ...npcMemory,
      timesTraded: (npcMemory.timesTraded ?? 0) + 1
    });
  }

  if (getComponent(nextState, buyerId, ComponentType.Player)) {
    nextState = processQuestEvent(nextState, 'gather', itemComp.itemId, 1);
  }

  const shopName = resolveEntityDisplayName(nextState, shopEntityId, 'Merchant');
  const itemName = itemDef.name ?? itemComp.itemId;
  nextState = addMessage(
    nextState,
    `Bought ${itemName} from ${shopName} for ${formatCurrency(price, currencyCfg)}.`,
    MessageLogCategory.System
  );

  const event: ApplyResolvedEvent = {
    type: GameEventType.ApplyResolved,
    entityId: buyerId,
    verb: 'buy',
    target: { type: 'entity', entityId: shopEntityId },
    toolEntityId: itemEntityId
  };

  return { state: nextState, success: true, events: [event] };
}

/**
 * Executes a sale of an item from a seller's inventory to a merchant's `ShopComponent.inventory`.
 */
export function executeSellItem(
  state: GameState,
  sellerId: EntityId,
  shopEntityId: EntityId,
  itemEntityId: EntityId
): { readonly state: GameState; readonly success: boolean; readonly events?: readonly GameEvent[] } {
  const shop = getComponent(state, shopEntityId, ComponentType.Shop) as ShopComponent | undefined;
  const sellerInv = getComponent(state, sellerId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (!shop || !sellerInv) {
    return {
      state: addMessage(state, 'Unable to trade here.', MessageLogCategory.System),
      success: false
    };
  }

  if (!sellerInv.items.includes(itemEntityId)) {
    return {
      state: addMessage(state, 'You do not carry that item.', MessageLogCategory.System),
      success: false
    };
  }

  const sellerEquip = getComponent(state, sellerId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (sellerEquip && sellerEquip.slots.some((s) => s.equippedItem === itemEntityId)) {
    return {
      state: addMessage(state, 'Unequip that item before selling it.', MessageLogCategory.System),
      success: false
    };
  }

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  const itemDef = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
  if (!itemComp || !itemDef) {
    return { state, success: false };
  }

  const isBuyable =
    shop.buyTags.length === 0 || (itemDef.tags !== undefined && itemDef.tags.some((t) => shop.buyTags.includes(t)));
  if (!isBuyable) {
    return {
      state: addMessage(state, 'The merchant is not interested in buying that item.', MessageLogCategory.System),
      success: false
    };
  }

  const currencyCfg = resolveCurrencyConfig(state);
  const sellPrice = getEffectiveItemPriceInBaseUnits(state, itemDef, shopEntityId, sellerId, true);
  if (sellPrice <= 0) {
    return {
      state: addMessage(state, 'That item has no resale value.', MessageLogCategory.System),
      success: false
    };
  }

  let nextState = addEntityCurrency(state, sellerId, sellPrice).state;

  const latestSellerInv = getComponent(nextState, sellerId, ComponentType.Inventory) as InventoryComponent;
  nextState = addComponent(nextState, sellerId, {
    ...latestSellerInv,
    items: latestSellerInv.items.filter((id) => id !== itemEntityId)
  });

  const latestShop = getComponent(nextState, shopEntityId, ComponentType.Shop) as ShopComponent;
  nextState = addComponent(nextState, shopEntityId, {
    ...latestShop,
    inventory: [...latestShop.inventory, itemEntityId]
  });

  const npcMemory = getComponent(nextState, shopEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (npcMemory) {
    nextState = addComponent(nextState, shopEntityId, {
      ...npcMemory,
      timesTraded: (npcMemory.timesTraded ?? 0) + 1
    });
  }

  const shopName = resolveEntityDisplayName(nextState, shopEntityId, 'Merchant');
  const itemName = itemDef.name ?? itemComp.itemId;
  nextState = addMessage(
    nextState,
    `Sold ${itemName} to ${shopName} for ${formatCurrency(sellPrice, currencyCfg)}.`,
    MessageLogCategory.System
  );

  const event: ApplyResolvedEvent = {
    type: GameEventType.ApplyResolved,
    entityId: sellerId,
    verb: 'sell',
    target: { type: 'entity', entityId: shopEntityId },
    toolEntityId: itemEntityId
  };

  return { state: nextState, success: true, events: [event] };
}

/**
 * Resolves a trade social/haggling attempt (`appraise`, `diplomacy`, `bluff`, `intimidate`),
 * delegating to the active ruleset cartridge when implemented or falling back to Console personality contest.
 */
export function executeTradeSocialAction(
  state: GameState,
  actorId: EntityId,
  shopEntityId: EntityId,
  skillId: string
): { readonly state: GameState; readonly success: boolean; readonly events?: readonly GameEvent[] } {
  const rulesetOutcome = getActiveRuleset(state).resolveTradeSocialSkill?.(state, actorId, shopEntityId, skillId);
  if (rulesetOutcome) {
    const event: ApplyResolvedEvent = {
      type: GameEventType.ApplyResolved,
      entityId: actorId,
      verb: skillId === 'diplomacy' ? 'persuade' : skillId === 'intimidate' ? 'intimidate' : 'haggle',
      target: { type: 'entity', entityId: shopEntityId }
    };
    return { state: rulesetOutcome.state, success: rulesetOutcome.success, events: [event] };
  }

  const memory = getComponent(state, shopEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (!memory) {
    return {
      state: addMessage(state, 'They refuse to haggle.', MessageLogCategory.System),
      success: false
    };
  }

  const roll = rng.getUniform() * 100;
  const threshold = skillId === 'appraise' ? 45 : 50;
  const success = roll >= threshold;
  const currentMod = memory.sessionMarkupModifier ?? 0;
  const nextMod = success ? Math.max(-0.35, currentMod - 0.15) : Math.min(0.5, currentMod + 0.15);

  let nextState = addComponent(state, shopEntityId, {
    ...memory,
    sessionMarkupModifier: nextMod
  });
  nextState = addMessage(
    nextState,
    success
      ? `Your ${skillId} succeeds — merchant drops prices temporarily.`
      : `Your ${skillId} backfires — merchant raises prices!`,
    MessageLogCategory.System
  );
  return { state: nextState, success };
}

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

    const shopName = resolveEntityDisplayName(nextState, shopEntityId, 'Merchant');

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
          amount: (targetItemDef.baseValue ?? 10) * amount * 2
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

    const playerEntities = nextState.entities.filter((e) => getComponent(nextState, e, ComponentType.Player));
    const playerId = playerEntities[0];
    if (playerId !== undefined) {
      nextState = grantQuest(nextState, playerId, questId);
      nextState = addMessage(
        nextState,
        `${shopName} posted a request: "Out of stock! I need ${amount}x ${targetItemDef.name ?? targetItemDef.id}."`,
        MessageLogCategory.System
      );
    }
  }

  return nextState;
}
