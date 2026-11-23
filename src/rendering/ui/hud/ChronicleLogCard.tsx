import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { LOG_FILTER_TABS, type LogFilterCategory } from '../../../constants/ui.constants.ts';
import type { GameState } from '../../../types/game-state.types.ts';
import { uiStore, useUiSelector } from '../core/ui_store.ts';
import { IconButton } from '../primitives/Button.tsx';
import { Badge } from '../primitives/DataDisplay.tsx';
import { type TabItem, Tabs } from '../primitives/Tabs.tsx';

/**
 * Classifies a message log entry into a filter tab category based on its cssClass and text.
 */
export function matchesLogCategory(
  msg: { readonly text: string; readonly cssClass?: string | undefined },
  filter: LogFilterCategory
): boolean {
  if (filter === 'all') return true;
  const cls = msg.cssClass ?? 'system';
  const isCombat = cls.startsWith('combat');
  const isSpeech = cls === 'flavor' || msg.text.startsWith('"');
  if (filter === 'combat') return isCombat;
  if (filter === 'speech') return isSpeech;
  return !isCombat && !isSpeech;
}

/** Props for `<ChronicleLogCard />`. */
export interface ChronicleLogCardProps {
  readonly state: GameState;
  readonly isHudFocused: boolean;
}

const LOG_TABS: ReadonlyArray<TabItem> = LOG_FILTER_TABS.map((t) => ({
  id: t.id,
  label: t.label
}));

/**
 * Right-stack Chronicle Combat & Event Log HUD Card with keyboard-accessible filter tabs
 * (`ArrowLeft`/`ArrowRight`) and automatic scroll-to-bottom on new messages.
 */
export function ChronicleLogCard({ state, isHudFocused }: ChronicleLogCardProps): JSX.Element {
  const folded = useUiSelector((s) => Boolean(s.hudFolded['log']));
  const [activeFilter, setActiveFilter] = useState<LogFilterCategory>('all');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const filteredMessages = state.messages.filter((msg) => matchesLogCategory(msg, activeFilter));

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredMessages.length, activeFilter, folded]);

  return (
    <section
      className="ui-hud-card ui-hud-zone"
      data-hud-zone="4"
      data-hud-focused={isHudFocused ? 'true' : undefined}
      aria-label="Chronicle Log"
    >
      <div className="ui-hud-card__header">
        <h3 className="ui-hud-card__title">Chronicle Log</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge tone="neutral">{String(state.messages.length)}</Badge>
          <IconButton
            ariaLabel={folded ? 'Expand Chronicle Log' : 'Fold Chronicle Log'}
            onClick={(): void => uiStore.toggleHudFolded('log')}
          >
            {folded ? '▸' : '▾'}
          </IconButton>
        </div>
      </div>

      {!folded ? (
        <div className="ui-hud-card__body">
          <Tabs
            tabs={LOG_TABS}
            activeTabId={activeFilter}
            ariaLabel="Message log filters"
            onSelectTab={(id): void => setActiveFilter(id as LogFilterCategory)}
          />
          <div ref={scrollRef} className="ui-chronicle-messages" role="log" aria-live="polite" tabIndex={0}>
            {filteredMessages.length === 0 ? (
              <span className="ui-field__hint">No chronicle entries in this category.</span>
            ) : (
              filteredMessages.map((msg, idx) => (
                <div key={`log_${idx}`} className={msg.cssClass ? `log-entry ${msg.cssClass}` : 'log-entry'}>
                  {msg.count && msg.count > 1 ? `${msg.text} (x${msg.count})` : msg.text}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
