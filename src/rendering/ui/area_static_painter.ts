import type { AreaDefinition, CampaignData } from '../../types/campaign.types.ts';
import { createDisplay, drawCell } from '../display.ts';
import { editorState } from '../editor/editor_state.ts';
import type { EditorController } from '../editor_ui.ts';
import { renderPlaytestMenu } from './area_playtest_menu.ui.ts';

interface PaintDef {
  glyph: string;
  fg?: string;
  bg?: string;
  spriteId?: string | undefined;
}

/**
 * Renders the interactive static map grid painter and context menu for an `AreaDefinition`.
 */
export function renderStaticAreaPainter(
  controller: EditorController,
  doc: CampaignData,
  area: AreaDefinition,
  basePath: string,
  painterContainer: HTMLElement
): void {
  if (!area.staticMap) {
    painterContainer.innerHTML = `
      <div class="workspace-placeholder">
        <h2>Static Map Not Initialized</h2>
        <button id="btn-init-static" class="editor-btn editor-btn-primary" style="margin-top: 20px;">Initialize Static Map</button>
      </div>
    `;
    painterContainer.querySelector('#btn-init-static')?.addEventListener('click', () => {
      const width = doc.rules.map.width || 40;
      const height = doc.rules.map.height || 20;
      const emptyRow = ' '.repeat(width);
      const layout = Array(height).fill(emptyRow);

      controller.applyOperations([
        {
          op: 'add',
          path: `${basePath}/staticMap`,
          value: {
            layout,
            legend: { ' ': 'floor' }
          }
        }
      ]);
    });
    return;
  }

  painterContainer.innerHTML = `
    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
      <select id="palette-mode-select" style="background: #222; color: #fff; border: 1px solid #444; padding: 4px;">
        <option value="tiles">Tiles</option>
        <option value="entities">Entities</option>
        <option value="items">Items</option>
      </select>
      <div id="palette-container" style="display: flex; gap: 5px; flex-wrap: wrap; flex: 1;"></div>
      <div>
        <label style="font-size: 0.8rem; color: #888; display: block; margin-bottom: 4px;">Active Brush:</label>
        <div id="active-brush-display" style="width: 40px; height: 40px; border: 2px solid white; display: flex; align-items: center; justify-content: center; font-size: 24px; background: #000;"></div>
      </div>
    </div>
    <div id="rot-display-container" style="flex-grow: 1; background: #000; border: 1px solid #444; overflow: auto; display: flex; align-items: center; justify-content: center;"></div>
  `;

  const paletteModeSelect = painterContainer.querySelector('#palette-mode-select') as HTMLSelectElement;
  const paletteContainer = painterContainer.querySelector('#palette-container') as HTMLElement;
  const rotContainer = painterContainer.querySelector('#rot-display-container') as HTMLElement;
  const activeBrushDisplay = painterContainer.querySelector('#active-brush-display') as HTMLElement;

  let activePaintMode: 'tiles' | 'entities' | 'items' = 'tiles';
  let activePaintId: string | null = null;
  let activePaintDef: PaintDef | null = null;

  const buildPalette = (): void => {
    paletteContainer.replaceChildren();
    const items = (
      activePaintMode === 'tiles' ? doc.tiles : activePaintMode === 'entities' ? doc.entities : doc.items
    ) as Record<string, PaintDef>;

    Object.entries(items).forEach(([id, def]) => {
      const btn = document.createElement('button');
      btn.style.cssText = `width: 30px; height: 30px; background: ${def.bg || '#000'}; color: ${def.fg || '#fff'}; border: 1px solid #444; cursor: pointer; font-size: 18px;`;
      btn.textContent = def.glyph;
      btn.title = id;

      btn.addEventListener('click', () => {
        activePaintId = id;
        activePaintDef = def;
        activeBrushDisplay.textContent = def.glyph;
        activeBrushDisplay.style.color = def.fg || '#fff';
        activeBrushDisplay.style.backgroundColor = def.bg || '#000';
      });

      paletteContainer.appendChild(btn);
    });

    const firstId = Object.keys(items)[0];
    if (firstId) {
      const firstDef = items[firstId];
      if (firstDef) {
        activePaintId = firstId;
        activePaintDef = firstDef;
        activeBrushDisplay.textContent = firstDef.glyph;
        activeBrushDisplay.style.color = firstDef.fg || '#fff';
        activeBrushDisplay.style.backgroundColor = firstDef.bg || '#000';
      }
    } else {
      activePaintId = null;
      activePaintDef = null;
      activeBrushDisplay.textContent = '';
      activeBrushDisplay.style.backgroundColor = '#000';
    }
  };

  paletteModeSelect.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    if (target.value === 'tiles' || target.value === 'entities' || target.value === 'items') {
      activePaintMode = target.value;
      buildPalette();
    }
  });

  buildPalette();

  const layout = area.staticMap.layout;
  const legend = area.staticMap.legend;
  const width = layout.reduce((max, row) => Math.max(max, row.length), 0) || doc.rules.map.width || 40;
  const height = layout.length || doc.rules.map.height || 20;

  createDisplay(doc, basePath, {
    width,
    height,
    bg: '#000'
  })
    .then((display) => {
      rotContainer.appendChild(display.getContainer() as HTMLElement);
      const isSpriteMode = doc.theme.spriteSheets !== undefined;

      const drawMap = (): void => {
        display.clear();
        for (let y = 0; y < height; y++) {
          const row = layout[y] || '';
          for (let x = 0; x < width; x++) {
            const char = row[x] || ' ';
            const tileId = legend[char];
            if (tileId && doc.tiles[tileId]) {
              const t = doc.tiles[tileId];
              if (t) {
                drawCell(display, x, y, isSpriteMode, t);
              }
            } else {
              drawCell(display, x, y, isSpriteMode, { glyph: char, fg: '#fff', bg: '#000' });
            }
          }
        }

        if (area.placedEntities) {
          for (const ent of area.placedEntities) {
            const def = doc.entities[ent.templateId] || doc.items[ent.templateId];
            if (def) {
              drawCell(display, ent.x, ent.y, isSpriteMode, def);
            }
          }
        }
      };
      drawMap();

      const getCharForTileId = (tileId: string): string => {
        for (const [char, mappedId] of Object.entries(legend)) {
          if (mappedId === tileId) return char;
        }

        const tileDef = doc.tiles[tileId];
        let candidate = tileDef ? tileDef.glyph : '?';

        if (legend[candidate]) {
          const unused = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+'
            .split('')
            .find((c) => !legend[c]);
          candidate = unused || '?';
        }

        controller.applyOperations(
          [{ op: 'add', path: `${basePath}/staticMap/legend/${candidate}`, value: tileId }],
          true
        );
        legend[candidate] = tileId;
        return candidate;
      };

      let isPainting = false;

      const paintAt = (e: MouseEvent): void => {
        if (!activePaintId) return;

        const pos = display.eventToPosition(e);
        if (!pos) return;
        const [x, y] = pos;

        if (x < 0 || x >= width || y < 0 || y >= height) return;

        if (activePaintMode === 'tiles') {
          const char = getCharForTileId(activePaintId);
          let rowStr = layout[y] || ' '.repeat(width);

          if (rowStr.length < width) {
            rowStr = rowStr.padEnd(width, ' ');
          }

          if (rowStr[x] !== char) {
            const newRowStr = rowStr.substring(0, x) + char + rowStr.substring(x + 1);
            layout[y] = newRowStr;
            if (activePaintDef) {
              const entsAtTile = (area.placedEntities || [])
                .filter((ent) => ent.x === x && ent.y === y)
                .map((ent) => doc.entities[ent.templateId] || doc.items[ent.templateId])
                .filter((def): def is NonNullable<typeof def> => def !== undefined);
              drawCell(
                display,
                x,
                y,
                isSpriteMode,
                {
                  glyph: activePaintDef.glyph,
                  fg: activePaintDef.fg ?? '#fff',
                  bg: activePaintDef.bg ?? '#000',
                  spriteId: activePaintDef.spriteId
                },
                entsAtTile
              );
            }
            controller.applyOperations(
              [{ op: 'replace', path: `${basePath}/staticMap/layout/${y}`, value: newRowStr }],
              true
            );
          }
        } else if (!isPainting) {
          const existingIdx = (area.placedEntities || []).findIndex((ent) => ent.x === x && ent.y === y);

          if (!area.placedEntities) {
            controller.applyOperations([{ op: 'add', path: `${basePath}/placedEntities`, value: [] }], true);
          }

          if (e.shiftKey && existingIdx >= 0) {
            controller.applyOperations([{ op: 'remove', path: `${basePath}/placedEntities/${existingIdx}` }], false);
          } else if (!e.shiftKey) {
            controller.applyOperations(
              [
                {
                  op: 'add',
                  path: `${basePath}/placedEntities/-`,
                  value: { templateId: activePaintId, x, y }
                }
              ],
              false
            );
          }

          setTimeout(drawMap, 10);
        }
      };

      const canvas = display.getContainer() as HTMLCanvasElement;
      canvas.style.position = 'relative';
      canvas.addEventListener('mousedown', (e) => {
        paintAt(e);
        isPainting = true;
      });

      canvas.addEventListener('mousemove', (e) => {
        if (isPainting) {
          paintAt(e);
        }
      });

      const stopPainting = (): void => {
        isPainting = false;
      };
      window.addEventListener('mouseup', stopPainting);

      canvas.addEventListener('mouseleave', () => {
        isPainting = false;
      });

      canvas.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        const pos = display.eventToPosition(e);
        if (!pos) return;
        const [mapX, mapY] = pos;

        const row = layout[mapY] || '';
        const char = row[mapX] || ' ';
        const tileId = legend[char] || '';
        const tileDefActual = doc.tiles[tileId] || null;
        const isWalkable = tileDefActual ? tileDefActual.walkable !== false : false;

        const activeDoc = controller.getDocument();
        const menuContainer = document.createElement('div');
        menuContainer.className = 'tile-context-menu';
        menuContainer.style.cssText = `position: fixed; z-index: 1000; background: #16162a; border: 1px solid #444; border-radius: 6px; padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); min-width: 160px; left: ${e.clientX}px; top: ${e.clientY}px;`;
        document.body.appendChild(menuContainer);

        renderPlaytestMenu(menuContainer, {
          areaId: area.id || 'unknown',
          x: mapX,
          y: mapY,
          walkable: isWalkable,
          onSelectPlaytest: (spawnAreaId: string, spawnX: number, spawnY: number) => {
            sessionStorage.setItem(
              'editor_playtest_spawn',
              JSON.stringify({ areaId: spawnAreaId, x: spawnX, y: spawnY })
            );
            sessionStorage.setItem('editor_active_document', JSON.stringify(activeDoc));
            sessionStorage.setItem('editor_active_category', editorState.activeTabId || '');
            sessionStorage.setItem('editor_active_item', editorState.activeItemId || '');
            sessionStorage.setItem('editor_playtest', 'true');
            window.location.reload();
          }
        });

        const closeMenu = (): void => {
          menuContainer.remove();
          document.removeEventListener('click', closeMenu);
        };
        document.addEventListener('click', closeMenu, { once: true });
      });
    })
    .catch(console.error);
}
