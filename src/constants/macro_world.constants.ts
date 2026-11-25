import type { MacroBiomeKind, MacroSeason, MacroSiteStatus, MacroWeatherKind } from '../types/macro_world.types.ts';

/** Default coarse continental map width in macro regions. */
export const DEFAULT_MACRO_WORLD_WIDTH = 32;

/** Default coarse continental map height in macro regions. */
export const DEFAULT_MACRO_WORLD_HEIGHT = 32;

/** Default number of years simulated during offline Legends worldgen. */
export const DEFAULT_LEGENDS_HISTORY_YEARS = 150;

/** Default number of named sites seeded across the continent. */
export const DEFAULT_MACRO_SITE_COUNT = 12;

/** Default world turns between Ring 2 macro-world tick dispatches. */
export const DEFAULT_MACRO_TICK_INTERVAL_TURNS = 100;

/** Default seconds per global turn used when campaign `rules.worldClock` is omitted. */
export const DEFAULT_MACRO_SECONDS_PER_TURN = 60;

/** Default hours per calendar day used when campaign `rules.worldClock` is omitted. */
export const DEFAULT_MACRO_HOURS_PER_DAY = 24;

/** Canonical synthetic rule identifier for Ring 2 macro-world rumors injected into gossip queues. */
export const MACRO_WORLD_RUMOR_RULE_ID = 'macro_world_rumor';

/** Default turn delay before a Ring 2 macro-world rumor reaches eligible NPC gossip pools. */
export const MACRO_WORLD_RUMOR_DELAY_TURNS = 5;

/** Deterministic seed offset separating macro continent generation from local chunks. */
export const DEFAULT_WORLDGEN_SEED_OFFSET = 48185;

/** Number of in-game days per seasonal calendar quarter. */
export const DAYS_PER_SEASON = 30;

/** Number of seasons per full calendar year. */
export const SEASONS_PER_YEAR = 4;

/** Ordered seasonal calendar cycle. */
export const MACRO_SEASONS: ReadonlyArray<MacroSeason> = ['spring', 'summer', 'autumn', 'winter'];

/** Maximum simultaneous active trade caravans on the continent. */
export const MAX_MACRO_CARAVANS = 12;

/** Maximum simultaneous roaming faction armies/warbands. */
export const MAX_MACRO_ARMIES = 10;

/** Maximum active traveling regional weather fronts. */
export const MAX_WEATHER_FRONTS = 4;

/** Maximum historical events retained in `LegendsArchive.events`. */
export const MAX_MACRO_EVENT_ARCHIVE = 500;

/** Maximum materialized delta IDs retained for idempotent site stamping. */
export const MAX_MATERIALIZED_DELTA_IDS = 1000;

/** Maximum pending site deltas retained in `MacroWorldState.pendingSiteDeltas`. */
export const MAX_PENDING_SITE_DELTAS = 160;

/** Maximum surviving living historical legends promoted into `persistentEntities` at Turn 1. */
export const MAX_SEEDED_LIVING_LEGENDS = 6;

/** Maximum historical figures generated/tracked in offline Legends worldgen. */
export const MAX_WORLD_HISTORICAL_FIGURES = 48;

/** Maximum unique historical artifacts forged across offline history. */
export const MAX_WORLD_ARTIFACTS = 18;

/** Maximum settlement prosperity rating. */
export const MAX_SITE_PROSPERITY = 100;

/** Minimum settlement prosperity rating. */
export const MIN_SITE_PROSPERITY = 0;

/** Maximum chunk offset radius around streaming origin `(0, 0)` where showcase sites anchor. */
export const STREAMING_OVERWORLD_SITE_SPAN_CHUNKS = 8;

/** Local ember temperature increase (°C) stamped on recently burned sites. */
export const BURNT_SITE_EMBER_TEMP_DELTA_C = 60;

/** Default spatial radius (in macro cells) covered by a single weather front. */
export const WEATHER_FRONT_BASE_RADIUS_CELLS = 5;

/** Normalized continental sea level elevation threshold (`0..1`). */
export const CONTINENT_SEA_LEVEL = 0.34;

/** Normalized coastal threshold (`0..1`). */
export const CONTINENT_COAST_MAX_ELEV = 0.4;

/** Normalized hill elevation threshold (`0..1`). */
export const CONTINENT_HILL_MIN_ELEV = 0.65;

/** Normalized mountain elevation threshold (`0..1`). */
export const CONTINENT_MOUNTAIN_MIN_ELEV = 0.78;

/** Number of years per generated era span during Legends worldgen. */
export const YEARS_PER_LEGENDS_ERA = 50;

/** Default prosperity restored when a friendly caravan completes delivery. */
export const CARAVAN_DELIVERY_PROSPERITY_GAIN = 6;

/** Initial food stock assigned to newly synthesized continental settlements. */
export const SITE_INITIAL_FOOD_STOCK = 75;

