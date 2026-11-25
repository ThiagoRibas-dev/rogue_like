import {
  BASELINE_MOOD,
  BREAK_FACET_BERSERK_THRESHOLD,
  BREAK_FACET_HIDE_THRESHOLD,
  BREAK_FACET_TANTRUM_THRESHOLD,
  DEFAULT_FACET_NEUTRAL,
  DEFAULT_INSPIRATION_DURATION_TURNS,
  DEFAULT_MENTAL_BREAK_DURATION_TURNS,
  INSPIRATION_FACET_CRAFT_THRESHOLD,
  INSPIRATION_FACET_VALOR_THRESHOLD,
  MAX_NEED_VALUE,
  MAX_TRANSIENT_THOUGHTS,
  MIN_NEED_VALUE,
  MOOD_BREAKING_THRESHOLD,
  MOOD_CATATONIC_THRESHOLD,
  MOOD_ECSTATIC_THRESHOLD,
  MOOD_HAPPY_THRESHOLD,
  MOOD_STRESSED_THRESHOLD,
  RESILIENCE_DAMPENER_BASE,
  RESILIENCE_DAMPENER_MIN,
  RESILIENCE_DAMPENER_SLOPE,
  STRESS_MOOD_PENALTY_FACTOR
} from '../../constants/personality.constants.ts';
import { addComponent, getComponent } from '../../core/ecs.ts';
import {
  ComponentType,
  type ActiveInspirationState,
  type ActiveMentalBreakState,
  type InspirationKind,
  type MemoryComponent,
  type MentalBreakKind,
  type MoodTier,
  type Thought
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';

/** Input payload for adding or stacking a decaying situational thought on an actor. */
export interface AddThoughtInput {
  readonly thoughtId: string;
  readonly eventSummary: string;
  readonly moodDelta: number;
  readonly stressDelta?: number | undefined;
  readonly durationTurns?: number | undefined;
  readonly maxStacks?: number | undefined;
  readonly relatedEntityId?: EntityId | undefined;
}

/** Classifies a numeric mood score (`0..100`) into a discrete canonical `MoodTier`. */
export function classifyMoodTier(moodScore: number): MoodTier {
  if (moodScore >= MOOD_ECSTATIC_THRESHOLD) return 'ecstatic';
  if (moodScore >= MOOD_HAPPY_THRESHOLD) return 'happy';
  if (moodScore > MOOD_STRESSED_THRESHOLD) return 'content';
  if (moodScore > MOOD_BREAKING_THRESHOLD) return 'stressed';
  if (moodScore > MOOD_CATATONIC_THRESHOLD) return 'breaking';
  return 'catatonic';
}

function createEmptyMemoryFallback(): MemoryComponent {
  return {
    type: ComponentType.Memory,
    factionStandings: {},
    grudges: [],
    facts: [],
    knowledge: {}
  };
}

/**
 * Adds a decaying, stackable situational `Thought` onto an actor's `MemoryComponent`
 * and recalculates their aggregated mood & inspiration/mental break thresholds.
 */
export function addTimedThought(state: GameState, entityId: EntityId, input: AddThoughtInput): GameState {
  const existing =
    (getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined) ?? createEmptyMemoryFallback();
  const currentTurn = state.globalTurn ?? 0;
  const activeThoughts = [...(existing.thoughts ?? [])].filter(
    (t) => t.expiresAtTurn === undefined || t.expiresAtTurn > currentTurn
  );

  const expiresAtTurn = input.durationTurns !== undefined ? currentTurn + Math.max(1, input.durationTurns) : undefined;
  const existingIdx = activeThoughts.findIndex((t) => t.thoughtId === input.thoughtId);

  if (existingIdx >= 0) {
    const prev = activeThoughts[existingIdx]!;
    const maxStacks = input.maxStacks ?? prev.maxStacks ?? 1;
    const nextStacks = Math.min(maxStacks, (prev.stackCount ?? 1) + 1);
    activeThoughts[existingIdx] = {
      ...prev,
      turn: currentTurn,
      eventSummary: input.eventSummary,
      moodDelta: input.moodDelta,
      stressDelta: input.stressDelta ?? prev.stressDelta,
      stackCount: nextStacks,
      ...(maxStacks > 1 ? { maxStacks } : {}),
      ...(expiresAtTurn !== undefined ? { expiresAtTurn } : {}),
      ...(input.relatedEntityId !== undefined ? { relatedEntityId: input.relatedEntityId } : {})
    };
  } else {
    if (activeThoughts.length >= MAX_TRANSIENT_THOUGHTS) {
      activeThoughts.shift();
    }
    activeThoughts.push({
      turn: currentTurn,
      thoughtId: input.thoughtId,
      eventSummary: input.eventSummary,
      stressDelta: input.stressDelta ?? Math.max(-25, Math.min(25, -Math.round(input.moodDelta / 2))),
      moodDelta: input.moodDelta,
      stackCount: 1,
      ...(input.maxStacks !== undefined && input.maxStacks > 1 ? { maxStacks: input.maxStacks } : {}),
      ...(expiresAtTurn !== undefined ? { expiresAtTurn } : {}),
      ...(input.relatedEntityId !== undefined ? { relatedEntityId: input.relatedEntityId } : {})
    });
  }

  const evaluated = recalculateActorMood(
    {
      ...existing,
      thoughts: activeThoughts
    },
    currentTurn,
    state.campaign.rules.psychology?.moodBreakingThreshold,
    state.campaign.rules.psychology?.moodInspirationThreshold
  );

  return addComponent(state, entityId, evaluated.memory);
}

function selectMentalBreakKind(facets: Readonly<Record<string, number>> | undefined): MentalBreakKind {
  const aggression = facets?.['aggression'] ?? facets?.['cruelty'] ?? DEFAULT_FACET_NEUTRAL;
  const cowardice = facets?.['cowardice'] ?? DEFAULT_FACET_NEUTRAL;
  if (aggression >= BREAK_FACET_BERSERK_THRESHOLD) return 'berserk';
  if (cowardice >= BREAK_FACET_HIDE_THRESHOLD) return 'hide_in_room';
  if (aggression >= BREAK_FACET_TANTRUM_THRESHOLD) return 'tantrum';
  return 'daze_wander';
}

function selectInspirationKind(facets: Readonly<Record<string, number>> | undefined): InspirationKind {
  const diligence = facets?.['diligence'] ?? facets?.['patience'] ?? DEFAULT_FACET_NEUTRAL;
  const bravery = facets?.['bravery'] ?? DEFAULT_FACET_NEUTRAL;
  if (bravery >= INSPIRATION_FACET_VALOR_THRESHOLD) return 'inspired_valor';
  if (diligence >= INSPIRATION_FACET_CRAFT_THRESHOLD) return 'inspired_craft';
  return 'work_frenzy';
}

/**
 * Purely prunes expired thoughts, computes facet-weighted mood (`0..100`), updates `moodTier`,
 * and triggers/expires `activeInspiration` and `activeMentalBreak` states.
 */
export function recalculateActorMood(
  memory: MemoryComponent,
  currentTurn: number,
  breakingThresholdOverride?: number,
  inspirationThresholdOverride?: number
): {
  readonly memory: MemoryComponent;
  readonly triggeredBreak?: MentalBreakKind | undefined;
  readonly triggeredInspiration?: InspirationKind | undefined;
} {
  const validThoughts: Thought[] = (memory.thoughts ?? []).filter(
    (t) => t.expiresAtTurn === undefined || t.expiresAtTurn > currentTurn
  );

  let netMoodDelta = 0;
  for (const t of validThoughts) {
    const rawDelta = t.moodDelta !== undefined ? t.moodDelta : -t.stressDelta;
    const stacks = t.stackCount ?? 1;
    netMoodDelta += rawDelta * stacks;
  }

  // Temperament resilience slightly dampens negative mood swings
  const resilience = memory.facets?.['resilience'] ?? DEFAULT_FACET_NEUTRAL;
  if (netMoodDelta < 0) {
    const dampener = Math.max(
      RESILIENCE_DAMPENER_MIN,
      RESILIENCE_DAMPENER_BASE - resilience * RESILIENCE_DAMPENER_SLOPE
    );
    netMoodDelta = Math.round(netMoodDelta * dampener);
  }

  const stressPenalty = Math.round((memory.stress ?? 0) * STRESS_MOOD_PENALTY_FACTOR);
  const mood = Math.max(MIN_NEED_VALUE, Math.min(MAX_NEED_VALUE, BASELINE_MOOD + netMoodDelta - stressPenalty));
  const moodTier = classifyMoodTier(mood);

  let activeInspiration: ActiveInspirationState | undefined =
    memory.activeInspiration && memory.activeInspiration.expiresAtTurn > currentTurn
      ? memory.activeInspiration
      : undefined;
  let activeMentalBreak: ActiveMentalBreakState | undefined =
    memory.activeMentalBreak && memory.activeMentalBreak.expiresAtTurn > currentTurn
      ? memory.activeMentalBreak
      : undefined;

  let triggeredBreak: MentalBreakKind | undefined;
  let triggeredInspiration: InspirationKind | undefined;
  const breakThreshold = breakingThresholdOverride ?? MOOD_BREAKING_THRESHOLD;
  const inspirationThreshold = inspirationThresholdOverride ?? MOOD_ECSTATIC_THRESHOLD;

  if (mood <= breakThreshold && !activeMentalBreak) {
    const kind = selectMentalBreakKind(memory.facets);
    activeMentalBreak = { kind, expiresAtTurn: currentTurn + DEFAULT_MENTAL_BREAK_DURATION_TURNS };
    activeInspiration = undefined;
    triggeredBreak = kind;
  } else if (mood >= inspirationThreshold && !activeInspiration && !activeMentalBreak) {
    const kind = selectInspirationKind(memory.facets);
    activeInspiration = { kind, expiresAtTurn: currentTurn + DEFAULT_INSPIRATION_DURATION_TURNS };
    triggeredInspiration = kind;
  }

  const { activeInspiration: _oldInsp, activeMentalBreak: _oldBreak, ...restMemory } = memory;

  const updatedMemory: MemoryComponent = {
    ...restMemory,
    thoughts: validThoughts,
    mood,
    moodTier,
    ...(activeInspiration !== undefined ? { activeInspiration } : {}),
    ...(activeMentalBreak !== undefined ? { activeMentalBreak } : {})
  };

  return {
    memory: updatedMemory,
    ...(triggeredBreak !== undefined ? { triggeredBreak } : {}),
    ...(triggeredInspiration !== undefined ? { triggeredInspiration } : {})
  };
}

/**
 * Evaluates mood recalculation and triggers inspiration/break log messages for one entity.
 */
export function evaluateEntityPsychologyMood(state: GameState, entityId: EntityId): GameState {
  const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (!memory) return state;

  const res = recalculateActorMood(
    memory,
    state.globalTurn ?? 0,
    state.campaign.rules.psychology?.moodBreakingThreshold,
    state.campaign.rules.psychology?.moodInspirationThreshold
  );

  let nextState = addComponent(state, entityId, res.memory);
  if (res.triggeredBreak) {
    nextState = addMessage(
      nextState,
      `A creature suffers a mental break (${res.triggeredBreak.replace(/_/g, ' ')})!`,
      MessageLogCategory.System
    );
  } else if (res.triggeredInspiration) {
    nextState = addMessage(
      nextState,
      `Someone experiences an inspiration (${res.triggeredInspiration.replace(/_/g, ' ')})!`,
      MessageLogCategory.System
    );
  }
  return nextState;
}
