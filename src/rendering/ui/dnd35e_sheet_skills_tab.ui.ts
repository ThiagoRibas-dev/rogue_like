/**
 * @file D&D 3.5e Character Sheet Column 3 (Right Column):
 * Pen-and-Paper Skills Ledger (with active [Use] buttons) + Compact 36x36px Backpack & Stash Grid.
 */

import { createApplyAction } from '../../actions/interaction.actions.ts';
import { createEquipItemAction } from '../../actions/inventory.actions.ts';
import type { Verb } from '../../constants/verbs.constants.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { DnD35UIAdapter } from '../../rulesets/registry.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { UICharacterSheetModel, UIInventoryModel } from '../../types/ui_adapter.types.ts';
import { hideConsoleItemInspectCard, showConsoleItemInspectCard } from './console_inspect_card.ui.ts';
import { renderCompactStashWidget } from './console_inventory.ui.ts';

const dndAdapter = new DnD35UIAdapter();

let showTrainedOnly = false;

const ACTIVE_SKILL_VERBS: Readonly<Record<string, Verb>> = {
  search: 'search',
  open_lock: 'unlock',
  disable_device: 'disarm',
  heal: 'heal',
  intimidate: 'intimidate',
  diplomacy: 'persuade'
};

/**
 * Renders Column 3 (Right Column): Pen-and-Paper Skills Ledger + Compact 36x36px Backpack & Stash.
 */
export function renderSheetSkillsTab(
  container: HTMLElement,
  state: GameState,
  playerId: EntityId,
  preSheetModel?: UICharacterSheetModel,
  preInvData?: UIInventoryModel
): void {
  const col = document.createElement('div');
  col.className = 'crpg-col-pane';

  const sheetModel = preSheetModel ?? dndAdapter.getCharacterSheetData({ state, entityId: playerId });
  const invData = preInvData ?? dndAdapter.getInventoryData({ state, entityId: playerId });

  // TOP HALF: Pen-and-Paper Skills Ledger
  const skillHeaderBar = document.createElement('div');
  skillHeaderBar.className = 'crpg-skills-header-bar';

  const skillHeading = document.createElement('h3');
  skillHeading.className = 'crpg-section-heading';
  skillHeading.textContent = 'Pen & Paper Skills';
  skillHeaderBar.appendChild(skillHeading);

  const filterBtn = document.createElement('button');
  filterBtn.type = 'button';
  filterBtn.className = 'crpg-wset-btn active';
  filterBtn.textContent = showTrainedOnly ? 'Trained Only' : 'All Skills';
  filterBtn.addEventListener('click', () => {
    showTrainedOnly = !showTrainedOnly;
    col.replaceWith(
      (() => {
        const holder = document.createElement('div');
        renderSheetSkillsTab(holder, state, playerId, sheetModel, invData);
        return holder.firstElementChild ?? holder;
      })()
    );
  });
  skillHeaderBar.appendChild(filterBtn);
  col.appendChild(skillHeaderBar);

  const skillsWrap = document.createElement('div');
  skillsWrap.className = 'crpg-pnp-skills-wrap';

  const tbl = document.createElement('table');
  tbl.className = 'crpg-pnp-skills-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const h of ['CS', 'Skill Name', 'Key', 'Total', 'Rnks', 'Use']) {
    const th = document.createElement('th');
    th.textContent = h;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (const skill of sheetModel.skillRows ?? []) {
    if (showTrainedOnly && skill.ranks <= 0) continue;

    const totalBonus = skill.totalModifier;
    const sign = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;

    const tr = document.createElement('tr');

    const csTd = document.createElement('td');
    csTd.className = 'crpg-skill-cs-dot';
    csTd.textContent = skill.isClassSkill ? '■' : '□';
    csTd.title = skill.isClassSkill ? 'Class Skill' : 'Cross-Class Skill';

    const nameTd = document.createElement('td');
    nameTd.className = 'crpg-skill-name-cell';
    nameTd.textContent = skill.name;

    const keyTd = document.createElement('td');
    keyTd.className = 'crpg-skill-ability-cell';
    keyTd.textContent = skill.keyAbility;

    const totTd = document.createElement('td');
    totTd.className = 'crpg-skill-total-cell';
    totTd.textContent = sign;

    const rnkTd = document.createElement('td');
    rnkTd.className = 'crpg-skill-ranks-cell';
    rnkTd.textContent = `${skill.ranks}`;

    const useTd = document.createElement('td');
    useTd.className = 'crpg-skill-use-cell';
    const verb = ACTIVE_SKILL_VERBS[skill.id];
    if (verb !== undefined) {
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'crpg-skill-use-btn';
      useBtn.textContent = 'Use';
      useBtn.addEventListener('click', () => {
        queuePlayerIntent(createApplyAction(playerId, verb, { type: 'self' }));
        markAllDomainsDirty();
      });
      useTd.appendChild(useBtn);
    } else {
      useTd.textContent = '—';
    }

    tr.append(csTd, nameTd, keyTd, totTd, rnkTd, useTd);
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  skillsWrap.appendChild(tbl);
  col.appendChild(skillsWrap);

  // BOTTOM HALF: Compact 36x36px Shared Stash / Backpack Grid driven by live InventoryComponent
  const stashHost = document.createElement('div');

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
          createApplyAction(playerId, 'apply', { type: 'entity', entityId: item.entityId as EntityId })
        );
        markAllDomainsDirty();
      }
    }
  });
  col.appendChild(stashHost);

  container.appendChild(col);
}
