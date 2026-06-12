import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { IntentType, type SelectDialogueOptionIntent } from '../../types/intents.types.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { parseWikiSegments } from '../../utils/text.ts';

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
 * Renders the Dialogue modal overlay.
 * @param state The current GameState.
 */
export function renderDialoguePanel(state: GameState): void {
  const overlay = document.getElementById('dialogue-overlay');
  const content = document.getElementById('dialogue-content');
  const optionsContainer = document.getElementById('dialogue-options');
  if (!overlay || !content || !optionsContainer) return;

  if (state.uiMode !== UIMode.Dialogue || !state.activeDialogue) {
    overlay.classList.add('hidden');
    return;
  }

  const { treeId, currentNodeId, npcEntityId } = state.activeDialogue;
  const tree = state.campaign.dialogues[treeId];
  if (!tree) {
    overlay.classList.add('hidden');
    return;
  }

  const node = tree.nodes[currentNodeId];
  if (!node) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');

  // Find NPC name
  let npcName = 'Unknown';
  // Try to find a renderable or specific component if possible. In our case, entity templates have names but we don't store names on instances directly unless it's in a specific component.
  // Wait, if it's persistent we might have it. Or we can just look at RenderableComponent's glyph or something, but name isn't there.
  // We'll just say "Stranger" for now, or fetch from campaign entities if we added an id.
  const renderable = getComponent(state, npcEntityId, ComponentType.Renderable);
  if (renderable) {
    // Attempt to match glyph to entity template name if we really wanted to, but this is a hack.
    const template = Object.values(state.campaign.entities).find(
      (e) => e.glyph === renderable.glyph && e.fg === renderable.fg
    );
    if (template) npcName = template.name;
  }

  const titleEl = overlay.querySelector('.modal-title');
  if (titleEl) titleEl.textContent = npcName;

  // Render text
  content.innerHTML = '';
  const textP = document.createElement('p');
  textP.style.color = 'var(--text-color)';
  textP.style.fontSize = '1.1rem';
  textP.style.lineHeight = '1.5';
  textP.style.marginBottom = '20px';
  appendWikiSegments(textP, node.text);
  content.appendChild(textP);

  // Render options
  optionsContainer.innerHTML = '';

  // We need player entity id for intents
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);

  if (!playerEntityId) return;

  for (const option of node.options) {
    // Condition check
    let valid = true;
    if (option.conditions) {
      const memory = getComponent(state, npcEntityId, ComponentType.Memory);
      for (const cond of option.conditions) {
        if (cond.type === 'faction_standing') {
          const standing = memory?.factionStandings[cond.target] ?? 0;
          if (cond.operator === '>=') valid = standing >= (cond.value ?? 0);
          else if (cond.operator === '<=') valid = standing <= (cond.value ?? 0);
          else valid = standing === (cond.value ?? 0);
        } else if (cond.type === 'has_fact') {
          valid = memory?.facts.includes(cond.target) ?? false;
        } else if (cond.type === 'not_has_fact') {
          valid = !(memory?.facts.includes(cond.target) ?? false);
        } else if (cond.type === 'quest_status') {
          const questLog = getComponent(state, playerEntityId, ComponentType.QuestLog) as
            | import('../../types/components.types.ts').QuestLogComponent
            | undefined;
          const qStatus = questLog?.quests[cond.target]?.status;

          if (cond.operator === '==') {
            // For '==', cond.value isn't a string so we might need a workaround or check payload
            // Actually cond.value is a number. We need to check if quest status equals a string.
            // Our schema for cond.value is a number. We can map: 0 = active, 1 = completed, 2 = failed.
            const numStatus = qStatus === 'active' ? 0 : qStatus === 'completed' ? 1 : qStatus === 'failed' ? 2 : -1;
            valid = numStatus === cond.value;
          }
        }
        if (!valid) break;
      }
    }

    if (!valid) continue;

    const btn = document.createElement('button');
    btn.className = 'modal-btn dialogue-option-btn';
    btn.style.textAlign = 'left';
    btn.style.width = '100%';
    btn.style.marginTop = '8px';
    btn.style.whiteSpace = 'normal';
    btn.appendChild(document.createTextNode('> '));
    appendWikiSegments(btn, option.text);

    btn.addEventListener('click', () => {
      // Actually wait, we should dispatch an intent, but we need createSelectDialogueOptionIntent.
      // We will create those action creators in core.actions.ts right now since we missed them.
      // We can also just push the intent directly.
      queuePlayerIntent({
        type: IntentType.SelectDialogueOption,
        entityId: playerEntityId,
        optionId: option.id,
        isImmediate: true
      } as SelectDialogueOptionIntent);
    });

    optionsContainer.appendChild(btn);
  }
}
