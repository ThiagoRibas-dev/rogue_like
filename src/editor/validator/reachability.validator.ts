import type { CampaignData, AreaDefinition } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';
import * as ROT from 'rot-js';

export async function validateReachability(campaign: Readonly<CampaignData>): Promise<ReadonlyArray<ValidationError>> {
  const errors: ValidationError[] = [];
  const startAreaId = campaign.rules.map.startingAreaId;
  const allAreaIds = Object.keys(campaign.areas);

  if (!allAreaIds.includes(startAreaId)) {
    return errors; // Handled by basic referential integrity validation
  }

  // 1. BFS for area reachability
  await validateAreaConnectivity(startAreaId, allAreaIds, campaign, errors);

  // 2. Portal Exit Check for static maps
  for (const [areaId, area] of Object.entries(campaign.areas)) {
    if (area.generatorType === 'static' && area.staticMap && area.connections) {
      await validateStaticMapPortals(areaId, area, campaign, errors);
    }
    // Yield to the event loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return errors;
}

async function validateAreaConnectivity(
  startAreaId: string,
  allAreaIds: ReadonlyArray<string>,
  campaign: Readonly<CampaignData>,
  errors: ValidationError[]
): Promise<void> {
  const visited = new Set<string>();
  const queue = [startAreaId];
  visited.add(startAreaId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const area = campaign.areas[current];
    if (area && area.connections) {
      for (const conn of area.connections) {
        if (allAreaIds.includes(conn.targetAreaId) && !visited.has(conn.targetAreaId)) {
          visited.add(conn.targetAreaId);
          queue.push(conn.targetAreaId);
        }
      }
    }
    // Yield to the event loop to prevent locking the UI
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  for (const areaId of allAreaIds) {
    if (!visited.has(areaId)) {
      errors.push({
        path: `/areas/${areaId}`,
        message: `Area '${campaign.areas[areaId]?.name || areaId}' is unreachable from the starting area via portals.`,
        severity: 'error'
      });
    }
  }
}

async function validateStaticMapPortals(
  areaId: string,
  area: Readonly<AreaDefinition>,
  campaign: Readonly<CampaignData>,
  errors: ValidationError[]
): Promise<void> {
  if (!area.staticMap || !area.connections) return;

  const layout = area.staticMap.layout;
  const legend = area.staticMap.legend;
  const width = layout.reduce((max, row) => Math.max(max, row.length), 0);
  const height = layout.length;

  const walkableTiles: Array<{ readonly x: number; readonly y: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const char = layout[y]?.[x] || ' ';
      const tileId = legend[char];
      if (tileId && campaign.tiles[tileId]?.walkable) {
        walkableTiles.push({ x, y });
      }
    }
  }

  if (walkableTiles.length === 0) return;

  for (let i = 0; i < area.connections.length; i++) {
    const conn = area.connections[i];
    if (conn?.direction !== 'portal' || conn.placementX === undefined || conn.placementY === undefined) {
      continue;
    }

    const px = conn.placementX;
    const py = conn.placementY;
    const start = walkableTiles[0]!;

    let pathFound = false;
    const astar = new ROT.Path.AStar(px, py, (x: number, y: number) => {
      if (x === px && y === py) return true;
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const c = layout[y]?.[x] || ' ';
      const tid = legend[c];
      return !!(tid && campaign.tiles[tid]?.walkable);
    });

    astar.compute(start.x, start.y, () => {
      pathFound = true;
    });

    if (!pathFound) {
      errors.push({
        path: `/areas/${areaId}/connections/${i}`,
        message: `Portal at (${px}, ${py}) is unreachable from walkable areas in static map.`,
        severity: 'error'
      });
    }
  }
}
