import {
  canTraverseVerticalTiles,
  getMapZBounds,
  getTileDefAt,
  isInMapBounds,
  isMultiZMap
} from '../map/map_accessor.ts';
import type { GameState } from '../types/game-state.types.ts';
import type { WorldChunk } from '../types/world-chunk.types.ts';
import { packWorldCoord3D } from '../utils/grid.ts';

/** Cluster edge length used to partition finite non-chunked maps for HPA* region graphs. */
export const HPA_FINITE_CLUSTER_SIZE = 16;

/** Maximum cells scanned during a single cluster connected-component flood fill. */
const MAX_CLUSTER_DIMENSION = 64;

/** Base abstract graph transition cost between connected cluster portal nodes. */
const REGION_INTER_PORTAL_COST = 1;

/** Portal node in the hierarchical region connectivity graph. */
export interface RegionPortalNode {
  readonly id: string;
  readonly regionKey: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly kind: 'boundary' | 'vertical';
}

/** Weighted undirected edge between two portal nodes in the region graph. */
export interface RegionGraphEdge {
  readonly toNodeId: string;
  readonly cost: number;
}

/** Cached connected-component plane for a single `(cx, cy, cz)` sector/chunk. */
export interface ClusterRegionData {
  readonly clusterKey: number;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly size: number;
  readonly regionIds: Uint16Array;
  readonly regionCount: number;
}

/** Complete HPA* abstract region connectivity graph for an area map snapshot. */
export interface RegionGraph {
  readonly areaId: string;
  readonly clusterSize: number;
  readonly nodes: ReadonlyMap<string, RegionPortalNode>;
  readonly edges: ReadonlyMap<string, ReadonlyArray<RegionGraphEdge>>;
  readonly regionToNodes: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly clusters: ReadonlyMap<number, ClusterRegionData>;
}

const REGION_NEIGHBOR_OFFSETS_8: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1]
];

function isClusterCellNavigable(state: Readonly<GameState>, x: number, y: number, z: number): boolean {
  if (!isInMapBounds(state.map, x, y, z)) return false;
  const def = getTileDefAt(state, x, y, z);
  if (!def) return false;
  return def.walkable === true || def.verticalLink !== undefined || def.isClimbable === true;
}

function formatRegionKey(cx: number, cy: number, cz: number, regionId: number): string {
  return `${cx},${cy},${cz}:${regionId}`;
}

function formatNodeId(x: number, y: number, z: number, kind: 'boundary' | 'vertical'): string {
  return `${kind === 'vertical' ? 'V' : 'B'}:${x},${y},${z}`;
}

function buildSingleClusterRegions(
  state: Readonly<GameState>,
  cx: number,
  cy: number,
  cz: number,
  size: number
): ClusterRegionData {
  const safeSize = Math.max(1, Math.min(MAX_CLUSTER_DIMENSION, size));
  const regionIds = new Uint16Array(safeSize * safeSize);
  let nextRegionId = 0;

  for (let ly = 0; ly < safeSize; ly++) {
    for (let lx = 0; lx < safeSize; lx++) {
      const localIdx = ly * safeSize + lx;
      if (regionIds[localIdx] !== 0) continue;

      const wx = cx * safeSize + lx;
      const wy = cy * safeSize + ly;
      if (!isClusterCellNavigable(state, wx, wy, cz)) continue;

      nextRegionId += 1;
      regionIds[localIdx] = nextRegionId;
      const queue: number[] = [localIdx];
      let head = 0;

      while (head < queue.length) {
        const curIdx = queue[head++]!;
        const clx = curIdx % safeSize;
        const cly = Math.floor(curIdx / safeSize);

        for (const [dx, dy] of REGION_NEIGHBOR_OFFSETS_8) {
          const nlx = clx + dx;
          const nly = cly + dy;
          if (nlx < 0 || nlx >= safeSize || nly < 0 || nly >= safeSize) continue;
          const nIdx = nly * safeSize + nlx;
          if (regionIds[nIdx] !== 0) continue;
          const nwx = cx * safeSize + nlx;
          const nwy = cy * safeSize + nly;
          if (!isClusterCellNavigable(state, nwx, nwy, cz)) continue;
          regionIds[nIdx] = nextRegionId;
          queue.push(nIdx);
        }
      }
    }
  }

  return {
    clusterKey: packWorldCoord3D(cx, cy, cz),
    cx,
    cy,
    cz,
    size: safeSize,
    regionIds,
    regionCount: nextRegionId
  };
}

