import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { getEffectiveCapacity } from '../../systems/inventory.system.ts';
import { UITooltipType } from '../../constants/ui.constants.ts';
import { getActiveCartridgeUI } from './cartridge_ui_registry.ts';
import { renderAnatomicalPaperDoll } from './equipment.ui.ts';

/**
 * Renders or hides the inventory panel overlay based on the current UIMode.
 * When open, delegates to the active cartridge's unified Master Dossier if registered,
 * or falls back to the split-view paperdoll backpack.
 * @param state The current GameState.
 */
export function renderInventoryPanel(state: GameState): void {
  const cartridgeUI = getActiveCartridgeUI(state);
  const sheetModal = cartridgeUI?.modals['character_sheet'] ?? cartridgeUI?.modals['inventory'];

  if (state.uiMode === UIMode.Inventory && sheetModal) {
    const overlayEl = document.getElementById(sheetModal.overlayElementId ?? 'dnd35e-sheet-overlay');
    if (overlayEl) {
      overlayEl.classList.remove('hidden');
    }
    sheetModal.render(state);
    return;
  }

  const overlay = document.getElementById('inventory-overlay');
  const equipPanel = document.getElementById('equipment-panel');
  const packPanel = document.getElementById('backpack-panel');
  if (!overlay || !equipPanel || !packPanel) return;

  if (state.uiMode !== UIMode.Inventory) {
    overlay.classList.add('hidden');
    equipPanel.replaceChildren();
    packPanel.replaceChildren();
    return;
  }

  overlay.classList.remove('hidden');
  equipPanel.replaceChildren();
  packPanel.replaceChildren();

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
  renderAnatomicalPaperDoll(paperdoll, state, playerEntityId, { compact: false });
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
