import type { JSX, TargetedKeyboardEvent } from 'preact';
import { Button } from './Button.tsx';

/** Props for `<Stepper />`. */
export interface StepperProps {
  readonly value: number;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly step?: number | undefined;
  readonly onChange: (nextValue: number) => void;
  readonly label?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

/**
 * Keyboard-operable numeric stepper (`[-][val][+]`) supporting `ArrowLeft`/`ArrowDown`/`-`
 * and `ArrowRight`/`ArrowUp`/`+` for Power Attack, Point Buy, and Phase 44 Editor numbers.
 */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label = 'Numeric stepper',
  disabled = false,
  className
}: StepperProps): JSX.Element {
  const canDec = !disabled && (min === undefined || value > min);
  const canInc = !disabled && (max === undefined || value < max);

  const adjust = (delta: number): void => {
    const raw = value + delta * step;
    const boundedMin = min !== undefined ? Math.max(min, raw) : raw;
    const bounded = max !== undefined ? Math.min(max, boundedMin) : boundedMin;
    if (bounded !== value) onChange(bounded);
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === '-') {
      event.preventDefault();
      adjust(-1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === '+' || event.key === '=') {
      event.preventDefault();
      adjust(1);
    }
  };

  return (
    <div
      className={className ? `ui-stepper ${className}` : 'ui-stepper'}
      role="spinbutton"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
    >
      <Button
        variant="ghost"
        size="sm"
        title={`Decrease ${label}`}
        disabled={!canDec}
        onClick={() => adjust(-1)}
        tabIndex={-1}
      >
        −
      </Button>
      <span className="ui-stepper__val">{value}</span>
      <Button
        variant="ghost"
        size="sm"
        title={`Increase ${label}`}
        disabled={!canInc}
        onClick={() => adjust(1)}
        tabIndex={-1}
      >
        +
      </Button>
    </div>
  );
}
