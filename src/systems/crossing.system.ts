import { addComponent, createEntity, getComponent, removeEntity, resolveEntityDisplayName } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import {
  ComponentType,
  type CrossingComponent,
  type CrossingKind,
  type FighterComponent,
  type PositionComponent,
  type RenderableComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { getEntityMovementModes } from './movement_displacement.ts';

/** Visual descriptors for each world-owned `CrossingKind`. */
const CROSSING_RENDER_PALETTE: Readonly<
  Record<CrossingKind, { readonly glyph: string; readonly fg: string; readonly bg: string }>
> = {
  bridge: { glyph: '=', fg: '#d35400', bg: '#3e2723' },
  rope_line: { glyph: '-', fg: '#f39c12', bg: 'transparent' },
  ladder_span: { glyph: 'H', fg: '#e67e22', bg: 'transparent' },
  frozen_surface: { glyph: '~', fg: '#a8e6cf', bg: '#1b4f72' }
};

/** Parameters for spawning a world-owned `CrossingComponent` entity at `(x, y)`. */
export interface SpawnCrossingParams {
  readonly state: GameState;
  readonly x: number;
  readonly y: number;
  readonly crossingKind: CrossingKind;
  readonly requiredSkill?: string | undefined;
  readonly skillDc?: number | undefined;
  readonly maxWeightLbs?: number | undefined;
  readonly anchorTileCoords?: ReadonlyArray<{ readonly x: number; readonly y: number }> | undefined;
  readonly durationTurns?: number | undefined;
}

/**
 * Queries `state.spatialIndex` at `(x, y)` for any live world-owned `CrossingComponent` entity.
 *
 * @param state Current immutable GameState.
 * @param x Grid X coordinate.
 * @param y Grid Y coordinate.
 * @returns The first matching `{ entityId, crossing }`, or `undefined` if no crossing spans `(x, y)`.
 */
export function queryCrossingAtPosition(
  state: Readonly<GameState>,
  x: number,
  y: number
): { readonly entityId: EntityId; readonly crossing: CrossingComponent } | undefined {
  const candidates = state.spatialIndex.get(`${x},${y}`);
  if (!candidates || candidates.length === 0) return undefined;

  for (const entityId of candidates) {
    const crossing = getComponent(state, entityId, ComponentType.Crossing) as CrossingComponent | undefined;
    if (crossing) {
      return { entityId, crossing };
    }
  }
  return undefined;
}

/**
 * Spawns a world-owned `CrossingComponent` entity at `(x, y)` (replacing an existing crossing of the same kind if present),
 * making underlying `deep_water`, `pit`, or `chasm` tiles traversable symmetrically for players, companions, and AI.
 *
 * @param params Structured `SpawnCrossingParams`.
 * @returns Tuple `[updatedState, crossingEntityId]`.
 */
export function spawnCrossingEntity(params: SpawnCrossingParams): [GameState, EntityId] {
  const existing = queryCrossingAtPosition(params.state, params.x, params.y);
  if (existing && existing.crossing.crossingKind === params.crossingKind) {
    const updatedCrossing: CrossingComponent = {
      ...existing.crossing,
      ...(params.durationTurns !== undefined ? { durationTurns: params.durationTurns } : {})
    };
    return [addComponent(params.state, existing.entityId, updatedCrossing), existing.entityId];
  }

  const [initialState, entityId] = createEntity(params.state);
  let nextState = initialState;
  const pos: PositionComponent = {
    type: ComponentType.Position,
    x: params.x,
    y: params.y
  };
  const palette = CROSSING_RENDER_PALETTE[params.crossingKind];
  const render: RenderableComponent = {
    type: ComponentType.Renderable,
    glyph: palette.glyph,
    fg: palette.fg,
    bg: palette.bg
  };
  const crossing: CrossingComponent = {
    type: ComponentType.Crossing,
    crossingKind: params.crossingKind,
    ...(params.requiredSkill !== undefined ? { requiredSkill: params.requiredSkill } : {}),
    ...(params.skillDc !== undefined ? { skillDc: params.skillDc } : {}),
    ...(params.maxWeightLbs !== undefined ? { maxWeightLbs: params.maxWeightLbs } : {}),
    ...(params.anchorTileCoords !== undefined ? { anchorTileCoords: params.anchorTileCoords } : {}),
    ...(params.durationTurns !== undefined ? { durationTurns: params.durationTurns } : {})
  };

  nextState = addComponent(nextState, entityId, pos);
  nextState = addComponent(nextState, entityId, render);
  nextState = addComponent(nextState, entityId, crossing);
  nextState = addComponent(nextState, entityId, {
    type: ComponentType.Tags,
    tags: ['crossing', `crossing:${params.crossingKind}`]
  });

  return [nextState, entityId];
}

/**
 * Destroys, cuts, or melts a world-owned `CrossingComponent` entity and immediately drops any non-flying
 * actors currently standing on its square into the underlying hazard tile via `RulesetContract.onCrossingCollapsedForOccupant`.
 *
 * @param state Current immutable GameState.
 * @param crossingEntityId EntityId of the crossing being destroyed.
 * @param reasonMessage Optional message logged to the combat/system log.
 * @returns Updated GameState after removing the crossing and resolving occupant hazard drops.
 */
export function destroyCrossingEntity(state: GameState, crossingEntityId: EntityId, reasonMessage?: string): GameState {
  const crossing = getComponent(state, crossingEntityId, ComponentType.Crossing) as CrossingComponent | undefined;
  const pos = getComponent(state, crossingEntityId, ComponentType.Position) as PositionComponent | undefined;
  if (!crossing || !pos) {
    return removeEntity(state, crossingEntityId);
  }

  let nextState = removeEntity(state, crossingEntityId);
  if (reasonMessage) {
    nextState = addMessage(nextState, reasonMessage, MessageLogCategory.System);
  }

  const occupants = [...(nextState.spatialIndex.get(`${pos.x},${pos.y}`) ?? [])];
  const activeRuleset = getActiveRuleset(nextState);

  for (const occupantId of occupants) {
    if (occupantId === crossingEntityId) continue;
    const fighter = getComponent(nextState, occupantId, ComponentType.Fighter) as FighterComponent | undefined;
    if (!fighter || fighter.hp <= 0) continue;

    const modes = getEntityMovementModes(nextState, occupantId);
    if (modes?.fly !== undefined && modes.fly > 0) {
      continue;
    }

    const occName = resolveEntityDisplayName(nextState, occupantId, 'An actor');
    nextState = addMessage(
      nextState,
      `The ${crossing.crossingKind.replace(/_/g, ' ')} gives way beneath ${occName}!`,
      MessageLogCategory.CombatHit
    );
    if (activeRuleset.onCrossingCollapsedForOccupant) {
      nextState = activeRuleset.onCrossingCollapsedForOccupant(nextState, occupantId, pos.x, pos.y);
    }
  }

  return nextState;
}

/**
 * Ticks temporary crossings (such as `frozen_surface` ice sheets with `durationTurns`),
 * melting expired crossings and dropping any non-flying occupants into the underlying hazard.
 *
 * @param state Current immutable GameState.
 * @returns Updated GameState.
 */
export function processCrossingsTick(state: GameState): GameState {
  let nextState = state;
  for (const entityId of [...nextState.entities]) {
    const crossing = getComponent(nextState, entityId, ComponentType.Crossing) as CrossingComponent | undefined;
    if (!crossing || crossing.durationTurns === undefined) continue;
    const remaining = crossing.durationTurns - 1;
    if (remaining <= 0) {
      nextState = destroyCrossingEntity(nextState, entityId, 'The frozen ice sheet thaws and gives way!');
    } else {
      nextState = addComponent(nextState, entityId, { ...crossing, durationTurns: remaining });
    }
  }
  return nextState;
}
