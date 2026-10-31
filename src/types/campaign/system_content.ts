import { z } from 'zod';

/**
 * Zod schema for generic, ruleset-agnostic System Content registries loaded
 * from `public/data/rulesets/<rulesetId>/`. Each ruleset cartridge validates and
 * casts its own system content records via its `RulesetContract` hooks.
 */
export const GenericSystemContentSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

/**
 * Inferred type for generic system content records keyed by system file/domain.
 */
export type GenericSystemContent = z.infer<typeof GenericSystemContentSchema>;
