import {
  DEFAULT_HOURS_PER_DAY,
  DEFAULT_SECONDS_PER_TURN,
  DEFAULT_TURN_UNIT_PLURAL,
  DEFAULT_TURN_UNIT_SHORT,
  DEFAULT_TURN_UNIT_SINGULAR,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE
} from '../constants/world_clock.constants.ts';

/**
 * Clock-scale and display-unit metadata used to convert global turn counts into real-world time
 * without hardcoding a ruleset-specific turn duration at Tier 1 Console.
 */
export interface TurnDurationScale {
  readonly secondsPerGlobalTurn: number;
  readonly hoursPerDay?: number | undefined;
  readonly turnUnitShort?: string | undefined;
  readonly turnUnitSingular?: string | undefined;
  readonly turnUnitPlural?: string | undefined;
}

/**
 * Computes the number of global turns per in-game minute for the given clock scale
 * (defaults to `DEFAULT_SECONDS_PER_TURN`).
 *
 * @param scale Optional clock scale metadata.
 * @returns Turns per minute.
 */
export function getTurnsPerMinute(scale?: TurnDurationScale): number {
  const spt = Math.max(1, scale?.secondsPerGlobalTurn ?? DEFAULT_SECONDS_PER_TURN);
  return SECONDS_PER_MINUTE / spt;
}

/**
 * Computes the number of global turns per in-game hour for the given clock scale
 * (defaults to `DEFAULT_SECONDS_PER_TURN`).
 *
 * @param scale Optional clock scale metadata.
 * @returns Turns per hour.
 */
export function getTurnsPerHour(scale?: TurnDurationScale): number {
  const spt = Math.max(1, scale?.secondsPerGlobalTurn ?? DEFAULT_SECONDS_PER_TURN);
  return (MINUTES_PER_HOUR * SECONDS_PER_MINUTE) / spt;
}

/**
 * Computes the number of global turns per diurnal day for the given clock scale
 * (defaults to `DEFAULT_SECONDS_PER_TURN` and `DEFAULT_HOURS_PER_DAY`).
 *
 * @param scale Optional clock scale metadata.
 * @returns Turns per diurnal day.
 */
export function getTurnsPerDay(scale?: TurnDurationScale): number {
  const hoursPerDay = Math.max(1, scale?.hoursPerDay ?? DEFAULT_HOURS_PER_DAY);
  return getTurnsPerHour(scale) * hoursPerDay;
}

/**
 * Formats a turn count into a compact, monotonically transitioning UI pill string
 * (`Perm`, `Xd`, `Xh`, `Xm`, or `X<turnUnitShort>`).
 *
 * @param turns Remaining duration in global turns.
 * @param isPermanent Whether the effect is permanent.
 * @param scale Optional active `WorldClockConfig` / `TurnDurationScale`.
 * @returns Compact UI badge duration string.
 */
export function formatTurnDurationCompact(turns: number, isPermanent?: boolean, scale?: TurnDurationScale): string {
  if (isPermanent === true) return 'Perm';
  const clamped = Math.max(0, Math.floor(turns));
  const spt = Math.max(1, scale?.secondsPerGlobalTurn ?? DEFAULT_SECONDS_PER_TURN);
  const hoursPerDay = Math.max(1, scale?.hoursPerDay ?? DEFAULT_HOURS_PER_DAY);
  const shortUnit = scale?.turnUnitShort ?? DEFAULT_TURN_UNIT_SHORT;

  const totalSeconds = clamped * spt;
  const secondsPerHour = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
  const secondsPerDay = hoursPerDay * secondsPerHour;

  if (totalSeconds >= secondsPerDay) return `${Math.floor(totalSeconds / secondsPerDay)}d`;
  if (totalSeconds >= secondsPerHour) return `${Math.floor(totalSeconds / secondsPerHour)}h`;
  if (totalSeconds >= SECONDS_PER_MINUTE) return `${Math.floor(totalSeconds / SECONDS_PER_MINUTE)}m`;
  return `${clamped}${shortUnit}`;
}

/**
 * Formats a turn count into a verbose tooltip string showing coarse units alongside exact turns/rounds
 * (e.g., `"1m (10 rounds)"`, `"1h 30m (900 rounds)"`, `"6 turns"`, `"Permanent"`).
 *
 * @param turns Remaining duration in global turns.
 * @param isPermanent Whether the effect is permanent.
 * @param scale Optional active `WorldClockConfig` / `TurnDurationScale`.
 * @returns Verbose human-readable duration string.
 */
export function formatTurnDurationVerbose(turns: number, isPermanent?: boolean, scale?: TurnDurationScale): string {
  if (isPermanent === true) return 'Permanent';
  const clamped = Math.max(0, Math.floor(turns));
  const spt = Math.max(1, scale?.secondsPerGlobalTurn ?? DEFAULT_SECONDS_PER_TURN);
  const hoursPerDay = Math.max(1, scale?.hoursPerDay ?? DEFAULT_HOURS_PER_DAY);
  const singular = scale?.turnUnitSingular ?? DEFAULT_TURN_UNIT_SINGULAR;
  const plural = scale?.turnUnitPlural ?? DEFAULT_TURN_UNIT_PLURAL;
  const unitLabel = `${clamped} ${clamped === 1 ? singular : plural}`;

  const totalSeconds = clamped * spt;
  const secondsPerHour = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
  const secondsPerDay = hoursPerDay * secondsPerHour;

  if (totalSeconds < SECONDS_PER_MINUTE) return unitLabel;

  if (totalSeconds >= secondsPerDay) {
    const days = Math.floor(totalSeconds / secondsPerDay);
    const remHours = Math.floor((totalSeconds % secondsPerDay) / secondsPerHour);
    const prefix = remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
    return `${prefix} (${unitLabel})`;
  }
  if (totalSeconds >= secondsPerHour) {
    const hours = Math.floor(totalSeconds / secondsPerHour);
    const remMins = Math.floor((totalSeconds % secondsPerHour) / SECONDS_PER_MINUTE);
    const prefix = remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
    return `${prefix} (${unitLabel})`;
  }
  const mins = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const remSecs = totalSeconds % SECONDS_PER_MINUTE;
  const prefix = remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  return `${prefix} (${unitLabel})`;
}
