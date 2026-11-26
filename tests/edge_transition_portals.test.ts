import { describe, expect, test } from 'bun:test';
import * as ROT from 'rot-js';
import {
  BUILTIN_SYNTHETIC_SPRITE_IDS,
  EDGE_ARROW_DIRECTIONS,
  EDGE_ARROW_GLYPHS,
  EDGE_ARROW_SPRITE_IDS
} from '../src/constants/display.constants.ts';
import {
  CELLULAR_PORTAL_EDGE_BAND_TILES,
  MIN_CELLULAR_PORTAL_SEPARATION
} from '../src/constants/spawning.constants.ts';
import { getComponent } from '../src/core/ecs.ts';
import { applyBiomesAndCull, carveBaseGeometry, carveRoomsAndPortals, resolvePalette } from '../src/map/generator_stages.ts';
import { selectDiggerPortalCandidate } from '../src/map/stages/portal_placement.ts';
import { buildProceduralSpriteAtlas } from '../src/rendering/procedural_sprites.ts';
import { getAvailableSpriteKeys } from '../src/rendering/sprite_keys.ts';
import { resolveEdgeTransitionDirection, spawnAreaPortalEntity } from '../src/systems/map/map_generation_spawner.ts';
import type { AreaConnection, AreaDefinition, CampaignData } from '../src/types/campaign.types.ts';
import { ComponentType, type RenderableComponent } from '../src/types/components.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function createCrossroadsArea(generatorType: 'cellular' | 'dla'): AreaDefinition {
  return {
    id: `test_${generatorType}_crossroads`,
    name: 'Test Crossroads',
    generatorType,
    dangerRating: 1,
    connections: [
      { targetAreaId: 'north_area', direction: 'edge', placementSide: 'top' },
      { targetAreaId: 'south_area', direction: 'edge', placementSide: 'bottom' },
      { targetAreaId: 'west_area', direction: 'edge', placementSide: 'left' },
      { targetAreaId: 'east_area', direction: 'edge', placementSide: 'right' }
    ]
  };
}

