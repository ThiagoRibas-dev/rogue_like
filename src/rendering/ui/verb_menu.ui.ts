import type { GameState } from '../../types/game-state.types.ts';
import { UIMode } from '../../types/game-state.types.ts';

/**
 * Renders the context interaction verb overlay when multiple options are present.
 */
export function renderVerbMenu(state: GameState): void {
  const container = document.getElementById('verb-menu');
  if (!container) return;

  if (state.uiMode !== UIMode.VerbMenu || !state.verbMenu) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  const { availableVerbs, target } = state.verbMenu;

  let targetName = 'Target';
  if (target.type === 'entity') targetName = 'Select Action';
  else if (target.type === 'item') targetName = 'Select Action';
  else if (target.type === 'tile') targetName = 'Tile Options';
  else if (target.type === 'self') targetName = 'Self Options';

  container.innerHTML = ''; // Clear old

  const header = document.createElement('div');
  header.className = 'verb-menu-header';
  header.textContent = targetName;
  container.appendChild(header);

  const list = document.createElement('ul');
  list.className = 'verb-menu-list';

  if (availableVerbs.length === 0) {
    const li = document.createElement('li');
    li.className = 'verb-menu-item disabled';
    li.textContent = 'No actions available';
    list.appendChild(li);
  } else {
    availableVerbs.forEach((verb, index) => {
      const li = document.createElement('li');
      li.className = 'verb-menu-item';
      li.dataset.verb = verb;

      const keySpan = document.createElement('span');
      keySpan.className = 'verb-key';
      keySpan.textContent = `[${index + 1}] `;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'verb-name';
      nameSpan.dataset.tooltipType = 'reaction';
      nameSpan.dataset.tooltipVerb = verb;
      nameSpan.textContent = verb;

      li.appendChild(keySpan);
      li.appendChild(nameSpan);
      list.appendChild(li);
    });
  }

  container.appendChild(list);

  const footer = document.createElement('div');
  footer.className = 'verb-menu-footer';
  footer.textContent = 'Press [Esc] to cancel';
  container.appendChild(footer);
}
