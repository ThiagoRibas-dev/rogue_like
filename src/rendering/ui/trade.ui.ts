import type { GameState } from '../../types/game-state.types.ts';
import { UIMode } from '../../types/game-state.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { ShopComponent, InventoryComponent, ItemComponent } from '../../types/components.types.ts';
import { getEffectivePrice } from '../../utils/trade.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { Intent } from '../../types/intents/intent.union.ts';

export function renderTradeUI(state: GameState, queueIntent: (intent: Intent) => void): HTMLElement | null {
  if (state.uiMode !== UIMode.Trade || !state.activeTrade) return null;

  const npcId = state.activeTrade.npcEntityId;
  const playerId = state.entities.find((e) => getComponent(state, e, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const shop = getComponent(state, npcId, ComponentType.Shop) as ShopComponent | undefined;
  if (!shop) return null;

  const npcInventory = getComponent(state, npcId, ComponentType.Inventory) as InventoryComponent | undefined;
  const playerInventory = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;

  const container = document.createElement('div');
  container.className = 'trade-ui-container panel';
  container.style.position = 'absolute';
  container.style.top = '10%';
  container.style.left = '10%';
  container.style.width = '80%';
  container.style.height = '80%';
  container.style.backgroundColor = 'var(--panel-bg)';
  container.style.color = 'var(--panel-fg)';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.padding = '20px';
  container.style.boxSizing = 'border-box';
  container.style.zIndex = '1000';

  const header = document.createElement('h2');
  header.textContent = 'Trade & Barter';
  container.appendChild(header);

  // Layout: Left (NPC Inventory), Right (Player Inventory)
  const columns = document.createElement('div');
  columns.style.display = 'flex';
  columns.style.flex = '1';
  columns.style.gap = '20px';
  columns.style.overflow = 'hidden';

  // NPC Column
  const npcCol = document.createElement('div');
  npcCol.style.flex = '1';
  npcCol.style.display = 'flex';
  npcCol.style.flexDirection = 'column';
  const npcHeader = document.createElement('h3');
  npcHeader.textContent = `Merchant's Wares`;
  npcCol.appendChild(npcHeader);

  const npcList = document.createElement('ul');
  npcList.style.flex = '1';
  npcList.style.overflowY = 'auto';
  npcList.style.listStyle = 'none';
  npcList.style.padding = '0';

  if (npcInventory && npcInventory.items.length > 0) {
    for (const itemEntityId of npcInventory.items) {
      if (!shop.inventory.includes(itemEntityId)) continue; // Only show items explicitly for sale

      const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
      if (!itemComp) continue;

      const def = state.campaign.items[itemComp.itemId];
      if (!def) continue;

      const price = getEffectivePrice(state, def.baseValue ?? 0, npcId, playerId, false);

      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.justifyContent = 'space-between';
      li.style.padding = '8px';
      li.style.borderBottom = '1px solid var(--border-color)';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${def.name ?? itemComp.itemId}`;

      const priceSpan = document.createElement('span');
      priceSpan.textContent = `${price}g`;

      // NOTE: Intent generation would be here for Buying
      const buyBtn = document.createElement('button');
      buyBtn.textContent = 'Buy';
      buyBtn.onclick = () => {
        // Construct Buy Intent (or generic ApplyIntent)
        // queueIntent({...})
      };

      li.appendChild(nameSpan);
      li.appendChild(priceSpan);
      li.appendChild(buyBtn);
      npcList.appendChild(li);
    }
  } else {
    npcList.innerHTML = '<li>Out of stock!</li>';
  }
  npcCol.appendChild(npcList);

  // Player Column
  const playerCol = document.createElement('div');
  playerCol.style.flex = '1';
  playerCol.style.display = 'flex';
  playerCol.style.flexDirection = 'column';
  const playerHeader = document.createElement('h3');
  playerHeader.textContent = `Your Inventory`;
  playerCol.appendChild(playerHeader);

  const playerList = document.createElement('ul');
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

      const isBuyable = def.tags?.some((t) => shop.buyTags.includes(t)) ?? false;
      const price = getEffectivePrice(state, def.baseValue ?? 0, npcId, playerId, true);

      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.justifyContent = 'space-between';
      li.style.padding = '8px';
      li.style.borderBottom = '1px solid var(--border-color)';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${def.name ?? itemComp.itemId}`;

      const priceSpan = document.createElement('span');
      priceSpan.textContent = isBuyable ? `${price}g` : 'Not interested';

      if (isBuyable) {
        const sellBtn = document.createElement('button');
        sellBtn.textContent = 'Sell / Barter';
        sellBtn.onclick = () => {
          // Barter interaction
          queueIntent({
            type: IntentType.Apply,
            entityId: playerId,
            verb: 'barter',
            toolEntityId: itemEntityId,
            target: { type: 'entity', entityId: npcId }
          } as Intent);
        };
        li.appendChild(nameSpan);
        li.appendChild(priceSpan);
        li.appendChild(sellBtn);
      } else {
        li.appendChild(nameSpan);
        li.appendChild(priceSpan);
      }
      playerList.appendChild(li);
    }
  } else {
    playerList.innerHTML = '<li>Your bags are empty.</li>';
  }
  playerCol.appendChild(playerList);

  columns.appendChild(npcCol);
  columns.appendChild(playerCol);
  container.appendChild(columns);

  const footer = document.createElement('div');
  footer.style.marginTop = '20px';
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  footer.style.gap = '10px';

  // Intimidate / Persuade options
  const intimidateBtn = document.createElement('button');
  intimidateBtn.textContent = 'Intimidate';
  intimidateBtn.onclick = () => {
    queueIntent({
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'intimidate',
      target: { type: 'entity', entityId: npcId }
    } as Intent);
  };

  const persuadeBtn = document.createElement('button');
  persuadeBtn.textContent = 'Persuade';
  persuadeBtn.onclick = () => {
    queueIntent({
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'persuade',
      target: { type: 'entity', entityId: npcId }
    } as Intent);
  };

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.onclick = () => {
    // We can use a generic Intent to pop UI mode, or fire a specific exit intent.
    // Assuming handling for a generic intent exists.
  };

  footer.appendChild(intimidateBtn);
  footer.appendChild(persuadeBtn);
  footer.appendChild(closeBtn);
  container.appendChild(footer);

  return container;
}
