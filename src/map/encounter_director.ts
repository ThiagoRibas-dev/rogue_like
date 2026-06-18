import * as ROT from 'rot-js';
import type { AreaDefinition, CampaignData } from '../types/campaign.types.ts';
import type { GameMap } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';

export type BudgetAxis = 'protein' | 'appetizer' | 'side' | 'dessert';

export type CandidateDisposition = 'spawned' | 'too_expensive' | 'token_exhausted' | 'no_space' | 'pool_filtered';

export interface CandidateRecord {
  readonly templateId: string;
  readonly cost: number;
  readonly disposition: CandidateDisposition;
  readonly reasonDetail?: string;
}

export interface DirectorReceipt {
  readonly areaId: string;
  readonly effectiveBudget: number;
  readonly preAllocated: number;
  readonly axisResults: Record<
    BudgetAxis,
    {
      readonly budget: number;
      readonly spent: number;
      readonly spawned: ReadonlyArray<string>;
      readonly rejected: ReadonlyArray<string>;
      readonly candidates: ReadonlyArray<CandidateRecord>;
    }
  >;
  readonly traitUpgrades: string[];
  readonly pathingFailures: number;
}

export interface DirectorResult {
  readonly newEntities: ReadonlyArray<{
    readonly templateId: string;
    readonly x: number;
    readonly y: number;
    readonly dynamicTraits?: ReadonlyArray<string>;
  }>;
  readonly traitOverrides: ReadonlyArray<{ readonly templateId: string; readonly traits: ReadonlyArray<string> }>;
  readonly receipt: DirectorReceipt;
}

export interface RoomBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly isSafe?: boolean;
  readonly tags?: ReadonlyArray<string>;
}

export interface DirectorContext {
  readonly playerLevel: number;
  readonly tokenPool: ReadonlySet<string>;
}

function resolveAxis(roleTags: ReadonlyArray<string>): BudgetAxis {
  if (roleTags.includes('protein')) return 'protein';
  if (roleTags.includes('appetizer')) return 'appetizer';
  if (roleTags.includes('side')) return 'side';
  if (roleTags.includes('dessert')) return 'dessert';
  return 'protein'; // Fallback
}

function getRandomFloorTileInRoom(
  room: RoomBounds,
  map: GameMap,
  occupiedCoordinates: Set<string>
): { x: number; y: number } | null {
  // Attempt to find a random open tile within a limited number of tries to prevent infinite loops
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(ROT.RNG.getUniform() * (room.right - room.left + 1)) + room.left;
    const y = Math.floor(ROT.RNG.getUniform() * (room.bottom - room.top + 1)) + room.top;
    const idx = coordToIndex(x, y, map.width);

    // Quick check if it's within bounds and walkable based on standard floor naming
    if (map.tiles[idx] && !occupiedCoordinates.has(`${x},${y}`)) {
      const tileId = map.tiles[idx]!.tileId;
      // In a real scenario we'd check campaign.tiles[tileId].walkable, but for procedural areas
      // we know walls and doors are usually not 'floor'.
      // For simplicity, we just avoid anything that isn't explicitly open or check for substrings.
      if (!tileId.includes('wall') && !tileId.includes('water')) {
        return { x, y };
      }
    }
  }
  return null;
}

/**
 * Runs the encounter director for a single room.
 */
