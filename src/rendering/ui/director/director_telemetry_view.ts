import type { CampaignData, AreaDefinition } from '../../../types/campaign.types.ts';
import type { DirectorReceipt } from '../../../types/encounter.types.ts';
import type { GeneratedArea } from '../../../map/generator.ts';

// ─── Constants ──────────────────────────────────────────────────────────────
export const MAP_CELL_SIZE = 6; // px per tile in the DOM mini-map

export const AXIS_COLORS: Record<string, string> = {
  protein: '#e74c3c',
  appetizer: '#2ecc71',
  side: '#f39c12',
  dessert: '#9b59b6'
};

/**
 * Resolves tile color from campaign data for mini-map rendering.
 */
export function getTileColor(campaign: CampaignData, tileId: string): string {
  const tileDef = campaign.tiles[tileId];
  if (tileDef?.bg) return tileDef.bg;
  if (tileId.includes('wall') || tileId === 'empty_space') return '#333';
  if (tileId.includes('water')) return '#2980b9';
  return '#555'; // default floor
}

/**
 * Resolves entity glyph/color from campaign data.
 */
export function getEntityDisplay(campaign: CampaignData, templateId: string): { glyph: string; fg: string; bg: string } {
  const def = campaign.entities[templateId];
  return {
    glyph: def?.glyph ?? '?',
    fg: def?.fg ?? '#fff',
    bg: def?.bg ?? 'transparent'
  };
}

/**
 * Lightens a CSS color string by a percentage.
 */
export function lightenColor(color: string, percent: number): string {
  const hex = color.replace('#', '');
  if (hex.length < 6) return color;
  const num = parseInt(hex, 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + percent);
  const g = Math.min(255, ((num >> 8) & 0xff) + percent);
  const b = Math.min(255, (num & 0xff) + percent);
  return `rgb(${r},${g},${b})`;
}

/**
 * Gets a human-readable label for a candidate disposition.
 */
export function getDispositionLabel(disposition: string): string {
  switch (disposition) {
    case 'too_expensive':
      return 'Too expensive for remaining budget';
    case 'token_exhausted':
      return 'Unique/token limit reached';
    case 'no_space':
      return 'No available floor tile in room';
    case 'pool_filtered':
      return 'Pool conditions did not match';
    default:
      return disposition;
  }
}

/**
 * Builds a static area definition representation from a generated area.
 */
export function buildBakedStaticArea(
  newId: string,
  areaDef: AreaDefinition,
  generated: GeneratedArea
): AreaDefinition {
  const width = generated.map.width;
  const height = generated.map.height;

  // Map tile definitions dynamically to build legend
  const legend: Record<string, string> = {
    '.': 'empty_space',
    '#': 'stone_wall',
    '~': 'water'
  };
  const legendInverse: Record<string, string> = {
    empty_space: '.',
    stone_wall: '#',
    water: '~'
  };

  const layoutRows: string[] = [];
  for (let y = 0; y < height; y++) {
    let rowStr = '';
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const tile = generated.map.tiles[idx];
      const tileId = tile?.tileId || 'empty_space';

      let char = legendInverse[tileId];
      if (!char) {
        const candidate = tileId.slice(0, 1).toLowerCase() || '?';
        char = legend[candidate] ? '?' : candidate;
        if (char === '?') {
          const unused = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+'
            .split('')
            .find((c) => !legend[c]);
          char = unused || '?';
        }
        legend[char] = tileId;
        legendInverse[tileId] = char;
      }
      rowStr += char;
    }
    layoutRows.push(rowStr);
  }

  return {
    id: newId,
    name: `${areaDef.name} (Baked)`,
    generatorType: 'static',
    dangerRating: areaDef.dangerRating,
    tags: areaDef.tags || [],
    connections: generated.portals.map((p) => ({
      targetAreaId: p.connection.targetAreaId,
      placementSide: p.connection.placementSide || 'any',
      direction: p.connection.direction,
      placementX: p.x,
      placementY: p.y
    })),
    placedEntities:
      generated.placedEntities?.map((e) => ({
        templateId: e.templateId,
        x: e.x,
        y: e.y
      })) || [],
    staticMap: {
      layout: layoutRows,
      legend
    }
  };
}

/**
 * Renders the generated map as a DOM grid.
 */
