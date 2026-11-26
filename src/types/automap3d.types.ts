/**
 * Canonical types for the Phase 49 zero-dependency Daggerfall-style 3D dungeon automap
 * and holistic campaign atlas shared across gameplay, Campaign Editor, and offline HTML artifacts.
 */

/** Persistent player-authored note pinned to a 3D map coordinate. */
export interface AutomapNote {
  readonly id: string;
  readonly areaId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly label: string;
  readonly color?: string | undefined;
  readonly createdTurn?: number | undefined;
}

/** Structural geometry classification derived purely from `TileDefinition` fields and fluid bytes. */
export type AutomapVoxelKind =
  | 'floor'
  | 'wall'
  | 'stairs_up'
  | 'stairs_down'
  | 'stairs_both'
  | 'ladder'
  | 'ramp'
  | 'water'
  | 'magma'
  | 'oil'
  | 'mud';

/** Semantic classification for vertical plumb-line beacons and glowing torch embers. */
export type AutomapBeaconKind = 'player' | 'portal' | 'stairs' | 'note' | 'start' | 'torch';

/** Optional entity summary attached to an explored/visible 3D automap voxel. */
export interface AutomapVoxelEntityMarker {
  readonly glyph: string;
  readonly color: string;
  readonly label: string;
}

/** Single 3D voxel cell positioned in global scene coordinates `(wx, wy, wz)`. */
export interface AutomapVoxelCell3D {
  readonly areaId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly wx: number;
  readonly wy: number;
  readonly wz: number;
  readonly tileId: string;
  readonly kind: AutomapVoxelKind;
  readonly topColor: string;
  readonly sideColor: string;
  readonly explored: boolean;
  readonly inFov?: boolean | undefined;
  readonly hasTorchEmber?: boolean | undefined;
  readonly fluidDepth?: number | undefined;
  readonly label?: string | undefined;
  readonly portalTargetAreaId?: string | undefined;
  readonly entityMarker?: AutomapVoxelEntityMarker | undefined;
}

/** Full-height vertical plumb-line beacon or glowing corridor ember marker. */
export interface AutomapBeacon3D {
  readonly id: string;
  readonly kind: AutomapBeaconKind;
  readonly areaId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly wx: number;
  readonly wy: number;
  readonly wz: number;
  readonly color: string;
  readonly label: string;
  readonly subtitle?: string | undefined;
}

/** Curved 3D transition spline connecting an exit portal in one area cluster to its target area. */
export interface AutomapPortalSpline3D {
  readonly id: string;
  readonly fromAreaId: string;
  readonly toAreaId: string;
  readonly fromWx: number;
  readonly fromWy: number;
  readonly fromWz: number;
  readonly toWx: number;
  readonly toWy: number;
  readonly toWz: number;
  readonly direction: 'up' | 'down' | 'edge' | 'portal';
  readonly color: string;
  readonly label: string;
}

/** World-space bounding and origin metadata for an area cluster inside a 3D scene. */
export interface AutomapAreaCluster3D {
  readonly areaId: string;
  readonly name: string;
  readonly generatorType: string;
  readonly dangerRating: number;
  readonly offsetWx: number;
  readonly offsetWy: number;
  readonly offsetWz: number;
  readonly minLocalX: number;
  readonly minLocalY: number;
  readonly maxLocalX: number;
  readonly maxLocalY: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly voxelCount: number;
  readonly beaconCount: number;
}

/** Inclusive world-space bounding box of an `AutomapScene3D`. */
export interface AutomapSceneBounds3D {
  readonly minWx: number;
  readonly maxWx: number;
  readonly minWy: number;
  readonly maxWy: number;
  readonly minWz: number;
  readonly maxWz: number;
}

/** Complete compiled 3D automap or holistic campaign atlas scene. */
export interface AutomapScene3D {
  readonly mode: 'local' | 'holistic';
  readonly title: string;
  readonly seed?: number | undefined;
  readonly voxels: ReadonlyArray<AutomapVoxelCell3D>;
  readonly beacons: ReadonlyArray<AutomapBeacon3D>;
  readonly splines: ReadonlyArray<AutomapPortalSpline3D>;
  readonly clusters: ReadonlyArray<AutomapAreaCluster3D>;
  readonly bounds: AutomapSceneBounds3D;
  readonly focusWx: number;
  readonly focusWy: number;
  readonly focusWz: number;
}

/** Cutaway slicing mode controlling how Z-strata above/below `activeZ` render. */
export type AutomapZCutawayMode = 'ghost_above' | 'isolate_z' | 'full_stack';

/** Camera projection mode supported by the zero-dependency 3D `<canvas>` renderer. */
export type AutomapProjectionMode = 'perspective' | 'isometric';

/** Interactive camera & filter state for `<Automap3DViewport />`. */
export interface AutomapCameraState3D {
  readonly yawRad: number;
  readonly pitchRad: number;
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly activeZ: number;
  readonly cutawayMode: AutomapZCutawayMode;
  readonly projection: AutomapProjectionMode;
  readonly showBeacons: boolean;
  readonly showLabels: boolean;
  readonly showSplines: boolean;
  readonly highlightAreaId?: string | undefined;
}

/** Hit-test result returned when hovering or clicking on the 3D automap canvas. */
export interface AutomapHitResult3D {
  readonly kind: 'voxel' | 'beacon';
  readonly voxel?: AutomapVoxelCell3D | undefined;
  readonly beacon?: AutomapBeacon3D | undefined;
  readonly screenX: number;
  readonly screenY: number;
}

/** Fog-of-war visibility policy when extracting an area into 3D voxels. */
export type AutomapVisibilityMode = 'explored_only' | 'full_omniscient';
