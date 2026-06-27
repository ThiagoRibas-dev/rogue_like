import { z } from 'zod';
import type { GameState } from './game-state.types.ts';
import type { GameEvent } from './events.types.ts';
import type * as ROT from 'rot-js';

/** Zod schema for declarative condition predicates evaluated by the trigger system. */
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
  }),
  z.object({
    type: z.literal('has_item'),
    itemId: z.string(),
    amount: z.number().int().positive().default(1)
  }),
  z.object({
    type: z.literal('personality_facet'),
    facet: z.string(),
    operator: z.enum(['>=', '<=', '==']),
    value: z.number()
  }),
  z.object({
    type: z.literal('stress_threshold'),
    operator: z.enum(['>=', '<=', '==']),
    value: z.number()
  }),
  z.object({
    type: z.literal('has_memory'),
    target: z.string()
  }),
  z.object({
    type: z.literal('has_grudge'),
    targetId: z.string()
  }),
  z.object({
    type: z.literal('pis'),
    operator: z.enum(['>=', '<=', '==']),
    value: z.number()
  }),
  z.object({
    type: z.literal('has_knowledge'),
    knowledgeId: z.string()
  }),
  z.object({
    type: z.literal('interaction_count'),
    interactionType: z.enum(['talk', 'trade', 'barter', 'intimidate', 'persuade', 'help', 'betray']),
    operator: z.enum(['>=', '<=', '==']),
    value: z.number()
  }),
  z.object({
    type: z.literal('patience_below'),
    value: z.number()
  }),
  z.object({
    type: z.literal('is_annoyed')
  }),
  z.object({
    type: z.literal('is_grateful')
  }),
  z.object({
    type: z.literal('relationship_axis'),
    target: z.string().optional(),
    axis: z.string(),
    operator: z.enum(['>=', '<=', '==']),
    value: z.number().int()
  })
]);

import type { EntityId } from './game-state.types.ts';

type InjectedContext = {
  _npcEntityId?: EntityId | undefined;
  _playerEntityId?: EntityId | undefined;
  entityId?: EntityId | undefined;
};

/** Inferred type representing an evaluated condition predicate with potential runtime contexts. */
export type ConditionPredicate = z.infer<typeof ConditionPredicateSchema> & InjectedContext;

/** Zod schema for consequence actions executed when triggers resolve successfully. */
export const ConsequenceActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('damage_area'),
    radius: z.number().int().nonnegative().optional(),
    amount: z.number().int().optional(),
    tags: z.array(z.string()).optional(),
    targetId: z.string().optional()
  }),
  z.object({
    type: z.literal('spawn_entity'),
    entityTemplateId: z.string(),
    targetId: z.string().optional()
  }),
  z.object({
    type: z.literal('apply_status'),
    statusId: z.string(),
    duration: z.number().int().positive().optional(),
    targetId: z.string().optional()
  }),
  z.object({
    type: z.literal('remove_entity'),
    targetId: z.string().optional()
  }),
  z.object({ type: z.literal('run_script'), scriptCode: z.string() }),
  z.object({ type: z.literal('damage'), targetId: z.string(), amount: z.number() }),
  z.object({ type: z.literal('spawn_clue'), message: z.string().optional() }),
  z.object({ type: z.literal('grant_quest'), targetId: z.string().optional(), questId: z.string().optional() }),
  z.object({ type: z.literal('complete_quest'), targetId: z.string().optional(), questId: z.string().optional() }),
  z.object({ type: z.literal('modify_standing'), factionId: z.string(), amount: z.number() }),
  z.object({ type: z.literal('open_barter'), targetId: z.string().optional() }),
  z.object({ type: z.literal('trigger_service'), serviceId: z.string(), targetId: z.string().optional() }),
  z.object({
    type: z.literal('emit_event'),
    eventType: z.string(),
    payload: z.record(z.string(), z.unknown()).optional()
  }),
  z.object({
    type: z.literal('change_area'),
    targetAreaId: z.string().optional(),
    targetX: z.number().int().nonnegative().optional(),
    targetY: z.number().int().nonnegative().optional()
  }),
  z.object({
    type: z.literal('apply_item_effect'),
    targetId: z.string().optional() // "target" means who receives the effect. If omitted, applies to source
  }),
  z.object({
    type: z.literal('consume_item'),
    targetId: z.string().optional() // "target" is the item to consume
  }),
  z.object({
    type: z.literal('spill_inventory'),
    targetId: z.string().optional() // Optional target entity. If omitted, applies to the reaction target.
  }),
  z.object({
    type: z.literal('modify_tags'),
    add: z.array(z.string()).optional(),
    remove: z.array(z.string()).optional(),
    targetId: z.string().optional()
  }),
  z.object({
    type: z.literal('change_glyph'),
    glyph: z.string(),
    targetId: z.string().optional()
  }),
  z.object({
    type: z.literal('set_lock_state'),
    locked: z.boolean(),
    targetId: z.string().optional()
  }),
  z.object({
    type: z.literal('change_intents'),
    intents: z.array(z.string()),
    targetId: z.string().optional()
  }),
  z.object({
    type: z.literal('apply_coating'),
    statusId: z.string(),
    charges: z.number().int().positive(),
    duration: z.number().int().positive().default(10),
    targetId: z.string().optional()
  }),
  z.object({
    type: z.literal('set_fact'),
    target: z.string()
  }),
  z.object({
    type: z.literal('change_faction'),
    targetId: z.string().optional(),
    factionId: z.string()
  }),
  z.object({
    type: z.literal('force_say'),
    message: z.string(),
    targetId: z.string().optional()
  }),
  z.object({
    type: z.literal('record_interaction'),
    interactionType: z.enum(['talk', 'trade', 'barter', 'intimidate', 'persuade', 'help', 'betray'])
  }),
  z.object({
    type: z.literal('set_patience'),
    value: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal('modify_knowledge'),
    action: z.enum(['add', 'remove']),
    knowledgeId: z.string(),
    knowledgeType: z.enum(['rumor', 'location', 'weakness', 'secret']).optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional()
  }),
  z.object({
    type: z.literal('set_social_state'),
    state: z.enum(['annoyed', 'grateful']),
    duration: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal('transfer_knowledge'),
    knowledgeId: z.string(),
    addToInvestigationBoard: z.boolean().default(false)
  }),
  z.object({
    type: z.literal('random_choice'),
    choices: z.array(z.array(z.any())),
    weights: z.array(z.number()).optional()
  }),
  z.object({
    type: z.literal('modify_relationship_axis'),
    axis: z.string(),
    amount: z.number().int(),
    targetId: z.string().optional()
  })
]);

