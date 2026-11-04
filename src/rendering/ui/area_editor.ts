import { type AreaDefinition, AreaDefinitionSchema } from '../../types/campaign.types.ts';
import { createDisplay, drawCell } from '../display.ts';
import type { EditorController } from '../editor_ui.ts';
import { renderStaticAreaPainter } from './area_static_painter.ts';
import { renderFormForZodSchema } from './zod_form_renderer.ts';

export * from './area_static_painter.ts';

/**
 * Renders the Area Editor which includes the standard form and an optional Grid Painter for static maps.
 */
export function renderAreaEditor(
  controller: EditorController,
  areaData: unknown,
  basePath: string,
  container: HTMLElement,
  errors?: ReadonlyArray<{ path: string; message: string; severity?: string }>
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

  renderFormForZodSchema(controller, AreaDefinitionSchema, area, basePath, formContainer);

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

    createDisplay(doc, basePath, {
      width,
      height,
      bg: '#000'
    })
      .then((display) => {
        sandboxContainer.appendChild(display.getContainer() as HTMLElement);
        const isSpriteMode = doc.theme.spriteSheets !== undefined;

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
                    drawCell(display, x, y, isSpriteMode, tileDef);
                  }
                }
              }
            }

            drawCell(display, generated.startPos.x, generated.startPos.y, isSpriteMode, {
              glyph: '@',
              fg: '#00ff00',
              bg: '#000',
              spriteId: 'player'
            });

            for (const portal of generated.portals) {
              drawCell(display, portal.x, portal.y, isSpriteMode, {
                glyph: 'O',
                fg: '#ff00ff',
                bg: '#000',
                spriteId: 'stairs_down'
              });
            }

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
      })
      .catch(console.error);

    return;
  }

  renderStaticAreaPainter(controller, doc, area, basePath, painterContainer);

  if (errors && errors.length > 0) {
    const errBlock = document.createElement('div');
    errBlock.style.marginTop = '12px';
    errBlock.style.padding = '8px';
    errBlock.style.background = 'rgba(231, 76, 60, 0.1)';
    errBlock.style.border = '1px solid #e74c3c';
    errBlock.style.borderRadius = '4px';
    errBlock.style.fontSize = '0.8rem';

    const title = document.createElement('strong');
    title.textContent = `Area Validation Errors (${errors.length})`;
    title.style.color = '#e74c3c';
    errBlock.appendChild(title);

    for (const err of errors) {
      if (err.path && err.path.startsWith(basePath)) {
        const row = document.createElement('div');
        row.textContent = `${err.path}: ${err.message}`;
        row.style.color = '#e74c3c';
        row.style.marginTop = '2px';
        errBlock.appendChild(row);
      }
    }
    container.appendChild(errBlock);
  }
}
