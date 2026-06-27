/**
 * Default global drama budget when starting or resetting pacing tracking.
 */
export const DEFAULT_GLOBAL_DRAMA_BUDGET = 100;

/**
 * Maximum capacity for the global drama budget.
 */
export const MAX_GLOBAL_DRAMA_BUDGET = 200;

/**
 * Minimum number of turns that must elapse between major paced narrative events.
 */
export const MIN_TURNS_BETWEEN_MAJOR_EVENTS = 50;

/**
 * Rate at which the global drama budget regenerates each game turn.
 */
export const DRAMA_BUDGET_REGEN_PER_TURN = 1;

/**
 * The base probability (0.0 to 1.0) that a standard weapon will organically awaken into an artifact when scoring a kill.
 */
export const ARTIFACT_PROMOTION_CHANCE = 0.05;

/**
 * The interval (in global turns) at which the world event system evaluates background narrative events.
 */
export const WORLD_EVENT_TICK_INTERVAL = 100;

/**
 * The probability (0.0 to 1.0) per Area that a world event occurs during a tick.
 */
export const WORLD_EVENT_AREA_CHANCE = 0.05;

/**
 * The probability (0.0 to 1.0) per Faction that a world event occurs during a tick.
 */
export const WORLD_EVENT_FACTION_CHANCE = 0.05;
