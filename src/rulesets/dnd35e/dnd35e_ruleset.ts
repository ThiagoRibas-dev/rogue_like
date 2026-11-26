import { addComponent, getComponent, getEntitiesAtPosition, resolveEntityDisplayName } from '../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type {
  HudVitalsDTO,
  RulesetBaseFileDescriptor,
  RulesetContract,
  RulesetSystemFileDescriptor,
  ViewGroup
} from '../../types/ruleset.types.ts';
import { isHostile } from '../../utils/faction.ts';
import { processDnD35eDamage, resolveDnD35eMeleeAttack } from './cartridge/dnd35e_combat_adapter.ts';
import { onDnD35eStatusEffectExpired, projectDnD35eActiveEffects } from './cartridge/dnd35e_active_effects.ts';
import { computeDnD35eEffectiveStats, evaluateDnD35eEntityDAG } from './cartridge/dnd35e_dag_adapter.ts';
import { onDnD35eEntitySpawned } from './cartridge/dnd35e_spawn_hydrator.ts';
import {
  executeDnD35eChargeAction,
  initiateDnD35eChargeTargeting,
  validateChargeLine
} from './combat/charge_resolver.ts';
import { resolveBullRushImpact } from './combat/bull_rush_resolver.ts';
import { resolveSavingThrow } from './combat/damage_vitality.ts';
import {
  evaluateDnD35eAltitudeAdjustment,
  evaluateDnD35eElevationCombat,
  resolveDnD35eFallLanded,
  resolveDnD35eMovementModes
} from './spatial/dnd35e_spatial_3d.ts';
import { measureDnD35Distance3DFt } from './spatial/grid_geometry.ts';
import { DND35E_DEFAULT_CURRENCY_CONFIG } from './currency.ts';
import { DND35E_DEFAULT_WORLD_CLOCK_CONFIG } from './world_clock.ts';
import { checkDnD35eRuleset } from './dnd35e_validator.ts';
import { resolveDnD35eItemHandRequirement } from './equipment_physics.ts';
import { DND35E_BASE_AC, resolveTypedModifiers } from './modifiers.ts';
import type { Verb } from '../../constants/verbs.constants.ts';
import {
  aggregateProgressionChassis,
  calculateMulticlassXpMultiplier,
  computeXpThresholdForLevel
} from './progression.ts';
import { resolveDnD35eKillXpReward } from './progression/cr_xp_table.ts';
import {
  getDnD35eValidVerbsForTarget,
  projectDnD35eInspectLoreLines,
  resolveDnD35eSkillVerb,
  validateDnD35eWandActivation
} from './skill_verbs.ts';
import {
  evaluateDnD35eDialogueSkillCheck,
  evaluateDnD35eTradePriceModifier,
  getDnD35eActorSkillModifier,
  getDnD35eTradeSocialActions,
  resolveDnD35eTradeSocialSkill
} from './skills/trade_social_checks.ts';
import { evaluateDnD35eLanguageComprehension } from './skills/language_comprehension.ts';
import { getDnD35EntityData, setDnD35EntityData } from './srd_registry.ts';
import { executeAbruptJauntTeleport } from './combat/immediate_reactions.ts';
import { executeDnD35eResourcePoolAbility } from './combat/pool_ability_resolver.ts';
import { executeDruidShapeshift, type DnD35ShapeshiftFormId } from './shapeshift.ts';
import { resolveDnD35eActorSpatialProfile, syncDnD35eActorSpatialFootprint } from './spatial/footprint_resolver.ts';
import { toggleActorFastStealth, toggleActorStealth } from './spatial/stealth_resolver.ts';
import { evaluateActorTileHazardOccupation } from './spatial/terrain_traversal_resolver.ts';
import { executeDnD35eSpellCast, resolveDnD35eSpellItemEffect } from './magic/spell_cast_resolver.ts';
import { spawnArcaneCasterSpellbookLoot } from './magic/spellbook_loot.ts';
import { DND35E_SYSTEM_CONTENT_FILES } from './system_content_files.ts';
import { getDnD35SystemContent, parseDnD35SystemContent } from './types/dnd35e_system.types.ts';

import {
  canDnD35eActorPerformIntent,
  hasDnD35eActorActedThisTurn,
  hasDnD35eActorMovementInProgress,
  onDnD35eActorMovementStep,
  onDnD35eActorTurnStart,
  onDnD35eWorldHourElapsed,
  resolveDnD35eActionEnergyCost
} from './cartridge/dnd35e_lifecycle_adapter.ts';

