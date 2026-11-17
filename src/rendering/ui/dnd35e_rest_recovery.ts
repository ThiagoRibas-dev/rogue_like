/**
 * @file D&D 3.5e Rest Safety Evaluation & Per-Actor 8-Hour Recovery Helpers.
 * Evaluates party-wide rest safety predicates and applies 8-hour rest recovery
 * (ability damage, living HP, Vancian/spontaneous spellbook refresh with 8h retention,
 * fatigue downgrade/removal, resource pools, and round action budgets) symmetrically
 * across the player and controlled companions.
 */

import { addComponent, getComponent, refreshResourcePools } from '../../core/ecs.ts';
import { evaluateDnD35eEntityDAG } from '../../rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { hydrateEntityRoundActionBudget } from '../../rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts';
import { resolveSpellbookEightHourRest } from '../../rulesets/dnd35e/magic/aoe_rest.ts';
import { buildActorResourcePoolsComponent } from '../../rulesets/dnd35e/progression/ledger_resource_pools.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import {
  ALL_ABILITY_IDS,
  type AbilityId,
  type DnD35ClassSpellbookState,
  type DnD35ConditionId
} from '../../rulesets/dnd35e/types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { getPlayerCompanions } from '../../systems/companion_commands.system.ts';
import { queryActiveFieldsAtPosition } from '../../systems/field.system.ts';
import { getHungerState, HungerState } from '../../systems/hunger.system.ts';
import { resetTriggeredReactionsForNewRound } from '../../systems/stance.system.ts';
import { isActorThreatenedByVisibleHostiles } from '../../systems/world_clock.system.ts';
import {
  ComponentType,
  type HungerComponent,
  type PositionComponent,
  type ResourcePoolComponent,
  type StatusEffectsComponent,
  type TacticalDoctrineComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

/** Result of evaluating whether an actor and active party can safely rest or prepare spells. */
export interface RestSafetyEvaluation {
  readonly safe: boolean;
  readonly reason?: string | undefined;
}

/**
 * Checks declaratively whether `playerId` and all controlled companions are in safe conditions
 * to rest or prepare spells: no visible hostiles, no active damaging status afflictions,
 * non-starving satiation, and no standing hazardous spatial fields.
 *
 * @param state Current immutable GameState.
 * @param playerId Player EntityId.
 * @returns `{ safe: true }` or `{ safe: false, reason }`.
 */
export function evaluateActorRestSafety(state: GameState, playerId: EntityId): RestSafetyEvaluation {
  if (isActorThreatenedByVisibleHostiles(state, playerId)) {
    return {
      safe: false,
      reason: 'Cannot rest or prepare spells while hostile creatures are visible!'
    };
  }

  const partyIds = Array.from(new Set<EntityId>([playerId, ...getPlayerCompanions(state, playerId)]));
  for (const actorId of partyIds) {
    const statusComp = getComponent(state, actorId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
    for (const eff of statusComp?.activeEffects ?? []) {
      const def = state.campaign.status[eff.effectId];
      if (def && def.perTurnDamage !== undefined && def.perTurnDamage > 0) {
        return {
          safe: false,
          reason: 'Cannot rest while you or a companion suffers from ongoing damaging afflictions!'
        };
      }
    }

    const pos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
    if (pos) {
      for (const activeField of queryActiveFieldsAtPosition(state, pos.x, pos.y)) {
        const fDef = state.campaign.fields[activeField.field.fieldType];
        const fieldHasDotStatus =
          fDef?.statusEffectId !== undefined && (state.campaign.status[fDef.statusEffectId]?.perTurnDamage ?? 0) > 0;
        if ((fDef && (fDef.damagePerTurn ?? 0) > 0) || fieldHasDotStatus) {
          return {
            safe: false,
            reason: 'Cannot rest while standing in a hazardous area!'
          };
        }
      }
    }
  }

  const hunger = getComponent(state, playerId, ComponentType.Hunger) as HungerComponent | undefined;
  if (hunger && (getHungerState(state, hunger.satiation) === HungerState.Starving || hunger.satiation <= 0)) {
    return {
      safe: false,
      reason: 'Cannot rest while starving! Eat food before resting.'
    };
  }

  return { safe: true };
}

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
