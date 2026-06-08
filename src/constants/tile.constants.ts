import { COLOR_BACKGROUND, COLOR_FLOOR_FG, COLOR_WALL_FG, COLOR_STAIRS_FG } from './colors.constants.ts';
import { GLYPH_FLOOR, GLYPH_WALL, GLYPH_STAIRS_UP, GLYPH_STAIRS_DOWN } from './glyphs.constants.ts';

/**
 * Definition of properties and visual layout of a specific tile type.
 */
export interface TileDefinition {
  readonly walkable: boolean;
  readonly transparent: boolean;
  readonly glyph: string;
  readonly fg: string;
  readonly bg: string;
  /** Optional movement cost multiplier (100 = normal speed). Defaults to 100 if undefined. */
  readonly movementCost?: number;
}

/**
 * Registry mapping a tile ID string to its properties and styles.
 */
export const TILE_REGISTRY: Readonly<Record<string, TileDefinition>> = {
  stone_floor: {
    walkable: true,
    transparent: true,
    glyph: GLYPH_FLOOR,
    fg: COLOR_FLOOR_FG,
    bg: COLOR_BACKGROUND
  },
  stone_wall: {
    walkable: false,
    transparent: false,
    glyph: GLYPH_WALL,
    fg: COLOR_WALL_FG,
    bg: COLOR_BACKGROUND
  },
  stairs_up: {
    walkable: true,
    transparent: true,
    glyph: GLYPH_STAIRS_UP,
    fg: COLOR_STAIRS_FG,
    bg: COLOR_BACKGROUND
  },
  stairs_down: {
    walkable: true,
    transparent: true,
    glyph: GLYPH_STAIRS_DOWN,
    fg: COLOR_STAIRS_FG,
    bg: COLOR_BACKGROUND
  },
  empty_space: {
    walkable: false,
    transparent: false,
    glyph: ' ',
    fg: '#000000',
    bg: COLOR_BACKGROUND
  },
  shallow_water: {
    walkable: true,
    transparent: true,
    glyph: '~',
    fg: '#3498db',
    bg: COLOR_BACKGROUND,
    movementCost: 200 // Takes twice as long to move through
  },
  closed_door: {
    walkable: false,
    transparent: false,
    glyph: '+',
    fg: '#d35400',
    bg: COLOR_BACKGROUND
  },
  open_door: {
    walkable: true,
    transparent: true,
    glyph: '/',
    fg: '#d35400',
    bg: COLOR_BACKGROUND
  }
};
