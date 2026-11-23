/**
 * @file End-to-End Runtime D&D 3.5e Spell Cast Resolver.
 * Validates range, metamagic adjustments, and 5-tier action economy; expends spell slots;
 * executes `resolveCastPipeline`, saving throws, SR, AoE geometry, and damage/buff application.
 */

import { consumeResourcePool, getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { matchesEntityTagCondition } from '../../../systems/reaction.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type ResourcePoolComponent
} from '../../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../../types/game-state.types.ts';
import { evaluateActiveSpellAuraContributions } from './spell_aura_resolver.ts';
import { evaluateSpellEffectUnitsForTarget, projectSpellEffectTags } from './spell_effects.ts';
import { applyResolvedSpellEffectsToTarget } from './spell_cast_effects.ts';
import { evaluateReactiveCounterspellInterrupt } from './counterspell_interrupt.ts';
import { resolveSpellEffectiveCasterLevel } from './spell_modifiers.ts';
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
import { hydrateEntityRoundActionBudget } from '../cartridge/dnd35e_turn_budget.ts';
import { rollD20 } from '../math/dice.ts';
import { resolveTypedModifiers } from '../modifiers/stacking_engine.ts';
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
  const casterMods = casterDag.statModifiers ?? casterDag.dndData.statModifiers ?? [];
  const spellEffectTags = projectSpellEffectTags(spell, meta.flags);
  const effectiveCasterLevel = resolveSpellEffectiveCasterLevel(spell, book.effectiveCasterLevel, casterMods, {
    casterSelfTags: casterDag.selfTags,
    metamagic: meta.flags
  });
  const dcMods = casterMods.filter((m) => m.targetStat === 'spell_save_dc' || m.targetStat === 'spell_dc');
  const srPenMods = casterMods.filter((m) => m.targetStat === 'caster_level_check_vs_sr');
  const dcBonus = resolveTypedModifiers(dcMods, {
    selfTags: casterDag.selfTags,
    effectTags: spellEffectTags
  });
  const spellPenetrationBonus = resolveTypedModifiers(srPenMods, {
    selfTags: casterDag.selfTags,
    effectTags: spellEffectTags
  });

  const maxRangeTiles = computeSpellRangeTiles(
    spell.range,
    effectiveCasterLevel,
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

  const effectiveBudget =
    casterDag.dndData.actionBudget ??
    (state.engineMode === EngineMode.RTwP ? hydrateEntityRoundActionBudget(state, casterId) : undefined);

  let directQuickenMax = 0;
  for (const mod of casterMods) {
    if (mod.targetStat !== 'quicken_max_spell_level') continue;
    if (mod.condition && !matchesEntityTagCondition(mod.condition, undefined, spellEffectTags, casterDag.selfTags)) {
      continue;
    }
    if (mod.value > directQuickenMax) {
      directQuickenMax = mod.value;
    }
  }
  const auraQuickenMax = evaluateActiveSpellAuraContributions(state, casterId, casterDag.selfTags).quickenMaxSpellLevel;
  const grantedQuickenMax = Math.max(directQuickenMax, auraQuickenMax);
  const baseSpellLevel = castContext.spellLevel ?? spell.levelByClass[book.classId] ?? spell.level;
  const effectiveSpellLevel = baseSpellLevel + meta.slotBump;
  const useGrantedQuicken =
    !meta.isQuickened &&
    grantedQuickenMax > 0 &&
    effectiveSpellLevel <= grantedQuickenMax &&
    (effectiveBudget === undefined || effectiveBudget.swiftRemaining >= 1);
  const effectiveMetaForBudget = useGrantedQuicken ? { ...meta, isQuickened: true } : meta;

  const actionRes = consumeSpellActionBudget(
    effectiveBudget,
    spell.castingTime,
    book.castingMode === 'spontaneous',
    effectiveMetaForBudget,
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

  if (useGrantedQuicken) {
    runningState = addMessage(
      runningState,
      `Quickened casting grant lets ${spell.name} be cast as a Swift action.`,
      MessageLogCategory.System
    );
  }

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
    casterLevel: effectiveCasterLevel,
    keyAbilityScore: govAbScore,
    concentrationModifier: concMod,
    hasVerbalComponent: spell.components.verbal && !meta.flags.silent,
    hasSomaticComponent: spell.components.somatic && !meta.flags.still,
    arcaneSpellFailurePercent: asfPercent,
    isCasterDeafened: casterDag.dndData.conditions.includes('deafened'),
    castDefensively: isThreatened,
    dcBonus,
    spellPenetrationBonus
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
  const casterSelfUnits = evaluateSpellEffectUnitsForTarget(spell, {
    casterSelfTags: casterDag.selfTags,
    targetTags: casterDag.selfTags,
    metamagic: meta.flags
  }).filter((u) => u.type !== 'spatial_field' && u.type !== 'summon' && u.targetRole === 'caster');
  const chassis = aggregateProgressionChassis(casterDag.dndData.tracks, 0);

  if (placementUnits.length > 0) {
    runningState = applyResolvedSpellEffectsToTarget({
      state: runningState,
      casterId,
      targetId: casterId,
      targetPos,
      spell,
      units: placementUnits,
      casterLevel: effectiveCasterLevel,
      castId,
      metamagic: meta.flags,
      casterAbilityMod: govAbMod,
      totalBab: chassis.totalBab,
      saveResultByUnitId: {},
      sysContent
    });
  }

  if (casterSelfUnits.length > 0) {
    runningState = applyResolvedSpellEffectsToTarget({
      state: runningState,
      casterId,
      targetId: casterId,
      targetPos: { x: casterPos.x, y: casterPos.y },
      spell,
      units: casterSelfUnits,
      casterLevel: effectiveCasterLevel,
      castId,
      metamagic: meta.flags,
      casterAbilityMod: govAbMod,
      totalBab: chassis.totalBab,
      saveResultByUnitId: {},
      sysContent
    });
  }

  if (targets.length === 0 && placementUnits.length === 0 && casterSelfUnits.length === 0) {
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
      const targetSrPenBonus = resolveTypedModifiers(srPenMods, {
        selfTags: casterDag.selfTags,
        targetTags: targetDag?.selfTags,
        effectTags: spellEffectTags
      });
      const srCheck = resolveCastPipeline({
        classification: spell.classification,
        spellLevel: spell.level,
        casterLevel: effectiveCasterLevel,
        keyAbilityScore: govAbScore,
        concentrationModifier: concMod,
        targetSpellResistance: targetSr,
        spellPenetrationBonus: targetSrPenBonus
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
      if (u.type === 'spatial_field' || u.type === 'summon' || u.targetRole === 'caster') return false;
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
    let contextualSaveTargetDag = undefined as typeof targetDag;
    const resolveSaveTargetDag = (): typeof targetDag => {
      if (!targetDag) return undefined;
      if (contextualSaveTargetDag !== undefined) return contextualSaveTargetDag;
      contextualSaveTargetDag =
        evaluateDnD35eEntityDAG(runningState, targetId, {
          effectTags: spellEffectTags,
          targetTags: casterDag.selfTags
        }) ?? targetDag;
      return contextualSaveTargetDag;
    };
    const targetDcBonus = resolveTypedModifiers(dcMods, {
      selfTags: casterDag.selfTags,
      targetTags: targetDag?.selfTags,
      effectTags: spellEffectTags
    });
    const effectiveSaveDC = basePipe.saveDC - dcBonus + targetDcBonus;

    if (topSave && topSave.saveType !== 'none' && targetId !== casterId && targetDag) {
      const saveDag = resolveSaveTargetDag();
      const saveRoll = rollD20('save', saveDag!.dagResult.saves[topSave.saveType]);
      saveResultByUnitId['top_level'] =
        !saveRoll.isAutoFailure && (saveRoll.isAutoSuccess || saveRoll.total >= effectiveSaveDC);
    }
    for (const u of units) {
      const uSave = u.savingThrow ?? topSave;
      if (uSave && uSave.saveType !== 'none' && targetId !== casterId && targetDag) {
        const saveDag = resolveSaveTargetDag();
        const roll = rollD20('save', saveDag!.dagResult.saves[uSave.saveType]);
        saveResultByUnitId[u.unitId] = !roll.isAutoFailure && (roll.isAutoSuccess || roll.total >= effectiveSaveDC);
      }
    }

    runningState = applyResolvedSpellEffectsToTarget({
      state: runningState,
      casterId,
      targetId,
      targetPos,
      spell,
      units,
      casterLevel: effectiveCasterLevel,
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

const SPELL_EFFECT_ID_PREFIX = 'spell:';
const BASE_MAGIC_ITEM_SAVE_DC = 10;
const MIN_MAGIC_ITEM_CASTER_LEVEL = 1;
const MAGIC_ITEM_CL_PER_SPELL_LEVEL = 2;
const MAGIC_ITEM_CL_OFFSET = 1;
const MAGIC_ITEM_ABILITY_MOD_DIVISOR = 2;

/**
 * Resolves a declarative `spell:<spellId>` consumable or wand/staff effect onto `explicitTargetId ?? userId`
 * (or AoE victims when the spell defines a non-single area template) using the D&D 3.5e spell effect pipeline
 * and standard DMG minimum item caster level (`max(1, level * 2 - 1)`).
 */
export function resolveDnD35eSpellItemEffect(
  state: GameState,
  userId: EntityId,
  effectId: string,
  _itemName: string,
  explicitTargetId?: EntityId
): GameState | null {
  if (!effectId.startsWith(SPELL_EFFECT_ID_PREFIX)) return null;
  const spellId = effectId.slice(SPELL_EFFECT_ID_PREFIX.length);
  const sysContent = getDnD35SystemContent(state.campaign);
  const spell = sysContent?.spells?.[spellId];
  if (!spell) return null;

  const targetId = explicitTargetId ?? userId;
  const targetPosComp = getComponent(state, targetId, ComponentType.Position) as PositionComponent | undefined;
  const userPosComp = getComponent(state, userId, ComponentType.Position) as PositionComponent | undefined;
  const targetPos = targetPosComp
    ? { x: targetPosComp.x, y: targetPosComp.y }
    : userPosComp
      ? { x: userPosComp.x, y: userPosComp.y }
      : { x: 0, y: 0 };

  const itemCasterLevel = Math.max(
    MIN_MAGIC_ITEM_CASTER_LEVEL,
    spell.level * MAGIC_ITEM_CL_PER_SPELL_LEVEL - MAGIC_ITEM_CL_OFFSET
  );
  const itemSaveDc = BASE_MAGIC_ITEM_SAVE_DC + spell.level + Math.floor(spell.level / MAGIC_ITEM_ABILITY_MOD_DIVISOR);
  const noMetamagic = summarizeMetamagic(undefined, sysContent).flags;
  const userDag = evaluateDnD35eEntityDAG(state, userId);
  const spellEffectTags = projectSpellEffectTags(spell, noMetamagic);
  const userTotalBab = userDag ? aggregateProgressionChassis(userDag.dndData.tracks, 0).totalBab : 0;
  const itemAbilityMod = Math.floor(spell.level / MAGIC_ITEM_ABILITY_MOD_DIVISOR);
  const castId = `item_${state.globalTurn}_${spell.id}`;

  const isAreaSpell = spell.aoeShape !== 'single' && spell.aoeRadiusFt > 0;
  const enumeratedTargets =
    isAreaSpell && userPosComp ? enumerateSpellTargets(state, userId, userPosComp, targetPos, spell, 1, false) : [];
  const targetIds: ReadonlyArray<EntityId> = enumeratedTargets.length > 0 ? enumeratedTargets : [targetId];

  let runningState = state;
  let emittedBundleMsg = spell.effectBundle !== undefined;

  for (const currentTargetId of targetIds) {
    const targetDag = evaluateDnD35eEntityDAG(runningState, currentTargetId);
    const targetFighter = getComponent(runningState, currentTargetId, ComponentType.Fighter) as
      FighterComponent | undefined;
    const targetChassis = targetDag ? aggregateProgressionChassis(targetDag.dndData.tracks, 0) : undefined;
    const units = evaluateSpellEffectUnitsForTarget(spell, {
      casterSelfTags: userDag?.selfTags ?? [],
      targetTags: targetDag?.selfTags ?? [],
      metamagic: noMetamagic,
      ...(targetFighter ? { targetCurrentHp: targetFighter.hp } : {}),
      ...(targetChassis ? { targetHitDice: targetChassis.totalHD } : {})
    });

    if (units.some((u) => u.type === 'stat_bundle')) {
      emittedBundleMsg = true;
    }

    const isUndeadTarget =
      targetDag?.dndData.creatureType === 'undead' ||
      (targetDag?.selfTags.includes('type:undead') ?? false) ||
      (targetDag?.selfTags.includes('undead') ?? false);
    const isLivingNonHostile =
      !isUndeadTarget && (currentTargetId === userId || !isHostile(runningState, userId, currentTargetId));
    const isPureHealingForLiving = units.length > 0 && units.every((u) => u.type === 'healing') && isLivingNonHostile;

    const saveResultByUnitId: Record<string, boolean> = {};
    if (currentTargetId !== userId && targetDag) {
      const contextualSaveDag =
        evaluateDnD35eEntityDAG(runningState, currentTargetId, {
          effectTags: spellEffectTags,
          targetTags: userDag?.selfTags ?? []
        }) ?? targetDag;
      const topSave = spell.savingThrow;
      if (topSave && topSave.saveType !== 'none' && topSave.effect !== 'harmless' && !isPureHealingForLiving) {
        const saveRoll = rollD20('save', contextualSaveDag.dagResult.saves[topSave.saveType]);
        saveResultByUnitId['top_level'] =
          !saveRoll.isAutoFailure && (saveRoll.isAutoSuccess || saveRoll.total >= itemSaveDc);
      }
      for (const u of units) {
        if (u.type === 'healing' && isLivingNonHostile) continue;
        const uSave = u.savingThrow ?? topSave;
        if (uSave && uSave.saveType !== 'none' && uSave.effect !== 'harmless') {
          const roll = rollD20('save', contextualSaveDag.dagResult.saves[uSave.saveType]);
          saveResultByUnitId[u.unitId] = !roll.isAutoFailure && (roll.isAutoSuccess || roll.total >= itemSaveDc);
        }
      }
    }

    runningState = applyResolvedSpellEffectsToTarget({
      state: runningState,
      casterId: userId,
      targetId: currentTargetId,
      targetPos,
      spell,
      units,
      casterLevel: itemCasterLevel,
      castId,
      metamagic: noMetamagic,
      casterAbilityMod: itemAbilityMod,
      totalBab: userTotalBab,
      saveResultByUnitId,
      sysContent
    });
  }

  if (emittedBundleMsg) {
    runningState = addMessage(runningState, `${spell.name} takes effect.`, MessageLogCategory.System);
  }

  return processDnD35eDamage(runningState);
}
