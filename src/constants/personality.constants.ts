/** The stress threshold at which an entity forms a core memory and potentially promotes. */
export const STRESS_CORE_MEMORY_THRESHOLD = 100;

/** The maximum number of transient thoughts an entity can hold in MemoryComponent before culling. */
export const MAX_TRANSIENT_THOUGHTS = 10;

/** A facet value >= this is considered extreme (triggers auto-promotion). */
export const FACET_EXTREME_HIGH_THRESHOLD = 100;

/** A facet value <= this is considered extreme (triggers auto-promotion). */
export const FACET_EXTREME_LOW_THRESHOLD = 0;

/** A facet value >= this is considered dominant (visible in UI). */
export const FACET_DOMINANT_HIGH_THRESHOLD = 80;

/** A facet value <= this is considered dominant (visible in UI). */
export const FACET_DOMINANT_LOW_THRESHOLD = 20;

/** Base facet mutation applied during a core memory event. */
export const CORE_MEMORY_MUTATION_AMOUNT = 20;

/** Default number of talk interactions an NPC can handle before refusing options. */
export const DEFAULT_PATIENCE_THRESHOLD = 5;

/** Default turn duration for the annoyed social state. */
export const DEFAULT_ANNOYED_DURATION = 50;

/** Default turn duration for the grateful social state. */
export const DEFAULT_GRATEFUL_DURATION = 50;

/** Initial value for newly hydrated actor need meters (`0..100`). */
export const DEFAULT_NEED_VALUE = 80;

/** Maximum need meter capacity. */
export const MAX_NEED_VALUE = 100;

/** Minimum need meter value. */
export const MIN_NEED_VALUE = 0;

/** Need level at or below which critical distress thoughts & emergency AI self-care trigger. */
export const NEED_CRITICAL_THRESHOLD = 20;

/** Need level at or below which mild discomfort thoughts emit. */
export const NEED_LOW_THRESHOLD = 40;

/** Need level at or above which positive satisfaction thoughts emit. */
export const NEED_HIGH_THRESHOLD = 90;

/** Baseline neutral mood score (`0..100`). */
export const BASELINE_MOOD = 50;

/** Mood score threshold at or above which the actor is Ecstatic and eligible for Inspirations. */
export const MOOD_ECSTATIC_THRESHOLD = 85;

/** Mood score threshold at or above which the actor is Happy. */
export const MOOD_HAPPY_THRESHOLD = 65;

/** Mood score threshold at or below which the actor is Stressed. */
export const MOOD_STRESSED_THRESHOLD = 35;

/** Mood score threshold at or below which the actor is Breaking and risks a Mental Break. */
export const MOOD_BREAKING_THRESHOLD = 20;

/** Mood score threshold at or below which the actor is Catatonic. */
export const MOOD_CATATONIC_THRESHOLD = 8;

/** Default duration in turns for triggered Inspirations. */
export const DEFAULT_INSPIRATION_DURATION_TURNS = 100;

/** Default duration in turns for triggered Mental Breaks. */
export const DEFAULT_MENTAL_BREAK_DURATION_TURNS = 30;

/** Neighborhood Chebyshev radius scanned for furniture, allies, and threats during needs evaluation. */
export const NEEDS_NEIGHBORHOOD_RADIUS = 4;

/** Rest recovery rate per tick when adjacent to or on a bed. */
export const NEED_REST_BED_RECOVERY = 10;

/** Shelter recovery rate per tick when indoors or roofed. */
export const NEED_SHELTER_INDOOR_RECOVERY = 4;

/** Comfort drain rate per tick in freezing or scorching temperatures. */
export const NEED_COMFORT_EXTREME_TEMP_DRAIN = 8;

/** Comfort recovery rate per tick near furniture in an ideal temperature band. */
export const NEED_COMFORT_IDEAL_FURNITURE_RECOVERY = 5;

