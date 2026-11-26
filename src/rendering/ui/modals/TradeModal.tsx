import type { JSX } from 'preact';
import { getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { getActiveRuleset } from '../../../rulesets/registry.ts';
import { formatCurrency, getEntityCurrencyBalance, resolveCurrencyConfig } from '../../../systems/currency.system.ts';
import {
  ComponentType,
  type AttitudeComponent,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent,
  type MemoryComponent,
  type ShopComponent
} from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { IntentType } from '../../../types/intents/intent.enum.ts';
import type { ApplyIntent } from '../../../types/intents/interaction.intents.ts';
import type { CloseTradeIntent } from '../../../types/intents/ui.intents.ts';
import type { TradeSocialActionDescriptor } from '../../../types/ruleset.types.ts';
import {
  getEffectiveItemPriceInBaseUnits,
  getTradePriceBreakdown,
  getTradeSkillHaggleStatus
} from '../../../utils/trade.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge } from '../primitives/DataDisplay.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';

const CONSOLE_DEFAULT_TRADE_SOCIAL_ACTIONS: ReadonlyArray<TradeSocialActionDescriptor> = [
  { label: 'Persuade', verb: 'persuade', skillId: 'persuade' },
  { label: 'Intimidate', verb: 'intimidate', skillId: 'intimidate' }
];

const PERCENT_MULTIPLIER = 100;

/**
 * Dual-pane Trade & Barter modal supporting multi-denomination currency, merchant
 * disposition/rate annotations, keyboard-focusable Buy/Sell rows, and Cartridge social haggle actions.
 */
export function TradeModal(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const modalsVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Modals]);
  const invVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Inventory]);
  void modalsVer;
  void invVer;

  if (!state || state.uiMode !== UIMode.Trade || !state.activeTrade) {
    return null;
  }

  const npcId = state.activeTrade.npcEntityId;
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const shop = getComponent(state, npcId, ComponentType.Shop) as ShopComponent | undefined;
  if (!shop) return null;

  const playerInventory = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;
  const playerEquipment = getComponent(state, playerId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const attitudeComp = getComponent(state, npcId, ComponentType.Attitude) as AttitudeComponent | undefined;
  const npcMemory = getComponent(state, npcId, ComponentType.Memory) as MemoryComponent | undefined;
  const currencyConfig = resolveCurrencyConfig(state);
  const playerBalance = getEntityCurrencyBalance(state, playerId);
  const merchantName = resolveEntityDisplayName(state, npcId, 'Merchant');
  const buyBreakdown = getTradePriceBreakdown(state, npcId, playerId, false);
  const socialActions = getActiveRuleset(state).getTradeSocialActions?.() ?? CONSOLE_DEFAULT_TRADE_SOCIAL_ACTIONS;

  const attitudeText = attitudeComp?.attitude ? `Attitude: ${attitudeComp.attitude}` : 'Attitude: indifferent';
  const rateText = `Buy Rate: ${Math.round(buyBreakdown.finalBuyMultiplier * PERCENT_MULTIPLIER)}%`;
  const notesText = buyBreakdown.annotations.length > 0 ? ` · ${buyBreakdown.annotations.join(' · ')}` : '';

  const handleClose = (): void => {
    const closeIntent: CloseTradeIntent = {
      type: IntentType.CloseTrade,
      entityId: playerId,
      isImmediate: true
    };
    queuePlayerIntent(closeIntent);
  };

  return (
    <ModalShell
      title={`Trade & Barter — ${merchantName}`}
      subtitle={`${attitudeText} · ${rateText}${notesText}`}
      size="xl"
      scrollMode="panes"
      onClose={handleClose}
      headerActions={<Badge tone="accent">{`Purse: ${formatCurrency(playerBalance, currencyConfig)}`}</Badge>}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ui-space-2)', flexWrap: 'wrap' }}>
          {socialActions.map((descriptor) => {
            const status = getTradeSkillHaggleStatus(npcMemory, descriptor.skillId);
            const label = status.locked
              ? `${descriptor.label} (Locked)`
              : !status.canAttempt
                ? `${descriptor.label} (Max)`
                : descriptor.label;
            return (
              <Button
                key={descriptor.skillId}
                variant="secondary"
                size="sm"
                disabled={!status.canAttempt}
                onClick={(): void => {
                  const socialIntent: ApplyIntent = {
                    type: IntentType.Apply,
                    entityId: playerId,
                    verb: descriptor.verb,
                    target: { type: 'entity', entityId: npcId },
                    isImmediate: true
                  };
                  queuePlayerIntent(socialIntent);
                }}
              >
                {label}
              </Button>
            );
          })}
          <Button variant="primary" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="ui-trade-columns">
        {/* Merchant Stock Pane */}
        <section className="ui-trade-pane" aria-label={`${merchantName}'s Wares`}>
          <h3 className="ui-trade-pane-title">{`${merchantName}'s Wares (${shop.inventory.length})`}</h3>
          <div className="ui-trade-list">
            {shop.inventory.length === 0 ? (
              <div style={{ padding: '12px', color: 'var(--ui-text-muted)' }}>Out of stock!</div>
            ) : (
              shop.inventory.map((itemEntityId) => {
                const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
                if (!itemComp) return null;
                const def = state.campaign.items[itemComp.itemId];
                if (!def) return null;

                const price = getEffectiveItemPriceInBaseUnits(state, def, npcId, playerId, false);
                const canAfford = playerBalance >= price;
                const displayName = resolveEntityDisplayName(state, itemEntityId, def.name ?? itemComp.itemId);

                return (
                  <div key={itemEntityId} className="ui-trade-row">
                    <span className="ui-trade-row__name">{displayName}</span>
                    <span className="ui-trade-row__price" data-affordable={canAfford ? 'true' : 'false'}>
                      {formatCurrency(price, currencyConfig)}
                    </span>
                    <Button
                      size="sm"
                      variant={canAfford ? 'primary' : 'ghost'}
                      disabled={!canAfford}
                      onClick={(): void => {
                        const buyIntent: ApplyIntent = {
                          type: IntentType.Apply,
                          entityId: playerId,
                          verb: 'buy',
                          toolEntityId: itemEntityId,
                          target: { type: 'entity', entityId: npcId },
                          isImmediate: true
                        };
                        queuePlayerIntent(buyIntent);
                      }}
                    >
                      Buy
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Player Inventory Pane */}
        <section className="ui-trade-pane" aria-label="Your Inventory">
          <h3 className="ui-trade-pane-title">Your Inventory</h3>
          <div className="ui-trade-list">
            {!playerInventory || playerInventory.items.length === 0 ? (
              <div style={{ padding: '12px', color: 'var(--ui-text-muted)' }}>Your bags are empty.</div>
            ) : (
              playerInventory.items.map((itemEntityId) => {
                const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
                if (!itemComp) return null;
                const def = state.campaign.items[itemComp.itemId];
                if (!def) return null;

                const isEquipped = playerEquipment?.slots.some((s) => s.equippedItem === itemEntityId) ?? false;
                const isBuyable =
                  !def.currencyGrant &&
                  (shop.buyTags.length === 0 || (def.tags?.some((t) => shop.buyTags.includes(t)) ?? false));
                const sellPrice = getEffectiveItemPriceInBaseUnits(state, def, npcId, playerId, true);
                const displayName = resolveEntityDisplayName(state, itemEntityId, def.name ?? itemComp.itemId);

                return (
                  <div key={itemEntityId} className="ui-trade-row">
                    <span className="ui-trade-row__name">{`${displayName}${isEquipped ? ' [Equipped]' : ''}`}</span>
                    <span className="ui-trade-row__price">
                      {isBuyable && sellPrice > 0 ? formatCurrency(sellPrice, currencyConfig) : 'Not interested'}
                    </span>
                    {isBuyable && sellPrice > 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isEquipped}
                        onClick={(): void => {
                          const sellIntent: ApplyIntent = {
                            type: IntentType.Apply,
                            entityId: playerId,
                            verb: 'sell',
                            toolEntityId: itemEntityId,
                            target: { type: 'entity', entityId: npcId },
                            isImmediate: true
                          };
                          queuePlayerIntent(sellIntent);
                        }}
                      >
                        {isEquipped ? 'Equipped' : 'Sell'}
                      </Button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </ModalShell>
  );
}
