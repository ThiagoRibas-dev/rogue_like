import { addComponent, getComponent, removeComponent, removeEntity, resolveEntityDisplayName } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import {
  ComponentType,
  type CorpseComponent,
  type FactionComponent,
  type FighterComponent,
  type IdentityMaskComponent,
  type InventoryComponent,
  type ItemComponent,
  type PositionComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import type { ApplyIntentTarget } from '../types/intents/interaction.intents.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/** Declarative tag identifying disguise kit / costume tools (`disguise_kit`). */
export const DISGUISE_KIT_ITEM_TAG = 'disguise_kit';

/** Default suspicion threshold (`100`) at which an `IdentityMaskComponent` disguise is blown. */
export const DEFAULT_MAX_DISGUISE_SUSPICION = 100;

/** Base suspicion added when an observer beats the disguised actor's `disguiseCheckTotal` on a `Spot` check (`50`). */
export const SPOT_BEATS_DISGUISE_SUSPICION_GAIN = 50;

/** Maximum Chebyshev tile distance within which guards actively scrutinize a disguised actor (`4` tiles = 20 ft). */
export const DISGUISE_SCRUTINY_RADIUS_TILES = 4;

/** Baseline Spot roll used when no forced roll is supplied (`10` = passive Take 10 scrutiny). */
const PASSIVE_SCRUTINY_SPOT_ROLL = 10;

/**
 * Checks whether an item entity carries the declarative `'disguise_kit'` or `'disguise_tool'` tag.
 */
export function isDisguiseToolItem(state: Readonly<GameState>, itemEntityId: EntityId): boolean {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return false;
  const campaignDef = state.campaign.items[itemComp.itemId];
  const sysItems = (
    state.campaign.systemContent as
      { readonly items?: Readonly<Record<string, { readonly tags?: ReadonlyArray<string> | undefined }>> } | undefined
  )?.items;
  const tags = campaignDef?.tags ?? sysItems?.[itemComp.itemId]?.tags ?? [];
  return tags.includes(DISGUISE_KIT_ITEM_TAG) || tags.includes('disguise_tool');
}

function resolveImpersonatedFactionForDisguise(
  state: Readonly<GameState>,
  actorId: EntityId,
  target: ApplyIntentTarget
): string {
  const actorFaction =
    (getComponent(state, actorId, ComponentType.Faction) as FactionComponent | undefined)?.factionId ?? 'player';

  if (target.type === 'entity' && target.entityId !== actorId) {
    const targetFaction = (getComponent(state, target.entityId, ComponentType.Faction) as FactionComponent | undefined)
      ?.factionId;
    if (targetFaction && targetFaction !== 'neutral' && targetFaction !== actorFaction) {
      return targetFaction;
    }
    const corpse = getComponent(state, target.entityId, ComponentType.Corpse) as CorpseComponent | undefined;
    if (corpse) {
      const tpl = state.campaign.entities[corpse.sourceTemplateId];
      const tplFaction = tpl?.faction;
      if (tplFaction && tplFaction !== 'neutral' && tplFaction !== actorFaction) {
        return tplFaction;
      }
    }
  }

  for (const eid of state.entities) {
    if (eid === actorId) continue;
    const f = (getComponent(state, eid, ComponentType.Faction) as FactionComponent | undefined)?.factionId;
    if (f && f !== actorFaction && f !== 'neutral') {
      return f;
    }
  }

  const campaignFactionIds = Object.keys(state.campaign.factions).filter(
    (fid) => fid !== actorFaction && fid !== 'neutral'
  );
  return campaignFactionIds[0] ?? 'bandits';
}

/**
 * Production entry point for applying a disguise kit (`'disguise_kit'` / `'disguise_tool'`) via `processApplyIntent`.
 * Resolves the target faction to impersonate, computes the actor's Disguise skill check total (`Take 10 + modifier`),
 * decrements finite tool charges if present, and attaches `ComponentType.IdentityMask`.
 */
export function applyDisguiseFromTool(
  state: GameState,
  actorId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  if (!isDisguiseToolItem(state, toolEntityId)) {
    return { state, success: false };
  }
  const activeRuleset = getActiveRuleset(state);
  const disguiseMod = activeRuleset.getActorSkillModifier?.(state, actorId, 'disguise') ?? 0;
  const checkTotal = PASSIVE_SCRUTINY_SPOT_ROLL + disguiseMod;
  const disguisedAsFactionId = resolveImpersonatedFactionForDisguise(state, actorId, target);

  let nextState = applyIdentityMask(state, actorId, disguisedAsFactionId, checkTotal);
  const itemComp = getComponent(nextState, toolEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (itemComp?.charges !== undefined) {
    const remaining = itemComp.charges - 1;
    if (remaining <= 0) {
      const inv = getComponent(nextState, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
      if (inv && inv.items.includes(toolEntityId)) {
        nextState = addComponent(nextState, actorId, {
          ...inv,
          items: inv.items.filter((id) => id !== toolEntityId)
        });
      }
      nextState = removeEntity(nextState, toolEntityId);
    } else {
      nextState = addComponent(nextState, toolEntityId, {
        ...itemComp,
        charges: remaining
      });
    }
  }
  return { state: nextState, success: true };
}

/**
 * Applies an active `IdentityMaskComponent` to `actorId`, disguising them as a member of `disguisedAsFactionId`
 * (and optionally `disguisedAsRaceId`) with an initial `disguiseCheckTotal`.
 * Works symmetrically for both player infiltrators and enemy spies.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor donning the disguise.
 * @param disguisedAsFactionId Target faction ID being impersonated.
 * @param disguiseCheckTotal Actor's `Disguise` check total.
 * @param options Optional `disguisedAsRaceId` and `maxSuspicion`.
 * @returns Updated GameState.
 */
export function applyIdentityMask(
  state: GameState,
  actorId: EntityId,
  disguisedAsFactionId: string,
  disguiseCheckTotal: number,
  options?: {
    readonly disguisedAsRaceId?: string | undefined;
    readonly maxSuspicion?: number | undefined;
  }
): GameState {
  const mask: IdentityMaskComponent = {
    type: ComponentType.IdentityMask,
    disguisedAsFactionId,
    ...(options?.disguisedAsRaceId !== undefined ? { disguisedAsRaceId: options.disguisedAsRaceId } : {}),
    disguiseCheckTotal,
    suspicion: 0,
    maxSuspicion: Math.max(1, options?.maxSuspicion ?? DEFAULT_MAX_DISGUISE_SUSPICION)
  };
  let nextState = addComponent(state, actorId, mask);
  const actorName = resolveEntityDisplayName(nextState, actorId, 'Someone');
  nextState = addMessage(
    nextState,
    `${actorName} assumes a disguise as a member of ${disguisedAsFactionId} (Disguise check: ${disguiseCheckTotal}).`,
    MessageLogCategory.System
  );
  return nextState;
}

/**
 * Checks whether an active, unblown `IdentityMaskComponent` on `disguisedActorId` currently suppresses
 * baseline faction hostility from `observerId` (because `disguisedAsFactionId` is non-hostile to `observerId`'s faction).
 *
 * @param state Current GameState.
 * @param observerId Entity evaluating faction relation.
 * @param disguisedActorId Potentially disguised entity.
 * @returns `true` if `disguisedActorId` has an intact disguise that makes them appear non-hostile to `observerId`.
 */
export function isDisguiseSuppressingHostility(
  state: Readonly<GameState>,
  observerId: EntityId,
  disguisedActorId: EntityId
): boolean {
  const mask = getComponent(state, disguisedActorId, ComponentType.IdentityMask) as IdentityMaskComponent | undefined;
  if (!mask || mask.suspicion >= mask.maxSuspicion) {
    return false;
  }

  const observerFaction =
    (getComponent(state, observerId, ComponentType.Faction) as FactionComponent | undefined)?.factionId ?? 'neutral';
  if (observerFaction === mask.disguisedAsFactionId) {
    return true;
  }

  const observerRelations = state.campaign.factions[observerFaction];
  const spoofedRelation = observerRelations?.[mask.disguisedAsFactionId] ?? 'neutral';
  return spoofedRelation !== 'hostile';
}

/**
 * Evaluates close-range observer scrutiny (`Spot` vs. `IdentityMaskComponent.disguiseCheckTotal`) or explicit
 * suspicion increments against `actorId`. When `suspicion >= maxSuspicion`, the disguise is blown and
 * `ComponentType.IdentityMask` is stripped.
 *
 * @param state Current immutable GameState.
 * @param actorId Disguised actor EntityId.
 * @param options Optional explicit `suspicionDelta` or deterministic `forcedObserverSpotRoll`.
 * @returns Updated GameState, current `suspicion`, and whether the disguise was `blown`.
 */
export function evaluateDisguiseSuspicion(
  state: GameState,
  actorId: EntityId,
  options?: {
    readonly suspicionDelta?: number | undefined;
    readonly forcedObserverSpotRoll?: number | undefined;
  }
): {
  readonly state: GameState;
  readonly suspicion: number;
  readonly blown: boolean;
} {
  const mask = getComponent(state, actorId, ComponentType.IdentityMask) as IdentityMaskComponent | undefined;
  if (!mask) {
    return { state, suspicion: 0, blown: false };
  }

  let addedSuspicion = Math.max(0, Math.trunc(options?.suspicionDelta ?? 0));
  const actorPos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  const activeRuleset = getActiveRuleset(state);

  if (actorPos) {
    for (const observerId of state.entities) {
      if (observerId === actorId) continue;
      const fighter = getComponent(state, observerId, ComponentType.Fighter) as FighterComponent | undefined;
      const obsPos = getComponent(state, observerId, ComponentType.Position) as PositionComponent | undefined;
      if (!fighter || fighter.hp <= 0 || !obsPos) continue;

      const obsFaction =
        (getComponent(state, observerId, ComponentType.Faction) as FactionComponent | undefined)?.factionId ??
        'neutral';
      if (obsFaction !== mask.disguisedAsFactionId) continue;

      const dist = Math.max(Math.abs(obsPos.x - actorPos.x), Math.abs(obsPos.y - actorPos.y));
      if (dist > DISGUISE_SCRUTINY_RADIUS_TILES) continue;

      const spotMod = activeRuleset.getActorSkillModifier?.(state, observerId, 'spot') ?? 0;
      const rawRoll = options?.forcedObserverSpotRoll ?? PASSIVE_SCRUTINY_SPOT_ROLL;
      // Familiar faction members gain +4 on Spot checks to see through a disguise impersonating their own group
      const familiarityBonus = 4;
      const spotTotal = rawRoll + spotMod + familiarityBonus;

      if (spotTotal > mask.disguiseCheckTotal) {
        addedSuspicion += SPOT_BEATS_DISGUISE_SUSPICION_GAIN;
      }
    }
  }

  const nextSuspicion = Math.min(mask.maxSuspicion, mask.suspicion + addedSuspicion);
  if (nextSuspicion >= mask.maxSuspicion) {
    let nextState = removeComponent(state, actorId, ComponentType.IdentityMask);
    const actorName = resolveEntityDisplayName(nextState, actorId, 'The infiltrator');
    nextState = addMessage(
      nextState,
      `${actorName}'s disguise as ${mask.disguisedAsFactionId} is seen through and blown!`,
      MessageLogCategory.CombatMiss
    );
    return { state: nextState, suspicion: nextSuspicion, blown: true };
  }

  if (nextSuspicion !== mask.suspicion) {
    const nextState = addComponent(state, actorId, {
      ...mask,
      suspicion: nextSuspicion
    });
    return { state: nextState, suspicion: nextSuspicion, blown: false };
  }

  return { state, suspicion: mask.suspicion, blown: false };
}
