import type { JSX } from 'preact';
import { useUiSelector } from '../core/ui_store.ts';

/**
 * Global themed tooltip overlay driven by `tooltipService` (supports pointer hover and keyboard inspect).
 */
export function TooltipHost(): JSX.Element | null {
  const tooltip = useUiSelector((snap) => snap.tooltip);
  if (!tooltip) return null;

  const left = tooltip.anchor ? Math.max(12, Math.min(tooltip.anchor.x, 960)) : 24;
  const top = tooltip.anchor ? Math.max(12, tooltip.anchor.y) : 24;

  return (
    <div className="ui-tooltip" role="tooltip" style={{ left: `${left}px`, top: `${top}px` }}>
      <div className="ui-tooltip__title">{tooltip.title}</div>
      {tooltip.body ? <div>{tooltip.body}</div> : null}
      {tooltip.meta && tooltip.meta.length > 0 ? (
        <div style={{ marginTop: 'var(--ui-space-1)', color: 'var(--ui-ink-muted)' }}>{tooltip.meta.join(' · ')}</div>
      ) : null}
    </div>
  );
}
