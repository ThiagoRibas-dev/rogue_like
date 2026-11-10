import { appendSourcePath } from '../modifiers.ts';
import { collectClassFeaturesUpToLevel } from '../progression.ts';
import {
  evaluateEffectBundle,
  isActivationConditionMet,
  parseParameterizedFeatId,
  resolveFeatEffectBundle
} from '../srd_registry.ts';
import type { HitDieTrack, StatModifier, StatModifierCondition } from '../types/dnd35e.types.ts';
import type {
  DnD35ClassDefinition,
  DnD35DomainDefinition,
  DnD35FeatDefinition,
  DnD35RuleOverrideEntry
} from '../types/dnd35e_system.types.ts';

/**
 * Collects all active granted and virtual feats from class features and domain granted power bundles,
 * respecting `suppressedBundleIds` and `activationCondition` tag checks (e.g. Ranger Combat Style in light/no armor).
 */
export function collectActiveGrantedAndVirtualFeats(
  tracks: ReadonlyArray<HitDieTrack>,
  selectedAcfs: ReadonlyArray<string>,
  domains: ReadonlyArray<string>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  domainRegistry: Readonly<Record<string, DnD35DomainDefinition>>,
  suppressedBundleIds: ReadonlyArray<string> = [],
  activeSelfTags?: ReadonlyArray<string>
): ReadonlyArray<string> {
  const granted = new Set<string>();

  for (const track of tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef) continue;
    const activeFeatures = collectClassFeaturesUpToLevel(classDef, track.levels, selectedAcfs);
    for (const featId of activeFeatures) {
      if (suppressedBundleIds.includes(featId)) continue;
      const detail = classDef.featureDetails[featId];
      if (!detail) continue;
      if (!isActivationConditionMet(detail.activationCondition, activeSelfTags)) continue;

      for (const gf of detail.grantedFeats ?? []) {
        granted.add(gf);
      }
      for (const vf of detail.virtualFeatGrants ?? []) {
        granted.add(vf.featId);
      }
    }
  }

  for (const domainId of domains) {
    const domainDef = domainRegistry[domainId];
    if (!domainDef) continue;
    if (domainDef.grantedPowerBundle) {
      if (suppressedBundleIds.includes(domainDef.grantedPowerBundle.bundleId)) continue;
      const evalRes = evaluateEffectBundle(
        domainDef.grantedPowerBundle,
        appendSourcePath('class:cleric', `domain:${domainDef.id}`),
        suppressedBundleIds,
        activeSelfTags
      );
      for (const gf of evalRes.grantedFeats) {
        granted.add(gf);
      }
      for (const vf of evalRes.virtualFeatGrants) {
        granted.add(vf.featId);
      }
      for (const f of domainDef.featGrants) {
        granted.add(f);
      }
    } else {
      for (const f of domainDef.featGrants) {
        granted.add(f);
      }
    }
  }

  return Array.from(granted);
}

/**
 * Builds class and domain Effect Provider StatModifiers with hierarchical sourcePath provenance.
 * Preserves `detail.activationCondition` merged onto emitted `StatModifier.condition` so Horizon 3
 * (`evaluateDnD35ActorStatDAG`) dynamically activates or suppresses modifiers when armor or load changes.
 */
