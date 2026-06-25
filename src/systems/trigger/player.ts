import type { GameState, EntityId } from '../../types/game-state.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { ConditionPredicate, ConsequenceAction } from '../../types/trigger.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type {
  InventoryComponent,
  ItemComponent,
  PositionComponent,
  CoatingComponent
} from '../../types/components.types.ts';
import { getComponent, addComponent, removeEntity } from '../../core/ecs.ts';
import { applyItemEffect } from '../effects.system.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';

/**
 * Condition evaluators specific to the player entity and item usage.
 */
export const playerConditions = {
  is_player: (
    state: Readonly<GameState>,
    event: GameEvent,
    _condition: Extract<ConditionPredicate, { type: 'is_player' }>
  ): boolean => {
    return (
      'entityId' in event &&
      getComponent(state, (event as unknown as { entityId: EntityId }).entityId, ComponentType.Player) !== undefined
    );
  },
  has_item: (
    state: Readonly<GameState>,
    _event: GameEvent,
    condition: Extract<ConditionPredicate, { type: 'has_item' }>
  ): boolean => {
    const entityId = condition._playerEntityId ?? condition.entityId;
    if (entityId === undefined) return false;

    const inventory = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
    if (!inventory || inventory.items.length === 0) return false;

    let count = 0;
    for (const itemEntityId of inventory.items) {
      const item = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
      if (item?.itemId === condition.itemId) {
        count++;
        if (count >= (condition.amount ?? 1)) return true;
      }
    }
    return false;
  }
} satisfies Partial<
  Record<ConditionPredicate['type'], (state: Readonly<GameState>, event: GameEvent, condition: never) => boolean>
>;

/**
 * Consequence appliers specific to the player entity and item usage.
 */
export const playerConsequences = {
  apply_item_effect: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'apply_item_effect' }>
  ): GameState => {
    if (event.type !== GameEventType.ReactionResolved) return state;
    const rxEvent = event as unknown as { sourceId: EntityId; target: unknown };
    const sourceId = rxEvent.sourceId;

    const targetPayload = rxEvent.target as { type: string; itemEntityId?: EntityId } | undefined;
    const itemEntityId = targetPayload?.itemEntityId;

    if (itemEntityId === undefined) return state;

    const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) return state;

    const def = state.campaign.items[itemComp.itemId];
    if (!def?.consumable) return state;

    let nextState = state;
    const isIdentified = state.identifiedItems.has(itemComp.itemId);
    if (!isIdentified) {
      const newIdentifiedSet = new Set(state.identifiedItems);
      newIdentifiedSet.add(itemComp.itemId);
      nextState = { ...state, identifiedItems: newIdentifiedSet };
    }

    const itemName = nextState.campaign.items[itemComp.itemId]?.name ?? itemComp.itemId;
    const effectTargetId =
      consequence.targetId === 'source'
        ? sourceId
        : consequence.targetId
          ? (parseInt(consequence.targetId) as EntityId)
          : sourceId;

    return applyItemEffect(nextState, effectTargetId, def.consumable.effectId, itemName);
  },

  consume_item: (
    state: GameState,
    event: GameEvent,
    _consequence: Extract<ConsequenceAction, { type: 'consume_item' }>
  ): GameState => {
    if (event.type !== GameEventType.ReactionResolved) return state;
    const rxEvent = event as unknown as { sourceId: EntityId; target: unknown };
    const sourceId = rxEvent.sourceId;

    const targetPayload = rxEvent.target as { type: string; itemEntityId?: EntityId } | undefined;
    const itemEntityId = targetPayload?.itemEntityId;

    if (itemEntityId === undefined) return state;

    const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) return state;

    let nextState = state;
    // Decrement charges or remove
    const remainingCharges = (itemComp.charges ?? 1) - 1;

    if (remainingCharges <= 0) {
      const inventory = getComponent(nextState, sourceId, ComponentType.Inventory) as InventoryComponent | undefined;
      if (inventory) {
        const nextInventory = {
          ...inventory,
          items: inventory.items.filter((id) => id !== itemEntityId)
        };
        nextState = addComponent(nextState, sourceId, nextInventory);
      }
      nextState = removeEntity(nextState, itemEntityId);
    } else {
      const nextItemComp = { ...itemComp, charges: remainingCharges };
      nextState = addComponent(nextState, itemEntityId, nextItemComp);
    }

    return {
      ...nextState,
      events: [...nextState.events, { type: GameEventType.ItemUsed, entityId: sourceId, itemId: itemEntityId }]
    };
  },

  spill_inventory: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'spill_inventory' }>
  ): GameState => {
    let eId: EntityId | undefined;
    if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
      eId = (event as unknown as { entityId: EntityId }).entityId;
    } else if (consequence.targetId) {
      eId = parseInt(consequence.targetId) as EntityId;
    } else {
      // default to target of reaction
      if (event.type === GameEventType.ReactionResolved) {
        const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
        if (targetPayload.type === 'entity') {
          eId = targetPayload.entityId;
        }
      }
    }

    if (eId === undefined) return state;

    const inventory = getComponent(state, eId, ComponentType.Inventory) as InventoryComponent | undefined;
    const pos = getComponent(state, eId, ComponentType.Position) as PositionComponent | undefined;

    if (!inventory || !pos || inventory.items.length === 0) return state;

    let nextState = state;
    for (const itemId of inventory.items) {
      // give the item a PositionComponent to drop it
      nextState = addComponent(nextState, itemId, pos);
    }

    // clear the inventory
    return addComponent(nextState, eId, { ...inventory, items: [] });
  },

  apply_coating: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: 'apply_coating' }>
  ): GameState => {
    let eId: EntityId | undefined;
    if (consequence.targetId) {
      eId = parseInt(consequence.targetId) as EntityId;
    } else if (event.type === GameEventType.ReactionResolved) {
      const targetPayload = (
        event as unknown as { target: { type: string; entityId?: EntityId; itemEntityId?: EntityId } }
      ).target;
      if (targetPayload.type === 'entity') {
        eId = targetPayload.entityId;
      } else if (targetPayload.type === 'item') {
        eId = targetPayload.itemEntityId;
      }
    }

    if (eId === undefined) return state;

    const newCoating: CoatingComponent = {
      type: ComponentType.Coating,
      statusId: consequence.statusId,
      charges: consequence.charges,
      duration: consequence.duration ?? 10
    };

    const nextState = addComponent(state, eId, newCoating);

    const itemName = getComponent(nextState, eId, ComponentType.Renderable)?.glyph ?? 'The item';
    return addMessage(nextState, `${itemName} is now coated!`, MessageLogCategory.System);
  }
} satisfies Partial<
  Record<ConsequenceAction['type'], (state: GameState, event: GameEvent, consequence: never) => GameState>
>;
