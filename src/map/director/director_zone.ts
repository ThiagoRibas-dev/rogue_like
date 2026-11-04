import * as ROT from 'rot-js';
import type { AreaDefinition, CampaignData } from '../../types/campaign.types.ts';
import type { GameMap } from '../../types/game-state.types.ts';
import { coordToIndex } from '../../utils/grid.ts';
import { MAX_TILE_SPAWN_ATTEMPTS } from '../../constants/spawning.constants.ts';
import type {
  BudgetAxis,
  CandidateRecord,
  DirectorReceipt,
  DirectorResult,
  RoomBounds,
  DirectorContext
} from '../../types/encounter.types.ts';

/**
 * Maps role tags on an entity template to a CR budget axis.
 * @param roleTags The role tags array on an entity template.
 * @returns The matching BudgetAxis.
 */
export function resolveAxis(roleTags: ReadonlyArray<string>): BudgetAxis {
  if (roleTags.includes('protein')) return 'protein';
  if (roleTags.includes('appetizer')) return 'appetizer';
  if (roleTags.includes('side')) return 'side';
  if (roleTags.includes('dessert')) return 'dessert';
  return 'protein';
}

/**
 * Finds a random floor tile within room bounds, optionally biasing placement towards Dijkstra hot path coordinates.
 */
export function getRandomFloorTileInRoom(
  campaign: CampaignData,
  room: RoomBounds,
  map: GameMap,
  occupiedCoordinates: Set<string>,
  hotPathCoords?: ReadonlySet<string> | undefined,
  preferHotPath?: boolean | undefined
): { x: number; y: number } | null {
  let fallbackPos: { x: number; y: number } | null = null;

  if (room.exactTiles) {
    const tileList = room.exactTiles;
    for (let i = 0; i < MAX_TILE_SPAWN_ATTEMPTS; i++) {
      if (tileList.length === 0) break;
      const coordStr = tileList[Math.floor(ROT.RNG.getUniform() * tileList.length)];
      if (!coordStr) break;
      const [xStr, yStr] = coordStr.split(',');
      const x = Number(xStr);
      const y = Number(yStr);
      const idx = coordToIndex(x, y, map.width);

      if (map.tiles[idx] && !occupiedCoordinates.has(`${x},${y}`)) {
        const tileId = map.tiles[idx]!.tileId;
        if (campaign.tiles[tileId]?.walkable) {
          if (preferHotPath && hotPathCoords && hotPathCoords.has(`${x},${y}`)) {
            return { x, y };
          }
          if (!fallbackPos) {
            fallbackPos = { x, y };
          }
        }
      }
    }
    return fallbackPos;
  }

  for (let i = 0; i < MAX_TILE_SPAWN_ATTEMPTS; i++) {
    const x = Math.floor(ROT.RNG.getUniform() * (room.right - room.left + 1)) + room.left;
    const y = Math.floor(ROT.RNG.getUniform() * (room.bottom - room.top + 1)) + room.top;
    const idx = coordToIndex(x, y, map.width);

    if (map.tiles[idx] && !occupiedCoordinates.has(`${x},${y}`)) {
      const tileId = map.tiles[idx]!.tileId;
      if (campaign.tiles[tileId]?.walkable) {
        if (preferHotPath && hotPathCoords && hotPathCoords.has(`${x},${y}`)) {
          return { x, y };
        }
        if (!fallbackPos) {
          fallbackPos = { x, y };
        }
      }
    }
  }
  return fallbackPos;
}

/**
 * Runs the encounter director for a single room / zone.
 */
