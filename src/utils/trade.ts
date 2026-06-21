import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import type { ShopComponent, MemoryComponent, FactionComponent } from '../types/components.types.ts';

/**
 * Calculates the effective price of an item given its base value,
 * applying the merchant's markup, social modifiers, and faction standing.
 *
 * @param state The current GameState.
 * @param baseValue The base value of the item.
 * @param shopEntityId The entity ID of the NPC merchant.
 * @param buyerEntityId The entity ID of the player/buyer.
 * @param isSellingToShop True if the player is selling an item to the merchant.
 * @returns The final calculated gold price.
 */
export function getEffectivePrice(
  state: GameState,
  baseValue: number,
  shopEntityId: EntityId,
  buyerEntityId: EntityId,
  isSellingToShop = false
): number {
  if (baseValue <= 0) return 0;

  const shop = getComponent(state, shopEntityId, ComponentType.Shop) as ShopComponent | undefined;
  if (!shop) return baseValue;

  let multiplier = shop.markupMultiplier;

  // Apply temporary session modifier (from intimidate/persuade)
  const memory = getComponent(state, shopEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (memory) {
    if (memory.sessionMarkupModifier !== undefined) {
      multiplier += memory.sessionMarkupModifier;
    }

    // Apply social state modifiers (M45)
    if (memory.annoyedDuration && memory.annoyedDuration > 0) {
      multiplier += 0.25; // 25% markup for being annoyed
    } else if (memory.gratefulDuration && memory.gratefulDuration > 0) {
      multiplier -= 0.25; // 25% discount for being grateful
    }

    // Apply faction standing
    const buyerFaction = getComponent(state, buyerEntityId, ComponentType.Faction) as FactionComponent | undefined;
    if (buyerFaction) {
      const standing = memory.factionStandings[buyerFaction.factionId] ?? 0;
      // Convert standing to a modifier. e.g. +100 standing = -20% discount.
      const standingModifier = -(standing / 500);
      multiplier += standingModifier;
    }

    // Apply personality modifiers (M43)
    if (memory.facets) {
      const greedy = memory.facets['greedy'] ?? 50;
      const generous = memory.facets['generous'] ?? 50;

      // facets are 0-100. 50 is neutral.
      // 100 greedy = +20% markup.
      const greedyModifier = (greedy - 50) / 250;
      // 100 generous = -20% markup.
      const generousModifier = -(generous - 50) / 250;

      multiplier += greedyModifier + generousModifier;
    }
  }

  // Ensure multiplier doesn't drop below a minimum threshold
  const finalMultiplier = Math.max(0.1, multiplier);

  if (isSellingToShop) {
    // When the player sells to the shop, the base offer is 25% of the value.
    // If the merchant has a high markup (greedy, annoyed), they offer less.
    // If they have a low markup (generous, grateful), they offer more.
    const sellMultiplier = Math.max(0.05, 0.25 * (1 / finalMultiplier));
    return Math.max(1, Math.floor(baseValue * sellMultiplier));
  }

  // When buying from the shop
  return Math.max(1, Math.floor(baseValue * finalMultiplier));
}
