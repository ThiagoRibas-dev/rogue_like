/**
 * Static map right-click context menu for "Playtest from Here" spawning.
 *
 * Strictly scoped to static maps (Decision D5). Non-static generator sandboxes
 * have no definitive tile grid, so the existing toolbar button remains the path.
 *
 * Zero `.innerHTML`. All nodes created with `document.createElement`.
 *
 * @see docs/research_notes.md §10.5 — §10.6
 * @see docs/DECISIONS.md — Milestone 76, Decision D5
 */

export interface PlaytestMenuProps {
  readonly areaId: string;
  readonly x: number;
  readonly y: number;
  readonly walkable: boolean; // Pre-computed walkability for the tile at (x, y)
  readonly onSelectPlaytest: (areaId: string, x: number, y: number) => void;
}

/**
 * Render the context menu into a container element.
 *
 * @param container — The menu container (usually a `<div>` appended to `document.body`
 * @param props — Tile coordinates, area ID, walkability, and spawn callback
 */
export function renderPlaytestMenu(
  container: HTMLElement,
  props: PlaytestMenuProps
): void {
  container.replaceChildren();

  const header = document.createElement('div');
  header.className = 'context-menu-header';
  header.textContent = `Tile (${props.x}, ${props.y})`;
  header.style.padding = '4px 8px';
  header.style.fontWeight = 'bold';
  header.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
  header.style.marginBottom = '4px';
  container.appendChild(header);

  // Only offer playtest spawn if the tile is walkable (Decision D5: strict scope + verification)
  if (!props.walkable) {
    const refuseMsg = document.createElement('div');
    refuseMsg.className = 'context-menu-refuse';
    refuseMsg.textContent = 'Blocked: non-walkable tile.';
    refuseMsg.style.padding = '6px 8px';
    refuseMsg.style.color = '#f38ba8';
    refuseMsg.style.fontSize = '0.8rem';
    container.appendChild(refuseMsg);
    return;
  }

  const btn = document.createElement('button');
  btn.className = 'context-menu-item';
  btn.textContent = '▶ Playtest from Here';
  btn.style.width = '100%';
  btn.style.textAlign = 'left';
  btn.style.padding = '8px 12px';
  btn.style.background = 'none';
  btn.style.border = 'none';
  btn.style.color = '#cdd6f4';
  btn.style.cursor = 'pointer';
  btn.style.fontSize = '0.9rem';
  btn.style.transition = 'background 0.1s ease';

  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(89, 180, 250, 0.15)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'none';
  });

  btn.addEventListener('click', () => {
    props.onSelectPlaytest(props.areaId, props.x, props.y);
  });

  container.appendChild(btn);
}
