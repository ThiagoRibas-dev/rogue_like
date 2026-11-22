import { addComponent, getComponent, removeComponent, resolveEntityDisplayName } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import {
  ComponentType,
  type BreathComponent,
  type DamageComponent,
  type FighterComponent,
  type TagsComponent,
  type TraitsComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/** Default fallback breath capacity in rounds when ruleset does not override (`20` rounds = CON 10). */
export const DEFAULT_MAX_BREATH_TURNS = 20;

/** Suffocation / drowning lethal damage dealt once `remainingTurns` drops to `0` (`999` true drowning damage). */
export const DROWNING_SUFFOCATION_DAMAGE = 999;

/**
 * Checks whether `entityId` is exempt from underwater breath depletion / drowning
 * (`trait:water_breathing`, `type:undead`, `type:construct`, or ruleset `isActorImmuneToDrowning`).
 *
 * @param state Current immutable GameState.
 * @param entityId Target actor EntityId.
 * @returns `true` if the actor does not need to breathe underwater.
 */
export function isEntityImmuneToDrowning(state: Readonly<GameState>, entityId: EntityId): boolean {
  const tagsComp = getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined;
  const tags = tagsComp?.tags ?? [];
  if (
    tags.includes('trait:water_breathing') ||
    tags.includes('water_breathing') ||
    tags.includes('type:undead') ||
    tags.includes('undead') ||
    tags.includes('type:construct') ||
    tags.includes('construct')
  ) {
    return true;
  }

  const traitsComp = getComponent(state, entityId, ComponentType.Traits) as TraitsComponent | undefined;
  const traits = traitsComp?.traits ?? [];
  if (
    traits.includes('trait:water_breathing') ||
    traits.includes('water_breathing') ||
    traits.includes('undead') ||
    traits.includes('construct')
  ) {
    return true;
  }

  const ruleset = getActiveRuleset(state);
  if (ruleset.isActorImmuneToDrowning && ruleset.isActorImmuneToDrowning(state, entityId)) {
    return true;
  }

  return false;
}

/**
 * Resolves the maximum breath-holding capacity in rounds for `entityId` (defaulting to `2 * CON` in D&D 3.5e).
 *
 * @param state Current immutable GameState.
 * @param entityId Target actor EntityId.
 * @returns Maximum breath rounds (`>= 1`).
 */
export function resolveEntityMaxBreathTurns(state: Readonly<GameState>, entityId: EntityId): number {
  const ruleset = getActiveRuleset(state);
  if (ruleset.getActorMaxBreathTurns) {
    return Math.max(1, ruleset.getActorMaxBreathTurns(state, entityId));
  }
  return DEFAULT_MAX_BREATH_TURNS;
}

/**
 * Sets or clears submersion state on `entityId`. When submerged, attaches `BreathComponent`
 * initialized to `2 * CON` rounds (unless already submerged or immune to drowning). When surfacing,
 * removes `BreathComponent` and restores full breath.
 *
 * @param state Current immutable GameState.
 * @param entityId Target actor EntityId.
 * @param isSubmerged Whether the actor is now submerged underwater.
 * @returns Updated GameState.
 */
export function setActorSubmersionState(state: GameState, entityId: EntityId, isSubmerged: boolean): GameState {
  if (!isSubmerged) {
    if (getComponent(state, entityId, ComponentType.Breath) !== undefined) {
      const actorName = resolveEntityDisplayName(state, entityId, 'The swimmer');
      const cleared = removeComponent(state, entityId, ComponentType.Breath);
      return addMessage(cleared, `${actorName} surfaces and catches their breath.`, MessageLogCategory.System);
    }
    return state;
  }

  if (isEntityImmuneToDrowning(state, entityId)) {
    return removeComponent(state, entityId, ComponentType.Breath);
  }

  const existing = getComponent(state, entityId, ComponentType.Breath) as BreathComponent | undefined;
  const maxTurns = resolveEntityMaxBreathTurns(state, entityId);
  if (existing && existing.isSubmerged) {
    return state;
  }

  const breath: BreathComponent = {
    type: ComponentType.Breath,
    remainingTurns: existing ? Math.min(existing.remainingTurns, maxTurns) : maxTurns,
    maxTurns,
    isSubmerged: true
  };
  return addComponent(state, entityId, breath);
}

function tickActorBreathSingleTurn(state: GameState, entityId: EntityId): GameState {
  const breath = getComponent(state, entityId, ComponentType.Breath) as BreathComponent | undefined;
  if (!breath) return state;

  if (!breath.isSubmerged || isEntityImmuneToDrowning(state, entityId)) {
    return removeComponent(state, entityId, ComponentType.Breath);
  }

  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter || fighter.hp <= 0) {
    return state;
  }

  const nextRemaining = Math.max(0, breath.remainingTurns - 1);
  const actorName = resolveEntityDisplayName(state, entityId, 'The swimmer');
  let nextState = addComponent(state, entityId, {
    ...breath,
    remainingTurns: nextRemaining
  });

  if (nextRemaining === 0) {
    const existingDmg = getComponent(nextState, entityId, ComponentType.Damage) as DamageComponent | undefined;
    const instances = existingDmg ? [...existingDmg.instances] : [];
    instances.push({
      amount: DROWNING_SUFFOCATION_DAMAGE,
      tags: ['drowning', 'suffocation', 'environmental']
    });
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Damage,
      instances
    });
    nextState = addMessage(nextState, `${actorName} runs out of breath and drowns!`, MessageLogCategory.CombatHit);
  } else if (nextRemaining <= 3) {
    nextState = addMessage(
      nextState,
      `${actorName} is running out of air (${nextRemaining} round(s) of breath remaining)!`,
      MessageLogCategory.System
    );
  }

  return nextState;
}

/**
 * Advances an actor's `BreathComponent` across `turnsElapsed` turns.
 * Shared between normal Turn Start and bulk time advancement.
 *
 * @param state Current immutable GameState.
 * @param entityId The actor whose breath is advancing.
 * @param turnsElapsed Number of elapsed turns.
 * @returns Updated GameState.
 */
export function advanceActorBreathByTurns(state: GameState, entityId: EntityId, turnsElapsed: number): GameState {
  if (turnsElapsed <= 0) return state;
  let nextState = state;
  for (let step = 0; step < turnsElapsed; step++) {
    const breath = getComponent(nextState, entityId, ComponentType.Breath) as BreathComponent | undefined;
    if (!breath) break;
    const prevRemaining = breath.remainingTurns;
    nextState = tickActorBreathSingleTurn(nextState, entityId);
    if (prevRemaining === 0 || (getComponent(nextState, entityId, ComponentType.Breath)?.remainingTurns ?? 0) === 0) {
      break;
    }
  }
  return nextState;
}

/**
 * Ticks an actor's `BreathComponent` at Turn Start (`runActorTurnStart`).
 * Decrements `remainingTurns` while `isSubmerged === true` (unless immune to drowning);
 * when `remainingTurns` reaches `0`, queues lethal drowning damage (`DROWNING_SUFFOCATION_DAMAGE`).
 *
 * @param state Current immutable GameState.
 * @param entityId The actor whose turn is starting.
 * @returns Updated GameState.
 */
export function processActorBreathTick(state: GameState, entityId: EntityId): GameState {
  return advanceActorBreathByTurns(state, entityId, 1);
}
