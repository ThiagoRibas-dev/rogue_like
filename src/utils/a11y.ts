/**
 * Traps keyboard focus within the specified container element.
 * @param element The DOM element to trap focus inside (e.g. a Modal)
 * @returns A cleanup function to remove the event listeners.
 */
export function trapFocus(element: HTMLElement): () => void {
  const focusableEls = element.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input[type="text"]:not([disabled]), input[type="radio"]:not([disabled]), input[type="checkbox"]:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );

  const firstFocusableEl = focusableEls[0];
  const lastFocusableEl = focusableEls[focusableEls.length - 1];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstFocusableEl) {
        lastFocusableEl?.focus();
        e.preventDefault();
      }
    } else {
      // Tab
      if (document.activeElement === lastFocusableEl) {
        firstFocusableEl?.focus();
        e.preventDefault();
      }
    }
  };

  element.addEventListener('keydown', handleKeyDown);

  // Auto-focus the first element when invoked if nothing already focused inside the element
  if (firstFocusableEl && !element.contains(document.activeElement)) {
    firstFocusableEl.focus();
  }

  return () => {
    element.removeEventListener('keydown', handleKeyDown);
  };
}
