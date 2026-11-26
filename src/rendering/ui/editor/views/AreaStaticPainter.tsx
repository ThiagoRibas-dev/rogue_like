import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type * as ROT from 'rot-js';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import type { AreaDefinition, CampaignData } from '../../../../types/campaign.types.ts';
import { createDisplay, drawCell } from '../../../display.ts';
import { isEffectiveSpriteMode } from '../../../procedural_sprites.ts';
import { Button } from '../../primitives/Button.tsx';
import { dialogService } from '../../primitives/dialog_service.ts';
import { escapeJsonPointerSegment, useEditorSelector } from '../editor_store.ts';
import { AreaPlaytestMenu } from './AreaPlaytestMenu.tsx';
import { type AreaPaintDef, type AreaPaintMode, AreaStaticPainterToolbars } from './AreaStaticPainterToolbars.tsx';

interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly walkable: boolean;
}

/** Props for `<AreaStaticPainter />`. */
export interface AreaStaticPainterProps {
  readonly controller: EditorController;
  readonly doc: CampaignData;
  readonly area: AreaDefinition;
  readonly basePath: string;
}

function getSliceRows(area: AreaDefinition, targetZ: number): ReadonlyArray<string> {
  if (targetZ === 0) return area.staticMap?.layout ?? [];
  return area.staticMap?.zLevels?.[String(targetZ)] ?? [];
}

function drawStaticSlice(
  display: ROT.Display,
  doc: CampaignData,
  area: AreaDefinition,
  activeZ: number,
  width: number,
  height: number
): void {
  const sm = area.staticMap;
  if (!sm) return;
  const sliceRows = getSliceRows(area, activeZ);
  const isSpriteMode = isEffectiveSpriteMode(doc);
  display.clear();

  for (let y = 0; y < height; y++) {
    const row = sliceRows[y] || '';
    for (let x = 0; x < width; x++) {
      const ch = row[x] || ' ';
      const tileId = sm.legend[ch];
      const tileDef = tileId ? doc.tiles[tileId] : undefined;
      if (tileDef) {
        drawCell(display, x, y, isSpriteMode, tileDef);
      } else {
        drawCell(display, x, y, isSpriteMode, { glyph: ch, fg: '#ffffff', bg: '#000000' });
      }
    }
  }

  for (const ent of area.placedEntities ?? []) {
    if ((ent.z ?? 0) !== activeZ) continue;
    const def = doc.entities[ent.templateId] ?? doc.items[ent.templateId];
    if (def) {
      drawCell(display, ent.x, ent.y, isSpriteMode, def);
    }
  }
}

/**
 * Multi-Z Preact Static Map Painter with Z-slice switching (`zLevels`), entity/item placement,
 * shift-click removal, and right-click Playtest From Here support.
 */