export function buildClassAndDomainEffectModifiers(
  tracks: ReadonlyArray<HitDieTrack>,
  selectedAcfs: ReadonlyArray<string>,
  domains: ReadonlyArray<string>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  domainRegistry: Readonly<Record<string, DnD35DomainDefinition>>,
  suppressedBundleIds: ReadonlyArray<string> = [],
  activeSelfTags?: ReadonlyArray<string>
): ReadonlyArray<StatModifier> {
  const modifiers: StatModifier[] = [];

  for (const track of tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef) continue;
    const activeFeatures = collectClassFeaturesUpToLevel(classDef, track.levels, selectedAcfs);
    for (const featId of activeFeatures) {
      if (suppressedBundleIds.includes(featId)) continue;
      const detail = classDef.featureDetails[featId];
      if (!detail) continue;

      const featureRoot = appendSourcePath(`class:${classDef.id}`, `feature:${featId}`);
      for (const mod of detail.modifiers) {
        const mergedCondition: StatModifierCondition | undefined =
          detail.activationCondition !== undefined || mod.condition !== undefined
            ? {
                ...(mod.condition ?? {}),
                ...(detail.activationCondition?.selfTagsAll !== undefined || mod.condition?.selfTagsAll !== undefined
                  ? {
                      selfTagsAll: Array.from(
                        new Set([
                          ...(detail.activationCondition?.selfTagsAll ?? []),
                          ...(mod.condition?.selfTagsAll ?? [])
                        ])
                      )
                    }
                  : {}),
                ...(detail.activationCondition?.selfTagsAny !== undefined || mod.condition?.selfTagsAny !== undefined
                  ? {
                      selfTagsAny: Array.from(
                        new Set([
                          ...(detail.activationCondition?.selfTagsAny ?? []),
                          ...(mod.condition?.selfTagsAny ?? [])
                        ])
                      )
                    }
                  : {}),
                ...(detail.activationCondition?.selfTagsNone !== undefined || mod.condition?.selfTagsNone !== undefined
                  ? {
                      selfTagsNone: Array.from(
                        new Set([
                          ...(detail.activationCondition?.selfTagsNone ?? []),
                          ...(mod.condition?.selfTagsNone ?? [])
                        ])
                      )
                    }
                  : {})
              }
            : undefined;
        modifiers.push({
          targetStat: mod.target,
          value: mod.value,
          bonusType: mod.type,
          sourceId: `class:${classDef.id}:${mod.id}`,
          sourcePath: appendSourcePath(featureRoot, mod.id),
          origin: detail.category === 'su' ? 'su' : detail.category === 'sp' ? 'sp' : 'ex',
          ...(mod.effectTags !== undefined ? { effectTags: mod.effectTags } : {}),
          ...(mergedCondition !== undefined ? { condition: mergedCondition } : {})
        });
      }
    }
  }

  for (const domainId of domains) {
    const domainDef = domainRegistry[domainId];
    if (!domainDef) continue;
    const domainRoot = appendSourcePath('class:cleric', `domain:${domainDef.id}`);
    if (domainDef.grantedPowerBundle) {
      const evalRes = evaluateEffectBundle(
        domainDef.grantedPowerBundle,
        domainRoot,
        suppressedBundleIds,
        activeSelfTags
      );
      modifiers.push(...evalRes.statModifiers);
    } else {
      for (const mod of domainDef.modifiers) {
        modifiers.push({
          targetStat: mod.target,
          value: mod.value,
          bonusType: mod.type,
          sourceId: `domain:${domainDef.id}:${mod.id}`,
          sourcePath: appendSourcePath(domainRoot, mod.id),
          origin: 'su',
          ...(mod.effectTags !== undefined ? { effectTags: mod.effectTags } : {}),
          ...(mod.condition !== undefined ? { condition: mod.condition } : {})
        });
      }
    }
  }

  return modifiers;
}

/**
 * Builds passive and conditional `StatModifier` entries from an actor's acquired feats (`dndData.feats`),
 * tagging each modifier with its hierarchical `sourcePath` (`feat:<featId>/...`).
 * For stacking repeatable feats (e.g. Toughness taken multiple times), assigns indexed provenance
 * (`feat:toughness#1/...`, `feat:toughness#2/...`) so each instance stacks without sourceId collision.
 */
