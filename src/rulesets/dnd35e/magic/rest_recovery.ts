/**
 * @file D&D 3.5e 8-Hour Rest Recovery Simulation.
 * Applies D&D 3.5e rest recovery rules (1 pt ability damage healing, 1 HP/HD natural healing
 * for living actors — doubled to 2x with DC 15 Long-Term Care from a medical kit — Vancian/spontaneous
 * spellbook refresh honoring the 8-hour recent-cast rule, fatigue downgrade/removal, resource pool refresh,
 * and round action budget reset) symmetrically across the player and controlled companions, building atop
 * Tier 1 Console watch-chunked rest primitives.
 */

import { addComponent, getComponent, refreshResourcePools } from '../../../core/ecs.ts';
import { getPlayerCompanions } from '../../../systems/companion_commands.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  evaluateActorRestSafety,
  executeWatchChunkedBulkRest,
  finalizeBulkTimeEventsAndRespawn
} from '../../../systems/rest.system.ts';
import { resetTriggeredReactionsForNewRound } from '../../../systems/stance.system.ts';
import { formatWorldClockShort, readWorldClock } from '../../../systems/world_clock.system.ts';
import type { BulkTimeAdvanceResult } from '../../../systems/world_time_skip.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent,
  type ResourcePoolComponent,
  type StatusEffectsComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { hydrateEntityRoundActionBudget } from '../cartridge/dnd35e_turn_budget.ts';
import { evaluateEffectBundle } from '../effect_bundle.ts';
import { resolveEffectiveItemDefinition } from '../equipment/item_inheritance.ts';
import { resolveTypedModifiers } from '../modifiers.ts';
import { buildActorResourcePoolsComponent } from '../progression/ledger_resource_pools.ts';
import { HEAL_SKILL_STANDARD_DC, TAKE_10_VALUE } from '../skills.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import {
  ALL_ABILITY_IDS,
  type AbilityId,
  type DnD35ClassSpellbookState,
  type DnD35ConditionId,
  type StatModifier
} from '../types/dnd35e.types.ts';
import { getDnD35SystemContent, type DnD35ItemDefinition } from '../types/dnd35e_system.types.ts';
import { EIGHT_HOURS_IN_ROUNDS, resolveSpellbookEightHourRest } from './aoe_rest.ts';

/** Declarative tag identifying medical / healer kits in inventory (`healers_kit`). */
export const MEDICAL_KIT_ITEM_TAG = 'medical_kit';

/** Recovery multiplier granted by successful DC 15 Long-Term Care (`2x` per PHB p. 75). */
export const LONG_TERM_CARE_RECOVERY_MULTIPLIER = 2;

/** Status effect IDs cured upon completing an 8-hour rest (`limping`, `caltrop_wound`). */
const REST_CURED_STATUS_IDS: ReadonlySet<string> = new Set(['limping', 'caltrop_wound']);

/**
 * Collects passive `skill:heal` StatModifiers from any carried item in `actorId`'s inventory
 * that bears the declarative `'medical_kit'` tag (e.g. `healers_kit.json`), without hardcoding item IDs.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor EntityId.
 * @returns Array of `StatModifier`s targeting `'skill:heal'` and whether a medical kit is present.
 */
