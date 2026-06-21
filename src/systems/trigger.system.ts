import * as ROT from 'rot-js';
import type { Verb } from '../constants/verbs.constants.ts';
import { addComponent, getComponent, removeEntity } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import type { GameEvent } from '../types/events.types.ts';
import { GameEventType } from '../types/events.types.ts';
import { type EntityId, type GameState } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import type { ApplyIntentTarget } from '../types/intents/interaction.intents.ts';
import { applyItemEffect } from './effects.system.ts';
import { processChangeAreaIntent } from './map.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { completeQuest, grantQuest } from './quest.system.ts';
import { applyStatusEffect } from './status-effect.system.ts';
import { processSayIntent } from '../actions/say.action.ts';
import { assertNever } from '../utils/assert.ts';

/**
 * Checks if the entity stepped on any physical traps.
 * Marks them triggered, reveals them, and emits a TrapTriggeredEvent.
 */
export function processTraps(state: GameState, entityId: EntityId): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return state;

  const targetKey = `${pos.x},${pos.y}`;
  const entitiesAtNewTarget = state.spatialIndex.get(targetKey) || [];

  let nextState = state;

  for (const id of entitiesAtNewTarget) {
    if (id === entityId) continue;

    const trap = getComponent(nextState, id, ComponentType.Trap) as TrapComponent | undefined;
    if (trap && !trap.triggered) {
      // Trigger it!
      const nextTrap = { ...trap, triggered: true };
      nextState = addComponent(nextState, id, nextTrap);

      // Add a RenderableComponent so the trap becomes visible (or update existing)
      const renderCmp = getComponent(nextState, id, ComponentType.Renderable);
      if (!renderCmp) {
        nextState = addComponent(nextState, id, {
          type: ComponentType.Renderable,
          glyph: '^',
          fg: '#e74c3c',
          bg: 'transparent'
        });
      }

      const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
      const targetName = isPlayer ? 'You' : 'Something';
      nextState = addMessage(nextState, `${targetName} triggered a trap!`, MessageLogCategory.System);

      // Push TrapTriggeredEvent instead of hardcoded damage
      nextState = {
        ...nextState,
        events: [
          ...nextState.events,
          {
            type: GameEventType.TrapTriggered,
            entityId: entityId,
            triggerId: trap.triggerId
          }
        ]
      };
    }
  }

  return nextState;
}

/**
 * Evaluates a single condition predicate against the game state and event.
 */
