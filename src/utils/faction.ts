import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { ComponentType, type FactionComponent } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { HOSTILITY_MATRIX, FactionRelation, FactionId } from '../constants/faction.constants.ts';

/**
 * Gets the faction relation between two entities.
 * Defaults to Neutral if either entity lacks a FactionComponent.
 * @param state The current GameState.
 * @param subject The EntityId checking relation.
 * @param target The EntityId being checked against.
 * @returns The FactionRelation enum value.
 */
export function getFactionRelation(state: GameState, subject: EntityId, target: EntityId): FactionRelation {
  const subjectFactionCmp = getComponent(state, subject, ComponentType.Faction) as FactionComponent | undefined;
  const targetFactionCmp = getComponent(state, target, ComponentType.Faction) as FactionComponent | undefined;

  const subjectFaction = subjectFactionCmp?.factionId ?? FactionId.Neutral;
  const targetFaction = targetFactionCmp?.factionId ?? FactionId.Neutral;

  const relations = HOSTILITY_MATRIX[subjectFaction];
  if (!relations) {
    return FactionRelation.Neutral;
  }

  const relation = relations[targetFaction];
  if (!relation) {
    return FactionRelation.Neutral;
  }

  return relation;
}

/**
 * Checks if the subject is hostile towards the target.
 * @param state The current GameState.
 * @param subject The EntityId checking relation.
 * @param target The EntityId being checked against.
 * @returns True if the subject is hostile to the target.
 */
export function isHostile(state: GameState, subject: EntityId, target: EntityId): boolean {
  return getFactionRelation(state, subject, target) === FactionRelation.Hostile;
}
