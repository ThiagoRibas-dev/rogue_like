/**
 * Persistent collapsible bottom diagnostics dock.
 * Replaces the hover-only validation popup in `editor_toolbar.ts`.
 *
 * Zero `.innerHTML` usage (Golden Rule 7 / Decision D6).
 *
 * @see docs/research_notes.md §10.1 — §10.4
 * @see docs/DECISIONS.md — Milestone 76, Decision D2
 */
import { revealField } from '../../editor/validation_navigator';

export interface ValidationPanelProps {
  readonly errors: ReadonlyArray<{
    readonly path: string;
    readonly message: string;
    readonly severity?: 'error' | 'warning' | 'info';
  }>;
}

/**
 * Render (or update) the bottom dock. Called by `editor_toolbar.ts`'s `updateToolbarState()`.
 *
 * @param container — The dock DOM element (`#validation-dock`)
 * @param props — Current validation error state
 */
export function renderValidationPanel(container: HTMLElement, props: ValidationPanelProps): void {
  // Clear previous children safely (no innerHTML assignment)
  container.replaceChildren();

  // Header showing total error count
  const header = document.createElement('div');
  header.className = 'validation-dock-header';
  header.textContent = `Diagnostics: ${props.errors.length} issue${props.errors.length === 1 ? '' : 's'}`;
  container.appendChild(header);

  if (props.errors.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'validation-dock-empty';
    emptyMsg.textContent = 'No validation errors.';
    container.appendChild(emptyMsg);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'validation-dock-list';
  list.style.padding = '0';
  list.style.margin = '4px 0';
  list.style.listStyle = 'none';

  for (const err of props.errors) {
    const li = document.createElement('li');
    li.className = 'validation-dock-row';
    li.style.marginBottom = '4px';

    const btn = document.createElement('button');
    btn.className = 'validation-dock-button';
    btn.style.width = '100%';
    btn.style.textAlign = 'left';
    btn.style.background = 'none';
    btn.style.border = 'none';
    btn.style.color = 'inherit';
    btn.style.cursor = 'pointer';
    btn.style.padding = '4px 8px';
    btn.style.borderRadius = '4px';

    const severity = err.severity || 'error';
    const color = severity === 'error' ? '#f38ba8' : severity === 'warning' ? '#f9e2af' : '#89b4fa';
    btn.style.color = color;

    btn.textContent = `${err.path}: ${err.message}`;

    btn.addEventListener('click', () => {
      // Use navigator to expand ancestors and prepare focus
      const navResult = revealField(err.path);
      // The controller (editor_toolbar / workspace) reads `navResult.focusSelector`
      // and applies focus; here we emit a custom event or rely on the caller.
      // For simplicity, the button click also dispatches a navigation event.
      const event = new CustomEvent('editor:navigate-to-field', {
        detail: { targetPath: err.path, focusSelector: navResult.focusSelector }
      });
      container.dispatchEvent(event);
    });

    li.appendChild(btn);
    list.appendChild(li);
  }

  container.appendChild(list);
}
