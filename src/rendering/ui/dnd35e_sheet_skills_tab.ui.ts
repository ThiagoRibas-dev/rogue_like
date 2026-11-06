/**
 * @file D&D 3.5e Character Sheet Skills Tab (Milestone 118).
 * Renders all trained & untrained skills with Ranks, Ability Modifier, Synergies,
 * Armor Check Penalty, and interactive `[Use Skill]` buttons for dungeon & social skills.
 */

import { createApplyAction } from '../../actions/interaction.actions.ts';
import type { Verb } from '../../constants/verbs.constants.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { evaluateActorSkillCheck, getDnD35EntityData, getDnD35SystemContent } from '../../rulesets/registry.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

const NOMINAL_PREVIEW_DC = 10;

const ACTIVE_SKILL_VERBS: Readonly<Record<string, Verb>> = {
  search: 'search',
  open_lock: 'unlock',
  disable_device: 'disarm',
  heal: 'heal',
  intimidate: 'intimidate',
  diplomacy: 'persuade'
};

const TABLE_COLUMNS: ReadonlyArray<{ readonly cls: string; readonly label: string }> = [
  { cls: 'col-name', label: 'Skill' },
  { cls: 'col-key', label: 'Key' },
  { cls: 'col-ranks', label: 'Ranks' },
  { cls: 'col-mod', label: 'Total' },
  { cls: 'col-act', label: 'Action' }
];

/**
 * Renders Tab 4: Skills of the Heroic Character Sheet.
 */
export function renderSheetSkillsTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  container.replaceChildren();

  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys?.skills) {
    const err = document.createElement('div');
    err.className = 'status-empty';
    err.textContent = 'No skill definitions available.';
    container.appendChild(err);
    return;
  }

  const table = document.createElement('div');
  table.className = 'sheet-skills-table';

  const thead = document.createElement('div');
  thead.className = 'skills-table-header';
  for (const col of TABLE_COLUMNS) {
    const colSpan = document.createElement('span');
    colSpan.className = col.cls;
    colSpan.textContent = col.label;
    thead.appendChild(colSpan);
  }
  table.appendChild(thead);

  const skillsList = Object.values(sys.skills);
  for (const skill of skillsList) {
    const ranks = dndData.skillRanks[skill.id] ?? 0;
    const { check } = evaluateActorSkillCheck(state, playerId, skill.id, NOMINAL_PREVIEW_DC);
    const totalBonus = check.totalModifier;
    const sign = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;
    const keyAb = skill.keyAbility.toUpperCase();

    const row = document.createElement('div');
    row.className = 'skills-table-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'col-name';
    nameSpan.textContent = skill.name;
    row.appendChild(nameSpan);

    const keySpan = document.createElement('span');
    keySpan.className = 'col-key';
    keySpan.textContent = keyAb;
    row.appendChild(keySpan);

    const rankSpan = document.createElement('span');
    rankSpan.className = 'col-ranks';
    rankSpan.textContent = ranks.toString();
    row.appendChild(rankSpan);

    const modSpan = document.createElement('strong');
    modSpan.className = 'col-mod';
    modSpan.textContent = sign;
    row.appendChild(modSpan);

    const actSpan = document.createElement('span');
    actSpan.className = 'col-act';

    const verb = ACTIVE_SKILL_VERBS[skill.id];
    if (verb !== undefined) {
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'skill-use-btn';
      useBtn.textContent = 'Use';
      useBtn.title = `Perform active ${skill.name} check`;
      useBtn.addEventListener('click', () => {
        queuePlayerIntent(createApplyAction(playerId, verb, { type: 'self' }));
        markAllDomainsDirty();
      });
      actSpan.appendChild(useBtn);
    } else {
      actSpan.textContent = '—';
    }
    row.appendChild(actSpan);

    table.appendChild(row);
  }

  container.appendChild(table);
}