export function AreaStaticPainter({ controller, doc, area, basePath }: AreaStaticPainterProps): JSX.Element {
  const activeTabId = useEditorSelector((s) => s.activeTabId);
  const activeItemId = useEditorSelector((s) => s.activeItemId);

  const [paintMode, setPaintMode] = useState<AreaPaintMode>('tiles');
  const [activePaintId, setActivePaintId] = useState<string | null>(() => Object.keys(doc.tiles)[0] ?? null);
  const [activeZ, setActiveZ] = useState<number>(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const rotContainerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<ROT.Display | null>(null);
  const latestRef = useRef({ doc, area, paintMode, activePaintId, activeZ, controller, basePath });
  latestRef.current = { doc, area, paintMode, activePaintId, activeZ, controller, basePath };

  const paletteEntries = useMemo((): ReadonlyArray<readonly [string, AreaPaintDef]> => {
    const source = paintMode === 'tiles' ? doc.tiles : paintMode === 'entities' ? doc.entities : doc.items;
    return Object.entries(source) as Array<readonly [string, AreaPaintDef]>;
  }, [doc.tiles, doc.entities, doc.items, paintMode]);

  useEffect(() => {
    if (paletteEntries.length === 0) {
      setActivePaintId(null);
      return;
    }
    if (!activePaintId || !paletteEntries.some(([id]) => id === activePaintId)) {
      setActivePaintId(paletteEntries[0]![0]);
    }
  }, [paletteEntries, activePaintId]);

  const zLevelsSorted = useMemo(() => {
    const zs = new Set<number>([0]);
    for (const key of Object.keys(area.staticMap?.zLevels ?? {})) {
      const parsed = Number(key);
      if (Number.isInteger(parsed)) zs.add(parsed);
    }
    return Array.from(zs).sort((a, b) => a - b);
  }, [area.staticMap?.zLevels]);

  useEffect(() => {
    if (!zLevelsSorted.includes(activeZ)) setActiveZ(0);
  }, [zLevelsSorted, activeZ]);

  const staticMap = area.staticMap;
  const baseLayout = staticMap?.layout ?? [];
  const width = baseLayout.reduce((m, row) => Math.max(m, row.length), 0) || doc.rules.map.width || 40;
  const height = baseLayout.length || doc.rules.map.height || 20;

  useEffect(() => {
    const container = rotContainerRef.current;
    if (!staticMap || !container) return;

    let cancelled = false;
    let isPainting = false;
    let canvasEl: HTMLCanvasElement | null = null;

    const ensureLegendChar = (tileId: string): string => {
      const cur = latestRef.current;
      const legend = cur.area.staticMap?.legend ?? {};
      for (const [ch, mappedId] of Object.entries(legend)) {
        if (mappedId === tileId) return ch;
      }
      const tileDef = cur.doc.tiles[tileId];
      let candidate = tileDef?.glyph || '?';
      if (legend[candidate]) {
        const unused = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+'
          .split('')
          .find((c) => !legend[c]);
        candidate = unused || '?';
      }
      cur.controller.applyOperations(
        [
          {
            op: 'add',
            path: `${cur.basePath}/staticMap/legend/${escapeJsonPointerSegment(candidate)}`,
            value: tileId
          }
        ],
        true
      );
      return candidate;
    };

    const handlePaintAt = (display: ROT.Display, e: MouseEvent, isInitialDown: boolean): void => {
      const cur = latestRef.current;
      const sm = cur.area.staticMap;
      if (!sm || !cur.activePaintId) return;

      const pos = display.eventToPosition(e);
      if (!pos) return;
      const [x, y] = pos;
      if (x < 0 || x >= width || y < 0 || y >= height) return;

      if (cur.paintMode === 'tiles') {
        const ch = ensureLegendChar(cur.activePaintId);
        const rows = getSliceRows(cur.area, cur.activeZ);
        const rowStr = (rows[y] || '').padEnd(width, ' ');
        if (rowStr[x] === ch) return;
        const nextRow = rowStr.substring(0, x) + ch + rowStr.substring(x + 1);
        const targetPath =
          cur.activeZ === 0
            ? `${cur.basePath}/staticMap/layout/${y}`
            : `${cur.basePath}/staticMap/zLevels/${cur.activeZ}/${y}`;
        cur.controller.applyOperations([{ op: 'replace', path: targetPath, value: nextRow }], true);
      } else if (isInitialDown) {
        const existingList = cur.area.placedEntities ?? [];
        const existingIdx = existingList.findIndex((ent) => ent.x === x && ent.y === y && (ent.z ?? 0) === cur.activeZ);
        if (e.shiftKey && existingIdx >= 0) {
          cur.controller.applyOperations(
            [{ op: 'remove', path: `${cur.basePath}/placedEntities/${existingIdx}` }],
            false
          );
        } else if (!e.shiftKey) {
          const entry = {
            templateId: cur.activePaintId,
            x,
            y,
            ...(cur.activeZ !== 0 ? { z: cur.activeZ } : {})
          };
          if (!cur.area.placedEntities) {
            cur.controller.applyOperations(
              [{ op: 'add', path: `${cur.basePath}/placedEntities`, value: [entry] }],
              false
            );
          } else {
            cur.controller.applyOperations(
              [{ op: 'add', path: `${cur.basePath}/placedEntities/${existingList.length}`, value: entry }],
              false
            );
          }
        }
      }
    };

    const stopPainting = (): void => {
      isPainting = false;
    };
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0 || !displayRef.current) return;
      setContextMenu(null);
      isPainting = true;
      handlePaintAt(displayRef.current, e, true);
    };
    const onMouseMove = (e: MouseEvent): void => {
      if (!isPainting || !displayRef.current) return;
      handlePaintAt(displayRef.current, e, false);
    };
    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      if (!displayRef.current) return;
      const cur = latestRef.current;
      const sm = cur.area.staticMap;
      if (!sm) return;
      const pos = displayRef.current.eventToPosition(e);
      if (!pos) return;
      const [mapX, mapY] = pos;
      const rows = getSliceRows(cur.area, cur.activeZ);
      const ch = rows[mapY]?.[mapX] || ' ';
      const tileId = sm.legend[ch] || '';
      const tileDef = tileId ? cur.doc.tiles[tileId] : undefined;
      setContextMenu({
        x: mapX,
        y: mapY,
        clientX: e.clientX,
        clientY: e.clientY,
        walkable: tileDef ? tileDef.walkable !== false : false
      });
    };

    const win = window;
    createDisplay(doc, basePath, { width, height, bg: '#000000' })
      .then((display) => {
        if (cancelled) return;
        displayRef.current = display;
        container.replaceChildren();
        canvasEl = display.getContainer() as HTMLCanvasElement;
        canvasEl.style.position = 'relative';
        container.appendChild(canvasEl);

        canvasEl.addEventListener('mousedown', onMouseDown);
        canvasEl.addEventListener('mousemove', onMouseMove);
        canvasEl.addEventListener('mouseleave', stopPainting);
        canvasEl.addEventListener('contextmenu', onContextMenu);
        win.addEventListener('mouseup', stopPainting);
        const cur = latestRef.current;
        drawStaticSlice(display, cur.doc, cur.area, cur.activeZ, width, height);
      })
      .catch(console.error);

    return (): void => {
      cancelled = true;
      win.removeEventListener('mouseup', stopPainting);
      if (canvasEl) {
        canvasEl.removeEventListener('mousedown', onMouseDown);
        canvasEl.removeEventListener('mousemove', onMouseMove);
        canvasEl.removeEventListener('mouseleave', stopPainting);
        canvasEl.removeEventListener('contextmenu', onContextMenu);
      }
      displayRef.current = null;
      container.replaceChildren();
    };
  }, [Boolean(staticMap), basePath, width, height]);

  useEffect(() => {
    const display = displayRef.current;
    if (!display || !staticMap) return;
    drawStaticSlice(display, doc, area, activeZ, width, height);
  }, [doc, area, staticMap, activeZ, width, height]);

  if (!staticMap) {
    return (
      <div className="ui-editor-placeholder">
        <h3>Static Map Not Initialized</h3>
        <Button
          variant="primary"
          onClick={() => {
            const w = doc.rules.map.width || 40;
            const h = doc.rules.map.height || 20;
            controller.applyOperations([
              {
                op: 'add',
                path: `${basePath}/staticMap`,
                value: { layout: Array(h).fill(' '.repeat(w)), legend: { ' ': 'floor' } }
              }
            ]);
          }}
        >
          Initialize Static Map
        </Button>
      </div>
    );
  }

  const handleAddZSlice = (direction: 'above' | 'below'): void => {
    const targetZ = direction === 'above' ? Math.max(...zLevelsSorted) + 1 : Math.min(...zLevelsSorted) - 1;
    const defaultChar = Object.keys(staticMap.legend)[0] ?? ' ';
    const emptyRows = Array.from({ length: height }, () => defaultChar.repeat(width));
    if (!staticMap.zLevels) {
      controller.applyOperations([
        { op: 'add', path: `${basePath}/staticMap/zLevels`, value: { [String(targetZ)]: emptyRows } }
      ]);
    } else {
      controller.applyOperations([{ op: 'add', path: `${basePath}/staticMap/zLevels/${targetZ}`, value: emptyRows }]);
    }
    setActiveZ(targetZ);
  };

  const handleRemoveActiveZ = async (): Promise<void> => {
    if (activeZ === 0) return;
    const ok = await dialogService.confirm({
      title: `Remove Z-Level ${activeZ}`,
      message: `Delete slice Z=${activeZ} from "${area.name}"?`,
      confirmLabel: 'Delete Slice',
      danger: true
    });
    if (!ok) return;
    controller.applyOperations([{ op: 'remove', path: `${basePath}/staticMap/zLevels/${activeZ}` }]);
    setActiveZ(0);
  };

  return (
    <div className="ui-editor-static-painter">
      <AreaStaticPainterToolbars
        zLevelsSorted={zLevelsSorted}
        activeZ={activeZ}
        paintMode={paintMode}
        paletteEntries={paletteEntries}
        activePaintId={activePaintId}
        onSelectZ={setActiveZ}
        onAddZSlice={handleAddZSlice}
        onRemoveActiveZ={() => void handleRemoveActiveZ()}
        onChangePaintMode={setPaintMode}
        onSelectPaintId={setActivePaintId}
      />
      <div ref={rotContainerRef} className="ui-editor-canvas-stage" />
      {contextMenu ? (
        <AreaPlaytestMenu
          areaId={area.id || 'unknown'}
          x={contextMenu.x}
          y={contextMenu.y}
          z={activeZ}
          clientX={contextMenu.clientX}
          clientY={contextMenu.clientY}
          walkable={contextMenu.walkable}
          onClose={() => setContextMenu(null)}
          onSelectPlaytest={(spawnAreaId, spawnX, spawnY, spawnZ) => {
            sessionStorage.setItem(
              'editor_playtest_spawn',
              JSON.stringify({ areaId: spawnAreaId, x: spawnX, y: spawnY, z: spawnZ })
            );
            sessionStorage.setItem('editor_active_document', JSON.stringify(controller.getDocument()));
            sessionStorage.setItem('editor_active_category', activeTabId ?? '');
            sessionStorage.setItem('editor_active_item', activeItemId ?? '');
            sessionStorage.setItem('editor_playtest', 'true');
            window.location.reload();
          }}
        />
      ) : null}
    </div>
  );
}
