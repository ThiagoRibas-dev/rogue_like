/**
 * @file End-to-End Runtime D&D 3.5e Spell Cast Resolver.
 * Validates range, metamagic adjustments, and 5-tier action economy; expends spell slots;
 * executes `resolveCastPipeline`, saving throws, SR, AoE geometry, and damage/buff application.
 */

import { consumeResourcePool, getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type ResourcePoolComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateSpellEffectUnitsForTarget } from './spell_effects.ts';
import { applyResolvedSpellEffectsToTarget } from './spell_cast_effects.ts';
import { evaluateReactiveCounterspellInterrupt } from './counterspell_interrupt.ts';
import {
  collectEquippedArcaneSpellFailure,
  computeSpellRangeTiles,
  consumeSpellActionBudget,
  type DnD35SpellCastContext,
  enumerateSpellTargets,
  expendCasterSpellSlot,
  isCasterThreatenedInMelee,
  matchesTargetCategoryFilter,
  summarizeMetamagic
} from './spell_cast_helpers.ts';
import { resolveCastPipeline } from './spellcasting.ts';
import { isHostile } from '../../../utils/faction.ts';
import { processDnD35eDamage } from '../cartridge/dnd35e_combat_adapter.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { rollD20 } from '../math/dice.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import {
  measureFootprintToFootprintDistanceFt,
  measureFootprintToTileDistanceFt
} from '../spatial/footprint_resolver.ts';
import { FEET_PER_GRID_SQUARE } from '../spatial/grid_geometry.ts';
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
  const maxRangeTiles = computeSpellRangeTiles(
    spell.range,
    book.effectiveCasterLevel,
    meta.rangeMultiplier,
    meta.flags.projectTouch
  );
  const casterW = Math.max(1, casterPos.footprintWidth ?? 1);
  const casterH = Math.max(1, casterPos.footprintHeight ?? 1);
  let minDistanceFt = measureFootprintToTileDistanceFt(
    casterPos.x,
    casterPos.y,
    casterW,
    casterH,
    targetPos.x,
    targetPos.y
  );
  const targetOccupants = state.spatialIndex.get(`${targetPos.x},${targetPos.y}`) ?? [];
  for (const occId of targetOccupants) {
    const occPos = getComponent(state, occId, ComponentType.Position) as PositionComponent | undefined;
    if (occPos) {
      const d = measureFootprintToFootprintDistanceFt(
        casterPos.x,
        casterPos.y,
        casterW,
        casterH,
        occPos.x,
        occPos.y,
        occPos.footprintWidth ?? 1,
        occPos.footprintHeight ?? 1
      );
      if (d < minDistanceFt) minDistanceFt = d;
    }
  }
  const distTiles = Math.round(minDistanceFt / FEET_PER_GRID_SQUARE);
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

  const poolComp = getComponent(state, casterId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  const metamagicPool = poolComp?.pools['metamagic_specialist'];
  const hasMetamagicSpecialistTrait =
    casterDag.selfTags.includes('trait:metamagic_specialist') ||
    (casterDag.dndData.activeClassFeatures ?? []).includes('metamagic_specialist') ||
    (casterDag.dndData.feats ?? []).includes('metamagic_specialist');
  const shouldUseMetamagicSpecialist =
    book.castingMode === 'spontaneous' &&
    meta.hasNonQuickenMetamagic &&
    !meta.isQuickened &&
    hasMetamagicSpecialistTrait &&
    metamagicPool !== undefined &&
    metamagicPool.current >= 1;

  const actionRes = consumeSpellActionBudget(
    casterDag.dndData.actionBudget,
    spell.castingTime,
    book.castingMode === 'spontaneous',
    meta,
    shouldUseMetamagicSpecialist
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

  if (shouldUseMetamagicSpecialist) {
    const poolRes = consumeResourcePool(runningState, casterId, 'metamagic_specialist', 1);
    runningState = poolRes.state;
    runningState = addMessage(
      runningState,
      'Metamagic Specialist: Spontaneous metamagic cast as standard action.',
      MessageLogCategory.CombatHit
    );
  }

  const govAbState = casterDag.dagResult.effectiveAbilities[book.governingAbility];
  const govAbScore =
    govAbState.base === null
      ? 10
      : Math.max(
          0,
          govAbState.base + govAbState.inherentBonus - govAbState.damage - govAbState.drain - govAbState.tempPenalty
        );
  const govAbMod = casterDag.dagResult.effectiveAbilityModifiers[book.governingAbility];
  const asfPercent = book.castingTradition === 'arcane' ? collectEquippedArcaneSpellFailure(runningState, casterId) : 0;

  const isThreatened =
    !meta.isQuickened &&
    spell.castingTime !== 'swift' &&
    spell.castingTime !== 'immediate' &&
    isCasterThreatenedInMelee(runningState, casterId, casterPos);
  const combatCastingBonus = isThreatened && (casterDag.dndData.feats ?? []).includes('combat_casting') ? 4 : 0;
  const concRes = casterDag.resolvedSkills['concentration'];
  const concMod =
    (concRes
      ? concRes.totalModifier
      : (casterDag.dndData.skillRanks['concentration'] ?? 0) + casterDag.dagResult.effectiveAbilityModifiers.con) +
    combatCastingBonus;

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

  const counterRes = evaluateReactiveCounterspellInterrupt(runningState, casterId, casterPos, spell, sysContent);
  if (counterRes.countered) {
    return { state: counterRes.state, success: true };
  }
  runningState = counterRes.state;

  const targets = enumerateSpellTargets(
    runningState,
    casterId,
    casterPos,
    targetPos,
    spell,
    meta.areaMultiplier,
    meta.flags.judicious
  );
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
    const hasExplicitCategories = (spell.targeting?.validTargetCategories?.length ?? 0) > 0;
    if (!targetDag && !hasExplicitCategories) continue;
    const targetSr = targetDag?.dndData.spellResistance ?? 0;
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
    const targetChassis = targetDag ? aggregateProgressionChassis(targetDag.dndData.tracks, 0) : undefined;
    const units = evaluateSpellEffectUnitsForTarget(spell, {
      casterSelfTags: casterDag.selfTags,
      targetTags: targetDag?.selfTags ?? [],
      metamagic: meta.flags,
      ...(targetFighter ? { targetCurrentHp: targetFighter.hp } : {}),
      ...(targetChassis ? { targetHitDice: targetChassis.totalHD } : {})
    }).filter((u) => {
      if (u.type === 'spatial_field' || u.type === 'summon') return false;
      if (u.validTargetCategories && u.validTargetCategories.length > 0) {
        if (!matchesTargetCategoryFilter(runningState, casterId, targetId, u.validTargetCategories)) return false;
      }
      if (
        meta.flags.judicious &&
        (u.type === 'damage' || u.type === 'save_or_die' || u.type === 'energy_drain' || u.type === 'ability_harm') &&
        (targetId === casterId || !isHostile(runningState, casterId, targetId))
      ) {
        return false;
      }
      return true;
    });

    const saveResultByUnitId: Record<string, boolean> = {};
    const topSave = spell.savingThrow;
    if (topSave && topSave.saveType !== 'none' && targetId !== casterId && targetDag) {
      const saveRoll = rollD20('save', targetDag.dagResult.saves[topSave.saveType]);
      saveResultByUnitId['top_level'] =
        !saveRoll.isAutoFailure && (saveRoll.isAutoSuccess || saveRoll.total >= basePipe.saveDC);
    }
    for (const u of units) {
      const uSave = u.savingThrow ?? topSave;
      if (uSave && uSave.saveType !== 'none' && targetId !== casterId && targetDag) {
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
