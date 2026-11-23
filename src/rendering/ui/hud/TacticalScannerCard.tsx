import type { JSX } from 'preact';
import { uiStore, useUiSelector } from '../core/ui_store.ts';
import { IconButton } from '../primitives/Button.tsx';
import { Badge } from '../primitives/DataDisplay.tsx';

/** Props for `<TacticalScannerCard />`. */
export interface TacticalScannerCardProps {
  readonly isHudFocused: boolean;
}

/**
 * Right-stack Inspect HUD Card displaying live hovered/inspected tile, entity,
 * and hazard metadata projected by `buildViewportSnapshot`.
 */
export function TacticalScannerCard({ isHudFocused }: TacticalScannerCardProps): JSX.Element {
  const folded = useUiSelector((s) => Boolean(s.hudFolded['scanner']));
  const inspectTooltip = useUiSelector((s) => s.inspectTooltip);

  const firstHeader = inspectTooltip?.active ? inspectTooltip.sections.find((sec) => sec.type === 'header') : undefined;

  return (
    <section
      className="ui-hud-card ui-hud-zone"
      data-hud-zone="3"
      data-hud-focused={isHudFocused ? 'true' : undefined}
      aria-label="Inspect"
    >
      <div className="ui-hud-card__header">
        <h3 className="ui-hud-card__title">Inspect</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge tone={inspectTooltip?.active ? 'accent' : 'neutral'}>
            {firstHeader ? firstHeader.value.slice(0, 12) : 'IDLE'}
          </Badge>
          <IconButton
            ariaLabel={folded ? 'Expand Inspect' : 'Fold Inspect'}
            onClick={(): void => uiStore.toggleHudFolded('scanner')}
          >
            {folded ? '▸' : '▾'}
          </IconButton>
        </div>
      </div>

      {!folded ? (
        <div className="ui-hud-card__body">
          <div className="ui-scanner-body" aria-live="polite">
            {!inspectTooltip?.active || inspectTooltip.sections.length === 0 ? (
              <span className="ui-field__hint">Hover or press [X] to examine tiles. Right-click or [V] for verbs.</span>
            ) : (
              inspectTooltip.sections.map((section, idx) => {
                if (section.type === 'header') {
                  return (
                    <div key={`scan_h_${idx}`} style={{ fontWeight: 700, color: 'var(--ui-accent-primary)' }}>
                      {section.value}
                    </div>
                  );
                }
                if (section.type === 'stat') {
                  return (
                    <div key={`scan_s_${idx}`} className="ui-scanner-stat">
                      {section.label ? <span>{section.label}</span> : null}
                      <span style={section.color ? { color: section.color } : undefined}>{section.value}</span>
                    </div>
                  );
                }
                return (
                  <div
                    key={`scan_d_${idx}`}
                    style={section.color ? { color: section.color } : { color: 'var(--ui-text-secondary)' }}
                  >
                    {section.value}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
