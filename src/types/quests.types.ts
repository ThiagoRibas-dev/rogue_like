import { z } from 'zod';

export const QuestObjectiveSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(['kill', 'gather', 'explore', 'interact', 'talk']),
  targetId: z.string(), // ID of the monster, item, area, or interactable
  requiredAmount: z.number().int().default(1)
});

export type QuestObjective = z.infer<typeof QuestObjectiveSchema>;

export const QuestRewardSchema = z.object({
  type: z.enum(['item', 'xp', 'standing', 'event']),
  targetId: z.string().optional(), // ID of item, faction, or event
  amount: z.number().int().optional() // Amount of item, XP, or standing change
});

export type QuestReward = z.infer<typeof QuestRewardSchema>;

export const QuestSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  objectives: z.array(QuestObjectiveSchema),
  rewards: z.array(QuestRewardSchema).optional(),
  isHidden: z.boolean().optional(), // If true, doesn't show in the main journal initially
  autoComplete: z.boolean().optional() // If true, finishes instantly when objectives are met
});

export type Quest = z.infer<typeof QuestSchema>;