describe('Edge Transition Indicators & Cellular/DLA Border Portal Placement', () => {
  test('cellular maps place cardinal placementSide portals near their respective map edges with separation across 10 seeds', () => {
    const campaign = loadCampaignFromDisk('realms-of-shroudgarde');
    const areaDef = createCrossroadsArea('cellular');
    const palette = resolvePalette(areaDef);
    const width = 50;
    const height = 40;

    for (let seed = 1001; seed <= 1010; seed++) {
      ROT.RNG.setSeed(seed);
      const base = carveBaseGeometry(areaDef, width, height, palette, campaign.rules.map);
      const result = carveRoomsAndPortals(areaDef, width, height, palette, base.tiles, base.diggerRooms);

      expect(result.portals.length).toBe(4);

      let minY = height;
      let maxY = 0;
      let minX = width;
      let maxX = 0;
      for (const tile of base.tiles) {
        if (tile.tileId !== palette.floor) continue;
        if (tile.y < minY) minY = tile.y;
        if (tile.y > maxY) maxY = tile.y;
        if (tile.x < minX) minX = tile.x;
        if (tile.x > maxX) maxX = tile.x;
      }

      const north = result.portals.find((p) => p.connection.targetAreaId === 'north_area')!;
      const south = result.portals.find((p) => p.connection.targetAreaId === 'south_area')!;
      const west = result.portals.find((p) => p.connection.targetAreaId === 'west_area')!;
      const east = result.portals.find((p) => p.connection.targetAreaId === 'east_area')!;

      expect(north.y).toBeLessThanOrEqual(minY + CELLULAR_PORTAL_EDGE_BAND_TILES);
      expect(south.y).toBeGreaterThanOrEqual(maxY - CELLULAR_PORTAL_EDGE_BAND_TILES);
      expect(west.x).toBeLessThanOrEqual(minX + CELLULAR_PORTAL_EDGE_BAND_TILES);
      expect(east.x).toBeGreaterThanOrEqual(maxX - CELLULAR_PORTAL_EDGE_BAND_TILES);

      for (let i = 0; i < result.portals.length; i++) {
        for (let j = i + 1; j < result.portals.length; j++) {
          const a = result.portals[i]!;
          const b = result.portals[j]!;
          const manhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
          expect(manhattan).toBeGreaterThanOrEqual(MIN_CELLULAR_PORTAL_SEPARATION);
        }
      }
    }
  });

  test('cellular maps separate placementSide="any" portals from startPos and each other', () => {
    const campaign = loadCampaignFromDisk('realms-of-shroudgarde');
    const areaDef: AreaDefinition = {
      id: 'test_cellular_any',
      name: 'Test Cavern',
      generatorType: 'cellular',
      dangerRating: 1,
      connections: [
        { targetAreaId: 'up_area', direction: 'up' },
        { targetAreaId: 'down_area', direction: 'down' },
        { targetAreaId: 'side_area', direction: 'portal', placementSide: 'any' }
      ]
    };
    const palette = resolvePalette(areaDef);
    ROT.RNG.setSeed(7777);
    const base = carveBaseGeometry(areaDef, 50, 40, palette, campaign.rules.map);
    const result = carveRoomsAndPortals(areaDef, 50, 40, palette, base.tiles, base.diggerRooms);

    expect(result.portals.length).toBe(3);
    for (const p of result.portals) {
      const distToStart = Math.abs(p.x - result.startPos.x) + Math.abs(p.y - result.startPos.y);
      expect(distToStart).toBeGreaterThanOrEqual(MIN_CELLULAR_PORTAL_SEPARATION);
    }
    for (let i = 0; i < result.portals.length; i++) {
      for (let j = i + 1; j < result.portals.length; j++) {
        const a = result.portals[i]!;
        const b = result.portals[j]!;
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(MIN_CELLULAR_PORTAL_SEPARATION);
      }
    }
  });

  test('DLA maps place cardinal placementSide portals near their respective map edges with separation', () => {
    const campaign = loadCampaignFromDisk('realms-of-shroudgarde');
    const areaDef = createCrossroadsArea('dla');
    const palette = resolvePalette(areaDef);
    const width = 48;
    const height = 36;

    ROT.RNG.setSeed(98765);
    const base = carveBaseGeometry(areaDef, width, height, palette, campaign.rules.map);
    const result = carveRoomsAndPortals(areaDef, width, height, palette, base.tiles, base.diggerRooms);

    expect(result.portals.length).toBe(4);
    const north = result.portals.find((p) => p.connection.targetAreaId === 'north_area')!;
    const south = result.portals.find((p) => p.connection.targetAreaId === 'south_area')!;
    const west = result.portals.find((p) => p.connection.targetAreaId === 'west_area')!;
    const east = result.portals.find((p) => p.connection.targetAreaId === 'east_area')!;

    expect(north.y).toBeLessThan(south.y);
    expect(west.x).toBeLessThan(east.x);
  });

  test('selectDiggerPortalCandidate avoids already-occupied portal tiles when free candidates exist', () => {
    const candidates = [
      { x: 5, y: 1 },
      { x: 6, y: 1 }
    ];
    const chosen = selectDiggerPortalCandidate(candidates, [{ x: 5, y: 1 }], { x: 5, y: 3 });
    expect(chosen).toEqual({ x: 6, y: 1 });
  });

  test('applyBiomesAndCull protects startPos and portal coordinates from water scatter', () => {
    const campaign = loadCampaignFromDisk('realms-of-shroudgarde');
    const areaDef = createCrossroadsArea('cellular');
    const palette = resolvePalette(areaDef);
    const width = 20;
    const height = 20;

    ROT.RNG.setSeed(1234);
    const base = carveBaseGeometry(areaDef, width, height, palette, campaign.rules.map);
    const portalsRes = carveRoomsAndPortals(areaDef, width, height, palette, base.tiles, base.diggerRooms);
    const protectedCoords = new Set<string>([`${portalsRes.startPos.x},${portalsRes.startPos.y}`]);
    for (const p of portalsRes.portals) {
      protectedCoords.add(`${p.x},${p.y}`);
    }

    // Force 100% water scatter chance; protected start/portal tiles must remain floor
    applyBiomesAndCull(areaDef, width, height, palette, base.tiles, portalsRes.rooms, 1.0, protectedCoords);

    const startTile = base.tiles[portalsRes.startPos.y * width + portalsRes.startPos.x];
    expect(startTile?.tileId).toBe(palette.floor);
    for (const p of portalsRes.portals) {
      const portalTile = base.tiles[p.y * width + p.x];
      expect(portalTile?.tileId).toBe(palette.floor);
    }
  });

  test('resolveEdgeTransitionDirection honors explicit placementSide, infers nearest map border, and handles 0x0 streaming maps safely', () => {
    const baseConn: AreaConnection = { targetAreaId: 'next', direction: 'edge' };

    expect(resolveEdgeTransitionDirection({ ...baseConn, placementSide: 'top' }, 25, 25, 50, 40)).toBe('north');
    expect(resolveEdgeTransitionDirection({ ...baseConn, placementSide: 'bottom' }, 25, 25, 50, 40)).toBe('south');
    expect(resolveEdgeTransitionDirection({ ...baseConn, placementSide: 'left' }, 25, 25, 50, 40)).toBe('west');
    expect(resolveEdgeTransitionDirection({ ...baseConn, placementSide: 'right' }, 25, 25, 50, 40)).toBe('east');

    // Static map coordinate fallback (rectangular 80x40 map)
    expect(resolveEdgeTransitionDirection(baseConn, 40, 1, 80, 40)).toBe('north');
    expect(resolveEdgeTransitionDirection(baseConn, 40, 38, 80, 40)).toBe('south');
    expect(resolveEdgeTransitionDirection(baseConn, 1, 20, 80, 40)).toBe('west');
    expect(resolveEdgeTransitionDirection(baseConn, 78, 20, 80, 40)).toBe('east');

    // Streaming overworld (0x0 map dimensions) fallback without NaN
    expect(resolveEdgeTransitionDirection(baseConn, 0, 0, 0, 0)).toBe('east');
  });

  test('spawnAreaPortalEntity assigns directional arrow sprites and glyphs for edge transitions while preserving portals and stairs', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign);

    const northEdge = spawnAreaPortalEntity(state, {
      x: 15,
      y: 1,
      connection: { targetAreaId: 'north_dest', direction: 'edge', placementSide: 'top' }
    });
    state = northEdge.state;
    const northRender = getComponent(state, northEdge.entityId, ComponentType.Renderable) as
      | RenderableComponent
      | undefined;
    expect(northRender?.spriteId).toBe(EDGE_ARROW_SPRITE_IDS.north);
    expect(northRender?.glyph).toBe(EDGE_ARROW_GLYPHS.north);

    const westEdge = spawnAreaPortalEntity(state, {
      x: 1,
      y: 10,
      connection: { targetAreaId: 'west_dest', direction: 'edge', placementSide: 'left' }
    });
    state = westEdge.state;
    const westRender = getComponent(state, westEdge.entityId, ComponentType.Renderable) as
      | RenderableComponent
      | undefined;
    expect(westRender?.spriteId).toBe(EDGE_ARROW_SPRITE_IDS.west);
    expect(westRender?.glyph).toBe(EDGE_ARROW_GLYPHS.west);

    const magicPortal = spawnAreaPortalEntity(state, {
      x: 10,
      y: 10,
      connection: { targetAreaId: 'arcane_dest', direction: 'portal' }
    });
    state = magicPortal.state;
    const portalRender = getComponent(state, magicPortal.entityId, ComponentType.Renderable) as
      | RenderableComponent
      | undefined;
    expect(portalRender?.glyph).toBe('O');
    expect(portalRender?.spriteId).not.toBe(EDGE_ARROW_SPRITE_IDS.north);

    const stairsDown = spawnAreaPortalEntity(state, {
      x: 12,
      y: 12,
      connection: { targetAreaId: 'lower_dest', direction: 'down' }
    });
    state = stairsDown.state;
    const stairsRender = getComponent(state, stairsDown.entityId, ComponentType.Renderable) as
      | RenderableComponent
      | undefined;
    expect(stairsRender?.glyph).toBe('>');
  });

  test('getAvailableSpriteKeys exposes built-in synthetic arrow sprites only when sprite sheets are active', () => {
    const spriteCampaign = loadCampaignFromDisk('default');
    const available = getAvailableSpriteKeys(spriteCampaign);
    for (const syntheticKey of BUILTIN_SYNTHETIC_SPRITE_IDS) {
      expect(available.has(syntheticKey)).toBe(true);
    }

    const asciiCampaign: CampaignData = {
      ...spriteCampaign,
      theme: {
        ...spriteCampaign.theme,
        sprites: undefined,
        spritePacks: undefined,
        loadedSpritePacks: undefined
      }
    };
    expect(getAvailableSpriteKeys(asciiCampaign).size).toBe(0);
  });

  test('buildProceduralSpriteAtlas registers all 4 directional edge arrow sprites and glyphs within atlas bounds', () => {
    const campaign = loadCampaignFromDisk('default');
    const mockCtx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillRect: (): void => {},
      strokeRect: (): void => {},
      clearRect: (): void => {},
      beginPath: (): void => {},
      arc: (): void => {},
      ellipse: (): void => {},
      moveTo: (): void => {},
      lineTo: (): void => {},
      fill: (): void => {},
      stroke: (): void => {},
      fillText: (): void => {},
      save: (): void => {},
      restore: (): void => {},
      translate: (): void => {},
      rotate: (): void => {}
    } as unknown as CanvasRenderingContext2D;

    const globalWithDoc = globalThis as unknown as { document?: Document | undefined };
    const origDocument = globalWithDoc.document;
    globalWithDoc.document = {
      createElement: (): HTMLCanvasElement =>
        ({
          width: 0,
          height: 0,
          getContext: (): CanvasRenderingContext2D => mockCtx
        }) as unknown as HTMLCanvasElement
    } as unknown as Document;

    try {
      const { atlas, mergedTileMap, tileWidth, tileHeight } = buildProceduralSpriteAtlas(campaign);
      for (const dir of EDGE_ARROW_DIRECTIONS) {
        const spriteCoords = mergedTileMap[EDGE_ARROW_SPRITE_IDS[dir]];
        const glyphCoords = mergedTileMap[EDGE_ARROW_GLYPHS[dir]];
        expect(spriteCoords).toBeDefined();
        expect(glyphCoords).toEqual(spriteCoords);
        expect(spriteCoords![0] + tileWidth).toBeLessThanOrEqual(atlas.width);
        expect(spriteCoords![1] + tileHeight).toBeLessThanOrEqual(atlas.height);
      }
    } finally {
      if (origDocument === undefined) {
        delete globalWithDoc.document;
      } else {
        globalWithDoc.document = origDocument;
      }
    }
  });
});
