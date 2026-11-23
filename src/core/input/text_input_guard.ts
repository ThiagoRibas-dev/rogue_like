/** Non-text `<input>` types that act as buttons/toggles rather than freeform text entry. */
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image']);

/** ARIA widget roles representing editable text or numeric controls. */
const EDITABLE_ARIA_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton']);

interface EditableCandidate {
  readonly tagName?: unknown;
  readonly type?: unknown;
  readonly isContentEditable?: unknown;
  readonly getAttribute?: ((name: string) => string | null) | undefined;
}

/**
 * Reports whether an arbitrary DOM node represents an editable text-entry control.
 * Safe in headless/happy-dom environments where global `HTMLElement` may vary by realm.
 *
 * @param element Candidate DOM element or EventTarget.
 * @returns True if typing into this element should be protected from gameplay shortcuts.
 */
export function isEditableElement(element: unknown): boolean {
  if (element === null || element === undefined || typeof element !== 'object') {
    return false;
  }

  const candidate = element as EditableCandidate;
  if (candidate.isContentEditable === true) {
    return true;
  }

  const contentEditableAttr = candidate.getAttribute?.('contenteditable');
  if (contentEditableAttr === '' || contentEditableAttr === 'true' || contentEditableAttr === 'plaintext-only') {
    return true;
  }

  const tag = typeof candidate.tagName === 'string' ? candidate.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }

  if (tag === 'INPUT') {
    const inputType = typeof candidate.type === 'string' ? candidate.type.toLowerCase() : 'text';
    return !NON_TEXT_INPUT_TYPES.has(inputType);
  }

  const role = candidate.getAttribute?.('role');
  if (role !== null && role !== undefined && EDITABLE_ARIA_ROLES.has(role)) {
    return true;
  }

  return false;
}

/**
 * Reports whether a KeyboardEvent originated from (or currently targets focus inside)
 * an editable text control where printable/modifier-free hotkeys must be suppressed.
 *
 * @param eventOrTarget The KeyboardEvent or raw EventTarget.
 * @returns True when TextInputGuard must protect the active text control.
 */
export function isEditableEventTarget(eventOrTarget: EventTarget | KeyboardEvent | null | undefined): boolean {
  if (eventOrTarget === null || eventOrTarget === undefined) {
    return typeof document !== 'undefined' ? isEditableElement(document.activeElement) : false;
  }

  const isKeyboardEvent = typeof eventOrTarget === 'object' && 'key' in eventOrTarget && 'target' in eventOrTarget;
  const target: unknown = isKeyboardEvent ? (eventOrTarget as KeyboardEvent).target : eventOrTarget;

  if (isEditableElement(target)) {
    return true;
  }

  // Fallback for window-level synthetic dispatches where focus sits on an editable element
  const isContainerTarget =
    target === null ||
    target === undefined ||
    (typeof window !== 'undefined' && target === window) ||
    (typeof document !== 'undefined' && (target === document || target === document.body));

  if (isContainerTarget && typeof document !== 'undefined') {
    return isEditableElement(document.activeElement);
  }

  return false;
}
