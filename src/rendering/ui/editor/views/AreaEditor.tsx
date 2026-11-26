import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type * as ROT from 'rot-js';
import { DEFAULT_ATLAS_PREVIEW_SEED } from '../../../../constants/automap3d.constants.ts';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';
import type { GeneratedArea } from '../../../../map/generator.ts';
import { getMapZBounds, getTileAt } from '../../../../map/map_accessor.ts';
import { parseStaticMap } from '../../../../map/static-parser.ts';
import { type AreaDefinition, AreaDefinitionSchema } from '../../../../types/campaign.types.ts';
import { buildAreaVoxelScene3D } from '../../../automap3d/automap3d_scene.ts';
import { createDisplay, drawCell } from '../../../display.ts';
import { isEffectiveSpriteMode } from '../../../procedural_sprites.ts';
import { Automap3DViewport } from '../../primitives/Automap3DViewport.tsx';
import { Button } from '../../primitives/Button.tsx';
import { Badge } from '../../primitives/DataDisplay.tsx';
import { NumberInput } from '../../primitives/FormControls.tsx';
import { ZodFormRenderer } from '../forms/ZodFormRenderer.tsx';
import { AreaStaticPainter } from './AreaStaticPainter.tsx';

/** Props for `<AreaEditor />`. */
export interface AreaEditorProps {
  readonly controller: EditorController;
  readonly area: AreaDefinition;
  readonly basePath: string;
  readonly errors?: ReadonlyArray<ValidationError> | undefined;
}

/**
 * Split-pane Area Editor pairing `<ZodFormRenderer schema={AreaDefinitionSchema} />`
 * with either Multi-Z `<AreaStaticPainter />` / Live Generator Sandbox (2D Slice)
 * or an interactive Daggerfall-style 3D Dungeon View across all Z-strata.
 */
