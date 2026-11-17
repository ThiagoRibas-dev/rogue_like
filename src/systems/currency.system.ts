import { getComponent, addComponent } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import { ComponentType, type InventoryComponent } from '../types/components.types.ts';
import type { CurrencyConfig, CurrencyDenomination, ItemDefinition } from '../types/campaign.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';

/**
 * Fallback single-denomination Console currency config used when neither campaign `rules.currency`
 * nor the active ruleset cartridge provides a multi-denomination monetary configuration.
 */
export const DEFAULT_CONSOLE_CURRENCY_CONFIG: CurrencyConfig = {
  baseUnitId: 'gold',
  defaultValueDenominationId: 'gold',
  denominations: [
    {
      id: 'gold',
      name: 'Gold',
      abbreviation: 'g',
      baseMultiplier: 1,
      color: '#f1c40f'
    }
  ],
  displayOrder: ['gold']
};

/**
 * Represents one decomposed coin bucket produced by `decomposeToCoins`.
 */
export interface DecomposedCoinBucket {
  readonly id: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly amount: number;
  readonly baseMultiplier: number;
  readonly color?: string | undefined;
}

/**
 * Resolves the active `CurrencyConfig` for the current game state.
 * Precedence: `campaign.rules.currency` -> `RulesetContract.getDefaultCurrencyConfig()` -> `DEFAULT_CONSOLE_CURRENCY_CONFIG`.
 */
export function resolveCurrencyConfig(state: Readonly<GameState>): CurrencyConfig {
  if (state.campaign.rules.currency) {
    return state.campaign.rules.currency;
  }
  const rulesetDefault = getActiveRuleset(state as GameState).getDefaultCurrencyConfig?.();
  return rulesetDefault ?? DEFAULT_CONSOLE_CURRENCY_CONFIG;
}

/**
 * Finds a denomination descriptor by ID within a `CurrencyConfig`.
 */
export function findCurrencyDenomination(
  config: Readonly<CurrencyConfig>,
  denominationId: string
): CurrencyDenomination | undefined {
  return config.denominations.find((d) => d.id === denominationId);
}

/**
 * Returns the integer multiplier in base coin units for a denomination ID (defaults to `1`).
 */
export function getDenominationMultiplier(config: Readonly<CurrencyConfig>, denominationId: string): number {
  return findCurrencyDenomination(config, denominationId)?.baseMultiplier ?? 1;
}

/**
 * Converts a denomination quantity into integer base coin units.
 */
export function toBaseUnits(amount: number, denominationId: string, config: Readonly<CurrencyConfig>): number {
  const mult = getDenominationMultiplier(config, denominationId);
  return Math.round(amount * mult);
}

/**
 * Converts an amount from one denomination to another (rounded down to whole target coins).
 */
export function convertCurrency(
  amount: number,
  fromDenominationId: string,
  toDenominationId: string,
  config: Readonly<CurrencyConfig>
): number {
  const baseAmount = toBaseUnits(amount, fromDenominationId, config);
  const targetMult = Math.max(1, getDenominationMultiplier(config, toDenominationId));
  return Math.floor(baseAmount / targetMult);
}

/**
 * Resolves an item definition's intrinsic `baseValue` into base coin units using `itemDef.currencyUnit`
 * or `config.defaultValueDenominationId` (falling back to `config.baseUnitId`).
 */
export function resolveItemBaseValueInBaseUnits(
  itemDef: Pick<ItemDefinition, 'baseValue' | 'currencyUnit'>,
  config: Readonly<CurrencyConfig>
): number {
  const rawValue = itemDef.baseValue ?? 0;
  if (rawValue <= 0) return 0;
  const unitId = itemDef.currencyUnit ?? config.defaultValueDenominationId ?? config.baseUnitId;
  return Math.max(1, Math.round(rawValue * getDenominationMultiplier(config, unitId)));
}

/**
 * Decomposes an integer base-unit amount into whole coin denominations, ordered by `baseMultiplier`
 * descending (greedy decomposition), and formatted according to `displayOrder` when specified.
 */