export function renderMiniMap(container: HTMLElement, campaign: CampaignData, result: GeneratedArea): void {
  const mapGrid = container.querySelector('#ds-map-grid') as HTMLElement | null;
  const mapStats = container.querySelector('#ds-map-stats');
  if (!mapGrid) return;

  const { map, rooms, portals, placedEntities, startPos, directorReceipt } = result;
  const entityPositions = new Map<string, string>(); // "x,y" → templateId
  if (placedEntities) {
    for (const e of placedEntities) {
      entityPositions.set(`${e.x},${e.y}`, e.templateId);
    }
  }

  // Mark start position
  const startKey = `${startPos.x},${startPos.y}`;

  // Portal positions
  const portalKeys = new Set<string>();
  for (const p of portals) {
    portalKeys.add(`${p.x},${p.y}`);
  }

  // Room region tracking for highlighting
  const roomKeys = new Set<string>();
  for (const r of rooms) {
    for (let y = r.top; y <= r.bottom; y++) {
      for (let x = r.left; x <= r.right; x++) {
        roomKeys.add(`${x},${y}`);
      }
    }
  }

  // Build grid
  mapGrid.style.gridTemplateColumns = `repeat(${map.width}, ${MAP_CELL_SIZE}px)`;
  mapGrid.replaceChildren();

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const idx = y * map.width + x;
      const tile = map.tiles[idx];
      const cell = document.createElement('div');
      cell.style.width = `${MAP_CELL_SIZE}px`;
      cell.style.height = `${MAP_CELL_SIZE}px`;
      cell.style.fontSize = `${MAP_CELL_SIZE - 1}px`;
      cell.style.lineHeight = `${MAP_CELL_SIZE}px`;
      cell.style.textAlign = 'center';
      cell.style.boxSizing = 'border-box';

      // Tile background color
      if (tile) {
        cell.style.backgroundColor = getTileColor(campaign, tile.tileId);
      } else {
        cell.style.backgroundColor = '#111';
      }

      // Room highlight (subtle)
      const key = `${x},${y}`;
      if (roomKeys.has(key) && !tile?.tileId.includes('wall')) {
        cell.style.backgroundColor = lightenColor(cell.style.backgroundColor, 10);
      }

      // Entity overlay
      const entityId = entityPositions.get(key);
      if (entityId) {
        const display = getEntityDisplay(campaign, entityId);
        cell.textContent = display.glyph;
        cell.style.color = display.fg;
        cell.style.fontWeight = 'bold';
        cell.title = entityId;

        // Check for dynamic traits
        const placedEntity = placedEntities?.find((e) => e.x === x && e.y === y);
        if (placedEntity?.dynamicTraits && placedEntity.dynamicTraits.length > 0) {
          cell.style.outline = '1px solid #f1c40f';
          cell.title += ` [${placedEntity.dynamicTraits.join(', ')}]`;
        }
      }

      // Portal overlay (glyph takes precedence)
      if (portalKeys.has(key)) {
        cell.textContent = '🌀';
        cell.title = 'Portal / Transition';
      }

      // Start position marker
      if (key === startKey) {
        if (!entityId) {
          cell.textContent = '@';
          cell.style.color = '#2ecc71';
          cell.title = 'Player Start';
        }
        cell.style.outline = '1px solid #2ecc71';
      }

      mapGrid.appendChild(cell);
    }
  }

  // Update stats
  if (mapStats) {
    const entityCount = placedEntities?.length ?? 0;
    const totalBudget = directorReceipt?.effectiveBudget ?? 0;
    const totalSpent = Object.values(directorReceipt?.axisResults ?? {}).reduce((s, a) => s + a.spent, 0);
    const totalRooms = rooms.length;
    mapStats.textContent = `🗺 ${map.width}×${map.height} | 🚪 ${totalRooms} rooms | 👾 ${entityCount} entities | 💰 ${totalSpent}/${totalBudget} CR spent`;
  }
}

/**
 * Renders the Director Receipt panel with candidate explanations.
 */
