import { test, expect } from 'bun:test';
import { loadCampaignFromDisk, buildGameState } from './helpers.ts';
import { updateExploredTiles } from '../src/systems/map.system.ts';
import { consumeDirtyDomains, markDirtyFromStateDiff, PresentationDomain } from '../src/core/presentation_queue.ts';
import { UIMode, type GameState } from '../src/types/game-state.types.ts';

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
