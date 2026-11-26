import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { ItemDefinition } from '../types/campaign.types.ts';
import { createDefaultMemoryComponent, getComponent } from '../core/ecs.ts';
export { createDefaultMemoryComponent };
import { getActiveRuleset } from '../rulesets/registry.ts';
import { resolveCurrencyConfig, resolveItemBaseValueInBaseUnits } from '../systems/currency.system.ts';
import { ComponentType } from '../types/components.types.ts';
import type { ShopComponent, MemoryComponent } from '../types/components.types.ts';
import { getEffectiveStandingBetween } from './faction.ts';

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
 * Maximum sell-to-shop multiplier allowed as a fair resale ceiling above base shop markdown.
 */
export const MAX_SELL_TO_SHOP_MULTIPLIER = 0.75;

/**
 * Maximum ratio between sell-back multiplier and buy multiplier (`sell <= buy * 0.85`),
 * preventing buy-and-resell arbitrage loops regardless of stacked discounts.
 */
export const MAX_SELL_TO_BUY_RATIO = 0.85;

/** Minimum allowed cumulative `sessionMarkupModifier` adjustment (`-40%`). */
export const MIN_SESSION_MARKUP_MOD = -0.4;

/** Maximum allowed cumulative `sessionMarkupModifier` penalty (`+60%`). */
export const MAX_SESSION_MARKUP_MOD = 0.6;

/** Maximum successful repeat haggle attempts allowed per negotiation skill against one merchant. */
export const MAX_TRADE_HAGGLE_WINS_PER_SKILL = 2;

/** Duration (turns) a merchant stays annoyed after a backfired haggle attempt. */
export const HAGGLE_ANNOYED_DURATION = 15;

const TRADE_LOCKED_FACT_PREFIX = 'trade_locked:';
const TRADE_WIN_FACT_PREFIX = 'trade_win:';
const PERCENT_MULTIPLIER = 100;

/**
 * Clamps a cumulative `sessionMarkupModifier` value to `[MIN_SESSION_MARKUP_MOD, MAX_SESSION_MARKUP_MOD]`
 * rounded to two decimal places.
 */
export function clampSessionMarkup(val: number): number {
  return Math.max(MIN_SESSION_MARKUP_MOD, Math.min(MAX_SESSION_MARKUP_MOD, Number(val.toFixed(2))));
}

/**
 * Evaluates whether a trade negotiation skill (`appraise`, `diplomacy`, `bluff`, `intimidate`)
 * can still be attempted against a merchant, or whether it is locked by prior failure or capped.
 */
export function getTradeSkillHaggleStatus(
  memory: MemoryComponent | undefined,
  skillId: string
): {
  readonly locked: boolean;
  readonly wins: number;
  readonly discountCapped: boolean;
  readonly canAttempt: boolean;
} {
  const facts = memory?.facts ?? [];
  const locked = facts.includes(`${TRADE_LOCKED_FACT_PREFIX}${skillId}`);
  const winPrefix = `${TRADE_WIN_FACT_PREFIX}${skillId}:`;
  const wins = facts.filter((f) => f.startsWith(winPrefix)).length;
  const discountCapped = (memory?.sessionMarkupModifier ?? 0) <= MIN_SESSION_MARKUP_MOD;
  return {
    locked,
    wins,
    discountCapped,
    canAttempt: !locked && wins < MAX_TRADE_HAGGLE_WINS_PER_SKILL && !discountCapped
  };
}

/**
 * Produces the updated `MemoryComponent.facts` array after a trade haggle attempt:
 * wins append `trade_win:<skillId>:<n>`, failures lock `trade_locked:<skillId>`.
 */
export function recordTradeHaggleOutcomeFacts(
  facts: ReadonlyArray<string>,
  skillId: string,
  succeeded: boolean
): ReadonlyArray<string> {
  if (succeeded) {
    const winPrefix = `${TRADE_WIN_FACT_PREFIX}${skillId}:`;
    const nextCount = facts.filter((f) => f.startsWith(winPrefix)).length + 1;
    return [...facts, `${winPrefix}${nextCount}`];
  }
  const lockFact = `${TRADE_LOCKED_FACT_PREFIX}${skillId}`;
  return facts.includes(lockFact) ? facts : [...facts, lockFact];
}

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

  const effectiveStanding = getEffectiveStandingBetween(state, shopEntityId, buyerEntityId);
  if (effectiveStanding !== 0) {
    const standingModifier = -(effectiveStanding / FACTION_STANDING_PRICE_DIVISOR);
    if (standingModifier !== 0) {
      multiplier += standingModifier;
      const pct = Math.round(standingModifier * 100);
      annotations.push(`Standing (${pct >= 0 ? `+${pct}%` : `${pct}%`})`);
    }
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

    if (memory.facets) {
      const greedy = memory.facets['greedy'] ?? PERSONALITY_FACET_NEUTRAL_VAL;
      const generous = memory.facets['generous'] ?? PERSONALITY_FACET_NEUTRAL_VAL;
      const greedyModifier = (greedy - PERSONALITY_FACET_NEUTRAL_VAL) / PERSONALITY_FACET_PRICE_DIVISOR;
      const generousModifier = -(generous - PERSONALITY_FACET_NEUTRAL_VAL) / PERSONALITY_FACET_PRICE_DIVISOR;
      const personalityDelta = greedyModifier + generousModifier;
      if (personalityDelta !== 0) {
        multiplier += personalityDelta;
        const pct = Math.round(personalityDelta * PERCENT_MULTIPLIER);
        annotations.push(`Personality (${pct >= 0 ? `+${pct}%` : `${pct}%`})`);
      }
    }

    if (memory.relationshipAxes) {
      const loyalty = memory.relationshipAxes['loyalty'] ?? 0;
      const fear = memory.relationshipAxes['fear'] ?? 0;
      const debt = memory.relationshipAxes['debt'] ?? 0;
      const resentment = memory.relationshipAxes['resentment'] ?? 0;

      let relationshipDelta = 0;
      if (loyalty > 0) relationshipDelta -= loyalty / RELATIONSHIP_AXIS_PRICE_DIVISOR;
      if (fear > 0) relationshipDelta -= fear / RELATIONSHIP_AXIS_PRICE_DIVISOR;
      if (debt > 0) relationshipDelta -= debt / RELATIONSHIP_AXIS_PRICE_DIVISOR;
      if (resentment > 0) relationshipDelta += resentment / RELATIONSHIP_AXIS_PRICE_DIVISOR;
      if (relationshipDelta !== 0) {
        multiplier += relationshipDelta;
        const pct = Math.round(relationshipDelta * PERCENT_MULTIPLIER);
        annotations.push(`Relationship (${pct >= 0 ? `+${pct}%` : `${pct}%`})`);
      }
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
  const uncappedSellMultiplier = (BASE_SELL_TO_SHOP_MULTIPLIER + sellMultiplierBonus) * (1 / finalBuyMultiplier);
  const maxSellAllowed = Math.min(MAX_SELL_TO_SHOP_MULTIPLIER, finalBuyMultiplier * MAX_SELL_TO_BUY_RATIO);
  const finalSellMultiplier = Math.max(MIN_SELL_TO_SHOP_MULTIPLIER, Math.min(maxSellAllowed, uncappedSellMultiplier));

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
