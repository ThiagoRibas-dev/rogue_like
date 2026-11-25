import { NEED_CRITICAL_THRESHOLD } from '../constants/personality.constants.ts';
import { addComponent, getComponent, getEntitiesAtPosition } from '../core/ecs.ts';
import {
  canTraverseVerticalTiles,
  getMapZBounds,
  getTileDefAt,
  isInMapBounds,
  isMultiZMap
} from '../map/map_accessor.ts';
import { canTraverseTile } from '../systems/movement.system.ts';
import { getEntityMovementModes } from '../systems/movement_displacement.ts';
import { resolveConstructionBlueprint } from '../systems/construction.system.ts';
import { formatDesignationKey, getActiveDesignationsForArea } from '../systems/labor/designation.system.ts';
import {
  entityResourceKey,
  isResourceReservedByOther,
  releaseReservation,
  tileResourceKey,
  tryAcquireReservation,
  workshopResourceKey
} from '../systems/labor/job_blackboard.ts';
import { findUnstockedHaulItems } from '../systems/labor/stockpile.system.ts';
import { collectShopStockItemIds, resolveNextRunnableBill } from '../systems/labor/workshop.system.ts';
import type { LaborIngredient } from '../types/campaign/meta.ts';
import {
  ComponentType,
  type ActiveLaborJobState,
  type InventoryComponent,
  type ItemComponent,
  type LaborProfileComponent,
  type NeedsComponent,
  type PositionComponent,
  type TagsComponent
} from '../types/components.types.ts';
import type { LaborKind, VoxelCoord } from '../types/colony.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { computeHierarchicalNextStep } from './pathfinding_hpa.ts';

const PRIORITY_SCORE_BASE = 5;
const PRIORITY_SCORE_MULTIPLIER = 100;
const DEFAULT_LABOR_PRIORITY = 2;
const DESIGNATION_PRIORITY_WEIGHT = 5;
const WORKSHOP_INPUT_HAUL_BONUS = 15;
const BUILD_INPUT_HAUL_BONUS = 10;
const DEFAULT_LABOR_SEARCH_RADIUS = 24;
const VERTICAL_Z_DISTANCE_WEIGHT = 2;
const MAX_BUILD_LOCAL_RADIUS = 1;

function computeDist3D(a: VoxelCoord, b: VoxelCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) * VERTICAL_Z_DISTANCE_WEIGHT;
}

function resolveMoveStepToward(
  state: Readonly<GameState>,
  entityId: EntityId,
  from: VoxelCoord,
  goal: VoxelCoord,
  stopAdjacent: boolean
): Intent | null {
  const distCheb = Math.max(Math.abs(from.x - goal.x), Math.abs(from.y - goal.y));
  if (stopAdjacent && distCheb <= 1 && from.z === goal.z) return null;
  if (!stopAdjacent && from.x === goal.x && from.y === goal.y && from.z === goal.z) return null;

  const modes = getEntityMovementModes(state as GameState, entityId);
  const { minZ, maxZ } = getMapZBounds(state.map);
  const multiZ = isMultiZMap(state.map);

  const isPassable = (nx: number, ny: number, nz: number, px: number, py: number, pz: number): boolean => {
    if (!isInMapBounds(state.map, nx, ny, nz)) return false;
    if (multiZ && (nz < minZ || nz > maxZ)) return false;
    const toDef = getTileDefAt(state, nx, ny, nz);
    if (nz !== pz) {
      const fromDef = getTileDefAt(state, px, py, pz);
      return canTraverseVerticalTiles(fromDef, toDef, nz - pz);
    }
    if (stopAdjacent && nx === goal.x && ny === goal.y && nz === goal.z) return true;
    return canTraverseTile(toDef, modes, state, nx, ny, nz);
  };

  const step = computeHierarchicalNextStep(state, from.x, from.y, from.z, goal.x, goal.y, goal.z, isPassable);
  if (!step || (step.dx === 0 && step.dy === 0 && step.dz === 0)) return null;

  return {
    type: IntentType.Move,
    entityId,
    dx: step.dx,
    dy: step.dy,
    ...(step.dz !== 0 ? { dz: step.dz } : {})
  };
}

