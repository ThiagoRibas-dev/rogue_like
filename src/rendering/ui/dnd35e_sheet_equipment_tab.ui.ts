/**
 * @file D&D 3.5e Character Sheet Column 3:
 * Reactive Paper Doll Equipment and Uniform 5-Column Backpack Stash Grid.
 */

import { createApplyAction } from '../../actions/interaction.actions.ts';
import { createEquipItemAction, createUnequipItemAction } from '../../actions/inventory.actions.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { DnD35UIAdapter } from '../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { UIInventoryModel } from '../../types/ui_adapter.types.ts';
import { hideConsoleItemInspectCard, showConsoleItemInspectCard } from './console_inspect_card.ui.ts';
import { renderCompactStashWidget, renderReactivePaperDollWidget } from './console_inventory.ui.ts';

const dndAdapter = new DnD35UIAdapter();
let activeWeaponSet = 1;

/**
 * Renders Column 3 (Right Column): Reactive Paper Doll and Uniform 5-Column Backpack Grid.
 */
export function renderSheetEquipmentTab(
  container: HTMLElement,
  state: GameState,
  playerId: EntityId,
  preInvData?: UIInventoryModel
): void {
  const col = document.createElement('div');
  col.className = 'crpg-col-pane crpg-sheet-col-equipment-backpack';

  const invData = preInvData ?? dndAdapter.getInventoryData({ state, entityId: playerId });

  // 1. Reactive Anatomical Paper Doll
  const eqHeader = document.createElement('div');
  eqHeader.className = 'crpg-subbanner';
  eqHeader.textContent = 'EQUIPMENT';
  col.appendChild(eqHeader);

  const pdHost = document.createElement('div');
  pdHost.className = 'crpg-paperdoll-section';
  renderReactivePaperDollWidget(
    pdHost,
    {
      ...invData,
      activeWeaponSetIndex: activeWeaponSet
    },
    {
      onHoverItem: (item, event) => {
        if (item?.inspectData) showConsoleItemInspectCard(item.inspectData, event);
        else hideConsoleItemInspectCard();
      },
      onUnequipItem: (slotId) => {
        queuePlayerIntent(createUnequipItemAction(playerId, slotId));
        markAllDomainsDirty();
      },
      onSelectWeaponSet: (idx) => {
        activeWeaponSet = idx;
      }
    }
  );
  col.appendChild(pdHost);

  // 2. Uniform 5-Column Backpack & Stash Grid
  const bpHeader = document.createElement('div');
  bpHeader.className = 'crpg-subbanner';
  bpHeader.textContent = 'BACKPACK';
  col.appendChild(bpHeader);

  const stashHost = document.createElement('div');
  stashHost.className = 'crpg-backpack-stash-section';

  renderCompactStashWidget(stashHost, invData, {
    onHoverItem: (item, event) => {
      if (item?.inspectData) showConsoleItemInspectCard(item.inspectData, event);
      else hideConsoleItemInspectCard();
    },
    onEquipItem: (_itemId, _slotId, item) => {
      if (item?.inventoryIndex !== undefined) {
        queuePlayerIntent(createEquipItemAction(playerId, item.inventoryIndex));
        markAllDomainsDirty();
      }
    },
    onUseItem: (_itemId, item) => {
      if (item?.entityId !== undefined) {
        queuePlayerIntent(
          createApplyAction(playerId, 'apply', { type: 'item', itemEntityId: item.entityId as EntityId })
        );
        markAllDomainsDirty();
      }
    }
  });
  col.appendChild(stashHost);

  container.appendChild(col);
}