export * from './cartridge/dnd35e_combat_adapter.ts';
export * from './cartridge/dnd35e_dag_adapter.ts';
export * from './cartridge/dnd35e_lifecycle_adapter.ts';

/**
 * Grants XP to an actor under the D&D 3.5e triangular XP progression table
 * ($\text{Threshold}(L+1) = \frac{L(L+1)}{2} \times 1000$).
 *
 * @param state The current GameState.
 * @param entityId The recipient entity ID.
 * @param amount The XP amount to grant.
 * @returns Updated GameState.
 */
function grantDnD35eXp(state: GameState, entityId: EntityId, amount: number): GameState {
  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter || amount <= 0) return state;

  const dndData = getDnD35EntityData(state, entityId);
  const sysContent = getDnD35SystemContent(state.campaign);
  const xpMultiplier = sysContent
    ? calculateMulticlassXpMultiplier(
        dndData.tracks,
        sysContent.classes,
        dndData.favoredClass ?? 'any',
        dndData.enforceMulticlassXpPenalty ?? true
      )
    : 1.0;
  const adjustedAmount = Math.max(0, Math.floor(amount * xpMultiplier));

  const newXp = fighter.xp + adjustedAmount;
  const nextLevel = fighter.level + 1;
  const nextThreshold = computeXpThresholdForLevel(nextLevel);

  let nextState = addComponent(state, entityId, { ...fighter, xp: newXp });

  if (newXp >= nextThreshold) {
    nextState = addMessage(
      nextState,
      '[D&D 3.5e] Level Up Available! Press [U] or click the ribbon to advance your character.',
      MessageLogCategory.System
    );
  }

  return nextState;
}

/**
 * Projects HUD vitals for the `dnd35e` ruleset cartridge (displaying BAB and Full AC sockets).
 *
 * @param state The current GameState.
 * @param playerEntityId The player entity ID.
 * @returns The projected `HudVitalsDTO`, or `null` if the player lacks combat stats.
 */
