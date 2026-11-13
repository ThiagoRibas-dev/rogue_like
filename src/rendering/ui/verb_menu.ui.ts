import { createApplyAction } from '../../actions/interaction.actions.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent, setGameState } from '../../core/game-loop.ts';
import { getHoverState, setContextMenuAnchor } from '../../core/hover_state.ts';
import { resolveEntityDisplayName } from '../inspect_tooltip.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { UIMode } from '../../types/game-state.types.ts';

/** Estimated popover width for viewport clamping. */
const POPOVER_WIDTH_PX = 220;
/** Estimated popover height for viewport clamping. */
const POPOVER_HEIGHT_PX = 280;
/** Viewport edge padding in pixels. */
const VIEWPORT_PAD_PX = 12;

/**
 * Renders the context interaction verb overlay when multiple options are present.
 * Positions as a RimWorld-style floating popover near the right-click cursor when opened by mouse,
 * or centered when opened via keyboard.
 *
 * @param state The current GameState.
 */
export function renderVerbMenu(state: GameState): void {
  const container = document.getElementById('verb-menu');
  if (!container) return;

  if (state.uiMode !== UIMode.VerbMenu || !state.verbMenu) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  const anchor = getHoverState().contextMenuAnchor;
  if (anchor !== null) {
    const clampedX = Math.max(
      VIEWPORT_PAD_PX,
      Math.min(window.innerWidth - POPOVER_WIDTH_PX - VIEWPORT_PAD_PX, anchor.x + 8)
    );
    const clampedY = Math.max(
      VIEWPORT_PAD_PX,
      Math.min(window.innerHeight - POPOVER_HEIGHT_PX - VIEWPORT_PAD_PX, anchor.y + 8)
    );
    container.style.left = `${clampedX}px`;
    container.style.top = `${clampedY}px`;
    container.style.transform = 'none';
  } else {
    container.style.left = '50%';
    container.style.top = '50%';
    container.style.transform = 'translate(-50%, -50%)';
  }

  const { availableVerbs, verbOptions, target, toolEntityId } = state.verbMenu;
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);

  let targetName = 'Target';
  if (target.type === 'entity') targetName = resolveEntityDisplayName(state, target.entityId);
  else if (target.type === 'item') targetName = resolveEntityDisplayName(state, target.itemEntityId);
  else if (target.type === 'tile') targetName = `Tile (${target.x}, ${target.y})`;
  else if (target.type === 'self') targetName = 'Self Actions';

  container.replaceChildren();

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
    // Sort applicable verbs to the top for instant RimWorld-style scanning while preserving all verbs
    const sortedOptions = [...verbOptions].sort((a, b) => Number(b.valid) - Number(a.valid));

    for (const option of sortedOptions) {
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

        if (playerEntityId !== undefined) {
          li.addEventListener('click', (e) => {
            e.stopPropagation();
            setContextMenuAnchor(null);
            setGameState({ ...state, uiMode: UIMode.Game, verbMenu: undefined });
            queuePlayerIntent(createApplyAction(playerEntityId, option.verb, target, toolEntityId));
          });
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

  const footer = document.createElement('button');
  footer.type = 'button';
  footer.className = 'verb-menu-footer';
  footer.textContent = 'Cancel [Esc]';
  footer.addEventListener('click', (e) => {
    e.stopPropagation();
    setContextMenuAnchor(null);
    setGameState({ ...state, uiMode: UIMode.Game, verbMenu: undefined });
  });
  container.appendChild(footer);
}
