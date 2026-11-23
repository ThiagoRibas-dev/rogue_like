import type { JSX, TargetedMouseEvent } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { UIInventoryItem } from '../../../types/ui_adapter.types.ts';
import type { ConsoleInventoryData } from './PaperDollWidget.tsx';
import { Button } from '../primitives/Button.tsx';
import { Chip } from '../primitives/DataDisplay.tsx';
import { Select, type SelectOption } from '../primitives/FormControls.tsx';
import { GridNav } from '../primitives/GridNav.tsx';

type CategoryFilter = 'all' | 'weapon' | 'armor' | 'consumable' | 'accessory' | 'quest';
type SortOption = 'slot_asc' | 'price_desc' | 'name_asc' | 'weight_asc';

const COMPACT_STASH_COLS = 5;
const COMPACT_STASH_MIN_ROWS = 4;

const CATEGORY_OPTIONS: ReadonlyArray<readonly [CategoryFilter, string, string]> = [
  ['all', '✦', 'All Items'],
  ['weapon', '⚔️', 'Weapons'],
  ['armor', '🛡️', 'Armor & Shields'],
  ['accessory', '💍', 'Rings, Cloaks & Amulets'],
  ['consumable', '🧪', 'Potions & Scrolls'],
  ['quest', '🗝️', 'Quest & Misc']
];

const SORT_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'slot_asc', label: 'Slot [a–z]' },
  { value: 'price_desc', label: 'Value ↓' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'weight_asc', label: 'Weight ↑' }
];

/** Props for `<CompactStashWidget />`. */
export interface CompactStashWidgetProps {
  readonly data: ConsoleInventoryData;
  readonly onEquipItem?: ((itemId: string, slotId: string, item?: UIInventoryItem) => void) | undefined;
  readonly onUseItem?: ((itemId: string, item?: UIInventoryItem) => void) | undefined;
  readonly onDropItem?: ((itemId: string, item?: UIInventoryItem) => void) | undefined;
  readonly onInspectItem?: ((item: UIInventoryItem | null, clientX: number, clientY: number) => void) | undefined;
}

/**
 * 5-column keyboard-navigable Shared Stash / Backpack grid powered by `<GridNav />`.
 * Supports full 2D Arrow-key traversal beyond slot `#26`, category chips, sort dropdown,
 * `?` / `Alt+I` keyboard inspection, and explicit Equip/Use/Drop action buttons.
 */
