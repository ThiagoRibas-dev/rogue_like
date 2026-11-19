/**
 * @file D&D 3.5e 8-Hour Rest Recovery Simulation.
 * Applies D&D 3.5e rest recovery rules (1 pt ability damage healing, 1 HP/HD natural healing
 * for living actors, Vancian/spontaneous spellbook refresh honoring the 8-hour recent-cast rule,
 * fatigue downgrade/removal, resource pool refresh, and round action budget reset) symmetrically
 * across the player and controlled companions, building atop Tier 1 Console rest primitives.
 */

import { addComponent, getComponent, refreshResourcePools } from '../../../core/ecs.ts';
import { getPlayerCompanions } from '../../../systems/companion_commands.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { evaluateActorRestSafety, finalizeBulkTimeEventsAndRespawn } from '../../../systems/rest.system.ts';
import { resetTriggeredReactionsForNewRound } from '../../../systems/stance.system.ts';
import { formatWorldClockShort, readWorldClock } from '../../../systems/world_clock.system.ts';
import { advanceWorldTimeBulk, type BulkTimeAdvanceResult } from '../../../systems/world_time_skip.ts';
import {
  ComponentType,
  type ResourcePoolComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { hydrateEntityRoundActionBudget } from '../cartridge/dnd35e_turn_budget.ts';
import { buildActorResourcePoolsComponent } from '../progression/ledger_resource_pools.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import {
  ALL_ABILITY_IDS,
  type AbilityId,
  type DnD35ClassSpellbookState,
  type DnD35ConditionId
} from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { EIGHT_HOURS_IN_ROUNDS, resolveSpellbookEightHourRest } from './aoe_rest.ts';

/**
 * Recovers 1 point of ability damage on each damaged ability score, heals 1 lethal HP per total HD
 * (for living actors with non-null CON), refreshes all eligible spellbook slots honoring the 8-hour
 * recent-cast rule, downgrades `exhausted -> fatigued` or removes `fatigued`, syncs & refreshes all
 * resource pools, and resets round action budgets & reaction counters for a single actor.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor EntityId receiving 8-hour rest recovery.
 * @returns Updated GameState and count of retained recent-cast slots.
 */
