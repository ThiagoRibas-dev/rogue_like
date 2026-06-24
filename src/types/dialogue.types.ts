import { z } from 'zod';
import { ConditionPredicateSchema, ConsequenceActionSchema } from './trigger.types.ts';

/** Zod schema for gating dialogue options/trees based on conditions. */
export const DialogueConditionSchema = ConditionPredicateSchema;
/** Inferred type for a dialogue condition predicate. */
export type DialogueCondition = z.infer<typeof DialogueConditionSchema>;

/** Zod schema representing consequence actions triggered by dialogue choices. */
export const DialogueEffectSchema = ConsequenceActionSchema;

/** Inferred type for dialogue effects/consequences. */
export type DialogueEffect = z.infer<typeof DialogueEffectSchema>;

/** Zod schema defining a single option/response inside a dialogue node. */
export const DialogueOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
  nextNodeId: z.string().optional(), // If undefined, selecting this ends the conversation
  conditions: z.array(DialogueConditionSchema).optional(),
  consequences: z.array(DialogueEffectSchema).optional()
});

/** Inferred type representing a choice/option in a dialogue node. */
export type DialogueOption = z.infer<typeof DialogueOptionSchema>;

/** Zod schema outlining dialogue nodes comprising text responses and branching choices. */
export const DialogueNodeSchema = z.object({
  id: z.string(),
  text: z.string(),
  dynamicType: z.enum(['ask_about', 'gossip', 'trade', 'inject_rumor']).optional(),
  injectRumorId: z.string().optional(),
  onKnownNodeId: z.string().optional(),
  onUnknownNodeId: z.string().optional(),
  options: z.array(DialogueOptionSchema)
});

/** Inferred type representing an active node in a dialogue tree. */
export type DialogueNode = z.infer<typeof DialogueNodeSchema>;

/** Zod schema defining complete branching dialogue trees. */
export const DialogueTreeSchema = z.object({
  id: z.string(),
  startNodeId: z.string(),
  nodes: z.record(z.string(), DialogueNodeSchema)
});

/** Inferred type for a dialogue tree. */
export type DialogueTree = z.infer<typeof DialogueTreeSchema>;
