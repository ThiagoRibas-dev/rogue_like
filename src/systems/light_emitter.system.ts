import { addComponent, getComponent, removeEntity, resolveEntityDisplayName } from '../core/ecs.ts';
import {
  ComponentType,
  type CardinalFacing,
  type EquipmentComponent,
  type FighterComponent,
  type InventoryComponent,
  type ItemComponent,
  type LightEmitterComponent,
  type PositionComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { assertNever } from '../utils/assert.ts';
import { has3DLineOfSight } from '../map/fov_3d.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/** Standard grid square length in feet (`5` ft). */
const FEET_PER_SQUARE = 5;

/** Default fuel turns added when refueling a lantern with a pint of oil (`3600` turns = 6 hours). */
export const DEFAULT_OIL_REFUEL_TURNS = 3600;

/** Declarative tag identifying fire-starting tools (`flint_and_steel`, `tindertwig`). */
export const FIRE_STARTER_ITEM_TAG = 'fire_starter';

/** Declarative tag identifying lamp oil fuel items (`oil_flask`). */
export const LAMP_FUEL_ITEM_TAG = 'fuel';

/** Declarative tag identifying oil-refuelable lanterns. */
export const REFUELABLE_OIL_ITEM_TAG = 'refuelable_oil';

/** Declarative tag identifying generic light-source items. */
export const LIGHT_SOURCE_ITEM_TAG = 'light_source';

/** Active resolved emitter descriptor in world space. */
export interface ResolvedActiveLightEmitter {
  readonly emitterEntityId: EntityId;
  readonly carrierEntityId?: EntityId | undefined;
  readonly x: number;
  readonly y: number;
  readonly z?: number | undefined;
  readonly radiusFt: number;
  readonly shadowyRadiusFt: number;
  readonly coneAngleDeg?: number | undefined;
  readonly facing?: CardinalFacing | undefined;
}

function resolveFacingUnitVector(facing: CardinalFacing): { readonly fx: number; readonly fy: number } {
  switch (facing) {
    case 'north':
      return { fx: 0, fy: -1 };
    case 'south':
      return { fx: 0, fy: 1 };
    case 'east':
      return { fx: 1, fy: 0 };
    case 'west':
      return { fx: -1, fy: 0 };
    default:
      return assertNever(facing);
  }
}

/**
 * Checks whether `(targetX, targetY)` falls inside a directional cone centered at `(originX, originY)`
 * facing `facing` with total aperture `coneAngleDeg`. The origin square itself is always illuminated.
 *
 * @param originX Emitter X coordinate.
 * @param originY Emitter Y coordinate.
 * @param targetX Target X coordinate.
 * @param targetY Target Y coordinate.
 * @param facing Cardinal facing of the directional emitter.
 * @param coneAngleDeg Total cone angle in degrees (e.g. `60` for a bullseye lantern).
 * @returns `true` if `(targetX, targetY)` is inside the illuminated cone.
 */
export function isPointWithinEmitterCone(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  facing: CardinalFacing,
  coneAngleDeg: number
): boolean {
  const dx = targetX - originX;
  const dy = targetY - originY;
  if (dx === 0 && dy === 0) return true;
  if (coneAngleDeg >= 360) return true;

  const { fx, fy } = resolveFacingUnitVector(facing);
  const len = Math.hypot(dx, dy);
  const dot = (dx * fx + dy * fy) / len;
  const clampedDot = Math.max(-1, Math.min(1, dot));
  const angleDeg = (Math.acos(clampedDot) * 180) / Math.PI;
  return angleDeg <= coneAngleDeg / 2 + 0.001;
}

function getItemDefinitionRecord(
  state: Readonly<GameState>,
  itemId: string
):
  | {
      readonly name: string;
      readonly tags?: ReadonlyArray<string> | undefined;
      readonly lightSource?:
        | {
            readonly radiusFt: number;
            readonly shadowyRadiusFt?: number | undefined;
            readonly coneAngleDeg?: number | undefined;
            readonly fuelTurns?: number | undefined;
            readonly requiresIgnition?: boolean | undefined;
            readonly defaultLit?: boolean | undefined;
          }
        | undefined;
    }
  | undefined {
  const campaignDef = state.campaign.items[itemId];
  if (campaignDef) return campaignDef;
  const sysItems = (
    state.campaign.systemContent as
      { readonly items?: Readonly<Record<string, typeof campaignDef>> | undefined } | undefined
  )?.items;
  return sysItems?.[itemId];
}

/**
 * Derives a default `LightEmitterComponent` template from an item's declarative `lightSource` config
 * or `light_source` + `light_radius_ft:<N>` tags.
 *
 * @param state Current immutable GameState.
 * @param itemEntityId Item entity ID.
 * @returns Hydrated `LightEmitterComponent` or `undefined` if the item is not a light source.
 */
export function buildLightEmitterFromItem(
  state: Readonly<GameState>,
  itemEntityId: EntityId
): LightEmitterComponent | undefined {
  const existing = getComponent(state, itemEntityId, ComponentType.LightEmitter) as LightEmitterComponent | undefined;
  if (existing) return existing;

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return undefined;
  const def = getItemDefinitionRecord(state, itemComp.itemId);
  if (!def) return undefined;

  if (def.lightSource) {
    return {
      type: ComponentType.LightEmitter,
      radiusFt: def.lightSource.radiusFt,
      shadowyRadiusFt: def.lightSource.shadowyRadiusFt ?? def.lightSource.radiusFt * 2,
      ...(def.lightSource.coneAngleDeg !== undefined ? { coneAngleDeg: def.lightSource.coneAngleDeg } : {}),
      ...(def.lightSource.fuelTurns !== undefined
        ? { fuelTurns: def.lightSource.fuelTurns, maxFuelTurns: def.lightSource.fuelTurns }
        : {}),
      isLit: def.lightSource.defaultLit === true,
      ...(def.lightSource.requiresIgnition !== undefined ? { requiresIgnition: def.lightSource.requiresIgnition } : {})
    };
  }

  const tags = def.tags ?? [];
  if (!tags.includes(LIGHT_SOURCE_ITEM_TAG)) return undefined;
  const radiusTag = tags.find((t) => t.startsWith('light_radius_ft:'));
  const parsedRadius = radiusTag ? Number(radiusTag.slice('light_radius_ft:'.length)) : 20;
  const radiusFt = Number.isFinite(parsedRadius) && parsedRadius > 0 ? parsedRadius : 20;

  return {
    type: ComponentType.LightEmitter,
    radiusFt,
    shadowyRadiusFt: radiusFt * 2,
    isLit: false,
    requiresIgnition: true
  };
}

/**
 * Collects all currently active lit `LightEmitterComponent` sources on the map:
 * - Dropped / world-placed lit entities with `PositionComponent`, AND
 * - Lit emitters carried in the equipment or inventory of any living actor (player, companion, or NPC guard).
 *
 * @param state Current immutable GameState.
 * @returns Array of resolved world-space active emitters.
 */
export function getActiveLightEmitters(state: Readonly<GameState>): ReadonlyArray<ResolvedActiveLightEmitter> {
  const emitters: ResolvedActiveLightEmitter[] = [];
  const seenItemIds = new Set<EntityId>();

  // 1. Emitters carried or equipped by living actors (symmetric across PCs, companions, NPCs)
  for (const actorId of state.entities) {
    const pos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;
    const fighter = getComponent(state, actorId, ComponentType.Fighter) as FighterComponent | undefined;
    if (fighter && fighter.hp <= 0) continue;

    const candidateItemIds: EntityId[] = [];
    const equip = getComponent(state, actorId, ComponentType.Equipment) as EquipmentComponent | undefined;
    if (equip) {
      for (const slot of equip.slots) {
        if (slot.equippedItem !== null && slot.suppressed !== true) {
          candidateItemIds.push(slot.equippedItem);
        }
      }
    }
    const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
    if (inv) {
      for (const itemId of inv.items) {
        candidateItemIds.push(itemId);
      }
    }

    for (const itemId of candidateItemIds) {
      if (seenItemIds.has(itemId)) continue;
      const emitter = getComponent(state, itemId, ComponentType.LightEmitter) as LightEmitterComponent | undefined;
      if (!emitter || !emitter.isLit) continue;
      if (emitter.fuelTurns !== undefined && emitter.fuelTurns <= 0) continue;
      seenItemIds.add(itemId);

      const effectiveFacing = emitter.facing ?? pos.facing ?? 'east';
      emitters.push({
        emitterEntityId: itemId,
        carrierEntityId: actorId,
        x: pos.x,
        y: pos.y,
        ...(pos.z !== undefined && pos.z !== 0 ? { z: pos.z } : {}),
        radiusFt: emitter.radiusFt,
        shadowyRadiusFt: emitter.shadowyRadiusFt ?? emitter.radiusFt * 2,
        ...(emitter.coneAngleDeg !== undefined ? { coneAngleDeg: emitter.coneAngleDeg, facing: effectiveFacing } : {})
      });
    }
  }

  // 2. World-placed / dropped emitters with direct PositionComponent
  for (const entityId of state.entities) {
    if (seenItemIds.has(entityId)) continue;
    const emitter = getComponent(state, entityId, ComponentType.LightEmitter) as LightEmitterComponent | undefined;
    if (!emitter || !emitter.isLit) continue;
    if (emitter.fuelTurns !== undefined && emitter.fuelTurns <= 0) continue;
    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;

    const effectiveFacing = emitter.facing ?? pos.facing ?? 'east';
    emitters.push({
      emitterEntityId: entityId,
      x: pos.x,
      y: pos.y,
      ...(pos.z !== undefined && pos.z !== 0 ? { z: pos.z } : {}),
      radiusFt: emitter.radiusFt,
      shadowyRadiusFt: emitter.shadowyRadiusFt ?? emitter.radiusFt * 2,
      ...(emitter.coneAngleDeg !== undefined ? { coneAngleDeg: emitter.coneAngleDeg, facing: effectiveFacing } : {})
    });
  }

  return emitters;
}

/**
 * Evaluates the strongest dynamic illumination level (`'bright' | 'shadowy' | 'darkness'`)
 * cast onto `(x, y, z)` by all active radial and cone `LightEmitterComponent` sources with true 3D occlusion.
 *
 * @param state Current immutable GameState.
 * @param x Target tile X coordinate.
 * @param y Target tile Y coordinate.
 * @param z Target tile Z coordinate (defaults to `0`).
 * @returns Dynamic illumination level contributed by active emitters.
 */
export function evaluateDynamicLightAtTile(
  state: Readonly<GameState>,
  x: number,
  y: number,
  z = 0
): 'bright' | 'shadowy' | 'darkness' {
  const emitters = getActiveLightEmitters(state);
  const feetPerZ = state.campaign.rules.map.feetPerZLevel ?? FEET_PER_SQUARE;
  let level: 'bright' | 'shadowy' | 'darkness' = 'darkness';

  for (const emitter of emitters) {
    const emitterZ = emitter.z ?? 0;
    const distFt = Math.hypot(
      (x - emitter.x) * FEET_PER_SQUARE,
      (y - emitter.y) * FEET_PER_SQUARE,
      (z - emitterZ) * feetPerZ
    );
    if (distFt > emitter.shadowyRadiusFt) continue;

    if (emitter.coneAngleDeg !== undefined && emitter.facing !== undefined) {
      if (!isPointWithinEmitterCone(emitter.x, emitter.y, x, y, emitter.facing, emitter.coneAngleDeg)) {
        continue;
      }
    }

    if (!has3DLineOfSight(state, emitter.x, emitter.y, emitterZ, x, y, z)) {
      continue;
    }

    if (distFt <= emitter.radiusFt) {
      return 'bright';
    }
    level = 'shadowy';
  }

  return level;
}

/**
 * Checks whether `(x, y, z)` is currently illuminated (`'bright'` or `'shadowy'`) by at least one active,
 * lit, non-depleted `LightEmitterComponent` source (carried by a living actor or placed on the map).
 *
 * @param state Current immutable GameState.
 * @param x Target tile X coordinate.
 * @param y Target tile Y coordinate.
 * @param z Target tile Z coordinate (defaults to `0`).
 * @returns `true` if `(x, y, z)` is illuminated by an active light emitter.
 */
export function isPositionIlluminatedByActiveLightEmitter(
  state: Readonly<GameState>,
  x: number,
  y: number,
  z = 0
): boolean {
  return evaluateDynamicLightAtTile(state, x, y, z) !== 'darkness';
}

function actorHasFireStarter(state: Readonly<GameState>, actorId: EntityId, igniterItemEntityId?: EntityId): boolean {
  const checkItem = (itemId: EntityId): boolean => {
    const itemComp = getComponent(state, itemId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) return false;
    const def = getItemDefinitionRecord(state, itemComp.itemId);
    return def?.tags?.includes(FIRE_STARTER_ITEM_TAG) === true;
  };
  if (igniterItemEntityId !== undefined && checkItem(igniterItemEntityId)) return true;
  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  return inv?.items.some((id) => checkItem(id)) ?? false;
}

/**
 * Checks whether `targetItemEntityId` is a valid, unlit, non-depleted light source that `actorId`
 * can currently ignite (using `igniterItemEntityId` or a carried `'fire_starter'` tool when required).
 * Shared between UI verb projection (`getValidVerbsForTarget`) and `igniteLightEmitter`.
 */
export function canIgniteLightEmitterItem(
  state: Readonly<GameState>,
  actorId: EntityId,
  targetItemEntityId: EntityId,
  igniterItemEntityId?: EntityId
): boolean {
  const emitter = buildLightEmitterFromItem(state, targetItemEntityId);
  if (!emitter || emitter.isLit) return false;
  if (emitter.fuelTurns !== undefined && emitter.fuelTurns <= 0) return false;
  if (emitter.requiresIgnition !== false && !actorHasFireStarter(state, actorId, igniterItemEntityId)) {
    return false;
  }
  return true;
}

/**
 * Ignites a light-source item (`torch`, `hooded_lantern`, `bullseye_lantern`, `sunrod`), checking
 * for a declarative `'fire_starter'` tool (`flint_and_steel` / `tindertwig`) when `requiresIgnition` is true.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor igniting the emitter.
 * @param targetItemEntityId Light-source item entity ID.
 * @param igniterItemEntityId Optional explicit igniter tool item entity ID.
 * @returns Updated GameState and success flag.
 */
export function igniteLightEmitter(
  state: GameState,
  actorId: EntityId,
  targetItemEntityId: EntityId,
  igniterItemEntityId?: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const emitter = buildLightEmitterFromItem(state, targetItemEntityId);
  if (!emitter) {
    return {
      state: addMessage(state, 'That item cannot be ignited as a light source.', MessageLogCategory.System),
      success: false
    };
  }
  if (emitter.fuelTurns !== undefined && emitter.fuelTurns <= 0) {
    return {
      state: addMessage(
        state,
        'The light source is out of fuel and must be refueled first.',
        MessageLogCategory.System
      ),
      success: false
    };
  }
  if (emitter.requiresIgnition !== false && !actorHasFireStarter(state, actorId, igniterItemEntityId)) {
    return {
      state: addMessage(
        state,
        'You need a fire-starting tool (such as flint and steel or a tindertwig) to ignite that.',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const actorPos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  const litEmitter: LightEmitterComponent = {
    ...emitter,
    isLit: true,
    ...(emitter.coneAngleDeg !== undefined && emitter.facing === undefined
      ? { facing: actorPos?.facing ?? 'east' }
      : {})
  };
  let nextState = addComponent(state, targetItemEntityId, litEmitter);
  const itemName = resolveEntityDisplayName(nextState, targetItemEntityId, 'light source');
  nextState = addMessage(nextState, `You ignite the ${itemName}.`, MessageLogCategory.System);
  return { state: nextState, success: true };
}

/**
 * Refuels a refuelable oil lantern (`refuelable_oil` tag or finite `LightEmitterComponent`) using
 * a declarative `'fuel'` item (`oil_flask`), consuming the fuel item.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor performing the refueling.
 * @param targetItemEntityId Target lantern item entity ID.
 * @param fuelItemEntityId Fuel item entity ID (`oil_flask`).
 * @returns Updated GameState and success flag.
 */
export function refuelLightEmitter(
  state: GameState,
  actorId: EntityId,
  targetItemEntityId: EntityId,
  fuelItemEntityId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const fuelItem = getComponent(state, fuelItemEntityId, ComponentType.Item) as ItemComponent | undefined;
  const fuelDef = fuelItem ? getItemDefinitionRecord(state, fuelItem.itemId) : undefined;
  if (!fuelItem || !fuelDef?.tags?.includes(LAMP_FUEL_ITEM_TAG)) {
    return { state, success: false };
  }

  const targetItem = getComponent(state, targetItemEntityId, ComponentType.Item) as ItemComponent | undefined;
  const targetDef = targetItem ? getItemDefinitionRecord(state, targetItem.itemId) : undefined;
  const emitter = buildLightEmitterFromItem(state, targetItemEntityId);
  if (!emitter || !targetDef?.tags?.includes(REFUELABLE_OIL_ITEM_TAG)) {
    return { state, success: false };
  }

  const maxFuel = emitter.maxFuelTurns ?? DEFAULT_OIL_REFUEL_TURNS;
  const nextFuel = Math.min(maxFuel, (emitter.fuelTurns ?? 0) + DEFAULT_OIL_REFUEL_TURNS);
  let nextState = addComponent(state, targetItemEntityId, {
    ...emitter,
    fuelTurns: nextFuel,
    maxFuelTurns: maxFuel
  });

  const inv = getComponent(nextState, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (inv && inv.items.includes(fuelItemEntityId)) {
    nextState = addComponent(nextState, actorId, {
      ...inv,
      items: inv.items.filter((id) => id !== fuelItemEntityId)
    });
  }
  nextState = removeEntity(nextState, fuelItemEntityId);

  const lanternName = resolveEntityDisplayName(nextState, targetItemEntityId, targetDef.name);
  nextState = addMessage(
    nextState,
    `You refuel the ${lanternName} with oil (${nextFuel} turns remaining).`,
    MessageLogCategory.System
  );
  return { state: nextState, success: true };
}

function tickSingleEmitterFuel(
  state: GameState,
  emitterEntityId: EntityId,
  notifyOwner: boolean,
  turnsElapsed = 1
): GameState {
  if (turnsElapsed <= 0) return state;
  const emitter = getComponent(state, emitterEntityId, ComponentType.LightEmitter) as LightEmitterComponent | undefined;
  if (!emitter || !emitter.isLit || emitter.fuelTurns === undefined) return state;

  const nextFuel = Math.max(0, emitter.fuelTurns - turnsElapsed);
  if (nextFuel > 0) {
    return addComponent(state, emitterEntityId, { ...emitter, fuelTurns: nextFuel });
  }

  let nextState = addComponent(state, emitterEntityId, {
    ...emitter,
    fuelTurns: 0,
    isLit: false
  });
  nextState = { ...nextState, fovNeedsUpdate: true };
  if (notifyOwner) {
    const itemName = resolveEntityDisplayName(nextState, emitterEntityId, 'light source');
    nextState = addMessage(nextState, `Your ${itemName} flickers and burns out!`, MessageLogCategory.System);
  }
  return nextState;
}

/**
 * Advances fuel by `turnsElapsed` turns for all lit `LightEmitterComponent` items carried/equipped by `entityId`
 * (and when `entityId` is the player, also advances any lit world-placed/dropped emitters on the map).
 *
 * @param state Current immutable GameState.
 * @param entityId Actor whose light emitters are advancing.
 * @param turnsElapsed Number of elapsed turns.
 * @returns Updated GameState.
 */
export function advanceActorLightEmittersByTurns(
  state: GameState,
  entityId: EntityId,
  turnsElapsed: number
): GameState {
  if (turnsElapsed <= 0) return state;
  let nextState = state;
  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
  const tickedIds = new Set<EntityId>();

  const equip = getComponent(nextState, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (equip) {
    for (const slot of equip.slots) {
      if (slot.equippedItem !== null && !tickedIds.has(slot.equippedItem)) {
        tickedIds.add(slot.equippedItem);
        nextState = tickSingleEmitterFuel(nextState, slot.equippedItem, isPlayer, turnsElapsed);
      }
    }
  }
  const inv = getComponent(nextState, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (inv) {
    for (const itemId of inv.items) {
      if (!tickedIds.has(itemId)) {
        tickedIds.add(itemId);
        nextState = tickSingleEmitterFuel(nextState, itemId, isPlayer, turnsElapsed);
      }
    }
  }

  if (isPlayer) {
    for (const worldId of nextState.entities) {
      if (tickedIds.has(worldId)) continue;
      if (getComponent(nextState, worldId, ComponentType.Position) === undefined) continue;
      const emitter = getComponent(nextState, worldId, ComponentType.LightEmitter) as LightEmitterComponent | undefined;
      if (emitter?.isLit && emitter.fuelTurns !== undefined) {
        nextState = tickSingleEmitterFuel(nextState, worldId, false, turnsElapsed);
      }
    }
  }

  return nextState;
}

/**
 * Ticks down fuel by 1 turn for all lit `LightEmitterComponent` items carried/equipped by `entityId`
 * (and on the player's turn start, also ticks any lit world-placed/dropped emitters on the map).
 *
 * @param state Current immutable GameState.
 * @param entityId Actor whose turn is starting.
 * @returns Updated GameState.
 */
export function processActorLightEmittersTick(state: GameState, entityId: EntityId): GameState {
  return advanceActorLightEmittersByTurns(state, entityId, 1);
}
