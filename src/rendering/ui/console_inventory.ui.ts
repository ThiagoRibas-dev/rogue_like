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
type SortOption = 'price_desc' | 'name_asc' | 'weight_asc';

let activeCategory: CategoryFilter = 'all';
let activeSort: SortOption = 'price_desc';

const WEAPON_SET_LABELS: ReadonlyArray<string> = ['I', 'II', 'III', 'IV'];
const COMPACT_STASH_COLS = 10;
const COMPACT_STASH_MIN_CELLS = 40;
const MEDIUM_LOAD_RATIO = 0.33;
const PERCENT_SCALE = 100;

const DEFAULT_HUMANOID_SPEC: ReadonlyArray<Omit<UIAnatomicalSlotDescriptor, 'equippedItem'>> = [
  { slotId: 'head', slotType: 'head', label: 'Head', emptyGlyph: '🪖', rail: 'left' },
  { slotId: 'cloak', slotType: 'shoulders', label: 'Cloak', emptyGlyph: '🧥', rail: 'left' },
  { slotId: 'ring_1', slotType: 'ring', label: 'Ring 1', emptyGlyph: '💍', rail: 'left' },
  { slotId: 'hands', slotType: 'hands', label: 'Gloves', emptyGlyph: '🧤', rail: 'left' },
  { slotId: 'main_hand', slotType: 'main_hand', label: 'Main Hand', emptyGlyph: '⚔️', rail: 'left' },
  { slotId: 'ammo', slotType: 'ranged', label: 'Ammo', emptyGlyph: '🏹', rail: 'left' },
  { slotId: 'neck', slotType: 'neck', label: 'Neck', emptyGlyph: '📿', rail: 'right' },
  { slotId: 'torso', slotType: 'torso', label: 'Armor', emptyGlyph: '🛡️', rail: 'right' },
  { slotId: 'waist', slotType: 'waist', label: 'Belt', emptyGlyph: '🎗️', rail: 'right' },
  { slotId: 'ring_2', slotType: 'ring', label: 'Ring 2', emptyGlyph: '💍', rail: 'right' },
  { slotId: 'feet', slotType: 'feet', label: 'Boots', emptyGlyph: '🥾', rail: 'right' },
  { slotId: 'off_hand', slotType: 'off_hand', label: 'Off Hand', emptyGlyph: '🗡️', rail: 'right' }
];

