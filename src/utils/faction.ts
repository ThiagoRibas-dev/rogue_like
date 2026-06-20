import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { ComponentType, type FactionComponent, type AttitudeComponent } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';

/**
 * Gets the faction relation between two entities.
 * Defaults to Neutral if either entity lacks a FactionComponent.
 * @param state The current GameState.
 * @param subject The EntityId checking relation.
 * @param target The EntityId being checked against.
 * @returns The FactionRelation enum value.
 */
export function getFactionRelation(
  state: GameState,
  subject: EntityId,
  target: EntityId
): 'hostile' | 'neutral' | 'friendly' {
  const isSubjectPlayer = getComponent(state, subject, ComponentType.Player) !== undefined;
  const isTargetPlayer = getComponent(state, target, ComponentType.Player) !== undefined;

  if (isSubjectPlayer && !isTargetPlayer) {
    const attitudeCmp = getComponent(state, target, ComponentType.Attitude) as AttitudeComponent | undefined;
    if (attitudeCmp) return attitudeCmp.attitude;
  } else if (isTargetPlayer && !isSubjectPlayer) {
    const attitudeCmp = getComponent(state, subject, ComponentType.Attitude) as AttitudeComponent | undefined;
    if (attitudeCmp) return attitudeCmp.attitude;
  }

  const subjectFactionCmp = getComponent(state, subject, ComponentType.Faction) as FactionComponent | undefined;
  const targetFactionCmp = getComponent(state, target, ComponentType.Faction) as FactionComponent | undefined;

  const subjectFaction = subjectFactionCmp?.factionId ?? 'neutral';
  const targetFaction = targetFactionCmp?.factionId ?? 'neutral';

  const relations = state.campaign.factions[subjectFaction];
  if (!relations) {
    return 'neutral';
  }

  const relation = relations[targetFaction];
  if (!relation) {
    return 'neutral';
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
  return getFactionRelation(state, subject, target) === 'hostile';
}
