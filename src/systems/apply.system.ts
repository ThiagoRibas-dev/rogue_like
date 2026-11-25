import type { ApplyFailedEvent, ApplyResolvedEvent, GameEvent } from '../types/events.types.ts';
import { GameEventType } from '../types/events.types.ts';
import { UIMode, type GameState } from '../types/game-state.types.ts';
import type { ApplyIntent } from '../types/intents/interaction.intents.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { processProjectileThrow } from './projectile.system.ts';
import { processWandZap } from './zap.system.ts';
import { executeBuyItem, executeSellItem, executeTradeSocialAction } from './shop.system.ts';
import { processSocialIntent } from './social.system.ts';
import { processReactions, getValidReactionsForTarget } from './reaction.system.ts';
import { VERBS, type Verb } from '../constants/verbs.constants.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent,
  type PositionComponent,
  type TagsComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import { addComponent, getComponent, removeEntity, resolveEntityDisplayName } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import { REACH_PROBE_ITEM_TAG, REACH_PROBE_MAX_RANGE_TILES } from './durability.system.ts';
import { applyItemEffect } from './effects.system.ts';
import { computeRectDistanceTiles, getEntitySpatialProfile } from './movement_footprint.ts';
import { processQuestEvent } from './quest.system.ts';
import type { EntityId } from '../types/game-state.types.ts';
import type { ApplyIntentTarget, VerbOption } from '../types/intents/interaction.intents.ts';
import {
  COMPANION_ORDERS_DIALOGUE_ID,
  getValidCompanionVerbsForTarget,
  isPlayerControlledCompanion,
  processCompanionVerbIntent
} from './companion_commands.system.ts';
import { startDialogue } from './dialogue.system.ts';
import { canIgniteLightEmitterItem, igniteLightEmitter, refuelLightEmitter } from './light_emitter.system.ts';
import { canHarvestCorpseEntity, harvestCorpseEntity } from './corpse.system.ts';
import { isAltarOrShrineEntity, prayAtAltarOrShrine } from './religion.system.ts';
import { applyDisguiseFromTool, isDisguiseToolItem } from './disguise.system.ts';
import { constructTerrainTile, mineTerrainTile } from './construction.system.ts';
import { formatDesignationKey } from './labor/designation.system.ts';
import { advanceWorkshopBillWork } from './labor/workshop.system.ts';
import { getTileDefAt } from '../map/map_accessor.ts';
import type { LaborProfileComponent } from '../types/components.types.ts';
/** Physical and touch-based interaction verbs that require target proximity within actor reach. */
export const TOUCH_INTERACTION_VERBS: ReadonlySet<Verb> = new Set<Verb>([
  'open',
  'close',
  'lock',
  'unlock',
  'kick',
  'search',
  'disarm',
  'harvest',
  'pray',
  'apply',
  'dip',
  'ignite',
  'eat',
  'drink',
  'heal',
  'feint',
  'mine',
  'chop',
  'build',
  'craft'
]);

const REACH_PROBE_VERBS: ReadonlySet<Verb> = new Set<Verb>(['search', 'disarm']);

function hasReachProbeTool(state: GameState, actorId: EntityId, toolEntityId?: EntityId): boolean {
  const hasProbeTag = (itemId: EntityId): boolean => {
    const tags = (getComponent(state, itemId, ComponentType.Tags) as TagsComponent | undefined)?.tags;
    if (tags?.includes(REACH_PROBE_ITEM_TAG)) return true;
    const item = getComponent(state, itemId, ComponentType.Item) as ItemComponent | undefined;
    const defTags = item ? state.campaign.items[item.itemId]?.tags : undefined;
    return defTags?.includes(REACH_PROBE_ITEM_TAG) === true;
  };
  if (toolEntityId !== undefined && hasProbeTag(toolEntityId)) return true;
  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  return inv?.items.some((id) => hasProbeTag(id)) === true;
}

/**
 * Resolves an actor's effective interaction reach (in Chebyshev footprint tiles) for a given verb,
 * factoring in creature natural reach, reach-probe tools (`10-ft pole`), and active ruleset modifiers
 * (e.g. Mage Hand `interaction_reach_tiles`).
 */
