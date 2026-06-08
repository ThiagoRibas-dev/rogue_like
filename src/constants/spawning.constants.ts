import {
  COLOR_PLAYER_FG,
  COLOR_ORC_FG,
  COLOR_TROLL_FG,
  COLOR_GOBLIN_FG,
  COLOR_SHAMAN_FG,
  COLOR_TRANSPARENT
} from './colors.constants.ts';
import { FactionId } from './faction.constants.ts';
import { AIProfileId } from './ai.constants.ts';

export const MAX_MONSTERS_PER_ROOM = 2;

export const SPAWN_WEIGHTS: Readonly<Record<string, number>> = {
  orc: 60,
  goblin_archer: 30,
  orc_shaman: 10,
  troll: 10
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
    readonly xpGiven?: number;
  };
  readonly ai?: {
    readonly profileId: string;
    readonly aggroRadius?: number;
    readonly wanders?: boolean;
  };
  /** Inventory configuration — only required for player-type entities. */
  readonly inventoryConfig?: {
    readonly baseCapacity: number;
  };
  readonly faction?: string;
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
    inventoryConfig: { baseCapacity: 10 },
    faction: FactionId.Player
  },
  orc: {
    id: 'orc',
    name: 'Orc',
    glyph: 'o',
    fg: COLOR_ORC_FG,
    bg: COLOR_TRANSPARENT,
    isActor: true,
    speed: 100,
    fighter: { maxHp: 10, attack: 3, defense: 0, xpGiven: 50 },
    ai: { profileId: AIProfileId.MeleeAggressive, aggroRadius: 5, wanders: true },
    faction: FactionId.Monster
  },
  troll: {
    id: 'troll',
    name: 'Troll',
    glyph: 'T',
    fg: COLOR_TROLL_FG,
    bg: COLOR_TRANSPARENT,
    isActor: true,
    speed: 80,
    fighter: { maxHp: 16, attack: 4, defense: 1, xpGiven: 150 },
    ai: { profileId: AIProfileId.MeleeAggressive, aggroRadius: 4, wanders: false },
    faction: FactionId.Monster
  },
  goblin_archer: {
    id: 'goblin_archer',
    name: 'Goblin Archer',
    glyph: 'g',
    fg: COLOR_GOBLIN_FG,
    bg: COLOR_TRANSPARENT,
    isActor: true,
    speed: 110,
    fighter: { maxHp: 8, attack: 2, defense: 0, xpGiven: 40 },
    ai: { profileId: AIProfileId.RangedArcher, aggroRadius: 6, wanders: true },
    faction: FactionId.Monster
  },
  orc_shaman: {
    id: 'orc_shaman',
    name: 'Orc Shaman',
    glyph: 's',
    fg: COLOR_SHAMAN_FG,
    bg: COLOR_TRANSPARENT,
    isActor: true,
    speed: 90,
    fighter: { maxHp: 12, attack: 2, defense: 0, xpGiven: 100 },
    ai: { profileId: AIProfileId.CasterMage, aggroRadius: 8, wanders: true },
    faction: FactionId.Monster
  }
};
