import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { useRovingFocus } from './focus_hooks.ts';

/** Item option rendered inside `<ListBox />`. */
export interface ListBoxItem {
  readonly id: string;
  readonly label: string;
  readonly subtitle?: string | undefined;
  readonly meta?: ComponentChildren | undefined;
  readonly disabled?: boolean | undefined;
}

/** Props for `<ListBox />`. */
export interface ListBoxProps {
  readonly items: ReadonlyArray<ListBoxItem>;
  readonly selectedId?: string | null | undefined;
  readonly onSelect: (itemId: string) => void;
  readonly onActivate?: ((itemId: string) => void) | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
  readonly emptyMessage?: string | undefined;
}

/**
 * Keyboard-accessible vertical list box (`ArrowUp`/`ArrowDown`/`Home`/`End`/`Enter`)
 * shared across Menus, Campaign Select, Trade, Quests, and Phase 44 Editor Sidebar.
 */
export function ListBox({
  items,
  selectedId,
  onSelect,
  onActivate,
  ariaLabel = 'Selectable list',
  className,
  emptyMessage = 'No items available.'
}: ListBoxProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = selectedId
    ? Math.max(
        0,
        items.findIndex((item) => item.id === selectedId)
      )
    : 0;

  const roving = useRovingFocus({
    count: items.length,
    orientation: 'vertical',
    controlledIndex: selectedId ? selectedIndex : undefined,
    onIndexChange: (idx) => {
      const target = items[idx];
      if (!target || target.disabled) return;
      onSelect(target.id);
      const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
      buttons?.[idx]?.focus();
    },
    onActivate: (idx) => {
      const target = items[idx];
      if (!target || target.disabled) return;
      if (onActivate) onActivate(target.id);
      else onSelect(target.id);
    }
  });

  if (items.length === 0) {
    return <p className="ui-field__hint">{emptyMessage}</p>;
  }

  return (
    <div
      ref={containerRef}
      className={className ? `ui-listbox ${className}` : 'ui-listbox'}
      role="listbox"
      aria-label={ariaLabel}
      onKeyDown={roving.handleKeyDown}
    >
      {items.map((item, idx) => {
        const isSelected = selectedId !== undefined ? item.id === selectedId : idx === roving.activeIndex;
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            className="ui-listbox__item"
            aria-selected={isSelected}
            disabled={item.disabled}
            tabIndex={roving.getTabIndex(idx)}
            onClick={() => {
              roving.setActiveIndex(idx);
              onSelect(item.id);
            }}
            onDblClick={() => onActivate?.(item.id)}
          >
            <div>
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              {item.subtitle ? <div className="ui-field__hint">{item.subtitle}</div> : null}
            </div>
            {item.meta ? <div>{item.meta}</div> : null}
          </button>
        );
      })}
    </div>
  );
}
