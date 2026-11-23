import type { RefObject } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/** Options configuring live DOM focus trapping inside a modal or dialog container. */
export interface FocusTrapOptions {
  /** Whether to restore focus to the previously focused element on cleanup (default true). */
  readonly restoreFocus?: boolean | undefined;
  /** Optional explicit element to focus initially instead of the first focusable child. */
  readonly initialFocusRef?: RefObject<HTMLElement | null> | undefined;
}

/**
 * Queries currently visible & enabled focusable descendants inside `container` dynamically.
 */
export function queryFocusableElements(container: HTMLElement): ReadonlyArray<HTMLElement> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

/**
 * Attaches a live DOM focus trap to `element` that queries focusable descendants dynamically on
 * every `Tab` / `Shift+Tab` press (surviving re-renders) and restores prior focus upon cleanup.
 *
 * @param element Container HTMLElement to trap focus within.
 * @param options Optional initial focus and restoration settings.
 * @returns Cleanup function detaching listeners and restoring previous focus.
 */
export function createLiveFocusTrap(element: HTMLElement, options: FocusTrapOptions = {}): () => void {
  const previousActive = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  const focusInitial = (): void => {
    const explicit = options.initialFocusRef?.current;
    if (explicit && element.contains(explicit) && !explicit.hasAttribute('disabled')) {
      explicit.focus();
      return;
    }
    const focusables = queryFocusableElements(element);
    const first = focusables[0];
    if (first) {
      if (typeof document !== 'undefined' && !element.contains(document.activeElement)) {
        first.focus();
      }
      return;
    }
    if (!element.hasAttribute('tabindex')) {
      element.setAttribute('tabindex', '-1');
    }
    element.focus();
  };

  focusInitial();

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;

    const focusables = queryFocusableElements(element);
    if (focusables.length === 0) {
      event.preventDefault();
      element.focus();
      return;
    }

    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

    if (event.shiftKey) {
      if (!active || active === first || !element.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (!active || active === last || !element.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  element.addEventListener('keydown', handleKeyDown);

  return (): void => {
    element.removeEventListener('keydown', handleKeyDown);
    if (options.restoreFocus !== false && previousActive && typeof previousActive.focus === 'function') {
      if (typeof document === 'undefined' || document.contains(previousActive)) {
        previousActive.focus();
      }
    }
  };
}

/**
 * Preact hook attaching a live focus trap whenever `enabled` is true.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  options: FocusTrapOptions = {}
): void {
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    return createLiveFocusTrap(el, options);
  }, [containerRef, enabled, options.restoreFocus, options.initialFocusRef]);
}

/** Roving focus geometry mode. */
export type RovingOrientation = 'vertical' | 'horizontal' | 'grid';

/** Configuration passed to `useRovingFocus`. */
export interface RovingFocusOptions {
  readonly count: number;
  readonly orientation?: RovingOrientation | undefined;
  readonly columns?: number | undefined;
  readonly loop?: boolean | undefined;
  readonly initialIndex?: number | undefined;
  readonly controlledIndex?: number | undefined;
  readonly onIndexChange?: ((nextIndex: number) => void) | undefined;
  readonly onActivate?: ((index: number) => void) | undefined;
}

/** Result returned by `useRovingFocus` for declarative ARIA listboxes, grids, and toolbars. */
export interface RovingFocusResult {
  readonly activeIndex: number;
  readonly getActiveIndex: () => number;
  readonly setActiveIndex: (index: number) => void;
  readonly handleKeyDown: (event: KeyboardEvent) => void;
  readonly getTabIndex: (index: number) => 0 | -1;
}

function clampRovingIndex(index: number, count: number, loop: boolean): number {
  if (count <= 0) return 0;
  if (loop) {
    return ((index % count) + count) % count;
  }
  return Math.max(0, Math.min(count - 1, index));
}

/**
 * Declarative roving tabindex keyboard navigation hook supporting vertical lists,
 * horizontal tab strips/toolbars, and 2D grids (Arrow keys, Home, End, Enter/Space).
 */
export function useRovingFocus(options: RovingFocusOptions): RovingFocusResult {
  const {
    count,
    orientation = 'vertical',
    columns = 1,
    loop = true,
    initialIndex = 0,
    controlledIndex,
    onIndexChange,
    onActivate
  } = options;

  const [internalIndex, setInternalIndex] = useState<number>(() => clampRovingIndex(initialIndex, count, false));

  const rawActive = controlledIndex !== undefined ? controlledIndex : internalIndex;
  const activeIndex = count > 0 ? Math.max(0, Math.min(count - 1, rawActive)) : 0;
  const activeRef = useRef<number>(activeIndex);
  activeRef.current = activeIndex;

  const setActiveIndex = useCallback(
    (next: number): void => {
      const clamped = clampRovingIndex(next, count, loop);
      activeRef.current = clamped;
      if (controlledIndex === undefined) {
        setInternalIndex(clamped);
      }
      onIndexChange?.(clamped);
    },
    [count, loop, controlledIndex, onIndexChange]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (count <= 0) return;
      const current = activeRef.current;
      const safeCols = Math.max(1, columns);
      let nextIndex: number | null = null;

      if (orientation === 'vertical') {
        if (event.key === 'ArrowDown') nextIndex = current + 1;
        else if (event.key === 'ArrowUp') nextIndex = current - 1;
      } else if (orientation === 'horizontal') {
        if (event.key === 'ArrowRight') nextIndex = current + 1;
        else if (event.key === 'ArrowLeft') nextIndex = current - 1;
      } else {
        if (event.key === 'ArrowRight') nextIndex = current + 1;
        else if (event.key === 'ArrowLeft') nextIndex = current - 1;
        else if (event.key === 'ArrowDown') {
          const candidate = current + safeCols;
          nextIndex = candidate < count ? candidate : loop ? candidate % safeCols : current;
        } else if (event.key === 'ArrowUp') {
          const candidate = current - safeCols;
          if (candidate >= 0) {
            nextIndex = candidate;
          } else if (loop) {
            const col = current % safeCols;
            const lastRowStart = Math.floor((count - 1) / safeCols) * safeCols;
            const wrapped = lastRowStart + col;
            nextIndex = wrapped < count ? wrapped : Math.max(0, wrapped - safeCols);
          } else {
            nextIndex = current;
          }
        }
      }

      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = count - 1;

      if (nextIndex !== null) {
        event.preventDefault();
        setActiveIndex(nextIndex);
        return;
      }

      if ((event.key === 'Enter' || event.key === ' ') && onActivate) {
        event.preventDefault();
        onActivate(current);
      }
    },
    [count, columns, orientation, loop, setActiveIndex, onActivate]
  );

  const getTabIndex = useCallback((index: number): 0 | -1 => (index === activeIndex ? 0 : -1), [activeIndex]);
  const getActiveIndex = useCallback((): number => activeRef.current, []);

  return { activeIndex, getActiveIndex, setActiveIndex, handleKeyDown, getTabIndex };
}
