import type { JSX, TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';
import { getComponent } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { resolveDialogueTree } from '../../../systems/dialogue.system.ts';
import { evaluateCondition } from '../../../systems/trigger.system.ts';
import { ComponentType, type MemoryComponent } from '../../../types/components.types.ts';
import { type DialogueSelectedEvent, GameEventType } from '../../../types/events.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { IntentType } from '../../../types/intents/intent.enum.ts';
import type {
  AskAboutIntent,
  CloseDialogueIntent,
  GossipIntent,
  SelectDialogueOptionIntent
} from '../../../types/intents/ui.intents.ts';
import { resolveEntityDisplayName } from '../../inspect_tooltip.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { WikiText } from './WikiText.tsx';

interface DialogueActionRow {
  readonly key: string;
  readonly text: string;
  readonly isWiki: boolean;
  readonly onSelect: () => void;
}

const MAX_QUICK_PICK_DIGITS = 9;

/**
 * Interactive NPC Dialogue modal supporting inline `<WikiText />` tooltips, dynamic
 * Ask About / Gossip nodes, Arrow Up/Down roving focus, and `1–9` keyboard quick-pick.
 */
export function DialogueModal(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const modalsVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Modals]);
  const listRef = useRef<HTMLDivElement | null>(null);
  void modalsVer;

  if (!state || state.uiMode !== UIMode.Dialogue || !state.activeDialogue) {
    return null;
  }

  const { treeId, currentNodeId, npcEntityId } = state.activeDialogue;
  const tree = resolveDialogueTree(state, treeId, npcEntityId);
  if (!tree) return null;

  const node = tree.nodes[currentNodeId];
  if (!node) return null;

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const npcName = resolveEntityDisplayName(state, npcEntityId);
  const npcMemory = getComponent(state, npcEntityId, ComponentType.Memory) as MemoryComponent | undefined;

  let textToRender = state.activeDialogue.textOverride ?? node.text;
  if (!state.activeDialogue.textOverride && npcMemory?.rumorPool && npcMemory.rumorPool.length > 0) {
    const rumor = npcMemory.rumorPool[0];
    if (rumor) {
      textToRender = `"${rumor.text}"\n\n${textToRender}`;
    }
  }

  const rows: DialogueActionRow[] = [];

  if (node.dynamicType === 'ask_about') {
    const playerMemory = getComponent(state, playerId, ComponentType.Memory) as MemoryComponent | undefined;
    for (const [topicId, item] of Object.entries(playerMemory?.knowledge ?? {})) {
      rows.push({
        key: `ask_${topicId}`,
        text: `Ask about: ${item.description}`,
        isWiki: false,
        onSelect: (): void => {
          const intent: AskAboutIntent = {
            type: IntentType.AskAbout,
            entityId: playerId,
            topicId,
            isImmediate: true
          };
          queuePlayerIntent(intent);
        }
      });
    }
  } else if (node.dynamicType === 'gossip') {
    if (npcMemory?.rumorPool && npcMemory.rumorPool.length > 0) {
      rows.push({
        key: 'gossip_rumor',
        text: 'Gossip',
        isWiki: false,
        onSelect: (): void => {
          const intent: GossipIntent = {
            type: IntentType.Gossip,
            entityId: playerId,
            isImmediate: true
          };
          queuePlayerIntent(intent);
        }
      });
    }
  }

  for (const option of node.options) {
    let valid = true;
    if (option.conditions) {
      const dummyEvent: DialogueSelectedEvent = {
        type: GameEventType.DialogueSelected,
        dialogueId: treeId,
        optionId: option.id
      };
      for (const cond of option.conditions) {
        const evalCond = { ...cond, _npcEntityId: npcEntityId, _playerEntityId: playerId };
        if (!evaluateCondition(state, dummyEvent, evalCond)) {
          valid = false;
          break;
        }
      }
    }
    if (!valid) continue;

    rows.push({
      key: option.id,
      text: option.text,
      isWiki: true,
      onSelect: (): void => {
        const intent: SelectDialogueOptionIntent = {
          type: IntentType.SelectDialogueOption,
          entityId: playerId,
          optionId: option.id,
          isImmediate: true
        };
        queuePlayerIntent(intent);
      }
    });
  }

  const handleClose = (): void => {
    const intent: CloseDialogueIntent = {
      type: IntentType.CloseDialogue,
      entityId: playerId,
      isImmediate: true
    };
    queuePlayerIntent(intent);
  };

  const handleOptionsKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-dialogue-option="true"]');
    if (!buttons || buttons.length === 0) return;

    if (event.key >= '1' && event.key <= String(MAX_QUICK_PICK_DIGITS)) {
      const idx = Number(event.key) - 1;
      const target = rows[idx];
      if (target) {
        event.preventDefault();
        target.onSelect();
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const arr = Array.from(buttons);
      const curIdx = arr.findIndex((b) => b === document.activeElement);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIdx = curIdx < 0 ? 0 : (curIdx + delta + arr.length) % arr.length;
      arr[nextIdx]?.focus();
    }
  };

  return (
    <ModalShell
      title={npcName}
      subtitle="Use Arrow keys + Enter or keys 1–9 to respond"
      size="md"
      onClose={handleClose}
      footer={
        <Button variant="ghost" size="sm" onClick={handleClose}>
          Leave Conversation
        </Button>
      }
    >
      <div onKeyDown={handleOptionsKeyDown}>
        <p className="ui-dialogue-speech">
          <WikiText text={textToRender} />
        </p>

        <div ref={listRef} className="ui-dialogue-options" role="group" aria-label="Dialogue responses">
          {rows.map((row, idx) => (
            <button
              key={row.key}
              type="button"
              className="ui-dialogue-option"
              data-dialogue-option="true"
              onClick={row.onSelect}
            >
              <span className="ui-dialogue-option__index">{idx < MAX_QUICK_PICK_DIGITS ? `[${idx + 1}]` : '›'}</span>
              <span>{row.isWiki ? <WikiText text={row.text} /> : row.text}</span>
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
