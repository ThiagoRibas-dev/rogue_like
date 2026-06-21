import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { ComponentType, type MemoryComponent } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import { type SelectDialogueOptionIntent, type AskAboutIntent } from '../../types/intents/ui.intents.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { parseWikiSegments } from '../../utils/text.ts';
import { evaluateCondition } from '../../systems/trigger.system.ts';
import { GameEventType, type DialogueSelectedEvent } from '../../types/events.types.ts';

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
  appendWikiSegments(textP, state.activeDialogue.textOverride ?? node.text);
  content.appendChild(textP);

  // Render options
  optionsContainer.innerHTML = '';

  // We need player entity id for intents
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);

  if (!playerEntityId) return;

  if (node.dynamicType === 'ask_about') {
    const playerMemory = getComponent(state, playerEntityId, ComponentType.Memory) as MemoryComponent | undefined;
    const playerKnowledge = playerMemory?.knowledge ?? {};

    for (const [topicId, item] of Object.entries(playerKnowledge)) {
      const btn = document.createElement('button');
      btn.className = 'modal-btn dialogue-option-btn';
      btn.style.textAlign = 'left';
      btn.style.width = '100%';
      btn.style.marginTop = '8px';
      btn.style.whiteSpace = 'normal';
      btn.appendChild(document.createTextNode(`> Ask about: ${item.description}`));

      btn.addEventListener('click', () => {
        queuePlayerIntent({
          type: IntentType.AskAbout,
          entityId: playerEntityId,
          topicId,
          isImmediate: true
        } as AskAboutIntent);
      });

      optionsContainer.appendChild(btn);
    }
  }

  for (const option of node.options) {
    // Condition check
    let valid = true;
    if (option.conditions) {
      const dummyEvent: DialogueSelectedEvent = {
        type: GameEventType.DialogueSelected,
        dialogueId: treeId,
        optionId: option.id
      };
      for (const cond of option.conditions) {
        const evalCond = { ...cond, _npcEntityId: npcEntityId, _playerEntityId: playerEntityId };
        if (!evaluateCondition(state, dummyEvent, evalCond)) {
          valid = false;
          break;
        }
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
