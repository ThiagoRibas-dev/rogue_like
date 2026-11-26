import { DEFAULT_STREAMING_PREVIEW_SPAN } from '../../../constants/world_chunk.constants.ts';
import type { CampaignData, AreaDefinition } from '../../../types/campaign.types.ts';
import type { GeneratedArea } from '../../../map/generator.ts';
import { getTileIdAt } from '../../../map/map_accessor.ts';

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
export function getEntityDisplay(
  campaign: CampaignData,
  templateId: string
): { glyph: string; fg: string; bg: string } {
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
export function buildBakedStaticArea(newId: string, areaDef: AreaDefinition, generated: GeneratedArea): AreaDefinition {
  const isStreaming = generated.map.chunkGrid !== undefined;
  const width = isStreaming ? DEFAULT_STREAMING_PREVIEW_SPAN : generated.map.width;
  const height = isStreaming ? DEFAULT_STREAMING_PREVIEW_SPAN : generated.map.height;
  const originX = isStreaming ? generated.startPos.x - Math.floor(width / 2) : 0;
  const originY = isStreaming ? generated.startPos.y - Math.floor(height / 2) : 0;

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
  for (let vy = 0; vy < height; vy++) {
    let rowStr = '';
    for (let vx = 0; vx < width; vx++) {
      const tileId = getTileIdAt(generated.map, originX + vx, originY + vy) || 'empty_space';

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
