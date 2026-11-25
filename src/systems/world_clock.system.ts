import { DAYS_PER_SEASON, MACRO_SEASONS, SEASONS_PER_YEAR } from '../constants/macro_world.constants.ts';
import {
  CLOCK_PHASE_ICONS,
  DEFAULT_CLOCK_START_HOUR,
  DEFAULT_HOURS_PER_DAY,
  DEFAULT_SECONDS_PER_TURN,
  DEFAULT_TURN_UNIT_PLURAL,
  DEFAULT_TURN_UNIT_SHORT,
  DEFAULT_TURN_UNIT_SINGULAR,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE
} from '../constants/world_clock.constants.ts';
import type { MacroSeason } from '../types/macro_world.types.ts';
import { getComponent } from '../core/ecs.ts';
import { getRuleset } from '../rulesets/registry.ts';
import type {
  AreaEnvironmentType,
  AreaIllumination,
  RestPressureConfig,
  WorldClockConfig
} from '../types/campaign.types.ts';
import { ComponentType, type FighterComponent, type PositionComponent } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { isHostile } from '../utils/faction.ts';
import { isTileKeyInFov } from '../map/map_accessor.ts';

/** Fallback proximity radius (tiles) used when `cachedFov` is unpopulated in headless unit tests. */
const HEADLESS_VISIBLE_THREAT_RADIUS = 8;

/** Default camp ambush probability per watch chunk in unprotected dungeon areas (`15%`). */
const DEFAULT_REST_AMBUSH_CHANCE_PER_WATCH = 0.15;

/** Default watch duration per rest check chunk in hours (`2h`). */
const DEFAULT_REST_WATCH_DURATION_HOURS = 2;

/** Default scheme advancement speed multiplier during rest/wait (`1x`). */
const DEFAULT_REST_SCHEME_TICK_MULTIPLIER = 1;

/** Default area respawn rate multiplier during elapsed world time (`1x`). */
const DEFAULT_REST_RESPAWN_RATE_MULTIPLIER = 1;

/** Default alert/alarm decay turns during calm time (`50`). */
const DEFAULT_REST_ALARM_DECAY_TURNS = 50;

/** Canonical default Tier 1 Rest Pressure configuration when omitted from `rules.json` and `areas.json`. */
export const DEFAULT_REST_PRESSURE_CONFIG: RestPressureConfig = {
  safeRest: false,
  ambushChancePerWatch: DEFAULT_REST_AMBUSH_CHANCE_PER_WATCH,
  watchDurationHours: DEFAULT_REST_WATCH_DURATION_HOURS,
  schemeTickMultiplier: DEFAULT_REST_SCHEME_TICK_MULTIPLIER,
  respawnRateMultiplier: DEFAULT_REST_RESPAWN_RATE_MULTIPLIER,
  alarmDecayTurns: DEFAULT_REST_ALARM_DECAY_TURNS
};

/** Canonical default Tier 1 Console diurnal clock schedule (24h day starting 08:00 AM, Dawn 05:00, Day 07:00, Dusk 18:00, Night 20:00). */
export const DEFAULT_WORLD_CLOCK_CONFIG: WorldClockConfig = {
  secondsPerGlobalTurn: DEFAULT_SECONDS_PER_TURN,
  startHour: DEFAULT_CLOCK_START_HOUR,
  hoursPerDay: DEFAULT_HOURS_PER_DAY,
  turnUnitShort: DEFAULT_TURN_UNIT_SHORT,
  turnUnitSingular: DEFAULT_TURN_UNIT_SINGULAR,
  turnUnitPlural: DEFAULT_TURN_UNIT_PLURAL,
  waitTargets: ['dawn', 'night'],
  phases: [
    { id: 'night', label: 'Night', startHour: 0, skyIllumination: 'shadowy', isNaturalSunlight: false },
    { id: 'dawn', label: 'Dawn', startHour: 5, skyIllumination: 'shadowy', isNaturalSunlight: false },
    { id: 'day', label: 'Day', startHour: 7, skyIllumination: 'bright', isNaturalSunlight: true },
    { id: 'dusk', label: 'Dusk', startHour: 18, skyIllumination: 'shadowy', isNaturalSunlight: false },
    { id: 'night', label: 'Night', startHour: 20, skyIllumination: 'shadowy', isNaturalSunlight: false }
  ]
};