/** Minimum Chebyshev separation (in continent cells) enforced between initial sites. */
export const SITE_MIN_SEPARATION_CELLS = 3;

/** Maximum number of mountain/hill peaks carved into continental rivers. */
export const CONTINENT_PEAK_RIVER_COUNT = 4;

/** Initial duration (in Ring 2 ticks) of the starting weather front. */
export const WEATHER_INITIAL_DURATION_TICKS = 8;

/** Minimum food stock threshold allowing an intact site's prosperity to grow. */
export const SITE_FOOD_GROWTH_THRESHOLD = 40;

/** Minimum food stock clamp for settlements. */
export const SITE_MIN_FOOD_STOCK = 10;

/** Maximum food stock clamp for settlements. */
export const SITE_MAX_FOOD_STOCK = 100;

/** Seasonal food stock change per macro tick during winter. */
export const SITE_WINTER_FOOD_DELTA = -2;

/** Seasonal food stock change per macro tick outside winter. */
export const SITE_MILD_FOOD_DELTA = 2;

/** Maximum settlement garrison size. */
export const SITE_MAX_GARRISON = 60;

/** Per-tick probability an intact settlement recruits an extra garrison guard. */
export const SITE_GARRISON_REGEN_CHANCE = 0.25;

/** Per-tick probability a raided/burned settlement rebuilds back to intact status. */
export const SITE_REBUILD_CHANCE = 0.14;

/** Minimum prosperity floor applied when a site is rebuilt. */
export const SITE_REBUILD_MIN_PROSPERITY = 20;

/** Garrison reinforcement added when a settlement rebuilds. */
export const SITE_REBUILD_GARRISON_BONUS = 6;

/** Minimum garrison floor applied when a settlement rebuilds. */
export const SITE_REBUILD_MIN_GARRISON = 12;

/** Per-tick probability of dispatching a new overland merchant caravan. */
export const CARAVAN_SPAWN_CHANCE = 0.55;

/** Base escort strength of a newly dispatched merchant caravan. */
export const CARAVAN_BASE_ESCORT_STRENGTH = 10;

/** Divisor converting site prosperity into bonus caravan escort strength. */
export const CARAVAN_ESCORT_PROSPERITY_DIVISOR = 15;

/** Base trade goods valuation of a newly dispatched caravan. */
export const CARAVAN_BASE_GOODS_VALUE = 40;

/** Prosperity multiplier added to caravan goods valuation. */
export const CARAVAN_GOODS_PROSPERITY_MULT = 0.8;

/** Food stock delivered when a merchant caravan arrives safely. */
export const CARAVAN_DELIVERY_FOOD_GAIN = 8;

/** Per-tick probability of dispatching a faction patrol or raider warband. */
export const ARMY_SPAWN_CHANCE = 0.4;

/** Minimum garrison required to muster an outbound army or raid. */
export const ARMY_ORIGIN_MIN_GARRISON = 10;

/** Minimum strength of a spawned macro army/warband. */
export const ARMY_BASE_STRENGTH = 16;

/** Random additional strength span for spawned macro armies/warbands. */
export const ARMY_STRENGTH_RANGE = 24;

/** Random combat roll span added to an attacking army's strength. */
export const ARMY_ATTACK_ROLL_RANGE = 16;

/** Random combat roll span added to a defending site's garrison. */
export const ARMY_DEFENSE_ROLL_RANGE = 14;

/** Attack-over-defense margin required for a raid to torch a settlement (`burned`). */
export const ARMY_SEVERE_BURN_MARGIN = 12;

/** Prosperity lost when a site is burned by raiders. */
export const SITE_BURN_PROSPERITY_LOSS = 32;

/** Prosperity lost when a site is raided without burning. */
export const SITE_RAID_PROSPERITY_LOSS = 18;

/** Remaining garrison multiplier after a successful raid. */
export const SITE_RAID_GARRISON_RATIO = 0.45;

/** Minimum surviving garrison clamp after a raid. */
export const SITE_RAID_MIN_GARRISON = 4;

/** Remaining population multiplier after a successful raid. */
export const SITE_RAID_POP_RATIO = 0.75;

/** Minimum surviving population clamp after a raid. */
export const SITE_RAID_MIN_POP = 10;

/** Director encounter budget modifier injected when a bound macro site is raided. */
export const SITE_RAID_AREA_BUDGET_MODIFIER = 10;

/** Per-tick probability of spawning a new seasonal weather front when below capacity. */
export const WEATHER_FRONT_SPAWN_CHANCE = 0.45;

/** Minimum active duration (in Ring 2 ticks) for newly spawned weather fronts. */
export const WEATHER_FRONT_MIN_TICKS = 4;

/** Additional random duration span (in Ring 2 ticks) for newly spawned weather fronts. */
export const WEATHER_FRONT_EXTRA_TICKS = 8;

/** Additional random radius span (in continent cells) for newly spawned weather fronts. */
export const WEATHER_FRONT_EXTRA_RADIUS = 3;

