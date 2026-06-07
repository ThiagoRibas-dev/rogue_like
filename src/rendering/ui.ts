import { type GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { ITEM_REGISTRY } from '../constants/items.constants.ts';
import { getEffectiveCapacity } from '../systems/inventory.system.ts';

/**
 * Renders the GameState's messages to the DOM.
 * @param state The current GameState containing the messages array.
 */
export function renderMessageLog(state: GameState): void {
  const messageLog = document.getElementById('message-log');

  if (!messageLog) {
    return; // Fast fail if DOM element doesn't exist
  }

  // Clear existing messages
  // (In a more complex app, we might diff this or use a virtual DOM,
  // but for our MVP, replacing innerHTML is fast enough given the small count)
  messageLog.innerHTML = '';

  // Render messages from oldest to newest (top to bottom)
  for (const msg of state.messages) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (msg.cssClass) {
      // Allow adding multiple classes separated by spaces if needed
      msg.cssClass.split(' ').forEach((cls) => entry.classList.add(cls));
    }
    entry.textContent = msg.text;
    messageLog.appendChild(entry);
  }

  // Auto-scroll to the bottom so the newest message is always visible
  messageLog.scrollTop = messageLog.scrollHeight;
}

/**
 * Renders or hides the inventory panel overlay based on the current UIMode.
 * When open, lists all items in the player's inventory with slot labels (a-z),
 * colored by item category, and shows current capacity.
 * @param state The current GameState.
 */
export function renderInventoryPanel(state: GameState): void {
  const panel = document.getElementById('inventory-panel');
  if (!panel) return;

  if (state.uiMode !== UIMode.Inventory) {
    panel.classList.remove('visible');
    panel.innerHTML = '';
    return;
  }

  panel.classList.add('visible');
  panel.innerHTML = '';

  // Find player
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerEntityId === undefined) return;

  const inventory = getComponent(state, playerEntityId, ComponentType.Inventory);
  if (!inventory) return;

  const equipment = getComponent(state, playerEntityId, ComponentType.Equipment);
  const effectiveCapacity = getEffectiveCapacity(state, playerEntityId);

  // Header
  const header = document.createElement('div');
  header.className = 'inv-header';
  header.textContent = `Inventory (${inventory.items.length}/${effectiveCapacity})`;
  panel.appendChild(header);

  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = '[a-z] Use/Equip  [Shift+a-z] Drop  [I/Esc] Close';
  panel.appendChild(hint);

  if (inventory.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'inv-empty';
    empty.textContent = '(empty)';
    panel.appendChild(empty);
    return;
  }

  inventory.items.forEach((itemEntityId, index) => {
    const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
    if (!itemComp) return;

    const def = ITEM_REGISTRY[itemComp.itemId];
    const displayName = (itemComp.identified ? def?.name : def?.unidentifiedName) ?? itemComp.itemId;
    const slotLabel = String.fromCharCode(97 + index);
    const isEquippedWeapon = equipment?.weapon === itemEntityId;
    const isEquippedArmor = equipment?.armor === itemEntityId;
    const isEquipped = isEquippedWeapon || isEquippedArmor;

    const row = document.createElement('div');
    row.className = `inv-slot inv-cat-${def?.category ?? 'consumable'}`;
    if (isEquipped) row.classList.add('inv-equipped');

    const label = document.createElement('span');
    label.className = 'inv-slot-label';
    label.textContent = `${slotLabel})`;

    const name = document.createElement('span');
    name.className = 'inv-slot-name';
    name.textContent = `${displayName}${isEquipped ? ' (equipped)' : ''}`;

    row.appendChild(label);
    row.appendChild(name);
    panel.appendChild(row);
  });
}
