/**
 * Identifiers for factions in the game.
 */
export const enum FactionId {
  Player = 'player',
  Monster = 'monster',
  Neutral = 'neutral'
}

/**
 * The relationship between two factions.
 */
export const enum FactionRelation {
  Hostile = 'hostile',
  Neutral = 'neutral',
  Friendly = 'friendly'
}

/**
 * Hostility matrix defining how factions interact.
 * Format is HOSTILITY_MATRIX[subjectFaction][targetFaction]
 */
export const HOSTILITY_MATRIX: Readonly<Record<string, Readonly<Record<string, FactionRelation>>>> = {
  [FactionId.Player]: {
    [FactionId.Player]: FactionRelation.Friendly,
    [FactionId.Monster]: FactionRelation.Hostile,
    [FactionId.Neutral]: FactionRelation.Neutral
  },
  [FactionId.Monster]: {
    [FactionId.Player]: FactionRelation.Hostile,
    [FactionId.Monster]: FactionRelation.Neutral,
    [FactionId.Neutral]: FactionRelation.Neutral
  },
  [FactionId.Neutral]: {
    [FactionId.Player]: FactionRelation.Neutral,
    [FactionId.Monster]: FactionRelation.Neutral,
    [FactionId.Neutral]: FactionRelation.Friendly
  }
};