export function runForEncounterZone(
  campaign: CampaignData,
  areaDef: AreaDefinition,
  baseEffectiveBudget: number,
  profile: NonNullable<CampaignData['encounterProfiles'][string]>,
  map: GameMap,
  room: RoomBounds,
  existingPlacedEntities: ReadonlyArray<{ readonly templateId: string; readonly x: number; readonly y: number }>,
  _context: DirectorContext | undefined,
  occupiedCoordinates: Set<string>,
  localTokenPool: Set<string>
): DirectorResult {
  let preAllocatedCost = 0;
  const axisBudget: Record<BudgetAxis, number> = {
    protein: baseEffectiveBudget * profile.budgetAllocation.protein,
    appetizer: baseEffectiveBudget * profile.budgetAllocation.appetizer,
    side: baseEffectiveBudget * profile.budgetAllocation.side,
    dessert: baseEffectiveBudget * profile.budgetAllocation.dessert
  };

  const axisSpent: Record<BudgetAxis, number> = { protein: 0, appetizer: 0, side: 0, dessert: 0 };
  const axisSpawned: Record<BudgetAxis, string[]> = { protein: [], appetizer: [], side: [], dessert: [] };
  const axisRejected: Record<BudgetAxis, string[]> = { protein: [], appetizer: [], side: [], dessert: [] };
  const axisCandidates: Record<BudgetAxis, CandidateRecord[]> = {
    protein: [],
    appetizer: [],
    side: [],
    dessert: []
  };
  const pathingFailures = 0;

  for (const placed of existingPlacedEntities) {
    if (placed.x >= room.left && placed.x <= room.right && placed.y >= room.top && placed.y <= room.bottom) {
      const template = campaign.entities[placed.templateId];
      if (template?.crCost && template.roleTags) {
        const axis = resolveAxis(template.roleTags);
        axisBudget[axis] -= template.crCost;
        preAllocatedCost += template.crCost;
      }
    }
  }

  const candidatesByAxis: Record<BudgetAxis, Array<{ templateId: string; cost: number; weight: number }>> = {
    protein: [],
    appetizer: [],
    side: [],
    dessert: []
  };

  const effectiveAreaTags = [...(areaDef.tags || []), ...(_context?.areaMutation?.addedTags || [])];

  for (const pool of Object.values(campaign.spawnPools)) {
    if (pool.conditions) {
      if (pool.conditions.areaTags && !pool.conditions.areaTags.some((t) => effectiveAreaTags.includes(t))) continue;
      if (pool.conditions.biomeTags && !pool.conditions.biomeTags.every((t) => (room.tags ?? []).includes(t))) continue;
    }

    for (const [templateId, weight] of Object.entries(pool.entities)) {
      const template = campaign.entities[templateId];
      if (!template || template.crCost === undefined) continue;

      const axis = resolveAxis(template.roleTags ?? []);

      if (template.persistent && localTokenPool.has(templateId)) {
        axisCandidates[axis].push({
          templateId,
          cost: template.crCost,
          disposition: 'token_exhausted',
          reasonDetail: `Persistent entity '${templateId}' already spawned in this generation cycle.`
        });
        continue;
      }

      candidatesByAxis[axis].push({ templateId, cost: template.crCost, weight });
    }
  }

  const newEntities: Array<{ templateId: string; x: number; y: number; dynamicTraits?: string[] }> = [];
  const axes: BudgetAxis[] = ['protein', 'side', 'appetizer', 'dessert'];

  for (const axis of axes) {
    let budget = axisBudget[axis];
    const preferHotPath = axis === 'protein' || axis === 'side';

    for (const c of candidatesByAxis[axis]) {
      if (c.cost > budget) {
        axisCandidates[axis].push({
          templateId: c.templateId,
          cost: c.cost,
          disposition: 'too_expensive',
          reasonDetail: `Cost ${c.cost} exceeds remaining axis budget ${budget}.`
        });
      }
    }

    while (budget > 0) {
      const affordable = candidatesByAxis[axis].filter((c) => c.cost <= budget && c.cost > 0);
      if (affordable.length === 0) break;

      const weightMap: Record<string, number> = {};
      affordable.forEach((c) => {
        weightMap[c.templateId] = c.weight;
      });

      const selectedId = ROT.RNG.getWeightedValue(weightMap);
      if (!selectedId) break;

      const cost = campaign.entities[selectedId]!.crCost!;

      const pos = getRandomFloorTileInRoom(
        campaign,
        room,
        map,
        occupiedCoordinates,
        _context?.hotPathCoords,
        preferHotPath
      );
      if (!pos) {
        axisRejected[axis].push(`${selectedId} (no space)`);
        axisCandidates[axis].push({
          templateId: selectedId,
          cost,
          disposition: 'no_space',
          reasonDetail: `No available floor tile in room (${room.left},${room.top})-(${room.right},${room.bottom}).`
        });
        break;
      }

      if (campaign.entities[selectedId]?.persistent) {
        localTokenPool.add(selectedId);
      }

      axisCandidates[axis].push({
        templateId: selectedId,
        cost,
        disposition: 'spawned',
        reasonDetail: `Selected via weighted RNG (weight: ${weightMap[selectedId] ?? 'unknown'}). Placed at (${pos.x},${pos.y}).`
      });

      newEntities.push({ templateId: selectedId, x: pos.x, y: pos.y, dynamicTraits: [] });
      occupiedCoordinates.add(`${pos.x},${pos.y}`);
      axisSpawned[axis].push(selectedId);
      axisSpent[axis] += cost;
      budget -= cost;
    }
  }

  const remainingBudget = axes.reduce((sum, axis) => sum + (axisBudget[axis] - axisSpent[axis]), 0);
  const traitUpgrades: string[] = [];

  if (remainingBudget > 0 && newEntities.length > 0) {
    const affordableTraits = Object.values(campaign.traitRegistry).filter(
      (t) => t.crCostModifier !== undefined && t.crCostModifier > 0 && t.crCostModifier <= remainingBudget
    );

    if (affordableTraits.length > 0) {
      const selectedTrait = affordableTraits[Math.floor(ROT.RNG.getUniform() * affordableTraits.length)]!;
      const proteinEntity =
        newEntities.find((e) => campaign.entities[e.templateId]?.roleTags?.includes('protein')) ?? newEntities[0];

      if (proteinEntity) {
        (proteinEntity.dynamicTraits as string[]).push(selectedTrait.id);
        traitUpgrades.push(`${proteinEntity.templateId} +${selectedTrait.id}`);
      }
    }
  }

  const receipt: DirectorReceipt = {
    areaId: '',
    effectiveBudget: baseEffectiveBudget,
    preAllocated: preAllocatedCost,
    axisResults: {
      protein: {
        budget: axisBudget.protein,
        spent: axisSpent.protein,
        spawned: axisSpawned.protein,
        rejected: axisRejected.protein,
        candidates: axisCandidates.protein
      },
      appetizer: {
        budget: axisBudget.appetizer,
        spent: axisSpent.appetizer,
        spawned: axisSpawned.appetizer,
        rejected: axisRejected.appetizer,
        candidates: axisCandidates.appetizer
      },
      side: {
        budget: axisBudget.side,
        spent: axisSpent.side,
        spawned: axisSpawned.side,
        rejected: axisRejected.side,
        candidates: axisCandidates.side
      },
      dessert: {
        budget: axisBudget.dessert,
        spent: axisSpent.dessert,
        spawned: axisSpawned.dessert,
        rejected: axisRejected.dessert,
        candidates: axisCandidates.dessert
      }
    },
    traitUpgrades,
    pathingFailures
  };

  return {
    newEntities,
    traitOverrides: [],
    receipt
  };
}
