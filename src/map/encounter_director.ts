import * as ROT from 'rot-js';
import type { AreaDefinition, CampaignData } from '../types/campaign.types.ts';
import type { GameMap, EntityId } from '../types/game-state.types.ts';
import type {
  BudgetAxis,
  CandidateDisposition,
  CandidateRecord,
  DirectorReceipt,
  DirectorResult,
  RoomBounds,
  DirectorContext
} from '../types/encounter.types.ts';
import { getRandomFloorTileInRoom, runForEncounterZone } from './director/director_zone.ts';

export type {
  BudgetAxis,
  CandidateDisposition,
  CandidateRecord,
  DirectorReceipt,
  DirectorResult,
  RoomBounds,
  DirectorContext
};

/**
 * Distributes dynamic encounter elements across active zones within an area map based on CR budgets.
 */
export function runEncounterDirector(
  campaign: CampaignData,
  areaDef: AreaDefinition,
  map: GameMap,
  rooms: ReadonlyArray<RoomBounds>,
  existingPlacedEntities: ReadonlyArray<{ readonly templateId: string; readonly x: number; readonly y: number }>,
  context?: DirectorContext,
  extraOccupiedCoordinates?: ReadonlySet<string>
): DirectorResult {
  const profileId = areaDef.encounterProfileId;
  if (!profileId) return { newEntities: [], traitOverrides: [], receipt: buildEmptyReceipt(areaDef.id) };

  const profile = campaign.encounterProfiles[profileId];
  if (!profile) return { newEntities: [], traitOverrides: [], receipt: buildEmptyReceipt(areaDef.id) };

  let baseBudget = areaDef.crBudget ?? 0;
  if (areaDef.budgetScaling) {
    baseBudget = areaDef.budgetScaling.baseBudget + areaDef.budgetScaling.scalingFactor * (context?.playerLevel ?? 1);
  }
  if (context?.areaMutation) {
    baseBudget += context.areaMutation.budgetModifier;
  }

  if (baseBudget <= 0 || areaDef.tags?.includes('safe')) {
    return { newEntities: [], traitOverrides: [], receipt: buildEmptyReceipt(areaDef.id) };
  }

  const zones: RoomBounds[] = [];
  if (areaDef.generatorType === 'digger' && rooms.length > 0) {
    zones.push(...rooms.filter((r) => !r.isSafe));
  } else if (areaDef.generatorType !== 'digger') {
    if (!areaDef.tags?.includes('safe')) {
      zones.push({
        left: 1,
        right: map.width - 2,
        top: 1,
        bottom: map.height - 2,
        centerX: Math.floor(map.width / 2),
        centerY: Math.floor(map.height / 2)
      });
    }
  }

  if (zones.length === 0) {
    return { newEntities: [], traitOverrides: [], receipt: buildEmptyReceipt(areaDef.id) };
  }

  const localTokenPool = new Set(context?.tokenPool ?? []);
  const occupiedCoordinates = new Set<string>();
  if (extraOccupiedCoordinates) {
    extraOccupiedCoordinates.forEach((coord) => occupiedCoordinates.add(coord));
  }
  existingPlacedEntities.forEach((e) => occupiedCoordinates.add(`${e.x},${e.y}`));

  const allNewEntities: Array<{
    readonly templateId: string;
    readonly x: number;
    readonly y: number;
    readonly dynamicTraits?: ReadonlyArray<string>;
    readonly preExistingEntityId?: EntityId;
  }> = [];

  if (context?.reservedTokens) {
    for (const token of context.reservedTokens) {
      const zone = ROT.RNG.getItem(zones);
      if (!zone) continue;

      const pos = getRandomFloorTileInRoom(campaign, zone, map, occupiedCoordinates, context?.hotPathCoords, false);
      if (pos) {
        allNewEntities.push({
          templateId: token.templateId,
          x: pos.x,
          y: pos.y,
          preExistingEntityId: token.minionId,
          dynamicTraits: []
        });
        occupiedCoordinates.add(`${pos.x},${pos.y}`);

        const template = campaign.entities[token.templateId];
        if (template?.crCost) {
          baseBudget = Math.max(0, baseBudget - template.crCost / zones.length);
        }
      }
    }
  }

  const activePlaced = [...existingPlacedEntities, ...allNewEntities];

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
      activePlaced,
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
