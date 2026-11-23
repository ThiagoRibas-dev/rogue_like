import type { ComponentChildren, JSX, TargetedMouseEvent } from 'preact';

/** Visual emphasis variant for `Button`. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Control height/padding scale for `Button`. */
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Props for the accessible `Button` primitive. */
export interface ButtonProps {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: ButtonSize | undefined;
  readonly type?: 'button' | 'submit' | 'reset' | undefined;
  readonly disabled?: boolean | undefined;
  readonly title?: string | undefined;
  readonly className?: string | undefined;
  readonly onClick?: ((event: TargetedMouseEvent<HTMLButtonElement>) => void) | undefined;
  readonly children: ComponentChildren;
  readonly ariaPressed?: boolean | undefined;
  readonly tabIndex?: number | undefined;
  readonly dataTestId?: string | undefined;
}

/**
 * Themed accessible button primitive adhering to `--ui-*` tokens and focus rings.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled = false,
  title,
  className,
  onClick,
  children,
  ariaPressed,
  tabIndex,
  dataTestId
}: ButtonProps): JSX.Element {
  const classes = [
    'ui-btn',
    variant !== 'secondary' ? `ui-btn--${variant}` : '',
    size !== 'md' ? `ui-btn--${size}` : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      title={title}
      onClick={onClick}
      aria-pressed={ariaPressed}
      tabIndex={tabIndex}
      data-testid={dataTestId}
    >
      {children}
    </button>
  );
}

/** Props for `IconButton`, requiring an explicit accessible `ariaLabel`. */
export interface IconButtonProps {
  readonly ariaLabel: string;
  readonly title?: string | undefined;
  readonly variant?: ButtonVariant | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
  readonly onClick?: ((event: TargetedMouseEvent<HTMLButtonElement>) => void) | undefined;
  readonly children: ComponentChildren;
  readonly tabIndex?: number | undefined;
}

/**
 * Square icon-only button primitive with mandatory accessible `aria-label`.
 */
export function IconButton({
  ariaLabel,
  title,
  variant = 'secondary',
  disabled = false,
  className,
  onClick,
  children,
  tabIndex
}: IconButtonProps): JSX.Element {
  const classes = ['ui-icon-btn', variant !== 'secondary' ? `ui-btn--${variant}` : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      disabled={disabled}
      onClick={onClick}
      tabIndex={tabIndex}
    >
      {children}
    </button>
  );
}