export function AreaEditor({ controller, area, basePath, errors }: AreaEditorProps): JSX.Element {
  const doc = controller.getDocument();
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  const [previewSeed, setPreviewSeed] = useState<number>(DEFAULT_ATLAS_PREVIEW_SEED);
  const [isCustomSeed, setIsCustomSeed] = useState<boolean>(false);
  const [seedTick, setSeedTick] = useState<number>(0);
  const [displayReadyTick, setDisplayReadyTick] = useState<number>(0);
  const [previewZ, setPreviewZ] = useState<number>(0);
  const [generatedArea, setGeneratedArea] = useState<GeneratedArea | null>(null);
  const [zBounds, setZBounds] = useState<{ readonly minZ: number; readonly maxZ: number }>({ minZ: 0, maxZ: 0 });
  const [unreachablePortals, setUnreachablePortals] = useState<ReadonlyArray<string>>([]);
  const [genError, setGenError] = useState<string | null>(null);

  const sandboxContainerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<ROT.Display | null>(null);

  const width = doc.rules.map.width || 40;
  const height = doc.rules.map.height || 20;

  useEffect(() => {
    if (area.generatorType === 'static' || viewMode !== '2d') return;
    const container = sandboxContainerRef.current;
    if (!container) return;

    let cancelled = false;
    createDisplay(doc, basePath, { width, height, bg: '#000000' })
      .then((display) => {
        if (cancelled) return;
        displayRef.current = display;
        container.replaceChildren();
        container.appendChild(display.getContainer() as HTMLElement);
        setDisplayReadyTick((t) => t + 1);
      })
      .catch(console.error);

    return (): void => {
      cancelled = true;
      displayRef.current = null;
      container.replaceChildren();
    };
  }, [area.generatorType, area.id, basePath, width, height, viewMode]);

  // Effect 1: Generate procedural sandbox area (only when area/seed changes, never on Z-slice step)
  useEffect(() => {
    if (area.generatorType === 'static') {
      setGeneratedArea(null);
      return;
    }

    try {
      const effectiveSeed = previewSeed + seedTick;
      const generated =
        isCustomSeed && controller.generateSandboxAreaWithSeed
          ? controller.generateSandboxAreaWithSeed(area.id, effectiveSeed)
          : controller.generateSandboxArea(area.id);
      const bounds = getMapZBounds(generated.map);
      setGeneratedArea(generated);
      setZBounds(bounds);
      setPreviewZ((cur) => Math.max(bounds.minZ, Math.min(bounds.maxZ, cur)));

      const originX = generated.map.chunkGrid !== undefined ? generated.startPos.x - Math.floor(width / 2) : 0;
      const originY = generated.map.chunkGrid !== undefined ? generated.startPos.y - Math.floor(height / 2) : 0;
      const startZ = generated.startPos.z ?? 0;

      // BFS reachability check on spawn Z plane
      const visited = new Set<string>();
      const queue: Array<[number, number]> = [[generated.startPos.x, generated.startPos.y]];
      visited.add(`${generated.startPos.x},${generated.startPos.y}`);

      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        for (const [dx, dy] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0]
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= originX && nx < originX + width && ny >= originY && ny < originY + height) {
            const k = `${nx},${ny}`;
            if (!visited.has(k)) {
              const t = getTileAt(generated.map, nx, ny, startZ);
              const def = t ? doc.tiles[t.tileId] : undefined;
              if (def && def.walkable !== false) {
                visited.add(k);
                queue.push([nx, ny]);
              }
            }
          }
        }
      }

      const warnings: string[] = [];
      for (const portal of generated.portals) {
        if ((portal.z ?? 0) === startZ && !visited.has(`${portal.x},${portal.y}`)) {
          warnings.push(`Portal at (${portal.x}, ${portal.y}, Z=${startZ}) is unreachable from spawn.`);
        }
      }
      setUnreachablePortals(warnings);
      setGenError(null);
    } catch (e: unknown) {
      setGeneratedArea(null);
      setGenError(e instanceof Error ? e.message : 'Unknown error generating map.');
    }
  }, [area, controller, doc, width, height, seedTick, previewSeed, isCustomSeed]);

  // Effect 2: Render the requested Z slice of the currently generated map without rerolling
  useEffect(() => {
    const display = displayRef.current;
    if (!display || !generatedArea || area.generatorType === 'static' || viewMode !== '2d') return;

    display.clear();
    const clampedZ = Math.max(zBounds.minZ, Math.min(zBounds.maxZ, previewZ));
    const isSpriteMode = isEffectiveSpriteMode(doc);
    const originX = generatedArea.map.chunkGrid !== undefined ? generatedArea.startPos.x - Math.floor(width / 2) : 0;
    const originY = generatedArea.map.chunkGrid !== undefined ? generatedArea.startPos.y - Math.floor(height / 2) : 0;

    for (let vy = 0; vy < height; vy++) {
      for (let vx = 0; vx < width; vx++) {
        const tileData = getTileAt(generatedArea.map, originX + vx, originY + vy, clampedZ);
        const tileDef = tileData ? doc.tiles[tileData.tileId] : undefined;
        if (tileDef) {
          drawCell(display, vx, vy, isSpriteMode, tileDef);
        }
      }
    }

    if ((generatedArea.startPos.z ?? 0) === clampedZ) {
      drawCell(display, generatedArea.startPos.x - originX, generatedArea.startPos.y - originY, isSpriteMode, {
        glyph: '@',
        fg: '#00ff00',
        bg: '#000000',
        spriteId: 'player'
      });
    }

    for (const portal of generatedArea.portals) {
      if ((portal.z ?? 0) !== clampedZ) continue;
      drawCell(display, portal.x - originX, portal.y - originY, isSpriteMode, {
        glyph: 'O',
        fg: '#ff00ff',
        bg: '#000000',
        spriteId: 'stairs_down'
      });
    }
  }, [area.generatorType, generatedArea, zBounds, previewZ, doc, width, height, displayReadyTick, viewMode]);

  const local3DScene = useMemo(() => {
    if (viewMode !== '3d') return null;

    if (area.generatorType === 'static' && area.staticMap) {
      const { map, parsedEntities } = parseStaticMap(area.staticMap);
      const portals = (area.connections ?? []).map((conn, idx) => ({
        x: conn.placementX ?? 1 + idx,
        y: conn.placementY ?? 1,
        ...(conn.placementZ !== undefined ? { z: conn.placementZ } : {}),
        connection: conn
      }));
      return buildAreaVoxelScene3D({
        areaId: area.id,
        areaName: area.name,
        generatorType: area.generatorType,
        dangerRating: area.dangerRating,
        map,
        tiles: doc.tiles,
        entities: doc.entities,
        visibilityMode: 'full_omniscient',
        portals,
        placedEntities: [...(area.placedEntities ?? []), ...parsedEntities]
      });
    }

    if (!generatedArea) return null;
    return buildAreaVoxelScene3D({
      areaId: area.id,
      areaName: area.name,
      generatorType: area.generatorType,
      dangerRating: area.dangerRating,
      map: generatedArea.map,
      tiles: doc.tiles,
      entities: doc.entities,
      visibilityMode: 'full_omniscient',
      startPos: generatedArea.startPos,
      portals: generatedArea.portals,
      placedEntities: generatedArea.placedEntities,
      seed: previewSeed + seedTick
    });
  }, [viewMode, area, doc.tiles, doc.entities, generatedArea, previewSeed, seedTick]);

  const areaErrors = (errors ?? []).filter((e) => e.path.startsWith(basePath));

  return (
    <div className="ui-editor-split">
      <div className="ui-editor-split__left">
        <ZodFormRenderer
          controller={controller}
          schema={AreaDefinitionSchema}
          value={area}
          basePath={basePath}
          errors={errors}
        />
        {areaErrors.length > 0 ? (
          <div className="ui-editor-error-box">
            <strong>Area Validation Errors ({areaErrors.length})</strong>
            {areaErrors.map((err, idx) => (
              <div key={`${err.path}_${idx}`}>
                {err.path}: {err.message}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="ui-editor-split__right">
        <div className="ui-editor-z-toolbar" data-testid="editor-area-view-toggle">
          <button type="button" className="ui-chip" aria-pressed={viewMode === '2d'} onClick={() => setViewMode('2d')}>
            2D Slice
          </button>
          <button type="button" className="ui-chip" aria-pressed={viewMode === '3d'} onClick={() => setViewMode('3d')}>
            3D Dungeon View
          </button>
          {area.generatorType !== 'static' ? (
            <div className="ui-editor-row" style={{ marginLeft: 'auto' }}>
              <span className="ui-editor-muted">Seed:</span>
              <NumberInput
                ariaLabel="Area preview seed"
                value={previewSeed}
                step={1}
                onChange={(val) => {
                  setPreviewSeed(Math.floor(val));
                  setIsCustomSeed(true);
                  setSeedTick(0);
                }}
              />
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setIsCustomSeed(true);
                  setSeedTick((t) => t + 1);
                }}
              >
                Reroll Seed
              </Button>
            </div>
          ) : null}
        </div>

        {viewMode === '3d' && local3DScene ? (
          <Automap3DViewport
            scene={local3DScene}
            initialCutaway="ghost_above"
            heightPx={480}
            dataTestId="editor-area-local-3d"
          />
        ) : area.generatorType === 'static' ? (
          <AreaStaticPainter controller={controller} doc={doc} area={area} basePath={basePath} />
        ) : (
          <div className="ui-editor-sandbox-pane">
            <div className="ui-editor-sandbox-pane__header">
              <div className="ui-editor-row">
                <h3>Live Generator Sandbox</h3>
                <Badge tone="accent">Z={previewZ}</Badge>
              </div>
              <div className="ui-editor-row">
                <Button
                  size="sm"
                  disabled={previewZ <= zBounds.minZ}
                  onClick={() => setPreviewZ((z) => Math.max(zBounds.minZ, z - 1))}
                >
                  Z-
                </Button>
                <Button
                  size="sm"
                  disabled={previewZ >= zBounds.maxZ}
                  onClick={() => setPreviewZ((z) => Math.min(zBounds.maxZ, z + 1))}
                >
                  Z+
                </Button>
              </div>
            </div>

            {genError ? <div className="ui-editor-error-box">{genError}</div> : null}
            {unreachablePortals.length > 0 ? (
              <div className="ui-editor-error-box">
                {unreachablePortals.map((msg, i) => (
                  <div key={i}>{msg}</div>
                ))}
              </div>
            ) : null}

            <div ref={sandboxContainerRef} className="ui-editor-canvas-stage" />
          </div>
        )}
      </div>
    </div>
  );
}
