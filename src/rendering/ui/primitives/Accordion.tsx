import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';

/** Props for accessible `<Accordion />`. */
export interface AccordionProps {
  readonly title: string;
  readonly badge?: ComponentChildren | undefined;
  readonly actions?: ComponentChildren | undefined;
  readonly defaultExpanded?: boolean | undefined;
  readonly expanded?: boolean | undefined;
  readonly onToggle?: ((expanded: boolean) => void) | undefined;
  readonly className?: string | undefined;
  readonly children: ComponentChildren;
}

/**
 * Collapsible section primitive shared by Quickcast classes, Investigation logs, and Editor Zod objects.
 */
export function Accordion({
  title,
  badge,
  actions,
  defaultExpanded = false,
  expanded,
  onToggle,
  className,
  children
}: AccordionProps): JSX.Element {
  const [internalExpanded, setInternalExpanded] = useState<boolean>(defaultExpanded);
  const isExpanded = expanded !== undefined ? expanded : internalExpanded;

  const handleToggle = (): void => {
    const next = !isExpanded;
    if (expanded === undefined) {
      setInternalExpanded(next);
    }
    onToggle?.(next);
  };

  return (
    <div className={className ? `ui-accordion ${className}` : 'ui-accordion'}>
      <div className="ui-accordion__header">
        <button type="button" className="ui-accordion__trigger" aria-expanded={isExpanded} onClick={handleToggle}>
          <span>
            {isExpanded ? '▾ ' : '▸ '}
            {title}
          </span>
          {badge ? <span>{badge}</span> : null}
        </button>
        {actions ? <div className="ui-accordion__actions">{actions}</div> : null}
      </div>
      {isExpanded ? <div className="ui-accordion__content">{children}</div> : null}
    </div>
  );
}