function addUndirectedEdge(edges: Map<string, RegionGraphEdge[]>, a: string, b: string, cost: number): void {
  if (a === b) return;
  let listA = edges.get(a);
  if (!listA) {
    listA = [];
    edges.set(a, listA);
  }
  if (!listA.some((e) => e.toNodeId === b)) {
    listA.push({ toNodeId: b, cost });
  }
  let listB = edges.get(b);
  if (!listB) {
    listB = [];
    edges.set(b, listB);
  }
  if (!listB.some((e) => e.toNodeId === a)) {
    listB.push({ toNodeId: a, cost });
  }
}

interface CachedRegionGraphEntry {
  readonly graph: RegionGraph;
  readonly mapRef: GameState['map'];
  readonly chunkRefs?: ReadonlyMap<number, WorldChunk> | undefined;
}

const regionGraphCache = new Map<string, CachedRegionGraphEntry>();

/**
 * Resolves a tile coordinate `(x, y, z)` to its local connected-component `regionKey` within `graph`.
 * Returns `undefined` when the tile is solid/unloaded.
 */
export function getRegionKeyAt(graph: RegionGraph, x: number, y: number, z = 0): string | undefined {
  const cx = Math.floor(x / graph.clusterSize);
  const cy = Math.floor(y / graph.clusterSize);
  const cluster = graph.clusters.get(packWorldCoord3D(cx, cy, z));
  if (!cluster) return undefined;
  const lx = x - cx * cluster.size;
  const ly = y - cy * cluster.size;
  if (lx < 0 || lx >= cluster.size || ly < 0 || ly >= cluster.size) return undefined;
  const rid = cluster.regionIds[ly * cluster.size + lx] ?? 0;
  if (rid === 0) return undefined;
  return formatRegionKey(cx, cy, z, rid);
}

/**
 * Returns true if the cached `RegionGraph` for `state.currentAreaId` is absent or stale
 * relative to `state.map` (or any copy-on-write replaced `WorldChunk` reference).
 */
export function isRegionGraphDirty(state: Readonly<GameState>): boolean {
  const cached = regionGraphCache.get(state.currentAreaId);
  if (!cached || cached.mapRef !== state.map) return true;
  const grid = state.map.chunkGrid;
  if (grid) {
    if (!cached.chunkRefs || cached.chunkRefs.size !== grid.chunks.size) return true;
    for (const [packed, chunk] of grid.chunks.entries()) {
      if (cached.chunkRefs.get(packed) !== chunk) return true;
    }
  }
  return false;
}

/**
 * Clears cached hierarchical region graphs (used in tests or full world reset).
 */
export function clearRegionGraphCache(): void {
  regionGraphCache.clear();
}

/**
 * Builds or incrementally updates the hierarchical HPA* `RegionGraph` for the active map
 * without mutating `Readonly<GameState>` or chunk buffers in place.
 * Partitioned by `WorldChunk` slabs on streaming maps or `16x16` clusters on finite multi-Z/2D maps,
 * linking horizontal boundary entrances and directional Z-axis vertical portals (`stairs`, `ladder`, `ramp`).
 */
