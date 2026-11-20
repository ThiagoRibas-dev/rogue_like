/**
 * Engine scheduling budgets, simulation cadence intervals, and stage definitions.
 */

/** Maximum milliseconds allocated to turn draining before cooperatively yielding to browser event loop. */
export const FRAME_BUDGET_MS = 4;

/** Maximum simulation iterations per animation frame in RTwP to prevent delta time death spirals. */
export const MAX_RTWP_DRAIN_ITERATIONS = 10;

/** Canonical 6-second tactical round duration in milliseconds (`6000 ms`). */
export const DND_ROUND_DURATION_MS = 6000;

/** Real-time millisecond conversion constant: 6000ms = 100 duration (1 full 6-second round) at 1x speed. */
export const RTWP_MS_PER_100_DURATION = DND_ROUND_DURATION_MS;

/** Base turn duration for actor steps (`100` energy = 1 full 6-second round). */
export const DEFAULT_ACTOR_TURN_DURATION = 100;

/** Half-round energy duration (`50` energy = 3.0s at 1x speed, e.g. 1 Standard or 1 Move action). */
export const HALF_ROUND_ENERGY_COST = 50;

/** Fallback energy duration when an active turn concludes without a specific speed cost (`2` = ~120ms at 1x). */
export const RTWP_IDLE_WAIT_DURATION = 2;

/** Cap for accumulated RTwP time to prevent spiral of death after background tab pauses. */
export const MAX_ACCUMULATED_RTWP_TIME = MAX_RTWP_DRAIN_ITERATIONS * DEFAULT_ACTOR_TURN_DURATION;

/** Interval (in player/global turns) at which Tier 2 local narrative cadence ticks (rumors, knowledge, personality). */
export const LOCAL_NARRATIVE_TICK_INTERVAL = 10;

/** Interval (in global turns) at which Tier 3 nemesis hierarchy advancement evaluates. */
export const NEMESIS_EVALUATION_INTERVAL = 25;

/** Interval (in global turns) at which Tier 3 persistent rivalry conflicts evaluate. */
export const RIVALRY_EVALUATION_INTERVAL = 25;

/** Interval (in global turns) at which Tier 3 background schemes tick. */
export const SCHEME_CADENCE_INTERVAL = 50;

/** Turn interval at which cooperative narrative fuzzer yields progress checkpoints. */
export const FUZZER_YIELD_TURN_INTERVAL = 50;

/** Stage identifiers for procedural map generation. */
export enum MapGenStage {
  Init = 'init',
  Carving = 'carving',
  Biomes = 'biomes',
  Dijkstra = 'dijkstra',
  Portals = 'portals',
  Encounters = 'encounters',
  Complete = 'complete'
}

/** User-facing progress labels for generation stages. */
export const MAP_GEN_STAGE_LABELS: Readonly<Record<MapGenStage, string>> = {
  [MapGenStage.Init]: 'Preparing topographical survey...',
  [MapGenStage.Carving]: 'Sculpting cavern chambers...',
  [MapGenStage.Biomes]: 'Distributing environmental biomes...',
  [MapGenStage.Dijkstra]: 'Evaluating tactical hot-paths...',
  [MapGenStage.Portals]: 'Positioning portals and chambers...',
  [MapGenStage.Encounters]: 'Directing encounter ecologies...',
  [MapGenStage.Complete]: 'Dungeon synthesized.'
};