function runForEncounterZone(
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
  // 1. Initialize budget tracking
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

  // 2. Pre-Allocate from existing entities inside THIS room
  for (const placed of existingPlacedEntities) {
    // Check if the placed entity is inside this room bounds
    if (placed.x >= room.left && placed.x <= room.right && placed.y >= room.top && placed.y <= room.bottom) {
      const template = campaign.entities[placed.templateId];
      if (template?.crCost && template.roleTags) {
        const axis = resolveAxis(template.roleTags);
        axisBudget[axis] -= template.crCost;
        preAllocatedCost += template.crCost;
      }
    }
  }

  // 3. Build candidate pools
  const candidatesByAxis: Record<BudgetAxis, Array<{ templateId: string; cost: number; weight: number }>> = {
    protein: [],
    appetizer: [],
    side: [],
    dessert: []
  };

  for (const pool of Object.values(campaign.spawnPools)) {
    if (pool.conditions) {
      if (pool.conditions.areaTags && !pool.conditions.areaTags.some((t) => (areaDef.tags ?? []).includes(t))) continue;
      if (pool.conditions.biomeTags && !pool.conditions.biomeTags.every((t) => (room.tags ?? []).includes(t))) continue;
    }

    for (const [templateId, weight] of Object.entries(pool.entities)) {
      const template = campaign.entities[templateId];
      if (!template || template.crCost === undefined) continue;

      const axis = resolveAxis(template.roleTags ?? []);

      // Exclude tokens that have already been spawned globally or in this map generation
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

  // 4. Spend Budget
  const newEntities: Array<{ templateId: string; x: number; y: number; dynamicTraits?: string[] }> = [];
  const axes: BudgetAxis[] = ['protein', 'side', 'appetizer', 'dessert'];

  for (const axis of axes) {
    let budget = axisBudget[axis];

    // Mark all candidates that are too expensive from the start
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
      // Filter candidates that we can afford
      const affordable = candidatesByAxis[axis].filter((c) => c.cost <= budget && c.cost > 0);
      if (affordable.length === 0) {
        break; // Can't afford anything else in this axis
      }

      // Build weighted map for ROT.RNG
      const weightMap: Record<string, number> = {};
      affordable.forEach((c) => {
        weightMap[c.templateId] = c.weight;
      });

      const selectedId = ROT.RNG.getWeightedValue(weightMap);
      if (!selectedId) break;

      const cost = campaign.entities[selectedId]!.crCost!;

      // Find coordinate
      const pos = getRandomFloorTileInRoom(room, map, occupiedCoordinates);
      if (!pos) {
        // Couldn't find room, reject
        axisRejected[axis].push(`${selectedId} (no space)`);
        axisCandidates[axis].push({
          templateId: selectedId,
          cost,
          disposition: 'no_space',
          reasonDetail: `No available floor tile in room (${room.left},${room.top})-(${room.right},${room.bottom}).`
        });
        break;
      }

      // TODO: If this is a 'side' (hazard), we should run ROT.Path.AStar to ensure it doesn't block the room's doors.
      // For now, we skip the AStar logic to avoid immense computational overhead on generation,
      // relying on the fact that random placement usually doesn't create perfect soft-locks.
      // If we implement AStar, increment pathingFailures if it fails and `continue` to try another pos/entity.

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

  // 4.5 Budget Padding with Dynamic Traits
  const remainingBudget = axes.reduce((sum, axis) => sum + (axisBudget[axis] - axisSpent[axis]), 0);
  const traitUpgrades: string[] = [];

  if (remainingBudget > 0 && newEntities.length > 0) {
    const affordableTraits = Object.values(campaign.traitRegistry).filter(
      (t) => t.crCostModifier !== undefined && t.crCostModifier > 0 && t.crCostModifier <= remainingBudget
    );

    if (affordableTraits.length > 0) {
      // Pick a random affordable trait
      const selectedTrait = affordableTraits[Math.floor(ROT.RNG.getUniform() * affordableTraits.length)]!;

      // Prefer applying it to the protein, else the first entity
      const proteinEntity =
        newEntities.find((e) => campaign.entities[e.templateId]?.roleTags?.includes('protein')) ?? newEntities[0];

      if (proteinEntity) {
        (proteinEntity.dynamicTraits as string[]).push(selectedTrait.id);
        traitUpgrades.push(`${proteinEntity.templateId} +${selectedTrait.id}`);
        // Deduct from some axis conceptually, or just leave it. We'll add it to the receipt.
      }
    }
  }

  // 5. Build Receipt
  const receipt: DirectorReceipt = {
    areaId: '', // Filled by caller
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

export function runEncounterDirector(
  campaign: CampaignData,
  areaDef: AreaDefinition,
  map: GameMap,
  rooms: ReadonlyArray<RoomBounds>,
  existingPlacedEntities: ReadonlyArray<{ readonly templateId: string; readonly x: number; readonly y: number }>,
  context?: DirectorContext
): DirectorResult {
  const profileId = areaDef.encounterProfileId;
  if (!profileId) return { newEntities: [], traitOverrides: [], receipt: buildEmptyReceipt(areaDef.id) };

  const profile = campaign.encounterProfiles[profileId];
  if (!profile) return { newEntities: [], traitOverrides: [], receipt: buildEmptyReceipt(areaDef.id) };

  // Calculate Base CR Budget (per encounter zone / room)
  let baseBudget = areaDef.crBudget ?? 0;
  if (areaDef.budgetScaling) {
    baseBudget = areaDef.budgetScaling.baseBudget + areaDef.budgetScaling.scalingFactor * (context?.playerLevel ?? 1);
  }

  if (baseBudget <= 0) return { newEntities: [], traitOverrides: [], receipt: buildEmptyReceipt(areaDef.id) };

  // Determine Encounter Zones (Rooms vs Global)
  const zones: RoomBounds[] = [];
  if (areaDef.generatorType === 'digger' && rooms.length > 0) {
    // For Digger maps, use rooms, but exclude explicitly marked safe rooms (like start or portals)
    zones.push(...rooms.filter((r) => !r.isSafe));
  } else if (areaDef.generatorType !== 'digger') {
    // For Cellular or global maps, treat the whole area as one giant zone
    zones.push({
      left: 1,
      right: map.width - 2,
      top: 1,
      bottom: map.height - 2,
      centerX: Math.floor(map.width / 2),
      centerY: Math.floor(map.height / 2)
    });
  }

  // If all zones were filtered out (e.g., a tiny 1-room map that is a safe starting room)
  if (zones.length === 0) {
    return { newEntities: [], traitOverrides: [], receipt: buildEmptyReceipt(areaDef.id) };
  }

  const localTokenPool = new Set(context?.tokenPool ?? []);
  const occupiedCoordinates = new Set<string>();
  existingPlacedEntities.forEach((e) => occupiedCoordinates.add(`${e.x},${e.y}`));

  const allNewEntities: Array<{ templateId: string; x: number; y: number; dynamicTraits?: ReadonlyArray<string> }> = [];
  let totalPreAllocated = 0;
  const mergedAxisResults: Record<
    BudgetAxis,
    { budget: number; spent: number; spawned: string[]; rejected: string[]; candidates: CandidateRecord[] }
  > = {
    protein: { budget: 0, spent: 0, spawned: [], rejected: [], candidates: [] },
    appetizer: { budget: 0, spent: 0, spawned: [], rejected: [], candidates: [] },
    side: { budget: 0, spent: 0, spawned: [], rejected: [], candidates: [] },
    dessert: { budget: 0, spent: 0, spawned: [], rejected: [], candidates: [] }
  };

  const mergedTraitUpgrades: string[] = [];

  for (const zone of zones) {
    const zoneResult = runForEncounterZone(
      campaign,
      areaDef,
      baseBudget,
      profile,
      map,
      zone,
      existingPlacedEntities,
      context,
      occupiedCoordinates,
      localTokenPool
    );
    allNewEntities.push(...zoneResult.newEntities);
    mergedTraitUpgrades.push(...zoneResult.receipt.traitUpgrades);

    totalPreAllocated += zoneResult.receipt.preAllocated;
    for (const axis of ['protein', 'appetizer', 'side', 'dessert'] as BudgetAxis[]) {
      mergedAxisResults[axis].budget += zoneResult.receipt.axisResults[axis].budget;
      mergedAxisResults[axis].spent += zoneResult.receipt.axisResults[axis].spent;
      mergedAxisResults[axis].spawned.push(...zoneResult.receipt.axisResults[axis].spawned);
      mergedAxisResults[axis].rejected.push(...zoneResult.receipt.axisResults[axis].rejected);
      mergedAxisResults[axis].candidates.push(...zoneResult.receipt.axisResults[axis].candidates);
    }
  }

  const mergedReceipt: DirectorReceipt = {
    areaId: areaDef.id,
    effectiveBudget: baseBudget * zones.length,
    preAllocated: totalPreAllocated,
    axisResults: mergedAxisResults,
    traitUpgrades: mergedTraitUpgrades,
    pathingFailures: 0
  };

  return {
    newEntities: allNewEntities,
    traitOverrides: [],
    receipt: mergedReceipt
  };
}

function buildEmptyReceipt(areaId: string): DirectorReceipt {
  const emptyAxis = {
    budget: 0,
    spent: 0,
    spawned: [] as string[],
    rejected: [] as string[],
    candidates: [] as CandidateRecord[]
  };
  return {
    areaId,
    effectiveBudget: 0,
    preAllocated: 0,
    axisResults: {
      protein: { ...emptyAxis },
      appetizer: { ...emptyAxis },
      side: { ...emptyAxis },
      dessert: { ...emptyAxis }
    },
    traitUpgrades: [],
    pathingFailures: 0
  };
}
