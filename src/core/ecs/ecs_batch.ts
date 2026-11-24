import { type Component, ComponentType, type PositionComponent } from '../../types/components.types.ts';
import { type EntityId, type GameState, toEntityId } from '../../types/game-state.types.ts';
import { isEntityIdInUse, patchSpatialIndexInPlace } from './ecs_core.ts';

/**
 * Transaction interface for batching multiple ECS entity/component mutations inside a single
 * copy-on-write state update while preserving reference identity for untouched entities.
 */
export interface EcsBatch {
  /** Allocates a collision-free EntityId and registers it in the active entity list. */
  createEntity(): EntityId;
  /** Attaches or replaces a component on an entity, updating spatialIndex incrementally if needed. */
  addComponent<C extends Component>(entityId: EntityId, component: C): void;
  /** Removes a component type from an entity, updating spatialIndex incrementally if Position. */
  removeComponent(entityId: EntityId, type: ComponentType): void;
  /** Removes an entity and its components from the batch state. */
  removeEntity(entityId: EntityId): void;
  /** Reads a component against the batch's latest working view. */
  getComponent<T extends ComponentType>(
    entityId: EntityId,
    type: T
  ): Extract<Component, { readonly type: T }> | undefined;
  /**
   * Flushes pending batch edits into an immutable GameState snapshot (for calling non-batched helpers)
   * without contaminating previously returned snapshots on subsequent batch writes.
   */
  snapshot(): GameState;
}

/**
 * Executes multiple ECS operations inside a copy-on-write transaction, cloning top-level `Map`s at most once
 * per commit and cloning individual entity component objects only on first write so untouched entities preserve
 * strict reference identity (`prev.components.get(id) === next.components.get(id)`).
 *
 * @param state Starting immutable GameState.
 * @param fn Callback receiving the batch transaction interface and returning a result value.
 * @returns Committed immutable GameState paired with the callback's return value.
 */
