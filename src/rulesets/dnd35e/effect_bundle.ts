import type {
  DnD35ActivatedAbilityDescriptor,
  DnD35DeclarativeModifier,
  DnD35EffectBundle,
  DnD35FeatDefinition,
  DnD35FeatGrantDescriptor,
  DnD35RuleOverrideEntry
} from './types/dnd35e_system.types.ts';
import { appendSourcePath } from './modifiers.ts';
import type { StatModifier, StatModifierCondition } from './types/dnd35e.types.ts';

function mergeTags(a?: ReadonlyArray<string>, b?: ReadonlyArray<string>): string[] | undefined {
  if (!a && !b) return undefined;
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

/** Result of evaluating a universal `DnD35EffectBundle`. */
export interface EvaluatedEffectBundleResult {
  readonly isActive: boolean;
  readonly statModifiers: ReadonlyArray<StatModifier>;
  readonly ruleOverrides: ReadonlyArray<DnD35RuleOverrideEntry>;
  readonly grantedTags: ReadonlyArray<string>;
  readonly grantedFeats: ReadonlyArray<string>;
  readonly virtualFeatGrants: ReadonlyArray<DnD35FeatGrantDescriptor>;
  readonly classSkillsAdded: ReadonlyArray<string>;
  readonly immunities: ReadonlyArray<string>;
  readonly vulnerabilities: ReadonlyArray<string>;
  readonly activatedAbilities: ReadonlyArray<DnD35ActivatedAbilityDescriptor>;
}

/**
 * Checks whether an Effect Bundle's `activationCondition` passes against an actor's active semantic self-tags.
 *
 * @param activationCondition Optional tag condition on the bundle or class feature.
 * @param activeSelfTags Optional array of active semantic tags on the actor.
 * @returns True if the bundle is active.
 */
export function isActivationConditionMet(
  activationCondition:
    | {
        readonly selfTagsAll?: ReadonlyArray<string> | undefined;
        readonly selfTagsAny?: ReadonlyArray<string> | undefined;
        readonly selfTagsNone?: ReadonlyArray<string> | undefined;
      }
    | undefined,
  activeSelfTags?: ReadonlyArray<string>
): boolean {
  if (!activationCondition || !activeSelfTags) return true;
  if (activationCondition.selfTagsAll && activationCondition.selfTagsAll.length > 0) {
    for (const reqTag of activationCondition.selfTagsAll) {
      if (!activeSelfTags.includes(reqTag)) return false;
    }
  }
  if (activationCondition.selfTagsAny && activationCondition.selfTagsAny.length > 0) {
    if (!activationCondition.selfTagsAny.some((t) => activeSelfTags.includes(t))) return false;
  }
  if (activationCondition.selfTagsNone && activationCondition.selfTagsNone.length > 0) {
    if (activationCondition.selfTagsNone.some((t) => activeSelfTags.includes(t))) return false;
  }
  return true;
}

/**
 * Evaluates a universal `DnD35EffectBundle` (`DnD35EffectBundleSchema`), checking atomic bundle
 * suppression (`suppressedBundleIds`), evaluating `activationCondition`, and tagging all emitted
 * `StatModifier`s with hierarchical `sourcePath` provenance (`"<parentSourcePath>/bundle:<bundleId>/<modId>"`).
 *
 * @param bundle The Effect Bundle definition.
 * @param parentSourcePath Parent provenance path (e.g. `"class:cleric/domain:war"` or `"race:dwarf"`).
 * @param suppressedBundleIds Optional array of suppressed bundle IDs on the actor (e.g. traded domain power).
 * @param activeSelfTags Optional active semantic self-tags on the actor for `activationCondition` gating.
 * @returns `EvaluatedEffectBundleResult`.
 */
export function evaluateEffectBundle(
  bundle: DnD35EffectBundle,
  parentSourcePath: string,
  suppressedBundleIds: ReadonlyArray<string> = [],
  activeSelfTags?: ReadonlyArray<string>
): EvaluatedEffectBundleResult {
  if (
    suppressedBundleIds.includes(bundle.bundleId) ||
    !isActivationConditionMet(bundle.activationCondition, activeSelfTags)
  ) {
    return {
      isActive: false,
      statModifiers: [],
      ruleOverrides: [],
      grantedTags: [],
      grantedFeats: [],
      virtualFeatGrants: [],
      classSkillsAdded: [],
      immunities: [],
      vulnerabilities: [],
      activatedAbilities: []
    };
  }

  const bundlePath = appendSourcePath(parentSourcePath, `bundle:${bundle.bundleId}`);
  const origin =
    bundle.category === 'su' || bundle.category === 'domain_power' ? 'su' : bundle.category === 'sp' ? 'sp' : 'ex';

  const statModifiers: StatModifier[] = bundle.modifiers.map((mod) => {
    const actCond = bundle.activationCondition;
    const modCond = mod.condition;
    const mergedCondition: StatModifierCondition | undefined =
      actCond || modCond
        ? {
            ...(modCond ?? {}),
            ...(mergeTags(actCond?.selfTagsAll, modCond?.selfTagsAll)
              ? { selfTagsAll: mergeTags(actCond?.selfTagsAll, modCond?.selfTagsAll) }
              : {}),
            ...(mergeTags(actCond?.selfTagsAny, modCond?.selfTagsAny)
              ? { selfTagsAny: mergeTags(actCond?.selfTagsAny, modCond?.selfTagsAny) }
              : {}),
            ...(mergeTags(actCond?.selfTagsNone, modCond?.selfTagsNone)
              ? { selfTagsNone: mergeTags(actCond?.selfTagsNone, modCond?.selfTagsNone) }
              : {})
          }
        : undefined;

    return {
      targetStat: mod.target,
      value: mod.value,
      bonusType: mod.type,
      sourceId: `${bundle.bundleId}:${mod.id}`,
      sourcePath: appendSourcePath(bundlePath, mod.id),
      origin,
      ...(mod.effectTags !== undefined ? { effectTags: mod.effectTags } : {}),
      ...(mergedCondition !== undefined ? { condition: mergedCondition } : {})
    };
  });

  return {
    isActive: true,
    statModifiers,
    ruleOverrides: bundle.ruleOverrides,
    grantedTags: bundle.grantedTags,
    grantedFeats: bundle.grantedFeats,
    virtualFeatGrants: bundle.virtualFeatGrants,
    classSkillsAdded: bundle.classSkillsAdded,
    immunities: bundle.immunities,
    vulnerabilities: bundle.vulnerabilities,
    activatedAbilities: bundle.activatedAbilities
  };
}

/**
 * Splits a potentially parameterized feat ID (e.g. `"weapon_focus:longsword"`)
 * into its canonical `baseFeatId` and optional `targetId`.
 *
 * @param rawFeatId The raw or parameterized feat ID string.
 * @returns Object with baseFeatId and optional targetId.
 */
export function parseParameterizedFeatId(rawFeatId: string): {
  readonly baseFeatId: string;
  readonly targetId?: string;
} {
  const colonIdx = rawFeatId.indexOf(':');
  if (colonIdx === -1) {
    return { baseFeatId: rawFeatId };
  }
  const baseFeatId = rawFeatId.slice(0, colonIdx);
  const targetId = rawFeatId.slice(colonIdx + 1);
  return targetId.length > 0 ? { baseFeatId, targetId } : { baseFeatId };
}

/**
 * Normalizes any `DnD35FeatDefinition` into a universal `DnD35EffectBundle` (`category: 'feat'`).
 * When `targetId` is provided (e.g. for targeted feats like `weapon_focus`, `weapon_specialization`,
 * `improved_critical`, `skill_focus`, `spell_focus`), binds the target into the bundle's modifiers,
 * conditions (`effectTagsAll`), or granted tags.
 *
 * @param featDef The feat definition.
 * @param targetId Optional target identifier (weapon ID, skill ID, or spell school).
 * @returns Universal `DnD35EffectBundle`.
 */
export function resolveFeatEffectBundle(featDef: DnD35FeatDefinition, targetId?: string): DnD35EffectBundle {
  const baseBundle: DnD35EffectBundle = featDef.effectBundle ?? {
    bundleId: featDef.id,
    name: featDef.name,
    category: 'feat',
    usageMode: 'passive',
    description: featDef.description,
    modifiers: featDef.modifiers ?? [],
    ruleOverrides: featDef.ruleOverrides ?? [],
    grantedTags: [],
    grantedFeats: [],
    virtualFeatGrants: [],
    classSkillsAdded: [],
    immunities: [],
    vulnerabilities: [],
    energyResistances: {},
    activatedAbilities: featDef.activatedAbilities ?? []
  };

  if (!targetId) {
    return baseBundle;
  }

  const targetCategory = featDef.repeatable?.targetCategory;
  const isWeaponTargeted =
    targetCategory === 'weapon' ||
    featDef.id.startsWith('weapon_') ||
    featDef.id.startsWith('greater_weapon_') ||
    featDef.id === 'improved_critical' ||
    featDef.id.includes('weapon_proficiency');

  const isSkillTargeted = targetCategory === 'skill' || featDef.id.startsWith('skill_');
  const isSchoolTargeted =
    targetCategory === 'school' || featDef.id.startsWith('spell_focus') || featDef.id.startsWith('greater_spell_focus');

  const transformedModifiers: DnD35DeclarativeModifier[] = baseBundle.modifiers.map((mod) => {
    if (isWeaponTargeted) {
      const isAttackMod = mod.target === 'attack' || mod.target === 'strike_attack';
      const isDamageMod = mod.target === 'damage' || mod.target === 'strike_damage';
      const isCritMod = mod.target === 'crit_threat_doubling';

      if (isAttackMod || isDamageMod || isCritMod) {
        const nextTarget = isAttackMod ? 'strike_attack' : isDamageMod ? 'strike_damage' : mod.target;
        const existingTags = mod.condition?.effectTagsAll ?? [];
        const weaponTag = `weapon:${targetId}`;
        const effectTagsAll = existingTags.includes(weaponTag) ? existingTags : [...existingTags, weaponTag];

        return {
          ...mod,
          target: nextTarget,
          condition: {
            ...(mod.condition ?? {}),
            effectTagsAll
          }
        };
      }
    } else if (isSkillTargeted) {
      if (mod.target === 'skill_all' || mod.target === 'skill') {
        return {
          ...mod,
          target: `skill:${targetId}`
        };
      }
    } else if (isSchoolTargeted) {
      if (mod.target === 'spell_save_dc' || mod.target === 'spell_dc') {
        const existingTags = mod.condition?.effectTagsAll ?? [];
        const schoolTag = `school:${targetId}`;
        const effectTagsAll = existingTags.includes(schoolTag) ? existingTags : [...existingTags, schoolTag];
        return {
          ...mod,
          target: 'spell_save_dc',
          condition: {
            ...(mod.condition ?? {}),
            effectTagsAll
          }
        };
      }
    }
    return mod;
  });

  const nextGrantedTags = [...baseBundle.grantedTags];
  if (isWeaponTargeted && (featDef.id.includes('weapon_proficiency') || featDef.id.startsWith('proficiency_'))) {
    nextGrantedTags.push(`proficiency:weapon:${targetId}`);
  }

  if (isSchoolTargeted) {
    for (const rule of baseBundle.ruleOverrides) {
      if (
        (rule.ruleKey === 'spell_save_dc_bonus' || rule.ruleKey === 'greater_spell_save_dc_bonus') &&
        typeof rule.value === 'number'
      ) {
        const schoolTag = `school:${targetId}`;
        const hasExisting = transformedModifiers.some(
          (m) => m.target === 'spell_save_dc' && m.condition?.effectTagsAll?.includes(schoolTag)
        );
        if (!hasExisting) {
          transformedModifiers.push({
            id: `${rule.id}_${targetId}`,
            target: 'spell_save_dc',
            value: rule.value,
            type: 'untyped',
            condition: {
              effectTagsAll: [schoolTag]
            }
          });
        }
      }
    }
  }

  return {
    ...baseBundle,
    bundleId: `${baseBundle.bundleId}:${targetId}`,
    modifiers: transformedModifiers,
    grantedTags: nextGrantedTags
  };
}
