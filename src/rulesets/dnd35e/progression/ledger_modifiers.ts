import { appendSourcePath } from '../modifiers.ts';
import { collectClassFeaturesUpToLevel } from '../progression.ts';
import { evaluateEffectBundle, isActivationConditionMet } from '../srd_registry.ts';
import type { HitDieTrack, StatModifier, StatModifierCondition } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35DomainDefinition } from '../types/dnd35e_system.types.ts';

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
          ...(mod.condition !== undefined ? { condition: mod.condition } : {})
        });
      }
    }
  }

  return modifiers;
}
