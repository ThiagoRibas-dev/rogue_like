import { addComponent, getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { setActorSubmersionState } from '../../../systems/breath.system.ts';
import { queryCrossingAtPosition, spawnCrossingEntity } from '../../../systems/crossing.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  displaceEntityStep,
  evaluateTileTraversal,
  getEntityMovementModes
} from '../../../systems/movement_displacement.ts';
import {
  ComponentType,
  type CrossingKind,
  type DamageComponent,
  type InventoryComponent,
  type ItemComponent,
  type PositionComponent,
  type StatusEffectsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { coordToIndex, isInBounds } from '../../../utils/grid.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { resolveEffectiveItemDefinition } from '../equipment/item_inheritance.ts';
import { evaluateDiceExpression, rollD20 } from '../math/dice.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35ConditionId } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { removeStatusEffectById } from './flanking_graph.ts';

/** SRD Calm Water Swim check DC (`10`). */
export const SWIM_CALM_WATER_DC = 10;

/** SRD Rough Water Swim check DC (`15`). */
export const SWIM_ROUGH_WATER_DC = 15;

/** SRD Swim skill Armor Check Penalty multiplier (`2`). */
export const SWIM_ACP_MULTIPLIER = 2;

/** SRD Jump check DC per 5-ft horizontal gap with a running start (`5`). */
export const JUMP_RUNNING_DC_PER_5_FT = 5;

/** SRD Standing Jump DC multiplier without a running start (`2`). */
export const JUMP_STANDING_DC_MULTIPLIER = 2;

/** SRD Reflex saving throw DC to catch a pit or chasm ledge upon failing a Jump (`15`). */
export const JUMP_LEDGE_CATCH_REFLEX_DC = 15;

/** SRD Climb check DC to scale a standard dungeon pit wall (`15`). */
export const CLIMB_PIT_WALL_DC = 15;

/** SRD Use Rope check DC to secure a grappling hook across a gap (`10`). */
export const USE_ROPE_GRAPPLING_HOOK_DC = 10;

/** SRD falling damage dice per 10 ft fallen (`1d6`). */
export const FALL_DAMAGE_DICE_PER_10_FT = '1d6';

/** Shallow water / bog penalty applied to Move Silently and Tumble checks (`-2`). */
export const SHALLOW_WATER_STEALTH_TUMBLE_PENALTY = -2;

/** Non-magical burning status effect IDs extinguished upon entering water. */
const EXTINGUISHED_BY_WATER_STATUS_IDS: ReadonlyArray<string> = ['burning', 'on_fire', 'catching_fire'];

function addConditionToActor(state: GameState, entityId: EntityId, condition: DnD35ConditionId): GameState {
  const dndData = getDnD35EntityData(state, entityId);
  const current = dndData.conditions ?? [];
  if (current.includes(condition)) return state;
  return setDnD35EntityData(state, entityId, {
    ...dndData,
    conditions: [...current, condition]
  });
}

function actorInventoryHasItemTag(state: Readonly<GameState>, entityId: EntityId, tag: string): boolean {
  const inv = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (!inv) return false;
  const sysItems = getDnD35SystemContent(state.campaign)?.items;
  for (const itemEntityId of inv.items) {
    const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const campaignDef = state.campaign.items[itemComp.itemId];
    if (campaignDef?.tags?.includes(tag)) return true;
    const rawSysDef = sysItems?.[itemComp.itemId];
    const sysDef = rawSysDef && sysItems ? resolveEffectiveItemDefinition(rawSysDef, sysItems, itemComp) : undefined;
    if (sysDef?.tags?.includes(tag)) return true;
  }
  return false;
}

/**
 * Extinguishes non-magical burning status effects on `entityId` when stepping into water.
 *
 * @param state Current immutable GameState.
 * @param entityId Target actor EntityId.
 * @returns Updated GameState.
 */
export function extinguishActorFireInWater(state: GameState, entityId: EntityId): GameState {
  const statusComp = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  if (!statusComp || statusComp.activeEffects.length === 0) return state;

  let nextState = state;
  for (const eff of statusComp.activeEffects) {
    if (EXTINGUISHED_BY_WATER_STATUS_IDS.includes(eff.effectId)) {
      nextState = removeStatusEffectById(nextState, entityId, eff.effectId);
    }
  }
  return nextState;
}

/**
 * Evaluates whether an actor (`entityId`) at `(x, y)` is standing in `shallow_water` or `bog`,
 * returning the `-2` circumstance penalty to `Move Silently` and `Tumble` checks (unless flying).
 *
 * @param state Current immutable GameState.
 * @param entityId Target actor EntityId.
 * @returns `0` or `-2`.
 */
export function getShallowWaterStealthAndTumblePenalty(state: Readonly<GameState>, entityId: EntityId): number {
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos || !isInBounds(pos.x, pos.y, state.map.width, state.map.height)) return 0;
  const modes = getEntityMovementModes(state as GameState, entityId);
  if (modes?.fly !== undefined && modes.fly > 0) return 0;

  const tile = state.map.tiles[coordToIndex(pos.x, pos.y, state.map.width)];
  const tileDef = tile ? state.campaign.tiles[tile.tileId] : undefined;
  const tags = tileDef?.tags ?? [];
  if (
    tileDef?.hazardKind === 'shallow_water' ||
    tileDef?.hazardKind === 'bog' ||
    tags.includes('shallow_water') ||
    tags.includes('bog')
  ) {
    return SHALLOW_WATER_STEALTH_TUMBLE_PENALTY;
  }
  return 0;
}

