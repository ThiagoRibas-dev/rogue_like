import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { parseWikiSegments } from '../../utils/text.ts';
import { getQuestDef } from '../../systems/quest.system.ts';

function appendWikiSegments(container: HTMLElement, text: string) {
  const segments = parseWikiSegments(text);
  for (const seg of segments) {
    if (seg.type) {
      const span = document.createElement('span');
      span.className = 'wiki-link';
      span.style.cssText = 'color: #3498db; cursor: help; text-decoration: underline dashed rgba(52, 152, 219, 0.5);';
      span.dataset.tooltipType = seg.type;
      span.dataset.tooltipId = seg.id;
      span.textContent = seg.text;
      container.appendChild(span);
    } else {
      container.appendChild(document.createTextNode(seg.text));
    }
  }
}

/**
 * Renders the Quest Journal UI panel.
 * @param state The current game state.
 */
export function renderQuestJournal(state: GameState): void {
  const panel = document.getElementById('quest-panel');
  if (!panel) return;

  if (state.uiMode !== UIMode.Quests) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');

  const content = document.getElementById('quest-content');
  if (!content) return;

  content.innerHTML = '';

  const playerEntities = state.entities.filter((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  const playerId = playerEntities[0];
  if (playerId === undefined) return;

  const questLog = getComponent(state, playerId, ComponentType.QuestLog) as
    | import('../../types/components.types.ts').QuestLogComponent
    | undefined;

  if (!questLog || Object.keys(questLog.quests).length === 0) {
    content.innerHTML = '<div class="text-gray-400 italic">No quests in your journal.</div>';
    return;
  }

  for (const [questId, qState] of Object.entries(questLog.quests)) {
    const questDef = getQuestDef(state, questId);
    if (!questDef) continue;

    const questContainer = document.createElement('div');
    questContainer.style.cssText =
      'margin-bottom: 16px; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid var(--border-color); border-radius: 4px;';

    const title = document.createElement('h3');
    title.style.cssText = `margin: 0 0 8px 0; font-size: 1.1rem; color: ${qState.status === 'completed' ? '#2ecc71' : '#f1c40f'};`;
    title.textContent = questDef.title;
    questContainer.appendChild(title);

    const desc = document.createElement('p');
    desc.style.cssText = 'color: var(--text-dim); font-size: 0.9rem; margin-bottom: 12px;';
    appendWikiSegments(desc, questDef.description);
    questContainer.appendChild(desc);

    const objTitle = document.createElement('div');
    objTitle.style.cssText =
      'color: var(--text-dim); font-size: 0.75rem; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 1px;';
    objTitle.textContent = 'Objectives:';
    questContainer.appendChild(objTitle);

    for (const obj of questDef.objectives) {
      const progress = qState.objectiveProgress[obj.id] || 0;
      const isDone = progress >= obj.requiredAmount;
      const objLine = document.createElement('div');
      objLine.style.cssText = `display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px; color: ${isDone ? '#2ecc71' : 'var(--text-color)'}; text-decoration: ${isDone ? 'line-through' : 'none'};`;

      const objDesc = document.createElement('span');
      appendWikiSegments(objDesc, obj.description);
      objLine.appendChild(objDesc);

      const progCount = document.createElement('span');
      progCount.textContent = `${progress} / ${obj.requiredAmount}`;
      objLine.appendChild(progCount);

      questContainer.appendChild(objLine);
    }

    content.appendChild(questContainer);
  }
}
