/**
 * @file Unified D&D 3.5e Spell Cast UI Dispatcher.
 * Bridges Hotbar, Quickcast Overlay, and Spellbook buttons to the Turn/RTwP Targeting
 * & Execution Pipeline without bypassing `applyIntentWithCost` or Monster Turn progression.
 */

import { createFireAimedAction, createToggleTargetingAction } from '../../actions/targeting.actions.ts';
import { getComponent } from '../../core/ecs.ts';
import { getGameState, queuePlayerIntent, setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { computeSpellRangeTiles, summarizeMetamagic } from '../../rulesets/dnd35e/magic/spell_cast_helpers.ts';
import { FEET_PER_GRID_SQUARE } from '../../rulesets/dnd35e/spatial/grid_geometry.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { ComponentType, type PositionComponent } from '../../types/components.types.ts';
import { type EntityId, type GameState, type TargetingContext, UIMode } from '../../types/game-state.types.ts';
import { closeCartridgeModal } from './cartridge_ui_registry.ts';

/** Request payload passed from Quickcast, Hotbar, or Spellbook UI controls. */
export interface SpellCastUIRequest {
  readonly classId: string;
  readonly spellId: string;
  readonly slotId?: string | undefined;
  readonly spellLevel?: number | undefined;
  readonly convertedSpellId?: string | undefined;
  readonly metamagicFeatIds?: ReadonlyArray<string> | undefined;
}

/**
 * Initiates a spell cast from any UI surface:
 * - Closes open cartridge modals cleanly.
 * - Personal / self-anchored spells fire immediately through `FireAimedIntent` on the caster's tile.
 * - Targeted / AoE spells enter interactive map `targetingMode` with blast radius & max range previews.
 */
export function initiateSpellCastFromUI(state: GameState, playerId: EntityId, request: SpellCastUIRequest): void {
  const sysContent = getDnD35SystemContent(state.campaign);
  const effectiveSpellId = request.convertedSpellId ?? request.spellId;
  const spell = sysContent?.spells?.[effectiveSpellId];
  if (!spell) {
    setGameState(addMessage(state, `Unknown spell: ${effectiveSpellId}`, MessageLogCategory.System));
    markAllDomainsDirty();
    return;
  }

  let nextState = state.uiMode === UIMode.CartridgeModal ? closeCartridgeModal(state) : state;

  const aoeShape =
    spell.aoeShape === 'burst' ||
    spell.aoeShape === 'emanation' ||
    spell.aoeShape === 'spread' ||
    spell.aoeShape === 'cone' ||
    spell.aoeShape === 'line'
      ? spell.aoeShape
      : undefined;

  const context: TargetingContext = {
    verb: 'cast_spell',
    spellId: request.spellId,
    classId: request.classId,
    ...(request.slotId !== undefined ? { slotId: request.slotId } : {}),
    ...(request.spellLevel !== undefined ? { spellLevel: request.spellLevel } : {}),
    ...(request.convertedSpellId !== undefined ? { convertedSpellId: request.convertedSpellId } : {}),
    ...(request.metamagicFeatIds && request.metamagicFeatIds.length > 0
      ? { metamagicFeatIds: request.metamagicFeatIds }
      : {}),
    ...(aoeShape !== undefined ? { aoeShape } : {})
  };

  const isSelfAnchored = spell.effectUnits.some((u) => u.type === 'spatial_field' && u.anchorToCaster);
  const isPersonal = spell.range === 'personal' || spell.targeting?.mode === 'personal' || isSelfAnchored;

  if (isPersonal) {
    const pos = getComponent(nextState, playerId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) return;
    nextState = {
      ...nextState,
      targetingMode: {
        active: true,
        x: pos.x,
        y: pos.y,
        radius: 0,
        maxRangeTiles: 0,
        context
      }
    };
    setGameState(nextState);
    queuePlayerIntent(createFireAimedAction(playerId));
    markAllDomainsDirty();
    return;
  }

  const dndData = getDnD35EntityData(nextState, playerId);
  const book = (dndData.spellbooksByClass ?? {})[request.classId];
  const casterLevel = book?.effectiveCasterLevel ?? 1;
  const meta = summarizeMetamagic(request.metamagicFeatIds, sysContent);
  const maxRangeTiles = computeSpellRangeTiles(spell.range, casterLevel, meta.rangeMultiplier);
  const radiusTiles =
    spell.aoeRadiusFt > 0
      ? Math.max(1, Math.round((spell.aoeRadiusFt * meta.areaMultiplier) / FEET_PER_GRID_SQUARE))
      : 0;

  setGameState(nextState);
  queuePlayerIntent(
    createToggleTargetingAction(playerId, context, {
      radius: radiusTiles,
      maxRangeTiles
    })
  );
  markAllDomainsDirty();
}

/**
 * Convenience wrapper retrieving live game state before dispatching `initiateSpellCastFromUI`.
 */
export function dispatchSpellCastFromLiveUI(playerId: EntityId, request: SpellCastUIRequest): void {
  const live = getGameState();
  if (!live) return;
  initiateSpellCastFromUI(live, playerId, request);
}
