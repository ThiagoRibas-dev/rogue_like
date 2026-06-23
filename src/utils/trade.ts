import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import type { ShopComponent, MemoryComponent, FactionComponent } from '../types/components.types.ts';

/**
 * Economic penalty markup applied when a merchant's supplier hierarchy has a top-tier vacancy.
 */
export const HIERARCHY_VACANCY_MARKUP_PENALTY = 0.5;

/**
 * Price markup modifier applied when a merchant is annoyed.
 */
export const ANNOYED_MARKUP_MODIFIER = 0.25;

/**
 * Price discount modifier applied when a merchant is grateful.
 */
export const GRATEFUL_DISCOUNT_MODIFIER = 0.25;

/**
 * Faction standing divisor used to convert numeric standing into a price modifier.
 * e.g., +500 standing results in a 1.0 (100%) discount change factor.
 */
export const FACTION_STANDING_PRICE_DIVISOR = 500;

/**
 * Personality facet divisor used to scale the 0-100 greedy/generous facets.
 * e.g., 50 point deviation from neutral divided by 250 = 20% modifier.
 */
export const PERSONALITY_FACET_PRICE_DIVISOR = 250;

/**
 * The default baseline value at which personality facets are considered neutral.
 */
export const PERSONALITY_FACET_NEUTRAL_VAL = 50;

/**
 * Relationship axis divisor used to convert numeric relationship axis value into a price modifier.
 * e.g., +100 loyalty results in a 20% discount (100 / 500 = 0.2).
 */
export const RELATIONSHIP_AXIS_PRICE_DIVISOR = 500;

/**
 * Minimum multiplier threshold allowed for final trade price calculations to prevent prices dropping to zero.
 */
export const MIN_TRADE_MULTIPLIER = 0.1;

/**
 * Base percentage of item value offered to the player when selling items to a merchant.
 */
export const BASE_SELL_TO_SHOP_MULTIPLIER = 0.25;

/**
 * Minimum sell-to-shop multiplier allowed to prevent items being sold for 0 gold.
 */
export const MIN_SELL_TO_SHOP_MULTIPLIER = 0.05;

/**
 * Checks if there is a vacancy in any of the top-tier ranks of the specified hierarchy.
 */
export function hasTopTierVacancy(state: GameState, hierarchyId: string): boolean {
  const hierarchy = state.campaign.nemesisHierarchies[hierarchyId];
  if (!hierarchy || hierarchy.ranks.length === 0) return false;

  const maxTier = Math.max(...hierarchy.ranks.map((r) => r.tier));
  const topRanks = hierarchy.ranks.filter((r) => r.tier === maxTier);

  for (const rank of topRanks) {
    const key = `${hierarchyId}:${rank.rankId}`;
    const occupants = state.nemesisSlots[key] ?? [];
    if (occupants.length < rank.maxSlots) {
      return true;
    }
  }

  return false;
}

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

  // Apply economic hierarchy penalty if supplier has top-tier vacancies
  if (shop.supplierHierarchyId && hasTopTierVacancy(state, shop.supplierHierarchyId)) {
    multiplier += HIERARCHY_VACANCY_MARKUP_PENALTY;
  }

  // Apply temporary session modifier (from intimidate/persuade)
  const memory = getComponent(state, shopEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (memory) {
    if (memory.sessionMarkupModifier !== undefined) {
      multiplier += memory.sessionMarkupModifier;
    }

    // Apply social state modifiers (M45)
    if (memory.annoyedDuration && memory.annoyedDuration > 0) {
      multiplier += ANNOYED_MARKUP_MODIFIER;
    } else if (memory.gratefulDuration && memory.gratefulDuration > 0) {
      multiplier -= GRATEFUL_DISCOUNT_MODIFIER;
    }

    // Apply faction standing
    const buyerFaction = getComponent(state, buyerEntityId, ComponentType.Faction) as FactionComponent | undefined;
    if (buyerFaction) {
      const standing = memory.factionStandings[buyerFaction.factionId] ?? 0;
      // Convert standing to a modifier. e.g. +100 standing = -20% discount.
      const standingModifier = -(standing / FACTION_STANDING_PRICE_DIVISOR);
      multiplier += standingModifier;
    }

    // Apply personality modifiers (M43)
    if (memory.facets) {
      const greedy = memory.facets['greedy'] ?? PERSONALITY_FACET_NEUTRAL_VAL;
      const generous = memory.facets['generous'] ?? PERSONALITY_FACET_NEUTRAL_VAL;

      // facets are 0-100. 50 is neutral.
      // 100 greedy = +20% markup.
      const greedyModifier = (greedy - PERSONALITY_FACET_NEUTRAL_VAL) / PERSONALITY_FACET_PRICE_DIVISOR;
      // 100 generous = -20% markup.
      const generousModifier = -(generous - PERSONALITY_FACET_NEUTRAL_VAL) / PERSONALITY_FACET_PRICE_DIVISOR;

      multiplier += greedyModifier + generousModifier;
    }

    // Apply relationship axes
    if (memory.relationshipAxes) {
      const loyalty = memory.relationshipAxes['loyalty'] ?? 0;
      const fear = memory.relationshipAxes['fear'] ?? 0;
      const debt = memory.relationshipAxes['debt'] ?? 0;
      const resentment = memory.relationshipAxes['resentment'] ?? 0;

      if (loyalty > 0) multiplier -= loyalty / RELATIONSHIP_AXIS_PRICE_DIVISOR;
      if (fear > 0) multiplier -= fear / RELATIONSHIP_AXIS_PRICE_DIVISOR;
      if (debt > 0) multiplier -= debt / RELATIONSHIP_AXIS_PRICE_DIVISOR;
      if (resentment > 0) multiplier += resentment / RELATIONSHIP_AXIS_PRICE_DIVISOR;
    }
  }

  // Ensure multiplier doesn't drop below a minimum threshold
  const finalMultiplier = Math.max(MIN_TRADE_MULTIPLIER, multiplier);

  if (isSellingToShop) {
    // When the player sells to the shop, the base offer is 25% of the value.
    // If the merchant has a high markup (greedy, annoyed), they offer less.
    // If they have a low markup (generous, grateful), they offer more.
    const sellMultiplier = Math.max(MIN_SELL_TO_SHOP_MULTIPLIER, BASE_SELL_TO_SHOP_MULTIPLIER * (1 / finalMultiplier));
    return Math.max(1, Math.floor(baseValue * sellMultiplier));
  }

  // When buying from the shop
  return Math.max(1, Math.floor(baseValue * finalMultiplier));
}
