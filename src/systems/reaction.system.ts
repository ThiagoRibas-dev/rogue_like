import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import type { ItemComponent, TagsComponent, TraitsComponent, MemoryComponent } from '../types/components.types.ts';
import { applyConsequence } from './trigger.system.ts';
import { GameEventType, type GameEvent, type ReactionResolvedEvent } from '../types/events.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import type { Verb } from '../constants/verbs.constants.ts';
import type { ApplyIntentTarget } from '../types/intents/interaction.intents.ts';
import type { ReactionDefinition } from '../types/campaign.types.ts';

export interface EntityMatcherData {
  tags: ReadonlyArray<string>;
  traits: ReadonlyArray<string>;
  category: string | undefined;
  entityId: EntityId;
}

/**
 * Helper to extract tags, traits, and item category from an entity.
 */
export function getEntityMatcherData(state: GameState, entityId: EntityId): EntityMatcherData {
  const tagsCmp = getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined;
  const traitsCmp = getComponent(state, entityId, ComponentType.Traits) as TraitsComponent | undefined;
  const itemCmp = getComponent(state, entityId, ComponentType.Item) as ItemComponent | undefined;
  const itemDef = itemCmp ? state.campaign.items[itemCmp.itemId] : undefined;

  const tags = tagsCmp?.tags ?? [];
  const traits = traitsCmp?.traits ?? [];
  const category = itemDef?.category;

  return { tags, traits, category, entityId };
}

/**
 * Condition specification for tag-based matching on an entity or combat context.
 * Supports self-tags (actor's own size/type/subtype/stance/load tags), target-tags (opponent tags),
 * and effect-tags (spell/damage/save descriptor tags).
 */
export interface EntityTagCondition {
  readonly selfTagsAll?: ReadonlyArray<string> | undefined;
  readonly selfTagsAny?: ReadonlyArray<string> | undefined;
  readonly selfTagsNone?: ReadonlyArray<string> | undefined;
  readonly targetTagsAll?: ReadonlyArray<string> | undefined;
  readonly targetTagsAny?: ReadonlyArray<string> | undefined;
  readonly targetTagsNone?: ReadonlyArray<string> | undefined;
  readonly effectTagsAny?: ReadonlyArray<string> | undefined;
  readonly targetSizeMin?: string | undefined;
}

/**
 * Checks if self tags, target tags, and effect tags satisfy an EntityTagCondition.
 * Evaluates selfTagsAll/Any/None, targetTagsAll/Any/None, and effectTagsAny.
 *
 * @param condition The tag condition to evaluate.
 * @param targetTags Optional tags of the opponent/target entity.
 * @param effectTags Optional tags of the incoming/outgoing effect or attack.
 * @param selfTags Optional tags of the subject entity itself (e.g., `size:large`, `type:construct`).
 * @returns True if all specified conditions are satisfied.
 */
export function matchesEntityTagCondition(
  condition: EntityTagCondition,
  targetTags?: ReadonlyArray<string> | undefined,
  effectTags?: ReadonlyArray<string> | undefined,
  selfTags?: ReadonlyArray<string> | undefined
): boolean {
  if (condition.selfTagsAll && condition.selfTagsAll.length > 0) {
    if (!selfTags) return false;
    for (const tag of condition.selfTagsAll) {
      if (!selfTags.includes(tag)) return false;
    }
  }

  if (condition.selfTagsAny && condition.selfTagsAny.length > 0) {
    if (!selfTags) return false;
    let match = false;
    for (const tag of condition.selfTagsAny) {
      if (selfTags.includes(tag)) {
        match = true;
        break;
      }
    }
    if (!match) return false;
  }

  if (condition.selfTagsNone && condition.selfTagsNone.length > 0) {
    if (selfTags) {
      for (const tag of condition.selfTagsNone) {
        if (selfTags.includes(tag)) return false;
      }
    }
  }

  if (condition.targetTagsAll && condition.targetTagsAll.length > 0) {
    if (!targetTags) return false;
    for (const tag of condition.targetTagsAll) {
      if (!targetTags.includes(tag)) return false;
    }
  }

  if (condition.targetTagsAny && condition.targetTagsAny.length > 0) {
    if (!targetTags) return false;
    let match = false;
    for (const tag of condition.targetTagsAny) {
      if (targetTags.includes(tag)) {
        match = true;
        break;
      }
    }
    if (!match) return false;
  }

  if (condition.targetTagsNone && condition.targetTagsNone.length > 0) {
    if (targetTags) {
      for (const tag of condition.targetTagsNone) {
        if (targetTags.includes(tag)) return false;
      }
    }
  }

  if (condition.effectTagsAny && condition.effectTagsAny.length > 0) {
    if (!effectTags) return false;
    let match = false;
    for (const tag of condition.effectTagsAny) {
      if (effectTags.includes(tag)) {
        match = true;
        break;
      }
    }
    if (!match) return false;
  }

  return true;
}


/**
 * Helper to evaluate a specific target against a matcher definition.
 */