export function resolveActorInteractionReachTiles(
  state: GameState,
  actorId: EntityId,
  verb: Verb,
  toolEntityId?: EntityId
): number {
  const profile = getEntitySpatialProfile(state, actorId);
  let reachTiles = Math.max(1, profile.naturalReachTiles);
  if (REACH_PROBE_VERBS.has(verb) && hasReachProbeTool(state, actorId, toolEntityId)) {
    reachTiles = Math.max(reachTiles, REACH_PROBE_MAX_RANGE_TILES);
  }
  const activeRuleset = getActiveRuleset(state);
  if (activeRuleset.resolveInteractionReachTiles) {
    reachTiles = activeRuleset.resolveInteractionReachTiles(state, actorId, verb, reachTiles, toolEntityId);
  }
  return Math.max(1, reachTiles);
}

/**
 * Computes Chebyshev tile distance from `actorId`'s footprint to `target`, returning `0` for
 * `self` targets and items already carried or equipped by `actorId`.
 */
export function computeInteractionTargetDistanceTiles(
  state: GameState,
  actorId: EntityId,
  target: ApplyIntentTarget
): number | null {
  if (target.type === 'self') return 0;

  if (target.type === 'item') {
    const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
    if (inv?.items.includes(target.itemEntityId)) return 0;
    const equip = getComponent(state, actorId, ComponentType.Equipment) as EquipmentComponent | undefined;
    if (equip?.slots.some((slot) => slot.equippedItem === target.itemEntityId)) return 0;
  } else if (target.type === 'entity' && target.entityId === actorId) {
    return 0;
  }

  const actorPos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  if (!actorPos) return null;
  const actorW = Math.max(1, actorPos.footprintWidth ?? 1);
  const actorH = Math.max(1, actorPos.footprintHeight ?? 1);

  if (target.type === 'tile') {
    return computeRectDistanceTiles(actorPos.x, actorPos.y, actorW, actorH, target.x, target.y, 1, 1);
  }

  const targetEntityId = target.type === 'entity' ? target.entityId : target.itemEntityId;
  const targetPos = getComponent(state, targetEntityId, ComponentType.Position) as PositionComponent | undefined;
  if (!targetPos) return null;

  return computeRectDistanceTiles(
    actorPos.x,
    actorPos.y,
    actorW,
    actorH,
    targetPos.x,
    targetPos.y,
    Math.max(1, targetPos.footprintWidth ?? 1),
    Math.max(1, targetPos.footprintHeight ?? 1)
  );
}

/**
 * Returns `true` if `verb` is either non-touch or `target` falls within `actorId`'s resolved
 * interaction reach.
 */
export function isTargetWithinInteractionReach(
  state: GameState,
  actorId: EntityId,
  verb: Verb,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): boolean {
  if (!TOUCH_INTERACTION_VERBS.has(verb)) return true;
  const dist = computeInteractionTargetDistanceTiles(state, actorId, target);
  if (dist === null) return true;
  return dist <= resolveActorInteractionReachTiles(state, actorId, verb, toolEntityId);
}

/**
 * Emits an 'interact' quest event when the player successfully interacts with an entity target.
 */
function emitInteractQuestEventIfApplicable(state: GameState, intent: ApplyIntent): GameState {
  if (!getComponent(state, intent.entityId, ComponentType.Player)) return state;
  const targetEntityId = intent.target.type === 'entity' ? intent.target.entityId : undefined;
  if (targetEntityId === undefined) return state;

  const templateComp = getComponent(state, targetEntityId, ComponentType.Template) as TemplateComponent | undefined;
  if (!templateComp) return state;

  return processQuestEvent(state, 'interact', templateComp.templateId, 1);
}

/**
 * Processes an ApplyIntent, which represents a generic attempt by an actor
 * to apply a specific verb to a specific target, optionally using a tool.
 *
 * @param state The current GameState.
 * @param intent The ApplyIntent to process.
 * @returns A result object containing the potentially modified state, success flag, and emitted events.
 */
