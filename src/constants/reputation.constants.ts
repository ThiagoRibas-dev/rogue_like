/** Default standing penalty applied when an actor commits a witnessed non-lethal attack on a non-hostile faction member. */
export const DEFAULT_ATTACK_STANDING_PENALTY = 5;

/** Default standing penalty applied when an actor commits a witnessed kill of a non-hostile faction member. */
export const DEFAULT_KILL_STANDING_PENALTY = 25;

/** Default standing threshold at or below which a faction treats an actor as hostile. */
export const DEFAULT_STANDING_HOSTILE_THRESHOLD = -50;

/** Default standing threshold at or above which a faction treats an actor as friendly. */
export const DEFAULT_STANDING_FRIENDLY_THRESHOLD = 50;

/** Default Chebyshev radius (tiles) within which awake non-hostile actors can witness a crime. */
export const DEFAULT_WITNESS_RADIUS_TILES = 10;

/** Default suspicion added to an active `IdentityMaskComponent` when a disguised actor commits a witnessed attack. */
export const DEFAULT_DISGUISE_ATTACK_SUSPICION_GAIN = 50;

/** Default suspicion added to an active `IdentityMaskComponent` when a disguised actor commits a witnessed kill. */
export const DEFAULT_DISGUISE_KILL_SUSPICION_GAIN = 100;

/** Default allied-faction standing ripple multiplier (`0` = disabled unless opted in via `rules.reputation`). */
export const DEFAULT_ALLIED_FACTION_RIPPLE_RATIO = 0;

/** Lower bound clamping per-faction standing values. */
export const MIN_FACTION_STANDING = -1000;

/** Upper bound clamping per-faction standing values. */
export const MAX_FACTION_STANDING = 1000;
