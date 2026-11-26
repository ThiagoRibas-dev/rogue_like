import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { join } from 'node:path';
import { render } from 'preact';
import renderToString from 'preact-render-to-string';
import ROT from 'rot-js';
import { loadCampaignDataForVisualizer } from '../scripts/visualize-campaign.ts';
import { buildStandaloneAtlasHtml } from '../scripts/visualize_campaign_html.ts';
import { dispatchAction } from '../src/actions/action.registry.ts';
import { createSetAutomapNoteAction, createToggleAutomapAction } from '../src/actions/core.actions.ts';
import { DEFAULT_ATLAS_PREVIEW_SEED, createDefaultAutomapCamera } from '../src/constants/automap3d.constants.ts';
import { FLUID_KIND_SHIFT, FluidKindCode } from '../src/constants/world_chunk.constants.ts';
import { addComponent } from '../src/core/ecs.ts';
import { getGameState, setGameState } from '../src/core/game-loop.ts';
import { commandRegistry } from '../src/core/input/command_registry.ts';
import { InputScopeManager } from '../src/core/input/input_scope_manager.ts';
import { migrateV1KeybindsToV2 } from '../src/core/input/keybind_migration.ts';
import { clearInputQueue } from '../src/core/input_queue.ts';
import { clearModals } from '../src/core/modal_manager.ts';
import { PresentationDomain } from '../src/core/presentation_queue.ts';
import { deserializeGameState, serializeGameState } from '../src/core/save.ts';
import { applyKeybindPreset, getBindingsForCommand, resetSettings } from '../src/core/settings.ts';
import { generateArea } from '../src/map/generator.ts';
import { buildTilePaletteRegistry } from '../src/map/tile_palette.ts';
import { createEmptyWorldChunk } from '../src/map/world_chunk.ts';
import { buildCampaignHolisticScene3D } from '../src/rendering/automap3d/automap3d_holistic.ts';
import {
  fitCameraToScene3D,
  pickAutomapVoxelAtScreenPoint,
  projectAutomapPoint3D,
  renderAutomapScene3D
} from '../src/rendering/automap3d/automap3d_renderer.ts';
import {
  buildAreaVoxelScene3D,
  buildLiveGameAutomapScene3D,
  classifyTileVoxelKind
} from '../src/rendering/automap3d/automap3d_scene.ts';
import { uiStore } from '../src/rendering/ui/core/ui_store.ts';
import { editorStore } from '../src/rendering/ui/editor/editor_store.ts';
import { AreaEditor } from '../src/rendering/ui/editor/views/AreaEditor.tsx';
import { WorldGraph } from '../src/rendering/ui/editor/views/WorldGraph.tsx';
import { Automap3DModal } from '../src/rendering/ui/modals/Automap3DModal.tsx';
import { CampaignEditor } from '../src/editor/campaign_editor.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { type GameMap, type GameState, toEntityId, UIMode } from '../src/types/game-state.types.ts';
import type { ChunkedWorldGrid } from '../src/types/world-chunk.types.ts';
import { packWorldCoord3D } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function createMockCanvasContext(): {
  readonly ctx: CanvasRenderingContext2D;
  readonly drawStats: { fills: number; lines: number; rects: number };
} {
  const drawStats = { fills: 0, lines: 0, rects: 0 };
  const noop = (): void => {};
  const ctx = {
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '12px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    createLinearGradient: () => ({ addColorStop: noop }),
    fillRect: () => {
      drawStats.rects++;
    },
    strokeRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: () => {
      drawStats.lines++;
    },
    quadraticCurveTo: noop,
    arc: noop,
    closePath: noop,
    fill: () => {
      drawStats.fills++;
    },
    stroke: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    fillText: noop,
    measureText: (t: string) => ({ width: t.length * 6 })
  } as unknown as CanvasRenderingContext2D;
  return { ctx, drawStats };
}

function makeKeyEvent(
  key: string,
  options: { readonly code?: string; readonly shiftKey?: boolean } = {}
): KeyboardEvent & { readonly defaultPrevented: boolean } {
  let prevented = false;
  return {
    key,
    code: options.code ?? '',
    shiftKey: options.shiftKey ?? false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: null,
    preventDefault: (): void => {
      prevented = true;
    },
    get defaultPrevented(): boolean {
      return prevented;
    }
  } as unknown as KeyboardEvent & { readonly defaultPrevented: boolean };
}

