import { getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { queryActiveFieldsAtPosition } from '../../../systems/field.system.ts';
import {
  ComponentType,
  type FieldComponent,
  type FighterComponent,
  type PositionComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateAdjacentEnemyReactionsOnMove } from '../combat/immediate_reactions.ts';
import { resolveAuraFirstEntrySaveAndSr } from '../magic/spell_aura_resolver.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import {
  DISTRACTED_FLANKED_STATUS_ID,
  removeStatusEffectById,
  syncSpatialFlankingGraph
} from '../spatial/flanking_graph.ts';
import { syncDnD35eActorSpatialFootprint } from '../spatial/footprint_resolver.ts';
import { FEET_PER_GRID_SQUARE } from '../spatial/grid_geometry.ts';
import { evaluateActorLightExposure } from '../spatial/light_exposure.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { evaluateDnD35eEntityDAG } from './dnd35e_dag_adapter.ts';
import {
  canDnD35eActorPerformIntent,
  hasDnD35eActorActedThisTurn,
  hasDnD35eActorMovementInProgress,
  hydrateEntityRoundActionBudget,
  resolveDnD35eActionEnergyCost
} from './dnd35e_turn_budget.ts';

export {
  canDnD35eActorPerformIntent,
  hasDnD35eActorActedThisTurn,
  hasDnD35eActorMovementInProgress,
  hydrateEntityRoundActionBudget,
  resolveDnD35eActionEnergyCost
};

/** Default caster level fallback when not specified on FieldComponent (`1`). */
const DEFAULT_CASTER_LEVEL = 1;

/** Standard base DC constant (`10`). */
const BASE_SPELL_DC = 10;

/**
 * Maximum Chebyshev tile radius (`12` = 60 ft, covering Colossal footprints + 30 ft reach) within which
 * another living combatant triggers flanking graph recalculation on a 5-ft movement step.
 */
const MAX_FLANKING_STEP_CHECK_RADIUS_TILES = 12;

