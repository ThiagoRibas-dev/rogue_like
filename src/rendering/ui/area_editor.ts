import type { EditorController } from '../editor_ui.ts';
import type { AreaDefinition } from '../../types/campaign.types.ts';
import { AreaDefinitionSchema } from '../../types/campaign.types.ts';
import { renderFormForZodSchema } from './zod_form_renderer.ts';
import * as ROT from 'rot-js';

/**
 * Renders the Area Editor which includes the standard form and an optional Grid Painter for static maps.
 */
export function renderAreaEditor(
  controller: EditorController,
  areaData: unknown,
  basePath: string,
  container: HTMLElement
): void {
  const area = areaData as AreaDefinition;
  const doc = controller.getDocument();

  container.innerHTML = `
    <div style="display: flex; gap: 20px; width: 50%; height: 100%;">
      <div id="area-form-container" style="flex: 1; min-width: 400px; overflow-y: auto; padding-right: 10px;"></div>
      <div id="area-painter-container" style="flex: 2; border-left: 1px solid #444; padding-left: 20px; display: flex; flex-direction: column;"></div>
    </div>
  `;

  const formContainer = container.querySelector('#area-form-container') as HTMLElement;
  const painterContainer = container.querySelector('#area-painter-container') as HTMLElement;

  // 1. Render standard form
  renderFormForZodSchema(controller, AreaDefinitionSchema, area, basePath, formContainer);

  // 2. Render Painter if static
  if (area.generatorType !== 'static') {
    painterContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; height: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <h2>Live Generator Sandbox</h2>
          <button id="btn-reroll" class="editor-btn editor-btn-primary">Reroll Seed</button>
        </div>
        <div id="sandbox-display-container" style="flex-grow: 1; background: #000; border: 1px solid #444; overflow: auto; display: flex; align-items: center; justify-content: center;"></div>
      </div>
    `;

    const sandboxContainer = painterContainer.querySelector('#sandbox-display-container') as HTMLElement;
    const btnReroll = painterContainer.querySelector('#btn-reroll') as HTMLButtonElement;

    const width = doc.rules.map.width || 40;
    const height = doc.rules.map.height || 20;

    const display = new ROT.Display({
      width,
      height,
      fontSize: doc.theme.ui.fontSize || 16,
      fontFamily: doc.theme.ui.fontFamily || 'monospace',
      bg: '#000'
    });

    sandboxContainer.appendChild(display.getContainer() as HTMLElement);

    const generateAndDraw = (): void => {
      display.clear();
      try {
        const generated = controller.generateSandboxArea(area.id);

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const tileData = generated.map.tiles[idx];
            if (tileData) {
              const tileDef = doc.tiles[tileData.tileId];
              if (tileDef) {
                display.draw(x, y, tileDef.glyph, tileDef.fg || '#fff', tileDef.bg || '#000');
              }
            }
          }
        }

        // Draw start position
        display.draw(generated.startPos.x, generated.startPos.y, '@', '#00ff00', '#000');

        // Draw portals
        for (const portal of generated.portals) {
          display.draw(portal.x, portal.y, 'O', '#ff00ff', '#000');
        }

        // Reachability check
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
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const key = `${nx},${ny}`;
              if (!visited.has(key)) {
                const idx = ny * width + nx;
                const t = generated.map.tiles[idx];
                if (t) {
                  const def = doc.tiles[t.tileId];
                  if (def && def.walkable !== false) {
                    visited.add(key);
                    queue.push([nx, ny]);
                  }
                }
              }
            }
          }
        }

        for (const portal of generated.portals) {
          if (!visited.has(`${portal.x},${portal.y}`)) {
            display.drawText(0, 0, `%c{#f00}Warning: Portal at ${portal.x},${portal.y} is unreachable!`);
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error) {
          display.drawText(0, 0, `%c{#f00}Error generating map: ${e.message}`);
        } else {
          display.drawText(0, 0, `%c{#f00}Unknown error generating map.`);
        }
      }
    };

    btnReroll.addEventListener('click', generateAndDraw);
    setTimeout(generateAndDraw, 100);

    return;
  }

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
            legend: { ' ': 'floor' } // default
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

  interface PaintDef {
    glyph: string;
    fg?: string;
    bg?: string;
  }
  let activePaintDef: PaintDef | null = null;

  const buildPalette = (): void => {
    paletteContainer.innerHTML = '';
    const items = (
      activePaintMode === 'tiles' ? doc.tiles : activePaintMode === 'entities' ? doc.entities : doc.items
    ) as Record<string, PaintDef>;

    Object.entries(items).forEach(([id, def]) => {
      const btn = document.createElement('button');
      btn.style.width = '30px';
      btn.style.height = '30px';
      btn.style.background = def.bg || '#000';
      btn.style.color = def.fg || '#fff';
      btn.style.border = '1px solid #444';
      btn.style.cursor = 'pointer';
      btn.style.fontSize = '18px';
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

  // Setup ROT Display
  const layout = area.staticMap.layout;
  const legend = area.staticMap.legend;
  const width = layout.reduce((max, row) => Math.max(max, row.length), 0) || doc.rules.map.width || 40;
  const height = layout.length || doc.rules.map.height || 20;

  const display = new ROT.Display({
    width,
    height,
    fontSize: doc.theme.ui.fontSize || 16,
    fontFamily: doc.theme.ui.fontFamily || 'monospace',
    bg: '#000'
  });

  rotContainer.appendChild(display.getContainer() as HTMLElement);

  // Draw current layout
  const drawMap = () => {
    display.clear();
    for (let y = 0; y < height; y++) {
      const row = layout[y] || '';
      for (let x = 0; x < width; x++) {
        const char = row[x] || ' ';
        const tileId = legend[char];
        if (tileId && doc.tiles[tileId]) {
          const t = doc.tiles[tileId];
          if (t) {
            display.draw(x, y, t.glyph, t.fg ?? null, t.bg ?? null);
          }
        } else {
          // Unmapped character
          display.draw(x, y, char, '#fff', '#000');
        }
      }
    }

    // Draw placed entities
    if (area.placedEntities) {
      for (const ent of area.placedEntities) {
        const def = doc.entities[ent.templateId] || doc.items[ent.templateId];
        if (def) {
          display.draw(ent.x, ent.y, def.glyph, def.fg ?? null, def.bg ?? null);
        }
      }
    }
  };
  drawMap();

  // Helper to get or create a character mapping for a tileId
  const getCharForTileId = (tileId: string): string => {
    // Check if it already exists in legend
    for (const [char, mappedId] of Object.entries(legend)) {
      if (mappedId === tileId) return char;
    }

    // Doesn't exist, we need to add it to legend.
    const tileDef = doc.tiles[tileId];
    let candidate = tileDef ? tileDef.glyph : '?';

    // If taken, find an unused ascii character
    if (legend[candidate]) {
      const unused = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+'
        .split('')
        .find((c) => !legend[c]);
      candidate = unused || '?'; // fallback
    }

    controller.applyOperations([{ op: 'add', path: `${basePath}/staticMap/legend/${candidate}`, value: tileId }], true);
    legend[candidate] = tileId;
    return candidate;
  };

  // Painting Logic
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
          display.draw(x, y, activePaintDef.glyph, activePaintDef.fg ?? null, activePaintDef.bg ?? null);
        }
        controller.applyOperations(
          [{ op: 'replace', path: `${basePath}/staticMap/layout/${y}`, value: newRowStr }],
          true
        );
      }
    } else {
      // Entities or Items
      // Only place on click, not drag, to avoid spam
      if (!isPainting) {
        // Find if one exists here
        const existingIdx = (area.placedEntities || []).findIndex((e) => e.x === x && e.y === y);

        // Ensure array exists
        if (!area.placedEntities) {
          controller.applyOperations([{ op: 'add', path: `${basePath}/placedEntities`, value: [] }], true);
        }

        if (e.shiftKey && existingIdx >= 0) {
          // Remove
          controller.applyOperations([{ op: 'remove', path: `${basePath}/placedEntities/${existingIdx}` }], false);
        } else if (!e.shiftKey) {
          // Add
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

        // A hacky quick redraw
        setTimeout(drawMap, 10);
      }
    }
  };

  const canvas = display.getContainer() as HTMLCanvasElement;
  canvas.addEventListener('mousedown', (e) => {
    paintAt(e); // Single click
    isPainting = true;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isPainting) {
      paintAt(e);
    }
  });

  canvas.addEventListener('mouseup', () => {
    isPainting = false;
    // We could emit a dummy non-coalesced op here to break the undo group if we wanted,
    // but clicking elsewhere will naturally break it based on the path changing.
  });

  canvas.addEventListener('mouseleave', () => {
    isPainting = false;
  });
}
