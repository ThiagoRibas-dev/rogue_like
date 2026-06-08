/**
 * Enum defining the different hunger states.
 */
export const enum HungerState {
  Satiated = 'Satiated',
  Normal = 'Normal',
  Hungry = 'Hungry',
  Starving = 'Starving'
}

/**
 * Thresholds for satiation points to reach specific hunger states.
 */
export const HUNGER_THRESHOLDS = {
  SATIATED: 1500,
  NORMAL: 1000,
  HUNGRY: 300,
  STARVING: 0
} as const;

/**
 * The maximum satiation a character can have.
 */
export const MAX_SATIATION = 2000;
