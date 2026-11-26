import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type * as ROT from 'rot-js';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';
import type { GeneratedArea } from '../../../../map/generator.ts';
import { getMapZBounds, getTileAt } from '../../../../map/map_accessor.ts';
import { type AreaDefinition, AreaDefinitionSchema } from '../../../../types/campaign.types.ts';
import { createDisplay, drawCell } from '../../../display.ts';
import { isEffectiveSpriteMode } from '../../../procedural_sprites.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge } from '../../primitives/DataDisplay.tsx';
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
 * with either Multi-Z `<AreaStaticPainter />` or Multi-Z Live Generator Sandbox.
 */
export function AreaEditor({ controller, area, basePath, errors }: AreaEditorProps): JSX.Element {
  const doc = controller.getDocument();
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
    if (area.generatorType === 'static') return;
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
  }, [area.generatorType, area.id, basePath, width, height]);

  // Effect 1: Generate procedural sandbox area (only when area/seedTick changes, never on Z-slice step)
  useEffect(() => {
    if (area.generatorType === 'static') {
      setGeneratedArea(null);
      return;
    }

    try {
      const generated = controller.generateSandboxArea(area.id);
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
  }, [area, controller, doc, width, height, seedTick]);

  // Effect 2: Render the requested Z slice of the currently generated map without rerolling
  useEffect(() => {
    const display = displayRef.current;
    if (!display || !generatedArea || area.generatorType === 'static') return;

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
  }, [area.generatorType, generatedArea, zBounds, previewZ, doc, width, height, displayReadyTick]);

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
        {area.generatorType === 'static' ? (
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
                <Button size="sm" variant="primary" onClick={() => setSeedTick((t) => t + 1)}>
                  Reroll Seed
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
