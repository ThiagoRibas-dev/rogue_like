import { z } from 'zod';

export const DialogueConditionSchema = z.object({
  type: z.enum(['faction_standing', 'has_fact', 'not_has_fact', 'has_trait', 'has_item', 'quest_status']),
  target: z.string(), // e.g., 'goblins', 'health_potion', 'saw_murder'
  operator: z.enum(['>=', '<=', '==']).optional(),
  value: z.number().optional()
});

export type DialogueCondition = z.infer<typeof DialogueConditionSchema>;

export const DialogueActionSchema = z.object({
  type: z.enum([
    'grant_quest',
    'complete_quest',
    'give_item',
    'take_item',
    'change_standing',
    'combat',
    'emit_event',
    'grant_dynamic_quest'
  ]),
  targetId: z.string(), // ID of quest, item, faction, or event type
  amount: z.number().optional(), // For items or standing change
  payload: z.record(z.string(), z.unknown()).optional() // For emit_event custom payloads
});

export type DialogueAction = z.infer<typeof DialogueActionSchema>;

export const DialogueOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  nextNodeId: z.string().optional(), // If undefined, selecting this ends the conversation
  conditions: z.array(DialogueConditionSchema).optional(),
  actions: z.array(DialogueActionSchema).optional()
});

export type DialogueOption = z.infer<typeof DialogueOptionSchema>;

export const DialogueNodeSchema = z.object({
  id: z.string(),
  text: z.string(),
  options: z.array(DialogueOptionSchema)
});

export type DialogueNode = z.infer<typeof DialogueNodeSchema>;

export const DialogueTreeSchema = z.object({
  id: z.string(),
  startNodeId: z.string(),
  nodes: z.record(z.string(), DialogueNodeSchema)
});

export type DialogueTree = z.infer<typeof DialogueTreeSchema>;
