import { getComponent } from './ecs.ts';
import { getVisibleHostileEntityIds } from '../systems/map.system.ts';
import { type EntityId, type GameState } from '../types/game-state.types.ts';
import {
  ComponentType,
  type AttitudeComponent,
  type FighterComponent,
  type StatusEffectsComponent,
  type TagsComponent
} from '../types/components.types.ts';
import { GameEventType, type EntitySpottedEvent, type GameEvent } from '../types/events.types.ts';
import { PERCENT_SCALE, type AutoPauseReason, type AutoPauseSettings } from '../constants/autopause.constants.ts';

/**
 * Event types considered narrative/drama developments for auto-pause purposes.
 * Kept here (rather than in the constants module) so `src/constants/` stays free
 * of runtime type imports, matching the convention of the other constant files.
 */
const NARRATIVE_AUTOPAUSE_EVENTS: ReadonlySet<GameEventType> = new Set<GameEventType>([
  GameEventType.ClueDiscovered,
  GameEventType.DialogueSelected,
  GameEventType.WorldEventFired,
  GameEventType.InvestigationStalled,
  GameEventType.NemesisPromoted,
  GameEventType.SchemeEscalated
]);

/**
 * Transient record of the hostiles currently visible to the player.
 * Lives in memory only (never in `GameState`) so no save migration is required.
 */
const currentlySighted: Set<EntityId> = new Set<EntityId>();

/** Outcome of evaluating every auto-pause signal for one turn step. */
export interface AutoPauseSignalResult {
  readonly state: GameState;
  readonly reason: AutoPauseReason | undefined;
}

/** Result of evaluating field-of-view perception for a single turn step. */
interface SightingResult {
  readonly state: GameState;
  readonly reason: AutoPauseReason | undefined;
}

/**
 * Clears transient sighting memory. Call on new game, save load, or area transition,
 * so hostiles in a freshly loaded area are reported as newly spotted.
 */
export function resetAutoPauseTracking(): void {
  currentlySighted.clear();
}

/**
 * Evaluates all auto-pause signals in priority order and returns the first that fired.
 *
 * Sighting runs first so any `EntitySpotted` events it appends are present in the
 * event queue that the narrative check (and the caller's ledger) observes.
 *
 * @param before State prior to the intent, used for status-effect diffing.
 * @param after State after stabilisation and cadence systems ran.
 * @param settings The active auto-pause preferences.
 * @returns The resulting state plus the triggered reason, if any.
 */
export function detectAutoPauseSignals(
  before: GameState,
  after: GameState,
  settings: AutoPauseSettings
): AutoPauseSignalResult {
  const sighting = processSighting(after, settings);

  const reason =
    sighting.reason ??
    detectLowHealth(sighting.state, settings) ??
    detectDetrimentalStatus(before, sighting.state, settings) ??
    detectNarrative(sighting.state, settings);

  return { state: sighting.state, reason };
}

/**
 * Diffs currently visible hostiles against the transient sighting memory and emits
 * an `EntitySpotted` event for each newcomer.
 *
 * @param state The current GameState (post-intent).
 * @param settings The active auto-pause preferences.
 * @returns The state with any sighting events appended, plus the pause reason if a configured trigger fired.
 */
function processSighting(state: GameState, settings: AutoPauseSettings): SightingResult {
  const visible = getVisibleHostileEntityIds(state);
  const newlySpotted = visible.filter((entityId) => !currentlySighted.has(entityId));

  // Rebuild from the current visible set so dead or reused ids cannot suppress future pauses.
  currentlySighted.clear();
  for (const entityId of visible) {
    currentlySighted.add(entityId);
  }

  if (newlySpotted.length === 0) return { state, reason: undefined };

  const events: GameEvent[] = [];
  let reason: AutoPauseReason | undefined;

  for (const entityId of newlySpotted) {
    const event = buildSpottedEvent(state, entityId);
    if (event === undefined) continue;
    events.push(event);

    if (event.isNemesis && settings.pauseOnNemesisSpotted) {
      reason = 'nemesis_spotted';
      continue;
    }
    if (!event.isNemesis && settings.pauseOnEnemySpotted && reason === undefined) {
      reason = 'enemy_spotted';
    }
  }

  if (events.length === 0) return { state, reason: undefined };
  return { state: { ...state, events: [...state.events, ...events] }, reason };
}