function projectDnD35eHudVitals(state: GameState, playerEntityId: EntityId): HudVitalsDTO | null {
  const fighter = getComponent(state, playerEntityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return null;

  const stats = computeDnD35eEffectiveStats(state, playerEntityId);
  const hpMax = Math.max(0, stats.maxHp);
  const hpCurrent = fighter.hp;
  const rawHpPercent = hpMax > 0 ? Math.round((hpCurrent / hpMax) * 100) : 0;
  const hpPercent = Math.max(0, Math.min(100, Math.max(0, rawHpPercent)));

  const xpNext = Math.max(1, computeXpThresholdForLevel(fighter.level + 1));
  const xpPercent = Math.max(0, Math.min(100, Math.round((fighter.xp / xpNext) * 100)));

  const formattedBab = stats.attack >= 0 ? `+${stats.attack}` : `${stats.attack}`;
  const armorClass = DND35E_BASE_AC + stats.defense;

  return {
    levelLabel: `ECL ${fighter.level}`,
    hpCurrent,
    hpMax,
    hpPercent,
    xpPercent,
    xpText: `${fighter.xp} / ${xpNext}`,
    primaryStat: { label: 'BAB', value: formattedBab },
    secondaryStat: { label: 'AC', value: armorClass.toString() }
  };
}

function formatSignedBonus(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/**
 * Projects D&D 3.5e combat stats (HP, Full/Touch/Flat-Footed AC, BAB, Saves) for the HUD Inspect panel.
 */
function projectDnD35eInspectStats(
  state: GameState,
  targetEntityId: EntityId
): ReadonlyArray<{ readonly label: string; readonly value: string; readonly color?: string | undefined }> {
  const fighter = getComponent(state, targetEntityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return [];

  const stats = computeDnD35eEffectiveStats(state, targetEntityId);
  const dag = evaluateDnD35eEntityDAG(state, targetEntityId);
  if (!dag) {
    return [
      { label: 'HP', value: `${fighter.hp}/${stats.maxHp}` },
      { label: 'AC', value: `${DND35E_BASE_AC + stats.defense}` },
      { label: 'BAB', value: formatSignedBonus(stats.attack) }
    ];
  }

  const { acBreakdown, saves } = dag.dagResult;
  const totalBab = aggregateProgressionChassis(dag.dndData.tracks, 0).totalBab;
  const formattedBab = formatSignedBonus(totalBab);
  return [
    { label: 'HP', value: `${fighter.hp}/${stats.maxHp}` },
    {
      label: 'AC',
      value: `${acBreakdown.fullAC} (T ${acBreakdown.touchAC} / FF ${acBreakdown.flatFootedAC})`
    },
    { label: 'BAB', value: formattedBab },
    {
      label: 'Saves',
      value: `F ${formatSignedBonus(saves.fort)} / R ${formatSignedBonus(saves.ref)} / W ${formatSignedBonus(saves.will)}`
    }
  ];
}

/**
 * Evaluates declarative `'interaction_reach_tiles'` StatModifiers (e.g., Mage Hand or telekinesis buffs)
 * to extend an actor's effective physical/touch interaction reach beyond baseline natural/probe reach.
 */
function resolveDnD35eInteractionReachTiles(
  state: GameState,
  actorId: EntityId,
  _verb: Verb,
  baseReachTiles: number
): number {
  const dag = evaluateDnD35eEntityDAG(state, actorId);
  if (!dag) return baseReachTiles;
  const reachMods = (dag.statModifiers ?? []).filter((m) => m.targetStat === 'interaction_reach_tiles');
  if (reachMods.length === 0) return baseReachTiles;
  const bonusReach = resolveTypedModifiers(reachMods, { selfTags: dag.selfTags });
  return Math.max(baseReachTiles, baseReachTiles + bonusReach);
}

const DND35E_BASE_CONTENT_FILES: ReadonlyArray<RulesetBaseFileDescriptor> = [
  { key: 'status', filename: 'status.json' },
  { key: 'effects', filename: 'effects.json' }
];

/**
 * The `dnd35e` (Dungeons & Dragons 3.5e SRD) ruleset cartridge entry point.
 */
export const dnd35eRulesetContract: RulesetContract = {
  id: 'dnd35e',
  metadata: {
    id: 'dnd35e',
    name: 'Dungeons & Dragons 3.5e (SRD)',
    shortLabel: 'D&D 3.5e',
    badgeIcon: '🐉',
    version: '1.0.0',
    description:
      'Tactical d20 open-gaming ruleset featuring 6 Ability Scores, 18-type bonus stacking, 5-ft footprint/reach & cover geometry, 5-tier action economy, Attacks of Opportunity, and Vancian spellcasting.',
    features: [
      '6 Ability Scores & 18-Type Bonus Stacking Engine',
      'Full / Touch / Flat-Footed AC & Saving Throws (Fort/Ref/Will)',
      '5-Foot Grid Reach Rings, Cover & Flanking Geometry',
      '5-Tier Action Economy, Attacks of Opportunity & Vancian Magic'
    ]
  },
  getEffectiveActorStats: computeDnD35eEffectiveStats,
  resolveMeleeAttack: resolveDnD35eMeleeAttack,
  processDamage: processDnD35eDamage,
  grantActorXp: grantDnD35eXp,
  projectHudVitals: projectDnD35eHudVitals,
  projectInspectStats: projectDnD35eInspectStats,
  resolveInteractionReachTiles: resolveDnD35eInteractionReachTiles,
  resolveItemEffect: resolveDnD35eSpellItemEffect,
  getEditorViewGroups(baseGroups: ReadonlyArray<ViewGroup>): ReadonlyArray<ViewGroup> {
    return baseGroups;
  },
  getBaseContentFiles(): ReadonlyArray<RulesetBaseFileDescriptor> {
    return DND35E_BASE_CONTENT_FILES;
  },
  getSystemContentFiles(): ReadonlyArray<RulesetSystemFileDescriptor> {
    return DND35E_SYSTEM_CONTENT_FILES;
  },
  parseSystemContent(raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    return parseDnD35SystemContent(raw) as unknown as Readonly<Record<string, unknown>>;
  },
  validateCampaignRuleset: checkDnD35eRuleset,
  resolveSkillVerb: resolveDnD35eSkillVerb,
  getValidRulesetVerbsForTarget: getDnD35eValidVerbsForTarget,
  validateWandActivation: validateDnD35eWandActivation,
  projectInspectLoreLines: projectDnD35eInspectLoreLines,
  onActorTurnStart: onDnD35eActorTurnStart,
  onActorMovementStep: onDnD35eActorMovementStep,
  getEntityMovementModes(state, entityId) {
    return resolveDnD35eMovementModes(state, entityId);
  },
  evaluateCombatChargeIntent(state, attackerId, defenderId) {
    return validateChargeLine(state, attackerId, defenderId).valid;
  },
  resolveActionEnergyCost: resolveDnD35eActionEnergyCost,
  canActorPerformIntent: canDnD35eActorPerformIntent,
  hasActorActedThisTurn: hasDnD35eActorActedThisTurn,
  hasActorMovementInProgress: hasDnD35eActorMovementInProgress,
  resolveAimedAction(state, actorId, targetPos, context) {
    if (context.verb === 'cast_spell' && context.spellId && context.classId) {
      return executeDnD35eSpellCast(state, actorId, targetPos, {
        classId: context.classId,
        spellId: context.spellId,
        slotId: context.slotId,
        spellLevel: context.spellLevel,
        convertedSpellId: context.convertedSpellId,
        metamagicFeatIds: context.metamagicFeatIds
      });
    }
    if (context.verb === 'abrupt_jaunt') {
      return executeAbruptJauntTeleport(state, actorId, targetPos.x, targetPos.y, true);
    }
    if (context.verb === 'charge') {
      const targetZ = targetPos.z ?? 0;
      const occupants = getEntitiesAtPosition(state, targetPos.x, targetPos.y, targetZ);
      const targetId =
        occupants.find((id) => {
          if (id === actorId) return false;
          const fighter = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
          return fighter !== undefined && fighter.hp > 0 && isHostile(state, actorId, id);
        }) ??
        occupants.find((id) => {
          if (id === actorId) return false;
          const fighter = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
          return fighter !== undefined && fighter.hp > 0;
        });
      if (targetId === undefined) {
        return {
          state: addMessage(state, '[Charge] Select a living target to Charge.', MessageLogCategory.System),
          success: false
        };
      }
      return executeDnD35eChargeAction(state, actorId, targetId);
    }
    return { state, success: false };
  },
  resolveUseAbility(state, intent) {
    if (intent.effectId === 'action:charge') {
      return initiateDnD35eChargeTargeting(state, intent.entityId);
    }
    if (intent.effectId === 'skill:stealth') {
      const res = toggleActorStealth(state, intent.entityId);
      return { state: res.state, success: res.reason === undefined };
    }
    if (intent.effectId === 'skill:fast_stealth') {
      return { state: toggleActorFastStealth(state, intent.entityId), success: true };
    }
    if (intent.effectId.startsWith('pool:')) {
      const poolId = intent.effectId.slice('pool:'.length);
      return executeDnD35eResourcePoolAbility(state, intent.entityId, poolId);
    }
    if (intent.effectId.startsWith('shapeshift:')) {
      const formId = intent.effectId.slice('shapeshift:'.length) as DnD35ShapeshiftFormId;
      return executeDruidShapeshift(state, intent.entityId, formId);
    }
    if (intent.effectId.startsWith('shapeshift_')) {
      const formId = intent.effectId.slice('shapeshift_'.length) as DnD35ShapeshiftFormId;
      return executeDruidShapeshift(state, intent.entityId, formId);
    }
    return null;
  },
  resolveActorSpatialProfile: resolveDnD35eActorSpatialProfile,
  syncActorSpatialFootprint: syncDnD35eActorSpatialFootprint,
  onWorldHourElapsed: onDnD35eWorldHourElapsed,
  resolveItemHandRequirement: resolveDnD35eItemHandRequirement,
  getDefaultCurrencyConfig: () => DND35E_DEFAULT_CURRENCY_CONFIG,
  getDefaultWorldClockConfig: () => DND35E_DEFAULT_WORLD_CLOCK_CONFIG,
  getTradeSocialActions: getDnD35eTradeSocialActions,
  evaluateTradePriceModifier: evaluateDnD35eTradePriceModifier,
  resolveTradeSocialSkill: resolveDnD35eTradeSocialSkill,
  evaluateDialogueSkillCheck: evaluateDnD35eDialogueSkillCheck,
  getActorSkillModifier: getDnD35eActorSkillModifier,
  onEntitySpawned: onDnD35eEntitySpawned,
  resolveKillXpReward: resolveDnD35eKillXpReward,
  onAmbushSurprise(state, surprisedEntityIds) {
    let nextState = state;
    for (const entityId of surprisedEntityIds) {
      const dndData = getDnD35EntityData(nextState, entityId);
      const conds = dndData.conditions ?? [];
      const nextConds = conds.includes('flat_footed') ? conds : [...conds, 'flat_footed' as const];
      const nextBudget = dndData.actionBudget ? { ...dndData.actionBudget, isFlatFooted: true } : undefined;
      nextState = setDnD35EntityData(nextState, entityId, {
        ...dndData,
        conditions: nextConds,
        ...(nextBudget !== undefined ? { actionBudget: nextBudget } : {})
      });
    }
    return nextState;
  },
  resolveStatusSecondaryStage(state, entityId, _activeEffect, statusDef) {
    const dc = statusDef.secondarySaveDc ?? 14;
    const effectTags =
      statusDef.tags && statusDef.tags.length > 0
        ? statusDef.tags.map((t) => (t.startsWith('effect:') ? t : `effect:${t}`))
        : [`effect:${statusDef.id}`];
    const baseDag = evaluateDnD35eEntityDAG(state, entityId);
    const contextualDag = evaluateDnD35eEntityDAG(state, entityId, { effectTags });
    const totalFort = contextualDag?.dagResult.saves.fort ?? baseDag?.dagResult.saves.fort ?? 0;
    const baselineFort = baseDag?.dagResult.saves.fort ?? totalFort;
    const contextualBonus = totalFort - baselineFort;
    const contextualMod = contextualDag?.dagResult.saveBreakdowns?.fort.modifierBreakdown.activeModifiers.find(
      (m) => m.condition?.effectTagsAny !== undefined
    );
    const contextualBonusType = contextualMod?.bonusType ?? 'resistance';

    const saveRes = resolveSavingThrow({
      saveType: 'fort',
      baseSave: totalFort,
      abilityModifier: 0,
      miscBonus: 0,
      dc
    });
    const name = resolveEntityDisplayName(state, entityId, 'Someone');
    const bonusNote = contextualBonus > 0 ? ` (+${contextualBonus} ${contextualBonusType})` : '';
    const msg = saveRes.success
      ? `${name} resists secondary ${statusDef.name} damage (Fortitude ${saveRes.total}${bonusNote} vs DC ${dc})!`
      : `${name} fails to resist secondary ${statusDef.name} damage (Fortitude ${saveRes.total}${bonusNote} vs DC ${dc})!`;
    return {
      state: addMessage(state, msg, saveRes.success ? MessageLogCategory.System : MessageLogCategory.CombatHit),
      resisted: saveRes.success
    };
  },
  isActorImmuneToDrowning(state, entityId) {
    const dndData = getDnD35EntityData(state, entityId);
    if (dndData.abilityScores?.con?.base === null) return true;
    const dag = evaluateDnD35eEntityDAG(state, entityId);
    if (!dag) return false;
    if (dag.dagResult.abilityBreakdowns?.con?.effectiveScore === null) return true;
    return (
      dag.selfTags.includes('trait:water_breathing') ||
      dag.selfTags.includes('type:undead') ||
      dag.selfTags.includes('type:construct')
    );
  },
  getActorMaxBreathTurns(state, entityId) {
    const dag = evaluateDnD35eEntityDAG(state, entityId);
    const conScore =
      dag?.dagResult.abilityBreakdowns?.con?.effectiveScore ??
      getDnD35EntityData(state, entityId).abilityScores?.con?.base ??
      10;
    return Math.max(1, (conScore ?? 10) * 2);
  },
  onCrossingCollapsedForOccupant(state, occupantId, x, y) {
    return evaluateActorTileHazardOccupation(state, occupantId, x, y);
  },
  onEntityDied(state, victimId, x, y) {
    return spawnArcaneCasterSpellbookLoot(state, victimId, x, y).state;
  },
  onStatusEffectExpired: onDnD35eStatusEffectExpired,
  projectActiveEffects: projectDnD35eActiveEffects,
  measureDistance3DFt: measureDnD35Distance3DFt,
  evaluateElevationCombatModifiers: evaluateDnD35eElevationCombat,
  onEntityFallLanded: resolveDnD35eFallLanded,
  canActorAdjustAltitude: evaluateDnD35eAltitudeAdjustment,
  evaluateLanguageComprehension: evaluateDnD35eLanguageComprehension,
  resolveShove(state, actorId, targetEntityId) {
    const res = resolveBullRushImpact(state, {
      attackerId: actorId,
      defenderId: targetEntityId
    });
    return {
      state: res.state,
      success: res.success,
      pushedSquares: res.pushedSquares
    };
  }
};