export function CompactStashWidget({
  data,
  onEquipItem,
  onUseItem,
  onDropItem,
  onInspectItem
}: CompactStashWidgetProps): JSX.Element {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('slot_asc');
  const [focusedItem, setFocusedItem] = useState<UIInventoryItem | null>(null);

  const filtered = useMemo(() => {
    return data.stashItems
      .filter((item) =>
        category === 'all'
          ? true
          : category === 'quest'
            ? item.category === 'quest' || item.category === 'misc'
            : item.category === category
      )
      .slice()
      .sort((a, b) =>
        sortBy === 'slot_asc'
          ? (a.inventoryIndex ?? Number.MAX_SAFE_INTEGER) - (b.inventoryIndex ?? Number.MAX_SAFE_INTEGER)
          : sortBy === 'price_desc'
            ? b.priceGp - a.priceGp
            : sortBy === 'name_asc'
              ? a.name.localeCompare(b.name)
              : a.weightLbs - b.weightLbs
      );
  }, [data.stashItems, category, sortBy]);

  const totalRows = Math.max(
    COMPACT_STASH_MIN_ROWS,
    Math.ceil((filtered.length + COMPACT_STASH_COLS) / COMPACT_STASH_COLS)
  );
  const paddedCells: ReadonlyArray<UIInventoryItem | null> = Array.from(
    { length: totalRows * COMPACT_STASH_COLS },
    (_, idx) => filtered[idx] ?? null
  );

  const triggerPrimaryAction = (item: UIInventoryItem): void => {
    if (item.category === 'consumable') {
      onUseItem?.(item.id, item);
    } else {
      onEquipItem?.(item.id, item.category, item);
    }
  };

  const currencyLabel = data.currencyFormatted ?? data.goldCurrency.toLocaleString();

  return (
    <div className="ui-stash" aria-label="Backpack and Shared Stash">
      <div className="ui-stash-toolbar">
        <div className="ui-stash-filters" role="group" aria-label="Item category filter">
          {CATEGORY_OPTIONS.map(([catId, icon, label]) => (
            <Chip key={catId} active={category === catId} title={label} onClick={(): void => setCategory(catId)}>
              {icon}
            </Chip>
          ))}
        </div>
        <Select
          ariaLabel="Sort backpack items"
          value={sortBy}
          options={SORT_OPTIONS}
          onChange={(val): void => setSortBy(val as SortOption)}
        />
      </div>

      <GridNav
        className="ui-stash-grid"
        items={paddedCells}
        columns={COMPACT_STASH_COLS}
        ariaLabel="Backpack item grid"
        getKey={(item, idx): string => (item ? `${item.id}_${idx}` : `empty_${idx}`)}
        onFocusItem={(item): void => setFocusedItem(item)}
        onActivate={(item): void => {
          if (item) {
            setFocusedItem(item);
            triggerPrimaryAction(item);
          }
        }}
        onInspectItem={(item): void => {
          if (item && onInspectItem) {
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
            const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
            onInspectItem(item, Math.round(vw * 0.5), Math.round(vh * 0.35));
          }
        }}
        renderItem={(item): JSX.Element => {
          const title = item
            ? item.hotkeyLabel
              ? `[${item.hotkeyLabel}] ${item.name} (${item.category === 'consumable' ? 'Enter/Click to Use' : 'Enter/Click to Equip'}, ? to Examine)`
              : `${item.name} (? to Examine)`
            : 'Empty backpack slot';

          return (
            <div
              className="ui-stash-cell"
              data-occupied={item ? 'true' : undefined}
              title={title}
              onMouseEnter={(e: TargetedMouseEvent<HTMLDivElement>): void => {
                if (item) {
                  setFocusedItem(item);
                  onInspectItem?.(item, e.clientX, e.clientY);
                }
              }}
              onMouseLeave={(): void => onInspectItem?.(null, 0, 0)}
            >
              {item ? (
                <>
                  {item.hotkeyLabel ? <span className="ui-stash-cell__hotkey">{`[${item.hotkeyLabel}]`}</span> : null}
                  <span className="ui-stash-cell__icon" aria-hidden="true">
                    {item.iconUrl ?? '📦'}
                  </span>
                  <span className="ui-stash-cell__name">{item.name}</span>
                  {item.quantity > 1 ? <span className="ui-stash-cell__qty">{item.quantity}</span> : null}
                </>
              ) : null}
            </div>
          );
        }}
      />

      {focusedItem ? (
        <div className="ui-stash-actionbar">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{focusedItem.name}</span>
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
            <Button size="sm" variant="primary" onClick={(): void => triggerPrimaryAction(focusedItem)}>
              {focusedItem.category === 'consumable' ? 'Use' : 'Equip'}
            </Button>
            {onDropItem ? (
              <Button size="sm" variant="ghost" onClick={(): void => onDropItem(focusedItem.id, focusedItem)}>
                Drop
              </Button>
            ) : null}
            {focusedItem.inspectData && onInspectItem ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={(): void => {
                  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
                  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
                  onInspectItem(focusedItem, Math.round(vw * 0.5), Math.round(vh * 0.3));
                }}
              >
                Examine
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="ui-stash-footer">
        <span>{`Carried: ${data.currentWeightLbs.toFixed(1)} / ${data.maxWeightLbs.toFixed(1)} lbs`}</span>
        <span style={{ color: 'var(--ui-accent-primary)', fontWeight: 700 }}>{`${currencyLabel} 🪙`}</span>
      </div>
    </div>
  );
}