export function processApplyIntent(
  state: GameState,
  intent: ApplyIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } {
  if (!isTargetWithinInteractionReach(state, intent.entityId, intent.verb, intent.target, intent.toolEntityId)) {
    const failedEvent: ApplyFailedEvent = {
      type: GameEventType.ApplyFailed,
      entityId: intent.entityId,
      verb: intent.verb,
      target: intent.target,
      toolEntityId: intent.toolEntityId,
      reason: 'Target is out of interaction reach.'
    };
    return {
      state: addMessage(state, 'That is out of reach.', MessageLogCategory.System),
      success: false,
      events: [failedEvent]
    };
  }

  if (intent.verb === 'throw' && intent.toolEntityId) {
    return processProjectileThrow(state, intent);
  }

  if (intent.verb === 'zap' && intent.toolEntityId) {
    return processWandZap(state, intent);
  }

  if (intent.verb === 'buy' && intent.target.type === 'entity' && intent.toolEntityId !== undefined) {
    return executeBuyItem(state, intent.entityId, intent.target.entityId, intent.toolEntityId);
  }

  if (
    (intent.verb === 'sell' || intent.verb === 'barter') &&
    intent.target.type === 'entity' &&
    intent.toolEntityId !== undefined
  ) {
    return executeSellItem(state, intent.entityId, intent.target.entityId, intent.toolEntityId);
  }

  if (intent.verb === 'appraise' && intent.target.type === 'entity') {
    return executeTradeSocialAction(state, intent.entityId, intent.target.entityId, 'appraise');
  }

  if (intent.verb === 'haggle' && intent.target.type === 'entity') {
    return executeTradeSocialAction(state, intent.entityId, intent.target.entityId, 'bluff');
  }

  if (
    state.uiMode === UIMode.Trade &&
    (intent.verb === 'persuade' || intent.verb === 'intimidate') &&
    intent.target.type === 'entity'
  ) {
    return executeTradeSocialAction(
      state,
      intent.entityId,
      intent.target.entityId,
      intent.verb === 'persuade' ? 'diplomacy' : 'intimidate'
    );
  }

  if (intent.verb === 'intimidate' || intent.verb === 'persuade' || intent.verb === 'feint') {
    return processSocialIntent(state, intent);
  }

  if (intent.verb === 'command') {
    if (
      intent.target.type === 'entity' &&
      isPlayerControlledCompanion(state, intent.entityId, intent.target.entityId)
    ) {
      return startDialogue(state, intent.target.entityId, COMPANION_ORDERS_DIALOGUE_ID);
    }
    return {
      state: addMessage(state, 'You can only command your own companions.', MessageLogCategory.System),
      success: false
    };
  }

  const companionOutcome = processCompanionVerbIntent(state, intent);
  if (companionOutcome !== null) {
    return companionOutcome;
  }

  if (intent.verb === 'harvest' && intent.target.type === 'entity') {
    const harvestRes = harvestCorpseEntity(state, intent.entityId, intent.target.entityId);
    if (harvestRes.success) {
      const nextState = emitInteractQuestEventIfApplicable(harvestRes.state, intent);
      const resolvedEvent: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return { state: nextState, success: true, events: [resolvedEvent] };
    }
    return { state: harvestRes.state, success: false };
  }

  if (intent.verb === 'pray' && intent.target.type === 'entity') {
    const prayRes = prayAtAltarOrShrine(state, intent.entityId, intent.target.entityId);
    if (prayRes.success) {
      const nextState = emitInteractQuestEventIfApplicable(prayRes.state, intent);
      const resolvedEvent: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return { state: nextState, success: true, events: [resolvedEvent] };
    }
    return { state: prayRes.state, success: false };
  }

  if ((intent.verb === 'mine' || intent.verb === 'chop') && intent.target.type === 'tile') {
    const mineRes = mineTerrainTile(
      state,
      intent.entityId,
      intent.target.x,
      intent.target.y,
      intent.target.z ?? 0,
      intent.toolEntityId
    );
    if (mineRes.success) {
      const resolvedEvent: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return { state: mineRes.state, success: true, events: [resolvedEvent] };
    }
    return { state: mineRes.state, success: false };
  }

  if (intent.verb === 'build' && intent.target.type === 'tile') {
    const targetZ = intent.target.z ?? 0;
    const desig =
      state.colonyState?.designations[
        formatDesignationKey(state.currentAreaId, intent.target.x, intent.target.y, targetZ)
      ];
    const buildRes = constructTerrainTile(
      state,
      intent.entityId,
      intent.target.x,
      intent.target.y,
      targetZ,
      desig?.blueprintId,
      intent.toolEntityId
    );
    if (buildRes.success) {
      const resolvedEvent: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return { state: buildRes.state, success: true, events: [resolvedEvent] };
    }
    return { state: buildRes.state, success: false };
  }

  if (intent.verb === 'craft' && intent.target.type === 'entity') {
    const profile = getComponent(state, intent.entityId, ComponentType.LaborProfile) as
      LaborProfileComponent | undefined;
    const reservedBillId =
      profile?.activeJob?.workshopEntityId === intent.target.entityId ? profile.activeJob.billId : undefined;
    const craftRes = advanceWorkshopBillWork(state, intent.entityId, intent.target.entityId, reservedBillId);
    if (craftRes.progressed) {
      const resolvedEvent: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return { state: craftRes.state, success: true, events: [resolvedEvent] };
    }
    return { state: craftRes.state, success: false };
  }

  if (intent.verb === 'apply') {
    const candidateToolId =
      intent.toolEntityId !== undefined
        ? intent.toolEntityId
        : intent.target.type === 'item'
          ? intent.target.itemEntityId
          : undefined;
    if (candidateToolId !== undefined && isDisguiseToolItem(state, candidateToolId)) {
      const disguiseRes = applyDisguiseFromTool(state, intent.entityId, intent.target, candidateToolId);
      if (disguiseRes.success) {
        const resolvedEvent: ApplyResolvedEvent = {
          type: GameEventType.ApplyResolved,
          entityId: intent.entityId,
          verb: intent.verb,
          target: intent.target,
          toolEntityId: intent.toolEntityId
        };
        return { state: disguiseRes.state, success: true, events: [resolvedEvent] };
      }
      return { state: disguiseRes.state, success: false };
    }
  }

  const activeRuleset = getActiveRuleset(state);
  if (activeRuleset.resolveSkillVerb) {
    const rulesetOutcome = activeRuleset.resolveSkillVerb(state, intent);
    if (rulesetOutcome !== null) {
      const nextState = rulesetOutcome.success
        ? emitInteractQuestEventIfApplicable(rulesetOutcome.state, intent)
        : rulesetOutcome.state;
      return { ...rulesetOutcome, state: nextState };
    }
  }

  const result = processReactions(state, intent.verb, intent.entityId, intent.target, intent.toolEntityId);

  if (result.success) {
    const nextState = emitInteractQuestEventIfApplicable(result.state, intent);

    const resolvedEvent: ApplyResolvedEvent = {
      type: GameEventType.ApplyResolved,
      entityId: intent.entityId,
      verb: intent.verb,
      target: intent.target,
      toolEntityId: intent.toolEntityId
    };
    return {
      state: nextState,
      success: true,
      events: [resolvedEvent]
    };
  }

  if (intent.verb === 'ignite') {
    const targetItemId =
      intent.target.type === 'item'
        ? intent.target.itemEntityId
        : intent.target.type === 'entity'
          ? intent.target.entityId
          : undefined;
    if (targetItemId !== undefined) {
      const igniteRes = igniteLightEmitter(state, intent.entityId, targetItemId, intent.toolEntityId);
      if (igniteRes.success) {
        const resolvedEvent: ApplyResolvedEvent = {
          type: GameEventType.ApplyResolved,
          entityId: intent.entityId,
          verb: intent.verb,
          target: intent.target,
          toolEntityId: intent.toolEntityId
        };
        return { state: igniteRes.state, success: true, events: [resolvedEvent] };
      }
      return { state: igniteRes.state, success: false };
    }
  }

  if (intent.verb === 'dip' && intent.toolEntityId !== undefined) {
    const targetItemEntityId =
      intent.target.type === 'item'
        ? intent.target.itemEntityId
        : intent.target.type === 'entity'
          ? intent.target.entityId
          : undefined;
    if (targetItemEntityId !== undefined) {
      const refuelRes = refuelLightEmitter(state, intent.entityId, targetItemEntityId, intent.toolEntityId);
      if (refuelRes.success) {
        const resolvedEvent: ApplyResolvedEvent = {
          type: GameEventType.ApplyResolved,
          entityId: intent.entityId,
          verb: intent.verb,
          target: intent.target,
          toolEntityId: intent.toolEntityId
        };
        return { state: refuelRes.state, success: true, events: [resolvedEvent] };
      }
      return { state: refuelRes.state, success: false };
    }
  }

  if (intent.verb === 'apply' || intent.verb === 'drink') {
    const consumableEntityId = intent.target.type === 'item' ? intent.target.itemEntityId : intent.toolEntityId;
    if (consumableEntityId !== undefined) {
      const itemComp = getComponent(state, consumableEntityId, ComponentType.Item) as ItemComponent | undefined;
      const itemDef = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
      if (itemComp && itemDef?.consumable) {
        const targetActorId = intent.target.type === 'entity' ? intent.target.entityId : intent.entityId;
        const itemName = resolveEntityDisplayName(state, consumableEntityId, itemDef.name);
        let nextState = addMessage(state, `You use the ${itemName}.`, MessageLogCategory.System);
        if (!nextState.identifiedItems.has(itemComp.itemId)) {
          const nextIdentified = new Set(nextState.identifiedItems);
          nextIdentified.add(itemComp.itemId);
          nextState = { ...nextState, identifiedItems: nextIdentified };
        }
        nextState = applyItemEffect(nextState, targetActorId, itemDef.consumable.effectId, itemName, targetActorId);

        const remainingCharges = (itemComp.charges ?? itemDef.consumable.charges ?? 1) - 1;
        if (remainingCharges <= 0) {
          const inv = getComponent(nextState, intent.entityId, ComponentType.Inventory) as
            InventoryComponent | undefined;
          if (inv && inv.items.includes(consumableEntityId)) {
            nextState = addComponent(nextState, intent.entityId, {
              ...inv,
              items: inv.items.filter((id) => id !== consumableEntityId)
            });
          }
          nextState = removeEntity(nextState, consumableEntityId);
        } else {
          nextState = addComponent(nextState, consumableEntityId, { ...itemComp, charges: remainingCharges });
        }

        const resolvedEvent: ApplyResolvedEvent = {
          type: GameEventType.ApplyResolved,
          entityId: intent.entityId,
          verb: intent.verb,
          target: intent.target,
          toolEntityId: intent.toolEntityId
        };
        return {
          state: nextState,
          success: true,
          events: [resolvedEvent]
        };
      }
    }
  }

  const failedEvent: ApplyFailedEvent = {
    type: GameEventType.ApplyFailed,
    entityId: intent.entityId,
    verb: intent.verb,
    target: intent.target,
    toolEntityId: intent.toolEntityId,
    reason: 'No reaction matched this combination.'
  };

  const stateWithMessage = addMessage(state, `Nothing interesting happens.`, MessageLogCategory.System);

  return {
    state: stateWithMessage,
    success: false,
    events: [failedEvent]
  };
}

