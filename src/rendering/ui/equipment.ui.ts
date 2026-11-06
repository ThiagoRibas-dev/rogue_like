/**
 * @file Interactive Anatomical Paper Doll Slot Card and Grid Component (Milestone 118).
 * Renders universal anatomical slots (Head, Eyes, Neck, Shoulders, Torso, Body/Armor, Waist,
 * Wrists, Hands, Rings, Feet, Main Hand, Off Hand, plus extra limbs for marilith/quadruped).
 */

import { createUnequipItemAction } from '../../actions/inventory.actions.ts';
import { UITooltipType } from '../../constants/ui.constants.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type ItemComponent,
  type RenderableComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

/**
 * Standard slot display configuration with semantic icons and 4-char abbreviation tags.
 */
interface SlotMeta {
  readonly icon: string;
  readonly label: string;
}

const SLOT_META: Record<string, SlotMeta> = {
  head: { icon: '👑', label: 'HEAD' },
  eyes: { icon: '👓', label: 'EYES' },
  neck: { icon: '📿', label: 'NECK' },
  shoulders: { icon: '🧣', label: 'SHLD' },
  torso: { icon: '🦺', label: 'TORS' },
  body: { icon: '🥋', label: 'BODY' },
  waist: { icon: '🎗', label: 'WAIS' },
  arms: { icon: '🧤', label: 'ARMS' },
  wrists: { icon: '⌚', label: 'WRIS' },
  hands: { icon: '🥊', label: 'HAND' },
  ring_1: { icon: '💍', label: 'RNG1' },
  ring_2: { icon: '💎', label: 'RNG2' },
  feet: { icon: '👢', label: 'FEET' },
  main_hand: { icon: '⚔', label: 'MAIN' },
  off_hand: { icon: '🛡', label: 'OFFH' }
};

/**
 * Resolves the display name of an item entity.
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
 * Renders an anatomical paper doll grid into a container element.
 *
 * @param container Target DOM element.
 * @param state The current GameState.
 * @param entityId Target entity ID (usually player).
 * @param options Display options: compact (for HUD) vs full (for Character Sheet / Inventory).
 */
export function renderAnatomicalPaperDoll(
  container: HTMLElement,
  state: GameState,
  entityId: EntityId,
  options?: { readonly compact?: boolean | undefined }
): void {
  container.replaceChildren();

  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!equipment) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'status-empty';
    emptyMsg.textContent = 'No anatomical equipment slots.';
    container.appendChild(emptyMsg);
    return;
  }

  const isCompact = options?.compact === true;
  const grid = document.createElement('div');
  grid.className = isCompact ? 'mini-paperdoll-grid' : 'anatomical-paperdoll-full-grid';

  for (const slot of equipment.slots) {
    const meta = SLOT_META[slot.slotType] ?? {
      icon: '📦',
      label: slot.slotType.slice(0, 4).toUpperCase()
    };

    const card = document.createElement('button');
    card.type = 'button';
    card.className = slot.equippedItem !== null ? 'paperdoll-slot-card equipped' : 'paperdoll-slot-card empty';

    const header = document.createElement('div');
    header.className = 'slot-card-header';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'slot-card-icon';
    iconSpan.textContent = meta.icon;
    header.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'slot-card-label';
    labelSpan.textContent = meta.label;
    header.appendChild(labelSpan);

    card.appendChild(header);

    if (slot.equippedItem !== null) {
      const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
      const renderable = getComponent(state, slot.equippedItem, ComponentType.Renderable) as
        RenderableComponent | undefined;

      const body = document.createElement('div');
      body.className = 'slot-card-body';

      if (renderable) {
        const glyph = document.createElement('span');
        glyph.className = 'slot-item-glyph';
        glyph.textContent = renderable.glyph;
        if (renderable.fg) glyph.style.color = renderable.fg;
        body.appendChild(glyph);
      }

      const itemName = document.createElement('span');
      itemName.className = 'slot-item-name';
      itemName.textContent = itemComp ? resolveItemDisplayName(state, itemComp) : 'Equipped Item';
      body.appendChild(itemName);

      card.appendChild(body);

      card.dataset.tooltipType = UITooltipType.Item;
      card.dataset.tooltipId = slot.equippedItem.toString();
      card.title = 'Click to unequip item';
      card.addEventListener('click', () => {
        queuePlayerIntent(createUnequipItemAction(entityId, slot.id));
      });
    } else {
      const emptyIndicator = document.createElement('div');
      emptyIndicator.className = 'slot-card-empty';
      emptyIndicator.textContent = '—';
      card.appendChild(emptyIndicator);
    }

    grid.appendChild(card);
  }

  container.appendChild(grid);
}
