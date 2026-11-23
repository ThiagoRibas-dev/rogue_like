import type { AriaRole, ComponentChildren, JSX } from 'preact';

/** Props for `<Panel />`. */
export interface PanelProps {
  readonly title?: string | undefined;
  readonly headerActions?: ComponentChildren | undefined;
  readonly className?: string | undefined;
  readonly children: ComponentChildren;
  readonly role?: AriaRole | undefined;
  readonly ariaLabel?: string | undefined;
}

/**
 * Framed surface container styled by `--ui-bg-panel` and `--ui-border-subtle`.
 */
export function Panel({ title, headerActions, className, children, role, ariaLabel }: PanelProps): JSX.Element {
  return (
    <section className={className ? `ui-panel ${className}` : 'ui-panel'} role={role} aria-label={ariaLabel ?? title}>
      {(title || headerActions) && (
        <div className="ui-panel__header">
          {title ? <h3 className="ui-panel__title">{title}</h3> : <span />}
          {headerActions ? <div>{headerActions}</div> : null}
        </div>
      )}
      <div className="ui-panel__body">{children}</div>
    </section>
  );
}

/** Props for `<SplitPane />` master/detail layout (Gameplay + Phase 44 Editor ready). */
export interface SplitPaneProps {
  readonly leftWidth?: string | undefined;
  readonly rightWidth?: string | undefined;
  readonly left: ComponentChildren;
  readonly right: ComponentChildren;
  readonly className?: string | undefined;
}

/**
 * Two-column responsive split container shared by Dossier, Trade, Character Builder, and Editor layouts.
 */
export function SplitPane({
  leftWidth = '300px',
  rightWidth = '1fr',
  left,
  right,
  className
}: SplitPaneProps): JSX.Element {
  return (
    <div
      className={className ? `ui-split-pane ${className}` : 'ui-split-pane'}
      style={{ gridTemplateColumns: `${leftWidth} ${rightWidth}` }}
    >
      <div style={{ minWidth: 0, minHeight: 0, overflow: 'auto' }}>{left}</div>
      <div style={{ minWidth: 0, minHeight: 0, overflow: 'auto' }}>{right}</div>
    </div>
  );
}

/** Props for `<Toolbar />`. */
export interface ToolbarProps {
  readonly ariaLabel: string;
  readonly className?: string | undefined;
  readonly children: ComponentChildren;
}

/**
 * Horizontal control strip styled by `--ui-bg-toolbar` for Chronos, Shops, and Phase 44 Editor Toolbars.
 */
export function Toolbar({ ariaLabel, className, children }: ToolbarProps): JSX.Element {
  return (
    <div className={className ? `ui-toolbar ${className}` : 'ui-toolbar'} role="toolbar" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