export function evaluateCondition(
  state: Readonly<GameState>,
  event: GameEvent,
  condition: ConditionPredicate
): boolean {
  switch (condition.type) {
    case 'is_player':
      return (
        'entityId' in event &&
        getComponent(state, (event as unknown as { entityId: EntityId }).entityId, ComponentType.Player) !== undefined
      );

    case 'has_agreement': {
      if (event.type !== GameEventType.EntityDied) return false;
      const diedEvent = event as EntityDiedEvent;
      return getComponent(state, diedEvent.victimId, ComponentType.Agreement) !== undefined;
    }

    case 'faction_standing': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return false;

      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      const standing = memory?.factionStandings[condition.target] ?? 0;

      const operator = condition.operator;
      const value = condition.value;

      if (operator === '>=') return standing >= value;
      if (operator === '<=') return standing <= value;
      return standing === value;
    }

    case 'has_fact': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return false;

      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      return memory?.facts.includes(condition.target) ?? false;
    }

    case 'not_has_fact': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return true;

      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      return !(memory?.facts.includes(condition.target) ?? false);
    }

    case 'quest_status': {
      const playerEntityId = condition._playerEntityId ?? condition.entityId;
      if (playerEntityId === undefined) return false;

      const questLog = getComponent(state, playerEntityId, ComponentType.QuestLog) as QuestLogComponent | undefined;
      const qStatus = questLog?.quests[condition.target]?.status;
      const numStatus = qStatus === 'active' ? 0 : qStatus === 'completed' ? 1 : qStatus === 'failed' ? 2 : -1;

      const operator = condition.operator;
      const value = condition.value;

      if (operator === '>=') return numStatus >= value;
      if (operator === '<=') return numStatus <= value;
      return numStatus === value;
    }

    case 'has_item': {
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

    case 'personality_facet': {
      const entityId = condition._npcEntityId ?? condition.entityId;
      if (entityId === undefined) return false;
      const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      const facetVal = memory?.facets?.[condition.facet] ?? 0;
      if (condition.operator === '>=') return facetVal >= condition.value;
      if (condition.operator === '<=') return facetVal <= condition.value;
      return facetVal === condition.value;
    }

    case 'stress_threshold': {
      const entityId = condition._npcEntityId ?? condition.entityId;
      if (entityId === undefined) return false;
      const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      const stress = memory?.stress ?? 0;
      if (condition.operator === '>=') return stress >= condition.value;
      if (condition.operator === '<=') return stress <= condition.value;
      return stress === condition.value;
    }

    case 'has_memory': {
      const entityId = condition._npcEntityId ?? condition.entityId;
      if (entityId === undefined) return false;
      const chronicle = getComponent(state, entityId, ComponentType.Chronicle);
      if (!chronicle) return false;
      return chronicle.coreMemories.some((m) => m.includes(condition.target));
    }

    case 'has_grudge': {
      const entityId = condition._npcEntityId ?? condition.entityId;
      if (entityId === undefined) return false;
      const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      return memory?.grudges?.includes(condition.targetId) ?? false;
    }

    case 'pis': {
      const entityId = condition._npcEntityId ?? condition.entityId;
      if (entityId === undefined) return false;
      const chronicle = getComponent(state, entityId, ComponentType.Chronicle);
      const pisVal = chronicle?.pis ?? 0;
      if (condition.operator === '>=') return pisVal >= condition.value;
      if (condition.operator === '<=') return pisVal <= condition.value;
      return pisVal === condition.value;
    }

    case 'has_knowledge': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return false;
      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      return memory?.knowledge?.[condition.knowledgeId] !== undefined;
    }

    case 'interaction_count': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return false;
      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      if (!memory) return false;
      let count = 0;
      switch (condition.interactionType) {
        case 'talk':
          count = memory.timesTalked ?? 0;
          break;
        case 'trade':
          count = memory.timesTraded ?? 0;
          break;
        case 'intimidate':
          count = memory.timesIntimidated ?? 0;
          break;
        case 'help':
          count = memory.timesHelped ?? 0;
          break;
        case 'betray':
          count = memory.timesBetrayed ?? 0;
          break;
        default:
          return assertNever(condition.interactionType);
      }
      if (condition.operator === '>=') return count >= condition.value;
      if (condition.operator === '<=') return count <= condition.value;
      return count === condition.value;
    }

    case 'patience_below': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return false;
      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      if (!memory) return false;
      const threshold = memory.patienceThreshold ?? 5;
      const remaining = threshold - (memory.timesTalked ?? 0);
      return remaining < condition.value;
    }

    case 'is_annoyed': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return false;
      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      return (memory?.annoyedDuration ?? 0) > 0;
    }

    case 'is_grateful': {
      const memoryOwnerId = condition._npcEntityId ?? condition.entityId;
      if (memoryOwnerId === undefined) return false;
      const memory = getComponent(state, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      return (memory?.gratefulDuration ?? 0) > 0;
    }

    default:
      return assertNever(condition);
  }
}

import { createEntity, spawnEntity, spawnItem } from '../core/ecs.ts';
import type {
  AgreementComponent,
  ClueComponent,
  CoatingComponent,
  DamageComponent,
  DamageInstance,
  FactionComponent,
  InteractableComponent,
  InventoryComponent,
  ItemComponent,
  LockComponent,
  MemoryComponent,
  PortalComponent,
  PositionComponent,
  QuestLogComponent,
  RenderableComponent,
  TagsComponent,
  TrapComponent
} from '../types/components.types.ts';
import { toItemInstanceId } from '../types/components.types.ts';
import type { DebugTriggerTraceEvent, EntityDiedEvent, TrapTriggeredEvent } from '../types/events.types.ts';
import type { ConditionPredicate, ConsequenceAction, RunScriptConsequenceFn } from '../types/trigger.types.ts';

/**
 * Applies a single consequence to the game state.
 */