/**
 * Returns a list of valid verbs for a given target combination,
 * evaluating both hardcoded item mechanics (throw/zap) and data-driven reactions.
 */
function collectRawValidVerbsForTarget(
  state: GameState,
  sourceEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): ReadonlyArray<Verb> {
  const validVerbs = new Set<Verb>();

  // 1. Check hardcoded fallback verb systems (if holding a tool)
  if (toolEntityId) {
    const itemComp = getComponent(state, toolEntityId, ComponentType.Item) as ItemComponent | undefined;
    if (itemComp) {
      const itemDef = state.campaign.items[itemComp.itemId];
      if (itemDef) {
        if (itemDef.throwable) validVerbs.add('throw');
        if (itemDef.zappable) validVerbs.add('zap');
        if (itemDef.consumable) {
          validVerbs.add('apply');
          validVerbs.add('drink');
        }
        if (isDisguiseToolItem(state, toolEntityId)) {
          validVerbs.add('apply');
        }
        const tags = itemDef.tags ?? [];
        if (
          tags.includes('liquid') ||
          tags.includes('poison') ||
          tags.includes('flammable_oil') ||
          tags.includes('fuel') ||
          (tags.includes('holy') && tags.includes('splash_weapon'))
        ) {
          validVerbs.add('dip');
        }
      }
    }
  }

  const targetItemEntityId =
    target.type === 'item' ? target.itemEntityId : target.type === 'entity' ? target.entityId : undefined;
  if (targetItemEntityId !== undefined) {
    if (canIgniteLightEmitterItem(state, sourceEntityId, targetItemEntityId, toolEntityId)) {
      validVerbs.add('ignite');
    }
    if (isDisguiseToolItem(state, targetItemEntityId)) {
      validVerbs.add('apply');
    }
  }

  if (target.type === 'entity') {
    if (canHarvestCorpseEntity(state, target.entityId)) {
      validVerbs.add('harvest');
    }
    if (isAltarOrShrineEntity(state, target.entityId)) {
      validVerbs.add('pray');
    }
    if (state.colonyState?.workshops[String(target.entityId)] !== undefined) {
      validVerbs.add('craft');
    }
  } else if (target.type === 'tile') {
    const tileDef = getTileDefAt(state, target.x, target.y, target.z ?? 0);
    if (tileDef && (tileDef.mineable === true || tileDef.tags?.includes('mineable'))) {
      validVerbs.add('mine');
    }
    if (tileDef && (tileDef.tags?.includes('tree') || tileDef.tags?.includes('chop'))) {
      validVerbs.add('chop');
    }
  }

  // 2. Check all verbs against data-driven reactions
  for (const verb of VERBS) {
    if (validVerbs.has(verb)) continue; // Already validated

    const matches = getValidReactionsForTarget(state, verb, sourceEntityId, target, toolEntityId);
    if (matches.length > 0) {
      validVerbs.add(verb);
    }
  }

  // 3. Add ruleset-provided context verbs
  const activeRuleset = getActiveRuleset(state);
  if (activeRuleset.getValidRulesetVerbsForTarget) {
    for (const verb of activeRuleset.getValidRulesetVerbsForTarget(state, sourceEntityId, target)) {
      validVerbs.add(verb);
    }
  }

  // 4. Add Console companion command verbs
  for (const verb of getValidCompanionVerbsForTarget(state, sourceEntityId, target)) {
    validVerbs.add(verb);
  }

  return Array.from(validVerbs);
}

