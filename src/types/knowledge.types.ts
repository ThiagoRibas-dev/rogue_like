/**
 * A pending knowledge propagation item waiting for its delay to expire.
 * Stored on GameState.pendingKnowledge.
 */
export interface PendingKnowledgePropagation {
  readonly ruleId: string;
  readonly knowledgeItem: {
    readonly id: string;
    readonly type: 'rumor' | 'location' | 'weakness' | 'secret';
    readonly description: string;
    readonly tags: ReadonlyArray<string>;
  };
  /** The area where the event occurred (for proximity filtering). */
  readonly sourceAreaId: string;
  /** Remaining ticks before this knowledge is distributed. */
  readonly remainingDelay: number;
  /** The areas that have already received this knowledge. */
  readonly deliveredAreas: ReadonlyArray<string>;
}
