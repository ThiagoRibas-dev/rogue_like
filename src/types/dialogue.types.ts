import { z } from 'zod';
import { ConditionPredicateSchema, ConsequenceActionSchema } from './trigger.types.ts';

export const DialogueOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  nextNodeId: z.string().optional(), // If undefined, selecting this ends the conversation
  conditions: z.array(ConditionPredicateSchema).optional(),
  consequences: z.array(ConsequenceActionSchema).optional()
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
