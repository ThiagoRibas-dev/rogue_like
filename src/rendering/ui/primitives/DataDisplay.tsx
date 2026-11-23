import type { ComponentChildren, JSX } from 'preact';

/** Visual tone for `Badge` primitives. */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** Props for `<Chip />` toggle/filter pill. */
export interface ChipProps {
  readonly active?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly title?: string | undefined;
  readonly className?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly children: ComponentChildren;
}

/**
 * Interactive filter or tag chip button with accessible `aria-pressed` state.
 */
export function Chip({
  active = false,
  disabled = false,
  title,
  className,
  onClick,
  children
}: ChipProps): JSX.Element {
  const classes = ['ui-chip', active ? 'ui-chip--active' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} aria-pressed={active} disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/** Props for `<Badge />`. */
export interface BadgeProps {
  readonly tone?: BadgeTone | undefined;
  readonly className?: string | undefined;
  readonly children: ComponentChildren;
}

/**
 * Non-interactive semantic status or category badge.
 */
export function Badge({ tone = 'neutral', className, children }: BadgeProps): JSX.Element {
  const classes = ['ui-badge', tone !== 'neutral' ? `ui-badge--${tone}` : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return <span className={classes}>{children}</span>;
}

/** Props for `<StatChip />` tabular metric display. */
export interface StatChipProps {
  readonly label: string;
  readonly value: string | number;
  readonly title?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * Compact label + tabular monospace value readout used across HUD, Dossier, and Cartridge sheets.
 */
export function StatChip({ label, value, title, className }: StatChipProps): JSX.Element {
  return (
    <div className={className ? `ui-stat-chip ${className}` : 'ui-stat-chip'} title={title}>
      <span className="ui-stat-chip__label">{label}</span>
      <span className="ui-stat-chip__value">{value}</span>
    </div>
  );
}
