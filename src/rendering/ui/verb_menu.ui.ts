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

  const { availableVerbs, verbOptions, target } = state.verbMenu;

  let targetName = 'Target';
  if (target.type === 'entity') targetName = 'Select Action';
  else if (target.type === 'item') targetName = 'Select Action';
  else if (target.type === 'tile') targetName = 'Tile Options';
  else if (target.type === 'self') targetName = 'Self Options';

  container.replaceChildren(); // Clear old

  const header = document.createElement('div');
  header.className = 'verb-menu-header';
  header.textContent = targetName;
  container.appendChild(header);

  const list = document.createElement('ul');
  list.className = 'verb-menu-list';

  if (verbOptions.length === 0) {
    const li = document.createElement('li');
    li.className = 'verb-menu-item disabled';
    li.textContent = 'No actions available';
    list.appendChild(li);
  } else {
    // Every verb is listed; applicable ones are illuminated and numbered, the rest dimmed.
    for (const option of verbOptions) {
      const li = document.createElement('li');
      li.className = option.valid ? 'verb-menu-item valid' : 'verb-menu-item invalid';
      li.dataset.verb = option.verb;

      if (option.valid) {
        const rank = availableVerbs.indexOf(option.verb);
        if (rank >= 0) {
          const keySpan = document.createElement('span');
          keySpan.className = 'verb-key';
          keySpan.textContent = `[${rank + 1}] `;
          li.appendChild(keySpan);
        }
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'verb-name';
      nameSpan.dataset.tooltipType = 'reaction';
      nameSpan.dataset.tooltipVerb = option.verb;
      nameSpan.textContent = option.verb;

      li.appendChild(nameSpan);
      list.appendChild(li);
    }
  }

  container.appendChild(list);

  const footer = document.createElement('div');
  footer.className = 'verb-menu-footer';
  footer.textContent = 'Press [Esc] to cancel';
  container.appendChild(footer);
}
