import { addComponent, getComponent, removeEntity, resolveEntityDisplayName } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import type { DurabilityConfig } from '../types/campaign/meta.ts';
import {
  ComponentType,
  type InventoryComponent,
  type ItemComponent,
  type LockComponent,
  type PositionComponent,
  type StructuralComponent,
  type TagsComponent,
  type TrapComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { emitSoundEvent, SOUND_DB_DOOR_KICK } from './sound.system.ts';

/** Declarative item tag identifying repair tools (`whetstone`, `artisan_tools`). */
export const REPAIR_TOOL_ITEM_TAG = 'repair_tool';

/** Declarative item tag identifying door wedges / iron spikes (`iron_spike`). */
export const DOOR_SPIKE_ITEM_TAG = 'door_spike';

/** Declarative item tag identifying hammers used to drive spikes (`hammer`). */
export const HAMMER_TOOL_ITEM_TAG = 'hammer';

/** Declarative item tag identifying 10-ft reach probing poles (`pole_10ft`). */
export const REACH_PROBE_ITEM_TAG = 'reach_probe';

/** Bonus added to a door's Break DC when wedged shut with an iron spike (`+2`). */
export const SPIKED_DOOR_BREAK_DC_BONUS = 2;

/** Maximum Chebyshev tile range for probing a tile or trap with a 10-ft pole (`2` tiles = 10 ft). */
export const REACH_PROBE_MAX_RANGE_TILES = 2;

/** Sound decibel emission when driving an iron spike into a door with a hammer (`55` dB). */
export const SOUND_DOOR_SPIKE_DB = 55;

/** Default campaign durability configuration (all opt-in combat wear probabilities set to `0%`). */
export const DEFAULT_DURABILITY_CONFIG: DurabilityConfig = {
  enableFumbleWearChance: 0,
  enableHardArmorWearChance: 0,
  enableCritArmorWearChance: 0,
  ruinedIsRepairable: true
};

/**
 * Resolves the effective campaign durability configuration from `state.campaign.rules.durabilityConfig`,
 * defaulting all optional combat wear percentages to `0` (`0%`) for baseline SRD fidelity.
 *
 * @param state Current GameState.
 * @returns Effective `DurabilityConfig`.
 */
export function resolveDurabilityConfig(state: Readonly<GameState>): DurabilityConfig {
  const cfg = state.campaign.rules.durabilityConfig;
  if (!cfg) {
    return DEFAULT_DURABILITY_CONFIG;
  }
  return {
    enableFumbleWearChance: cfg.enableFumbleWearChance ?? DEFAULT_DURABILITY_CONFIG.enableFumbleWearChance,
    enableHardArmorWearChance: cfg.enableHardArmorWearChance ?? DEFAULT_DURABILITY_CONFIG.enableHardArmorWearChance,
    enableCritArmorWearChance: cfg.enableCritArmorWearChance ?? DEFAULT_DURABILITY_CONFIG.enableCritArmorWearChance,
    ruinedIsRepairable: cfg.ruinedIsRepairable ?? DEFAULT_DURABILITY_CONFIG.ruinedIsRepairable
  };
}

/**
 * Applies post-mitigation structural HP damage to an entity carrying `StructuralComponent`.
 * Reaching `0 HP` marks `ruined: true` and `hp: 0` without deleting the item or object entity,
 * allowing later repair via `repairRuinedItem` (or opening a smashed door).
 *
 * @param state Current immutable GameState.
 * @param targetEntityId Entity carrying `ComponentType.Structural`.
 * @param netDamage Net damage after energy multipliers and hardness subtraction.
 * @returns Updated GameState, remaining HP, and whether the object became `ruined`.
 */
export function applyStructuralDamage(
  state: GameState,
  targetEntityId: EntityId,
  netDamage: number
): {
  readonly state: GameState;
  readonly appliedDamage: number;
  readonly remainingHp: number;
  readonly becameRuined: boolean;
} {
  const structural = getComponent(state, targetEntityId, ComponentType.Structural) as StructuralComponent | undefined;
  if (!structural) {
    return { state, appliedDamage: 0, remainingHp: 0, becameRuined: false };
  }

  const clampedDamage = Math.max(0, Math.floor(netDamage));
  const nextHp = Math.max(0, structural.hp - clampedDamage);
  const becameRuined = nextHp === 0 && structural.ruined !== true;
  const updatedStructural: StructuralComponent = {
    ...structural,
    hp: nextHp,
    ...(nextHp === 0 ? { ruined: true } : {}),
    ...(nextHp === 0 && structural.isDoor === true ? { isOpen: true } : {})
  };

  let nextState = addComponent(state, targetEntityId, updatedStructural);
  if (becameRuined) {
    const targetName = resolveEntityDisplayName(nextState, targetEntityId, 'The object');
    nextState = addMessage(
      nextState,
      `${targetName} is reduced to 0 HP and becomes ruined!`,
      MessageLogCategory.CombatHit
    );
  }

  return {
    state: nextState,
    appliedDamage: clampedDamage,
    remainingHp: nextHp,
    becameRuined
  };
}

/**
 * Repairs a damaged or `ruined: true` structural item or object (`targetEntityId`), restoring HP
 * (up to `maxHp`) and clearing `ruined` when `hp > 0` and `resolveDurabilityConfig(state).ruinedIsRepairable` is true.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor performing the repair.
 * @param targetEntityId Structural item or object being repaired.
 * @param restoredHp Amount of structural HP restored (defaults to full `maxHp`).
 * @returns `{ state, success }`.
 */
export function repairRuinedItem(
  state: GameState,
  actorId: EntityId,
  targetEntityId: EntityId,
  restoredHp?: number
): { readonly state: GameState; readonly success: boolean } {
  const structural = getComponent(state, targetEntityId, ComponentType.Structural) as StructuralComponent | undefined;
  if (!structural) {
    return {
      state: addMessage(state, 'That item has no structural durability to repair.', MessageLogCategory.System),
      success: false
    };
  }

  const cfg = resolveDurabilityConfig(state);
  if (structural.ruined === true && !cfg.ruinedIsRepairable) {
    return {
      state: addMessage(
        state,
        'Campaign rules prohibit repairing completely ruined equipment.',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const healAmount = restoredHp !== undefined ? Math.max(1, Math.floor(restoredHp)) : structural.maxHp;
  const nextHp = Math.min(structural.maxHp, structural.hp + healAmount);
  const { ruined: _clearedRuined, ...restStructural } = structural;
  const updatedStructural: StructuralComponent = {
    ...restStructural,
    hp: nextHp
  };

  let nextState = addComponent(state, targetEntityId, updatedStructural);
  const actorName = resolveEntityDisplayName(nextState, actorId, 'Someone');
  const itemName = resolveEntityDisplayName(nextState, targetEntityId, 'the item');
  nextState = addMessage(
    nextState,
    `${actorName} repairs ${itemName} (${nextHp}/${structural.maxHp} HP).`,
    MessageLogCategory.System
  );
  return { state: nextState, success: true };
}

/**
 * Evaluates opt-in campaign combat wear (`fumble`, `hard_armor_impact`, `crit_armor_impact`).
 * By default (`0%` across all fields in `DEFAULT_DURABILITY_CONFIG`), returns `triggered: false` and leaves the item untouched.
 *
 * @param state Current immutable GameState.
 * @param itemEntityId Equipped weapon or armor EntityId carrying `StructuralComponent`.
 * @param trigger `'fumble' | 'hard_armor_impact' | 'crit_armor_impact'`.
 * @param forcedRoll Optional deterministic `[0, 1)` roll override for testing.
 * @returns Updated GameState and whether 1 point of structural wear was applied.
 */
export function evaluateOptInCombatWear(
  state: GameState,
  itemEntityId: EntityId,
  trigger: 'fumble' | 'hard_armor_impact' | 'crit_armor_impact',
  forcedRoll?: number
): { readonly state: GameState; readonly triggered: boolean } {
  const cfg = resolveDurabilityConfig(state);
  const chance =
    trigger === 'fumble'
      ? cfg.enableFumbleWearChance
      : trigger === 'hard_armor_impact'
        ? cfg.enableHardArmorWearChance
        : cfg.enableCritArmorWearChance;

  if (chance <= 0) {
    return { state, triggered: false };
  }

  const structural = getComponent(state, itemEntityId, ComponentType.Structural) as StructuralComponent | undefined;
  if (!structural || structural.ruined === true) {
    return { state, triggered: false };
  }

  const roll = forcedRoll !== undefined ? forcedRoll : rng.getUniform();
  if (roll >= chance) {
    return { state, triggered: false };
  }

  const dmgRes = applyStructuralDamage(state, itemEntityId, 1);
  return { state: dmgRes.state, triggered: true };
}

/**
 * Opens a structural door entity if it is neither locked nor spiked/jammed shut.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor opening the door.
 * @param doorEntityId Target door entity ID.
 * @returns `{ state, success }`.
 */
export function openStructuralDoor(
  state: GameState,
  actorId: EntityId,
  doorEntityId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const structural = getComponent(state, doorEntityId, ComponentType.Structural) as StructuralComponent | undefined;
  const lock = getComponent(state, doorEntityId, ComponentType.Lock) as LockComponent | undefined;
  if (!structural) {
    return {
      state: addMessage(state, 'There is no structural door there to open.', MessageLogCategory.System),
      success: false
    };
  }
  if (structural.isOpen === true) {
    return {
      state: addMessage(state, 'The door is already open.', MessageLogCategory.System),
      success: false
    };
  }
  if (lock?.locked === true) {
    return {
      state: addMessage(state, 'The door is locked.', MessageLogCategory.System),
      success: false
    };
  }
  if (structural.jammed === true || structural.spikedByEntityId !== undefined) {
    return {
      state: addMessage(
        state,
        'The door is wedged shut with an iron spike and must be forced open!',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  let nextState = addComponent(state, doorEntityId, {
    ...structural,
    isOpen: true
  });
  const actorName = resolveEntityDisplayName(nextState, actorId, 'Someone');
  nextState = addMessage(nextState, `${actorName} opens the door.`, MessageLogCategory.System);
  return { state: nextState, success: true };
}

/**
 * Closes an open structural door entity.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor closing the door.
 * @param doorEntityId Target door entity ID.
 * @returns `{ state, success }`.
 */
export function closeStructuralDoor(
  state: GameState,
  actorId: EntityId,
  doorEntityId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const structural = getComponent(state, doorEntityId, ComponentType.Structural) as StructuralComponent | undefined;
  if (!structural) {
    return {
      state: addMessage(state, 'There is no structural door there to close.', MessageLogCategory.System),
      success: false
    };
  }
  if (structural.ruined === true) {
    return {
      state: addMessage(state, 'The shattered door can no longer be closed.', MessageLogCategory.System),
      success: false
    };
  }
  if (structural.isOpen !== true) {
    return {
      state: addMessage(state, 'The door is already closed.', MessageLogCategory.System),
      success: false
    };
  }

  let nextState = addComponent(state, doorEntityId, {
    ...structural,
    isOpen: false
  });
  const actorName = resolveEntityDisplayName(nextState, actorId, 'Someone');
  nextState = addMessage(nextState, `${actorName} closes the door.`, MessageLogCategory.System);
  return { state: nextState, success: true };
}

function itemHasDeclarativeTag(state: Readonly<GameState>, itemEntityId: EntityId, tag: string): boolean {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  const itemDef = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
  if (itemDef?.tags.includes(tag)) return true;
  const tagsComp = getComponent(state, itemEntityId, ComponentType.Tags) as TagsComponent | undefined;
  return tagsComp?.tags.includes(tag) ?? false;
}

/**
 * Wedges a closed structural door shut using an `iron_spike` (`'door_spike'` or `'iron_spike'`) and a carried `hammer`,
 * increasing the door's `breakDc` by `+2`, setting `jammed: true`, consuming 1 spike, and emitting a hammer sound ripple.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor driving the spike.
 * @param doorEntityId Target door entity carrying `ComponentType.Structural`.
 * @param spikeItemEntityId Optional explicit spike item entity ID from inventory.
 * @returns `{ state, success }`.
 */
export function spikeDoorWithWedge(
  state: GameState,
  actorId: EntityId,
  doorEntityId: EntityId,
  spikeItemEntityId?: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const structural = getComponent(state, doorEntityId, ComponentType.Structural) as StructuralComponent | undefined;
  if (!structural) {
    return {
      state: addMessage(state, 'You can only drive a wedge into a structural door.', MessageLogCategory.System),
      success: false
    };
  }
  if (structural.isOpen === true) {
    return {
      state: addMessage(state, 'Close the door before wedging it shut.', MessageLogCategory.System),
      success: false
    };
  }

  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  const invItems = inv?.items ?? [];

  const resolvedSpikeId =
    spikeItemEntityId ??
    invItems.find((id) => itemHasDeclarativeTag(state, id, DOOR_SPIKE_ITEM_TAG));

  if (resolvedSpikeId === undefined) {
    return {
      state: addMessage(state, 'You need an iron spike to wedge the door shut.', MessageLogCategory.System),
      success: false
    };
  }

  const hasHammer = invItems.some(
    (id) => itemHasDeclarativeTag(state, id, HAMMER_TOOL_ITEM_TAG) || itemHasDeclarativeTag(state, id, 'hammer')
  );
  if (!hasHammer) {
    return {
      state: addMessage(state, 'You need a hammer to drive the iron spike under the door.', MessageLogCategory.System),
      success: false
    };
  }

  const alreadySpiked = structural.spikedByEntityId !== undefined;
  const nextBreakDc = alreadySpiked ? structural.breakDc : structural.breakDc + SPIKED_DOOR_BREAK_DC_BONUS;

  let nextState = addComponent(state, doorEntityId, {
    ...structural,
    jammed: true,
    spikedByEntityId: actorId,
    breakDc: nextBreakDc
  });

  // Consume 1 charge or remove the spike item
  const spikeComp = getComponent(nextState, resolvedSpikeId, ComponentType.Item) as ItemComponent | undefined;
  const remainingCharges = (spikeComp?.charges ?? 1) - 1;
  if (remainingCharges <= 0) {
    if (inv) {
      nextState = addComponent(nextState, actorId, {
        ...inv,
        items: inv.items.filter((id) => id !== resolvedSpikeId)
      });
    }
    nextState = removeEntity(nextState, resolvedSpikeId);
  } else if (spikeComp) {
    nextState = addComponent(nextState, resolvedSpikeId, {
      ...spikeComp,
      charges: remainingCharges
    });
  }

  const doorPos = getComponent(nextState, doorEntityId, ComponentType.Position) as PositionComponent | undefined;
  if (doorPos) {
    nextState = emitSoundEvent(nextState, doorPos.x, doorPos.y, SOUND_DOOR_SPIKE_DB, actorId, {
      cueLabel: 'metallic hammering'
    }).state;
  }

  const actorName = resolveEntityDisplayName(nextState, actorId, 'Someone');
  nextState = addMessage(
    nextState,
    `${actorName} hammers an iron spike under the door (Break DC increased to ${nextBreakDc}).`,
    MessageLogCategory.System
  );
  return { state: nextState, success: true };
}

/**
 * Probes a tile or trap from up to 2 tiles away (`10` ft) using a `pole_10ft` (`'reach_probe'`),
 * safely revealing or springing any pressure-plate trap at `(targetX, targetY)` without the actor stepping onto the tile.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor wielding or carrying the 10-ft pole.
 * @param targetX Target tile X coordinate.
 * @param targetY Target tile Y coordinate.
 * @returns `{ state, success, triggeredTrapCount }`.
 */
export function probeTrapWithReachTool(
  state: GameState,
  actorId: EntityId,
  targetX: number,
  targetY: number
): {
  readonly state: GameState;
  readonly success: boolean;
  readonly triggeredTrapCount: number;
} {
  const actorPos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  if (actorPos) {
    const dist = Math.max(Math.abs(actorPos.x - targetX), Math.abs(actorPos.y - targetY));
    if (dist > REACH_PROBE_MAX_RANGE_TILES) {
      return {
        state: addMessage(state, 'That tile is beyond the 10-foot reach of your pole.', MessageLogCategory.System),
        success: false,
        triggeredTrapCount: 0
      };
    }
  }

  const entitiesAt = state.spatialIndex.get(`${targetX},${targetY}`) ?? [];
  let nextState = state;
  let triggeredTrapCount = 0;

  for (const eid of entitiesAt) {
    const trap = getComponent(nextState, eid, ComponentType.Trap) as TrapComponent | undefined;
    if (trap && !trap.triggered) {
      nextState = addComponent(nextState, eid, {
        ...trap,
        triggered: true
      });
      triggeredTrapCount++;
    }
  }

  if (triggeredTrapCount > 0) {
    nextState = emitSoundEvent(nextState, targetX, targetY, SOUND_DB_DOOR_KICK, actorId, {
      cueLabel: 'a sprung trap mechanism'
    }).state;
    nextState = addMessage(
      nextState,
      `You tap (${targetX}, ${targetY}) with the 10-foot pole and safely spring ${triggeredTrapCount} trap mechanism(s) from a distance!`,
      MessageLogCategory.System
    );
  } else {
    nextState = addMessage(
      nextState,
      `You tap (${targetX}, ${targetY}) with the 10-foot pole. The floor feels solid.`,
      MessageLogCategory.System
    );
  }

  return {
    state: nextState,
    success: true,
    triggeredTrapCount
  };
}
