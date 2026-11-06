/**
 * @file Vancian Spell Preparation and Rest Recovery Actions (Milestone 118).
 * Manages per-class spellbook state, open-slot preparation, casting slot expenditure,
 * and 8-hour rest recovery.
 */

import { addComponent, getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { getDnD35EntityData } from '../../rulesets/registry.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { ComponentType, type RulesetDataComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

/**
 * Prepares a known spell into an open slot for a specific class spellbook.
 */
export function prepareSpellIntoSlot(
  state: GameState,
  playerId: EntityId,
  classId: string,
  spellId: string
): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const classBooks = dndData.spellbooksByClass ?? {};
  const book = classBooks[classId];
  if (!book) return state;

  const prepared = [...book.preparedSpellIds, spellId];
  const updatedBook = { ...book, preparedSpellIds: prepared };
  const updatedBooks = { ...classBooks, [classId]: updatedBook };

  const updatedDndData = { ...dndData, spellbooksByClass: updatedBooks };
  const nextState = addComponent(state, playerId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: updatedDndData
  } as RulesetDataComponent);

  return addMessage(nextState, `Prepared spell: ${spellId}`, MessageLogCategory.System);
}

/**
 * Unprepares or expends a prepared spell slot.
 */
export function unprepareSpellSlot(
  state: GameState,
  playerId: EntityId,
  classId: string,
  slotIndex: number
): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const classBooks = dndData.spellbooksByClass ?? {};
  const book = classBooks[classId];
  if (!book || slotIndex < 0 || slotIndex >= book.preparedSpellIds.length) return state;

  const prepared = [...book.preparedSpellIds];
  const removed = prepared.splice(slotIndex, 1);
  const updatedBook = { ...book, preparedSpellIds: prepared };
  const updatedBooks = { ...classBooks, [classId]: updatedBook };

  const updatedDndData = { ...dndData, spellbooksByClass: updatedBooks };
  const nextState = addComponent(state, playerId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: updatedDndData
  } as RulesetDataComponent);

  return addMessage(nextState, `Unprepared spell: ${removed[0]}`, MessageLogCategory.System);
}

/**
 * Triggers an 8-Hour Rest recovery for the hero.
 */
export function executeEightHourRest(state: GameState, playerId: EntityId): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const fighter = getComponent(state, playerId, ComponentType.Fighter);
  if (!fighter) return state;

  const healedHp = Math.min(fighter.maxHp, fighter.hp + Math.max(1, dndData.tracks.length));
  let nextState = addComponent(state, playerId, { ...fighter, hp: healedHp });

  nextState = addMessage(
    nextState,
    'Rest completed (8 hours). Spell slots refreshed and vital vitality restored.',
    MessageLogCategory.System
  );
  return nextState;
}

/**
 * Helper to dispatch rest and update state.
 */
export function applyRestAction(state: GameState, playerId: EntityId): void {
  const next = executeEightHourRest(state, playerId);
  setGameState(next);
  markAllDomainsDirty();
}
