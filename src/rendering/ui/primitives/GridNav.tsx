import type { ComponentChildren, JSX, TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';
import { useRovingFocus } from './focus_hooks.ts';

/** Props for 2D keyboard-navigable `<GridNav />`. */
export interface GridNavProps<T> {
  readonly items: ReadonlyArray<T>;
  readonly columns: number;
  readonly getKey: (item: T, index: number) => string;
  readonly renderItem: (item: T, index: number, isFocused: boolean) => ComponentChildren;
  readonly onActivate?: ((item: T, index: number) => void) | undefined;
  readonly onFocusItem?: ((item: T, index: number) => void) | undefined;
  readonly onInspectItem?: ((item: T, index: number) => void) | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * 2D Arrow-key navigable grid (`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Home`/`End`/`Enter`
 * plus `?` / `Alt+I` keyboard inspect hook) used by Paperdoll, Stash, Sprite Picker, and Editor Tile Palette.
 */
export function GridNav<T>({
  items,
  columns,
  getKey,
  renderItem,
  onActivate,
  onFocusItem,
  onInspectItem,
  ariaLabel = 'Grid navigation',
  className
}: GridNavProps<T>): JSX.Element {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const safeColumns = Math.max(1, columns);

  const roving = useRovingFocus({
    count: items.length,
    orientation: 'grid',
    columns: safeColumns,
    onIndexChange: (nextIdx) => {
      const buttons = gridRef.current?.querySelectorAll<HTMLElement>('[data-grid-cell="true"]');
      buttons?.[nextIdx]?.focus();
      const target = items[nextIdx];
      if (target !== undefined) onFocusItem?.(target, nextIdx);
    },
    onActivate: (idx) => {
      const target = items[idx];
      if (target !== undefined) onActivate?.(target, idx);
    }
  });

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (onInspectItem && (event.key === '?' || (event.altKey && event.key.toLowerCase() === 'i'))) {
      const target = items[roving.getActiveIndex()];
      if (target !== undefined) {
        event.preventDefault();
        onInspectItem(target, roving.activeIndex);
        return;
      }
    }
    roving.handleKeyDown(event);
  };

  return (
    <div
      ref={gridRef}
      className={className ? `ui-gridnav ${className}` : 'ui-gridnav'}
      role="grid"
      aria-label={ariaLabel}
      style={{ gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))` }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, idx) => {
        const isFocused = idx === roving.activeIndex;
        return (
          <div
            key={getKey(item, idx)}
            role="gridcell"
            data-grid-cell="true"
            tabIndex={roving.getTabIndex(idx)}
            onFocus={() => roving.setActiveIndex(idx)}
            onClick={() => {
              roving.setActiveIndex(idx);
              onActivate?.(item, idx);
            }}
          >
            {renderItem(item, idx, isFocused)}
          </div>
        );
      })}
    </div>
  );
}
