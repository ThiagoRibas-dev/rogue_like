import type { GameState } from '../../types/game-state.types.ts';
import { UIMode } from '../../types/game-state.types.ts';
import { getComponent, resolveEntityDisplayName } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { getActiveRuleset } from '../../rulesets/registry.ts';
import { ComponentType } from '../../types/components.types.ts';
import type {
  AttitudeComponent,
  EquipmentComponent,
  InventoryComponent,
  ItemComponent,
  MemoryComponent,
  ShopComponent
} from '../../types/components.types.ts';
import type { TradeSocialActionDescriptor } from '../../types/ruleset.types.ts';
import { formatCurrency, getEntityCurrencyBalance, resolveCurrencyConfig } from '../../systems/currency.system.ts';
import {
  getEffectiveItemPriceInBaseUnits,
  getTradePriceBreakdown,
  getTradeSkillHaggleStatus
} from '../../utils/trade.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { ApplyIntent } from '../../types/intents/interaction.intents.ts';
import type { CloseTradeIntent } from '../../types/intents/ui.intents.ts';
import type { Intent } from '../../types/intents/intent.union.ts';

const CONSOLE_DEFAULT_TRADE_SOCIAL_ACTIONS: ReadonlyArray<TradeSocialActionDescriptor> = [
  { label: 'Persuade', verb: 'persuade', skillId: 'persuade' },
  { label: 'Intimidate', verb: 'intimidate', skillId: 'intimidate' }
];

const TRADE_OVERLAY_ID = 'trade-overlay';
const PERCENT_MULTIPLIER = 100;

/**
 * Renders the trading interface for bartering items, buying/selling with multi-denomination currency,
 * inspecting disposition/price modifiers, and invoking Cartridge social haggling skills.
 */