describe('Phase 49: Daggerfall-Style 3D Multi-Z Dungeon Automap & Holistic Campaign Atlas', () => {
  beforeEach(() => {
    resetSettings();
    clearModals();
    clearInputQueue();
    uiStore.reset();
    editorStore.reset();
  });

  afterEach(() => {
    clearModals();
    clearInputQueue();
    uiStore.reset();
    editorStore.reset();
  });

  test('classifyTileVoxelKind uses declarative TileDefinition properties & fluid bytes cleanly (Rule 21)', () => {
    const campaign = loadCampaignFromDisk('default');
    expect(classifyTileVoxelKind(campaign.tiles['stone_wall'], 0)).toBe('wall');
    expect(classifyTileVoxelKind(campaign.tiles['stone_floor'], 0)).toBe('floor');
    expect(classifyTileVoxelKind(campaign.tiles['stairs_down'], 0)).toBe('stairs_down');
    expect(classifyTileVoxelKind(campaign.tiles['stairs_up'], 0)).toBe('stairs_up');
    expect(classifyTileVoxelKind(campaign.tiles['open_air'], 0)).toBeNull();
    expect(classifyTileVoxelKind(campaign.tiles['empty_space'], 0)).toBeNull();

    const waterByte = (FluidKindCode.Water << FLUID_KIND_SHIFT) | 4;
    const magmaByte = (FluidKindCode.Magma << FLUID_KIND_SHIFT) | 6;
    expect(classifyTileVoxelKind(campaign.tiles['stone_floor'], waterByte)).toBe('water');
    expect(classifyTileVoxelKind(campaign.tiles['stone_floor'], magmaByte)).toBe('magma');
  });

  test('buildAreaVoxelScene3D culls solid interior bedrock into hollow shells across multi-Z static and chunkGrid maps', () => {
    const campaign = loadCampaignFromDisk('default');

    // Static multi-Z watchtower_overlook from default campaign
    const generated = generateArea(campaign, 'watchtower_overlook');
    const scene = buildAreaVoxelScene3D({
      areaId: 'watchtower_overlook',
      areaName: 'Highwatch Bastion',
      map: generated.map,
      tiles: campaign.tiles,
      entities: campaign.entities,
      visibilityMode: 'full_omniscient',
      startPos: generated.startPos,
      portals: generated.portals,
      placedEntities: generated.placedEntities
    });

    expect(scene.voxels.length).toBeGreaterThan(20);
    expect(scene.bounds.maxWz).toBeGreaterThan(scene.bounds.minWz);
    expect(scene.beacons.some((b) => b.kind === 'stairs')).toBe(true);
    expect(scene.beacons.some((b) => b.kind === 'portal')).toBe(true);

    // ChunkGrid multi-Z synthetic dungeon: 16x16 wall bedrock with a 3x3 room carved on Z=0 and Z=-1
    const palette = buildTilePaletteRegistry(campaign.tiles);
    const wallCode = palette.tileIdToIndex['stone_wall'] ?? 1;
    const floorCode = palette.tileIdToIndex['stone_floor'] ?? 2;
    const stairsDownCode = palette.tileIdToIndex['stairs_down'] ?? 3;
    const chunkZ0 = createEmptyWorldChunk(0, 0, 0, 16);
    const chunkZm1 = createEmptyWorldChunk(0, 0, -1, 16);
    chunkZ0.tileType.fill(wallCode);
    chunkZm1.tileType.fill(wallCode);
    for (let y = 6; y <= 8; y++) {
      for (let x = 6; x <= 8; x++) {
        chunkZ0.tileType[y * 16 + x] = x === 7 && y === 7 ? stairsDownCode : floorCode;
        chunkZm1.tileType[y * 16 + x] = floorCode;
      }
    }
    const chunks = new Map([
      [packWorldCoord3D(0, 0, 0), chunkZ0],
      [packWorldCoord3D(0, 0, -1), chunkZm1]
    ]);
    const grid: ChunkedWorldGrid = {
      areaId: 'synthetic_chunks',
      worldSeed: 1337,
      chunkSize: 16,
      activeRadiusChunks: 2,
      prefetchRadiusChunks: 3,
      evictRadiusChunks: 4,
      originChunkX: 0,
      originChunkY: 0,
      minZ: -1,
      maxZ: 0,
      palette,
      chunks,
      dirtyChunkKeys: new Set<number>(),
      evictedChunkEntities: {}
    };
    const chunkMap: GameMap = {
      width: 16,
      height: 16,
      tiles: [],
      chunkGrid: grid,
      isFullyExplored: true
    };
    const chunkScene = buildAreaVoxelScene3D({
      areaId: 'synthetic_chunks',
      areaName: 'Chunk Crypt',
      map: chunkMap,
      tiles: campaign.tiles,
      visibilityMode: 'full_omniscient'
    });

    // 16*16*2 = 512 raw cells; hollow shell culling drops buried bedrock so count is far below 512
    expect(chunkScene.voxels.length).toBeLessThan(120);
    expect(chunkScene.bounds.minWz).toBe(-1);
    expect(chunkScene.bounds.maxWz).toBe(0);
    expect(chunkScene.voxels.some((v) => v.kind === 'stairs_down' && v.z === 0)).toBe(true);
  });

  test('buildLiveGameAutomapScene3D strictly enforces explored fog-of-war unless revealUnexplored is enabled', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 4901);

    // Clear exploration flags on all tiles except a single tile
    const mapWidth = state.map.width;
    const clearedTiles = state.map.tiles.map((tile, idx) => {
      const x = idx % mapWidth;
      const y = Math.floor(idx / mapWidth);
      return { ...tile, explored: x === 5 && y === 5 && tile.tileId !== 'empty_space' };
    });
    state = {
      ...state,
      map: { ...state.map, tiles: clearedTiles, isFullyExplored: false },
      automapNotes: [
        {
          id: 'note_1',
          areaId: state.currentAreaId,
          x: 5,
          y: 5,
          z: 0,
          label: 'Stash Spot'
        }
      ]
    };

    // Place a lit light emitter on player tile
    const playerId = state.entities.find((id) => id === toEntityId(1)) ?? state.entities[0]!;
    state = addComponent(state, playerId, {
      type: ComponentType.LightEmitter,
      radius: 4,
      isLit: true,
      color: '#ff9933'
    });

    const restricted = buildLiveGameAutomapScene3D(state, false);
    const omniscient = buildLiveGameAutomapScene3D(state, true);

    expect(restricted.voxels.length).toBeLessThan(omniscient.voxels.length);
    expect(restricted.beacons.some((b) => b.kind === 'player')).toBe(true);
    expect(restricted.beacons.some((b) => b.kind === 'note' && b.label === 'Stash Spot')).toBe(true);
    expect(omniscient.voxels.length).toBeGreaterThan(20);
  });

  test('buildCampaignHolisticScene3D is deterministic with fixed seed, preserves ROT.RNG state, and connects portals with 3D splines', () => {
    const campaign = loadCampaignFromDisk('default');

    ROT.RNG.setSeed(98765);
    const sampleBefore = ROT.RNG.getUniform();
    const stateBefore = ROT.RNG.getState();

    const sceneA = buildCampaignHolisticScene3D(campaign, { seed: DEFAULT_ATLAS_PREVIEW_SEED });
    const stateAfter = ROT.RNG.getState();
    const sampleAfterA = ROT.RNG.getUniform();

    expect(stateAfter).toEqual(stateBefore);

    // Re-seed back to 98765 and advance once: must match sampleAfterA bit-exactly
    ROT.RNG.setSeed(98765);
    expect(ROT.RNG.getUniform()).toBe(sampleBefore);
    expect(ROT.RNG.getUniform()).toBe(sampleAfterA);

    const sceneB = buildCampaignHolisticScene3D(campaign, { seed: DEFAULT_ATLAS_PREVIEW_SEED });
    expect(sceneA.voxels.length).toBe(sceneB.voxels.length);
    expect(sceneA.splines.length).toBe(sceneB.splines.length);
    expect(sceneA.clusters.length).toBe(Object.keys(campaign.areas).length);
    expect(sceneA.splines.length).toBeGreaterThan(0);

    // Vertical 'down' portal (safe_hub -> dungeon_1) pushes dungeon_1 lower on wz
    const hub = sceneA.clusters.find((c) => c.areaId === 'safe_hub')!;
    const d1 = sceneA.clusters.find((c) => c.areaId === 'dungeon_1')!;
    expect(d1.offsetWz).toBeLessThan(hub.offsetWz);
  });

  test('3D Canvas renderer & screen-space picker draw voxels and locate projected voxel/beacon coordinates', () => {
    const campaign = loadCampaignFromDisk('default');
    const generated = generateArea(campaign, 'watchtower_overlook');
    const scene = buildAreaVoxelScene3D({
      areaId: 'watchtower_overlook',
      areaName: 'Highwatch Bastion',
      map: generated.map,
      tiles: campaign.tiles,
      visibilityMode: 'full_omniscient',
      startPos: generated.startPos,
      portals: generated.portals
    });

    const width = 900;
    const height = 560;
    const camera = fitCameraToScene3D(scene, createDefaultAutomapCamera(0, 'ghost_above'), width, height);
    const { ctx, drawStats } = createMockCanvasContext();

    renderAutomapScene3D(ctx, scene, camera, width, height);
    expect(drawStats.fills).toBeGreaterThan(20);

    // Verify picking a projected voxel hits it
    const targetVoxel = scene.voxels.find((v) => v.z === 0) ?? scene.voxels[0]!;
    const projected = projectAutomapPoint3D(
      targetVoxel.wx,
      targetVoxel.wy,
      targetVoxel.wz + 0.1,
      scene,
      camera,
      width,
      height
    );
    const hit = pickAutomapVoxelAtScreenPoint(projected.sx, projected.sy, scene, camera, width, height);
    expect(hit).not.toBeNull();

    // Verify isolate_z filters out other Z strata
    const isoCam = { ...camera, activeZ: 2, cutawayMode: 'isolate_z' as const };
    const isoStats = createMockCanvasContext();
    renderAutomapScene3D(isoStats.ctx, scene, isoCam, width, height);
    expect(isoStats.drawStats.fills).toBeGreaterThan(0);
    expect(isoStats.drawStats.fills).toBeLessThan(drawStats.fills);
  });

  test('ToggleAutomap, SetAutomapNote, save round-trip, and M keybind migration have zero conflicts', () => {
    const campaign = loadCampaignFromDisk('default');
    let state: GameState = buildGameState(campaign, 4902);
    const playerId = state.entities[0]!;

    // Dispatch ToggleAutomap open & close
    state = dispatchAction(state, createToggleAutomapAction(playerId)).state;
    expect(state.uiMode).toBe(UIMode.Automap);
    state = dispatchAction(state, createToggleAutomapAction(playerId)).state;
    expect(state.uiMode).toBe(UIMode.Game);

    // Pin, update, and serialize automap note
    state = dispatchAction(state, createSetAutomapNoteAction(playerId, 'safe_hub', 4, 5, 0, 'Hidden Cache')).state;
    expect(state.automapNotes?.length).toBe(1);
    expect(state.automapNotes?.[0]?.label).toBe('Hidden Cache');

    const serialized = serializeGameState(state);
    expect(serialized.automapNotes?.length).toBe(1);
    const restored = deserializeGameState(serialized, campaign);
    expect(restored.automapNotes?.[0]?.label).toBe('Hidden Cache');

    // Legacy save without automapNotes deserializes cleanly to undefined or empty
    const legacySerialized = { ...serialized };
    delete (legacySerialized as { automapNotes?: unknown }).automapNotes;
    const restoredLegacy = deserializeGameState(legacySerialized, campaign);
    expect(restoredLegacy.automapNotes ?? []).toEqual([]);

    // Remove note
    const cleared = dispatchAction(state, createSetAutomapNoteAction(playerId, 'safe_hub', 4, 5, 0, null)).state;
    expect(cleared.automapNotes?.length).toBe(0);

    // M opens & closes Automap in InputScopeManager, zero conflicts in both modern & classic_vi presets
    setGameState(state);
    const manager = new InputScopeManager();
    const mKey = makeKeyEvent('m', { code: 'KeyM' });
    expect(manager.dispatchKeyEvent(mKey, state)).toBe(true);
    expect(getGameState().uiMode).toBe(UIMode.Automap);

    const mClose = makeKeyEvent('m', { code: 'KeyM' });
    expect(manager.dispatchKeyEvent(mClose, getGameState())).toBe(true);
    expect(getGameState().uiMode).toBe(UIMode.Game);

    for (const preset of ['modern', 'classic_vi'] as const) {
      applyKeybindPreset(preset);
      const conflicts = commandRegistry.detectConflicts(
        Object.fromEntries(
          commandRegistry.getAllCommands('dnd35e').map((c) => [c.id, getBindingsForCommand(c.id)])
        ),
        'dnd35e'
      );
      expect(conflicts.some((c) => c.commandId === 'panel.automap' || c.otherCommandId === 'panel.automap')).toBe(
        false
      );
      expect(conflicts.some((c) => c.commandId === 'action.verb_menu' || c.otherCommandId === 'action.verb_menu')).toBe(
        false
      );
    }

    // Lossless v1 migration shifts legacy stock verb_menu=['m'] to V + Enter while preserving M for Automap
    const migrated = migrateV1KeybindsToV2({ verb_menu: ['m'] });
    expect(migrated['panel.automap']).toEqual([{ key: 'm' }]);
    expect(migrated['action.verb_menu']).toEqual([{ key: 'v' }, { code: 'Enter' }]);
  });

  test('Preact Automap3DModal, Editor AreaEditor 3D Dungeon View, WorldGraph 3D Atlas, and Standalone HTML render cleanly', async () => {
    const campaign = loadCampaignFromDisk('default');
    const state: GameState = {
      ...buildGameState(campaign, 4903),
      uiMode: UIMode.Automap,
      automapNotes: [{ id: 'n1', areaId: 'safe_hub', x: 5, y: 5, z: 0, label: 'Camp Hearth' }]
    };
    uiStore.syncFromPresenter(state, false, new Set([PresentationDomain.Modals]));

    const modalHtml = renderToString(<Automap3DModal />);
    expect(modalHtml).toContain('3D Dungeon Automap');
    expect(modalHtml).toContain('Camp Hearth');
    expect(modalHtml).toContain('ingame-automap3d-viewport');

    // Interactive toggle test in Happy-DOM for AreaEditor & WorldGraph 3D Atlas
    const domWindow = new Window({ url: 'http://localhost:3000/' });
    const g = globalThis as Record<string, unknown>;
    const prevDoc = g['document'];
    const prevWin = g['window'];
    g['document'] = domWindow.document;
    g['window'] = domWindow;

    try {
      const editor = new CampaignEditor(campaign);
      editorStore.bindController(editor);

      // AreaEditor 3D view toggle
      const areaRoot = domWindow.document.createElement('div');
      domWindow.document.body.appendChild(areaRoot);
      const areaDef = campaign.areas['watchtower_overlook']!;
      render(
        <AreaEditor controller={editor} area={areaDef} basePath="/" />,
        areaRoot as unknown as Element
      );

      const btn3D = Array.from(areaRoot.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('3D Dungeon View')
      ) as HTMLButtonElement | undefined;
      expect(btn3D).toBeDefined();
      btn3D!.click();
      await new Promise((r) => setTimeout(r, 15));
      expect(areaRoot.querySelector('[data-testid="editor-area-local-3d"]')).not.toBeNull();
      render(null, areaRoot as unknown as Element);

      // WorldGraph 3D Campaign Atlas toggle
      const graphRoot = domWindow.document.createElement('div');
      domWindow.document.body.appendChild(graphRoot);
      render(
        <WorldGraph doc={campaign} onSelectNode={() => {}} />,
        graphRoot as unknown as Element
      );
      const atlasBtn = Array.from(graphRoot.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('3D Campaign Atlas')
      ) as HTMLButtonElement | undefined;
      expect(atlasBtn).toBeDefined();
      atlasBtn!.click();
      await new Promise((r) => setTimeout(r, 15));
      expect(graphRoot.querySelector('[data-testid="editor-world-atlas-3d"]')).not.toBeNull();
      render(null, graphRoot as unknown as Element);
    } finally {
      g['document'] = prevDoc;
      g['window'] = prevWin;
      await domWindow.happyDOM.close();
    }

    // Standalone HTML generator emits safe self-contained HTML for disk campaigns
    const loadedDefault = loadCampaignDataForVisualizer(join(process.cwd(), 'public', 'data', 'campaigns', 'default'));
    expect(loadedDefault).not.toBeNull();
    const holistic = buildCampaignHolisticScene3D(loadedDefault!, { seed: DEFAULT_ATLAS_PREVIEW_SEED });
    const html = buildStandaloneAtlasHtml(
      [
        {
          campaignId: loadedDefault!.manifest.id,
          campaignName: loadedDefault!.manifest.name,
          rulesetId: loadedDefault!.manifest.rulesetId,
          description: loadedDefault!.manifest.description,
          scene: holistic
        }
      ],
      DEFAULT_ATLAS_PREVIEW_SEED
    );
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('3D Campaign Atlas');
    expect(html).toContain('id="atlas-scenes"');
    expect(html).toContain('Fixed Seed: 1337');
  });
});