/**
 * Resolves a D&D 3.5e Swim check (`DC 10` calm / `DC 15` rough) applying **`2×` live Armor Check Penalty**
 * from the M150 encumbrance/armor DAG. Native swimmers (`swim > 0`) auto-succeed without sinking.
 * On failure, the actor sinks below the surface and activates their `BreathComponent` (`2 * CON` rounds).
 *
 * @param state Current immutable GameState.
 * @param entityId Swimming actor EntityId.
 * @param options Optional `isRoughWater` flag and deterministic `forcedD20` roll.
 * @returns Result containing updated GameState, success flag, total roll, DC, and whether the actor sank.
 */
export function resolveDeepWaterSwimCheck(
  state: GameState,
  entityId: EntityId,
  options?: {
    readonly isRoughWater?: boolean | undefined;
    readonly forcedD20?: number | undefined;
  }
): {
  readonly state: GameState;
  readonly success: boolean;
  readonly totalRoll: number;
  readonly dc: number;
  readonly sank: boolean;
} {
  let nextState = extinguishActorFireInWater(state, entityId);
  const dc = options?.isRoughWater === true ? SWIM_ROUGH_WATER_DC : SWIM_CALM_WATER_DC;
  const modes = getEntityMovementModes(nextState, entityId);

  if ((modes?.fly !== undefined && modes.fly > 0) || (modes?.swim !== undefined && modes.swim > 0)) {
    nextState = setActorSubmersionState(nextState, entityId, false);
    return {
      state: nextState,
      success: true,
      totalRoll: dc + 10,
      dc,
      sank: false
    };
  }

  const dag = evaluateDnD35eEntityDAG(nextState, entityId);
  const swimSnapshot = dag?.resolvedSkills['swim'];
  const effectiveAcp = dag?.armorCheckPenalty ?? 0;
  // resolvedSkills['swim'].totalModifier already includes 2x ACP when armorCheckPenaltyMultiplier === 2 in skills.json;
  // verify and guarantee 2x live ACP is applied even if skills.json multiplier is 1.
  const snapshotAcpApplied = swimSnapshot?.acpApplied ?? 0;
  const targetDoubleAcp = effectiveAcp * SWIM_ACP_MULTIPLIER;
  const extraAcpDelta = targetDoubleAcp - snapshotAcpApplied;
  const baseSwimMod =
    swimSnapshot !== undefined
      ? swimSnapshot.totalModifier + extraAcpDelta
      : (dag?.dagResult.effectiveAbilityModifiers.str ?? 0) + targetDoubleAcp;

  const roll = rollD20('skill_check', baseSwimMod, options?.forcedD20);
  const actorName = resolveEntityDisplayName(nextState, entityId, 'The swimmer');

  if (roll.total >= dc) {
    nextState = setActorSubmersionState(nextState, entityId, false);
    nextState = addMessage(
      nextState,
      `${actorName} treads through the deep water (Swim ${roll.total} vs DC ${dc}).`,
      MessageLogCategory.System
    );
    return {
      state: nextState,
      success: true,
      totalRoll: roll.total,
      dc,
      sank: false
    };
  }

  nextState = setActorSubmersionState(nextState, entityId, true);
  nextState = addMessage(
    nextState,
    `${actorName} fails to stay afloat in deep water (Swim ${roll.total} vs DC ${dc}) and sinks beneath the surface!`,
    MessageLogCategory.CombatHit
  );
  return {
    state: nextState,
    success: false,
    totalRoll: roll.total,
    dc,
    sank: true
  };
}

