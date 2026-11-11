import type { DnD35MagicImmunityException, DnD35RaceDefinition } from './types/dnd35e_system.types.ts';

export * from './families/dragon_synthesizer.ts';
export * from './families/elemental_synthesizer.ts';

/** Default damage divisor for golem elemental healing (1 HP per 3 damage). */
const DEFAULT_GOLEM_HEAL_DIVISOR = 3;

/** Default slow duration in rounds for golem elemental slow effects. */
const DEFAULT_GOLEM_SLOW_ROUNDS = 3;

/**
 * Result of evaluating a spell or magic effect against a Golem's magic immunity.
 */
export interface GolemMagicInteractionResult {
  readonly isImmune: boolean;
  readonly specialEffectDescription?: string | undefined;
  readonly healsHpAmount?: number | undefined;
  readonly slowsRounds?: number | undefined;
  readonly breaksHaste?: boolean | undefined;
}

/**
 * Resolves declarative `DnD35MagicImmunityException` entries from a race definition,
 * explicit exception array, or system content dictionary.
 */
function resolveMagicImmunityExceptions(
  golemOrId: string | { readonly magicImmunityExceptions?: ReadonlyArray<DnD35MagicImmunityException> | undefined },
  systemContent?: Record<string, unknown>
): ReadonlyArray<DnD35MagicImmunityException> {
  if (typeof golemOrId !== 'string') {
    return golemOrId.magicImmunityExceptions ?? [];
  }
  const races = systemContent?.['races'] as Record<string, DnD35RaceDefinition> | undefined;
  return races?.[golemOrId]?.magicImmunityExceptions ?? [];
}

/**
 * Evaluates whether a spell affects a construct/Golem via declarative `magicImmunityExceptions` rules
 * defined on its Tier 3 race JSON (`races/<id>.json`).
 *
 * @param golemOrId Race/archetype definition with `magicImmunityExceptions`, or race ID resolved via `systemContent`.
 * @param spellTags Array of spell tags (e.g. `['fire', 'electricity', 'acid', 'cold']`).
 * @param spellDamageAmount Potential incoming magic damage before immunity check.
 * @param systemContent Optional system content dictionary when `golemOrId` is passed as a string ID.
 * @returns `GolemMagicInteractionResult`.
 */
export function evaluateGolemMagicInteraction(
  golemOrId: string | { readonly magicImmunityExceptions?: ReadonlyArray<DnD35MagicImmunityException> | undefined },
  spellTags: ReadonlyArray<string>,
  spellDamageAmount = 0,
  systemContent?: Record<string, unknown>
): GolemMagicInteractionResult {
  const exceptions = resolveMagicImmunityExceptions(golemOrId, systemContent);
  for (const rule of exceptions) {
    const matches = rule.triggerTagsAny.some((tag) => spellTags.includes(tag));
    if (!matches) continue;

    switch (rule.effectType) {
      case 'heal_per_damage_divisor': {
        const divisor = rule.damageDivisor ?? DEFAULT_GOLEM_HEAL_DIVISOR;
        const healed = Math.max(1, Math.floor(spellDamageAmount / divisor));
        return {
          isImmune: true,
          healsHpAmount: healed,
          ...(rule.breaksHaste !== undefined ? { breaksHaste: rule.breaksHaste } : {}),
          specialEffectDescription: rule.description
        };
      }
      case 'slow': {
        const slowRounds = rule.slowRounds ?? DEFAULT_GOLEM_SLOW_ROUNDS;
        return {
          isImmune: true,
          slowsRounds: slowRounds,
          specialEffectDescription: rule.description
        };
      }
      case 'bypass_immunity': {
        return {
          isImmune: false,
          specialEffectDescription: rule.description
        };
      }
    }
  }

  return { isImmune: true };
}
