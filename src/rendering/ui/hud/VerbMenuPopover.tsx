import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createApplyAction } from '../../../actions/interaction.actions.ts';
import { getComponent } from '../../../core/ecs.ts';
import { queuePlayerIntent, setGameState } from '../../../core/game-loop.ts';
import { getHoverState, setContextMenuAnchor } from '../../../core/hover_state.ts';
import { markAllDomainsDirty } from '../../../core/presentation_queue.ts';
import { ComponentType } from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import type { VerbOption } from '../../../types/intents/interaction.intents.ts';
import { scoreFuzzyTextMatch } from '../../../utils/fuzzy_match.ts';
import { resolveEntityDisplayName } from '../../inspect_tooltip.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { useFocusTrap } from '../primitives/focus_hooks.ts';

const POPOVER_WIDTH_PX = 248;
const POPOVER_HEIGHT_PX = 340;
const VIEWPORT_PAD_PX = 12;

/**
 * Computes a deterministic fuzzy match score for an interaction verb label against `query`,
 * returning `null` if the characters of `query` do not appear in order inside `verb`.
 */
export function scoreFuzzyVerbMatch(query: string, verb: string): number | null {
  return scoreFuzzyTextMatch(query, verb);
}

/**
 * Filters a target's verb options strictly to valid applicable actions and ranks them
 * against a fuzzy search query string.
 */
export function filterFuzzyVerbOptions(options: ReadonlyArray<VerbOption>, query: string): ReadonlyArray<VerbOption> {
  const validOnly = options.filter((opt) => opt.valid);
  const trimmed = query.trim();
  if (trimmed.length === 0) return validOnly;

  const scored: Array<{ readonly option: VerbOption; readonly score: number; readonly index: number }> = [];
  for (let i = 0; i < validOnly.length; i++) {
    const option = validOnly[i]!;
    const score = scoreFuzzyVerbMatch(trimmed, option.verb);
    if (score !== null) {
      scored.push({ option, score, index: i });
    }
  }

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));
  return scored.map((entry) => entry.option);
}

/**
 * Context Interaction Verb Popover rendering valid-only actions with an auto-focused
 * fuzzy search filter, Arrow Up/Down keyboard navigation, mouse hover/click, and Escape dismissal.
 */
export function VerbMenuPopover(): JSX.Element | null {
  const gameState = useUiSelector((s) => s.gameState);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const isOpen = gameState?.uiMode === UIMode.VerbMenu && Boolean(gameState.verbMenu);
  const verbMenuTarget = gameState?.verbMenu?.target;
  useFocusTrap(popoverRef, isOpen, { restoreFocus: true });

  const validOptions = useMemo(
    () => (gameState?.verbMenu ? filterFuzzyVerbOptions(gameState.verbMenu.verbOptions, searchQuery) : []),
    [gameState?.verbMenu, searchQuery]
  );

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setSelectedIndex(0);
    searchInputRef.current?.focus();
    const frameId = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return (): void => cancelAnimationFrame(frameId);
  }, [isOpen, verbMenuTarget]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  const highlightedIndex = validOptions.length > 0 ? Math.max(0, Math.min(selectedIndex, validOptions.length - 1)) : -1;

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    const highlighted = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    highlighted?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightedIndex, isOpen]);

  const closeMenu = (): void => {
    if (!gameState) return;
    setContextMenuAnchor(null);
    setGameState({ ...gameState, uiMode: UIMode.Game, verbMenu: undefined });
    markAllDomainsDirty();
  };

  const executeOption = (option: VerbOption | undefined): void => {
    if (!gameState?.verbMenu || !option?.valid) return;
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

  const handleNavigationKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      if (validOptions.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % validOptions.length);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (validOptions.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + validOptions.length) % validOptions.length);
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (highlightedIndex >= 0) {
        executeOption(validOptions[highlightedIndex]);
      }
    }
  };

  if (!isOpen || !gameState?.verbMenu) {
    return null;
  }

  const { target } = gameState.verbMenu;
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
      role="dialog"
      aria-label={`Actions for ${targetName}`}
      onKeyDown={handleNavigationKeyDown}
    >
      <div className="ui-verb-popover__header">{targetName}</div>
      <div className="ui-verb-popover__search-wrap">
        <input
          ref={searchInputRef}
          type="text"
          className="ui-input ui-verb-popover__search"
          value={searchQuery}
          placeholder="Type to filter actions..."
          aria-label="Filter interaction actions"
          onInput={(e): void => setSearchQuery(e.currentTarget.value)}
        />
      </div>
      <div ref={listRef} className="ui-verb-popover__list" role="listbox" aria-label="Available actions">
        {validOptions.length === 0 ? (
          <div className="ui-field__hint" style={{ padding: '8px' }}>
            {searchQuery.trim().length > 0 ? 'No matching actions' : 'No actions available'}
          </div>
        ) : (
          validOptions.map((option, idx) => {
            const isHighlighted = idx === highlightedIndex;
            return (
              <button
                key={option.verb}
                type="button"
                role="option"
                aria-selected={isHighlighted}
                data-highlighted={isHighlighted ? 'true' : undefined}
                className="ui-verb-popover__item"
                tabIndex={-1}
                onMouseEnter={(): void => setSelectedIndex(idx)}
                onClick={(): void => executeOption(option)}
              >
                <span>{option.verb}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="ui-verb-popover__footer">
        <Button variant="ghost" size="sm" tabIndex={-1} onClick={closeMenu}>
          Cancel [Esc]
        </Button>
      </div>
    </div>
  );
}
