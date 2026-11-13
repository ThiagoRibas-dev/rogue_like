import { addComponent, getComponent } from '../core/ecs.ts';
import { ComponentType, type CompanionStance, type ControllerLinkComponent } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { isHostile } from '../utils/faction.ts';
import { coordToIndex } from '../utils/grid.ts';

/** Default tile distance within which a following companion stops approaching its controller. */
export const DEFAULT_COMPANION_FOLLOW_DISTANCE = 2;

/** Default maximum tile distance a companion may stray from its controller before leashing back. */
export const DEFAULT_COMPANION_LEASH_RADIUS = 8;

/** Default radius around the controller within which a Defensive companion engages enemies. */
export const DEFAULT_COMPANION_DEFEND_RADIUS = 3;

/** Default self-defense radius within which a Defensive companion engages enemies directly threatening it. */
export const DEFAULT_COMPANION_SELF_DEFEND_RADIUS = 2;

/** Default aggro radius for hunt behavior when none is configured. */
export const DEFAULT_AI_AGGRO_RADIUS = 5;

/** Default range for ranged spell attacks when no explicit range is provided. */
export const DEFAULT_RANGED_SPELL_RANGE = 6;

/**
 * Resolved hostile target metadata returned by AI target selection.
 */
export interface ResolvedAITarget {
  readonly targetId: EntityId;
  readonly distance: number;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Clears stale or invalid focus-target directives (`commandTargetId`) from a companion's
 * `ControllerLinkComponent` when the target no longer exists, has fallen (`hp <= 0`), or is no longer hostile.
 * @param state The current GameState.
 * @param entityId The AI entity taking its turn.
 * @returns Updated GameState with any invalid `commandTargetId` removed.
 */
export function sanitizeCompanionControllerLink(state: GameState, entityId: EntityId): GameState {
  const link = getComponent(state, entityId, ComponentType.ControllerLink);
  if (!link || link.commandTargetId === undefined) {
    return state;
  }

  const targetId = link.commandTargetId;
  const targetExists = state.entities.includes(targetId);
  const targetPos = targetExists ? getComponent(state, targetId, ComponentType.Position) : undefined;
  const targetFighter = targetExists ? getComponent(state, targetId, ComponentType.Fighter) : undefined;
  const targetAlive = targetFighter !== undefined && targetFighter.hp > 0;
  const stillHostile = targetExists && isHostile(state, entityId, targetId);

  if (targetExists && targetPos !== undefined && targetAlive && stillHostile) {
    return state;
  }

  const nextLink: ControllerLinkComponent = {
    type: ComponentType.ControllerLink,
    controllerEntityId: link.controllerEntityId,
    tags: link.tags,
    ...(link.shareInitiative !== undefined ? { shareInitiative: link.shareInitiative } : {}),
    ...(link.expirationTurn !== undefined ? { expirationTurn: link.expirationTurn } : {}),
    ...(link.stance !== undefined ? { stance: link.stance } : {}),
    ...(link.followDistance !== undefined ? { followDistance: link.followDistance } : {}),
    ...(link.leashRadius !== undefined ? { leashRadius: link.leashRadius } : {})
  };

  return addComponent(state, entityId, nextLink);
}

/**
 * Checks whether a candidate target is eligible given optional FOV and melee hold constraints.
 */
function isCandidateTargetInRange(
  state: GameState,
  attackerId: EntityId,
  attackerX: number,
  attackerY: number,
  targetId: EntityId,
  maxRange: number,
  fov?: ReadonlySet<number>,
  holdMeleeOnly?: boolean,
  stance?: CompanionStance
): ResolvedAITarget | null {
  if (targetId === attackerId) return null;

  const otherPos = getComponent(state, targetId, ComponentType.Position);
  const otherFighter = getComponent(state, targetId, ComponentType.Fighter);
  if (!otherPos || !otherFighter || otherFighter.hp <= 0) return null;
  if (!isHostile(state, attackerId, targetId)) return null;

  if (fov !== undefined) {
    const targetIndex = coordToIndex(otherPos.x, otherPos.y, state.map.width);
    if (!fov.has(targetIndex)) return null;
  }

  const dx = otherPos.x - attackerX;
  const dy = otherPos.y - attackerY;
  const distance = Math.max(Math.abs(dx), Math.abs(dy));

  if (distance > maxRange) return null;
  if (stance === 'hold' && holdMeleeOnly && distance !== 1) return null;

  return { targetId, distance, dx, dy };
}

/**
 * Resolves the highest-priority valid combat target for an AI entity.
 * When the entity carries a `ControllerLinkComponent`, enforces companion stances
 * (`passive`, `defensive`, `aggressive`, `hold`), focus-target overrides (`commandTargetId`),
 * and controller leash distance. For unlinked entities, selects the nearest hostile within `maxRange`.
 * @param state The current GameState.
 * @param entityId The AI entity searching for a target.
 * @param maxRange Maximum Chebyshev engagement range.
 * @param fov Optional computed field-of-view tile indices required for line-of-sight behaviors.
 * @param holdMeleeOnly When true (melee hunt), a `'hold'` stance entity only attacks adjacent (`distance === 1`) enemies.
 * @returns The selected target and delta vector, or `null` if no valid target should be engaged.
 */
export function resolveAITarget(
  state: GameState,
  entityId: EntityId,
  maxRange: number,
  fov?: ReadonlySet<number>,
  holdMeleeOnly = false
): ResolvedAITarget | null {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return null;

  const link = getComponent(state, entityId, ComponentType.ControllerLink);
  const stance: CompanionStance | undefined = link ? (link.stance ?? 'defensive') : undefined;

  if (stance === 'passive') {
    return null;
  }

  const leashRadius = link?.leashRadius ?? DEFAULT_COMPANION_LEASH_RADIUS;
  const controllerPos = link ? getComponent(state, link.controllerEntityId, ComponentType.Position) : undefined;
  const distToController = controllerPos
    ? Math.max(Math.abs(pos.x - controllerPos.x), Math.abs(pos.y - controllerPos.y))
    : 0;

  if (link && stance !== 'hold' && controllerPos !== undefined && distToController > leashRadius) {
    return null;
  }

  if (link?.commandTargetId !== undefined) {
    const commanded = isCandidateTargetInRange(
      state,
      entityId,
      pos.x,
      pos.y,
      link.commandTargetId,
      maxRange,
      fov,
      holdMeleeOnly,
      stance
    );
    if (commanded !== null) {
      return commanded;
    }
  }

  let bestTarget: ResolvedAITarget | null = null;
  let minDistance = Infinity;

  for (const candidateId of state.entities) {
    const candidate = isCandidateTargetInRange(
      state,
      entityId,
      pos.x,
      pos.y,
      candidateId,
      maxRange,
      fov,
      holdMeleeOnly,
      stance
    );
    if (candidate === null) continue;

    if (link && controllerPos !== undefined && stance === 'defensive') {
      const targetPos = getComponent(state, candidateId, ComponentType.Position);
      if (!targetPos) continue;
      const distFromController = Math.max(
        Math.abs(targetPos.x - controllerPos.x),
        Math.abs(targetPos.y - controllerPos.y)
      );
      if (
        distFromController > DEFAULT_COMPANION_DEFEND_RADIUS &&
        candidate.distance > DEFAULT_COMPANION_SELF_DEFEND_RADIUS
      ) {
        continue;
      }
    }

    if (link && controllerPos !== undefined && stance === 'aggressive') {
      const targetPos = getComponent(state, candidateId, ComponentType.Position);
      if (!targetPos) continue;
      const distFromController = Math.max(
        Math.abs(targetPos.x - controllerPos.x),
        Math.abs(targetPos.y - controllerPos.y)
      );
      if (distFromController > leashRadius) {
        continue;
      }
    }

    if (candidate.distance < minDistance) {
      minDistance = candidate.distance;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}
