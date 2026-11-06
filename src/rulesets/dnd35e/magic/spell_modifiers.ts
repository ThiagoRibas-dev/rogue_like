import { matchesEntityTagCondition } from '../../../systems/reaction.system.ts';
import { appendSourcePath } from '../modifiers/provenance.ts';
import { resolveTypedModifiers } from '../modifiers/stacking_engine.ts';
import type { StatModifier } from '../types/dnd35e.types.ts';
import type { DnD35SpellDefinition, DnD35SpellEffectUnit } from '../types/system/spell_system.types.ts';
import type { MetamagicSpellModifiers } from './metamagic_dispel.ts';
import { projectSpellEffectTags } from './spell_effects.ts';

const SUMMONED_CREATURE_STAT_PREFIX = 'summoned_creature:';

/**
 * Resolves the effective Caster Level for a spell by evaluating any `targetStat === 'caster_level'`
 * modifiers on the caster against the spell's projected `effectTags` (e.g. Good/Healing/Fire Domain +1 CL).
 *
 * @param spell The spell definition.
 * @param baseCasterLevel Caster's base class Caster Level.
 * @param casterModifiers Caster's active stat modifiers.
 * @param context Context for tag evaluation.
 * @returns Net effective Caster Level.
 */
export function resolveSpellEffectiveCasterLevel(
  spell: DnD35SpellDefinition,
  baseCasterLevel: number,
  casterModifiers: ReadonlyArray<StatModifier>,
  context?: {
    readonly casterSelfTags?: ReadonlyArray<string>;
    readonly targetTags?: ReadonlyArray<string>;
    readonly metamagic?: MetamagicSpellModifiers;
  }
): number {
  const clMods = casterModifiers.filter((m) => m.targetStat === 'caster_level');
  if (clMods.length === 0) return baseCasterLevel;

  const effectTags = projectSpellEffectTags(spell, context?.metamagic);
  const bonus = resolveTypedModifiers(clMods, {
    selfTags: context?.casterSelfTags,
    targetTags: context?.targetTags,
    effectTags
  });
  return baseCasterLevel + bonus;
}

/**
 * Generically materializes `StatModifier`s projected onto summoned creatures by the caster's active
 * feats, domains, class features, or items (any caster modifier with `targetStat` prefixed by
 * `"summoned_creature:"` whose tag condition matches the spell's projected `effectTags`).
 *
 * @param spell The spell definition.
 * @param unit The `summon` effect unit.
 * @param casterModifiers Caster's active stat modifiers (e.g. from Augment Summoning).
 * @param castId Unique cast session instance ID.
 * @param context Context for tag evaluation.
 * @returns Instantiated modifiers for the summoned creature.
 */
export function materializeSummonedCreatureModifiers(
  spell: DnD35SpellDefinition,
  unit: DnD35SpellEffectUnit,
  casterModifiers: ReadonlyArray<StatModifier>,
  castId: string,
  context?: {
    readonly casterSelfTags?: ReadonlyArray<string>;
    readonly targetTags?: ReadonlyArray<string>;
    readonly metamagic?: MetamagicSpellModifiers;
  }
): ReadonlyArray<StatModifier> {
  if (unit.type !== 'summon') {
    return [];
  }
  const effectTags = projectSpellEffectTags(spell, context?.metamagic);
  const unitBasePath = appendSourcePath(`spell:${spell.id}:${castId}`, `unit:${unit.unitId}`);
  const result: StatModifier[] = [];

  for (const mod of casterModifiers) {
    if (!mod.targetStat.startsWith(SUMMONED_CREATURE_STAT_PREFIX)) continue;
    if (
      mod.condition &&
      !matchesEntityTagCondition(mod.condition, context?.targetTags, effectTags, context?.casterSelfTags)
    ) {
      continue;
    }
    const innerStat = mod.targetStat.slice(SUMMONED_CREATURE_STAT_PREFIX.length);
    const modLineage = mod.sourcePath ?? mod.sourceId;
    result.push({
      ...mod,
      targetStat: innerStat,
      sourcePath: appendSourcePath(unitBasePath, modLineage)
    });
  }

  return result;
}
