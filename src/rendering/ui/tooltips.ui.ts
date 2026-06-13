import { type GameState, type EntityId } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { UITooltipType, UIStatId } from '../../constants/ui.constants.ts';
import { getEffectiveStats } from '../../utils/stats.ts';

/**
 * Initializes the global UI tooltip system using event delegation.
 * @param getState Function to retrieve the current GameState.
 */
export function initUITooltips(getState: () => GameState | undefined): void {
  const tooltip = document.getElementById('ui-tooltip');
  if (!tooltip) return;

  const handleMouseMove = (e: MouseEvent) => {
    // Look for a target with data-tooltip-type
    const target = (e.target as HTMLElement).closest('[data-tooltip-type]') as HTMLElement | null;

    if (!target) {
      tooltip.classList.add('hidden');
      return;
    }

    const state = getState();
    if (!state) return;

    const type = target.dataset.tooltipType;
    const id = target.dataset.tooltipId;

    let contentHTML = '';

    if (type === UITooltipType.Item && id) {
      const entityId = parseInt(id, 10) as EntityId;
      const itemComp = getComponent(state, entityId, ComponentType.Item);
      if (itemComp) {
        const itemDef = state.campaign.items[itemComp.itemId];
        const isIdentified = state.identifiedItems.has(itemComp.itemId);
        const name = isIdentified
          ? itemDef?.name
          : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? itemDef?.unidentifiedName ?? itemComp.itemId);

        contentHTML += `<div class="ui-tooltip-header">${name}</div>`;
        if (itemDef?.description && isIdentified) {
          contentHTML += `<div class="ui-tooltip-desc">${itemDef.description}</div>`;
        }
      }
    } else if (type === UITooltipType.Status && id) {
      const def = state.campaign.status[id];
      if (def) {
        contentHTML += `<div class="ui-tooltip-header" style="color: ${def.color ?? 'inherit'}">${def.name}</div>`;
        if (def.description) {
          contentHTML += `<div class="ui-tooltip-desc">${def.description}</div>`;
        }
      }
    } else if (type === UITooltipType.Entity && id) {
      const def = state.campaign.entities[id];
      if (def) {
        contentHTML += `<div class="ui-tooltip-header" style="color: ${def.fg ?? 'inherit'}">${def.name}</div>`;
        contentHTML += `<div class="ui-tooltip-desc">A creature of the world.</div>`;
        if (def.fighter) {
          contentHTML += `<div class="ui-tooltip-stat"><span>HP</span><span>${def.fighter.maxHp}</span></div>`;
          contentHTML += `<div class="ui-tooltip-stat"><span>Attack</span><span>${def.fighter.attack}</span></div>`;
          contentHTML += `<div class="ui-tooltip-stat"><span>Defense</span><span>${def.fighter.defense}</span></div>`;
        }
      }
    } else if (type === UITooltipType.Stat && id) {
      const playerEntityId = state.entities.find((eid) => getComponent(state, eid, ComponentType.Player) !== undefined);
      if (playerEntityId !== undefined) {
        const fighter = getComponent(state, playerEntityId, ComponentType.Fighter);
        const stats = getEffectiveStats(state, playerEntityId);

        if (id === UIStatId.HP && fighter) {
          contentHTML += `<div class="ui-tooltip-header">Health Points</div>`;
          contentHTML += `<div class="ui-tooltip-desc">Current health. If this reaches 0, you die.</div>`;
          contentHTML += `<div class="ui-tooltip-stat"><span>Base Max HP</span><span>${fighter.maxHp}</span></div>`;
          const bonus = stats.maxHp - fighter.maxHp;
          if (bonus !== 0) {
            contentHTML += `<div class="ui-tooltip-stat"><span>Bonus</span><span>${bonus > 0 ? '+' : ''}${bonus}</span></div>`;
          }
        } else if (id === UIStatId.Attack && fighter) {
          contentHTML += `<div class="ui-tooltip-header">Attack Power</div>`;
          contentHTML += `<div class="ui-tooltip-desc">Damage dealt with melee attacks.</div>`;
          contentHTML += `<div class="ui-tooltip-stat"><span>Base Attack</span><span>${fighter.attack}</span></div>`;
          const bonus = stats.attack - fighter.attack;
          if (bonus !== 0) {
            contentHTML += `<div class="ui-tooltip-stat"><span>Bonus</span><span>${bonus > 0 ? '+' : ''}${bonus}</span></div>`;
          }
        } else if (id === UIStatId.Defense && fighter) {
          contentHTML += `<div class="ui-tooltip-header">Defense</div>`;
          contentHTML += `<div class="ui-tooltip-desc">Reduces incoming physical damage.</div>`;
          contentHTML += `<div class="ui-tooltip-stat"><span>Base Defense</span><span>${fighter.defense}</span></div>`;
          const bonus = stats.defense - fighter.defense;
          if (bonus !== 0) {
            contentHTML += `<div class="ui-tooltip-stat"><span>Bonus</span><span>${bonus > 0 ? '+' : ''}${bonus}</span></div>`;
          }
        }
      }
    }

    if (contentHTML) {
      tooltip.innerHTML = contentHTML;
      tooltip.classList.remove('hidden');

      // Position tooltip near cursor, offset to not be under the cursor
      const offset = 15;

      // Calculate position
      let x = e.clientX + offset;
      let y = e.clientY + offset;

      // Keep within bounds
      const rect = tooltip.getBoundingClientRect();
      if (x + rect.width > window.innerWidth) {
        x = e.clientX - rect.width - offset;
      }
      if (y + rect.height > window.innerHeight) {
        y = e.clientY - rect.height - offset;
      }

      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    } else {
      tooltip.classList.add('hidden');
    }
  };

  document.body.addEventListener('mousemove', handleMouseMove);

  // Hide when mouse leaves
  document.body.addEventListener('mouseleave', () => {
    tooltip.classList.add('hidden');
  });
}
