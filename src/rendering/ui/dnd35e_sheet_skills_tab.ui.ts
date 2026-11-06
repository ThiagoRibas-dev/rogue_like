/**
 * @file D&D 3.5e Character Sheet Column 3 (Right Column):
 * Pen-and-Paper Skills Ledger (with active [Use] buttons) + Compact 36x36px Backpack & Stash Grid.
 */

import { createApplyAction } from '../../actions/interaction.actions.ts';
import { createEquipItemAction } from '../../actions/inventory.actions.ts';
import type { Verb } from '../../constants/verbs.constants.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import {
  DnD35UIAdapter,
  evaluateActorSkillCheck,
  getActorEverClassSkillIds,
  getDnD35EntityData,
  getDnD35SystemContent
} from '../../rulesets/registry.ts';
import { ComponentType, type EquipmentComponent, type InventoryComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { UIInventoryItem } from '../../types/ui_adapter.types.ts';
import { hideConsoleItemInspectCard, showConsoleItemInspectCard } from './console_inspect_card.ui.ts';
import { renderCompactStashWidget } from './console_inventory.ui.ts';

const NOMINAL_PREVIEW_DC = 10;
const ASCII_LOWERCASE_A = 97;
const MAX_HOTKEY_INDEX = 26;
const DEFAULT_GOLD_CURRENCY = 250;
const DEFAULT_ITEM_PRICE_GP = 20;
const DEFAULT_ITEM_WEIGHT_LBS = 1.0;
const DEFAULT_MAX_WEIGHT_LBS = 150;
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

function buildLiveStashItems(
  state: GameState,
  playerId: EntityId
): {
  readonly items: ReadonlyArray<UIInventoryItem>;
  readonly carriedLbs: number;
} {
  const inventory = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equipment = getComponent(state, playerId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const fallback = dndAdapter.getInventoryData({});
  if (!inventory || inventory.items.length === 0) {
    return { items: fallback.stashItems, carriedLbs: fallback.currentWeightLbs };
  }

  const uiItems: UIInventoryItem[] = [];
  let carriedLbs = 0;

  inventory.items.forEach((itemEntityId, idx) => {
    const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
    if (!itemComp) return;
    const def = state.campaign.items[itemComp.itemId];
    const name = def?.name ?? itemComp.itemId.replace(/_/g, ' ');
    const isEquipped = equipment?.slots.some((s) => s.equippedItem === itemEntityId) ?? false;
    const slot = def?.equippable?.slot ?? 'held';
    const isWeapon = def?.category === 'weapon' || slot === 'main_hand' || slot === 'off_hand' || slot === 'two_handed';
    const isArmor = def?.category === 'armor' || slot === 'torso' || slot === 'body';
    const isConsumable = def?.category === 'consumable' || def?.consumable !== undefined;
    const weight = def?.weight ?? DEFAULT_ITEM_WEIGHT_LBS;
    carriedLbs += weight;

    uiItems.push({
      id: `${itemComp.itemId}_${idx}`,
      entityId: itemEntityId,
      inventoryIndex: idx,
      ...(idx < MAX_HOTKEY_INDEX ? { hotkeyLabel: String.fromCharCode(ASCII_LOWERCASE_A + idx) } : {}),
      name,
      iconUrl: isWeapon ? '⚔️' : isArmor ? '🛡️' : isConsumable ? '🧪' : '📦',
      category: isWeapon ? 'weapon' : isArmor ? 'armor' : isConsumable ? 'consumable' : 'accessory',
      quantity: itemComp.charges ?? 1,
      priceGp: def?.baseValue ?? DEFAULT_ITEM_PRICE_GP,
      weightLbs: weight,
      isEquipped,
      inspectData: {
        title: `${name}${isEquipped ? ' (Equipped)' : ''}`,
        loreText: def?.description ?? 'Adventuring equipment.',
        baseMetrics: [
          ...(def?.equippable?.attackBonus ? [{ label: 'Attack Bonus', value: `+${def.equippable.attackBonus}` }] : []),
          ...(def?.equippable?.defenseBonus
            ? [{ label: 'Defense Bonus', value: `+${def.equippable.defenseBonus} AC` }]
            : []),
          { label: 'Weight', value: `${weight.toFixed(1)} lbs` }
        ],
        specialProperties: (def?.tags ?? []).map((t) => ({ text: `Property: ${t}`, colorHint: 'green' as const }))
      }
    });
  });

  for (const sc of fallback.stashItems) {
    if (!uiItems.some((u) => u.name === sc.name)) {
      uiItems.push(sc);
    }
  }

  return { items: uiItems, carriedLbs: Math.max(carriedLbs, fallback.currentWeightLbs) };
}

/**
 * Renders Column 3 (Right Column): Pen-and-Paper Skills Ledger + Compact 36x36px Backpack & Stash.
 */
export function renderSheetSkillsTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  const col = document.createElement('div');
  col.className = 'crpg-col-pane';

  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);

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
        renderSheetSkillsTab(holder, state, playerId);
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
  const primaryClassId = dndData.tracks[0]?.trackId ?? 'fighter';
  const everClassSkills = sys
    ? new Set(getActorEverClassSkillIds(dndData, primaryClassId, dndData.domains ?? [], sys))
    : new Set<string>();
  const skillsList = Object.values(sys?.skills ?? {});

  for (const skill of skillsList) {
    const ranks = dndData.skillRanks[skill.id] ?? 0;
    if (showTrainedOnly && ranks <= 0) continue;

    const { check } = evaluateActorSkillCheck(state, playerId, skill.id, NOMINAL_PREVIEW_DC);
    const totalBonus = check.totalModifier;
    const sign = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;
    const isClassSkill = everClassSkills.has(skill.id);

    const tr = document.createElement('tr');

    const csTd = document.createElement('td');
    csTd.className = 'crpg-skill-cs-dot';
    csTd.textContent = isClassSkill ? '■' : '□';
    csTd.title = isClassSkill ? 'Class Skill' : 'Cross-Class Skill';

    const nameTd = document.createElement('td');
    nameTd.className = 'crpg-skill-name-cell';
    nameTd.textContent = skill.name;

    const keyTd = document.createElement('td');
    keyTd.className = 'crpg-skill-ability-cell';
    keyTd.textContent = skill.keyAbility.toUpperCase();

    const totTd = document.createElement('td');
    totTd.className = 'crpg-skill-total-cell';
    totTd.textContent = sign;

    const rnkTd = document.createElement('td');
    rnkTd.className = 'crpg-skill-ranks-cell';
    rnkTd.textContent = `${ranks}`;

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

  // BOTTOM HALF: Compact 36x36px Shared Stash / Backpack Grid
  const stashHost = document.createElement('div');
  const { items, carriedLbs } = buildLiveStashItems(state, playerId);

  renderCompactStashWidget(
    stashHost,
    {
      equippedSlots: {},
      activeWeaponSetIndex: 1,
      stashItems: items,
      currentWeightLbs: carriedLbs,
      maxWeightLbs: DEFAULT_MAX_WEIGHT_LBS,
      goldCurrency: DEFAULT_GOLD_CURRENCY
    },
    {
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
    }
  );
  col.appendChild(stashHost);

  container.appendChild(col);
}