export function renderTradeUI(state: GameState, queueIntent: (intent: Intent) => void): HTMLElement | null {
  if (state.uiMode !== UIMode.Trade || !state.activeTrade) return null;

  const npcId = state.activeTrade.npcEntityId;
  const playerId = state.entities.find((e) => getComponent(state, e, ComponentType.Player) !== undefined);
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

  const container = document.createElement('div');
  container.className = 'trade-ui-container panel';
  container.style.position = 'absolute';
  container.style.top = '8%';
  container.style.left = '8%';
  container.style.width = '84%';
  container.style.height = '84%';
  container.style.backgroundColor = 'var(--bg-card, #16181f)';
  container.style.color = 'var(--text-main, #e2d9c8)';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.padding = '20px';
  container.style.boxSizing = 'border-box';
  container.style.border = '1px solid var(--border-color, #2a2d3d)';
  container.style.zIndex = '1000';

  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.alignItems = 'center';
  headerRow.style.marginBottom = '8px';
  headerRow.style.borderBottom = '1px solid var(--border-color)';
  headerRow.style.paddingBottom = '10px';

  const headerTitle = document.createElement('div');
  const titleEl = document.createElement('h2');
  titleEl.style.margin = '0';
  titleEl.textContent = `Trade & Barter — ${merchantName}`;
  headerTitle.appendChild(titleEl);

  const subMeta = document.createElement('div');
  subMeta.style.fontSize = '0.85rem';
  subMeta.style.opacity = '0.85';
  const attitudeText = attitudeComp?.attitude ? `Attitude: ${attitudeComp.attitude}` : 'Attitude: indifferent';
  const rateText = `Buy Rate: ${Math.round(buyBreakdown.finalBuyMultiplier * PERCENT_MULTIPLIER)}%`;
  const notesText = buyBreakdown.annotations.length > 0 ? ` | ${buyBreakdown.annotations.join(' · ')}` : '';
  subMeta.textContent = `${attitudeText} · ${rateText}${notesText}`;
  headerTitle.appendChild(subMeta);

  const purseBadge = document.createElement('div');
  purseBadge.style.fontWeight = 'bold';
  purseBadge.style.fontSize = '1rem';
  purseBadge.textContent = `Your Purse: ${formatCurrency(playerBalance, currencyConfig)}`;

  headerRow.append(headerTitle, purseBadge);
  container.appendChild(headerRow);

  // Layout: Left (Merchant Shop Stock), Right (Player Inventory)
  const columns = document.createElement('div');
  columns.style.display = 'flex';
  columns.style.flex = '1';
  columns.style.gap = '20px';
  columns.style.overflow = 'hidden';

  // NPC Shop Stock Column
  const npcCol = document.createElement('div');
  npcCol.style.flex = '1';
  npcCol.style.display = 'flex';
  npcCol.style.flexDirection = 'column';
  const npcHeader = document.createElement('h3');
  npcHeader.textContent = `${merchantName}'s Wares (${shop.inventory.length})`;
  npcCol.appendChild(npcHeader);

  const npcList = document.createElement('ul');
  npcList.className = 'trade-npc-list';
  npcList.style.flex = '1';
  npcList.style.overflowY = 'auto';
  npcList.style.listStyle = 'none';
  npcList.style.padding = '0';

  if (shop.inventory.length > 0) {
    for (const itemEntityId of shop.inventory) {
      const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
      if (!itemComp) continue;
      const def = state.campaign.items[itemComp.itemId];
      if (!def) continue;

      const price = getEffectiveItemPriceInBaseUnits(state, def, npcId, playerId, false);
      const canAfford = playerBalance >= price;

      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.justifyContent = 'space-between';
      li.style.alignItems = 'center';
      li.style.gap = '10px';
      li.style.padding = '8px';
      li.style.borderBottom = '1px solid var(--border-color, #2a2d3d)';

      const nameSpan = document.createElement('span');
      nameSpan.style.flex = '1';
      nameSpan.textContent = resolveEntityDisplayName(state, itemEntityId, def.name ?? itemComp.itemId);

      const priceSpan = document.createElement('span');
      priceSpan.style.minWidth = '110px';
      priceSpan.style.textAlign = 'right';
      priceSpan.style.color = canAfford ? 'var(--text-main, #e2d9c8)' : '#e74c3c';
      priceSpan.textContent = formatCurrency(price, currencyConfig);

      const buyBtn = document.createElement('button');
      buyBtn.textContent = 'Buy';
      buyBtn.disabled = !canAfford;
      buyBtn.onclick = () => {
        const buyIntent: ApplyIntent = {
          type: IntentType.Apply,
          entityId: playerId,
          verb: 'buy',
          toolEntityId: itemEntityId,
          target: { type: 'entity', entityId: npcId },
          isImmediate: true
        };
        queueIntent(buyIntent);
      };

      li.append(nameSpan, priceSpan, buyBtn);
      npcList.appendChild(li);
    }
  } else {
    const emptyLi = document.createElement('li');
    emptyLi.style.padding = '12px';
    emptyLi.style.opacity = '0.75';
    emptyLi.textContent = 'Out of stock!';
    npcList.appendChild(emptyLi);
  }
  npcCol.appendChild(npcList);

  // Player Column
  const playerCol = document.createElement('div');
  playerCol.style.flex = '1';
  playerCol.style.display = 'flex';
  playerCol.style.flexDirection = 'column';
  const playerHeader = document.createElement('h3');
  playerHeader.textContent = 'Your Inventory';
  playerCol.appendChild(playerHeader);

  const playerList = document.createElement('ul');
  playerList.className = 'trade-player-list';
  playerList.style.flex = '1';
  playerList.style.overflowY = 'auto';
  playerList.style.listStyle = 'none';
  playerList.style.padding = '0';

  if (playerInventory && playerInventory.items.length > 0) {
    for (const itemEntityId of playerInventory.items) {
      const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
      if (!itemComp) continue;
      const def = state.campaign.items[itemComp.itemId];
      if (!def) continue;

      const isEquipped = playerEquipment?.slots.some((s) => s.equippedItem === itemEntityId) ?? false;
      const isBuyable =
        !def.currencyGrant && (shop.buyTags.length === 0 || (def.tags?.some((t) => shop.buyTags.includes(t)) ?? false));
      const sellPrice = getEffectiveItemPriceInBaseUnits(state, def, npcId, playerId, true);

      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.justifyContent = 'space-between';
      li.style.alignItems = 'center';
      li.style.gap = '10px';
      li.style.padding = '8px';
      li.style.borderBottom = '1px solid var(--border-color)';

      const nameSpan = document.createElement('span');
      nameSpan.style.flex = '1';
      const displayName = resolveEntityDisplayName(state, itemEntityId, def.name ?? itemComp.itemId);
      nameSpan.textContent = `${displayName}${isEquipped ? ' [Equipped]' : ''}`;

      const priceSpan = document.createElement('span');
      priceSpan.style.minWidth = '110px';
      priceSpan.style.textAlign = 'right';
      priceSpan.textContent = isBuyable && sellPrice > 0 ? formatCurrency(sellPrice, currencyConfig) : 'Not interested';

      if (isBuyable && sellPrice > 0) {
        const sellBtn = document.createElement('button');
        sellBtn.textContent = isEquipped ? 'Equipped' : 'Sell';
        sellBtn.disabled = isEquipped;
        sellBtn.onclick = () => {
          const sellIntent: ApplyIntent = {
            type: IntentType.Apply,
            entityId: playerId,
            verb: 'sell',
            toolEntityId: itemEntityId,
            target: { type: 'entity', entityId: npcId },
            isImmediate: true
          };
          queueIntent(sellIntent);
        };
        li.append(nameSpan, priceSpan, sellBtn);
      } else {
        li.append(nameSpan, priceSpan);
      }
      playerList.appendChild(li);
    }
  } else {
    const emptyLi = document.createElement('li');
    emptyLi.style.padding = '12px';
    emptyLi.style.opacity = '0.75';
    emptyLi.textContent = 'Your bags are empty.';
    playerList.appendChild(emptyLi);
  }
  playerCol.appendChild(playerList);

  columns.append(npcCol, playerCol);
  container.appendChild(columns);

  const footer = document.createElement('div');
  footer.style.marginTop = '16px';
  footer.style.paddingTop = '12px';
  footer.style.borderTop = '1px solid var(--border-color)';
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.alignItems = 'center';
  footer.style.gap = '10px';

  const socialBar = document.createElement('div');
  socialBar.style.display = 'flex';
  socialBar.style.gap = '8px';

  const makeSocialBtn = (descriptor: TradeSocialActionDescriptor): HTMLButtonElement => {
    const btn = document.createElement('button');
    const haggleStatus = getTradeSkillHaggleStatus(npcMemory, descriptor.skillId);
    btn.textContent = haggleStatus.locked
      ? `${descriptor.label} (Locked)`
      : !haggleStatus.canAttempt
        ? `${descriptor.label} (Max)`
        : descriptor.label;
    btn.disabled = !haggleStatus.canAttempt;
    btn.onclick = () => {
      const socialIntent: ApplyIntent = {
        type: IntentType.Apply,
        entityId: playerId,
        verb: descriptor.verb,
        target: { type: 'entity', entityId: npcId },
        isImmediate: true
      };
      queueIntent(socialIntent);
    };
    return btn;
  };

  for (const descriptor of socialActions) {
    socialBar.appendChild(makeSocialBtn(descriptor));
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close [Esc]';
  closeBtn.onclick = () => {
    const closeIntent: CloseTradeIntent = {
      type: IntentType.CloseTrade,
      entityId: playerId,
      isImmediate: true
    };
    queueIntent(closeIntent);
  };

  footer.append(socialBar, closeBtn);
  container.appendChild(footer);

  return container;
}

/**
 * Mounts or tears down the DOM `#trade-overlay` backdrop and Trade panel during `PresentationDomain.Modals`,
 * preserving shop and inventory scroll offsets across transactions and social haggling attempts.
 */
export function renderTradeOverlay(state: GameState): void {
  const existingOverlay = document.getElementById(TRADE_OVERLAY_ID);
  if (state.uiMode !== UIMode.Trade || !state.activeTrade) {
    existingOverlay?.remove();
    return;
  }

  const prevNpcScroll = existingOverlay?.querySelector('.trade-npc-list')?.scrollTop ?? 0;
  const prevPlayerScroll = existingOverlay?.querySelector('.trade-player-list')?.scrollTop ?? 0;

  const panel = renderTradeUI(state, queuePlayerIntent);
  if (!panel) {
    existingOverlay?.remove();
    return;
  }

  let overlay = existingOverlay;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = TRADE_OVERLAY_ID;
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.65)';
    overlay.style.zIndex = '999';
    document.body.appendChild(overlay);
  }

  overlay.replaceChildren(panel);

  const nextNpcList = overlay.querySelector('.trade-npc-list');
  if (nextNpcList) {
    nextNpcList.scrollTop = prevNpcScroll;
  }
  const nextPlayerList = overlay.querySelector('.trade-player-list');
  if (nextPlayerList) {
    nextPlayerList.scrollTop = prevPlayerScroll;
  }
}