export function withEcsBatch<TResult>(
  state: GameState,
  fn: (batch: EcsBatch) => TResult
): { readonly state: GameState; readonly result: TResult } {
  let baseState = state;
  let workingEntities: EntityId[] | null = null;
  let removedEntityIds: Set<EntityId> | null = null;
  let workingComponents: Map<EntityId, Record<string, Component>> | null = null;
  let workingSpatial: Map<string, ReadonlyArray<EntityId>> | null = null;
  let workingNextEntityId = state.nextEntityId;
  let clonedEntityRecords = new Set<EntityId>();
  let copiedSpatialKeys = new Set<string>();

  const ensureComponents = (): Map<EntityId, Record<string, Component>> => {
    if (!workingComponents) {
      workingComponents = new Map(baseState.components as ReadonlyMap<EntityId, Record<string, Component>>);
    }
    return workingComponents;
  };

  const ensureWritableEntityRecord = (entityId: EntityId): Record<string, Component> => {
    const comps = ensureComponents();
    const existing = comps.get(entityId);
    if (!existing) {
      const fresh: Record<string, Component> = {};
      comps.set(entityId, fresh);
      clonedEntityRecords.add(entityId);
      return fresh;
    }
    if (clonedEntityRecords.has(entityId)) {
      return existing;
    }
    const copy: Record<string, Component> = { ...existing };
    comps.set(entityId, copy);
    clonedEntityRecords.add(entityId);
    return copy;
  };

  const ensureSpatial = (): Map<string, ReadonlyArray<EntityId>> => {
    if (!workingSpatial) {
      workingSpatial = new Map(baseState.spatialIndex);
    }
    return workingSpatial;
  };

  const commitWorkingState = (): GameState => {
    const hasRemovals = removedEntityIds !== null && removedEntityIds.size > 0;
    if (
      workingEntities === null &&
      !hasRemovals &&
      workingComponents === null &&
      workingSpatial === null &&
      workingNextEntityId === baseState.nextEntityId
    ) {
      return baseState;
    }
    const finalEntities = hasRemovals
      ? (workingEntities ?? baseState.entities).filter((id) => !removedEntityIds!.has(id))
      : workingEntities;
    baseState = {
      ...baseState,
      ...(finalEntities !== null ? { entities: finalEntities } : {}),
      ...(workingComponents !== null ? { components: workingComponents } : {}),
      ...(workingSpatial !== null ? { spatialIndex: workingSpatial } : {}),
      ...(workingNextEntityId !== baseState.nextEntityId ? { nextEntityId: workingNextEntityId } : {})
    };
    workingEntities = null;
    removedEntityIds = null;
    workingComponents = null;
    workingSpatial = null;
    clonedEntityRecords = new Set<EntityId>();
    copiedSpatialKeys = new Set<string>();
    return baseState;
  };

  const isIdInUse = (id: EntityId): boolean => {
    if (removedEntityIds?.has(id)) return false;
    if (workingComponents?.has(id)) return true;
    return isEntityIdInUse(baseState, id);
  };

  const batch: EcsBatch = {
    createEntity(): EntityId {
      let candidateId = workingNextEntityId;
      let newId = toEntityId(candidateId);
      while (isIdInUse(newId)) {
        candidateId++;
        newId = toEntityId(candidateId);
      }
      workingNextEntityId = candidateId + 1;
      removedEntityIds?.delete(newId);

      if (!workingEntities) {
        workingEntities = [...baseState.entities];
      }
      workingEntities.push(newId);

      const comps = ensureComponents();
      comps.set(newId, {});
      clonedEntityRecords.add(newId);
      return newId;
    },

    addComponent<C extends Component>(entityId: EntityId, component: C): void {
      const record = ensureWritableEntityRecord(entityId);
      const prevPos =
        component.type === ComponentType.Position
          ? (record[ComponentType.Position] as PositionComponent | undefined)
          : undefined;
      record[component.type] = component;
      if (component.type === ComponentType.Position) {
        patchSpatialIndexInPlace(ensureSpatial(), copiedSpatialKeys, entityId, prevPos, component);
      }
    },

    removeComponent(entityId: EntityId, type: ComponentType): void {
      const currentComps = workingComponents ?? baseState.components;
      const existing = currentComps.get(entityId);
      if (!existing || existing[type] === undefined) return;
      const record = ensureWritableEntityRecord(entityId);
      const prevPos =
        type === (ComponentType.Position as ComponentType)
          ? (record[ComponentType.Position] as PositionComponent | undefined)
          : undefined;
      delete record[type];
      if (prevPos !== undefined) {
        patchSpatialIndexInPlace(ensureSpatial(), copiedSpatialKeys, entityId, prevPos, undefined);
      }
    },

    removeEntity(entityId: EntityId): void {
      const currentComps = workingComponents ?? baseState.components;
      const existing = currentComps.get(entityId);
      const prevPos = existing?.[ComponentType.Position] as PositionComponent | undefined;

      if (!removedEntityIds) {
        removedEntityIds = new Set<EntityId>();
      }
      removedEntityIds.add(entityId);
      ensureComponents().delete(entityId);
      clonedEntityRecords.delete(entityId);
      if (prevPos !== undefined) {
        patchSpatialIndexInPlace(ensureSpatial(), copiedSpatialKeys, entityId, prevPos, undefined);
      }
    },

    getComponent<T extends ComponentType>(
      entityId: EntityId,
      type: T
    ): Extract<Component, { readonly type: T }> | undefined {
      const map = workingComponents ?? baseState.components;
      return map.get(entityId)?.[type] as Extract<Component, { readonly type: T }> | undefined;
    },

    snapshot(): GameState {
      return commitWorkingState();
    }
  };

  const result = fn(batch);
  return { state: commitWorkingState(), result };
}

/**
 * Convenience wrapper around {@link withEcsBatch} when only the updated `GameState` is needed.
 *
 * @param state Starting immutable GameState.
 * @param fn Callback mutating the batch transaction.
 * @returns Committed immutable GameState.
 */
export function withEcsBatchState(state: GameState, fn: (batch: EcsBatch) => void): GameState {
  return withEcsBatch(state, fn).state;
}
