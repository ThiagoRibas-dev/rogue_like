/**
 * Minimum PIS (Player Interaction Score) required for an entity to be eligible for promotion.
 */
export const PIS_PROMOTION_THRESHOLD = 5;

/**
 * Minimum PIS required for an entity to be eligible for cheating death.
 */
export const PIS_CHEAT_DEATH_THRESHOLD = 3;

/**
 * Base probability that an eligible entity will cheat death when killed.
 */
export const CHEAT_DEATH_BASE_CHANCE = 0.3;

/**
 * Global cooldown (in turns) between ANY cheat death events occurring in the game.
 * Prevents multiple nemeses from cheating death simultaneously.
 */
export const CHEAT_DEATH_GLOBAL_COOLDOWN = 100;

/**
 * Entity-specific cooldown (in turns) before the same entity can cheat death again.
 */
export const CHEAT_DEATH_ENTITY_COOLDOWN = 200;

/**
 * Minimum turns before a "dead" entity returns and is placed back into the world.
 */
export const CHEAT_DEATH_RETURN_DELAY_MIN = 50;

/**
 * Maximum turns before a "dead" entity returns.
 */
export const CHEAT_DEATH_RETURN_DELAY_MAX = 150;

/**
 * Maximum number of scars an entity can accumulate from cheating death.
 */
export const MAX_SCARS_PER_ENTITY = 5;

/**
 * Turns before a vacancy in the hierarchy is automatically filled by a subordinate.
 */
export const VACANCY_FILL_DELAY = 30;

/**
 * Turn duration delay (in ms) to pause the game loop after a dramatic narrative event.
 */
export const DRAMATIC_PAUSE_DURATION_MS = 500;

/**
 * Cooldown (in turns) before a nemesis can bark again upon encountering the player.
 */
export const NEMESIS_ENCOUNTER_COOLDOWN_TURNS = 500;
