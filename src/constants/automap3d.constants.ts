import type { AutomapCameraState3D, AutomapZCutawayMode } from '../types/automap3d.types.ts';

/** Default deterministic preview seed for holistic campaign atlases and editor procedural previews. */
export const DEFAULT_ATLAS_PREVIEW_SEED = 1337 as const;

/** Default initial camera yaw (radians, 45° isometric three-quarter angle). */
export const AUTOMAP_DEFAULT_YAW_RAD = Math.PI * 0.25;

/** Default initial camera pitch (radians, ~31° elevated Daggerfall dungeon angle). */
export const AUTOMAP_DEFAULT_PITCH_RAD = 0.54;

/** Minimum allowed camera pitch (radians) preventing gimbal flip over the zenith. */
export const AUTOMAP_MIN_PITCH_RAD = 0.14;

/** Maximum allowed camera pitch (radians) keeping horizon readable. */
export const AUTOMAP_MAX_PITCH_RAD = 1.42;

/** Default camera zoom scale (pixels per world unit before perspective). */
export const AUTOMAP_DEFAULT_ZOOM = 14 as const;

/** Minimum camera zoom scale. */
export const AUTOMAP_MIN_ZOOM = 2.5 as const;

/** Maximum camera zoom scale. */
export const AUTOMAP_MAX_ZOOM = 48 as const;

/** Perspective camera distance factor relative to scene radius. */
export const AUTOMAP_PERSPECTIVE_DISTANCE = 95 as const;

/** Perspective focal projection scale multiplier. */
export const AUTOMAP_PERSPECTIVE_FOCAL = 82 as const;

/** Vertical world-unit height separating adjacent Z strata (slightly taller than 1:1 for clear stairwell readability). */
export const AUTOMAP_Z_VERTICAL_SCALE = 1.65 as const;

/** Wall shell prism height fraction relative to one Z stratum. */
export const AUTOMAP_WALL_HEIGHT_RATIO = 0.88 as const;

/** Thin walkable floor slab height fraction relative to one Z stratum. */
export const AUTOMAP_FLOOR_SLAB_HEIGHT = 0.18 as const;

/** Stair/ramp prism height fraction relative to one Z stratum. */
export const AUTOMAP_STAIR_HEIGHT_RATIO = 0.65 as const;

/** Alpha transparency applied to upper Z-strata when `cutawayMode === 'ghost_above'`. */
export const AUTOMAP_GHOST_ABOVE_ALPHA = 0.16 as const;

/** Alpha transparency per Z-step below `activeZ` to create depth hierarchy. */
export const AUTOMAP_LOWER_Z_DIM_STEP = 0.08 as const;

/** Minimum alpha floor for deep lower strata so distant dungeons remain legible. */
export const AUTOMAP_LOWER_Z_MIN_ALPHA = 0.45 as const;

/** Default horizontal gap (tiles) between adjacent area clusters in Holistic Campaign 3D Atlas. */
export const AUTOMAP_HOLISTIC_AREA_GAP = 14 as const;

/** Default vertical Z-level offset between stacked areas connected by `'up'` or `'down'`. */
export const AUTOMAP_HOLISTIC_VERTICAL_STEP_Z = 3 as const;

/** Half-width radius (in tiles) extracted around spawn for unbounded `streaming_overworld` areas in holistic atlases. */
export const AUTOMAP_HOLISTIC_STREAMING_PREVIEW_RADIUS = 20 as const;

/** Default canvas width (px) fallback when container layout has not yet measured. */
export const AUTOMAP_DEFAULT_CANVAS_WIDTH = 920 as const;

/** Default canvas height (px) fallback when container layout has not yet measured. */
export const AUTOMAP_DEFAULT_CANVAS_HEIGHT = 560 as const;

/** Half-height extension (in Z strata units) of Daggerfall-style vertical plumb-line beacons. */
export const AUTOMAP_BEACON_PLUMB_HALF_SPAN_Z = 4.5 as const;

/** Semantic color palette for Daggerfall-style plumb-line beacons and markers. */
export const AUTOMAP_BEACON_COLORS = {
  player: '#ef4444',
  portal: '#22c55e',
  stairs: '#38bdf8',
  note: '#f59e0b',
  start: '#eab308',
  torch: '#fb923c'
} as const;

/** Fallback surface colors used when a campaign tile's `bg` is pure black `#000000`. */
export const AUTOMAP_FALLBACK_COLORS = {
  floorTop: '#262b36',
  floorSide: '#191d26',
  wallTop: '#5b6476',
  wallSide: '#3a4150',
  stairsTop: '#38bdf8',
  stairsSide: '#0284c7',
  waterTop: '#2563eb',
  waterSide: '#1d4ed8',
  magmaTop: '#f97316',
  magmaSide: '#c2410c',
  oilTop: '#78350f',
  oilSide: '#451a03',
  mudTop: '#713f12',
  mudSide: '#422006',
  voidOutline: '#334155',
  backgroundTop: '#0b0e14',
  backgroundBottom: '#06080c',
  gridTint: 'rgba(148, 163, 184, 0.08)',
  splineDefault: '#22c55e',
  splineVertical: '#38bdf8'
} as const;

/** Human-readable labels for each cutaway mode button. */
export const AUTOMAP_CUTAWAY_LABELS: Readonly<Record<AutomapZCutawayMode, string>> = {
  ghost_above: 'Ghost Above',
  isolate_z: 'Isolate Z',
  full_stack: 'Full Stack'
};

/** Default camera factory for a given starting Z level. */
export function createDefaultAutomapCamera(
  activeZ = 0,
  cutawayMode: AutomapZCutawayMode = 'ghost_above',
  highlightAreaId?: string
): AutomapCameraState3D {
  return {
    yawRad: AUTOMAP_DEFAULT_YAW_RAD,
    pitchRad: AUTOMAP_DEFAULT_PITCH_RAD,
    zoom: AUTOMAP_DEFAULT_ZOOM,
    panX: 0,
    panY: 0,
    activeZ,
    cutawayMode,
    projection: 'perspective',
    showBeacons: true,
    showLabels: true,
    showSplines: true,
    ...(highlightAreaId !== undefined ? { highlightAreaId } : {})
  };
}
