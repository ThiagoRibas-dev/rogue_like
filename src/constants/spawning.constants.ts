import { COLOR_PLAYER_FG, COLOR_ORC_FG, COLOR_TROLL_FG, COLOR_TRANSPARENT } from './colors.constants.ts';
import { AIBehavior } from '../types/components.types.ts';

export const MAX_MONSTERS_PER_ROOM = 2;

export const SPAWN_WEIGHTS: Readonly<Record<string, number>> = {
  orc: 80,
  troll: 20
};

export interface EntityTemplate {
  readonly id: string;
  readonly name: string;
  readonly glyph: string;
  readonly fg: string;
  readonly bg: string;
  readonly isActor: boolean;
  readonly speed?: number;
  readonly fighter?: {
    readonly maxHp: number;
    readonly attack: number;
    readonly defense: number;
  };
  readonly ai?: {
    readonly behavior: AIBehavior;
    readonly aggroRadius?: number;
    readonly wanders?: boolean;
  };
  /** Inventory configuration — only required for player-type entities. */
  readonly inventoryConfig?: {
    readonly baseCapacity: number;
  };
}

export const ENTITY_TEMPLATES: Readonly<Record<string, EntityTemplate>> = {
  player: {
    id: 'player',
    name: 'Player',
    glyph: '@',
    fg: COLOR_PLAYER_FG,
    bg: COLOR_TRANSPARENT,
    isActor: true,
    speed: 100,
    fighter: { maxHp: 30, attack: 5, defense: 2 },
    inventoryConfig: { baseCapacity: 10 }
  },
  orc: {
    id: 'orc',
    name: 'Orc',
    glyph: 'o',
    fg: COLOR_ORC_FG,
    bg: COLOR_TRANSPARENT,
    isActor: true,
    speed: 100,
    fighter: { maxHp: 10, attack: 3, defense: 0 },
    ai: { behavior: AIBehavior.BasicMelee, aggroRadius: 5, wanders: true }
  },
  troll: {
    id: 'troll',
    name: 'Troll',
    glyph: 'T',
    fg: COLOR_TROLL_FG,
    bg: COLOR_TRANSPARENT,
    isActor: true,
    speed: 80,
    fighter: { maxHp: 16, attack: 4, defense: 1 },
    ai: { behavior: AIBehavior.BasicMelee, aggroRadius: 4, wanders: false }
  }
};
