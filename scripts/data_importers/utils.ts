import { NETHACK_COLOR_MAP, INCURSION_COLOR_MAP } from './constants.ts';

/** Converts "Giant Ant" to "giant_ant" */
export function toSnakeCase(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Prefixes the ID with the source game */
export function prefixId(source: string, rawId: string): string {
  return `${source}_${toSnakeCase(rawId)}`;
}

/** Converts dice notation "1d6" to average value */
export function avgDice(dice: string): number {
  const match = dice.match(/(\d+)d(\d+)(?:([+-]\d+))?/i);
  if (!match) return parseInt(dice) || 0;
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;
  return (count * (sides + 1)) / 2 + modifier;
}

/** Clamps a value between a min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** NetHack AC (10 is naked, lower is better) to Engine Defense (0 is naked, higher is better) */
export function nethackAcToDefense(ac: number): number {
  return clamp(10 - ac, 0, 30);
}

/** NetHack Speed (12 is normal) to Engine Speed (100 is normal) */
export function nethackSpeedToEngine(speed: number): number {
  // Assuming 12 in NetHack is approximately 100 in our engine
  return clamp(Math.round((speed * 100) / 12), 50, 200);
}

/** Maps a color string to hex */
export function mapColor(source: 'nethack' | 'incursion', rawColor: string): string {
  if (source === 'nethack') {
    return NETHACK_COLOR_MAP[rawColor] || '#C0C0C0';
  } else {
    return INCURSION_COLOR_MAP[rawColor.toLowerCase()] || '#C0C0C0';
  }
}
