import type {
  DnD35ActivatedAbilityDescriptor,
  DnD35EffectBundle,
  DnD35FeatGrantDescriptor,
  DnD35RuleOverrideEntry
} from './types/dnd35e_system.types.ts';
import { appendSourcePath } from './modifiers.ts';
import type { StatModifier, StatModifierCondition } from './types/dnd35e.types.ts';

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
  if (suppressedBundleIds.includes(bundle.bundleId)) {
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

  const isActive = isActivationConditionMet(bundle.activationCondition, activeSelfTags);
  if (!isActive) {
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
    const mergedCondition: StatModifierCondition | undefined =
      bundle.activationCondition || mod.condition
        ? {
            ...(mod.condition ?? {}),
            ...(bundle.activationCondition?.selfTagsAll !== undefined || mod.condition?.selfTagsAll !== undefined
              ? {
                  selfTagsAll: Array.from(
                    new Set([...(bundle.activationCondition?.selfTagsAll ?? []), ...(mod.condition?.selfTagsAll ?? [])])
                  )
                }
              : {}),
            ...(bundle.activationCondition?.selfTagsAny !== undefined || mod.condition?.selfTagsAny !== undefined
              ? {
                  selfTagsAny: Array.from(
                    new Set([...(bundle.activationCondition?.selfTagsAny ?? []), ...(mod.condition?.selfTagsAny ?? [])])
                  )
                }
              : {}),
            ...(bundle.activationCondition?.selfTagsNone !== undefined || mod.condition?.selfTagsNone !== undefined
              ? {
                  selfTagsNone: Array.from(
                    new Set([
                      ...(bundle.activationCondition?.selfTagsNone ?? []),
                      ...(mod.condition?.selfTagsNone ?? [])
                    ])
                  )
                }
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