export function renderReceipt(_container: HTMLElement, campaign: CampaignData, receipt: DirectorReceipt): void {
  const content = document.getElementById('ds-receipt-content');
  if (!content) return;

  const { axisResults, effectiveBudget, preAllocated, traitUpgrades } = receipt;
  const parts: string[] = [];

  // Budget summary
  const totalSpent = Object.values(axisResults).reduce((s, a) => s + a.spent, 0);
  parts.push(`
    <div style="margin-bottom: 0.5rem; padding: 0.25rem 0.5rem; background: rgba(255,255,255,0.05); border-radius: 3px;">
      <strong>Budget Summary</strong><br/>
      Total: <code>${effectiveBudget}</code> CR
      &nbsp;|&nbsp; Spent: <code>${totalSpent}</code> CR
      &nbsp;|&nbsp; Pre-allocated: <code>${preAllocated}</code> CR
      &nbsp;|&nbsp; Remaining: <code style="color: ${effectiveBudget - totalSpent > 0 ? '#f39c12' : '#888'}">${effectiveBudget - totalSpent}</code>
    </div>
  `);

  // Per-axis breakdown
  for (const axis of ['protein', 'appetizer', 'side', 'dessert'] as const) {
    const result = axisResults[axis];
    const color = AXIS_COLORS[axis] ?? '#888';
    const pct = result.budget > 0 ? Math.round((result.spent / result.budget) * 100) : 0;

    parts.push(`
      <div style="margin-bottom: 0.5rem; border-left: 3px solid ${color}; padding-left: 0.5rem;">
        <div style="display: flex; justify-content: space-between; font-weight: bold;">
          <span style="text-transform: capitalize;">${axis}</span>
          <span style="color: ${color};">${result.spent} / ${result.budget} CR (${pct}%)</span>
        </div>
        <div style="background: #333; height: 6px; border-radius: 3px; margin: 2px 0 4px 0;">
          <div style="background: ${color}; width: ${Math.min(pct, 100)}%; height: 100%; border-radius: 3px;"></div>
        </div>
    `);

    // Spawned entities
    if (result.candidates.filter((c) => c.disposition === 'spawned').length > 0) {
      parts.push(`<div style="font-size: 0.7rem; color: #2ecc71; margin-bottom: 2px;">✓ Spawned:</div>`);
      for (const c of result.candidates) {
        if (c.disposition !== 'spawned') continue;
        const def = campaign.entities[c.templateId];
        const name = def?.name ?? c.templateId;
        parts.push(
          `<div style="font-size: 0.65rem; padding-left: 0.5rem; color: #ccc;"> &bull; ${name} (${c.cost} CR) ${c.reasonDetail ?? ''}</div>`
        );
      }
    }

    // Rejected candidates
    const rejected = result.candidates.filter((c) => c.disposition !== 'spawned');
    if (rejected.length > 0) {
      parts.push(
        `<div style="font-size: 0.7rem; color: #e74c3c; margin-top: 2px; margin-bottom: 2px;">✗ Rejected (${rejected.length}):</div>`
      );
      for (const c of rejected) {
        const def = campaign.entities[c.templateId];
        const name = def?.name ?? c.templateId;
        const reasonLabel = getDispositionLabel(c.disposition);
        parts.push(
          `<div style="font-size: 0.65rem; padding-left: 0.5rem; color: #999;"> &bull; ${name} (${c.cost} CR) &mdash; <span style="color: #e74c3c;">${reasonLabel}</span></div>`
        );
      }
    }

    parts.push(`</div>`);
  }

  // Trait upgrades
  if (traitUpgrades.length > 0) {
    parts.push(`
      <div style="margin-bottom: 0.5rem; padding: 0.25rem 0.5rem; background: rgba(241, 196, 15, 0.1); border-radius: 3px;">
        <strong style="color: #f1c40f;">✦ Budget Padding — Dynamic Traits</strong><br/>
        ${traitUpgrades.map((t) => `<span style="font-size: 0.7rem;">• ${t}</span>`).join('<br/>')}
      </div>
    `);
  }

  content.innerHTML = parts.join('\n');
}

/**
 * Updates the JSON inspector panel with the serialized preview of the baked area.
 */
export function updateJsonPreview(container: HTMLElement, areaId: string, areaDef: AreaDefinition, generated: GeneratedArea): void {
  const jsonContent = container.querySelector('#ds-json-content');
  if (!jsonContent) return;
  const previewArea = buildBakedStaticArea(`${areaId}_baked`, areaDef, generated);
  jsonContent.textContent = JSON.stringify(previewArea, null, 2);
}
