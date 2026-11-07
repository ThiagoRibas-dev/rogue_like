/**
 * @file Vancian & Spontaneous Spell Preparation and Rest Recovery Actions (Milestone 118 / Phase 26).
 * Manages per-class spellbook state, structured slot preparation, spontaneous casting,
 * spontaneous conversion (Cure/Inflict, SNA), and 8-hour rest recovery.
 */

import { addComponent, getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { getDnD35EntityData } from '../../rulesets/registry.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { ComponentType, type RulesetDataComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

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
  const classBooks = dndData.spellbooksByClass ?? {};
  const book = classBooks[classId];
  if (!book) return state;

  const currentSlots = book.preparedSlots ? [...book.preparedSlots] : [];
  const slotIdx = currentSlots.findIndex((s) => s.slotId === slotId);
  if (slotIdx === -1) return state;

  const oldSlot = currentSlots[slotIdx]!;
  currentSlots[slotIdx] = {
    ...oldSlot,
    preparedSpellId: spellId,
    expended: false
  };

  // Keep legacy preparedSpellIds in sync
  const preparedSpellIds = currentSlots
    .filter((s) => s.preparedSpellId !== undefined && !s.expended)
    .map((s) => s.preparedSpellId!);

  const updatedBook = {
    ...book,
    preparedSlots: currentSlots,
    preparedSpellIds
  };
  const updatedBooks = { ...classBooks, [classId]: updatedBook };
  const updatedDndData = { ...dndData, spellbooksByClass: updatedBooks };

  const nextState = addComponent(state, playerId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: updatedDndData
  } as RulesetDataComponent);

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

  const slots = book.preparedSlots ?? [];
  const openSlot = slots.find(
    (s) => s.spellLevel === spellLevel && s.slotKind === slotKind && (!s.preparedSpellId || s.expended)
  );

  if (openSlot) {
    return prepareSpellIntoSpecificSlot(state, playerId, classId, openSlot.slotId, spellId);
  }

  // Fallback if structured slots not initialized
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
 * Clears the prepared spell from a specific slot.
 */
export function unprepareSpecificSlot(
  state: GameState,
  playerId: EntityId,
  classId: string,
  slotId: string
): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const classBooks = dndData.spellbooksByClass ?? {};
  const book = classBooks[classId];
  if (!book) return state;

  const currentSlots = book.preparedSlots ? [...book.preparedSlots] : [];
  const slotIdx = currentSlots.findIndex((s) => s.slotId === slotId);
  if (slotIdx === -1) return state;

  const oldSlot = currentSlots[slotIdx]!;
  const removedName = oldSlot.preparedSpellId;
  currentSlots[slotIdx] = {
    ...oldSlot,
    preparedSpellId: undefined,
    expended: false
  };

  const preparedSpellIds = currentSlots
    .filter((s) => s.preparedSpellId !== undefined && !s.expended)
    .map((s) => s.preparedSpellId!);

  const updatedBook = {
    ...book,
    preparedSlots: currentSlots,
    preparedSpellIds
  };
  const updatedBooks = { ...classBooks, [classId]: updatedBook };
  const updatedDndData = { ...dndData, spellbooksByClass: updatedBooks };

  const nextState = addComponent(state, playerId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: updatedDndData
  } as RulesetDataComponent);

  return addMessage(nextState, `Unprepared slot [${slotId}] (${removedName ?? 'empty'})`, MessageLogCategory.System);
}

/**
 * Casts a prepared spell slot or spontaneously converts and casts it.
 */
