/**
 * Declarative definition of a status effect.
 * Defines how it modifies stats, damages per turn, and affects behavior.
 */
export interface StatusEffectDefinition {
  /** Unique string ID matching the effectId in ActiveStatusEffect. */
  readonly id: string;
  /** Display name for the UI. */
  readonly name: string;
  /** Color for UI rendering. */
  readonly color: string;
  /** Stat modifiers applied dynamically during getEffectiveStats(). */
  readonly statModifiers?: {
    readonly attack?: number;
    readonly defense?: number;
    readonly maxHp?: number;
    readonly speed?: number;
  };
  /** HP lost per turn while active. */
  readonly perTurnDamage?: number;
  /** HP gained per turn while active. */
  readonly perTurnHeal?: number;
  /** Behavioral flags checked by the game loop and AI systems. */
  readonly flags?: {
    /** If true, the entity skips its turn entirely. Used by Stun, Freeze, Sleep, etc. */
    readonly skipTurn?: boolean;
    /** If true, the entity's AI is overridden to move in a random direction. */
    readonly confused?: boolean;
  };
}

/**
 * The global Status Effects Registry.
 */
export const STATUS_EFFECTS: Readonly<Record<string, StatusEffectDefinition>> = {
  poison: {
    id: 'poison',
    name: 'Poisoned',
    color: '#00d2d3', // Teal/green
    perTurnDamage: 2
  },
  haste: {
    id: 'haste',
    name: 'Hasted',
    color: '#feca57', // Yellow/gold
    statModifiers: {
      speed: 50
    }
  },
  weakness: {
    id: 'weakness',
    name: 'Weakened',
    color: '#ff9f43', // Orange
    statModifiers: {
      attack: -5
    }
  },
  stun: {
    id: 'stun',
    name: 'Stunned',
    color: '#c8d6e5', // Light gray
    flags: {
      skipTurn: true
    }
  },
  confusion: {
    id: 'confusion',
    name: 'Confused',
    color: '#f368e0', // Pink/magenta
    flags: {
      confused: true
    }
  }
} satisfies Record<string, StatusEffectDefinition>;