export function evaluateTargetMatcher(
  state: GameState,
  matcher: ReactionDefinition['targetMatcher'],
  target: ApplyIntentTarget
): boolean {
  if (matcher.targetType === 'entity') {
    if (target.type !== 'entity' && target.type !== 'item' && target.type !== 'self') return false;

    // Determine the actual entity ID
    let eId: EntityId;
    if (target.type === 'entity') eId = target.entityId;
    else if (target.type === 'item') eId = target.itemEntityId;
    else return false; // self target is typically handled as the source, but if used as target, we'd need actorId. Here we assume we only evaluate explicit targets. Wait, if target is self, we need actorId.
    // For now, let's let the caller resolve target to an EntityId if it's an entity.

    const data = getEntityMatcherData(state, eId);

    if (matcher.entityId && matcher.entityId !== data.entityId.toString()) return false;
    if (
      matcher.categories &&
      matcher.categories.length > 0 &&
      (!data.category || !matcher.categories.includes(data.category))
    )
      return false;
    if (matcher.tags && matcher.tags.length > 0 && !matcher.tags.every((t) => data.tags.includes(t))) return false;
    if (matcher.traits && matcher.traits.length > 0 && !matcher.traits.every((t) => data.traits.includes(t)))
      return false;

    return true;
  } else if (matcher.targetType === 'tile') {
    if (target.type !== 'tile') return false;

    const tileIndex = target.y * state.map.width + target.x;
    const tile = state.map.tiles[tileIndex];
    if (!tile) return false;

    const tileDef = state.campaign.tiles[tile.tileId];
    if (!tileDef) return false;

    const tileTags = tileDef.tags ?? [];

    if (matcher.tileId && matcher.tileId !== tile.tileId) return false;
    if (matcher.tags && matcher.tags.length > 0 && !matcher.tags.every((t) => tileTags.includes(t))) return false;

    // fieldTypes evaluation can check for field entities on that tile if implemented later.
    return true;
  }

  return false;
}

/**
 * Returns all matching reactions for a specific verb, source, and target without applying consequences.
 */
export function getValidReactionsForTarget(
  state: GameState,
  verb: Verb,
  sourceEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): ReactionDefinition[] {
  const activeSourceId = toolEntityId ?? sourceEntityId;
  const sourceData = getEntityMatcherData(state, activeSourceId);
  const matches: ReactionDefinition[] = [];

  for (const reaction of state.campaign.reactions) {
    if (reaction.verb !== verb) continue;

    // Evaluate Source
    if (reaction.sourceMatcher.targetType !== 'entity') continue;
    if (reaction.sourceMatcher.entityId && reaction.sourceMatcher.entityId !== activeSourceId.toString()) continue;
    if (
      reaction.sourceMatcher.categories &&
      reaction.sourceMatcher.categories.length > 0 &&
      (!sourceData.category || !reaction.sourceMatcher.categories.includes(sourceData.category))
    )
      continue;
    if (
      reaction.sourceMatcher.tags &&
      reaction.sourceMatcher.tags.length > 0 &&
      !reaction.sourceMatcher.tags.every((t) => sourceData.tags.includes(t))
    )
      continue;
    if (
      reaction.sourceMatcher.traits &&
      reaction.sourceMatcher.traits.length > 0 &&
      !reaction.sourceMatcher.traits.every((t) => sourceData.traits.includes(t))
    )
      continue;

    // Evaluate Target
    if (!evaluateTargetMatcher(state, reaction.targetMatcher, target)) continue;

    // Evaluate Context
    if (reaction.contextMatcher?.factionStanding) {
      const memory = getComponent(state, sourceEntityId, ComponentType.Memory) as MemoryComponent | undefined;
      const standing = memory?.factionStandings[reaction.contextMatcher.factionStanding.factionId] ?? 0;
      const min = reaction.contextMatcher.factionStanding.min ?? -Infinity;
      const max = reaction.contextMatcher.factionStanding.max ?? Infinity;
      if (standing < min || standing > max) continue;
    }

    matches.push(reaction);
  }

  // Tie-breaking: Highest priority first, then stable ID sort
  matches.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority; // Descending priority
    }
    return a.id.localeCompare(b.id);
  });

  return matches;
}

/**
 * Processes declarative reactions between game entities based on their tags, traits, and the verb applied.
 */
export function processReactions(
  state: GameState,
  verb: Verb,
  sourceEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): { state: GameState; success: boolean } {
  const matches = getValidReactionsForTarget(state, verb, sourceEntityId, target, toolEntityId);

  if (matches.length === 0) {
    return { state, success: false };
  }

  const winningReaction = matches[0]!;

  let nextState = state;

  // Log the message
  if (winningReaction.message) {
    nextState = addMessage(nextState, winningReaction.message, MessageLogCategory.System);
  }

  // Apply Consequences
  const dummyEvent = {
    type: GameEventType.ReactionResolved,
    sourceId: sourceEntityId,
    entityId: sourceEntityId,
    verb,
    target,
    toolEntityId
  } as unknown as GameEvent;

  // Attempt to resolve targetEntityId if target is an entity, to pass into context
  let targetEntityId: EntityId | undefined;
  if (target.type === 'entity') targetEntityId = target.entityId;
  else if (target.type === 'item') targetEntityId = target.itemEntityId;

  for (const consequence of winningReaction.consequences) {
    const evalCons = {
      ...consequence,
      _npcEntityId: targetEntityId,
      _playerEntityId: sourceEntityId,
      entityId: sourceEntityId
    };
    nextState = applyConsequence(nextState, dummyEvent, evalCons);
  }

  // Emit ReactionResolvedEvent
  const resolvedEvent: ReactionResolvedEvent = {
    type: GameEventType.ReactionResolved,
    reactionId: winningReaction.id,
    verb,
    sourceId: sourceEntityId,
    target,
    whyMatched: `Priority ${winningReaction.priority}`
  };

  nextState = {
    ...nextState,
    events: [...nextState.events, resolvedEvent as unknown as GameEvent]
  };

  return { state: nextState, success: true };
}