export function castPreparedSlot(
  state: GameState,
  playerId: EntityId,
  classId: string,
  slotId: string,
  convertedSpellId?: string
): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const classBooks = dndData.spellbooksByClass ?? {};
  const book = classBooks[classId];
  if (!book) return state;

  const currentSlots = book.preparedSlots ? [...book.preparedSlots] : [];
  const slotIdx = currentSlots.findIndex((s) => s.slotId === slotId);
  if (slotIdx === -1) return state;

  const slot = currentSlots[slotIdx]!;
  if (slot.expended || !slot.preparedSpellId) return state;

  const castSpellName = convertedSpellId ?? slot.preparedSpellId;
  currentSlots[slotIdx] = {
    ...slot,
    expended: true
  };

  const preparedSpellIds = currentSlots
    .filter((s) => s.preparedSpellId !== undefined && !s.expended)
    .map((s) => s.preparedSpellId!);

  const updatedBook = {
    ...book,
    preparedSlots: currentSlots,
    preparedSpellIds
  };
  const updatedBooks = { ...classBooks, [classId]: updatedBook };
  const updatedDndData = { ...dndData, spellbooksByClass: updatedBooks };

  const nextState = addComponent(state, playerId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: updatedDndData
  } as RulesetDataComponent);

  const msg = convertedSpellId
    ? `Spontaneously converted slot [${slotId}] and cast: ${convertedSpellId.replace(/_/g, ' ')}`
    : `Cast spell: ${castSpellName.replace(/_/g, ' ')} (expended slot [${slotId}])`;
  return addMessage(nextState, msg, MessageLogCategory.System);
}

/**
 * Spontaneous caster expending a daily slot of a given level.
 */
export function castSpontaneousSpell(
  state: GameState,
  playerId: EntityId,
  classId: string,
  spellId: string,
  spellLevel: number
): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const classBooks = dndData.spellbooksByClass ?? {};
  const book = classBooks[classId];
  if (!book) return state;

  const usedMap = { ...(book.spontaneousSlotsUsedByLevel ?? {}) };
  const lvlKey = String(spellLevel);
  usedMap[lvlKey] = (usedMap[lvlKey] ?? 0) + 1;

  const updatedBook = {
    ...book,
    spontaneousSlotsUsedByLevel: usedMap
  };
  const updatedBooks = { ...classBooks, [classId]: updatedBook };
  const updatedDndData = { ...dndData, spellbooksByClass: updatedBooks };

  const nextState = addComponent(state, playerId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: updatedDndData
  } as RulesetDataComponent);

  return addMessage(
    nextState,
    `Spontaneously cast: ${spellId.replace(/_/g, ' ')} (used Level ${spellLevel} slot)`,
    MessageLogCategory.System
  );
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
 * Triggers an 8-Hour Rest recovery for the hero.
 * Recharges all expended spell slots back to unexpended WITHOUT wiping memorized spells,
 * resets spontaneous slots, and heals vitality.
 */
export function executeEightHourRest(state: GameState, playerId: EntityId): GameState {
  const dndData = getDnD35EntityData(state, playerId);
  const fighter = getComponent(state, playerId, ComponentType.Fighter);
  if (!fighter) return state;

  const healedHp = Math.min(fighter.maxHp, fighter.hp + Math.max(1, dndData.tracks.length));
  let nextState = addComponent(state, playerId, { ...fighter, hp: healedHp });

  const classBooks = dndData.spellbooksByClass ?? {};
  let changed = false;
  const refreshedBooks: Record<string, (typeof classBooks)[string]> = {};

  for (const [cid, book] of Object.entries(classBooks)) {
    let slots = book.preparedSlots;
    if (slots && slots.length > 0) {
      slots = slots.map((s) => (s.expended ? { ...s, expended: false } : s));
    }
    const preparedSpellIds = slots
      ? slots.filter((s) => s.preparedSpellId !== undefined).map((s) => s.preparedSpellId!)
      : book.preparedSpellIds;

    refreshedBooks[cid] = {
      ...book,
      preparedSlots: slots,
      preparedSpellIds,
      spontaneousSlotsUsedByLevel: {}
    };
    changed = true;
  }

  if (changed) {
    const updatedDndData = { ...dndData, spellbooksByClass: refreshedBooks };
    nextState = addComponent(nextState, playerId, {
      type: ComponentType.RulesetData,
      rulesetId: 'dnd35e',
      payload: updatedDndData
    } as RulesetDataComponent);
  }

  nextState = addMessage(
    nextState,
    'Rest completed (8 hours). All daily spell slots refreshed and vitality restored.',
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