/** Diurnal clock snapshot computed from `GameState.globalTurn` and `rules.worldClock`. */
export interface WorldClockReading {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly phaseId: string;
  readonly phaseLabel: string;
  readonly skyIllumination: AreaIllumination;
  readonly isNaturalSunlight: boolean;
}

/** Resolved physical environment and lighting profile for the currently active area. */
export interface AreaEnvironmentProfile {
  readonly environmentType: AreaEnvironmentType;
  readonly illumination: AreaIllumination;
  readonly isNaturalSunlight: boolean;
  readonly clock: WorldClockReading;
}

/**
 * Resolves the effective `WorldClockConfig` for a game state.
 * Precedence: `campaign.rules.worldClock` -> `RulesetContract.getDefaultWorldClockConfig()` -> `DEFAULT_WORLD_CLOCK_CONFIG`.
 * Optional unit display labels (`turnUnitShort`, `turnUnitSingular`, `turnUnitPlural`) fall back to the ruleset/console base if omitted.
 */
export function getEffectiveWorldClockConfig(state: GameState): WorldClockConfig {
  const rulesetDefault = getRuleset(state.campaign?.manifest?.rulesetId).getDefaultWorldClockConfig?.();
  const base = rulesetDefault ?? DEFAULT_WORLD_CLOCK_CONFIG;
  const campaignClock = state.campaign?.rules?.worldClock;
  if (!campaignClock) return base;

  const turnUnitShort = campaignClock.turnUnitShort ?? base.turnUnitShort;
  const turnUnitSingular = campaignClock.turnUnitSingular ?? base.turnUnitSingular;
  const turnUnitPlural = campaignClock.turnUnitPlural ?? base.turnUnitPlural;

  return {
    ...campaignClock,
    ...(turnUnitShort !== undefined ? { turnUnitShort } : {}),
    ...(turnUnitSingular !== undefined ? { turnUnitSingular } : {}),
    ...(turnUnitPlural !== undefined ? { turnUnitPlural } : {})
  };
}

/**
 * Resolves the effective `RestPressureConfig` ("Doom Clock") for `areaIdOverride ?? state.currentAreaId`,
 * layering area overrides on top of campaign `rules.restPressure` and safe-zone defaults.
 *
 * @param state Current immutable GameState.
 * @param areaIdOverride Optional target area identifier.
 * @returns Resolved `RestPressureConfig`.
 */
export function resolveAreaRestPressure(state: GameState, areaIdOverride?: string): RestPressureConfig {
  const area = state.campaign.areas[areaIdOverride ?? state.currentAreaId];
  const campaignDefault = state.campaign.rules.restPressure;
  const base = campaignDefault ?? DEFAULT_REST_PRESSURE_CONFIG;

  if (area?.restPressure) {
    const ov = area.restPressure;
    return {
      safeRest: ov.safeRest ?? base.safeRest,
      ambushChancePerWatch: ov.ambushChancePerWatch ?? base.ambushChancePerWatch,
      watchDurationHours: ov.watchDurationHours ?? base.watchDurationHours,
      schemeTickMultiplier: ov.schemeTickMultiplier ?? base.schemeTickMultiplier,
      respawnRateMultiplier: ov.respawnRateMultiplier ?? base.respawnRateMultiplier,
      alarmDecayTurns: ov.alarmDecayTurns ?? base.alarmDecayTurns
    };
  }

  if (area?.tags?.includes('safe')) {
    return {
      ...base,
      safeRest: true,
      ambushChancePerWatch: 0
    };
  }

  return base;
}

/**
 * Resolves the display label for a phase ID configured in `rules.worldClock.phases`.
 */
export function getClockPhaseLabel(state: GameState, phaseId: string): string {
  const match = getEffectiveWorldClockConfig(state).phases.find((p) => p.id === phaseId);
  return match?.label ?? phaseId;
}

/**
 * Computes the matching phase entry from `config.phases` for a given hour (`0..hoursPerDay - 1`).
 */
function resolvePhaseForHour(config: WorldClockConfig, hour: number): WorldClockConfig['phases'][number] {
  const sorted = [...config.phases].sort((a, b) => a.startHour - b.startHour);
  let active = sorted[sorted.length - 1] ?? DEFAULT_WORLD_CLOCK_CONFIG.phases[0]!;
  for (const phase of sorted) {
    if (hour >= phase.startHour) {
      active = phase;
    }
  }
  return active;
}

