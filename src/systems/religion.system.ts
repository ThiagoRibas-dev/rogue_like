import { addComponent, getComponent, resolveEntityDisplayName } from '../core/ecs.ts';
import {
  ComponentType,
  type ReligionComponent,
  type TagsComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/** Default penance debt added when an actor violates one of their deity/patron's taboos (`10`). */
export const DEFAULT_TABOO_PENANCE_DEBT = 10;

/** Favor penalty applied when an actor violates a taboo (`-15`). */
export const DEFAULT_TABOO_FAVOR_PENALTY = -15;

/** Default favor bonus granted when praying at a sacred altar or shrine (`5`). */
export const DEFAULT_ALTAR_PRAYER_FAVOR_BONUS = 5;

/** Prefix on entity/template tags identifying an altar or shrine's patron deity (`deity:<id>`). */
const DEITY_TAG_PREFIX = 'deity:';

/**
 * Adjusts an actor's `ReligionComponent.favorScore` with their patron deity (`deityOrPatronId`),
 * initializing the component only when an explicit `deityOrPatronId` or existing `ReligionComponent` is present.
 *
 * @param state Current immutable GameState.
 * @param actorId Worshipping actor EntityId.
 * @param delta Signed favor adjustment (`+` for offerings/vows, `-` for transgressions).
 * @param deityOrPatronId Optional deity ID if initializing a new `ReligionComponent`.
 * @returns Updated GameState and new `favorScore`.
 */
export function recordDeityFavorDelta(
  state: GameState,
  actorId: EntityId,
  delta: number,
  deityOrPatronId?: string
): { readonly state: GameState; readonly favorScore: number } {
  const existing = getComponent(state, actorId, ComponentType.Religion) as ReligionComponent | undefined;
  const resolvedDeityId = existing?.deityOrPatronId ?? deityOrPatronId;
  if (!resolvedDeityId) {
    return { state, favorScore: 0 };
  }
  const nextFavor = (existing?.favorScore ?? 0) + Math.trunc(delta);
  const updated: ReligionComponent = {
    type: ComponentType.Religion,
    deityOrPatronId: resolvedDeityId,
    favorScore: nextFavor,
    penanceDebt: existing?.penanceDebt ?? 0,
    taboosViolated: existing?.taboosViolated ?? []
  };

  const nextState = addComponent(state, actorId, updated);
  return { state: nextState, favorScore: nextFavor };
}

/**
 * Records a taboo violation against the actor's deity/patron, incrementing `penanceDebt`,
 * reducing `favorScore`, and appending `tabooId` to `taboosViolated`.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor EntityId.
 * @param tabooId Identifier of the violated taboo (e.g. `'desecrate_altar'`, `'cast_evil_descriptor'`).
 * @param penanceAdded Penance debt added (defaults to `DEFAULT_TABOO_PENANCE_DEBT`).
 * @param deityOrPatronId Optional explicit deity ID if the actor does not yet have a `ReligionComponent`.
 * @returns Updated GameState.
 */
export function recordTabooViolation(
  state: GameState,
  actorId: EntityId,
  tabooId: string,
  penanceAdded = DEFAULT_TABOO_PENANCE_DEBT,
  deityOrPatronId?: string
): GameState {
  const existing = getComponent(state, actorId, ComponentType.Religion) as ReligionComponent | undefined;
  const deityId = existing?.deityOrPatronId ?? deityOrPatronId;
  if (!deityId) {
    return state;
  }
  const nextFavor = (existing?.favorScore ?? 0) + DEFAULT_TABOO_FAVOR_PENALTY;
  const nextPenance = (existing?.penanceDebt ?? 0) + Math.max(1, Math.trunc(penanceAdded));
  const nextTaboos = Array.from(new Set([...(existing?.taboosViolated ?? []), tabooId]));

  let nextState = addComponent(state, actorId, {
    type: ComponentType.Religion,
    deityOrPatronId: deityId,
    favorScore: nextFavor,
    penanceDebt: nextPenance,
    taboosViolated: nextTaboos
  });

  const actorName = resolveEntityDisplayName(nextState, actorId, 'The devotee');
  nextState = addMessage(
    nextState,
    `${actorName} violates a sacred taboo of ${deityId} (${tabooId})! Penance debt is now ${nextPenance}.`,
    MessageLogCategory.System
  );
  return nextState;
}

/**
 * Clears or reduces an actor's `penanceDebt` and `taboosViolated` when praying/offering at a sacred altar or shrine.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor praying or making an offering at an altar.
 * @param atonementAmount Amount of penance debt cleared (defaults to full clearance).
 * @param favorGranted Bonus favor granted upon atonement (defaults to `5`).
 * @returns `{ state, success, remainingPenanceDebt }`.
 */
export function atonePenanceAtAltar(
  state: GameState,
  actorId: EntityId,
  atonementAmount?: number,
  favorGranted = DEFAULT_ALTAR_PRAYER_FAVOR_BONUS
): {
  readonly state: GameState;
  readonly success: boolean;
  readonly remainingPenanceDebt: number;
} {
  const existing = getComponent(state, actorId, ComponentType.Religion) as ReligionComponent | undefined;
  if (!existing) {
    return { state, success: false, remainingPenanceDebt: 0 };
  }

  const cleared = atonementAmount !== undefined ? Math.max(0, Math.trunc(atonementAmount)) : existing.penanceDebt;
  const remainingPenanceDebt = Math.max(0, existing.penanceDebt - cleared);
  const nextFavor = existing.favorScore + Math.trunc(favorGranted);

  let nextState = addComponent(state, actorId, {
    ...existing,
    favorScore: nextFavor,
    penanceDebt: remainingPenanceDebt,
    taboosViolated: remainingPenanceDebt === 0 ? [] : existing.taboosViolated
  });

  const actorName = resolveEntityDisplayName(nextState, actorId, 'The devotee');
  nextState = addMessage(
    nextState,
    `${actorName} atones at the altar of ${existing.deityOrPatronId} (Favor: ${nextFavor}, Penance Debt: ${remainingPenanceDebt}).`,
    MessageLogCategory.System
  );

  return {
    state: nextState,
    success: true,
    remainingPenanceDebt
  };
}

function collectAltarTags(state: Readonly<GameState>, entityId: EntityId): ReadonlyArray<string> {
  const tagsComp = getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined;
  const templateComp = getComponent(state, entityId, ComponentType.Template) as TemplateComponent | undefined;
  const templateTags = templateComp ? (state.campaign.entities[templateComp.templateId]?.tags ?? []) : [];
  return [...(tagsComp?.tags ?? []), ...templateTags];
}

/**
 * Returns `true` when `entityId` carries an `'altar'` or `'shrine'` tag.
 */
export function isAltarOrShrineEntity(state: Readonly<GameState>, entityId: EntityId): boolean {
  const tags = collectAltarTags(state, entityId);
  return tags.includes('altar') || tags.includes('shrine');
}

/**
 * Resolves the patron deity ID (`deity:<id>`) declared on an altar or shrine entity.
 */
export function resolveAltarDeityId(state: Readonly<GameState>, altarEntityId: EntityId): string | undefined {
  const tags = collectAltarTags(state, altarEntityId);
  const deityTag = tags.find((tag) => tag.startsWith(DEITY_TAG_PREFIX));
  if (!deityTag) return undefined;
  const id = deityTag.slice(DEITY_TAG_PREFIX.length).trim();
  return id.length > 0 ? id : undefined;
}

/**
 * Executes the `'pray'` interaction verb at an altar or shrine entity, atoning existing penance debt
 * or granting divine favor with the altar's patron deity (or the devotee's existing deity).
 */
export function prayAtAltarOrShrine(
  state: GameState,
  actorId: EntityId,
  altarEntityId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  if (!isAltarOrShrineEntity(state, altarEntityId)) {
    return {
      state: addMessage(state, 'There is no sacred altar or shrine there.', MessageLogCategory.System),
      success: false
    };
  }

  const existing = getComponent(state, actorId, ComponentType.Religion) as ReligionComponent | undefined;
  const altarDeityId = resolveAltarDeityId(state, altarEntityId);
  const deityId = existing?.deityOrPatronId ?? altarDeityId;
  if (!deityId) {
    return {
      state: addMessage(state, 'This shrine bears no recognizable divine patron.', MessageLogCategory.System),
      success: false
    };
  }

  let nextState = state;
  if (!existing) {
    nextState = addComponent(nextState, actorId, {
      type: ComponentType.Religion,
      deityOrPatronId: deityId,
      favorScore: 0,
      penanceDebt: 0,
      taboosViolated: []
    });
  }

  const currentRel = getComponent(nextState, actorId, ComponentType.Religion) as ReligionComponent | undefined;
  if (currentRel && currentRel.penanceDebt > 0) {
    const atoneRes = atonePenanceAtAltar(nextState, actorId);
    return { state: atoneRes.state, success: atoneRes.success };
  }

  const favorRes = recordDeityFavorDelta(nextState, actorId, DEFAULT_ALTAR_PRAYER_FAVOR_BONUS, deityId);
  nextState = favorRes.state;
  const actorName = resolveEntityDisplayName(nextState, actorId, 'The devotee');
  nextState = addMessage(
    nextState,
    `${actorName} prays at the sacred shrine of ${deityId} (Favor: ${favorRes.favorScore}).`,
    MessageLogCategory.System
  );
  return { state: nextState, success: true };
}