/**
 * Builds an `EntitySpotted` event for one entity, or undefined when it has no position.
 *
 * @param state The current GameState.
 * @param entityId The spotted entity.
 * @returns The constructed event, or undefined.
 */
function buildSpottedEvent(state: GameState, entityId: EntityId): EntitySpottedEvent | undefined {
  const position = getComponent(state, entityId, ComponentType.Position);
  if (position === undefined) return undefined;

  const attitude = getComponent(state, entityId, ComponentType.Attitude) as AttitudeComponent | undefined;
  const isNemesis = getComponent(state, entityId, ComponentType.Nemesis) !== undefined;
  const tagsComponent = getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined;
  const disposition = attitude !== undefined && attitude.attitude === 'hostile' ? 'Hostile' : 'Entity';

  return {
    type: GameEventType.EntitySpotted,
    entityId,
    x: position.x,
    y: position.y,
    isNemesis,
    tags: tagsComponent?.tags ?? [],
    importance: isNemesis ? 'high' : 'low',
    summary: `${isNemesis ? 'Nemesis' : disposition} ${entityId} spotted`
  };
}

/**
 * Detects whether the player's health has fallen below the configured threshold.
 *
 * @param state The current GameState.
 * @param settings The active auto-pause preferences.
 * @returns The reason when triggered, otherwise undefined.
 */
function detectLowHealth(state: GameState, settings: AutoPauseSettings): AutoPauseReason | undefined {
  if (!settings.pauseOnLowHealth) return undefined;

  const playerEntityId = getPlayerEntityId(state);
  if (playerEntityId === undefined) return undefined;

  const fighter = getComponent(state, playerEntityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (fighter === undefined || fighter.maxHp <= 0 || fighter.hp <= 0) return undefined;

  const healthPercent = (fighter.hp * PERCENT_SCALE) / fighter.maxHp;
  return healthPercent < settings.lowHealthThresholdPercent ? 'low_health' : undefined;
}

/**
 * Detects newly gained status effects flagged detrimental in the campaign registry.
 * Diffing against the pre-intent state means only fresh applications trigger a pause.
 *
 * @param before State prior to the intent.
 * @param after State after the intent.
 * @param settings The active auto-pause preferences.
 * @returns The reason when triggered, otherwise undefined.
 */
function detectDetrimentalStatus(
  before: GameState,
  after: GameState,
  settings: AutoPauseSettings
): AutoPauseReason | undefined {
  if (!settings.pauseOnDetrimentalStatus) return undefined;

  const playerEntityId = getPlayerEntityId(after);
  if (playerEntityId === undefined) return undefined;

  const previousEffectIds = getActiveEffectIds(before, playerEntityId);
  const currentEffectIds = getActiveEffectIds(after, playerEntityId);

  for (const effectId of currentEffectIds) {
    if (previousEffectIds.has(effectId)) continue;
    const definition = after.campaign.status[effectId];
    if (definition !== undefined && definition.detrimental) return 'detrimental_status';
  }

  return undefined;
}

/**
 * Detects narrative or drama events in the current tick's event queue.
 *
 * @param state The current GameState.
 * @param settings The active auto-pause preferences.
 * @returns The reason when triggered, otherwise undefined.
 */
function detectNarrative(state: GameState, settings: AutoPauseSettings): AutoPauseReason | undefined {
  if (!settings.pauseOnNarrative) return undefined;

  for (const event of state.events) {
    if (NARRATIVE_AUTOPAUSE_EVENTS.has(event.type)) return 'narrative';
  }

  return undefined;
}

/**
 * Finds the player entity in the current state.
 *
 * @param state The current GameState.
 * @returns The player's EntityId, or undefined when no player exists.
 */
function getPlayerEntityId(state: GameState): EntityId | undefined {
  for (const entityId of state.entities) {
    if (getComponent(state, entityId, ComponentType.Player) !== undefined) return entityId;
  }
  return undefined;
}

/**
 * Collects the active status effect ids for an entity.
 *
 * @param state The GameState to read.
 * @param entityId The entity to inspect.
 * @returns A set of active effect ids.
 */
function getActiveEffectIds(state: GameState, entityId: EntityId): Set<string> {
  const effects = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  const ids = new Set<string>();
  if (effects === undefined) return ids;

  for (const effect of effects.activeEffects) {
    ids.add(effect.effectId);
  }
  return ids;
}