/**
 * Computes a diurnal `WorldClockReading` purely from `state.globalTurn` and `rules.worldClock`.
 *
 * @param state Current immutable GameState.
 * @param turnOffset Optional non-negative turn offset added to `state.globalTurn`.
 * @returns `WorldClockReading` with 1-based day, 24h hour/minute, and active phase metadata.
 */
export function readWorldClock(state: GameState, turnOffset = 0): WorldClockReading {
  const config = getEffectiveWorldClockConfig(state);
  const effectiveTurn = Math.max(0, (state.globalTurn || 0) + turnOffset);
  const startOffsetSeconds = config.startHour * MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
  const totalSeconds = startOffsetSeconds + effectiveTurn * config.secondsPerGlobalTurn;
  const secondsPerDay = config.hoursPerDay * MINUTES_PER_HOUR * SECONDS_PER_MINUTE;

  const day = Math.floor(totalSeconds / secondsPerDay) + 1;
  const secWithinDay = totalSeconds % secondsPerDay;
  const hour = Math.floor(secWithinDay / (MINUTES_PER_HOUR * SECONDS_PER_MINUTE));
  const minute = Math.floor((secWithinDay % (MINUTES_PER_HOUR * SECONDS_PER_MINUTE)) / SECONDS_PER_MINUTE);
  const phase = resolvePhaseForHour(config, hour);

  return {
    day,
    hour,
    minute,
    phaseId: phase.id,
    phaseLabel: phase.label,
    skyIllumination: phase.skyIllumination,
    isNaturalSunlight: phase.isNaturalSunlight
  };
}

/**
 * Formats a concise human-readable clock string (e.g., `"☀️ Day 1 08:00 (Day)"`).
 */
export function formatWorldClockShort(clock: WorldClockReading): string {
  const icon = CLOCK_PHASE_ICONS[clock.phaseId] ?? '🕒';
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');
  return `${icon} Day ${clock.day} ${hh}:${mm} (${clock.phaseLabel})`;
}

/**
 * Resolves the physical environment (`'outdoors' | 'indoors' | 'underground'`), ambient illumination,
 * and natural sunlight flag for `areaIdOverride ?? state.currentAreaId`.
 * Areas omitting `environmentType` default cleanly to `'indoors'` + `'bright'` for legacy compatibility.
 */
export function resolveAreaEnvironmentProfile(state: GameState, areaIdOverride?: string): AreaEnvironmentProfile {
  const clock = readWorldClock(state);
  const area = state.campaign.areas[areaIdOverride ?? state.currentAreaId];
  const environmentType: AreaEnvironmentType = area?.environmentType ?? 'indoors';

  if (environmentType === 'outdoors') {
    return {
      environmentType: 'outdoors',
      illumination: clock.skyIllumination,
      isNaturalSunlight: clock.isNaturalSunlight,
      clock
    };
  }

  if (environmentType === 'underground') {
    return {
      environmentType: 'underground',
      illumination: area?.ambientIllumination ?? 'darkness',
      isNaturalSunlight: false,
      clock
    };
  }

  return {
    environmentType: 'indoors',
    illumination: area?.ambientIllumination ?? 'bright',
    isNaturalSunlight: false,
    clock
  };
}

/**
 * Computes the exact positive number of world turns until the next onset of `targetPhaseId`.
 * Returns `undefined` if `targetPhaseId` does not exist in `rules.worldClock.phases`.
 */
export function computeTurnsUntilPhase(state: GameState, targetPhaseId: string): number | undefined {
  const config = getEffectiveWorldClockConfig(state);
  const sorted = [...config.phases].sort((a, b) => a.startHour - b.startHour);
  const matchingStarts = sorted.filter((p) => p.id === targetPhaseId && p.startHour > 0).map((p) => p.startHour);
  if (matchingStarts.length === 0) {
    const anyMatch = sorted.filter((p) => p.id === targetPhaseId).map((p) => p.startHour);
    if (anyMatch.length === 0) return undefined;
    matchingStarts.push(...anyMatch);
  }

  const secondsPerHour = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
  const secondsPerDay = config.hoursPerDay * secondsPerHour;
  const startOffsetSeconds = config.startHour * secondsPerHour;
  const currentTotalSeconds = startOffsetSeconds + Math.max(0, state.globalTurn || 0) * config.secondsPerGlobalTurn;
  const currentSecInDay = currentTotalSeconds % secondsPerDay;

  let minDeltaSeconds = Infinity;
  for (const targetHour of matchingStarts) {
    const targetSec = targetHour * secondsPerHour;
    const delta =
      targetSec > currentSecInDay ? targetSec - currentSecInDay : secondsPerDay - currentSecInDay + targetSec;
    if (delta > 0 && delta < minDeltaSeconds) {
      minDeltaSeconds = delta;
    }
  }

  if (!Number.isFinite(minDeltaSeconds)) return undefined;
  return Math.max(1, Math.ceil(minDeltaSeconds / config.secondsPerGlobalTurn));
}

