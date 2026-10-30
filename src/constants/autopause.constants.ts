/**
 * Configuration and thresholds governing automatic RTwP pausing.
 *
 * These preferences are user settings persisted in `localStorage` via
 * `PlayerSettings` (see `src/core/settings.ts`). They never live in `GameState`,
 * because they are player preferences rather than per-save simulation state.
 */

/**
 * Reason a run-time automatic pause was triggered.
 * Used both as the evaluator's return discriminator and as a stable label key.
 */
export type AutoPauseReason = 'enemy_spotted' | 'nemesis_spotted' | 'low_health' | 'detrimental_status' | 'narrative';

/**
 * User-tunable auto-pause preferences for Real-Time with Pause mode.
 */
export interface AutoPauseSettings {
  /** Pause when a hostile actor newly enters the player's field of view. */
  readonly pauseOnEnemySpotted: boolean;
  /** Pause when a nemesis-tier actor newly enters the player's field of view. */
  readonly pauseOnNemesisSpotted: boolean;
  /** Pause when player health drops below `lowHealthThresholdPercent`. */
  readonly pauseOnLowHealth: boolean;
  /** Health percentage (1-100) at or below which a low-health pause triggers. */
  readonly lowHealthThresholdPercent: number;
  /** Pause when the player gains a status effect flagged `detrimental` in the campaign registry. */
  readonly pauseOnDetrimentalStatus: boolean;
  /** Pause when narrative/drama events fire (clues, schemes, world events, dialogue). */
  readonly pauseOnNarrative: boolean;
}

/** Default auto-pause configuration applied on first launch and on settings reset. */
export const DEFAULT_AUTO_PAUSE_SETTINGS: AutoPauseSettings = {
  pauseOnEnemySpotted: true,
  pauseOnNemesisSpotted: true,
  pauseOnLowHealth: true,
  lowHealthThresholdPercent: 25,
  pauseOnDetrimentalStatus: true,
  pauseOnNarrative: false
};

/** Lowest accepted user-supplied low-health threshold percentage. */
export const MIN_LOW_HEALTH_PERCENT = 5;

/** Highest accepted user-supplied low-health threshold percentage. */
export const MAX_LOW_HEALTH_PERCENT = 90;

/** Multiplier converting a health ratio into a 0-100 percentage. */
export const PERCENT_SCALE = 100;

/**
 * Human-readable message fragments for each auto-pause reason, appended to the
 * message log so the player always knows why the simulation stopped.
 */
export const AUTOPAUSE_REASON_LABELS: Readonly<Record<AutoPauseReason, string>> = {
  enemy_spotted: 'Hostile spotted',
  nemesis_spotted: 'Nemesis spotted',
  low_health: 'Health critical',
  detrimental_status: 'Detrimental status effect',
  narrative: 'Narrative development'
};