/**
 * Applies pit/chasm falling damage (`1d6` per 10 ft, default `1d6`) and knocks the actor `'prone'`.
 *
 * @param state Current immutable GameState.
 * @param entityId Falling actor EntityId.
 * @param depthFeet Pit depth in feet (default `10`).
 * @returns Updated GameState.
 */
export function applyPitFallConsequences(state: GameState, entityId: EntityId, depthFeet = 10): GameState {
  const diceCount = Math.max(1, Math.floor(depthFeet / 10));
  let totalFallDamage = 0;
  for (let i = 0; i < diceCount; i++) {
    totalFallDamage += Math.max(1, evaluateDiceExpression(FALL_DAMAGE_DICE_PER_10_FT).total);
  }

  const existingDmg = getComponent(state, entityId, ComponentType.Damage) as DamageComponent | undefined;
  const instances = existingDmg ? [...existingDmg.instances] : [];
  instances.push({
    amount: totalFallDamage,
    tags: ['falling', 'bludgeoning', 'environmental']
  });

  let nextState = addComponent(state, entityId, {
    type: ComponentType.Damage,
    instances
  });
  nextState = addConditionToActor(nextState, entityId, 'prone');
  const actorName = resolveEntityDisplayName(nextState, entityId, 'The traveler');
  return addMessage(
    nextState,
    `${actorName} plunges into the pit, taking ${totalFallDamage} falling damage and landing prone!`,
    MessageLogCategory.CombatHit
  );
}

/**
 * Resolves a D&D 3.5e Jump check across a 1–2 tile (`5–10 ft`) horizontal gap or pit:
 * - DC = `5` per 5-ft gap with a running start (`×2` if standing).
 * - On success, displaces the actor cleanly to `(landingX, landingY)`.
 * - On failure, rolls a Reflex ledge-catch save (`DC 15`):
 *   - Save success catches the origin edge without falling.
 *   - Save failure drops the actor into the pit tile (`(pitX, pitY)`), dealing `1d6` falling damage and applying `'prone'`.
 *
 * @param params Structured jump attempt parameters.
 * @returns Jump outcome with updated GameState, success flag, roll total, DC, and whether the actor fell.
 */