/** Comfort recovery rate per tick near furniture outside the ideal temperature band. */
export const NEED_COMFORT_FURNITURE_RECOVERY = 2;

/** Social recovery rate per tick when near non-hostile actors. */
export const NEED_SOCIAL_ALLY_RECOVERY = 4;

/** Safety drain rate per tick when injured or threatened by nearby hostiles. */
export const NEED_SAFETY_THREAT_DRAIN = 6;

/** Safety recovery rate per tick when unthreatened. */
export const NEED_SAFETY_SAFE_RECOVERY = 3;

/** HP ratio below which an actor counts as critically injured for safety evaluation. */
export const NEED_INJURED_HP_RATIO = 0.5;

/** Thought mood delta when suffering extreme cold or scorching heat. */
export const THOUGHT_MOOD_EXTREME_TEMP = -14;

/** Thought mood delta when rest falls to critical exhaustion. */
export const THOUGHT_MOOD_EXHAUSTED = -18;

/** Thought mood delta when rest reaches high satisfaction. */
export const THOUGHT_MOOD_WELL_RESTED = 8;

/** Thought mood delta when comfort falls below low threshold. */
export const THOUGHT_MOOD_UNCOMFORTABLE = -8;

/** Neutral fallback facet value when an actor lacks an explicit temperament trait. */
export const DEFAULT_FACET_NEUTRAL = 50;

/** Aggression/cruelty facet cutoff selecting a berserk mental break. */
export const BREAK_FACET_BERSERK_THRESHOLD = 70;

/** Cowardice facet cutoff selecting a hide-in-room mental break. */
export const BREAK_FACET_HIDE_THRESHOLD = 70;

/** Aggression facet cutoff selecting a tantrum mental break. */
export const BREAK_FACET_TANTRUM_THRESHOLD = 55;

/** Bravery facet cutoff selecting an inspired valor boost. */
export const INSPIRATION_FACET_VALOR_THRESHOLD = 65;

/** Diligence/patience facet cutoff selecting an inspired craft boost. */
export const INSPIRATION_FACET_CRAFT_THRESHOLD = 60;

/** Minimum dampener multiplier applied by temperament resilience to negative mood swings. */
export const RESILIENCE_DAMPENER_MIN = 0.65;

/** Baseline dampener intercept applied before subtracting resilience scaling. */
export const RESILIENCE_DAMPENER_BASE = 1.15;

/** Resilience scaling slope dampening negative mood swings. */
export const RESILIENCE_DAMPENER_SLOPE = 0.004;

/** Multiplier converting accumulated stress into mood penalty. */
export const STRESS_MOOD_PENALTY_FACTOR = 0.2;

/** Morale bonus granted across attack, saves, and skills while ecstatic. */
export const MOOD_ECSTATIC_MORALE_BONUS = 1;

/** Morale penalty applied across attack, saves, and skills while breaking or catatonic. */
export const MOOD_BREAKING_MORALE_PENALTY = -2;

/** Canonical declarative thought slot key for freezing temperature discomfort. */
export const THOUGHT_SLOT_FREEZING_COLD = 'freezing_cold';

/** Canonical declarative thought slot key for scorching heat discomfort. */
export const THOUGHT_SLOT_SWELTERING_HEAT = 'sweltering_heat';

/** Canonical declarative thought slot key for critical exhaustion. */
export const THOUGHT_SLOT_EXHAUSTED = 'exhausted';

/** Canonical declarative thought slot key for high rest satisfaction. */
export const THOUGHT_SLOT_WELL_RESTED = 'well_rested';

/** Canonical declarative thought slot key for low comfort surroundings. */
export const THOUGHT_SLOT_UNCOMFORTABLE = 'uncomfortable';

/** Canonical declarative thought slot key for workshop item crafting satisfaction. */
export const THOUGHT_SLOT_CRAFTED_ITEM = 'crafted_item';

