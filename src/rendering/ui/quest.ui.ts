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
      span.className = 'wiki-link text-blue-400 cursor-help underline decoration-blue-400/50 decoration-dashed';
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
    questContainer.className = 'mb-4 p-2 bg-gray-800 rounded border border-gray-600';

    const title = document.createElement('h3');
    title.className = `text-lg font-bold mb-1 ${qState.status === 'completed' ? 'text-green-400' : 'text-yellow-400'}`;
    title.textContent = questDef.title;
    questContainer.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'text-gray-300 text-sm mb-2';
    appendWikiSegments(desc, questDef.description);
    questContainer.appendChild(desc);

    const objTitle = document.createElement('div');
    objTitle.className = 'text-gray-400 text-xs uppercase tracking-wide mb-1';
    objTitle.textContent = 'Objectives:';
    questContainer.appendChild(objTitle);

    for (const obj of questDef.objectives) {
      const progress = qState.objectiveProgress[obj.id] || 0;
      const isDone = progress >= obj.requiredAmount;
      const objLine = document.createElement('div');
      objLine.className = `text-sm flex justify-between ${isDone ? 'text-green-500 line-through' : 'text-gray-200'}`;

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