function createSlotElement(slot: UIAnatomicalSlotDescriptor, callbacks: ConsoleInventoryCallbacks): HTMLElement {
  const equipped = slot.equippedItem;
  const box = document.createElement('div');
  const classes = ['crpg-pd-slot'];
  if (equipped) classes.push('equipped');
  if (slot.suppressed) classes.push('suppressed');
  if (slot.occupiedBySlotId) classes.push('grip-locked');
  if (slot.isExtraLimb) classes.push('extra-limb');
  box.className = classes.join(' ');
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

  const icon = document.createElement('span');
  icon.className = 'crpg-pd-slot-icon';
  icon.textContent = slot.suppressed ? '🔒' : (equipped?.iconUrl ?? slot.emptyGlyph);
  const caption = document.createElement('span');
  caption.className = 'crpg-pd-slot-caption';
  caption.textContent = equipped ? equipped.name : slot.label;
  box.append(icon, caption);

  if (slot.suppressed || slot.occupiedBySlotId || slot.isExtraLimb) {
    const status = document.createElement('span');
    status.className = 'crpg-pd-slot-status';
    status.textContent = slot.suppressed ? 'Melded' : slot.occupiedBySlotId ? '2H Grip' : '+Limb';
    box.appendChild(status);
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

  const wrap = document.createElement('div');
  wrap.className = 'crpg-paperdoll-widget';
  const pdBody = document.createElement('div');
  pdBody.className = 'crpg-paperdoll-body';

  const leftCol = document.createElement('div');
  leftCol.className = 'crpg-pd-slot-col';
  for (const s of slots.filter((x) => x.rail === 'left')) leftCol.appendChild(createSlotElement(s, callbacks));

  const arch = document.createElement('div');
  arch.className = 'crpg-paperdoll-arch';
  const avatarStage = document.createElement('div');
  avatarStage.className = 'crpg-avatar-stage';
  const figure = document.createElement('div');
  figure.className = 'crpg-avatar-silhouette';
  const extraLimbs = slots.filter((x) => x.rail === 'extra');
  figure.textContent =
    data.avatarGlyph ?? (extraLimbs.length >= 3 ? '🐍' : slots.some((x) => x.suppressed) ? '🐺' : '🤺');

  const mainWeapon = slots.find((x) => x.slotId === 'main_hand' || x.slotType === 'main_hand')?.equippedItem;
  const figureCap = document.createElement('div');
  figureCap.className = 'crpg-avatar-caption';
  figureCap.textContent = mainWeapon?.name ?? 'Unarmed';
  avatarStage.append(figure, figureCap);

  const bottomStrip = document.createElement('div');
  bottomStrip.className = 'crpg-pd-bottom-strip';
  const wsetRow = document.createElement('div');
  wsetRow.className = 'crpg-weapon-sets-row';
  WEAPON_SET_LABELS.forEach((roman, idx) => {
    const setIdx = idx + 1;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = data.activeWeaponSetIndex === setIdx ? 'crpg-wset-btn active' : 'crpg-wset-btn';
    btn.textContent = `Set ${roman}`;
    btn.addEventListener('click', () => callbacks.onSelectWeaponSet?.(setIdx));
    wsetRow.appendChild(btn);
  });
  bottomStrip.appendChild(wsetRow);
  arch.append(avatarStage, bottomStrip);

  const rightCol = document.createElement('div');
  rightCol.className = 'crpg-pd-slot-col';
  for (const s of slots.filter((x) => x.rail === 'right')) rightCol.appendChild(createSlotElement(s, callbacks));

  pdBody.append(leftCol, arch, rightCol);
  wrap.appendChild(pdBody);

  if (extraLimbs.length > 0) {
    const extraDrawer = document.createElement('div');
    extraDrawer.className = 'crpg-extra-limbs-drawer';
    const extraTitle = document.createElement('div');
    extraTitle.className = 'crpg-extra-limbs-title';
    extraTitle.textContent = `Extra Anatomy & Multi-Limb Slots (${extraLimbs.length})`;
    const extraGrid = document.createElement('div');
    extraGrid.className = 'crpg-extra-limbs-grid';
    for (const s of extraLimbs) extraGrid.appendChild(createSlotElement(s, callbacks));
    extraDrawer.append(extraTitle, extraGrid);
    wrap.appendChild(extraDrawer);
  }

  const encBox = document.createElement('div');
  encBox.className = 'crpg-encumbrance-box';
  const maxW = Math.max(1, data.maxWeightLbs);
  const pct = Math.min(PERCENT_SCALE, Math.round((data.currentWeightLbs / maxW) * PERCENT_SCALE));
  const ticks = document.createElement('div');
  ticks.className = 'crpg-encumbrance-ticks';
  for (const txt of [
    `Light (${data.currentWeightLbs.toFixed(1)} lbs)`,
    `${Math.round(maxW * MEDIUM_LOAD_RATIO)} lbs`,
    `Max ${maxW.toFixed(0)} lbs`
  ]) {
    const sp = document.createElement('span');
    sp.textContent = txt;
    ticks.appendChild(sp);
  }
  const track = document.createElement('div');
  track.className = 'crpg-encumbrance-track';
  const fill = document.createElement('div');
  fill.className = 'crpg-encumbrance-fill';
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  encBox.append(ticks, track);
  wrap.appendChild(encBox);
  container.appendChild(wrap);
}

/**
 * Renders the compact 10-column (`36x36px` sockets) Shared Stash / Backpack grid widget.
 */
export function renderCompactStashWidget(
  container: HTMLElement,
  data: ConsoleInventoryData,
  callbacks: ConsoleInventoryCallbacks
): void {
  const wrap = document.createElement('div');
  wrap.className = 'crpg-compact-stash-widget';
  const toolbar = document.createElement('div');
  toolbar.className = 'crpg-stash-toolbar-inline';

  const catRow = document.createElement('div');
  catRow.className = 'crpg-stash-filter-row';
  const categories: ReadonlyArray<{ id: CategoryFilter; icon: string; title: string }> = [
    { id: 'all', icon: '✦', title: 'All Items' },
    { id: 'weapon', icon: '⚔️', title: 'Weapons' },
    { id: 'armor', icon: '🛡️', title: 'Armor & Shields' },
    { id: 'accessory', icon: '💍', title: 'Rings, Cloaks & Amulets' },
    { id: 'consumable', icon: '🧪', title: 'Potions & Scrolls' },
    { id: 'quest', icon: '🗝️', title: 'Quest & Misc' }
  ];
  for (const cat of categories) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = activeCategory === cat.id ? 'crpg-cat-pill active' : 'crpg-cat-pill';
    pill.title = cat.title;
    pill.textContent = cat.icon;
    pill.addEventListener('click', () => {
      activeCategory = cat.id;
      const holder = document.createElement('div');
      renderCompactStashWidget(holder, data, callbacks);
      wrap.replaceWith(holder.firstElementChild ?? holder);
    });
    catRow.appendChild(pill);
  }

  const sortSelect = document.createElement('select');
  sortSelect.className = 'crpg-sort-select';
  for (const opt of [
    { id: 'price_desc', label: 'Value ↓' },
    { id: 'name_asc', label: 'Name A–Z' },
    { id: 'weight_asc', label: 'Weight ↑' }
  ] as const) {
    const el = document.createElement('option');
    el.value = opt.id;
    el.textContent = opt.label;
    el.selected = opt.id === activeSort;
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
      activeSort === 'price_desc'
        ? b.priceGp - a.priceGp
        : activeSort === 'name_asc'
          ? a.name.localeCompare(b.name)
          : a.weightLbs - b.weightLbs
    );

  const matrix = document.createElement('div');
  matrix.className = 'crpg-stash-matrix-compact';
  const cellTotal = Math.max(
    COMPACT_STASH_MIN_CELLS,
    Math.ceil(filtered.length / COMPACT_STASH_COLS) * COMPACT_STASH_COLS
  );
  for (let i = 0; i < cellTotal; i++) {
    const item = filtered[i];
    const cell = document.createElement('div');
    cell.className = item ? 'crpg-stash-cell occupied' : 'crpg-stash-cell';
    if (item) {
      cell.addEventListener('mouseenter', (e) => callbacks.onHoverItem?.(item, e));
      cell.addEventListener('mouseleave', (e) => callbacks.onHoverItem?.(null, e));
      cell.addEventListener('click', () => {
        if (item.category === 'consumable') callbacks.onUseItem?.(item.id, item);
        else callbacks.onEquipItem?.(item.id, item.category, item);
      });
      const iconSpan = document.createElement('span');
      iconSpan.className = 'crpg-cell-icon';
      iconSpan.textContent = item.iconUrl ?? '📦';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'crpg-cell-name';
      nameSpan.textContent = item.name;
      cell.append(iconSpan, nameSpan);
      if (item.quantity > 1) {
        const qtySpan = document.createElement('span');
        qtySpan.className = 'crpg-cell-qty';
        qtySpan.textContent = `${item.quantity}`;
        cell.appendChild(qtySpan);
      }
    }
    matrix.appendChild(cell);
  }
  wrap.appendChild(matrix);

  const footer = document.createElement('div');
  footer.className = 'crpg-stash-footer';
  const weightText = document.createElement('span');
  weightText.textContent = `Carried: ${data.currentWeightLbs.toFixed(1)} / ${data.maxWeightLbs.toFixed(1)} lbs`;
  const goldText = document.createElement('span');
  goldText.className = 'crpg-gold-Readout';
  goldText.textContent = `${data.goldCurrency.toLocaleString()} gp 🪙`;
  footer.append(weightText, goldText);
  wrap.appendChild(footer);
  container.appendChild(wrap);
}

export function renderConsoleInventoryView(
  container: HTMLElement,
  data: ConsoleInventoryData,
  callbacks: ConsoleInventoryCallbacks
): void {
  container.replaceChildren();
  const pdCol = document.createElement('div');
  pdCol.className = 'crpg-col-pane';
  renderReactivePaperDollWidget(pdCol, data, callbacks);
  const stashCol = document.createElement('div');
  stashCol.className = 'crpg-col-pane';
  renderCompactStashWidget(stashCol, data, callbacks);
  container.append(pdCol, stashCol);
}
