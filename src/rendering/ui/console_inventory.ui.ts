import type { UIAnatomicalSlotDescriptor, UIInventoryItem } from '../../types/ui_adapter.types.ts';

export interface ConsoleInventoryCallbacks {
  readonly onEquipItem?: (itemId: string, slotId: string, item?: UIInventoryItem) => void;
  readonly onUnequipItem?: (slotId: string, item?: UIInventoryItem) => void;
  readonly onUseItem?: (itemId: string, item?: UIInventoryItem) => void;
  readonly onHoverItem?: (item: UIInventoryItem | null, event: MouseEvent) => void;
  readonly onSelectWeaponSet?: (setIndex: number) => void;
}

export interface ConsoleInventoryData {
  readonly equippedSlots: Readonly<Record<string, UIInventoryItem | null>>;
  readonly anatomicalSlots?: ReadonlyArray<UIAnatomicalSlotDescriptor> | undefined;
  readonly morphologyLabel?: string | undefined;
  readonly avatarGlyph?: string | undefined;
  readonly activeWeaponSetIndex: number;
  readonly stashItems: ReadonlyArray<UIInventoryItem>;
  readonly currentWeightLbs: number;
  readonly maxWeightLbs: number;
  readonly goldCurrency: number;
}

type CategoryFilter = 'all' | 'weapon' | 'armor' | 'consumable' | 'accessory' | 'quest';
type SortOption = 'slot_asc' | 'price_desc' | 'name_asc' | 'weight_asc';

let activeCategory: CategoryFilter = 'all';
let activeSort: SortOption = 'slot_asc';

const WEAPON_SET_LABELS: ReadonlyArray<string> = ['I', 'II', 'III', 'IV'];
const COMPACT_STASH_COLS = 5;
const COMPACT_STASH_MIN_ROWS = 4;
const MEDIUM_LOAD_RATIO = 0.33;
const PERCENT_SCALE = 100;

const DEFAULT_HUMANOID_TUPLES: ReadonlyArray<readonly [string, string, string, string, 'left' | 'right']> = [
  ['head', 'head', 'Head', '🪖', 'left'],
  ['cloak', 'shoulders', 'Cloak', '🧥', 'left'],
  ['ring_1', 'ring', 'Ring 1', '💍', 'left'],
  ['hands', 'hands', 'Gloves', '🧤', 'left'],
  ['main_hand', 'main_hand', 'Main Hand', '⚔️', 'left'],
  ['ammo', 'ranged', 'Ammo', '🏹', 'left'],
  ['neck', 'neck', 'Neck', '📿', 'right'],
  ['torso', 'torso', 'Armor', '🛡️', 'right'],
  ['waist', 'waist', 'Belt', '🎗️', 'right'],
  ['ring_2', 'ring', 'Ring 2', '💍', 'right'],
  ['feet', 'feet', 'Boots', '🥾', 'right'],
  ['off_hand', 'off_hand', 'Off Hand', '🗡️', 'right']
];

const DEFAULT_HUMANOID_SPEC: ReadonlyArray<Omit<UIAnatomicalSlotDescriptor, 'equippedItem'>> =
  DEFAULT_HUMANOID_TUPLES.map(([slotId, slotType, label, emptyGlyph, rail]) => ({
    slotId,
    slotType,
    label,
    emptyGlyph,
    rail
  }));

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  textContent?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function createSlotElement(slot: UIAnatomicalSlotDescriptor, callbacks: ConsoleInventoryCallbacks): HTMLElement {
  const equipped = slot.equippedItem;
  const classes = ['crpg-pd-slot'];
  if (equipped) classes.push('equipped');
  if (slot.suppressed) classes.push('suppressed');
  if (slot.occupiedBySlotId) classes.push('grip-locked');
  if (slot.isExtraLimb) classes.push('extra-limb');
  const box = createEl('div', classes.join(' '));
  box.title = slot.suppressed
    ? `${slot.label}: Melded / Suppressed`
    : slot.occupiedBySlotId
      ? `${slot.label}: 2H Grip (${slot.occupiedBySlotId})`
      : equipped
        ? `${slot.label}: ${equipped.name}`
        : `${slot.label} (${slot.slotType})`;

  box.addEventListener('mouseenter', (e) => callbacks.onHoverItem?.(equipped, e));
  box.addEventListener('mouseleave', (e) => callbacks.onHoverItem?.(null, e));
  box.addEventListener('click', () => {
    if (equipped && !slot.suppressed) callbacks.onUnequipItem?.(slot.slotId, equipped);
  });

  box.append(
    createEl('span', 'crpg-pd-slot-icon', slot.suppressed ? '🔒' : (equipped?.iconUrl ?? slot.emptyGlyph)),
    createEl('span', 'crpg-pd-slot-caption', equipped ? equipped.name : slot.label)
  );

  if (slot.suppressed || slot.occupiedBySlotId || slot.isExtraLimb) {
    const label = slot.suppressed ? 'Melded' : slot.occupiedBySlotId ? '2H Grip' : '+Limb';
    box.appendChild(createEl('span', 'crpg-pd-slot-status', label));
  }
  return box;
}