/**
 * Returns `true` if `target` has at least one contextually valid verb that was blocked solely
 * because `target` is outside `sourceEntityId`'s resolved physical/touch interaction reach.
 */
export function hasOutOfReachVerbsForTarget(
  state: GameState,
  sourceEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): boolean {
  const rawVerbs = collectRawValidVerbsForTarget(state, sourceEntityId, target, toolEntityId);
  return (
    rawVerbs.length > 0 &&
    rawVerbs.every((verb) => !isTargetWithinInteractionReach(state, sourceEntityId, verb, target, toolEntityId))
  );
}

export function getValidVerbsForTarget(
  state: GameState,
  sourceEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): Verb[] {
  // 5. Enforce physical/touch interaction reach
  return collectRawValidVerbsForTarget(state, sourceEntityId, target, toolEntityId).filter((verb) =>
    isTargetWithinInteractionReach(state, sourceEntityId, verb, target, toolEntityId)
  );
}

/**
 * Returns every engine verb annotated with its current applicability for a target,
 * so a view can illuminate the ones that will actually work.
 *
 * Validity is delegated to {@link getValidVerbsForTarget} rather than recomputed,
 * keeping a single source of truth for interaction resolution.
 *
 * @param state The current GameState.
 * @param sourceEntityId The acting entity.
 * @param target The interaction target.
 * @param toolEntityId Optional tool entity in hand.
 * @returns All verbs, each flagged valid or invalid.
 */
export function getVerbOptionsForTarget(
  state: GameState,
  sourceEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): ReadonlyArray<VerbOption> {
  const validVerbs = new Set<Verb>(getValidVerbsForTarget(state, sourceEntityId, target, toolEntityId));
  return VERBS.map((verb) => ({ verb, valid: validVerbs.has(verb) }));
}
