/**
 * @file D&D 3.5e Character Sheet Tab 3:
 * Companions, Familiars, Cohorts & Summons roster table.
 */

import { getComponent } from '../../core/ecs.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import { getPlayerCompanions } from '../../systems/companion_commands.system.ts';
import {
  ComponentType,
  type ControllerLinkComponent,
  type FighterComponent,
  type IdentityComponent,
  type PositionComponent,
  type TemplateComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

function formatStance(stance?: string): string {
  switch (stance) {
    case 'aggressive':
      return 'Aggressive';
    case 'defensive':
      return 'Defensive';
    case 'passive':
      return 'Passive';
    case 'hold':
      return 'Hold Position';
    default:
      return 'Defensive';
  }
}

/**
 * Renders Tab 3: Companions & Summons into `container`.
 */
export function renderSheetCompanionsTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  const tabWrap = document.createElement('div');
  tabWrap.className = 'crpg-companions-tab-wrap';

  const heading = document.createElement('div');
  heading.className = 'crpg-subbanner';
  heading.textContent = 'COMPANIONS & SUMMONS';
  tabWrap.appendChild(heading);

  const companions = getPlayerCompanions(state, playerId);

  if (companions.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'status-empty crpg-companions-empty';
    emptyState.textContent = 'No active animal companions, familiars, cohorts, or summons.';
    tabWrap.appendChild(emptyState);
    container.appendChild(tabWrap);
    return;
  }

  const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent | undefined;

  const tableWrap = document.createElement('div');
  tableWrap.className = 'crpg-companions-table-wrap';

  const tbl = document.createElement('table');
  tbl.className = 'crpg-level-matrix-table crpg-companions-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Name</th><th>Type / HD</th><th>HP</th><th>Stance</th><th>Status</th></tr>';
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');

  for (const compId of companions) {
    const identity = getComponent(state, compId, ComponentType.Identity) as IdentityComponent | undefined;
    const template = getComponent(state, compId, ComponentType.Template) as TemplateComponent | undefined;
    const fighter = getComponent(state, compId, ComponentType.Fighter) as FighterComponent | undefined;
    const link = getComponent(state, compId, ComponentType.ControllerLink) as ControllerLinkComponent | undefined;
    const cPos = getComponent(state, compId, ComponentType.Position) as PositionComponent | undefined;
    const dndData = getDnD35EntityData(state, compId);

    const name = identity?.name ?? template?.templateId?.replace(/_/g, ' ') ?? 'Companion';
    const trackDesc =
      dndData.tracks.map((t) => `${t.trackId.toUpperCase()} ${t.levels} HD`).join(', ') ||
      (dndData.raceId ? `${dndData.raceId.toUpperCase()}` : 'Ally');

    let distText = 'Present';
    if (pPos && cPos) {
      const dist = Math.max(Math.abs(pPos.x - cPos.x), Math.abs(pPos.y - cPos.y));
      distText = dist <= 1 ? 'Following (Adjacent)' : `Following (${dist} tiles)`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="crpg-companion-name-cell"><strong>${name}</strong></td>
      <td>${trackDesc}</td>
      <td>${fighter ? `${fighter.hp} / ${fighter.maxHp}` : '—'}</td>
      <td><span class="crpg-stance-badge ${link?.stance ?? 'defensive'}">${formatStance(link?.stance)}</span></td>
      <td>${distText}</td>
    `;
    tbody.appendChild(tr);
  }

  tbl.appendChild(tbody);
  tableWrap.appendChild(tbl);
  tabWrap.appendChild(tableWrap);
  container.appendChild(tabWrap);
}
