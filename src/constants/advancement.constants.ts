/**
 * Defines the XP requirements and stat bonuses for leveling up.
 */
export interface AdvancementLevel {
  readonly level: number;
  readonly requiredXp: number;
  readonly hpGain: number;
  readonly attackGain: number;
  readonly defenseGain: number;
}

/**
 * The data-driven XP table.
 * Level 1 is the starting level (requires 0 XP).
 * The array index generally aligns with level - 1, but we use an array of objects
 * to be explicit and allow easy JSON serialization later.
 */
export const ADVANCEMENT_TABLE: ReadonlyArray<AdvancementLevel> = [
  { level: 1, requiredXp: 0, hpGain: 0, attackGain: 0, defenseGain: 0 },
  { level: 2, requiredXp: 100, hpGain: 5, attackGain: 1, defenseGain: 0 },
  { level: 3, requiredXp: 300, hpGain: 5, attackGain: 1, defenseGain: 1 },
  { level: 4, requiredXp: 600, hpGain: 5, attackGain: 2, defenseGain: 0 },
  { level: 5, requiredXp: 1000, hpGain: 10, attackGain: 2, defenseGain: 1 },
  { level: 6, requiredXp: 1500, hpGain: 10, attackGain: 2, defenseGain: 1 },
  { level: 7, requiredXp: 2100, hpGain: 10, attackGain: 3, defenseGain: 2 },
  { level: 8, requiredXp: 2800, hpGain: 15, attackGain: 3, defenseGain: 2 },
  { level: 9, requiredXp: 3600, hpGain: 15, attackGain: 4, defenseGain: 2 },
  { level: 10, requiredXp: 4500, hpGain: 20, attackGain: 5, defenseGain: 3 }
];

/**
 * Helper to get the advancement definition for a specific level.
 * @param level The target level.
 * @returns The AdvancementLevel, or undefined if the max level is exceeded.
 */
export function getAdvancementForLevel(level: number): AdvancementLevel | undefined {
  return ADVANCEMENT_TABLE.find((a) => a.level === level);
}