export function applyEightHourRestToActor(
  state: GameState,
  actorId: EntityId
): { readonly state: GameState; readonly retainedRecentCastCount: number } {
  const fighter = getComponent(state, actorId, ComponentType.Fighter);
  if (!fighter) {
    return { state, retainedRecentCastCount: 0 };
  }

  let nextState = state;
  const dndData = getDnD35EntityData(nextState, actorId);
  const abilities = dndData.abilityScores;

  let abilityDamageHealed = false;
  const healedAbilities = { ...abilities } as Record<AbilityId, (typeof abilities)[AbilityId]>;
  for (const ab of ALL_ABILITY_IDS) {
    const entry = abilities[ab];
    if (entry.damage > 0) {
      abilityDamageHealed = true;
      healedAbilities[ab] = { ...entry, damage: Math.max(0, entry.damage - 1) };
    } else {
      healedAbilities[ab] = entry;
    }
  }

  const totalTrackLevels = dndData.tracks.reduce((sum, t) => sum + t.levels, 0);
  const effectiveHd = Math.max(1, totalTrackLevels > 0 ? totalTrackLevels : fighter.level || 1);

  const classBooks = dndData.spellbooksByClass ?? {};
  const refreshedBooks: Record<string, DnD35ClassSpellbookState> = {};
  let booksChanged = false;
  let retainedRecentCastCount = 0;

  for (const [cid, book] of Object.entries(classBooks)) {
    const restRes = resolveSpellbookEightHourRest({
      book,
      restCompletionTurn: nextState.globalTurn,
      characterLevel: effectiveHd,
      isThreatened: false
    });
    refreshedBooks[cid] = restRes.updatedBook;
    retainedRecentCastCount += restRes.retainedRecentCastCount;
    booksChanged = true;
  }

  const currentConditions = dndData.conditions ?? [];
  let nextConditions: ReadonlyArray<DnD35ConditionId> = currentConditions;
  if (currentConditions.includes('exhausted')) {
    const filtered = currentConditions.filter((c) => c !== 'exhausted');
    nextConditions = filtered.includes('fatigued') ? filtered : [...filtered, 'fatigued'];
  } else if (currentConditions.includes('fatigued')) {
    nextConditions = currentConditions.filter((c) => c !== 'fatigued');
  }

  let updatedDndData = {
    ...dndData,
    abilityScores: healedAbilities,
    conditions: nextConditions,
    ...(booksChanged ? { spellbooksByClass: refreshedBooks } : {})
  };
  nextState = setDnD35EntityData(nextState, actorId, updatedDndData);

  const dag = evaluateDnD35eEntityDAG(nextState, actorId);
  const isLiving = healedAbilities.con.base !== null && dag?.dagResult.abilityBreakdowns?.con?.effectiveScore !== null;
  if (isLiving) {
    const effectiveMaxHp = Math.max(fighter.maxHp, dag?.dagResult.maxHp ?? fighter.maxHp);
    const healedHp = Math.min(effectiveMaxHp, fighter.hp + effectiveHd);
    nextState = addComponent(nextState, actorId, { ...fighter, hp: healedHp, maxHp: effectiveMaxHp });
  }

  const sysContent = getDnD35SystemContent(nextState.campaign);
  if (abilityDamageHealed && sysContent) {
    const existingPools = getComponent(nextState, actorId, ComponentType.ResourcePool) as
      ResourcePoolComponent | undefined;
    const rebuiltPools = buildActorResourcePoolsComponent(updatedDndData, sysContent, existingPools);
    if (existingPools || rebuiltPools) {
      nextState = addComponent(nextState, actorId, {
        type: ComponentType.ResourcePool,
        pools: {
          ...(existingPools?.pools ?? {}),
          ...(rebuiltPools?.pools ?? {})
        }
      });
    }
  }
  nextState = refreshResourcePools(nextState, actorId, 'rest_8h');

  updatedDndData = {
    ...getDnD35EntityData(nextState, actorId),
    actionBudget: hydrateEntityRoundActionBudget(nextState, actorId)
  };
  nextState = setDnD35EntityData(nextState, actorId, updatedDndData);

  const doctrine = getComponent(nextState, actorId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  if (doctrine) {
    nextState = addComponent(nextState, actorId, resetTriggeredReactionsForNewRound(doctrine));
  }

  return { state: nextState, retainedRecentCastCount };
}

/**
 * Applies post-bulk-time-advance rest recovery (natural healing, 1 pt ability damage healing,
 * spell slot refresh with 8h retention, `rest_8h` pool recharge, fatigue removal, companion recovery,
 * active-area respawn, and world event digest), or reports interruption when aborted mid-rest.
 *
 * @param bulkRes Completed or interrupted bulk time progression result.
 * @param playerId Player EntityId.
 * @returns Updated GameState.
 */
export function finalizeEightHourRestRecovery(bulkRes: BulkTimeAdvanceResult, playerId: EntityId): GameState {
  if (bulkRes.interruptedReason !== undefined) {
    const respawnedState = finalizeBulkTimeEventsAndRespawn(bulkRes.state, bulkRes.summaryEvents, 'rested');
    return addMessage(
      respawnedState,
      `Rest interrupted at ${formatWorldClockShort(readWorldClock(respawnedState))}: ${bulkRes.interruptedReason}`,
      MessageLogCategory.System
    );
  }

  let nextState = bulkRes.state;
  const partyIds = Array.from(new Set<EntityId>([playerId, ...getPlayerCompanions(nextState, playerId)]));
  let totalRetainedRecentCasts = 0;

  for (const actorId of partyIds) {
    const recovered = applyEightHourRestToActor(nextState, actorId);
    nextState = recovered.state;
    totalRetainedRecentCasts += recovered.retainedRecentCastCount;
  }

  nextState = finalizeBulkTimeEventsAndRespawn(nextState, bulkRes.summaryEvents, 'rested');

  const retentionNote =
    totalRetainedRecentCasts > 0
      ? ` (${totalRetainedRecentCasts} slot(s) cast within the last 8 hours remained expended.)`
      : '';
  return addMessage(
    nextState,
    `Rest completed (8 hours). It is now ${formatWorldClockShort(readWorldClock(nextState))}. All eligible daily spell slots and abilities refreshed.${retentionNote}`,
    MessageLogCategory.System
  );
}

/**
 * Performs an 8-hour rest synchronously when safe, interrupting cleanly if a hazard emerges mid-rest.
 *
 * @param state Current immutable GameState.
 * @param playerId Player EntityId.
 * @returns Updated GameState.
 */
export function executeEightHourRest(state: GameState, playerId: EntityId): GameState {
  const safety = evaluateActorRestSafety(state, playerId);
  if (!safety.safe) {
    return addMessage(state, safety.reason ?? 'You cannot rest right now!', MessageLogCategory.System);
  }
  const bulkRes = advanceWorldTimeBulk(state, EIGHT_HOURS_IN_ROUNDS, playerId, (current) => {
    const check = evaluateActorRestSafety(current, playerId);
    return check.safe ? undefined : check.reason;
  });
  return finalizeEightHourRestRecovery(bulkRes, playerId);
}