function findCarriedItemIndex(state: Readonly<GameState>, entityId: EntityId, targetItemEntityId: EntityId): number {
  const inv = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (!inv) return -1;
  return inv.items.indexOf(targetItemEntityId);
}

function findEdibleInventoryItemId(state: Readonly<GameState>, entityId: EntityId): EntityId | undefined {
  const inv = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (!inv) return undefined;
  for (const itemId of inv.items) {
    const item = getComponent(state, itemId, ComponentType.Item) as ItemComponent | undefined;
    const def = item ? state.campaign.items[item.itemId] : undefined;
    const tags = (getComponent(state, itemId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
    const effectType = def?.consumable?.effectId ? state.campaign.effects[def.consumable.effectId]?.type : undefined;
    if (def?.tags?.includes('edible') || tags.includes('edible') || effectType === 'satiate') {
      return itemId;
    }
  }
  return undefined;
}

function itemMatchesBuildReq(state: Readonly<GameState>, itemEntityId: EntityId, req: LaborIngredient): boolean {
  const item = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!item) return false;
  if (req.itemId && item.itemId === req.itemId) return true;
  if (!req.tag) return false;
  const tags = (getComponent(state, itemEntityId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  if (tags.includes(req.tag)) return true;
  return state.campaign.items[item.itemId]?.tags?.includes(req.tag) === true;
}

function findMissingBuildMaterialRemote(
  state: Readonly<GameState>,
  workerEntityId: EntityId,
  buildCoord: VoxelCoord,
  blueprintId: string | undefined
):
  | { readonly status: 'ready' }
  | { readonly status: 'haul'; readonly itemEntityId: EntityId; readonly sourceCoord: VoxelCoord }
  | { readonly status: 'missing' } {
  if (!blueprintId) return { status: 'ready' };
  const bp = resolveConstructionBlueprint(state, blueprintId);
  if (!bp || bp.requiredInputs.length === 0) return { status: 'ready' };

  const inv = getComponent(state, workerEntityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const usedIds = new Set<EntityId>();
  let missingReq: LaborIngredient | undefined;

  for (const req of bp.requiredInputs) {
    let have = 0;
    for (const invItemId of inv?.items ?? []) {
      if (have >= req.count) break;
      if (usedIds.has(invItemId)) continue;
      if (itemMatchesBuildReq(state, invItemId, req)) {
        usedIds.add(invItemId);
        have += 1;
      }
    }
    if (have < req.count) {
      for (let dy = -MAX_BUILD_LOCAL_RADIUS; dy <= MAX_BUILD_LOCAL_RADIUS && have < req.count; dy++) {
        for (let dx = -MAX_BUILD_LOCAL_RADIUS; dx <= MAX_BUILD_LOCAL_RADIUS && have < req.count; dx++) {
          for (const gid of getEntitiesAtPosition(state, buildCoord.x + dx, buildCoord.y + dy, buildCoord.z)) {
            if (have >= req.count) break;
            if (usedIds.has(gid)) continue;
            if (itemMatchesBuildReq(state, gid, req)) {
              usedIds.add(gid);
              have += 1;
            }
          }
        }
      }
    }
    if (have < req.count && !missingReq) {
      missingReq = req;
    }
  }

  if (!missingReq) return { status: 'ready' };

  const shopStockIds = collectShopStockItemIds(state);
  for (const eid of state.entities) {
    if (shopStockIds.has(eid)) continue;
    const pos = getComponent(state, eid, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;
    const z = pos.z ?? 0;
    if (isResourceReservedByOther(state, entityResourceKey(eid), workerEntityId)) continue;
    if (itemMatchesBuildReq(state, eid, missingReq)) {
      return { status: 'haul', itemEntityId: eid, sourceCoord: { x: pos.x, y: pos.y, z } };
    }
  }

  return { status: 'missing' };
}

interface CandidateLaborJob {
  readonly score: number;
  readonly job: ActiveLaborJobState;
  readonly resourceKeys: ReadonlyArray<string>;
}

function mapDesignationToLaborKind(kind: string): LaborKind {
  switch (kind) {
    case 'mine':
    case 'channel':
      return 'mining';
    case 'chop':
      return 'chopping';
    case 'build':
      return 'building';
    case 'harvest':
      return 'harvesting';
    default:
      return 'hauling';
  }
}

function getWorkerPriority(profile: LaborProfileComponent | undefined, kind: LaborKind): number {
  if (!profile) return DEFAULT_LABOR_PRIORITY;
  return profile.priorities[kind] ?? 0;
}

function buildCandidateJobs(
  state: Readonly<GameState>,
  entityId: EntityId,
  from: VoxelCoord,
  searchRadius: number
): ReadonlyArray<CandidateLaborJob> {
  const profile = getComponent(state, entityId, ComponentType.LaborProfile) as LaborProfileComponent | undefined;
  const areaId = state.currentAreaId;
  const candidates: CandidateLaborJob[] = [];

  // 1. Spatial tile designations (mine, chop, build + input haul, harvest, channel)
  for (const d of getActiveDesignationsForArea(state, areaId)) {
    const laborKind = mapDesignationToLaborKind(d.kind);
    const prio = getWorkerPriority(profile, laborKind);
    const haulPrio = getWorkerPriority(profile, 'hauling');
    if (prio <= 0 && !(d.kind === 'build' && haulPrio > 0)) continue;

    const targetCoord: VoxelCoord = { x: d.x, y: d.y, z: d.z };
    const tileKey = tileResourceKey(areaId, d.x, d.y, d.z);
    if (isResourceReservedByOther(state, tileKey, entityId)) continue;

    if (d.kind === 'build') {
      const matCheck = findMissingBuildMaterialRemote(state, entityId, targetCoord, d.blueprintId);
      if (matCheck.status === 'haul') {
        if (haulPrio > 0) {
          const dist = computeDist3D(from, matCheck.sourceCoord);
          if (dist <= searchRadius) {
            const itemKey = entityResourceKey(matCheck.itemEntityId);
            if (!isResourceReservedByOther(state, itemKey, entityId)) {
              candidates.push({
                score:
                  (PRIORITY_SCORE_BASE - haulPrio) * PRIORITY_SCORE_MULTIPLIER -
                  dist -
                  d.priority * DESIGNATION_PRIORITY_WEIGHT +
                  BUILD_INPUT_HAUL_BONUS,
                resourceKeys: [itemKey],
                job: {
                  jobId: `haul_build:${d.id}:${matCheck.itemEntityId}`,
                  kind: 'hauling',
                  phase: 'fetch_item',
                  targetCoord: matCheck.sourceCoord,
                  carriedItemEntityId: matCheck.itemEntityId,
                  destinationCoord: targetCoord,
                  reservedResourceKeys: [itemKey]
                }
              });
            }
          }
        }
        continue;
      }
      if (matCheck.status === 'missing') continue;
    }

    if (prio <= 0) continue;
    const dist = computeDist3D(from, targetCoord);
    if (dist > searchRadius) continue;

    candidates.push({
      score: (PRIORITY_SCORE_BASE - prio) * PRIORITY_SCORE_MULTIPLIER - dist - d.priority * DESIGNATION_PRIORITY_WEIGHT,
      resourceKeys: [tileKey],
      job: {
        jobId: `desig:${d.id}`,
        kind: laborKind,
        phase: 'move_to_target',
        targetCoord,
        ...(d.targetEntityId !== undefined ? { targetEntityId: d.targetEntityId } : {}),
        ...(d.blueprintId !== undefined ? { blueprintId: d.blueprintId } : {}),
        reservedResourceKeys: [tileKey]
      }
    });
  }

  // 2. Workshop crafting DAG bills & input hauling
  const craftPrio = getWorkerPriority(profile, 'crafting');
  const haulPrio = getWorkerPriority(profile, 'hauling');
  if (state.colonyState && (craftPrio > 0 || haulPrio > 0)) {
    for (const ws of Object.values(state.colonyState.workshops)) {
      if (ws.areaId !== areaId) continue;
      const wsKey = workshopResourceKey(ws.workshopEntityId);
      if (isResourceReservedByOther(state, wsKey, entityId)) continue;
      const resolution = resolveNextRunnableBill(state, ws.workshopEntityId, entityId);
      if (!resolution) continue;

      if (resolution.mode === 'craft' && craftPrio > 0) {
        const dist = computeDist3D(from, resolution.workshopCoord);
        if (dist <= searchRadius) {
          candidates.push({
            score: (PRIORITY_SCORE_BASE - craftPrio) * PRIORITY_SCORE_MULTIPLIER - dist,
            resourceKeys: [wsKey],
            job: {
              jobId: `craft:${ws.workshopEntityId}:${resolution.bill.billId}`,
              kind: 'crafting',
              phase: 'move_to_target',
              targetCoord: resolution.workshopCoord,
              targetEntityId: ws.workshopEntityId,
              workshopEntityId: ws.workshopEntityId,
              billId: resolution.bill.billId,
              reservedResourceKeys: [wsKey]
            }
          });
        }
      } else if (resolution.mode === 'haul_input' && haulPrio > 0) {
        const dist = computeDist3D(from, resolution.sourceCoord);
        if (dist <= searchRadius) {
          const itemKey = entityResourceKey(resolution.sourceItemEntityId);
          if (!isResourceReservedByOther(state, itemKey, entityId)) {
            candidates.push({
              score: (PRIORITY_SCORE_BASE - haulPrio) * PRIORITY_SCORE_MULTIPLIER - dist + WORKSHOP_INPUT_HAUL_BONUS,
              resourceKeys: [itemKey],
              job: {
                jobId: `haul_in:${resolution.sourceItemEntityId}`,
                kind: 'hauling',
                phase: 'fetch_item',
                targetCoord: resolution.sourceCoord,
                carriedItemEntityId: resolution.sourceItemEntityId,
                destinationCoord: resolution.workshopCoord,
                reservedResourceKeys: [itemKey]
              }
            });
          }
        }
      }
    }
  }

  // 3. General stockpile hauling
  if (haulPrio > 0) {
    for (const h of findUnstockedHaulItems(state, entityId)) {
      const dist = computeDist3D(from, h.sourceCoord);
      if (dist > searchRadius) continue;
      const itemKey = entityResourceKey(h.itemEntityId);
      const cellKey = tileResourceKey(areaId, h.targetCoord.x, h.targetCoord.y, h.targetCoord.z);
      if (isResourceReservedByOther(state, itemKey, entityId) || isResourceReservedByOther(state, cellKey, entityId)) {
        continue;
      }
      candidates.push({
        score: (PRIORITY_SCORE_BASE - haulPrio) * PRIORITY_SCORE_MULTIPLIER - dist,
        resourceKeys: [itemKey, cellKey],
        job: {
          jobId: `haul:${h.itemEntityId}`,
          kind: 'hauling',
          phase: 'fetch_item',
          targetCoord: h.sourceCoord,
          carriedItemEntityId: h.itemEntityId,
          destinationCoord: h.targetCoord,
          reservedResourceKeys: [itemKey, cellKey]
        }
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function produceIntentForJob(
  state: GameState,
  entityId: EntityId,
  from: VoxelCoord,
  job: ActiveLaborJobState
): { readonly state: GameState; readonly intent: Intent | null; readonly clearJob: boolean } {
  if (job.kind === 'hauling' && job.carriedItemEntityId !== undefined && job.destinationCoord !== undefined) {
    const carriedIdx = findCarriedItemIndex(state, entityId, job.carriedItemEntityId);
    if (carriedIdx >= 0) {
      const dropAdjacent = job.jobId.startsWith('haul_build:') || job.jobId.startsWith('haul_in:');
      const atDropSpot = dropAdjacent
        ? Math.max(Math.abs(from.x - job.destinationCoord.x), Math.abs(from.y - job.destinationCoord.y)) <= 1 &&
          from.z === job.destinationCoord.z
        : from.x === job.destinationCoord.x && from.y === job.destinationCoord.y && from.z === job.destinationCoord.z;
      if (atDropSpot) {
        return {
          state,
          intent: { type: IntentType.Drop, entityId, itemIndex: carriedIdx },
          clearJob: true
        };
      }
      const move = resolveMoveStepToward(state, entityId, from, job.destinationCoord, dropAdjacent);
      return { state, intent: move, clearJob: move === null };
    }

    const itemPos = getComponent(state, job.carriedItemEntityId, ComponentType.Position) as
      PositionComponent | undefined;
    if (!itemPos) {
      return { state, intent: null, clearJob: true };
    }
    const itemCoord: VoxelCoord = { x: itemPos.x, y: itemPos.y, z: itemPos.z ?? 0 };
    if (from.x === itemCoord.x && from.y === itemCoord.y && from.z === itemCoord.z) {
      return {
        state,
        intent: { type: IntentType.PickUp, entityId, itemEntityId: job.carriedItemEntityId },
        clearJob: false
      };
    }
    const move = resolveMoveStepToward(state, entityId, from, itemCoord, false);
    return { state, intent: move, clearJob: move === null };
  }

  if (job.kind === 'crafting' && job.workshopEntityId !== undefined) {
    const dist = Math.max(Math.abs(from.x - job.targetCoord.x), Math.abs(from.y - job.targetCoord.y));
    if (dist <= 1 && from.z === job.targetCoord.z) {
      return {
        state,
        intent: {
          type: IntentType.Apply,
          entityId,
          verb: 'craft',
          target: { type: 'entity', entityId: job.workshopEntityId }
        },
        clearJob: false
      };
    }
    const move = resolveMoveStepToward(state, entityId, from, job.targetCoord, true);
    return { state, intent: move, clearJob: move === null };
  }

  const dist = Math.max(Math.abs(from.x - job.targetCoord.x), Math.abs(from.y - job.targetCoord.y));
  if (dist <= 1 && from.z === job.targetCoord.z) {
    const verb =
      job.kind === 'mining' ? 'mine' : job.kind === 'chopping' ? 'chop' : job.kind === 'building' ? 'build' : 'harvest';
    const target =
      verb === 'harvest' && job.targetEntityId !== undefined
        ? ({ type: 'entity', entityId: job.targetEntityId } as const)
        : ({ type: 'tile', x: job.targetCoord.x, y: job.targetCoord.y, z: job.targetCoord.z } as const);
    return {
      state,
      intent: { type: IntentType.Apply, entityId, verb, target },
      clearJob: verb !== 'harvest'
    };
  }

  const move = resolveMoveStepToward(state, entityId, from, job.targetCoord, true);
  return { state, intent: move, clearJob: move === null };
}

/**
 * Evaluates and commits an autonomous colony labor step (with atomic blackboard reservation tracking)
 * for `entityId`, emitting a standard `Move`, `PickUp`, `Drop`, or `Apply` intent.
 */
export function selectAndReserveLaborAction(
  state: GameState,
  entityId: EntityId,
  searchRadius: number = DEFAULT_LABOR_SEARCH_RADIUS
): { readonly state: GameState; readonly intent: Intent | null } {
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return { state, intent: null };
  const from: VoxelCoord = { x: pos.x, y: pos.y, z: pos.z ?? 0 };

  // Emergency self-care if actor needs nourishment critically and carries food
  const needs = getComponent(state, entityId, ComponentType.Needs) as NeedsComponent | undefined;
  if ((needs?.needs['nourishment']?.current ?? 100) <= NEED_CRITICAL_THRESHOLD) {
    const foodId = findEdibleInventoryItemId(state, entityId);
    if (foodId !== undefined) {
      return {
        state,
        intent: { type: IntentType.Apply, entityId, verb: 'eat', target: { type: 'item', itemEntityId: foodId } }
      };
    }
  }

  let nextState = state;
  const profile = getComponent(nextState, entityId, ComponentType.LaborProfile) as LaborProfileComponent | undefined;
  let activeJob = profile?.activeJob;

  if (activeJob) {
    if (activeJob.kind === 'crafting' && activeJob.workshopEntityId !== undefined) {
      const billReady = resolveNextRunnableBill(nextState, activeJob.workshopEntityId, entityId);
      if (!billReady || billReady.mode !== 'craft') {
        nextState = releaseReservation(nextState, activeJob.reservedResourceKeys, entityId);
        activeJob = undefined;
      }
    } else if (activeJob.jobId.startsWith('desig:')) {
      const dKey = formatDesignationKey(
        nextState.currentAreaId,
        activeJob.targetCoord.x,
        activeJob.targetCoord.y,
        activeJob.targetCoord.z
      );
      if (!nextState.colonyState?.designations[dKey]) {
        nextState = releaseReservation(nextState, activeJob.reservedResourceKeys, entityId);
        activeJob = undefined;
      }
    }
    if (!activeJob && profile?.activeJob) {
      const { activeJob: _cleared, ...restProfile } = profile;
      nextState = addComponent(nextState, entityId, restProfile);
    }
  }

  if (activeJob) {
    const exec = produceIntentForJob(nextState, entityId, from, activeJob);
    nextState = exec.state;
    if (exec.clearJob) {
      nextState = releaseReservation(nextState, activeJob.reservedResourceKeys, entityId);
      const latestProfile = getComponent(nextState, entityId, ComponentType.LaborProfile) as
        LaborProfileComponent | undefined;
      if (latestProfile?.activeJob) {
        const { activeJob: _cleared, ...restProfile } = latestProfile;
        nextState = addComponent(nextState, entityId, restProfile);
      }
    }
    if (exec.intent !== null) {
      return { state: nextState, intent: exec.intent };
    }
    activeJob = undefined;
  }

  const candidates = buildCandidateJobs(nextState, entityId, from, searchRadius);
  for (const chosen of candidates) {
    const acq = tryAcquireReservation(nextState, chosen.resourceKeys, chosen.job.jobId, entityId);
    if (!acq.acquired) continue;

    const reservedState = acq.state;
    const exec = produceIntentForJob(reservedState, entityId, from, chosen.job);
    if (exec.intent === null) {
      nextState = releaseReservation(reservedState, chosen.resourceKeys, entityId);
      continue;
    }

    nextState = exec.state;
    if (exec.clearJob) {
      nextState = releaseReservation(nextState, chosen.resourceKeys, entityId);
      const latestProfile = getComponent(nextState, entityId, ComponentType.LaborProfile) as
        LaborProfileComponent | undefined;
      if (latestProfile?.activeJob) {
        const { activeJob: _cleared, ...restProfile } = latestProfile;
        nextState = addComponent(nextState, entityId, restProfile);
      }
    } else if (profile) {
      const latestProfile = getComponent(nextState, entityId, ComponentType.LaborProfile) as
        LaborProfileComponent | undefined;
      if (latestProfile) {
        nextState = addComponent(nextState, entityId, { ...latestProfile, activeJob: chosen.job });
      }
    }
    return { state: nextState, intent: exec.intent };
  }

  return { state: nextState, intent: null };
}

/**
 * Pure `AIBehaviorFn` adapter registered in `BEHAVIOR_REGISTRY['labor']`.
 * Selects the next labor step for an autonomous colonist/NPC without mutating reservation state directly.
 */
export function laborBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  const searchRadius = typeof params['searchRadius'] === 'number' ? params['searchRadius'] : 24;
  return selectAndReserveLaborAction(state, entityId, searchRadius).intent;
}
