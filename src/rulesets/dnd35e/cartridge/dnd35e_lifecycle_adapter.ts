import { getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { queryActiveFieldsAtPosition } from '../../../systems/field.system.ts';
import {
  ComponentType,
  type FieldComponent,
  type FighterComponent,
  type PositionComponent
} from '../../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../../types/game-state.types.ts';
import { IntentType } from '../../../types/intents/intent.enum.ts';
import type { Intent } from '../../../types/intents/intent.union.ts';
import { coordToIndex } from '../../../utils/grid.ts';
import { getEffectiveStats } from '../../../utils/stats.ts';
import { consumeMovementStepFt, createRoundActionBudget } from '../action_economy.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { resolveAuraFirstEntrySaveAndSr } from '../magic/spell_aura_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { evaluateDnD35eEntityDAG } from './dnd35e_dag_adapter.ts';

/** Standard grid step distance in feet (`5`). */
const STANDARD_STEP_DISTANCE_FT = 5;

/** Standard full round energy cost (`100`). */
const FULL_ROUND_ENERGY_COST = 100;

/** Default caster level fallback when not specified on FieldComponent (`1`). */
const DEFAULT_CASTER_LEVEL = 1;

/** Standard base DC constant (`10`). */
const BASE_SPELL_DC = 10;

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

    // Check if any unit in the spell requires a save or SR for enemies
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
 * 1. Refreshes a fresh 6-second `DnD35ActionBudget` (`createRoundActionBudget`).
 * 2. Evaluates active aura entry saves for the actor.
 *
 * @param state Current immutable GameState.
 * @param entityId The actor whose turn is starting.
 * @returns Updated GameState.
 */
export function onDnD35eActorTurnStart(state: GameState, entityId: EntityId): GameState {
  const dndData = getDnD35EntityData(state, entityId);
  const dexMod = Math.floor(((dndData.abilityScores?.dex?.base ?? 10) - 10) / 2);
  const hasReflexes = dndData.feats?.includes('combat_reflexes') ?? false;

  const freshBudget = createRoundActionBudget({
    dexModifier: dexMod,
    hasCombatReflexes: hasReflexes,
    isFlatFooted: dndData.conditions?.includes('flat_footed') ?? false
  });

  let nextState = setDnD35EntityData(state, entityId, {
    ...dndData,
    actionBudget: freshBudget
  });

  nextState = evaluateActorAuraEntrySaves(nextState, entityId);
  return nextState;
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
    const radiusTiles = field.radiusFt !== undefined ? Math.floor(field.radiusFt / STANDARD_STEP_DISTANCE_FT) : 0;
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

  return nextState;
}

/**
 * Resolves D&D 3.5e 5-tier action budget consumption and energy cost for an intent in TurnBased mode.
 * Returns `energyCost: 0` while movement or actions remain in the round, or `100` when the round completes.
 *
 * @param state Current immutable GameState.
 * @param intent The intent being executed.
 * @param baseEnergyCost Baseline cost.
 * @returns Updated GameState and effective energy cost.
 */
export function resolveDnD35eActionEnergyCost(
  state: GameState,
  intent: Intent,
  baseEnergyCost: number
): { readonly state: GameState; readonly energyCost: number } {
  if (state.engineMode !== EngineMode.TurnBased || baseEnergyCost <= 0) {
    return { state, energyCost: baseEnergyCost };
  }

  const isPlayer = getComponent(state, intent.entityId, ComponentType.Player) !== undefined;
  if (!isPlayer) {
    const dndData = getDnD35EntityData(state, intent.entityId);
    if (dndData.actionBudget) {
      const nextState = setDnD35EntityData(state, intent.entityId, {
        ...dndData,
        actionBudget: undefined
      });
      return { state: nextState, energyCost: FULL_ROUND_ENERGY_COST };
    }
    return { state, energyCost: baseEnergyCost };
  }

  const dndData = getDnD35EntityData(state, intent.entityId);
  const stats = getEffectiveStats(state, intent.entityId);
  const actorSpeedFt = stats.speed > 0 ? stats.speed : 30;
  let currentBudget = dndData.actionBudget;

  if (!currentBudget) {
    const dexMod = Math.floor(((dndData.abilityScores?.dex?.base ?? 10) - 10) / 2);
    const hasReflexes = dndData.feats?.includes('combat_reflexes') ?? false;
    currentBudget = createRoundActionBudget({
      dexModifier: dexMod,
      hasCombatReflexes: hasReflexes,
      isFlatFooted: dndData.conditions?.includes('flat_footed') ?? false
    });
  }

  if (intent.type === IntentType.Move) {
    const posAfter = getComponent(state, intent.entityId, ComponentType.Position) as PositionComponent | undefined;
    let isDifficult = false;
    if (posAfter) {
      const tileIdx = coordToIndex(posAfter.x, posAfter.y, state.map.width);
      const tile = state.map.tiles[tileIdx];
      const mCost = tile ? (state.campaign.tiles[tile.tileId]?.movementCost ?? 100) : 100;
      isDifficult = mCost > 100;
    }

    const stepResult = consumeMovementStepFt(currentBudget, actorSpeedFt, STANDARD_STEP_DISTANCE_FT, isDifficult);
    if (stepResult.allowed) {
      const nextState = setDnD35EntityData(state, intent.entityId, {
        ...dndData,
        actionBudget: stepResult.budget
      });
      const hasMoreBudget =
        stepResult.budget.movementRemainingFt > 0 ||
        stepResult.budget.moveRemaining > 0 ||
        stepResult.budget.standardRemaining > 0;
      return { state: nextState, energyCost: hasMoreBudget ? 0 : FULL_ROUND_ENERGY_COST };
    } else {
      const nextState = setDnD35EntityData(state, intent.entityId, {
        ...dndData,
        actionBudget: undefined
      });
      return { state: nextState, energyCost: FULL_ROUND_ENERGY_COST };
    }
  }

  if (intent.type === IntentType.Wait) {
    const nextState = setDnD35EntityData(state, intent.entityId, {
      ...dndData,
      actionBudget: undefined
    });
    return { state: nextState, energyCost: FULL_ROUND_ENERGY_COST };
  }

  // Standard action (attack, spell, skill)
  const updatedDndData = getDnD35EntityData(state, intent.entityId);
  const postActionBudget = updatedDndData.actionBudget ?? currentBudget;
  const canKeepMoving = postActionBudget.movementRemainingFt > 0;

  if (!canKeepMoving) {
    const nextState = setDnD35EntityData(state, intent.entityId, {
      ...updatedDndData,
      actionBudget: undefined
    });
    return { state: nextState, energyCost: FULL_ROUND_ENERGY_COST };
  }

  return { state, energyCost: 0 };
}
