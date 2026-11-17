import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { ItemDefinition } from '../types/campaign.types.ts';
import { getComponent } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import { resolveCurrencyConfig, resolveItemBaseValueInBaseUnits } from '../systems/currency.system.ts';
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
 * Minimum sell-to-shop multiplier allowed to prevent items being sold for 0 coins.
 */
export const MIN_SELL_TO_SHOP_MULTIPLIER = 0.05;

/**
 * Detailed trade pricing breakdown showing final multiplier and contributor annotations.
 */
export interface TradePriceBreakdown {
  readonly finalBuyMultiplier: number;
  readonly finalSellMultiplier: number;
  readonly annotations: ReadonlyArray<string>;
}

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
 * Computes the effective buy/sell price multipliers and human-readable factor annotations
 * combining merchant markup, nemesis hierarchy vacancies, NPC social memory, and Cartridge hooks.
 */
export function getTradePriceBreakdown(
  state: GameState,
  shopEntityId: EntityId,
  buyerEntityId: EntityId,
  isSellingToShop = false
): TradePriceBreakdown {
  const shop = getComponent(state, shopEntityId, ComponentType.Shop) as ShopComponent | undefined;
  if (!shop) {
    return {
      finalBuyMultiplier: 1.0,
      finalSellMultiplier: BASE_SELL_TO_SHOP_MULTIPLIER,
      annotations: []
    };
  }

  let multiplier = shop.markupMultiplier;
  const annotations: string[] = [];

  if (shop.supplierHierarchyId && hasTopTierVacancy(state, shop.supplierHierarchyId)) {
    multiplier += HIERARCHY_VACANCY_MARKUP_PENALTY;
    annotations.push(`Supply Shortage (+${Math.round(HIERARCHY_VACANCY_MARKUP_PENALTY * 100)}%)`);
  }

  const memory = getComponent(state, shopEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (memory) {
    if (memory.sessionMarkupModifier !== undefined && memory.sessionMarkupModifier !== 0) {
      multiplier += memory.sessionMarkupModifier;
      const pct = Math.round(memory.sessionMarkupModifier * 100);
      annotations.push(`Haggling (${pct >= 0 ? `+${pct}%` : `${pct}%`})`);
    }

    if (memory.annoyedDuration && memory.annoyedDuration > 0) {
      multiplier += ANNOYED_MARKUP_MODIFIER;
      annotations.push(`Annoyed (+${Math.round(ANNOYED_MARKUP_MODIFIER * 100)}%)`);
    } else if (memory.gratefulDuration && memory.gratefulDuration > 0) {
      multiplier -= GRATEFUL_DISCOUNT_MODIFIER;
      annotations.push(`Grateful (-${Math.round(GRATEFUL_DISCOUNT_MODIFIER * 100)}%)`);
    }

    const buyerFaction = getComponent(state, buyerEntityId, ComponentType.Faction) as FactionComponent | undefined;
    if (buyerFaction) {
      const standing = memory.factionStandings[buyerFaction.factionId] ?? 0;
      const standingModifier = -(standing / FACTION_STANDING_PRICE_DIVISOR);
      if (standingModifier !== 0) {
        multiplier += standingModifier;
        const pct = Math.round(standingModifier * 100);
        annotations.push(`Standing (${pct >= 0 ? `+${pct}%` : `${pct}%`})`);
      }
    }

    if (memory.facets) {
      const greedy = memory.facets['greedy'] ?? PERSONALITY_FACET_NEUTRAL_VAL;
      const generous = memory.facets['generous'] ?? PERSONALITY_FACET_NEUTRAL_VAL;
      const greedyModifier = (greedy - PERSONALITY_FACET_NEUTRAL_VAL) / PERSONALITY_FACET_PRICE_DIVISOR;
      const generousModifier = -(generous - PERSONALITY_FACET_NEUTRAL_VAL) / PERSONALITY_FACET_PRICE_DIVISOR;
      multiplier += greedyModifier + generousModifier;
    }

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

  let sellMultiplierBonus = 0;
  const rulesetMod = getActiveRuleset(state).evaluateTradePriceModifier?.(state, {
    shopEntityId,
    buyerEntityId,
    isSellingToShop
  });
  if (rulesetMod) {
    multiplier += rulesetMod.markupDelta;
    sellMultiplierBonus += rulesetMod.sellMultiplierBonus ?? 0;
    if (rulesetMod.annotations) {
      annotations.push(...rulesetMod.annotations);
    }
  }

  const finalBuyMultiplier = Math.max(MIN_TRADE_MULTIPLIER, multiplier);
  const finalSellMultiplier = Math.max(
    MIN_SELL_TO_SHOP_MULTIPLIER,
    (BASE_SELL_TO_SHOP_MULTIPLIER + sellMultiplierBonus) * (1 / finalBuyMultiplier)
  );

  return {
    finalBuyMultiplier,
    finalSellMultiplier,
    annotations
  };
}

/**
 * Calculates the effective price of an item given its base value (in active base currency units),
 * applying the merchant's markup, social modifiers, faction standing, and Cartridge ruleset modifiers.
 */
export function getEffectivePrice(
  state: GameState,
  baseValueInBaseUnits: number,
  shopEntityId: EntityId,
  buyerEntityId: EntityId,
  isSellingToShop = false
): number {
  if (baseValueInBaseUnits <= 0) return 0;

  const breakdown = getTradePriceBreakdown(state, shopEntityId, buyerEntityId, isSellingToShop);
  if (isSellingToShop) {
    return Math.max(1, Math.floor(baseValueInBaseUnits * breakdown.finalSellMultiplier));
  }
  return Math.max(1, Math.floor(baseValueInBaseUnits * breakdown.finalBuyMultiplier));
}

/**
 * Resolves an item definition's `baseValue` (honoring `currencyUnit` vs `defaultValueDenominationId`)
 * into effective buy/sell base currency units for a given merchant and buyer.
 */
export function getEffectiveItemPriceInBaseUnits(
  state: GameState,
  itemDef: Pick<ItemDefinition, 'baseValue' | 'currencyUnit'>,
  shopEntityId: EntityId,
  buyerEntityId: EntityId,
  isSellingToShop = false
): number {
  const currencyConfig = resolveCurrencyConfig(state);
  const baseValueUnits = resolveItemBaseValueInBaseUnits(itemDef, currencyConfig);
  return getEffectivePrice(state, baseValueUnits, shopEntityId, buyerEntityId, isSellingToShop);
}