function hasRelevantFlankingNeighborForStep(
  state: GameState,
  entityId: EntityId,
  fromPos: { readonly x: number; readonly y: number },
  toPos: { readonly x: number; readonly y: number }
): boolean {
  const moverData = getDnD35EntityData(state, entityId);
  if (
    (moverData.flankingRelations?.flankingTargetIds.length ?? 0) > 0 ||
    (moverData.flankingRelations?.flankedByEntityIds.length ?? 0) > 0
  ) {
    return true;
  }

  for (const otherId of state.entities) {
    if (otherId === entityId) continue;
    const otherFighter = getComponent(state, otherId, ComponentType.Fighter) as FighterComponent | undefined;
    const otherPos = getComponent(state, otherId, ComponentType.Position) as PositionComponent | undefined;
    if (!otherFighter || otherFighter.hp <= 0 || !otherPos) continue;

    const distFrom = Math.max(Math.abs(otherPos.x - fromPos.x), Math.abs(otherPos.y - fromPos.y));
    const distTo = Math.max(Math.abs(otherPos.x - toPos.x), Math.abs(otherPos.y - toPos.y));
    if (distFrom <= MAX_FLANKING_STEP_CHECK_RADIUS_TILES || distTo <= MAX_FLANKING_STEP_CHECK_RADIUS_TILES) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates active spell emanation fields covering `occupantId` and automatically triggers
 * first-entry saving throw and Spell Resistance checks for any hostile/save-requiring units
 * not yet recorded in `field.auraSaveMemory`.
 *
 * @param state Current immutable GameState.
 * @param occupantId The creature entering or occupying the field.
 * @returns Updated GameState with save outcomes recorded in `auraSaveMemory`.
 */
export function evaluateActorAuraEntrySaves(state: GameState, occupantId: EntityId): GameState {
  const occPos = getComponent(state, occupantId, ComponentType.Position) as PositionComponent | undefined;
  if (!occPos) return state;

  const activeFields = queryActiveFieldsAtPosition(state, occPos.x, occPos.y);
  if (activeFields.length === 0) return state;

  const sysContent = getDnD35SystemContent(state.campaign);
  let runningState = state;

  for (const { field, entityId: fieldEntityId } of activeFields) {
    if (!field.spellId) continue;
    if (occupantId === field.anchorEntityId || occupantId === field.sourceEntityId) continue;
    const spell = sysContent?.spells?.[field.spellId];
    if (!spell) continue;

    const memoryKey = String(occupantId);
    if (field.auraSaveMemory?.[memoryKey] !== undefined) continue;

    for (const unit of spell.effectUnits) {
      if (unit.targetRole !== 'secondary_enemy' && unit.targetRole !== 'area_occupant') continue;
      if (!unit.savingThrow && !unit.allowsSpellResistance) continue;

      const dag = evaluateDnD35eEntityDAG(runningState, occupantId);
      if (!dag) continue;

      const saveType = unit.savingThrow?.saveType ?? 'will';
      const chassis = aggregateProgressionChassis(dag.dndData.tracks, 0);
      const abilityMod =
        saveType === 'fort'
          ? (dag.dagResult.effectiveAbilityModifiers.con ?? 0)
          : saveType === 'ref'
            ? (dag.dagResult.effectiveAbilityModifiers.dex ?? 0)
            : (dag.dagResult.effectiveAbilityModifiers.wis ?? 0);
      const baseSave =
        saveType === 'fort'
          ? chassis.baseSaves.fort
          : saveType === 'ref'
            ? chassis.baseSaves.ref
            : chassis.baseSaves.will;
      const saveMod = baseSave + abilityMod;
      const cl = field.casterLevel ?? DEFAULT_CASTER_LEVEL;
      const saveDc = BASE_SPELL_DC + spell.level + Math.floor(cl / 2);
      const sr = dag.dndData.spellResistance;

      const [nextState, outcome] = resolveAuraFirstEntrySaveAndSr(runningState, fieldEntityId, occupantId, {
        saveDc,
        occupantSaveModifier: saveMod,
        casterLevel: cl,
        ...(sr !== undefined && sr > 0 ? { occupantSpellResistance: sr } : {})
      });
      runningState = nextState;

      if (outcome === 'saved') {
        runningState = addMessage(
          runningState,
          `Entity #${occupantId} resists ${spell.name} emanation (Save Success)!`,
          MessageLogCategory.CombatHit
        );
      } else if (outcome === 'sr_blocked') {
        runningState = addMessage(
          runningState,
          `Entity #${occupantId}'s Spell Resistance repels ${spell.name} emanation!`,
          MessageLogCategory.CombatHit
        );
      } else {
        runningState = addMessage(
          runningState,
          `Entity #${occupantId} succumbs to ${spell.name} emanation (Save Failed)!`,
          MessageLogCategory.CombatHit
        );
      }
      break;
    }
  }

  return runningState;
}

/**
 * D&D 3.5e Ruleset Turn-Start hook:
 * 1. Hydrates a fresh per-entity 6-second `DnD35ActionBudget` (`hydrateEntityRoundActionBudget`).
 * 2. Evaluates active aura entry saves for the actor.
 *
 * @param state Current immutable GameState.
 * @param entityId The actor whose turn is starting.
 * @returns Updated GameState.
 */
export function onDnD35eActorTurnStart(state: GameState, entityId: EntityId): GameState {
  let nextState = syncDnD35eActorSpatialFootprint(state, entityId);
  nextState = evaluateActorLightExposure(nextState, entityId, 'turn_start');
  const dndData = getDnD35EntityData(nextState, entityId);
  const freshBudget = hydrateEntityRoundActionBudget(nextState, entityId);

  nextState = setDnD35EntityData(nextState, entityId, {
    ...dndData,
    actionBudget: freshBudget
  });

  for (const otherId of nextState.entities) {
    nextState = removeStatusEffectById(nextState, otherId, DISTRACTED_FLANKED_STATUS_ID, entityId);
  }
  nextState = syncSpatialFlankingGraph(nextState);

  return evaluateActorAuraEntrySaves(nextState, entityId);
}

/**
 * D&D 3.5e Ruleset Movement-Step hook:
 * 1. Triggers automatic aura entry saves for the moving actor at the destination tile.
 * 2. If the moving actor carries any anchored emanation fields, sweeps all occupants now
 *    within the relocated field's radius so newly engulfed creatures immediately roll their
 *    first-entry save / Spell Resistance check.
 *
 * @param state Current immutable GameState.
 * @param entityId The moving entity.
 * @param _fromPos Origin coordinates.
 * @param toPos Destination coordinates.
 * @returns Updated GameState.
 */
export function onDnD35eActorMovementStep(
  state: GameState,
  entityId: EntityId,
  _fromPos: { readonly x: number; readonly y: number },
  toPos: { readonly x: number; readonly y: number }
): GameState {
  let nextState = evaluateActorAuraEntrySaves(state, entityId);

  let maxAnchoredRadiusTiles = -1;
  for (const candId of nextState.entities) {
    const field = getComponent(nextState, candId, ComponentType.Field) as FieldComponent | undefined;
    if (!field || field.anchorEntityId !== entityId || !field.spellId) continue;
    const radiusTiles = field.radiusFt !== undefined ? Math.floor(field.radiusFt / FEET_PER_GRID_SQUARE) : 0;
    if (radiusTiles > maxAnchoredRadiusTiles) {
      maxAnchoredRadiusTiles = radiusTiles;
    }
  }

  if (maxAnchoredRadiusTiles >= 0) {
    for (const otherId of nextState.entities) {
      if (otherId === entityId) continue;
      const otherFighter = getComponent(nextState, otherId, ComponentType.Fighter) as FighterComponent | undefined;
      const otherPos = getComponent(nextState, otherId, ComponentType.Position) as PositionComponent | undefined;
      if (!otherFighter || otherFighter.hp <= 0 || !otherPos) continue;
      const dist = Math.max(Math.abs(otherPos.x - toPos.x), Math.abs(otherPos.y - toPos.y));
      if (dist <= maxAnchoredRadiusTiles) {
        nextState = evaluateActorAuraEntrySaves(nextState, otherId);
      }
    }
  }

  if (hasRelevantFlankingNeighborForStep(nextState, entityId, _fromPos, toPos)) {
    nextState = syncSpatialFlankingGraph(nextState);
  }
  nextState = evaluateActorLightExposure(nextState, entityId, 'move_or_field');
  nextState = evaluateAdjacentEnemyReactionsOnMove(nextState, entityId, toPos);

  return nextState;
}
