import { test, expect } from 'bun:test';
import { loadCampaignFromDisk, buildGameState } from './helpers.ts';
import { addComponent, createEntity, getComponent } from '../src/core/ecs.ts';
import { updateExploredTiles } from '../src/systems/map.system.ts';
import { consumeDirtyDomains, markDirtyFromStateDiff, PresentationDomain } from '../src/core/presentation_queue.ts';
import {
  ComponentType,
  type HungerComponent,
  type InventoryComponent,
  type PositionComponent
} from '../src/types/components.types.ts';
import { UIMode, type GameState } from '../src/types/game-state.types.ts';
import { coordToIndex } from '../src/utils/grid.ts';

test('menu → new-game transition marks the Map domain dirty', () => {
  const campaign = loadCampaignFromDisk('default');
  const game = updateExploredTiles(buildGameState(campaign));

  const menu: GameState = {
    ...game,
    map: { width: campaign.rules.map.width, height: campaign.rules.map.height, tiles: [] },
    entities: [],
    components: new Map(),
    spatialIndex: new Map(),
    cachedFov: new Set(),
    uiMode: UIMode.MainMenu,
    activeRooms: []
  };

  markDirtyFromStateDiff(null, menu);
  const firstFrame = consumeDirtyDomains();
  expect(firstFrame.size).toBeGreaterThan(0);

  markDirtyFromStateDiff(menu, game);
  const secondFrame = consumeDirtyDomains();
  expect(secondFrame.has(PresentationDomain.Map)).toBe(true);
});

test('off-screen NPC component mutations leave Entities, HUD, and Inventory clean', () => {
  const campaign = loadCampaignFromDisk('default');
  let baseState = updateExploredTiles(buildGameState(campaign));
  const playerId = baseState.entities.find((id) => getComponent(baseState, id, ComponentType.Player) !== undefined)!;
  const playerPos = getComponent(baseState, playerId, ComponentType.Position) as PositionComponent;

  // Pick a non-player actor far outside FOV
  const [stateWithNpc, npcId] = createEntity(baseState);
  baseState = stateWithNpc;
  const offscreenX = playerPos.x === 0 ? baseState.map.width - 1 : 0;
  const offscreenY = playerPos.y === 0 ? baseState.map.height - 1 : 0;
  baseState = {
    ...baseState,
    cachedFov: new Set([coordToIndex(playerPos.x, playerPos.y, baseState.map.width)])
  };
  baseState = addComponent(baseState, npcId, { type: ComponentType.Position, x: offscreenX, y: offscreenY });
  baseState = addComponent(baseState, npcId, { type: ComponentType.Hunger, satiation: 500 });

  consumeDirtyDomains();

  // Mutate off-screen NPC's Hunger component
  const nextState = addComponent(baseState, npcId, {
    type: ComponentType.Hunger,
    satiation: 499
  } satisfies HungerComponent);

  markDirtyFromStateDiff(baseState, nextState);
  const dirty = consumeDirtyDomains();
  expect(dirty.has(PresentationDomain.Entities)).toBe(false);
  expect(dirty.has(PresentationDomain.HUD)).toBe(false);
  expect(dirty.has(PresentationDomain.Inventory)).toBe(false);
});

test('FOV-visible NPC mutations mark Entities and HUD dirty without dirtying Inventory', () => {
  const campaign = loadCampaignFromDisk('default');
  let baseState = updateExploredTiles(buildGameState(campaign));
  const playerId = baseState.entities.find((id) => getComponent(baseState, id, ComponentType.Player) !== undefined)!;
  const playerPos = getComponent(baseState, playerId, ComponentType.Position) as PositionComponent;
  const visibleX = playerPos.x;
  const visibleY = playerPos.y;

  const [stateWithNpc, npcId] = createEntity(baseState);
  baseState = stateWithNpc;
  baseState = {
    ...baseState,
    cachedFov: new Set([coordToIndex(visibleX, visibleY, baseState.map.width)])
  };
  baseState = addComponent(baseState, npcId, { type: ComponentType.Position, x: visibleX, y: visibleY });

  consumeDirtyDomains();

  const nextState = addComponent(baseState, npcId, { type: ComponentType.Hunger, satiation: 400 });
  markDirtyFromStateDiff(baseState, nextState);
  const dirty = consumeDirtyDomains();
  expect(dirty.has(PresentationDomain.Entities)).toBe(true);
  expect(dirty.has(PresentationDomain.HUD)).toBe(true);
  expect(dirty.has(PresentationDomain.Inventory)).toBe(false);
});

test('player owned item mutation marks HUD and Inventory dirty', () => {
  const campaign = loadCampaignFromDisk('default');
  const baseState = updateExploredTiles(buildGameState(campaign));
  const playerId = baseState.entities.find((id) => getComponent(baseState, id, ComponentType.Player) !== undefined)!;
  const inv = getComponent(baseState, playerId, ComponentType.Inventory) as InventoryComponent | undefined;

  consumeDirtyDomains();

  if (inv && inv.items.length > 0) {
    const ownedItemId = inv.items[0]!;
    const itemComp = getComponent(baseState, ownedItemId, ComponentType.Item);
    if (itemComp) {
      const nextState = addComponent(baseState, ownedItemId, {
        ...itemComp,
        customName: 'Renamed Blade'
      });
      markDirtyFromStateDiff(baseState, nextState);
      const dirty = consumeDirtyDomains();
      expect(dirty.has(PresentationDomain.HUD)).toBe(true);
      expect(dirty.has(PresentationDomain.Inventory)).toBe(true);
    }
  } else {
    const nextState = addComponent(baseState, playerId, {
      type: ComponentType.Inventory,
      items: [],
      capacity: 15
    });
    markDirtyFromStateDiff(baseState, nextState);
    const dirty = consumeDirtyDomains();
    expect(dirty.has(PresentationDomain.HUD)).toBe(true);
    expect(dirty.has(PresentationDomain.Inventory)).toBe(true);
  }
});
