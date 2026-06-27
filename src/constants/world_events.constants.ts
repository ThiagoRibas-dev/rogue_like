/**
 * Generic flavor text events that can occur to Areas.
 */
export const AREA_NARRATIVE_EVENTS = [
  'suffered a severe famine.',
  'experienced a sudden economic boom.',
  'was ravaged by a mysterious plague.',
  'discovered a rich vein of precious minerals.',
  'endured a harsh, unnatural winter.'
] as const;

/**
 * Generic flavor text events that can occur to Factions.
 */
export const FACTION_NARRATIVE_EVENTS = [
  'suffered an internal schism.',
  'forged a new dark alliance.',
  'lost a major artifact in a raid.',
  'recruited a swarm of zealots.',
  'faced a violent leadership challenge.'
] as const;
