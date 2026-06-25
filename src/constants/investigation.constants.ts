/**
 * Constants governing the procedural investigation and scheme system.
 */

/**
 * The number of turns the player can go without discovering a plot clue
 * before the investigation is considered "stalled".
 * When this threshold is crossed, the system emits an InvestigationStalledEvent
 * to trigger narrative "escape hatches" (like spawning a fallback clue or witness).
 */
export const INVESTIGATION_STALL_THRESHOLD = 500;