/** Canonical declarative thought slot key for survivors of raided macro sites. */
export const THOUGHT_SLOT_SITE_RAIDED = 'site_raided';

/** Canonical declarative thought slot key for survivors of burned macro sites. */
export const THOUGHT_SLOT_SITE_BURNED = 'site_burned';

/** Default duration in turns for medium-lived need-driven thoughts. */
export const THOUGHT_DURATION_MEDIUM = 60;

/** Default mood boost granted upon finishing a workshop crafting bill. */
export const THOUGHT_MOOD_CRAFTED_ITEM = 6;

/** Default duration in turns for workshop crafting satisfaction thoughts. */
export const THOUGHT_DURATION_CRAFTED_ITEM = 40;

/** Default maximum stacks allowed for workshop crafting thoughts. */
export const THOUGHT_MAX_STACKS_CRAFTED_ITEM = 2;

/** Default mood delta inflicted on traumatized survivors of a burned macro site. */
export const THOUGHT_MOOD_SITE_BURNED = -22;

/** Default mood delta inflicted on traumatized survivors of a raided macro site. */
export const THOUGHT_MOOD_SITE_RAIDED = -14;

/** Default duration in turns for macro-world site raid/burn trauma thoughts. */
export const THOUGHT_DURATION_SITE_TRAUMA = 120;

/** Default maximum stacks allowed for macro-world site raid/burn trauma thoughts. */
export const THOUGHT_MAX_STACKS_SITE_TRAUMA = 2;

/** Default situational thought descriptor used when `rules.psychology.thoughtDefinitions` omits a slot. */
export interface DefaultThoughtDescriptor {
  readonly thoughtId: string;
  readonly moodDelta: number;
  readonly durationTurns: number;
  readonly maxStacks?: number | undefined;
}

/** Fallback declarative thought definitions used when a campaign omits `rules.psychology.thoughtDefinitions` overrides. */
export const DEFAULT_THOUGHT_DEFINITIONS: Readonly<Record<string, DefaultThoughtDescriptor>> = {
  [THOUGHT_SLOT_FREEZING_COLD]: {
    thoughtId: 'freezing_cold',
    moodDelta: THOUGHT_MOOD_EXTREME_TEMP,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_SWELTERING_HEAT]: {
    thoughtId: 'sweltering_heat',
    moodDelta: THOUGHT_MOOD_EXTREME_TEMP,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_EXHAUSTED]: {
    thoughtId: 'exhausted',
    moodDelta: THOUGHT_MOOD_EXHAUSTED,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_WELL_RESTED]: {
    thoughtId: 'well_rested',
    moodDelta: THOUGHT_MOOD_WELL_RESTED,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_UNCOMFORTABLE]: {
    thoughtId: 'uncomfortable',
    moodDelta: THOUGHT_MOOD_UNCOMFORTABLE,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_CRAFTED_ITEM]: {
    thoughtId: 'crafted_item',
    moodDelta: THOUGHT_MOOD_CRAFTED_ITEM,
    durationTurns: THOUGHT_DURATION_CRAFTED_ITEM,
    maxStacks: THOUGHT_MAX_STACKS_CRAFTED_ITEM
  },
  [THOUGHT_SLOT_SITE_RAIDED]: {
    thoughtId: 'site_raid_trauma',
    moodDelta: THOUGHT_MOOD_SITE_RAIDED,
    durationTurns: THOUGHT_DURATION_SITE_TRAUMA,
    maxStacks: THOUGHT_MAX_STACKS_SITE_TRAUMA
  },
  [THOUGHT_SLOT_SITE_BURNED]: {
    thoughtId: 'site_raid_trauma',
    moodDelta: THOUGHT_MOOD_SITE_BURNED,
    durationTurns: THOUGHT_DURATION_SITE_TRAUMA,
    maxStacks: THOUGHT_MAX_STACKS_SITE_TRAUMA
  }
};
