/** Default game start hour (`08:00 AM`). */
export const DEFAULT_CLOCK_START_HOUR = 8;

/** Default seconds per global world turn (`1` D&D round = `6` seconds). */
export const DEFAULT_SECONDS_PER_TURN = 6;

/** Default hours per diurnal day (`24`). */
export const DEFAULT_HOURS_PER_DAY = 24;

/** Standard minutes per hour (`60`). */
export const MINUTES_PER_HOUR = 60;

/** Standard seconds per minute (`60`). */
export const SECONDS_PER_MINUTE = 60;

/** Standard action energy equivalence for 1 full turn (`100`). */
export const STANDARD_ENERGY_PER_TURN = 100;

/** GCD cadence step size matching Local Narrative (`10`), Nemesis (`25`), Rivalry (`25`), World Events (`100`). */
export const BULK_CADENCE_STEP_SIZE = 5;

/** Async UI chunk size (turns per animation yield) during rest/wait overlay progress. */
export const BULK_REST_CHUNK_TURNS = 240;

/**
 * Default SRD-aligned satiation loss per standard 1-turn action:
 * `0.035 * 14,400 turns/day = 504 satiation / 24h` (~1 daily trail ration of `500` satiation).
 */
export const DEFAULT_SATIATION_LOSS_PER_STANDARD_TURN = 0.035;

/** Phase icon badges displayed in the World Clock HUD telemetry chip. */
export const CLOCK_PHASE_ICONS: Readonly<Record<string, string>> = {
  dawn: '🌅',
  day: '☀️',
  dusk: '🌇',
  night: '🌙'
};

/** Cycling ellipses suffixes shown while advancing world time in bulk rest/wait overlays. */
export const BULK_REST_PROGRESS_DOTS: ReadonlyArray<string> = ['.', '..', '...'];
