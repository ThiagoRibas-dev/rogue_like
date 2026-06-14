import { z } from 'zod';
import type { GameState } from './game-state.types.ts';
import type { GameEvent } from './events.types.ts';
import type * as ROT from 'rot-js';

export const ConditionPredicateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('is_player') }),
  z.object({
    type: z.literal('has_agreement')
  }),
  z.object({
    type: z.literal('faction_standing'),
    target: z.string(),
    operator: z.enum(['>=', '<=', '==']),
    value: z.number()
  }),
  z.object({
    type: z.literal('has_fact'),
    target: z.string()
  }),
  z.object({
    type: z.literal('not_has_fact'),
    target: z.string()
  }),
  z.object({
    type: z.literal('quest_status'),
    target: z.string(),
    operator: z.enum(['>=', '<=', '==']),
    value: z.number()
  })
]);

import type { EntityId } from './game-state.types.ts';

type InjectedContext = {
  _npcEntityId?: EntityId;
  _playerEntityId?: EntityId;
  entityId?: EntityId;
};

export type ConditionPredicate = z.infer<typeof ConditionPredicateSchema> & InjectedContext;

export const ConsequenceActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run_script'), scriptCode: z.string() }),
  z.object({ type: z.literal('damage'), targetId: z.string(), amount: z.number() }),
  z.object({ type: z.literal('spawn_clue'), message: z.string().optional() }),
  z.object({ type: z.literal('grant_quest'), targetId: z.string() }),
  z.object({ type: z.literal('complete_quest'), targetId: z.string() }),
  z.object({ type: z.literal('change_standing'), targetId: z.string(), amount: z.number() }),
  z.object({
    type: z.literal('emit_event'),
    eventType: z.string(),
    payload: z.record(z.string(), z.unknown()).optional()
  })
]);

export type ConsequenceAction = z.infer<typeof ConsequenceActionSchema> & InjectedContext;

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