export function resolveGapJumpTraversal(params: {
  readonly state: GameState;
  readonly entityId: EntityId;
  readonly landingX: number;
  readonly landingY: number;
  readonly gapTiles?: number | undefined;
  readonly hasRunningStart?: boolean | undefined;
  readonly pitX?: number | undefined;
  readonly pitY?: number | undefined;
  readonly forcedJumpD20?: number | undefined;
  readonly forcedReflexD20?: number | undefined;
}): {
  readonly state: GameState;
  readonly success: boolean;
  readonly caughtLedge: boolean;
  readonly fellInPit: boolean;
  readonly totalRoll: number;
  readonly dc: number;
} {
  const { state, entityId, landingX, landingY } = params;
  const fromPos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  const spanTiles = Math.max(
    1,
    params.gapTiles ??
      (fromPos ? Math.max(1, Math.max(Math.abs(landingX - fromPos.x), Math.abs(landingY - fromPos.y)) - 1) : 1)
  );
  const runningMult = params.hasRunningStart === false ? JUMP_STANDING_DC_MULTIPLIER : 1;
  const dc = spanTiles * JUMP_RUNNING_DC_PER_5_FT * runningMult;

  const dag = evaluateDnD35eEntityDAG(state, entityId);
  const jumpMod = dag?.resolvedSkills['jump']?.totalModifier ?? dag?.dagResult.effectiveAbilityModifiers.str ?? 0;
  const jumpRoll = rollD20('skill_check', jumpMod, params.forcedJumpD20);
  const actorName = resolveEntityDisplayName(state, entityId, 'The jumper');

  if (jumpRoll.total >= dc) {
    const disp = displaceEntityStep({
      state,
      entityId,
      targetX: landingX,
      targetY: landingY,
      context: {
        mode: 'voluntary_walk',
        isForced: false,
        provokesAoO: true
      }
    });
    const msgState = addMessage(
      disp.state,
      `${actorName} leaps across the gap (Jump ${jumpRoll.total} vs DC ${dc})!`,
      MessageLogCategory.System
    );
    return {
      state: msgState,
      success: disp.moved,
      caughtLedge: false,
      fellInPit: false,
      totalRoll: jumpRoll.total,
      dc
    };
  }

  // Failed Jump -> Reflex save DC 15 to catch the ledge
  const refMod = dag?.dagResult.effectiveAbilityModifiers.dex ?? 0;
  const refRoll = rollD20('save', refMod, params.forcedReflexD20);
  if (refRoll.total >= JUMP_LEDGE_CATCH_REFLEX_DC) {
    const msgState = addMessage(
      state,
      `${actorName} comes up short (Jump ${jumpRoll.total} vs DC ${dc}) but catches the ledge (Reflex ${refRoll.total} vs DC ${JUMP_LEDGE_CATCH_REFLEX_DC})!`,
      MessageLogCategory.System
    );
    return {
      state: msgState,
      success: false,
      caughtLedge: true,
      fellInPit: false,
      totalRoll: jumpRoll.total,
      dc
    };
  }

  const hazardX = params.pitX ?? (fromPos ? fromPos.x + Math.sign(landingX - fromPos.x) : landingX);
  const hazardY = params.pitY ?? (fromPos ? fromPos.y + Math.sign(landingY - fromPos.y) : landingY);
  const preJumpDmgCount =
    (getComponent(state, entityId, ComponentType.Damage) as DamageComponent | undefined)?.instances.length ?? 0;
  const fallDisp = displaceEntityStep({
    state,
    entityId,
    targetX: hazardX,
    targetY: hazardY,
    context: {
      mode: 'forced_push',
      isForced: true,
      provokesAoO: false
    }
  });
  const postDispDmgCount =
    (getComponent(fallDisp.state, entityId, ComponentType.Damage) as DamageComponent | undefined)?.instances.length ??
    0;
  const fallenState =
    postDispDmgCount > preJumpDmgCount ? fallDisp.state : applyPitFallConsequences(fallDisp.state, entityId);
  return {
    state: fallenState,
    success: false,
    caughtLedge: false,
    fellInPit: true,
    totalRoll: jumpRoll.total,
    dc
  };
}

/**
 * Resolves a D&D 3.5e Climb check (`DC 10–15`, granting `+2` circumstance bonus when carrying `climbers_kit`)
 * to climb out of or scale across a pit/ledge tile.
 *
 * @param params Climb attempt parameters.
 * @returns Climb outcome with updated GameState, success flag, roll total, and DC.
 */
export function resolvePitClimbTraversal(params: {
  readonly state: GameState;
  readonly entityId: EntityId;
  readonly targetX: number;
  readonly targetY: number;
  readonly dc?: number | undefined;
  readonly forcedD20?: number | undefined;
}): {
  readonly state: GameState;
  readonly success: boolean;
  readonly totalRoll: number;
  readonly dc: number;
} {
  const { state, entityId, targetX, targetY } = params;
  const dc = params.dc ?? CLIMB_PIT_WALL_DC;
  const dag = evaluateDnD35eEntityDAG(state, entityId);
  const baseClimbMod = dag?.resolvedSkills['climb']?.totalModifier ?? dag?.dagResult.effectiveAbilityModifiers.str ?? 0;
  const hasClimbersKit = actorInventoryHasItemTag(state, entityId, 'climbing_kit');
  // If climbers_kit is in inventory (not equipped), add +2 circumstance bonus if not already in skill snapshot
  const kitBonus = hasClimbersKit && (dag?.resolvedSkills['climb']?.miscModifier ?? 0) === 0 ? 2 : 0;

  const roll = rollD20('skill_check', baseClimbMod + kitBonus, params.forcedD20);
  const actorName = resolveEntityDisplayName(state, entityId, 'The climber');

  if (roll.total < dc) {
    return {
      state: addMessage(
        state,
        `${actorName} fails to scale the wall (Climb ${roll.total} vs DC ${dc}).`,
        MessageLogCategory.System
      ),
      success: false,
      totalRoll: roll.total,
      dc
    };
  }

  const disp = displaceEntityStep({
    state,
    entityId,
    targetX,
    targetY,
    context: {
      mode: 'voluntary_walk',
      isForced: false,
      provokesAoO: true
    }
  });
  return {
    state: addMessage(
      disp.state,
      `${actorName} climbs onto the ledge (Climb ${roll.total} vs DC ${dc})!`,
      MessageLogCategory.System
    ),
    success: disp.moved,
    totalRoll: roll.total,
    dc
  };
}

