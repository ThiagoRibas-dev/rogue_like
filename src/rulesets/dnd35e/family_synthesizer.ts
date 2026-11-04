export * from './families/dragon_synthesizer.ts';
export * from './families/elemental_synthesizer.ts';

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
 * Evaluates whether a spell affects a specific Golem type (SRD Golem Magic Immunity).
 * - Flesh Golem: Cold/Fire slows 2d6 rounds; Electricity breaks slow and heals 1 HP per 3 damage.
 * - Clay Golem: Acid heals 1 HP per 3 damage; Disintegrate/Earthquake bypasses.
 * - Stone Golem: Stone to Flesh bypasses; Rock to Mud slows 1 round.
 * - Iron Golem: Fire heals 1 HP per 3 damage; Rusting Grasp affects normally; Electricity slows 3 rounds.
 *
 * @param golemArchetypeId Golem race/archetype ID ('flesh_golem', 'clay_golem', 'stone_golem', 'iron_golem').
 * @param spellTags Array of spell tags (e.g. ['fire', 'electricity', 'acid', 'cold', 'earth']).
 * @param spellDamageAmount Potential incoming magic damage before immunity check.
 * @returns GolemMagicInteractionResult.
 */
export function evaluateGolemMagicInteraction(
  golemArchetypeId: string,
  spellTags: ReadonlyArray<string>,
  spellDamageAmount = 0
): GolemMagicInteractionResult {
  if (golemArchetypeId === 'flesh_golem') {
    if (spellTags.includes('electricity')) {
      const healed = Math.max(1, Math.floor(spellDamageAmount / 3));
      return {
        isImmune: true,
        healsHpAmount: healed,
        breaksHaste: false,
        specialEffectDescription: `Electricity breaks any active slow and repairs ${healed} HP.`
      };
    }
    if (spellTags.includes('fire') || spellTags.includes('cold')) {
      return {
        isImmune: true,
        slowsRounds: 3,
        specialEffectDescription: 'Magical fire or cold slows the Flesh Golem for 3 rounds.'
      };
    }
    return { isImmune: true };
  }

  if (golemArchetypeId === 'iron_golem') {
    if (spellTags.includes('fire')) {
      const healed = Math.max(1, Math.floor(spellDamageAmount / 3));
      return {
        isImmune: true,
        healsHpAmount: healed,
        specialEffectDescription: `Magical fire repairs ${healed} HP.`
      };
    }
    if (spellTags.includes('electricity')) {
      return {
        isImmune: true,
        slowsRounds: 3,
        specialEffectDescription: 'Magical electricity slows the Iron Golem for 3 rounds.'
      };
    }
    if (spellTags.includes('rust')) {
      return { isImmune: false, specialEffectDescription: 'Rusting attacks affect the Iron Golem normally.' };
    }
    return { isImmune: true };
  }

  if (golemArchetypeId === 'clay_golem') {
    if (spellTags.includes('acid')) {
      const healed = Math.max(1, Math.floor(spellDamageAmount / 3));
      return {
        isImmune: true,
        healsHpAmount: healed,
        specialEffectDescription: `Magical acid repairs ${healed} HP.`
      };
    }
    if (spellTags.includes('disintegrate') || spellTags.includes('earthquake')) {
      return { isImmune: false, specialEffectDescription: 'Disintegrate or Earthquake affects Clay Golem normally.' };
    }
    return { isImmune: true };
  }

  if (golemArchetypeId === 'stone_golem') {
    if (spellTags.includes('stone_to_flesh') || spellTags.includes('transmute')) {
      return { isImmune: false, specialEffectDescription: 'Transmutation effects affect Stone Golem normally.' };
    }
    return { isImmune: true };
  }

  return { isImmune: true };
}
