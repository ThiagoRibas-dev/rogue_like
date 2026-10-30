/**
 * Engine scheduling budgets, simulation cadence intervals, and stage definitions.
 */

/** Maximum milliseconds allocated to turn draining before cooperatively yielding to browser event loop. */
export const FRAME_BUDGET_MS = 4;

/** Maximum simulation iterations per animation frame in RTwP to prevent delta time death spirals. */
export const MAX_RTWP_DRAIN_ITERATIONS = 10;

/** Real-time millisecond conversion constant: 500ms = 100 duration at 1x speed. */
export const RTWP_MS_PER_100_DURATION = 500;

/** Base turn duration for actor steps. */
export const DEFAULT_ACTOR_TURN_DURATION = 100;

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
