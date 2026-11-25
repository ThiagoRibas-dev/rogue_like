import { getComponent, getEntitiesAtPosition, removeEntity, spawnItem } from '../../core/ecs.ts';
import type { CraftingRecipe, LaborIngredient } from '../../types/campaign/meta.ts';
import type { BillRepeatMode, CraftingBill, VoxelCoord, WorkshopState } from '../../types/colony.types.ts';
import {
  ComponentType,
  type InventoryComponent,
  type ItemComponent,
  type MemoryComponent,
  type PositionComponent,
  type ShopComponent,
  type TagsComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { ensureColonyState, isResourceReservedByOther, entityResourceKey } from './job_blackboard.ts';
import { addTimedThought } from '../psychology/thoughts.system.ts';

const INSPIRED_CRAFT_WORK_STEP = 2;
const NORMAL_CRAFT_WORK_STEP = 1;
const CRAFTED_ITEM_THOUGHT_MOOD = 6;
const CRAFTED_ITEM_THOUGHT_DURATION = 40;
const CRAFTED_ITEM_THOUGHT_MAX_STACKS = 2;
const WORKSHOP_PROXIMITY_RADIUS = 1;

/** Fallback crafting recipes active when a campaign does not specify custom recipes in `rules.json`. */
export const DEFAULT_CRAFTING_RECIPES: Readonly<Record<string, CraftingRecipe>> = {
  cut_stone_blocks: {
    id: 'cut_stone_blocks',
    name: 'Cut Stone Blocks',
    workshopTag: 'workshop:masonry',
    requiredInputs: [{ tag: 'material:stone', count: 1 }],
    workUnits: 2,
    outputs: [{ itemId: 'cut_stone_block', count: 1 }]
  }
};

function getRecipe(state: Readonly<GameState>, recipeId: string): CraftingRecipe | undefined {
  return state.campaign.rules.craftingRecipes?.[recipeId] ?? DEFAULT_CRAFTING_RECIPES[recipeId];
}

function itemMatchesIngredient(state: Readonly<GameState>, itemEntityId: EntityId, req: LaborIngredient): boolean {
  const item = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!item) return false;
  if (req.itemId && item.itemId === req.itemId) return true;
  if (!req.tag) return false;
  const tags = (getComponent(state, itemEntityId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  if (tags.includes(req.tag)) return true;
  return state.campaign.items[item.itemId]?.tags?.includes(req.tag) === true;
}

/** Registers a workshop entity and its station tag inside `state.colonyState.workshops`. */
export function registerWorkshop(state: GameState, workshopEntityId: EntityId, workshopTag: string): GameState {
  const colony = ensureColonyState(state);
  const key = String(workshopEntityId);
  if (colony.workshops[key]) return state;
  const ws: WorkshopState = {
    workshopEntityId,
    areaId: state.currentAreaId,
    workshopTag,
    bills: []
  };
  return {
    ...state,
    colonyState: {
      ...colony,
      workshops: { ...colony.workshops, [key]: ws }
    }
  };
}

/** Enqueues a crafting production bill onto a registered workshop entity. */
export function enqueueCraftingBill(
  state: GameState,
  workshopEntityId: EntityId,
  input: {
    readonly billId: string;
    readonly recipeId: string;
    readonly repeatMode?: BillRepeatMode | undefined;
    readonly targetCount?: number | undefined;
  }
): GameState {
  const colony = ensureColonyState(state);
  const key = String(workshopEntityId);
  const ws = colony.workshops[key];
  if (!ws) return state;

  const bill: CraftingBill = {
    billId: input.billId,
    recipeId: input.recipeId,
    repeatMode: input.repeatMode ?? 'do_x_times',
    targetCount: input.targetCount ?? 1,
    completedCount: 0,
    workProgress: 0,
    paused: false
  };

  return {
    ...state,
    colonyState: {
      ...colony,
      workshops: {
        ...colony.workshops,
        [key]: { ...ws, bills: [...ws.bills, bill] }
      }
    }
  };
}

/** Collects all entity IDs currently inside any actor's merchant `ShopComponent.stock`. */
export function collectShopStockItemIds(state: Readonly<GameState>): ReadonlySet<EntityId> {
  const stockIds = new Set<EntityId>();
  for (const eid of state.entities) {
    const shop = getComponent(state, eid, ComponentType.Shop) as ShopComponent | undefined;
    if (!shop) continue;
    for (const stockItemId of shop.inventory) {
      stockIds.add(stockItemId);
    }
  }
  return stockIds;
}

function itemHasTag(state: Readonly<GameState>, itemEntityId: EntityId, requiredTag: string): boolean {
  const tags = (getComponent(state, itemEntityId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  if (tags.includes(requiredTag)) return true;
  const item = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  return item ? state.campaign.items[item.itemId]?.tags?.includes(requiredTag) === true : false;
}

function hasWorkshopRequiredTool(
  state: Readonly<GameState>,
  actorId: EntityId,
  wsCoord: VoxelCoord,
  requiredToolTag: string | undefined
): boolean {
  if (!requiredToolTag) return true;
  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (inv?.items.some((id) => itemHasTag(state, id, requiredToolTag))) return true;
  for (let dy = -WORKSHOP_PROXIMITY_RADIUS; dy <= WORKSHOP_PROXIMITY_RADIUS; dy++) {
    for (let dx = -WORKSHOP_PROXIMITY_RADIUS; dx <= WORKSHOP_PROXIMITY_RADIUS; dx++) {
      for (const groundId of getEntitiesAtPosition(state, wsCoord.x + dx, wsCoord.y + dy, wsCoord.z)) {
        if (itemHasTag(state, groundId, requiredToolTag)) return true;
      }
    }
  }
  return false;
}

function countStockedOutputItems(state: Readonly<GameState>, itemId: string): number {
  const shopStockIds = collectShopStockItemIds(state);
  let count = 0;
  for (const eid of state.entities) {
    if (shopStockIds.has(eid)) continue;
    const item = getComponent(state, eid, ComponentType.Item) as ItemComponent | undefined;
    if (item && item.itemId === itemId && getComponent(state, eid, ComponentType.Position) !== undefined) {
      count += 1;
    }
  }
  return count;
}

function isBillSatisfied(state: Readonly<GameState>, bill: CraftingBill, recipe: CraftingRecipe): boolean {
  if (bill.paused) return true;
  if (bill.repeatMode === 'forever') return false;
  if (bill.repeatMode === 'do_x_times') {
    return bill.completedCount >= bill.targetCount;
  }
  const primaryOut = recipe.outputs[0];
  if (!primaryOut) return true;
  return countStockedOutputItems(state, primaryOut.itemId) >= bill.targetCount;
}

function findLocalMatchingInputs(
  state: Readonly<GameState>,
  wsCoord: VoxelCoord,
  requirements: ReadonlyArray<LaborIngredient>
): {
  readonly satisfied: boolean;
  readonly consumedIds: ReadonlyArray<EntityId>;
  readonly missingReq?: LaborIngredient;
} {
  const consumedIds: EntityId[] = [];
  const used = new Set<EntityId>();

  for (const req of requirements) {
    let have = 0;
    for (let dy = -1; dy <= 1 && have < req.count; dy++) {
      for (let dx = -1; dx <= 1 && have < req.count; dx++) {
        for (const eid of getEntitiesAtPosition(state, wsCoord.x + dx, wsCoord.y + dy, wsCoord.z)) {
          if (have >= req.count) break;
          if (used.has(eid)) continue;
          if (itemMatchesIngredient(state, eid, req)) {
            used.add(eid);
            consumedIds.push(eid);
            have += 1;
          }
        }
      }
    }
    if (have < req.count) {
      return { satisfied: false, consumedIds, missingReq: req };
    }
  }

  return { satisfied: true, consumedIds };
}

function findRemoteMatchingInput(
  state: Readonly<GameState>,
  wsCoord: VoxelCoord,
  workerEntityId: EntityId,
  req: LaborIngredient
): { readonly itemEntityId: EntityId; readonly coord: VoxelCoord } | undefined {
  const shopStockIds = collectShopStockItemIds(state);
  for (const eid of state.entities) {
    if (shopStockIds.has(eid)) continue;
    const pos = getComponent(state, eid, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;
    const z = pos.z ?? 0;
    if (
      Math.abs(pos.x - wsCoord.x) <= WORKSHOP_PROXIMITY_RADIUS &&
      Math.abs(pos.y - wsCoord.y) <= WORKSHOP_PROXIMITY_RADIUS &&
      z === wsCoord.z
    ) {
      continue;
    }
    if (isResourceReservedByOther(state, entityResourceKey(eid), workerEntityId)) continue;
    if (itemMatchesIngredient(state, eid, req)) {
      return { itemEntityId: eid, coord: { x: pos.x, y: pos.y, z } };
    }
  }
  return undefined;
}

/**
 * Returns `true` when `itemEntityId` at `coord` sits adjacent to an active workshop in the current area
 * with an unsatisfied bill requiring that item as a recipe ingredient (prevents stockpile haulers from stealing inputs).
 */
export function isItemNeededAtAdjacentWorkshop(
  state: Readonly<GameState>,
  itemEntityId: EntityId,
  coord: VoxelCoord
): boolean {
  const workshops = state.colonyState?.workshops;
  if (!workshops) return false;
  for (const ws of Object.values(workshops)) {
    if (ws.areaId !== state.currentAreaId) continue;
    const wsPos = getComponent(state, ws.workshopEntityId, ComponentType.Position) as PositionComponent | undefined;
    if (!wsPos) continue;
    const wz = wsPos.z ?? 0;
    if (
      wz !== coord.z ||
      Math.abs(wsPos.x - coord.x) > WORKSHOP_PROXIMITY_RADIUS ||
      Math.abs(wsPos.y - coord.y) > WORKSHOP_PROXIMITY_RADIUS
    ) {
      continue;
    }
    for (const bill of ws.bills) {
      const recipe = getRecipe(state, bill.recipeId);
      if (!recipe || isBillSatisfied(state, bill, recipe)) continue;
      if (recipe.requiredInputs.some((req) => itemMatchesIngredient(state, itemEntityId, req))) {
        return true;
      }
    }
  }
  return false;
}

/** Resolution result describing whether a workshop bill is ready to craft or needs input hauling first. */
export type RunnableWorkshopResolution =
  | {
      readonly mode: 'craft';
      readonly workshop: WorkshopState;
      readonly workshopCoord: VoxelCoord;
      readonly bill: CraftingBill;
      readonly recipe: CraftingRecipe;
    }
  | {
      readonly mode: 'haul_input';
      readonly workshop: WorkshopState;
      readonly workshopCoord: VoxelCoord;
      readonly bill: CraftingBill;
      readonly recipe: CraftingRecipe;
      readonly sourceItemEntityId: EntityId;
      readonly sourceCoord: VoxelCoord;
    };

/** Resolves the highest-priority runnable crafting step or prerequisite input-haul sub-job at a workshop. */
export function resolveNextRunnableBill(
  state: Readonly<GameState>,
  workshopEntityId: EntityId,
  workerEntityId: EntityId
): RunnableWorkshopResolution | undefined {
  const ws = state.colonyState?.workshops[String(workshopEntityId)];
  if (!ws || ws.areaId !== state.currentAreaId) return undefined;
  const wsPos = getComponent(state, workshopEntityId, ComponentType.Position) as PositionComponent | undefined;
  if (!wsPos) return undefined;
  const wsCoord: VoxelCoord = { x: wsPos.x, y: wsPos.y, z: wsPos.z ?? 0 };

  for (const bill of ws.bills) {
    const recipe = getRecipe(state, bill.recipeId);
    if (!recipe) continue;
    if (isBillSatisfied(state, bill, recipe)) continue;

    const localCheck = findLocalMatchingInputs(state, wsCoord, recipe.requiredInputs);
    if (localCheck.satisfied) {
      if (!hasWorkshopRequiredTool(state, workerEntityId, wsCoord, recipe.requiredToolTag)) continue;
      return { mode: 'craft', workshop: ws, workshopCoord: wsCoord, bill, recipe };
    }

    if (localCheck.missingReq) {
      const remote = findRemoteMatchingInput(state, wsCoord, workerEntityId, localCheck.missingReq);
      if (remote) {
        return {
          mode: 'haul_input',
          workshop: ws,
          workshopCoord: wsCoord,
          bill,
          recipe,
          sourceItemEntityId: remote.itemEntityId,
          sourceCoord: remote.coord
        };
      }
    }
  }

  return undefined;
}

/**
 * Advances active crafting bill work at `workshopEntityId`. When `workProgress >= recipe.workUnits`,
 * consumes local inputs, spawns recipe outputs, updates bill counts, and emits a positive crafting thought.
 */
export function advanceWorkshopBillWork(
  state: GameState,
  actorId: EntityId,
  workshopEntityId: EntityId,
  billId?: string
): { readonly state: GameState; readonly progressed: boolean; readonly completed: boolean } {
  const colony = state.colonyState;
  const ws = colony?.workshops[String(workshopEntityId)];
  const wsPos = getComponent(state, workshopEntityId, ComponentType.Position) as PositionComponent | undefined;
  if (!colony || !ws || !wsPos) return { state, progressed: false, completed: false };

  const wsCoord: VoxelCoord = { x: wsPos.x, y: wsPos.y, z: wsPos.z ?? 0 };
  const targetBill =
    (billId ? ws.bills.find((b) => b.billId === billId) : undefined) ??
    ws.bills.find((b) => {
      const r = getRecipe(state, b.recipeId);
      return (
        r !== undefined &&
        !isBillSatisfied(state, b, r) &&
        findLocalMatchingInputs(state, wsCoord, r.requiredInputs).satisfied
      );
    });

  if (!targetBill) return { state, progressed: false, completed: false };
  const recipe = getRecipe(state, targetBill.recipeId);
  if (!recipe) return { state, progressed: false, completed: false };

  const localInputs = findLocalMatchingInputs(state, wsCoord, recipe.requiredInputs);
  if (!localInputs.satisfied) return { state, progressed: false, completed: false };
  if (!hasWorkshopRequiredTool(state, actorId, wsCoord, recipe.requiredToolTag)) {
    return { state, progressed: false, completed: false };
  }

  const memory = getComponent(state, actorId, ComponentType.Memory) as MemoryComponent | undefined;
  const hasInsp =
    memory?.activeInspiration !== undefined &&
    memory.activeInspiration.expiresAtTurn > (state.globalTurn ?? 0) &&
    (memory.activeInspiration.kind === 'inspired_craft' || memory.activeInspiration.kind === 'work_frenzy');
  const stepGain = hasInsp ? INSPIRED_CRAFT_WORK_STEP : NORMAL_CRAFT_WORK_STEP;

  const nextProgress = targetBill.workProgress + stepGain;
  let nextState = state;
  let completed = false;
  let updatedBill: CraftingBill;

  if (nextProgress >= recipe.workUnits) {
    completed = true;
    for (const inputId of localInputs.consumedIds) {
      nextState = removeEntity(nextState, inputId);
    }
    for (const out of recipe.outputs) {
      if (!nextState.campaign.items[out.itemId]) continue;
      for (let i = 0; i < out.count; i++) {
        [nextState] = spawnItem(nextState, out.itemId, wsCoord.x, wsCoord.y, wsCoord.z);
      }
    }
    updatedBill = {
      ...targetBill,
      completedCount: targetBill.completedCount + 1,
      workProgress: 0
    };
    if (memory) {
      nextState = addTimedThought(nextState, actorId, {
        thoughtId: 'crafted_item',
        eventSummary: `Crafted ${recipe.name}`,
        moodDelta: CRAFTED_ITEM_THOUGHT_MOOD,
        durationTurns: CRAFTED_ITEM_THOUGHT_DURATION,
        maxStacks: CRAFTED_ITEM_THOUGHT_MAX_STACKS
      });
    }
  } else {
    updatedBill = { ...targetBill, workProgress: nextProgress };
  }

  const nextBills = ws.bills.map((b) => (b.billId === updatedBill.billId ? updatedBill : b));
  const latestColony = ensureColonyState(nextState);
  nextState = {
    ...nextState,
    colonyState: {
      ...latestColony,
      workshops: {
        ...latestColony.workshops,
        [String(workshopEntityId)]: { ...ws, bills: nextBills }
      }
    }
  };

  return { state: nextState, progressed: true, completed };
}
