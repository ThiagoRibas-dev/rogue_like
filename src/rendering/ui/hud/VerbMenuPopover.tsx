import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { createApplyAction } from '../../../actions/interaction.actions.ts';
import { getComponent } from '../../../core/ecs.ts';
import { queuePlayerIntent, setGameState } from '../../../core/game-loop.ts';
import { getHoverState, setContextMenuAnchor } from '../../../core/hover_state.ts';
import { markAllDomainsDirty } from '../../../core/presentation_queue.ts';
import { ComponentType } from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { resolveEntityDisplayName } from '../../inspect_tooltip.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { useFocusTrap, useRovingFocus } from '../primitives/focus_hooks.ts';
import { Keycap } from '../primitives/Keycap.tsx';

const POPOVER_WIDTH_PX = 240;
const POPOVER_HEIGHT_PX = 280;
const VIEWPORT_PAD_PX = 12;

/**
 * Context Interaction Verb Popover supporting Arrow Up/Down roving focus, `1–9` number shortcuts,
 * `Enter`, and `Escape` dismissal.
 */
export function VerbMenuPopover(): JSX.Element | null {
  const gameState = useUiSelector((s) => s.gameState);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const isOpen = gameState?.uiMode === UIMode.VerbMenu && Boolean(gameState.verbMenu);
  useFocusTrap(popoverRef, isOpen, { restoreFocus: true });

  const sortedOptions = gameState?.verbMenu
    ? [...gameState.verbMenu.verbOptions].sort((a, b) => Number(b.valid) - Number(a.valid))
    : [];

  const closeMenu = (): void => {
    if (!gameState) return;
    setContextMenuAnchor(null);
    setGameState({ ...gameState, uiMode: UIMode.Game, verbMenu: undefined });
    markAllDomainsDirty();
  };

  const executeOption = (idx: number): void => {
    if (!gameState?.verbMenu) return;
    const option = sortedOptions[idx];
    if (!option?.valid) return;
    const playerEntityId = gameState.entities.find(
      (id) => getComponent(gameState, id, ComponentType.Player) !== undefined
    );
    if (playerEntityId === undefined) return;
    const { target, toolEntityId } = gameState.verbMenu;
    setContextMenuAnchor(null);
    setGameState({ ...gameState, uiMode: UIMode.Game, verbMenu: undefined });
    queuePlayerIntent(createApplyAction(playerEntityId, option.verb, target, toolEntityId));
    markAllDomainsDirty();
  };

  const roving = useRovingFocus({
    count: sortedOptions.length,
    orientation: 'vertical',
    onIndexChange: (idx): void => {
      const btns = popoverRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      btns?.[idx]?.focus();
    },
    onActivate: (idx): void => executeOption(idx)
  });

  if (!isOpen || !gameState?.verbMenu) {
    return null;
  }

  const { availableVerbs, target } = gameState.verbMenu;
  let targetName = 'Target';
  if (target.type === 'entity') targetName = resolveEntityDisplayName(gameState, target.entityId);
  else if (target.type === 'item') targetName = resolveEntityDisplayName(gameState, target.itemEntityId);
  else if (target.type === 'tile') targetName = `Tile (${target.x}, ${target.y})`;
  else if (target.type === 'self') targetName = 'Self Actions';

  const anchor = getHoverState().contextMenuAnchor;
  const posStyle: Record<string, string> =
    anchor !== null
      ? {
          left: `${Math.max(VIEWPORT_PAD_PX, Math.min(window.innerWidth - POPOVER_WIDTH_PX - VIEWPORT_PAD_PX, anchor.x + 8))}px`,
          top: `${Math.max(VIEWPORT_PAD_PX, Math.min(window.innerHeight - POPOVER_HEIGHT_PX - VIEWPORT_PAD_PX, anchor.y + 8))}px`
        }
      : {
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)'
        };

  return (
    <div
      ref={popoverRef}
      className="ui-verb-popover"
      style={posStyle}
      role="menu"
      aria-label={`Actions for ${targetName}`}
      onKeyDown={roving.handleKeyDown}
    >
      <div className="ui-verb-popover__header">{targetName}</div>
      <div className="ui-verb-popover__list">
        {sortedOptions.length === 0 ? (
          <div className="ui-field__hint" style={{ padding: '8px' }}>
            No actions available
          </div>
        ) : (
          sortedOptions.map((option, idx) => {
            const rank = option.valid ? availableVerbs.indexOf(option.verb) : -1;
            return (
              <button
                key={`${option.verb}_${idx}`}
                type="button"
                role="menuitem"
                className="ui-verb-popover__item"
                disabled={!option.valid}
                tabIndex={roving.getTabIndex(idx)}
                onClick={(): void => executeOption(idx)}
              >
                <span>{option.verb}</span>
                {rank >= 0 ? <Keycap fallbackLabel={String(rank + 1)} /> : null}
              </button>
            );
          })
        )}
      </div>
      <div style={{ padding: '4px', borderTop: '1px solid var(--ui-border-subtle)' }}>
        <Button variant="ghost" size="sm" onClick={closeMenu}>
          Cancel [Esc]
        </Button>
      </div>
    </div>
  );
}