export function decomposeToCoins(
  totalBaseUnits: number,
  config: Readonly<CurrencyConfig>
): ReadonlyArray<DecomposedCoinBucket> {
  const sanitizedTotal = Math.max(0, Math.floor(totalBaseUnits));
  const sortedDesc = [...config.denominations].sort((a, b) => b.baseMultiplier - a.baseMultiplier);

  let remaining = sanitizedTotal;
  const computedById = new Map<string, DecomposedCoinBucket>();

  for (const denom of sortedDesc) {
    const mult = Math.max(1, denom.baseMultiplier);
    const count = Math.floor(remaining / mult);
    remaining -= count * mult;
    if (count > 0) {
      computedById.set(denom.id, {
        id: denom.id,
        name: denom.name,
        abbreviation: denom.abbreviation,
        amount: count,
        baseMultiplier: mult,
        ...(denom.color !== undefined ? { color: denom.color } : {})
      });
    }
  }

  if (computedById.size === 0) {
    const fallbackId = config.defaultValueDenominationId ?? config.baseUnitId;
    const fallbackDenom =
      findCurrencyDenomination(config, fallbackId) ?? sortedDesc[sortedDesc.length - 1] ?? config.denominations[0];
    if (!fallbackDenom) return [];
    return [
      {
        id: fallbackDenom.id,
        name: fallbackDenom.name,
        abbreviation: fallbackDenom.abbreviation,
        amount: 0,
        baseMultiplier: fallbackDenom.baseMultiplier,
        ...(fallbackDenom.color !== undefined ? { color: fallbackDenom.color } : {})
      }
    ];
  }

  if (config.displayOrder && config.displayOrder.length > 0) {
    const ordered: DecomposedCoinBucket[] = [];
    for (const id of config.displayOrder) {
      const bucket = computedById.get(id);
      if (bucket) {
        ordered.push(bucket);
        computedById.delete(id);
      }
    }
    for (const leftover of computedById.values()) {
      ordered.push(leftover);
    }
    return ordered;
  }

  return Array.from(computedById.values());
}

/**
 * Formats an integer base-unit amount as a human-readable multi-denomination string
 * (e.g. `"15 gp, 4 sp, 5 cp"` or `"250g"`).
 */
export function formatCurrency(totalBaseUnits: number, config: Readonly<CurrencyConfig>, compact = false): string {
  const buckets = decomposeToCoins(totalBaseUnits, config);
  if (buckets.length === 0) return `${Math.max(0, Math.floor(totalBaseUnits))}`;

  if (compact && config.denominations.length === 1) {
    const b = buckets[0]!;
    return `${b.amount.toLocaleString()}${b.abbreviation}`;
  }

  return buckets
    .map((b) =>
      compact ? `${b.amount.toLocaleString()}${b.abbreviation}` : `${b.amount.toLocaleString()} ${b.abbreviation}`
    )
    .join(', ');
}

/**
 * Returns an entity's stored monetary balance in base coin units (`0` if absent).
 */
export function getEntityCurrencyBalance(state: Readonly<GameState>, entityId: EntityId): number {
  const inventory = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  return Math.max(0, Math.floor(inventory?.currencyBalance ?? 0));
}

/**
 * Sets an entity's base-unit monetary balance directly (clamped to `>= 0`).
 */
export function setEntityCurrencyBalance(state: GameState, entityId: EntityId, balanceBaseUnits: number): GameState {
  const inventory = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (!inventory) return state;
  return addComponent(state, entityId, {
    ...inventory,
    currencyBalance: Math.max(0, Math.floor(balanceBaseUnits))
  });
}

/**
 * Credits or debits an entity's base-unit monetary balance. Rejects debits exceeding current funds.
 */
export function addEntityCurrency(
  state: GameState,
  entityId: EntityId,
  deltaBaseUnits: number
): { readonly state: GameState; readonly balance: number; readonly success: boolean } {
  const inventory = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (!inventory) {
    return { state, balance: 0, success: false };
  }
  const current = Math.max(0, Math.floor(inventory.currencyBalance ?? 0));
  const delta = Math.trunc(deltaBaseUnits);
  const nextBalance = current + delta;
  if (nextBalance < 0) {
    return { state, balance: current, success: false };
  }
  const nextState = addComponent(state, entityId, {
    ...inventory,
    currencyBalance: nextBalance
  });
  return { state: nextState, balance: nextBalance, success: true };
}

/**
 * Transfers base-unit currency atomically from `fromEntityId` to `toEntityId`.
 */
export function transferEntityCurrency(
  state: GameState,
  fromEntityId: EntityId,
  toEntityId: EntityId,
  amountBaseUnits: number
): { readonly state: GameState; readonly success: boolean } {
  const sanitized = Math.max(0, Math.floor(amountBaseUnits));
  if (sanitized === 0) return { state, success: true };

  const debit = addEntityCurrency(state, fromEntityId, -sanitized);
  if (!debit.success) return { state, success: false };

  const recipientInventory = getComponent(debit.state, toEntityId, ComponentType.Inventory) as
    InventoryComponent | undefined;
  if (!recipientInventory) {
    return { state: debit.state, success: true };
  }

  const credit = addEntityCurrency(debit.state, toEntityId, sanitized);
  return { state: credit.state, success: credit.success };
}
