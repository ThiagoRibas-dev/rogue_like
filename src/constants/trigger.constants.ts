/**
 * Standard placeholder variable bindings for the Trigger Composer system.
 * These are used by trigger templates to match and replace variables during compilation.
 */
export const COMPOSER_PLACEHOLDERS = {
  NEMESIS_ID: '$NEMESIS_ID',
  ALLY_ID: '$ALLY_ID',
  AREA_ID: '$AREA_ID',
  FACTION_ID: '$FACTION_ID',
  ARTIFACT_ID: '$ARTIFACT_ID',
  NEMESIS_NAME: '$NEMESIS_NAME',
  CLUE_ITEM_ID: '$CLUE_ITEM_ID',
  STANDING_GAIN: '$STANDING_GAIN'
} as const;

/**
 * A ReadonlyArray of all default/expected placeholder strings for validation checks or editor suggestions.
 */
export const ALL_COMPOSER_PLACEHOLDERS: ReadonlyArray<string> = Object.values(COMPOSER_PLACEHOLDERS);

/**
 * Maximum recursive loops allowed in processGlobalTriggers before throwing runaway error.
 */
export const MAX_TRIGGER_LOOPS = 500;