export function buildFeatEffectModifiers(
  featIds: ReadonlyArray<string>,
  featRegistry: Readonly<Record<string, DnD35FeatDefinition>> | undefined,
  suppressedBundleIds: ReadonlyArray<string> = [],
  activeSelfTags?: ReadonlyArray<string>
): ReadonlyArray<StatModifier> {
  if (!featRegistry || featIds.length === 0) return [];
  const modifiers: StatModifier[] = [];
  const featOccurrences: Record<string, number> = {};

  for (const rawFeatId of featIds) {
    const { baseFeatId, targetId } = parseParameterizedFeatId(rawFeatId);
    const featDef = featRegistry[rawFeatId] ?? featRegistry[baseFeatId];
    if (!featDef) continue;
    if (suppressedBundleIds.includes(rawFeatId) || suppressedBundleIds.includes(featDef.id)) continue;

    const occurrence = (featOccurrences[rawFeatId] ?? 0) + 1;
    featOccurrences[rawFeatId] = occurrence;
    const instanceSuffix = featDef.repeatable?.mode === 'stacking' || occurrence > 1 ? `#${occurrence}` : '';
    const featRoot = `feat:${rawFeatId}${instanceSuffix}`;

    if (featDef.modifiers.length > 0) {
      const topLevelResolved = resolveFeatEffectBundle({ ...featDef, effectBundle: undefined }, targetId);
      for (const mod of topLevelResolved.modifiers) {
        modifiers.push({
          targetStat: mod.target,
          value: mod.value,
          bonusType: mod.type,
          sourceId: `${featRoot}:${mod.id}`,
          sourcePath: appendSourcePath(featRoot, mod.id),
          origin: 'ex',
          ...(mod.effectTags !== undefined ? { effectTags: mod.effectTags } : {}),
          ...(mod.condition !== undefined ? { condition: mod.condition } : {})
        });
      }
    }

    if (featDef.effectBundle) {
      const resolvedBundle = resolveFeatEffectBundle(featDef, targetId);
      const evalRes = evaluateEffectBundle(resolvedBundle, featRoot, suppressedBundleIds, activeSelfTags);
      for (const sm of evalRes.statModifiers) {
        modifiers.push({
          ...sm,
          sourceId: occurrence > 1 ? `${sm.sourceId}#${occurrence}` : sm.sourceId
        });
      }
    }
  }

  return modifiers;
}

/**
 * Collects declarative `DnD35RuleOverrideEntry` records from an actor's active feats.
 */
export function collectActiveFeatRuleOverrides(
  featIds: ReadonlyArray<string>,
  featRegistry: Readonly<Record<string, DnD35FeatDefinition>> | undefined,
  suppressedBundleIds: ReadonlyArray<string> = [],
  activeSelfTags?: ReadonlyArray<string>
): ReadonlyArray<DnD35RuleOverrideEntry> {
  if (!featRegistry || featIds.length === 0) return [];
  const overrides: DnD35RuleOverrideEntry[] = [];

  for (const rawFeatId of featIds) {
    const { baseFeatId, targetId } = parseParameterizedFeatId(rawFeatId);
    const featDef = featRegistry[rawFeatId] ?? featRegistry[baseFeatId];
    if (!featDef) continue;
    if (suppressedBundleIds.includes(rawFeatId) || suppressedBundleIds.includes(featDef.id)) continue;

    const resolvedBundle = resolveFeatEffectBundle(featDef, targetId);
    const evalRes = evaluateEffectBundle(resolvedBundle, `feat:${rawFeatId}`, suppressedBundleIds, activeSelfTags);
    overrides.push(...evalRes.ruleOverrides);
  }

  return overrides;
}

/** Base primary-hand and off-hand attack penalty (`-4`) when fighting with two weapons with the Two-Weapon Fighting feat before light-weapon adjustment. */
const TWF_FEAT_BASE_PENALTY = -4;

/**
 * Resolved combat behavioral flags and numerical penalty overrides derived purely from active `DnD35RuleOverrideEntry` records.
 */
export interface ResolvedActiveCombatRules {
  readonly hasWeaponFinesse: boolean;
  readonly hasBlindFight: boolean;
  readonly hasCleave: boolean;
  readonly hasGreatCleave: boolean;
  readonly hasExoticWeaponProficiency: boolean;
  readonly combatOverrides: {
    readonly secondaryNaturalPenalty?: number | undefined;
    readonly twfPrimaryPenalty?: number | undefined;
    readonly twfOffHandPenalty?: number | undefined;
    readonly extraOffHandAttacks?: number | undefined;
  };
}

/**
 * Derives `ResolvedActiveCombatRules` strictly from declarative `DnD35RuleOverrideEntry` records
 * without inspecting feat IDs directly (`AGENTS.md` Rule 17).
 */
