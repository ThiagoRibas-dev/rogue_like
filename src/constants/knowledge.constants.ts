/** Default delay (in game ticks) before propagated knowledge becomes available on NPCs. */
export const DEFAULT_KNOWLEDGE_PROPAGATION_DELAY = 50 as const;

/** Maximum number of pending knowledge items in the global queue. */
export const MAX_PENDING_KNOWLEDGE_QUEUE = 100 as const;

/** Default deflection lines used when an NPC has none configured. */
export const DEFAULT_DEFLECTION_LINES: ReadonlyArray<string> = [
  "I don't know anything about that.",
  'Never heard of it.',
  "You're asking the wrong person.",
  "Can't help you there."
] as const;
