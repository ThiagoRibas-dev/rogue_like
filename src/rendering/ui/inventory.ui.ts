import { type GameState, type EntityId, UIMode } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { getEffectiveCapacity } from '../../systems/inventory.system.ts';
import { UITooltipType } from '../../constants/ui.constants.ts';

/**
 * Renders or hides the inventory panel overlay based on the current UIMode.
 * When open, lists all items in the player's inventory with slot labels (a-z),
 * colored by item category, and shows current capacity.
 * @param state The current GameState.
 */
export function renderInventoryPanel(state: GameState): void {
  const overlay = document.getElementById('inventory-overlay');
  const equipPanel = document.getElementById('equipment-panel');
  const packPanel = document.getElementById('backpack-panel');
  if (!overlay || !equipPanel || !packPanel) return;

  if (state.uiMode !== UIMode.Inventory) {
    overlay.classList.add('hidden');
    equipPanel.innerHTML = '';
    packPanel.innerHTML = '';
    return;
  }

  overlay.classList.remove('hidden');
  equipPanel.innerHTML = '';
  packPanel.innerHTML = '';

  // Find player
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerEntityId === undefined) return;

  const inventory = getComponent(state, playerEntityId, ComponentType.Inventory);
  if (!inventory) return;

  const equipment = getComponent(state, playerEntityId, ComponentType.Equipment);
  const effectiveCapacity = getEffectiveCapacity(state, playerEntityId);

  // Headers
  const equipHeader = document.createElement('div');
  equipHeader.className = 'inv-header';
  equipHeader.textContent = `Equipment`;
  equipPanel.appendChild(equipHeader);

  const packHeader = document.createElement('div');
  packHeader.className = 'inv-header';
  packHeader.textContent = `Backpack (${inventory.items.length}/${effectiveCapacity})`;
  packPanel.appendChild(packHeader);

  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = '[a-z] Use/Equip  [Shift+a-z] Drop  [I/Esc] Close';
  packPanel.appendChild(hint);

  // --- Equipment Panel (Paperdoll Layout) ---
  const paperdoll = document.createElement('div');
  paperdoll.className = 'paperdoll-layout';

  const renderEquipSlot = (slotName: string, itemEntityId: EntityId | null): HTMLElement => {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'paperdoll-slot';

    const header = document.createElement('div');
    header.className = 'equipment-slot-header';
    header.textContent = slotName;
    slotDiv.appendChild(header);

    if (itemEntityId === null) {
      const empty = document.createElement('div');
      empty.className = 'equipment-slot-empty';
      empty.textContent = '(Empty)';
      slotDiv.appendChild(empty);
    } else {
      const index = inventory.items.indexOf(itemEntityId);
      if (index === -1) return slotDiv;

      const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
      if (!itemComp) return slotDiv;

      const def = state.campaign.items[itemComp.itemId];
      const isIdentified = state.identifiedItems.has(itemComp.itemId);
      const displayName = isIdentified
        ? def?.name
        : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? def?.unidentifiedName ?? itemComp.itemId);
      const slotLabel = String.fromCharCode(97 + index);

      const row = document.createElement('div');
      row.className = `inv-slot inv-cat-${def?.category ?? 'consumable'} inv-equipped`;
      row.dataset.tooltipType = UITooltipType.Item;
      row.dataset.tooltipId = itemEntityId.toString();

      const label = document.createElement('span');
      label.className = 'inv-slot-label';
      label.textContent = `[${slotLabel}]`;

      const name = document.createElement('span');
      name.className = 'inv-slot-name';
      name.textContent = `${displayName}`;

      row.appendChild(label);
      row.appendChild(name);
      slotDiv.appendChild(row);
    }
    return slotDiv;
  };

  const createZone = (zoneName: string, slotTypes: string[]) => {
    const zoneDiv = document.createElement('div');
    zoneDiv.className = `paperdoll-zone zone-${zoneName}`;

    if (equipment) {
      const zoneSlots = equipment.slots.filter((s) => slotTypes.includes(s.slotType));
      if (zoneSlots.length > 0) {
        zoneSlots.forEach((slot) => {
          zoneDiv.appendChild(renderEquipSlot(slot.slotType, slot.equippedItem));
        });
        paperdoll.appendChild(zoneDiv);
      }
    }
  };

  const createSplitZone = (zonePrefix: string, slotTypes: string[]) => {
    if (equipment) {
      const leftSlots: typeof equipment.slots = [];
      const rightSlots: typeof equipment.slots = [];

      slotTypes.forEach((type) => {
        const slotsOfType = equipment.slots.filter((s) => s.slotType === type);
        slotsOfType.forEach((slot, index) => {
          if (index % 2 === 0) leftSlots.push(slot);
          else rightSlots.push(slot);
        });
      });

      if (leftSlots.length > 0) {
        const leftDiv = document.createElement('div');
        leftDiv.className = `paperdoll-zone zone-${zonePrefix}-left`;
        leftSlots.forEach((slot) => {
          leftDiv.appendChild(renderEquipSlot(slot.slotType, slot.equippedItem));
        });
        paperdoll.appendChild(leftDiv);
      }

      if (rightSlots.length > 0) {
        const rightDiv = document.createElement('div');
        rightDiv.className = `paperdoll-zone zone-${zonePrefix}-right`;
        rightSlots.forEach((slot) => {
          rightDiv.appendChild(renderEquipSlot(slot.slotType, slot.equippedItem));
        });
        paperdoll.appendChild(rightDiv);
      }
    }
  };

  createZone('head', ['head', 'neck']);
  createZone('torso', ['torso', 'back']);
  createSplitZone('arms', ['arm', 'hand', 'finger']);
  createZone('legs', ['leg', 'foot']);

  equipPanel.appendChild(paperdoll);

  // --- Backpack Panel (Grid Layout) ---
  const gridContainer = document.createElement('div');
  gridContainer.className = 'inventory-grid';

  for (let i = 0; i < effectiveCapacity; i++) {
    const itemEntityId = inventory.items[i];

    const slotDiv = document.createElement('div');
    slotDiv.className = 'inv-grid-slot';

    // Add label for hotkey
    if (i < 26) {
      const label = document.createElement('span');
      label.className = 'inv-grid-label';
      label.textContent = String.fromCharCode(97 + i);
      slotDiv.appendChild(label);
    }

    if (itemEntityId !== undefined) {
      // It has an item
      const isEquipped = equipment?.slots.some((s) => s.equippedItem === itemEntityId) ?? false;
      if (isEquipped) {
        slotDiv.classList.add('inv-equipped-grid');
      }

      const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
      if (itemComp) {
        const isIdentified = state.identifiedItems.has(itemComp.itemId);
        const def = state.campaign.items[itemComp.itemId];
        const displayName = isIdentified
          ? def?.name
          : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? def?.unidentifiedName ?? itemComp.itemId);

        const renderable = getComponent(state, itemEntityId, ComponentType.Renderable);
        const icon = document.createElement('span');
        icon.className = 'inv-item-icon';
        if (displayName) {
          icon.textContent = displayName.substring(0, 3);
          icon.style.fontSize = '0.7rem';
        } else {
          icon.textContent = renderable ? renderable.glyph : '?';
        }
        icon.style.color = renderable ? renderable.fg : '#fff';

        slotDiv.appendChild(icon);

        slotDiv.dataset.tooltipType = UITooltipType.Item;
        slotDiv.dataset.tooltipId = itemEntityId.toString();
      }
    } else {
      slotDiv.classList.add('inv-grid-empty');
    }

    gridContainer.appendChild(slotDiv);
  }

  packPanel.appendChild(gridContainer);
}
