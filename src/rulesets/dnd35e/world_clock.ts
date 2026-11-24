import { DEFAULT_CLOCK_START_HOUR, DEFAULT_HOURS_PER_DAY } from '../../constants/world_clock.constants.ts';
import type { WorldClockConfig } from '../../types/campaign.types.ts';

/** Canonical D&D 3.5e combat round duration in real-world seconds (`6` seconds per round, PHB p. 138). */
const DND35E_SECONDS_PER_ROUND = 6;

/**
 * Canonical D&D 3.5e SRD diurnal clock and 6-second round scale configuration
 * (`10` rounds/minute, `600` rounds/hour, `14,400` rounds/24h day).
 */
export const DND35E_DEFAULT_WORLD_CLOCK_CONFIG: WorldClockConfig = {
  secondsPerGlobalTurn: DND35E_SECONDS_PER_ROUND,
  startHour: DEFAULT_CLOCK_START_HOUR,
  hoursPerDay: DEFAULT_HOURS_PER_DAY,
  turnUnitShort: 'r',
  turnUnitSingular: 'round',
  turnUnitPlural: 'rounds',
  waitTargets: ['dawn', 'night'],
  phases: [
    { id: 'night', label: 'Night', startHour: 0, skyIllumination: 'shadowy', isNaturalSunlight: false },
    { id: 'dawn', label: 'Dawn', startHour: 5, skyIllumination: 'shadowy', isNaturalSunlight: false },
    { id: 'day', label: 'Day', startHour: 7, skyIllumination: 'bright', isNaturalSunlight: true },
    { id: 'dusk', label: 'Dusk', startHour: 18, skyIllumination: 'shadowy', isNaturalSunlight: false },
    { id: 'night', label: 'Night', startHour: 20, skyIllumination: 'shadowy', isNaturalSunlight: false }
  ]
};
