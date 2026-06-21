/** Default delay (in game ticks) before propagated knowledge becomes available on NPCs. */
export const DEFAULT_KNOWLEDGE_PROPAGATION_DELAY = 50 as const;

/** Maximum number of pending knowledge items in the global queue. */
export const MAX_PENDING_KNOWLEDGE_QUEUE = 100 as const;

/** Default deflection lines used when an NPC has none configured. */
export const DEFAULT_DEFLECTION_LINES = [
  'I have nothing more to say about that.',
  'That is none of my concern.',
  "I don't know what you're talking about."
];

export const RUMOR_STALE_THRESHOLD = 500;