export function buildOrUpdateRegionGraph(state: Readonly<GameState>): RegionGraph {
  const cached = regionGraphCache.get(state.currentAreaId);
  if (cached && cached.mapRef === state.map && !isRegionGraphDirty(state)) {
    return cached.graph;
  }

  const grid = state.map.chunkGrid;
  const clusterSize = grid ? grid.chunkSize : HPA_FINITE_CLUSTER_SIZE;
  const clusters = new Map<number, ClusterRegionData>();
  const chunkRefs = grid ? new Map<number, WorldChunk>() : undefined;

  if (grid) {
    for (const chunk of grid.chunks.values()) {
      const cKey = packWorldCoord3D(chunk.cx, chunk.cy, chunk.cz);
      chunkRefs!.set(cKey, chunk);
      const prevCluster = cached?.graph.clusters.get(cKey);
      const chunkUnchanged =
        cached?.graph.areaId === state.currentAreaId &&
        cached?.chunkRefs?.get(cKey) === chunk &&
        prevCluster !== undefined;
      if (chunkUnchanged) {
        clusters.set(cKey, prevCluster);
      } else {
        const built = buildSingleClusterRegions(state, chunk.cx, chunk.cy, chunk.cz, clusterSize);
        clusters.set(cKey, built);
      }
    }
  } else {
    const { minZ, maxZ } = getMapZBounds(state.map);
    const maxCx = Math.max(0, Math.ceil(state.map.width / clusterSize) - 1);
    const maxCy = Math.max(0, Math.ceil(state.map.height / clusterSize) - 1);
    for (let z = minZ; z <= maxZ; z++) {
      for (let cy = 0; cy <= maxCy; cy++) {
        for (let cx = 0; cx <= maxCx; cx++) {
          const built = buildSingleClusterRegions(state, cx, cy, z, clusterSize);
          clusters.set(built.clusterKey, built);
        }
      }
    }
  }

  const nodes = new Map<string, RegionPortalNode>();
  const edges = new Map<string, RegionGraphEdge[]>();
  const regionToNodes = new Map<string, string[]>();

  const registerNode = (node: RegionPortalNode): void => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
      let list = regionToNodes.get(node.regionKey);
      if (!list) {
        list = [];
        regionToNodes.set(node.regionKey, list);
      }
      if (!list.includes(node.id)) {
        list.push(node.id);
      }
    }
  };

  const multiZ = isMultiZMap(state.map);

  for (const cluster of clusters.values()) {
    const { cx, cy, cz, size, regionIds } = cluster;
    const baseX = cx * size;
    const baseY = cy * size;

    // Scan cluster boundaries (east & south edges link adjacent clusters without duplicating)
    const eastCluster = clusters.get(packWorldCoord3D(cx + 1, cy, cz));
    if (eastCluster) {
      let runStart = -1;
      for (let ly = 0; ly <= size; ly++) {
        const ridA = ly < size ? (regionIds[ly * size + (size - 1)] ?? 0) : 0;
        const ridB = ly < size ? (eastCluster.regionIds[ly * size] ?? 0) : 0;
        const connected = ridA > 0 && ridB > 0;
        if (connected && runStart === -1) {
          runStart = ly;
        } else if (!connected && runStart !== -1) {
          const midLy = Math.floor((runStart + ly - 1) / 2);
          const midRidA = regionIds[midLy * size + (size - 1)]!;
          const midRidB = eastCluster.regionIds[midLy * size]!;
          const nodeA: RegionPortalNode = {
            id: formatNodeId(baseX + size - 1, baseY + midLy, cz, 'boundary'),
            regionKey: formatRegionKey(cx, cy, cz, midRidA),
            x: baseX + size - 1,
            y: baseY + midLy,
            z: cz,
            kind: 'boundary'
          };
          const nodeB: RegionPortalNode = {
            id: formatNodeId(baseX + size, baseY + midLy, cz, 'boundary'),
            regionKey: formatRegionKey(cx + 1, cy, cz, midRidB),
            x: baseX + size,
            y: baseY + midLy,
            z: cz,
            kind: 'boundary'
          };
          registerNode(nodeA);
          registerNode(nodeB);
          addUndirectedEdge(edges, nodeA.id, nodeB.id, REGION_INTER_PORTAL_COST);
          runStart = -1;
        }
      }
    }

    const southCluster = clusters.get(packWorldCoord3D(cx, cy + 1, cz));
    if (southCluster) {
      let runStart = -1;
      for (let lx = 0; lx <= size; lx++) {
        const ridA = lx < size ? (regionIds[(size - 1) * size + lx] ?? 0) : 0;
        const ridB = lx < size ? (southCluster.regionIds[lx] ?? 0) : 0;
        const connected = ridA > 0 && ridB > 0;
        if (connected && runStart === -1) {
          runStart = lx;
        } else if (!connected && runStart !== -1) {
          const midLx = Math.floor((runStart + lx - 1) / 2);
          const midRidA = regionIds[(size - 1) * size + midLx]!;
          const midRidB = southCluster.regionIds[midLx]!;
          const nodeA: RegionPortalNode = {
            id: formatNodeId(baseX + midLx, baseY + size - 1, cz, 'boundary'),
            regionKey: formatRegionKey(cx, cy, cz, midRidA),
            x: baseX + midLx,
            y: baseY + size - 1,
            z: cz,
            kind: 'boundary'
          };
          const nodeB: RegionPortalNode = {
            id: formatNodeId(baseX + midLx, baseY + size, cz, 'boundary'),
            regionKey: formatRegionKey(cx, cy + 1, cz, midRidB),
            x: baseX + midLx,
            y: baseY + size,
            z: cz,
            kind: 'boundary'
          };
          registerNode(nodeA);
          registerNode(nodeB);
          addUndirectedEdge(edges, nodeA.id, nodeB.id, REGION_INTER_PORTAL_COST);
          runStart = -1;
        }
      }
    }

    // Vertical portal detection linking Z and Z+1 along stairs/ladders/ramps
    if (multiZ) {
      const upperCluster = clusters.get(packWorldCoord3D(cx, cy, cz + 1));
      if (upperCluster) {
        for (let ly = 0; ly < size; ly++) {
          for (let lx = 0; lx < size; lx++) {
            const ridLower = regionIds[ly * size + lx] ?? 0;
            if (ridLower === 0) continue;
            const wx = baseX + lx;
            const wy = baseY + ly;
            const def = getTileDefAt(state, wx, wy, cz);
            if (!def?.verticalLink) continue;

            // Stairs/ladder directly connect (wx, wy, cz+1); ramps connect adjacent upper cells
            if (def.verticalLink === 'ramp') {
              for (const [dx, dy] of REGION_NEIGHBOR_OFFSETS_8) {
                const ux = wx + dx;
                const uy = wy + dy;
                if (!isClusterCellNavigable(state, ux, uy, cz + 1)) continue;
                const upperKey = getRegionKeyFromClusterMap(clusters, clusterSize, ux, uy, cz + 1);
                if (!upperKey) continue;
                const lowNode: RegionPortalNode = {
                  id: formatNodeId(wx, wy, cz, 'vertical'),
                  regionKey: formatRegionKey(cx, cy, cz, ridLower),
                  x: wx,
                  y: wy,
                  z: cz,
                  kind: 'vertical'
                };
                const upNode: RegionPortalNode = {
                  id: formatNodeId(ux, uy, cz + 1, 'vertical'),
                  regionKey: upperKey,
                  x: ux,
                  y: uy,
                  z: cz + 1,
                  kind: 'vertical'
                };
                registerNode(lowNode);
                registerNode(upNode);
                addUndirectedEdge(edges, lowNode.id, upNode.id, REGION_INTER_PORTAL_COST);
              }
            } else {
              const ridUpper = upperCluster.regionIds[ly * size + lx] ?? 0;
              if (ridUpper === 0) continue;
              const upperDef = getTileDefAt(state, wx, wy, cz + 1);
              if (!canTraverseVerticalTiles(def, upperDef, 1) && !canTraverseVerticalTiles(upperDef, def, -1)) {
                continue;
              }
              const lowNode: RegionPortalNode = {
                id: formatNodeId(wx, wy, cz, 'vertical'),
                regionKey: formatRegionKey(cx, cy, cz, ridLower),
                x: wx,
                y: wy,
                z: cz,
                kind: 'vertical'
              };
              const upNode: RegionPortalNode = {
                id: formatNodeId(wx, wy, cz + 1, 'vertical'),
                regionKey: formatRegionKey(cx, cy, cz + 1, ridUpper),
                x: wx,
                y: wy,
                z: cz + 1,
                kind: 'vertical'
              };
              registerNode(lowNode);
              registerNode(upNode);
              addUndirectedEdge(edges, lowNode.id, upNode.id, REGION_INTER_PORTAL_COST);
            }
          }
        }
      }
    }
  }

  // Connect all portal nodes sharing the same connected regionKey
  for (const nodeIds of regionToNodes.values()) {
    for (let i = 0; i < nodeIds.length; i++) {
      const a = nodes.get(nodeIds[i]!)!;
      for (let j = i + 1; j < nodeIds.length; j++) {
        const b = nodes.get(nodeIds[j]!)!;
        const cost = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 2));
        addUndirectedEdge(edges, a.id, b.id, cost);
      }
    }
  }

  const graph: RegionGraph = {
    areaId: state.currentAreaId,
    clusterSize,
    nodes,
    edges,
    regionToNodes,
    clusters
  };
  regionGraphCache.set(state.currentAreaId, {
    graph,
    mapRef: state.map,
    ...(chunkRefs !== undefined ? { chunkRefs } : {})
  });
  return graph;
}

function getRegionKeyFromClusterMap(
  clusters: ReadonlyMap<number, ClusterRegionData>,
  clusterSize: number,
  x: number,
  y: number,
  z: number
): string | undefined {
  const cx = Math.floor(x / clusterSize);
  const cy = Math.floor(y / clusterSize);
  const cluster = clusters.get(packWorldCoord3D(cx, cy, z));
  if (!cluster) return undefined;
  const lx = x - cx * cluster.size;
  const ly = y - cy * cluster.size;
  if (lx < 0 || lx >= cluster.size || ly < 0 || ly >= cluster.size) return undefined;
  const rid = cluster.regionIds[ly * cluster.size + lx] ?? 0;
  return rid > 0 ? formatRegionKey(cx, cy, z, rid) : undefined;
}
