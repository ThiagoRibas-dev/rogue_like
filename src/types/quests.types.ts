import { z } from 'zod';

/** Zod schema for quest objective parameters. */
export const QuestObjectiveSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['kill', 'gather', 'explore', 'interact', 'talk']),
  targetId: z.string(), // ID of the monster, item, area, or interactable
  requiredAmount: z.number().int().default(1)
});

/** Inferred type representing a single objective of a quest. */
export type QuestObjective = z.infer<typeof QuestObjectiveSchema>;

/** Zod schema representing rewards granted upon quest completion. */
export const QuestRewardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item'), itemId: z.string(), amount: z.number().int().optional() }),
  z.object({ type: z.literal('xp'), amount: z.number().int().optional() }),
  z.object({ type: z.literal('standing'), factionId: z.string(), amount: z.number().int().optional() }),
  z.object({ type: z.literal('event'), eventType: z.string() })
]);

/** Inferred type for a quest reward. */
export type QuestReward = z.infer<typeof QuestRewardSchema>;

/** Zod schema outlining the complete structure of a quest definition. */
export const QuestSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  objectives: z.array(QuestObjectiveSchema),
  logicalOperator: z.enum(['AND', 'OR']).default('AND').optional(),
  rewards: z.array(QuestRewardSchema).optional(),
  isHidden: z.boolean().optional(), // If true, doesn't show in the main journal initially
  autoComplete: z.boolean().optional() // If true, finishes instantly when objectives are met
});

/** Inferred type for a quest definition. */
export type Quest = z.infer<typeof QuestSchema>;
