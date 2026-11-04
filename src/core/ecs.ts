// Re-export all ECS Core primitives, storage, queries, and spatial indexing
export {
  createEntity,
  updateSpatialIndex,
  addComponent,
  removeComponent,
  getComponent,
  queryEntities,
  removeEntity
} from './ecs/ecs_core.ts';

// Re-export entity spawning, item creation, and promotion
export { spawnEntity, spawnItem, promoteEntity } from './ecs/ecs_spawner.ts';

// Re-export ownership traversal, limbo packaging, controller links, and resource pools
export {
  collectOwnedEntityIds,
  tickControllerLinksAndOverlays,
  consumeResourcePool,
  refreshResourcePools,
  moveToLimbo
} from './ecs/ecs_lifecycle.ts';
