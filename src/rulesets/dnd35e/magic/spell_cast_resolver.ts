/**
 * @file End-to-End Runtime D&D 3.5e Spell Cast Resolver.
 * Validates range, metamagic adjustments, and 5-tier action economy; expends spell slots;
 * executes `resolveCastPipeline`, saving throws, SR, AoE geometry, and damage/buff application.
 */

import { getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { ComponentType, type FighterComponent, type PositionComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateSpellEffectUnitsForTarget } from './spell_effects.ts';
import { applyResolvedSpellEffectsToTarget } from './spell_cast_effects.ts';
import {
  collectEquippedArcaneSpellFailure,
  computeSpellRangeTiles,
  consumeSpellActionBudget,
  type DnD35SpellCastContext,
  enumerateSpellTargets,
  expendCasterSpellSlot,
  isCasterThreatenedInMelee,
  summarizeMetamagic
} from './spell_cast_helpers.ts';
import { resolveCastPipeline } from './spellcasting.ts';
import { processDnD35eDamage } from '../cartridge/dnd35e_combat_adapter.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { rollD20 } from '../math/dice.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { FEET_PER_GRID_SQUARE, measureDnD35DistanceFt } from '../spatial/grid_geometry.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';

export { computeSpellRangeTiles, summarizeMetamagic, type DnD35SpellCastContext } from './spell_cast_helpers.ts';

/**
 * Executes a D&D 3.5e spell cast end-to-end against `targetPos`, returning the updated
 * `GameState` and whether an action/turn was consumed.
 */
export function executeDnD35eSpellCast(
  state: GameState,
  casterId: EntityId,
  targetPos: { readonly x: number; readonly y: number },
  castContext: DnD35SpellCastContext
): { readonly state: GameState; readonly success: boolean } {
  const sysContent = getDnD35SystemContent(state.campaign);
  const effectiveSpellId = castContext.convertedSpellId ?? castContext.spellId;
  const spell = sysContent?.spells?.[effectiveSpellId];
  const casterPos = getComponent(state, casterId, ComponentType.Position) as PositionComponent | undefined;
  const casterDag = evaluateDnD35eEntityDAG(state, casterId);

  if (!spell || !casterPos || !casterDag) {
    return {
      state: addMessage(state, `Unknown spell: ${effectiveSpellId}`, MessageLogCategory.System),
      success: false
    };
  }

  const book = (casterDag.dndData.spellbooksByClass ?? {})[castContext.classId];
  if (!book) {
    return {
      state: addMessage(state, 'No matching spellbook class found.', MessageLogCategory.System),
      success: false
    };
  }

  const meta = summarizeMetamagic(castContext.metamagicFeatIds, sysContent);
  const maxRangeTiles = computeSpellRangeTiles(spell.range, book.effectiveCasterLevel, meta.rangeMultiplier);
  const distTiles = Math.round(
    measureDnD35DistanceFt(casterPos.x, casterPos.y, targetPos.x, targetPos.y) / FEET_PER_GRID_SQUARE
  );
  if (spell.range !== 'personal' && distTiles > maxRangeTiles) {
    return {
      state: addMessage(
        state,
        `${spell.name} is out of range (${distTiles} > ${maxRangeTiles} tiles).`,
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const actionRes = consumeSpellActionBudget(
    casterDag.dndData.actionBudget,
    spell.castingTime,
    book.castingMode === 'spontaneous',
    meta
  );
  if (!actionRes.allowed) {
    return {
      state: addMessage(state, actionRes.reason ?? 'Cannot cast spell right now.', MessageLogCategory.System),
      success: false
    };
  }

  const slotRes = expendCasterSpellSlot(book, spell, castContext, meta.slotBump, state, casterId, sysContent);
  if (!slotRes.ok) {
    return {
      state: addMessage(state, slotRes.reason ?? 'No slot available.', MessageLogCategory.System),
      success: false
    };
  }

  const rawCasterDnd = getDnD35EntityData(state, casterId);
  let runningState = setDnD35EntityData(state, casterId, {
    ...rawCasterDnd,
    spellbooksByClass: { ...(rawCasterDnd.spellbooksByClass ?? {}), [castContext.classId]: slotRes.updatedBook },
    ...(actionRes.budget !== undefined ? { actionBudget: actionRes.budget } : {})
  });

  const govAbState = casterDag.dagResult.effectiveAbilities[book.governingAbility];
  const govAbScore =
    govAbState.base === null
      ? 10
      : Math.max(
          0,
          govAbState.base + govAbState.inherentBonus - govAbState.damage - govAbState.drain - govAbState.tempPenalty
        );
  const govAbMod = casterDag.dagResult.effectiveAbilityModifiers[book.governingAbility];
  const concRanks = casterDag.dndData.skillRanks['concentration'] ?? 0;
  const concSkillMods = (casterDag.dndData.statModifiers ?? [])
    .filter((m) => m.targetStat === 'skill:concentration' || m.targetStat === 'skills')
    .reduce((sum, m) => sum + m.value, 0);
  const asfPercent = book.castingTradition === 'arcane' ? collectEquippedArcaneSpellFailure(runningState, casterId) : 0;

  const isThreatened =
    !meta.isQuickened &&
    spell.castingTime !== 'swift' &&
    spell.castingTime !== 'immediate' &&
    isCasterThreatenedInMelee(runningState, casterId, casterPos);
  const combatCastingBonus = isThreatened && (casterDag.dndData.feats ?? []).includes('combat_casting') ? 4 : 0;
  const concMod = concRanks + casterDag.dagResult.effectiveAbilityModifiers.con + concSkillMods + combatCastingBonus;

  const basePipe = resolveCastPipeline({
    classification: spell.classification,
    spellLevel: spell.level,
    casterLevel: book.effectiveCasterLevel,
    keyAbilityScore: govAbScore,
    concentrationModifier: concMod,
    hasVerbalComponent: spell.components.verbal && !meta.flags.silent,
    hasSomaticComponent: spell.components.somatic && !meta.flags.still,
    arcaneSpellFailurePercent: asfPercent,
    isCasterDeafened: casterDag.dndData.conditions.includes('deafened'),
    castDefensively: isThreatened
  });

  if (!basePipe.succeeded) {
    return {
      state: addMessage(
        runningState,
        `${spell.name} failed to cast (${basePipe.failureReason?.replace(/_/g, ' ')})!`,
        MessageLogCategory.CombatMiss
      ),
      success: true
    };
  }

  const targets = enumerateSpellTargets(runningState, casterId, casterPos, targetPos, spell, meta.areaMultiplier);
  const castId = `cast_${runningState.globalTurn}_${spell.id}`;
  runningState = addMessage(runningState, `You cast ${spell.name}!`, MessageLogCategory.CombatHit);

  const placementUnits = spell.effectUnits.filter((u) => u.type === 'spatial_field' || u.type === 'summon');
  const chassis = aggregateProgressionChassis(casterDag.dndData.tracks, 0);

  if (placementUnits.length > 0) {
    runningState = applyResolvedSpellEffectsToTarget({
      state: runningState,
      casterId,
      targetId: casterId,
      targetPos,
      spell,
      units: placementUnits,
      casterLevel: book.effectiveCasterLevel,
      castId,
      metamagic: meta.flags,
      casterAbilityMod: govAbMod,
      totalBab: chassis.totalBab,
      saveResultByUnitId: {},
      sysContent
    });
  }

  if (targets.length === 0 && placementUnits.length === 0) {
    return {
      state: addMessage(runningState, `${spell.name} affects no creatures.`, MessageLogCategory.System),
      success: true
    };
  }

  for (const targetId of targets) {
    const targetDag = evaluateDnD35eEntityDAG(runningState, targetId);
    if (!targetDag) continue;
    const targetSr = targetDag.dndData.spellResistance ?? 0;
    if (spell.allowsSpellResistance && targetSr > 0 && targetId !== casterId) {
      const srCheck = resolveCastPipeline({
        classification: spell.classification,
        spellLevel: spell.level,
        casterLevel: book.effectiveCasterLevel,
        keyAbilityScore: govAbScore,
        concentrationModifier: concMod,
        targetSpellResistance: targetSr
      });
      if (!srCheck.succeeded) {
        runningState = addMessage(
          runningState,
          `Target's Spell Resistance resists ${spell.name}!`,
          MessageLogCategory.CombatMiss
        );
        continue;
      }
    }

    const targetFighter = getComponent(runningState, targetId, ComponentType.Fighter) as FighterComponent | undefined;
    const targetChassis = aggregateProgressionChassis(targetDag.dndData.tracks, 0);
    const units = evaluateSpellEffectUnitsForTarget(spell, {
      casterSelfTags: casterDag.selfTags,
      targetTags: targetDag.selfTags,
      metamagic: meta.flags,
      ...(targetFighter ? { targetCurrentHp: targetFighter.hp } : {}),
      targetHitDice: targetChassis.totalHD
    }).filter((u) => u.type !== 'spatial_field' && u.type !== 'summon');

    const saveResultByUnitId: Record<string, boolean> = {};
    const topSave = spell.savingThrow;
    if (topSave && topSave.saveType !== 'none' && targetId !== casterId) {
      const saveRoll = rollD20('save', targetDag.dagResult.saves[topSave.saveType]);
      saveResultByUnitId['top_level'] =
        !saveRoll.isAutoFailure && (saveRoll.isAutoSuccess || saveRoll.total >= basePipe.saveDC);
    }
    for (const u of units) {
      const uSave = u.savingThrow ?? topSave;
      if (uSave && uSave.saveType !== 'none' && targetId !== casterId) {
        const roll = rollD20('save', targetDag.dagResult.saves[uSave.saveType]);
        saveResultByUnitId[u.unitId] = !roll.isAutoFailure && (roll.isAutoSuccess || roll.total >= basePipe.saveDC);
      }
    }

    runningState = applyResolvedSpellEffectsToTarget({
      state: runningState,
      casterId,
      targetId,
      targetPos,
      spell,
      units,
      casterLevel: book.effectiveCasterLevel,
      castId,
      metamagic: meta.flags,
      casterAbilityMod: govAbMod,
      totalBab: chassis.totalBab,
      saveResultByUnitId,
      sysContent
    });
  }

  runningState = processDnD35eDamage(runningState);
  return { state: runningState, success: true };
}
