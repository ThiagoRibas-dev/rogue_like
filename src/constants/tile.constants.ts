import { COLOR_BACKGROUND, COLOR_FLOOR_FG, COLOR_WALL_FG } from './colors.constants.ts';
import { GLYPH_FLOOR, GLYPH_WALL } from './glyphs.constants.ts';

/**
 * Definition of properties and visual layout of a specific tile type.
 */
export interface TileDefinition {
  readonly walkable: boolean;
  readonly transparent: boolean;
  readonly glyph: string;
  readonly fg: string;
  readonly bg: string;
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
    bg: COLOR_BACKGROUND,
  },
  stone_wall: {
    walkable: false,
    transparent: false,
    glyph: GLYPH_WALL,
    fg: COLOR_WALL_FG,
    bg: COLOR_BACKGROUND,
  },
};