function findInventoryItemWithTag(state: Readonly<GameState>, entityId: EntityId, tag: string): EntityId | undefined {
  const inv = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (!inv) return undefined;
  const sysItems = getDnD35SystemContent(state.campaign)?.items;
  for (const itemEntityId of inv.items) {
    const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const campaignDef = state.campaign.items[itemComp.itemId];
    if (campaignDef?.tags?.includes(tag)) return itemEntityId;
    const rawSysDef = sysItems?.[itemComp.itemId];
    const sysDef = rawSysDef && sysItems ? resolveEffectiveItemDefinition(rawSysDef, sysItems, itemComp) : undefined;
    if (sysDef?.tags?.includes(tag)) return itemEntityId;
  }
  return undefined;
}

function consumeOneInventoryItemEntity(state: GameState, actorId: EntityId, itemEntityId: EntityId): GameState {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (itemComp?.charges !== undefined && itemComp.charges > 1) {
    return addComponent(state, itemEntityId, {
      ...itemComp,
      charges: itemComp.charges - 1
    });
  }
  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (!inv) return state;
  return addComponent(state, actorId, {
    ...inv,
    items: inv.items.filter((id) => id !== itemEntityId)
  });
}

function isTileCrossingGapHazard(state: Readonly<GameState>, x: number, y: number): boolean {
  if (!isInBounds(x, y, state.map.width, state.map.height)) return false;
  const tile = state.map.tiles[coordToIndex(x, y, state.map.width)];
  const tileDef = tile ? state.campaign.tiles[tile.tileId] : undefined;
  if (!tileDef) return false;
  const tags = tileDef.tags ?? [];
  return (
    tileDef.hazardKind === 'pit' ||
    tileDef.hazardKind === 'chasm' ||
    tileDef.hazardKind === 'water' ||
    tileDef.hazardKind === 'deep_water' ||
    tags.includes('pit') ||
    tags.includes('chasm') ||
    tags.includes('water') ||
    tags.includes('liquid') ||
    !tileDef.walkable
  );
}

function findAdjacentSolidAnchorCoords(
  state: Readonly<GameState>,
  x: number,
  y: number
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const anchors: Array<{ readonly x: number; readonly y: number }> = [];
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
  ];
  for (const { dx, dy } of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (!isInBounds(nx, ny, state.map.width, state.map.height)) continue;
    const tile = state.map.tiles[coordToIndex(nx, ny, state.map.width)];
    const tileDef = tile ? state.campaign.tiles[tile.tileId] : undefined;
    if (tileDef && (tileDef.walkable || tileDef.isSolidObstacle === true)) {
      anchors.push({ x: nx, y: ny });
    }
  }
  return anchors;
}

/**
 * Resolves deploying a world-owned `CrossingComponent` entity (`'rope_line'` via `grappling_hook` + rope and
 * a `Use Rope DC 10` check with `+2` for `silk_rope`, or `'ladder_span'` via `ladder_10ft`) over a hazardous tile `(targetX, targetY)`:
 * - Validates that `(targetX, targetY)` is a gap/hazard tile within `maxRangeTiles`, has at least one adjacent solid anchor,
 *   and does not already have an active crossing.
 * - Requires and consumes/installs the required inventory gear (`crossing_ladder` / `ladder` for `'ladder_span'`, or
 *   `grappling_anchor` + `rope` for `'rope_line'`) when the actor carries an inventory.
 *
 * @param params Crossing deployment parameters.
 * @returns Updated GameState, success flag, and spawned `crossingEntityId`.
 */