/**
 * Renders the reactive Anatomical Paper Doll widget.
 */
export function renderReactivePaperDollWidget(
  container: HTMLElement,
  data: ConsoleInventoryData,
  callbacks: ConsoleInventoryCallbacks
): void {
  const slots: ReadonlyArray<UIAnatomicalSlotDescriptor> =
    data.anatomicalSlots && data.anatomicalSlots.length > 0
      ? data.anatomicalSlots
      : DEFAULT_HUMANOID_SPEC.map((s) => ({ ...s, equippedItem: data.equippedSlots[s.slotId] ?? null }));

  const wrap = createEl('div', 'crpg-paperdoll-widget');
  const pdBody = createEl('div', 'crpg-paperdoll-body');
  const leftCol = createEl('div', 'crpg-pd-slot-col');
  for (const s of slots.filter((x) => x.rail === 'left')) leftCol.appendChild(createSlotElement(s, callbacks));

  const arch = createEl('div', 'crpg-paperdoll-arch');
  const avatarStage = createEl('div', 'crpg-avatar-stage');
  const extraLimbs = slots.filter((x) => x.rail === 'extra');
  const glyph = data.avatarGlyph ?? (extraLimbs.length >= 3 ? '🐍' : slots.some((x) => x.suppressed) ? '🐺' : '🤺');
  avatarStage.appendChild(createEl('div', 'crpg-avatar-silhouette', glyph));

  const bottomStrip = createEl('div', 'crpg-pd-bottom-strip');
  const wsetRow = createEl('div', 'crpg-weapon-sets-row');
  WEAPON_SET_LABELS.forEach((roman, idx) => {
    const setIdx = idx + 1;
    const cls = data.activeWeaponSetIndex === setIdx ? 'crpg-wset-btn active' : 'crpg-wset-btn';
    const btn = createEl('button', cls, `Set ${roman}`);
    btn.type = 'button';
    btn.addEventListener('click', () => callbacks.onSelectWeaponSet?.(setIdx));
    wsetRow.appendChild(btn);
  });
  bottomStrip.appendChild(wsetRow);
  arch.append(avatarStage, bottomStrip);

  const rightCol = createEl('div', 'crpg-pd-slot-col');
  for (const s of slots.filter((x) => x.rail === 'right')) rightCol.appendChild(createSlotElement(s, callbacks));

  pdBody.append(leftCol, arch, rightCol);
  wrap.appendChild(pdBody);

  if (extraLimbs.length > 0) {
    const extraDrawer = createEl('div', 'crpg-extra-limbs-drawer');
    const extraGrid = createEl('div', 'crpg-extra-limbs-grid');
    for (const s of extraLimbs) extraGrid.appendChild(createSlotElement(s, callbacks));
    extraDrawer.append(
      createEl('div', 'crpg-extra-limbs-title', `Extra Anatomy & Multi-Limb Slots (${extraLimbs.length})`),
      extraGrid
    );
    wrap.appendChild(extraDrawer);
  }

  const encBox = createEl('div', 'crpg-encumbrance-box');
  const maxW = Math.max(1, data.maxWeightLbs);
  const pct = Math.min(PERCENT_SCALE, Math.round((data.currentWeightLbs / maxW) * PERCENT_SCALE));
  const ticks = createEl('div', 'crpg-encumbrance-ticks');
  for (const txt of [
    `Light (${data.currentWeightLbs.toFixed(1)} lbs)`,
    `${Math.round(maxW * MEDIUM_LOAD_RATIO)} lbs`,
    `Max ${maxW.toFixed(0)} lbs`
  ]) {
    ticks.appendChild(createEl('span', '', txt));
  }
  const track = createEl('div', 'crpg-encumbrance-track');
  const fill = createEl('div', 'crpg-encumbrance-fill');
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  encBox.append(ticks, track);
  wrap.appendChild(encBox);
  container.appendChild(wrap);
}

