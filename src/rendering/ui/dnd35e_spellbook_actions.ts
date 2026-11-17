/**
 * @file Vancian & Spontaneous Spell Preparation and Rest Recovery Actions (Milestone 118 / Phase 26).
 * Manages per-class spellbook state, structured slot preparation, spontaneous casting,
 * spontaneous conversion (Cure/Inflict, SNA), and 8-hour rest recovery.
 */

import { addComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { computeClassLevelSlotSummaries, reconcilePreparedSlots } from '../../rulesets/dnd35e/magic/spellbook_slots.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import type { DnD35ClassSpellbookState, DnD35PreparedSlotEntry } from '../../rulesets/dnd35e/types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { ComponentType, type RulesetDataComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { executeEightHourRest } from './dnd35e_rest_actions.ts';

export { executeEightHourRest };

function ensureHydratedClassSlots(
  state: GameState,
  playerId: EntityId,
  book: DnD35ClassSpellbookState
): ReadonlyArray<DnD35PreparedSlotEntry> {
  if (book.preparedSlots && book.preparedSlots.length > 0) {
    return book.preparedSlots;
  }
  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  const summaries = computeClassLevelSlotSummaries(book, dndData, dndData.abilityScores, sys ?? undefined);
  return reconcilePreparedSlots(book, summaries, sys?.spells);
}

function persistUpdatedSpellbookSlots(
  state: GameState,
  playerId: EntityId,
  dndData: ReturnType<typeof getDnD35EntityData>,
  classId: string,
  book: DnD35ClassSpellbookState,
  currentSlots: ReadonlyArray<DnD35PreparedSlotEntry>
): GameState {
  const preparedSpellIds = currentSlots
    .filter((s) => s.preparedSpellId !== undefined && !s.expended)
    .map((s) => s.preparedSpellId!);
  const updatedBook = { ...book, preparedSlots: currentSlots, preparedSpellIds };
  const updatedBooks = { ...(dndData.spellbooksByClass ?? {}), [classId]: updatedBook };
  return addComponent(state, playerId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: { ...dndData, spellbooksByClass: updatedBooks }
  } as RulesetDataComponent);
}

/**
 * Prepares a spell into a specific slot ID.
 */
export function prepareSpellIntoSpecificSlot(
  state: GameState,
  playerId: EntityId,
  classId: string,
  slotId: string,
  spellId: string
): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const book = (dndData.spellbooksByClass ?? {})[classId];
  if (!book) return state;

  const currentSlots = [...ensureHydratedClassSlots(state, playerId, book)];
  const slotIdx = currentSlots.findIndex((s) => s.slotId === slotId);
  if (slotIdx === -1) return state;

  currentSlots[slotIdx] = { ...currentSlots[slotIdx]!, preparedSpellId: spellId, expended: false };
  const nextState = persistUpdatedSpellbookSlots(state, playerId, dndData, classId, book, currentSlots);

  return addMessage(
    nextState,
    `Memorized ${spellId.replace(/_/g, ' ')} into slot [${slotId}]`,
    MessageLogCategory.System
  );
}

/**
 * Prepares a spell into the first available open slot of its level.
 */
export function prepareSpellIntoSlot(
  state: GameState,
  playerId: EntityId,
  classId: string,
  spellId: string,
  slotKind: 'general' | 'domain' | 'specialist' = 'general',
  spellLevel = 0
): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const classBooks = dndData.spellbooksByClass ?? {};
  const book = classBooks[classId];
  if (!book) return state;

  const slots = ensureHydratedClassSlots(state, playerId, book);
  const openSlot = slots.find(
    (s) => s.spellLevel === spellLevel && s.slotKind === slotKind && (!s.preparedSpellId || s.expended)
  );

  if (openSlot) {
    return prepareSpellIntoSpecificSlot(state, playerId, classId, openSlot.slotId, spellId);
  }

  if (slots.length > 0) {
    return addMessage(state, `No open Level ${spellLevel} ${slotKind} slots remaining.`, MessageLogCategory.System);
  }

  const updatedBook = { ...book, preparedSpellIds: [...book.preparedSpellIds, spellId] };
  const nextState = addComponent(state, playerId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: { ...dndData, spellbooksByClass: { ...classBooks, [classId]: updatedBook } }
  } as RulesetDataComponent);

  return addMessage(nextState, `Prepared spell: ${spellId}`, MessageLogCategory.System);
}

/**
 * Clears the prepared spell from a specific slot.
 */
export function unprepareSpecificSlot(
  state: GameState,
  playerId: EntityId,
  classId: string,
  slotId: string
): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const book = (dndData.spellbooksByClass ?? {})[classId];
  if (!book) return state;

  const currentSlots = [...ensureHydratedClassSlots(state, playerId, book)];
  const slotIdx = currentSlots.findIndex((s) => s.slotId === slotId);
  if (slotIdx === -1) return state;

  const oldSlot = currentSlots[slotIdx]!;
  const removedName = oldSlot.preparedSpellId;
  currentSlots[slotIdx] = {
    slotId: oldSlot.slotId,
    spellLevel: oldSlot.spellLevel,
    slotKind: oldSlot.slotKind,
    expended: false
  };

  const nextState = persistUpdatedSpellbookSlots(state, playerId, dndData, classId, book, currentSlots);
  return addMessage(nextState, `Unprepared slot [${slotId}] (${removedName ?? 'empty'})`, MessageLogCategory.System);
}

/**
 * Legacy unprepare function for index-based removal.
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
 * Helper to dispatch 8-hour rest and update state.
 */
export function applyRestAction(state: GameState, playerId: EntityId): void {
  const next = executeEightHourRest(state, playerId);
  setGameState(next);
  markAllDomainsDirty();
}
