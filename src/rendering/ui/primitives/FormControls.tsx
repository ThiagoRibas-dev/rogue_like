import type { ComponentChildren, JSX, RefObject } from 'preact';

/** Props for `<FormField />`. */
export interface FormFieldProps {
  readonly label: string;
  readonly htmlFor?: string | undefined;
  readonly hint?: string | undefined;
  readonly error?: string | null | undefined;
  readonly className?: string | undefined;
  readonly children: ComponentChildren;
}

/**
 * Labeled form field container displaying optional hint and validation errors.
 */
export function FormField({ label, htmlFor, hint, error, className, children }: FormFieldProps): JSX.Element {
  return (
    <div className={className ? `ui-field ${className}` : 'ui-field'}>
      <label className="ui-field__label" {...(htmlFor !== undefined ? { htmlFor } : {})}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="ui-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="ui-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

/** Props for `<TextInput />`. */
export interface TextInputProps {
  readonly id?: string | undefined;
  readonly value: string;
  readonly onInput: (value: string) => void;
  readonly placeholder?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly type?: 'text' | 'search' | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
  readonly inputRef?: RefObject<HTMLInputElement | null> | undefined;
}

/**
 * Themed text/search input automatically guarded against hotkey leaks by `TextInputGuard`.
 */
export function TextInput({
  id,
  value,
  onInput,
  placeholder,
  disabled = false,
  type = 'text',
  ariaLabel,
  className,
  inputRef
}: TextInputProps): JSX.Element {
  const classes = className ? `ui-input ${className}` : 'ui-input';
  const optionalProps = {
    ...(inputRef !== undefined ? { ref: inputRef } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(placeholder !== undefined ? { placeholder } : {}),
    ...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})
  };

  if (type === 'search') {
    return (
      <input
        {...optionalProps}
        type="search"
        className={classes}
        value={value}
        disabled={disabled}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
    );
  }

  return (
    <input
      {...optionalProps}
      type="text"
      className={classes}
      value={value}
      disabled={disabled}
      onInput={(e) => onInput((e.target as HTMLInputElement).value)}
    />
  );
}

/** Props for `<NumberInput />`. */
export interface NumberInputProps {
  readonly id?: string | undefined;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly disabled?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * Themed numeric input emitting finite parsed numbers within optional `min`/`max` bounds.
 */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  ariaLabel,
  className
}: NumberInputProps): JSX.Element {
  return (
    <input
      {...(id !== undefined ? { id } : {})}
      {...(min !== undefined ? { min } : {})}
      {...(max !== undefined ? { max } : {})}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      type="number"
      className={className ? `ui-input ui-tabular ${className}` : 'ui-input ui-tabular'}
      value={value}
      step={step}
      disabled={disabled}
      onInput={(e) => {
        const parsed = Number((e.target as HTMLInputElement).value);
        if (!Number.isFinite(parsed)) return;
        const clamped =
          min !== undefined && max !== undefined
            ? Math.max(min, Math.min(max, parsed))
            : min !== undefined
              ? Math.max(min, parsed)
              : max !== undefined
                ? Math.min(max, parsed)
                : parsed;
        onChange(clamped);
      }}
    />
  );
}

/** Option tuple rendered inside `<Select />`. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

/** Props for `<Select />`. */
export interface SelectProps {
  readonly id?: string | undefined;
  readonly value: string;
  readonly options: ReadonlyArray<SelectOption>;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}

/**
 * Themed accessible dropdown select primitive.
 */
export function Select({
  id,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className
}: SelectProps): JSX.Element {
  return (
    <select
      {...(id !== undefined ? { id } : {})}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      className={className ? `ui-select ${className}` : 'ui-select'}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** Props for `<Checkbox />`. */
export interface CheckboxProps {
  readonly id?: string | undefined;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * Themed labeled checkbox primitive.
 */
export function Checkbox({ id, checked, onChange, label, disabled = false, className }: CheckboxProps): JSX.Element {
  return (
    <label
      className={className ? `ui-checkbox ${className}` : 'ui-checkbox'}
      {...(id !== undefined ? { htmlFor: id } : {})}
    >
      <input
        {...(id !== undefined ? { id } : {})}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span>{label}</span>
    </label>
  );
}
