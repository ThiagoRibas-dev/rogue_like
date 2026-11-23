import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { useRovingFocus } from './focus_hooks.ts';

/** Single tab descriptor rendered inside `<Tabs />`. */
export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string | undefined;
  readonly badge?: ComponentChildren | undefined;
  readonly disabled?: boolean | undefined;
}

/** Props for `<Tabs />`. */
export interface TabsProps {
  readonly tabs: ReadonlyArray<TabItem>;
  readonly activeTabId: string;
  readonly onSelectTab: (tabId: string) => void;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * Accessible horizontal tablist with `ArrowLeft`/`ArrowRight`/`Home`/`End` roving keyboard support.
 */
export function Tabs({ tabs, activeTabId, onSelectTab, ariaLabel = 'Tabs', className }: TabsProps): JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null);
  const currentIdx = Math.max(
    0,
    tabs.findIndex((t) => t.id === activeTabId)
  );

  const roving = useRovingFocus({
    count: tabs.length,
    orientation: 'horizontal',
    controlledIndex: currentIdx,
    onIndexChange: (nextIdx) => {
      const next = tabs[nextIdx];
      if (!next || next.disabled) return;
      onSelectTab(next.id);
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons?.[nextIdx]?.focus();
    }
  });

  return (
    <div
      ref={listRef}
      className={className ? `ui-tabs__list ${className}` : 'ui-tabs__list'}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={roving.handleKeyDown}
    >
      {tabs.map((tab, idx) => {
        const selected = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="ui-tabs__tab"
            aria-selected={selected}
            disabled={tab.disabled}
            tabIndex={roving.getTabIndex(idx)}
            onClick={() => onSelectTab(tab.id)}
          >
            {tab.icon ? `${tab.icon} ` : ''}
            {tab.label}
            {tab.badge ? <span style={{ marginLeft: 'var(--ui-space-1)' }}>{tab.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