/** Annual probability of spawning a new historical figure during Legends worldgen. */
export const LEGENDS_FIGURE_SPAWN_CHANCE = 0.35;

/** Minimum age in years before a historical figure risks natural passing. */
export const LEGENDS_ELDER_AGE_YEARS = 72;

/** Annual probability an elder historical figure passes away naturally. */
export const LEGENDS_ELDER_DEATH_CHANCE = 0.15;

/** Annual probability of forging a new legendary historical artifact. */
export const LEGENDS_ARTIFACT_FORGE_CHANCE = 0.18;

/** Annual probability of a historical figure clash or site raid during Legends worldgen. */
export const LEGENDS_CONFLICT_CHANCE = 0.28;

/** Probability a local defender clashes directly with the raiding force during a conflict. */
export const LEGENDS_DEFENDER_CLASH_CHANCE = 0.55;

/** Probability a clashing defender is slain rather than scarred. */
export const LEGENDS_DEFENDER_SLAIN_CHANCE = 0.35;

/** Probability two surviving clashing figures record a mutual historical rivalry. */
export const LEGENDS_RIVALRY_CHANCE = 0.4;

/** Probability an intact site falls or burns during an annual Legends conflict. */
export const LEGENDS_SITE_STRIKE_CHANCE = 0.25;

/** Probability a struck site collapses into ancient ruin instead of temporary burning. */
export const LEGENDS_SITE_DESTROY_CHANCE = 0.38;

/** Base Player Interaction Score seeded on promoted historical legends. */
export const LEGENDS_PIS_BASE = 25;

/** Additional PIS granted per historical kill on seeded living legends. */
export const LEGENDS_PIS_PER_KILL = 15;

/** Additional PIS granted per historical scar on seeded living legends. */
export const LEGENDS_PIS_PER_SCAR = 10;

/** Maximum epic Legends events promoted into initial `GameState.historicalLedger`. */
export const LEGENDS_LEDGER_CAP = 12;

/** Interval in simulated years between worker progress updates during Legends worldgen. */
export const LEGENDS_PROGRESS_YIELD_YEARS = 10;

/** Mood delta inflicted on traumatized survivors of a burned settlement. */
export const SITE_BURN_TRAUMA_MOOD_DELTA = -22;

/** Mood delta inflicted on traumatized survivors of a raided settlement. */
export const SITE_RAID_TRAUMA_MOOD_DELTA = -14;

/** Duration (turns) of the M182 trauma thought on site raid survivors. */
export const SITE_RAID_TRAUMA_DURATION_TURNS = 120;

/** Maximum stacks allowed for `site_raid_trauma` thoughts on survivors. */
export const SITE_RAID_TRAUMA_MAX_STACKS = 2;

/** Maximum ember voxel temperature (°C) stamped on recently burned sites. */
export const BURNT_SITE_MAX_EMBER_TEMP_C = 250;

/** Radius (tiles) of decaying smoke fields spawned at recently burned sites. */
export const BURNT_SITE_SMOKE_RADIUS = 1;

/** Duration (turns) of decaying smoke fields spawned at recently burned sites. */
export const BURNT_SITE_SMOKE_DURATION = 12;

/** Maximum cargo item templates stocked on a materialized caravan merchant. */
export const CARAVAN_MAX_SHOP_ITEMS = 4;

/** Default shop price markup applied to materialized traveling caravan merchants. */
export const CARAVAN_DEFAULT_MARKUP = 1.1;

/** Ambient outdoor temperature delta (°C) applied per weather front kind. */
export const WEATHER_TEMP_DELTA_BY_KIND: Readonly<Record<MacroWeatherKind, number>> = {
  clear: 0,
  fog: -2,
  rain: -5,
  storm: -8,
  blizzard: -22,
  drought: 10,
  heatwave: 16
};

/** ASCII glyphs and semantic hex colors rendered for continental biomes in LegendsModal. */
export const MACRO_BIOME_GLYPHS: Readonly<Record<MacroBiomeKind, { readonly glyph: string; readonly fg: string }>> = {
  ocean: { glyph: '~', fg: '#2b5876' },
  coast: { glyph: ',', fg: '#80a1c1' },
  plains: { glyph: '.', fg: '#7cb342' },
  forest: { glyph: '♣', fg: '#2e7d32' },
  hills: { glyph: 'n', fg: '#a1887f' },
  mountain: { glyph: '^', fg: '#90a4ae' },
  desert: { glyph: '≈', fg: '#d4a373' },
  tundra: { glyph: '*', fg: '#cfd8dc' },
  swamp: { glyph: ';', fg: '#558b2f' }
};

/** Status indicator glyphs displayed on continental maps and site cards. */
export const MACRO_SITE_STATUS_GLYPHS: Readonly<Record<MacroSiteStatus, string>> = {
  intact: '⌂',
  besieged: '⚔',
  raided: '!',
  burned: '🔥',
  ruined: '×',
  abandoned: '·'
};
