import { describe, expect, it } from 'bun:test';
import {
  addComponent,
  createEntity,
  getComponent,
  moveToLimbo,
  removeComponent,
  removeEntity,
  spawnEntity,
  updateSpatialIndex,
  withEcsBatch,
  withEcsBatchState
} from '../src/core/ecs.ts';
import { ComponentType, type PositionComponent } from '../src/types/components.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import { buildGameState, deepFreezeGameState, loadCampaignFromDisk } from './helpers.ts';

function normalizeSpatialIndex(
  index: ReadonlyMap<string, ReadonlyArray<EntityId>>
): Readonly<Record<string, ReadonlyArray<number>>> {
  const result: Record<string, ReadonlyArray<number>> = {};
  const keys = Array.from(index.keys()).sort();
  for (const key of keys) {
    const ids = [...(index.get(key) ?? [])].map(Number).sort((a, b) => a - b);
    if (ids.length > 0) {
      result[key] = ids;
    }
  }
  return result;
}

describe('Milestone 173: Incremental spatialIndex & Batched ECS Transactions', () => {
  const campaign = loadCampaignFromDisk('default');

  it('maintains exact spatialIndex parity across 1x1, 2x2 footprints, overlap, resize, and removal', () => {
    const frozenSeen = new WeakSet<object>();
    let state: GameState = deepFreezeGameState(buildGameState(campaign), frozenSeen);

    const [s1, giantId] = createEntity(state);
    state = deepFreezeGameState(s1, frozenSeen);
    state = deepFreezeGameState(
      addComponent(state, giantId, {
        type: ComponentType.Position,
        x: 3,
        y: 4,
        footprintWidth: 2,
        footprintHeight: 2
      }),
      frozenSeen
    );

    const [s2, overlapId] = createEntity(state);
    state = deepFreezeGameState(s2, frozenSeen);
    state = deepFreezeGameState(
      addComponent(state, overlapId, {
        type: ComponentType.Position,
        x: 4,
        y: 5
      }),
      frozenSeen
    );

    expect(normalizeSpatialIndex(state.spatialIndex)).toEqual(normalizeSpatialIndex(updateSpatialIndex(state).spatialIndex));

    // Move & resize giant overlapping stationary entity
    state = deepFreezeGameState(
      addComponent(state, giantId, {
        type: ComponentType.Position,
        x: 4,
        y: 5,
        footprintWidth: 3,
        footprintHeight: 2
      }),
      frozenSeen
    );
    expect(normalizeSpatialIndex(state.spatialIndex)).toEqual(normalizeSpatialIndex(updateSpatialIndex(state).spatialIndex));

    // Remove Position component from overlapId while giant remains covering (4, 5)
    state = deepFreezeGameState(removeComponent(state, overlapId, ComponentType.Position), frozenSeen);
    expect(normalizeSpatialIndex(state.spatialIndex)).toEqual(normalizeSpatialIndex(updateSpatialIndex(state).spatialIndex));

    // Remove giant entity cleanly
    state = deepFreezeGameState(removeEntity(state, giantId), frozenSeen);
    expect(normalizeSpatialIndex(state.spatialIndex)).toEqual(normalizeSpatialIndex(updateSpatialIndex(state).spatialIndex));
  });

  it('patches spatialIndex incrementally on moveToLimbo including owned entities', () => {
    const baseState = buildGameState(campaign);
    const [withOrc, orcId] = spawnEntity(baseState, 'orc', 6, 6, undefined, ['health_potion']);
    const [withGoblin, goblinId] = spawnEntity(withOrc, 'orc', 6, 7);
    const frozenBefore = deepFreezeGameState(withGoblin);

    const afterLimbo = moveToLimbo(frozenBefore, orcId, 'dungeon_1');
    expect(afterLimbo.persistentEntities.has(orcId)).toBe(true);
    expect(afterLimbo.components.has(orcId)).toBe(false);
    expect(afterLimbo.spatialIndex.get('6,6')).toBeUndefined();
    expect(afterLimbo.spatialIndex.get('6,7')).toEqual([goblinId]);
    expect(normalizeSpatialIndex(afterLimbo.spatialIndex)).toEqual(
      normalizeSpatialIndex(updateSpatialIndex(afterLimbo).spatialIndex)
    );
  });

  it('preserves untouched entity component reference identity and snapshot immutability inside withEcsBatch', () => {
    const frozenSeen = new WeakSet<object>();
    const baseState = deepFreezeGameState(spawnEntity(buildGameState(campaign), 'orc', 4, 4)[0], frozenSeen);
    const untouchedId = baseState.entities[0]!;
    const secondId = baseState.entities[1]!;

    const { state: nextState, result } = withEcsBatch(baseState, (batch) => {
      const createdId = batch.createEntity();
      batch.addComponent(createdId, { type: ComponentType.Position, x: 8, y: 8 });
      const midSnap = deepFreezeGameState(batch.snapshot(), frozenSeen);

      // Mutate secondId & createdId after midSnap — must not mutate midSnap
      batch.addComponent(secondId, { type: ComponentType.Position, x: 9, y: 9 });
      batch.addComponent(createdId, { type: ComponentType.Tags, tags: ['batched'] });
      expect((getComponent(midSnap, secondId, ComponentType.Position) as PositionComponent).x).toBe(4);
      expect(getComponent(midSnap, createdId, ComponentType.Tags)).toBeUndefined();
      return createdId;
    });

    expect(nextState.components.get(untouchedId)).toBe(baseState.components.get(untouchedId));
    expect((getComponent(nextState, secondId, ComponentType.Position) as PositionComponent).x).toBe(9);
    expect(nextState.spatialIndex.get('4,4')).toBeUndefined();
    expect(nextState.spatialIndex.get('9,9')).toEqual([secondId]);
    expect(nextState.spatialIndex.get('8,8')).toEqual([result]);
    expect(normalizeSpatialIndex(nextState.spatialIndex)).toEqual(
      normalizeSpatialIndex(updateSpatialIndex(nextState).spatialIndex)
    );
  });

  it('handles 2,000 batched entity spawns & moves quickly with zero spatial drift', () => {
    let state = buildGameState(campaign);
    const t0 = performance.now();

    const { state: afterSpawn, result: spawnedIds } = withEcsBatch(state, (batch) => {
      const ids: EntityId[] = [];
      for (let i = 0; i < 2000; i++) {
        const id = batch.createEntity();
        batch.addComponent(id, { type: ComponentType.Position, x: i % 50, y: Math.floor(i / 50) });
        batch.addComponent(id, { type: ComponentType.Tags, tags: ['bench'] });
        ids.push(id);
      }
      return ids;
    });

    state = withEcsBatchState(afterSpawn, (batch) => {
      for (let i = 0; i < spawnedIds.length; i++) {
        const id = spawnedIds[i]!;
        batch.addComponent(id, { type: ComponentType.Position, x: (i + 1) % 50, y: Math.floor(i / 50) });
      }
    });

    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(1000);
    expect(state.entities.length).toBeGreaterThanOrEqual(2001);
    expect(normalizeSpatialIndex(state.spatialIndex)).toEqual(normalizeSpatialIndex(updateSpatialIndex(state).spatialIndex));
  });

  it('defers multiple batch.removeEntity deletions cleanly with zero spatial drift and preserved untouched identity', () => {
    const frozenSeen = new WeakSet<object>();
    let state = deepFreezeGameState(buildGameState(campaign), frozenSeen);
    const untouchedId = state.entities[0]!;

    const { state: seeded, result: victimIds } = withEcsBatch(state, (batch) => {
      const ids: EntityId[] = [];
      for (let i = 0; i < 6; i++) {
        const id = batch.createEntity();
        batch.addComponent(id, { type: ComponentType.Position, x: 10 + i, y: 12 });
        ids.push(id);
      }
      return ids;
    });
    state = deepFreezeGameState(seeded, frozenSeen);

    const afterBatchDelete = withEcsBatchState(state, (batch) => {
      for (const vid of victimIds) {
        batch.removeEntity(vid);
      }
    });

    expect(afterBatchDelete.components.get(untouchedId)).toBe(state.components.get(untouchedId));
    for (const vid of victimIds) {
      expect(afterBatchDelete.entities.includes(vid)).toBe(false);
      expect(afterBatchDelete.components.has(vid)).toBe(false);
    }
    expect(normalizeSpatialIndex(afterBatchDelete.spatialIndex)).toEqual(
      normalizeSpatialIndex(updateSpatialIndex(afterBatchDelete).spatialIndex)
    );
  });
});