/** Inferred type representing an executable consequence action with potential runtime contexts. */
export type ConsequenceAction = z.infer<typeof ConsequenceActionSchema> & InjectedContext;

/** Zod schema for pacing rules on narrative events. */
export const PacingSchema = z.object({
  dramaCost: z.number().int().nonnegative().optional(),
  domain: z.string().optional(),
  cooldownId: z.string().optional(),
  cooldownTurns: z.number().int().positive().optional(),
  requiresSafeContext: z.boolean().default(false)
});

/** Inferred type for trigger pacing settings. */
export type PacingSettings = z.infer<typeof PacingSchema>;

/** Zod schema for foreshadowing prerequisite rules. */
export const ForeshadowingSchema = z.object({
  requiredKnowledgeTags: z.array(z.string()).optional()
});

/** Inferred type for trigger foreshadowing settings. */
export type ForeshadowingSettings = z.infer<typeof ForeshadowingSchema>;

/** Zod schema defining when-if-then event trigger rules. */
export const TriggerDefinitionSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  conditions: z.array(ConditionPredicateSchema),
  consequences: z.array(ConsequenceActionSchema),
  pacing: PacingSchema.optional(),
  foreshadowing: ForeshadowingSchema.optional(),
  fallbackConsequences: z.array(ConsequenceActionSchema).optional()
});

/** Inferred type for a trigger rule definition. */
export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>;

/**
 * The signature for the scripting sandbox used by the "run_script" consequence.
 * Scripts cannot directly mutate GameState; they return pure ConsequenceActions.
 */
export type RunScriptConsequenceFn = (
  scriptCode: string,
  context: { event: GameEvent; state: Readonly<GameState>; rng: typeof ROT.RNG }
) => ConsequenceAction[];

/** Zod schema for dynamic trigger templates */
export const TriggerTemplateSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  conditions: z.array(z.any()), // Allows strings (placeholders) + objects
  consequences: z.array(z.any()), // Allows strings (placeholders) + objects
  expectedVariables: z.array(z.string()).optional(),
  pacing: PacingSchema.optional(),
  foreshadowing: ForeshadowingSchema.optional(),
  fallbackConsequences: z.array(z.any()).optional()
});

/** Inferred type for a trigger template definition */
export type TriggerTemplate = z.infer<typeof TriggerTemplateSchema>;
