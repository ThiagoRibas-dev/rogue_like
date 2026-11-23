import type { JSX } from 'preact';
import type { UIInspectData } from '../../../types/ui_adapter.types.ts';

const POPOVER_WIDTH_PX = 320;
const POPOVER_HEIGHT_PX = 290;
const CURSOR_OFFSET_PX = 16;
const VIEWPORT_MARGIN_PX = 16;

/** Active item inspection anchor coordinates. */
export interface ItemInspectAnchor {
  readonly data: UIInspectData;
  readonly clientX: number;
  readonly clientY: number;
}

/** Props for `<ItemInspectPopover />`. */
export interface ItemInspectPopoverProps {
  readonly anchor: ItemInspectAnchor | null;
}

/**
 * Theme-aware Preact Examine Popover card anchored near cursor or keyboard-focused
 * inventory / paperdoll item (`?` or `Alt+I` or mouse hover).
 */
export function ItemInspectPopover({ anchor }: ItemInspectPopoverProps): JSX.Element | null {
  if (!anchor) return null;

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;

  let leftPos = anchor.clientX + CURSOR_OFFSET_PX;
  let topPos = anchor.clientY + CURSOR_OFFSET_PX;

  if (leftPos + POPOVER_WIDTH_PX > viewportWidth - VIEWPORT_MARGIN_PX) {
    leftPos = Math.max(VIEWPORT_MARGIN_PX, anchor.clientX - POPOVER_WIDTH_PX - CURSOR_OFFSET_PX);
  }
  if (topPos + POPOVER_HEIGHT_PX > viewportHeight - VIEWPORT_MARGIN_PX) {
    topPos = Math.max(VIEWPORT_MARGIN_PX, anchor.clientY - POPOVER_HEIGHT_PX - CURSOR_OFFSET_PX);
  }

  const { data } = anchor;

  return (
    <div className="ui-inspect-popover" role="tooltip" style={{ left: `${leftPos}px`, top: `${topPos}px` }}>
      <div className="ui-inspect-popover__banner">
        <span>👁</span>
        <span>Examine</span>
      </div>
      <div className="ui-inspect-popover__body">
        <h4 className="ui-inspect-popover__title">{data.title}</h4>
        {data.loreText ? <p className="ui-inspect-popover__lore">{data.loreText}</p> : null}
        {data.baseMetrics.length > 0 ? (
          <div className="ui-inspect-popover__metrics">
            {data.baseMetrics.map((metric, idx) => (
              <div key={`${metric.label}_${idx}`}>{`${metric.label}: ${metric.value}`}</div>
            ))}
          </div>
        ) : null}
        {data.specialProperties.length > 0 ? (
          <div>
            <div style={{ fontWeight: 700, marginBottom: '4px', color: 'var(--ui-status-success)' }}>
              Special Properties
            </div>
            <ul className="ui-inspect-popover__props">
              {data.specialProperties.map((prop, idx) => (
                <li key={`prop_${idx}`}>{prop.text}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