export function buildCombatRuleOverridesFromActiveRules(
  ruleOverrides: ReadonlyArray<DnD35RuleOverrideEntry>,
  offHandIsLight: boolean
): ResolvedActiveCombatRules {
  const hasWeaponFinesse = ruleOverrides.some(
    (r) => r.ruleKey === 'use_dex_for_light_finesse_melee_attack' && r.value === true
  );
  const hasBlindFight = ruleOverrides.some((r) => r.ruleKey === 'reroll_concealment_miss_chance' && r.value === true);
  const hasCleave = ruleOverrides.some(
    (r) => (r.ruleKey === 'cleave_followup_on_drop' || r.ruleKey === 'cleave_extra_attack_on_drop') && r.value === true
  );
  const hasGreatCleave = ruleOverrides.some(
    (r) =>
      (r.ruleKey === 'great_cleave_unlimited_on_drop' || r.ruleKey === 'great_cleave_unlimited') && r.value === true
  );
  const hasExoticWeaponProficiency = ruleOverrides.some(
    (r) => r.ruleKey === 'exotic_weapon_proficiency' && r.value === true
  );

  let secondaryNaturalPenalty: number | undefined;
  let baseTwfPrimary: number | undefined;
  let baseTwfOffHand: number | undefined;
  let twfLightBonus = 0;
  let extraOffHandAttacks = 0;

  for (const r of ruleOverrides) {
    if (
      (r.ruleKey === 'secondary_natural_penalty' || r.ruleKey === 'secondary_natural_attack_penalty') &&
      typeof r.value === 'number'
    ) {
      secondaryNaturalPenalty =
        secondaryNaturalPenalty === undefined ? r.value : Math.max(secondaryNaturalPenalty, r.value);
    } else if (r.ruleKey === 'twf_penalty_reduction' && r.value === true) {
      baseTwfPrimary =
        baseTwfPrimary === undefined ? TWF_FEAT_BASE_PENALTY : Math.max(baseTwfPrimary, TWF_FEAT_BASE_PENALTY);
      baseTwfOffHand =
        baseTwfOffHand === undefined ? TWF_FEAT_BASE_PENALTY : Math.max(baseTwfOffHand, TWF_FEAT_BASE_PENALTY);
    } else if (r.ruleKey === 'twf_primary_penalty' && typeof r.value === 'number') {
      baseTwfPrimary = baseTwfPrimary === undefined ? r.value : Math.max(baseTwfPrimary, r.value);
    } else if (r.ruleKey === 'twf_offhand_penalty' && typeof r.value === 'number') {
      baseTwfOffHand = baseTwfOffHand === undefined ? r.value : Math.max(baseTwfOffHand, r.value);
    } else if (r.ruleKey === 'twf_light_offhand_bonus' && typeof r.value === 'number') {
      twfLightBonus = Math.max(twfLightBonus, r.value);
    } else if (r.ruleKey === 'extra_offhand_attacks' && typeof r.value === 'number') {
      extraOffHandAttacks = Math.max(extraOffHandAttacks, r.value);
    }
  }

  const lightBonus = offHandIsLight ? (twfLightBonus > 0 ? twfLightBonus : 2) : 0;
  const twfPrimaryPenalty = baseTwfPrimary !== undefined ? baseTwfPrimary + lightBonus : undefined;
  const twfOffHandPenalty = baseTwfOffHand !== undefined ? baseTwfOffHand + lightBonus : undefined;

  return {
    hasWeaponFinesse,
    hasBlindFight,
    hasCleave,
    hasGreatCleave,
    hasExoticWeaponProficiency,
    combatOverrides: {
      ...(secondaryNaturalPenalty !== undefined ? { secondaryNaturalPenalty } : {}),
      ...(twfPrimaryPenalty !== undefined ? { twfPrimaryPenalty } : {}),
      ...(twfOffHandPenalty !== undefined ? { twfOffHandPenalty } : {}),
      ...(extraOffHandAttacks > 0 ? { extraOffHandAttacks } : {})
    }
  };
}