export function resolveRigCrossingWithGear(params: {
  readonly state: GameState;
  readonly entityId: EntityId;
  readonly targetX: number;
  readonly targetY: number;
  readonly crossingKind?: CrossingKind | undefined;
  readonly forcedD20?: number | undefined;
}): {
  readonly state: GameState;
  readonly success: boolean;
  readonly crossingEntityId?: EntityId | undefined;
  readonly totalRoll?: number | undefined;
} {
  const { state, entityId, targetX, targetY } = params;
  const actorName = resolveEntityDisplayName(state, entityId, 'The adventurer');

  if (!isInBounds(targetX, targetY, state.map.width, state.map.height)) {
    return {
      state: addMessage(state, 'Target square is out of bounds.', MessageLogCategory.System),
      success: false
    };
  }

  if (queryCrossingAtPosition(state, targetX, targetY) !== undefined) {
    return {
      state: addMessage(state, 'A crossing is already rigged over that square.', MessageLogCategory.System),
      success: false
    };
  }

  if (!isTileCrossingGapHazard(state, targetX, targetY)) {
    return {
      state: addMessage(
        state,
        'You can only rig a crossing over a pit, chasm, or water hazard.',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const anchorCoords = findAdjacentSolidAnchorCoords(state, targetX, targetY);
  if (anchorCoords.length === 0) {
    return {
      state: addMessage(
        state,
        'There is no adjacent ledge or anchor point to support a crossing there.',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const ladderItemId =
    findInventoryItemWithTag(state, entityId, 'crossing_ladder') ?? findInventoryItemWithTag(state, entityId, 'ladder');
  const requestedKind: CrossingKind = params.crossingKind ?? (ladderItemId !== undefined ? 'ladder_span' : 'rope_line');
  const maxRangeTiles = requestedKind === 'ladder_span' ? 2 : 4;

  const actorPos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (actorPos) {
    const dist = Math.max(Math.abs(actorPos.x - targetX), Math.abs(actorPos.y - targetY));
    if (dist > maxRangeTiles) {
      return {
        state: addMessage(state, 'That gap is too far away to rig from here.', MessageLogCategory.System),
        success: false
      };
    }
  }

  const inv = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const hasPopulatedInventory = inv !== undefined && inv.items.length > 0;

  if (requestedKind === 'ladder_span' || requestedKind === 'bridge') {
    if (requestedKind === 'ladder_span' && hasPopulatedInventory && ladderItemId === undefined) {
      return {
        state: addMessage(state, 'You need a 10-foot ladder to bridge that gap.', MessageLogCategory.System),
        success: false
      };
    }

    let workingState = state;
    if (ladderItemId !== undefined) {
      workingState = consumeOneInventoryItemEntity(workingState, entityId, ladderItemId);
    }

    const [nextState, crossingEntityId] = spawnCrossingEntity({
      state: workingState,
      x: targetX,
      y: targetY,
      crossingKind: requestedKind,
      anchorTileCoords: anchorCoords
    });
    return {
      state: addMessage(
        nextState,
        `${actorName} lays a ${requestedKind.replace(/_/g, ' ')} across (${targetX}, ${targetY}).`,
        MessageLogCategory.System
      ),
      success: true,
      crossingEntityId
    };
  }

  const hookItemId = findInventoryItemWithTag(state, entityId, 'grappling_anchor');
  const ropeItemId =
    findInventoryItemWithTag(state, entityId, 'supple_rope') ?? findInventoryItemWithTag(state, entityId, 'rope');
  if (hasPopulatedInventory && (hookItemId === undefined || ropeItemId === undefined)) {
    return {
      state: addMessage(
        state,
        'You need both a grappling hook and a coil of rope to rig a rope line across that gap.',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const dag = evaluateDnD35eEntityDAG(state, entityId);
  const baseRopeMod =
    dag?.resolvedSkills['use_rope']?.totalModifier ?? dag?.dagResult.effectiveAbilityModifiers.dex ?? 0;
  const hasSilkRope = actorInventoryHasItemTag(state, entityId, 'supple_rope');
  const silkBonus = hasSilkRope && (dag?.resolvedSkills['use_rope']?.miscModifier ?? 0) === 0 ? 2 : 0;
  const roll = rollD20('skill_check', baseRopeMod + silkBonus, params.forcedD20);

  if (roll.total < USE_ROPE_GRAPPLING_HOOK_DC) {
    return {
      state: addMessage(
        state,
        `${actorName} throws the grappling hook (Use Rope ${roll.total} vs DC ${USE_ROPE_GRAPPLING_HOOK_DC}) but it clatters loose!`,
        MessageLogCategory.System
      ),
      success: false,
      totalRoll: roll.total
    };
  }

  let workingState = state;
  if (hookItemId !== undefined) {
    workingState = consumeOneInventoryItemEntity(workingState, entityId, hookItemId);
  }
  if (ropeItemId !== undefined) {
    workingState = consumeOneInventoryItemEntity(workingState, entityId, ropeItemId);
  }

  const [nextState, crossingEntityId] = spawnCrossingEntity({
    state: workingState,
    x: targetX,
    y: targetY,
    crossingKind: 'rope_line',
    requiredSkill: 'balance',
    skillDc: 10,
    anchorTileCoords: anchorCoords
  });
  return {
    state: addMessage(
      nextState,
      `${actorName} secures a taut rope line across (${targetX}, ${targetY}) (Use Rope ${roll.total} vs DC ${USE_ROPE_GRAPPLING_HOOK_DC})!`,
      MessageLogCategory.System
    ),
    success: true,
    crossingEntityId,
    totalRoll: roll.total
  };
}

/**
 * Evaluates terrain hazards at `(x, y)` whenever an actor enters or starts a turn on the square,
 * or when a world-owned crossing collapses beneath them:
 * - If an active `CrossingComponent` spans `(x, y)`, the actor stays safely supported above underlying water/pits.
 * - If on `shallow_water` or `bog`, extinguishes non-magical fire and clears submersion.
 * - If on `deep_water` (or `water`) without a crossing, runs `resolveDeepWaterSwimCheck` (`2× ACP` Swim DC 10/15).
 * - If on `pit` or `chasm` without a crossing or flight, applies `applyPitFallConsequences` (`1d6` fall + `prone`).
 *
 * @param state Current immutable GameState.
 * @param entityId Occupant actor EntityId.
 * @param x Grid X coordinate.
 * @param y Grid Y coordinate.
 * @returns Updated GameState.
 */
export function evaluateActorTileHazardOccupation(
  state: GameState,
  entityId: EntityId,
  x: number,
  y: number,
  options?: { readonly isTurnStart?: boolean | undefined }
): GameState {
  if (!isInBounds(x, y, state.map.width, state.map.height)) return state;
  const tile = state.map.tiles[coordToIndex(x, y, state.map.width)];
  const tileDef = tile ? state.campaign.tiles[tile.tileId] : undefined;
  if (!tileDef) return state;

  const modes = getEntityMovementModes(state, entityId);
  if (modes?.fly !== undefined && modes.fly > 0) {
    return setActorSubmersionState(state, entityId, false);
  }

  // If supported by an intact world crossing, clear submersion and skip underlying water/pit hazards
  const crossing = queryCrossingAtPosition(state, x, y);
  if (crossing) {
    return setActorSubmersionState(state, entityId, false);
  }

  const tags = tileDef.tags ?? [];
  const isDeepWater =
    tileDef.hazardKind === 'deep_water' ||
    tileDef.hazardKind === 'water' ||
    (!tileDef.walkable && (tags.includes('water') || tags.includes('liquid')));
  if (isDeepWater) {
    const isRough = tags.includes('rough_water');
    return resolveDeepWaterSwimCheck(state, entityId, { isRoughWater: isRough }).state;
  }

  const isShallowWater =
    tileDef.hazardKind === 'shallow_water' ||
    tileDef.hazardKind === 'bog' ||
    tags.includes('shallow_water') ||
    tags.includes('bog') ||
    (tileDef.walkable && (tags.includes('water') || tags.includes('liquid')));
  if (isShallowWater) {
    const ext = extinguishActorFireInWater(state, entityId);
    return setActorSubmersionState(ext, entityId, false);
  }

  if (options?.isTurnStart !== true) {
    const evalRes = evaluateTileTraversal(tileDef, modes, state, x, y);
    if (evalRes.passability === 'hazardous' && (evalRes.hazardKind === 'pit' || evalRes.hazardKind === 'chasm')) {
      return applyPitFallConsequences(state, entityId);
    }
  }

  return setActorSubmersionState(state, entityId, false);
}