export function collectInventoryMedicalKitHealModifiers(
  state: GameState,
  actorId: EntityId
): { readonly hasMedicalKit: boolean; readonly modifiers: ReadonlyArray<StatModifier> } {
  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  const eq = getComponent(state, actorId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const dndData = getDnD35EntityData(state, actorId);
  const suppressed = dndData.suppressedBundleIds ?? [];

  const allItemEntIds: EntityId[] = [...(inv?.items ?? [])];
  for (const slot of eq?.slots ?? []) {
    if (slot.equippedItem !== null) {
      allItemEntIds.push(slot.equippedItem);
    }
  }

  let hasMedicalKit = false;
  const modifiers: StatModifier[] = [];

  for (const itemEntId of allItemEntIds) {
    const itemComp = getComponent(state, itemEntId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const rawDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
    if (!rawDef) continue;
    const itemDef = resolveEffectiveItemDefinition(rawDef, state.campaign.items, itemComp);
    if (!(itemDef.tags ?? []).includes(MEDICAL_KIT_ITEM_TAG)) continue;

    hasMedicalKit = true;
    if (itemDef.effectBundle) {
      const evalRes = evaluateEffectBundle(itemDef.effectBundle, `item:${itemDef.id}`, suppressed, []);
      for (const mod of evalRes.statModifiers) {
        if (mod.targetStat === 'skill:heal') {
          modifiers.push(mod);
        }
      }
    }
  }

  return { hasMedicalKit, modifiers };
}

/**
 * Evaluates whether any party member carrying a `'medical_kit'` item succeeds on a Take-10
 * Long-Term Care check (`Heal DC 15`, PHB p. 75), returning `2` (`2x` natural HP and ability-damage
 * recovery) on success or `1` otherwise.
 *
 * @param state Current immutable GameState.
 * @param partyIds Array of party EntityIds.
 * @returns `2` if Long-Term Care succeeded, else `1`.
 */
export function evaluateLongTermCareMultiplier(state: GameState, partyIds: ReadonlyArray<EntityId>): number {
  for (const caregiverId of partyIds) {
    const kitInfo = collectInventoryMedicalKitHealModifiers(state, caregiverId);
    if (!kitInfo.hasMedicalKit) continue;

    const dag = evaluateDnD35eEntityDAG(state, caregiverId);
    const baseHealMod = dag?.resolvedSkills['heal']?.totalModifier ?? 0;
    const existingHealMods = dag?.resolvedSkills['heal']?.modifierBreakdown.activeModifiers ?? [];
    const combinedHealBonus = resolveTypedModifiers([...existingHealMods, ...kitInfo.modifiers]);
    const existingTypedSum = resolveTypedModifiers(existingHealMods);
    const kitDelta = combinedHealBonus - existingTypedSum;
    const totalHealTake10 = TAKE_10_VALUE + baseHealMod + kitDelta;

    if (totalHealTake10 >= HEAL_SKILL_STANDARD_DC) {
      return LONG_TERM_CARE_RECOVERY_MULTIPLIER;
    }
  }
  return 1;
}

/**
 * Recovers `1 * recoveryMultiplier` points of ability damage on each damaged ability score,
 * heals `1 * recoveryMultiplier` lethal HP per total HD (for living actors with non-null CON),
 * refreshes all eligible spellbook slots honoring the 8-hour recent-cast rule, downgrades
 * `exhausted -> fatigued` or removes `fatigued`, clears `limping` foot wounds, syncs & refreshes
 * all resource pools, and resets round action budgets & reaction counters for a single actor.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor EntityId receiving 8-hour rest recovery.
 * @param recoveryMultiplier Natural healing multiplier (`1` normal, `2` with Long-Term Care).
 * @returns Updated GameState and count of retained recent-cast slots.
 */
export function applyEightHourRestToActor(
  state: GameState,
  actorId: EntityId,
  recoveryMultiplier = 1
): { readonly state: GameState; readonly retainedRecentCastCount: number } {
  const fighter = getComponent(state, actorId, ComponentType.Fighter);
  if (!fighter) {
    return { state, retainedRecentCastCount: 0 };
  }

  let nextState = state;
  const mult = Math.max(1, Math.floor(recoveryMultiplier));
  const dndData = getDnD35EntityData(nextState, actorId);
  const abilities = dndData.abilityScores;

  let abilityDamageHealed = false;
  const healedAbilities = { ...abilities } as Record<AbilityId, (typeof abilities)[AbilityId]>;
  for (const ab of ALL_ABILITY_IDS) {
    const entry = abilities[ab];
    if (entry.damage > 0) {
      abilityDamageHealed = true;
      healedAbilities[ab] = { ...entry, damage: Math.max(0, entry.damage - mult) };
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

  const statusComp = getComponent(nextState, actorId, ComponentType.StatusEffects) as
    StatusEffectsComponent | undefined;
  if (statusComp && statusComp.activeEffects.some((e) => REST_CURED_STATUS_IDS.has(e.effectId))) {
    const remainingStatuses = statusComp.activeEffects.filter((e) => !REST_CURED_STATUS_IDS.has(e.effectId));
    nextState = addComponent(nextState, actorId, { ...statusComp, activeEffects: remainingStatuses });
  }

  const dag = evaluateDnD35eEntityDAG(nextState, actorId);
  const isLiving = healedAbilities.con.base !== null && dag?.dagResult.abilityBreakdowns?.con?.effectiveScore !== null;
  if (isLiving) {
    const effectiveMaxHp = Math.max(fighter.maxHp, dag?.dagResult.maxHp ?? fighter.maxHp);
    const healedHp = Math.min(effectiveMaxHp, fighter.hp + effectiveHd * mult);
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
 * Applies post-bulk-time-advance rest recovery (natural healing — doubled with Long-Term Care —
 * ability damage healing, spell slot refresh with 8h retention, `rest_8h` pool recharge, fatigue removal,
 * companion recovery, active-area respawn, and world event digest), or reports interruption when aborted mid-rest.
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
  const recoveryMultiplier = evaluateLongTermCareMultiplier(nextState, partyIds);
  let totalRetainedRecentCasts = 0;

  for (const actorId of partyIds) {
    const recovered = applyEightHourRestToActor(nextState, actorId, recoveryMultiplier);
    nextState = recovered.state;
    totalRetainedRecentCasts += recovered.retainedRecentCastCount;
  }

  nextState = finalizeBulkTimeEventsAndRespawn(nextState, bulkRes.summaryEvents, 'rested');

  const careNote = recoveryMultiplier > 1 ? ' Long-Term Care doubled natural healing (2x).' : '';
  const retentionNote =
    totalRetainedRecentCasts > 0
      ? ` (${totalRetainedRecentCasts} slot(s) cast within the last 8 hours remained expended.)`
      : '';
  return addMessage(
    nextState,
    `Rest completed (8 hours). It is now ${formatWorldClockShort(readWorldClock(nextState))}. All eligible daily spell slots and abilities refreshed.${careNote}${retentionNote}`,
    MessageLogCategory.System
  );
}

/**
 * Performs an 8-hour rest synchronously when safe, evaluating watch-chunk camp ambushes in non-safe
 * areas and interrupting cleanly if an ambush or environmental hazard emerges mid-rest.
 *
 * @param state Current immutable GameState.
 * @param playerId Player EntityId.
 * @param forcedAmbushRollPerWatch Optional deterministic `[0, 1)` roll override for watch ambush tests.
 * @param forcedWatchD20 Optional deterministic `1..20` d20 roll override for watch perception tests.
 * @returns Updated GameState.
 */
export function executeEightHourRest(
  state: GameState,
  playerId: EntityId,
  forcedAmbushRollPerWatch?: number,
  forcedWatchD20?: number
): GameState {
  const safety = evaluateActorRestSafety(state, playerId);
  if (!safety.safe) {
    return addMessage(state, safety.reason ?? 'You cannot rest right now!', MessageLogCategory.System);
  }
  const bulkRes = executeWatchChunkedBulkRest(
    state,
    playerId,
    EIGHT_HOURS_IN_ROUNDS,
    (current) => {
      const check = evaluateActorRestSafety(current, playerId);
      return check.safe ? undefined : check.reason;
    },
    forcedAmbushRollPerWatch,
    forcedWatchD20
  );
  return finalizeEightHourRestRecovery(bulkRes, playerId);
}
