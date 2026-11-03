/**
 * "Where Used" global reverse-reference inspector drawer/dock.
 *
 * Driven by the cached `ReferenceIndex` (`WeakMap`) built by `reference_index.ts`.
 * Zero `.innerHTML`. Every row is a native `<button>` with `textContent`.
 *
 * @see docs/archive/research_notes.md §10.3 — §10.4
 * @see docs/DECISIONS.md — Milestone 76, Decision D1
 */
import type { ReferenceIndex } from '../../editor/reference_index';
import { revealField } from '../../editor/validation_navigator';

export interface WhereUsedDrawerProps {
  readonly index: ReferenceIndex;
  readonly selectedKind: string;
  readonly selectedId: string;
}

/**
 * Render (or refresh) the drawer content.
 *
 * @param container — The drawer DOM container
 * @param props — Reference index + selected target
 */
export function renderWhereUsedDrawer(container: HTMLElement, props: WhereUsedDrawerProps): void {
  container.replaceChildren();

  const usages = props.index.usages.get(`${props.selectedKind}:${props.selectedId}`) ?? [];

  const header = document.createElement('h3');
  header.className = 'where-used-header';
  header.textContent = `Where Used: ${props.selectedKind}:${props.selectedId}`;
  header.style.marginTop = '0';
  header.style.marginBottom = '8px';
  container.appendChild(header);

  if (usages.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'where-used-empty';
    emptyMsg.textContent = 'No usages found for this reference.';
    container.appendChild(emptyMsg);
    return;
  }

  const countMsg = document.createElement('p');
  countMsg.className = 'where-used-count';
  countMsg.textContent = `${usages.length} reference${usages.length === 1 ? '' : 's'}`;
  container.appendChild(countMsg);

  const list = document.createElement('ul');
  list.className = 'where-used-list';
  list.style.padding = '0';
  list.style.margin = '8px 0';
  list.style.listStyle = 'none';

  for (const usage of usages) {
    const li = document.createElement('li');
    li.className = 'where-used-item';
    li.style.marginBottom = '4px';

    const btn = document.createElement('button');
    btn.className = 'where-used-row-button';
    btn.style.width = '100%';
    btn.style.textAlign = 'left';
    btn.style.background = 'none';
    btn.style.border = 'none';
    btn.style.color = '#cdd6f4';
    btn.style.cursor = 'pointer';
    btn.style.padding = '6px 8px';
    btn.style.borderRadius = '4px';
    btn.style.fontFamily = 'monospace';
    btn.style.fontSize = '0.85rem';
    btn.style.transition = 'background 0.1s ease';

    // Hover state via native CSS class (no inline style mutation needed for basic hover)
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(255,255,255,0.05)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'none';
    });

    btn.textContent = `${usage.sourcePath}`;

    btn.addEventListener('click', () => {
      // Expand ancestors and focus the source field
      revealField(usage.sourcePath);
      // Emit navigation event for controller layer
      const event = new CustomEvent('editor:navigate-to-field', {
        detail: { targetPath: usage.sourcePath, focusSelector: `[data-field-path="${usage.sourcePath}"]` }
      });
      container.dispatchEvent(event);
    });

    li.appendChild(btn);
    list.appendChild(li);
  }

  container.appendChild(list);
}