/**
 * Checks whether any living hostile entity in the active area is visible to `actorId`
 * (using `state.cachedFov` when populated, or a headless distance radius when empty).
 */
export function isActorThreatenedByVisibleHostiles(state: GameState, actorId: EntityId): boolean {
  const actorPos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  if (!actorPos) return false;
  const useFov = state.cachedFov.size > 0;

  for (const candId of state.entities) {
    if (candId === actorId) continue;
    const fighter = getComponent(state, candId, ComponentType.Fighter) as FighterComponent | undefined;
    if (!fighter || fighter.hp <= 0) continue;
    if (!isHostile(state, actorId, candId)) continue;

    const candPos = getComponent(state, candId, ComponentType.Position) as PositionComponent | undefined;
    if (!candPos) continue;

    if (useFov) {
      if (isTileKeyInFov(state, candPos.x, candPos.y)) return true;
    } else {
      const dist = Math.max(Math.abs(candPos.x - actorPos.x), Math.abs(candPos.y - actorPos.y));
      if (dist <= HEADLESS_VISIBLE_THREAT_RADIUS) return true;
    }
  }

  return false;
}

/**
 * Checks whether one or more whole clock hours (derived from active `WorldClockConfig.secondsPerGlobalTurn`)
 * were crossed between `prevTurn` and `nextTurn` and invokes the active ruleset's `onWorldHourElapsed` hook.
 *
 * @param state Current GameState at `nextTurn`.
 * @param prevTurn Turn index prior to advancing.
 * @param nextTurn Turn index after advancing.
 * @returns Updated GameState.
 */
export function applyElapsedWorldHours(state: GameState, prevTurn: number, nextTurn: number): GameState {
  const clock = getEffectiveWorldClockConfig(state);
  const secondsPerHour = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
  const prevHours = Math.floor((Math.max(0, prevTurn) * clock.secondsPerGlobalTurn) / secondsPerHour);
  const nextHours = Math.floor((Math.max(0, nextTurn) * clock.secondsPerGlobalTurn) / secondsPerHour);
  const hoursElapsed = nextHours - prevHours;
  if (hoursElapsed <= 0) return state;

  const ruleset = getRuleset(state.campaign?.manifest?.rulesetId);
  return ruleset.onWorldHourElapsed ? ruleset.onWorldHourElapsed(state, hoursElapsed) : state;
}

/** Deterministic seasonal calendar reading projected from `readWorldClock(state, turnOffset).day`. */
export interface SeasonalCalendarReading {
  readonly year: number;
  readonly season: MacroSeason;
  readonly seasonIndex: number;
  readonly dayOfSeason: number;
  readonly dayOfYear: number;
}

/**
 * Computes the current seasonal calendar reading (`year`, `season`, `dayOfSeason`, `dayOfYear`)
 * deterministically from `state.globalTurn` via {@link readWorldClock}.
 *
 * @param state Current immutable GameState.
 * @param turnOffset Optional non-negative turn offset.
 * @returns Seasonal calendar reading.
 */
export function readSeasonalCalendar(state: GameState, turnOffset = 0): SeasonalCalendarReading {
  const clockDay = Math.max(1, readWorldClock(state, turnOffset).day);
  const daysPerYear = DAYS_PER_SEASON * SEASONS_PER_YEAR;
  const zeroBasedDay = clockDay - 1;
  const year = Math.floor(zeroBasedDay / daysPerYear) + 1;
  const dayOfYear = (zeroBasedDay % daysPerYear) + 1;
  const seasonIndex = Math.floor((dayOfYear - 1) / DAYS_PER_SEASON);
  const dayOfSeason = ((dayOfYear - 1) % DAYS_PER_SEASON) + 1;
  const season = MACRO_SEASONS[seasonIndex] ?? 'spring';
  return {
    year,
    season,
    seasonIndex,
    dayOfSeason,
    dayOfYear
  };
}