/** Renders the uniform 5-column scrollable Shared Stash / Backpack grid widget. */
export function renderCompactStashWidget(
  container: HTMLElement,
  data: ConsoleInventoryData,
  callbacks: ConsoleInventoryCallbacks
): void {
  const wrap = createEl('div', 'crpg-compact-stash-widget');
  const toolbar = createEl('div', 'crpg-stash-toolbar-inline');
  const catRow = createEl('div', 'crpg-stash-filter-row');
  const categories: ReadonlyArray<readonly [CategoryFilter, string, string]> = [
    ['all', '✦', 'All Items'],
    ['weapon', '⚔️', 'Weapons'],
    ['armor', '🛡️', 'Armor & Shields'],
    ['accessory', '💍', 'Rings, Cloaks & Amulets'],
    ['consumable', '🧪', 'Potions & Scrolls'],
    ['quest', '🗝️', 'Quest & Misc']
  ];
  for (const [catId, icon, title] of categories) {
    const pill = createEl('button', activeCategory === catId ? 'crpg-cat-pill active' : 'crpg-cat-pill', icon);
    pill.type = 'button';
    pill.title = title;
    pill.addEventListener('click', () => {
      activeCategory = catId;
      const holder = document.createElement('div');
      renderCompactStashWidget(holder, data, callbacks);
      wrap.replaceWith(holder.firstElementChild ?? holder);
    });
    catRow.appendChild(pill);
  }

  const sortSelect = createEl('select', 'crpg-sort-select');
  const sortOptions: ReadonlyArray<readonly [SortOption, string]> = [
    ['slot_asc', 'Slot [a–z]'],
    ['price_desc', 'Value ↓'],
    ['name_asc', 'Name A–Z'],
    ['weight_asc', 'Weight ↑']
  ];
  for (const [optId, label] of sortOptions) {
    const el = createEl('option', '', label);
    el.value = optId;
    el.selected = optId === activeSort;
    sortSelect.appendChild(el);
  }
  sortSelect.addEventListener('change', () => {
    activeSort = sortSelect.value as SortOption;
    const holder = document.createElement('div');
    renderCompactStashWidget(holder, data, callbacks);
    wrap.replaceWith(holder.firstElementChild ?? holder);
  });
  toolbar.append(catRow, sortSelect);
  wrap.appendChild(toolbar);

  const filtered = data.stashItems
    .filter((item) =>
      activeCategory === 'all'
        ? true
        : activeCategory === 'quest'
          ? item.category === 'quest' || item.category === 'misc'
          : item.category === activeCategory
    )
    .slice()
    .sort((a, b) =>
      activeSort === 'slot_asc'
        ? (a.inventoryIndex ?? Number.MAX_SAFE_INTEGER) - (b.inventoryIndex ?? Number.MAX_SAFE_INTEGER)
        : activeSort === 'price_desc'
          ? b.priceGp - a.priceGp
          : activeSort === 'name_asc'
            ? a.name.localeCompare(b.name)
            : a.weightLbs - b.weightLbs
    );

  const matrix = createEl('div', 'crpg-stash-matrix-compact');
  const totalRows = Math.max(
    COMPACT_STASH_MIN_ROWS,
    Math.ceil((filtered.length + COMPACT_STASH_COLS) / COMPACT_STASH_COLS)
  );
  const cellTotal = totalRows * COMPACT_STASH_COLS;
  for (let i = 0; i < cellTotal; i++) {
    const item = filtered[i];
    const cell = createEl('div', item ? 'crpg-stash-cell occupied' : 'crpg-stash-cell');
    if (item) {
      cell.title = item.hotkeyLabel
        ? `[${item.hotkeyLabel}] ${item.name} (${item.category === 'consumable' ? 'Click or press key to Use' : 'Click to Equip, Alt+Key to Equip, Shift+Key to Drop'})`
        : item.name;
      cell.addEventListener('mouseenter', (e) => callbacks.onHoverItem?.(item, e));
      cell.addEventListener('mouseleave', (e) => callbacks.onHoverItem?.(null, e));
      cell.addEventListener('click', () => {
        if (item.category === 'consumable') callbacks.onUseItem?.(item.id, item);
        else callbacks.onEquipItem?.(item.id, item.category, item);
      });
      if (item.hotkeyLabel) {
        cell.appendChild(createEl('span', 'crpg-cell-hotkey', `[${item.hotkeyLabel}]`));
      }
      cell.append(
        createEl('span', 'crpg-cell-action', item.category === 'consumable' ? 'USE' : 'EQP'),
        createEl('span', 'crpg-cell-icon', item.iconUrl ?? '📦'),
        createEl('span', 'crpg-cell-name', item.name)
      );
      if (item.quantity > 1) {
        cell.appendChild(createEl('span', 'crpg-cell-qty', `${item.quantity}`));
      }
    }
    matrix.appendChild(cell);
  }
  wrap.appendChild(matrix);

  const footer = createEl('div', 'crpg-stash-footer');
  footer.append(
    createEl('span', '', `Carried: ${data.currentWeightLbs.toFixed(1)} / ${data.maxWeightLbs.toFixed(1)} lbs`),
    createEl('span', 'crpg-gold-Readout', `${data.goldCurrency.toLocaleString()} gp 🪙`)
  );
  wrap.appendChild(footer);
  container.appendChild(wrap);
}

export function renderConsoleInventoryView(
  container: HTMLElement,
  data: ConsoleInventoryData,
  callbacks: ConsoleInventoryCallbacks
): void {
  container.replaceChildren();
  const pdCol = createEl('div', 'crpg-col-pane');
  renderReactivePaperDollWidget(pdCol, data, callbacks);
  const stashCol = createEl('div', 'crpg-col-pane');
  renderCompactStashWidget(stashCol, data, callbacks);
  container.append(pdCol, stashCol);
}
