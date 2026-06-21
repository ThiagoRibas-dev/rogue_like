import { z } from 'zod';
import { ConditionPredicateSchema, ConsequenceActionSchema } from './trigger.types.ts';

export const DialogueConditionSchema = ConditionPredicateSchema;
export type DialogueCondition = z.infer<typeof DialogueConditionSchema>;

export const DialogueEffectSchema = ConsequenceActionSchema;

export type DialogueEffect = z.infer<typeof DialogueEffectSchema>;

export const DialogueOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  nextNodeId: z.string().optional(), // If undefined, selecting this ends the conversation
  conditions: z.array(DialogueConditionSchema).optional(),
  consequences: z.array(DialogueEffectSchema).optional()
});

export type DialogueOption = z.infer<typeof DialogueOptionSchema>;

export const DialogueNodeSchema = z.object({
  id: z.string(),
  text: z.string(),
  dynamicType: z.enum(['ask_about']).optional(),
  onKnownNodeId: z.string().optional(),
  onUnknownNodeId: z.string().optional(),
  options: z.array(DialogueOptionSchema)
});

export type DialogueNode = z.infer<typeof DialogueNodeSchema>;

export const DialogueTreeSchema = z.object({
  id: z.string(),
  startNodeId: z.string(),
  nodes: z.record(z.string(), DialogueNodeSchema)
});

export type DialogueTree = z.infer<typeof DialogueTreeSchema>;