export function applyConsequence(state: GameState, event: GameEvent, consequence: ConsequenceAction): GameState {
  let nextState = state;

  switch (consequence.type) {
    case 'remove_entity': {
      let eId: EntityId | undefined;
      if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
        eId = (event as unknown as { entityId: EntityId }).entityId;
      } else if (consequence.targetId) {
        eId = parseInt(consequence.targetId) as EntityId;
      } else {
        const targetPayload = (
          event as unknown as { target?: { type: string; entityId?: EntityId; itemEntityId?: EntityId } }
        ).target;
        if (targetPayload) {
          if (targetPayload.type === 'entity') eId = targetPayload.entityId;
          else if (targetPayload.type === 'item') eId = targetPayload.itemEntityId;
        }
      }

      if (eId !== undefined) {
        nextState = removeEntity(nextState, eId);
      }
      break;
    }

    case 'run_script': {
      const code = consequence.scriptCode;
      if (!code) break;
      try {
        const sandboxFn = new Function('context', code) as RunScriptConsequenceFn;
        const context = { event, state, rng: ROT.RNG };
        const dynamicConsequences = sandboxFn(code, context);
        if (dynamicConsequences && Array.isArray(dynamicConsequences)) {
          for (const dynCons of dynamicConsequences) {
            nextState = applyConsequence(nextState, event, dynCons);
          }
        }
      } catch (e) {
        console.error('Failed to run trigger script:', e);
      }
      break;
    }

    case 'damage': {
      const targetId = consequence.targetId;
      const amount = consequence.amount;

      let eId: EntityId | undefined;
      if (targetId === 'event.entityId' && 'entityId' in event) {
        eId = (event as unknown as { entityId: EntityId }).entityId;
      }

      if (eId === undefined || amount <= 0) break;

      const fighter = getComponent(nextState, eId, ComponentType.Fighter);
      if (!fighter) break;

      const existingDamageComp = getComponent(nextState, eId, ComponentType.Damage) as DamageComponent | undefined;

      const damageInstance: DamageInstance = {
        amount,
        tags: ['trigger', 'physical']
      };

      if (existingDamageComp) {
        const newDamageComp = {
          ...existingDamageComp,
          instances: [...existingDamageComp.instances, damageInstance]
        };
        nextState = addComponent(nextState, eId, newDamageComp);
      } else {
        const newDamageComp: DamageComponent = {
          type: ComponentType.Damage,
          instances: [damageInstance]
        };
        nextState = addComponent(nextState, eId, newDamageComp);
      }
      break;
    }

    case 'spawn_clue': {
      if (event.type !== GameEventType.EntityDied) break;
      const diedEvent = event as EntityDiedEvent;
      const victimId = diedEvent.victimId;

      const agreement = getComponent(nextState, victimId, ComponentType.Agreement) as AgreementComponent | undefined;
      const pos = getComponent(nextState, victimId, ComponentType.Position) as PositionComponent | undefined;
      const renderable = getComponent(nextState, victimId, ComponentType.Renderable);
      const name = renderable ? renderable.glyph : 'Someone';

      if (!agreement || !pos) break;

      const agreementDef = nextState.campaign.agreements[agreement.agreementId];
      if (!agreementDef || agreementDef.clueTemplates.length === 0) break;

      const clueTemplateId = agreementDef.clueTemplates[0]!;
      let clueEntity: EntityId;
      [nextState, clueEntity] = createEntity(nextState);

      nextState = addComponent(nextState, clueEntity, pos);
      nextState = addComponent(nextState, clueEntity, {
        type: ComponentType.Renderable,
        glyph: '?',
        fg: '#ffff00',
        bg: 'transparent'
      });

      const instanceId = toItemInstanceId(`clue_item_${nextState.nextItemInstanceId}`);
      nextState = { ...nextState, nextItemInstanceId: nextState.nextItemInstanceId + 1 };

      nextState = addComponent(nextState, clueEntity, {
        type: ComponentType.Item,
        itemId: 'clue_item',
        instanceId
      });
      nextState = addComponent(nextState, clueEntity, {
        type: ComponentType.Clue,
        clueId: clueTemplateId,
        text: `Incriminating evidence regarding a ${agreementDef.task}...`,
        implicatesEntityId: agreement.mastermindId
      } as ClueComponent);

      const msg = consequence.message ?? 'dropped something suspicious!';
      nextState = addMessage(nextState, `${name} ${msg}`, MessageLogCategory.System);
      break;
    }

    case 'grant_quest': {
      const questId = consequence.questId ?? consequence.targetId;
      const playerId =
        consequence._playerEntityId ??
        consequence.entityId ??
        ('entityId' in event ? ((event as unknown as Record<string, unknown>).entityId as EntityId) : undefined);

      if (playerId !== undefined && questId) {
        nextState = grantQuest(nextState, playerId, questId);
      }
      break;
    }

    case 'complete_quest': {
      const questId = consequence.questId ?? consequence.targetId;
      const playerId =
        consequence._playerEntityId ??
        consequence.entityId ??
        ('entityId' in event ? ((event as unknown as Record<string, unknown>).entityId as EntityId) : undefined);

      if (playerId !== undefined && questId) {
        nextState = completeQuest(nextState, playerId, questId);
      }
      break;
    }

    case 'open_barter': {
      // TODO(Milestone 47): Integrate actual trade.ui.ts and ShopComponent logic
      nextState = addMessage(nextState, '[Barter Menu Placeholder]', MessageLogCategory.System);
      break;
    }

    case 'trigger_service': {
      // TODO(Milestone 47): Integrate spell services and ServiceComponent logic
      nextState = addMessage(nextState, `[Service: ${consequence.serviceId} Placeholder]`, MessageLogCategory.System);
      break;
    }

    case 'modify_standing': {
      const amount = consequence.amount;
      const factionId = consequence.factionId;
      const memoryOwnerId = consequence._npcEntityId ?? consequence.entityId;

      if (memoryOwnerId === undefined || !factionId || !amount) break;

      const memory = getComponent(nextState, memoryOwnerId, ComponentType.Memory) as MemoryComponent | undefined;

      if (!memory) break;

      const newStanding = (memory.factionStandings[factionId] ?? 0) + amount;
      const newMemory = { ...memory, factionStandings: { ...memory.factionStandings, [factionId]: newStanding } };

      nextState = addComponent(nextState, memoryOwnerId, newMemory);
      break;
    }

    case 'emit_event': {
      const eventType = consequence.eventType;
      const payload = consequence.payload;

      if (!eventType) break;

      nextState = {
        ...nextState,
        events: [
          ...nextState.events,
          {
            type: eventType as GameEventType,
            ...payload
          } as unknown as GameEvent
        ]
      };
      break;
    }

    case 'change_area': {
      let targetAreaId = consequence.targetAreaId;
      let targetX = consequence.targetX;
      let targetY = consequence.targetY;

      let eId: EntityId | undefined;
      if ('entityId' in event) {
        eId = (event as unknown as { entityId: EntityId }).entityId;
      }

      if (!targetAreaId && event.type === GameEventType.ReactionResolved) {
        const rxEvent = event as unknown as { target: unknown };
        const targetPayload = rxEvent.target as { type: string; entityId?: EntityId } | undefined;
        if (targetPayload?.type === 'entity' && targetPayload.entityId !== undefined) {
          const portalComp = getComponent(nextState, targetPayload.entityId, ComponentType.Portal) as
            | PortalComponent
            | undefined;
          if (portalComp) {
            targetAreaId = portalComp.targetAreaId;
            targetX = portalComp.targetX;
            targetY = portalComp.targetY;
          }
        }
      }

      if (eId !== undefined && targetAreaId) {
        const result = processChangeAreaIntent(nextState, {
          type: IntentType.ChangeArea,
          entityId: eId,
          targetAreaId,
          targetX,
          targetY
        });
        if (result.success) {
          nextState = result.state;
        }
      }
      break;
    }

    case 'apply_item_effect': {
      // Typically used from ReactionResolvedEvent when an item is applied
      if (event.type !== GameEventType.ReactionResolved) break;
      const rxEvent = event as unknown as { sourceId: EntityId; target: unknown };
      const sourceId = rxEvent.sourceId;

      const targetPayload = rxEvent.target as { type: string; itemEntityId?: EntityId } | undefined;
      const itemEntityId = targetPayload?.itemEntityId;

      if (itemEntityId === undefined) break;

      const itemComp = getComponent(nextState, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
      if (!itemComp) break;

      const def = nextState.campaign.items[itemComp.itemId];
      if (!def?.consumable) break;

      const isIdentified = nextState.identifiedItems.has(itemComp.itemId);
      if (!isIdentified) {
        const newIdentifiedSet = new Set(nextState.identifiedItems);
        newIdentifiedSet.add(itemComp.itemId);
        nextState = { ...nextState, identifiedItems: newIdentifiedSet };
      }

      const itemName = nextState.campaign.items[itemComp.itemId]?.name ?? itemComp.itemId;
      const effectTargetId =
        consequence.targetId === 'source'
          ? sourceId
          : consequence.targetId
            ? (parseInt(consequence.targetId) as EntityId)
            : sourceId;

      nextState = applyItemEffect(nextState, effectTargetId, def.consumable.effectId, itemName);
      break;
    }

    case 'consume_item': {
      if (event.type !== GameEventType.ReactionResolved) break;
      const rxEvent = event as unknown as { sourceId: EntityId; target: unknown };
      const sourceId = rxEvent.sourceId;

      const targetPayload = rxEvent.target as { type: string; itemEntityId?: EntityId } | undefined;
      const itemEntityId = targetPayload?.itemEntityId;

      if (itemEntityId === undefined) break;

      const itemComp = getComponent(nextState, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
      if (!itemComp) break;

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

      nextState = {
        ...nextState,
        events: [...nextState.events, { type: GameEventType.ItemUsed, entityId: sourceId, itemId: itemEntityId }]
      };
      break;
    }

    case 'spill_inventory': {
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

      if (eId === undefined) break;

      const inventory = getComponent(nextState, eId, ComponentType.Inventory) as InventoryComponent | undefined;
      const pos = getComponent(nextState, eId, ComponentType.Position) as PositionComponent | undefined;

      if (!inventory || !pos || inventory.items.length === 0) break;

      for (const itemId of inventory.items) {
        // give the item a PositionComponent to drop it
        nextState = addComponent(nextState, itemId, pos);
      }

      // clear the inventory
      nextState = addComponent(nextState, eId, { ...inventory, items: [] });
      break;
    }

    case 'modify_tags': {
      let eId: EntityId | undefined;
      if (event.type === GameEventType.ReactionResolved) {
        const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
        if (targetPayload.type === 'entity') {
          eId = targetPayload.entityId;
        }
      }
      if (eId === undefined) break;

      const tagsCmp = getComponent(nextState, eId, ComponentType.Tags) as TagsComponent | undefined;
      let newTags = [...(tagsCmp?.tags ?? [])];

      let requiresFovUpdate = false;
      if (consequence.remove) {
        if (consequence.remove.includes('opaque')) requiresFovUpdate = true;
        newTags = newTags.filter((t) => !consequence.remove!.includes(t));
      }
      if (consequence.add) {
        if (consequence.add.includes('opaque')) requiresFovUpdate = true;
        for (const t of consequence.add) {
          if (!newTags.includes(t)) newTags.push(t);
        }
      }

      if (tagsCmp) {
        nextState = addComponent(nextState, eId, { ...tagsCmp, tags: newTags });
      } else {
        nextState = addComponent(nextState, eId, { type: ComponentType.Tags, tags: newTags });
      }

      if (requiresFovUpdate) {
        nextState = { ...nextState, fovNeedsUpdate: true };
      }
      break;
    }

    case 'change_glyph': {
      let eId: EntityId | undefined;
      if (event.type === GameEventType.ReactionResolved) {
        const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
        if (targetPayload.type === 'entity') {
          eId = targetPayload.entityId;
        }
      }
      if (eId === undefined) break;

      const rendCmp = getComponent(nextState, eId, ComponentType.Renderable) as RenderableComponent | undefined;
      if (rendCmp) {
        nextState = addComponent(nextState, eId, { ...rendCmp, glyph: consequence.glyph });
      }
      break;
    }

    case 'set_lock_state': {
      let eId: EntityId | undefined;
      if (event.type === GameEventType.ReactionResolved) {
        const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
        if (targetPayload.type === 'entity') {
          eId = targetPayload.entityId;
        }
      }
      if (eId === undefined) break;

      const lockCmp = getComponent(nextState, eId, ComponentType.Lock) as LockComponent | undefined;
      if (lockCmp) {
        nextState = addComponent(nextState, eId, { ...lockCmp, locked: consequence.locked });
      }
      break;
    }

    case 'change_intents': {
      let eId: EntityId | undefined;
      if (event.type === GameEventType.ReactionResolved) {
        const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
        if (targetPayload.type === 'entity') {
          eId = targetPayload.entityId;
        }
      }
      if (eId === undefined) break;

      const interactable = getComponent(nextState, eId, ComponentType.Interactable) as
        | InteractableComponent
        | undefined;
      if (interactable) {
        const newIntents = consequence.intents.map(
          (v) =>
            ({
              type: IntentType.Apply,
              entityId: -1 as unknown as EntityId,
              verb: v as Verb,
              target: { type: 'self' } as const
            }) as Intent
        );
        nextState = addComponent(nextState, eId, { ...interactable, intents: newIntents });
      }
      break;
    }

    case 'apply_coating': {
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

      if (eId === undefined) break;

      const newCoating: CoatingComponent = {
        type: ComponentType.Coating,
        statusId: consequence.statusId,
        charges: consequence.charges,
        duration: consequence.duration ?? 10
      };

      nextState = addComponent(nextState, eId, newCoating);

      const itemName = getComponent(nextState, eId, ComponentType.Renderable)?.glyph ?? 'The item';
      nextState = addMessage(nextState, `${itemName} is now coated!`, MessageLogCategory.System);
      break;
    }

    case 'set_fact': {
      const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
      if (memOwnerId === undefined) break;

      const memory = getComponent(nextState, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      if (memory && !memory.facts.includes(consequence.target)) {
        nextState = addComponent(nextState, memOwnerId, {
          ...memory,
          facts: [...memory.facts, consequence.target]
        });
      }
      break;
    }

    case 'change_faction': {
      let eId: EntityId | undefined;
      if (consequence.targetId) {
        eId = parseInt(consequence.targetId) as EntityId;
      } else if (event.type === GameEventType.ReactionResolved) {
        const targetPayload = (event as unknown as { target: { type: string; entityId?: EntityId } }).target;
        if (targetPayload.type === 'entity') {
          eId = targetPayload.entityId;
        }
      }

      if (eId === undefined) break;

      const faction = getComponent(nextState, eId, ComponentType.Faction) as FactionComponent | undefined;
      if (faction) {
        nextState = addComponent(nextState, eId, {
          ...faction,
          factionId: consequence.factionId
        });
      }
      break;
    }

    case 'spawn_entity': {
      const templateId = consequence.entityTemplateId;
      if (!templateId) break;

      let pos: PositionComponent | undefined;
      let targetId: EntityId | undefined;

      if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
        targetId = (event as unknown as { entityId: EntityId }).entityId;
      } else if (consequence.targetId) {
        targetId = parseInt(consequence.targetId) as EntityId;
      } else {
        if (event.type === GameEventType.ReactionResolved) {
          const rxEvent = event as unknown as { target: ApplyIntentTarget };
          if (rxEvent.target.type === 'entity') {
            targetId = rxEvent.target.entityId;
          } else if (rxEvent.target.type === 'item') {
            targetId = rxEvent.target.itemEntityId;
          } else if (rxEvent.target.type === 'tile') {
            pos = { type: ComponentType.Position, x: rxEvent.target.x, y: rxEvent.target.y };
          }
        }
      }

      if (targetId !== undefined && !pos) {
        pos = getComponent(nextState, targetId, ComponentType.Position) as PositionComponent | undefined;
      }

      if (pos) {
        if (nextState.campaign.items[templateId]) {
          const [stateAfterSpawn] = spawnItem(nextState, templateId, pos.x, pos.y);
          nextState = stateAfterSpawn;
        } else if (nextState.campaign.entities[templateId]) {
          const [stateAfterSpawn] = spawnEntity(nextState, templateId, pos.x, pos.y);
          nextState = stateAfterSpawn;
        } else {
          console.warn(`Template ${templateId} not found in campaign items/entities during spawn_entity consequence.`);
        }
      }
      break;
    }

    case 'damage_area': {
      const radius = consequence.radius ?? 1;
      const amount = consequence.amount ?? 0;
      if (amount <= 0) break;

      let centerPos: PositionComponent | undefined;
      let targetId: EntityId | undefined;

      if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
        targetId = (event as unknown as { entityId: EntityId }).entityId;
      } else if (consequence.targetId) {
        targetId = parseInt(consequence.targetId) as EntityId;
      } else {
        if (event.type === GameEventType.ReactionResolved) {
          const rxEvent = event as unknown as { target: ApplyIntentTarget };
          if (rxEvent.target.type === 'entity') {
            targetId = rxEvent.target.entityId;
          } else if (rxEvent.target.type === 'item') {
            targetId = rxEvent.target.itemEntityId;
          } else if (rxEvent.target.type === 'tile') {
            centerPos = { type: ComponentType.Position, x: rxEvent.target.x, y: rxEvent.target.y };
          }
        }
      }

      if (targetId !== undefined && !centerPos) {
        centerPos = getComponent(nextState, targetId, ComponentType.Position) as PositionComponent | undefined;
      }

      if (!centerPos) break;

      for (const id of nextState.entities) {
        const fighter = getComponent(nextState, id, ComponentType.Fighter);
        const pos = getComponent(nextState, id, ComponentType.Position);
        if (!fighter || !pos) continue;

        const dist = Math.sqrt(Math.pow(pos.x - centerPos.x, 2) + Math.pow(pos.y - centerPos.y, 2));
        if (dist <= radius) {
          const existingDamageComp = getComponent(nextState, id, ComponentType.Damage) as DamageComponent | undefined;
          const damageInstance: DamageInstance = {
            amount,
            tags: consequence.tags ?? ['trigger', 'area']
          };

          if (existingDamageComp) {
            const newDamageComp = {
              ...existingDamageComp,
              instances: [...existingDamageComp.instances, damageInstance]
            };
            nextState = addComponent(nextState, id, newDamageComp);
          } else {
            const newDamageComp: DamageComponent = {
              type: ComponentType.Damage,
              instances: [damageInstance]
            };
            nextState = addComponent(nextState, id, newDamageComp);
          }
        }
      }
      break;
    }

    case 'apply_status': {
      if (!consequence.statusId) break;

      let eId: EntityId | undefined;
      if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
        eId = (event as unknown as { entityId: EntityId }).entityId;
      } else if (consequence.targetId) {
        eId = parseInt(consequence.targetId) as EntityId;
      } else {
        if (event.type === GameEventType.ReactionResolved) {
          const rxEvent = event as unknown as { target: ApplyIntentTarget };
          if (rxEvent.target.type === 'entity') {
            eId = rxEvent.target.entityId;
          } else if (rxEvent.target.type === 'item') {
            eId = rxEvent.target.itemEntityId;
          }
        }
      }

      if (eId !== undefined) {
        nextState = applyStatusEffect(nextState, eId, consequence.statusId, consequence.duration ?? 10);
      }
      break;
    }

    case 'force_say': {
      let eId: EntityId | undefined;
      if (consequence.targetId === 'event.entityId' && 'entityId' in event) {
        eId = (event as unknown as { entityId: EntityId }).entityId;
      } else if (consequence.targetId) {
        eId = parseInt(consequence.targetId) as EntityId;
      } else {
        if (event.type === GameEventType.ReactionResolved) {
          const rxEvent = event as unknown as { target: ApplyIntentTarget };
          if (rxEvent.target.type === 'entity') {
            eId = rxEvent.target.entityId;
          }
        }
      }

      if (eId !== undefined) {
        const sayResult = processSayIntent(nextState, {
          type: IntentType.Say,
          entityId: eId,
          message: consequence.message
        });
        nextState = sayResult.state;
        if (sayResult.events && sayResult.events.length > 0) {
          nextState = { ...nextState, events: [...nextState.events, ...sayResult.events] };
        }
      }
      break;
    }

    case 'record_interaction': {
      const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
      if (memOwnerId === undefined) break;
      const memory = getComponent(nextState, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      if (memory) {
        const nextMemory: MemoryComponent = {
          ...memory,
          timesTalked: consequence.interactionType === 'talk' ? (memory.timesTalked ?? 0) + 1 : memory.timesTalked,
          timesTraded: consequence.interactionType === 'trade' ? (memory.timesTraded ?? 0) + 1 : memory.timesTraded,
          timesIntimidated:
            consequence.interactionType === 'intimidate' ? (memory.timesIntimidated ?? 0) + 1 : memory.timesIntimidated,
          timesHelped: consequence.interactionType === 'help' ? (memory.timesHelped ?? 0) + 1 : memory.timesHelped,
          timesBetrayed:
            consequence.interactionType === 'betray' ? (memory.timesBetrayed ?? 0) + 1 : memory.timesBetrayed
        };
        nextState = addComponent(nextState, memOwnerId, nextMemory);
      }
      break;
    }

    case 'set_patience': {
      const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
      if (memOwnerId === undefined) break;
      const memory = getComponent(nextState, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      if (memory) {
        nextState = addComponent(nextState, memOwnerId, { ...memory, patienceThreshold: consequence.value });
      }
      break;
    }

    case 'modify_knowledge': {
      const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
      if (memOwnerId === undefined) break;
      const memory = getComponent(nextState, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      if (memory) {
        const nextKnowledge = { ...(memory.knowledge ?? {}) };
        if (consequence.action === 'add' && consequence.knowledgeType && consequence.description) {
          nextKnowledge[consequence.knowledgeId] = {
            id: consequence.knowledgeId,
            type: consequence.knowledgeType,
            description: consequence.description,
            tags: consequence.tags ?? []
          };
        } else if (consequence.action === 'remove') {
          delete nextKnowledge[consequence.knowledgeId];
        }
        nextState = addComponent(nextState, memOwnerId, { ...memory, knowledge: nextKnowledge });
      }
      break;
    }

    case 'set_social_state': {
      const memOwnerId = consequence._npcEntityId ?? consequence.entityId;
      if (memOwnerId === undefined) break;
      const memory = getComponent(nextState, memOwnerId, ComponentType.Memory) as MemoryComponent | undefined;
      if (memory) {
        const nextMemory: MemoryComponent = {
          ...memory,
          annoyedDuration: consequence.state === 'annoyed' ? consequence.duration : memory.annoyedDuration,
          gratefulDuration: consequence.state === 'grateful' ? consequence.duration : memory.gratefulDuration
        };
        nextState = addComponent(nextState, memOwnerId, nextMemory);
      }
      break;
    }

    default:
      return assertNever(consequence);
  }

  return nextState;
}

/**
 * Processes all global events against the declarative trigger system.
 */
export function processGlobalTriggers(state: GameState): GameState {
  if (state.events.length === 0) return state;

  let nextState = state;

  let eventIndex = 0;
  // Using while loop to process newly pushed events from consequences recursively.
  while (eventIndex < nextState.events.length) {
    const event = nextState.events[eventIndex]!;
    eventIndex++;

    // O(1) bucket routing
    const triggers = nextState.campaign.triggerBuckets?.[event.type] ?? [];

    // Also include TrapTriggered triggers if we're evaluating a TrapTriggered event.
    // Wait, the bucket for GameEventType.TrapTriggered already contains them since we bucketed by `eventType`.
    // The previous loop was checking: trigger.eventType === event.type || (trigger.eventType === 'TrapTriggered' && event.type === GameEventType.TrapTriggered && ...)
    // But since the bucket handles `trigger.eventType === event.type`, we just need to filter traps by `triggerId`
    // Actually, triggers in the bucket are already of `eventType`. We just need to check the trap condition.

    for (const trigger of triggers) {
      if (event.type === GameEventType.TrapTriggered) {
        const trapEvent = event as TrapTriggeredEvent;
        // The trigger ID in the JSON must match the triggerId in the trap.
        // Or wait, does the JSON trigger use its own `id` as the physical triggerId? Yes, that was the design.
        if (trapEvent.triggerId !== trigger.id) {
          continue; // Skip if this trap trigger doesn't match the physical triggerId
        }
      }

      const conditionsMet = trigger.conditions.every((c) => evaluateCondition(nextState, event, c));
      if (conditionsMet) {
        for (const consequence of trigger.consequences) {
          nextState = applyConsequence(nextState, event, consequence);
        }
        const traceEvent: DebugTriggerTraceEvent = {
          type: GameEventType.DebugTriggerTrace,
          triggerId: trigger.id,
          triggeringEvent: event,
          executedConsequences: trigger.consequences.map((c) => c.type)
        };
        nextState = {
          ...nextState,
          events: [...nextState.events, traceEvent as unknown as GameEvent]
        };
      }
    }
  }

  return nextState;
}
