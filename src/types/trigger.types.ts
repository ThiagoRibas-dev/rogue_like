import { z } from 'zod';
import type { GameState } from './game-state.types.ts';
import type { GameEvent } from './events.types.ts';
import type * as ROT from 'rot-js';

export const ConditionPredicateSchema = z.object({
  type: z.string(),
  params: z.record(z.string(), z.unknown())
});

export type ConditionPredicate = z.infer<typeof ConditionPredicateSchema>;

export const ConsequenceActionSchema = z.object({
  type: z.string(),
  params: z.record(z.string(), z.unknown())
});

export type ConsequenceAction = z.infer<typeof ConsequenceActionSchema>;

export const TriggerDefinitionSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  conditions: z.array(ConditionPredicateSchema),
  consequences: z.array(ConsequenceActionSchema)
});

export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>;

/**
 * The signature for the scripting sandbox used by the "run_script" consequence.
 * Scripts cannot directly mutate GameState; they return pure ConsequenceActions.
 */
export type RunScriptConsequenceFn = (
  scriptCode: string,
  context: { event: GameEvent; state: Readonly<GameState>; rng: typeof ROT.RNG }
) => ConsequenceAction[];
