/**
 * @file Always-visible HUD mini paper-doll and 5-slot quick-use belt (`[1]-[5]`).
 * Dispatches standard equip/unequip/apply intents via the buffered InputCommandQueue.
 */

import { createApplyAction } from '../../actions/interaction.actions.ts';
import { createToggleInventoryAction, createUnequipItemAction } from '../../actions/inventory.actions.ts';
import { QUICK_BELT_SLOT_COUNT, UITooltipType } from '../../constants/ui.constants.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent,
  type RenderableComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

/**
 * Resolves the player-facing display name of an item entity.
 */
function resolveItemDisplayName(state: GameState, itemComp: ItemComponent): string {
  const def = state.campaign.items[itemComp.itemId];
  const isIdentified = state.identifiedItems.has(itemComp.itemId);
  if (isIdentified && def?.name) {
    return def.name;
  }
  return state.itemUnidentifiedNames.get(itemComp.itemId) ?? def?.unidentifiedName ?? def?.name ?? itemComp.itemId;
}

/**
 * Collects up to `QUICK_BELT_SLOT_COUNT` unequipped consumable, zappable, or throwable items from the player's inventory.
 *
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId.
 * @returns Array of item EntityIds mapped to quick-belt slots `[1]-[5]`.
 */
export function getQuickBeltItems(state: GameState, playerEntityId: EntityId): ReadonlyArray<EntityId> {
  const inventory = getComponent(state, playerEntityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equipment = getComponent(state, playerEntityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!inventory) return [];

  const equippedIds = new Set<EntityId>();
  if (equipment) {
    for (const slot of equipment.slots) {
      if (slot.equippedItem !== null) {
        equippedIds.add(slot.equippedItem);
      }
    }
  }

  const beltItems: EntityId[] = [];
  for (const itemId of inventory.items) {
    if (beltItems.length >= QUICK_BELT_SLOT_COUNT) break;
    if (equippedIds.has(itemId)) continue;

    const itemComp = getComponent(state, itemId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const def = state.campaign.items[itemComp.itemId];
    if (!def) continue;

    if (def.category === 'consumable' || def.zappable || def.throwable || !def.equippable) {
      beltItems.push(itemId);
    }
  }

  return beltItems;
}

/**
 * Triggers the quick-belt item at 0-based index `beltIndex` (`0..4` corresponding to keys `1..5`).
 *
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId.
 * @param beltIndex Zero-based quick-belt slot index.
 * @returns True if an item was present and queued.
 */
export function triggerQuickBeltSlot(state: GameState, playerEntityId: EntityId, beltIndex: number): boolean {
  const beltItems = getQuickBeltItems(state, playerEntityId);
  const itemEntityId = beltItems[beltIndex];
  if (itemEntityId === undefined) return false;

  queuePlayerIntent(createApplyAction(playerEntityId, 'apply', { type: 'item', itemEntityId }));
  return true;
}

/**
 * Renders the compact Ultima/Dwarf Fortress mini paper-doll and quick-use consumable belt in the left HUD stack.
 *
 * @param state The current GameState.
 */
export function renderHudPaperdoll(state: GameState): void {
  const equipContainer = document.getElementById('hud-paperdoll-grid');
  const beltContainer = document.getElementById('hud-quickbelt-grid');
  if (!equipContainer && !beltContainer) return;

  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerEntityId === undefined) return;

  const equipment = getComponent(state, playerEntityId, ComponentType.Equipment) as EquipmentComponent | undefined;

  if (equipContainer) {
    equipContainer.replaceChildren();
    const slots = equipment?.slots ?? [];
    const equippedCount = slots.filter((s) => s.equippedItem !== null).length;
    const gearBadge = document.getElementById('edge-badge-gear');
    if (gearBadge) {
      gearBadge.textContent = `${equippedCount}/${slots.length || 5}`;
    }

    for (const slot of slots) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = slot.equippedItem !== null ? 'mini-doll-slot equipped' : 'mini-doll-slot empty';

      const slotTag = document.createElement('span');
      slotTag.className = 'mini-doll-tag';
      slotTag.textContent = slot.slotType.slice(0, 4).toUpperCase();
      cell.appendChild(slotTag);

      if (slot.equippedItem !== null) {
        const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
        const renderable = getComponent(state, slot.equippedItem, ComponentType.Renderable) as
          RenderableComponent | undefined;

        const glyphSpan = document.createElement('span');
        glyphSpan.className = 'mini-doll-glyph';
        glyphSpan.textContent = renderable?.glyph ?? '/';
        if (renderable?.fg) {
          glyphSpan.style.color = renderable.fg;
        }
        cell.appendChild(glyphSpan);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'mini-doll-name';
        nameSpan.textContent = itemComp ? resolveItemDisplayName(state, itemComp) : 'Item';
        cell.appendChild(nameSpan);

        cell.dataset.tooltipType = UITooltipType.Item;
        cell.dataset.tooltipId = slot.equippedItem.toString();
        cell.title = 'Click to unequip';
        cell.addEventListener('click', () => {
          queuePlayerIntent(createUnequipItemAction(playerEntityId, slot.id));
        });
      } else {
        const emptySpan = document.createElement('span');
        emptySpan.className = 'mini-doll-empty';
        emptySpan.textContent = '·';
        cell.appendChild(emptySpan);
        cell.title = `${slot.slotType.toUpperCase()} — Click to open Inventory [I]`;
        cell.addEventListener('click', () => {
          queuePlayerIntent(createToggleInventoryAction(playerEntityId));
        });
      }

      equipContainer.appendChild(cell);
    }
  }

  if (beltContainer) {
    beltContainer.replaceChildren();
    const beltItems = getQuickBeltItems(state, playerEntityId);

    for (let i = 0; i < QUICK_BELT_SLOT_COUNT; i++) {
      const itemEntityId = beltItems[i];
      const slotBtn = document.createElement('button');
      slotBtn.type = 'button';
      slotBtn.className = itemEntityId !== undefined ? 'quickbelt-slot filled' : 'quickbelt-slot empty';

      const keyBadge = document.createElement('span');
      keyBadge.className = 'quickbelt-key';
      keyBadge.textContent = `${i + 1}`;
      slotBtn.appendChild(keyBadge);

      if (itemEntityId !== undefined) {
        const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
        const renderable = getComponent(state, itemEntityId, ComponentType.Renderable) as
          RenderableComponent | undefined;

        const glyphSpan = document.createElement('span');
        glyphSpan.className = 'quickbelt-glyph';
        glyphSpan.textContent = renderable?.glyph ?? '!';
        if (renderable?.fg) {
          glyphSpan.style.color = renderable.fg;
        }
        slotBtn.appendChild(glyphSpan);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'quickbelt-name';
        nameSpan.textContent = itemComp ? resolveItemDisplayName(state, itemComp) : 'Use';
        slotBtn.appendChild(nameSpan);

        slotBtn.dataset.tooltipType = UITooltipType.Item;
        slotBtn.dataset.tooltipId = itemEntityId.toString();
        slotBtn.addEventListener('click', () => {
          triggerQuickBeltSlot(state, playerEntityId, i);
        });
      } else {
        const dash = document.createElement('span');
        dash.className = 'quickbelt-empty-label';
        dash.textContent = 'Empty';
        slotBtn.appendChild(dash);
      }

      beltContainer.appendChild(slotBtn);
    }
  }
}
